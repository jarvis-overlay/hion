'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function addPurchaseOrder(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const product_id = String(formData.get('product_id') || '');
  const order_date = String(formData.get('order_date') || '');
  const quantity = Number(formData.get('quantity') || 0);
  const unit_price_cny = Number(formData.get('unit_price_cny') || 0);
  const exchange_rate = Number(formData.get('exchange_rate') || 190);
  const note = String(formData.get('note') || '').trim();

  if (!product_id || !order_date || quantity <= 0) return;

  await supabase.from('purchase_orders').insert({
    product_id,
    order_date,
    quantity,
    unit_price_cny,
    exchange_rate,
    note: note || null,
    author_email: user.email,
  });

  revalidatePath('/dashboard/inventory/orders');
}

export async function receivePurchaseOrder(
  orderId: string,
  productId: string,
  coupangQty: number,
  ownQty: number,
  note: string
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const entries: { warehouse: string; qty: number }[] = [];
  if (coupangQty > 0) entries.push({ warehouse: 'coupang', qty: coupangQty });
  if (ownQty > 0) entries.push({ warehouse: 'own', qty: ownQty });

  for (const entry of entries) {
    // 창고 재고 upsert (기존 있으면 증가, 없으면 생성)
    const { data: existing } = await supabase
      .from('warehouse_stock')
      .select('id, quantity')
      .eq('product_id', productId)
      .eq('warehouse', entry.warehouse)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('warehouse_stock')
        .update({ quantity: existing.quantity + entry.qty })
        .eq('id', existing.id);
    } else {
      await supabase.from('warehouse_stock').insert({
        product_id: productId,
        warehouse: entry.warehouse,
        quantity: entry.qty,
      });
    }

    await supabase.from('stock_movements').insert({
      product_id: productId,
      warehouse: entry.warehouse,
      type: 'in',
      quantity: entry.qty,
      related_order_id: orderId,
      note: note || null,
      author_email: user.email,
    });
  }

  await supabase
    .from('purchase_orders')
    .update({ status: 'received' })
    .eq('id', orderId);

  revalidatePath('/dashboard/inventory/orders');
  revalidatePath('/dashboard/inventory/stock');
}

export async function deletePurchaseOrder(id: string) {
  const supabase = createClient();
  await supabase.from('purchase_orders').delete().eq('id', id);
  revalidatePath('/dashboard/inventory/orders');
}
