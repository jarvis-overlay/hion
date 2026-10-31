// Claude API(Haiku 4.5)로 트렌드/판매 데이터를 해석해서 소싱 카테고리/
// 아이템을 추천받기 위한 클라이언트. 구조화된 JSON 응답 신뢰도가 중요한
// 작업이라(키워드를 정확히 그대로 반환해야 링크 매칭이 됨) 지시사항
// 준수력이 좋은 Claude를 쓴다. 저빈도 호출이라 Haiku로도 비용이 매우 낮다.
const MODEL = 'claude-haiku-4-5-20251001';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} 환경변수가 설정 안 되어있어요.`);
  return v;
}

async function callClaude(prompt: string): Promise<string> {
  const apiKey = requireEnv('ANTHROPIC_API_KEY');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 6000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message || `Claude API 오류 (HTTP ${res.status})`);
  }
  // content 블록이 여러 개일 수 있어서(예: thinking 블록) 전부 합친다 -
  // content[0]만 보면 텍스트가 아예 비어있는 경우가 생길 수 있음
  const text = (json.content || [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');
  if (json.stop_reason === 'max_tokens') {
    console.error('[ai] Claude 응답이 max_tokens에서 잘림. 길이:', text.length);
  }
  return extractJson(text);
}

// Claude가 마크다운 코드블록으로 감싸거나 앞뒤에 설명 문장을 붙여서
// 응답할 때가 있어서, 순수 텍스트 stripping만으로는 부족하다. 첫 '['와
// 마지막 ']' 사이만 잘라내서 JSON.parse가 먹을 수 있게 만든다.
function extractJson(text: string): string {
  const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    return cleaned.slice(start, end + 1);
  }
  return cleaned;
}

// 응답이 max_tokens 제한 등으로 중간에 잘려서 배열이 안 닫혔을 때도,
// 완전하게 끝난 객체들만이라도 건져서 반환한다 (전체 실패보다 낫다).
function parseJsonArray(text: string): any[] {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // fall through to repair
  }

  const items: any[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        try {
          items.push(JSON.parse(text.slice(start, i + 1)));
        } catch {
          // 이 조각도 깨졌으면 건너뛴다
        }
        start = -1;
      }
    }
  }
  if (items.length > 0) return items;
  console.error('[ai] JSON 파싱 완전 실패. 원문:', text.slice(0, 1000));
  throw new Error('AI 응답을 해석하지 못했어요. 다시 시도해주세요.');
}

// parseJsonArray의 객체 버전 - 응답이 배열이 아니라 단일 JSON 객체일
// 때 쓴다 (판매 전략처럼 항목이 고정된 몇 개 필드로 구성된 경우).
function parseJsonObject(text: string): any {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // fall through to repair
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // fall through
    }
  }
  console.error('[ai] JSON 객체 파싱 실패. 원문:', text.slice(0, 1000));
  throw new Error('AI 응답을 해석하지 못했어요. 다시 시도해주세요.');
}

export type Season = 'summer' | 'winter' | 'all';

const SEASON_LABEL: Record<Season, string> = {
  summer: '여름 시즌 상품',
  winter: '겨울 시즌 상품',
  all: '사계절 상품 (계절 안 타는 상품)',
};

const SEASON_RULE: Record<Season, string> = {
  summer:
    '여름에만 잘 팔리는 상품이어야 합니다. 겨울/사계절 상품(손난로, 전기장판, 사무용품 등)은 넣지 마세요.',
  winter:
    '겨울에만 잘 팔리는 상품이어야 합니다. 여름/사계절 상품(선풍기, 쿨매트, 아이스박스 등)은 넣지 마세요.',
  all: `**계절과 무관하게 연중 똑같이 팔려야 합니다.** 선풍기·손난로·전기장판·쿨매트처럼 특정 계절에만 수요가 몰리는 상품은 절대 넣지 마세요. "선풍기/가습기"처럼 여름 상품과 겨울 상품을 억지로 묶어서 "사계절"이라고 우기는 것도 안 됩니다. 진짜 사계절 상품 예시: 주방용품, 수납/정리용품, 반려동물 용품, 케이블/전자기기 액세서리, 욕실용품.`,
};

// 1인 셀러가 중국(알리바바/1688)에서 실제로 소싱할 수 있는 상품이어야
// 한다 - 통관/위험물 규제, 인증 문제로 소싱 자체가 사실상 불가능하거나
// 매우 어려운 카테고리는 아예 후보에서 빼야 함.
const SOURCING_EXCLUSION_RULE = `**절대 추천하면 안 되는 상품군 (통관/위험물/인증 문제로 1인 셀러가 소싱 불가능하거나 매우 어려움)**:
- 액체/젤/스프레이형 제품 (세제, 클리너, 화장품, 방향제, 소독제 등) — 국제 항공/해상 배송 시 위험물 규제 대상이고, 국내 반입 시 위해우려제품/생활화학제품 신고가 필요해서 개인 셀러가 정상적으로 수입하기 매우 어렵습니다.
- 화장품/의약외품 (식약처 수입 인증 필요)
- 식품/건강기능식품 (수입식품 신고 필요)
- 리튬배터리가 내장된 전자기기 (항공 운송 제한 + KC 인증 필요) — 단, 배터리가 없는 케이블/거치대/커버류는 괜찮습니다.
- 의료기기, 어린이 안전인증(KC) 대상 완구/유아용품

이런 상품군은 카테고리 단계에서든 개별 상품 단계에서든 절대 추천하지 마세요. 대신 같은 니즈를 충족하는 고체/일반 잡화 형태의 대안을 찾으세요 (예: "배수구 액체 클리너" (X) → "배수구 헤어 트랩/거름망" (O), "섬유탈취 스프레이" (X) → "섬유탈취 비즈/캡슐" 중 액체 아닌 것 (O)).`;

export interface CategoryRecommendation {
  category: string;
  reason: string;
}

// 1단계 - 1차: 시즌 + 네이버 트렌드(되면)를 근거로 "검증해볼 후보"
// 카테고리를 브레인스토밍한다. 아직 쿠팡 실데이터는 안 본 상태라
// 최종 결과가 아니라 다음 단계(실데이터 검증)의 입력일 뿐이다.
export async function recommendCategories(input: {
  season: Season;
  contextSummary: string | null;
  excludeCategories?: string[];
  includeScope?: string[];
  compactOnly?: boolean;
}): Promise<CategoryRecommendation[]> {
  const { season, contextSummary, excludeCategories = [], includeScope = [], compactOnly = false } = input;

  const dataSection = contextSummary
    ? `아래는 참고할 실데이터입니다:\n\n${contextSummary}`
    : '(현재 연동된 실시간 데이터는 없습니다. 일반 지식으로 판단해주세요.)';

  const excludeSection =
    excludeCategories.length > 0
      ? `\n**이미 이전에 추천했던 카테고리입니다 - 이것들과 겹치거나 비슷한 카테고리는 절대 다시 추천하지 마세요. 완전히 다른 새로운 카테고리를 찾아주세요**:\n${excludeCategories
          .map((c) => `- ${c}`)
          .join('\n')}\n`
      : '';

  // 사용자가 "조건 모드"에서 입력한 범위 - 지정했으면 이 범위를 벗어난
  // 카테고리는 절대 추천하면 안 된다 (벗어나면 강제가 안 되는 AI 지시일
  // 뿐이라, 실데이터 조회 단계에서 코드로 한 번 더 못 거르는 유일한
  // 조건이라 프롬프트에서 최대한 강하게 못박는다).
  const scopeSection =
    includeScope.length > 0
      ? `\n**사용자가 지정한 범위입니다 - 반드시 아래 범위 안에 속하는 카테고리만 추천하세요. 범위를 벗어나는 카테고리는 절대 추천하지 마세요**:\n${includeScope
          .map((s) => `- ${s}`)
          .join('\n')}\n`
      : '';

  // 배송비가 적게 드는 소형/경량 상품 위주로 - 쿠팡 목록 데이터에 실제
  // 무게/규격 정보가 없어서 코드로 걸러낼 방법이 없다(includeScope와
  // 같은 이유). AI 판단에만 의존하는 지시라 100% 보장은 아니다.
  const compactSection = compactOnly
    ? `\n**배송비가 적게 드는 소형·경량 상품만 추천하세요.** 한 손으로 들 수 있고 작은 박스(택배 기본 규격)에 들어가는 상품만 추천하고, 가구·대형가전·운동기구·캠핑 텐트처럼 부피가 크거나 무거워서 배송비가 많이 드는 상품은 절대 추천하지 마세요.\n`
    : '';

  const prompt = `당신은 1인 이커머스 셀러(쿠팡 로켓그로스, 중국 알리바바/1688에서 소싱)의 소싱 컨설턴트입니다.

사용자는 지금 **"${SEASON_LABEL[season]}"** 을 집중적으로 소싱하고 싶어합니다.

**시즌 조건 (반드시 지킬 것)**: ${SEASON_RULE[season]}

${SOURCING_EXCLUSION_RULE}
${excludeSection}
${scopeSection}
${compactSection}
${dataSection}

이 조건에 맞는, 지금 소싱하기 좋은 **카테고리(상품군)** 8개를 최대한 다양하게(서로 겹치지 않는 여러 생활 영역에 걸쳐서) 추천해주세요. 시장 규모가 클 것 같은 것부터 작고 틈새인 것까지, 경쟁이 치열할 것 같은 것부터 아직 안 붐빌 것 같은 것까지 골고루 섞어주세요 - 나중에 실데이터로 검증한 뒤 시장규모/경쟁강도 조합별로 걸러서 보여줄 예정이라, 후보 단계에서부터 스펙트럼이 다양해야 합니다. "패션의류" 같은 너무 넓은 대분류 말고, "여름 휴대용 냉방 소품" "캠핑 조명용품" 처럼 실제로 무엇을 찾아야 할지 감이 오는 수준의 구체성으로 적어주세요. 단, "A/B", "A·B", "A 및 B" 처럼 서로 다른 상품 여러 개를 하나로 묶은 이름은 절대 쓰지 마세요 — 하나의 일관된 상품군이어야 합니다 (예: "수건걸이/샴푸디스펜서 세트" (X), "선풍기/가습기" (X) → "욕실 정리용품" (O)).

반드시 아래 JSON 배열 형식으로만 응답하세요:
[
  { "category": "카테고리명", "reason": "왜 지금 이 카테고리가 유망한지 (1~2문장, 데이터가 있으면 근거로 인용)" }
]`;

  const cleaned = await callClaude(prompt);
  try {
    return parseJsonArray(cleaned);
  } catch {
    throw new Error('AI 응답을 해석하지 못했어요. 다시 시도해주세요.');
  }
}

export type MarketScaleTier = 'very-high' | 'high' | 'mid' | 'low' | 'very-low';
export type CompetitionTier = 'low' | 'mid' | 'high';

export interface CategoryFinding {
  category: string;
  summary: string; // 그 카테고리명으로 실제 쿠팡 검색을 해본 결과 요약
}

export interface CategoryRecommendationDraft {
  category: string; // 후보 목록의 category와 정확히 일치해야 함
  reason: string; // 실데이터 근거 포함
}

// 1단계 - 2차: 브레인스토밍한 후보 카테고리마다 실제 쿠팡 검색을 해본
// 결과를 근거로 최종 카테고리를 확정한다. "우리 주 채널은 쿠팡"이라는
// 요청에 맞춰, 카테고리 단계부터 실데이터로 검증하도록 추가한 단계.
export async function finalizeCategoryRecommendations(input: {
  season: Season;
  findings: CategoryFinding[];
}): Promise<CategoryRecommendationDraft[]> {
  const { season, findings } = input;

  const findingsText = findings
    .map((f) => `- "${f.category}": ${f.summary}`)
    .join('\n');

  const prompt = `당신은 1인 이커머스 셀러(쿠팡 로켓그로스, 중국 알리바바에서 소싱)의 소싱 컨설턴트입니다.

시즌 조건: "${SEASON_LABEL[season]}"

아래는 후보 카테고리마다 그 이름으로 쿠팡에서 실제 판매량순 검색을 해본 결과입니다 (다른 셀러 포함 시장 전체 데이터):
${findingsText}

**중요한 판단 기준**: 시장 규모는 목록 내 "리뷰 최다 상품"의 리뷰수 절대값으로 판단하세요:
- 리뷰 3,000개 이상: 매우 큰 검증된 시장 / 1,000~3,000개: 확실한 수요 / 300~1,000개: 중간 규모 / 50~300개: 니치 시장 / 50개 미만: 시장이 거의 없음

이 실데이터를 근거로 최종 카테고리를 선별하세요:
- "쿠팡 조회 실패/데이터 없음"인 카테고리는 실데이터 검증이 안 된 것이므로 제외하세요 (단, 전부가 데이터 없음이면 예외적으로 원래 후보 그대로 반환해도 됩니다).
- 시장 규모가 매우 작거나(리뷰 50개 미만) 상품 수가 극단적으로 많아(200개 이상, 이미 레드오션) 신규 진입이 무의미한 카테고리는 제외하세요.
- reason에는 반드시 실제 수치(리뷰수, 상품수, 가격대)를 인용해서 왜 이 카테고리가 지금 유망한지 설명하세요. "~일 것 같다" 같은 추측이 아니라 데이터로 뒷받침하세요.
- 후보 순서를 시장성이 좋은 순서대로 재배열하세요.

category는 반드시 후보 목록에 있는 문자열과 정확히 동일해야 합니다 (지어내지 마세요).

반드시 아래 JSON 배열 형식으로만 응답하세요:
[{ "category": "후보 목록의 카테고리명 그대로", "reason": "실데이터 근거 (2~3문장)" }]`;

  const cleaned = await callClaude(prompt);
  try {
    return parseJsonArray(cleaned);
  } catch {
    throw new Error('AI 응답을 해석하지 못했어요. 다시 시도해주세요.');
  }
}

export interface CandidateKeyword {
  ko: string; // 쿠팡 검색용 한글 키워드
  en: string; // 알리바바 검색용 영문 키워드
}

// 2단계 - 1차: 선택된 카테고리를 실제로 쿠팡에서 검색해서 커버할 "검색
// 관점(facet)"을 뽑는다. 여기서 나오는 건 "추천 상품"이 아니라 그냥
// 검색어일 뿐이다 - 진짜 상품 판단은 이 검색으로 나온 실제 목록을
// 놓고 3단계(finalizeProductRecommendations)에서 한다.
export async function suggestCandidateKeywords(input: {
  category: string;
  season: Season;
}): Promise<CandidateKeyword[]> {
  const prompt = `당신은 1인 이커머스 셀러의 소싱 컨설턴트입니다.

카테고리: "${input.category}"
시즌 조건: "${SEASON_LABEL[input.season]}" — ${SEASON_RULE[input.season]}

${SOURCING_EXCLUSION_RULE}

이 카테고리를 쿠팡에서 실제로 검색해서 폭넓게 커버하고 싶습니다. 서로 다른 하위 유형을 대표하는 **검색어** 4개를 뽑아주세요 (예를 들어 카테고리가 "욕실 정리용품"이면 "수건걸이", "샴푸 디스펜서", "코너 선반", "칫솔꽂이"처럼 카테고리 안의 서로 다른 하위 유형).

**중요**: ko 키워드는 사람들이 쿠팡에 실제로 검색할 법한 **짧고 단일한** 검색어여야 합니다 (2~4단어). "A + B", "A·B", "A/B" 처럼 여러 상품을 조합하거나 나열한 키워드는 절대 만들지 마세요 — 이런 건 실제 검색 결과가 거의 안 나옵니다.

각 검색어마다 두 가지 버전이 필요합니다:
- ko: 쿠팡/네이버쇼핑에 실제로 검색할 한글 키워드 (예: "목걸이선풍기", "캠핑 랜턴", "욕실 수건걸이")
- en: 같은 걸 alibaba.com에서 검색할 영문 키워드 (예: "neck fan", "camping lantern", "bathroom towel rack")

반드시 아래 JSON 배열 형식으로만 응답하세요:
[{ "ko": "한글키워드", "en": "english keyword" }]`;

  const cleaned = await callClaude(prompt);
  try {
    return parseJsonArray(cleaned);
  } catch {
    throw new Error('AI 응답을 해석하지 못했어요. 다시 시도해주세요.');
  }
}

export interface KeywordFinding {
  keyword: string;
  productListText: string; // 실제 검색된 상품 목록 (여러 줄, 상품명+리뷰수+가격)
  hasData: boolean;
}

export interface ProductRecommendationDraft {
  keyword: string; // 어느 검색어에서 나왔는지 (badge/facet 조회용)
  representativeProductName: string; // 실제 목록에 있는 상품명 그대로 - "진짜 메인 상품"
  displayName: string;
  reason: string;
  criteria: {
    demand: string; // 쿠팡 실데이터 근거 (리뷰수/순위 등 구체적으로)
    competition: string; // 경쟁 강도 + 차별화/진입 전략
    seasonality: string;
  };
  caution: string;
}

// 2단계 - 2차: 검색어별로 실제 쿠팡에서 나온 진짜 상품 목록을 통째로
// 주고, 그 안에서 "진짜 메인 상품"을 골라내게 한다 - AI가 상품을
// 지어내는 게 아니라 실제 검색 결과 중에서 선택하는 것. 링크/가격 같은
// 사실 데이터는 코드에서 정확히 일치하는 상품명으로 다시 찾아서 붙인다.
export async function finalizeProductRecommendations(input: {
  category: string;
  season: Season;
  findings: KeywordFinding[];
}): Promise<ProductRecommendationDraft[]> {
  const { category, season, findings } = input;

  const findingsText = findings
    .map((f) => `\n[검색어 "${f.keyword}"의 실제 쿠팡 판매량순 검색 결과]\n${f.productListText}`)
    .join('\n');

  const prompt = `당신은 1인 이커머스 셀러의 소싱 컨설턴트입니다. 아래는 지어낸 게 아니라 실제로 쿠팡에서 검색해서 나온 진짜 상품 목록입니다 (다른 셀러 포함 시장 전체 데이터).
${findingsText}

카테고리: "${category}" / 시즌 조건: "${SEASON_LABEL[season]}"

**당신의 임무는 후보를 지어내는 게 아니라, 위 실제 목록 중에서 소싱할 가치가 있는 "진짜 메인 상품"을 찾아내는 것입니다.** 같은 상품의 색상/사이즈만 다른 변형은 하나로 묶고, 서로 다른 상품 유형 **최대 3개**만 엄선하세요 (많이 나열하지 말고 가장 유망한 것만 압축해서 고르세요).

**주의**: 검색 결과에는 검색어와 무관한 상품(광고/추천 알고리즘으로 섞여 들어온 다른 카테고리 상품)이 섞여 있을 수 있습니다. 카테고리 "${category}"와 명백히 관련 없는 상품(예: 가구/수납 카테고리에 전자기기가 섞여 있는 경우 등)은 절대 고르지 마세요.

**중요한 판단 기준**: "판매량순 1위"는 최근 판매 속도 기준이라 리뷰가 가장 많은 상품이 아닐 수 있습니다. 시장 규모는 각 검색어 목록 내 "리뷰 최다 상품"의 리뷰수 절대값으로 판단하세요:
- 리뷰 3,000개 이상: 매우 큰 검증된 시장 / 1,000~3,000개: 확실한 수요 / 300~1,000개: 중간 규모 / 50~300개: 니치 시장 / 50개 미만: 시장이 거의 없음 — 이 경우 caution에 명확히 경고하세요.

**당신은 전문 소싱 컨설턴트로서 표면적인 "리뷰 많다/적다" 수준을 넘어서 분석해야 합니다**:
- 데이터가 있는 검색어는 웬만하면 다 활용하세요 (약해도 caution으로 경고하며 포함). "쿠팡 조회 실패/데이터 없음"인 검색어만 건너뛰세요. 전부 데이터 없으면 빈 배열을 반환하세요.
- reason과 criteria는 단순 숫자 나열이 아니라, 그 숫자가 시사하는 시장 해석(왜 이 규모인지, 진입 타이밍이 왜 지금인지, 어떤 소비자 니즈를 반영하는지)까지 설명하세요.
- criteria.competition에는 목록의 상품 개수/가격 분포를 보고 경쟁 강도를 판단하고, 구체적인 차별화/진입 전략(가격/디자인/기능/번들 등)을 제시하세요.

**액체/젤/스프레이형 제품, 화장품, 식품, 리튬배터리 내장 전자기기는 통관/위험물 규제 문제로 소싱이 어려우니 목록에 있어도 고르지 마세요.**

representativeProductName은 반드시 위 목록에 실제로 있는 상품명과 **정확히 동일한 문자열**이어야 합니다 (지어내거나 요약하지 마세요). keyword는 그 상품이 어느 검색어 목록에서 나왔는지 표시하세요.

반드시 아래 JSON 배열 형식으로만 응답하세요:
[
  {
    "keyword": "그 상품이 나온 검색어",
    "representativeProductName": "위 목록에 있는 실제 상품명 그대로",
    "displayName": "고객에게 보여줄 상품명 (더 자연스럽게 다듬어도 됨)",
    "reason": "왜 이걸 추천하는지, 시장 해석 포함 (2~3문장)",
    "criteria": {
      "demand": "쿠팡 실데이터 근거 + 그게 의미하는 수요 해석 (구체적 수치 인용)",
      "competition": "경쟁 강도 판단 + 구체적인 차별화/진입 전략",
      "seasonality": "지금 시기/계절성 근거"
    },
    "caution": "소싱/판매 시 주의할 점 (1~2문장)"
  }
]`;

  const cleaned = await callClaude(prompt);
  try {
    return parseJsonArray(cleaned);
  } catch {
    throw new Error('AI 응답을 해석하지 못했어요. 다시 시도해주세요.');
  }
}

export interface KnowledgeFallbackItem {
  item: string;
  reason: string;
  caution: string;
}

// 쿠팡 스크래핑이 (캡차 차단 등으로) 전부 실패했을 때 쓰는 안전장치.
// 실시간 데이터 없이 완전히 빈 결과를 보여주는 것보다는, AI의 일반
// 지식으로라도 추천하는 게 낫다 - 대신 UI에서 "실데이터 아님"을
// 명확히 표시해야 한다.
export async function recommendFromKnowledgeOnly(
  category: string,
  season: Season
): Promise<KnowledgeFallbackItem[]> {
  const prompt = `당신은 1인 이커머스 셀러(쿠팡 로켓그로스, 중국 알리바바에서 소싱)의 소싱 컨설턴트입니다.

카테고리: "${category}" / 시즌 조건: "${SEASON_LABEL[season]}" — ${SEASON_RULE[season]}

${SOURCING_EXCLUSION_RULE}

지금 실시간 데이터 조회에 실패해서, 당신의 일반 지식(계절성, 최근 몇 년간 한국 이커머스 트렌드)만으로 이 카테고리 안에서 소싱하기 좋은 **구체적인 상품** 3~4개를 추천해주세요.

반드시 아래 JSON 배열 형식으로만 응답하세요:
[
  {
    "item": "구체적인 상품명",
    "reason": "왜 지금 이 상품을 추천하는지 (2~3문장)",
    "caution": "소싱/판매 시 주의할 점 (1~2문장)"
  }
]`;

  const cleaned = await callClaude(prompt);
  return parseJsonArray(cleaned) as KnowledgeFallbackItem[];
}

// 2단계 - 3차: 최종 확정된 상품의 "실제 쿠팡 1위 상품명"을 보고 알리바바
// 검색어를 다시 만든다. 카테고리 단계에서 미리 만든 일반적인 영어
// 키워드로는 실제로 잘 팔리는 상품의 구체적인 소재/디자인/기능이 반영이
// 안 되므로, 진짜 쿠팡에서 팔리는 상품과 연관도 높은 알리바바 후보를
// 찾기 위해 이 단계를 추가함.
export async function refineAlibabaSearchTerms(
  items: { keyword: string; topCoupangProductName: string }[]
): Promise<Record<string, string>> {
  if (items.length === 0) return {};

  const prompt = `당신은 소싱 컨설턴트입니다. 아래는 쿠팡에서 실제로 잘 팔리고 있는 상품명들입니다. 각각에 대해, 이 상품과 최대한 비슷한 소재/디자인/기능을 가진 제품을 alibaba.com에서 찾기 위한 **영문 검색어**를 만들어주세요.

브랜드명/한글 표기는 빼고, 상품의 핵심 특징(소재, 형태, 기능, 단수/다단 등)을 반영한 3~6단어 영문 검색어로 만드세요. 너무 일반적인 검색어(예: "shelf")가 아니라, 실제 이 상품과 매칭될 만한 구체성을 가져야 합니다.

${items.map((it, i) => `${i + 1}. 키워드: "${it.keyword}" / 쿠팡 실제 상품명: "${it.topCoupangProductName}"`).join('\n')}

반드시 아래 JSON 배열 형식으로만 응답하세요 (원문 순서 유지, 총 ${items.length}개):
[{ "keyword": "위 키워드 그대로", "searchTerm": "영문 검색어" }]`;

  const cleaned = await callClaude(prompt);
  try {
    const parsed = parseJsonArray(cleaned) as { keyword: string; searchTerm: string }[];
    return Object.fromEntries(parsed.map((p) => [p.keyword, p.searchTerm]));
  } catch {
    return {}; // 실패하면 호출부에서 기존 영문 키워드로 폴백
  }
}

// 알리바바 상품명은 영문(가끔 다른 언어)이라 원문과 함께 한글 번역을
// 보여주기 위해 씀. 여러 개를 한 번에 배치 번역해서 호출을 아낀다.
export async function translateProductNames(names: string[]): Promise<string[]> {
  if (names.length === 0) return [];

  const prompt = `아래 상품명들을 자연스러운 한국어로 번역해주세요. 원문 순서를 그대로 유지하고, 각 항목은 배열의 같은 인덱스에 대응해야 합니다.

${names.map((n, i) => `${i + 1}. ${n}`).join('\n')}

반드시 아래 JSON 배열 형식으로만 응답하세요 (번역문 문자열만, 총 ${names.length}개): ["번역1", "번역2", ...]`;

  const cleaned = await callClaude(prompt);
  try {
    const result = JSON.parse(cleaned);
    if (Array.isArray(result) && result.length === names.length) return result;
    return names; // 개수가 안 맞으면 원문 그대로 폴백
  } catch {
    return names;
  }
}

export interface SalesStrategyInput {
  title: string;
  price: number | null;
  cost: number | null;
  marginProfit: number | null;
  marginPct: number | null;
  feeRatePct: number | null; // 저장된 coupang_fee로부터 역산한 수수료율
  adRatePct: number | null; // 저장된 ad_cost로부터 역산한 광고비율
  marketSummary: string; // 실제 쿠팡 검색 결과 요약 (analyzeCoupangResults 스타일)
  marketVerdict: string; // 뱃지 기반으로 이미 계산된 한줄 결론
  comparisonSummary: string | null; // 비교 상품군/공급처에 입력해둔 데이터 요약
}

export interface SalesStrategyResult {
  pricingStrategy: string;
  reviewStrategy: string;
  adStrategy: string;
  channelStrategy: string;
  differentiation: string;
}

// "판매" 대분류의 첫 기능 - 이미 확보한 실데이터(쿠팡 시장 위치) +
// 사용자가 입력해둔 마진/공급처/비교 상품군 데이터를 근거로, 이 상품을
// 구체적으로 "어떻게 팔지/어떻게 광고를 태울지" 결론까지 내려준다.
// 새로 데이터를 수집하지 않고 이미 있는 걸 최대한 재사용한다.
export async function generateSalesStrategy(input: SalesStrategyInput): Promise<SalesStrategyResult> {
  const marginText =
    input.price != null
      ? `판매가 ${input.price.toLocaleString()}원, 원가 ${input.cost?.toLocaleString() ?? '미입력'}원, 마진 ${
          input.marginProfit != null ? input.marginProfit.toLocaleString() + '원' : '계산불가'
        }${input.marginPct != null ? ` (${input.marginPct.toFixed(1)}%)` : ''}, 쿠팡수수료율 ${
          input.feeRatePct != null ? input.feeRatePct.toFixed(1) + '%' : '미입력'
        }, 현재 설정된 광고비율 ${input.adRatePct != null ? input.adRatePct.toFixed(1) + '%' : '미입력'}`
      : '판매가/원가 미입력 (마진 계산 불가)';

  const prompt = `당신은 1인 이커머스 셀러(쿠팡 로켓그로스, 네이버도 같이 판매)의 판매 전략 컨설턴트입니다.

상품명: "${input.title}"

[내 상품의 원가/마진 구조]
${marginText}

[실제 쿠팡 시장 조회 결과 - "${input.title}"로 검색한 실데이터]
${input.marketSummary}
결론: ${input.marketVerdict}

[내가 직접 조사해둔 공급처/경쟁 상품 비교 데이터]
${input.comparisonSummary || '(아직 입력한 비교 데이터 없음)'}

위 실데이터를 근거로, 이 상품을 **지금 이 시장 위치에서 구체적으로 어떻게 팔아야 하는지** 판매 전략을 세워주세요. 추측이 아니라 위에 주어진 숫자(마진, 리뷰수, 경쟁강도, 가격대)를 직접 인용해서 근거를 대야 합니다.

반드시 아래 JSON 객체 형식으로만 응답하세요 (각 항목 2~4문장):
{
  "pricingStrategy": "가격 전략 - 런칭가를 얼마로 잡을지, 초반 쿠폰/할인이 필요한지, 마진 구조상 가격을 더 내릴 여유가 있는지",
  "reviewStrategy": "리뷰 확보 전략 - 경쟁 상품 리뷰 규모 대비 초반에 얼마나 공격적으로 리뷰를 쌓아야 하는지, 구체적 방법",
  "adStrategy": "광고 운영 전략 - 현재 광고비율이 이 경쟁강도에 적정한지, 어떤 키워드/시점에 얼마나 태워야 하는지",
  "channelStrategy": "채널 우선순위 - 쿠팡/네이버 중 지금 어디에 먼저 집중해야 하는지와 이유",
  "differentiation": "차별화 포인트 - 원가/공급처 경쟁력이나 경쟁 상품 대비 내세울 수 있는 지점"
}`;

  const cleaned = await callClaude(prompt);
  return parseJsonObject(cleaned) as SalesStrategyResult;
}

export type DetailLayoutStyle = 'white' | 'overlay' | 'typography';
export type DetailTheme = 'dark' | 'purple' | 'light';

export interface DetailCopyRecommendation {
  keyword: string;
  mood: string;
  eyebrow: string;
  description: string;
  accentTitle: string;
  accentSubtitle: string;
  stat: string;
  statCaption: string;
  badge: string;
  bodyText: string;
  listItems: string;
  layoutStyle: DetailLayoutStyle;
  theme: DetailTheme;
}

// "상세페이지 제작" - 섹션 입력칸(키워드/분위기/문구/브랜드명/통계 +
// 레이아웃/테마)을 사용자가 하나씩 채우는 대신 AI가 한 번에 초안을
// 만들어준다. 원본 사진 OCR 결과(있으면)와 프로젝트명, 이미 입력해둔
// 내용을 참고자료로 준다 - 비전 모델이 아니라 텍스트 모델이라 사진을
// 직접 보진 못하지만, OCR로 뽑은 원문/번역문이 사진 속 실제 셀링
// 포인트를 담고 있어서 이것만으로도 꽤 구체적인 카피가 나온다.
export async function recommendDetailSectionCopy(input: {
  productName: string;
  extractedText: string; // OCR 원문+번역 (없으면 빈 문자열)
  existingHints: string; // 사용자가 이미 입력해둔 키워드/문구 (있으면 참고, 없으면 빈 문자열)
}): Promise<DetailCopyRecommendation> {
  const prompt = `당신은 쿠팡 상세페이지 카피라이터입니다. 아래 상품의 상세페이지 섹션 하나에 들어갈 문구와 디자인 스타일을 추천해주세요.

상품명: "${input.productName || '(제목 없음)'}"
${input.extractedText ? `원본(1688) 사진에 있던 셀링 포인트 문구 (원문/번역):\n${input.extractedText}\n` : ''}${input.existingHints ? `사용자가 이미 입력해둔 참고 내용:\n${input.existingHints}\n` : ''}
이 섹션은 아래 계층 구조로 구성됩니다 (전부 채울 필요 없음 - 상품 성격에 안 맞으면 빈 문자열로 남겨도 됨):
- eyebrow: 헤드라인 위에 작게 들어갈 감성적인 문구 (1줄, 선택)
- description: 메인 헤드라인 - 가장 굵고 크게 나오는 핵심 문구 (필수, 1~2줄 분량)
- accentTitle: 영문 브랜드/제품명 스타일 문구 (선택, 상품에 브랜드성이 없으면 빈 문자열)
- accentSubtitle: accentTitle의 한글 표기 (accentTitle을 채웠으면 같이 채움)
- stat: 강조할 숫자/통계 (선택, 예: "50% 할인", "리뷰 1,200+", 없으면 빈 문자열)
- statCaption: stat 아래에 붙는 짧은 설명 (stat을 채웠을 때만)
- badge: 헤드라인 아래 작은 뱃지/인증 문구 (선택, 예: "특허출원 신개념 처방", 없으면 빈 문자열)
- bodyText: 스토리텔링/비교형 문단 카피 - 줄바꿈(\n)으로 2~4줄 구분 (선택, 없으면 빈 문자열)
- listItems: 번호 매김 피처 리스트 - 줄바꿈(\n)으로 구분된 3~5개 짧은 문장 (선택, 없으면 빈 문자열). bodyText와 listItems는 보통 둘 중 하나만 채우세요.
- keyword: AI가 배경 사진을 새로 생성/편집할 때 참고할 상황 키워드 (예: "원룸 현관")
- mood: 배경 이미지의 분위기 (예: "따뜻한 우드톤 조명")

레이아웃/테마도 상품 성격에 맞게 골라주세요:
- layoutStyle: "white"(사진+흰 문구 섹션 분리 - 기능성/실용 상품에 무난), "overlay"(사진 위 그라데이션+문구 - 라이프스타일/감성 상품), "typography"(사진 없이 그라데이션 배경+문구만 - 브랜드/무드 강조용, stat/badge/bodyText/listItems 위주 섹션에 적합)
- theme: "dark"(무난한 블랙), "purple"(고급스러운 톤), "light"(밝고 화사한 톤)

문구는 실제 쿠팡 상세페이지에 바로 써도 될 만큼 자연스럽고 설득력 있는 한국어로 작성하세요. 과장 광고나 근거 없는 최상급 표현은 피하세요.

반드시 아래 JSON 객체 형식으로만 응답하세요:
{
  "keyword": "...", "mood": "...", "eyebrow": "...", "description": "...",
  "accentTitle": "...", "accentSubtitle": "...", "stat": "...", "statCaption": "...",
  "badge": "...", "bodyText": "...", "listItems": "...",
  "layoutStyle": "white|overlay|typography", "theme": "dark|purple|light"
}`;

  const cleaned = await callClaude(prompt);
  const parsed = parseJsonObject(cleaned) as Partial<DetailCopyRecommendation>;
  return {
    keyword: parsed.keyword || '',
    mood: parsed.mood || '',
    eyebrow: parsed.eyebrow || '',
    description: parsed.description || '',
    accentTitle: parsed.accentTitle || '',
    accentSubtitle: parsed.accentSubtitle || '',
    stat: parsed.stat || '',
    statCaption: parsed.statCaption || '',
    badge: parsed.badge || '',
    bodyText: parsed.bodyText || '',
    listItems: parsed.listItems || '',
    layoutStyle: (['white', 'overlay', 'typography'] as const).includes(parsed.layoutStyle as any)
      ? (parsed.layoutStyle as DetailLayoutStyle)
      : 'white',
    theme: (['dark', 'purple', 'light'] as const).includes(parsed.theme as any)
      ? (parsed.theme as DetailTheme)
      : 'dark',
  };
}

export interface SourcingZhTranslation {
  casual: string;
  formal: string;
}

// 1688/알리바바 공장 담당자와의 실제 채팅(웨이신 등)에서 바로 쓸 수
// 있는 번역을 만든다 - 구글 번역 같은 직역이 아니라 비즈니스 바이어
// 말투로 다듬는다. 여러 줄/여러 조건이 섞여 있으면(예: 체크리스트에서
// 고른 항목 여러 개) 번호를 매기거나 자연스럽게 하나의 메시지로
// 엮어서 정리해준다 - 그래서 소싱 체크리스트의 "선택 항목 메시지
// 생성" 기능도 이 함수를 그대로 재사용한다.
export async function translateToChineseForSourcing(koreanText: string): Promise<SourcingZhTranslation> {
  const prompt = `당신은 중국 1688/알리바바 공급업체와 소싱 비즈니스 채팅(웨이신/1688 메신저)을 하는 한국인 바이어를 돕는 번역가입니다.

아래 한국어 메시지를 중국어로 번역해주세요. 공장 담당자와의 실제 채팅에서 바로 쓸 문장이니, 직역이 아니라 자연스럽고 매끄러운 비즈니스 중국어로 다듬어주세요. 여러 줄이나 여러 조건이 나열되어 있으면, 번호를 매기거나 자연스럽게 이어서 하나의 정리된 메시지로 구성해주세요. 숫자·제품 사양·금액·주문번호·고유명사는 정확히 그대로 보존하세요.

번역할 한국어:
"""
${koreanText}
"""

두 가지 톤으로 각각 번역해주세요:
- casual: 이미 대화를 이어오던 상대에게 편하게 쓰는, 예의 바른 비즈니스 채팅 톤
- formal: 처음 조건을 정리해서 보내거나 좀 더 격식을 차려야 할 때 쓰는 정중한 톤

반드시 아래 JSON 객체 형식으로만 응답하세요:
{ "casual": "...", "formal": "..." }`;

  const cleaned = await callClaude(prompt);
  const parsed = parseJsonObject(cleaned) as Partial<SourcingZhTranslation>;
  return { casual: parsed.casual || '', formal: parsed.formal || '' };
}

// 공장 담당자가 보내온 중국어 답장을 자연스러운 한국어로 - 숫자/금액/
// 주문번호 등은 그대로 보존.
export async function translateToKoreanForSourcing(chineseText: string): Promise<string> {
  const prompt = `당신은 중국 1688/알리바바 공급업체 담당자가 보낸 중국어 메시지를, 소싱하는 한국인 바이어에게 번역해주는 번역가입니다.

아래 중국어 메시지를 자연스러운 한국어로 번역해주세요. 배송/통관/결제 같은 비즈니스 용어는 정확하게, 숫자·금액·주문번호·고유명사는 그대로 보존해주세요.

번역할 중국어:
"""
${chineseText}
"""

반드시 아래 JSON 객체 형식으로만 응답하세요:
{ "translation": "..." }`;

  const cleaned = await callClaude(prompt);
  const parsed = parseJsonObject(cleaned) as { translation?: string };
  return parsed.translation || '';
}


// ---------------------------------------------------------------------------
// 썸네일 추가 이미지용 한국어 문구
// ---------------------------------------------------------------------------
// 이미지 속 글자는 AI가 그리면 깨지므로, 여기서는 문구만 만들고 실제 글자는
// 서버에서 폰트로 합성한다 (lib/styledThumbnail.ts). 쿠팡 광고/표시 심의에
// 걸리기 쉬운 최상급·의학적 표현과, 상품명에 근거 없는 소재/수치 단정은
// 막는다 - AI가 사실과 다른 스펙을 지어내는 게 가장 위험하기 때문이다.
//
// 컷의 레이아웃에 따라 필요한 문구가 다르다:
//   caption: 헤드라인 + 보조문구 한 줄
//   bullets: 헤드라인 + 짧은 포인트 3개 (체크 목록)
//   badge:   헤드라인 + 모서리 배지(6자 이내)
export type CopyLayout = 'caption' | 'bullets' | 'badge';

export interface ThumbnailCopy {
  shotId: string;
  headline: string;
  sub: string;
  points: string[];
  badge: string;
}

const BANNED_COPY = /(최고|1\s*등|1\s*위|최저가|국내\s*유일|세계\s*최초|완벽|100\s*%|무조건|보장|치료|예방|의학|특허|인증)/;

const clean = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// 금지어가 들어간 항목은 고치지 않고 버린다. 헤드라인이 비거나 금지어면 fallbackHeadline을
// 쓰는데, 내부용 컷 이름 같은 걸 넣으면 고객에게 그대로 노출되므로 빈 문자열을 넘기고
// (= 문구 없는 이미지) 쓰는 쪽이 그렇게 처리한다.
export function sanitizeThumbnailCopy(
  c: Partial<ThumbnailCopy>,
  fallbackHeadline: string
): { headline: string; sub: string; points: string[]; badge: string } {
  let headline = clean(c.headline, 18);
  if (!headline || BANNED_COPY.test(headline)) headline = fallbackHeadline;
  let sub = clean(c.sub, 30);
  if (BANNED_COPY.test(sub)) sub = '';
  const points = (Array.isArray(c.points) ? c.points : [])
    .map((p) => clean(p, 16))
    .filter((p) => p && !BANNED_COPY.test(p))
    .slice(0, 3);
  let badge = clean(c.badge, 8);
  if (BANNED_COPY.test(badge)) badge = '';
  return { headline, sub, points, badge };
}

export async function generateThumbnailCopies(input: {
  productName: string;
  category: string;
  sellingPoints: string[];
  shots: { id: string; title: string; layout: CopyLayout }[];
}): Promise<ThumbnailCopy[]> {
  if (input.shots.length === 0) return [];
  const prompt = `쿠팡에 올릴 상품의 "추가 이미지" 위에 얹을 한국어 문구를 컷마다 만들어주세요.

상품명: ${input.productName || input.category}
카테고리: ${input.category}
이 카테고리 인기상품이 공통으로 강조하는 키워드(참고용, 이 상품에 해당하는지는 확인 안 됨): ${input.sellingPoints.join(', ') || '(없음)'}

컷 목록 (레이아웃별로 필요한 항목이 다릅니다):
${input.shots.map((s) => `- ${s.id}: ${s.title} [레이아웃: ${s.layout}]`).join('\n')}

레이아웃별 작성 규칙:
- caption: headline(12자 이내)과 sub(22자 이내 보조 문구, 비워도 됨)
- bullets: headline(12자 이내)과 points(짧은 장점 문구 3개, 각 14자 이내)
- badge: headline(12자 이내), sub(22자 이내, 비워도 됨), badge(6자 이내의 짧은 강조 단어)

공통 규칙:
- 컷의 성격에 맞는 문구를 쓰세요 (예: 디테일 컷이면 마감/촉감, 정리 컷이면 보관/사용 편의).
- **상품명에 근거가 없는 소재·기능·수치·인증은 절대 쓰지 마세요.** (예: 상품명에 "면"이 없는데 "순면", "냉감"이 없는데 "냉감", 임의의 %, 인증 문구 금지) 참고용 키워드도 상품명이나 컷 성격에서 확실히 뒷받침될 때만 쓰세요. 애매하면 "편안한 착용감", "깔끔한 마감"처럼 누구에게나 맞는 일반적인 표현을 쓰세요.
- 최상급·과장·의학적 표현 금지: 최고, 1등, 1위, 최저가, 국내유일, 완벽, 100%, 무조건, 보장, 치료, 예방, 특허, 인증.
- 컷마다 서로 다른 문구여야 합니다. 같은 표현("정교한 마감" 등)을 반복하지 마세요.
- 해당 레이아웃에 쓰지 않는 항목은 빈 값("" 또는 [])으로 두세요.

JSON 배열로만 응답하세요:
[{"shotId":"컷 id 그대로","headline":"...","sub":"...","points":["..."],"badge":"..."}]`;

  const text = await callClaude(prompt);
  const arr = parseJsonArray(text);
  return arr
    .filter((x) => x && typeof x.shotId === 'string')
    .map((x) => ({
      shotId: String(x.shotId),
      headline: String(x.headline || ''),
      sub: String(x.sub || ''),
      points: Array.isArray(x.points) ? x.points.map((p: unknown) => String(p ?? '')) : [],
      badge: String(x.badge || ''),
    }));
}


// ---------------------------------------------------------------------------
// 상세페이지 자동 구성: 사진 분석 + 쿠팡 인기상품 흐름 + 취급 옵션 -> 장면(섹션) 목록
// ---------------------------------------------------------------------------
// 결과(raw)는 그대로 쓰지 않고 lib/detailOptions.ts의 finalizePlan이 한 번 더
// 검사한다 (취급하지 않는 색상/사이즈 표현, 못 쓰는 사진 지정 등을 코드로 거른다).
export async function planDetailSectionsRaw(input: {
  productName: string;
  category: string;
  flow: {
    summary: string;
    tone: string;
    sellingPoints: string[];
    flow: { title: string; purpose: string; note: string }[];
  };
  selling: { colors: string[]; sizes: string[] };
  photos: {
    index: number;
    role: string;
    description: string;
    koreanTexts: string[];
    facts: string[];
    colorLabel: string | null;
    colorsShown: string[];
    usable: boolean;
    reason: string | null;
    hasSizeChart: boolean;
  }[];
  templates: { id: string; use: string; needsPhoto: boolean }[];
  maxSections: number;
}): Promise<any[]> {
  const { selling } = input;
  const colorLine = selling.colors.length
    ? `${selling.colors.join(', ')} (${selling.colors.length}가지)`
    : '입력 안 함 - 색상은 언급하지 마세요';
  const sizeLine = selling.sizes.length
    ? `${selling.sizes.join(', ')} (${selling.sizes.length}가지)`
    : '입력 안 함 - 사이즈는 언급하지 마세요';

  const photoLines = input.photos
    .map((p) => {
      const head = `사진 ${p.index + 1}번 [${p.usable ? '사용 가능' : '사용 불가: ' + p.reason}] 종류=${p.role}${
        p.colorLabel ? ` / 색상=${p.colorLabel}` : ''
      }${p.hasSizeChart ? ' / 사이즈표 있음' : ''}`;
      const body = [
        p.description && `  내용: ${p.description}`,
        p.facts.length ? `  확인된 사실: ${p.facts.join(' | ')}` : '',
        p.koreanTexts.length ? `  사진 속 문구(번역): ${p.koreanTexts.slice(0, 8).join(' | ')}` : '',
        p.colorsShown.length ? `  사진에 보이는 색상: ${p.colorsShown.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      return `${head}\n${body}`;
    })
    .join('\n');

  const prompt = `당신은 쿠팡 상세페이지 기획자입니다. 중국 상품 사진을 분석한 내용과 쿠팡 인기상품 상세페이지의 흐름을 참고해서, 이 상품의 상세페이지를 "장면(섹션) 목록"으로 기획하세요.

[상품] ${input.productName || input.category} (카테고리: ${input.category || '미입력'})

[쿠팡 인기상품 상세페이지 흐름 - 이 순서와 역할을 최대한 따르세요]
요약: ${input.flow.summary}
어조: ${input.flow.tone || '(없음)'}
인기상품이 공통으로 강조하는 키워드(참고용, 이 상품에 해당하는지는 사진으로 확인될 때만): ${input.flow.sellingPoints.join(', ') || '(없음)'}
${input.flow.flow.map((s, i) => `${i + 1}. ${s.title} - ${s.purpose} (${s.note})`).join('\n')}

[내가 실제로 판매하는 옵션]
- 색상: ${colorLine}
- 사이즈: ${sizeLine}

⚠ 가장 중요한 규칙 (어기면 허위 표시가 됩니다):
- 중국 사진에는 위보다 훨씬 많은 색상·사이즈가 나올 수 있지만, 나는 **위 옵션만** 판매합니다. 위에 없는 색상·사이즈는 문구·키워드·분위기·사양표 어디에도 절대 쓰지 마세요.
- "N가지 색상", "N가지 사이즈"처럼 개수를 말할 때는 위에 적힌 개수와 정확히 같아야 합니다. 확신이 없으면 개수를 말하지 마세요.
- 색상 이름을 문구에 쓸 때도 위 색상만 쓰세요. 색상을 바꾸는 지시(colorPrompt)는 쓰지 말고 빈 문자열로 두세요.
- "사용 불가"로 표시된 사진은 sourceIndex로 지정하지 마세요. 그 사진에서도 소재·기능 같은 **사실 정보**는 참고해도 되지만 색상 정보는 쓰지 마세요.

[사진 분석 결과 (번호는 1부터)]
${photoLines || '(첨부된 사진 없음)'}

[쓸 수 있는 템플릿 - templateId는 아래 중에서만]
${input.templates.map((t) => `- ${t.id}: ${t.use}${t.needsPhoto ? ' [사진 필요 → sourceIndex 지정]' : ' [사진 없음]'}`).join('\n')}

기획 규칙:
- 장면은 최대 ${input.maxSections}개. 쿠팡 인기상품 흐름 순서를 따르되, 내 사진에서 확인되는 사실이 없는 장면은 만들지 마세요. 첫 장면은 관심을 끄는 훅, 마지막 근처에는 제품 사양표(kind "spec")를 넣으세요.
- 사진이 필요한 템플릿은 sourceIndex에 **사진 번호에서 1을 뺀 0부터의 번호**를 넣으세요. 가능하면 장면마다 다른 사진을 쓰고, 특정 색상 장면은 그 색상 사진을 쓰세요. 사진 없는 템플릿은 sourceIndex를 null로.
- keyword는 이미지 생성용 장면 키워드(배경·연출·확대 정도)이고 **상품의 모양·색을 바꾸는 내용이나 색상 이름은 쓰지 마세요**. mood는 분위기.
- 문구는 한국어, 짧고 구체적으로 (description 헤드라인 18자 이내). **사진에서 확인되지 않는 소재·기능·수치·인증은 쓰지 마세요.** 사진 속 중국어 문구에서 확인된 사실을 근거로 하세요.
- 최상급·과장·의학적 표현 금지: 최고, 1등, 1위, 최저가, 국내유일, 완벽, 100%, 무조건, 보장, 치료, 예방, 특허, 인증.
- 장면마다 서로 다른 문구여야 합니다. 이미 확인된 수치가 없으면 stat-highlight 템플릿은 쓰지 마세요.
- listItems는 문자열 배열(3~4개, 각 14자 이내).
- spec 장면의 specRows는 사진에서 확인된 사실(소재, 원산지, 구성 등)만 label/value로. 색상/사이즈 행은 넣어도 되지만 값은 위 옵션만 쓰세요.

JSON 배열로만 응답하세요. 각 원소는 다음 중 하나:
{"kind":"section","templateId":"...","sourceIndex":0,"purpose":"장면의 역할","fields":{"keyword":"","mood":"","description":"","eyebrow":"","accentTitle":"","accentSubtitle":"","stat":"","statCaption":"","badge":"","bodyText":"","listItems":[],"colorPrompt":""}}
{"kind":"spec","purpose":"제품 사양","specTitle":"제품 사양","specRows":[{"label":"소재","value":"..."}]}`;

  const text = await callClaude(prompt);
  return parseJsonArray(text);
}
