import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import SignOutButton from './SignOutButton';

export default async function Navbar() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header className="border-b-2 border-ink">
      <div className="max-w-5xl mx-auto px-5 py-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-6">
          <span className="font-display font-bold text-lg">HION HUB</span>
          <nav className="flex gap-4 text-sm flex-wrap">
            <Link href="/dashboard/margin" className="hover:underline">
              마진 계산기
            </Link>
            <Link href="/dashboard/sourcing/info" className="hover:underline">
              소싱 정보
            </Link>
            <Link href="/dashboard/sourcing/list" className="hover:underline">
              소싱 리스트
            </Link>
            <span className="text-paperLine">|</span>
            <Link href="/dashboard/inventory/products" className="hover:underline">
              상품 관리
            </Link>
            <Link href="/dashboard/inventory/orders" className="hover:underline">
              발주·입고
            </Link>
            <Link href="/dashboard/inventory/stock" className="hover:underline">
              재고 현황
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3 text-xs text-inkSoft">
          <span>{user?.email}</span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
