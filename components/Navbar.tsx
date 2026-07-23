import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import SignOutButton from './SignOutButton';
import NavLinks from './NavLinks';

export default async function Sidebar() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <aside className="w-60 shrink-0 h-screen sticky top-0 flex flex-col border-r border-paperLine bg-white">
      <div className="px-5 py-8">
        <Link href="/dashboard">
          <img src="/logo.png" alt="HION HUB" className="h-16 w-auto object-contain" />
        </Link>
      </div>

      <NavLinks />

      <div className="px-5 py-4 border-t border-paperLine">
        <div className="text-xs text-inkSoft truncate mb-1">{user?.email}</div>
        <SignOutButton />
      </div>
    </aside>
  );
}
