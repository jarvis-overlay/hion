// 상세페이지 자동 구성의 "취급 옵션" 규칙 (순수 로직 - 네트워크/이미지 라이브러리 없음).
//
// 중국 판매 페이지 사진에는 색상이 5가지, 사이즈가 6가지씩 한 장에 같이 나오는 일이
// 많은데, 실제로 들여오는 건 그중 일부(예: 색상 2가지)다. 그런데 상세페이지에
// 안 가져온 색상이 나오거나 "5가지 색상" 같은 문구가 들어가면 허위 표시가 되므로,
//   1) 취급하지 않는 색상이 같이 보이는 사진은 상품 사진으로 쓰지 않고,
//   2) 만들어진 문구에서 취급하지 않는 색상/사이즈/개수 표현을 걸러내고,
//   3) 사이즈표는 취급하는 사이즈만 남긴다.
// 이 규칙을 AI 프롬프트에만 맡기면 어겨질 수 있어서, 결과를 코드로 한 번 더 검사한다.

export interface SellingOptions {
  colors: string[]; // 실제로 파는 색상 (사용자 입력 + 사진 색상 라벨)
  sizes: string[]; // 실제로 파는 사이즈
}

export type SourceRole =
  | 'hero'
  | 'detail'
  | 'size_chart'
  | 'color_lineup'
  | 'usage'
  | 'package'
  | 'material'
  | 'other';

export interface SizeChart {
  headers: string[];
  rows: string[][];
}

// 사진 한 장을 비전 모델이 분석한 결과
export interface SourceAnalysis {
  role: SourceRole;
  description: string; // 무엇이 찍혀 있는지 한국어 한두 문장
  koreanTexts: string[]; // 사진 속 중국어를 한국어로 옮긴 문구들
  facts: string[]; // 소재·기능·구성 등 사진에서 읽은 사실 (한국어)
  colorsShown: string[]; // 사진에 보이는 "상품" 색상 (한국어 색상명)
  sizeChart: SizeChart | null; // 사이즈표가 있으면
  sizesMentioned: string[]; // 사진에 언급된 사이즈
}

export interface PhotoVerdict {
  usable: boolean;
  color: string | null; // 이 사진이 대표하는 색상 (알 수 없으면 null)
  reason: string | null; // 쓰지 않는 이유
}

// ---------------------------------------------------------------------------
// 색상 이름 정규화 - 같은 색의 여러 표기(검정/블랙/black/黑)를 하나로 본다
// ---------------------------------------------------------------------------
const COLOR_GROUPS: string[][] = [
  ['블랙', '검정', '검정색', '검은색', '까만색', '흑색', 'black', '黑', '黑色'],
  ['화이트', '흰색', '하얀색', '하양', '백색', '아이보리', 'white', 'ivory', '白', '白色'],
  ['그레이', '회색', '쥐색', '멜란지', '멜란지그레이', 'gray', 'grey', '灰', '灰色'],
  ['차콜', '다크그레이', '진회색', 'charcoal', '炭灰'],
  ['네이비', '남색', '곤색', '감색', '진남색', 'navy', '藏青', '深蓝'],
  ['블루', '파랑', '파란색', '푸른색', 'blue', '蓝', '蓝色'],
  ['스카이블루', '하늘색', '연하늘', 'skyblue', '天蓝'],
  ['레드', '빨강', '빨간색', '붉은색', 'red', '红', '红色'],
  ['와인', '버건디', '자주', '적갈색', 'wine', 'burgundy', '酒红'],
  ['핑크', '분홍', '분홍색', '연분홍', 'pink', '粉', '粉色'],
  ['그린', '초록', '초록색', '녹색', 'green', '绿', '绿色'],
  ['카키', '올리브', '국방색', 'khaki', 'olive', '军绿'],
  ['민트', '연두', 'mint', '薄荷'],
  ['옐로', '노랑', '노란색', '옐로우', 'yellow', '黄', '黄色'],
  ['오렌지', '주황', '주황색', 'orange', '橙', '橙色'],
  ['퍼플', '보라', '보라색', '바이올렛', 'purple', 'violet', '紫', '紫色'],
  ['브라운', '갈색', '밤색', '커피', 'brown', 'coffee', '咖啡', '棕色'],
  ['베이지', '살구', '카멜', '크림', 'beige', 'camel', 'cream', '米色', '卡其'],
  ['골드', '금색', 'gold', '金色'],
  ['실버', '은색', 'silver', '银色'],
];

const norm = (s: string) => s.toLowerCase().replace(/[\s_\-·ㆍ.]/g, '');

const COLOR_INDEX = new Map<string, number>();
COLOR_GROUPS.forEach((g, i) => g.forEach((w) => COLOR_INDEX.set(norm(w), i)));

// 같은 색이면 같은 문자열을 돌려준다. 모르는 색은 정규화한 이름 그대로 (그 이름끼리만 같음)
export function canonicalColor(name: string): string {
  const n = norm(name);
  const g = COLOR_INDEX.get(n);
  return g === undefined ? `?${n}` : `#${g}`;
}

export function colorsMatch(a: string, b: string): boolean {
  return !!a.trim() && !!b.trim() && canonicalColor(a) === canonicalColor(b);
}

export function isSellingColor(color: string, selling: SellingOptions): boolean {
  return selling.colors.some((c) => colorsMatch(c, color));
}

// "검정, 회색 / 네이비" 같은 입력을 목록으로
export function parseOptionList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,/\n、，;·]+/)) {
    const t = raw.trim();
    if (!t) continue;
    const key = norm(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

const normSize = (s: string) => s.toUpperCase().replace(/[\s_\-]/g, '');

export function sizesMatch(a: string, b: string): boolean {
  return !!normSize(a) && normSize(a) === normSize(b);
}

export function mergeSellingOptions(
  colorsText: string,
  sizesText: string,
  photoColorLabels: string[]
): SellingOptions {
  const colors = parseOptionList([colorsText, ...photoColorLabels].join(','));
  // 표기만 다른 같은 색은 하나로 (검정 / 블랙)
  const uniqueColors: string[] = [];
  for (const c of colors) if (!uniqueColors.some((u) => colorsMatch(u, c))) uniqueColors.push(c);
  return { colors: uniqueColors, sizes: parseOptionList(sizesText) };
}

// ---------------------------------------------------------------------------
// 1) 사진 판정: 이 사진을 상품 사진으로 써도 되는가
// ---------------------------------------------------------------------------
export function evaluatePhoto(
  analysis: SourceAnalysis | null,
  selling: SellingOptions,
  colorLabel: string | null
): PhotoVerdict {
  // 사이즈표 사진은 표(글자)가 대부분이라 상품 사진 배경으로 쓰면 표 모양이 다시 그려진다.
  // 그리고 중국 사이즈표의 숫자는 한국으로 가져오면서 바뀌는 일이 많아 내용도 쓰지 않는다 -
  // 사이즈표는 사용자가 직접 입력한 한국 기준 표로만 만든다.
  if (analysis?.role === 'size_chart') {
    return {
      usable: false,
      color: null,
      reason: '중국 사이즈표 사진이라 쓰지 않아요 (사이즈표는 직접 입력한 표로 만들어요)',
    };
  }
  const label = (colorLabel || '').trim();
  const shown = (analysis?.colorsShown || []).map((c) => c.trim()).filter(Boolean);
  // 표기만 다른 같은 색은 한 번만 센다
  const distinct: string[] = [];
  for (const c of shown) if (!distinct.some((d) => colorsMatch(d, c))) distinct.push(c);
  const foreign = distinct.filter((c) => !isSellingColor(c, selling));

  if (label) {
    if (!isSellingColor(label, selling)) {
      return { usable: false, color: label, reason: `"${label}"은(는) 취급 색상에 없어요` };
    }
    // 라벨 색상 외에 취급하지 않는 색상이 같이 보이면 (예: 5가지 색상 한 장 사진) 쓰지 않는다
    if (foreign.length > 0) {
      return {
        usable: false,
        color: label,
        reason: `취급하지 않는 색상(${foreign.join(', ')})이 같이 나와요`,
      };
    }
    return { usable: true, color: label, reason: null };
  }

  if (distinct.length === 0) return { usable: true, color: null, reason: null }; // 색이 특정되지 않는 컷(소재 확대 등)
  if (foreign.length > 0) {
    return {
      usable: false,
      color: null,
      reason:
        distinct.length > 1
          ? `여러 색상이 한 장에 나오고 취급하지 않는 색상(${foreign.join(', ')})이 포함돼요`
          : `취급하지 않는 색상(${foreign[0]})이에요`,
    };
  }
  return { usable: true, color: distinct.length === 1 ? distinct[0] : null, reason: null };
}

// ---------------------------------------------------------------------------
// 2) 사이즈표: 취급하는 사이즈만 남긴다
// ---------------------------------------------------------------------------
export function filterSizeChart(chart: SizeChart | null, selling: SellingOptions): SizeChart | null {
  if (!chart || chart.rows.length === 0 || selling.sizes.length === 0) return null;
  const isSize = (cell: string) => selling.sizes.some((s) => sizesMatch(s, cell));
  const anySize = (cell: string) => /^(?:[2-6]?X{0,3}[SML]|XS|XXL|XXXL|\d{2,3}|F|FREE|프리)$/i.test(normSize(cell));

  // 열 기준(헤더에 사이즈가 나열됨: 항목 | S | M | L)
  const headerSizeCols = chart.headers.map((h, i) => ({ h, i })).filter(({ h }) => anySize(h));
  if (headerSizeCols.length >= 2) {
    const keep = chart.headers.map((h, i) => i === 0 || isSize(h));
    const headers = chart.headers.filter((_, i) => keep[i]);
    if (headers.length <= 1) return null;
    return { headers, rows: chart.rows.map((r) => r.filter((_, i) => keep[i])) };
  }

  // 행 기준(첫 칸이 사이즈: S | 가슴 | 길이)
  const rows = chart.rows.filter((r) => r[0] && isSize(r[0]));
  if (rows.length === 0) return null;
  return { headers: chart.headers, rows };
}

// 사이즈표를 사양표(라벨/값) 행으로 바꾼다. 행 기준이면 "M: 가슴 96 · 길이 70",
// 열 기준이면 "가슴: S 92 · M 96".
export function chartToSpecRows(chart: SizeChart | null): { label: string; value: string }[] {
  if (!chart) return [];
  const rowBased = !chart.headers.slice(1).some((h) => /^(?:[2-6]?X{0,3}[SML]|XS|XXL|XXXL|F|FREE)$/i.test(normSize(h)));
  if (rowBased) {
    return chart.rows
      .filter((r) => r[0])
      .map((r) => ({
        label: r[0],
        value: r
          .slice(1)
          .map((v, i) => (chart.headers[i + 1] ? `${chart.headers[i + 1]} ${v}` : v))
          .filter((x) => x.trim())
          .join(' · '),
      }));
  }
  return chart.rows
    .filter((r) => r[0])
    .map((r) => ({
      label: r[0],
      value: r
        .slice(1)
        .map((v, i) => `${chart.headers[i + 1]} ${v}`)
        .join(' · '),
    }));
}

// ---------------------------------------------------------------------------
// 2-2) 사용자가 직접 입력하는 사이즈표 (한국 기준 실제 치수)
// ---------------------------------------------------------------------------
// 중국 사진의 사이즈표 숫자는 한국으로 가져오면서 바뀌므로 상세페이지의 사이즈표는 이 입력값으로만 만든다.
export interface SizeTableData {
  title?: string;
  headers: string[];
  rows: string[][];
  note?: string;
}

export const SIZE_TABLE_LIMITS = { maxCols: 8, maxRows: 14, maxCell: 14 };
export const DEFAULT_SIZE_NOTE = '※ 측정 방법에 따라 1~3cm 정도 오차가 있을 수 있습니다.';

export function normalizeSizeTable(t: Partial<SizeTableData> | null | undefined): SizeTableData | null {
  if (!t || !Array.isArray(t.headers) || !Array.isArray(t.rows)) return null;
  const cell = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, SIZE_TABLE_LIMITS.maxCell);
  const headers = t.headers.map(cell).slice(0, SIZE_TABLE_LIMITS.maxCols);
  if (headers.length < 2 || headers.every((h) => !h)) return null;
  const rows = t.rows
    .filter((r) => Array.isArray(r))
    .map((r) => headers.map((_, i) => cell((r as unknown[])[i])))
    .filter((r) => r.some(Boolean))
    .slice(0, SIZE_TABLE_LIMITS.maxRows);
  if (rows.length === 0) return null;
  return {
    title: String(t.title ?? '').trim().slice(0, 20),
    headers,
    rows,
    note: String(t.note ?? '').trim().slice(0, 120),
  };
}

// 엑셀에서 복사한 표(탭)나 쉼표/공백으로 적은 글 -> 표. 첫 줄이 열 제목.
export function parseSizeTableText(text: string): { table: SizeTableData | null; error: string | null } {
  const lines = (text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { table: null, error: null };
  const sep = lines.some((l) => l.includes('\t')) ? /\t+/ : lines.some((l) => l.includes(',')) ? /\s*,\s*/ : lines.some((l) => l.includes('|')) ? /\s*\|\s*/ : /\s+/;
  const grid = lines.map((l) => l.split(sep).map((c) => c.trim()));
  const headers = grid[0];
  if (headers.length < 2) return { table: null, error: '첫 줄에 열 제목을 2개 이상 적어주세요 (예: 사이즈 허리 총길이). 칸은 탭·쉼표·공백으로 나눠요.' };
  if (grid.length < 2) return { table: null, error: '열 제목 아래에 사이즈별 행을 한 줄 이상 적어주세요.' };
  if (headers.length > SIZE_TABLE_LIMITS.maxCols) return { table: null, error: `열은 ${SIZE_TABLE_LIMITS.maxCols}개까지 넣을 수 있어요.` };
  if (grid.length - 1 > SIZE_TABLE_LIMITS.maxRows) return { table: null, error: `행은 ${SIZE_TABLE_LIMITS.maxRows}개까지 넣을 수 있어요.` };
  const table = normalizeSizeTable({ headers, rows: grid.slice(1) });
  if (!table) return { table: null, error: '표로 읽을 수 없어요. 열 제목과 값을 확인해주세요.' };
  return { table, error: null };
}

// 입력한 표에 취급하지 않는 사이즈가 섞여 있으면 뺀다 (행 기준: 첫 칸이 사이즈, 열 기준: 제목이 사이즈).
// 어느 쪽으로도 사이즈를 알아볼 수 없으면 입력한 그대로 둔다.
export function filterSizeTable(
  table: SizeTableData,
  selling: SellingOptions
): { table: SizeTableData; removed: string[]; unchecked: boolean } {
  if (selling.sizes.length === 0) return { table, removed: [], unchecked: false };
  const chart = filterSizeChart({ headers: table.headers, rows: table.rows }, selling);
  if (!chart) return { table, removed: [], unchecked: true };
  const removed: string[] = [];
  const keptRows = new Set(chart.rows.map((r) => r.join('\u0001')));
  for (const r of table.rows) {
    if (!keptRows.has(r.join('\u0001')) && chart.headers.length === table.headers.length) removed.push(r[0]);
  }
  if (chart.headers.length < table.headers.length) {
    for (const h of table.headers) if (!chart.headers.includes(h)) removed.push(h);
  }
  return { table: { ...table, headers: chart.headers, rows: chart.rows }, removed, unchecked: false };
}

// ---------------------------------------------------------------------------
// 3) 문구 검사: 취급하지 않는 색상/사이즈/개수 표현이 있으면 걸러낸다
// ---------------------------------------------------------------------------
// 문구에 나오면 "색상 언급"으로 보는 단어들 (모든 표기). 일반 단어와 겹치는 것
// ("자주 쓰는", 커피잔, 수분크림, 와인잔, 올리브유, 골드 브랜드 등)은 멀쩡한 문구를
// 지워버리는 오탐이 나서 감지 대상에서 뺀다 - 사용자가 취급 색상으로 입력하면
// 색상 일치 판정(canonicalColor)에는 그대로 쓰인다.
const NOT_FOR_DETECTION = new Set(['자주', '커피', '크림', '살구', '와인', '올리브', '골드', '실버', '금색', '은색', '밤색', '하양']);
const ALL_COLOR_WORDS = COLOR_GROUPS.flat().filter(
  (w) => /[가-힣]/.test(w) && w.length >= 2 && !NOT_FOR_DETECTION.has(w)
);

const MEASURE_RE = /\d+(?:\.\d+)?\s*(?:cm|mm|㎝|㎜|센티|센치|인치|inch)(?![A-Za-z])|\d+(?:\.\d+)?\s*[x×*]\s*\d+(?:\.\d+)?\s*(?:cm|mm|㎝|㎜)/gi;

export function findOptionViolations(
  text: string,
  selling: SellingOptions,
  extraColorWords: string[] = []
): string[] {
  const found: string[] = [];
  const t = text || '';
  if (!t.trim()) return found;

  // 취급하지 않는 색상 단어 (단어가 다른 색 단어의 일부일 때 오탐하지 않게 긴 것부터)
  const words = Array.from(new Set([...ALL_COLOR_WORDS, ...extraColorWords.filter((w) => w.trim().length >= 2)])).sort(
    (a, b) => b.length - a.length
  );
  let rest = t;
  for (const w of words) {
    if (!rest.includes(w)) continue;
    if (!isSellingColor(w, selling)) found.push(w);
    rest = rest.split(w).join(' '); // 같은 글자를 다른 짧은 단어로 또 세지 않게 지운다
  }

  // "5가지 색상" 같은 개수 표현은 실제 취급 색상 수와 달라야 걸린다
  const countRe = /(\d+)\s*(?:가지|종|개)\s*(?:의\s*)?(?:색상|컬러|색)/g;
  for (const m of t.matchAll(countRe)) {
    if (Number(m[1]) !== selling.colors.length) found.push(m[0]);
  }
  // '5색', '5컬러', '5색상'처럼 '가지' 없이 붙여 쓴 개수 표현
  const shortCountRe = /(\d+)\s*(?:색상|컬러|색)(?![가-힣])/g;
  for (const m of t.matchAll(shortCountRe)) {
    if (Number(m[1]) !== selling.colors.length) found.push(m[0].trim());
  }
  const sizeCountRe = /(\d+)\s*(?:가지|종)\s*(?:의\s*)?(?:사이즈)/g;
  for (const m of t.matchAll(sizeCountRe)) {
    if (Number(m[1]) !== selling.sizes.length) found.push(m[0]);
  }
  // 치수 수치(92cm, 30mm, 20x30 등)는 중국 사진 기준이라 한국으로 들여오면서 달라질 수 있다.
  // 치수는 사용자가 직접 입력한 사이즈표로만 보여주므로 문구에서는 걸러낸다.
  for (const m of t.matchAll(MEASURE_RE)) found.push(`치수(${m[0].trim()})`);

  // 취급하지 않는 사이즈 표기 (대문자 단독 토큰: XL, 2XL, M ...)
  const sizeRe = /(?<![A-Za-z0-9])((?:[2-6]X{1,2}L)|XXXL|XXL|XL|XS|S|M|L)(?![A-Za-z0-9])/g;
  for (const m of t.matchAll(sizeRe)) {
    if (!selling.sizes.some((s) => sizesMatch(s, m[1]))) found.push(m[1]);
  }

  return Array.from(new Set(found));
}

export interface PlannedFields {
  keyword: string;
  mood: string;
  description: string;
  eyebrow: string;
  accentTitle: string;
  accentSubtitle: string;
  stat: string;
  statCaption: string;
  badge: string;
  bodyText: string;
  listItems: string; // 줄바꿈으로 구분
  colorPrompt: string;
}

// 섹션 문구 칸들을 검사해서 위반이 있는 칸/줄은 비운다 (고쳐 쓰지 않는다 - 비워 두는 게 안전).
// 이미지 생성용 키워드/분위기/색상 지시도 검사 대상이다 - 거기 다른 색이 들어가면 그 색의 이미지가 나올 수 있다.
export function sanitizePlannedFields(
  fields: PlannedFields,
  selling: SellingOptions,
  extraColorWords: string[] = []
): { fields: PlannedFields; removed: string[] } {
  const removed: string[] = [];
  const clean = (label: string, v: string) => {
    const bad = findOptionViolations(v, selling, extraColorWords);
    if (bad.length > 0) {
      removed.push(`${label}: ${bad.join(', ')}`);
      return '';
    }
    return v;
  };
  const out: PlannedFields = {
    keyword: clean('키워드', fields.keyword),
    mood: clean('분위기', fields.mood),
    description: clean('헤드라인', fields.description),
    eyebrow: clean('작은 문구', fields.eyebrow),
    accentTitle: clean('브랜드명', fields.accentTitle),
    accentSubtitle: clean('한글 표기', fields.accentSubtitle),
    stat: clean('강조 숫자', fields.stat),
    statCaption: clean('숫자 설명', fields.statCaption),
    badge: clean('뱃지', fields.badge),
    bodyText: clean('문단', fields.bodyText),
    listItems: fields.listItems
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => {
        const bad = findOptionViolations(l, selling, extraColorWords);
        if (bad.length > 0) removed.push(`목록: ${bad.join(', ')}`);
        return bad.length === 0;
      })
      .join('\n'),
    colorPrompt: clean('색상 지시', fields.colorPrompt),
  };
  return { fields: out, removed };
}

// 사양표 행 검사: 색상/사이즈 행은 코드가 직접 채우고(AI가 쓴 값은 버림), 나머지 행은 문구 검사
export function sanitizeSpecRows(
  rows: { label: string; value: string }[],
  selling: SellingOptions,
  extraColorWords: string[] = []
): { rows: { label: string; value: string }[]; removed: string[] } {
  const removed: string[] = [];
  const out: { label: string; value: string }[] = [];
  let hasColor = false;
  let hasSize = false;
  for (const r of rows) {
    const label = r.label.trim();
    const value = r.value.trim();
    if (!label || !value) continue;
    if (/색상|컬러|^색$/.test(label)) {
      hasColor = true;
      if (selling.colors.length > 0) out.push({ label, value: selling.colors.join(', ') });
      else removed.push(`사양표 '${label}' 행: 취급 색상이 입력되지 않아 뺐어요`);
      continue;
    }
    if (/사이즈|치수|크기/.test(label) && !/cm|mm|가로|세로|높이|길이|두께|무게/i.test(label)) {
      hasSize = true;
      if (selling.sizes.length > 0) out.push({ label, value: selling.sizes.join(', ') });
      else removed.push(`사양표 '${label}' 행: 취급 사이즈가 입력되지 않아 뺐어요`);
      continue;
    }
    const bad = findOptionViolations(`${label} ${value}`, selling, extraColorWords);
    if (bad.length > 0) {
      removed.push(`사양표 '${label}' 행: ${bad.join(', ')}`);
      continue;
    }
    out.push({ label, value });
  }
  // 취급 옵션을 입력했다면 색상/사이즈 행은 항상 들어가게 한다
  if (!hasColor && selling.colors.length > 0) out.push({ label: '색상', value: selling.colors.join(', ') });
  if (!hasSize && selling.sizes.length > 0) out.push({ label: '사이즈', value: selling.sizes.join(', ') });
  return { rows: out, removed };
}

// ---------------------------------------------------------------------------
// 사진 분석 결과 정규화 (비전 모델 JSON -> SourceAnalysis)
// ---------------------------------------------------------------------------
const ROLES: SourceRole[] = ['hero', 'detail', 'size_chart', 'color_lineup', 'usage', 'package', 'material', 'other'];
const sstr = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const slist = (v: unknown, maxItems: number, maxLen: number) =>
  (Array.isArray(v) ? v : []).map((x) => sstr(x, maxLen)).filter(Boolean).slice(0, maxItems);

export function normalizeSourceAnalysis(raw: any): SourceAnalysis {
  let chart: SizeChart | null = null;
  if (raw?.sizeChart && Array.isArray(raw.sizeChart.headers) && Array.isArray(raw.sizeChart.rows)) {
    const headers = raw.sizeChart.headers.map((h: unknown) => sstr(h, 16));
    const rows = raw.sizeChart.rows
      .filter((r: unknown) => Array.isArray(r))
      .map((r: unknown[]) => r.map((c) => sstr(c, 16)))
      .slice(0, 20);
    if (headers.length >= 2 && rows.length >= 1) chart = { headers, rows };
  }
  return {
    role: ROLES.includes(raw?.role) ? raw.role : 'other',
    description: sstr(raw?.description, 200),
    koreanTexts: slist(raw?.koreanTexts, 20, 120),
    facts: slist(raw?.facts, 12, 120),
    colorsShown: slist(raw?.colorsShown, 12, 12),
    sizeChart: chart,
    sizesMentioned: slist(raw?.sizesMentioned, 12, 8),
  };
}

// ---------------------------------------------------------------------------
// 상세페이지 템플릿 규격 (화면의 템플릿 카드와 같은 id/레이아웃/테마)
// ---------------------------------------------------------------------------
export type DetailLayout = 'white' | 'overlay' | 'typography' | 'spec';
export type DetailTheme = 'dark' | 'purple' | 'light';

export interface DetailTemplateSpec {
  id: string;
  layoutStyle: Exclude<DetailLayout, 'spec'>;
  theme: DetailTheme;
  use: string; // AI에게 알려줄 쓰임새
  needsPhoto: boolean;
}

export const DETAIL_TEMPLATES: DetailTemplateSpec[] = [
  {
    id: 'white-simple', layoutStyle: 'white', theme: 'dark', needsPhoto: true,
    use: '상품 사진 위에 깔끔한 한 줄 헤드라인(description). 기능 설명·디테일·일반 소개. keyword(사진 장면 키워드)·mood(분위기)·description만 사용',
  },
  {
    id: 'overlay-lifestyle', layoutStyle: 'overlay', theme: 'dark', needsPhoto: true,
    use: '사진 위에 어두운 그라데이션과 문구. 사용 장면·분위기 컷. eyebrow(작은 문구)·description(헤드라인)·bodyText 사용 가능',
  },
  {
    id: 'overlay-bright', layoutStyle: 'overlay', theme: 'light', needsPhoto: true,
    use: '사진 위에 밝고 화사한 그라데이션과 문구. 산뜻한/데일리 느낌의 컷. eyebrow·description·bodyText 사용 가능',
  },
  {
    id: 'overlay-mood', layoutStyle: 'overlay', theme: 'purple', needsPhoto: true,
    use: '사진 위에 퍼플 그라데이션과 문구. 감성/무드 컷',
  },
  {
    id: 'brand-mood', layoutStyle: 'typography', theme: 'purple', needsPhoto: false,
    use: '사진 없이 그라데이션 배경 + 제품명(accentTitle 영문, accentSubtitle 한글) + 헤드라인. 브랜드/제품 소개 첫 장면',
  },
  {
    id: 'brand-mood-light', layoutStyle: 'typography', theme: 'light', needsPhoto: false,
    use: '사진 없이 파스텔 배경 + 제품명 + 헤드라인. 부드러운 소개 장면',
  },
  {
    id: 'quote-minimal', layoutStyle: 'typography', theme: 'light', needsPhoto: false,
    use: '사진 없이 여백 위에 eyebrow(인용구 느낌)와 description(헤드라인)만. 담백한 메시지/전환 장면',
  },
  {
    id: 'badge-list', layoutStyle: 'typography', theme: 'dark', needsPhoto: false,
    use: '사진 없이 badge(뱃지 문구) + description(헤드라인) + listItems(핵심 장점 3~4줄). 핵심 장점 요약 장면',
  },
  {
    id: 'stat-highlight', layoutStyle: 'typography', theme: 'dark', needsPhoto: false,
    use: '사진 없이 큰 숫자 stat + statCaption + description. 사진/표에서 확인된 수치가 있을 때만(없으면 쓰지 말 것)',
  },
];

export interface PlannedSection {
  kind: 'section' | 'spec' | 'sizechart';
  templateId: string;
  layoutStyle: DetailLayout;
  theme: DetailTheme;
  purpose: string; // 이 장면의 역할 (화면 표시용)
  sourceIndex: number | null; // 사용할 사진 번호(0부터)
  fields: PlannedFields;
  specTitle: string;
  specRows: { label: string; value: string }[];
  sizeTable?: SizeTableData | null; // kind === 'sizechart'일 때 - 사용자가 입력한 한국 기준 사이즈표
}

export const EMPTY_FIELDS: PlannedFields = {
  keyword: '', mood: '', description: '', eyebrow: '', accentTitle: '', accentSubtitle: '',
  stat: '', statCaption: '', badge: '', bodyText: '', listItems: '', colorPrompt: '',
};

const fstr = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[ \t]+/g, ' ').trim().slice(0, max) : '');

function readFields(raw: any): PlannedFields {
  const f = raw?.fields ?? raw ?? {};
  const list = Array.isArray(f.listItems)
    ? f.listItems.map((x: unknown) => fstr(x, 40)).filter(Boolean).slice(0, 5).join('\n')
    : String(f.listItems ?? '')
        .split(/\r?\n/)
        .map((x: string) => fstr(x, 40))
        .filter(Boolean)
        .slice(0, 5)
        .join('\n');
  return {
    keyword: fstr(f.keyword, 80),
    mood: fstr(f.mood, 80),
    description: fstr(f.description, 40),
    eyebrow: fstr(f.eyebrow, 40),
    accentTitle: fstr(f.accentTitle, 40),
    accentSubtitle: fstr(f.accentSubtitle, 40),
    stat: fstr(f.stat, 16),
    statCaption: fstr(f.statCaption, 40),
    badge: fstr(f.badge, 24),
    bodyText: fstr(f.bodyText, 160),
    listItems: list,
    colorPrompt: fstr(f.colorPrompt, 80),
  };
}

const hasCopy = (f: PlannedFields) =>
  !!(f.keyword || f.mood || f.description || f.eyebrow || f.accentTitle || f.stat || f.badge || f.bodyText || f.listItems);

export const MAX_PLANNED_SECTIONS = 10;

// AI가 짠 구성안(raw)을 규칙에 맞게 확정한다:
//  - 템플릿 id -> 레이아웃/테마, 알 수 없는 id는 white-simple
//  - 사진이 필요한 장면은 "쓸 수 있는 사진"만 쓰고(취급하지 않는 색상이 나온 사진 제외),
//    지정한 번호가 못 쓰는 사진이면 쓸 수 있는 사진으로 대체, 쓸 수 있는 사진이 아예
//    없으면 사진 없는 템플릿(brand-mood-light)으로 바꾼다
//  - 모든 문구 칸에서 취급하지 않는 색상/사이즈/개수 표현을 걸러낸다
//  - 사양표는 색상/사이즈 행을 코드가 취급 옵션으로 채운다
//  - 원본 사진의 사이즈표가 있으면 취급 사이즈만 남긴 사이즈 사양표를 코드가 직접 덧붙인다
export function finalizePlan(
  rawSections: unknown[],
  ctx: {
    verdicts: PhotoVerdict[];
    analyses: (SourceAnalysis | null)[];
    selling: SellingOptions;
    sizeTable?: SizeTableData | null; // 사용자가 입력한 사이즈표 (없으면 사이즈표 장면을 만들지 않는다)
  }
): { sections: PlannedSection[]; notes: string[] } {
  const notes: string[] = [];
  const { verdicts, analyses, selling } = ctx;
  const usable = verdicts.map((v, i) => (v.usable ? i : -1)).filter((i) => i >= 0);
  const usedCount = new Map<number, number>(usable.map((i) => [i, 0]));

  // 사진에서 읽은 색상 이름 중 취급하지 않는 것 - 문구 검사에서 같이 감지한다
  const extraColorWords = Array.from(
    new Set(analyses.flatMap((a) => a?.colorsShown || []).filter((c) => !isSellingColor(c, selling)))
  );

  const pickUsable = (preferred: number | null): number | null => {
    if (preferred !== null && usable.includes(preferred)) return preferred;
    if (usable.length === 0) return null;
    // 가장 덜 쓰인 사진을 골라 같은 사진이 반복되지 않게 한다
    return usable.slice().sort((a, b) => usedCount.get(a)! - usedCount.get(b)! || a - b)[0];
  };

  const sections: PlannedSection[] = [];
  for (const r of (rawSections || []).slice(0, MAX_PLANNED_SECTIONS + 2) as any[]) {
    if (sections.length >= MAX_PLANNED_SECTIONS) break;
    // 장면 이름도 화면에 보이므로 취급하지 않는 옵션 표현이 들어 있으면 비운다
    let purpose = fstr(r?.purpose, 60);
    if (purpose && findOptionViolations(purpose, selling, extraColorWords).length > 0) purpose = '';

    if (r?.kind === 'spec') {
      const rows = (Array.isArray(r?.specRows) ? r.specRows : [])
        .map((x: any) => ({ label: fstr(x?.label, 20), value: fstr(x?.value, 60) }))
        .filter((x: any) => x.label && x.value);
      const cleaned = sanitizeSpecRows(rows, selling, extraColorWords);
      notes.push(...cleaned.removed);
      if (cleaned.rows.length === 0) continue;
      sections.push({
        kind: 'spec',
        templateId: 'spec',
        layoutStyle: 'spec',
        theme: 'light',
        purpose: purpose || '제품 사양',
        sourceIndex: null,
        fields: { ...EMPTY_FIELDS },
        specTitle: fstr(r?.specTitle, 20) || '제품 사양',
        specRows: cleaned.rows,
      });
      continue;
    }

    const tpl = DETAIL_TEMPLATES.find((t) => t.id === r?.templateId) || DETAIL_TEMPLATES[0];
    let template = tpl;
    let sourceIndex: number | null = null;
    if (tpl.needsPhoto) {
      const preferred = Number.isInteger(r?.sourceIndex) ? (r.sourceIndex as number) : null;
      if (preferred !== null && verdicts[preferred] && !verdicts[preferred].usable) {
        notes.push(`사진 ${preferred + 1}번은 ${verdicts[preferred].reason} 다른 사진으로 대체했어요`);
      }
      sourceIndex = pickUsable(preferred);
      if (sourceIndex === null) {
        // 쓸 수 있는 상품 사진이 하나도 없으면 사진 없는 템플릿으로
        template = DETAIL_TEMPLATES.find((t) => t.id === 'brand-mood-light')!;
      } else {
        usedCount.set(sourceIndex, (usedCount.get(sourceIndex) || 0) + 1);
      }
    }

    const cleaned = sanitizePlannedFields(readFields(r), selling, extraColorWords);
    for (const x of cleaned.removed) {
      notes.push(`'${purpose || template.id}' 장면에서 취급하지 않는 옵션 표현을 뺐어요 (${x})`);
    }
    if (!hasCopy(cleaned.fields)) continue;

    sections.push({
      kind: 'section',
      templateId: template.id,
      layoutStyle: template.layoutStyle,
      theme: template.theme,
      purpose: purpose || template.id,
      sourceIndex,
      fields: cleaned.fields,
      specTitle: '',
      specRows: [],
    });
  }

  if (usable.length === 0 && verdicts.length > 0) {
    notes.push(
      '상품 사진으로 쓸 수 있는 사진이 없어서(취급하지 않는 색상이 나오는 사진뿐이거나 분석 실패) 사진 없는 장면 위주로 만들었어요.'
    );
  }

  // 사이즈표: 사용자가 직접 입력한 한국 기준 표로만 만든다. (중국 사진의 사이즈표 숫자는 한국으로 가져오면서
  // 바뀌므로 쓰지 않는다.) 취급하지 않는 사이즈가 섞여 있으면 빼고, 사양표 바로 앞에 넣는다.
  if (ctx.sizeTable) {
    const filtered = filterSizeTable(ctx.sizeTable, selling);
    if (filtered.removed.length > 0) {
      notes.push(`입력한 사이즈표에서 취급하지 않는 사이즈(${filtered.removed.join(', ')})는 뺐어요.`);
    }
    if (filtered.unchecked) {
      notes.push('입력한 사이즈표에서 사이즈 칸을 알아보지 못해서, 취급 사이즈와 맞는지 검사하지 못하고 입력한 그대로 넣었어요.');
    }
    const sizeSection: PlannedSection = {
      kind: 'sizechart',
      templateId: 'size-table',
      layoutStyle: 'spec',
      theme: 'light',
      purpose: '사이즈표',
      sourceIndex: null,
      fields: { ...EMPTY_FIELDS },
      specTitle: filtered.table.title || '사이즈표',
      specRows: [],
      sizeTable: filtered.table,
    };
    let at = -1;
    for (let i = sections.length - 1; i >= 0; i--) {
      if (sections[i].kind === 'spec') {
        at = i;
        break;
      }
    }
    if (at >= 0) sections.splice(at, 0, sizeSection);
    else sections.push(sizeSection);
  } else if (selling.sizes.length > 0) {
    notes.push('사이즈표를 입력하지 않아서 사이즈표 장면은 만들지 않았어요 (중국 사진의 사이즈표 숫자는 쓰지 않아요).');
  }

  return { sections, notes: Array.from(new Set(notes)) };
}

// ---------------------------------------------------------------------------
// 색상 변환 계획: 내가 파는 색상의 사진이 없으면, 다른 색(취급하지 않는 색 포함)의 사진을 그 색으로 바꿔서 쓴다
// ---------------------------------------------------------------------------
export interface RecolorJob {
  sourceIndex: number; // 바꿀 사진 번호(0부터)
  from: string | null; // 지금 색 (모르면 null)
  to: string; // 바꿀 색 (취급 색상)
}

// 사진 한 장이 대표하는 단일 색상. 라벨이 있으면 라벨, 없으면 분석에서 한 가지 색만 나온 경우. 여러 색이면 null.
export function resolvePhotoColor(analysis: SourceAnalysis | null, label: string | null): string | null {
  const l = (label || '').trim();
  if (l) return l;
  const shown: string[] = [];
  for (const c of (analysis?.colorsShown || []).map((x) => x.trim()).filter(Boolean)) {
    if (!shown.some((s) => colorsMatch(s, c))) shown.push(c);
  }
  return shown.length === 1 ? shown[0] : null;
}

const RECOLOR_ROLES: SourceRole[] = ['hero', 'detail', 'usage', 'other'];

// 취급 색상마다 그 색 사진이 없으면 변환 작업을 만든다. 색상 라인업/사이즈표/포장 사진은 바꾸지 않는다.
// 우선순위: 취급하지 않는 단일 색 사진(그냥 두면 버려짐) > 다른 취급 색 사진 > 색을 모르는 상품 컷.
export function planRecolorJobs(
  photos: { analysis: SourceAnalysis | null; label: string | null }[],
  selling: SellingOptions,
  opts: { perColor?: number; maxJobs?: number } = {}
): RecolorJob[] {
  const perColor = opts.perColor ?? 2;
  const maxJobs = opts.maxJobs ?? 6;
  const info = photos.map((p, i) => {
    const color = resolvePhotoColor(p.analysis, p.label);
    const role = p.analysis?.role ?? 'other';
    const distinct = new Set((p.analysis?.colorsShown || []).map((c) => canonicalColor(c)));
    const convertible = RECOLOR_ROLES.includes(role) && (distinct.size <= 1 || !!(p.label || '').trim()) && !!p.analysis;
    return { i, color, role, convertible };
  });

  const jobs: RecolorJob[] = [];
  const timesUsed = new Map<number, number>();
  for (const target of selling.colors) {
    // 이미 그 색 사진이 있으면 변환하지 않는다
    if (info.some((x) => x.color && colorsMatch(x.color, target))) continue;
    const candidates = info
      .filter((x) => x.convertible && !(x.color && colorsMatch(x.color, target)))
      .map((x) => ({
        ...x,
        rank: x.color && !isSellingColor(x.color, selling) ? 0 : x.color ? 1 : 2,
        roleRank: x.role === 'hero' ? 0 : x.role === 'usage' ? 1 : x.role === 'detail' ? 2 : 3,
      }))
      .sort((a, b) => a.rank - b.rank || (timesUsed.get(a.i) || 0) - (timesUsed.get(b.i) || 0) || a.roleRank - b.roleRank || a.i - b.i);
    let n = 0;
    for (const c of candidates) {
      if (n >= perColor || jobs.length >= maxJobs) break;
      if ((timesUsed.get(c.i) || 0) >= 2) continue;
      jobs.push({ sourceIndex: c.i, from: c.color, to: target });
      timesUsed.set(c.i, (timesUsed.get(c.i) || 0) + 1);
      n++;
    }
    if (jobs.length >= maxJobs) break;
  }
  return jobs;
}

// 이미지 생성 지시에 같이 적을 색상 설명 (한국어 이름만으로는 색이 흔들려서 영어 표현을 덧붙인다)
const COLOR_HINTS: Record<string, string> = {
  '#0': 'jet black, deep black',
  '#1': 'clean white',
  '#2': 'medium light gray',
  '#3': 'dark charcoal gray',
  '#4': 'deep navy blue',
  '#5': 'medium blue',
  '#6': 'sky blue, light blue',
  '#7': 'bright red',
  '#8': 'deep wine burgundy red',
  '#9': 'soft pink',
  '#10': 'green',
  '#11': 'olive khaki green',
  '#12': 'mint green',
  '#13': 'yellow',
  '#14': 'orange',
  '#15': 'purple violet',
  '#16': 'brown',
  '#17': 'beige',
  '#18': 'gold',
  '#19': 'silver',
};
export function colorHint(name: string): string {
  return COLOR_HINTS[canonicalColor(name)] || '';
}

// 사이즈표 장면은 기존 사양표 컬럼(spec_title/spec_rows)에 그대로 저장한다 (새 컬럼/마이그레이션 없이).
// spec_rows에는 표 전체를 JSON으로 담은 한 행을 넣고 라벨로 구분한다.
export const SIZE_TABLE_ROW_LABEL = '__size_table__';

export function encodeSizeTableRows(table: SizeTableData): { label: string; value: string }[] {
  return [{ label: SIZE_TABLE_ROW_LABEL, value: JSON.stringify({ headers: table.headers, rows: table.rows, note: table.note || '' }) }];
}

export function decodeSizeTableRows(rows: unknown, title?: string | null): SizeTableData | null {
  if (!Array.isArray(rows)) return null;
  const hit = rows.find((r: any) => r && r.label === SIZE_TABLE_ROW_LABEL);
  if (!hit) return null;
  try {
    const parsed = JSON.parse(String(hit.value));
    return normalizeSizeTable({ ...parsed, title: title || '' });
  } catch {
    return null;
  }
}

// 표를 편집용 글로 (parseSizeTableText의 반대) - 탭으로 칸을 나눈다
export function sizeTableToText(table: SizeTableData): string {
  return [table.headers, ...table.rows].map((r) => r.join('\t')).join('\n');
}
