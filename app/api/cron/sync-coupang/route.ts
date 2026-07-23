import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runCoupangInventorySync, runCoupangOrderSync } from '@/lib/coupangSync';

export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const { searchParams } = new URL(request.url);
  const querySecret = searchParams.get('secret');

  // Vercel Cron이 자동으로 보내는 값(CRON_SECRET) 또는
  // 외부 스케줄러(cron-job.org 등)가 ?secret= 로 보내는 값 둘 다 허용
  const isVercelCron =
    process.env.CRON_SECRET &&
    authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isExternalSecret =
    process.env.COUPANG_SYNC_SECRET &&
    querySecret === process.env.COUPANG_SYNC_SECRET;

  if (!isVercelCron && !isExternalSecret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const stockResult = await runCoupangInventorySync(supabase, 'auto-sync@hion');
  const orderResult = await runCoupangOrderSync(supabase, 'auto-sync@hion');

  return NextResponse.json({ ...stockResult, ...orderResult });
}
