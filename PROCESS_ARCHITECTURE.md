# hion 서버 프로세스 구조 (이 맥북 기준 실측, 2026-11-05)

이 문서는 설치 방법이 아니라 **지금 이 순간 실제로 떠 있는 프로세스/서비스를
그대로 기록**한 스냅샷이다. 셋업 절차는 `SETUP_MACOS_SELFHOST.md` 참고.

## 0. 환경

| 항목 | 값 |
| --- | --- |
| 호스트 | `wook@gim-ug-ui-MacBookPro` (개인 맥북) |
| OS | macOS 12.7.6 (Build 21H1320) |
| 프로젝트 경로 | `/Users/wook/hion` |
| Node.js | v24.21.0 |
| npm | 11.19.0 |
| 외부 도메인 | `https://hion.cc` |
| 앱 리슨 포트 | `localhost:3000` (Next.js, `npm start` = `next start`) |

## 1. 전체 요청 흐름

```
인터넷 사용자
    │  https://hion.cc
    ▼
Cloudflare 엣지 (DNS + TLS 종료, 네임서버가 Cloudflare로 위임됨)
    │  Cloudflare Tunnel (아웃바운드 연결, 포트포워딩/공인IP 불필요)
    ▼
cloudflared 데몬 (이 맥북에서 상시 실행, launchd가 관리)
    │  tunnel --config ~/.cloudflared/config.yml run
    │  config.yml의 ingress 규칙: hostname hion.cc → http://localhost:3000
    ▼
localhost:3000
    │
    ▼
Next.js 프로덕션 서버 (`npm start` 프로세스, pm2가 관리, 이름 "hion")
```

## 2. launchd 서비스 (전부 `/Library/LaunchDaemons/`, root가 부팅 시 실행)

### 2-1. `pm2.wook.plist`
```xml
Label: pm2.wook
RunAtLoad: true, KeepAlive: true
UserName: wook
ProgramArguments: [/Users/wook/.npm-global/lib/node_modules/pm2/bin/pm2, resurrect]
EnvironmentVariables: PATH=/Users/wook/.npm-global/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
                      PM2_HOME=/Users/wook/.pm2
로그: /Users/wook/.pm2/pm2.log
```
역할: 부팅/로그인 시 `pm2 resurrect`를 실행해 `~/.pm2/dump.pm2`에 저장된
프로세스 목록(`hion`, `caffeinate`)을 그대로 복원. **pm2 데몬 자체를 띄우는
게 아니라, 마지막으로 `pm2 save`한 상태를 되살리는 것**이라는 점에 주의.

### 2-2. `com.cloudflare.cloudflared.plist`
```xml
Label: com.cloudflare.cloudflared
ProgramArguments: [/Users/wook/bin/cloudflared, tunnel, --config,
                    /Users/wook/.cloudflared/config.yml, run]
RunAtLoad: true
KeepAlive: { SuccessfulExit: false }   # 비정상 종료 시 자동 재시작
ThrottleInterval: 5
로그: /Library/Logs/com.cloudflare.cloudflared.{out,err}.log
```
역할: Cloudflare Tunnel 클라이언트를 상시 실행. 터널 설정:
```yaml
tunnel: hion
credentials-file: /Users/wook/.cloudflared/1041e087-f127-418e-b3c8-02c63d4ba03b.json
ingress:
  - hostname: hion.cc
    service: http://localhost:3000
  - service: http_status:404
```

### 2-3. `com.hion.autodeploy.plist`
```xml
Label: com.hion.autodeploy
UserName: wook
ProgramArguments: [/bin/bash, /Users/wook/deploy-watch.sh]
StartInterval: 90        # 90초마다 반복 실행
RunAtLoad: true
로그: /Users/wook/.pm2/autodeploy.log (stdout/stderr 동일 파일)
```
역할: 90초마다 `deploy-watch.sh`를 실행해 GitHub에 새 커밋이 있으면 자동
배포. **`/bin/bash`에 macOS "전체 디스크 접근 권한(Full Disk Access)"이
없으면 launchd 데몬 컨텍스트에서 git/npm이
`fatal: Unable to read current working directory: Operation not permitted`로
막힌다** — 시스템 설정 → 개인정보 보호 및 보안 → 전체 디스크 접근 권한에서
사용자가 직접 부여해야 하는 설정이라 코드/스크립트로 해결 불가.

## 3. `deploy-watch.sh` 전체 내용 (`/Users/wook/deploy-watch.sh`)

```bash
#!/bin/bash
export PATH="/Users/wook/bin:/Users/wook/.npm-global/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd /Users/wook/hion || exit 1

LOCK=/tmp/hion-deploy.lock
if [ -e "$LOCK" ]; then
  exit 0
fi
trap 'rm -f "$LOCK"' EXIT
touch "$LOCK"

git fetch origin main --quiet 2>&1

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

echo "[$(date)] 새 커밋 발견 ($LOCAL -> $REMOTE), 배포 시작"

OLD_LOCK_HASH=$(git rev-parse HEAD:package-lock.json 2>/dev/null || echo "")

if ! git pull origin main; then
  echo "[$(date)] git pull 실패, 배포 중단"
  exit 1
fi

NEW_LOCK_HASH=$(git rev-parse HEAD:package-lock.json 2>/dev/null || echo "")

if [ "$OLD_LOCK_HASH" != "$NEW_LOCK_HASH" ]; then
  echo "[$(date)] package-lock.json 변경됨, npm install 실행"
  npm install
fi

echo "[$(date)] 빌드 시작"
if ! npm run build; then
  echo "[$(date)] 빌드 실패, 배포 중단 (이전 빌드로 계속 서비스됨)"
  exit 1
fi

pm2 restart hion
echo "[$(date)] 배포 완료 ($REMOTE)"
```

특징:
- `/tmp/hion-deploy.lock` 파일로 중복 실행 방지 (90초 주기로 겹쳐 돌 수 있어서).
- `package-lock.json`의 git 블롭 해시가 바뀌었을 때만 `npm install` 실행 (매번
  설치하지 않아서 빠름).
- **빌드 실패 시 `pm2 restart`를 안 하므로 기존 빌드로 계속 서비스됨** —
  무중단에 가깝지만, `npm run build`가 `.next`를 그 자리에서 덮어쓰기 때문에
  빌드 진행 중(수십 초) 들어온 요청은 `MODULE_NOT_FOUND` /
  `clientModules` 에러를 잠깐 낼 수 있음 (완전 무중단 아님, Blue-Green 아님).

## 4. pm2 관리 프로세스

| name | 역할 | 실행 명령 | cwd |
| --- | --- | --- | --- |
| `hion` | 앱 본체 | `npm start` (= `next start`, 포트 3000) | `/Users/wook/hion` |
| `caffeinate` | 맥북이 안 잠들게 | `caffeinate -dimsu` | - |

- pm2 데몬 자체는 `brew` 없이 `npm config set prefix ~/.npm-global` +
  `npm install -g pm2`로 설치됨 (sudo 불필요, 전역 설치 경로가
  `~/.npm-global`).
- 현재 상태/재시작 횟수 확인: `pm2 list`, `pm2 describe hion`.
  **재시작 횟수가 계속 올라가는 것은 비정상이 아님** — `deploy-watch.sh`가
  새 커밋마다 `pm2 restart hion`을 호출하므로, 커밋이 잦을수록 restart count가
  누적된다 (크래시 루프와 구분할 것: `pm2 describe hion`의 `uptime`이 매번
  수십~수백 초 안에 다시 0으로 돌아가면서 `unstable restarts`가 올라가면
  그건 진짜 문제).
- 로그: `~/.pm2/logs/hion-{out,error}.log`, `~/.pm2/logs/caffeinate-{out,error}.log`
- 프로세스 목록 영속화: `pm2 save` → `~/.pm2/dump.pm2`에 기록, 이 파일을
  `pm2 resurrect`(§2-1)가 부팅 시 읽어서 복원.

## 5. Homebrew 미설치로 인한 설치 방식 차이 (일반 가이드와 다른 부분)

이 맥북은 `/usr/local`이 root 소유라 Homebrew 설치 자체에 sudo 비밀번호가
필요해서 Homebrew를 쓰지 않음. 대신:
- `cloudflared`: GitHub 릴리스 바이너리를 `~/bin/cloudflared`에 직접 배치
- `pm2`: `~/.npm-global` 사용자 전용 prefix로 전역 설치
- `~/.zshrc`: `export PATH="$HOME/bin:$HOME/.npm-global/bin:$PATH"` 추가

## 6. 알려진 제약 / 미완료 작업

- OAuth(Google)·Supabase 리다이렉트 URL에 `hion.cc` 등록 **아직 안 함**
  (계정 로그인 필요해서 수동 작업 필요).
- Vercel 프로젝트 정리(삭제/중지) **아직 안 함** — 위 OAuth 작업 끝나고
  로그인 정상 확인 후 진행 예정.
- 쿠팡 동기화는 Vercel Cron을 쓴 적이 없고, 원래부터 외부 무료 스케줄러
  (cron-job.org 등)가 `?secret=...` 쿼리로 `/api/cron/sync-coupang*`을
  호출하는 구조 — 이 맥북 프로세스와 무관, 도메인만 바뀌면 됨.

## 7. 다른 PC에서 분석 시 확인할 것

```bash
# 이 맥북에 SSH/원격 접속이 가능하다면:
export PATH="$HOME/bin:$HOME/.npm-global/bin:$PATH"
pm2 list
pm2 describe hion
ps aux | grep cloudflared | grep -v grep
ls /Library/LaunchDaemons/ | grep -E "pm2|cloudflare|hion"
tail -50 /Users/wook/.pm2/autodeploy.log
tail -50 /Users/wook/.pm2/logs/hion-error.log
curl -sI https://hion.cc --max-time 15
```
