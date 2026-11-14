'use client';

// 작은 썸네일에 마우스를 올리면(모바일은 눌러서) 큰 사진이 옆에 떠서 보이는 이미지.
// 쿠팡 썸네일 주소의 크기 부분(…/thumbnails/remote/230x230ex/…)만 큰 크기로 바꿔서 불러오고,
// 주소 모양이 다르면 원래 주소를 그대로 확대해 보여준다. 큰 사진은 올릴 때 처음 불러온다(lazy).

function normalizeSrc(src: string): string {
  let s = src.trim();
  if (s.startsWith('//')) s = `https:${s}`;
  if (s.startsWith('http://')) s = `https://${s.slice(7)}`;
  return s;
}

function enlarge(src: string): string {
  return src.replace(/\/thumbnails\/remote\/\d+x\d+ex\//, '/thumbnails/remote/492x492ex/');
}

export default function HoverZoomImage({
  src,
  alt,
  size = 40,
  zoom = 260,
}: {
  src: string | null | undefined;
  alt: string;
  size?: number; // 작은 사진 한 변(px)
  zoom?: number; // 확대 사진 한 변(px)
}) {
  if (!src) {
    return <div className="rounded shrink-0 bg-paperLine" style={{ width: size, height: size }} />;
  }
  const small = normalizeSrc(src);
  const big = enlarge(small);
  return (
    <span className="relative group inline-block shrink-0 align-top" style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={small}
        alt={alt}
        className="rounded object-cover bg-paperLine cursor-zoom-in"
        style={{ width: size, height: size }}
      />
      {/* 좁은 화면에선 아래로, 넓은 화면에선 오른쪽으로 띄운다 */}
      <span className="pointer-events-none hidden group-hover:block group-focus-within:block absolute z-50 left-0 top-full mt-1 sm:left-full sm:top-0 sm:mt-0 sm:ml-2 rounded-md bg-white p-1 shadow-xl ring-1 ring-paperLine">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={big}
          alt={alt}
          loading="lazy"
          className="rounded object-contain bg-white"
          style={{ width: zoom, height: zoom, maxWidth: 'none' }}
        />
      </span>
    </span>
  );
}
