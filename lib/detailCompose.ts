// 상세페이지 "한 번에 만들기" - 사진 분석 + 쿠팡 상세페이지 구성 학습.
//
//  1) analyzeSourceImage: 중국어가 박힌 상품 사진 한 장을 비전 모델로 분석한다
//     (무슨 사진인지, 사진 속 중국어의 한국어 번역, 확인되는 사실, 보이는 색상, 사이즈표).
//  2) learnDetailFlow: 쿠팡에서 잘 팔리는 상위 상품의 상세 설명 이미지를 분석해서
//     "상세페이지가 어떤 순서로, 어떤 장면들로 흘러가는지"를 정리한다.
// 두 결과를 합쳐 구성안을 짜는 건 lib/ai.ts(planDetailSections), 취급하지 않는
// 색상/사이즈를 걸러내는 규칙은 lib/detailOptions.ts에 있다.
import sharp from 'sharp';
import { fetchCoupangBestsellers, fetchCoupangDetailImageUrls } from '@/lib/brightdata';
import { fetchImageFromUrl, VISION_MODEL, IMAGE_GEN_MODEL } from '@/lib/imageProcessing';
import { removeOverlays } from '@/lib/overlayCleanup';
import { normalizeSourceAnalysis, colorHint, type SourceAnalysis } from '@/lib/detailOptions';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} 환경변수가 설정 안 되어있어요.`);
  return v;
}

function parseJsonObject(text: string): any {
  const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const jsonText = start !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  return JSON.parse(jsonText);
}

async function geminiVision(parts: Record<string, unknown>[]): Promise<string> {
  const apiKey = requireEnv('GEMINI_API_KEY');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] }),
    }
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `Gemini API 오류 (HTTP ${res.status})`);
  return (json.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('');
}

// ---------------------------------------------------------------------------
// 1) 상품 사진 한 장 분석
// ---------------------------------------------------------------------------
export async function analyzeSourceImage(img: { buffer: Buffer; mimeType: string }): Promise<SourceAnalysis> {
  const prompt = `당신은 중국 1688/타오바오 상품 사진을 분석해 한국 쿠팡 상세페이지를 기획하는 이커머스 기획자입니다. 첨부된 사진 한 장을 분석해서 JSON 객체로만 답하세요.

규칙:
- 사진 속 중국어·영어 문구는 한국어로 번역해 koreanTexts에 담으세요. 뜻을 바꾸거나 과장하지 마세요. 문구가 없으면 빈 배열.
- facts에는 사진과 사진 속 문구에서 **확인되는 사실만** 담으세요 (소재, 기능, 구성품, 제조/사용 정보 등). 추측이나 일반적인 장점은 넣지 마세요.
- colorsShown에는 사진에 보이는 **상품의 색상**을 한국어 색상명으로 모두 적으세요. 한 장에 여러 색상이 나열돼 있으면 전부 적어야 합니다. 모델·배경·소품의 색은 제외하세요.
- sizeChart는 사이즈표가 있을 때만: headers(열 제목 배열)와 rows(각 행의 칸 배열, 숫자는 사진 그대로)를 담으세요. 없으면 null.
- sizesMentioned에는 사진에 언급된 사이즈 표기(S, M, L, XL, 2XL 등)를 담으세요.
- role은 다음 중 하나: "hero"(상품 전체 컷), "detail"(확대/디테일), "size_chart"(사이즈표), "color_lineup"(여러 색상 나열), "usage"(사용/착용 장면), "package"(포장/구성품), "material"(소재 설명), "other".
- description은 무엇이 찍혀 있는지 한국어 한두 문장.

응답 형식:
{"role":"...","description":"...","koreanTexts":["..."],"facts":["..."],"colorsShown":["..."],"sizeChart":{"headers":["..."],"rows":[["..."]]},"sizesMentioned":["..."]}`;

  const text = await geminiVision([
    { text: prompt },
    { inlineData: { mimeType: img.mimeType, data: img.buffer.toString('base64') } },
  ]);
  let raw: any;
  try {
    raw = parseJsonObject(text);
  } catch {
    console.error('[detailCompose] 사진 분석 응답 파싱 실패:', text.slice(0, 300));
    throw new Error('사진 분석 결과를 해석하지 못했어요.');
  }
  return normalizeSourceAnalysis(raw);
}

// ---------------------------------------------------------------------------
// 2) 쿠팡 상세페이지 구성 학습
// ---------------------------------------------------------------------------
export interface DetailFlowStep {
  title: string; // 장면 이름
  purpose: string; // 이 장면이 하는 역할
  note: string; // 인기상품에서 보이는 표현/배치 방식
}

// 인기상품 상세 이미지에서 읽은 글자/배치 습관 - 장면 템플릿과 문구 길이를 고를 때 참고한다
export interface DetailVisualStyle {
  themeTendency: 'light' | 'dark' | 'mixed'; // 문구 장면의 배경 톤
  alignment: 'center' | 'left' | 'mixed'; // 글자 정렬
  copyLength: 'short' | 'medium' | 'long'; // 한 장면의 문구 분량
  usesEmphasis: boolean; // 핵심 단어를 색/굵기로 강조하는가
  photoTextRatio: 'photo-heavy' | 'balanced' | 'text-heavy';
  note: string; // 글자 크기·굵기·여백 등 눈에 띄는 특징
}

export interface DetailFlowBrief {
  summary: string;
  tone: string;
  sellingPoints: string[];
  flow: DetailFlowStep[];
  visual?: DetailVisualStyle;
  analysis?: { products: number; detailImages: number; mainImages: number };
}

// 카테고리를 안 정했거나 쿠팡 학습에 실패했을 때 쓰는 일반적인 흐름 (쿠팡 참고 아님)
export const DEFAULT_DETAIL_FLOW: DetailFlowBrief = {
  summary: '쿠팡 인기상품을 참고하지 않은 일반적인 상세페이지 흐름이에요.',
  tone: '간결하고 신뢰감 있는 톤',
  sellingPoints: [],
  flow: [
    { title: '첫인상(훅)', purpose: '상품을 한눈에 보여주고 핵심 한 줄로 관심을 끈다', note: '큰 상품 사진 + 짧은 헤드라인' },
    { title: '핵심 장점 요약', purpose: '구매 이유를 3~4가지로 정리', note: '번호/체크 목록' },
    { title: '디테일 1', purpose: '소재·마감 등 눈으로 확인되는 장점', note: '확대 사진 + 한 줄 설명' },
    { title: '사용 장면', purpose: '쓰는 모습을 상상하게 한다', note: '분위기 있는 사진 위 문구' },
    { title: '디테일 2', purpose: '구성·기능 보충 설명', note: '사진 + 한 줄 설명' },
    { title: '제품 사양', purpose: '소재·색상·사이즈 등 정보를 표로 정리', note: '라벨/값 표' },
    { title: '마무리', purpose: '신뢰를 주는 짧은 마무리 메시지', note: '여백 있는 문구' },
  ],
};

function normalizeFlow(raw: any): DetailFlowBrief {
  const flow: DetailFlowStep[] = (Array.isArray(raw?.flow) ? raw.flow : [])
    .map((s: any) => ({
      title: String(s?.title ?? '').trim().slice(0, 30),
      purpose: String(s?.purpose ?? '').trim().slice(0, 120),
      note: String(s?.note ?? '').trim().slice(0, 120),
    }))
    .filter((s: DetailFlowStep) => s.title)
    .slice(0, 10);
  if (flow.length < 4) throw new Error('쿠팡 상세페이지 구성 분석 결과를 해석하지 못했어요. 잠시 후 다시 시도해주세요.');
  return {
    summary: String(raw?.summary ?? '').trim().slice(0, 400),
    tone: String(raw?.tone ?? '').trim().slice(0, 100),
    sellingPoints: (Array.isArray(raw?.sellingPoints) ? raw.sellingPoints : [])
      .map((p: unknown) => String(p ?? '').trim().slice(0, 20))
      .filter(Boolean)
      .slice(0, 8),
    flow,
    visual: normalizeVisual(raw?.visual),
  };
}

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

function normalizeVisual(v: any): DetailVisualStyle | undefined {
  if (!v || typeof v !== 'object') return undefined;
  return {
    themeTendency: pick(v.themeTendency, ['light', 'dark', 'mixed'] as const, 'mixed'),
    alignment: pick(v.alignment, ['center', 'left', 'mixed'] as const, 'center'),
    copyLength: pick(v.copyLength, ['short', 'medium', 'long'] as const, 'short'),
    usesEmphasis: v.usesEmphasis === true,
    photoTextRatio: pick(v.photoTextRatio, ['photo-heavy', 'balanced', 'text-heavy'] as const, 'balanced'),
    note: String(v.note ?? '').trim().slice(0, 200),
  };
}

export { normalizeFlow as normalizeDetailFlow };

// 상위 상품의 상세 설명 이미지를 읽어서 흐름을 배운다. 페이지 크롤링은 느리고 한도가
// 있어서(분당 8건) 상위 3개 상품만 보고, 정해진 시간 안에 끝난 것만 쓴다. 상세 이미지를
// 못 읽으면 검색결과 대표 이미지만으로 분석하고 그 사실을 analysis에 남겨 화면에 알린다.
export async function learnDetailFlow(category: string): Promise<DetailFlowBrief> {
  const q = category.trim();
  if (!q) throw new Error('카테고리/검색어를 먼저 입력해주세요.');

  const bestsellers = await fetchCoupangBestsellers(q, 10, { budgetMs: 60_000 });
  const mainCandidates = bestsellers.filter((b) => b.imageUrl).slice(0, 4);
  if (mainCandidates.length < 2) {
    throw new Error(`"${q}" 인기상품을 충분히 찾지 못했어요. 카테고리/검색어를 바꿔보세요.`);
  }

  const done: { b: (typeof bestsellers)[number]; urls: string[] }[] = [];
  const tasks = bestsellers.slice(0, 3).map(async (b) => {
    try {
      done.push({ b, urls: (await fetchCoupangDetailImageUrls(b.url, 8)).slice(0, 6) });
    } catch (e) {
      console.error('[detailCompose] 상세 이미지 조회 실패:', b.url, e);
    }
  });
  await Promise.race([Promise.all(tasks), new Promise<void>((r) => setTimeout(r, 80_000))]);

  const dl = async (url: string) => {
    try {
      return await fetchImageFromUrl(url);
    } catch {
      return null;
    }
  };
  const mains = (await Promise.all(mainCandidates.map(async (b) => ({ b, img: await dl(b.imageUrl!) })))).filter(
    (x): x is { b: typeof x.b; img: NonNullable<typeof x.img> } => x.img !== null
  );
  const details = (
    await Promise.all(
      done.map(async ({ b, urls }) => ({
        b,
        imgs: (await Promise.all(urls.map(dl))).filter((x): x is NonNullable<typeof x> => x !== null),
      }))
    )
  ).filter((d) => d.imgs.length > 0);
  const detailCount = details.reduce((s, d) => s + d.imgs.length, 0);

  const detailNote = details.length
    ? `이어서 상위 상품 ${details.length}개의 "상세 설명 이미지"가 상품별로, 페이지에 나오는 **위에서 아래 순서 그대로** 첨부돼 있습니다:\n${details
        .map((d) => `- ${d.b.name}: ${d.imgs.length}장`)
        .join('\n')}\n상세페이지가 어떤 순서·장면으로 흘러가는지는 **이쪽을 가장 중요하게** 분석하세요.`
    : '(상세 설명 이미지는 가져오지 못했어요. 대표 이미지와 상품 정보만으로 이 카테고리 상세페이지의 일반적인 흐름을 추정하되, 추정이라는 점이 summary에 드러나게 쓰세요.)';

  const prompt = `당신은 쿠팡 상세페이지 기획자입니다. 쿠팡에서 "${q}"를 검색했을 때 판매량순 상위 상품들의 상세페이지가 어떤 흐름으로 구성되는지 분석해주세요.

먼저 상위 상품 ${mains.length}개의 대표 이미지가 순서대로 첨부돼 있습니다:
${mains.map(({ b }, i) => `${i + 1}. ${b.name} / 가격 ${b.price ?? '?'} / 리뷰 ${b.reviewCount ?? '?'}`).join('\n')}

${detailNote}

분석 규칙:
- 특정 브랜드·로고·문구를 베끼지 말고, 여러 상품에 공통으로 보이는 흐름만 정리하세요.
- flow는 상세페이지를 위에서 아래로 읽을 때의 장면 순서입니다 (6~9개). 각 장면의 title(장면 이름), purpose(그 장면이 하는 일), note(그 장면에서 흔히 쓰는 사진/문구/배치 방식)를 적으세요.
- tone은 인기상품 문구의 어조(예: 간결·신뢰, 감성적, 기능 강조 등).
- sellingPoints는 이 카테고리 인기상품이 공통으로 강조하는 장점 키워드(한국어 단어) 최대 6개.
- visual은 상세 이미지에서 보이는 글자/배치 습관입니다: themeTendency(문구 장면 배경이 light/dark/mixed), alignment(글자 정렬 center/left/mixed), copyLength(한 장면 문구 분량 short/medium/long), usesEmphasis(핵심 단어를 색·굵기로 강조하는지 true/false), photoTextRatio(photo-heavy/balanced/text-heavy), note(글자 크기·굵기·여백 특징 한 줄).

반드시 JSON 객체로만 응답하세요:
{"summary":"공통 흐름 요약 2~3문장","tone":"...","sellingPoints":["..."],"flow":[{"title":"...","purpose":"...","note":"..."}],"visual":{"themeTendency":"light","alignment":"center","copyLength":"short","usesEmphasis":true,"photoTextRatio":"balanced","note":"..."}}`;

  const parts: Record<string, unknown>[] = [{ text: prompt }];
  for (const { img } of mains) parts.push({ inlineData: { mimeType: img.mimeType, data: img.buffer.toString('base64') } });
  for (const d of details) {
    for (const img of d.imgs) parts.push({ inlineData: { mimeType: img.mimeType, data: img.buffer.toString('base64') } });
  }

  const text = await geminiVision(parts);
  let raw: any;
  try {
    raw = parseJsonObject(text);
  } catch {
    console.error('[detailCompose] 상세 구성 분석 응답 파싱 실패:', text.slice(0, 300));
    throw new Error('쿠팡 상세페이지 구성 분석 결과를 해석하지 못했어요. 잠시 후 다시 시도해주세요.');
  }
  const brief = normalizeFlow(raw);
  brief.analysis = { products: details.length, detailImages: detailCount, mainImages: mains.length };
  return brief;
}


// ---------------------------------------------------------------------------
// 3) 상품 색상 변환: 내가 파는 색상의 사진이 없을 때 다른 색 사진을 그 색으로 바꾼다
// ---------------------------------------------------------------------------
// 이미지 생성 모델이 색만 바꾸라는 지시를 어기고 모양을 바꾸거나 다른 색을 섞는 일이 있어서, 만든 결과를
// 비전 모델로 한 번 더 검사하고(원본과 비교) 통과한 것만 쓴다. 두 번 시도해도 통과하지 못하면 쓰지 않는다.
async function recolorOnce(img: { buffer: Buffer; mimeType: string }, from: string | null, to: string): Promise<Buffer> {
  const apiKey = requireEnv('GEMINI_API_KEY');
  const hint = colorHint(to);
  const prompt = `첨부된 사진은 판매 상품 사진입니다. **상품의 색상만** "${to}"${hint ? ` (${hint})` : ''}(으)로 바꿔주세요.${from ? ` 지금 상품 색상은 "${from}"입니다.` : ''}

규칙(모두 필수):
1. 상품의 모양, 비율, 소재 질감(주름·짜임·광택), 솔기, 부품, 그림자, 조명, 구도, 배경은 원본과 똑같이 유지하세요. 색만 바뀌어야 합니다.
2. 상품이 아닌 것(사람 피부, 배경, 소품)의 색은 바꾸지 마세요.
3. 결과 속 상품 전체가 "${to}" 한 가지 색이어야 합니다. 원본에 없는 다른 색의 무늬·로고·장식을 새로 만들지 마세요.
4. 사진 속에 글자·아이콘이 있으면 모두 지우고 자연스러운 재질로 채우세요. 새 글자는 절대 그리지 마세요.
5. 결과는 원본과 같은 비율의 사진 한 장입니다.`;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_GEN_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ inlineData: { mimeType: img.mimeType, data: img.buffer.toString('base64') } }, { text: prompt }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      }),
    }
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `Gemini 이미지 생성 오류 (HTTP ${res.status})`);
  const part = (json.candidates?.[0]?.content?.parts || []).find((p: any) => p.inlineData?.data);
  if (!part) throw new Error('색상을 바꾼 이미지를 받지 못했어요.');
  return Buffer.from(part.inlineData.data, 'base64');
}

export interface RecolorCheck {
  ok: boolean;
  reason: string;
}

export async function verifyRecolor(
  original: { buffer: Buffer; mimeType: string },
  edited: Buffer,
  to: string
): Promise<RecolorCheck> {
  const prompt = `두 장의 상품 사진을 비교하세요. 첫 번째는 원본, 두 번째는 상품 색상을 "${to}"(으)로 바꾸게 해서 만든 결과입니다. JSON 객체로만 답하세요.
- productColor: 두 번째 사진에서 상품 본체의 색상을 한국어 색상명으로
- matchesTarget: 두 번째 사진의 상품 본체가 "${to}" 한 가지 색으로 보이는가 (true/false). 다른 색의 무늬·줄·로고가 눈에 띄면 false
- shapeUnchanged: 상품의 모양·비율·부품 개수·질감이 원본과 같은가 (true/false). 부품이 사라지거나 생기거나 모양이 달라졌으면 false
- hasText: 두 번째 사진에 글자·숫자·로고가 보이는가 (true/false)
- note: 문제가 있으면 한 줄로
{"productColor":"","matchesTarget":true,"shapeUnchanged":true,"hasText":false,"note":""}`;
  const text = await geminiVision([
    { text: prompt },
    { inlineData: { mimeType: original.mimeType, data: original.buffer.toString('base64') } },
    { inlineData: { mimeType: 'image/jpeg', data: edited.toString('base64') } },
  ]);
  let r: any;
  try {
    r = parseJsonObject(text);
  } catch {
    return { ok: false, reason: '변환 결과를 검사하지 못했어요' };
  }
  if (r?.matchesTarget !== true) return { ok: false, reason: `색상이 "${to}"로 제대로 바뀌지 않았어요${r?.productColor ? ` (${r.productColor}로 보임)` : ''}` };
  if (r?.shapeUnchanged !== true) return { ok: false, reason: '상품 모양이 원본과 달라졌어요' };
  if (r?.hasText === true) return { ok: false, reason: '결과에 글자가 남아 있어요' };
  return { ok: true, reason: '' };
}

export async function recolorWithVerification(
  img: { buffer: Buffer; mimeType: string },
  from: string | null,
  to: string
): Promise<{ success: true; buffer: Buffer } | { success: false; error: string }> {
  let lastReason = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await recolorOnce(img, from, to);
      let buf: Buffer = await sharp(raw).jpeg({ quality: 92 }).toBuffer();
      buf = (await removeOverlays(buf, 'image/jpeg')).buffer;
      const check = await verifyRecolor(img, buf, to);
      if (check.ok) return { success: true, buffer: buf };
      lastReason = check.reason;
    } catch (e: any) {
      lastReason = e?.message || String(e);
    }
  }
  return { success: false, error: lastReason || '색상 변환에 실패했어요' };
}
