# hion (비즈니스 허브) 개발 규칙

Next.js 14 App Router + Supabase. **운영 서버는 맥북**(`https://hion.cc`, pm2 + Cloudflare Tunnel). GitHub `main`에 푸시하면 맥북이 약 90초 안에 자동으로 pull → build → 재시작한다 (자세한 구조: `SETUP_MACOS_SELFHOST.md`, `PROCESS_ARCHITECTURE.md`). 사용자 UI/답변은 한국어.
사용자는 두 PC(`jarvis`, `wook`)에서 작업한다. 작업 시작 전 `git pull`, 푸시 전 다시 pull.

## 항상 지킬 것
- 세션 시작 시 `HANDOFF.md`(현재 진행 상황·미실행 SQL·확인 못 한 것)를 먼저 읽고, 작업이 끝나면 갱신한다.
- 에러가 나면 안 된다: 외부 API(Gemini/Claude/Supabase/Bright Data)는 실패를 전제로, 화면에 읽을 수 있는 한국어 오류 문구와 대체 동작을 둔다.
- wook PC 작업이 기준이다. 요청 없이 덮어쓰지 않는다.
- `.env*`와 비밀키는 읽어서 출력·커밋하지 않는다. GitHub 로그인/자격 증명 변경은 사용자가 직접 한다.
- 커밋 메시지 끝: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
- 배포는 작업 완료 후 main에 푸시. `git push`가 곧 운영 배포이므로 푸시 전 검증(아래)을 반드시 한다. 사용자에게는 "약 90초 뒤 https://hion.cc 에서 Ctrl+Shift+R로 확인"을 안내한다. 배포 스크립트는 `scripts/deploy-watch.sh`(설치·문제 해결: `scripts/DEPLOY.md`, 검증: `bash scripts/test-deploy-watch.sh`)이다. 반영이 안 되면 맥북에서 `tail -30 /Users/wook/.pm2/autodeploy.log`를 확인해야 한다(이 PC에서는 볼 수 없다). 배포 중 수십 초간 일시적 오류가 날 수 있다.
- **큰 기능·위험한 변경(AI 생성 로직, 결제/인증 관련 등)은 feature 브랜치로 푸시 → Vercel이 만들어주는 Preview URL에서 실제로 눌러보고 확인 → main에 머지**한다. 한 줄 수정·문구 변경처럼 작은 일은 바로 main에 푸시해도 된다. (Vercel Preview는 Vercel 프로젝트가 남아 있는 동안에만 쓸 수 있고, 운영인 맥북과는 별개 환경이다. 맥북 운영 환경과 같은 결과라고 단정하지 말 것)
- DB 스키마 변경은 이제 Supabase CLI 마이그레이션으로 관리한다: `npx supabase migration new <이름>`으로 `supabase/migrations/`에 파일 생성 → SQL 작성 → `npx supabase db push --remote`로 적용. 원격 DB가 적용 여부를 자체 기록하므로 어느 PC에서 실행해도 중복 걱정이 없다. 마이그레이션 파일은 반드시 git에 커밋한다. (`supabase/PENDING_MIGRATIONS.md`와 `supabase/*.sql` 낱개 파일은 2026-11-05 이전 기록이라 참고용으로만 남겨둠)
- AI가 만든 결과는 원본과 대조 검증한다(`lib/outputVerifier.ts`: 종류·실루엣·색·부품 비교 → 다르면 틀린 점을 알려 재생성 → 그래도 다르면 원본 사진 사용 + 화면에 경고). 새 AI 생성 기능엔 같은 검증을 붙인다.
- AI가 상품을 "다시 그리면" 색·길이·부품이 틀어진다. 상품 픽셀은 원본 사진 그대로 쓰고, 한글 문구는 AI가 아닌 코드(node-canvas)로 합성한다.

## 검증 규칙 (운영 빌드 `next build`는 전체 TypeScript 검사를 한다)
로컬엔 sharp/canvas가 없어 tsc가 오류를 숨긴다. 푸시 전:
1. 스크래치패드의 `imgtest/node_modules`에서 `sharp`, `canvas`(+의존 패키지)를 `node_modules`로 임시 복사
2. `node node_modules/typescript/bin/tsc --noEmit -p .` (web-push 오류는 무시)
3. 복사한 패키지와 `tsconfig.tsbuildinfo` 삭제

## 개발 체계 (개인용 개발부서 키트: `tools/dev-system/`)
`/resume`(시작) → `/dev <요청>` → `/handover`(종료). 설치는 PC마다 `python tools/dev-system/install.py` (설명: `tools/dev-system/README.md`). 새 세션을 열어야 보인다.
- 규모 S(한 줄·문구)는 에이전트 없이 직접 수정 + `tsc`. M은 `dev-planner`→`dev-implementer`→`dev-reviewer`. L(AI 생성 로직·결제·인증·스키마·외부 시스템)은 계획 승인 + 높음 지적은 `dev-verifier`(opus) 교차 검증.
- 리뷰어는 구현자 설명 없이 `git diff`와 완료 기준만 본다. 타입 검사(위 "검증 규칙")는 리뷰어가 돌린다.
- 이 프로젝트는 `.claude/dev-system.json`의 `allow_main_push`로 main 푸시를 허용한다(푸시=배포). 강제 푸시·`--no-verify`·`git add -A`·시크릿 스테이징은 가드 훅이 계속 막는다. 큰·위험한 변경은 위 규칙대로 feature 브랜치 + Preview 후 머지.
- `/handover`는 `HANDOFF.md`를 **상세하게** 갱신한다(이력을 줄이지 않음). `/resume`은 그중 맨 위 "지금 상태·남은 일"부터 읽는다.
- **세션 시작 시(어느 PC든) 먼저 `python tools/dev-system/install.py --check`를 실행**한다. "다름/없음"이면 사용자에게 알리고, 승인받아 `python tools/dev-system/install.py`로 설치/갱신한 뒤 "새 세션을 열어야 반영된다"고 안내한다. (사용자가 PC를 옮겨도 잊지 않게 하는 장치. `/resume`도 같은 확인을 한다.)
- 결과 보고는 "무엇을 만들었나 / 확인한 것 / 확인 못 한 것(실제 API·화면)"을 구분해 정직하게 쓴다.
- 실제 Gemini/Supabase 동작은 이 PC에서 검증할 수 없다. 못 본 것은 본 것처럼 말하지 않는다.
