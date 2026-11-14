// 쿠팡 이미지 주소 검증 (가벼운 순수 함수 - 서버 액션과 사진 비교가 같이 쓴다)

// 쿠팡 이미지 서버 주소만 허용한다(서버가 임의 주소를 대신 받아오지 않게).
export function normalizeCoupangImageUrl(raw: string | null): string | null {
  if (!raw || raw.length > 600) return null;
  let s = raw.trim();
  if (s.startsWith('//')) s = `https:${s}`;
  if (s.startsWith('http://')) s = `https://${s.slice(7)}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' || u.port || u.username || u.password) return null;
    const h = u.hostname.toLowerCase();
    // 쿠팡 이미지 서버(coupangcdn.com)만 허용 - 범위를 좁게 잡아 서버가 엉뚱한 곳을 호출하지 않게 한다
    if (h === 'coupangcdn.com' || h.endsWith('.coupangcdn.com')) return u.href;
    return null;
  } catch {
    return null;
  }
}
