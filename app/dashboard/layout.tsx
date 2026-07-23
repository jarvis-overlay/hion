import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import Navbar from '@/components/Navbar';
import SignOutButton from '@/components/SignOutButton';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // 등록된 두 사람 이메일인지 확인 (allowed_users 테이블)
  const { data: allowed } = await supabase
    .from('allowed_users')
    .select('email')
    .eq('email', user.email)
    .maybeSingle();

  if (!allowed) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 bg-[#F7F8FA]">
        <div className="card max-w-sm p-8 text-center">
          <h1 className="font-display text-xl font-bold mb-2">
            접근 권한이 없어요
          </h1>
          <p className="text-sm text-inkSoft mb-6">
            {user.email} 계정은 아직 허용 목록에 없어요. Supabase에서
            allowed_users 테이블에 이메일을 추가해주세요.
          </p>
          <SignOutButton />
        </div>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen bg-white">
      <Navbar />
      <main className="flex-1 min-w-0 px-8 py-8 max-w-5xl">{children}</main>
    </div>
  );
}
