'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const GROUPS: { label: string | null; items: { href: string; label: string }[] }[] = [
  {
    label: null,
    items: [
      { href: '/dashboard', label: '홈' },
      { href: '/dashboard/margin', label: '마진 계산기' },
      { href: '/dashboard/analytics', label: '성과 분석' },
    ],
  },
  {
    label: '소싱',
    items: [
      { href: '/dashboard/sourcing/list', label: '소싱' },
      { href: '/dashboard/sourcing/trends', label: 'AI 소싱 추천' },
      { href: '/dashboard/sourcing/compare', label: '키워드 리서치' },
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
  {
    label: null,
    items: [{ href: '/dashboard/notifications', label: '알림 설정' }],
  },
  {
    label: '개발자',
    items: [{ href: '/dashboard/api-test', label: 'API 테스트' }],
  },
];

export default function NavLinks() {
  const pathname = usePathname();
  // 그룹 안에 현재 활성 링크가 있으면 그 그룹은 강제로 펼쳐서 보여줘야
  // 하므로, 접힘 상태는 "닫힌 그룹" 집합으로 관리한다 (기본은 전부 열림).
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());

  function isGroupActive(group: (typeof GROUPS)[number]) {
    return group.items.some((item) =>
      item.href === '/dashboard' ? pathname === '/dashboard' : pathname?.startsWith(item.href)
    );
  }

  function toggleGroup(label: string) {
    setClosedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  return (
    <nav className="flex-1 px-3">
      {GROUPS.map((group, i) => {
        const isOpen = !group.label || !closedGroups.has(group.label) || isGroupActive(group);
        return (
          <div key={i}>
            {group.label && (
              <button
                type="button"
                onClick={() => toggleGroup(group.label!)}
                className="nav-section-label"
              >
                <span>{group.label}</span>
                <span className={`nav-section-chevron ${isOpen ? 'open' : ''}`}>▸</span>
              </button>
            )}
            {isOpen && (
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const isActive =
                    item.href === '/dashboard'
                      ? pathname === '/dashboard'
                      : pathname?.startsWith(item.href);
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
            )}
          </div>
        );
      })}
    </nav>
  );
}
