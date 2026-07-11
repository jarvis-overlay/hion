/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        paper: '#FAF7EF',
        paperLine: '#E4DECB',
        ink: '#23291F',
        inkSoft: '#6B6A5C',
        profit: '#2F6F4E',
        profitBg: '#E4EEE3',
        warn: '#B8862E',
        warnBg: '#F5EAD6',
      },
      fontFamily: {
        display: ['Fraunces', 'serif'],
        body: ['Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
};
