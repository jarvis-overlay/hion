import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'HION HUB',
  description: 'HION SYSTEM',
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
