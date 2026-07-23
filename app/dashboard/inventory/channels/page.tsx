import { createClient } from '@/lib/supabase/server';
import CoupangCard from '@/components/CoupangCard';
import NaverCard from '@/components/NaverCard';

const COMING_SOON = [
  { name: '오늘의집' },
  { name: '에이블리' },
  { name: '토스쇼핑' },
];

export default async function ChannelsPage() {
  const supabase = createClient();
  const { data: credentials } = await supabase
    .from('channel_credentials')
    .select('channel, connected');

  const isConnected = (channel: string) =>
    credentials?.find((c) => c.channel === channel)?.connected || false;

  return (
    <div>
      <h1 className="font-display text-2xl font-bold mb-1">채널 연동</h1>
      <p className="text-sm text-inkSoft mb-5">
        API 키를 등록하면 주문·재고 자동 동기화를 이어서 붙일 수 있어요.
        쿠팡·네이버부터 우선 지원해요.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <CoupangCard connected={isConnected('coupang')} />
        <NaverCard connected={isConnected('naver')} />
        {COMING_SOON.map((c) => (
          <div key={c.name} className="card p-5 opacity-60">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display font-bold">{c.name}</h3>
              <span className="text-xs px-2 py-0.5 rounded-full bg-paperLine text-inkSoft">
                준비중
              </span>
            </div>
            <p className="text-xs text-inkSoft">
              쿠팡·네이버 연동 안정화 후 순차적으로 지원 예정이에요.
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
