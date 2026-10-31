// 이미지 속 글자/아이콘/워터마크를 "코드로 확실히" 지우는 후처리.
//
// 중국 판매 사진에는 중국어 문구와 그 옆의 동그란 아이콘 같은 그래픽이 사진 위에 얹혀 있다.
// 이미지 생성 AI에게 "글자를 지워라"라고 프롬프트로만 시키면 그게 사진의 일부라서 그대로
// 다시 그려 넣는 일이 잦다(실측). 그래서
//   1) 비전 모델로 글자·아이콘 영역의 좌표를 찾고,
//   2) 그 영역을 이미지의 다른 부분(주변 질감)으로 덮어서 지우고,
//   3) 결과를 다시 검사해서 남은 게 있으면 한 번 더 지운다.
// AI가 글자를 다시 그리더라도 이 단계에서 걸러지게 하는 게 목적이다.
import sharp from 'sharp';
import { VISION_MODEL } from '@/lib/imageProcessing';

export interface OverlayRegion {
  // 이미지 전체 대비 0~1 비율 좌표
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export type DetectRegions = (buffer: Buffer, mimeType: string) => Promise<OverlayRegion[]>;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} 환경변수가 설정 안 되어있어요.`);
  return v;
}

// 비전 모델이 준 좌표를 검증/정리한다 (비율 범위로 자르고, 너무 작거나 거의 전체를 덮는
// 영역은 버린다 - 전체를 덮는다는 건 모델이 잘못 짚은 것이고 그대로 지우면 사진이 망가진다).
export function normalizeRegions(raw: unknown): OverlayRegion[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: OverlayRegion[] = [];
  for (const r of arr as any[]) {
    const clamp = (v: unknown) => Math.min(1, Math.max(0, Number(v)));
    const xMin = clamp(r?.xMin);
    const yMin = clamp(r?.yMin);
    const xMax = clamp(r?.xMax);
    const yMax = clamp(r?.yMax);
    if (![xMin, yMin, xMax, yMax].every(Number.isFinite)) continue;
    const w = xMax - xMin;
    const h = yMax - yMin;
    if (w < 0.01 || h < 0.01) continue;
    if (w * h > 0.55) continue;
    out.push({ xMin, yMin, xMax, yMax });
  }
  return out.slice(0, 30);
}

export const detectOverlayRegions: DetectRegions = async (buffer, mimeType) => {
  const apiKey = requireEnv('GEMINI_API_KEY');
  const prompt = `이 사진 위에 나중에 얹은 글자와 그래픽 요소의 위치를 모두 찾아주세요. 찾을 대상:
- 모든 언어의 문자·숫자 (중국어, 영어, 한글 포함) - 문구, 제목, 설명, 가격, 사이즈 표기
- 문구에 딸린 아이콘·동그라미 배지·스티커·화살표·말풍선·테두리 도형
- 로고, 워터마크, QR코드, 상품에 인쇄/부착된 알아볼 수 있는 글자 라벨

규칙:
- 각 항목(한 줄의 글자, 또는 아이콘+그 아래 글자 묶음)마다 그것을 **빠짐없이 덮는** 사각형을 이미지 전체 대비 0~1 비율 좌표로 알려주세요. 여백을 조금 넉넉하게 잡으세요.
- 상품 자체의 무늬·질감·주름·그림자는 대상이 아닙니다. 글자나 그래픽 요소가 하나도 없으면 빈 배열 [].

JSON 배열로만 응답하세요:
[{"xMin":0.0,"yMin":0.0,"xMax":0.0,"yMax":0.0}]`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: buffer.toString('base64') } }] }],
      }),
    }
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `Gemini API 오류 (HTTP ${res.status})`);
  const text: string = (json.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('');
  const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  try {
    return normalizeRegions(JSON.parse(cleaned.slice(start, end + 1)));
  } catch {
    return [];
  }
};

interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlapArea = (a: PxRect, b: PxRect) => {
  const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ox * oy;
};

// 겹치거나 맞닿은 영역은 하나로 합친다 (아이콘과 그 밑 글자처럼 붙어 있는 것들)
export function mergeRects(rects: PxRect[], gap = 6): PxRect[] {
  const list = rects.map((r) => ({ ...r }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const touch =
          a.x <= b.x + b.w + gap && b.x <= a.x + a.w + gap && a.y <= b.y + b.h + gap && b.y <= a.y + a.h + gap;
        if (touch) {
          const x = Math.min(a.x, b.x);
          const y = Math.min(a.y, b.y);
          list[i] = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
          list.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return list;
}

// 영역(px)을 이미지의 다른 부분 조각으로 덮는다. 지울 영역들과 겹치지 않는 가장 가까운
// 같은 크기 조각(위/아래/좌/우, 간격을 두고)을 골라 가장자리를 부드럽게 섞어서 붙인다.
// 알맞은 조각이 없으면(영역이 이미지의 큰 부분을 차지) 강하게 흐린 색으로 채운다.
export async function inpaintRects(buffer: Buffer, rects: PxRect[]): Promise<Buffer> {
  const meta = await sharp(buffer).metadata();
  const W = meta.width || 0;
  const H = meta.height || 0;
  if (!W || !H || rects.length === 0) return buffer;

  // 검출 상자 바깥으로 넉넉히 더 덮는다. 가장자리를 섞는 구간(아래 feather)은 이 여유분
  // 안쪽에 들어가므로, 검출된 글자/아이콘 자체는 항상 완전히 덮이고 윤곽 잔상이 남지 않는다.
  const pad = Math.max(12, Math.round(Math.min(W, H) * 0.03));
  const feather = Math.max(3, Math.round(pad / 3));
  const targets = mergeRects(
    rects.map((r) => {
      const x = Math.max(0, Math.floor(r.x - pad));
      const y = Math.max(0, Math.floor(r.y - pad));
      const x2 = Math.min(W, Math.ceil(r.x + r.w + pad));
      const y2 = Math.min(H, Math.ceil(r.y + r.h + pad));
      return { x, y, w: x2 - x, h: y2 - y };
    }),
    pad
  ).filter((r) => r.w >= 4 && r.h >= 4);

  let current = await sharp(buffer).removeAlpha().png().toBuffer();
  for (const t of targets) {
    const gap = Math.round(Math.min(t.w, t.h) * 0.15);
    const candidates: PxRect[] = [
      { x: t.x, y: t.y - t.h - gap, w: t.w, h: t.h }, // 위
      { x: t.x, y: t.y + t.h + gap, w: t.w, h: t.h }, // 아래
      { x: t.x - t.w - gap, y: t.y, w: t.w, h: t.h }, // 왼쪽
      { x: t.x + t.w + gap, y: t.y, w: t.w, h: t.h }, // 오른쪽
    ].filter((c) => c.x >= 0 && c.y >= 0 && c.x + c.w <= W && c.y + c.h <= H);
    // 다른 지울 영역과 겹치는 정도가 가장 적은 후보 (0이면 완벽)
    const scored = candidates
      .map((c) => ({ c, bad: targets.reduce((s, o) => s + (o === t ? 0 : overlapArea(c, o)), 0) }))
      .sort((a, b) => a.bad - b.bad);

    let patch: Buffer;
    if (scored.length > 0 && scored[0].bad < t.w * t.h * 0.2) {
      const c = scored[0].c;
      patch = await sharp(current).extract({ left: c.x, top: c.y, width: c.w, height: c.h }).png().toBuffer();
    } else {
      // 조각을 못 구하면 영역 주변을 크게 흐려서 채운다 (글자는 없어지고 질감은 뭉개짐)
      patch = await sharp(current)
        .extract({ left: t.x, top: t.y, width: t.w, height: t.h })
        .blur(Math.max(8, Math.min(t.w, t.h) / 3))
        .png()
        .toBuffer();
    }

    // 가장자리를 부드럽게 섞는 마스크 (SVG의 가우시안 블러)
    const f = feather;
    const mask = await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${t.w}" height="${t.h}"><defs><filter id="b"><feGaussianBlur stdDeviation="${f / 2}"/></filter></defs><rect x="${f}" y="${f}" width="${Math.max(1, t.w - 2 * f)}" height="${Math.max(1, t.h - 2 * f)}" fill="#fff" filter="url(#b)"/></svg>`
      )
    )
      .png()
      .toBuffer();
    const alphaPatch = await sharp(patch).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    current = await sharp(current).composite([{ input: alphaPatch, left: t.x, top: t.y }]).png().toBuffer();
  }
  return sharp(current).jpeg({ quality: 92 }).toBuffer();
}

// 글자/아이콘을 찾아서 지운다. 결과를 다시 검사해서 남은 게 있으면 한 번 더(최대 2번)
// 지운다. 검사/지우기가 실패해도 이미지 생성 전체를 막지 않고 원본을 그대로 돌려준다.
export async function removeOverlays(
  buffer: Buffer,
  mimeType: string,
  detect: DetectRegions = detectOverlayRegions
): Promise<{ buffer: Buffer; mimeType: string; removed: number; error: string | null }> {
  let current = buffer;
  let currentMime = mimeType;
  let removed = 0;
  try {
    for (let pass = 0; pass < 2; pass++) {
      const regions = await detect(current, currentMime);
      if (regions.length === 0) break;
      const meta = await sharp(current).metadata();
      const W = meta.width || 0;
      const H = meta.height || 0;
      if (!W || !H) break;
      const rects = regions.map((r) => ({
        x: r.xMin * W,
        y: r.yMin * H,
        w: (r.xMax - r.xMin) * W,
        h: (r.yMax - r.yMin) * H,
      }));
      current = await inpaintRects(current, rects);
      currentMime = 'image/jpeg';
      removed += regions.length;
    }
    return { buffer: current, mimeType: currentMime, removed, error: null };
  } catch (e: any) {
    console.error('[overlayCleanup] 글자/아이콘 제거 실패 - 원본 그대로 사용:', e?.message || e);
    return { buffer, mimeType, removed: 0, error: e?.message || String(e) };
  }
}
