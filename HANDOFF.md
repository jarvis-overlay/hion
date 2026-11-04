# 인수인계 (HANDOFF) — 다른 PC에서 바로 이어서 작업하기

마지막 갱신: 2026-11-05 (wook PC). 최종 커밋: 이 세션에서 푸시 예정 (아래 "오늘 한 일" 참고).
개발 규칙은 `CLAUDE.md`가 기준이다. 이 문서는 "지금 어디까지 왔나"만 적는다.

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
- **미해결로 남긴 것**: `README.md`/`SETUP_MACOS_SELFHOST.md`는 운영을 맥북
  자체 호스팅(pm2+Cloudflare Tunnel)으로 옮긴 것처럼 써있는데, 이 세션에서
  `vercel whoami`/`.vercel/project.json` 확인 결과 **지금도 실제 운영은 Vercel**이다.
  `SETUP_MACOS_SELFHOST.md`는 9/20에 작성된 계획 문서로 보이고 실제 전환은
  안 된 것 같음 - 다음에 다룰 때 사용자에게 먼저 확인할 것 (맥북을 실제로
  서버로 쓰기 시작했는지, 아니면 아직 계획 단계인지).

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
- 푸시 전에도 `git pull`을 한 번 더 한다. 푸시하면 Vercel이 자동 배포한다 → Vercel에서 **Ready** 확인 후 사이트에서 `Ctrl+Shift+R`.
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

Vercel 빌드는 전체 TS 검사를 한다. 로컬에 `sharp`/`canvas`가 없으면 `tsc`가 오류를 숨기므로:
1. `sharp`, `canvas`와 의존 패키지(`@img, color, color-string, color-convert, color-name, detect-libc, semver, simple-swizzle, is-arrayish, node-addon-api`)를 임시로 `node_modules`에 복사 (또는 `npm i --no-save sharp canvas`)
2. `node node_modules/typescript/bin/tsc --noEmit -p .` (`web-push` 관련 오류만 무시)
3. 임시 패키지와 `tsconfig.tsbuildinfo` 삭제 후 커밋·푸시

## 7. 사용자(소싱) 쪽 메모 — 코드와 무관

- 1688 상품 정보 고시 입력 시: 소재 혼용률은 반드시 판매처에 확인 (남성 속옷 C858은 폴리 95% / 나머지 5% 미확인, 오버니 양말은 涤棉 75% 외 미확인). 근거 없는 소재·"항균"·"EO 멸균" 문구는 쓰지 말 것.
