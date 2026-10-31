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
import { fetchCoupangBestsellers } from './brightdata';
import { FONT_BOLD, FONT_EXTRABOLD, ensureKoreanFontRegistered } from './fonts';
import {
  composeDetailSection,
  composeTypographySection,
  composeOverlaySection,
  composeSpecTableSection,
  composeSizeTableSection,
  type DetailSectionInput,
} from './detailRender';
import { DETAIL_IMAGE_WIDTH, THUMBNAIL_IMAGE_SIZE } from './imageSpecs';
import { packageGrid } from './thumbnailPackage';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} 환경변수가 설정 안 되어있어요.`);
  return v;
}

// 1688 상품 페이지는 로그인 없인 못 열지만, 거기 박힌 사진 CDN 링크
// 자체(img.alicdn.com 등)는 로그인 없이도 공개 접근되는 걸 실측으로
// 확인함 - 파일 업로드 대신 "이미지 URL 붙여넣기"로 바로 가져올 수
// 있게 하는 공용 헬퍼. 이미지가 아닌 URL을 넣는 실수를 바로 잡아주기
// 위해 content-type을 확인한다.
export async function fetchImageFromUrl(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e: any) {
    throw new Error(`이미지 URL에 접속하지 못했어요: ${e?.message || String(e)}`);
  }
  if (!res.ok) throw new Error(`이미지 URL을 불러오지 못했어요 (HTTP ${res.status})`);
  const contentType = (res.headers.get('content-type') || '').split(';')[0];
  if (!contentType.startsWith('image/')) {
    throw new Error('이 URL은 이미지가 아니에요. 이미지 파일 주소(끝이 .jpg/.png 등)가 맞는지 확인해주세요.');
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, mimeType: contentType };
}

// 쿠팡에서 실제로 잘 팔리는 경쟁 상품 사진을 AI 생성 호출에 "스타일
// 참고용"으로 같이 넣어주기 위한 헬퍼. 프로젝트에 카테고리/검색어를
// 입력해둔 경우에만 호출되고, 실패하거나 이미지가 없으면 빈 배열을
// 돌려줘서 참고 없이도 생성 자체는 항상 계속 진행되게 한다.
export async function fetchTopSellerReferenceImages(
  category: string,
  limit = 2
): Promise<{ buffer: Buffer; mimeType: string }[]> {
  const q = category.trim();
  if (!q) return [];
  try {
    const bestsellers = await fetchCoupangBestsellers(q, limit * 3);
    const candidates = bestsellers.filter((b) => b.imageUrl).slice(0, limit);
    const fetched = await Promise.all(
      candidates.map(async (b) => {
        try {
          return await fetchImageFromUrl(b.imageUrl!);
        } catch {
          return null;
        }
      })
    );
    return fetched.filter((f): f is { buffer: Buffer; mimeType: string } => f !== null);
  } catch (e) {
    console.error('[imageProcessing] 인기상품 레퍼런스 조회 실패:', e);
    return [];
  }
}

export { FONT_BOLD, FONT_EXTRABOLD, ensureKoreanFontRegistered };


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
export const VISION_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-3.6-flash';

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

// remove.bg는 월 무료 호출이 금방 바닥나는데, 이 함수를 부르기 직전
// cleanProductPhotoForCutout에서 Gemini가 이미 배경을 거의 순백색으로
// 정리해준 상태라 - "흰색에 가까운 픽셀을 투명하게" 만드는 단순한
// 색상 기반 처리만으로도 쓸만한 누끼가 나온다(API 호출/비용 없음).
// remove.bg처럼 "이게 진짜 제품인지 배경인지"를 의미적으로 구분하진
// 못해서, 제품 자체에 흰색/아주 밝은 색 부분(흰 티셔츠 등)이 있으면
// 그 부분도 같이 투명해질 수 있다 - 품질이 안 좋으면 아래 호출부를
// removeImageBackground(remove.bg)로 다시 바꾸면 된다.
async function removeWhiteBackground(imageBuffer: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(imageBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  // 거리가 WHITE_LOW 이하면 배경(완전 투명), WHITE_HIGH 이상이면 제품
  // (완전 불透명), 그 사이는 경계선 안티에일리어싱을 위해 선형 보간한다.
  const WHITE_LOW = 18;
  const WHITE_HIGH = 60;
  for (let i = 0; i < data.length; i += channels) {
    const distance = 255 - Math.min(data[i], data[i + 1], data[i + 2]);
    let alpha: number;
    if (distance <= WHITE_LOW) alpha = 0;
    else if (distance >= WHITE_HIGH) alpha = 255;
    else alpha = Math.round(((distance - WHITE_LOW) / (WHITE_HIGH - WHITE_LOW)) * 255);
    data[i + 3] = Math.min(data[i + 3], alpha);
  }

  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
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
export const IMAGE_GEN_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

export type { DetailSectionLayout, DetailSectionTheme, DetailSectionInput, SpecRow, SizeTable, BrandPalette } from './detailRender';
export { composeSpecTableSection, composeSizeTableSection };

// 이미지 생성 모델은 "그대로 유지하라"는 지시만으로는 발받침대 같은 작은
// 부품을 자주 놓친다(실측: 프롬프트 강화 후에도 트레이의 바닥 발이
// 사라짐). 그래서 생성 전에 비전 모델이 상품 사진의 구조를 먼저 글로
// 정확히 명세하게 하고, 그 명세를 생성 지시에 박아 넣는다. 실패해도
// 생성 자체는 막지 않도록 null을 돌려준다.
export async function describeProductAppearance(productImage: {
  buffer: Buffer;
  mimeType: string;
}): Promise<string | null> {
  try {
    const apiKey = requireEnv('GEMINI_API_KEY');
    const prompt = `이 사진 속 판매 상품의 외형을 다른 사람이 사진 없이도 똑같이 그릴 수 있도록 한국어 글머리표로 정확히 명세해주세요. 사진 속 글자·로고·배경은 언급하지 마세요.
반드시 포함할 항목:
- 전체 형태와 대략적인 비율 (예: 원형 트레이, 높이 대비 지름)
- 주 재질/색상과 표면 질감 (주름·골·광택 등)
- 바닥의 발받침대·고무발·다리·받침: 있으면 개수, 색, 모양, 위치, 바닥에서 얼마나 띄우는지
- 손잡이·뚜껑·구멍·홈·테두리 등 작은 부품이 있으면 각각의 위치와 모양
- 사진에서 가려져 있거나 일부만 보이는 부품이 있으면 그렇다고 명시
없는 부품을 지어내지 말고 보이는 것만 적으세요. 10줄 이내.`;
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inlineData: { mimeType: productImage.mimeType, data: productImage.buffer.toString('base64') } },
                { text: prompt },
              ],
            },
          ],
        }),
      }
    );
    const json = await res.json();
    if (!res.ok) return null;
    const text: string = (json.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('').trim();
    return text || null;
  } catch (e) {
    console.error('[imageProcessing] 상품 외형 명세 실패:', e);
    return null;
  }
}

async function generateBackgroundImage(
  keyword: string,
  mood: string,
  productImage: { buffer: Buffer; mimeType: string } | null,
  colorPrompt?: string,
  referenceImages: { buffer: Buffer; mimeType: string }[] = []
): Promise<Buffer> {
  const apiKey = requireEnv('GEMINI_API_KEY');
  const appearanceSpec = productImage ? await describeProductAppearance(productImage) : null;

  // 프로젝트에 카테고리를 입력해둔 경우, 쿠팡에서 실제로 잘 팔리는
  // 경쟁 상품 사진을 같이 넣어서 "그 상품을 베끼라"가 아니라 "왜 잘
  // 팔리는지에 기여하는 구도/분위기/연출 스타일만 참고하라"고 못박는다.
  const referenceRule =
    referenceImages.length > 0
      ? `\n\n[참고용 - 이 카테고리에서 실제로 잘 팔리는 경쟁 상품 사진 ${referenceImages.length}장이 먼저 첨부돼 있습니다] 그 사진 속 상품이나 문구를 그대로 베끼면 절대 안 됩니다. 다만 구도·배경 연출·조명 톤·여백 사용처럼 "이 카테고리에서 잘 팔리는 사진이 공통적으로 갖는 스타일 요소"는 참고해서, 아래 상품 사진에 녹여주세요.`
      : '';

  const noTextRule =
    '**가장 중요한 규칙: 결과 이미지 안에는 그 어떤 문자·숫자·기호도 존재하면 안 됩니다.** 한국어든 중국어든 영어든 로고든 워터마크든 예외 없습니다. 이 규칙은 원본 사진에 이미 디자인 요소로 박혀 있는 텍스트(예: 판매용 사진에 얹혀있는 중국어 홍보 문구, 브랜드 로고, 워터마크, 각인, 라벨 글씨)에도 똑같이 적용됩니다 - 그런 텍스트가 보이면 지우거나 그리지 말고, 해당 영역을 자연스러운 배경/재질로 다시 채워서 완전히 안 보이게 만드세요. "글자를 다른 언어로 바꿔서 넣는 것"도 금지입니다 - 번역해서 넣는 게 아니라 아예 아무 글자도 없어야 합니다. 문구는 이후 단계에서 저희가 별도로 정확한 폰트로 합성할 예정이니, 지금 결과물은 순수하게 사진/배경/분위기만 있으면 됩니다.';

  // 기본은 "형태·색상·디자인 유지"지만, 사용자가 색상 변경을 직접
  // 요청했으면 그 지시를 우선한다 - 두 지시가 충돌하면 AI가 색을 안
  // 바꾸는 쪽으로 보수적으로 행동하는 걸 실측으로 확인해서, 색상
  // 유지 문구 자체를 조건부로 바꾼다.
  const colorRule = colorPrompt?.trim()
    ? `상품의 형태·디자인·구도는 그대로 유지하되, 색상은 다음 요청에 맞게 바꿔주세요: "${colorPrompt.trim()}"`
    : '상품의 실제 형태·색상·디자인은 최대한 그대로 유지하면서';

  // 실측: "형태 유지"만 적으면 모델이 상품을 단순화해서 새로 그려버려
  // 발받침대/다리/손잡이/뚜껑 같은 작은 부품이 사라졌다. 판매 상품은
  // 실물과 다르면 안 되므로(허위 표시·반품 사유), 구조 요소를 명시적으로
  // 나열해서 하나도 빼거나 바꾸지 못하게 못박는다.
  const fidelityRule =
    '**상품 외형 보존 규칙(필수):** 첨부된 상품 사진 속 상품은 실제 판매할 실물이므로, 새로 디자인하거나 단순화하지 말고 사진 속 그 물건을 그대로 옮겨오세요. 특히 바닥의 발받침대·고무발·다리·받침, 손잡이, 뚜껑, 주름·골·홈 같은 표면 질감, 모서리 형태, 비율, 개수, 색상은 하나도 빼거나 바꾸거나 추가하지 마세요. 원본에서 작은 부품이 보이면 결과물에서도 반드시 같은 모양·위치로 보여야 하며, 부품이 보이도록 상품을 약간 위에서 내려다보거나 바닥면이 드러나는 각도로 배치해도 좋습니다. 상품이 여러 개 나오는 구도라도 모든 상품이 원본과 동일한 외형이어야 합니다.';

  const instruction = productImage
    ? `${noTextRule}

${fidelityRule}${
        appearanceSpec
          ? `\n\n[상품 외형 명세 - 결과물 속 모든 상품이 반드시 이 명세와 일치해야 합니다. 특히 바닥 부품은 상품과 바닥면 사이에 눈에 보이게 그려주세요]\n${appearanceSpec}`
          : ''
      }${referenceRule}

위 규칙을 지키면서, 아래 상품 사진을 그대로 활용해서 쿠팡 상세페이지에 들어갈 마케팅 배경 이미지를 만들어주세요. ${colorRule}, 배경과 분위기만 아래 키워드/분위기에 맞게 합성/편집해주세요. 원본 사진에 있던 문구·워터마크·로고는 이번 결과물에 절대 나오면 안 됩니다.

키워드: ${keyword || '(없음)'}
분위기: ${mood || '(없음)'}`
    : `${noTextRule}${referenceRule}

위 규칙을 지키면서, 아래 키워드/분위기에 맞는 쿠팡 상세페이지용 마케팅 배경 이미지를 새로 만들어주세요. 첨부된 상품 사진이 없으니, 상황에 맞는 이미지를 구성해주세요.

키워드: ${keyword || '(없음)'}
분위기: ${mood || '(없음)'}`;

  // 참고 이미지(있으면) -> 상품 사진 -> 지시문 순서로 둔다 - 이미지
  // 편집 계열 모델은 지시문을 마지막에 둘 때 이미지들을 더 충실히
  // 따르고, 지시문 안에서 "먼저 첨부된 참고 사진들"이라고 명시했으므로
  // 참고 이미지를 상품 사진보다 앞에 둬야 그 설명과 순서가 맞는다.
  const parts: Record<string, unknown>[] = [];
  for (const ref of referenceImages) {
    parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.buffer.toString('base64') } });
  }
  if (productImage) {
    parts.push({ inlineData: { mimeType: productImage.mimeType, data: productImage.buffer.toString('base64') } });
  }
  parts.push({ text: instruction });

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

// 섹션 이미지는 "AI가 만든 배경 사진"과 "서버에서 합성하는 문구" 두 단계다.
// 생성된 섹션을 나중에 수정할 때 문구/디자인만 바꾸는 경우엔 배경 사진을
// 다시 만들 필요가 없으므로(비용 + 사진이 바뀌는 문제), 두 단계를 따로
// 쓸 수 있게 분리해둔다. 배경은 항상 JPEG로 정규화해서 보관/재사용한다.
export async function generateDetailBackground(
  input: DetailSectionInput,
  productImage: { buffer: Buffer; mimeType: string } | null,
  referenceImages: { buffer: Buffer; mimeType: string }[] = []
): Promise<Buffer> {
  const raw = await generateBackgroundImage(input.keyword, input.mood, productImage, input.colorPrompt, referenceImages);
  return sharp(raw).jpeg({ quality: 92 }).toBuffer();
}

// background는 typography(사진 없는 레이아웃)에선 쓰지 않으므로 null이어도 된다.
export async function composeDetailSectionImage(
  input: DetailSectionInput,
  background: Buffer | null
): Promise<Buffer> {
  const style = input.layoutStyle || 'white';

  if (style === 'typography') {
    return composeTypographySection(input);
  }
  if (!background) {
    throw new Error('배경 이미지가 없어서 합성할 수 없어요.');
  }
  if (style === 'overlay') {
    return composeOverlaySection(background, input);
  }
  return composeDetailSection(background, input);
}

export async function generateDetailSectionImage(
  input: DetailSectionInput,
  productImage: { buffer: Buffer; mimeType: string } | null
): Promise<Buffer> {
  const background =
    (input.layoutStyle || 'white') === 'typography' ? null : await generateDetailBackground(input, productImage);
  return composeDetailSectionImage(input, background);
}

// 쿠팡 상세페이지 이미지 규격(가로 860px)에 맞춘다 - AI 업스케일이
// 아니라 단순 리사이즈라 외부 API 없이 sharp로 로컬 처리한다. 원본이
// 860px보다 작아도 규격을 맞추기 위해 확대까지 허용한다(화질 손실은
// 감수 - 애초에 원본이 작으면 어쩔 수 없음).
export const COUPANG_DETAIL_WIDTH = DETAIL_IMAGE_WIDTH;

export async function resizeForCoupang(imageBuffer: Buffer): Promise<Buffer> {
  return sharp(imageBuffer).resize({ width: COUPANG_DETAIL_WIDTH }).jpeg({ quality: 90 }).toBuffer();
}

// "썸네일 제작" - 쿠팡 메인/서브 썸네일 규격(1000x1000, 흰 배경)에
// 맞춰 상품 컷아웃을 배치한다. remove.bg로 딴 누끼(투명 배경)를
// 트리밍해서 실제 상품 영역만 남긴 뒤, 원하는 위치에 배치하고 나머지는
// 순백색으로 채운다 - AI가 아니라 sharp로 결정적으로 처리해서
// "배경이 흰색이어야 한다"는 요구사항이 항상 정확하게 지켜진다.
export type ThumbnailPosition = 'center' | 'top' | 'bottom' | 'left' | 'right';
export const THUMBNAIL_SIZE = THUMBNAIL_IMAGE_SIZE;

// 썸네일은 항상 정확히 1000x1000이어야 한다. 대부분은 이미 맞지만, AI 편집 결과처럼 크기가 달라질 수 있는
// 경로가 있어서 저장 직전에 한 번 더 확인하고, 다르면 꽉 채워 맞춘다 (같으면 그대로 - 재인코딩 없음).
export async function enforceThumbnailSize(buffer: Buffer): Promise<Buffer> {
  const meta = await sharp(buffer).metadata();
  if (meta.width === THUMBNAIL_SIZE && meta.height === THUMBNAIL_SIZE && meta.format === 'jpeg') return buffer;
  return sharp(buffer)
    .resize({ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE, fit: 'cover' })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 92 })
    .toBuffer();
}

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
export async function applyThumbnailEffect(
  imageBuffer: Buffer,
  effectPrompt: string,
  referenceImages: { buffer: Buffer; mimeType: string }[] = [],
  opts: { preserveText?: boolean; productPhoto?: { buffer: Buffer; mimeType: string } | null; insist?: boolean } = {}
): Promise<Buffer> {
  const apiKey = requireEnv('GEMINI_API_KEY');

  const referenceRule =
    referenceImages.length > 0
      ? `\n\n[참고용 - 이 카테고리에서 실제로 잘 팔리는 경쟁 상품 썸네일 ${referenceImages.length}장이 먼저 첨부돼 있습니다] 그 사진 속 상품이나 문구를 베끼지 말고, 효과/연출/소품 배치처럼 "잘 팔리는 썸네일이 공통적으로 갖는 스타일 요소"만 참고해서 아래 요청에 반영해주세요.`
      : '';

  const textRule = opts.preserveText
    ? '이미지에 이미 들어 있는 한국어 문구(글자 내용·위치·글꼴·색)는 한 글자도 바꾸지 말고 그대로 두세요. 새로운 문자는 추가하지 마세요.'
    : '**절대 이미지 안에 어떤 문자·숫자·기호도 넣지 마세요.**';
  const photoRule = opts.productPhoto
    ? '\n\n[실제 판매 상품 사진이 마지막에 추가로 첨부돼 있습니다] 요청 사항에서 상품의 길이·모양·색 같은 외형을 말하면, 이 실제 상품 사진 속 모습과 똑같이 맞춰서 수정하세요.'
    : '';
  const insistRule = opts.insist
    ? '\n\n이전 시도에서 눈에 띄는 변화가 없었습니다. 이번에는 요청한 부분이 한눈에 확실히 달라지도록 분명하게 수정하세요.'
    : '';
  const instruction = `${textRule} 아래 상품 썸네일 사진을 아래 "요청 사항"에 맞게 수정해주세요. 요청 사항은 상품 개수를 늘리거나 배치를 바꾸는 것처럼 상품 자체에 관한 내용이어도 반드시 반영하세요. 요청 사항에서 따로 언급하지 않은 부분(상품의 색상·재질·전체적인 디자인 등)만 원본 그대로 유지하면 됩니다. 쿠팡 상품 썸네일이라는 걸 감안해서 상품이 가려지거나 알아보기 어려워지면 안 됩니다.${referenceRule}

요청 사항: ${effectPrompt}${photoRule}${insistRule}`;

  const parts: Record<string, unknown>[] = [{ text: instruction }];
  for (const ref of referenceImages) {
    parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.buffer.toString('base64') } });
  }
  parts.push({ inlineData: { mimeType: 'image/jpeg', data: imageBuffer.toString('base64') } });
  if (opts.productPhoto) {
    parts.push({ inlineData: { mimeType: opts.productPhoto.mimeType, data: opts.productPhoto.buffer.toString('base64') } });
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
    throw new Error('효과 적용 결과를 받지 못했어요. 프롬프트를 조금 더 구체적으로 적어서 다시 시도해주세요.');
  }
  const edited = Buffer.from(imagePart.inlineData.data, 'base64');
  return sharp(edited)
    .resize({ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE, fit: 'cover' })
    .jpeg({ quality: 92 })
    .toBuffer();
}

// AI한테 "상품을 하나 더 그려 넣어줘" 같은 요청을 맡기면 반복되는
// 패턴(예: 겹쳐 쌓인 다회 세트 상품의 띠)을 정확히 재현하지 못하고
// 번번이 무시하는 경우가 많다 - 반면 이미 있는 영역을 그대로
// 복사해서 다른 위치에 붙여넣는 건 AI 없이도 완벽하게 할 수 있는
// 작업이라 별도 결정적 함수로 분리한다. 퍼센트(0~100) 좌표를 쓰는
// 이유는 호출하는 쪽(UI)이 실제 픽셀 크기를 몰라도 되게 하기 위해서.
export async function duplicateImageStrip(
  imageBuffer: Buffer,
  params: { sourceTopPct: number; sourceBottomPct: number; destTopPct: number }
): Promise<Buffer> {
  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width || THUMBNAIL_SIZE;
  const height = meta.height || THUMBNAIL_SIZE;

  const srcTop = Math.max(0, Math.min(height - 1, Math.round((height * params.sourceTopPct) / 100)));
  const srcBottom = Math.max(srcTop + 1, Math.min(height, Math.round((height * params.sourceBottomPct) / 100)));
  const stripHeight = srcBottom - srcTop;

  const strip = await sharp(imageBuffer).extract({ left: 0, top: srcTop, width, height: stripHeight }).toBuffer();

  const destTop = Math.max(0, Math.min(height - stripHeight, Math.round((height * params.destTopPct) / 100)));

  return sharp(imageBuffer)
    .composite([{ input: strip, left: 0, top: destTop }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

// Gemini가 "success"로 응답해도 실제로는 요청을 무시하고 원본과
// 거의 동일한 이미지를 그대로 돌려줄 때가 있다 (특히 상품 개수를
// 늘리는 것처럼 구조적인 수정 요청일 때). 이런 경우를 조용히
// "성공"으로 처리하면 사용자가 왜 안 바뀌었는지 알 수 없으니,
// 16x16 흑백 다운샘플 평균 밝기 차이로 "거의 그대로"인지 감지해서
// 호출하는 쪽에서 명확한 에러로 보여줄 수 있게 한다.
export async function isImageVisuallyUnchanged(before: Buffer, after: Buffer): Promise<boolean> {
  const SIZE = 16;
  const [a, b] = await Promise.all([
    sharp(before).resize(SIZE, SIZE, { fit: 'fill' }).greyscale().raw().toBuffer(),
    sharp(after).resize(SIZE, SIZE, { fit: 'fill' }).greyscale().raw().toBuffer(),
  ]);
  let diffSum = 0;
  for (let i = 0; i < a.length; i++) diffSum += Math.abs(a[i] - b[i]);
  const meanDiff = diffSum / a.length;
  return meanDiff < 1.5;
}

// 실측 결과 "이미지 생성 모델에게 상품만 남기고 다시 그려달라"는
// 방식은 같은 사진을 두 번 넣어도 결과가 들쭉날쭉했다(한 번은 소품이
// 남고, 한 번은 깔끔하게 나옴) - 이미지 생성 자체가 확률적이라
// 일관성을 보장 못 한다. 반면 "이 상품의 위치가 어디냐"를 좌표로
// 답하는 건 훨씬 일관적이고 안정적이다(텍스트 출력이라 흔들림이
// 적음). 그래서 이미지를 다시 그리게 하는 대신, 먼저 상품의 위치만
// 정확히 찾아서 그 영역만 크롭한다 - 옆에 있던 소품(책상 등)은
// 크롭 단계에서 물리적으로 아예 잘려나가므로 이후 단계에서 다시
// 나타날 수가 없다.
async function detectProductBoundingBox(
  imageBuffer: Buffer,
  mimeType: string
): Promise<{ xMin: number; yMin: number; xMax: number; yMax: number } | null> {
  const apiKey = requireEnv('GEMINI_API_KEY');
  const prompt = `이 사진은 이커머스 상품 사진입니다. 사진 속에 여러 물건이 함께 있더라도, **실제로 판매하는 메인 상품 하나**의 위치를 찾아주세요 (옆에 같이 연출된 다른 가구·소품은 제외).

반드시 아래 JSON 객체 형식으로만 응답하세요:
{
  "xMin": 0.0~1.0 사이 (이미지 왼쪽 기준 상품 영역 시작 비율),
  "yMin": 0.0~1.0 사이 (이미지 위쪽 기준 상품 영역 시작 비율),
  "xMax": 0.0~1.0 사이 (상품 영역 끝 비율),
  "yMax": 0.0~1.0 사이 (상품 영역 끝 비율)
}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: imageBuffer.toString('base64') } }] }],
        generationConfig: { temperature: 0 },
      }),
    }
  );
  const json = await res.json();
  if (!res.ok) return null;

  const text: string = (json.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('');
  const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    const box = JSON.parse(cleaned.slice(start, end + 1));
    if (
      typeof box.xMin === 'number' &&
      typeof box.yMin === 'number' &&
      typeof box.xMax === 'number' &&
      typeof box.yMax === 'number' &&
      box.xMax > box.xMin &&
      box.yMax > box.yMin
    ) {
      return box;
    }
    return null;
  } catch {
    return null;
  }
}

// 찾은 상품 영역만 여유(10%)를 두고 크롭한다 - 이후 remove.bg가 볼
// 이미지에는 옆 소품이 아예 존재하지 않게 된다. 좌표 인식이 실패하면
// (드묾) 원본 그대로 다음 단계로 넘긴다 - 크롭을 안 해도 파이프라인은
// 계속 동작한다.
async function cropToProduct(imageBuffer: Buffer, mimeType: string): Promise<Buffer> {
  const box = await detectProductBoundingBox(imageBuffer, mimeType);
  if (!box) return imageBuffer;

  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  if (!width || !height) return imageBuffer;

  const padRatio = 0.1;
  const boxW = box.xMax - box.xMin;
  const boxH = box.yMax - box.yMin;
  const padX = boxW * padRatio;
  const padY = boxH * padRatio;

  const xMin = Math.max(0, box.xMin - padX);
  const yMin = Math.max(0, box.yMin - padY);
  const xMax = Math.min(1, box.xMax + padX);
  const yMax = Math.min(1, box.yMax + padY);

  const left = Math.round(xMin * width);
  const top = Math.round(yMin * height);
  const cropWidth = Math.round((xMax - xMin) * width);
  const cropHeight = Math.round((yMax - yMin) * height);
  if (cropWidth < 10 || cropHeight < 10) return imageBuffer;

  return sharp(imageBuffer).extract({ left, top, width: cropWidth, height: cropHeight }).toBuffer();
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
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'], temperature: 0 },
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
  referenceImages?: { buffer: Buffer; mimeType: string }[];
}

// 상품 위치 크롭(소품 물리적으로 제거) -> 문구/워터마크 정리 -> 누끼
// -> 흰 배경 1000x1000 배치 -> (선택) 효과 추가, 순서로 처리한다.
export async function generateThumbnailImage(input: GenerateThumbnailInput): Promise<Buffer> {
  const cropped = await cropToProduct(input.productImage.buffer, input.productImage.mimeType);
  const cleaned = await cleanProductPhotoForCutout(cropped, input.productImage.mimeType);
  const cutout = await removeWhiteBackground(cleaned.buffer);
  const base = await composeThumbnailImage(cutout, input.position);
  if (input.effectPrompt?.trim()) {
    return applyThumbnailEffect(base, input.effectPrompt.trim(), input.referenceImages || []);
  }
  return base;
}

// ---------------------------------------------------------------------------
// 패키지(세트) 썸네일: 색상별 상품을 수량 그대로 한 장에 담는다
// ---------------------------------------------------------------------------
// AI에게 "두 개를 같이 그려줘"라고 시키면 개수·색상이 어긋나는 일이 있어서, 색상별 사진을 각각 누끼로
// 따고(상품 위치 크롭 -> 글자 정리 -> 흰 배경 제거) 코드로 정확한 개수만큼 배치한다. 메인 썸네일과 같은
// 규격(1000x1000 순백 배경, 상품이 86% 이내)이다.
export async function composePackageCutouts(units: Buffer[]): Promise<Buffer> {
  if (units.length === 0) throw new Error('패키지에 담을 상품이 없어요.');
  const SIZE = THUMBNAIL_SIZE;
  const maxDim = Math.round(SIZE * 0.86);
  const pad = Math.round((SIZE - maxDim) / 2);
  const { cols, rows } = packageGrid(units.length);
  const cellW = maxDim / cols;
  const cellH = maxDim / rows;

  const placed: { input: Buffer; left: number; top: number }[] = [];
  for (let i = 0; i < units.length; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const inRow = r === rows - 1 ? units.length - r * cols : cols; // 마지막 줄이 모자라면 가운데로
    const rowOffset = ((cols - inRow) * cellW) / 2;
    // 이웃과 살짝 겹치게(세트 느낌) 칸보다 약간 넓게 그린다
    const trimmed = await sharp(units[i]).trim().toBuffer();
    const fitted = await sharp(trimmed)
      .resize({ width: Math.round(cellW * 1.1), height: Math.round(cellH * 0.98), fit: 'inside' })
      .toBuffer();
    const m = await sharp(fitted).metadata();
    const w = m.width || 1;
    const h = m.height || 1;
    placed.push({
      input: fitted,
      left: Math.round(pad + rowOffset + c * cellW + cellW / 2 - w / 2),
      top: Math.round(pad + r * cellH + cellH / 2 - h / 2),
    });
  }
  return sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: '#ffffff' } })
    .composite(placed.map((p) => ({ input: p.input, left: Math.max(0, p.left), top: Math.max(0, p.top) })))
    .jpeg({ quality: 92 })
    .toBuffer();
}

export async function generatePackageThumbnail(
  items: { productImage: { buffer: Buffer; mimeType: string }; quantity: number }[]
): Promise<Buffer> {
  const cutouts = await Promise.all(
    items.map(async (it) => {
      const cropped = await cropToProduct(it.productImage.buffer, it.productImage.mimeType);
      const cleaned = await cleanProductPhotoForCutout(cropped, it.productImage.mimeType);
      return removeWhiteBackground(cleaned.buffer);
    })
  );
  const units: Buffer[] = [];
  items.forEach((it, i) => {
    for (let q = 0; q < it.quantity; q++) units.push(cutouts[i]);
  });
  return composePackageCutouts(units);
}
