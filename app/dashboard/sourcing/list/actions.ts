'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function addSourcingPost(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const title = String(formData.get('title') || '').trim();
  const source_url = String(formData.get('source_url') || '').trim();
  const price = formData.get('price') ? Number(formData.get('price')) : null;
  const moq = String(formData.get('moq') || '').trim();
  const notes = String(formData.get('notes') || '').trim();

  if (!title) return;

  await supabase.from('sourcing_posts').insert({
    title,
    source_url: source_url || null,
    price,
    moq: moq || null,
    notes: notes || null,
    author_email: user.email,
  });

  revalidatePath('/dashboard/sourcing/list');
}

export async function updateSourcingStatus(id: string, status: string) {
  const supabase = createClient();
  await supabase.from('sourcing_posts').update({ status }).eq('id', id);
  revalidatePath('/dashboard/sourcing/list');
}

export async function deleteSourcingPost(id: string) {
  const supabase = createClient();
  await supabase.from('sourcing_posts').delete().eq('id', id);
  revalidatePath('/dashboard/sourcing/list');
}
