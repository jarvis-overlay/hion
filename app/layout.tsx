import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'HION HUB',
  description: '마진 계산 · 소싱 · 재고 관리',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="font-body min-h-screen">{children}</body>
    </html>
  );
}
