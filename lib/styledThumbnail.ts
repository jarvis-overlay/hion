// "인기상품 스타일 학습" + "스타일 적용 추가 이미지" 생성.
//
// 기존 썸네일 일괄생성은 사진마다 누끼만 따서 흰 배경에 올려서, 결과물을
// 그대로 상품 페이지에 쓰기 어려웠다. 여기서는
//   1) 쿠팡에서 판매량순 상위 상품들의 대표 이미지를 비전 모델이 분석해서
//      "잘 팔리는 이미지의 공통 구성 규칙"(배경/소품/조명/컷 구성)을 글로
//      정리하고(학습),
//   2) 이미지를 만들 때는 경쟁사 사진을 AI에 직접 보여주지 않고 그 규칙(글)과
//      내 상품 사진만 넣어서 새 장면을 생성한다 - 남의 상품·로고·구도를
//      그대로 베끼거나 섞이는 걸 피하기 위해서다.
//   3) 한국어 문구는 AI가 그리면 깨지므로, 이미지는 글자 없이 만들고 실제
//      폰트로 서버에서 합성한다 (상세페이지 제작과 같은 방식).
import sharp from 'sharp';
import { createCanvas } from 'canvas';
import { fetchCoupangBestsellers } from '@/lib/brightdata';
import {
  fetchImageFromUrl,
  describeProductAppearance,
  ensureKoreanFontRegistered,
  FONT_BOLD,
  FONT_EXTRABOLD,
  IMAGE_GEN_MODEL,
  VISION_MODEL,
  THUMBNAIL_SIZE,
} from '@/lib/imageProcessing';

export interface StyleShot {
  id: string;
  title: string; // 컷 이름 (예: "접어서 정리한 컷")
  scene: string; // 이미지 생성 AI에게 줄 장면 묘사
  textPosition: 'top' | 'bottom'; // 문구를 얹을 위치 (반대쪽에 상품을 배치)
}

export interface StyleBrief {
  summary: string;
  background: string;
  props: string;
  lighting: string;
  sellingPoints: string[];
  shots: StyleShot[];
}

export interface ShotCopyText {
  headline: string;
  sub: string;
}

// 저장된 스타일은 이 기간이 지나면 다시 학습한다 (인기상품 구성은 서서히 바뀜)
export const STYLE_BRIEF_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// 카테고리를 설정하지 않았거나 인기상품 학습에 실패했을 때 쓰는 범용 구성. 어떤
// 상품에도 무리 없는 컷들이라, 이 경우에도 "메인 + 추가 이미지"가 항상 한 번에
// 만들어지게 한다 (학습된 스타일보다 상품 맞춤도는 떨어짐).
export const DEFAULT_STYLE_BRIEF: StyleBrief = {
  summary: '카테고리별 인기상품 분석 없이 쓰는 기본 구성이에요.',
  background: '깨끗한 밝은 단색 또는 은은한 톤의 스튜디오 배경',
  props: '상품이 돋보이도록 소품은 최소한으로',
  lighting: '부드러운 자연광과 은은한 그림자',
  sellingPoints: [],
  shots: [
    {
      id: 'd1',
      title: '스튜디오 정면 컷',
      scene: '밝고 깨끗한 단색 스튜디오 배경 위에 상품을 정면에서 크고 또렷하게, 바닥에 부드러운 그림자',
      textPosition: 'bottom',
    },
    {
      id: 'd2',
      title: '디테일 확대 컷',
      scene: '상품의 소재 질감과 마감이 잘 보이도록 가까이 확대한 컷, 배경은 단순하고 부드럽게 흐리게',
      textPosition: 'bottom',
    },
    {
      id: 'd3',
      title: '라이프스타일 연출 컷',
      scene: '따뜻한 톤의 실내 테이블이나 선반 위에 자연스럽게 놓인 상품, 소품은 한두 개만 곁들여 단정하게',
      textPosition: 'top',
    },
    {
      id: 'd4',
      title: '위에서 내려다본 컷',
      scene: '밝은 배경 위에 상품을 위에서 내려다본 구도로 깔끔하게 놓은 컷, 여백을 충분히',
      textPosition: 'bottom',
    },
    {
      id: 'd5',
      title: '컬러 배경 컷',
      scene: '상품 색과 어울리는 은은한 파스텔 그라데이션 배경 위에 상품을 중앙에 크게 배치',
      textPosition: 'top',
    },
    {
      id: 'd6',
      title: '비스듬한 각도 컷',
      scene: '상품을 약간 비스듬한 각도에서 입체감이 느껴지게 촬영한 컷, 은은한 반사광과 그림자',
      textPosition: 'bottom',
    },
    {
      id: 'd7',
      title: '여백 강조 컷',
      scene: '넓은 여백 속에 상품을 한쪽에 치우쳐 배치한 미니멀한 구도, 차분한 배경',
      textPosition: 'top',
    },
    {
      id: 'd8',
      title: '그림자 강조 컷',
      scene: '조명이 한쪽에서 비치는 따뜻한 스튜디오, 상품 옆으로 길게 드리운 부드러운 그림자',
      textPosition: 'bottom',
    },
  ],
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} 환경변수가 설정 안 되어있어요.`);
  return v;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// 비전 모델 응답(JSON)을 검증하고 정규화한다 - 일부 항목이 비어도 쓸 수 있는
// 만큼은 살리되, 컷이 3개 미만이면 쓸모가 없으니 실패로 처리한다.
export function normalizeStyleBrief(raw: any): StyleBrief {
  const shots: StyleShot[] = (Array.isArray(raw?.shots) ? raw.shots : [])
    .map((s: any, i: number) => ({
      id: `s${i + 1}`,
      title: str(s?.title, 24) || `컷 ${i + 1}`,
      scene: str(s?.scene, 400),
      textPosition: s?.textPosition === 'top' ? ('top' as const) : ('bottom' as const),
    }))
    .filter((s: StyleShot) => s.scene)
    .slice(0, 8);
  if (shots.length < 3) {
    throw new Error('인기상품 스타일 분석 결과를 해석하지 못했어요. 잠시 후 다시 시도해주세요.');
  }
  return {
    summary: str(raw?.summary, 400),
    background: str(raw?.background, 300),
    props: str(raw?.props, 300),
    lighting: str(raw?.lighting, 300),
    sellingPoints: (Array.isArray(raw?.sellingPoints) ? raw.sellingPoints : [])
      .map((p: unknown) => str(p, 20))
      .filter(Boolean)
      .slice(0, 8),
    shots,
  };
}

function parseJsonObject(text: string): any {
  const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const jsonText = start !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  return JSON.parse(jsonText);
}

export async function learnStyleBrief(category: string): Promise<{ brief: StyleBrief; sourceCount: number }> {
  const q = category.trim();
  if (!q) throw new Error('카테고리/검색어를 먼저 설정해주세요.');

  const bestsellers = await fetchCoupangBestsellers(q, 12, { budgetMs: 60_000 });
  const candidates = bestsellers.filter((b) => b.imageUrl).slice(0, 8);
  if (candidates.length < 3) {
    throw new Error(`"${q}" 인기상품을 충분히 찾지 못했어요. 카테고리/검색어를 바꿔보세요.`);
  }

  const fetched = await Promise.all(
    candidates.map(async (b) => {
      try {
        return { b, img: await fetchImageFromUrl(b.imageUrl!) };
      } catch {
        return null;
      }
    })
  );
  const items = fetched.filter((x): x is NonNullable<typeof x> => x !== null);
  if (items.length < 3) {
    throw new Error('인기상품 이미지를 충분히 불러오지 못했어요. 잠시 후 다시 시도해주세요.');
  }

  const apiKey = requireEnv('GEMINI_API_KEY');
  const prompt = `당신은 쿠팡 상품 이미지 기획자입니다. 아래는 쿠팡에서 "${q}"를 검색했을 때 판매량순 상위 상품 ${items.length}개의 대표 이미지(순서대로 첨부)와 상품 정보입니다.

${items
  .map(
    ({ b }, i) =>
      `${i + 1}. ${b.name} / 가격 ${b.price ?? '?'} / 리뷰 ${b.reviewCount ?? '?'}`
  )
  .join('\n')}

이 이미지들에서 "잘 팔리는 상품 이미지의 공통 구성 규칙"만 뽑아주세요. 특정 브랜드·로고·문구·상품 디자인을 그대로 베끼면 안 되고, 여러 이미지에 공통으로 보이는 패턴만 정리합니다.

그리고 이 카테고리 상품의 "추가 이미지(상세 갤러리)"로 만들면 좋은 서로 다른 컷 6개를 제안해주세요. 규칙:
- 컷의 scene은 이미지 생성 AI에게 줄 장면 묘사(한국어)입니다. 상품 자체의 모양·색을 바꾸는 내용은 넣지 마세요(배경·소품·구도·확대 정도만).
- 사람/모델이 등장하는 장면은 만들지 마세요. 상품만, 또는 소품과 함께 있는 장면으로만 구성하세요.
- 글자·숫자·로고가 들어가는 장면 묘사는 금지입니다.
- textPosition은 문구를 얹을 위치("top" 또는 "bottom")이고, 상품은 그 반대쪽에 배치됩니다. 컷마다 적절히 섞어주세요.

반드시 아래 JSON 객체로만 응답하세요:
{
  "summary": "잘 팔리는 이미지의 공통점 2~3문장",
  "background": "공통 배경/분위기",
  "props": "자주 쓰는 소품/연출 요소",
  "lighting": "조명·색감 톤",
  "sellingPoints": ["이미지/상품명에서 공통으로 강조되는 장점 키워드(한국어 단어) 최대 6개"],
  "shots": [{"title": "짧은 컷 이름", "scene": "장면 묘사", "textPosition": "top 또는 bottom"}]
}`;

  const parts: Record<string, unknown>[] = [{ text: prompt }];
  for (const { img } of items) {
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.buffer.toString('base64') } });
  }

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

  const text: string = (json.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('');
  let raw: any;
  try {
    raw = parseJsonObject(text);
  } catch {
    console.error('[styledThumbnail] 스타일 분석 응답 파싱 실패:', text.slice(0, 500));
    throw new Error('인기상품 스타일 분석 결과를 해석하지 못했어요. 잠시 후 다시 시도해주세요.');
  }
  return { brief: normalizeStyleBrief(raw), sourceCount: items.length };
}

// ---------------------------------------------------------------------------
// 스타일 적용 추가 이미지
// ---------------------------------------------------------------------------

// 문구가 들어갈 쪽에 어두운 그라데이션을 깔고 그 위에 글자를 얹는다. 배경 사진이
// 밝아도 흰 글자가 읽히게 하기 위함. 글자 폭이 넘치면 폰트를 줄이고, 그래도
// 안 되면 두 줄까지만 쓴다.
function layoutLines(ctx: any, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (!cur || ctx.measureText(next).width <= maxWidth) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export async function overlayThumbnailCopy(
  imageBuffer: Buffer,
  copy: ShotCopyText,
  position: 'top' | 'bottom'
): Promise<Buffer> {
  ensureKoreanFontRegistered();
  const S = THUMBNAIL_SIZE;
  const PAD = 60;
  const maxWidth = S - PAD * 2;
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext('2d');

  const scrimH = 380;
  const grad =
    position === 'top' ? ctx.createLinearGradient(0, 0, 0, scrimH) : ctx.createLinearGradient(0, S, 0, S - scrimH);
  grad.addColorStop(0, 'rgba(0,0,0,0.62)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, position === 'top' ? 0 : S - scrimH, S, scrimH);

  // 헤드라인: 72px에서 시작해 두 줄 안에 들어올 때까지 줄인다
  let headSize = 72;
  let headLines: string[] = [];
  for (; headSize >= 44; headSize -= 4) {
    ctx.font = `${headSize}px ${FONT_EXTRABOLD}`;
    headLines = layoutLines(ctx, copy.headline, maxWidth);
    if (headLines.length <= 2 && headLines.every((l) => ctx.measureText(l).width <= maxWidth)) break;
  }
  headLines = headLines.slice(0, 2);

  const subSize = 36;
  ctx.font = `${subSize}px ${FONT_BOLD}`;
  const subLines = copy.sub ? layoutLines(ctx, copy.sub, maxWidth).slice(0, 2) : [];

  const headLH = headSize * 1.25;
  const subLH = subSize * 1.35;
  const gap = subLines.length ? 14 : 0;
  const blockH = headLines.length * headLH + gap + subLines.length * subLH;
  let y = position === 'top' ? PAD - 6 : S - PAD + 6 - blockH;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 10;
  ctx.fillStyle = '#ffffff';
  ctx.font = `${headSize}px ${FONT_EXTRABOLD}`;
  for (const line of headLines) {
    ctx.fillText(line, S / 2, y);
    y += headLH;
  }
  y += gap;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = `${subSize}px ${FONT_BOLD}`;
  for (const line of subLines) {
    ctx.fillText(line, S / 2, y);
    y += subLH;
  }

  return sharp(imageBuffer)
    .composite([{ input: canvas.toBuffer('image/png') }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

const NO_TEXT_RULE =
  '**가장 중요한 규칙: 결과 이미지 안에는 그 어떤 문자·숫자·기호·로고·워터마크도 존재하면 안 됩니다.** 한국어든 중국어든 영어든 예외 없습니다. 원본 상품 사진에 박혀 있는 홍보 문구·로고·워터마크·라벨 글씨도 지우고 자연스러운 배경/재질로 채우세요. 문구는 이후 단계에서 별도로 정확한 폰트로 합성합니다. 사람(모델)의 얼굴이나 신체도 그리지 마세요.';

const FIDELITY_RULE =
  '**상품 외형 보존 규칙(필수):** 첨부된 상품 사진 속 상품은 실제 판매할 실물이므로 새로 디자인하거나 단순화하지 말고 사진 속 그 물건을 그대로 옮겨오세요. 바닥의 발받침대·다리, 손잡이, 뚜껑, 표면 질감, 모서리 형태, 비율, 개수, 색상은 하나도 빼거나 바꾸거나 추가하지 마세요. 색상이 여러 개 보여도 첨부 사진의 색상 그대로 쓰세요.';

export async function generateStyledAdditionalImage(input: {
  productImage: { buffer: Buffer; mimeType: string };
  brief: Pick<StyleBrief, 'background' | 'props' | 'lighting'>;
  shot: StyleShot;
  copy: ShotCopyText | null;
  appearanceSpec?: string | null;
}): Promise<Buffer> {
  const apiKey = requireEnv('GEMINI_API_KEY');
  const spec =
    input.appearanceSpec === undefined ? await describeProductAppearance(input.productImage) : input.appearanceSpec;
  const textSide = input.shot.textPosition === 'top' ? '위쪽' : '아래쪽';
  const productSide = input.shot.textPosition === 'top' ? '아래쪽' : '위쪽 또는 중앙';

  const instruction = `${NO_TEXT_RULE}

${FIDELITY_RULE}${
    spec ? `\n\n[상품 외형 명세 - 결과물 속 상품은 반드시 이 명세와 일치해야 합니다]\n${spec}` : ''
  }

위 규칙을 지키면서, 첨부된 상품 사진의 상품을 사용해 쿠팡 상품 페이지의 "추가 이미지" 한 장을 새로 만들어주세요. 쿠팡에서 실제로 잘 팔리는 이 카테고리 상품들의 이미지 구성 규칙을 분석한 결과는 다음과 같습니다.
- 배경/분위기: ${input.brief.background || '(없음)'}
- 소품/연출: ${input.brief.props || '(없음)'}
- 조명/색감: ${input.brief.lighting || '(없음)'}

이번 컷: ${input.shot.title}
장면: ${input.shot.scene}

구도: 정사각형(1:1). 이후 ${textSide} 25% 영역에 문구를 얹을 예정이므로 그 영역은 단순하고 어두워져도 괜찮은 배경으로 비워두고, 상품은 ${productSide}에 크고 또렷하게 배치하세요. 상품이 가려지거나 작아지면 안 됩니다.`;

  const parts: Record<string, unknown>[] = [
    { inlineData: { mimeType: input.productImage.mimeType, data: input.productImage.buffer.toString('base64') } },
    { text: instruction },
  ];
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_GEN_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      }),
    }
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `Gemini 이미지 생성 오류 (HTTP ${res.status})`);

  const imagePart = (json.candidates?.[0]?.content?.parts || []).find((p: any) => p.inlineData?.data);
  if (!imagePart) {
    throw new Error('이미지 생성 결과를 받지 못했어요. 다시 시도해주세요.');
  }
  const base = await sharp(Buffer.from(imagePart.inlineData.data, 'base64'))
    .resize({ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE, fit: 'cover' })
    .jpeg({ quality: 92 })
    .toBuffer();

  if (!input.copy || !input.copy.headline) return base;
  return overlayThumbnailCopy(base, input.copy, input.shot.textPosition);
}
