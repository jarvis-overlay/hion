'use server';

import {
  fetchSearchTrend,
  fetchShoppingCategoryTrend,
  fetchShoppingKeywordTrend,
  SHOPPING_CATEGORIES,
  type TimeUnit,
} from '@/lib/naver';
import { recommendSourcingItems, type SourcingRecommendation } from '@/lib/claude';
import { createClient } from '@/lib/supabase/server';

// 우리 쿠팡 판매 데이터(최근 60일 판매출고 기록)로 지금 잘 팔리는/뜨고 있는
// 상품을 요약한다. 네이버 데이터랩이 막혀있어도 이건 우리 DB만 보면 되니까
// 항상 동작한다.
async function fetchOwnSalesSummary(): Promise<string | null> {
  const supabase = createClient();
  const since = new Date();
  since.setDate(since.getDate() - 60);

  const { data: movements } = await supabase
    .from('stock_movements')
    .select('product_id, quantity, created_at, products(name)')
    .eq('type', 'out')
    .eq('channel', 'coupang')
    .gte('created_at', since.toISOString());

  if (!movements || movements.length === 0) return null;

  const midpoint = new Date();
  midpoint.setDate(midpoint.getDate() - 30);

  const byProduct = new Map<
    string,
    { name: string; recentQty: number; priorQty: number }
  >();

  for (const m of movements as any[]) {
    const name = m.products?.name || '이름 없음';
    const key = m.product_id;
    const entry = byProduct.get(key) || { name, recentQty: 0, priorQty: 0 };
    const qty = Math.abs(m.quantity);
    if (new Date(m.created_at) >= midpoint) entry.recentQty += qty;
    else entry.priorQty += qty;
    byProduct.set(key, entry);
  }

  const rows = Array.from(byProduct.values())
    .sort((a, b) => b.recentQty + b.priorQty - (a.recentQty + a.priorQty))
    .slice(0, 15);

  if (rows.length === 0) return null;

  return rows
    .map((r) => {
      const change =
        r.priorQty === 0
          ? r.recentQty > 0
            ? '신규/급증'
            : '변화없음'
          : `${(((r.recentQty - r.priorQty) / r.priorQty) * 100).toFixed(0)}%`;
      return `- ${r.name}: 최근 30일 ${r.recentQty}개 판매 (이전 30일 대비 ${change})`;
    })
    .join('\n');
}

// 카테고리 10개 전체의 최근 트렌드를 자동으로 긁어서 Claude에게 해석시키고
// 구체적인 소싱 아이템을 추천받는다. 사용자가 키워드/카테고리를 직접 고를
// 필요 없는 원클릭 플로우.
export async function runAiRecommendation(): Promise<
  { recommendations: SourcingRecommendation[]; usedTrendData: boolean } | { error: string }
> {
  const timeUnit: TimeUnit = 'week';
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - 4);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);

  const chunks: (typeof SHOPPING_CATEGORIES)[number][][] = [];
  for (let i = 0; i < SHOPPING_CATEGORIES.length; i += 3) {
    chunks.push(SHOPPING_CATEGORIES.slice(i, i + 3));
  }

  // 네이버 데이터랩 연동이 계정 이슈로 막혀있을 수 있어서, 트렌드 데이터
  // 수집에 실패해도 전체를 에러로 막지 않고 Claude 자체 지식으로 폴백한다.
  const summaries: string[] = [];
  try {
    for (const chunk of chunks) {
      const res = await fetchShoppingCategoryTrend({
        startDate,
        endDate,
        timeUnit,
        categories: chunk.map((c) => ({ name: c.name, param: [c.code] })),
      });
      for (const r of res.results) {
        const data = r.data;
        if (data.length < 2) continue;
        const half = Math.floor(data.length / 2);
        const first = data.slice(0, half);
        const second = data.slice(half);
        const avg = (arr: { ratio: number }[]) =>
          arr.reduce((s, d) => s + d.ratio, 0) / arr.length;
        const a1 = avg(first);
        const a2 = avg(second);
        const change = a1 === 0 ? 0 : ((a2 - a1) / a1) * 100;
        summaries.push(
          `- ${r.title}: 최근 관심도 ${a2.toFixed(1)} (이전 대비 ${
            change >= 0 ? '+' : ''
          }${change.toFixed(1)}%)`
        );
      }
    }
  } catch {
    // 네이버 데이터랩 연동 실패 - 아래에서 트렌드 데이터 없이 진행
  }

  const usedTrendData = summaries.length > 0;
  const today = new Date().toISOString().slice(0, 10);
  const ownSales = await fetchOwnSalesSummary().catch(() => null);

  const parts: string[] = [`오늘 날짜: ${today}`];
  if (usedTrendData) {
    parts.push(`[네이버 쇼핑인사이트 카테고리별 트렌드]\n${summaries.join('\n')}`);
  }
  if (ownSales) {
    parts.push(`[우리 쿠팡 스토어 최근 60일 실제 판매 데이터]\n${ownSales}`);
  }

  const summaryText = usedTrendData || ownSales ? parts.join('\n\n') : null;

  try {
    const recommendations = await recommendSourcingItems(summaryText);
    return { recommendations, usedTrendData: usedTrendData || !!ownSales };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}

export async function runKeywordTrend(
  startDate: string,
  endDate: string,
  timeUnit: TimeUnit,
  groupInputs: string[] // 각 줄: "그룹명: 키워드1,키워드2" 또는 그냥 "키워드"
) {
  const keywordGroups = groupInputs
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5)
    .map((line) => {
      const [namePart, kwPart] = line.split(':');
      if (kwPart) {
        return {
          groupName: namePart.trim(),
          keywords: kwPart
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean),
        };
      }
      return { groupName: namePart.trim(), keywords: [namePart.trim()] };
    });

  if (keywordGroups.length === 0) {
    return { error: '키워드를 하나 이상 입력해주세요.' };
  }

  try {
    const result = await fetchSearchTrend({
      startDate,
      endDate,
      timeUnit,
      keywordGroups,
    });
    return { result };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}

export async function runCategoryTrend(
  startDate: string,
  endDate: string,
  timeUnit: TimeUnit,
  categories: { name: string; param: string[] }[]
) {
  if (categories.length === 0) {
    return { error: '카테고리를 하나 이상 선택해주세요.' };
  }
  try {
    const result = await fetchShoppingCategoryTrend({
      startDate,
      endDate,
      timeUnit,
      categories,
    });
    return { result };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}

export async function runShoppingKeywordTrend(
  startDate: string,
  endDate: string,
  timeUnit: TimeUnit,
  categoryCode: string,
  keywordInputs: string[]
) {
  const keywords = keywordInputs
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 5)
    .map((k) => ({ name: k, param: [k] }));

  if (!categoryCode) {
    return { error: '카테고리를 선택해주세요.' };
  }
  if (keywords.length === 0) {
    return { error: '키워드를 하나 이상 입력해주세요.' };
  }

  try {
    const result = await fetchShoppingKeywordTrend({
      startDate,
      endDate,
      timeUnit,
      categoryCode,
      keywords,
    });
    return { result };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}
