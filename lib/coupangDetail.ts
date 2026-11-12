// 쿠팡 상품 페이지 원문(마크다운)에서 "상품정보/옵션" 텍스트만 추려서, Gemini에게
// 페이지에 실제로 적힌 소재·사이즈·색상 옵션을 뽑아오게 하는 도구들.
//
// 역할 분담: AI는 "페이지에 뭐라고 적혀 있나"를 읽어오기만 하고(추측 금지),
// 사이즈/색상이 내가 원하는 것과 맞는지는 코드(lib/candidateFilter.ts)가 비교한다.
// 재질은 "같은 방식인가"라는 판단이 필요해서 AI 판정(materialVerdict)을 받되,
// 근거 원문(evidence)을 화면에 같이 보여준다. 절대 throw하지 않는다.
import { VISION_MODEL, geminiErrorMessage } from '@/lib/imageProcessing';

// 'cm/mm/가로/세로' 같은 흔한 단어는 추천상품·리뷰 줄까지 끌어와서 뺐다(옵션/상품정보 라벨만 본다)
const KEY_RE = /옵션|색상|컬러|사이즈|크기|규격|소재|재질|원단|상품정보|상품 정보|상세정보/;
const MAX_CHARS = 6000;

// 이미지/링크 주소/잡음을 걷어내고 핵심 구간만 남긴다.
// truncated: 글자 수 한도 때문에 일부를 버렸는지(버렸다면 옵션 목록이 불완전할 수 있어
// 호출한 쪽이 "옵션에 없음" 같은 단정을 하면 안 된다)
export function extractRelevantText(
  markdown: string,
  maxChars = MAX_CHARS
): { text: string; truncated: boolean } {
  const lines = markdown
    .split('\n')
    .map((l) =>
      l
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // 이미지
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 링크 → 글자만
        .replace(/https?:\/\/\S+/g, '')
        .trim()
    )
    .filter((l, i, arr) => l && l !== arr[i - 1]);

  const keep = new Set<number>();
  // 맨 앞(상품명/가격 영역)
  for (let i = 0; i < Math.min(15, lines.length); i++) keep.add(i);
  // 키워드가 있는 줄과 그 앞뒤 3줄(옵션 목록은 보통 라벨 아래에 줄줄이 나옴)
  lines.forEach((l, i) => {
    if (KEY_RE.test(l)) {
      for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 4); j++) keep.add(j);
    }
  });

  const picked = [...keep].sort((a, b) => a - b).map((i) => lines[i]);
  const joined = picked.join('\n');
  return { text: joined.slice(0, maxChars), truncated: joined.length > maxChars };
}

export interface ProductFacts {
  material: string | null;
  sizes: string[];
  colors: string[];
  materialVerdict: 'same' | 'different' | 'unknown';
  evidence: string | null;
  // 옵션 목록이 상한에 닿았을 가능성(사이즈/색상이 더 있을 수 있음)
  listsMaybeIncomplete: boolean;
}

function parseObject(text: string): any {
  const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();
  const s = cleaned.indexOf('{');
  const e = cleaned.lastIndexOf('}');
  if (s === -1 || e <= s) throw new Error('JSON 객체 없음');
  return JSON.parse(cleaned.slice(s, e + 1));
}

export const LIST_MAX = 40;

function strList(v: unknown, max = LIST_MAX): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim().slice(0, 40))
    .slice(0, max);
}

export type FactsResult = { facts: ProductFacts } | { error: string };

export async function extractProductFacts(
  pageText: string,
  userMaterial: string
): Promise<FactsResult> {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { error: 'AI 키가 설정되지 않아 상세 내용을 읽지 못했어요.' };
    if (pageText.trim().length < 30) return { error: '상품 페이지에서 읽을 내용이 없었어요.' };

    const materialLine = userMaterial
      ? `내 상품의 재질/방식: ${userMaterial}\n이 상품이 내 상품과 같은 재질/방식(직접 경쟁 상품)인지 materialVerdict로 판정하세요(same/different/unknown). 페이지에 재질 정보가 없으면 unknown.
판정 주의:
- 섬유 성분 이름(폴리에스터/폴리에스테르/나일론/아크릴 등)은 극세사·마이크로화이바·샤기·기모 같은 제품 방식과 겹치는 경우가 많습니다. 성분만 적혀 있고 제품 방식이 불분명하면 different가 아니라 unknown으로 답하세요.
- different는 페이지가 내 상품과 확실히 다른 방식임을 보여줄 때만 쓰세요 (예: 규조토, 메모리폼, PVC/실리콘/고무, 대나무, 코르크, 퍼즐매트 등 흡수·구조 방식 자체가 다른 경우).
- same은 페이지가 내 재질/방식과 같거나 동의어(예: 극세사=마이크로화이바)임을 보여줄 때만 쓰세요.`
      : '재질 비교는 필요 없으니 materialVerdict는 "unknown"으로 두세요.';

    const prompt = `아래는 쿠팡 상품 페이지에서 뽑은 텍스트입니다. 페이지에 실제로 적힌 내용만 근거로 답하세요. 적혀 있지 않으면 null 또는 빈 배열로 두고, 절대 추측하지 마세요.

${materialLine}

반드시 아래 형식의 JSON 객체로만 응답하세요:
{"material":"페이지에 적힌 소재/재질 (없으면 null)","sizes":["구매 가능한 사이즈/규격 전부, 예 40x60cm"],"colors":["선택 가능한 색상 전부"],"materialVerdict":"same|different|unknown","evidence":"판정 근거가 된 원문 일부 (40자 이내, 없으면 null)"}

페이지 텍스트:
"""
${pageText}
"""`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let res: Response;
    let json: any;
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
      // 응답 본문을 읽는 동안에도 타임아웃이 살아 있어야 한다
      json = await res.json();
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      throw new Error(geminiErrorMessage(json?.error?.message, res.status, `Gemini API 오류 (HTTP ${res.status})`));
    }
    const text: string = (json.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('');
    const obj = parseObject(text);

    const sizes = strList(obj.sizes);
    const colors = strList(obj.colors);
    const evidence =
      typeof obj.evidence === 'string' && obj.evidence.trim() ? obj.evidence.trim().slice(0, 80) : null;
    // 재질 "다름" 판정은 근거 문구가 있고 그 문구가 실제 페이지 텍스트에 있을 때만 인정한다
    // (근거 없는 AI 단정으로 후보가 지워지는 걸 막음). 공백 차이는 무시.
    const squash = (t: string) => t.replace(/\s+/g, '');
    const evidenceInPage = !!evidence && squash(pageText).includes(squash(evidence));
    let verdict: 'same' | 'different' | 'unknown' =
      obj.materialVerdict === 'same' || obj.materialVerdict === 'different' ? obj.materialVerdict : 'unknown';
    if (verdict === 'different' && !evidenceInPage) verdict = 'unknown';
    return {
      facts: {
        listsMaybeIncomplete: sizes.length >= LIST_MAX || colors.length >= LIST_MAX,
        material: typeof obj.material === 'string' && obj.material.trim() ? obj.material.trim().slice(0, 60) : null,
        sizes,
        colors,
        materialVerdict: verdict,
        evidence,
      },
    };
  } catch (e: any) {
    console.error('[coupangDetail] 상세 정보 추출 실패:', e?.message || e);
    const msg: string = typeof e?.message === 'string' ? e.message : '';
    if (e?.name === 'AbortError') return { error: 'AI 응답이 늦어서 건너뛰었어요.' };
    // geminiErrorMessage가 만든 한국어 안내(쿼터 등)는 그대로 보여준다
    return { error: /[가-힣]/.test(msg) && !/[A-Z][A-Z0-9_]{5,}/.test(msg) ? msg : '상세 내용을 읽지 못했어요.' };
  }
}
