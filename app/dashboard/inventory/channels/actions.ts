'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { runCoupangInventorySync, runCoupangOrderSync } from '@/lib/coupangSync';

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

  const stockResult = await runCoupangInventorySync(supabase, user.email!);
  if (stockResult.error) return stockResult;

  const orderResult = await runCoupangOrderSync(supabase, user.email!);

  revalidatePath('/dashboard/inventory/stock');
  revalidatePath('/dashboard');
  return { ...stockResult, ...orderResult };
}
