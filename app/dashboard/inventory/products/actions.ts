'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  fetchCoupangProductList,
  fetchCoupangProductDetail,
  fetchAllCoupangInventorySummaries,
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

export async function updateProductName(id: string, name: string) {
  const supabase = createClient();
  const trimmed = name.trim();
  if (!trimmed) return;
  await supabase.from('products').update({ name: trimmed }).eq('id', id);
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

// 발주 기록 없이 원가를 직접 입력 (반품등급 재판매처럼 "발주"가 안 맞는
// 상품용). null(빈 값)로 저장하면 다시 발주 기록 기반 계산으로 돌아간다.
export async function updateManualCost(id: string, cost: number | null) {
  const supabase = createClient();
  await supabase
    .from('products')
    .update({ manual_cost: cost })
    .eq('id', id);
  revalidatePath('/dashboard/inventory/products');
  revalidatePath('/dashboard/analytics');
}

// 상품 카드에 마진 계산기 공식을 바로 보여주기 위한 판매가(쿠폰 적용 후
// 실제 판매가)와 쿠팡수수료율.
export async function updateMarginInputs(
  id: string,
  salePrice: number | null,
  feeRate: number
) {
  const supabase = createClient();
  await supabase
    .from('products')
    .update({ sale_price: salePrice, fee_rate: feeRate })
    .eq('id', id);
  revalidatePath('/dashboard/inventory/products');
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

// 상품 목록 조회 API는 반품등급 옵션ID를 안 주지만, 재고 요약 API는
// vendorItemId를 생략하면 이 계정의 전체 옵션ID를 다 준다는 걸 이용해서
// 우리 DB에 아직 없는(=상품목록 스캔이 놓친) 옵션ID를 찾아 자동 등록한다.
// 상품명/바코드는 이 API가 안 줘서 임시 이름으로 등록하고, 사장님이
// 나중에 상품명과 반품등급을 직접 채워야 한다.
export async function discoverUnmappedVendorItems() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: '로그인이 필요해요.' };

  const { data: cred } = await supabase
    .from('channel_credentials')
    .select('*')
    .eq('channel', 'coupang')
    .maybeSingle();
  if (!cred || !cred.connected || !cred.vendor_id) {
    return { error: '쿠팡 연동이 안 되어있어요. 채널 연동에서 키를 먼저 저장해줘.' };
  }

  try {
    const allItems = await fetchAllCoupangInventorySummaries({
      vendorId: cred.vendor_id,
      accessKey: cred.access_key,
      secretKey: cred.secret_key,
    });

    const { data: mapped } = await supabase
      .from('product_vendor_items')
      .select('vendor_item_id');
    const mappedSet = new Set((mapped || []).map((m: any) => String(m.vendor_item_id)));

    const unmapped = allItems.filter(
      (i) => !mappedSet.has(i.vendorItemId) && i.totalOrderableQuantity > 0
    );

    let registered = 0;
    for (const item of unmapped) {
      const { data: created, error: createErr } = await supabase
        .from('products')
        .insert({
          name: `미확인 상품 (옵션ID ${item.vendorItemId}) - 이름/등급 입력 필요`,
          author_email: user.email,
          notes:
            '재고 요약 API로 자동 발견됨 - 상품목록 조회에 안 잡히는 옵션(주로 반품등급). 상품명과 반품등급을 직접 채워주세요.',
          return_grade: null,
        })
        .select('id')
        .single();
      if (createErr) continue;

      const { error: mapErr } = await supabase
        .from('product_vendor_items')
        .upsert(
          {
            product_id: created.id,
            vendor_item_id: item.vendorItemId,
            is_return_grade: true,
          },
          { onConflict: 'vendor_item_id' }
        );
      if (!mapErr) registered++;
    }

    revalidatePath('/dashboard/inventory/products');
    return { registered, totalFound: allItems.length, unmappedFound: unmapped.length };
  } catch (e: any) {
    return { error: e.message || '조회에 실패했어요.' };
  }
}

// 반품등급(최상/상/중 등) 표시 - 쿠팡에만 있는 개념이라 다른 채널과 무관.
export async function updateReturnGrade(id: string, grade: string) {
  const supabase = createClient();
  await supabase
    .from('products')
    .update({ return_grade: grade.trim() || null })
    .eq('id', id);
  revalidatePath('/dashboard/inventory/products');
}

// 쿠팡 "상품 목록 조회" API는 반품등급(회수품) 상품을 아예 안 돌려줘서
// 카탈로그 자동 스캔으로는 발견이 불가능하다는 게 실측으로 확인됐다.
// 쿠팡 판매자센터 재고관리 화면에서 sellerProductId를 직접 찾아서
// 수동으로 등록하는 용도.
export async function registerReturnGradeProduct(
  sellerProductId: string,
  returnGrade: string
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: '로그인이 필요해요.' };

  const { data: cred } = await supabase
    .from('channel_credentials')
    .select('*')
    .eq('channel', 'coupang')
    .maybeSingle();

  if (!cred || !cred.connected || !cred.vendor_id) {
    return { error: '쿠팡 연동이 안 되어있어요. 채널 연동에서 키를 먼저 저장해줘.' };
  }

  try {
    const detail = await fetchCoupangProductDetail({
      vendorId: cred.vendor_id,
      accessKey: cred.access_key,
      secretKey: cred.secret_key,
      sellerProductId: sellerProductId.trim(),
    });

    const detailData = (detail as any)?.data || detail || {};
    const items = detailData.items || [];
    if (!items.length) {
      return { error: '이 sellerProductId로 조회된 옵션이 없어요.' };
    }

    const displayName =
      detailData.sellerProductName || `쿠팡 상품 (${sellerProductId})`;

    const { data: existing } = await supabase
      .from('products')
      .select('id')
      .eq('coupang_seller_product_id', String(sellerProductId))
      .maybeSingle();

    let productId = existing?.id;
    if (!productId) {
      const { data: created, error: createErr } = await supabase
        .from('products')
        .insert({
          name: `${displayName} (반품등급${returnGrade ? ` - ${returnGrade}` : ''})`,
          coupang_seller_product_id: String(sellerProductId),
          return_grade: returnGrade || null,
          author_email: user.email,
          notes: '반품등급 재판매 상품 - 수동 등록 (쿠폰 할인 미적용)',
        })
        .select('id')
        .single();
      if (createErr) return { error: createErr.message };
      productId = created.id;
    }

    let mapped = 0;
    for (const item of items) {
      const vendorItemId = item.rocketGrowthItemData?.vendorItemId;
      if (!vendorItemId) continue;
      const { error: mapErr } = await supabase
        .from('product_vendor_items')
        .upsert(
          {
            product_id: productId,
            vendor_item_id: String(vendorItemId),
            is_return_grade: true,
          },
          { onConflict: 'vendor_item_id' }
        );
      if (!mapErr) mapped++;
    }

    revalidatePath('/dashboard/inventory/products');
    return { mapped, productName: displayName };
  } catch (e: any) {
    return { error: e.message || '조회에 실패했어요.' };
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
