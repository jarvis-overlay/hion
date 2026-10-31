// "인기상품 스타일 학습" + "스타일 적용 추가 이미지" 생성.
//
// 기존 썸네일 일괄생성은 사진마다 누끼만 따서 흰 배경에 올려서, 결과물을
// 그대로 상품 페이지에 쓰기 어려웠다. 여기서는
//   1) 쿠팡에서 판매량순 상위 상품들의 이미지 - 검색결과 대표 이미지와, 가능하면
//      상품 페이지 갤러리(판매자가 실제로 공들이는 추가 이미지)까지 - 를 비전
//      모델이 분석해서 "잘 팔리는 이미지의 공통 구성 규칙"(배경/소품/조명/컷
//      구성/문구 배치)을 글로 정리하고(학습),
//   2) 이미지를 만들 때는 경쟁사 사진을 AI에 직접 보여주지 않고 그 규칙(글)과
//      내 상품 사진만 넣어서 새 장면을 생성한다 - 남의 상품·로고·구도를
//      그대로 베끼거나 섞이는 걸 피하기 위해서다.
//   3) 한국어 문구는 AI가 그리면 깨지므로, 이미지는 글자 없이 만들고 실제
//      폰트로 서버에서 합성한다 (상세페이지 제작과 같은 방식). 문구 배치는 컷마다
//      캡션/포인트 목록/배지 중 학습한 방식을 쓴다.
import sharp from 'sharp';
import { removeOverlays } from '@/lib/overlayCleanup';
import { createCanvas } from 'canvas';
import { fetchCoupangBestsellers, fetchCoupangGalleryImageUrls } from '@/lib/brightdata';
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

export type ShotLayout = 'caption' | 'bullets' | 'badge';

export interface StyleShot {
  id: string;
  title: string; // 컷 이름 (예: "접어서 정리한 컷") - 내부/화면 표시용, 이미지 문구로 쓰지 않는다
  scene: string; // 이미지 생성 AI에게 줄 장면 묘사
  textPosition: 'top' | 'bottom'; // 문구를 얹을 위치 (반대쪽에 상품을 배치)
  layout: ShotLayout; // caption=한 줄 캡션, bullets=제목+포인트 목록, badge=모서리 배지+캡션
}

// 무엇을 분석해서 만든 스타일인지 (화면에 그대로 보여줘서, 대표 이미지만 봤는지
// 갤러리까지 봤는지 사용자가 확인할 수 있게 한다)
export interface StyleAnalysisInfo {
  mainImages: number; // 분석한 검색결과 대표 이미지 수
  galleryImages: number; // 분석한 상품 페이지 갤러리 이미지 수
  galleryProducts: number; // 갤러리를 읽는 데 성공한 상품 수
}

export interface StyleBrief {
  summary: string;
  background: string;
  props: string;
  lighting: string;
  sellingPoints: string[];
  shots: StyleShot[];
  analysis?: StyleAnalysisInfo;
}

export interface ShotCopyText {
  headline: string;
  sub: string;
  points?: string[];
  badge?: string;
}

// 저장된 스타일은 이 기간이 지나면 다시 학습한다 (인기상품 구성은 서서히 바뀜)
export const STYLE_BRIEF_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// 카테고리를 설정하지 않았거나 인기상품 학습에 실패했을 때 쓰는 범용 구성. 어떤
// 상품에도 무리 없는 컷들이라, 이 경우에도 "메인 + 추가 이미지"가 항상 한 번에
// 만들어지게 한다 (쿠팡 인기상품을 참고한 게 아니라서 상품 맞춤도는 떨어짐 -
// 화면에서 이 사실을 분명히 알려준다).
export const DEFAULT_STYLE_BRIEF: StyleBrief = {
  summary: '쿠팡 인기상품을 참고하지 않은 범용 기본 구성이에요.',
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
      layout: 'caption',
    },
    {
      id: 'd2',
      title: '디테일 확대 컷',
      scene: '상품의 소재 질감과 마감이 잘 보이도록 가까이 확대한 컷, 배경은 단순하고 부드럽게 흐리게',
      textPosition: 'bottom',
      layout: 'bullets',
    },
    {
      id: 'd3',
      title: '라이프스타일 연출 컷',
      scene: '따뜻한 톤의 실내 테이블이나 선반 위에 자연스럽게 놓인 상품, 소품은 한두 개만 곁들여 단정하게',
      textPosition: 'top',
      layout: 'caption',
    },
    {
      id: 'd4',
      title: '위에서 내려다본 컷',
      scene: '밝은 배경 위에 상품을 위에서 내려다본 구도로 깔끔하게 놓은 컷, 여백을 충분히',
      textPosition: 'bottom',
      layout: 'badge',
    },
    {
      id: 'd5',
      title: '컬러 배경 컷',
      scene: '상품 색과 어울리는 은은한 파스텔 그라데이션 배경 위에 상품을 중앙에 크게 배치',
      textPosition: 'top',
      layout: 'caption',
    },
    {
      id: 'd6',
      title: '비스듬한 각도 컷',
      scene: '상품을 약간 비스듬한 각도에서 입체감이 느껴지게 촬영한 컷, 은은한 반사광과 그림자',
      textPosition: 'top',
      layout: 'bullets',
    },
    {
      id: 'd7',
      title: '여백 강조 컷',
      scene: '넓은 여백 속에 상품을 한쪽에 치우쳐 배치한 미니멀한 구도, 차분한 배경',
      textPosition: 'top',
      layout: 'caption',
    },
    {
      id: 'd8',
      title: '그림자 강조 컷',
      scene: '조명이 한쪽에서 비치는 따뜻한 스튜디오, 상품 옆으로 길게 드리운 부드러운 그림자',
      textPosition: 'bottom',
      layout: 'badge',
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
      layout: s?.layout === 'bullets' || s?.layout === 'badge' ? (s.layout as ShotLayout) : ('caption' as const),
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

// 상품 페이지 크롤링은 느리고 계정 한도(분당 8건)가 있어서, 정해진 시간 안에 끝난
// 것만 쓰고 나머지는 포기한다 (갤러리는 있으면 좋은 정보라 전체를 붙잡으면 안 됨).
async function collectWithin<T>(tasks: Promise<T>[], ms: number): Promise<T[]> {
  const done: T[] = [];
  const wrapped = tasks.map((t) => t.then((v) => void done.push(v)).catch(() => undefined));
  await Promise.race([Promise.all(wrapped), new Promise<void>((r) => setTimeout(r, ms))]);
  return done.slice();
}

export async function learnStyleBrief(
  category: string
): Promise<{ brief: StyleBrief; sourceCount: number }> {
  const q = category.trim();
  if (!q) throw new Error('카테고리/검색어를 먼저 설정해주세요.');

  const bestsellers = await fetchCoupangBestsellers(q, 12, { budgetMs: 60_000 });
  const mainCandidates = bestsellers.filter((b) => b.imageUrl).slice(0, 6);
  if (mainCandidates.length < 3) {
    throw new Error(`"${q}" 인기상품을 충분히 찾지 못했어요. 카테고리/검색어를 바꿔보세요.`);
  }

  // 1) 상위 상품 페이지의 갤러리(추가 이미지) 주소 - 상위 4개 상품, 각 최대 5장.
  //    갤러리 첫 장은 대표 이미지와 같은 경우가 많아 건너뛴다.
  const galleryRaw = await collectWithin(
    bestsellers.slice(0, 4).map(async (b) => {
      try {
        const urls = (await fetchCoupangGalleryImageUrls(b.url, 7)).slice(1, 6);
        return { b, urls };
      } catch (e) {
        console.error('[styledThumbnail] 상품 페이지 갤러리 조회 실패:', b.url, e);
        return { b, urls: [] as string[] };
      }
    }),
    80_000
  );

  // 2) 이미지 내려받기 (실패한 건 조용히 제외)
  const dl = async (url: string) => {
    try {
      return await fetchImageFromUrl(url);
    } catch {
      return null;
    }
  };
  const mains = (
    await Promise.all(mainCandidates.map(async (b) => ({ b, img: await dl(b.imageUrl!) })))
  ).filter((x): x is { b: typeof x.b; img: NonNullable<typeof x.img> } => x.img !== null);
  if (mains.length < 3) {
    throw new Error('인기상품 이미지를 충분히 불러오지 못했어요. 잠시 후 다시 시도해주세요.');
  }

  const galleries = (
    await Promise.all(
      galleryRaw.map(async ({ b, urls }) => ({
        b,
        imgs: (await Promise.all(urls.map(dl))).filter((x): x is NonNullable<typeof x> => x !== null),
      }))
    )
  ).filter((g) => g.imgs.length > 0);
  const galleryImageCount = galleries.reduce((s, g) => s + g.imgs.length, 0);

  // 3) 비전 모델 분석
  const apiKey = requireEnv('GEMINI_API_KEY');
  const galleryNote = galleries.length
    ? `이어서 상위 상품 ${galleries.length}개의 "추가 이미지(상품 페이지 갤러리)"가 상품별로 묶여 첨부돼 있습니다:\n${galleries
        .map((g) => `- ${g.b.name}: ${g.imgs.length}장`)
        .join('\n')}\n추가 이미지는 판매자들이 실제로 공들여 만드는 구성이라, 컷 구성은 **이쪽을 가장 중요하게** 분석하세요.`
    : '(상품 페이지 추가 이미지는 가져오지 못했어요. 대표 이미지만으로 분석하되, 이 카테고리 상품 페이지에서 흔히 쓰이는 추가 이미지 구성도 함께 고려하세요.)';

  const prompt = `당신은 쿠팡 상품 이미지 기획자입니다. 쿠팡에서 "${q}"를 검색했을 때 판매량순 상위 상품들의 이미지를 분석해, "잘 팔리는 상품 이미지의 공통 구성 규칙"을 뽑아주세요.

먼저 상위 상품 ${mains.length}개의 대표 이미지가 순서대로 첨부돼 있습니다:
${mains.map(({ b }, i) => `${i + 1}. ${b.name} / 가격 ${b.price ?? '?'} / 리뷰 ${b.reviewCount ?? '?'}`).join('\n')}

${galleryNote}

분석 규칙:
- 특정 브랜드·로고·문구·상품 디자인을 그대로 베끼면 안 됩니다. 여러 이미지에 공통으로 보이는 패턴(배경, 소품, 조명, 컷 종류, 문구 배치 방식)만 정리하세요.
- 그리고 이 카테고리 상품의 "추가 이미지(상세 갤러리)"로 만들면 좋은 서로 다른 컷 6~8개를 제안하세요. 인기상품 추가 이미지에서 실제로 반복해서 보이는 컷 유형(확대 디테일, 소재 설명, 사이즈/구성 안내, 색상 구성, 사용 장면, 포장/구성품 등)을 우선하고, 한 가지 구도만 반복하지 마세요.
- 컷의 scene은 이미지 생성 AI에게 줄 장면 묘사(한국어)입니다. 상품 자체의 모양·색을 바꾸는 내용은 넣지 말고(배경·소품·구도·확대 정도만), 글자·숫자·로고가 들어가는 장면은 금지입니다.
- 사람/모델이 등장하는 장면은 만들지 마세요. 상품만, 또는 소품과 함께 있는 장면으로만 구성하세요.
- textPosition은 문구를 얹을 위치("top" 또는 "bottom")이고, 상품은 그 반대쪽에 배치됩니다. 컷마다 적절히 섞어주세요.
- layout은 그 컷 유형의 인기상품 이미지에서 문구를 어떻게 얹는지를 따라 고르세요: "caption"(한 줄 헤드라인+보조문구), "bullets"(제목 + 장점 3개 목록), "badge"(모서리 강조 배지 + 헤드라인). 세 가지를 컷에 맞게 섞어 쓰세요.

반드시 아래 JSON 객체로만 응답하세요:
{
  "summary": "잘 팔리는 이미지의 공통점 2~3문장 (대표 이미지와 추가 이미지에서 각각 무엇이 보이는지)",
  "background": "공통 배경/분위기",
  "props": "자주 쓰는 소품/연출 요소",
  "lighting": "조명·색감 톤",
  "sellingPoints": ["이미지/상품명에서 공통으로 강조되는 장점 키워드(한국어 단어) 최대 6개"],
  "shots": [{"title": "짧은 컷 이름", "scene": "장면 묘사", "textPosition": "top 또는 bottom", "layout": "caption 또는 bullets 또는 badge"}]
}`;

  const parts: Record<string, unknown>[] = [{ text: prompt }];
  for (const { img } of mains) {
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.buffer.toString('base64') } });
  }
  for (const g of galleries) {
    for (const img of g.imgs) {
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.buffer.toString('base64') } });
    }
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
  const brief = normalizeStyleBrief(raw);
  brief.analysis = {
    mainImages: mains.length,
    galleryImages: galleryImageCount,
    galleryProducts: galleries.length,
  };
  return { brief, sourceCount: mains.length };
}

// ---------------------------------------------------------------------------
// 스타일 적용 추가 이미지
// ---------------------------------------------------------------------------

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

// 폰트를 줄여가며 두 줄 안에 들어오는 헤드라인 크기를 찾는다
function fitHeadline(ctx: any, text: string, maxWidth: number, startSize: number): { size: number; lines: string[] } {
  let size = startSize;
  let lines: string[] = [];
  for (; size >= 44; size -= 4) {
    ctx.font = `${size}px ${FONT_EXTRABOLD}`;
    lines = layoutLines(ctx, text, maxWidth);
    if (lines.length <= 2 && lines.every((l) => ctx.measureText(l).width <= maxWidth)) break;
  }
  return { size: Math.max(size, 44), lines: lines.slice(0, 2) };
}

function roundRect(ctx: any, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 문구를 얹는다. 문구 쪽에 어두운 그라데이션을 깔아 밝은 사진에서도 흰 글자가 읽히게
// 하고, 컷의 layout에 따라 세 가지 모양으로 그린다:
//   caption: 가운데 정렬 헤드라인 + 보조문구
//   bullets: 왼쪽 정렬 헤드라인 + 체크 표시가 붙은 포인트 3개 (포인트가 없으면 caption)
//   badge:   caption + 반대쪽 모서리의 원형 배지 (배지 문구가 없으면 caption)
export async function overlayThumbnailCopy(
  imageBuffer: Buffer,
  copy: ShotCopyText,
  position: 'top' | 'bottom',
  layout: ShotLayout = 'caption'
): Promise<Buffer> {
  ensureKoreanFontRegistered();
  const S = THUMBNAIL_SIZE;
  const PAD = 60;
  const maxWidth = S - PAD * 2;
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext('2d');

  const points = (copy.points || []).filter(Boolean).slice(0, 3);
  const effective: ShotLayout =
    layout === 'bullets' && points.length > 0 ? 'bullets' : layout === 'badge' && copy.badge ? 'badge' : 'caption';

  const scrimH = effective === 'bullets' ? 520 : 380;
  const grad =
    position === 'top' ? ctx.createLinearGradient(0, 0, 0, scrimH) : ctx.createLinearGradient(0, S, 0, S - scrimH);
  grad.addColorStop(0, 'rgba(0,0,0,0.66)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, position === 'top' ? 0 : S - scrimH, S, scrimH);

  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 10;

  if (effective === 'bullets') {
    const head = fitHeadline(ctx, copy.headline, maxWidth, 68);
    const headLH = head.size * 1.25;
    const pillH = 64;
    const pillGap = 14;
    const blockH = head.lines.length * headLH + 22 + points.length * (pillH + pillGap) - pillGap;
    let y = position === 'top' ? PAD - 6 : S - PAD + 6 - blockH;

    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = `${head.size}px ${FONT_EXTRABOLD}`;
    for (const line of head.lines) {
      ctx.fillText(line, PAD, y);
      y += headLH;
    }
    y += 22;

    ctx.font = `34px ${FONT_BOLD}`;
    for (const p of points) {
      const textW = ctx.measureText(p).width;
      const pillW = Math.min(maxWidth, textW + 112);
      ctx.shadowBlur = 0;
      roundRect(ctx, PAD, y, pillW, pillH, pillH / 2);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 2;
      ctx.stroke();
      // 체크 표시 (흰 원 + 어두운 체크)
      const cx = PAD + 34;
      const cy = y + pillH / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 17, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - 8, cy + 1);
      ctx.lineTo(cx - 2, cy + 7);
      ctx.lineTo(cx + 9, cy - 6);
      ctx.strokeStyle = '#1F2430';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = `34px ${FONT_BOLD}`;
      ctx.shadowBlur = 8;
      ctx.fillText(p, PAD + 70, y + (pillH - 34) / 2 - 2);
      y += pillH + pillGap;
    }
  } else {
    const head = fitHeadline(ctx, copy.headline, maxWidth, 72);
    const subSize = 36;
    ctx.font = `${subSize}px ${FONT_BOLD}`;
    const subLines = copy.sub ? layoutLines(ctx, copy.sub, maxWidth).slice(0, 2) : [];
    const headLH = head.size * 1.25;
    const subLH = subSize * 1.35;
    const gap = subLines.length ? 14 : 0;
    const blockH = head.lines.length * headLH + gap + subLines.length * subLH;
    let y = position === 'top' ? PAD - 6 : S - PAD + 6 - blockH;

    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = `${head.size}px ${FONT_EXTRABOLD}`;
    for (const line of head.lines) {
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

    if (effective === 'badge' && copy.badge) {
      // 문구 반대쪽 오른쪽 모서리에 원형 배지
      const R = 96;
      const bx = S - PAD - R + 10;
      const by = position === 'top' ? S - PAD - R + 10 : PAD + R - 10;
      ctx.shadowColor = 'rgba(0,0,0,0.3)';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(bx, by, R, 0, Math.PI * 2);
      ctx.fillStyle = '#F5285C';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(bx, by, R - 9, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let bs = 44;
      ctx.font = `${bs}px ${FONT_EXTRABOLD}`;
      while (ctx.measureText(copy.badge).width > R * 1.55 && bs > 26) {
        bs -= 2;
        ctx.font = `${bs}px ${FONT_EXTRABOLD}`;
      }
      ctx.fillText(copy.badge, bx, by + 2);
    }
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

// 문구 레이아웃마다 비워둬야 하는 영역이 다르다
function textAreaNote(layout: ShotLayout, position: 'top' | 'bottom'): string {
  const side = position === 'top' ? '위쪽' : '아래쪽';
  const other = position === 'top' ? '아래쪽' : '위쪽 또는 중앙';
  if (layout === 'bullets') {
    return `이후 ${side} 45% 영역에 제목과 장점 목록을 얹을 예정이므로 그 영역은 단순하고 어두워져도 괜찮은 배경으로 비워두고, 상품은 ${other}에 크고 또렷하게 배치하세요.`;
  }
  if (layout === 'badge') {
    return `이후 ${side} 25% 영역에 문구를, 반대쪽 오른쪽 모서리에 지름 약 20%의 원형 배지를 얹을 예정이므로 그 두 곳은 단순한 배경으로 비워두고, 상품은 ${other}에 크고 또렷하게 배치하세요.`;
  }
  return `이후 ${side} 25% 영역에 문구를 얹을 예정이므로 그 영역은 단순하고 어두워져도 괜찮은 배경으로 비워두고, 상품은 ${other}에 크고 또렷하게 배치하세요.`;
}

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
  const layout: ShotLayout = input.shot.layout || 'caption';

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

구도: 정사각형(1:1). ${textAreaNote(layout, input.shot.textPosition)} 상품이 가려지거나 작아지면 안 됩니다.`;

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
  let base: Buffer = await sharp(Buffer.from(imagePart.inlineData.data, 'base64'))
    .resize({ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE, fit: 'cover' })
    .jpeg({ quality: 92 })
    .toBuffer();
  // AI가 원본 사진의 글자/아이콘을 다시 그려 넣는 경우를 검사해서 코드로 지운다 (문구는 이후에 우리가 합성)
  base = (await removeOverlays(base, 'image/jpeg')).buffer;

  if (!input.copy || !input.copy.headline) return base;
  return overlayThumbnailCopy(base, input.copy, input.shot.textPosition, layout);
}
