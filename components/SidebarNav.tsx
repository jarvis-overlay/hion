'use client';

import { useState } from 'react';
import Link from 'next/link';
import SignOutButton from './SignOutButton';
import NavLinks from './NavLinks';

export default function SidebarNav({ userEmail }: { userEmail: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* 모바일 상단바 - md 이상에서는 숨김 */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-paperLine bg-white sticky top-0 z-40">
        <Link href="/dashboard" onClick={() => setOpen(false)}>
          <img src="/logo.png" alt="HION HUB" className="h-9 w-auto object-contain" />
        </Link>
        <button
          onClick={() => setOpen(true)}
          aria-label="메뉴 열기"
          className="p-2 -mr-2 text-ink"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      </div>

      {/* 모바일에서 메뉴 열렸을 때 배경 클릭하면 닫히는 오버레이 */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={`w-64 shrink-0 h-screen fixed md:sticky top-0 left-0 z-50 flex flex-col bg-white border-r border-paperLine transition-transform duration-200 md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-5 py-8 flex items-center justify-between">
          <Link href="/dashboard" onClick={() => setOpen(false)}>
            <img src="/logo.png" alt="HION HUB" className="h-16 w-auto object-contain" />
          </Link>
          <button
            onClick={() => setOpen(false)}
            aria-label="메뉴 닫기"
            className="md:hidden p-1 text-inkSoft text-xl leading-none"
          >
            ✕
          </button>
        </div>

        <div onClick={() => setOpen(false)}>
          <NavLinks />
        </div>

        <div className="px-5 py-4 border-t border-paperLine">
          <div className="text-xs text-inkSoft truncate mb-1">{userEmail}</div>
          <SignOutButton />
        </div>
      </aside>
    </>
  );
}
