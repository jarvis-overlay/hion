'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { fetchCoupangOrderSheets } from '@/lib/coupang';

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

export async function syncCoupangOrders() {
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

  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 7);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  let orders: any[] = [];
  try {
    orders = await fetchCoupangOrderSheets({
      vendorId: cred.vendor_id,
      accessKey: cred.access_key,
      secretKey: cred.secret_key,
      createdAtFrom: fmt(from),
      createdAtTo: fmt(today),
      status: 'ACCEPT', // 결제완료(신규 주문)
    });
  } catch (e: any) {
    return { error: e.message || '쿠팡 API 호출에 실패했어요.' };
  }

  const { data: products } = await supabase
    .from('products')
    .select('id, coupang_vendor_item_id')
    .not('coupang_vendor_item_id', 'is', null);

  const mapByVendorItem: Record<string, string> = {};
  for (const p of products || []) {
    if (p.coupang_vendor_item_id) {
      mapByVendorItem[String(p.coupang_vendor_item_id)] = p.id;
    }
  }

  let synced = 0;
  let unmapped = 0;
  let skipped = 0;

  for (const order of orders) {
    for (const item of order.orderItems || []) {
      const vendorItemId = String(item.vendorItemId);
      const productId = mapByVendorItem[vendorItemId];
      const externalRef = `coupang:${order.shipmentBoxId}:${vendorItemId}`;

      if (!productId) {
        unmapped++;
        continue;
      }

      const { data: existing } = await supabase
        .from('stock_movements')
        .select('id')
        .eq('external_ref', externalRef)
        .maybeSingle();

      if (existing) {
        skipped++;
        continue;
      }

      const qty = Number(item.shippingCount) || 0;
      if (qty <= 0) continue;

      const { data: stockRow } = await supabase
        .from('warehouse_stock')
        .select('id, quantity')
        .eq('product_id', productId)
        .eq('warehouse', 'coupang')
        .maybeSingle();

      if (stockRow) {
        await supabase
          .from('warehouse_stock')
          .update({ quantity: stockRow.quantity - qty })
          .eq('id', stockRow.id);
      } else {
        await supabase.from('warehouse_stock').insert({
          product_id: productId,
          warehouse: 'coupang',
          quantity: -qty,
        });
      }

      await supabase.from('stock_movements').insert({
        product_id: productId,
        warehouse: 'coupang',
        type: 'out',
        quantity: -qty,
        channel: 'coupang',
        external_ref: externalRef,
        note: `쿠팡 자동동기화 (주문번호 ${order.orderId})`,
        author_email: user.email,
      });

      synced++;
    }
  }

  revalidatePath('/dashboard/inventory/stock');
  return { synced, unmapped, skipped };
}
