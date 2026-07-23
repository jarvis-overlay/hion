import crypto from 'crypto';

const HOST = 'https://api-gateway.coupang.com';

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

  const res = await fetch(`${HOST}${path}?${query}`, {
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
