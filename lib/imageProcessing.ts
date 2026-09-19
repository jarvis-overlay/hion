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
// 'spec': 제품 사양 표 - 마케팅 문구가 아니라 라벨/값 목록을 입력받아
//   composeSpecTableSection으로 별도 처리한다 (generateDetailSectionImage
//   경로를 안 탐 - AI 사진 생성 자체가 필요 없음).
export type DetailSectionLayout = 'white' | 'overlay' | 'typography' | 'spec';
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
  badge?: string; // 작은 뱃지/라벨 문구 (선택, 예: "특허출원 신개념 처방")
  bodyText?: string; // 여러 줄 문단형 카피 (선택, 스토리텔링/비교 문구용)
  listItems?: string; // 줄바꿈으로 구분된 번호 매김 리스트 항목 (선택)
  colorPrompt?: string; // 제품 색상/디자인을 바꿔달라는 자유 지시 (선택)
  layoutStyle?: DetailSectionLayout;
  theme?: DetailSectionTheme;
}

async function generateBackgroundImage(
  keyword: string,
  mood: string,
  productImage: { buffer: Buffer; mimeType: string } | null,
  colorPrompt?: string
): Promise<Buffer> {
  const apiKey = requireEnv('GEMINI_API_KEY');

  const noTextRule =
    '**가장 중요한 규칙: 결과 이미지 안에는 그 어떤 문자·숫자·기호도 존재하면 안 됩니다.** 한국어든 중국어든 영어든 로고든 워터마크든 예외 없습니다. 이 규칙은 원본 사진에 이미 디자인 요소로 박혀 있는 텍스트(예: 판매용 사진에 얹혀있는 중국어 홍보 문구, 브랜드 로고, 워터마크, 각인, 라벨 글씨)에도 똑같이 적용됩니다 - 그런 텍스트가 보이면 지우거나 그리지 말고, 해당 영역을 자연스러운 배경/재질로 다시 채워서 완전히 안 보이게 만드세요. "글자를 다른 언어로 바꿔서 넣는 것"도 금지입니다 - 번역해서 넣는 게 아니라 아예 아무 글자도 없어야 합니다. 문구는 이후 단계에서 저희가 별도로 정확한 폰트로 합성할 예정이니, 지금 결과물은 순수하게 사진/배경/분위기만 있으면 됩니다.';

  // 기본은 "형태·색상·디자인 유지"지만, 사용자가 색상 변경을 직접
  // 요청했으면 그 지시를 우선한다 - 두 지시가 충돌하면 AI가 색을 안
  // 바꾸는 쪽으로 보수적으로 행동하는 걸 실측으로 확인해서, 색상
  // 유지 문구 자체를 조건부로 바꾼다.
  const colorRule = colorPrompt?.trim()
    ? `상품의 형태·디자인·구도는 그대로 유지하되, 색상은 다음 요청에 맞게 바꿔주세요: "${colorPrompt.trim()}"`
    : '상품의 실제 형태·색상·디자인은 최대한 그대로 유지하면서';

  const instruction = productImage
    ? `${noTextRule}

위 규칙을 지키면서, 아래 상품 사진을 그대로 활용해서 쿠팡 상세페이지에 들어갈 마케팅 배경 이미지를 만들어주세요. ${colorRule}, 배경과 분위기만 아래 키워드/분위기에 맞게 합성/편집해주세요. 원본 사진에 있던 문구·워터마크·로고는 이번 결과물에 절대 나오면 안 됩니다.

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
  | { kind: 'divider'; color: string; gapBefore: number }
  | { kind: 'badge'; text: string; fontSize: number; textColor: string; bgColor: string; gapBefore: number }
  | {
      kind: 'list';
      items: { number: string; lines: string[] }[];
      fontSize: number;
      numberColor: string;
      textColor: string;
      lineHeight: number;
      itemGap: number;
      gapBefore: number;
    };

// 둥근 사각형 경로 - node-canvas(이 버전)엔 ctx.roundRect가 없어서
// arcTo로 직접 그린다. 뱃지(badge) 배경에만 쓰인다.
function pathRoundedRect(ctx: CanvasCtx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

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

  if (input.badge?.trim()) {
    tiers.push({
      kind: 'badge',
      text: input.badge.trim(),
      fontSize: 17,
      textColor: colors.bgTop,
      bgColor: colors.text,
      gapBefore: tiers.length === 0 ? 0 : 20,
    });
  }

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

  // bodyText: 스토리텔링/비교 문구용 여러 줄 문단 (헤드라인보다 작고
  // 옅은 톤). listItems: 줄바꿈으로 구분한 번호 매김 피처 리스트.
  pushText(input.bodyText, {
    font: FONT_BOLD,
    fontSize: 20,
    color: colors.textMuted,
    tracking: 0,
    lineHeight: 32,
    maxCharsPerLine: 22,
    maxLines: 6,
    gapBefore: 24,
  });

  const listLines = (input.listItems || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (listLines.length > 0) {
    const items = listLines.map((line, i) => ({
      number: String(i + 1).padStart(2, '0'),
      lines: wrapText(line, 24).slice(0, 2),
    }));
    const lineHeight = 30;
    const itemGap = 18;
    tiers.push({
      kind: 'list',
      items,
      fontSize: 20,
      numberColor: colors.accent,
      textColor: colors.text,
      lineHeight,
      itemGap,
      gapBefore: tiers.length === 0 ? 0 : 28,
    });
  }

  let totalHeight = 0;
  for (const tier of tiers) {
    if (tier.kind === 'divider') totalHeight += tier.gapBefore + 24;
    else if (tier.kind === 'badge') totalHeight += tier.gapBefore + tier.fontSize + 22;
    else if (tier.kind === 'list') {
      const itemsHeight = tier.items.reduce((sum, item) => sum + item.lines.length * tier.lineHeight, 0);
      totalHeight += tier.gapBefore + itemsHeight + tier.itemGap * (tier.items.length - 1);
    } else totalHeight += tier.gapBefore + tier.lines.length * tier.lineHeight;
  }
  return { tiers, totalHeight };
}

function paintContentTiers(ctx: CanvasCtx, tiers: ContentTier[], centerX: number, startY: number, width: number) {
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

    if (tier.kind === 'badge') {
      ctx.font = `${tier.fontSize}px ${FONT_BOLD}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const textWidth = ctx.measureText(tier.text).width;
      const padX = 20;
      const badgeH = tier.fontSize + 22;
      const badgeW = textWidth + padX * 2;
      pathRoundedRect(ctx, centerX - badgeW / 2, y, badgeW, badgeH, badgeH / 2);
      ctx.fillStyle = tier.bgColor;
      ctx.fill();
      ctx.fillStyle = tier.textColor;
      ctx.fillText(tier.text, centerX, y + badgeH / 2);
      y += badgeH;
      continue;
    }

    if (tier.kind === 'list') {
      const listMargin = 64;
      const numColWidth = 44;
      const textX = centerX - width / 2 + listMargin + numColWidth;
      tier.items.forEach((item, idx) => {
        ctx.font = `${tier.fontSize}px ${FONT_EXTRABOLD}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = tier.numberColor;
        ctx.fillText(item.number, centerX - width / 2 + listMargin, y + tier.lineHeight / 2);
        ctx.font = `${tier.fontSize}px ${FONT_BOLD}`;
        ctx.fillStyle = tier.textColor;
        item.lines.forEach((line, i) => {
          ctx.fillText(line, textX, y + tier.lineHeight / 2 + i * tier.lineHeight);
        });
        y += item.lines.length * tier.lineHeight;
        if (idx < tier.items.length - 1) y += tier.itemGap;
      });
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

  paintContentTiers(ctx, tiers, width / 2, padY, width);

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

  paintContentTiers(ctx, tiers, width / 2, padY, width);

  return sharp(resizedImage)
    .composite([{ input: overlayCanvas.toBuffer('image/png'), top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

export interface SpecRow {
  label: string;
  value: string;
}

// "제품 사양" 표 - 마케팅 카피 섹션들과 달리 AI 생성 사진이 필요 없는
// 순수 정보 전달용 섹션이라 별도 함수로 분리한다. 레퍼런스(둥근 회색
// 카드, 라벨/값 2열, 얇은 구분선)를 일반화한 단일 스타일로 구현 -
// 레퍼런스 3종이 사실상 같은 "라벨:값" 구조라 스타일 선택지를 여러 개
// 만드는 대신 하나로 통일함.
export async function composeSpecTableSection(rows: SpecRow[], title?: string): Promise<Buffer> {
  ensureKoreanFontRegistered();
  const width = COUPANG_DETAIL_WIDTH;
  const cardMargin = 20;
  const cardPadX = 40;
  const cardPadY = 36;
  const titleFontSize = 28;
  const titleBlockHeight = titleFontSize + 30;
  const rowFontSize = 19;
  const rowLineHeight = 28;
  const rowPaddingY = 14;
  const labelColWidth = 150;
  const valueMaxCharsPerLine = 24;

  const titleText = title?.trim() || '제품 사양';
  const cardWidth = width - cardMargin * 2;
  const rowsWithLines = rows.map((r) => ({
    label: r.label.trim() || '-',
    lines: wrapText(r.value.trim() || '-', valueMaxCharsPerLine),
  }));
  const rowsHeight = rowsWithLines.reduce(
    (sum, r) => sum + Math.max(1, r.lines.length) * rowLineHeight + rowPaddingY * 2,
    0
  );
  const cardHeight = cardPadY + titleBlockHeight + rowsHeight + cardPadY;
  const height = cardMargin * 2 + cardHeight;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const cardX = cardMargin;
  const cardY = cardMargin;
  pathRoundedRect(ctx, cardX, cardY, cardWidth, cardHeight, 20);
  ctx.fillStyle = '#f5f4f2';
  ctx.fill();

  let y = cardY + cardPadY;
  ctx.font = `${titleFontSize}px ${FONT_EXTRABOLD}`;
  ctx.fillStyle = '#1c1c1c';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(titleText, cardX + cardPadX, y + titleFontSize);
  y += titleBlockHeight;

  for (const row of rowsWithLines) {
    const rh = Math.max(1, row.lines.length) * rowLineHeight + rowPaddingY * 2;

    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cardX + cardPadX, y);
    ctx.lineTo(cardX + cardWidth - cardPadX, y);
    ctx.stroke();

    ctx.font = `${rowFontSize}px ${FONT_BOLD}`;
    ctx.fillStyle = 'rgba(28,28,28,0.55)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(row.label, cardX + cardPadX, y + rh / 2);

    ctx.fillStyle = '#1c1c1c';
    const valueX = cardX + cardPadX + labelColWidth;
    row.lines.forEach((line, i) => {
      const ly = y + rowPaddingY + rowLineHeight / 2 + i * rowLineHeight;
      ctx.fillText(line, valueX, ly);
    });

    y += rh;
  }

  return sharp(canvas.toBuffer('image/png')).jpeg({ quality: 92 }).toBuffer();
}

export async function generateDetailSectionImage(
  input: DetailSectionInput,
  productImage: { buffer: Buffer; mimeType: string } | null
): Promise<Buffer> {
  const style = input.layoutStyle || 'white';

  if (style === 'typography') {
    return composeTypographySection(input);
  }

  const background = await generateBackgroundImage(input.keyword, input.mood, productImage, input.colorPrompt);

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

// "썸네일 제작" - 쿠팡 메인/서브 썸네일 규격(1000x1000, 흰 배경)에
// 맞춰 상품 컷아웃을 배치한다. remove.bg로 딴 누끼(투명 배경)를
// 트리밍해서 실제 상품 영역만 남긴 뒤, 원하는 위치에 배치하고 나머지는
// 순백색으로 채운다 - AI가 아니라 sharp로 결정적으로 처리해서
// "배경이 흰색이어야 한다"는 요구사항이 항상 정확하게 지켜진다.
export type ThumbnailPosition = 'center' | 'top' | 'bottom' | 'left' | 'right';
export const THUMBNAIL_SIZE = 1000;

export async function composeThumbnailImage(
  cutoutBuffer: Buffer,
  position: ThumbnailPosition = 'center'
): Promise<Buffer> {
  const SIZE = THUMBNAIL_SIZE;
  const marginRatio = 0.86; // 상품이 캔버스의 86%를 넘지 않게(여백 확보)
  const maxDim = Math.round(SIZE * marginRatio);
  const pad = Math.round((SIZE - maxDim) / 2);

  const trimmed = await sharp(cutoutBuffer).trim().toBuffer();
  const resized = await sharp(trimmed)
    .resize({ width: maxDim, height: maxDim, fit: 'inside' })
    .toBuffer();
  const meta = await sharp(resized).metadata();
  const w = meta.width || maxDim;
  const h = meta.height || maxDim;

  let left: number;
  let top: number;
  switch (position) {
    case 'top':
      left = Math.round((SIZE - w) / 2);
      top = pad;
      break;
    case 'bottom':
      left = Math.round((SIZE - w) / 2);
      top = SIZE - h - pad;
      break;
    case 'left':
      left = pad;
      top = Math.round((SIZE - h) / 2);
      break;
    case 'right':
      left = SIZE - w - pad;
      top = Math.round((SIZE - h) / 2);
      break;
    case 'center':
    default:
      left = Math.round((SIZE - w) / 2);
      top = Math.round((SIZE - h) / 2);
  }

  return sharp({
    create: { width: SIZE, height: SIZE, channels: 3, background: '#ffffff' },
  })
    .composite([{ input: resized, left, top }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

// 완성된 1000x1000 흰 배경 썸네일에 사용자가 요청한 효과(그림자,
// 조명, 계절 소품 등)를 AI로 추가하는 선택 단계 - 기본 흰 배경
// 컷아웃(composeThumbnailImage)은 항상 결정적으로 먼저 만들고, 이
// 함수는 그 결과물 위에 추가 편집을 요청할 때만 호출한다. 결과 크기가
// 정확히 1000x1000이 아닐 수 있어서 마지막에 다시 규격에 맞춘다.
export async function applyThumbnailEffect(imageBuffer: Buffer, effectPrompt: string): Promise<Buffer> {
  const apiKey = requireEnv('GEMINI_API_KEY');

  const instruction = `**절대 이미지 안에 어떤 문자·숫자·기호도 넣지 마세요.** 아래 상품 썸네일 사진에 요청한 효과만 추가해주세요. 상품 자체의 실제 형태·색상·디자인·비율은 절대 바꾸지 말고, 조명/그림자/배경 질감/소품 같은 연출 효과만 추가하세요. 쿠팡 상품 썸네일이라는 걸 감안해서 상품이 가려지거나 알아보기 어려워지면 안 됩니다.

효과 요청: ${effectPrompt}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_GEN_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: instruction },
              { inlineData: { mimeType: 'image/jpeg', data: imageBuffer.toString('base64') } },
            ],
          },
        ],
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
    throw new Error('효과 적용 결과를 받지 못했어요. 프롬프트를 조금 더 구체적으로 적어서 다시 시도해주세요.');
  }
  const edited = Buffer.from(imagePart.inlineData.data, 'base64');
  return sharp(edited)
    .resize({ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE, fit: 'cover' })
    .jpeg({ quality: 92 })
    .toBuffer();
}

// 1688 원본 사진은 보통 (1) 중국어 홍보 문구/워터마크가 얹혀있고,
// (2) 실제 판매 상품 옆에 다른 가구/소품이 같이 스타일링된 "연출컷"인
// 경우가 많다. remove.bg는 단순히 "전경 vs 배경"만 구분하는 매팅
// 도구라 이 두 문제를 둘 다 처리하지 못한다 - 실측해보니 (1) 문구가
// 크면 전경 판단 자체가 흐트러져 누끼가 아예 안 따지고, (2) 상품과
// 소품(예: 신발장 옆 책상)이 서로 맞닿아 있으면 소품까지 통째로
// "전경"으로 인식해서 같이 남겨버린다. remove.bg가 애초에 모르는
// "이 사진에서 실제로 파는 상품이 뭔지"는 Gemini가 훨씬 잘 판단하므로,
// remove.bg를 부르기 전에 Gemini에게 "판매 상품만 남기고 나머지는
// 전부 지워서 흰 배경으로" 정리를 맡긴다 - 그 결과물(이미 거의
// 흰 배경)을 remove.bg에 넘기면 매팅이 훨씬 쉬워지고 정확해진다.
async function cleanProductPhotoForCutout(
  imageBuffer: Buffer,
  mimeType: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  const apiKey = requireEnv('GEMINI_API_KEY');
  const instruction =
    '이 사진은 이커머스에서 실제로 판매하는 상품 하나를 촬영한 사진입니다. 아래 작업을 해주세요:\n\n1. 사진에서 **실제로 판매하는 메인 상품 하나만** 남기고, 함께 연출된 다른 가구·소품·장식(예: 상품 옆에 놓인 책상/테이블/화분 등)은 전부 지워주세요.\n2. 지운 자리와 나머지 배경은 전부 **순백색(#FFFFFF)**으로 채워주세요.\n3. **어떤 문자·숫자·기호도 남기지 마세요** - 한국어든 중국어든 영어든 로고든 워터마크든 전부 지워주세요.\n4. 남기는 상품 자체의 실제 형태·색상·디자인·비율은 절대 바꾸지 마세요.\n\n결과물은 "상품 하나 + 순백색 배경"이어야 합니다.';

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_GEN_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: instruction }, { inlineData: { mimeType, data: imageBuffer.toString('base64') } }],
          },
        ],
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
    // 정리 단계는 실패해도 원본으로 계속 진행할 수 있게 폴백한다 -
    // 누끼 자체가 아예 안 되는 것보다는 문구가 남더라도 진행하는 게 낫다.
    return { buffer: imageBuffer, mimeType };
  }
  return {
    buffer: Buffer.from(imagePart.inlineData.data, 'base64'),
    mimeType: imagePart.inlineData.mimeType || 'image/png',
  };
}

export interface GenerateThumbnailInput {
  productImage: { buffer: Buffer; mimeType: string };
  position: ThumbnailPosition;
  effectPrompt?: string;
}

// 문구/워터마크 정리 -> 누끼 -> 흰 배경 1000x1000 배치 -> (선택) 효과
// 추가, 순서로 처리한다.
export async function generateThumbnailImage(input: GenerateThumbnailInput): Promise<Buffer> {
  const cleaned = await cleanProductPhotoForCutout(input.productImage.buffer, input.productImage.mimeType);
  const cutout = await removeImageBackground(cleaned.buffer, cleaned.mimeType);
  const base = await composeThumbnailImage(cutout, input.position);
  if (input.effectPrompt?.trim()) {
    return applyThumbnailEffect(base, input.effectPrompt.trim());
  }
  return base;
}
