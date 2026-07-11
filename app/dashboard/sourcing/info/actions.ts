'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function addSourcingNote(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const title = String(formData.get('title') || '').trim();
  const link = String(formData.get('link') || '').trim();
  const content = String(formData.get('content') || '').trim();

  if (!title) return;

  await supabase.from('sourcing_notes').insert({
    title,
    link: link || null,
    content: content || null,
    author_email: user.email,
  });

  revalidatePath('/dashboard/sourcing/info');
}

export async function deleteSourcingNote(id: string) {
  const supabase = createClient();
  await supabase.from('sourcing_notes').delete().eq('id', id);
  revalidatePath('/dashboard/sourcing/info');
}
