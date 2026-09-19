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

export interface DetailSectionInput {
  keyword: string;
  mood: string;
  description: string; // 이미지에 그대로 얹을 문구 - AI가 아니라 우리가 직접 합성
}

async function generateBackgroundImage(
  keyword: string,
  mood: string,
  productImage: { buffer: Buffer; mimeType: string } | null
): Promise<Buffer> {
  const apiKey = requireEnv('GEMINI_API_KEY');

  const noTextRule =
    '**절대 이미지 안에 어떤 문구·텍스트·글자도 넣지 마세요.** 문구는 이후 단계에서 별도로 정확하게 합성할 예정이라, 지금은 순수하게 사진/배경/분위기만 만들어야 합니다. 원본 사진에 중국어 등 외국어 텍스트가 있다면 전부 지우고 깨끗한 배경으로 바꿔주세요.';

  const instruction = productImage
    ? `아래 상품 사진을 그대로 활용해서, 쿠팡 상세페이지에 들어갈 마케팅 배경 이미지를 만들어주세요. 상품의 실제 형태·색상·디자인은 최대한 그대로 유지하면서, 배경과 분위기만 아래 키워드/분위기에 맞게 합성/편집해주세요.

${noTextRule}

키워드: ${keyword || '(없음)'}
분위기: ${mood || '(없음)'}`
    : `아래 키워드/분위기에 맞는 쿠팡 상세페이지용 마케팅 배경 이미지를 새로 만들어주세요. 첨부된 상품 사진이 없으니, 상황에 맞는 이미지를 구성해주세요.

${noTextRule}

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

// AI가 만든 "문구 없는" 배경 위에, 실제 폰트로 문구를 상단 배너
// 형태로 정확하게 합성한다 - 글자가 깨질 수 없는 방식. 밋밋한 단색
// 박스 대신 위->아래로 옅어지는 그라데이션 + 그림자로 사진에 자연스럽게
// 녹아들게 하고, 문구 아래 얇은 포인트 라인으로 마무리한다.
export async function compositeHeadlineText(imageBuffer: Buffer, text: string): Promise<Buffer> {
  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width || 800;
  const height = meta.height || 800;

  const maxCharsPerLine = 13;
  const lines = wrapText(text, maxCharsPerLine).slice(0, 3);
  const fontSize = Math.max(26, Math.min(60, (width / maxCharsPerLine) * 1.55));
  const lineHeight = fontSize * 1.35;
  const paddingY = fontSize * 0.9;
  const bannerHeight = Math.min(height * 0.42, lineHeight * lines.length + paddingY);

  ensureKoreanFontRegistered();
  const canvas = createCanvas(width, Math.round(bannerHeight));
  const ctx = canvas.getContext('2d');

  // 사진 위에 자연스럽게 얹히도록 위쪽이 진하고 아래로 갈수록 옅어지는
  // 그라데이션 (배너 경계선이 딱 잘린 느낌이 안 나게 함)
  const gradient = ctx.createLinearGradient(0, 0, 0, bannerHeight);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.72)');
  gradient.addColorStop(0.75, 'rgba(0, 0, 0, 0.45)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, bannerHeight);

  const textBlockHeight = lineHeight * lines.length;
  const textTop = paddingY * 0.45;

  ctx.font = `${fontSize}px ${FONT_EXTRABOLD}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = fontSize * 0.25;
  ctx.shadowOffsetY = fontSize * 0.06;
  ctx.fillStyle = 'white';
  lines.forEach((line, i) => {
    const y = textTop + lineHeight / 2 + i * lineHeight;
    ctx.fillText(line, width / 2, y);
  });
  ctx.shadowColor = 'transparent';

  // 문구 아래 얇은 포인트 라인으로 배너를 정리
  const lineY = textTop + textBlockHeight + fontSize * 0.28;
  const accentWidth = Math.min(width * 0.18, 120);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = Math.max(2, fontSize * 0.045);
  ctx.beginPath();
  ctx.moveTo(width / 2 - accentWidth / 2, lineY);
  ctx.lineTo(width / 2 + accentWidth / 2, lineY);
  ctx.stroke();

  return sharp(imageBuffer)
    .composite([{ input: canvas.toBuffer('image/png'), top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

export async function generateDetailSectionImage(
  input: DetailSectionInput,
  productImage: { buffer: Buffer; mimeType: string } | null
): Promise<Buffer> {
  const background = await generateBackgroundImage(input.keyword, input.mood, productImage);
  if (!input.description.trim()) return background;
  return compositeHeadlineText(background, input.description.trim());
}

// 쿠팡 상세페이지 이미지 규격(가로 860px)에 맞춘다 - AI 업스케일이
// 아니라 단순 리사이즈라 외부 API 없이 sharp로 로컬 처리한다. 원본이
// 860px보다 작아도 규격을 맞추기 위해 확대까지 허용한다(화질 손실은
// 감수 - 애초에 원본이 작으면 어쩔 수 없음).
export const COUPANG_DETAIL_WIDTH = 860;

export async function resizeForCoupang(imageBuffer: Buffer): Promise<Buffer> {
  return sharp(imageBuffer).resize({ width: COUPANG_DETAIL_WIDTH }).jpeg({ quality: 90 }).toBuffer();
}
