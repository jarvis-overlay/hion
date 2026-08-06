import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  runCoupangInventorySync,
  runCoupangOrderSync,
  syncCoupangProductCatalog,
} from '@/lib/coupangSync';

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

  // ?days=60 처럼 넘기면 과거 60일치 백필. 안 넘기면 기본 2일(평소 크론 동작).
  const daysParam = searchParams.get('days');
  const daysBack = daysParam ? parseInt(daysParam, 10) : 2;

  const supabase = createAdminClient();

  // 자동 크론이 제거된 뒤로는 이 라우트가 유일한 정기 동기화 지점이므로,
  // 여기서 카탈로그(옵션ID 매핑) 동기화까지 함께 최신화한다.
  let catalogResult: any = {};
  try {
    catalogResult = await syncCoupangProductCatalog(supabase, 'auto-sync@hion');
  } catch (e: any) {
    catalogResult = { error: e?.message || String(e) };
  }

  const orderResult = await runCoupangOrderSync(supabase, 'auto-sync@hion', daysBack);
  const stockResult = await runCoupangInventorySync(supabase, 'auto-sync@hion');

  return NextResponse.json({
    ...stockResult,
    ...orderResult,
    daysBack,
    catalogCreated: catalogResult.createdProducts ?? 0,
    catalogMapped: catalogResult.mappedVendorItems ?? 0,
    catalogError: catalogResult.error,
  });
}