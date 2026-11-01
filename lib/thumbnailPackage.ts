// 썸네일 "패키지(세트) 구성" - 예: 검정 1 + 회색 1을 한 패키지로 파는 상품.
// 색상별 사진을 개별로 만드는 대신, 패키지에 들어가는 색상/수량 그대로 한 장에 담은 이미지를 만든다.
// 수량 1 = 그 색상 사진에 찍힌 상품 한 묶음(사진에 보이는 그대로)을 1개로 센다.
export interface PackageItem {
  color: string; // 올린 사진의 색상 라벨과 같은 이름
  qty: number; // 1 ~ MAX_QTY
}
export interface PackageSpec {
  items: PackageItem[];
  additional: number; // 이 패키지로 만들 추가 이미지 개수 (0 ~ MAX_PACKAGE_ADDITIONAL)
  layout?: 'grid' | 'hero'; // grid: 같은 크기로 나열 / hero: 대표 1개를 크게 + 나머지를 오른쪽 세로 줄에 작게
  badge?: boolean; // 오른쪽 위에 수량 배지("5P")를 붙인다
}

export const MAX_QTY = 6;
export const MAX_UNITS = 8; // 한 장에 담는 상품 개수 합계 상한 (그 이상은 작아져서 알아보기 어려움)
export const MAX_PACKAGES = 4;
export const MAX_PACKAGE_ADDITIONAL = 8;

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
export const sameColor = (a: string, b: string) => !!norm(a) && norm(a) === norm(b);

// 대표형은 상품이 3~6개일 때만 쓴다 (2개는 격자가 더 자연스럽고, 7개 이상은 작은 줄이 너무 작아짐)
export const HERO_MIN_UNITS = 3;
export const HERO_MAX_UNITS = 6;
export const canUseHero = (units: number) => units >= HERO_MIN_UNITS && units <= HERO_MAX_UNITS;
export const unitCount = (items: PackageItem[]) => items.reduce((s, i) => s + i.qty, 0);

export function packageLabel(p: PackageSpec): string {
  const base = `패키지 ${p.items.map((i) => `${i.color} ${i.qty}`).join(' + ')}`;
  // 같은 구성이라도 배치/배지가 다르면 서로 다른 메인으로 구분한다 (다시 만들 때 덮어쓰기 기준)
  return `${base}${p.layout === 'hero' ? ' 대표형' : ''}${p.badge ? ' 배지' : ''}`;
}

// 화면에서 보낸 JSON을 검증/정리. 잘못된 항목은 버린다 (색상 없음, 수량 이상, 같은 색상 중복은 합침).
export function parsePackages(raw: unknown): { packages: PackageSpec[]; warnings: string[] } {
  const warnings: string[] = [];
  let arr: unknown = raw;
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw || '[]');
    } catch {
      return { packages: [], warnings: ['패키지 구성을 읽지 못해서 패키지는 만들지 않았어요.'] };
    }
  }
  if (!Array.isArray(arr)) return { packages: [], warnings: [] };
  const packages: PackageSpec[] = [];
  for (const p of arr.slice(0, MAX_PACKAGES)) {
    const items: PackageItem[] = [];
    for (const it of Array.isArray((p as any)?.items) ? (p as any).items : []) {
      const color = String(it?.color ?? '').trim().slice(0, 20);
      const qty = Math.round(Number(it?.qty));
      if (!color || !Number.isFinite(qty) || qty < 1) continue;
      const found = items.find((x) => sameColor(x.color, color));
      if (found) found.qty = Math.min(MAX_QTY, found.qty + qty);
      else items.push({ color, qty: Math.min(MAX_QTY, qty) });
    }
    if (items.length === 0) continue;
    let total = items.reduce((s, i) => s + i.qty, 0);
    if (total > MAX_UNITS) {
      warnings.push(`패키지 "${packageLabel({ items, additional: 0 })}"는 상품이 ${total}개라 많아서 ${MAX_UNITS}개까지만 담았어요.`);
      for (let i = items.length - 1; i >= 0 && total > MAX_UNITS; i--) {
        const cut = Math.min(items[i].qty - (i === 0 ? 1 : 0), total - MAX_UNITS);
        items[i].qty -= Math.max(0, cut);
        total -= Math.max(0, cut);
      }
    }
    const add = Math.round(Number((p as any)?.additional));
    const kept = items.filter((i) => i.qty > 0);
    let layout: 'grid' | 'hero' = (p as any)?.layout === 'hero' ? 'hero' : 'grid';
    if (layout === 'hero' && !canUseHero(unitCount(kept))) {
      warnings.push(`대표형 배치는 상품이 ${HERO_MIN_UNITS}~${HERO_MAX_UNITS}개일 때만 돼서 "${packageLabel({ items: kept, additional: 0 })}"는 나열형으로 만들었어요.`);
      layout = 'grid';
    }
    packages.push({
      items: kept,
      additional: Number.isFinite(add) ? Math.max(0, Math.min(MAX_PACKAGE_ADDITIONAL, add)) : 3,
      layout,
      badge: (p as any)?.badge === true,
    });
  }
  return { packages, warnings };
}

// 상품 n개를 한 장에 놓을 때의 줄/칸 수: 3개까지는 한 줄, 그 이상은 위아래 두 줄 이상
export function packageGrid(n: number): { cols: number; rows: number } {
  const cols = n <= 3 ? Math.max(1, n) : n <= 6 ? 3 : 4;
  return { cols, rows: Math.ceil(n / cols) };
}
