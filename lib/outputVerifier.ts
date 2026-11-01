// "검증 에이전트": AI가 만든 결과가 원본 상품과 같은 상품인지 사람 눈처럼 대조해서 확인한다.
//
// 이미지 생성 AI는 사진 속 상품을 "다시 그리면서" 종류·모양·색·부품을 바꾸는 일이 잦다
// (실측: 사각 드로즈 사진을 넣었는데 삼각팬티가 나옴). 판매 상품은 실물과 다르면 허위 표시/반품 사유라서,
// 만든 직후 원본과 결과를 비전 모델로 대조하고, 다르면 틀린 점을 알려주며 한 번 더 만들게 하고,
// 그래도 다르면 AI가 그린 것 대신 원본 사진(글자만 지운 것)을 그대로 쓴다.
// 검사 자체가 실패하면 생성을 막지 않고 통과시킨다(에러가 나면 안 되므로) - 그 사실은 호출한 쪽이 알 수 있다.
import { VISION_MODEL } from '@/lib/imageProcessing';

export interface MatchVerdict {
  ok: boolean;
  issues: string[]; // 다른 점 (한국어)
  skipped: boolean; // 검사를 못 해서 통과시킨 경우
  originalType?: string;
  resultType?: string;
}

// 비전 모델의 판정 JSON을 해석한다 (순수 함수 - 단위 테스트용)
export function judgeMatch(r: any, opts: { allowColorChange?: boolean } = {}): MatchVerdict {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { ok: true, issues: [], skipped: true };
  const issues: string[] = [];
  const o = typeof r.originalType === 'string' ? r.originalType.trim() : '';
  const t = typeof r.resultType === 'string' ? r.resultType.trim() : '';
  if (r.sameType === false) issues.push(`상품 종류가 달라요 (원본: ${o || '?'} / 결과: ${t || '?'})`);
  if (r.sameSilhouette === false) issues.push('상품 모양(실루엣·길이·폭)이 원본과 달라요');
  if (r.sameColor === false && !opts.allowColorChange) issues.push('상품 색상이 원본과 달라요');
  if (r.sameParts === false) issues.push('상품의 부품·디테일(밴드·솔기·주머니·개수 등)이 원본과 달라요');
  if (r.looksNatural === false) {
    issues.push('결과 그림에 어색하게 뭉개지거나 의미 없는 물체·도형이 있어요 (특히 위쪽·가장자리)');
  }
  if (issues.length > 0 && typeof r.note === 'string' && r.note.trim()) issues.push(r.note.trim().slice(0, 120));
  return { ok: issues.length === 0, issues, skipped: false, originalType: o || undefined, resultType: t || undefined };
}

function parseJsonObject(text: string): any {
  const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();
  const s = cleaned.indexOf('{');
  const e = cleaned.lastIndexOf('}');
  if (s === -1 || e <= s) throw new Error('JSON 없음');
  return JSON.parse(cleaned.slice(s, e + 1));
}

export async function verifyProductMatch(
  original: { buffer: Buffer; mimeType: string },
  generated: Buffer,
  ctx: { productHint?: string | null; allowColorChange?: boolean } = {}
): Promise<MatchVerdict> {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { ok: true, issues: [], skipped: true };
    const prompt = `두 장의 사진을 비교하세요. 첫 번째는 실제 판매할 상품의 원본 사진이고, 두 번째는 AI가 그 상품을 이용해 만든 마케팅 이미지입니다. 두 번째 사진 속 상품이 첫 번째 사진의 "같은 상품"으로 보이는지 엄격하게 검사하세요.${ctx.productHint ? `\n참고 - 상품 정보: ${ctx.productHint}` : ''}

비교 기준:
- 상품 종류: 같은 종류인가? 비슷해 보여도 종류가 다르면 false (예: 사각 드로즈/박서 ↔ 삼각팬티, 긴팔 ↔ 반팔, 롱 ↔ 숏, 컵 ↔ 텀블러)
- 실루엣: 길이·폭·다리/소매 부분의 모양이 같은가
- 색상: 상품 본체와 밴드/포인트 색이 같은가${ctx.allowColorChange ? ' (이번엔 색 변경을 요청했으므로 항상 true)' : ''}
- 부품·디테일: 밴드, 솔기, 주머니, 지퍼, 로고 자리, 개수가 같은가
- 자연스러움(looksNatural): 두 번째 사진이 그대로 상세페이지에 써도 될 만큼 자연스러운가. 위·아래·가장자리에 정체불명의 상자·도형·떠 있는 물체, 뭉개지거나 녹은 부분, 어색하게 잘리거나 겹친 부분, 흐림 덩어리, 의미 없는 줄·선만 있는 장면이면 false
문제 삼지 않을 것: 촬영 각도, 배경, 조명, 손·모델·연기·반짝임 같은 연출, 사진 속 글자, 크기.
애매하면 true로 판단하되, 종류나 실루엣이 다르거나 부자연스러우면 반드시 false입니다.

JSON 객체로만 답하세요:
{"originalType":"원본 상품 종류를 한국어로 짧게","resultType":"결과 속 상품 종류","sameType":true,"sameSilhouette":true,"sameColor":true,"sameParts":true,"looksNatural":true,"note":"다르면 무엇이 어떻게 다른지 한 줄"}`;
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                { inlineData: { mimeType: original.mimeType, data: original.buffer.toString('base64') } },
                { inlineData: { mimeType: 'image/jpeg', data: generated.toString('base64') } },
              ],
            },
          ],
        }),
      }
    );
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
    const text: string = (json.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('');
    return judgeMatch(parseJsonObject(text), { allowColorChange: ctx.allowColorChange });
  } catch (e: any) {
    console.error('[outputVerifier] 상품 일치 검사 실패 - 통과 처리:', e?.message || e);
    return { ok: true, issues: [], skipped: true };
  }
}

// 틀린 점을 다음 생성 지시에 박아 넣는 문장
export function buildFixNote(verdict: MatchVerdict): string {
  const lines = verdict.issues.map((i) => `- ${i}`).join('\n');
  const type = verdict.originalType ? `원본 상품은 "${verdict.originalType}"입니다. ` : '';
  return `[이전 결과에서 틀린 점 - 이번엔 반드시 고치세요]\n${lines}\n${type}원본 사진 속 상품의 종류·모양·색·부품을 그대로 옮기고, 비슷한 다른 종류의 상품으로 바꿔 그리지 마세요.`;
}

export interface VerifiedBackground {
  buffer: Buffer;
  // 'ok': 검사 통과 / 'skipped': 검사를 못 해서 통과 / 'retried': 다시 만들어서 통과 / 'fallback': 원본 사진으로 대체
  result: 'ok' | 'skipped' | 'retried' | 'fallback';
  issues: string[];
}

// 만들기 -> 검사 -> (다르면) 틀린 점을 알려주고 다시 만들기 -> 그래도 다르면 원본 사진 사용.
// 한 번 더 만드는 것까지만 한다 (서버 제한 시간 때문에 최대 2번 생성).
export async function generateWithVerification(deps: {
  generate: (fixNote: string | null, attempt: number) => Promise<Buffer>;
  verify: (generated: Buffer) => Promise<MatchVerdict>;
  fallback: () => Promise<Buffer>;
  maxAttempts?: number;
}): Promise<VerifiedBackground> {
  const max = deps.maxAttempts ?? 2;
  let fixNote: string | null = null;
  let lastIssues: string[] = [];
  for (let attempt = 1; attempt <= max; attempt++) {
    let buf: Buffer;
    try {
      buf = await deps.generate(fixNote, attempt);
    } catch (e) {
      if (attempt === 1) throw e; // 첫 생성부터 실패하면 기존처럼 오류로 알린다
      break; // 다시 만들기가 실패하면 원본 사진으로 대체
    }
    const verdict = await deps.verify(buf);
    if (verdict.ok) {
      return { buffer: buf, result: verdict.skipped ? 'skipped' : attempt > 1 ? 'retried' : 'ok', issues: [] };
    }
    lastIssues = verdict.issues;
    fixNote = buildFixNote(verdict);
  }
  return { buffer: await deps.fallback(), result: 'fallback', issues: lastIssues };
}
