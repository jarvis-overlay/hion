'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function addSourcingItem(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const title = String(formData.get('title') || '').trim();
  const link = String(formData.get('link') || '').trim();
  const price = formData.get('price') ? Number(formData.get('price')) : null;
  const cost = formData.get('cost') ? Number(formData.get('cost')) : null;
  const moq = String(formData.get('moq') || '').trim();
  const content = String(formData.get('content') || '').trim();

  if (!title) return;

  await supabase.from('sourcing_items').insert({
    title,
    link: link || null,
    price,
    cost,
    moq: moq || null,
    content: content || null,
    author_email: user.email,
  });

  revalidatePath('/dashboard/sourcing/list');
}

export async function updateSourcingStatus(id: string, status: string) {
  const supabase = createClient();
  await supabase.from('sourcing_items').update({ status }).eq('id', id);
  revalidatePath('/dashboard/sourcing/list');
}

export async function updateSourcingStage(id: string, stage: string) {
  const supabase = createClient();
  await supabase.from('sourcing_items').update({ stage }).eq('id', id);
  revalidatePath('/dashboard/sourcing/list');
}

export async function deleteSourcingItem(id: string) {
  const supabase = createClient();
  await supabase.from('sourcing_items').delete().eq('id', id);
  revalidatePath('/dashboard/sourcing/list');
}
