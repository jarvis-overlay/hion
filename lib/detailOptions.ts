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
  kind: 'section' | 'spec';
  templateId: string;
  layoutStyle: DetailLayout;
  theme: DetailTheme;
  purpose: string; // 이 장면의 역할 (화면 표시용)
  sourceIndex: number | null; // 사용할 사진 번호(0부터)
  fields: PlannedFields;
  specTitle: string;
  specRows: { label: string; value: string }[];
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

  // 사이즈표: 원본 사진에서 읽은 표를 취급 사이즈만 남겨서 사양표로
  if (sections.length < MAX_PLANNED_SECTIONS) {
    for (const a of analyses) {
      const filtered = filterSizeChart(a?.sizeChart ?? null, selling);
      const rows = chartToSpecRows(filtered).filter((x) => x.value);
      if (rows.length > 0) {
        sections.push({
          kind: 'spec',
          templateId: 'spec',
          layoutStyle: 'spec',
          theme: 'light',
          purpose: '사이즈 정보',
          sourceIndex: null,
          fields: { ...EMPTY_FIELDS },
          specTitle: '사이즈 정보',
          specRows: rows,
        });
        notes.push('사이즈표의 수치는 원본 사진에서 AI가 읽은 값이에요. 실제 치수와 맞는지 꼭 확인하세요.');
        break;
      }
    }
  }
  if (selling.sizes.length === 0 && analyses.some((a) => a?.sizeChart)) {
    notes.push('취급 사이즈를 입력하지 않아서 사진의 사이즈표는 넣지 않았어요.');
  }

  return { sections, notes: Array.from(new Set(notes)) };
}
