# 인수인계 (HANDOFF) — 다른 PC에서 바로 이어서 작업하기

마지막 갱신: 2026-11-12 (jarvis PC). 개발 규칙은 `CLAUDE.md`가 기준이다. 이 문서는 "지금 어디까지 왔나"만 적는다.

## -2. 지금 바로 할 일 (2026-11-12)

**Bright Data 환경변수 — 해결됨.** 맥북 `.env.local`에 `BRIGHTDATA_API_KEY`/`BRIGHTDATA_UNLOCKER_ZONE` 추가 + `pm2 restart hion` 완료, 사용자가 실제 화면에서 "조사하기"로 쿠팡 후보가 뜨는 것까지 확인함(스크린샷 확인). 아래 "-1"의 "확인 못함" 중 "실제 Bright Data 호출" 항목은 확인 완료로 처리.

**새로 발견한 비슷한 문제 — `SUPABASE_SERVICE_ROLE_KEY`도 맥북에 없을 가능성 높음.** 업무수첩(노트) 공유 다이얼로그에서 다른 사람에게 "보기/편집" 권한을 줄 때 `setNoteShare`(`app/dashboard/notes/actions.ts`)가 `createAdminClient()`(`lib/supabase/admin.ts`)를 쓰는데, 여기 필요한 `SUPABASE_SERVICE_ROLE_KEY`가 없으면 그 자리에서 예외가 터져서 화면 전체가 Next.js 원시 에러("Server Components render" + digest)로 죽는 걸 실제로 겪음. **코드는 이미 고쳐서 푸시함(커밋 `32213ff`)** - 이제는 크래시 대신 "공유 기능이 아직 설정되지 않았어요" 한국어 안내로만 뜬다. 단, **이 코드 수정은 화면이 안 죽게만 할 뿐, 공유 기능 자체가 실제로 되게 하려면 Bright Data 때와 똑같이 맥북 `.env.local`에 `SUPABASE_SERVICE_ROLE_KEY`를 추가해야 함** (Supabase 대시보드 → Project Settings → API → service_role 키에서 확인 가능, `SETUP_MACOS_SELFHOST.md` 107번 줄에도 문서화돼 있었음). 맥북 Claude 세션이 이어서: 사용자에게 공유 시도해보라고 안내 → 여전히 "공유 기능이 아직 설정되지 않았어요"가 뜨면 이 키가 없는 게 확정이니 Bright Data 때와 같은 절차(값 받아서 `.env.local`에 추가 → `pm2 restart hion`)로 처리할 것.

**재질/구조 구분 기능 — 빌드 진행 중(jarvis PC, 이 커밋 이후 push될 예정).** 쿠팡 실데이터 조사 후보 중 사용자 상품과 재질·작동 방식이 다른 것(예: 극세사 발매트 조사에 규조토 발매트가 섞임)을 배지로 구분해주는 기능을 `/build` 체계로 진행 중. 설계: `CoupangResearchPanel`에 "내 상품 재질(선택)" 입력란 → 시드 키워드 사전으로 1차 판정(비용 0) → 애매한 것만 Gemini 배치 호출로 "AI 추정" 배지 보완. 이 섹션 아래에 진행 상황이 이어서 갱신될 것 - 만약 이 문단이 그대로 남아있고 아래에 완료 보고가 없다면, jarvis PC 세션이 중간에 끊긴 것이니 git log로 어디까지 커밋됐는지 먼저 확인할 것.

## -1. 오늘(2026-11-11) 한 일 — 소싱 리스트: 쿠팡 실데이터 조사 + 마진 역산

소싱 리스트 "비교 상품군 ▼"에 두 기능 추가 (`/build` 체계: planner→architect→developer→reviewer/qa 2라운드 교차검증 거침):
- **"쿠팡 실데이터로 조사" 버튼**: 기존 트렌드 탭이 쓰던 `lib/brightdata.ts`의 `fetchCoupangBestsellers`를 재사용해서 실제 쿠팡 검색 결과(이름/가격/리뷰수/이미지)를 보여주고, 체크한 것만 비교 상품군에 저장(`source='coupang_auto'`로 수동 입력과 구분). 신규: `app/dashboard/sourcing/list/researchActions.ts`, `components/CoupangResearchPanel.tsx`, `lib/coupangMarket.ts`(트렌드 탭 분석 로직을 `'use server'` 아닌 lib로 분리 - 재사용을 위해 이동만 함, 기존 import 경로는 재노출로 안 바꿈).
- **마진 역산(`components/MarginReverseCalc.tsx`)**: 목표 마진율(기본 20%) → `lib/marginCalc.ts`의 `computeMinPriceForTargetMargin`으로 최소 판매가 즉시 계산, "이 가격 적용"으로 `sourcing_items`에 저장. **쿠폰은 반영 안 함(적용 시 쿠폰 0으로 강제 저장, 화면에 경고 문구 있음)** - 쿠폰 있는 항목에 쓸 때 주의.
- **마이그레이션**: `supabase/migrations/20261111015515_add_comparison_source.sql` (`sourcing_item_comparisons.source` 컬럼 추가). **다른 PC에서 이 브랜치/커밋을 받으면 머지 전에 `npx supabase db push --remote`를 먼저 실행했는지 확인할 것** - 안 하면 비교 상품 추가(수동 포함) 전체가 실패한다(한국어 에러 안내는 떠서 안전하게 실패는 하지만, 기능은 막힘).
- CLAUDE.md의 "위험한 변경은 feature 브랜치 → Vercel Preview 확인 → main" 규칙에 따라 feature 브랜치로 푸시함 (아래 "확인한 것/확인 못한 것" 참고).

**확인함(이 PC)**: tsc 전체 통과, `npm run build` clean, 쿠폰 이중반영·배열 insert 순서뒤섞임 버그를 가짜 데이터로 재현/수정 확인(스크래치패드 스텁 스크립트).
**확인 못함 — 사용자가 Vercel Preview에서 직접 봐야 함**: 실제 Bright Data 호출(캡차/타임아웃/응답 형태), 실제 화면에서 버튼 클릭→체크박스 선택→저장 흐름, "이 가격 적용" 후 카드 배지 갱신, `source` 컬럼이 실제 DB에 반영되는지.

## 0. 오늘(2026-11-05) 한 일 — SQL/배포 구조 변경

- **SQL 마이그레이션을 Supabase CLI로 전환.** 이제 `supabase/PENDING_MIGRATIONS.md`
  체크리스트 + SQL Editor 수동 복붙 방식은 안 쓴다 (레거시로 남겨둠).
  - `npx supabase link --project-ref isqsvclrdzdsnizzqsia` 로 프로젝트 연결 완료 (로그인 끝남)
  - 기존 운영 DB 스키마(`supabase/schema.sql`)를 `supabase/migrations/20261105005639_baseline.sql`로
    베이스라인 삼아 `supabase migration repair ... --status applied`로 "이미 적용됨"
    기록만 함 (실제 SQL 재실행 아님 - 메타데이터만)
  - 앞으로 새 스키마 변경: `npx supabase migration new <이름>` → SQL 작성 →
    `npx supabase db push --remote`. 원격 DB가 적용 여부를 자체 기록해서 다른
    PC에서 똑같이 `db push` 해도 중복 적용 안 됨
  - **주의**: 이 PC엔 Docker가 없어서 `db pull`/`db diff`는 못 쓴다 (Docker 필요).
    `db push`/`migration new`/`migration repair`는 Docker 없이도 동작함
  - `package.json`에 `supabase` CLI를 devDependency로 추가함 (`npx supabase ...`로 사용)
- **배포 전 테스트 방식 문서화**: 큰 기능은 feature 브랜치 푸시 → Vercel Preview URL
  확인 → main 머지. 작은 수정은 바로 main. (`CLAUDE.md`, `README.md` 5번 참고)
- **운영 서버 = 맥북 (사용자 확인, 2026-11-07).** `https://hion.cc`, pm2 + Cloudflare Tunnel.
  `main`에 푸시하면 맥북이 약 90초 안에 자동 pull → build → 재시작한다.
  (11/5 세션에서 `vercel whoami`로 Vercel이 운영이라고 적었던 것은 틀린 판단이었다 -
  Vercel 프로젝트는 아직 남아 있을 뿐 운영이 아니다. `SETUP_MACOS_SELFHOST.md`/
  `PROCESS_ARCHITECTURE.md`가 실제 구조다.) Vercel 프로젝트 정리(8단계)는 아직 안 했다.

## 1. 다른 PC에서 시작하는 순서 (5분)

```bash
cd <hion 폴더>
git pull            # 먼저 받는다 (wook PC 작업이 기준 - 덮어쓰지 말 것)
npm install         # package.json이 바뀌었을 수 있음 (supabase CLI 추가됨)
npm run dev         # http://localhost:3000
```

- `.env.local`은 git에 없다. 새 PC라면 `.env.local.example`을 보고 직접 채운다 (비밀키는 채팅/커밋에 올리지 말 것).
- 새 PC에서 처음 SQL 마이그레이션을 돌리려면: `npx supabase login` (브라우저 승인 필요,
  비대화형 셸에서는 안 되니 진짜 터미널에서 실행) → `npx supabase link --project-ref isqsvclrdzdsnizzqsia`
- 푸시 전에도 `git pull`을 한 번 더 한다. **푸시가 곧 운영 배포다**: 약 90초 뒤 https://hion.cc 에서 `Ctrl+Shift+R`로 확인. 안 바뀌면 맥북에서 `tail -30 /Users/wook/.pm2/autodeploy.log` 확인 (이 PC에서는 못 봄).
- Claude Code로 이어갈 때는 첫 요청에 "HANDOFF.md 읽고 이어서 작업해줘"라고 하면 된다.

## 2. SQL — 지금 해야 할 것

없음. Supabase CLI 마이그레이션 전환 완료 후 원격 DB는 "최신" 상태로 기록돼 있다
(`npx supabase db push --remote --dry-run` → `upToDate: true` 확인함). 새 스키마
변경이 필요하면 위 "0. 오늘 한 일"의 CLI 절차를 따른다.

## 3. 이번 세션에 한 일 (전부 main에 푸시됨)

| 커밋 | 내용 |
|---|---|
| `1622b73` | 상세 문구: 상품 정보에 없는 소재·원산지(신장/Xinjiang)·"OO 100%" 단정을 프롬프트 + 코드(`lib/copyGuard.ts`)로 차단 |
| `288b930` | 상세페이지 탭: 결과 클릭 확대(라이트박스), 새 창 없이 바로 다운로드, 선택/전체 ZIP 다운로드 |
| `020310d` | 썸네일 탭: 같은 기능 (전체 선택, 선택/전체 ZIP, 확대 미리보기 ←/→/Esc, 바로 다운로드) |
| `805a79e` | AI가 원본에 없는 봉제선·트임을 그리는 문제: 생성 지시·외형 명세·검증 기준에 봉제선 유무 명시 |
| `8070058` | 수량 배지 색상에 다크그레이·파랑·보라 추가 |
| `24dc301` | 썸네일 패키지 템플릿 5종(나열/대표+세로/대표+가로/삼각/엇갈려) + 자동 추천, 좌우 반전, 배지 모양·색 |
| `acbd2ab` | 패키지 대표형 배치 + 수량 배지(5P) |
| `489315e` | 글자·선만 있는 빈 사진 걸러내기 (`lib/imageQuality.ts`), 결과가 비면 불합격 |
| `279fec0` | Gemini 결제·한도 오류를 한국어로 안내 |
| `ee41d73` | 색상 자동 변환: 여러 색이 한 장에 나온 컷도 취급 색으로 변환, 다크그레이 동의어 |

새로 생긴 주요 파일: `lib/copyGuard.ts`, `lib/clientDownload.ts`, `lib/zip.ts`, `components/ImageLightbox.tsx`, `lib/imageQuality.ts`, `lib/packageTemplates.ts`, `lib/packageCompose.ts`.

## 4. 확인한 것 / 확인 못 한 것 (정직하게)

**확인함 (이 PC에서)**: TypeScript 전체 검사 통과, 순수 로직 단위 테스트(개별 스크립트), jsdom으로 다운로드·ZIP·라이트박스 동작, 합성 이미지로 패키지 배치·배지·빈 사진 판정.

**확인 못 함 — 실제 환경에서 사용자가 봐야 함**
- 실제 Gemini 동작: 봉제선 억제가 먹히는지, 검증 에이전트 민감도, 색상 변환 품질, 새 카피 문구가 규칙을 지키는지.
- Gemini 크레딧: 소진되면 대부분 실패한다 (한국어 안내가 뜬다). **충전은 사용자만 가능** (aistudio.google.com).
- 실제 브라우저·Supabase에서 ZIP/바로 다운로드 (Supabase 공개 URL을 `fetch`로 받는 방식 — CORS 문제가 있으면 "받지 못했어요" 안내가 뜬다).
- 실제 상품 사진으로 패키지 템플릿 5종이 예쁘게 나오는지.
- 이미 만들어진 장면의 옛 문구는 자동으로 안 바뀐다 → 해당 섹션 문구를 다시 추천받거나 장면을 다시 생성해야 새 규칙이 적용된다.

## 5. 알려진 한계 / 다음 후보

- 패키지 메인 "다시 만들기"를 누르면 배지·배치가 초기화된다 (보존하도록 개선 가능).
- "엇갈려 겹치기" 템플릿은 가로로 넓은 상품에서 겹침이 약하다.
- 빈 사진 판정은 상품이 화면의 5% 미만인 아주 작은 사진을 오판할 수 있다.
- 검증 에이전트가 Gemini를 추가 호출하므로 크레딧을 더 쓴다. 엄격도는 `lib/outputVerifier.ts`에서 조정.
- 다운로드 확대 창은 생성이 끝난 이미지만 대상이다.
- 단위 테스트 스크립트는 jarvis PC 임시 폴더에만 있고 레포에 없다 (경로가 PC 고정이라 미커밋). 필요하면 `tests/`로 옮겨 정리할 것.

## 6. 푸시 전 검증 절차 (CLAUDE.md와 동일)

맥북 운영 빌드(`next build`)는 전체 TS 검사를 한다. 푸시가 곧 배포라 오류가 있으면 운영이 깨질 수 있다. 로컬에 `sharp`/`canvas`가 없으면 `tsc`가 오류를 숨기므로:
1. `sharp`, `canvas`와 의존 패키지(`@img, color, color-string, color-convert, color-name, detect-libc, semver, simple-swizzle, is-arrayish, node-addon-api`)를 임시로 `node_modules`에 복사 (또는 `npm i --no-save sharp canvas`)
2. `node node_modules/typescript/bin/tsc --noEmit -p .` (`web-push` 관련 오류만 무시)
3. 임시 패키지와 `tsconfig.tsbuildinfo` 삭제 후 커밋·푸시

## 7. 사용자(소싱) 쪽 메모 — 코드와 무관

- 1688 상품 정보 고시 입력 시: 소재 혼용률은 반드시 판매처에 확인 (남성 속옷 C858은 폴리 95% / 나머지 5% 미확인, 오버니 양말은 涤棉 75% 외 미확인). 근거 없는 소재·"항균"·"EO 멸균" 문구는 쓰지 말 것.
