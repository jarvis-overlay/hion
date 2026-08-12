import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  runCoupangInventorySync,
  runCoupangOrderSync,
  runCoupangReturnSync,
  runDailyReturnEstimate,
  backfillDailyReturnEstimates,
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

  // ?catalog=0 이면 카탈로그(전체 상품 재스캔) 단계를 건너뛴다. 카탈로그
  // 스캔은 상품 목록조회 + 상품마다 상세조회 + 옵션마다 재고조회까지 하는
  // 무거운 작업이라 Fixie 프록시 요청을 많이 쓴다. 하루 여러 번 자동
  // 동기화할 때는 하루 1번(예: 자정)만 카탈로그를 돌리고, 나머지는
  // 이 파라미터로 주문/재고만 가볍게 동기화하도록 cron-job.org에서
  // URL을 다르게 등록해서 쓴다.
  const skipCatalog = searchParams.get('catalog') === '0';
  // 카탈로그 동기화는 함수 안에 자체 쿨다운(기본 1시간)이 있어서 너무 자주
  // 불러도 실제 API는 다시 안 두드리는데, 백필처럼 강제로 최신화가 필요하면
  // ?force=1 로 쿨다운을 무시하고 강제 실행할 수 있다.
  const forceCatalog = searchParams.get('force') === '1';
  // 반품이 실제로 API 응답에서 어떻게 표현되는지 확인하기 위한 임시 디버그
  const rawDebug = searchParams.get('rawdebug') === '1';

  const supabase = createAdminClient();

  // 과거 날짜용 반품 추정 백필 - 이건 나머지 동기화와 무관하게 명시적으로
  // 요청했을 때만 딱 한 번 돈다 (자동 스케줄에 안 끼워넣음).
  const backfillReturnsParam = searchParams.get('backfillReturns');
  if (backfillReturnsParam) {
    const backfillDays = parseInt(backfillReturnsParam, 10) || 14;
    const result = await backfillDailyReturnEstimates(
      supabase,
      'auto-sync@hion',
      backfillDays
    );
    return NextResponse.json(result);
  }

  // 카탈로그 스캔 디버그 전용 - 특정 상품이 왜 걸러지는지 확인할 때만
  // 명시적으로 요청. 나머지 동기화(주문/재고/반품추정)는 안 건드린다.
  if (searchParams.get('catalogDebug') === '1') {
    const result = await syncCoupangProductCatalog(
      supabase,
      'auto-sync@hion',
      forceCatalog
    );
    return NextResponse.json(result);
  }

  let catalogResult: any = {};
  if (!skipCatalog) {
    try {
      catalogResult = await syncCoupangProductCatalog(
        supabase,
        'auto-sync@hion',
        forceCatalog
      );
    } catch (e: any) {
      catalogResult = { error: e?.message || String(e) };
    }
  }

  const orderResult = await runCoupangOrderSync(supabase, 'auto-sync@hion', daysBack, rawDebug);
  const returnResult = await runCoupangReturnSync(supabase, 'auto-sync@hion', daysBack);
  // 카탈로그 동기화를 방금 돌렸으면 거기서 이미 조회한 재고값을 재사용해서
  // 같은 옵션ID 재고를 두 번 조회하지 않는다.
  const stockResult = await runCoupangInventorySync(
    supabase,
    'auto-sync@hion',
    catalogResult.inventoryByVendorItem
  );

  // 하루 단위 재고 대사(반품 추정) - "오늘 00시~지금"을 매번 다시 계산하는
  // 방식으로 바뀌어서, 하루에 몇 번을 불러도(가벼운 동기화 포함) 안전하다.
  // 그래서 자정까지 안 기다리고 하루 중에도 계속 최신 추정치로 갱신된다.
  const dailyReturnResult = await runDailyReturnEstimate(supabase, 'auto-sync@hion');

  return NextResponse.json({
    ...stockResult,
    ...orderResult,
    daysBack,
    dailyReturnChecked: dailyReturnResult.checked,
    dailyReturnEstimated: dailyReturnResult.estimated,
    catalogCreated: catalogResult.createdProducts ?? 0,
    catalogMapped: catalogResult.mappedVendorItems ?? 0,
    catalogError: catalogResult.error,
    catalogSkipped: catalogResult.skipped ?? false,
    catalogSyncedAt: catalogResult.catalogSyncedAt,
    returnsLogged: returnResult.logged,
    returnsError: returnResult.error,
    returnsDebug: returnResult.debug,
    returnsSkipped: returnResult.skipped,
    returnsUnmapped: returnResult.unmapped,
  });
}