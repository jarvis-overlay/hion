'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

const CHANNEL_WAREHOUSE: Record<string, string> = {
  coupang: 'coupang',
  naver: 'own',
  ohou: 'own',
  ably: 'own',
  toss: 'own',
};

export async function recordSale(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const product_id = String(formData.get('product_id') || '');
  const channel = String(formData.get('channel') || '');
  const quantity = Number(formData.get('quantity') || 0);
  const note = String(formData.get('note') || '').trim();

  if (!product_id || !channel || quantity <= 0) return;

  const warehouse = CHANNEL_WAREHOUSE[channel];
  if (!warehouse) return;

  const { data: existing } = await supabase
    .from('warehouse_stock')
    .select('id, quantity')
    .eq('product_id', product_id)
    .eq('warehouse', warehouse)
    .maybeSingle();

  const currentQty = existing?.quantity ?? 0;

  if (existing) {
    await supabase
      .from('warehouse_stock')
      .update({ quantity: currentQty - quantity })
      .eq('id', existing.id);
  } else {
    await supabase.from('warehouse_stock').insert({
      product_id,
      warehouse,
      quantity: -quantity,
    });
  }

  await supabase.from('stock_movements').insert({
    product_id,
    warehouse,
    type: 'out',
    quantity: -quantity,
    channel,
    note: note || null,
    author_email: user.email,
  });

  revalidatePath('/dashboard/inventory/stock');
}

export async function deleteMovement(id: string) {
  const supabase = createClient();
  await supabase.from('stock_movements').delete().eq('id', id);
  revalidatePath('/dashboard/inventory/stock');
}
