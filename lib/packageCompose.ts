// 썸네일 패키지를 템플릿(lib/packageTemplates.ts)대로 합성한다.
// 상품은 실제 사진을 누끼로 딴 픽셀 그대로 배치하고, 수량 배지 글자는 코드(node-canvas)로 그린다 -
// AI가 상품을 다시 그리면 개수·모양·색이 어긋나므로 쓰지 않는다.
import sharp from 'sharp';
import { createCanvas } from 'canvas';
import { ensureKoreanFontRegistered, FONT_EXTRABOLD } from '@/lib/fonts';
import {
  BADGE_COLORS,
  BADGE_STRIP,
  getTemplate,
  mirrorCells,
  normBadgeColor,
  normBadgeShape,
  type BadgeColor,
  type BadgeShape,
  type Box,
  type Cell,
  type TemplateId,
} from '@/lib/packageTemplates';

const SIZE = 1000;
const MARGIN = 50;

export interface ComposeOptions {
  badge?: boolean; // 맨 위를 배지 자리로 비워둔다
  flip?: boolean; // 좌우 반전
}

export function contentBox(reserveBadge: boolean): Box {
  const top = MARGIN + (reserveBadge ? BADGE_STRIP : 0);
  return { x: MARGIN, y: top, w: SIZE - MARGIN * 2, h: SIZE - MARGIN - top };
}

// 템플릿 칸 계산 (반전 포함). 테스트·합성에서 같이 쓴다.
export function templateCells(id: TemplateId, units: number, opts: ComposeOptions = {}): Cell[] {
  const def = getTemplate(id);
  if (!def) throw new Error('알 수 없는 템플릿이에요.');
  if (units < def.min || units > def.max) throw new Error(`"${def.name}"은(는) 상품이 ${def.min}~${def.max}개일 때만 쓸 수 있어요.`);
  const box = contentBox(!!opts.badge);
  const cells = def.cells(units, box);
  return opts.flip ? mirrorCells(cells, box) : cells;
}

async function fitInto(unit: Buffer, c: Cell) {
  const trimmed = await sharp(unit).trim().toBuffer();
  const fitted = await sharp(trimmed)
    .resize({ width: Math.max(1, Math.round(c.w * c.scale)), height: Math.max(1, Math.round(c.h * c.scale)), fit: 'inside' })
    .toBuffer();
  const m = await sharp(fitted).metadata();
  const w = m.width || 1;
  const h = m.height || 1;
  return {
    input: fitted,
    left: Math.max(0, Math.min(SIZE - w, Math.round(c.x + c.w / 2 - w / 2))),
    top: Math.max(0, Math.min(SIZE - h, Math.round(c.y + c.h / 2 - h / 2))),
  };
}

// grid 외 템플릿 합성. units[0]이 대표(대표형 템플릿에서 크게 나오는 것)
export async function composeTemplate(id: TemplateId, units: Buffer[], opts: ComposeOptions = {}): Promise<Buffer> {
  const cells = templateCells(id, units.length, opts);
  const placed = [];
  for (let i = 0; i < units.length; i++) placed.push(await fitInto(units[i], cells[i]));
  return sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: '#ffffff' } })
    .composite(placed)
    .jpeg({ quality: 92 })
    .toBuffer();
}

export interface BadgeStyle {
  shape?: BadgeShape;
  color?: BadgeColor;
}

const BADGE_SIZE: Record<BadgeShape, { w: number; h: number }> = {
  pill: { w: 230, h: 78 },
  circle: { w: 100, h: 100 },
  square: { w: 100, h: 100 },
};

// 수량 배지 이미지 (색 바탕 + 흰 테두리 + 흰 글자). 글자는 "5P" 같은 짧은 문구.
export async function drawCountBadge(text: string, style: BadgeStyle = {}): Promise<{ png: Buffer; w: number; h: number }> {
  ensureKoreanFontRegistered();
  const shape = normBadgeShape(style.shape);
  const color = BADGE_COLORS.find((c) => c.id === normBadgeColor(style.color))!.hex;
  const { w, h } = BADGE_SIZE[shape];
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const path = (inset: number) => {
    const x = inset;
    const y = inset;
    const bw = w - inset * 2;
    const bh = h - inset * 2;
    ctx.beginPath();
    if (shape === 'circle') {
      ctx.arc(w / 2, h / 2, Math.min(bw, bh) / 2, 0, Math.PI * 2);
    } else {
      const r = shape === 'pill' ? bh / 2 : bh * 0.22;
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + bw, y, x + bw, y + bh, r);
      ctx.arcTo(x + bw, y + bh, x, y + bh, r);
      ctx.arcTo(x, y + bh, x, y, r);
      ctx.arcTo(x, y, x + bw, y, r);
    }
    ctx.closePath();
  };
  ctx.fillStyle = color;
  path(0);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  path(7);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(h * (shape === 'pill' ? 0.56 : 0.44))}px ${FONT_EXTRABOLD}`;
  ctx.fillText(text, w / 2, h / 2 + 2);
  return { png: canvas.toBuffer('image/png'), w, h };
}

// 완성된 패키지 이미지 맨 위 띠(오른쪽, 반전이면 왼쪽)에 "N P" 배지를 붙인다 (1000x1000 기준)
export async function applyCountBadge(base: Buffer, total: number, style: BadgeStyle = {}, flip = false): Promise<Buffer> {
  const { png, w, h } = await drawCountBadge(`${total}P`, style);
  const left = flip ? MARGIN + 10 : SIZE - MARGIN - 10 - w;
  const top = Math.round((MARGIN + BADGE_STRIP - h) / 2 + 6);
  return sharp(base)
    .composite([{ input: png, left, top }])
    .jpeg({ quality: 92 })
    .toBuffer();
}
