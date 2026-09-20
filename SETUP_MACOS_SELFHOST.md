# 맥북 자체 호스팅 가이드 (Vercel → 맥북, Cloudflare Tunnel)

목적: Vercel 유료 플랜 비용을 없애고, 집에 있는 맥북에서 이 앱을 직접
서비스한다. 공인 IP나 라우터 포트포워딩 없이 Cloudflare Tunnel로 외부
접속을 안전하게 뚫는다.

> 맥북에서 Claude Code로 이 작업을 이어받았다면: 아래 순서를 하나씩
> 실행하면서 진행 상황을 사용자에게 보고해줘. 이미 완료된 단계(예:
> 저장소 클론, .env.local 값 채우기)는 건너뛰고 현재 상태부터 이어서
> 진행하면 됨. 도메인 구매/OAuth 콘솔 설정처럼 브라우저에서 사용자가
> 직접 눌러야 하는 단계는 안내만 하고, 터미널 명령은 직접 실행해도 됨.

## 0. 준비물
- 도메인 하나 (어디서 사도 상관없음 - Namecheap, 가비아, Cloudflare 등)
- Cloudflare 계정 (무료)
- Vercel 대시보드(Settings → Environment Variables)에서 값을 복사해와야
  하는 환경변수들 (.env.local.example엔 이름만 있고 실제 값은 Vercel에만
  있는 것들):
  - `ANTHROPIC_API_KEY`
  - `BRIGHTDATA_API_KEY`
  - `BRIGHTDATA_UNLOCKER_ZONE`
  - `SUPABASE_SERVICE_ROLE_KEY` (Supabase 대시보드 → Project Settings →
    API → service_role 키에서도 직접 확인 가능)
  - `COUPANG_SYNC_SECRET` (외부 스케줄러 인증용 - 이미 cron-job.org 등을
    쓰고 있다면 거기 등록된 것과 반드시 같은 값이어야 함)

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

# 이 저장소 클론
git clone https://github.com/jarvis-overlay/hion.git
cd hion
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

## 4. Cloudflare Tunnel 설치 + 연결
```bash
brew install cloudflared
cloudflared tunnel login          # 브라우저 열려서 Cloudflare 계정 인증 + 방금 그 도메인 선택
cloudflared tunnel create hion    # 터널 하나 생성 (이름은 자유)
```

터널이 로컬 3000번 포트를 서비스하도록 라우팅:
```bash
cloudflared tunnel route dns hion hion.mystore.com   # 원하는 서브도메인으로
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

여기까지 하면 `https://hion.mystore.com`으로 전 세계 어디서든 접속 가능 -
HTTPS 인증서는 Cloudflare가 자동으로 처리해준다.

## 5. OAuth / Supabase 리다이렉트 URL 변경
- **Google Cloud Console** → OAuth 클라이언트 → 승인된 리디렉션 URI에
  `https://hion.mystore.com/auth/callback` 추가 (기존 vercel.app 것은
  당장 지우지 말고 병행 - 문제 생기면 롤백 가능하게)
- **Supabase 대시보드** → Authentication → URL Configuration →
  Site URL / Redirect URLs에 같은 주소 추가

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
`caffeinate` 상시 실행을 고려.

## 8. 확인 후 정리
전부 정상 동작 확인되면, Vercel 프로젝트를 지우거나 배포를 중지해서
실제로 비용이 끊기는지 확인.
