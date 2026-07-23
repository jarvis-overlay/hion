'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { fetchCoupangOrderSheets, fetchCoupangInventoryForItem } from '@/lib/coupang';

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

  const { data: cred } = await supabase
    .from('channel_credentials')
    .select('*')
    .eq('channel', 'coupang')
    .maybeSingle();

  if (!cred || !cred.connected || !cred.vendor_id) {
    return {
      error: '쿠팡 연동이 안 되어있어요. 위에서 키를 먼저 저장해줘.',
    };
  }

  const { data: products } = await supabase
    .from('products')
    .select('id, name, coupang_vendor_item_id')
    .not('coupang_vendor_item_id', 'is', null);

  if (!products || products.length === 0) {
    return {
      error:
        '쿠팡 옵션ID(vendorItemId)가 등록된 상품이 없어요. 상품 관리에서 먼저 등록해줘.',
    };
  }

  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const product of products) {
    try {
      const result = await fetchCoupangInventoryForItem({
        vendorId: cred.vendor_id,
        accessKey: cred.access_key,
        secretKey: cred.secret_key,
        vendorItemId: String(product.coupang_vendor_item_id),
      });

      if (!result) {
        failed++;
        continue;
      }

      const newQty = result.totalOrderableQuantity;

      const { data: stockRow } = await supabase
        .from('warehouse_stock')
        .select('id, quantity')
        .eq('product_id', product.id)
        .eq('warehouse', 'coupang')
        .maybeSingle();

      const prevQty = stockRow?.quantity ?? 0;

      if (stockRow) {
        await supabase
          .from('warehouse_stock')
          .update({ quantity: newQty })
          .eq('id', stockRow.id);
      } else {
        await supabase.from('warehouse_stock').insert({
          product_id: product.id,
          warehouse: 'coupang',
          quantity: newQty,
        });
      }

      if (newQty !== prevQty) {
        await supabase.from('stock_movements').insert({
          product_id: product.id,
          warehouse: 'coupang',
          type: newQty > prevQty ? 'in' : 'out',
          quantity: newQty - prevQty,
          channel: 'coupang',
          note: `쿠팡 로켓창고 재고 동기화 (${prevQty} → ${newQty})`,
          author_email: user.email,
        });
        updated++;
      } else {
        unchanged++;
      }
    } catch (e) {
      failed++;
    }
  }

  revalidatePath('/dashboard/inventory/stock');
  revalidatePath('/dashboard');
  return { updated, unchanged, failed };
}
