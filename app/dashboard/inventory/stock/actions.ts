'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function toggleProductVisibility(productId: string, hide: boolean) {
  const supabase = createClient();
  await supabase.from('products').update({ is_hidden: hide }).eq('id', productId);
  revalidatePath('/dashboard/inventory/stock');
}
