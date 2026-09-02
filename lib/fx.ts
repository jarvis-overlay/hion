// CNY/USD -> KRW 환율을 프리랜터(Frankfurter, ECB 기준환율 - 무료/키불필요)에서
// 가져온다. 완전한 실시간은 아니고 ECB가 매 영업일 갱신하는 기준환율이지만,
// 소싱 원가 계산에 참고할 정도의 최신 환율로는 충분하다. 실패하면 null을
// 반환해서 폼에서는 직접 입력으로 계속 쓸 수 있게 한다.
export interface FxRates {
  CNY: number; // 1 CNY = ? KRW
  USD: number; // 1 USD = ? KRW
  date: string; // 기준일 (YYYY-MM-DD)
}

export async function fetchFxRates(): Promise<FxRates | null> {
  try {
    const [usdRes, cnyRes] = await Promise.all([
      fetch('https://api.frankfurter.app/latest?from=USD&to=KRW', {
        next: { revalidate: 3600 },
      }),
      fetch('https://api.frankfurter.app/latest?from=CNY&to=KRW', {
        next: { revalidate: 3600 },
      }),
    ]);
    if (!usdRes.ok || !cnyRes.ok) return null;
    const [usd, cny] = await Promise.all([usdRes.json(), cnyRes.json()]);
    const usdRate = usd?.rates?.KRW;
    const cnyRate = cny?.rates?.KRW;
    if (typeof usdRate !== 'number' || typeof cnyRate !== 'number') return null;
    return { USD: usdRate, CNY: cnyRate, date: usd.date || cny.date };
  } catch {
    return null;
  }
}
