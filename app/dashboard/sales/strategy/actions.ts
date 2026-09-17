'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { runProductSearch } from '@/app/dashboard/sourcing/trends/actions';
import { generateSalesStrategy, type SalesStrategyResult } from '@/lib/ai';
import { computeMargin } from '@/lib/marginCalc';

const MARKET_SIZE_KO: Record<string, string> = { high: '상', mid: '중', low: '하' };

// 이미 입력해둔 공급처/비교 상품군 데이터를 사람이 읽을 수 있는 요약
// 텍스트로 만든다 - 새로 데이터를 안 모으고 있는 걸 그대로 재사용.
function buildComparisonSummary(item: any): string | null {
  const suppliers: any[] = item.sourcing_item_suppliers || [];
  const comparisons: any[] = item.sourcing_item_comparisons || [];
  const lines: string[] = [];

  if (suppliers.length > 0) {
    const cheapest = [...suppliers]
      .filter((s) => s.price != null)
      .sort((a, b) => a.price - b.price)[0];
    lines.push(
      `공급처 후보 ${suppliers.length}곳${cheapest ? ` (최저가 ${cheapest.currency} ${cheapest.price})` : ''}`
    );
  }

  for (const c of comparisons) {
    const prices: any[] = c.sourcing_comparison_prices || [];
    if (prices.length === 0) continue;
    const priceText = prices
      .map(
        (p) =>
          `${p.platform === 'coupang' ? '쿠팡' : '네이버'} ${p.price_range || '가격대 미입력'}${
            p.market_size ? `(규모 ${MARKET_SIZE_KO[p.market_size] || p.market_size})` : ''
          }`
      )
      .join(', ');
    lines.push(`- ${c.title || '비교 상품'}: ${priceText}`);
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

export async function generateStrategy(
  itemId: string,
  keyword: string
): Promise<
  | { error: string }
  | { success: true; strategy: SalesStrategyResult; verdict: string; keyword: string }
> {
  const supabase = createClient();

  const { data: item, error: itemErr } = await supabase
    .from('sourcing_items')
    .select('*, sourcing_item_suppliers(*), sourcing_item_comparisons(*, sourcing_comparison_prices(*))')
    .eq('id', itemId)
    .single();

  if (itemErr || !item) return { error: itemErr?.message || '상품을 찾을 수 없어요.' };

  const q = keyword.trim() || item.title;

  const search = await runProductSearch(q);
  const badges = search.badges;
  const marketSummary = badges
    ? `시장규모 ${badges.marketScaleLabel}(목록 내 리뷰 중앙값 ${badges.medianReviewCount.toLocaleString()}개), 경쟁강도 ${
        badges.competitionLabel
      }(리뷰 3,000개 이상 검증된 경쟁자 ${badges.meaningfulCompetitorCount}개/조회 ${badges.productCount}개), 가격 분포 ${badges.priceRange}`
    : search.coupangError
    ? `쿠팡 조회 실패: ${search.coupangError}`
    : '쿠팡 조회 결과 없음';
  const marketVerdict = search.verdict || '판단 근거 부족';

  const margin = computeMargin({
    price: item.price,
    coupon: item.coupon,
    cost: item.cost,
    outputVat: item.output_vat,
    importVat: item.import_vat,
    coupangFee: item.coupang_fee,
    shipping: item.shipping,
    adCost: item.ad_cost,
    etcCost: item.etc_cost,
  });
  const feeRatePct =
    margin.actualPrice > 0 && item.coupang_fee != null ? (item.coupang_fee / margin.actualPrice) * 100 : null;
  const adRatePct =
    margin.actualPrice > 0 && item.ad_cost != null ? (item.ad_cost / margin.actualPrice) * 100 : null;

  let strategy: SalesStrategyResult;
  try {
    strategy = await generateSalesStrategy({
      title: item.title,
      price: item.price,
      cost: item.cost,
      marginProfit: item.price != null ? margin.profit : null,
      marginPct: margin.marginPct,
      feeRatePct,
      adRatePct,
      marketSummary,
      marketVerdict,
      comparisonSummary: buildComparisonSummary(item),
    });
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }

  const { error: upsertErr } = await supabase.from('sourcing_item_strategies').upsert(
    {
      sourcing_item_id: itemId,
      keyword: q,
      market_badges: badges,
      market_verdict: marketVerdict,
      pricing_strategy: strategy.pricingStrategy,
      review_strategy: strategy.reviewStrategy,
      ad_strategy: strategy.adStrategy,
      channel_strategy: strategy.channelStrategy,
      differentiation: strategy.differentiation,
    },
    { onConflict: 'sourcing_item_id' }
  );
  if (upsertErr) return { error: upsertErr.message };

  revalidatePath('/dashboard/sales/strategy');
  return { success: true, strategy, verdict: marketVerdict, keyword: q };
}
