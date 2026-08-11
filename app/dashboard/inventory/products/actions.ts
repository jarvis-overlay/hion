'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  fetchCoupangProductList,
  fetchCoupangProductDetail,
} from '@/lib/coupang';

export async function addProduct(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const name = String(formData.get('name') || '').trim();
  const sku = String(formData.get('sku') || '').trim();
  const china_link = String(formData.get('china_link') || '').trim();
  const notes = String(formData.get('notes') || '').trim();

  if (!name) return;

  await supabase.from('products').insert({
    name,
    sku: sku || null,
    china_link: china_link || null,
    notes: notes || null,
    author_email: user.email,
  });

  revalidatePath('/dashboard/inventory/products');
}

export async function deleteProduct(id: string) {
  const supabase = createClient();
  await supabase.from('products').delete().eq('id', id);
  revalidatePath('/dashboard/inventory/products');
}

// 상품별 쿠팡 쿠폰 할인액. 매출 동기화 시 정상 재고 판매(반품 재판매 제외)의
// 판매가에서 이 값을 빼서 실제 판매가에 가깝게 계산한다.
export async function updateCouponDiscount(id: string, discount: number) {
  const supabase = createClient();
  await supabase
    .from('products')
    .update({ coupon_discount: discount })
    .eq('id', id);
  revalidatePath('/dashboard/inventory/products');
}

// 상품별 고정 배송비 (원). 성과 분석의 마진 계산에 반영된다.
export async function updateShippingCost(id: string, cost: number) {
  const supabase = createClient();
  await supabase
    .from('products')
    .update({ shipping_cost: cost })
    .eq('id', id);
  revalidatePath('/dashboard/inventory/products');
  revalidatePath('/dashboard/analytics');
}

export async function fetchImportableCoupangProducts() {
  const supabase = createClient();
  const { data: cred } = await supabase
    .from('channel_credentials')
    .select('*')
    .eq('channel', 'coupang')
    .maybeSingle();

  if (!cred || !cred.connected || !cred.vendor_id) {
    return { error: '쿠팡 연동이 안 되어있어요. 채널 연동에서 키를 먼저 저장해줘.' };
  }

  const { data: existing } = await supabase
    .from('products')
    .select('coupang_vendor_item_id')
    .not('coupang_vendor_item_id', 'is', null);
  const existingSet = new Set(
    (existing || []).map((p: any) => String(p.coupang_vendor_item_id))
  );

  try {
    let sellerProducts: any[] = [];
    let nextToken: string | undefined = undefined;
    do {
      const { data, nextToken: next } = await fetchCoupangProductList({
        vendorId: cred.vendor_id,
        accessKey: cred.access_key,
        secretKey: cred.secret_key,
        nextToken,
      });
      sellerProducts = sellerProducts.concat(data);
      nextToken = next;
    } while (nextToken);

    const candidates: {
      sellerProductId: string;
      sellerProductName: string;
      vendorItemId: string;
      itemName: string;
      alreadyImported: boolean;
    }[] = [];

    for (const sp of sellerProducts) {
      const detail = await fetchCoupangProductDetail({
        vendorId: cred.vendor_id,
        accessKey: cred.access_key,
        secretKey: cred.secret_key,
        sellerProductId: sp.sellerProductId,
      });

      const items = detail?.items || detail?.data?.items || [];
      for (const item of items) {
        const vendorItemId = String(item.vendorItemId || item.sellerProductItemId || '');
        if (!vendorItemId) continue;
        candidates.push({
          sellerProductId: String(sp.sellerProductId),
          sellerProductName: sp.sellerProductName,
          vendorItemId,
          itemName: item.itemName || '',
          alreadyImported: existingSet.has(vendorItemId),
        });
      }
    }

    return { candidates };
  } catch (e: any) {
    return { error: e.message || '쿠팡 상품 목록을 가져오지 못했어요.' };
  }
}

export async function importCoupangProducts(
  selected: {
    sellerProductName: string;
    vendorItemId: string;
    itemName: string;
  }[]
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: '로그인이 필요해요.' };

  let imported = 0;
  for (const item of selected) {
    const name =
      item.itemName && item.itemName !== item.sellerProductName
        ? `${item.sellerProductName} - ${item.itemName}`
        : item.sellerProductName;

    await supabase.from('products').insert({
      name,
      coupang_vendor_item_id: item.vendorItemId,
      author_email: user.email,
    });
    imported++;
  }

  revalidatePath('/dashboard/inventory/products');
  return { imported };
}
