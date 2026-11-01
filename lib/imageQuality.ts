// 사진에 "보여줄 내용"이 남아 있는지 픽셀로 직접 검사한다 (AI 판단이 아닌 결정적 검사).
//
// 글자·그림 위주 이미지에서 글자를 지우면 흰 바탕에 가는 선만 남는 일이 있다. 이런 사진을 상세페이지
// 배경으로 쓰면 빈 화면이 나오고, AI 검사도 "식별 불가"라 판정 근거가 없다. 그래서 내용이 거의 없는
// 사진은 쓰지 않는다. 검사가 실패하면 막지 않고 "내용 있음"으로 본다 (에러가 나면 안 되므로).
import sharp from 'sharp';

const SIZE = 96;
const LIGHT_BG_MEDIAN = 225; // 중앙값 밝기가 이보다 밝으면 흰 바탕 사진
const MIN_CONTENT_RATIO = 0.05; // 바탕과 다른 픽셀이 이 비율보다 적으면 빈 사진
const FLAT_STDDEV = 0.5; // 밝기 표준편차가 이보다 작으면 완전 단색 사진 (질감 있는 어두운 원단 확대 사진은 막지 않도록 아주 낮게)

export interface ContentStats {
  contentRatio: number; // 바탕과 눈에 띄게 다른 픽셀 비율 (0~1)
  median: number; // 밝기 중앙값 (0~255)
  stddev: number; // 밝기 표준편차
  blank: boolean;
}

export async function measureContent(buffer: Buffer): Promise<ContentStats | null> {
  try {
    const { data } = await sharp(buffer)
      .flatten({ background: '#ffffff' })
      .resize(SIZE, SIZE, { fit: 'inside' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const n = data.length;
    if (n === 0) return null;
    const sorted = Uint8Array.from(data).sort();
    const median = sorted[Math.floor(n / 2)];
    let sum = 0;
    for (let i = 0; i < n; i++) sum += data[i];
    const mean = sum / n;
    let varSum = 0;
    let differing = 0;
    for (let i = 0; i < n; i++) {
      varSum += (data[i] - mean) ** 2;
      if (Math.abs(data[i] - median) > 25) differing++;
    }
    const stddev = Math.sqrt(varSum / n);
    const contentRatio = differing / n;
    const blank = stddev < FLAT_STDDEV || (median >= LIGHT_BG_MEDIAN && contentRatio < MIN_CONTENT_RATIO);
    return { contentRatio, median, stddev, blank };
  } catch {
    return null;
  }
}

// 검사를 못 하면 false (막지 않는다)
export async function isMostlyBlank(buffer: Buffer): Promise<boolean> {
  const s = await measureContent(buffer);
  return !!s && s.blank;
}
