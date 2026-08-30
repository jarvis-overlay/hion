// 네이버 데이터랩 API 클라이언트 - 소싱할 아이템 발굴용.
// 2026-07-31부로 openapi.naver.com 개발자센터 체계가 NAVER API HUB로
// 이전됐다 (주소/인증 헤더가 완전히 바뀜). 데이터랩(트렌드)은 HUB로
// 이관됐지만, 쇼핑 상품 검색(v1/search/shop.json)은 이관 없이 완전히
// 종료돼서 대체 API가 없다 - 실제 상품 목록이 필요하면 쿠팡처럼 별도
// 스크래핑 수단을 써야 한다.
// 참고: https://guide.ncloud-docs.com/docs/naveropenapiv3-application

const TREND_URL = 'https://naverapihub.apigw.ntruss.com/search-trend/v1/search';
const SHOPPING_BASE = 'https://naverapihub.apigw.ntruss.com/shopping/v1';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} 환경변수가 설정 안 되어있어요.`);
  return v;
}

async function postNaverHub(url: string, body: any) {
  const clientId = requireEnv('NAVER_CLIENT_ID');
  const clientSecret = requireEnv('NAVER_CLIENT_SECRET');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-NCP-APIGW-API-KEY-ID': clientId,
      'X-NCP-APIGW-API-KEY': clientSecret,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.errorMessage || `네이버 API 오류 (HTTP ${res.status})`);
  }
  return json;
}

export type TimeUnit = 'date' | 'week' | 'month';

export interface DatalabResult {
  title: string;
  keywords?: string[];
  data: { period: string; ratio: number }[];
}

export interface DatalabResponse {
  startDate: string;
  endDate: string;
  timeUnit: TimeUnit;
  results: DatalabResult[];
}

// 통합 검색어 트렌드 - 최대 5개 키워드 그룹까지 비교. 그룹당 최대 20개
// 유의어를 묶을 수 있다 (예: {groupName: "선풍기", keywords: ["선풍기","미니선풍기"]})
export async function fetchSearchTrend({
  startDate,
  endDate,
  timeUnit,
  keywordGroups,
}: {
  startDate: string;
  endDate: string;
  timeUnit: TimeUnit;
  keywordGroups: { groupName: string; keywords: string[] }[];
}): Promise<DatalabResponse> {
  return postNaverHub(TREND_URL, {
    startDate,
    endDate,
    timeUnit,
    keywordGroups,
  });
}

// 쇼핑인사이트 분야별 트렌드 - 최대 3개 카테고리까지 클릭량 추이 비교.
// param에는 네이버쇼핑 카테고리 코드(예: "50000003")를 넣는다.
export async function fetchShoppingCategoryTrend({
  startDate,
  endDate,
  timeUnit,
  categories,
}: {
  startDate: string;
  endDate: string;
  timeUnit: TimeUnit;
  categories: { name: string; param: string[] }[];
}): Promise<DatalabResponse> {
  return postNaverHub(`${SHOPPING_BASE}/categories`, {
    startDate,
    endDate,
    timeUnit,
    category: categories,
  });
}

// 쇼핑인사이트 키워드별 트렌드 - 특정 카테고리 안에서 키워드(최대 5개
// 그룹)별 클릭량 추이를 비교.
export async function fetchShoppingKeywordTrend({
  startDate,
  endDate,
  timeUnit,
  categoryCode,
  keywords,
}: {
  startDate: string;
  endDate: string;
  timeUnit: TimeUnit;
  categoryCode: string;
  keywords: { name: string; param: string[] }[];
}): Promise<DatalabResponse> {
  return postNaverHub(`${SHOPPING_BASE}/category/keywords`, {
    startDate,
    endDate,
    timeUnit,
    category: categoryCode,
    keyword: keywords,
  });
}

// 자주 쓰는 네이버쇼핑 대분류 카테고리 코드 (쇼핑인사이트 API용)
export const SHOPPING_CATEGORIES = [
  { code: '50000000', name: '패션의류' },
  { code: '50000001', name: '패션잡화' },
  { code: '50000002', name: '화장품/미용' },
  { code: '50000003', name: '디지털/가전' },
  { code: '50000004', name: '가구/인테리어' },
  { code: '50000005', name: '출산/육아' },
  { code: '50000006', name: '식품' },
  { code: '50000007', name: '스포츠/레저' },
  { code: '50000008', name: '생활/건강' },
  { code: '50000009', name: '여가/생활편의' },
];

export interface KeywordTrendSignal {
  direction: 'up' | 'down' | 'flat';
  changePct: number; // 최근 절반 대비 이전 절반 관심도 변화율
  recentRatio: number; // 최근 관심도 평균 (0~100 상대값)
}

// 카테고리/상품 후보 이름 하나로 최근 3개월 네이버 검색 관심도 추이를
// 본다. 쿠팡은 실제 판매/리뷰 데이터가 있지만 네이버 쇼핑 상품 검색
// API는 종료돼서 그런 절대 수치가 없다 - 대신 "관심도가 오르는
// 중인지"는 데이터랩으로 알 수 있어서, 이걸 쿠팡 데이터의 보조
// 지표로 같이 보여준다. 실패하면(권한/네트워크 등) null - 이 신호
// 없이도 쿠팡 기반 판단은 그대로 유효해야 하므로 호출부에서 무시
// 가능해야 함.
export async function fetchKeywordTrendSignal(keyword: string): Promise<KeywordTrendSignal | null> {
  try {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 3);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const res = await fetchSearchTrend({
      startDate: fmt(start),
      endDate: fmt(end),
      timeUnit: 'week',
      keywordGroups: [{ groupName: keyword, keywords: [keyword] }],
    });

    const data = res.results[0]?.data;
    if (!data || data.length < 2) return null;

    const half = Math.floor(data.length / 2);
    const first = data.slice(0, half);
    const second = data.slice(half);
    const avg = (arr: { ratio: number }[]) => arr.reduce((s, d) => s + d.ratio, 0) / arr.length;
    const a1 = avg(first);
    const a2 = avg(second);
    const changePct = a1 === 0 ? 0 : ((a2 - a1) / a1) * 100;

    return {
      direction: changePct >= 10 ? 'up' : changePct <= -10 ? 'down' : 'flat',
      changePct,
      recentRatio: a2,
    };
  } catch {
    return null;
  }
}
