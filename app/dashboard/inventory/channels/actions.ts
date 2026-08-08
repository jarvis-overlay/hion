'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  runCoupangInventorySync,
  runCoupangOrderSync,
  runCoupangReturnSync,
  syncCoupangProductCatalog,
} from '@/lib/coupangSync';

export async function saveCoupangCredentials(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const vendor_id = String(formData.get('vendor_id') || '').trim();
  const access_key = String(formData.get('access_key') || '').trim();
  const secret_key = String(formData.get('secret_key') || '').trim();

  if (!vendor_id || !access_key || !secret_key) return;

  await supabase.from('channel_credentials').upsert({
    channel: 'coupang',
    vendor_id,
    access_key,
    secret_key,
    connected: true,
    updated_at: new Date().toISOString(),
    updated_by: user.email,
  });

  revalidatePath('/dashboard/inventory/channels');
}

export async function saveNaverCredentials(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const client_id = String(formData.get('client_id') || '').trim();
  const client_secret = String(formData.get('client_secret') || '').trim();

  if (!client_id || !client_secret) return;

  await supabase.from('channel_credentials').upsert({
    channel: 'naver',
    client_id,
    client_secret,
    connected: true,
    updated_at: new Date().toISOString(),
    updated_by: user.email,
  });

  revalidatePath('/dashboard/inventory/channels');
}

export async function disconnectChannel(channel: string) {
  const supabase = createClient();
  await supabase
    .from('channel_credentials')
    .update({
      connected: false,
      vendor_id: null,
      access_key: null,
      secret_key: null,
      client_id: null,
      client_secret: null,
    })
    .eq('channel', channel);

  revalidatePath('/dashboard/inventory/channels');
}

export async function syncCoupangInventory() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: '로그인이 필요해요.' };

  // 카탈로그 동기화를 가장 먼저 실행 - 옵션ID(vendorItemId)→상품 매핑을
  // 최신 상태로 갱신해야 새로 팔린 옵션이 "매핑 안 됨"으로 누락되지 않는다.
  // 실패해도 기존 매핑으로 아래 판매/재고 동기화는 계속 진행한다.
  let catalogResult: any = {};
  try {
    catalogResult = await syncCoupangProductCatalog(supabase, user.email!);
  } catch (e: any) {
    catalogResult = { error: e?.message || String(e) };
  }

  // 판매 동기화 - 우리 시스템에 없는 상품이 팔렸으면 자동으로 등록
  const orderResult = await runCoupangOrderSync(supabase, user.email!);

  // 반품 동기화 - 판매 동기화와 별도 API라 따로 호출해야 함
  const returnResult = await runCoupangReturnSync(supabase, user.email!);

  // 그 다음 재고 동기화 - 방금 자동등록된 상품 재고도 바로 반영됨.
  // 카탈로그 동기화에서 이미 조회한 재고값은 재사용해서 API를 중복 호출하지 않는다.
  const stockResult = await runCoupangInventorySync(
    supabase,
    user.email!,
    catalogResult.inventoryByVendorItem
  );

  revalidatePath('/dashboard/inventory/stock');
  revalidatePath('/dashboard');
  return {
    ...stockResult,
    ...orderResult,
    catalogCreated: catalogResult.createdProducts ?? 0,
    catalogMapped: catalogResult.mappedVendorItems ?? 0,
    catalogError: catalogResult.error,
    catalogSkipped: catalogResult.skipped ?? false,
    returnsLogged: returnResult.logged,
    returnsError: returnResult.error,
  };
}
