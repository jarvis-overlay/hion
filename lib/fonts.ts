// 서버에서 한글을 그릴 때 쓰는 폰트 등록. sharp의 SVG 텍스트는 시스템 폰트에 의존해서 Vercel에서는
// 한글이 빈 네모로 나오므로, node-canvas에 폰트 파일을 직접 등록해서 쓴다 (웹 화면과 같은 Pretendard).
import { registerFont } from 'canvas';
import path from 'path';

export const FONT_BOLD = 'PretendardBold';
export const FONT_EXTRABOLD = 'PretendardExtraBold';
let fontRegistered = false;
export function ensureKoreanFontRegistered() {
  if (fontRegistered) return;
  registerFont(path.join(process.cwd(), 'assets/fonts/Pretendard-Bold.otf'), { family: FONT_BOLD });
  registerFont(path.join(process.cwd(), 'assets/fonts/Pretendard-ExtraBold.otf'), { family: FONT_EXTRABOLD });
  fontRegistered = true;
}
