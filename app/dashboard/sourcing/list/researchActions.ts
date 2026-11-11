'use server';

// 소싱 리스트 카드의 "비교 상품군" 섹션에서, 손으로 쿠팡을 검색해서 베껴
// 적지 않고 이미 있는 쿠팡 실데이터 수집 로직(lib/brightdata.ts)을 그대로
// 재사용해서 후보를 자동으로 조사해준다. 캡차/타임아웃 등 실패는 흔하므로
// (AI 소싱 추천 쪽에서 실측 확인된 패턴) 절대 throw하지 않고 한국어 에러
// 문구로 돌려준다 - 실패해도 기존 수동 입력 폼이 같은 섹션에 그대로 있어서
// 사용자가 계속 작업할 수 있다.
import { fetchCoupangBestsellers } from '@/lib/brightdata';
import { analyzeCoupangResults, type MarketBadges } from '@/lib/coupangMarket';
import { classifyByDictionary, classifyMaterialMismatch, type MaterialTierVerdict } from '@/lib/materialClassify';

export interface CoupangResearchCandidate {
  name: string;
  price: string | null;
  reviewCount: string | null;
  imageUrl: string | null;
  url: string;
  // 사용자가 재질/방식을 입력했을 때만 채워지는 참고용 배지. 저장하지 않음(순수 UI 참고용).
  materialBadge?: MaterialTierVerdict;
}

export interface CoupangResearchResult {
  candidates: CoupangResearchCandidate[];
  badges: MarketBadges;
  suggestedMarketSize: 'high' | 'mid' | 'low';
}

// AI 소싱 추천에서 쓰는 5단계(very-high~very-low)를, 비교 상품군이 쓰는
// 3단계(high/mid/low)로 축약한다 - 저장 테이블(sourcing_comparison_prices)
// 컬럼이 3단계라 그 폭에 맞춰야 함.
function toThreeTierMarketSize(tier: MarketBadges['marketScaleTier']): 'high' | 'mid' | 'low' {
  if (tier === 'very-high' || tier === 'high') return 'high';
  if (tier === 'mid') return 'mid';
  return 'low'; // 'low' | 'very-low'
}

export async function researchCoupangComparisons(
  keyword: string,
  userMaterial?: string
): Promise<CoupangResearchResult | { error: string }> {
  const q = keyword.trim();
  if (!q) return { error: '조사할 키워드를 입력해주세요.' };

  let coupang;
  try {
    // 다른 쿠팡 조사 호출부(runProductSearch 등)와 같이, 캡차로 실패해도
    // budgetMs 안에서 짧게 재시도한다. 버튼 한 번 누르고 바로 결과를
    // 기다리는 UX라 너무 길게 잡지 않음(30초).
    coupang = await fetchCoupangBestsellers(q, 20, { budgetMs: 30000 });
  } catch (e: any) {
    return {
      error:
        e?.message ||
        '쿠팡 조사에 실패했어요. 캡차 차단이거나 일시적인 오류일 수 있어요. 잠시 후 다시 시도해주세요.',
    };
  }

  if (coupang.length === 0) {
    return {
      error: '쿠팡에서 검색 결과를 찾지 못했어요. 다른 키워드로 다시 시도해주세요.',
    };
  }

  const analysis = analyzeCoupangResults(coupang);
  if (!analysis) {
    return {
      error: '조사 결과를 분석하지 못했어요.',
    };
  }

  const candidates: CoupangResearchCandidate[] = coupang.map((c) => ({
    name: c.name,
    price: c.price,
    reviewCount: c.reviewCount,
    imageUrl: c.imageUrl,
    url: c.url,
  }));

  // 재질/방식을 입력 안 하면(기존 사용자) 이 블록 전체를 건너뛴다 - 동작이
  // 1바이트도 안 바뀌어야 함. 이 기능은 참고용 보너스라서, 사전/AI 판정이
  // 뭔가 잘못돼도 전체 조사 결과를 날리면 안 돼서 한 번 더 try/catch로
  // 감싼다(이중 방어).
  const material = userMaterial?.trim();
  if (material) {
    try {
      const ambiguous: { index: number; title: string }[] = [];
      candidates.forEach((c, i) => {
        const verdict = classifyByDictionary(material, c.name);
        if (verdict === 'ambiguous') {
          ambiguous.push({ index: i, title: c.name });
        } else if (verdict !== null) {
          c.materialBadge = verdict;
        }
      });

      if (ambiguous.length > 0) {
        const aiResults = await classifyMaterialMismatch(material, ambiguous.map((a) => a.title));
        if (aiResults) {
          ambiguous.forEach((a, i) => {
            if (aiResults[i] === 'different') {
              candidates[a.index].materialBadge = { type: 'ai_different' };
            }
          });
        }
      }
    } catch (e) {
      console.error('[researchActions] 재질 배지 판정 실패 - 배지 없이 통과:', e);
    }
  }

  return {
    candidates,
    badges: analysis.badges,
    suggestedMarketSize: toThreeTierMarketSize(analysis.badges.marketScaleTier),
  };
}
