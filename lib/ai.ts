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
}): Promise<CategoryRecommendation[]> {
  const { season, contextSummary, excludeCategories = [] } = input;

  const dataSection = contextSummary
    ? `아래는 참고할 실데이터입니다:\n\n${contextSummary}`
    : '(현재 연동된 실시간 데이터는 없습니다. 일반 지식으로 판단해주세요.)';

  const excludeSection =
    excludeCategories.length > 0
      ? `\n**이미 이전에 추천했던 카테고리입니다 - 이것들과 겹치거나 비슷한 카테고리는 절대 다시 추천하지 마세요. 완전히 다른 새로운 카테고리를 찾아주세요**:\n${excludeCategories
          .map((c) => `- ${c}`)
          .join('\n')}\n`
      : '';

  const prompt = `당신은 1인 이커머스 셀러(쿠팡 로켓그로스, 중국 알리바바/1688에서 소싱)의 소싱 컨설턴트입니다.

사용자는 지금 **"${SEASON_LABEL[season]}"** 을 집중적으로 소싱하고 싶어합니다.

**시즌 조건 (반드시 지킬 것)**: ${SEASON_RULE[season]}

${SOURCING_EXCLUSION_RULE}
${excludeSection}
${dataSection}

이 조건에 맞는, 지금 소싱하기 좋은 **카테고리(상품군)** 14~16개를 최대한 다양하게(서로 겹치지 않는 여러 생활 영역에 걸쳐서) 추천해주세요. 시장 규모가 클 것 같은 것부터 작고 틈새인 것까지, 경쟁이 치열할 것 같은 것부터 아직 안 붐빌 것 같은 것까지 골고루 섞어주세요 - 나중에 실데이터로 검증한 뒤 시장규모/경쟁강도 조합별로 걸러서 보여줄 예정이라, 후보 단계에서부터 스펙트럼이 다양해야 합니다. "패션의류" 같은 너무 넓은 대분류 말고, "여름 휴대용 냉방 소품" "캠핑 조명용품" 처럼 실제로 무엇을 찾아야 할지 감이 오는 수준의 구체성으로 적어주세요. 단, "A/B", "A·B", "A 및 B" 처럼 서로 다른 상품 여러 개를 하나로 묶은 이름은 절대 쓰지 마세요 — 하나의 일관된 상품군이어야 합니다 (예: "수건걸이/샴푸디스펜서 세트" (X), "선풍기/가습기" (X) → "욕실 정리용품" (O)).

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
