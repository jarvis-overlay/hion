/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // 한남동 유엔빌리지풍 - 웜 아이보리 바탕 + 브론즈/골드 포인트
        paper: '#FBF9F5',
        paperLine: '#E4DECE',
        ink: '#211D17',
        inkSoft: '#8A8071',
        accent: '#9C7A3C',
        accentBg: '#F1E9D6',
        profit: '#516B52',
        profitBg: '#E7ECE3',
        warn: '#A15A2C',
        warnBg: '#F3E7D8',
      },
      fontFamily: {
        display: ['"Noto Serif KR"', 'serif'],
        body: ['"Noto Sans KR"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(33, 29, 23, 0.04), 0 8px 24px -12px rgba(33, 29, 23, 0.12)',
      },
    },
  },
  plugins: [],
};
