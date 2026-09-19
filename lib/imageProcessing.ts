// "판매" 대분류 - 1688 원본 이미지를 한국 판매용으로 가공하는 세 기능:
//   1) 번역: Gemini 비전으로 이미지 속 중국어 텍스트 위치+번역문을
//      한 번에 뽑아내고, sharp로 그 자리에 흰 박스+번역문을 합성한다
//      (OCR과 번역을 나누지 않고 비전 모델 한 번으로 처리).
//   2) 누끼: remove.bg API로 배경 제거.
//   3) 쿠팡 규격 리사이즈: AI 업스케일이 아니라 쿠팡 상세페이지
//      이미지가 요구하는 가로 860px 규격에 맞추는 단순 리사이즈라,
//      외부 API 없이 sharp로 로컬 처리한다.
//
// 1)/2)는 실제 서비스 키가 있어야 동작하고, 키가 없으면 명확한 한국어
// 에러로 바로 알려준다 (다른 lib 파일들과 동일한 requireEnv 패턴).
import sharp from 'sharp';
import { createCanvas, registerFont } from 'canvas';
import path from 'path';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} 환경변수가 설정 안 되어있어요.`);
  return v;
}

// sharp의 SVG 텍스트 렌더링은 시스템에 설치된 폰트에 의존하는데, Vercel
// 서버리스 환경엔 한글 폰트가 아예 없어서 글자가 빈 네모로 나오는 문제를
// 실측으로 확인했다(로컬 윈도우엔 한글 폰트가 있어서 로컬 테스트만으론
// 못 잡았음). node-canvas는 registerFont로 폰트 파일을 직접 읽어서
// 쓰기 때문에 시스템 폰트 설치 여부와 무관하게 항상 정확하게 렌더링
// 된다 - 그래서 텍스트가 들어가는 합성은 전부 canvas로 처리한다.
// 웹 화면(app/globals.css)과 동일하게 Pretendard를 쓴다 - 정적(비가변)
// weight별 파일이라 canvas/Cairo에서 굵기가 확실하게 반영된다.
const FONT_BOLD = 'PretendardBold';
const FONT_EXTRABOLD = 'PretendardExtraBold';
let fontRegistered = false;
function ensureKoreanFontRegistered() {
  if (fontRegistered) return;
  registerFont(path.join(process.cwd(), 'assets/fonts/Pretendard-Bold.otf'), { family: FONT_BOLD });
  registerFont(path.join(process.cwd(), 'assets/fonts/Pretendard-ExtraBold.otf'), { family: FONT_EXTRABOLD });
  fontRegistered = true;
}

// 긴 문구는 화면 폭에 맞게 여러 줄로 나눈다 (아주 단순한 어절 단위 wrap).
function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const next = current ? `${current} ${w}` : w;
    if (next.length > maxCharsPerLine && current) {
      lines.push(current);
      current = w;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [text];
}

export interface TranslatedRegion {
  // 이미지 전체 대비 0~1 비율 좌표 (해상도 무관하게 쓰기 위함)
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  originalText: string;
  translatedText: string;
}

// 실제 키로 테스트해보니 gemini-2.5-flash는 신규 키에 막혀있고
// gemini-3.6-flash를 쓰라고 안내함 - 모델명이 또 바뀔 수 있어서 환경
// 변수로 오버라이드 가능하게 함.
const VISION_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-3.6-flash';

// Gemini 비전 모델에게 이미지 속 텍스트 위치+원문+번역문을 한 번에
// 요청한다. 정확한 픽셀 좌표 대신 0~1 비율로 받아서(해상도 독립적),
// 합성 단계에서 실제 이미지 크기에 맞게 다시 환산한다.
export async function detectAndTranslateText(imageBuffer: Buffer, mimeType: string): Promise<TranslatedRegion[]> {
  const apiKey = requireEnv('GEMINI_API_KEY');
  const base64 = imageBuffer.toString('base64');

  const prompt = `이 이미지 안에 중국어 텍스트가 있으면 전부 찾아서, 각 텍스트 블록의 위치와 한국어 번역을 알려주세요.

반드시 아래 JSON 배열 형식으로만 응답하세요 (텍스트가 하나도 없으면 빈 배열 []):
[
  {
    "xMin": 0.0~1.0 사이 (이미지 왼쪽 기준 텍스트 블록 시작 비율),
    "yMin": 0.0~1.0 사이 (이미지 위쪽 기준 텍스트 블록 시작 비율),
    "xMax": 0.0~1.0 사이 (텍스트 블록 끝 비율),
    "yMax": 0.0~1.0 사이 (텍스트 블록 끝 비율),
    "originalText": "원문 그대로",
    "translatedText": "자연스러운 한국어 번역"
  }
]`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }, { inlineData: { mimeType, data: base64 } }],
          },
        ],
      }),
    }
  );
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message || `Gemini API 오류 (HTTP ${res.status})`);
  }

  const text: string = (json.candidates?.[0]?.content?.parts || [])
    .map((p: any) => p.text || '')
    .join('');
  const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  const jsonText = start !== -1 && end !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned;

  try {
    const parsed = JSON.parse(jsonText);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.error('[imageProcessing] Gemini 응답 파싱 실패:', text.slice(0, 500));
    throw new Error('이미지 속 텍스트 인식 결과를 해석하지 못했어요.');
  }
}

// 인식된 텍스트 영역마다 흰 박스를 깔고 번역문을 그 위에 그려서
// 원본 이미지에 합성한다. canvas로 오버레이 레이어를 그려서 sharp로
// 합치는 방식 - 폰트 파일을 직접 읽어 쓰므로 어떤 서버 환경에서도
// 글자가 정확하게 나온다.
export async function compositeTranslatedImage(
  imageBuffer: Buffer,
  regions: TranslatedRegion[]
): Promise<Buffer> {
  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width || 800;
  const height = meta.height || 800;

  if (regions.length === 0) {
    return sharp(imageBuffer).png().toBuffer();
  }

  ensureKoreanFontRegistered();
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  for (const r of regions) {
    const x = r.xMin * width;
    const y = r.yMin * height;
    const w = Math.max(1, (r.xMax - r.xMin) * width);
    const h = Math.max(1, (r.yMax - r.yMin) * height);
    const fontSize = Math.max(10, Math.min(h * 0.7, (w / Math.max(1, r.translatedText.length)) * 1.8));

    ctx.fillStyle = 'white';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'black';
    ctx.font = `${fontSize}px ${FONT_BOLD}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(r.translatedText, x + w / 2, y + h / 2);
  }

  return sharp(imageBuffer)
    .composite([{ input: canvas.toBuffer('image/png') }])
    .png()
    .toBuffer();
}

// remove.bg - image_url 방식은 remove.bg 서버가 우리 URL을 직접
// 가져가야 하는데, 호스트에 따라 못 가져오는 경우가 실측으로 확인돼서
// (핫링크 차단 등) 이미지 바이트를 직접 업로드하는 방식으로 처리한다.
export async function removeImageBackground(imageBuffer: Buffer, contentType: string): Promise<Buffer> {
  const apiKey = requireEnv('REMOVE_BG_API_KEY');

  const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
  const form = new FormData();
  form.append('image_file', new Blob([new Uint8Array(imageBuffer)], { type: contentType.split(';')[0] }), `image.${ext}`);
  form.append('size', 'auto');

  const res = await fetch('https://api.remove.bg/v1.0/removebg', {
    method: 'POST',
    headers: { 'X-Api-Key': apiKey },
    body: form,
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => null);
    throw new Error(errJson?.errors?.[0]?.title || `remove.bg 오류 (HTTP ${res.status})`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// "상세페이지 제작" - 섹션 하나(첨부 이미지 + 키워드/분위기/설명)를
// 근거로 상세페이지 한 장면을 만든다. 실측 결과 이미지 생성 모델이
// 한글을 깨진 글자로 렌더링하는 문제가 프롬프트 지시만으로는 해결이
// 안 돼서, 2단계로 나눈다:
//   1) Gemini에게는 "문구 없는" 배경/상품 합성 이미지만 만들게 한다
//      (키워드/분위기만 참고, 텍스트 렌더링은 아예 시키지 않음).
//   2) "설명"에 적은 문구는 AI가 그리게 하지 않고, sharp로 실제 폰트를
//      써서 우리가 직접 정확하게 합성한다 (번역 기능과 동일한 방식 -
//      글자가 깨질 수가 없음).
const IMAGE_GEN_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

// 'white': 기존 방식 - 흰 문구 섹션 + 그 아래 사진 (사진에는 글자 없음).
// 'overlay': 사진 위에 그라데이션 스크림을 깔고 그 위에 문구를 얹는다.
// 'typography': 사진 없이 그라데이션 배경 + 문구만으로 섹션 하나를 구성한다
//   (향수 브랜드 레퍼런스처럼 사진 없는 "카피 전용" 화면).
export type DetailSectionLayout = 'white' | 'overlay' | 'typography';
export type DetailSectionTheme = 'dark' | 'purple' | 'light';

export interface DetailSectionInput {
  keyword: string;
  mood: string;
  description: string; // 메인 헤드라인 문구 - AI가 아니라 우리가 직접 합성
  eyebrow?: string; // 헤드라인 위 작은 문구 (선택)
  accentTitle?: string; // 영문 브랜드/제품명 - 이탤릭 세리프로 강조 (선택)
  accentSubtitle?: string; // accentTitle 아래 한글 표기 (선택)
  stat?: string; // 강조 숫자/퍼센트 (선택, 예: "110%")
  statCaption?: string; // stat 아래 설명 문구 (선택)
  layoutStyle?: DetailSectionLayout;
  theme?: DetailSectionTheme;
}

async function generateBackgroundImage(
  keyword: string,
  mood: string,
  productImage: { buffer: Buffer; mimeType: string } | null
): Promise<Buffer> {
  const apiKey = requireEnv('GEMINI_API_KEY');

  const noTextRule =
    '**가장 중요한 규칙: 결과 이미지 안에는 그 어떤 문자·숫자·기호도 존재하면 안 됩니다.** 한국어든 중국어든 영어든 로고든 워터마크든 예외 없습니다. 이 규칙은 원본 사진에 이미 디자인 요소로 박혀 있는 텍스트(예: 판매용 사진에 얹혀있는 중국어 홍보 문구, 브랜드 로고, 워터마크, 각인, 라벨 글씨)에도 똑같이 적용됩니다 - 그런 텍스트가 보이면 지우거나 그리지 말고, 해당 영역을 자연스러운 배경/재질로 다시 채워서 완전히 안 보이게 만드세요. "글자를 다른 언어로 바꿔서 넣는 것"도 금지입니다 - 번역해서 넣는 게 아니라 아예 아무 글자도 없어야 합니다. 문구는 이후 단계에서 저희가 별도로 정확한 폰트로 합성할 예정이니, 지금 결과물은 순수하게 사진/배경/분위기만 있으면 됩니다.';

  const instruction = productImage
    ? `${noTextRule}

위 규칙을 지키면서, 아래 상품 사진을 그대로 활용해서 쿠팡 상세페이지에 들어갈 마케팅 배경 이미지를 만들어주세요. 상품의 실제 형태·색상·디자인은 최대한 그대로 유지하면서, 배경과 분위기만 아래 키워드/분위기에 맞게 합성/편집해주세요. 원본 사진에 있던 문구·워터마크·로고는 이번 결과물에 절대 나오면 안 됩니다.

키워드: ${keyword || '(없음)'}
분위기: ${mood || '(없음)'}`
    : `${noTextRule}

위 규칙을 지키면서, 아래 키워드/분위기에 맞는 쿠팡 상세페이지용 마케팅 배경 이미지를 새로 만들어주세요. 첨부된 상품 사진이 없으니, 상황에 맞는 이미지를 구성해주세요.

키워드: ${keyword || '(없음)'}
분위기: ${mood || '(없음)'}`;

  const parts: Record<string, unknown>[] = [{ text: instruction }];
  if (productImage) {
    parts.push({ inlineData: { mimeType: productImage.mimeType, data: productImage.buffer.toString('base64') } });
  }

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
  if (!res.ok) {
    throw new Error(json?.error?.message || `Gemini 이미지 생성 오류 (HTTP ${res.status})`);
  }

  const imagePart = (json.candidates?.[0]?.content?.parts || []).find((p: any) => p.inlineData?.data);
  if (!imagePart) {
    throw new Error('이미지 생성 결과를 받지 못했어요. 키워드/분위기를 조금 더 구체적으로 적어서 다시 시도해주세요.');
  }
  return Buffer.from(imagePart.inlineData.data, 'base64');
}

// node-canvas(Cairo)는 CSS letter-spacing을 지원 안 해서(실측 확인 -
// 'letterSpacing' in ctx === false), 자간을 좁히려면 글자를 하나씩
// 직접 그려서 수동으로 간격을 조절해야 한다. 촘촘한 기본 자간이
// 오히려 "안 다듬어진" 인상을 줘서, 살짝 좁혀서 더 정제된 느낌을 낸다.
function fillTextTracked(
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  text: string,
  centerX: number,
  y: number,
  tracking: number
) {
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const totalWidth = widths.reduce((a, b) => a + b, 0) + tracking * (chars.length - 1);
  const prevAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  let x = centerX - totalWidth / 2;
  chars.forEach((c, i) => {
    ctx.fillText(c, x, y);
    x += widths[i] + tracking;
  });
  ctx.textAlign = prevAlign;
}

// 실제 쿠팡/전문 상세페이지 레퍼런스를 참고해서 다시 만든 레이아웃 -
// 문구를 사진 위에 얹지 않고, 흰 배경의 독립된 "문구 섹션"을 만들어서
// 그 아래에 사진을 이어붙인다 (레퍼런스들도 전부 이 구조: 문구 구간과
// 사진 구간이 분리돼있고, 사진 위에는 글자가 전혀 없음). 레퍼런스
// 대비 처음 버전은 글자가 너무 굵고 크고 여백이 좁아서 예스러워
// 보인다는 피드백으로, 굵기를 낮추고(ExtraBold->Bold) 크기를
// 줄이고 여백을 넓혀서 더 정제된 느낌으로 다시 조정함.
export async function composeDetailSection(imageBuffer: Buffer, text: string): Promise<Buffer> {
  const resizedImage = await sharp(imageBuffer).resize({ width: COUPANG_DETAIL_WIDTH }).toBuffer();
  if (!text.trim()) {
    return sharp(resizedImage).jpeg({ quality: 90 }).toBuffer();
  }

  const imgMeta = await sharp(resizedImage).metadata();
  const width = imgMeta.width || COUPANG_DETAIL_WIDTH;
  const imgHeight = imgMeta.height || COUPANG_DETAIL_WIDTH;

  ensureKoreanFontRegistered();

  const maxCharsPerLine = 15;
  const lines = wrapText(text, maxCharsPerLine).slice(0, 2);
  const fontSize = Math.max(26, Math.min(36, (width / maxCharsPerLine) * 1.15));
  const tracking = -fontSize * 0.02;
  const lineHeight = fontSize * 1.5;
  const sectionPaddingY = fontSize * 2.6;
  const textSectionHeight = Math.round(lineHeight * lines.length + sectionPaddingY * 2);

  const textCanvas = createCanvas(width, textSectionHeight);
  const ctx = textCanvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, textSectionHeight);

  ctx.font = `${fontSize}px ${FONT_BOLD}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#1c1c1c';
  const textTop = sectionPaddingY;
  lines.forEach((line, i) => {
    const y = textTop + lineHeight / 2 + i * lineHeight;
    fillTextTracked(ctx, line, width / 2, y, tracking);
  });

  const totalHeight = textSectionHeight + imgHeight;
  return sharp({
    create: { width, height: totalHeight, channels: 3, background: '#ffffff' },
  })
    .composite([
      { input: textCanvas.toBuffer('image/png'), top: 0, left: 0 },
      { input: resizedImage, top: textSectionHeight, left: 0 },
    ])
    .jpeg({ quality: 90 })
    .toBuffer();
}

type CanvasCtx = ReturnType<ReturnType<typeof createCanvas>['getContext']>;

interface ThemeColors {
  bgTop: string;
  bgBottom: string;
  scrimTint: [number, number, number];
  text: string;
  textMuted: string;
  accent: string;
  divider: string;
}

// 향수 레퍼런스처럼 사진 없이 그라데이션 배경만으로 만드는 'typography'
// 섹션과, 사진 위에 그라데이션 스크림을 얹는 'overlay' 섹션이 공유하는
// 색상 팔레트. dark/purple은 흰 글자, light는 어두운 글자를 쓴다.
function getThemeColors(theme: DetailSectionTheme = 'dark'): ThemeColors {
  switch (theme) {
    case 'purple':
      return {
        bgTop: '#2c2049',
        bgBottom: '#0c0716',
        scrimTint: [26, 15, 46],
        text: '#ffffff',
        textMuted: 'rgba(255,255,255,0.75)',
        accent: '#c3a6f2',
        divider: 'rgba(255,255,255,0.35)',
      };
    case 'light':
      return {
        bgTop: '#faf7fb',
        bgBottom: '#efe6f5',
        scrimTint: [255, 255, 255],
        text: '#1c1c1c',
        textMuted: 'rgba(28,28,28,0.6)',
        accent: '#7c4fd1',
        divider: 'rgba(28,28,28,0.2)',
      };
    case 'dark':
    default:
      return {
        bgTop: '#1c1c1c',
        bgBottom: '#000000',
        scrimTint: [0, 0, 0],
        text: '#ffffff',
        textMuted: 'rgba(255,255,255,0.75)',
        accent: '#d8c8f5',
        divider: 'rgba(255,255,255,0.35)',
      };
  }
}

type ContentTier =
  | {
      kind: 'text';
      lines: string[];
      font: string;
      fontSize: number;
      color: string;
      tracking: number;
      lineHeight: number;
      gapBefore: number;
    }
  | { kind: 'divider'; color: string; gapBefore: number };

// eyebrow(작은 문구) - description(굵은 헤드라인) - 구분선 -
// accentTitle(영문 이탤릭) - accentSubtitle(한글 표기) - stat(강조 숫자)
// - statCaption 순서로, 채워진 필드만 쌓아 올리는 계층형 문구 블록.
// 레퍼런스(향수 브랜드 상세페이지)의 "여러 톤이 섞인 카피" 구조를
// 일반화한 것 - 전부 선택 항목이라 비어있는 필드는 그냥 건너뛴다.
function buildContentTiers(
  input: DetailSectionInput,
  colors: ThemeColors
): { tiers: ContentTier[]; totalHeight: number } {
  const tiers: ContentTier[] = [];

  function pushText(
    raw: string | undefined,
    opts: {
      font: string;
      fontSize: number;
      color: string;
      tracking: number;
      lineHeight: number;
      maxCharsPerLine: number;
      maxLines: number;
      gapBefore: number;
    }
  ) {
    const text = raw?.trim();
    if (!text) return;
    const lines = wrapText(text, opts.maxCharsPerLine).slice(0, opts.maxLines);
    tiers.push({
      kind: 'text',
      lines,
      font: opts.font,
      fontSize: opts.fontSize,
      color: opts.color,
      tracking: opts.tracking,
      lineHeight: opts.lineHeight,
      gapBefore: tiers.length === 0 ? 0 : opts.gapBefore,
    });
  }

  pushText(input.eyebrow, {
    font: FONT_BOLD,
    fontSize: 21,
    color: colors.textMuted,
    tracking: 0,
    lineHeight: 30,
    maxCharsPerLine: 20,
    maxLines: 2,
    gapBefore: 0,
  });
  pushText(input.description, {
    font: FONT_BOLD,
    fontSize: 33,
    color: colors.text,
    tracking: -0.7,
    lineHeight: 46,
    maxCharsPerLine: 15,
    maxLines: 2,
    gapBefore: 16,
  });

  const hasIntro = tiers.length > 0;
  const hasAccentBlock = !!(input.accentTitle?.trim() || input.stat?.trim());
  if (hasIntro && hasAccentBlock) {
    tiers.push({ kind: 'divider', color: colors.divider, gapBefore: 28 });
  }

  pushText(input.accentTitle, {
    // 별도 이탤릭 세리프 폰트를 시도했으나 로컬(Windows GDI)에서 TTF
    // 계열 폰트 로딩 자체가 실패하는 게 실측으로 확인돼서(OTF인
    // Pretendard만 안전하게 검증됨), 검증 안 된 폰트를 배포하는 대신
    // Pretendard를 작은 크기+넓은 자간+포인트 컬러로 스타일링해서
    // "브랜드명" 톤을 구분한다.
    font: FONT_BOLD,
    fontSize: 26,
    color: colors.accent,
    tracking: 1.5,
    lineHeight: 36,
    maxCharsPerLine: 40,
    maxLines: 1,
    gapBefore: 28,
  });
  pushText(input.accentSubtitle, {
    font: FONT_BOLD,
    fontSize: 19,
    color: colors.accent,
    tracking: 0,
    lineHeight: 28,
    maxCharsPerLine: 20,
    maxLines: 1,
    gapBefore: 6,
  });
  pushText(input.stat, {
    font: FONT_EXTRABOLD,
    fontSize: 56,
    color: colors.text,
    tracking: 0,
    lineHeight: 64,
    maxCharsPerLine: 20,
    maxLines: 1,
    gapBefore: 28,
  });
  pushText(input.statCaption, {
    font: FONT_BOLD,
    fontSize: 22,
    color: colors.text,
    tracking: -0.3,
    lineHeight: 32,
    maxCharsPerLine: 16,
    maxLines: 2,
    gapBefore: 10,
  });

  let totalHeight = 0;
  for (const tier of tiers) {
    totalHeight += tier.gapBefore + (tier.kind === 'divider' ? 24 : tier.lines.length * tier.lineHeight);
  }
  return { tiers, totalHeight };
}

function paintContentTiers(ctx: CanvasCtx, tiers: ContentTier[], centerX: number, startY: number) {
  let y = startY;
  for (const tier of tiers) {
    y += tier.gapBefore;
    if (tier.kind === 'divider') {
      const dh = 24;
      ctx.fillStyle = tier.color;
      ctx.fillRect(centerX - 18, y + dh / 2 - 1, 36, 1.5);
      y += dh;
      continue;
    }
    ctx.font = `${tier.fontSize}px ${tier.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = tier.color;
    tier.lines.forEach((line, i) => {
      const ly = y + tier.lineHeight / 2 + i * tier.lineHeight;
      if (tier.tracking) fillTextTracked(ctx, line, centerX, ly, tier.tracking);
      else ctx.fillText(line, centerX, ly);
    });
    y += tier.lines.length * tier.lineHeight;
  }
}

// 사진 없이 그라데이션 배경 + 문구만으로 섹션 하나를 완성한다. Gemini
// 이미지 생성 호출 자체가 없어서 (1) 중국어 잔존 위험이 원천적으로
// 없고 (2) 실패/쿼터 걱정 없이 항상 빠르고 정확하게 나온다.
export async function composeTypographySection(input: DetailSectionInput): Promise<Buffer> {
  ensureKoreanFontRegistered();
  const colors = getThemeColors(input.theme);
  const width = COUPANG_DETAIL_WIDTH;
  const { tiers, totalHeight } = buildContentTiers(input, colors);
  const padY = 90;
  const height = Math.max(400, Math.round(totalHeight + padY * 2));

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, colors.bgTop);
  grad.addColorStop(1, colors.bgBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  paintContentTiers(ctx, tiers, width / 2, padY);

  return sharp(canvas.toBuffer('image/png')).jpeg({ quality: 92 }).toBuffer();
}

// 사진 위에 그라데이션 스크림을 깔고 그 위에 문구를 얹는다 (사진에는
// 여전히 AI가 글자를 그리지 않음 - 스크림+문구는 우리가 직접 합성).
export async function composeOverlaySection(imageBuffer: Buffer, input: DetailSectionInput): Promise<Buffer> {
  const resizedImage = await sharp(imageBuffer).resize({ width: COUPANG_DETAIL_WIDTH }).toBuffer();
  const meta = await sharp(resizedImage).metadata();
  const width = meta.width || COUPANG_DETAIL_WIDTH;
  const imgHeight = meta.height || COUPANG_DETAIL_WIDTH;

  ensureKoreanFontRegistered();
  const colors = getThemeColors(input.theme);
  const { tiers, totalHeight } = buildContentTiers(input, colors);
  if (tiers.length === 0) {
    return sharp(resizedImage).jpeg({ quality: 90 }).toBuffer();
  }

  const padY = 56;
  const scrimContentHeight = totalHeight + padY * 2;
  const scrimFadeHeight = Math.min(imgHeight, scrimContentHeight + 120);

  const overlayCanvas = createCanvas(width, imgHeight);
  const ctx = overlayCanvas.getContext('2d');
  const [r, g, b] = colors.scrimTint;
  const grad = ctx.createLinearGradient(0, 0, 0, scrimFadeHeight);
  grad.addColorStop(0, `rgba(${r},${g},${b},0.82)`);
  grad.addColorStop(Math.min(1, scrimContentHeight / scrimFadeHeight), `rgba(${r},${g},${b},0.55)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, scrimFadeHeight);

  paintContentTiers(ctx, tiers, width / 2, padY);

  return sharp(resizedImage)
    .composite([{ input: overlayCanvas.toBuffer('image/png'), top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

export async function generateDetailSectionImage(
  input: DetailSectionInput,
  productImage: { buffer: Buffer; mimeType: string } | null
): Promise<Buffer> {
  const style = input.layoutStyle || 'white';

  if (style === 'typography') {
    return composeTypographySection(input);
  }

  const background = await generateBackgroundImage(input.keyword, input.mood, productImage);

  if (style === 'overlay') {
    return composeOverlaySection(background, input);
  }

  return composeDetailSection(background, input.description.trim());
}

// 쿠팡 상세페이지 이미지 규격(가로 860px)에 맞춘다 - AI 업스케일이
// 아니라 단순 리사이즈라 외부 API 없이 sharp로 로컬 처리한다. 원본이
// 860px보다 작아도 규격을 맞추기 위해 확대까지 허용한다(화질 손실은
// 감수 - 애초에 원본이 작으면 어쩔 수 없음).
export const COUPANG_DETAIL_WIDTH = 860;

export async function resizeForCoupang(imageBuffer: Buffer): Promise<Buffer> {
  return sharp(imageBuffer).resize({ width: COUPANG_DETAIL_WIDTH }).jpeg({ quality: 90 }).toBuffer();
}
