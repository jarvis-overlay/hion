// "재고·판매 현황" 화면용 집계. 서버에서 한 번 계산해서 클라이언트(탭 UI)에
// 직렬화 가능한 형태로 넘긴다. 전부 쿠팡 채널 기준이다 (재고 소진 위험은
// 쿠팡 로켓창고 재고 vs 쿠팡 판매속도로 봐야 의미가 있어서).
//
// 판매(out)는 quantity가 음수, 반품(in)은 양수로 저장돼 있다. 판매금액은
// 양수, 반품 추정 기록의 금액은 음수라서 그냥 더하면 순매출이 된다.

const KST_MS = 9 * 60 * 60 * 1000;
export const SERIES_DAYS = 60; // 일별 시계열 길이 (30일 + 직전 30일 비교용)

// 소진 예상 일수 기준 (일)
export const LOW_DAYS = 7;
export const EXCESS_DAYS = 90;
// 반품 주의: 최근 30일 판매 N건 이상이면서 반품 비율이 이 값 이상
export const RETURN_MIN_SOLD = 5;
export const RETURN_RATE_ALERT = 0.2;

export function kstDateStr(d: Date | string): string {
  const t = typeof d === 'string' ? new Date(d) : d;
  return new Date(t.getTime() + KST_MS).toISOString().slice(0, 10);
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// 시계열 조회 시작 시각 (KST 기준 SERIES_DAYS-1일 전 00:00)
export function seriesStartIso(todayStr: string): string {
  const start = addDays(todayStr, -(SERIES_DAYS - 1));
  return new Date(new Date(`${start}T00:00:00Z`).getTime() - KST_MS).toISOString();
}

export type RiskKey = 'soldout' | 'low' | 'returns' | 'excess';

// 숫자가 작을수록 급함
export const RISK_PRIORITY: Record<RiskKey, number> = {
  soldout: 0,
  low: 1,
  returns: 2,
  excess: 3,
};

export const RISK_LABEL: Record<RiskKey, string> = {
  soldout: '쿠팡 품절',
  low: '품절 임박',
  returns: '반품 주의',
  excess: '재고 과다·정체',
};

export interface ProductStat {
  id: string;
  name: string;
  isHidden: boolean;
  isReturnGrade: boolean;
  coupangStock: number;
  ownStock: number;
  sold7: number; // 순판매(판매-반품) 최근 7일
  sold30: number;
  amount7: number;
  amount30: number;
  soldGross30: number; // 반품 차감 전 판매수량
  returned30: number;
  dailyRate: number; // 최근 14일 순판매 일평균
  daysLeft: number | null; // 쿠팡 재고 / 일평균 (재고 0이거나 판매 없으면 null)
  risks: RiskKey[];
  daily14: number[]; // 최근 14일 일별 순판매 (오래된 날 → 오늘)
}

export interface DayStat {
  date: string;
  qty: number;
  amount: number;
  returns: number; // 반품 수량
}

export interface DayItem {
  name: string;
  qty: number;
  amount: number;
}

export interface StockSummary {
  todayQty: number;
  todayAmount: number;
  yesterdayQty: number;
  yesterdayAmount: number;
  weekQty: number;
  weekAmount: number;
  prevWeekQty: number;
  prevWeekAmount: number;
  weekElapsedDays: number; // 이번주(월요일 시작) 경과 일수, 오늘 포함
  coupangStockTotal: number;
  ownStockTotal: number;
  riskCounts: Record<RiskKey, number>;
  riskProductCount: number;
}

export interface StockStatsResult {
  products: ProductStat[];
  days: DayStat[]; // 오래된 날 → 오늘, 길이 SERIES_DAYS
  dayItems: Record<string, DayItem[]>; // 최근 30일 일자별 상품 내역
  summary: StockSummary;
}

interface ProductInput {
  id: string;
  name: string;
  is_hidden?: boolean | null;
  return_grade?: unknown;
  notes?: string | null;
}
interface StockRowInput {
  product_id: string;
  warehouse: string;
  quantity: number;
}
interface MovementInput {
  product_id: string;
  type: string;
  quantity: number;
  amount: number | null;
  occurred_at: string;
}

const sum = (arr: number[]) => arr.reduce((s, v) => s + v, 0);
const tail = (arr: number[], n: number) => arr.slice(arr.length - n);

export function riskPriorityOf(risks: RiskKey[]): number {
  return risks.length ? Math.min(...risks.map((r) => RISK_PRIORITY[r])) : 9;
}

export function buildStockStats(input: {
  products: ProductInput[];
  stockRows: StockRowInput[];
  movements: MovementInput[];
  todayStr: string;
}): StockStatsResult {
  const { products, stockRows, movements, todayStr } = input;

  const dates = Array.from({ length: SERIES_DAYS }, (_, i) =>
    addDays(todayStr, i - (SERIES_DAYS - 1))
  );
  const dateIndex = new Map(dates.map((d, i) => [d, i]));

  const makeArr = () => Array<number>(SERIES_DAYS).fill(0);
  const perProduct = new Map<
    string,
    { sold: number[]; returned: number[]; amount: number[] }
  >();
  const dayTotals = dates.map((date) => ({ date, qty: 0, amount: 0, returns: 0 }));

  for (const m of movements) {
    const idx = dateIndex.get(kstDateStr(m.occurred_at));
    if (idx === undefined) continue;
    let p = perProduct.get(m.product_id);
    if (!p) {
      p = { sold: makeArr(), returned: makeArr(), amount: makeArr() };
      perProduct.set(m.product_id, p);
    }
    const amount = Number(m.amount) || 0;
    if (m.type === 'out') {
      p.sold[idx] += -m.quantity;
      dayTotals[idx].qty += -m.quantity;
    } else if (m.type === 'in') {
      p.returned[idx] += m.quantity;
      dayTotals[idx].qty -= m.quantity;
      dayTotals[idx].returns += m.quantity;
    } else {
      continue;
    }
    p.amount[idx] += amount;
    dayTotals[idx].amount += amount;
  }

  const stockByProduct = new Map<string, { coupang: number; own: number }>();
  for (const r of stockRows) {
    const s = stockByProduct.get(r.product_id) || { coupang: 0, own: 0 };
    if (r.warehouse === 'coupang') s.coupang = Number(r.quantity) || 0;
    if (r.warehouse === 'own') s.own = Number(r.quantity) || 0;
    stockByProduct.set(r.product_id, s);
  }

  const dayItemsMap: Record<string, Map<string, DayItem>> = {};
  const lastThirty = dates.slice(-30);

  const stats: ProductStat[] = products.map((p) => {
    const series = perProduct.get(p.id);
    const stock = stockByProduct.get(p.id) || { coupang: 0, own: 0 };
    const net = series ? series.sold.map((v, i) => v - series.returned[i]) : makeArr();
    const amt = series ? series.amount : makeArr();

    const sold7 = sum(tail(net, 7));
    const sold14 = sum(tail(net, 14));
    const sold30 = sum(tail(net, 30));
    const soldGross30 = series ? sum(tail(series.sold, 30)) : 0;
    const returned30 = series ? sum(tail(series.returned, 30)) : 0;
    const dailyRate = sold14 / 14;
    const daysLeft = stock.coupang > 0 && dailyRate > 0 ? stock.coupang / dailyRate : null;

    const risks: RiskKey[] = [];
    if (stock.coupang <= 0 && sold14 > 0) risks.push('soldout');
    if (daysLeft !== null && daysLeft < LOW_DAYS) risks.push('low');
    if (soldGross30 >= RETURN_MIN_SOLD && returned30 / soldGross30 >= RETURN_RATE_ALERT) {
      risks.push('returns');
    }
    if (stock.coupang > 0 && (sold30 <= 0 || (daysLeft !== null && daysLeft > EXCESS_DAYS))) {
      risks.push('excess');
    }

    if (series) {
      lastThirty.forEach((date) => {
        const i = dateIndex.get(date)!;
        if (series.sold[i] === 0 && series.returned[i] === 0) return;
        const bucket = (dayItemsMap[date] ||= new Map());
        bucket.set(p.id, {
          name: p.name,
          qty: net[i],
          amount: amt[i],
        });
      });
    }

    return {
      id: p.id,
      name: p.name,
      isHidden: !!p.is_hidden,
      isReturnGrade: !!p.return_grade || (p.notes || '').includes('반품등급'),
      coupangStock: stock.coupang,
      ownStock: stock.own,
      sold7,
      sold30,
      amount7: sum(tail(amt, 7)),
      amount30: sum(tail(amt, 30)),
      soldGross30,
      returned30,
      dailyRate,
      daysLeft,
      risks,
      daily14: tail(net, 14),
    };
  });

  const dayItems: Record<string, DayItem[]> = {};
  for (const [date, bucket] of Object.entries(dayItemsMap)) {
    dayItems[date] = [...bucket.values()].sort((a, b) => b.qty - a.qty);
  }

  // 이번주는 월요일 시작. 지난주는 같은 경과 일수만큼만 비교해야 공정하다.
  const dow = new Date(`${todayStr}T00:00:00Z`).getUTCDay();
  const weekElapsedDays = ((dow + 6) % 7) + 1;
  const thisWeek = dayTotals.slice(-weekElapsedDays);
  const prevWeek = dayTotals.slice(
    -(weekElapsedDays + 7),
    dayTotals.length - 7
  );
  const today = dayTotals[dayTotals.length - 1];
  const yesterday = dayTotals[dayTotals.length - 2];

  const live = stats.filter((s) => !s.isHidden);
  const riskCounts: Record<RiskKey, number> = { soldout: 0, low: 0, returns: 0, excess: 0 };
  for (const s of live) for (const r of s.risks) riskCounts[r] += 1;

  return {
    products: stats,
    days: dayTotals,
    dayItems,
    summary: {
      todayQty: today.qty,
      todayAmount: today.amount,
      yesterdayQty: yesterday.qty,
      yesterdayAmount: yesterday.amount,
      weekQty: sum(thisWeek.map((d) => d.qty)),
      weekAmount: sum(thisWeek.map((d) => d.amount)),
      prevWeekQty: sum(prevWeek.map((d) => d.qty)),
      prevWeekAmount: sum(prevWeek.map((d) => d.amount)),
      weekElapsedDays,
      coupangStockTotal: sum(live.map((s) => s.coupangStock)),
      ownStockTotal: sum(live.map((s) => s.ownStock)),
      riskCounts,
      riskProductCount: live.filter((s) => s.risks.length > 0).length,
    },
  };
}

// ---- 화면 상태(탭/필터)와 주소 파라미터 해석 ----
// 서버 컴포넌트(page.tsx)에서도 호출하므로 'use client' 파일이 아니라 여기에 둔다.
export type StockTab = 'overview' | 'products' | 'trend' | 'history';
const STOCK_TABS: StockTab[] = ['overview', 'products', 'trend', 'history'];
export function parseTab(v: string | undefined): StockTab {
  return STOCK_TABS.includes(v as StockTab) ? (v as StockTab) : 'overview';
}

export type ProductFilter = 'all' | 'risk' | 'selling' | RiskKey;
const PRODUCT_FILTERS: ProductFilter[] = ['all', 'risk', 'selling', 'soldout', 'low', 'returns', 'excess'];
export function parseFilter(v: string | undefined): ProductFilter {
  return PRODUCT_FILTERS.includes(v as ProductFilter) ? (v as ProductFilter) : 'all';
}
