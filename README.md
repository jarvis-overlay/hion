# HION HUB

1인 이커머스 셀러(쿠팡 로켓그로스 + 중국 알리바바/1688 소싱)를 위한 올인원
업무 허브. Next.js + Supabase(로그인/DB) 조합이고, 구글 로그인 후 허용된
이메일 2개만 접속 가능한 프라이빗 시스템입니다.

**배포**: 원래 Vercel(`hion.vercel.app`)로 운영했으나, 비용 절감을 위해
맥북 자체 호스팅(pm2 + Cloudflare Tunnel)으로 이전 중입니다. 자세한 절차는
[SETUP_MACOS_SELFHOST.md](./SETUP_MACOS_SELFHOST.md) 참고. **맥북 서버는
`git push`가 곧 배포입니다** - main 브랜치에 반영되면 서버가 자동으로 받아서
재적용하는 구조로 세팅되어 있으니, 기능 추가/수정은 반드시 로컬에서
`npm run dev`로 확인 후 push하세요.

## 현재 기능 (사이드바 기준)

- **마진 계산기** / **성과 분석**
- **소싱**
  - 소싱 리스트 (후보 상품을 검토중/발주완료/보류로 관리, 옵션별·공급처별 비교)
  - AI 소싱 추천 (시즌 조건 + 쿠팡 실데이터 기반 카테고리 → 키워드 → 상품 추천)
  - 키워드 리서치 (비교 상품군 가격대/시장규모 기록)
- **판매**
  - 판매 전략 (마진 구조 + 시장 위치 기반 AI 전략 생성)
  - 썸네일 제작 (메인 썸네일 1장 + 추가 이미지, 1000x1000, 누끼, 위치 선택)
  - 상세페이지 제작 (섹션 단위 AI 이미지 생성 + 문구 합성, 디자인 템플릿)
- **재고관리**
  - 상품 관리 / 발주·입고 / 재고 현황 / 채널 연동(쿠팡·네이버 API 키)
  - 쿠팡 주문·재고 자동 동기화 (외부 무료 스케줄러가 주기 호출)
- **알림**: 웹푸시(PWA) + 카카오톡 "나에게 보내기"
- **API 테스트**: 개발자용 디버그 페이지

---

## 0. 준비물
- GitHub 계정
- Supabase 계정 (supabase.com, 구글/깃허브로 바로 가입 가능)
- Google Cloud Console 계정 (구글 로그인용 OAuth 키 발급)
- (AI/이미지/스크래핑 기능을 쓰려면) Anthropic, Google AI Studio(Gemini),
  Bright Data, remove.bg 계정 - 필요한 키 목록은 `.env.local.example` 참고

---

## 1. Supabase 프로젝트 만들기

1. supabase.com → New Project
2. 이름, 비밀번호(DB 비밀번호, 아무거나 강력하게) 설정하고 리전은 **Northeast Asia (Seoul)** 선택
3. 프로젝트 생성되면 왼쪽 메뉴 **SQL Editor** 클릭
4. 이 프로젝트의 `supabase/schema.sql` 파일 전체를 복사해서 붙여넣고 실행 (Run)
   - 이 파일 하나에 지금 운영 중인 모든 테이블 + RLS 정책이 들어있습니다.
   - 맨 아래 `allowed_users` 삽입 부분의 이메일을 실제 사용할 구글 이메일로 바꿔주세요.
5. 왼쪽 메뉴 **Project Settings → API** 에서
   - `Project URL` → `.env.local`의 `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` 키 → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` 키(secret) → `SUPABASE_SERVICE_ROLE_KEY` (쿠팡 자동 동기화 등 세션 없이 서버에서 DB 쓰기용)

---

## 2. 구글 로그인(OAuth) 연결

1. Supabase 프로젝트 → **Authentication → Providers → Google** 켜기
2. Google Cloud Console (console.cloud.google.com) 접속 → 새 프로젝트 생성
3. **APIs & Services → OAuth consent screen** → External로 설정, 앱 이름/이메일만 입력하고 저장
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: Web application
   - Authorized redirect URIs 에 Supabase가 알려주는 콜백 URL 붙여넣기
     (Supabase의 Google Provider 설정 화면에 `https://xxxx.supabase.co/auth/v1/callback` 형태로 나와있음, 그대로 복사)
5. 발급된 **Client ID / Client Secret**을 Supabase의 Google Provider 설정 화면에 붙여넣고 저장

---

## 3. 로컬에서 실행하기

```bash
npm install
cp .env.local.example .env.local
# .env.local 파일 열어서 필요한 키 채워넣기 (최소 Supabase 2개는 필수, 나머지는 해당 기능 쓸 때만 필요)
npm run dev
```

브라우저에서 http://localhost:3000 접속 → 구글 로그인 되는지 확인

---

## 4. 배포

### 4-1. 맥북 자체 호스팅 (현재 운영 방식)
[SETUP_MACOS_SELFHOST.md](./SETUP_MACOS_SELFHOST.md) 참고. pm2로 상시
실행하고 Cloudflare Tunnel로 외부 접속을 뚫는 구조. `git push` → 서버에서
자동 반영되도록 세팅되어 있습니다.

### 4-2. Vercel (레거시 / 대안)
1. vercel.com → New Project → GitHub repo 선택 → Import
2. **Environment Variables** 섹션에 `.env.local`에 채운 값들 그대로 입력
3. Deploy → 몇 분 뒤 배포 주소 생성됨
4. Google Cloud Console의 OAuth consent screen **Authorized domains**에
   `vercel.app`(또는 커스텀 도메인) 추가

쿠팡 동기화는 Vercel Cron을 쓰지 않습니다(`vercel.json`은 비어있음) -
`COUPANG_SYNC_SECRET`으로 인증하는 외부 무료 스케줄러(cron-job.org 등)가
아래 URL을 주기적으로 호출하는 구조입니다. 도메인이 바뀌면 스케줄러 설정의
URL도 같이 바꿔줘야 합니다.
- `/api/cron/sync-coupang?secret=...`
- `/api/cron/sync-coupang-catalog?secret=...`

---

## 5. 앞으로 기능 추가하는 흐름

- 새 기능 아이디어 있으면 이 프로젝트 폴더 통째로 Claude Code에 열어서 요청
- DB 테이블을 추가/수정할 땐 `supabase/schema.sql`에도 반영해서 최신 상태 유지
  (개별 마이그레이션이 필요하면 `supabase/` 밑에 새 파일로 추가하고, 최종
  반영된 구조는 `schema.sql`에도 합쳐두는 걸 권장 - 과거처럼 마이그레이션
  파일만 쌓이고 schema.sql이 안 갱신되면 나중에 새 환경 세팅할 때 애먹음)
- 로컬에서 `npm run dev`로 먼저 확인 → `git push` 하면 자동 반영

---

## 폴더 구조

```
app/
  login/                     # 로그인 페이지
  auth/callback/              # OAuth 콜백 처리
  api/
    cron/sync-coupang*/         # 쿠팡 주문/카탈로그 동기화 (외부 스케줄러가 호출)
    kakao/                       # 카카오 로그인 연동(알림 수신자 등록용)
  dashboard/
    layout.tsx                 # 로그인 + 허용 이메일 체크
    margin/                     # 마진 계산기
    analytics/                  # 성과 분석
    sourcing/
      list/                       # 소싱 리스트 (옵션/공급처/비교상품군 포함)
      trends/                     # AI 소싱 추천
      compare/                    # 키워드 리서치
      info/                       # (레거시) 소싱 정보 자유형 노트
    sales/
      strategy/                   # 판매 전략 (AI)
      thumbnails/                 # 썸네일 제작
      detail-pages/                # 상세페이지 제작
    inventory/
      products/                   # 상품 관리
      orders/                      # 발주·입고
      stock/                       # 재고 현황
      channels/                    # 채널 연동(쿠팡/네이버 API 키)
    notifications/               # 알림 설정 (웹푸시/카카오)
    api-test/                    # 개발자용 API 테스트
lib/
  supabase/                   # Supabase 클라이언트 (브라우저용/서버용/admin용)
  ai.ts                        # Claude API - AI 소싱 추천, 판매 전략, 상세페이지 카피
  brightdata.ts                # Bright Data Web Unlocker - 쿠팡/알리바바 스크래핑
  imageProcessing.ts           # Gemini Vision 번역 + remove.bg 누끼 + sharp/canvas 합성
  coupang.ts / coupangSync.ts  # 쿠팡 오픈API 연동 + 동기화 로직
  naver.ts                      # 네이버 오픈API 연동
  kakao.ts / webpush.ts        # 알림 발송
components/                    # 재사용 UI 컴포넌트
supabase/
  schema.sql                   # 통합 스키마 (새 환경 세팅 시 이 파일만 실행하면 됨)
  *.sql                          # 개별 변경 이력 (참고용 - schema.sql에 이미 반영됨)
```
