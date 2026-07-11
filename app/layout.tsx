import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '소싱 허브',
  description: '소싱 정보 공유 & 일정 관리',
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
