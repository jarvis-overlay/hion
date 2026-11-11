// 쿠팡 실데이터 조사 후보 중, 사용자가 입력한 재질/방식과 다른 상품
// (예: 극세사 욕실매트를 조사했는데 규조토 매트가 섞임)에 "참고용" 배지를
// 달기 위한 판정기. 사전 매칭이 애매한 것만 Gemini에 보너스로 한 번 더
// 물어본다 - 실패해도 조사 자체가 막히면 안 되므로 절대 throw하지 않는다
// (lib/outputVerifier.ts와 동일한 관례).
import { VISION_MODEL, geminiErrorMessage } from '@/lib/imageProcessing';
import { BATHROOM_MAT_MATERIAL_KEYWORDS } from '@/lib/materialKeywords';

export type MaterialTierVerdict =
  | { type: 'dictionary_different'; matchedKeyword: string }
  | { type: 'ai_different' };

// 순수 함수, 네트워크 없음.
// userMaterial이 제목에 그대로 포함돼 있으면 null(=매칭, 경쟁상품).
// BATHROOM_MAT_MATERIAL_KEYWORDS 중 userMaterial과 다른 키워드가 제목에
// 있으면 dictionary_different. 둘 다 아니면 'ambiguous'.
export function classifyByDictionary(
  userMaterial: string,
  title: string
): { type: 'dictionary_different'; matchedKeyword: string } | 'ambiguous' | null {
  const material = userMaterial.trim();
  if (!material) return 'ambiguous';
  if (title.includes(material)) return null;

  const matched = BATHROOM_MAT_MATERIAL_KEYWORDS.find(
    (kw) => kw !== material && title.includes(kw)
  );
  if (matched) return { type: 'dictionary_different', matchedKeyword: matched };

  return 'ambiguous';
}

function parseJsonArray(text: string): any[] {
  const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();
  const s = cleaned.indexOf('[');
  const e = cleaned.lastIndexOf(']');
  if (s === -1 || e <= s) throw new Error('JSON 배열 없음');
  const parsed = JSON.parse(cleaned.slice(s, e + 1));
  if (!Array.isArray(parsed)) throw new Error('JSON 배열 아님');
  return parsed;
}

// 애매한 후보만 모아 한 번의 배치 호출로 Gemini에 질의.
// 절대 throw하지 않는다(outputVerifier.verifyProductMatch와 동일 관례).
// API 키 없음/네트워크 실패/타임아웃(8초)/HTTP 비정상/JSON 파싱 실패
// 전부 null 반환으로 수렴시킨다 - 호출부는 "배지 없음"으로만 처리.
// 응답은 입력 배열과 인덱스를 맞춘 배열로 반환한다(제목을 키로 쓰지
// 않음 - 중복/특수문자 문제 방지).
export async function classifyMaterialMismatch(
  userMaterial: string,
  ambiguousTitles: string[]
): Promise<(('different' | 'same' | 'unsure') | null)[] | null> {
  if (ambiguousTitles.length === 0) return [];
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;

    const items = ambiguousTitles.map((title, index) => ({ index, title }));
    const prompt = `사용자 상품 재질/방식: ${userMaterial}.
아래 상품명들이 사용자 상품과 같은 방식(경쟁 상품)인지 다른 방식인지 판정해서 JSON 배열로 답하세요.
판단이 애매하면 "unsure"로 답하세요.

상품명 목록(JSON):
${JSON.stringify(items)}

반드시 아래 형식의 JSON 배열로만 응답하세요 (원래 index를 그대로 포함):
[{"index":0,"verdict":"same"},{"index":1,"verdict":"different"},{"index":2,"verdict":"unsure"}]`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
          signal: controller.signal,
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    const json = await res.json();
    if (!res.ok) {
      throw new Error(geminiErrorMessage(json?.error?.message, res.status, `Gemini API 오류 (HTTP ${res.status})`));
    }

    const text: string = (json.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('');
    const parsed = parseJsonArray(text);

    const result: (('different' | 'same' | 'unsure') | null)[] = new Array(ambiguousTitles.length).fill(null);
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue;
      const idx = entry.index;
      const verdict = entry.verdict;
      if (typeof idx !== 'number' || idx < 0 || idx >= ambiguousTitles.length) continue;
      if (verdict === 'same' || verdict === 'different' || verdict === 'unsure') {
        result[idx] = verdict;
      }
    }
    return result;
  } catch (e: any) {
    console.error('[materialClassify] 재질 AI 판정 실패 - 배지 없이 통과:', e?.message || e);
    return null;
  }
}
