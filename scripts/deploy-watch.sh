#!/bin/bash
# hion 맥북 자동배포 (무중단 전환 + 실패 시 자동 복구)
#
# launchd(com.hion.autodeploy)가 90초마다 실행한다. 설치/설명: scripts/DEPLOY.md
#
# 옛 방식의 문제(2026-11-08 장애):
#   - 빌드가 실행 중인 서버의 .next를 그 자리에서 지워서, 빌드 중/실패 후 사이트가 깨짐
#   - npm install 실패를 확인하지 않고 빌드로 넘어감
#   - git pull이 끝나면 HEAD가 최신이 돼서, 실패한 배포는 다시 시도하지 않음
#   - 중간에 죽으면 /tmp 잠금 파일이 남아 자동배포가 영영 멈춤
#
# 새 방식:
#   - 서버가 안 쓰는 칸(.next-a / .next-b)에 빌드한다 (NEXT_DIST_DIR). 빌드 중에도 사이트는 그대로.
#   - 빌드가 성공해야만 pm2를 새 칸으로 다시 시작하고, 로그인 페이지와 정적 파일이 실제로 나오는지 확인한다.
#     확인에 실패하면 이전 칸으로 되돌린다.
#   - "마지막으로 배포에 성공한 커밋"을 따로 기록해서, 실패한 커밋은 일정 시간 뒤 다시 시도한다.
#   - 잠금은 프로세스 번호로 확인하고, 죽은/오래된 잠금은 스스로 치운다.
#
# 이 파일 전체를 main() 함수 안에 넣고 마지막에 exit 하는 이유: 배포 도중 git이 이 파일 자체를
# 새 버전으로 바꿔도 bash가 중간부터 읽다 꼬이지 않게 하려는 것이다.

# launchd 데몬은 HOME이 비어 있을 수 있어서 맥북 계정 폴더를 기본값으로 둔다
export HOME="${HOME:-/Users/wook}"
HION_DIR="${HION_DIR:-/Users/wook/hion}"
STATE_DIR="${STATE_DIR:-$HOME/.hion-deploy}"
PM2_NAME="${PM2_NAME:-hion}"
APP_URL="${APP_URL:-http://127.0.0.1:3000}"
RETRY_SECS="${RETRY_SECS:-1800}"       # 실패한 커밋을 다시 시도하기까지 기다리는 시간
LOCK_MAX_MIN="${LOCK_MAX_MIN:-45}"     # 이보다 오래된 잠금은 멈춘 것으로 본다
HEALTH_WAIT="${HEALTH_WAIT:-45}"       # 재시작 후 서버가 뜨기를 기다리는 최대 초
NPM_CACHE="${NPM_CACHE:-$HOME/.npm-hion}"  # ~/.npm 일부가 root 소유라 EACCES가 났던 문제 회피

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

main() {
  export PATH="$PATH:/Users/wook/bin:/Users/wook/.npm-global/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  mkdir -p "$STATE_DIR" || return 1
  cd "$HION_DIR" || { log "프로젝트 폴더를 찾을 수 없어요: $HION_DIR"; return 1; }

  acquire_lock || return 0
  trap release_lock EXIT

  if ! git fetch origin main --quiet 2>&1; then
    log "git fetch 실패 (네트워크?) - 다음 주기에 다시 시도"
    return 1
  fi
  REMOTE=$(git rev-parse origin/main) || return 1
  DEPLOYED=$(cat "$STATE_DIR/deployed_sha" 2>/dev/null || echo "")

  [ "$REMOTE" = "$DEPLOYED" ] && return 0

  # 같은 커밋이 방금 실패했으면 잠시 쉬었다가 다시 시도 (고장 난 커밋을 90초마다 빌드하지 않게)
  if [ -f "$STATE_DIR/failed" ]; then
    read -r F_SHA F_AT F_WHY < "$STATE_DIR/failed"
    NOW=$(date +%s)
    if [ "$F_SHA" = "$REMOTE" ] && [ $((NOW - ${F_AT:-0})) -lt "$RETRY_SECS" ]; then
      return 0
    fi
  fi

  log "새 커밋 발견 (${DEPLOYED:-없음} -> $REMOTE), 배포 시작"

  # 1) 코드 받기: 서버에 남은 수정이 있으면 지우지 않고 stash에 보관
  if ! git merge --ff-only origin/main >/dev/null 2>&1; then
    log "서버 작업 폴더에 수정이 있어 보관(stash)한 뒤 다시 받아요"
    git stash push -m "autodeploy $(date +%Y%m%d-%H%M%S)" >/dev/null 2>&1
    if ! git merge --ff-only origin/main 2>&1; then
      fail "$REMOTE" "git 병합 실패"
      return 1
    fi
  fi

  # 2) 패키지 설치: package-lock.json이 달라졌거나 node_modules가 없을 때. 실패하면 여기서 중단
  LOCK_NOW=$(git hash-object package-lock.json 2>/dev/null || echo "none")
  LOCK_DONE=$(cat "$STATE_DIR/lock_hash" 2>/dev/null || echo "")
  if [ "$LOCK_NOW" != "$LOCK_DONE" ] || [ ! -d node_modules ]; then
    log "패키지 설치 (npm install)"
    if ! npm install --no-audit --no-fund --cache "$NPM_CACHE" 2>&1; then
      fail "$REMOTE" "npm install 실패 - 기존 사이트는 그대로 서비스 중"
      return 1
    fi
    echo "$LOCK_NOW" > "$STATE_DIR/lock_hash"
  fi

  # 3) 서버가 안 쓰는 칸에 빌드
  CURRENT=$(cat "$STATE_DIR/slot" 2>/dev/null || echo "")
  if [ "$CURRENT" = "a" ]; then TARGET=b; else TARGET=a; fi
  TARGET_DIR=".next-$TARGET"
  if [ -n "$CURRENT" ]; then CUR_LABEL=".next-$CURRENT"; else CUR_LABEL=".next"; fi
  log "빌드 시작 → $TARGET_DIR (현재 서비스: $CUR_LABEL)"
  rm -rf "$TARGET_DIR"
  if ! NEXT_DIST_DIR="$TARGET_DIR" npm run build 2>&1; then
    rm -rf "$TARGET_DIR"
    fail "$REMOTE" "빌드 실패 - 기존 사이트는 그대로 서비스 중"
    return 1
  fi
  if [ ! -f "$TARGET_DIR/BUILD_ID" ]; then
    rm -rf "$TARGET_DIR"
    fail "$REMOTE" "빌드가 끝났는데 BUILD_ID가 없어요"
    return 1
  fi

  # 4) 새 칸으로 서버 전환 + 실제로 뜨는지 확인, 안 되면 되돌림
  log "서버를 $TARGET_DIR 로 전환"
  NEXT_DIST_DIR="$TARGET_DIR" pm2 restart "$PM2_NAME" --update-env >/dev/null 2>&1
  if ! health_check; then
    log "새 빌드가 정상적으로 뜨지 않아요 - 이전 상태로 되돌려요"
    if [ -n "$CURRENT" ]; then
      NEXT_DIST_DIR=".next-$CURRENT" pm2 restart "$PM2_NAME" --update-env >/dev/null 2>&1
    else
      NEXT_DIST_DIR=".next" pm2 restart "$PM2_NAME" --update-env >/dev/null 2>&1
    fi
    rm -rf "$TARGET_DIR"
    fail "$REMOTE" "전환 후 확인 실패(롤백함)"
    return 1
  fi

  # 5) 성공 기록 (pm2 save: 맥북이 재부팅돼도 이 칸으로 복원되게)
  echo "$TARGET" > "$STATE_DIR/slot"
  echo "$REMOTE" > "$STATE_DIR/deployed_sha"
  rm -f "$STATE_DIR/failed"
  pm2 save >/dev/null 2>&1
  log "배포 완료 ($REMOTE, 서비스 칸: $TARGET_DIR)"
  return 0
}

# 서버가 응답하고, 로그인 페이지가 가리키는 정적 파일(CSS/JS)이 실제로 나오는지 확인
health_check() {
  local i=0 html asset
  while [ "$i" -lt "$HEALTH_WAIT" ]; do
    html=$(curl -fsS -m 5 "$APP_URL/login" 2>/dev/null) && break
    i=$((i + 2))
    sleep 2
  done
  [ -n "$html" ] || return 1
  asset=$(echo "$html" | grep -oE '/_next/static/[^"]*\.(css|js)' | head -1)
  [ -n "$asset" ] || return 1
  curl -fsS -m 10 -o /dev/null "$APP_URL$asset" 2>/dev/null
}

fail() {
  echo "$1 $(date +%s) $2" > "$STATE_DIR/failed"
  log "배포 실패 ($1): $2 - $((RETRY_SECS / 60))분 뒤 다시 시도해요"
}

# 잠금: mkdir은 원자적이다. 프로세스가 죽었거나 너무 오래됐으면 치우고 이어간다
acquire_lock() {
  local dir="$STATE_DIR/lock" pid
  if mkdir "$dir" 2>/dev/null; then echo $$ > "$dir/pid"; return 0; fi
  pid=$(cat "$dir/pid" 2>/dev/null)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    if [ -n "$(find "$dir" -maxdepth 0 -mmin +"$LOCK_MAX_MIN" 2>/dev/null)" ]; then
      log "배포가 ${LOCK_MAX_MIN}분 넘게 멈춰 있어요 (pid $pid) - 종료하고 다시 시작"
      kill "$pid" 2>/dev/null
      sleep 2
    else
      return 1
    fi
  else
    log "남아 있던 오래된 잠금을 치웠어요"
  fi
  rm -rf "$dir"
  mkdir "$dir" 2>/dev/null || return 1
  echo $$ > "$dir/pid"
  return 0
}

release_lock() { rm -rf "$STATE_DIR/lock"; }

main "$@"
exit $?
