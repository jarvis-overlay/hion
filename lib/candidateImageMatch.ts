// 내 상품 사진(기준 사진)과 쿠팡 후보 사진을 Gemini로 비교해서 "얼마나 닮았나"를 점수로 돌려준다.
// 상품명·상세페이지로는 알 수 없는 생김새(종류·모양·무늬·질감·색)를 눈으로 비교하는 용도.
//
// 원칙: 절대 throw하지 않는다(외부 API는 실패를 전제로 한다). 후보 사진을 못 받았거나
// AI가 판단을 못 한 후보는 null(=모름)로 돌려주고, 호출한 쪽은 "모름"으로만 취급한다.
// 결과는 AI 추정이라 화면에서도 그렇게 표시하고, 자동 삭제의 근거로는 쓰지 않는다.
import { VISION_MODEL, geminiErrorMessage } from '@/lib/imageProcessing';
import { normalizeCoupangImageUrl } from '@/lib/coupangImageUrl';

export { normalizeCoupangImageUrl };

export interface ReferenceImage {
  mimeType: string;
  base64: string;
}

export interface ImageMatchResult {
  score: number; // 0~100 (높을수록 닮음)
  sameType: boolean; // 같은 종류의 상품인지
  note: string | null; // 다른 점 한 줄(있을 때)
}

export const MAX_BATCH = 8; // 한 번의 AI 호출에 넣는 후보 사진 수
const MAX_REF_BASE64 = 700_000; // 기준 사진 base64 길이 상한(약 500KB)
const MAX_CANDIDATE_BYTES = 800_000;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function validateReference(ref: unknown): ReferenceImage | null {
  if (!ref || typeof ref !== 'object') return null;
  const { mimeType, base64 } = ref as Record<string, unknown>;
  if (typeof mimeType !== 'string' || !ALLOWED_MIME.has(mimeType)) return null;
  if (typeof base64 !== 'string' || base64.length < 100 || base64.length > MAX_REF_BASE64) return null;
  if (!/^[A-Za-z0-9+/]+=*$/.test(base64)) return null;
  return { mimeType, base64 };
}

async function fetchCandidateImage(url: string): Promise<{ mimeType: string; base64: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    // 리다이렉트는 직접 따라가며 매번 허용 주소인지 확인한다(최대 2번)
    let current = url;
    let res: Response | null = null;
    for (let hop = 0; hop < 3; hop++) {
      res = await fetch(current, { signal: controller.signal, redirect: 'manual' });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        let next: string | null = null;
        try {
          next = loc ? normalizeCoupangImageUrl(new URL(loc, current).href) : null;
        } catch {
          next = null;
        }
        if (!next) return null;
        current = next;
        res = null;
        continue;
      }
      break;
    }
    if (!res || !res.ok) return null;
    const mimeType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_MIME.has(mimeType)) return null;
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > MAX_CANDIDATE_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_CANDIDATE_BYTES) return null;
    return { mimeType, base64: buf.toString('base64') };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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

// urls: 후보 사진 주소(없으면 null). 결과는 같은 순서·같은 길이의 배열.
export async function compareWithReference(
  ref: ReferenceImage,
  urls: (string | null)[]
): Promise<{ results: (ImageMatchResult | null)[] } | { error: string }> {
  const results: (ImageMatchResult | null)[] = new Array(urls.length).fill(null);
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { error: 'AI 키가 설정되지 않아 사진을 비교하지 못했어요.' };

    // 후보 사진 받기(병렬). 못 받은 후보는 null로 남긴다.
    let rejected = 0; // 쿠팡 이미지 서버 주소가 아니라서 받지 않은 것
    let rejectedHost = '';
    const fetched = await Promise.all(
      urls.map((u) => {
        const safe = normalizeCoupangImageUrl(u);
        if (!safe) {
          rejected++;
          if (!rejectedHost && u) {
            try {
              rejectedHost = new URL(u.startsWith('//') ? `https:${u}` : u).hostname.slice(0, 60);
            } catch {
              rejectedHost = '(주소 형식 이상)';
            }
          }
          return Promise.resolve(null);
        }
        return fetchCandidateImage(safe);
      })
    );
    const usable = fetched.map((f, i) => ({ f, i })).filter((x): x is { f: { mimeType: string; base64: string }; i: number } => !!x.f);
    if (usable.length === 0) {
      // 전부 못 받았으면 이유를 알려준다(호스트 이름만 - 어느 쪽이 문제인지 구분하려고)
      if (rejected === urls.length && urls.length > 0) {
        return {
          error: `후보 사진 주소가 허용 목록(coupangcdn.com) 밖이라 받지 않았어요${rejectedHost ? ` (예: ${rejectedHost})` : ''}.`,
        };
      }
      return { error: '후보 사진을 받아오지 못했어요 (쿠팡 이미지 서버가 응답하지 않았거나 크기·형식이 맞지 않아요).' };
    }

    const prompt = `첫 번째 사진은 내가 팔려는 상품(기준 사진)입니다. 이어지는 "후보 N" 사진들은 쿠팡에 올라온 다른 상품입니다.
각 후보가 기준 사진의 상품과 같은 종류이면서 생김새가 얼마나 닮았는지(직접 경쟁 상품인지) 0~100점으로 평가하세요.

평가할 것: 상품 종류(같은 종류인가), 전체 모양·구조, 무늬/패턴, 질감(털 길이·표면 느낌), 색상 계열.
무시할 것: 배경, 촬영 각도, 조명, 모델·손·소품 같은 연출, 사진 속 글자·할인 스티커, 크기.
점수 기준: 90 이상 = 거의 같은 상품/디자인, 70~89 = 같은 종류에 비슷한 생김새, 40~69 = 같은 종류지만 생김새가 꽤 다름, 40 미만 = 다른 종류거나 다른 방식.
종류 자체가 다르면 sameType=false, 점수는 20 이하. 사진이 안 보이거나 판단할 수 없으면 score를 null로 두세요.
note에는 기준 사진과 눈에 띄게 다른 점을 한국어 20자 이내로 적으세요(비슷하면 null).

반드시 아래 형식의 JSON 배열로만 응답하세요 (index는 후보 번호 그대로):
[{"index":0,"score":85,"sameType":true,"note":null}]`;

    const parts: any[] = [
      { text: prompt },
      { inlineData: { mimeType: ref.mimeType, data: ref.base64 } },
    ];
    usable.forEach(({ f }, n) => {
      parts.push({ text: `후보 ${n}:` });
      parts.push({ inlineData: { mimeType: f.mimeType, data: f.base64 } });
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 40000);
    let res: Response;
    let json: any;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts }] }),
          signal: controller.signal,
        }
      );
      json = await res.json();
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new Error(geminiErrorMessage(json?.error?.message, res.status, `Gemini API 오류 (HTTP ${res.status})`));
    }

    const text: string = (json.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('');
    let entries: any[];
    try {
      entries = parseJsonArray(text);
    } catch {
      throw new Error('AI가 결과를 알아볼 수 없는 형태로 답했어요.');
    }
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const n = entry.index;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n >= usable.length) continue;
      if (typeof entry.score !== 'number' || !Number.isFinite(entry.score)) continue;
      const sameType = entry.sameType !== false;
      results[usable[n].i] = {
        score: Math.max(0, Math.min(100, Math.round(entry.score))),
        sameType,
        note: typeof entry.note === 'string' && entry.note.trim() ? entry.note.trim().slice(0, 40) : null,
      };
    }
    return { results };
  } catch (e: any) {
    console.error('[candidateImageMatch] 사진 비교 실패:', e?.message || e);
    if (e?.name === 'AbortError') return { error: 'AI 응답이 늦어서 이번 묶음은 건너뛰었어요.' };
    const msg: string = typeof e?.message === 'string' ? e.message : '';
    return { error: /[가-힣]/.test(msg) && !/[A-Z][A-Z0-9_]{5,}/.test(msg) ? msg : '사진을 비교하지 못했어요.' };
  }
}
