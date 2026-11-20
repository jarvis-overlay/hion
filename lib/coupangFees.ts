// 쿠팡 마켓플레이스 카테고리별 판매수수료율 (참고값).
//
// 출처: 쿠팡 공식 수수료 안내를 인용한 3자 정리글(대시판다 2026-03-11 등)의 주요 카테고리 표. 쿠팡이 공개 페이지에 전체 표를 두지 않고
// 판매자 계정(WING)에서만 정확히 보여줘서 **참고값**이다 - 카테고리는 자주 세분화·조정되니 WING의 "판매수수료" 값으로 확인해 고쳐 쓴다.
// 표의 요율은 부가세 별도다. 이 앱의 수수료 칸(기본 8.6%)은 생활용품 7.8% × 1.1 = 8.58%처럼 **부가세를 포함한 값**이라서,
// 선택하면 부가세 10%를 더한 값을 칸에 넣는다.
export interface CoupangFeeCategory {
  name: string;
  pct: number; // 부가세 별도 요율(%)
  source: 'main' | 'blog'; // main = 정리글 표(공식 안내 인용), blog = 한 곳에서만 확인된 값
}

export const COUPANG_FEE_CATEGORIES: CoupangFeeCategory[] = [
  { name: '생활용품', pct: 7.8, source: 'main' },
  { name: '가전디지털', pct: 7.8, source: 'main' },
  { name: '패션의류', pct: 10.5, source: 'main' },
  { name: '뷰티', pct: 9.6, source: 'main' },
  { name: '식품', pct: 10.6, source: 'main' },
  { name: '가구·홈인테리어', pct: 10.8, source: 'main' },
  { name: '도서', pct: 10.8, source: 'main' },
  { name: '자동차용품', pct: 10.0, source: 'main' },
  { name: '게임', pct: 6.8, source: 'main' },
  { name: '냉난방가전', pct: 5.8, source: 'main' },
  { name: '컴퓨터·태블릿PC', pct: 5.0, source: 'main' },
  { name: '모니터', pct: 4.5, source: 'main' },
  { name: '신선식품(쌀/잡곡)', pct: 5.8, source: 'main' },
  { name: '쥬얼리(순금/골드바)', pct: 4.0, source: 'main' },
  { name: '스포츠/레저용품', pct: 10.8, source: 'blog' },
  { name: '완구/취미', pct: 10.8, source: 'blog' },
  { name: '문구/사무용품', pct: 10.8, source: 'blog' },
  { name: '출산/유아', pct: 10.0, source: 'blog' },
];

// 부가세 10%를 더한 요율 (소수 첫째 자리까지): 7.8 -> 8.6
export function withVatPct(pct: number): number {
  return Math.round(pct * 1.1 * 10 + 1e-9) / 10;
}

// 칸의 값(부가세 포함 %)과 일치하는 카테고리를 찾는다 (여럿이면 처음 것). 없으면 null.
export function categoryForFeePct(feePct: number): CoupangFeeCategory | null {
  if (!Number.isFinite(feePct)) return null;
  return COUPANG_FEE_CATEGORIES.find((c) => Math.abs(withVatPct(c.pct) - feePct) < 0.05) ?? null;
}
