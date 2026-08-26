/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // 미니멀 + 자연스러운 톤 - 순백/순검정 대신 부드러운 오프화이트/
        // 웜그레이, 채도 낮춘 인디고 포인트
        paper: '#FAFAF9',
        paperLine: '#E7E5E2',
        ink: '#20201E',
        inkSoft: '#75726C',
        accent: '#4759A8',
        accentBg: '#EEF0FA',
        profit: '#3A8B5E',
        profitBg: '#EAF5EE',
        warn: '#C15B3D',
        warnBg: '#FBEEE8',
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
        card: '0 1px 2px rgba(32, 32, 30, 0.03), 0 4px 14px -6px rgba(32, 32, 30, 0.07)',
      },
    },
  },
  plugins: [],
};
