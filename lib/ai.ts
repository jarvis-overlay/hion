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
  const text = json.content?.[0]?.text || '';
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

**시즌 조건 (반드시 지킬 것)**: ${SEASON_RULE[season]}

${SOURCING_EXCLUSION_RULE}

${dataSection}

이 조건에 맞는, 지금 소싱하기 좋은 **카테고리(상품군)** 4~6개를 추천해주세요. "패션의류" 같은 너무 넓은 대분류 말고, "여름 휴대용 냉방 소품" "캠핑 조명용품" 처럼 실제로 무엇을 찾아야 할지 감이 오는 수준의 구체성으로 적어주세요. 단, "A/B", "A·B", "A 및 B" 처럼 서로 다른 상품 여러 개를 하나로 묶은 이름은 절대 쓰지 마세요 — 하나의 일관된 상품군이어야 합니다 (예: "수건걸이/샴푸디스펜서 세트" (X), "선풍기/가습기" (X) → "욕실 정리용품" (O)).

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
시즌 조건: "${SEASON_LABEL[input.season]}" — ${SEASON_RULE[input.season]}

${SOURCING_EXCLUSION_RULE}

이 카테고리 안에서, 위 시즌 조건에 맞는 실제로 검색해볼 만한 **서로 다른 구체적인 상품** 6개를 뽑아주세요 (같은 상품의 변형이 아니라 실제로 다른 상품이어야 함). 브랜드명은 빼고 일반명사로 적어주세요.

**중요**: ko 키워드는 사람들이 쿠팡에 실제로 검색할 법한 **짧고 단일한** 검색어여야 합니다 (2~4단어). "A + B", "A·B", "A/B" 처럼 여러 상품을 조합하거나 나열한 키워드는 절대 만들지 마세요 — 이런 건 실제 검색 결과가 거의 안 나옵니다. 예를 들어 "수건걸이 + 샴푸 디스펜서 세트" (X) 대신 "욕실 수건걸이" (O)와 "샴푸 디스펜서" (O)처럼 각각 별개 후보로 나누세요.

각 상품마다 두 가지 키워드가 필요합니다:
- ko: 쿠팡/네이버쇼핑에 실제로 검색할 한글 키워드, 단일 상품명 (예: "목걸이선풍기", "캠핑 랜턴", "욕실 수건걸이")
- en: 같은 상품을 alibaba.com에서 검색할 영문 키워드 (예: "neck fan", "camping lantern", "bathroom towel rack")

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
  coupangSummary: string; // "리뷰 5,047개, 순위 1위, 50,050원" 같은 요약
  hasAlibaba: boolean;
}

export interface ProductRecommendationDraft {
  keyword: string; // keywordFindings 중 하나의 keyword와 정확히 일치해야 함
  displayName: string;
  reason: string;
  criteria: {
    demand: string; // 쿠팡 실데이터 근거 (리뷰수/순위 등 구체적으로)
    competition: string; // 경쟁 강도 + 차별화/진입 전략
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

**중요한 판단 기준**: 쿠팡 "판매량순 1위"는 최근 판매 속도 기준이라 리뷰가 가장 많은 상품이 아닐 수 있습니다. 시장 규모는 반드시 목록 내 "리뷰 최다 상품"의 리뷰수 절대값으로 판단하세요 (판매량 1위 상품의 리뷰수가 아닙니다):
- 리뷰 3,000개 이상: 매우 큰 검증된 시장
- 리뷰 1,000~3,000개: 확실한 수요
- 리뷰 300~1,000개: 중간 규모, 괜찮은 편
- 리뷰 50~300개: 니치 시장, 신중하게 접근
- 리뷰 50개 미만: 시장 자체가 거의 없다는 뜻 — 검색 결과 1위여도 "수요가 검증됐다"고 쓰면 안 됩니다. caution에 "시장이 매우 작다"고 명확히 경고하세요.

이 실데이터를 근거로 최종 추천을 골라주세요. **당신은 전문 소싱 컨설턴트로서 표면적인 "리뷰 많다/적다" 수준을 넘어서 분석해야 합니다**:
- 데이터가 있는 후보는 웬만하면 다 포함시키세요 (약한 것도 caution으로 경고하며 포함). 한 카테고리에서 상품 하나만 나오는 것보다 여러 개를 폭넓게 보여주는 게 훨씬 유용합니다. 후보 전부가 "쿠팡 조회 실패/데이터 없음"일 때만 빈 배열을 반환하세요.
- reason과 criteria는 단순히 숫자를 나열하지 말고, 그 숫자가 시사하는 시장 해석(왜 이 규모인지, 진입 타이밍이 왜 지금인지, 어떤 소비자 니즈를 반영하는지)까지 설명하세요.
- criteria.competition에는 상품 개수/가격 분포를 보고 경쟁 강도를 판단하고, 어떻게 차별화해서 진입할지 구체적인 전략(가격/디자인/기능/번들 등)을 제시하세요.

**후보 중 액체/젤/스프레이형 제품, 화장품, 식품, 리튬배터리 내장 전자기기가 있다면 통관/위험물 규제 문제로 소싱이 어려우니 제외하세요.**

keyword는 반드시 위 후보 목록에 있는 문자열과 정확히 동일해야 합니다 (지어내지 마세요).

반드시 아래 JSON 배열 형식으로만 응답하세요:
[
  {
    "keyword": "후보 목록의 키워드 그대로",
    "displayName": "고객에게 보여줄 상품명 (키워드보다 자연스럽게)",
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
