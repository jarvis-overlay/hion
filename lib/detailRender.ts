// 상세페이지 장면 이미지 합성 (문구/표/브랜드 머리글·바닥글). AI는 사진만 만들고, 글자는 전부 여기서 코드로 그린다.
//
// 규격: 가로 860px 고정 (lib/imageSpecs.ts). 모든 장면은 finishDetailImage를 거쳐 가로가 정확히 860px인지
// 검사한 뒤 JPEG로 나간다.
//
// 글자 배치(레퍼런스인 쿠팡 인기 상세페이지의 공통 규칙을 따름):
//  - 헤드라인은 크고 굵게(ExtraBold 46px), 설명은 작고 옅게(Bold 24px) - 크기·굵기·색 대비로 위계를 만든다
//  - 줄바꿈은 글자 수가 아니라 실제 글자 폭으로 계산하고, 어절 단위로 끊고, 마지막 줄에 한 어절만 남지 않게 균형을 맞춘다
//  - 핵심 단어는 **이렇게** 감싸면 포인트 컬러 + 굵게 (카피 문구에 쓰면 됨)
//  - 여백을 넉넉히(위아래 120px), 본문은 읽기 좋은 폭(약 620px)으로 제한
import sharp, { type OverlayOptions } from 'sharp';
import { createCanvas } from 'canvas';
import { FONT_BOLD, FONT_EXTRABOLD, ensureKoreanFontRegistered } from './fonts';
import { normalizeSizeTable, DEFAULT_SIZE_NOTE, SIZE_TABLE_LIMITS, type SizeTableData } from './detailOptions';
import {
  DETAIL_IMAGE_WIDTH,
  DETAIL_MIN_HEIGHT,
  DETAIL_OVERLAY_HEIGHT,
  DETAIL_PHOTO_HEIGHT,
} from './imageSpecs';

export type DetailSectionLayout = 'white' | 'overlay' | 'typography' | 'spec';
export type DetailSectionTheme = 'dark' | 'purple' | 'light';

// 브랜드 템플릿의 색상. 있으면 테마 색 대신 이 색으로 배경/포인트를 칠한다.
export interface BrandPalette {
  primary: string; // 대표 색 (#rrggbb)
  accent: string; // 포인트 색 (#rrggbb)
}

export interface DetailSectionInput {
  keyword: string;
  mood: string;
  description: string; // 메인 헤드라인 문구 - AI가 아니라 우리가 직접 합성
  eyebrow?: string; // 헤드라인 위 작은 문구 (선택)
  accentTitle?: string; // 영문 브랜드/제품명 (선택)
  accentSubtitle?: string; // accentTitle 아래 한글 표기 (선택)
  stat?: string; // 강조 숫자/퍼센트 (선택, 예: "110%")
  statCaption?: string; // stat 아래 설명 문구 (선택)
  badge?: string; // 작은 뱃지/라벨 문구 (선택)
  bodyText?: string; // 여러 줄 문단형 카피 (선택)
  listItems?: string; // 줄바꿈으로 구분된 번호 매김 리스트 항목 (선택)
  colorPrompt?: string; // 제품 색상/디자인을 바꿔달라는 자유 지시 (선택)
  layoutStyle?: DetailSectionLayout;
  theme?: DetailSectionTheme;
  palette?: BrandPalette | null; // 저장되지 않는 값 - 내보내기 때 브랜드 색으로 다시 그릴 때만 쓴다
}

export interface SpecRow {
  label: string;
  value: string;
}

export type SizeTable = SizeTableData;
export { normalizeSizeTable, DEFAULT_SIZE_NOTE, SIZE_TABLE_LIMITS };

type RGB = [number, number, number];
type Ctx = ReturnType<ReturnType<typeof createCanvas>['getContext']>;

const W = DETAIL_IMAGE_WIDTH;

// ---------------------------------------------------------------------------
// 색상
// ---------------------------------------------------------------------------
export function parseHex(hex: string | undefined | null): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const mix = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];
const css = (c: RGB, a = 1) => (a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);
const BLACK: RGB = [0, 0, 0];
const WHITE: RGB = [255, 255, 255];

interface ThemeColors {
  bgTop: string;
  bgBottom: string;
  scrimTint: RGB;
  text: string;
  textMuted: string;
  accent: string;
  divider: string;
  onAccent: string; // 포인트 색 위에 올리는 글자색
}

function getThemeColors(theme: DetailSectionTheme = 'dark', palette?: BrandPalette | null): ThemeColors {
  const primary = parseHex(palette?.primary);
  const accentRgb = parseHex(palette?.accent);
  if (primary) {
    const accent = accentRgb || primary;
    const lum = (c: RGB) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
    const onAccent = lum(accent) > 0.6 ? '#1c1c1c' : '#ffffff';
    if (theme === 'light') {
      return {
        bgTop: css(mix(primary, WHITE, 0.95)),
        bgBottom: css(mix(primary, WHITE, 0.86)),
        scrimTint: [255, 255, 255],
        text: '#1c1c1c',
        textMuted: 'rgba(28,28,28,0.62)',
        accent: css(lum(accent) > 0.75 ? mix(accent, BLACK, 0.35) : accent),
        divider: 'rgba(28,28,28,0.2)',
        onAccent,
      };
    }
    const dark = theme === 'dark';
    const top = mix(primary, BLACK, dark ? 0.6 : 0.3);
    const bottom = mix(primary, BLACK, dark ? 0.88 : 0.72);
    return {
      bgTop: css(top),
      bgBottom: css(bottom),
      scrimTint: bottom,
      text: '#ffffff',
      textMuted: 'rgba(255,255,255,0.78)',
      accent: css(lum(accent) < 0.25 ? mix(accent, WHITE, 0.5) : accent),
      divider: 'rgba(255,255,255,0.35)',
      onAccent,
    };
  }
  switch (theme) {
    case 'purple':
      return {
        bgTop: '#2c2049', bgBottom: '#0c0716', scrimTint: [26, 15, 46], text: '#ffffff',
        textMuted: 'rgba(255,255,255,0.78)', accent: '#c3a6f2', divider: 'rgba(255,255,255,0.35)', onAccent: '#1c1c1c',
      };
    case 'light':
      return {
        bgTop: '#faf7fb', bgBottom: '#efe6f5', scrimTint: [255, 255, 255], text: '#1c1c1c',
        textMuted: 'rgba(28,28,28,0.62)', accent: '#7c4fd1', divider: 'rgba(28,28,28,0.2)', onAccent: '#ffffff',
      };
    case 'dark':
    default:
      return {
        bgTop: '#1c1c1c', bgBottom: '#000000', scrimTint: [0, 0, 0], text: '#ffffff',
        textMuted: 'rgba(255,255,255,0.78)', accent: '#d8c8f5', divider: 'rgba(255,255,255,0.35)', onAccent: '#1c1c1c',
      };
  }
}

// ---------------------------------------------------------------------------
// 글자 폭 계산 / 줄바꿈 (글자 단위로 굵기가 달라질 수 있어서 글리프 배열로 다룬다)
// ---------------------------------------------------------------------------
interface Glyph {
  ch: string;
  emph: boolean;
}
interface TextStyle {
  font: string; // 일반 글자 폰트
  emphFont: string; // **강조** 글자 폰트
  size: number;
  tracking: number; // 글자 사이 추가 간격(px, 음수면 좁힘)
}

let measureCtx: Ctx | null = null;
function mctx(): Ctx {
  if (!measureCtx) measureCtx = createCanvas(16, 16).getContext('2d');
  return measureCtx;
}
const widthCache = new Map<string, number>();
function glyphW(g: Glyph, st: TextStyle): number {
  const font = g.emph ? st.emphFont : st.font;
  const key = `${font}|${st.size}|${g.ch}`;
  const cached = widthCache.get(key);
  if (cached !== undefined) return cached + st.tracking;
  const c = mctx();
  c.font = `${st.size}px ${font}`;
  const w: number = Number(c.measureText(g.ch).width) || 0;
  widthCache.set(key, w);
  return w + st.tracking;
}
const lineW = (line: Glyph[], st: TextStyle) => line.reduce((s, g) => s + glyphW(g, st), 0) - (line.length ? st.tracking : 0);

// **강조** 표시를 글리프로. 짝이 안 맞으면 표시만 지운다.
export function parseGlyphs(raw: string): Glyph[] {
  const parts = (raw || '').replace(/\r/g, '').split('**');
  const balanced = parts.length % 2 === 1; // 표시가 짝수 개일 때만 강조로 인정
  const out: Glyph[] = [];
  let emph = false;
  parts.forEach((part, i) => {
    if (i > 0) emph = balanced ? !emph : false;
    for (const ch of [...part.replace(/\*/g, '')]) out.push({ ch, emph });
  });
  return out;
}
export const stripEmphasis = (s: string) => (s || '').replace(/\*\*/g, '');

function tokenize(glyphs: Glyph[]): Glyph[][] {
  const tokens: Glyph[][] = [];
  let cur: Glyph[] = [];
  for (const g of glyphs) {
    if (/\s/.test(g.ch)) {
      if (cur.length) tokens.push(cur);
      cur = [];
    } else cur.push(g);
  }
  if (cur.length) tokens.push(cur);
  return tokens;
}

// 어절 단위 탐욕 줄바꿈. 한 어절이 한 줄보다 길면 글자 단위로 자른다.
function greedyLines(tokens: Glyph[][], st: TextStyle, maxW: number): Glyph[][] {
  const space: Glyph = { ch: ' ', emph: false };
  const spaceW = glyphW(space, st);
  const lines: Glyph[][] = [];
  let cur: Glyph[] = [];
  let curW = 0;
  const flush = () => {
    if (cur.length) lines.push(cur);
    cur = [];
    curW = 0;
  };
  for (const tok of tokens) {
    const tw = lineW(tok, st);
    if (tw > maxW) {
      flush();
      let piece: Glyph[] = [];
      let pw = 0;
      for (const g of tok) {
        const gw = glyphW(g, st);
        if (pw + gw > maxW && piece.length) {
          lines.push(piece);
          piece = [];
          pw = 0;
        }
        piece.push(g);
        pw += gw;
      }
      cur = piece;
      curW = pw;
      continue;
    }
    if (cur.length === 0) {
      cur = tok.slice();
      curW = tw;
    } else if (curW + spaceW + tw <= maxW) {
      cur = cur.concat(space, tok);
      curW += spaceW + tw;
    } else {
      flush();
      cur = tok.slice();
      curW = tw;
    }
  }
  flush();
  return lines;
}

// 줄 수는 그대로 두고 가장 좁은 폭으로 다시 나눠서, 마지막 줄에 한 어절만 덩그러니 남는 것을 막는다.
function wrapBalanced(glyphs: Glyph[], st: TextStyle, maxW: number): Glyph[][] {
  const tokens = tokenize(glyphs);
  if (tokens.length === 0) return [];
  const base = greedyLines(tokens, st, maxW);
  if (base.length <= 1) return base;
  let lo = Math.max(...tokens.map((t) => Math.min(lineW(t, st), maxW)));
  let hi = maxW;
  let best = base;
  for (let i = 0; i < 14 && hi - lo > 1; i++) {
    const mid = (lo + hi) / 2;
    const tryLines = greedyLines(tokens, st, mid);
    if (tryLines.length <= base.length) {
      best = tryLines;
      hi = mid;
    } else lo = mid;
  }
  return best;
}

// 최대 줄 수 안에 들어오도록 글자 크기를 조금씩 줄이고(최대 28%), 그래도 넘치면 말줄임표로 자른다.
function fitText(
  text: string,
  base: TextStyle,
  maxW: number,
  maxLines: number
): { lines: Glyph[][]; style: TextStyle } {
  const glyphs = parseGlyphs(text);
  let st = base;
  for (let step = 0; step <= 4; step++) {
    st = { ...base, size: Math.round(base.size * (1 - step * 0.07)), tracking: base.tracking * (1 - step * 0.07) };
    const lines = wrapBalanced(glyphs, st, maxW);
    if (lines.length <= maxLines) return { lines, style: st };
  }
  const lines = wrapBalanced(glyphs, st, maxW).slice(0, maxLines);
  const last = lines[lines.length - 1];
  while (last.length > 1 && lineW(last, st) + glyphW({ ch: '…', emph: false }, st) > maxW) last.pop();
  last.push({ ch: '…', emph: false });
  return { lines, style: st };
}

function drawLine(ctx: Ctx, line: Glyph[], st: TextStyle, x: number, y: number, align: 'center' | 'left', color: string, emphColor: string) {
  const total = lineW(line, st);
  let cx = align === 'center' ? x - total / 2 : x;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const g of line) {
    ctx.font = `${st.size}px ${g.emph ? st.emphFont : st.font}`;
    ctx.fillStyle = g.emph ? emphColor : color;
    ctx.fillText(g.ch, cx, y);
    cx += glyphW(g, st);
  }
}

function roundedRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
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

// ---------------------------------------------------------------------------
// 문구 블록 (위계형)
// ---------------------------------------------------------------------------
type Tier =
  | { kind: 'text'; lines: Glyph[][]; st: TextStyle; color: string; emphColor: string; lineHeight: number; gapBefore: number }
  | { kind: 'bar'; w: number; h: number; color: string; gapBefore: number }
  | { kind: 'badge'; text: string; size: number; textColor: string; bgColor: string; gapBefore: number }
  | {
      kind: 'list';
      items: { number: string; lines: Glyph[][] }[];
      st: TextStyle;
      numColor: string;
      textColor: string;
      emphColor: string;
      lineHeight: number;
      colW: number;
      lineColor: string;
      gapBefore: number;
    };

const BADGE_PAD_X = 28;
const BADGE_PAD_Y = 14;
const LIST_ITEM_PAD = 20;
const LIST_NUM_COL = 72;

interface BlockLayout {
  align: 'center' | 'left';
  innerW: number; // 글자가 들어가는 폭
}

function buildTiers(input: DetailSectionInput, colors: ThemeColors, layout: BlockLayout): { tiers: Tier[]; height: number } {
  const tiers: Tier[] = [];
  const { innerW, align } = layout;
  const push = (t: Tier) => tiers.push(t);
  const first = () => tiers.length === 0;

  const pushText = (
    raw: string | undefined,
    base: TextStyle,
    opts: { color: string; emphColor?: string; lineHeight: number; maxLines: number; gapBefore: number; maxW?: number }
  ) => {
    const text = (raw || '').trim();
    if (!text) return;
    const { lines, style } = fitText(text.replace(/\s*\n\s*/g, ' '), base, Math.min(innerW, opts.maxW ?? innerW), opts.maxLines);
    if (lines.length === 0) return;
    push({
      kind: 'text',
      lines,
      st: style,
      color: opts.color,
      emphColor: opts.emphColor ?? colors.accent,
      lineHeight: Math.round(opts.lineHeight * (style.size / base.size)),
      gapBefore: first() ? 0 : opts.gapBefore,
    });
  };

  const hasHeadline = !!input.description?.trim();
  const hasLead = !!(input.eyebrow?.trim() || hasHeadline || input.badge?.trim());

  // 포인트 바: 문구 블록 맨 위에 짧은 막대 하나 (레퍼런스의 흔한 장식)
  if (hasLead) push({ kind: 'bar', w: 44, h: 4, color: colors.accent, gapBefore: 0 });

  pushText(input.eyebrow, { font: FONT_BOLD, emphFont: FONT_BOLD, size: 22, tracking: 2 }, {
    color: colors.accent, emphColor: colors.accent, lineHeight: 32, maxLines: 2, gapBefore: 18,
  });
  pushText(input.description, { font: FONT_EXTRABOLD, emphFont: FONT_EXTRABOLD, size: 46, tracking: -1.4 }, {
    color: colors.text, lineHeight: 62, maxLines: 3, gapBefore: 18,
  });

  if (input.badge?.trim()) {
    push({
      kind: 'badge',
      text: input.badge.trim(),
      size: 20,
      textColor: colors.onAccent,
      bgColor: colors.accent,
      gapBefore: first() ? 0 : 28,
    });
  }

  if (hasLead && (input.accentTitle?.trim() || input.stat?.trim())) {
    push({ kind: 'bar', w: 1, h: 1, color: 'transparent', gapBefore: 28 }); // 간격만
  }

  pushText(input.accentTitle, { font: FONT_BOLD, emphFont: FONT_BOLD, size: 32, tracking: 4 }, {
    color: colors.accent, emphColor: colors.accent, lineHeight: 44, maxLines: 1, gapBefore: 20,
  });
  pushText(input.accentSubtitle, { font: FONT_BOLD, emphFont: FONT_BOLD, size: 20, tracking: 0 }, {
    color: colors.textMuted, emphColor: colors.textMuted, lineHeight: 30, maxLines: 1, gapBefore: 8,
  });
  pushText(input.stat, { font: FONT_EXTRABOLD, emphFont: FONT_EXTRABOLD, size: 104, tracking: -2 }, {
    color: colors.accent, emphColor: colors.accent, lineHeight: 116, maxLines: 1, gapBefore: 24,
  });
  pushText(input.statCaption, { font: FONT_BOLD, emphFont: FONT_EXTRABOLD, size: 26, tracking: -0.4 }, {
    color: colors.text, lineHeight: 38, maxLines: 2, gapBefore: 12,
  });
  pushText(input.bodyText, { font: FONT_BOLD, emphFont: FONT_EXTRABOLD, size: 24, tracking: -0.3 }, {
    color: colors.textMuted, emphColor: colors.text, lineHeight: 42, maxLines: 8, gapBefore: 30, maxW: 620,
  });

  const listLines = (input.listItems || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (listLines.length > 0) {
    const colW = Math.min(innerW, 640);
    const st: TextStyle = { font: FONT_BOLD, emphFont: FONT_EXTRABOLD, size: 28, tracking: -0.4 };
    const items = listLines.map((line, i) => ({
      number: String(i + 1).padStart(2, '0'),
      lines: fitText(line, st, colW - LIST_NUM_COL, 2).lines,
    }));
    push({
      kind: 'list',
      items,
      st,
      numColor: colors.accent,
      textColor: colors.text,
      emphColor: colors.accent,
      lineHeight: 40,
      colW,
      lineColor: colors.divider,
      gapBefore: first() ? 0 : 36,
    });
  }

  let height = 0;
  for (const t of tiers) {
    height += t.gapBefore;
    if (t.kind === 'bar') height += t.h;
    else if (t.kind === 'badge') height += t.size + BADGE_PAD_Y * 2;
    else if (t.kind === 'list') {
      t.items.forEach((it, i) => {
        height += it.lines.length * t.lineHeight + LIST_ITEM_PAD * 2 - (i === 0 ? LIST_ITEM_PAD : 0) - (i === t.items.length - 1 ? LIST_ITEM_PAD : 0);
      });
    } else height += t.lines.length * t.lineHeight;
  }
  return { tiers, height };
}

function paintTiers(ctx: Ctx, tiers: Tier[], startY: number, layout: BlockLayout, originX: number) {
  let y = startY;
  const { align } = layout;
  for (const t of tiers) {
    y += t.gapBefore;
    if (t.kind === 'bar') {
      if (t.color !== 'transparent') {
        ctx.fillStyle = t.color;
        const x = align === 'center' ? originX - t.w / 2 : originX;
        ctx.fillRect(x, y, t.w, t.h);
      }
      y += t.h;
      continue;
    }
    if (t.kind === 'badge') {
      ctx.font = `${t.size}px ${FONT_BOLD}`;
      const tw = ctx.measureText(t.text).width;
      const bw = tw + BADGE_PAD_X * 2;
      const bh = t.size + BADGE_PAD_Y * 2;
      const bx = align === 'center' ? originX - bw / 2 : originX;
      roundedRect(ctx, bx, y, bw, bh, bh / 2);
      ctx.fillStyle = t.bgColor;
      ctx.fill();
      ctx.fillStyle = t.textColor;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.text, bx + BADGE_PAD_X, y + bh / 2 + 1);
      y += bh;
      continue;
    }
    if (t.kind === 'list') {
      const x0 = align === 'center' ? originX - t.colW / 2 : originX;
      t.items.forEach((it, i) => {
        const itemH = it.lines.length * t.lineHeight;
        if (i > 0) {
          ctx.fillStyle = t.lineColor;
          ctx.fillRect(x0, y + LIST_ITEM_PAD - 1, t.colW, 1);
          y += LIST_ITEM_PAD * 2;
        }
        ctx.font = `24px ${FONT_EXTRABOLD}`;
        ctx.fillStyle = t.numColor;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(it.number, x0, y + t.lineHeight / 2);
        it.lines.forEach((line, k) => {
          drawLine(ctx, line, t.st, x0 + LIST_NUM_COL, y + t.lineHeight / 2 + k * t.lineHeight, 'left', t.textColor, t.emphColor);
        });
        y += itemH;
      });
      continue;
    }
    t.lines.forEach((line, i) => {
      drawLine(ctx, line, t.st, originX, y + t.lineHeight / 2 + i * t.lineHeight, align, t.color, t.emphColor);
    });
    y += t.lines.length * t.lineHeight;
  }
}

// ---------------------------------------------------------------------------
// 마무리: 규격 검사 + JPEG
// ---------------------------------------------------------------------------
export async function finishDetailImage(png: Buffer): Promise<Buffer> {
  let img = sharp(png).flatten({ background: '#ffffff' }).toColourspace('srgb');
  const meta = await sharp(png).metadata();
  if (meta.width !== W) img = img.resize({ width: W });
  const out = await img.jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
  const check = await sharp(out).metadata();
  if (check.width !== W || !check.height) {
    throw new Error(`이미지 규격 오류: 가로 ${check.width}px (규격 ${W}px)`);
  }
  return out;
}

// 사진을 정확한 크기에 맞춘다. 비율이 비슷하면 꽉 채워 자르고, 많이 다르면 상품이 잘리지 않게
// 사진 전체를 가운데 두고 같은 사진을 흐리게 키워서 빈 곳을 채운다.
export async function fitToCanvas(buffer: Buffer, w: number, h: number): Promise<Buffer> {
  const meta = await sharp(buffer).metadata();
  const ar = (meta.width || w) / (meta.height || h);
  if (Math.abs(ar / (w / h) - 1) <= 0.12) {
    return sharp(buffer).resize({ width: w, height: h, fit: 'cover', position: 'centre' }).jpeg({ quality: 95 }).toBuffer();
  }
  const bg = await sharp(buffer).resize({ width: w, height: h, fit: 'cover' }).blur(28).modulate({ brightness: 0.92 }).toBuffer();
  const fg = await sharp(buffer).resize({ width: w, height: h, fit: 'inside' }).toBuffer();
  const fm = await sharp(fg).metadata();
  const fw = fm.width || w;
  const fh = fm.height || h;
  // 사진 가장자리를 부드럽게 풀어서 흐린 배경과 이어지는 경계선이 안 보이게 한다
  const mask = createCanvas(fw, fh);
  const mx = mask.getContext('2d');
  const feather = 56;
  const vertical = fh < h; // 위아래가 남으면 위아래 가장자리, 좌우가 남으면 좌우 가장자리
  const g = vertical ? mx.createLinearGradient(0, 0, 0, fh) : mx.createLinearGradient(0, 0, fw, 0);
  const span = vertical ? fh : fw;
  const f = Math.min(0.5, feather / span);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(f, 'rgba(0,0,0,1)');
  g.addColorStop(1 - f, 'rgba(0,0,0,1)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  mx.fillStyle = g;
  mx.fillRect(0, 0, fw, fh);
  const fgSoft = await sharp(fg)
    .ensureAlpha()
    .composite([{ input: mask.toBuffer('image/png'), blend: 'dest-in' }])
    .png()
    .toBuffer();
  return sharp(bg)
    .composite([{ input: fgSoft, left: Math.round((w - fw) / 2), top: Math.round((h - fh) / 2) }])
    .jpeg({ quality: 95 })
    .toBuffer();
}

const even = (n: number) => Math.ceil(n / 2) * 2;

// ---------------------------------------------------------------------------
// 1) 문구 + 사진 (흰 바탕 문구 구간 위, 사진 아래)
// ---------------------------------------------------------------------------
export async function composeDetailSection(imageBuffer: Buffer, input: DetailSectionInput): Promise<Buffer> {
  const photo = await fitToCanvas(imageBuffer, W, DETAIL_PHOTO_HEIGHT);
  const colors = getThemeColors('light', input.palette);
  // 흰 바탕 장면은 항상 흰 배경 + 어두운 글자, 포인트 색만 테마/브랜드에서 가져온다
  const textColors: ThemeColors = { ...colors, text: '#1c1c1c', textMuted: 'rgba(28,28,28,0.6)' };
  const only: DetailSectionInput = { keyword: '', mood: '', description: input.description, eyebrow: input.eyebrow };
  if (!only.description.trim() && !only.eyebrow?.trim()) {
    return finishDetailImage(photo);
  }
  ensureKoreanFontRegistered();
  const layout: BlockLayout = { align: 'center', innerW: W - 128 };
  const { tiers, height } = buildTiers(only, textColors, layout);
  const padY = 96;
  const blockH = even(height + padY * 2);

  const canvas = createCanvas(W, blockH);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, blockH);
  paintTiers(ctx, tiers, padY, layout, W / 2);

  const out = await sharp({ create: { width: W, height: blockH + DETAIL_PHOTO_HEIGHT, channels: 3, background: '#ffffff' } })
    .composite([
      { input: canvas.toBuffer('image/png'), top: 0, left: 0 },
      { input: photo, top: blockH, left: 0 },
    ])
    .png()
    .toBuffer();
  return finishDetailImage(out);
}

// ---------------------------------------------------------------------------
// 2) 문구만 (사진 없음)
// ---------------------------------------------------------------------------
export async function composeTypographySection(input: DetailSectionInput): Promise<Buffer> {
  ensureKoreanFontRegistered();
  const colors = getThemeColors(input.theme, input.palette);
  const layout: BlockLayout = { align: 'center', innerW: W - 128 };
  const { tiers, height } = buildTiers(input, colors, layout);
  const padY = 120;
  const totalH = even(Math.max(DETAIL_MIN_HEIGHT, height + padY * 2));

  const canvas = createCanvas(W, totalH);
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, totalH);
  grad.addColorStop(0, colors.bgTop);
  grad.addColorStop(1, colors.bgBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, totalH);
  paintTiers(ctx, tiers, Math.round((totalH - height) / 2), layout, W / 2);
  return finishDetailImage(canvas.toBuffer('image/png'));
}

// ---------------------------------------------------------------------------
// 3) 사진 위에 문구 (고정 860x1075)
//    테마별 배치: dark = 아래쪽 왼쪽 정렬(라이프스타일), light = 위쪽 가운데, purple = 아래쪽 가운데
// ---------------------------------------------------------------------------
function overlayPlacement(theme: DetailSectionTheme | undefined): { placement: 'top' | 'bottom'; align: 'center' | 'left' } {
  if (theme === 'light') return { placement: 'top', align: 'center' };
  if (theme === 'purple') return { placement: 'bottom', align: 'center' };
  return { placement: 'bottom', align: 'left' };
}

export async function composeOverlaySection(imageBuffer: Buffer, input: DetailSectionInput): Promise<Buffer> {
  const H = DETAIL_OVERLAY_HEIGHT;
  const photo = await fitToCanvas(imageBuffer, W, H);
  ensureKoreanFontRegistered();
  const colors = getThemeColors(input.theme, input.palette);
  const { placement, align } = overlayPlacement(input.theme);
  const margin = 72;
  const layout: BlockLayout = { align, innerW: W - margin * 2 };
  const { tiers, height } = buildTiers(input, colors, layout);
  if (tiers.length === 0) return finishDetailImage(photo);

  const pad = 84;
  const fade = Math.min(H, height + pad * 2 + 240);
  const overlay = createCanvas(W, H);
  const ctx = overlay.getContext('2d');
  const [r, g, b] = colors.scrimTint;
  const y0 = placement === 'top' ? 0 : H;
  const y1 = placement === 'top' ? fade : H - fade;
  const grad = ctx.createLinearGradient(0, y0, 0, y1);
  const solid = Math.min(0.97, (height + pad * 2) / fade);
  grad.addColorStop(0, `rgba(${r},${g},${b},0.86)`);
  grad.addColorStop(solid, `rgba(${r},${g},${b},0.6)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, placement === 'top' ? 0 : H - fade, W, fade);

  const startY = placement === 'top' ? pad : H - pad - height;
  paintTiers(ctx, tiers, startY, layout, align === 'center' ? W / 2 : margin);

  const out = await sharp(photo).composite([{ input: overlay.toBuffer('image/png'), top: 0, left: 0 }]).png().toBuffer();
  return finishDetailImage(out);
}

// ---------------------------------------------------------------------------
// 4) 제품 사양 표 (라벨/값)
// ---------------------------------------------------------------------------
export async function composeSpecTableSection(rows: SpecRow[], title?: string, palette?: BrandPalette | null): Promise<Buffer> {
  ensureKoreanFontRegistered();
  const colors = getThemeColors('light', palette);
  const cardMargin = 24;
  const cardPadX = 48;
  const cardPadY = 56;
  const rowSize = 22;
  const rowLine = 34;
  const rowPadY = 20;
  const labelCol = 170;
  const cardW = W - cardMargin * 2;
  const valueW = cardW - cardPadX * 2 - labelCol;
  const valueSt: TextStyle = { font: FONT_BOLD, emphFont: FONT_EXTRABOLD, size: rowSize, tracking: -0.2 };

  const titleText = title?.trim() || '제품 사양';
  const laid = rows.map((r) => ({
    label: r.label.trim() || '-',
    lines: wrapBalanced(parseGlyphs(r.value.trim() || '-'), valueSt, valueW),
  }));
  const rowsH = laid.reduce((s, r) => s + Math.max(1, r.lines.length) * rowLine + rowPadY * 2, 0);
  const titleBlock = 34 + 22 + 30 + 28; // 포인트 바 + 제목 + 여백
  const cardH = cardPadY + titleBlock + rowsH + cardPadY - 8;
  const H = even(cardMargin * 2 + cardH);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  roundedRect(ctx, cardMargin, cardMargin, cardW, cardH, 24);
  ctx.fillStyle = '#f6f5f3';
  ctx.fill();

  let y = cardMargin + cardPadY;
  const x0 = cardMargin + cardPadX;
  ctx.fillStyle = colors.accent;
  ctx.fillRect(x0, y, 44, 4);
  y += 34;
  ctx.font = `38px ${FONT_EXTRABOLD}`;
  ctx.fillStyle = '#1c1c1c';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(titleText, x0, y + 22);
  y += 22 + 30 + 28;

  for (const row of laid) {
    const rh = Math.max(1, row.lines.length) * rowLine + rowPadY * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(x0, y, cardW - cardPadX * 2, 1);
    ctx.font = `${rowSize}px ${FONT_BOLD}`;
    ctx.fillStyle = 'rgba(28,28,28,0.5)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(row.label, x0, y + rowPadY + rowLine / 2);
    row.lines.forEach((line, i) => {
      drawLine(ctx, line, valueSt, x0 + labelCol, y + rowPadY + rowLine / 2 + i * rowLine, 'left', '#1c1c1c', colors.accent);
    });
    y += rh;
  }
  return finishDetailImage(canvas.toBuffer('image/png'));
}

// ---------------------------------------------------------------------------
// 5) 사이즈표 (사용자가 직접 입력한 한국 기준 치수)
// ---------------------------------------------------------------------------
export async function composeSizeTableSection(table: SizeTable, palette?: BrandPalette | null): Promise<Buffer> {
  const t = normalizeSizeTable(table);
  if (!t) throw new Error('사이즈표에 열 2개 이상, 행 1개 이상이 필요해요.');
  ensureKoreanFontRegistered();
  const colors = getThemeColors('light', palette);
  const headFill = parseHex(palette?.primary) ? css(mix(parseHex(palette!.primary)!, BLACK, 0.15)) : '#1c1c1c';
  const headText = '#ffffff';

  const marginX = 40;
  const tableW = W - marginX * 2;
  const n = t.headers.length;
  const firstW = n <= 3 ? Math.round(tableW * 0.3) : Math.round(tableW / (n + 0.6));
  const restW = (tableW - firstW) / (n - 1);
  const colW = (i: number) => (i === 0 ? firstW : restW);

  // 가장 긴 칸이 칸 폭에 들어오도록 글자 크기를 정한다 (한 표는 한 가지 크기로 통일)
  let size = n <= 4 ? 26 : n <= 6 ? 23 : 20;
  const fits = (s: number) => {
    const c = mctx();
    c.font = `${s}px ${FONT_BOLD}`;
    const cells = [t.headers, ...t.rows];
    return cells.every((row) => row.every((v, i) => c.measureText(v).width <= colW(i) - 16));
  };
  while (size > 14 && !fits(size)) size -= 1;

  const rowH = Math.round(size * 2.5);
  const headH = Math.round(rowH * 1.1);
  const title = t.title || '사이즈표';
  const noteText = t.note || '';

  // 제목 영역
  const noteSt: TextStyle = { font: FONT_BOLD, emphFont: FONT_BOLD, size: 19, tracking: -0.2 };
  const noteLines = noteText ? wrapBalanced(parseGlyphs(noteText), noteSt, tableW) : [];
  const topPad = 88;
  const titleH = 4 + 22 + 16 + 24 + 8 + 40; // 바 + 영문 + 제목
  const tableH = headH + rowH * t.rows.length;
  const noteH = noteLines.length ? 28 + noteLines.length * 30 : 0;
  const H = even(topPad + titleH + 40 + tableH + noteH + 88);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  let y = topPad;
  ctx.fillStyle = colors.accent;
  ctx.fillRect(W / 2 - 22, y, 44, 4);
  y += 4 + 22;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `20px ${FONT_BOLD}`;
  ctx.fillStyle = colors.accent;
  const guide = 'SIZE GUIDE';
  // 자간을 벌려서 그린다
  {
    const chars = [...guide];
    const cw = chars.map((c) => ctx.measureText(c).width + 5);
    let x = W / 2 - cw.reduce((a, b) => a + b, 0) / 2;
    ctx.textAlign = 'left';
    chars.forEach((c, i) => {
      ctx.fillText(c, x, y + 10);
      x += cw[i];
    });
  }
  y += 16 + 24 + 8;
  ctx.textAlign = 'center';
  ctx.font = `44px ${FONT_EXTRABOLD}`;
  ctx.fillStyle = '#1c1c1c';
  ctx.fillText(title, W / 2, y + 20);
  y += 40 + 40;

  // 표
  const x0 = marginX;
  ctx.fillStyle = headFill;
  ctx.fillRect(x0, y, tableW, headH);
  ctx.font = `${size}px ${FONT_EXTRABOLD}`;
  ctx.fillStyle = headText;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let cx = x0;
  t.headers.forEach((h, i) => {
    ctx.fillText(h, cx + colW(i) / 2, y + headH / 2 + 1);
    cx += colW(i);
  });
  y += headH;
  t.rows.forEach((row, ri) => {
    ctx.fillStyle = ri % 2 === 0 ? '#ffffff' : '#f6f5f3';
    ctx.fillRect(x0, y, tableW, rowH);
    let rx = x0;
    row.forEach((v, i) => {
      ctx.font = `${size}px ${i === 0 ? FONT_EXTRABOLD : FONT_BOLD}`;
      ctx.fillStyle = i === 0 ? '#1c1c1c' : 'rgba(28,28,28,0.78)';
      ctx.fillText(v, rx + colW(i) / 2, y + rowH / 2 + 1);
      rx += colW(i);
    });
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(x0, y + rowH - 1, tableW, 1);
    y += rowH;
  });
  // 표 바깥 위/아래 선
  ctx.fillStyle = headFill;
  ctx.fillRect(x0, y - 1, tableW, 2);

  if (noteLines.length) {
    y += 28;
    noteLines.forEach((line, i) => {
      drawLine(ctx, line, noteSt, W / 2, y + 15 + i * 30, 'center', 'rgba(28,28,28,0.55)', 'rgba(28,28,28,0.8)');
    });
  }
  return finishDetailImage(canvas.toBuffer('image/png'));
}

// ---------------------------------------------------------------------------
// 6) 브랜드 머리글/바닥글
// ---------------------------------------------------------------------------
export interface BrandSpec {
  brandName: string;
  tagline: string;
  footerTitle: string;
  footerNotice: string; // 줄바꿈으로 구분된 안내 문구
  palette: BrandPalette;
}

async function logoPng(logo: Buffer | null, maxW: number, maxH: number) {
  if (!logo) return null;
  try {
    const buf = await sharp(logo).resize({ width: maxW, height: maxH, fit: 'inside', withoutEnlargement: false }).png().toBuffer();
    const m = await sharp(buf).metadata();
    return { buf, w: m.width || maxW, h: m.height || maxH };
  } catch {
    return null; // 로고가 깨져 있어도 머리글/바닥글은 만든다
  }
}

export async function composeBrandHeader(spec: BrandSpec, logo: Buffer | null): Promise<Buffer> {
  ensureKoreanFontRegistered();
  const colors = getThemeColors('dark', spec.palette);
  const lg = await logoPng(logo, 300, 140);
  const layout: BlockLayout = { align: 'center', innerW: W - 160 };
  const intro: DetailSectionInput = {
    keyword: '',
    mood: '',
    description: '',
    accentTitle: spec.brandName,
    bodyText: spec.tagline,
  };
  const { tiers, height } = buildTiers(intro, colors, layout);
  const gap = lg ? 44 : 0;
  const logoH = lg ? lg.h : 0;
  const padY = 120;
  const H = even(Math.max(DETAIL_MIN_HEIGHT - 120, padY * 2 + logoH + gap + height));

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, colors.bgTop);
  grad.addColorStop(1, colors.bgBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  const total = logoH + gap + height;
  const startY = Math.round((H - total) / 2);
  const comps: OverlayOptions[] = [];
  if (lg) comps.push({ input: lg.buf, left: Math.round((W - lg.w) / 2), top: startY });
  paintTiers(ctx, tiers, startY + logoH + gap, layout, W / 2);
  const base = await sharp(canvas.toBuffer('image/png')).composite(comps).png().toBuffer();
  return finishDetailImage(base);
}

export async function composeBrandFooter(spec: BrandSpec, logo: Buffer | null): Promise<Buffer> {
  ensureKoreanFontRegistered();
  const colors = getThemeColors('light', spec.palette);
  const lg = await logoPng(logo, 180, 80);
  const margin = 72;
  const innerW = W - margin * 2;
  const titleSt: TextStyle = { font: FONT_EXTRABOLD, emphFont: FONT_EXTRABOLD, size: 30, tracking: -0.6 };
  const bodySt: TextStyle = { font: FONT_BOLD, emphFont: FONT_EXTRABOLD, size: 20, tracking: -0.2 };
  const lineH = 32;

  const noticeLines = (spec.footerNotice || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => wrapBalanced(parseGlyphs(`• ${s}`), bodySt, innerW - 8));
  const title = spec.footerTitle?.trim() || '안내사항';
  const noticeH = noticeLines.reduce((sum, l) => sum + l.length * lineH + 10, 0);
  const padY = 88;
  const logoH = lg ? lg.h + 36 : 0;
  const nameH = spec.brandName.trim() ? 40 + 24 : 0;
  const H = even(padY + 4 + 26 + 44 + noticeH + 48 + logoH + nameH + padY);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = css(mix(parseHex(spec.palette.primary) || [28, 28, 28], WHITE, 0.94));
  ctx.fillRect(0, 0, W, H);

  let y = padY;
  ctx.fillStyle = colors.accent;
  ctx.fillRect(margin, y, 44, 4);
  y += 4 + 26;
  drawLine(ctx, parseGlyphs(title), titleSt, margin, y + 22, 'left', '#1c1c1c', colors.accent);
  y += 44;
  noticeLines.forEach((lines) => {
    lines.forEach((l, i) => {
      drawLine(ctx, l, bodySt, margin + (i > 0 ? 14 : 0), y + lineH / 2, 'left', 'rgba(28,28,28,0.7)', '#1c1c1c');
      y += lineH;
    });
    y += 10;
  });
  y += 48;
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(margin, y - 24, innerW, 1);

  const comps: OverlayOptions[] = [];
  if (lg) {
    comps.push({ input: lg.buf, left: Math.round((W - lg.w) / 2), top: Math.round(y) });
    y += lg.h + 36;
  }
  if (spec.brandName.trim()) {
    ctx.font = `26px ${FONT_EXTRABOLD}`;
    ctx.fillStyle = '#1c1c1c';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(spec.brandName.trim(), W / 2, y + 20);
  }
  const base = await sharp(canvas.toBuffer('image/png')).composite(comps).png().toBuffer();
  return finishDetailImage(base);
}

// ---------------------------------------------------------------------------
// 7) 이어붙이기: 장면 이미지들을 세로로 이어붙여 긴 이미지 여러 장으로 (장면 경계에서만 나눔)
// ---------------------------------------------------------------------------
export async function stitchVertical(images: Buffer[], maxHeight: number): Promise<Buffer[]> {
  const metas = await Promise.all(images.map((b) => sharp(b).metadata()));
  const groups: { bufs: Buffer[]; heights: number[] }[] = [];
  let cur: { bufs: Buffer[]; heights: number[] } = { bufs: [], heights: [] };
  let curH = 0;
  images.forEach((b, i) => {
    const h = metas[i].height || 0;
    if (cur.bufs.length > 0 && curH + h > maxHeight) {
      groups.push(cur);
      cur = { bufs: [], heights: [] };
      curH = 0;
    }
    cur.bufs.push(b);
    cur.heights.push(h);
    curH += h;
  });
  if (cur.bufs.length) groups.push(cur);

  const out: Buffer[] = [];
  for (const g of groups) {
    const total = g.heights.reduce((a, b) => a + b, 0);
    let top = 0;
    const comps = g.bufs.map((input, i) => {
      const c = { input, left: 0, top };
      top += g.heights[i];
      return c;
    });
    const png = await sharp({ create: { width: W, height: total, channels: 3, background: '#ffffff' } })
      .composite(comps)
      .png()
      .toBuffer();
    out.push(await finishDetailImage(png));
  }
  return out;
}
