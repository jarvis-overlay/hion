'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function addMarginEntry(data: {
  name: string;
  price: number;
  cost: number;
  output_vat: number;
  import_vat: number;
  coupang_fee: number;
  shipping: number;
  ad_cost: number;
  etc_cost: number;
  profit: number;
  margin_pct: number;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  if (!data.name.trim() || data.price <= 0) return;

  await supabase.from('margin_entries').insert({
    ...data,
    author_email: user.email,
  });

  revalidatePath('/dashboard/margin');
}

export async function deleteMarginEntry(id: string) {
  const supabase = createClient();
  await supabase.from('margin_entries').delete().eq('id', id);
  revalidatePath('/dashboard/margin');
}
