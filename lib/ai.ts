// Gemini API로 트렌드/판매 데이터를 해석해서 소싱 아이템을 자동 추천받기
// 위한 클라이언트. Google AI Studio 무료 등급 키를 쓴다 - 사용자가 버튼
// 누를 때만 호출되는 저빈도 작업이라 무료 등급으로 충분하다.

const MODEL = 'gemini-3.6-flash';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} 환경변수가 설정 안 되어있어요.`);
  return v;
}

export interface SourcingRecommendation {
  item: string;
  category: string;
  reason: string;
  criteria: {
    trend: string; // 트렌드/우리 판매 데이터 근거 - 데이터가 없으면 "실시간 데이터 없음"이라고 명시
    seasonality: string; // 지금 시기/계절성 근거
  };
  referenceExamples: string[]; // 시장에 이미 있는 비슷한 상품 예시 2~3개 (참고용, 실시간 검색 아님)
  caution: string;
}

export async function recommendSourcingItems(
  categoryTrendSummary: string | null
): Promise<SourcingRecommendation[]> {
  const apiKey = requireEnv('GEMINI_API_KEY');

  const dataSection = categoryTrendSummary
    ? `아래는 참고할 실데이터입니다 (네이버 쇼핑인사이트 카테고리 트렌드는 0~100 상대값 기준이고, 우리 쿠팡 스토어 판매 데이터는 실제 판매 개수입니다):\n\n${categoryTrendSummary}`
    : `(현재 실시간 트렌드/판매 데이터는 연동되지 않은 상태입니다.)`;

  const prompt = `당신은 1인 이커머스 셀러(쿠팡 로켓그로스 위주, 중국 알리/타오바오에서 소싱)의 소싱 컨설턴트입니다.

${dataSection}

이 데이터(있다면)와 지금 시기(계절성, 월, 다가오는 이벤트/시즌)를 근거로, 지금 소싱하면 좋을 만한 **구체적인 상품 아이템** 5개를 추천해주세요.

규칙:
- 카테고리명 자체가 아니라 실제로 검색해서 소싱할 수 있는 구체적인 상품명이어야 합니다 (예: "디지털/가전" (X) -> "목걸이 선풍기" (O))
- 우리 쿠팡 판매 데이터가 주어졌다면, 지금 잘 팔리는 상품과 연관되거나 함께 팔기 좋은(끼워팔기, 다음 시즌 아이템 등) 것도 적극 고려하세요
- criteria.trend에는 반드시 주어진 데이터에서 뽑은 구체적인 수치/근거를 쓰세요. 데이터가 전혀 없으면 정직하게 "실시간 데이터 없음 - 일반 지식 기반"이라고 쓰세요. 데이터 없이 지어내지 마세요
- criteria.seasonality에는 지금 시기(월, 계절, 다가오는 명절/이벤트)와 이 상품이 왜 지금인지를 구체적으로 쓰세요
- referenceExamples에는 실제로 시장에 존재할 법한 비슷한 상품/브랜드 예시를 2~3개 적어주세요 (당신이 아는 일반 지식 기준이며, 실시간 검색 결과가 아님을 감안해서 판단)

반드시 아래 JSON 배열 형식으로만 응답하세요. 다른 설명 텍스트는 붙이지 마세요:
[
  {
    "item": "구체적인 상품명",
    "category": "관련 네이버쇼핑 카테고리",
    "reason": "왜 지금 이 아이템을 추천하는지 (2문장 이내)",
    "criteria": {
      "trend": "트렌드/판매 데이터 근거 (구체적 수치 포함, 없으면 명시)",
      "seasonality": "계절성/시기 근거"
    },
    "referenceExamples": ["참고 상품/브랜드 예시1", "참고 상품/브랜드 예시2"],
    "caution": "소싱/판매 시 주의할 점 (경쟁 심함, 인증 필요 등, 1문장)"
  }
]`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    }
  );

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message || `Gemini API 오류 (HTTP ${res.status})`);
  }

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error('AI 응답을 해석하지 못했어요. 다시 시도해주세요.');
  }
}
