'use server';

import { createClient } from '@/lib/supabase/server';
import {
  fetchCoupangInventoryForItem,
  fetchCoupangProductDetail,
  fetchCoupangProductList,
  fetchCoupangRaw,
  fetchCoupangRGOrderById,
  fetchCoupangRGOrders,
  fetchCoupangReturnRequests,
} from '@/lib/coupang';

async function getCoupangCred(supabase: any) {
  const { data: cred } = await supabase
    .from('channel_credentials')
    .select('*')
    .eq('channel', 'coupang')
    .maybeSingle();

  if (!cred || !cred.connected || !cred.vendor_id) {
    throw new Error('쿠팡 연동이 안 되어있어요. 채널 연동에서 키를 먼저 저장해줘.');
  }
  return cred;
}

// 관리자 대시보드에서 쿠팡 API 원본 응답을 바로 확인해보기 위한 테스트 전용
// 액션. 실제 동기화 로직(lib/coupangSync.ts)과는 무관하고, 여기서 조회한
// 결과가 DB에 저장되지도 않는다 - 순수 조회/디버그 용도.
export async function testCoupangApi(endpoint: string, params: Record<string, string>) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: '로그인이 필요해요.' };

  try {
    const cred = await getCoupangCred(supabase);
    const base = {
      vendorId: cred.vendor_id,
      accessKey: cred.access_key,
      secretKey: cred.secret_key,
    };

    let data: any;
    switch (endpoint) {
      case 'productList':
        data = await fetchCoupangProductList({
          ...base,
          nextToken: params.nextToken || undefined,
        });
        break;
      case 'productDetail':
        data = await fetchCoupangProductDetail({
          ...base,
          sellerProductId: params.sellerProductId,
        });
        break;
      case 'inventory':
        data = await fetchCoupangInventoryForItem({
          ...base,
          vendorItemId: params.vendorItemId,
        });
        break;
      case 'orderList':
        data = await fetchCoupangRGOrders({
          ...base,
          paidDateFrom: params.paidDateFrom,
          paidDateTo: params.paidDateTo,
          nextToken: params.nextToken || undefined,
        });
        break;
      case 'orderById':
        data = await fetchCoupangRGOrderById({
          ...base,
          orderId: params.orderId,
        });
        break;
      case 'returnList':
        data = await fetchCoupangReturnRequests({
          ...base,
          createdAtFrom: params.createdAtFrom,
          createdAtTo: params.createdAtTo,
          nextToken: params.nextToken || undefined,
        });
        break;
      case 'custom': {
        // path/query에 {vendorId}가 들어있으면 실제 vendorId로 자동
        // 치환해준다 (쿠팡 문서 예시 URL을 그대로 복붙해도 되게 - path
        // 파라미터로 쓰는 API도 있고 query 파라미터로 쓰는 API도 있어서
        // 둘 다 처리).
        const rawPath = (params.path || '').replace(/\{vendorId\}/g, cred.vendor_id);
        const rawQuery = (params.query || '').replace(/\{vendorId\}/g, cred.vendor_id);
        const result = await fetchCoupangRaw({
          ...base,
          method: params.method || 'GET',
          path: rawPath,
          query: rawQuery,
        });
        data = result;
        break;
      }
      default:
        return { error: '알 수 없는 API 종류예요.' };
    }

    return { data };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}
