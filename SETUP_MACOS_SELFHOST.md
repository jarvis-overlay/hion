# 맥북 자체 호스팅 가이드 (Vercel → 맥북, Cloudflare Tunnel)

목적: Vercel 유료 플랜 비용을 없애고, 집에 있는 맥북에서 이 앱을 직접
서비스한다. 공인 IP나 라우터 포트포워딩 없이 Cloudflare Tunnel로 외부
접속을 안전하게 뚫는다.

> 맥북에서 Claude Code로 이 작업을 이어받았다면: 아래 "현재 상태" 섹션을
> 먼저 읽고 실제로 뭐가 되어있는지 확인한 다음, 안 된 부분만 진행해줘.
> 도메인 구매/OAuth 콘솔 설정처럼 브라우저에서 사용자가 직접 눌러야 하는
> 단계는 안내만 하고, 터미널 명령은 직접 실행해도 됨. sudo가 필요한
> 명령은 Bash 도구로 직접 실행이 안 되니(비밀번호 입력 불가), 쉘 스크립트
> 파일로 작성해서 사용자에게 "터미널 앱에서 `sudo <스크립트경로>` 한 줄만
> 실행해달라"고 요청하는 방식을 쓸 것 (멀티라인 명령을 채팅에 붙여넣으면
> 줄바꿈 때문에 쪼개져서 실패하니 반드시 스크립트 파일 + 한 줄 실행).

---

## 현재 상태 (이 맥북 기준, 최종 확인: 2026-11-05)

**이 맥북은 실제로 운영 서버로 쓰이고 있음.** 아래는 실제 구성이며, 밑에
나오는 "0~8단계" 범용 가이드와 일부 다르다 (이 맥북 환경 특성 때문에
실제로는 이렇게 됨):

- **프로젝트 경로: `/Users/wook/hion`** (`~/Desktop/py/hion`가 아님!
  원래 Desktop 밑에 있었는데, macOS TCC가 launchd 데몬의 Desktop 폴더
  접근을 막아서 `~/hion`으로 옮김. 앞으로도 Desktop/Documents/Downloads
  밑에는 두지 말 것)
- **도메인: `hion.cc`** (이미 Cloudflare 네임서버로 연결되어 있음)
- **Homebrew가 설치되어 있지 않음.** `/usr/local`이 root 소유라 brew
  설치 자체에 sudo 비밀번호가 필요해서 설치를 안 했음. 대신:
  - `cloudflared`: GitHub 릴리스에서 바이너리 직접 다운로드 →
    `~/bin/cloudflared` (sudo 불필요)
  - `pm2`: `npm config set prefix ~/.npm-global` 로 사용자 전용 global
    경로를 잡고 `npm install -g pm2` (sudo 불필요)
  - `~/.zshrc`에 `export PATH="$HOME/bin:$HOME/.npm-global/bin:$PATH"`
    추가해둠
- **launchd 서비스 3개** (`/Library/LaunchDaemons/`에 등록, 전부 재부팅
  시 자동 시작):
  1. `pm2.wook.plist` — 부팅 시 `pm2 resurrect` 실행해서 저장된 pm2
     프로세스 목록(`hion`, `caffeinate`) 복원
  2. `com.cloudflare.cloudflared.plist` — `cloudflared tunnel --config
     /Users/wook/.cloudflared/config.yml run` 상시 실행
  3. `com.hion.autodeploy.plist` — 아래 "자동 배포" 참고
- **pm2 프로세스 2개**: `hion` (앱 본체), `caffeinate` (맥북 안 잠들게,
  `caffeinate -dimsu`를 pm2로 관리 — 시스템 설정 잠자기 방지 대신 이걸로
  처리함)
- **OAuth / Supabase 리다이렉트 URL (5단계)**: **아직 사용자가 안 함.**
  Google Cloud Console / Supabase 대시보드에 `https://hion.cc/...` 추가
  필요 — 계정 로그인 필요해서 Claude Code가 대신 할 수 없음.
- **Vercel 정리 (8단계)**: **아직 안 함.** 위 OAuth 작업 끝나고 로그인까지
  정상 확인되면 진행.
- **쿠팡 동기화 크론 (6단계)**: 원래부터 외부 스케줄러 구조라 손댈 거
  없음 (아래 6단계 설명 그대로 유효).

### 자동 배포 (이 맥북에만 있는 추가 기능, 원래 가이드엔 없었음)

다른 PC에서 `git push origin main` 하면, 이 맥북이 **90초 안에 자동으로
pull → (package-lock.json 변경 시) npm install → build → pm2 재시작**까지
처리한다. Vercel의 git push 자동배포와 거의 동일한 경험.

- 스크립트: `/Users/wook/deploy-watch.sh`
- launchd: `/Library/LaunchDaemons/com.hion.autodeploy.plist`
  (`StartInterval: 90`, `UserName: wook`)
- 로그: `/Users/wook/.pm2/autodeploy.log`
- 동작 확인용: `git log -1` (로컬) vs `git log -1 origin/main` 비교해서
  최신 커밋이 반영됐는지 확인 가능

**중요한 함정 (다시 겪지 않도록 기록)**: launchd로 돌아가는 백그라운드
데몬(bash가 git/npm을 실행하는 과정)이 macOS TCC에 막혀서
`fatal: Unable to read current working directory: Operation not
permitted` 에러가 났었음. 프로젝트를 Desktop 밖으로 옮겨도 안 풀렸고,
**시스템 설정 → 개인정보 보호 및 보안 → 전체 디스크 접근 권한에
`/bin/bash`를 추가**하니 해결됨. 이건 사용자가 GUI에서 직접 해야 하는
단계라 Claude Code가 대신 할 수 없음.

배포 중 짧은 순간(수십 초) `MODULE_NOT_FOUND` / `clientModules` 에러가
날 수 있는데, 빌드가 `.next` 디렉토리를 덮어쓰는 동안 들어온 요청이
실패하는 현상 — 서비스 자체엔 문제없음. 신경 쓰이면 무중단 배포(새 빌드
완료 후 전환)로 개선 가능하지만 아직 안 했음.

### 상태 점검용 명령 모음
```bash
export PATH="$HOME/bin:$HOME/.npm-global/bin:$PATH"
pm2 list                                   # hion, caffeinate 둘 다 online인지
ps aux | grep cloudflared | grep -v grep   # cloudflared 실행 중인지
ls /Library/LaunchDaemons/ | grep -E "pm2|cloudflare|hion"
cd /Users/wook/hion && git log -1 --oneline && git fetch origin main --quiet && git rev-parse --short origin/main
curl -sI https://hion.cc --max-time 15     # HTTP 200/307이면 정상
tail -30 /Users/wook/.pm2/autodeploy.log   # 최근 자동배포 기록/에러
```

---

## 범용 가이드 (처음부터 다시 셋업할 때, 또는 다른 맥북에 할 때)

## 0. 준비물
- 도메인 하나 (어디서 사도 상관없음 - Namecheap, 가비아, Cloudflare 등)
- Cloudflare 계정 (무료)
- Vercel 대시보드(Settings → Environment Variables)에서 값을 그대로 복사해와야
  하는 환경변수 전체 목록은 `.env.local.example` 참고. 최소한 아래 값들은
  실제 서비스 키라 Vercel에만 있고 로컬 `.env.local.example`엔 이름만 있음:
  - `ANTHROPIC_API_KEY`
  - `GEMINI_API_KEY`
  - `REMOVE_BG_API_KEY`
  - `BRIGHTDATA_API_KEY`
  - `BRIGHTDATA_UNLOCKER_ZONE`
  - `SUPABASE_SERVICE_ROLE_KEY` (Supabase 대시보드 → Project Settings →
    API → service_role 키에서도 직접 확인 가능)
  - `COUPANG_SYNC_SECRET` (외부 스케줄러 인증용 - 이미 cron-job.org 등을
    쓰고 있다면 거기 등록된 것과 반드시 같은 값이어야 함)
  - `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET`
  - `KAKAO_REST_API_KEY` / `KAKAO_CLIENT_SECRET`
  - `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`

## 1. 도메인을 Cloudflare에 연결
1. 어디서든 도메인을 하나 구입한다 (예: `mystore.com`)
2. Cloudflare 대시보드 → "Add a site" → 그 도메인 입력
3. Cloudflare가 알려주는 네임서버 2개를, 도메인을 산 곳(레지스트라)의
   네임서버 설정에 입력해서 교체한다 (전파에 몇 분~몇 시간 걸릴 수 있음)
4. Cloudflare 대시보드에서 그 도메인이 "Active" 상태가 되면 완료

## 2. 맥북에 앱 올리기
```bash
# Node.js 설치 (없다면) - https://nodejs.org 에서 LTS 버전, 또는:
brew install node

# 이 저장소 클론 (Desktop/Documents/Downloads 밑은 피할 것 - TCC 문제,
# 아래 "현재 상태" 참고. 예: ~/hion 처럼 홈 디렉토리 바로 아래 추천)
git clone https://github.com/jarvis-overlay/hion.git ~/hion
cd ~/hion
npm install
```

`.env.local` 파일을 만들고, 지금 쓰는 값 + Vercel에서 복사해온 값을 전부 넣는다:
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
REMOVE_BG_API_KEY=...
GEMINI_API_KEY=...
ANTHROPIC_API_KEY=...
BRIGHTDATA_API_KEY=...
BRIGHTDATA_UNLOCKER_ZONE=...
```

빌드 후 실행 확인:
```bash
npm run build
npm start   # 기본적으로 http://localhost:3000
```

## 3. pm2로 상시 실행 (터미널 꺼도 계속 돌아가게)
```bash
npm install -g pm2
pm2 start npm --name hion -- start
pm2 save
pm2 startup   # 이 명령이 출력하는 sudo 명령어를 한 번 더 실행해야 함 (로그인 시 자동 시작 등록)
```

> **참고**: `brew`가 없는 환경이면 `npm install -g`가 `/usr/local`
> (root 소유)에 쓰려다 실패할 수 있다. 그럴 땐
> `npm config set prefix ~/.npm-global` 로 사용자 전용 경로를 잡고
> `~/.npm-global/bin`을 PATH에 추가한 뒤 다시 설치하면 sudo 없이 된다.
>
> **참고 2**: `pm2 startup launchd -u wook --hp /Users/wook`를 돌려도
> macOS에서는 `/Library/LaunchDaemons`가 아니라
> `~/Library/LaunchAgents`에 잘못 설치될 때가 있다 (로그인 세션에서만
> 실행되는 LaunchAgent라 헤드리스 서버 용도로는 부적합). 이 경우
> `/Library/LaunchDaemons/pm2.<사용자명>.plist`를 직접 작성하는 게
> 확실하다 (`ProgramArguments`에 `pm2 resurrect` 실행, `UserName`에
> 사용자명 지정, `RunAtLoad: true`).

## 4. Cloudflare Tunnel 설치 + 연결
```bash
brew install cloudflared
cloudflared tunnel login          # 브라우저 열려서 Cloudflare 계정 인증 + 방금 그 도메인 선택
cloudflared tunnel create hion    # 터널 하나 생성 (이름은 자유)
```

> `brew`가 없다면 GitHub 릴리스에서 바이너리를 바로 받아도 된다:
> `curl -fsSL -o cloudflared.tgz
> https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz`
> (Apple Silicon이면 `-arm64.tgz`) → 압축 풀고 `~/bin/cloudflared`로
> 이동 + `chmod +x`.

터널이 로컬 3000번 포트를 서비스하도록 라우팅:
```bash
cloudflared tunnel route dns hion hion.mystore.com   # 원하는 서브도메인으로 (도메인 자체를 써도 됨)
```

`~/.cloudflared/config.yml` 파일 생성:
```yaml
tunnel: hion
credentials-file: /Users/<네-사용자명>/.cloudflared/<터널ID>.json
ingress:
  - hostname: hion.mystore.com
    service: http://localhost:3000
  - service: http_status:404
```

터널을 서비스로 등록해서 상시 실행:
```bash
sudo cloudflared service install
```

> **참고**: `cloudflared service install`이 만드는
> `/Library/LaunchDaemons/com.cloudflare.cloudflared.plist`의
> `ProgramArguments`가 바이너리 경로만 달랑 들어가고 `tunnel run` 같은
> 실행 인자가 비어있을 때가 있다. 이러면 터널이 안 뜬다. 직접
> `ProgramArguments`를 `[cloudflared 경로, "tunnel", "--config",
> "~/.cloudflared/config.yml", "run"]`로 채워서 다시
> `launchctl load`하면 해결된다.

여기까지 하면 `https://hion.mystore.com`으로 전 세계 어디서든 접속 가능 -
HTTPS 인증서는 Cloudflare가 자동으로 처리해준다.

## 5. OAuth / Supabase 리다이렉트 URL 변경
- **Google Cloud Console** → OAuth 클라이언트 → 승인된 리디렉션 URI에
  `https://hion.mystore.com/auth/callback` 추가 (기존 vercel.app 것은
  당장 지우지 말고 병행 - 문제 생기면 롤백 가능하게)
- **Supabase 대시보드** → Authentication → URL Configuration →
  Site URL / Redirect URLs에 같은 주소 추가
- **카카오 알림("나에게 보내기") 연동**: `.env.local`의 `NEXT_PUBLIC_APP_URL`을
  `https://hion.mystore.com`으로 설정 (카카오 로그인 콜백 주소 + 메시지 링크에
  쓰임 - 안 채우면 기존 vercel.app 주소로 동작해서 콜백이 실패함).
  1. **카카오 개발자센터** (developers.kakao.com) → 해당 앱 → 카카오 로그인
     → Redirect URI에 `https://hion.mystore.com/api/kakao/callback` 추가
  2. 기존에 연동해둔 알림 수신자가 있다면, `/dashboard/notifications`에서
     재연동(카카오 로그인 다시 진행) 필요할 수 있음

## 6. 쿠팡 동기화 크론 - 사실 손댈 게 없음
확인해보니 이 앱은 Vercel Cron을 아예 쓴 적이 없다(`vercel.json`이
비어있음) - 원래부터 `COUPANG_SYNC_SECRET`으로 인증하는 외부 무료
스케줄러(cron-job.org 등)가 `?secret=...` 쿼리로 아래 URL들을 주기적으로
호출하는 구조로 설계되어 있었다:
- `https://hion.vercel.app/api/cron/sync-coupang?secret=...`
- `https://hion.vercel.app/api/cron/sync-coupang-catalog?secret=...`

**할 일은 이미 등록된 스케줄러가 있다면 그 설정에서 URL의 도메인만
`hion.vercel.app` → 새 도메인으로 바꾸는 것뿐이다.** launchd 같은 걸
새로 만들 필요 없음. 만약 지금까지 스케줄러 자체가 없었다면
cron-job.org에서 무료로 새로 등록하면 된다.

## 7. 맥북이 잠들지 않게
시스템 설정 → 잠자기 → "전원 어댑터 연결 시 자동으로 잠자기 안 함" 체크,
뚜껑을 닫아도 계속 돌게 하려면 외부 모니터/전원 연결 상태를 유지하거나
`caffeinate` 상시 실행을 고려. (이 맥북은 `caffeinate -dimsu`를 pm2로
등록해서 이 방법으로 처리함 - `pm2 start caffeinate --name caffeinate --
-dimsu` 후 `pm2 save`.)

## 8. 확인 후 정리
전부 정상 동작 확인되면, Vercel 프로젝트를 지우거나 배포를 중지해서
실제로 비용이 끊기는지 확인.

## 9. 자동 배포 설정 (git push 시 자동 반영)
다른 PC에서 push만 하면 이 맥북이 자동으로 pull/build/재시작하게
만들려면:

1. `~/deploy-watch.sh` 작성 (저장소 cd → `git fetch origin main` →
   로컬/원격 HEAD 비교 → 다르면 `git pull` → package-lock.json 변경됐으면
   `npm install` → `npm run build` → `pm2 restart hion`). 동시 실행 방지용
   lock 파일(`/tmp/hion-deploy.lock`) 두는 게 좋음.
2. `/Library/LaunchDaemons/com.hion.autodeploy.plist` 작성
   (`ProgramArguments: [/bin/bash, ~/deploy-watch.sh]`,
   `StartInterval: 90`, `UserName: <사용자명>`) 후
   `sudo launchctl load -w <경로>`.
3. **`/bin/bash`에 전체 디스크 접근 권한(Full Disk Access) 부여 필수** —
   안 하면 launchd 데몬이 git/npm 실행 시
   `Operation not permitted`로 막힘 (시스템 설정 → 개인정보 보호 및 보안
   → 전체 디스크 접근 권한 → `+` → `/bin/bash` 추가).
