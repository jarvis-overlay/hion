// 썸네일 패키지 "대표형" 배치: 왼쪽에 대표 상품 1개를 크게, 오른쪽 세로 줄에 나머지를 작게 세우고
// (예: 5개 묶음 = 큰 1개 + 작은 4개), 오른쪽 위에 "5P" 같은 수량 배지를 붙인다.
// 상품은 실제 사진을 누끼로 딴 픽셀 그대로 배치하고 배지 글자는 코드(node-canvas)로 그린다 - AI가 상품을
// 다시 그리면 개수·모양이 어긋나므로 쓰지 않는다. 합성 방식은 composePackageCutouts(격자형)와 같다.
import sharp from 'sharp';
import { createCanvas } from 'canvas';
import { ensureKoreanFontRegistered, FONT_EXTRABOLD } from '@/lib/fonts';
import { canUseHero } from '@/lib/thumbnailPackage';

const SIZE = 1000;

export interface HeroLayout {
  hero: { x: number; y: number; w: number; h: number };
  smalls: { x: number; y: number; w: number; h: number }[];
}

// 칸 계산만 따로 둔 순수 함수 (테스트용). units = 전체 상품 수, 첫 번째가 대표.
export function heroLayout(units: number): HeroLayout {
  const smallCount = units - 1;
  const colX = 700;
  const colW = 250;
  const colTop = 190;
  const colBottom = 950;
  const cellH = (colBottom - colTop) / smallCount;
  const smalls = Array.from({ length: smallCount }, (_, i) => ({
    x: colX,
    y: Math.round(colTop + i * cellH),
    w: colW,
    h: Math.round(cellH),
  }));
  return { hero: { x: 50, y: 150, w: 600, h: 760 }, smalls };
}

async function fitInto(unit: Buffer, cell: { x: number; y: number; w: number; h: number }, scale = 1) {
  const trimmed = await sharp(unit).trim().toBuffer();
  const fitted = await sharp(trimmed)
    .resize({ width: Math.round(cell.w * scale), height: Math.round(cell.h * scale), fit: 'inside' })
    .toBuffer();
  const m = await sharp(fitted).metadata();
  const w = m.width || 1;
  const h = m.height || 1;
  return {
    input: fitted,
    left: Math.max(0, Math.round(cell.x + cell.w / 2 - w / 2)),
    top: Math.max(0, Math.round(cell.y + cell.h / 2 - h / 2)),
  };
}

export async function composeHeroPackage(units: Buffer[]): Promise<Buffer> {
  if (!canUseHero(units.length)) throw new Error('대표형 배치는 상품이 3~6개일 때만 쓸 수 있어요.');
  const layout = heroLayout(units.length);
  const placed = [await fitInto(units[0], layout.hero)];
  for (let i = 0; i < layout.smalls.length; i++) {
    // 작은 상품은 칸을 90%만 채워 위아래가 붙지 않게 한다
    placed.push(await fitInto(units[i + 1], layout.smalls[i], 0.9));
  }
  return sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: '#ffffff' } })
    .composite(placed)
    .jpeg({ quality: 92 })
    .toBuffer();
}

// 수량 배지 이미지 (빨간 알약 + 흰 테두리 + 흰 글자). 글자는 "5P" 같은 짧은 문구.
export async function drawCountBadge(text: string, width = 240, height = 84): Promise<Buffer> {
  ensureKoreanFontRegistered();
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const pill = (x: number, y: number, w: number, h: number) => {
    const r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };
  ctx.fillStyle = '#c62828';
  pill(0, 0, width, height);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  pill(7, 7, width - 14, height - 14);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(height * 0.56)}px ${FONT_EXTRABOLD}`;
  ctx.fillText(text, width / 2, height / 2 + 2);
  return canvas.toBuffer('image/png');
}

// 완성된 패키지 이미지 오른쪽 위에 "N P" 배지를 붙인다 (1000x1000 기준)
export async function applyCountBadge(base: Buffer, total: number): Promise<Buffer> {
  const badge = await drawCountBadge(`${total}P`);
  return sharp(base)
    .composite([{ input: badge, left: 700, top: 50 }])
    .jpeg({ quality: 92 })
    .toBuffer();
}
