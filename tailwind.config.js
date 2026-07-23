/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        paper: '#FFFFFF',
        paperLine: '#E5E7EB',
        ink: '#14171F',
        inkSoft: '#6B7280',
        accent: '#2F5DE3',
        accentBg: '#EAF0FE',
        profit: '#16A34A',
        profitBg: '#DCFCE7',
        warn: '#D97706',
        warnBg: '#FEF3C7',
      },
      fontFamily: {
        display: ['"Noto Sans KR"', 'sans-serif'],
        body: ['"Noto Sans KR"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
};
