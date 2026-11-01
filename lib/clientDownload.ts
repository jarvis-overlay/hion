// 브라우저에서 이미지를 새 창 없이 바로 내려받는 도구 (여러 장은 ZIP 한 파일로).
// <a download target="_blank">는 다른 주소의 파일이면 download 속성이 무시돼 새 창이 뜨고 느리다 -
// 그래서 파일을 fetch로 받아서 blob 주소로 저장한다.
import { createZip } from '@/lib/zip';

export async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`이미지를 받지 못했어요 (HTTP ${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// 파일 이름에 못 쓰는 글자를 바꾼다
export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || '이미지';
}

export async function downloadImage(url: string, fileName: string): Promise<void> {
  const bytes = await fetchBytes(url);
  triggerDownload(new Blob([bytes as BlobPart], { type: 'image/jpeg' }), fileName);
}

// 여러 장을 최대 4장씩 동시에 받아 ZIP 하나로 저장한다. 일부가 실패해도 받은 것만 담고 실패 목록을 돌려준다.
export async function downloadImagesZip(
  files: { url: string; name: string }[],
  zipName: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ ok: number; failed: string[] }> {
  const results: ({ name: string; data: Uint8Array } | null)[] = new Array(files.length).fill(null);
  const failed: string[] = [];
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < files.length) {
      const i = next++;
      try {
        results[i] = { name: files[i].name, data: await fetchBytes(files[i].url) };
      } catch {
        failed.push(files[i].name);
      }
      onProgress?.(++done, files.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, worker));
  const entries = results.filter((r): r is { name: string; data: Uint8Array } => !!r);
  if (entries.length === 0) throw new Error('이미지를 하나도 받지 못했어요. 잠시 후 다시 시도해주세요.');
  triggerDownload(new Blob([createZip(entries) as BlobPart], { type: 'application/zip' }), zipName);
  return { ok: entries.length, failed };
}
