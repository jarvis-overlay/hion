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

export type BadgeUnit = 'P' | '개' | 'x';
export type BadgeCorner = 'auto' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
export const BADGE_MIN_SCALE = 0.6;
export const BADGE_MAX_SCALE = 2.4;

export interface BadgeStyle {
  shape?: BadgeShape;
  color?: BadgeColor;
  scale?: number; // 기본 크기 대비 배율 (1 = 기본)
  unit?: BadgeUnit; // 5P / 5개 / x5
}

// 기본 크기: 예전(100px)은 숫자가 너무 작다는 의견이 있어 키웠다 (원/사각 120px, 알약 260x90)
const BADGE_SIZE: Record<BadgeShape, { w: number; h: number }> = {
  pill: { w: 260, h: 90 },
  circle: { w: 120, h: 120 },
  square: { w: 120, h: 120 },
};

export function badgeText(total: number, unit: BadgeUnit = '개'): string {
  return unit === '개' ? `${total}개` : unit === 'x' ? `x${total}` : `${total}P`;
}

// 수량 배지 이미지. 글자는 "5P" 같은 짧은 문구. 흰색은 흰 바탕+검은 외곽선·글자, 나머지는 색 바탕+흰 테두리·흰 글자.
export async function drawCountBadge(text: string, style: BadgeStyle = {}): Promise<{ png: Buffer; w: number; h: number }> {
  ensureKoreanFontRegistered();
  const shape = normBadgeShape(style.shape);
  const color = BADGE_COLORS.find((c) => c.id === normBadgeColor(style.color))!.hex;
  const scale = Math.max(BADGE_MIN_SCALE, Math.min(BADGE_MAX_SCALE, Number.isFinite(style.scale) ? (style.scale as number) : 1));
  const w = Math.round(BADGE_SIZE[shape].w * scale);
  const h = Math.round(BADGE_SIZE[shape].h * scale);
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
  const outline = normBadgeColor(style.color) === 'white';
  ctx.fillStyle = color;
  path(0);
  ctx.fill();
  if (outline) {
    ctx.strokeStyle = '#222222';
    ctx.lineWidth = Math.max(3, Math.round(4 * scale));
    path(Math.round(2 * scale));
    ctx.stroke();
  } else {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(2, Math.round(3 * scale));
    path(Math.round(7 * scale));
    ctx.stroke();
  }
  ctx.fillStyle = outline ? '#222222' : '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 글자가 칸 안에 들어가는 한 최대한 크게 (3글자 이상이면 조금 줄임)
  const long = text.length >= 3 && shape !== 'pill';
  ctx.font = `${Math.round(h * (shape === 'pill' ? 0.58 : long ? 0.4 : 0.52))}px ${FONT_EXTRABOLD}`;
  ctx.fillText(text, w / 2, h / 2 + Math.round(2 * scale));
  return { png: canvas.toBuffer('image/png'), w, h };
}

// 쿠팡 대표 이미지 규정(상품이 95% 이상 + 비상품 요소 금지, 단 작은 수량 표기는 허용)에 맞춰,
// 상품을 가리지 않는 "완전히 빈(흰) 모서리"에만 배지를 붙인다. corner가 auto면 아래쪽 모서리부터
// (쿠팡 가이드 예시와 같음) 빈 곳을 찾고, 지정했으면 그 모서리만 쓴다. 자리가 모자라면 배지를
// 조금씩 줄여서(최소 BADGE_MIN_SCALE까지) 붙이고, 그래도 안 되면 null(호출한 쪽이 안내).
export async function placeCountBadge(
  base: Buffer,
  total: number,
  style: BadgeStyle = {},
  flip = false,
  corner: BadgeCorner = 'auto'
): Promise<{ buffer: Buffer; scale: number; corner: Exclude<BadgeCorner, 'auto'> } | null> {
  const gap = 20;
  const pad = 8; // 배지 둘레에도 상품이 없어야 한다
  const wantScale = Math.max(BADGE_MIN_SCALE, Math.min(BADGE_MAX_SCALE, style.scale ?? 1));
  const text = badgeText(total, style.unit);
  const order: Exclude<BadgeCorner, 'auto'>[] = flip
    ? ['bottom-left', 'bottom-right', 'top-left', 'top-right']
    : ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
  const candidates = corner === 'auto' ? order : [corner];

  for (let scale = wantScale; scale >= BADGE_MIN_SCALE - 1e-6; scale = Math.round((scale * 0.88) * 1000) / 1000) {
    const { png, w, h } = await drawCountBadge(text, { ...style, scale });
    for (const c of candidates) {
      const left = c.endsWith('right') ? SIZE - gap - w : gap;
      const top = c.startsWith('bottom') ? SIZE - gap - h : gap;
      const region = {
        left: Math.max(0, left - pad),
        top: Math.max(0, top - pad),
        width: 0,
        height: 0,
      };
      region.width = Math.min(w + pad * 2, SIZE - region.left);
      region.height = Math.min(h + pad * 2, SIZE - region.top);
      // sharp의 stats()는 extract를 무시하고 이미지 전체를 계산하므로, 먼저 잘라낸 뒤 통계를 낸다
      const stats = await sharp(await sharp(base).extract(region).toBuffer()).stats();
      if (!stats.channels.slice(0, 3).every((ch) => ch.min >= 244)) continue;
      const buffer = await sharp(base)
        .composite([{ input: png, left, top }])
        .jpeg({ quality: 92 })
        .toBuffer();
      return { buffer, scale, corner: c };
    }
  }
  return null;
}

// (예전 이름 - 배지를 빈 모서리에 붙인다)
export async function applyCountBadgeInFreeCorner(
  base: Buffer,
  total: number,
  style: BadgeStyle = {},
  flip = false
): Promise<Buffer | null> {
  return (await placeCountBadge(base, total, style, flip))?.buffer ?? null;
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
