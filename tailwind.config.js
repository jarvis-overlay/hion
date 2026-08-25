/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // 무신사풍 - 화이트 바탕 + 블랙 텍스트 + 블루 포인트 (클린한 미니멀)
        paper: '#FFFFFF',
        paperLine: '#E5E5E5',
        ink: '#111111',
        inkSoft: '#767676',
        accent: '#1B5FFF',
        accentBg: '#EEF3FF',
        profit: '#1AA260',
        profitBg: '#EAFBF1',
        warn: '#E02020',
        warnBg: '#FDEDED',
      },
      fontFamily: {
        display: ['"Noto Sans KR"', 'sans-serif'],
        body: ['"Noto Sans KR"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(0, 0, 0, 0.03), 0 4px 12px -6px rgba(0, 0, 0, 0.06)',
      },
    },
  },
  plugins: [],
};
