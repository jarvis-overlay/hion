// 썸네일 패키지 템플릿: 상품 n개를 한 장(1000x1000)에 어떻게 놓을지 정하는 "칸 계산"만 모아둔 순수 모듈.
// (sharp/canvas를 쓰지 않아 화면(클라이언트)에서도 가져다 쓸 수 있다.)
// 상품 수량과 형태(가로로 넓은지, 세로로 긴지)가 상품마다 다르므로 여러 템플릿을 두고,
// 고르기 어려우면 "자동 추천"이 수량과 형태로 골라준다.
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Cell extends Box {
  scale: number; // 칸 안에서 상품이 차지하는 비율 (1 = 꽉 채움)
}

export type TemplateId = 'grid' | 'hero-side' | 'hero-bottom' | 'pyramid' | 'stagger';
export type TemplateChoice = TemplateId | 'auto';

export interface TemplateDef {
  id: TemplateId;
  name: string;
  desc: string;
  min: number; // 쓸 수 있는 상품 수
  max: number;
  best: string; // 어떤 상품에 잘 맞는지 (화면 안내용)
  cells: (n: number, box: Box) => Cell[];
}

export const BADGE_STRIP = 90; // 수량 배지를 달 때 맨 위에 비워두는 높이

const cell = (x: number, y: number, w: number, h: number, scale = 1): Cell => ({
  x: Math.round(x),
  y: Math.round(y),
  w: Math.round(w),
  h: Math.round(h),
  scale,
});

// 같은 크기로 나열 (줄 수는 상품 수에 맞춰 자동). 마지막 줄이 모자라면 가운데로.
function gridCells(n: number, box: Box): Cell[] {
  const cols = n <= 3 ? Math.max(1, n) : n <= 6 ? 3 : 4;
  const rows = Math.ceil(n / cols);
  const cw = box.w / cols;
  const ch = box.h / rows;
  const out: Cell[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const inRow = r === rows - 1 ? n - r * cols : cols;
    const off = ((cols - inRow) * cw) / 2;
    out.push(cell(box.x + off + c * cw, box.y + r * ch, cw, ch, 1));
  }
  return out;
}

// 대표 1개를 왼쪽에 크게, 나머지는 오른쪽 세로 줄에 작게
function heroSideCells(n: number, box: Box): Cell[] {
  const k = n - 1;
  const heroW = box.w * 0.64;
  const colX = box.x + box.w * 0.68;
  const colW = box.w * 0.32;
  const ch = box.h / k;
  const out = [cell(box.x, box.y, heroW, box.h, 1)];
  for (let i = 0; i < k; i++) out.push(cell(colX, box.y + i * ch, colW, ch, 0.9));
  return out;
}

// 대표 1개를 위에 크게, 나머지는 아래 가로 줄에 작게 (세로로 긴 상품에 어울림)
function heroBottomCells(n: number, box: Box): Cell[] {
  const k = n - 1;
  const heroH = box.h * 0.62;
  const cw = box.w / k;
  const out = [cell(box.x, box.y, box.w, heroH, 1)];
  for (let i = 0; i < k; i++) out.push(cell(box.x + i * cw, box.y + heroH + box.h * 0.02, cw, box.h * 0.36, 0.92));
  return out;
}

// 위가 좁고 아래가 넓은 삼각 배치 (3: 1+2, 4: 1+3, 5: 2+3, 6: 1+2+3)
const PYRAMID_ROWS: Record<number, number[]> = { 3: [1, 2], 4: [1, 3], 5: [2, 3], 6: [1, 2, 3] };
function pyramidCells(n: number, box: Box): Cell[] {
  const rowsDef = PYRAMID_ROWS[n] || [n];
  const maxCols = Math.max(...rowsDef);
  const ch = box.h / rowsDef.length;
  const cw = box.w / maxCols;
  const out: Cell[] = [];
  rowsDef.forEach((count, r) => {
    const off = ((maxCols - count) * cw) / 2;
    for (let c = 0; c < count; c++) out.push(cell(box.x + off + c * cw, box.y + r * ch, cw, ch, 1.05));
  });
  return out;
}

// 위아래로 엇갈리게 겹쳐 놓기 (납작한 상품·여러 장 묶음 느낌). 뒤에서 앞으로 그려 겹친다.
function staggerCells(n: number, box: Box): Cell[] {
  const overlap = 0.5; // 이웃과 겹치는 정도
  const cw = box.w / (1 + (n - 1) * (1 - overlap));
  const ch = box.h * 0.56;
  const stepX = n > 1 ? (box.w - cw) / (n - 1) : 0;
  const out: Cell[] = [];
  for (let i = 0; i < n; i++) {
    const y = box.y + (i % 2 === 0 ? box.h * 0.04 : box.h * 0.4);
    out.push(cell(box.x + i * stepX, y, cw, ch, 1));
  }
  return out;
}

export const PACKAGE_TEMPLATES: TemplateDef[] = [
  { id: 'grid', name: '나열형', desc: '같은 크기로 나란히', min: 1, max: 8, best: '어떤 상품이든 무난', cells: gridCells },
  { id: 'hero-side', name: '대표 + 세로줄', desc: '대표 1개 크게, 나머지는 옆에 세로로', min: 3, max: 6, best: '가로로 넓은 상품 (속옷·양말·지갑)', cells: heroSideCells },
  { id: 'hero-bottom', name: '대표 + 가로줄', desc: '대표 1개 크게, 나머지는 아래 가로로', min: 3, max: 6, best: '세로로 긴 상품 (병·텀블러·우산)', cells: heroBottomCells },
  { id: 'pyramid', name: '삼각 쌓기', desc: '위는 적게, 아래는 많게', min: 3, max: 6, best: '정사각에 가까운 상품 (박스·컵·소품)', cells: pyramidCells },
  { id: 'stagger', name: '엇갈려 겹치기', desc: '위아래로 엇갈리게 겹쳐서', min: 2, max: 6, best: '납작한 상품 (티셔츠·양말·수건)', cells: staggerCells },
];

export const TEMPLATE_IDS = PACKAGE_TEMPLATES.map((t) => t.id) as TemplateId[];
export const getTemplate = (id: string): TemplateDef | undefined => PACKAGE_TEMPLATES.find((t) => t.id === id);
export const templateFits = (id: TemplateId, units: number) => {
  const t = getTemplate(id);
  return !!t && units >= t.min && units <= t.max;
};
export const templateName = (id: string) => (id === 'auto' ? '자동 추천' : getTemplate(id)?.name ?? '나열형');

// 수량과 상품 형태(가로/세로 비율 평균, 모르면 1)로 알맞은 템플릿을 고른다.
export function recommendTemplate(units: number, aspect = 1): TemplateId {
  if (units < 3) return 'grid';
  if (aspect >= 1.15) return 'hero-side';
  if (aspect <= 0.8) return 'hero-bottom';
  return 'pyramid';
}

// 고른 템플릿을 실제로 쓸 수 있는 것으로 바꾼다 (자동 추천 풀기, 수량이 안 맞으면 나열형)
export function resolveTemplate(choice: TemplateChoice | undefined, units: number, aspect = 1): TemplateId {
  const pick = !choice || choice === 'auto' ? (choice === 'auto' ? recommendTemplate(units, aspect) : 'grid') : choice;
  return templateFits(pick, units) ? pick : 'grid';
}

// 좌우 반전 (칸의 x만 뒤집는다)
export function mirrorCells(cells: Cell[], box: Box): Cell[] {
  return cells.map((c) => ({ ...c, x: Math.round(box.x * 2 + box.w - (c.x + c.w)) }));
}

export type BadgeShape = 'pill' | 'circle' | 'square';
export type BadgeColor = 'red' | 'navy' | 'darkgray' | 'black' | 'green' | 'orange' | 'blue' | 'purple';
export const BADGE_SHAPES: { id: BadgeShape; name: string }[] = [
  { id: 'circle', name: '원' },
  { id: 'square', name: '둥근 사각' },
  { id: 'pill', name: '알약' },
];
export const BADGE_COLORS: { id: BadgeColor; name: string; hex: string }[] = [
  { id: 'navy', name: '남색', hex: '#1f3a68' },
  { id: 'red', name: '빨강', hex: '#c62828' },
  { id: 'darkgray', name: '다크그레이', hex: '#4b4f56' },
  { id: 'black', name: '검정', hex: '#222222' },
  { id: 'green', name: '초록', hex: '#2e7d32' },
  { id: 'orange', name: '주황', hex: '#e65100' },
  { id: 'blue', name: '파랑', hex: '#1565c0' },
  { id: 'purple', name: '보라', hex: '#6a3fa0' },
];
export const normBadgeShape = (v: unknown): BadgeShape => (BADGE_SHAPES.some((s) => s.id === v) ? (v as BadgeShape) : 'circle');
export const normBadgeColor = (v: unknown): BadgeColor => (BADGE_COLORS.some((c) => c.id === v) ? (v as BadgeColor) : 'navy');
