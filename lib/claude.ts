// Claude API로 네이버 데이터랩 트렌드 데이터를 해석해서 소싱 아이템을
// 자동 추천받기 위한 클라이언트. 비용을 낮게 유지하려고 빠르고 저렴한
// 모델(Haiku)을 쓴다 - 사용자가 버튼 누를 때만 호출되는 저빈도 작업이라
// 굳이 비싼 모델이 필요 없다.

const MODEL = 'claude-haiku-4-5-20251001';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} 환경변수가 설정 안 되어있어요.`);
  return v;
}

export interface SourcingRecommendation {
  item: string;
  category: string;
  reason: string;
  trendNote: string;
  caution: string;
}

export async function recommendSourcingItems(
  categoryTrendSummary: string
): Promise<SourcingRecommendation[]> {
  const apiKey = requireEnv('ANTHROPIC_API_KEY');

  const prompt = `당신은 1인 이커머스 셀러(쿠팡 로켓그로스 위주, 중국 알리/타오바오에서 소싱)의 소싱 컨설턴트입니다.

아래는 네이버 쇼핑인사이트 카테고리별 최근 클릭 트렌드 데이터입니다 (0~100 상대값, 기간 내 전반부 대비 후반부 증감률 포함):

${categoryTrendSummary}

이 데이터와 지금 시기(계절성 포함)를 참고해서, 지금 소싱하면 좋을 만한 **구체적인 상품 아이템** 5개를 추천해주세요. 카테고리명 자체가 아니라 실제로 검색해서 소싱할 수 있는 구체적인 상품명이어야 합니다 (예: "디지털/가전" (X) -> "목걸이 선풍기" (O)).

반드시 아래 JSON 배열 형식으로만 응답하세요. 다른 설명 텍스트는 붙이지 마세요:
[
  {
    "item": "구체적인 상품명",
    "category": "관련 네이버쇼핑 카테고리",
    "reason": "왜 지금 이 아이템을 추천하는지 (트렌드/계절성 근거, 2문장 이내)",
    "trendNote": "관련된 트렌드 데이터 요약 (예: 디지털/가전 최근 8주 +23% 상승)",
    "caution": "소싱/판매 시 주의할 점 (경쟁 심함, 인증 필요 등, 1문장)"
  }
]`;

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
  // 혹시 모델이 코드블록(```json ... ```)으로 감싸서 응답해도 파싱되게 방어
  const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error('AI 응답을 해석하지 못했어요. 다시 시도해주세요.');
  }
}
