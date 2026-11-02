# 인수인계 (HANDOFF) — 다른 PC에서 바로 이어서 작업하기

마지막 갱신: 2026-11-02 (jarvis PC). 최종 커밋: `1622b73` (main, origin/main과 동일, 로컬 미커밋 변경 없음).
개발 규칙은 `CLAUDE.md`, 미실행 SQL은 `supabase/PENDING_MIGRATIONS.md`가 기준이다. 이 문서는 "지금 어디까지 왔나"만 적는다.

## 1. 다른 PC에서 시작하는 순서 (5분)

```bash
cd <hion 폴더>
git pull            # 먼저 받는다 (wook PC 작업이 기준 - 덮어쓰지 말 것)
npm install         # package.json이 바뀌었을 수 있음
npm run dev         # http://localhost:3000
```

- `.env.local`은 git에 없다. 새 PC라면 `.env.local.example`을 보고 직접 채운다 (비밀키는 채팅/커밋에 올리지 말 것).
- 푸시 전에도 `git pull`을 한 번 더 한다. 푸시하면 Vercel이 자동 배포한다 → Vercel에서 **Ready** 확인 후 사이트에서 `Ctrl+Shift+R`.
- Claude Code로 이어갈 때는 첫 요청에 "HANDOFF.md 읽고 이어서 작업해줘"라고 하면 된다.

## 2. SQL — 지금 해야 할 것

Supabase 대시보드 → SQL Editor. **실행 확인이 안 된 것은 2개뿐**이다. (전체 SQL 본문은 `supabase/PENDING_MIGRATIONS.md`에 있고, 파일은 `supabase/` 폴더에 있다. 둘 다 `if not exists` / `drop policy if exists`라서 이미 실행했어도 다시 실행해도 안전하다.)

| 순서 | 파일 | 안 돌리면 | 상태 |
|---|---|---|---|
| 1 | `supabase/thumbnail_style_learning.sql` | 썸네일 "인기상품 스타일 학습" 저장/재사용이 안 되고, 실패한 이미지를 같은 컷으로 다시 생성하지 못함 (그 외 기능은 동작) | ☐ 미확인 |
| 2 | `supabase/brand_templates.sql` | 상세페이지 "내 브랜드 템플릿" 저장 불가 (기본 색상 템플릿은 사용 가능) | ☐ 미확인 |

- 두 파일 모두 마지막 줄이 `notify pgrst, 'reload schema';` 라서 실행하면 바로 반영된다.
- 실행했으면 `PENDING_MIGRATIONS.md`의 체크박스를 `[x]`로 바꾸고 커밋·푸시한다 (그래야 다른 PC에서도 "완료"로 보인다).
- **이번 세션(11/1~11/2)에 만든 기능들은 새 SQL이 필요 없다.** 사용한 컬럼(`thumbnail_images.input_image_url/output_image_url/error/kind/position/color_label/style_spec`, `detail_page_sections.output_image_url/error/prompt_text`)은 기존 SQL에 이미 있다. 입력 저장용 `form-state/*.json`은 기존 `detail-images` 스토리지 버킷을 쓴다 (SQL 아님).
- 참고: `supabase/schema.sql`에는 위 2개 테이블이 아직 합쳐져 있지 않다. 실행 확인 후 합쳐도 된다.

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
