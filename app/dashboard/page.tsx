import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

const CHANNEL_LABEL: Record<string, string> = {
  coupang: '쿠팡',
  naver: '네이버',
  ohou: '오늘의집',
  ably: '에이블리',
  toss: '토스쇼핑',
};

const TYPE_LABEL: Record<string, string> = {
  in: '입고',
  out: '판매출고',
  move: '창고이동',
};

export default async function DashboardHome() {
  const supabase = createClient();

  const [
    { count: productCount },
    { data: stockRows },
    { data: sourcingPosts },
    { data: channels },
    { count: marginCount },
    { data: recentMovements },
  ] = await Promise.all([
    supabase.from('products').select('id', { count: 'exact', head: true }),
    supabase.from('warehouse_stock').select('warehouse, quantity'),
    supabase.from('sourcing_posts').select('status'),
    supabase.from('channel_credentials').select('channel, connected'),
    supabase.from('margin_entries').select('id', { count: 'exact', head: true }),
    supabase
      .from('stock_movements')
      .select('*, products(name)')
      .order('created_at', { ascending: false })
      .limit(6),
  ]);

  const coupangStock = (stockRows || [])
    .filter((r) => r.warehouse === 'coupang')
    .reduce((sum, r) => sum + r.quantity, 0);
  const ownStock = (stockRows || [])
    .filter((r) => r.warehouse === 'own')
    .reduce((sum, r) => sum + r.quantity, 0);

  const statusCount = { checking: 0, ordered: 0, hold: 0 } as Record<
    string,
    number
  >;
  for (const p of sourcingPosts || []) {
    statusCount[p.status] = (statusCount[p.status] || 0) + 1;
  }

  const isConnected = (ch: string) =>
    channels?.find((c) => c.channel === ch)?.connected || false;

  return (
    <div>
      <h1 className="font-display text-2xl font-bold mb-1">대시보드</h1>
      <p className="text-sm text-inkSoft mb-6">전체 현황 한눈에 보기</p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <Link href="/dashboard/inventory/products" className="card p-5">
          <div className="text-xs text-inkSoft mb-2">등록 상품</div>
          <div className="text-2xl font-bold font-mono">
            {productCount || 0}개
          </div>
        </Link>

        <Link href="/dashboard/inventory/stock" className="card p-5">
          <div className="text-xs text-inkSoft mb-2">쿠팡 창고 재고</div>
          <div className="text-2xl font-bold font-mono">{coupangStock}개</div>
        </Link>

        <Link href="/dashboard/inventory/stock" className="card p-5">
          <div className="text-xs text-inkSoft mb-2">자사 물류창고 재고</div>
          <div className="text-2xl font-bold font-mono">{ownStock}개</div>
        </Link>

        <Link href="/dashboard/margin" className="card p-5">
          <div className="text-xs text-inkSoft mb-2">저장된 마진 계산</div>
          <div className="text-2xl font-bold font-mono">
            {marginCount || 0}건
          </div>
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 mb-8">
        <div className="card p-5">
          <h2 className="font-display font-bold mb-4">소싱 리스트 현황</h2>
          <div className="flex gap-3">
            <div className="flex-1 text-center py-3 rounded-lg bg-warnBg">
              <div className="text-xl font-bold text-warn font-mono">
                {statusCount.checking}
              </div>
              <div className="text-xs text-inkSoft mt-1">검토중</div>
            </div>
            <div className="flex-1 text-center py-3 rounded-lg bg-profitBg">
              <div className="text-xl font-bold text-profit font-mono">
                {statusCount.ordered}
              </div>
              <div className="text-xs text-inkSoft mt-1">발주완료</div>
            </div>
            <div className="flex-1 text-center py-3 rounded-lg bg-[#F3F4F6]">
              <div className="text-xl font-bold text-inkSoft font-mono">
                {statusCount.hold}
              </div>
              <div className="text-xs text-inkSoft mt-1">보류</div>
            </div>
          </div>
          <Link
            href="/dashboard/sourcing/list"
            className="text-xs text-accent hover:underline mt-4 inline-block"
          >
            소싱 리스트 보기 →
          </Link>
        </div>

        <div className="card p-5">
          <h2 className="font-display font-bold mb-4">채널 연동 상태</h2>
          <div className="flex flex-col gap-2">
            {['coupang', 'naver'].map((ch) => (
              <div
                key={ch}
                className="flex items-center justify-between text-sm"
              >
                <span>{CHANNEL_LABEL[ch]}</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    isConnected(ch)
                      ? 'bg-profitBg text-profit'
                      : 'bg-warnBg text-warn'
                  }`}
                >
                  {isConnected(ch) ? '연결됨' : '미연결'}
                </span>
              </div>
            ))}
            {['ohou', 'ably', 'toss'].map((ch) => (
              <div
                key={ch}
                className="flex items-center justify-between text-sm opacity-50"
              >
                <span>{CHANNEL_LABEL[ch]}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-[#F3F4F6] text-inkSoft">
                  준비중
                </span>
              </div>
            ))}
          </div>
          <Link
            href="/dashboard/inventory/channels"
            className="text-xs text-accent hover:underline mt-4 inline-block"
          >
            채널 연동 관리 →
          </Link>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="font-display font-bold mb-4">최근 재고 히스토리</h2>
        {recentMovements?.length ? (
          <div className="flex flex-col gap-2">
            {recentMovements.map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-3 text-sm border-b border-paperLine last:border-0 pb-2 last:pb-0"
              >
                <span
                  className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${
                    m.type === 'in'
                      ? 'bg-profitBg text-profit'
                      : 'bg-warnBg text-warn'
                  }`}
                >
                  {TYPE_LABEL[m.type] || m.type}
                </span>
                <span className="flex-1 truncate">
                  {m.products?.name || '상품'}
                </span>
                <span
                  className={`font-mono text-xs ${
                    m.quantity < 0 ? 'text-red-700' : 'text-profit'
                  }`}
                >
                  {m.quantity > 0 ? '+' : ''}
                  {m.quantity}
                </span>
                <span className="text-[11px] text-inkSoft whitespace-nowrap">
                  {new Date(m.created_at).toLocaleDateString('ko-KR')}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-inkSoft">아직 히스토리가 없어요.</p>
        )}
        <Link
          href="/dashboard/inventory/stock"
          className="text-xs text-accent hover:underline mt-4 inline-block"
        >
          전체 히스토리 보기 →
        </Link>
      </div>
    </div>
  );
}
