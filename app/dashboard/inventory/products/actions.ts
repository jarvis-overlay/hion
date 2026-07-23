'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

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

export async function updateCoupangMapping(id: string, vendorItemId: string) {
  const supabase = createClient();
  await supabase
    .from('products')
    .update({ coupang_vendor_item_id: vendorItemId.trim() || null })
    .eq('id', id);
  revalidatePath('/dashboard/inventory/products');
}
