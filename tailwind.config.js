/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // RP-AI 디자인 시스템 참고 - 캔버스 그레이 바탕 + 비비드 핑크레드 포인트
        paper: '#F5F5F7',
        paperLine: '#F1F1F4',
        ink: '#1F2430',
        inkSoft: '#9CA3AF',
        accent: '#F5285C',
        accentBg: '#FFF1F4',
        profit: '#10B981',
        profitBg: '#ECFDF5',
        warn: '#F59E0B',
        warnBg: '#FFFBEB',
      },
      fontFamily: {
        display: [
          'Pretendard',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Apple SD Gothic Neo"',
          'sans-serif',
        ],
        body: [
          'Pretendard',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Apple SD Gothic Neo"',
          'sans-serif',
        ],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(31, 36, 48, 0.04)',
        glow: '0 4px 10px -2px rgba(245, 40, 92, 0.35)',
      },
    },
  },
  plugins: [],
};
