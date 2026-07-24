import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { syncCoupangProductCatalog } from '@/lib/coupangSync';

export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const querySecret = searchParams.get('secret');

  const isExternalSecret =
    process.env.COUPANG_SYNC_SECRET &&
    querySecret === process.env.COUPANG_SYNC_SECRET;

  if (!isExternalSecret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const result = await syncCoupangProductCatalog(supabase, 'auto-sync@hion');

  return NextResponse.json(result);
}
