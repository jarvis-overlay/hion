'use client';

import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const supabase = createClient();

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 bg-[#F7F8FA]">
      <div className="card w-full max-w-sm p-8 text-center">
        <img
          src="/logo.png"
          alt="HION HUB"
          className="h-16 w-auto object-contain mx-auto mb-6"
        />
        <p className="text-sm text-inkSoft mb-8">
          마진 계산 · 소싱 · 재고 관리
        </p>
        <button
          onClick={signInWithGoogle}
          className="w-full btn-primary py-3 text-sm font-semibold flex items-center justify-center gap-2"
        >
          Google 계정으로 로그인
        </button>
        <p className="text-xs text-inkSoft mt-6">
          등록된 계정만 접속할 수 있어요.
        </p>
      </div>
    </main>
  );
}
