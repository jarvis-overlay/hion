'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const GROUPS: { label: string | null; items: { href: string; label: string }[] }[] = [
  {
    label: null,
    items: [{ href: '/dashboard/margin', label: '마진 계산기' }],
  },
  {
    label: '소싱',
    items: [
      { href: '/dashboard/sourcing/info', label: '소싱 정보' },
      { href: '/dashboard/sourcing/list', label: '소싱 리스트' },
    ],
  },
  {
    label: '재고관리',
    items: [
      { href: '/dashboard/inventory/products', label: '상품 관리' },
      { href: '/dashboard/inventory/orders', label: '발주·입고' },
      { href: '/dashboard/inventory/stock', label: '재고 현황' },
      { href: '/dashboard/inventory/channels', label: '채널 연동' },
    ],
  },
];

export default function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex-1 px-3">
      {GROUPS.map((group, i) => (
        <div key={i}>
          {group.label && <div className="nav-section-label">{group.label}</div>}
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const isActive = pathname?.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-link ${isActive ? 'active' : ''}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
