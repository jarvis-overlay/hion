// 네이버 데이터랩 오픈API 클라이언트 - 소싱할 아이템 발굴용.
// 키워드/카테고리별 검색·쇼핑 클릭 추이를 가져와서 뜨는 아이템을 찾는 데 쓴다.
// 공식 문서: https://developers.naver.com/docs/serviceapi/datalab/

const BASE = 'https://openapi.naver.com/v1/datalab';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} 환경변수가 설정 안 되어있어요.`);
  return v;
}

async function postDatalab(path: string, body: any) {
  const clientId = requireEnv('NAVER_CLIENT_ID');
  const clientSecret = requireEnv('NAVER_CLIENT_SECRET');

  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'X-Naver-Client-Id': clientId,
      'X-Naver-Client-Secret': clientSecret,
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
  return postDatalab('/search', {
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
  return postDatalab('/shopping/categories', {
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
  return postDatalab('/shopping/category/keywords', {
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
