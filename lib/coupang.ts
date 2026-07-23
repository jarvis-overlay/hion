import crypto from 'crypto';
import { fetch as undiciFetch, ProxyAgent } from 'undici';

const HOST = 'https://api-gateway.coupang.com';

// COUPANG_PROXY_URL 환경변수가 있으면 고정 IP 프록시를 거쳐서 요청 (Vercel의
// 랜덤 아웃바운드 IP 문제를 우회하기 위함 - Noble IP, Fixie 등의 프록시 URL)
async function proxiedFetch(url: string, options: any) {
  const proxyUrl = process.env.COUPANG_PROXY_URL || process.env.FIXIE_URL;
  if (proxyUrl) {
    const dispatcher = new ProxyAgent(proxyUrl);
    return undiciFetch(url, { ...options, dispatcher }) as any;
  }
  return fetch(url, options);
}

// 쿠팡 API가 요구하는 시간 포맷: yyMMdd'T'HHmmss'Z' (UTC 기준)
function coupangDatetime(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const yy = String(d.getUTCFullYear()).slice(2);
  const MM = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const HH = pad(d.getUTCHours());
  const mm = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `${yy}${MM}${dd}T${HH}${mm}${ss}Z`;
}

function buildAuthHeader(
  method: string,
  path: string,
  query: string,
  accessKey: string,
  secretKey: string
): string {
  const datetime = coupangDatetime();
  const message = datetime + method + path + query;
  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(message)
    .digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`;
}

export async function fetchCoupangOrderSheets({
  vendorId,
  accessKey,
  secretKey,
  createdAtFrom,
  createdAtTo,
  status,
}: {
  vendorId: string;
  accessKey: string;
  secretKey: string;
  createdAtFrom: string;
  createdAtTo: string;
  status: string;
}): Promise<any[]> {
  const path = `/v2/providers/openapi/apis/api/v4/vendors/${vendorId}/ordersheets`;
  const query = `createdAtFrom=${createdAtFrom}&createdAtTo=${createdAtTo}&status=${status}&maxPerPage=50`;
  const authorization = buildAuthHeader(
    'GET',
    path,
    query,
    accessKey,
    secretKey
  );

  const res = await proxiedFetch(`${HOST}${path}?${query}`, {
    method: 'GET',
    headers: {
      Authorization: authorization,
      'X-Requested-By': vendorId,
      'Content-Type': 'application/json;charset=UTF-8',
    },
    cache: 'no-store',
  });

  const json = await res.json();

  if (!res.ok || json.code !== 200) {
    throw new Error(json?.message || `쿠팡 API 오류 (HTTP ${res.status})`);
  }

  return json.data || [];
}
