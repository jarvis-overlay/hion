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

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} 환경변수가 설정 안 되어있어요.`);
  return v;
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
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64 } }],
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
// 원본 이미지에 합성한다. sharp로 SVG를 오버레이하는 방식 - 별도
// 이미지 편집 API 없이 서버에서 바로 처리 가능.
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

  const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const overlays = regions
    .map((r) => {
      const x = r.xMin * width;
      const y = r.yMin * height;
      const w = Math.max(1, (r.xMax - r.xMin) * width);
      const h = Math.max(1, (r.yMax - r.yMin) * height);
      const fontSize = Math.max(10, Math.min(h * 0.7, w / Math.max(1, r.translatedText.length) * 1.8));
      return `
        <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="white" />
        <text x="${x + w / 2}" y="${y + h / 2}" font-size="${fontSize}" font-family="sans-serif"
          text-anchor="middle" dominant-baseline="middle" fill="black">${escapeXml(r.translatedText)}</text>
      `;
    })
    .join('\n');

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${overlays}</svg>`;

  return sharp(imageBuffer)
    .composite([{ input: Buffer.from(svg) }])
    .png()
    .toBuffer();
}

// remove.bg - 이미 업로드한 원본 이미지의 공개 URL을 그대로 넘겨서
// 배경 제거된 투명 PNG를 받는다 (이미지를 다시 업로드할 필요 없음).
export async function removeImageBackground(imageUrl: string): Promise<Buffer> {
  const apiKey = requireEnv('REMOVE_BG_API_KEY');

  const res = await fetch('https://api.remove.bg/v1.0/removebg', {
    method: 'POST',
    headers: {
      'X-Api-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ image_url: imageUrl, size: 'auto' }),
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => null);
    throw new Error(errJson?.errors?.[0]?.title || `remove.bg 오류 (HTTP ${res.status})`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// 쿠팡 상세페이지 이미지 규격(가로 860px)에 맞춘다 - AI 업스케일이
// 아니라 단순 리사이즈라 외부 API 없이 sharp로 로컬 처리한다. 원본이
// 860px보다 작아도 규격을 맞추기 위해 확대까지 허용한다(화질 손실은
// 감수 - 애초에 원본이 작으면 어쩔 수 없음).
export const COUPANG_DETAIL_WIDTH = 860;

export async function resizeForCoupang(imageBuffer: Buffer): Promise<Buffer> {
  return sharp(imageBuffer).resize({ width: COUPANG_DETAIL_WIDTH }).jpeg({ quality: 90 }).toBuffer();
}
