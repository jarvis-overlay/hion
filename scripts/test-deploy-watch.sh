#!/bin/bash
# scripts/deploy-watch.sh 논리 검증 (가짜 git 저장소 + 가짜 npm/pm2/curl). 맥북 없이도 실행된다:
#   bash scripts/test-deploy-watch.sh
# 진짜 pm2/macOS/실제 빌드는 검증하지 않는다 - 전환·복구·재시도·잠금 같은 "순서와 조건"만 본다.

SRC="$(cd "$(dirname "$0")" && pwd)"
T=$(mktemp -d)
trap 'rm -rf "$T"; kill $SLEEPER 2>/dev/null' EXIT
export T
PASS=0; FAILN=0
ok()   { PASS=$((PASS + 1)); echo "  ok  $1"; }
bad()  { FAILN=$((FAILN + 1)); echo "  FAIL $1"; }
check() { if eval "$2"; then ok "$1"; else bad "$1  [$2]"; fi; }

# ---- 가짜 명령 ----
mkdir -p "$T/bin"
cat > "$T/bin/npm" <<'EOF'
#!/bin/bash
echo "npm $1 $2 [DIST=$NEXT_DIST_DIR]" >> "$T/calls.log"
case "$1" in
  install) [ -f "$T/FAIL_INSTALL" ] && exit 1; mkdir -p node_modules; exit 0 ;;
  run)
    mkdir -p "$NEXT_DIST_DIR"
    [ -f "$T/FAIL_BUILD" ] && exit 1
    echo "build-$(git rev-parse --short HEAD)" > "$NEXT_DIST_DIR/BUILD_ID"; exit 0 ;;
esac
EOF
cat > "$T/bin/pm2" <<'EOF'
#!/bin/bash
echo "pm2 $1 [DIST=$NEXT_DIST_DIR]" >> "$T/calls.log"
[ "$1" = "restart" ] && echo "$NEXT_DIST_DIR" > "$T/serving"
exit 0
EOF
cat > "$T/bin/curl" <<'EOF'
#!/bin/bash
url="${@: -1}"
serving=$(cat "$T/serving" 2>/dev/null)
case "$url" in
  */login)
    [ -f "$T/HEALTH_FAIL_DIR" ] && [ "$serving" = "$(cat "$T/HEALTH_FAIL_DIR")" ] && exit 22
    echo '<html><link rel="stylesheet" href="/_next/static/css/abc.css"></html>'; exit 0 ;;
  *) [ -f "$T/ASSET_FAIL" ] && exit 22; exit 0 ;;
esac
EOF
chmod +x "$T/bin/"*
export PATH="$T/bin:$PATH"

# ---- 가짜 저장소: origin(bare) / dev(커밋 올리는 쪽) / hion(맥북 쪽) ----
git init -q --bare -b main "$T/origin.git"
git clone -q "$T/origin.git" "$T/dev" 2>/dev/null
( cd "$T/dev" && git config user.email t@t && git config user.name t \
  && mkdir scripts && cp "$SRC/deploy-watch.sh" scripts/ && echo '{}' > package.json && echo lock1 > package-lock.json && echo base > file.txt \
  && git add -A && git commit -q -m init && git push -q origin HEAD:main 2>/dev/null )
git clone -q "$T/origin.git" "$T/hion" 2>/dev/null
( cd "$T/hion" && git config user.email t@t && git config user.name t )

export HION_DIR="$T/hion" STATE_DIR="$T/state" HEALTH_WAIT=2 RETRY_SECS=1800 NPM_CACHE="$T/npmcache"
run()  { bash "$T/hion/scripts/deploy-watch.sh" > "$T/out.log" 2>&1; }
calls(){ wc -l < "$T/calls.log" 2>/dev/null || echo 0; }
push() { # push <파일> <내용> : dev에서 커밋해 origin에 올림
  ( cd "$T/dev" && echo "$2" >> "$1" && git add -A && git commit -q -m "c-$RANDOM" && git push -q origin HEAD:main 2>/dev/null ); }
state() { cat "$T/state/$1" 2>/dev/null; }
head_of_origin() { git -C "$T/origin.git" rev-parse main; }
: > "$T/calls.log"

echo "1) 첫 실행: 빌드 → 전환 → 확인 → 기록"
run
check "서비스 칸 a로 전환" '[ "$(state slot)" = a ]'
check "pm2가 .next-a 로 재시작" 'grep -q "pm2 restart \[DIST=.next-a\]" "$T/calls.log"'
check "성공 커밋 기록" '[ "$(state deployed_sha)" = "$(head_of_origin)" ]'
check "pm2 save 호출(재부팅 복원용)" 'grep -q "pm2 save" "$T/calls.log"'
check "처음엔 npm install 실행" 'grep -q "npm install" "$T/calls.log"'
check "배포 완료 로그" 'grep -q "배포 완료" "$T/out.log"'

echo "2) 변경 없으면 아무것도 안 함"
n=$(calls); run
check "추가 호출 없음" '[ "$(calls)" = "$n" ]'

echo "3) 새 커밋(package-lock 변경): 설치 + 다른 칸(b)으로 전환"
push package-lock.json lock2; push file.txt x
n=$(calls); run
check "npm install 실행" 'tail -n +$((n+1)) "$T/calls.log" | grep -q "npm install"'
check "서비스 칸 b로 전환" '[ "$(state slot)" = b ] && [ "$(cat "$T/serving")" = .next-b ]'
check "이전 칸(.next-a)은 롤백용으로 남음" '[ -f "$T/hion/.next-a/BUILD_ID" ]'

echo "4) 새 커밋(lock 그대로): npm install 건너뜀"
push file.txt y
n=$(calls); run
check "npm install 안 함" '! tail -n +$((n+1)) "$T/calls.log" | grep -q "npm install"'
check "칸 a로 전환" '[ "$(state slot)" = a ]'

echo "5) 빌드 실패: 서비스는 그대로, 실패 기록, 재시도 대기"
push file.txt z; touch "$T/FAIL_BUILD"
prev=$(state deployed_sha); n=$(calls); run
check "pm2 재시작 안 함(사이트 그대로)" '! tail -n +$((n+1)) "$T/calls.log" | grep -q "pm2 restart"'
check "서비스 칸 그대로(a)" '[ "$(state slot)" = a ] && [ "$(cat "$T/serving")" = .next-a ]'
check "성공 커밋 기록 안 바뀜" '[ "$(state deployed_sha)" = "$prev" ]'
check "실패 기록" 'grep -q "$(head_of_origin)" "$T/state/failed"'
check "실패한 빈 빌드 폴더는 지움" '[ ! -d "$T/hion/.next-b" ]'
n=$(calls); run
check "대기 시간 안에는 다시 빌드 안 함" '[ "$(calls)" = "$n" ]'
n=$(calls); RETRY_SECS=0 run
check "대기 시간이 지나면 다시 시도" 'tail -n +$((n+1)) "$T/calls.log" | grep -q "npm run"'
rm -f "$T/FAIL_BUILD"; n=$(calls); RETRY_SECS=0 run
check "원인 해결 후 재시도하면 성공" '[ "$(state deployed_sha)" = "$(head_of_origin)" ] && [ "$(state slot)" = b ]'
check "성공하면 실패 기록 삭제" '[ ! -f "$T/state/failed" ]'

echo "6) npm install 실패: 빌드로 넘어가지 않음, 나중에 설치부터 다시"
push package-lock.json lock3; touch "$T/FAIL_INSTALL"
prev=$(state deployed_sha); lockprev=$(state lock_hash); n=$(calls); run
check "빌드 안 함" '! tail -n +$((n+1)) "$T/calls.log" | grep -q "npm run"'
check "서비스 그대로" '[ "$(state slot)" = b ] && [ "$(state deployed_sha)" = "$prev" ]'
check "설치 성공으로 기록하지 않음" '[ "$(state lock_hash)" = "$lockprev" ]'
rm -f "$T/FAIL_INSTALL"; n=$(calls); RETRY_SECS=0 run
check "재시도 때 npm install 다시 실행" 'tail -n +$((n+1)) "$T/calls.log" | grep -q "npm install"'
check "재시도 성공" '[ "$(state deployed_sha)" = "$(head_of_origin)" ]'

echo "7) 전환 뒤 서버가 제대로 안 뜨면 이전 칸으로 롤백"
push file.txt h; cur=$(state slot)
if [ "$cur" = a ]; then tgt=b; else tgt=a; fi
echo ".next-$tgt" > "$T/HEALTH_FAIL_DIR"
prev=$(state deployed_sha); n=$(calls); run
check "롤백으로 이전 칸 서비스 중" '[ "$(cat "$T/serving")" = ".next-$cur" ]'
check "성공 커밋 기록 안 바뀜" '[ "$(state deployed_sha)" = "$prev" ] && [ "$(state slot)" = "$cur" ]'
check "새 칸 폴더 정리" '[ ! -d "$T/hion/.next-$tgt" ]'
check "롤백 로그" 'grep -q "되돌려요" "$T/out.log"'
rm -f "$T/HEALTH_FAIL_DIR"
echo "7b) 정적 파일이 안 나오면(2026-11 장애 증상) 실패로 판단"
touch "$T/ASSET_FAIL"; RETRY_SECS=0 run
check "정적 파일 400이면 전환 실패 처리" '[ "$(state deployed_sha)" = "$prev" ]'
rm -f "$T/ASSET_FAIL"; RETRY_SECS=0 run
check "정상이면 배포" '[ "$(state deployed_sha)" = "$(head_of_origin)" ]'

echo "8) 잠금"
push file.txt l1
mkdir -p "$T/state/lock"; echo 999999 > "$T/state/lock/pid"
run
check "죽은 프로세스의 잠금은 치우고 배포" '[ "$(state deployed_sha)" = "$(head_of_origin)" ] && grep -q "오래된 잠금" "$T/out.log"'
push file.txt l2
sleep 60 & SLEEPER=$!
mkdir -p "$T/state/lock"; echo $SLEEPER > "$T/state/lock/pid"
n=$(calls); run
check "다른 배포가 진행 중이면 건너뜀" '[ "$(calls)" = "$n" ] && [ -d "$T/state/lock" ]'
rm -rf "$T/state/lock"; kill $SLEEPER 2>/dev/null
check "정상 종료하면 잠금 안 남김" 'run; [ ! -d "$T/state/lock" ]'

echo "9) 서버 폴더에 수정이 남아 있어도(충돌) 보관 후 배포"
push file.txt l3
( cd "$T/hion" && echo local-edit >> file.txt )
push file.txt remote-edit
run
check "배포 성공" '[ "$(state deployed_sha)" = "$(head_of_origin)" ]'
check "수정은 stash에 보관" '[ -n "$(git -C "$T/hion" stash list)" ]'

echo "10) 배포 도중 이 스크립트 파일 자체가 바뀌어도 끝까지 실행"
push scripts/deploy-watch.sh "# 주석 한 줄 추가(자기 자신 교체 테스트)"
run
check "스크립트 교체 후에도 배포 완료" '[ "$(state deployed_sha)" = "$(head_of_origin)" ] && grep -q "배포 완료" "$T/out.log"'

echo
echo "결과: 통과 $PASS / 실패 $FAILN"
[ "$FAILN" = 0 ]
