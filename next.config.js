/** @type {import('next').NextConfig} */
const nextConfig = {
  // 상세페이지 제작 기능에서 쓰는 한글 폰트 파일(assets/fonts)이 Vercel
  // 서버리스 함수 번들에 자동으로 안 딸려가서(파일 트레이싱이 fs 직접
  // 접근은 못 잡아냄), 명시적으로 포함시킨다 - 안 하면 로컬에선 되고
  // 배포본에선 폰트를 못 찾아 텍스트가 깨진다(실측 확인).
  experimental: {
    outputFileTracingIncludes: {
      '/**': ['./assets/fonts/**'],
    },
  },
};

module.exports = nextConfig;
