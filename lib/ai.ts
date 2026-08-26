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
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message || `Claude API 오류 (HTTP ${res.status})`);
  }
  const text = json.content?.[0]?.text || '';
  return text.replace(/```json\s*|```\s*/g, '').trim();
}

export type Season = 'summer' | 'winter' | 'all';

const SEASON_LABEL: Record<Season, string> = {
  summer: '여름 시즌 상품',
  winter: '겨울 시즌 상품',
  all: '사계절 상품 (계절 안 타는 상품)',
};

export interface CategoryRecommendation {
  category: string;
  reason: string;
}

// 1단계: 시즌 + 우리 판매 데이터/네이버 트렌드(있으면)를 근거로 소싱하기
// 좋은 카테고리 몇 개를 추천한다. 가벼운 호출 (스크래핑 없음).
export async function recommendCategories(input: {
  season: Season;
  contextSummary: string | null;
}): Promise<CategoryRecommendation[]> {
  const { season, contextSummary } = input;

  const dataSection = contextSummary
    ? `아래는 참고할 실데이터입니다:\n\n${contextSummary}`
    : '(현재 연동된 실시간 데이터는 없습니다. 일반 지식으로 판단해주세요.)';

  const prompt = `당신은 1인 이커머스 셀러(쿠팡 로켓그로스, 중국 알리바바/1688에서 소싱)의 소싱 컨설턴트입니다.

사용자는 지금 **"${SEASON_LABEL[season]}"** 을 집중적으로 소싱하고 싶어합니다.

${dataSection}

이 조건에 맞는, 지금 소싱하기 좋은 **카테고리(상품군)** 4~6개를 추천해주세요. "패션의류" 같은 너무 넓은 대분류 말고, "여름 휴대용 냉방 소품" "캠핑 조명용품" 처럼 실제로 무엇을 찾아야 할지 감이 오는 수준의 구체성으로 적어주세요.

반드시 아래 JSON 배열 형식으로만 응답하세요:
[
  { "category": "카테고리명", "reason": "왜 지금 이 카테고리가 유망한지 (1~2문장, 데이터가 있으면 근거로 인용)" }
]`;

  const cleaned = await callClaude(prompt);
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error('AI 응답을 해석하지 못했어요. 다시 시도해주세요.');
  }
}

export interface CandidateKeyword {
  ko: string; // 쿠팡 검색용 한글 키워드
  en: string; // 알리바바 검색용 영문 키워드
}

// 2단계 - 1차: 선택된 카테고리 안에서 실제로 검색해볼 만한 구체적인
// 상품 키워드 후보를 뽑는다 (이후 이 키워드로 쿠팡/알리바바를 실제 조회).
// 쿠팡은 한글, 알리바바는 영문 검색이 필요해서 둘 다 받는다.
export async function suggestCandidateKeywords(input: {
  category: string;
  season: Season;
}): Promise<CandidateKeyword[]> {
  const prompt = `당신은 1인 이커머스 셀러의 소싱 컨설턴트입니다.

카테고리: "${input.category}"
시즌 조건: "${SEASON_LABEL[input.season]}"

이 카테고리 안에서, 실제로 검색해볼 만한 **구체적인 상품** 3개를 뽑아주세요. 브랜드명은 빼고 일반명사로 적어주세요.

각 상품마다 두 가지 키워드가 필요합니다:
- ko: 쿠팡/네이버쇼핑에 실제로 검색할 한글 키워드 (예: "목걸이선풍기", "캠핑 랜턴")
- en: 같은 상품을 alibaba.com에서 검색할 영문 키워드 (예: "neck fan", "camping lantern")

반드시 아래 JSON 배열 형식으로만 응답하세요:
[{ "ko": "한글키워드", "en": "english keyword" }]`;

  const cleaned = await callClaude(prompt);
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error('AI 응답을 해석하지 못했어요. 다시 시도해주세요.');
  }
}

export interface KeywordFinding {
  keyword: string;
  coupangSummary: string; // "리뷰 5,047개, 순위 1위, 50,050원" 같은 요약
  hasAlibaba: boolean;
}

export interface ProductRecommendationDraft {
  keyword: string; // keywordFindings 중 하나의 keyword와 정확히 일치해야 함
  displayName: string;
  reason: string;
  criteria: {
    demand: string; // 쿠팡 실데이터 근거 (리뷰수/순위 등 구체적으로)
    seasonality: string;
  };
  caution: string;
}

// 2단계 - 2차: 실제 쿠팡/알리바바 조회 결과를 근거로 최종 추천을 확정한다.
// 링크/가격 같은 사실 데이터는 AI가 아니라 실제 스크래핑 결과에서 그대로
// 가져다 붙이므로(코드에서 매칭), AI는 keyword를 후보 중에서 정확히
// 골라서 반환하기만 하면 된다 - 링크 환각을 원천 차단.
export async function finalizeProductRecommendations(input: {
  category: string;
  season: Season;
  findings: KeywordFinding[];
}): Promise<ProductRecommendationDraft[]> {
  const { category, season, findings } = input;

  const findingsText = findings
    .map((f) => `- "${f.keyword}": ${f.coupangSummary}`)
    .join('\n');

  const prompt = `당신은 1인 이커머스 셀러의 소싱 컨설턴트입니다.

카테고리: "${category}" / 시즌 조건: "${SEASON_LABEL[season]}"

아래는 후보 키워드별로 쿠팡에서 실제 판매량순 검색을 해본 결과입니다 (다른 셀러 포함 시장 전체 데이터):
${findingsText}

이 실데이터를 근거로, 후보 중에서 소싱할 가치가 있는 것을 모두 골라주세요 (최대 ${findings.length}개, 가치가 없으면 빈 배열도 가능). keyword는 반드시 위 후보 목록에 있는 문자열과 정확히 동일해야 합니다 (지어내지 마세요).

반드시 아래 JSON 배열 형식으로만 응답하세요:
[
  {
    "keyword": "후보 목록의 키워드 그대로",
    "displayName": "고객에게 보여줄 상품명 (키워드보다 자연스럽게)",
    "reason": "왜 이걸 추천하는지 (2문장 이내, 위 실데이터 인용)",
    "criteria": {
      "demand": "쿠팡 실데이터 근거 (리뷰수/가격대 등 구체적 수치 인용)",
      "seasonality": "지금 시기/계절성 근거"
    },
    "caution": "소싱/판매 시 주의할 점 (1문장)"
  }
]`;

  const cleaned = await callClaude(prompt);
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error('AI 응답을 해석하지 못했어요. 다시 시도해주세요.');
  }
}
