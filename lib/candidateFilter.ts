// 쿠팡 조사 후보의 "내 상품과 사이즈/색상이 다른가"를 상품명만 보고 판정하는
// 순수 함수들(네트워크 없음, 클라이언트/서버 공용).
//
// 원칙: "모르면 안 건드린다". 상품명에 사이즈/색상 정보가 아예 없거나, 내가
// 입력한 값이 해석이 안 되면 null(=판정 불가, 배지 없음)로 돌려준다. 확실히
// "다른 값이 적혀 있는 경우"에만 불일치로 판정한다 - 일괄 제거 버튼의 기준이
// 되기 때문에 잘못 걸러서 진짜 경쟁 상품을 지워버리는 쪽이 더 위험하다.

// "40x60", "40 X 60cm", "40×60", "40*60" → [40, 60] (작은 값, 큰 값 순서로
// 정규화해서 60x40과 40x60을 같은 걸로 본다)
const SIZE_RE = /(\d+(?:\.\d+)?)\s*(?:cm|㎝|mm)?\s*[xX×*]\s*(\d+(?:\.\d+)?)/g;

export type SizePair = [number, number];

export function extractSizes(text: string): SizePair[] {
  const out: SizePair[] = [];
  for (const m of text.matchAll(SIZE_RE)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) continue;
    out.push(a <= b ? [a, b] : [b, a]);
  }
  return out;
}

function sizeLabel(p: SizePair): string {
  return `${p[0]}x${p[1]}`;
}

export type MatchStatus = 'match' | 'mismatch' | 'unknown';

// 옵션/상품정보에서 뽑은 사이즈 문구(여러 개)가 내가 원하는 사이즈를 포함하는지.
// 둘 중 하나라도 해석이 안 되면 unknown.
export function sizeStatus(userSize: string, text: string): MatchStatus {
  // mm 표기가 섞이면 cm와 단위가 달라 비교가 틀어지므로 판정하지 않는다
  if (/mm/i.test(userSize) || /mm/i.test(text)) return 'unknown';
  const wanted = extractSizes(userSize);
  const found = extractSizes(text);
  if (wanted.length === 0 || found.length === 0) return 'unknown';
  const keys = new Set(wanted.map(sizeLabel));
  return found.some((p) => keys.has(sizeLabel(p))) ? 'match' : 'mismatch';
}

// 내가 원하는 사이즈(여러 개 가능: "40x60, 50x80")가 상품명에 없고, 상품명에
// 다른 사이즈가 적혀 있으면 그 사이즈를 돌려준다. 판정 불가/일치면 null.
export function sizeMismatch(userSize: string, title: string): string | null {
  const wanted = extractSizes(userSize);
  if (wanted.length === 0) return null; // "중형" 같은 건 해석 불가 → 건드리지 않음
  const found = extractSizes(title);
  if (found.length === 0) return null; // 상품명에 사이즈 표기 없음 → 모름
  const wantedKeys = new Set(wanted.map(sizeLabel));
  if (found.some((p) => wantedKeys.has(sizeLabel(p)))) return null;
  return found.map(sizeLabel).join(', ');
}

// 같은 색을 가리키는 말 묶음. 소문자로 비교한다.
const COLOR_GROUPS: string[][] = [
  ['그레이', '회색', 'gray', 'grey', '차콜'],
  ['베이지', '샌드'],
  ['아이보리', '크림', '오프화이트'],
  ['화이트', '흰색', 'white'],
  ['블랙', '검정', '검은', 'black'],
  ['브라운', '갈색', '초코', '모카', 'brown'],
  ['네이비', '남색', 'navy'],
  ['블루', '파랑', '파란', '하늘색', '스카이'],
  ['핑크', '분홍', '로즈'],
  ['레드', '빨강', '빨간', 'red', '버건디'],
  ['그린', '초록', '녹색', '카키', 'green'],
  ['옐로우', '노랑', '노란', 'yellow'],
  ['퍼플', '보라', '라벤더'],
  ['오렌지', '주황'],
  ['민트', '에메랄드'],
];

function splitTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[,/·\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

// 내가 원하는 색(여러 개 가능: "그레이, 베이지")이 상품명에 없고, 상품명에
// 다른 색이 적혀 있으면 그 색 이름을 돌려준다. 판정 불가/일치면 null.
// 한 상품 페이지가 여러 색을 같이 파는 경우가 많아서(옵션) 상품명에 내 색이
// 하나라도 들어 있으면 일치로 본다.
export function colorStatus(
  userColor: string,
  text: string
): { status: MatchStatus; other: string | null } {
  const tokens = splitTokens(userColor);
  if (tokens.length === 0) return { status: 'unknown', other: null };
  const t = text.toLowerCase();

  const wantedGroups = new Set<number>();
  for (const token of tokens) {
    const gi = COLOR_GROUPS.findIndex((g) => g.some((w) => token.includes(w)));
    // 사전에 없는 낯선 색 이름은 해석 불가 → 판정하지 않는다.
    if (gi === -1) return { status: 'unknown', other: null };
    wantedGroups.add(gi);
  }

  // 내 색 중 하나라도 있으면 일치
  for (const gi of wantedGroups) {
    if (COLOR_GROUPS[gi].some((w) => t.includes(w))) return { status: 'match', other: null };
  }
  // 다른 색이 적혀 있으면 불일치
  for (let gi = 0; gi < COLOR_GROUPS.length; gi++) {
    if (wantedGroups.has(gi)) continue;
    const hit = COLOR_GROUPS[gi].find((w) => t.includes(w));
    if (hit) return { status: 'mismatch', other: hit };
  }
  return { status: 'unknown', other: null };
}

export function colorMismatch(userColor: string, title: string): string | null {
  const r = colorStatus(userColor, title);
  return r.status === 'mismatch' ? r.other : null;
}

// 검색어에 붙일 대표값 하나 (여러 개를 적었으면 첫 번째)
export function firstSizeToken(userSize: string): string {
  const s = extractSizes(userSize)[0];
  return s ? sizeLabel(s) : userSize.trim().split(/[,/]+/)[0].trim();
}

export function firstColorToken(userColor: string): string {
  return userColor.trim().split(/[,/·\s]+/)[0] || '';
}
