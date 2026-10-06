// 서버 액션으로 보내기 전에 브라우저에서 사진을 줄인다 - Vercel은 요청 본문을
// 약 4.5MB까지만 받아서, 휴대폰 원본 사진은 그대로 보내면 요청 자체가 거절된다.
const SKIP_UNDER_BYTES = 1_500_000;

export async function shrinkImageForUpload(file: File, maxSide = 2000, quality = 0.9): Promise<File> {
  if (!file.type.startsWith('image/') || file.size < SKIP_UNDER_BYTES) return file;

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
}
