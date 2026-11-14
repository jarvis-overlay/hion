# 인수인계 (HANDOFF) — 다른 PC에서 바로 이어서 작업하기

마지막 갱신: 2026-11-14 (wook PC, 쿠팡 조사 정렬·정확도·사진 비교 / 알림 이메일 지정). 개발 규칙은 `CLAUDE.md`가 기준이다. 이 문서는 "지금 어디까지 왔나"만 적는다.

## 다른 PC에서 시작할 때 (2026-11-13)

1. `git pull` (모든 작업이 `main`에 푸시돼 있음, 마지막 커밋 `48223a7`). `package.json` 변경 없음이라 `npm install`은 안 해도 됨.
2. 이번 세션에서 새로 한 것(위에서 아래로 -9 → -4): 알림 이메일(한 기기에 여러 이메일), 쿠팡 사진 비교, 정확도 점수·정렬, 배송비 계산기 부가서비스 기본값, 상세·옵션 확인.
3. **맥북에서 실제로 확인해야 하는 것(이 PC에서는 못 봄)**: ① `scripts/setup-vapid-mac.sh` 실행 결과(사용자가 실행했다고 함 — 끝 메시지가 "키 추가"인지 "이미 있음"인지 미확인) 후 업무수첩 공유 알림이 실제로 가는지, ② 새 알림 설정 화면(이메일 칩·추가)이 배포됐는지, ③ 쿠팡 조사: 사진 비교 점수가 붙는지(`사진 ?`만 뜨면 썸네일 주소 허용 목록 문제), 상세·옵션 확인이 쿠팡 차단(캡차)에 얼마나 막히는지.
4. 배송비 계산기 기본값은 브라우저 localStorage라 PC마다 따로 저장해야 함.
5. 이 PC에만 있는 미추적 파일 `업무수첩_기능정리.md`는 다른 프로젝트(rpa-system) 문서라 커밋하지 않았음.

## -11. 쿠팡 조사 결과 자동 저장/복원 + 정확도 점수 보정 (2026-11-14)

- `components/CoupangResearchPanel.tsx`: 조사 결과(후보·체크·제거·정렬·상세확인·사진비교 결과)를 항목별로 브라우저 localStorage(`hion.coupangResearch.v1.<항목id>`)에 자동 저장, 패널을 닫았다 열어도 복원. 내 상품 사진은 저장 안 함. **PC·브라우저마다 따로**(DB 저장 아님) — PC 간 공유가 필요하면 DB 컬럼(jsonb) 마이그레이션이 필요.
- `lib/candidateScore.ts`: 검색어 일치를 띄어쓰기 무시·두 글자 조각 부분 일치로 채점. 사진 비교 결과가 하나도 없으면 점수에서 제외(전부 같은 점수 되는 문제). `lib/candidateImageMatch.ts`: 후보 사진을 못 받은 이유(허용 목록 밖 호스트 / 받기 실패)를 오류 문구로 반환.
- 확인 못 한 것: 실제 화면 동작, 사진 비교가 계속 실패하는 진짜 원인(사용자가 화면의 "사진을 비교하지 못했어요 …" 문구를 알려줘야 함).

## -10. 소싱 리스트: 진행 단계 6개로 통합 + 필터 정리 (2026-11-14)

- 단계: 검수전 → 검수 완료 → 소싱 진행 중 → 판매중 | 판매중지 · 보류. 로직은 `lib/sourcingProcess.ts`.
- **DB 변경 없음.** 새 단계 값을 `sourcing_items.status`(제약 없는 text)에 그대로 저장(`before_review/reviewed/sourcing/on_sale/stopped/hold`). 예전 값은 읽을 때 환산(`resolveProcess`): `ordered`·우선순위 `waiting/ordering` → 소싱 진행 중, `not_set/checking` + stage `confirmed` → 검수 완료, 그 외 검수전. 항목의 단계를 한 번 바꾸면 새 값으로 저장됨.
- 필터: 후보/확정·상태 드롭다운 삭제 → 단계 칩(개수 표시, 판매중지·보류는 구분선 뒤). 우선순위는 1·2·3·미지정만(발주 대기/진행 중 제거), 입력/미입력은 "더보기" 안으로. 카드의 후보/확정 선택·배지도 제거(stage 컬럼은 DB에 그대로 남음, 화면에서만 안 씀).
- 같이 바꾼 곳: 판매 전략 필터(`SalesStrategyList.tsx`), 대시보드 홈 "소싱 리스트 현황"(6단계 개수).
- 확인 못 한 것: 실제 화면(tsc만 통과). 예전 데이터 환산이 기대와 맞는지(특히 "확정 → 검수 완료") 맥북 화면에서 확인 필요.

## -9. 푸시 알림: 알림 받을 이메일 직접 지정 (2026-11-13)

- **한 브라우저=기기 1대=DB 1줄**(endpoint 유일)이라 같은 브라우저로 다른 이메일을 등록하면 예전엔 기존 줄이 덮어써졌음 → 이제 이미 등록된 기기면 이름은 두고 이메일을 "추가"(`user_email`에 쉼표로 여러 개, `lib/pushOwners.ts`). 기기 줄에 이메일 칩(✕로 개별 제거, 마지막이면 기기 삭제)·"+ 이메일 추가". 공유 알림 조회는 `ilike`+정확 일치 필터. 서버 알림 키(VAPID)가 바뀐 뒤 재등록 시 `InvalidStateError`가 나므로 예전 구독을 해제하고 다시 구독하게 함(이때 구독 주소가 바뀌어 새 줄이 생기고 예전 줄은 다음 전송 때 자동 삭제됨).

- 알림 설정 > "이 기기 등록하기" 위에 "알림 받을 이메일" 입력칸(기본 = 로그인 이메일, 접속 허용 계정 목록이 자동완성). 등록된 기기 줄마다 "이메일 변경"(다시 등록 안 해도 됨). 서버(`app/dashboard/notifications/actions.ts`)는 `allowed_users`에 있는 이메일만 허용(오타·외부 주소 차단), 목록을 못 읽으면 내 이메일만 허용. 허용된 계정이면 누구나 다른 기기의 이메일도 바꿀 수 있음(기존 등록 해제와 같은 권한 수준).
- 맥북 VAPID 키: 공유 알림이 "서버에 VAPID 키가 없어요"로 실패 → `scripts/setup-vapid-mac.sh`를 맥북에서 실행해야 함(키 생성·`.env.local` 기록·재빌드). 실행 여부는 아직 확인 못 함.
- 확인함: tsc 통과. 확인 못함: 실제 화면·DB 동작(RLS UPDATE 정책으로 이메일 변경이 실제 되는지).

## -8. 쿠팡 조사: 내 상품 사진 ↔ 후보 사진 AI 비교 (2026-11-13)

- 패널에서 "내 상품 사진 올리기(선택)" → 조사하면 끝나는 대로 후보 사진을 8장씩 묶어 Gemini로 비교(`lib/candidateImageMatch.ts`, 서버 액션 `matchCandidateImages`). 후보마다 0~100 닮은 정도 + 같은 종류인지 → 정확도 점수에 반영(가중치 50, `lib/candidateScore.ts`의 `W.image`). 후보 줄에 "사진 ✓ 87%", 일괄 제거 바에 "사진 많이 다름(AI 추정) N개"(자동 삭제 없음, "조건 안 맞는 것 전부"에도 안 섞임).
- **사진은 저장하지 않는다**(화면에서만 사용, 긴 변 640px JPEG로 줄여 서버 호출에 실음). 소싱 항목에 사진 필드를 추가해 영구 저장하려면 마이그레이션(+Storage)이 필요 — 이번엔 이 PC에서 DB 적용이 안 돼서 안 했음.
- 보안: 후보 사진은 `*.coupangcdn.com` https만 서버가 받아옴(포트·userinfo 차단, 리다이렉트는 직접 따라가며 매번 주소 확인, 800KB 상한), 기준 사진은 jpeg/png/webp·base64 700KB 이하만 허용.
- 교차검증: reviewer(치명 0)·qa 지적 반영 — 사진을 바꾸거나 지우면 이전 비교 결과 폐기, 새 조사 때 옛 삭제 목록이 비교에서 후보를 빼던 것, 일부/전부 실패 안내("N개 중 M개 비교"), 할 일 없을 때 안내, 불일치 사진엔 AI가 적은 다른 점 표시. 안 한 것: 비교 중 목록이 계속 재정렬됨, "사진 많이 다름" 버튼은 확인창 없이 바로 제거(다른 일괄 제거와 동일, "되돌리기" 링크로 복구), 서버 액션이 직렬이라 비교 중 다른 작업(상세 확인 등)이 기다릴 수 있음(실화면 확인 필요).
- 확인함(이 PC): tsc 통과, 가짜 fetch/Gemini 스텁 테스트(주소 검증, 응답 파싱, 점수 계산). 확인 못함: 실제 Gemini 사진 비교 품질, 쿠팡 썸네일이 실제로 `coupangcdn.com` 호스트인지(아니면 전부 "모름"으로 처리됨 → 화면에서 사진 점수가 안 붙으면 이 점부터 의심), 8장 묶음 1회 소요 시간, 서버 액션 본문 크기(기준 사진 약 50~100KB ×4회).

## -7. 쿠팡 조사: 정렬 + 정확도 점수 (2026-11-13)

- 후보 목록 정렬 버튼: 쿠팡 순서 / **정확도 높은 순** / 리뷰 많은 순 / 가격 낮은·높은 순(값 없는 후보는 항상 맨 아래). 조건(재질·사이즈·색상)을 적고 조사하면 기본이 정확도순.
- **정확도 점수**(`lib/candidateScore.ts`, 순수 함수 0~100): 키워드 포함 20 + 재질 40 + 사이즈 25 + 색상 15 중 "입력한 조건"끼리 비율로 환산. 확인된 일치=만점, 모름=30%, 확인된 불일치=감점(AI 추정 불일치는 덜 감점). 상세·옵션 확인 결과가 있으면 상품명 추정보다 우선. 각 후보에 "정확도 N점 · 재질 ✓ 사이즈 ? 색상 ✗" 표시. 상세 확인은 점수 높은 후보부터 읽음.
- 상세 확인 재질 판정 프롬프트 보정: 폴리에스터/나일론 같은 섬유 성분만 적혀 있으면 극세사와 겹치므로 different 대신 unknown(애플민트 오판 사례).
- 쿠팡이 막은 후보(캡차)는 "HTTP 200" 대신 "쿠팡이 페이지를 막았거나..." 문구. 실패한 후보는 버튼을 다시 누르면 재시도됨(done 아닌 것이 대상).
- 확인함: tsc 통과, 점수 함수 스텁 7케이스(순위가 의도대로). 확인 못함: 실제 화면, 점수 가중치가 실제 후보에서 체감상 맞는지(가중치는 `W`/`UNKNOWN_CREDIT`로 조정).
- 아직 안 한 것(후보): 내 상품 사진을 올려 후보 사진과 AI로 비교(소싱 아이템에 사진 필드가 없어서 업로드 필요).

## -6. 해외배송비 계산기 부가서비스 "기본값 저장" (2026-11-13)

`components/ShippingCostCalculator.tsx`: 부가서비스 목록(항목명·금액·전체/개당)을 "지금 목록을 기본값으로 저장"으로 저장 → 새 상품(입력 없음)에서 계산기를 열면 자동으로 채움. 불러오기/지우기 버튼 있음. **저장 위치는 브라우저 localStorage**(키 `hion.shippingExtraFeeDefaults.v1`)라 PC·브라우저마다 따로이고 SQL 변경 없음. PC 간 공유가 필요하면 Supabase 테이블로 옮겨야 함(마이그레이션 필요). 이미 저장된 상품(계산 상태가 있는 것)은 자동으로 덮어쓰지 않음. 확인함: tsc 통과. 확인 못함: 실제 화면 동작(자동 채움 타이밍, 문구).

## -4. 업무수첩 공유 → 앱 푸시 알림 (2026-11-12, wook PC)

업무수첩 공유 창에서 상대에게 "보기/편집" 권한을 주면, 상대가 이 계정으로 등록해둔 기기로 앱 푸시가 간다 (`📒 업무수첩이 공유됐어요 - OO님이 "제목" 수첩을 편집 권한으로 공유했어요`, 누르면 해당 노트로 이동).
- **새로 공유했거나 권한이 바뀐 경우에만** 보냄(같은 값 재저장·공유 해제는 알림 없음). 알림이 못 갔으면 공유 창에 이유를 표시(상대가 기기 미등록 / 푸시 설정 문제 등) — 공유 자체는 실패로 만들지 않음.
- 구조 변경: `push_subscriptions`에 **`user_email`(기기 주인)** 추가. 예전엔 주인 정보가 없어서 "특정 사람에게만" 보낼 수 없었음. `lib/webpush.ts`에 `sendPushToEmail` 추가(기존 `sendPushToAll`은 동작 그대로), 기기 등록(`savePushSubscription`)이 로그인 이메일을 소문자로 저장.
- **미실행 SQL (반드시 필요)**: `supabase/migrations/20261112120000_add_push_subscription_owner.sql` (컬럼 + 인덱스 + **UPDATE RLS 정책** — 원래 UPDATE 정책이 없어서 기존 기기를 upsert로 갱신할 수 없었음). 이 PC는 `supabase link`가 안 돼 있어서 적용 못 함. 적용 전에도 앱은 안 깨지게 폴백을 넣음(기기 등록은 주인 없이 저장, 알림은 "설정이 아직 준비되지 않았다"고 안내). 적용 방법: 연결된 PC에서 `npx supabase db push --remote`, 또는 Supabase SQL Editor에 파일 내용을 붙여넣어 실행(여러 번 실행해도 안전하게 작성됨).
- **이미 등록돼 있던 기기는 주인이 비어 있다** → 공유 알림을 받으려는 사람이 자기 기기에서 알림 설정 > "이 기기 등록하기"를 다시 눌러야 한다(알림 설정 화면 목록에 "주인 미지정" 표시됨). 두 사람 모두 한 번씩 필요.
- **공유 창 "공유 기능이 아직 설정되지 않았어요" 해결 (맥북 접속 없이)**: 원인은 맥북에 `SUPABASE_SERVICE_ROLE_KEY`가 없는 것(사용자가 실제 화면으로 확인). 맥북에 접속할 수 없는 상황이라, 상대 이메일 → 계정 ID 변환을 그 키 없이 하는 DB 함수 `lookup_allowed_user_id`를 추가함(`supabase/migrations/20261112130000_add_lookup_allowed_user_id.sql`, security definer, 호출자·대상 둘 다 allowed_users여야 조회됨). `setNoteShare`는 이 함수를 먼저 쓰고, 함수가 DB에 없으면 예전 방식(키)으로 폴백. **이 SQL도 실행해야 함**(위 `20261112120000`과 함께, 둘 다 여러 번 실행해도 안전). 맥북 `.env.local`에 키를 넣는 것은 여전히 권장: 쿠팡 자동 동기화 크론(`/api/cron/*`)과 카카오 연동 콜백도 같은 키를 쓴다(키 없이 실제로 실패하는지는 확인 못함).
- **확인함(이 PC)**: `tsc` 전체 통과. **확인 못함**: 실제 푸시 수신(웹푸시 전송·기기 표시는 맥북/실기기에서만 검증 가능), 마이그레이션 적용 후 동작(특히 `lookup_allowed_user_id`가 실제 DB에서 상대 계정을 찾는지), 공유 창 화면 문구·레이아웃.

## -5. 쿠팡 후보 "상세·옵션 확인" 추가 (2026-11-12, 사전 없이 재질 판정)

사용자 요청: 상품마다 달라서 재질 단어 사전을 늘리는 방식은 싫다 → 상품 상세페이지·옵션까지 읽어서 비교.
- **동작**: 패널의 "남은 후보 상세·옵션 확인(최대 12개)" 버튼 → 후보마다 서버 액션 `inspectCoupangCandidate(url, {material,size,color})` 1회(Bright Data로 상품 페이지 마크다운 1번 + Gemini 텍스트 호출 1번). 클라이언트가 1개씩 순차 호출(Next가 서버 액션을 어차피 한 줄로 실행함, 진행률 표시, 멈추기 가능).
- **역할 분담**: AI는 페이지에 "적힌" 소재/사이즈/색상 옵션을 읽어오기만 함(`lib/coupangDetail.ts`). 사이즈·색상 일치 여부는 코드(`lib/candidateFilter.ts`의 `sizeStatus`/`colorStatus`)가 비교. 재질은 AI가 same/different 판정하되 **근거 문구가 실제 페이지 텍스트에 있을 때만** different 인정.
- **"모르면 안 건드린다"**: 페이지 텍스트가 6000자 한도로 잘렸거나 옵션 목록이 40개 상한에 닿으면 "옵션에 없음" 단정을 안 함(unknown). mm 표기가 섞이면 사이즈 비교 안 함. 상세가 same이어도 사전이 확정한 "재질 다름" 배지는 안 지움(AI 추정 배지만 정정). "조건 안 맞는 것 전부" 버튼에는 상세(AI) 재질 판정을 넣지 않고 "상세 확인 재질 다름 N개" 별도 버튼.
- **보안/오류**: `isCoupangProductUrl`로 www.coupang.com/vp/products/ https만 허용(포트·userinfo 차단, 정규화한 href만 Bright Data에 전달). 영어 원문/환경변수명 에러는 한국어 고정 문구로 대체(`readableError`).
- **교차검증**: reviewer(치명 0, 중요 4건)·qa 지적 반영 완료 — 동시 2개→1개, 잘림 시 unknown, same이 dict 배지 덮던 것·배지/버튼 숫자 불일치 수정, 영어 에러 제거, 12개 초과 안내/완료 요약 추가.
- **확인함(이 PC)**: tsc 전체 통과, 텍스트 추출·사이즈/색상 상태·근거 검증 로직 스텁 테스트.
- **확인 못함(맥북에서 꼭 볼 것)**: ① **실제 쿠팡 상품 페이지 마크다운에 옵션(사이즈/색상) 목록이 들어오는가** — 동적으로 그려져 안 담기면 "상세: 소재/옵션 정보를 못 찾았어요"만 나옴(그 경우 대안: Bright Data 브라우저 렌더링/상품 API 검토). 후보 2~3개로 눌러 쿠팡 화면과 비교. ② Gemini 재질 판정 품질(규조토 → 재질 다름, 극세사 → 안 걸림, 근거 문구가 실제 문장인지). ③ 실제 소요 시간(후보당 10~40초 가정), 100초 넘는 후보에서 Cloudflare 터널 오류 문구가 어떻게 뜨는지. ④ 레이아웃.

## -4. 쿠팡 조사에 사이즈/색상 + 일괄 제거 추가 (2026-11-12, 늦게 추가)

사용자 요청: 조사할 때 사이즈·색상도 넣고, 내가 원하는 재질/사이즈가 아닌 후보를 일괄 삭제하고, 정확도를 높이고 싶다.
- **신규 `lib/candidateFilter.ts`**(순수 함수): `sizeMismatch`(40x60/40*60/40×60cm 표기 정규화, 60x40=40x60), `colorMismatch`(그레이=회색 등 동의어 묶음, 여러 색 가능), `firstSizeToken`/`firstColorToken`. 원칙은 "모르면 안 건드린다" — 상품명에 사이즈/색이 없거나 내 입력을 해석 못 하면 배지 없음. 단위 케이스 14개 직접 확인.
- **`researchCoupangComparisons(keyword, {material,size,color})`**: 시그니처가 `(keyword, userMaterial?)`에서 옵션 객체로 바뀜(호출부는 패널 하나뿐). 재질/색상/사이즈를 검색어에 붙여서 쿠팡에 검색, 0건이면 키워드만으로 재검색 + 안내 문구(`fallbackNote`). 후보 수 20→30. 결과에 `searchedQuery` 추가.
- **`CoupangResearchPanel.tsx`**: 사이즈/색상 입력란, 후보별 "사이즈 다름/색상 다름" 배지, 일괄 제거 바(재질 다름 / 사이즈 다름 / 색상 다름 / AI 추정 다름 / 조건 안 맞는 것 전부 / 체크 안 한 것), 제거 후 남은 후보 기준으로 시장규모·경쟁강도·가격대 재계산(`analyzeCoupangResults`를 클라이언트에서 호출). AI 추정은 틀릴 수 있어 "전부" 버튼에서 빼고 별도 버튼으로 분리. "제거한 N개 다시 보기"로 되돌릴 수 있음.
- **확인함**: tsc 전체 통과, 판정 함수 단위 케이스.
- **확인 못함(맥북에서 볼 것)**: 재질+색+사이즈를 붙인 쿠팡 검색이 실제로 결과를 충분히 주는지(0건이면 키워드만으로 재검색됨), 화면 레이아웃(입력 3칸, 일괄 제거 바 줄바꿈). 이 변경은 `/build` 교차검증(reviewer/qa)을 거치지 않았음 — 필요하면 돌릴 것.

## -3. 다음 세션이 제일 먼저 할 일 (2026-11-12)

1. **`SUPABASE_SERVICE_ROLE_KEY` 맥북에 있는지 확인.** 업무수첩 공유(보기/편집 권한 주기)를 한 번 눌러봐서 "공유 기능이 아직 설정되지 않았어요"가 뜨면 이 키가 없는 것 — Bright Data 때와 같은 절차(Supabase 대시보드 → Project Settings → API → service_role 키 확인 → 맥북 `~/hion/.env.local`에 추가 → `pm2 restart hion`)로 처리. 자세한 배경은 아래 "-2" 참고.
2. **재질 구분 배지 기능을 실제 Gemini 키가 있는 환경(맥북)에서 한 번 써볼 것.** 소싱 리스트 > 비교 상품군 > "내 상품 재질(선택)"에 값 넣고 조사해서, ① 사전에 걸리는 경우(예: "극세사" 입력 + "규조토" 포함 후보)에 배지가 바로 붙는지 ② 애매한 제목에 "AI 추정" 배지가 실제로 붙는지(Gemini 응답 품질은 이 PC에서 전혀 검증 못 함, 전부 모킹 테스트만 함) 확인. 안 붙어도 에러는 안 떠야 정상(설계 의도) — 그게 "꺼져 있는 것"인지 "다 매칭이라 안 붙은 것"인지는 화면만으론 구분 안 됨(QA가 지적한 알려진 한계, 아래 "-2" 참고).

## -2. 오늘(2026-11-12) 한 일 요약

**1) Bright Data 환경변수 누락 — 해결 완료.** 맥북 `.env.local`에 `BRIGHTDATA_API_KEY`/`BRIGHTDATA_UNLOCKER_ZONE` 추가 + `pm2 restart hion` 완료, 사용자가 실제 화면에서 "조사하기"로 쿠팡 후보가 뜨는 것까지 확인함(스크린샷 확인). 아래 "-1"의 "확인 못함" 중 "실제 Bright Data 호출" 항목은 확인 완료로 처리.

**2) 업무수첩 공유 크래시 수정 (커밋 `32213ff`).** `setNoteShare`가 `SUPABASE_SERVICE_ROLE_KEY` 누락 시 `createAdminClient()`에서 던지는 예외를 안 잡고 있어서, 공유 권한을 지정할 때마다 화면 전체가 Next.js 원시 에러("Server Components render" + digest)로 죽는 걸 사용자가 실제로 겪음. try/catch로 감싸서 "공유 기능이 아직 설정되지 않았어요" 한국어 안내로 대체 — **단, 이건 화면이 안 죽게만 할 뿐 공유 기능 자체가 되게 하려면 위 "-3"의 1번 작업이 필요함.**

**3) 소싱 쿠팡 조사에 재질/방식 구분 배지 추가 (커밋 `92d110a`).** `/build` 체계(planner→architect→developer→reviewer/qa)로 진행, 완료해서 push까지 함.
- 신규: `lib/materialKeywords.ts`(욕실매트류 재질 키워드 시드 사전 - 범용 아님, 이 카테고리 전용으로 작게 시작), `lib/materialClassify.ts`(`classifyByDictionary` 순수 함수 + `classifyMaterialMismatch` Gemini 배치 호출, 8초 타임아웃, 절대 throw 안 함).
- 수정: `app/dashboard/sourcing/list/researchActions.ts`(`researchCoupangComparisons`에 `userMaterial?` 파라미터 추가, 비우면 기존과 100% 동일 동작), `components/CoupangResearchPanel.tsx`("내 상품 재질(선택)" 입력란 + 후보별 배지).
- 판정 3단계: ①제목에 사용자 입력 재질이 그대로 있으면 매칭(배지 없음) ②시드 사전에 있는 다른 재질 키워드면 "재질 다름" 배지(결정적, 비용 0) ③둘 다 아닌 애매한 것만 모아 한 번의 Gemini 배치 호출로 "AI 추정" 배지.
- **QA 라운드에서 찾아서 고친 문제**: 초기 사전에 "미끄럼방지/패브릭/고무"처럼 재질이 아닌 범용 기능어가 섞여 있어서, 진짜 극세사 경쟁상품인데도 "재질 다름"(확정, 빨간색) 배지가 잘못 붙을 위험이 있었음 — 해당 단어들을 사전에서 제거해서 고침.
- **알려진 한계(배포는 했지만 손 안 댐 - 경미)**: AI 호출이 꺼져있거나 실패해도 에러 문구가 안 뜨는 건 의도된 설계인데, 그 결과 "AI가 다 같은 재질이라 판단했다"와 "AI 호출 자체가 안 됐다"를 화면만 보고 구분할 방법이 없음. 필요해지면 "AI 보완 N건 확인함" 같은 작은 상태 표시를 추가하는 걸 다음 후보로 남겨둠.
- **확인함(이 PC)**: tsc 전체 통과, `classifyByDictionary`/`classifyMaterialMismatch`/`researchCoupangComparisons` 전부 스텁/모킹으로 단위·통합 테스트, reviewer(치명/중요 문제 없음)·QA(성공기준 5개 전부 PASS) 교차검증 통과.
- **확인 못함**: 실제 Gemini 호출 품질(진짜로 "규조토 vs 극세사"를 잘 구분하는지), 실제 브라우저 레이아웃(입력란 위치, 배지 줄바꿈 등) — 위 "-3" 2번 참고.

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
