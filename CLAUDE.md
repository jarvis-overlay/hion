# hion (비즈니스 허브) 개발 규칙

Next.js 14 App Router + Supabase + Vercel(GitHub `main` 푸시 시 자동 배포). 사용자 UI/답변은 한국어.
사용자는 두 PC(`jarvis`, `wook`)에서 작업한다. 작업 시작 전 `git pull`, 푸시 전 다시 pull.

## 항상 지킬 것
- 에러가 나면 안 된다: 외부 API(Gemini/Claude/Supabase/Bright Data)는 실패를 전제로, 화면에 읽을 수 있는 한국어 오류 문구와 대체 동작을 둔다.
- wook PC 작업이 기준이다. 요청 없이 덮어쓰지 않는다.
- `.env*`와 비밀키는 읽어서 출력·커밋하지 않는다. GitHub 로그인/자격 증명 변경은 사용자가 직접 한다.
- 커밋 메시지 끝: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
- 배포는 작업 완료 후 푸시. 사용자에게 Vercel Ready 확인과 강력 새로고침을 안내한다.
- AI가 상품을 "다시 그리면" 색·길이·부품이 틀어진다. 상품 픽셀은 원본 사진 그대로 쓰고, 한글 문구는 AI가 아닌 코드(node-canvas)로 합성한다.

## 검증 규칙 (Vercel 빌드는 전체 TypeScript 검사를 한다)
로컬엔 sharp/canvas가 없어 tsc가 오류를 숨긴다. 푸시 전:
1. 스크래치패드의 `imgtest/node_modules`에서 `sharp`, `canvas`(+의존 패키지)를 `node_modules`로 임시 복사
2. `node node_modules/typescript/bin/tsc --noEmit -p .` (web-push 오류는 무시)
3. 복사한 패키지와 `tsconfig.tsbuildinfo` 삭제

## 개발 체계 (에이전트 협업)
큰 기능·구조 변경·반복되는 버그는 `/build <요청>` 으로 아래 순서를 따른다 (`.claude/commands/build.md`).
기획 검증 → 설계/효율 검토 → 개발 → 교차 검증(코드 검수 + 사용자 관점 QA) → 지적 반영 → 완료 보고.
한 줄 수정·문구 변경 같은 작은 일은 바로 처리한다.

에이전트(`.claude/agents/`): `planner`(기획 검증), `architect`(설계·효율), `developer`(구현), `reviewer`(코드 검수), `qa`(사용자 관점 검증).
- 서로의 결과를 그대로 믿지 않는다: 검수/QA가 지적하면 개발이 고치고 다시 검증한다(최대 3회).
- 결과 보고는 "무엇을 만들었나 / 확인한 것 / 확인 못 한 것(실제 API·화면)"을 구분해 정직하게 쓴다.
- 실제 Gemini/Supabase 동작은 이 PC에서 검증할 수 없다. 못 본 것은 본 것처럼 말하지 않는다.
