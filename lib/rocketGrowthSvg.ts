// 로켓그로스 사이즈 유형·요금 기준표를 "이미지(SVG)"로 그린다 (순수 함수 - 화면에서 <img>로 보여주고 PNG로 저장할 수 있다).
import { RG_SIZES, rgFeeFor, type RgFeeTable, type RgSizeId } from '@/lib/rocketGrowth';

const W = 920;
const LABEL_W = 170;
const COL_W = (W - LABEL_W - 20) / 6;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
const won = (n: number) => n.toLocaleString('ko-KR') + '원';

// 사이즈 구간 문구: 극소형 "~80cm이하", 나머지 "80cm초과 ~100cm이하"
function rangeText(i: number, key: 'maxSumCm' | 'maxKg', unit: string): string[] {
  const hi = RG_SIZES[i][key];
  if (i === 0) return [`~${hi}${unit}이하`];
  return [`${RG_SIZES[i - 1][key]}${unit}초과`, `~${hi}${unit}이하`];
}

// 한 줄에 대략 52자(한글 기준)씩 끊는다
function wrapNote(text: string): string[] {
  const lines: string[] = [];
  let rest = '• ' + text;
  while (rest.length > 52) {
    lines.push(rest.slice(0, 52));
    rest = '   ' + rest.slice(52);
  }
  lines.push(rest);
  return lines;
}

export function rgTableSvg(table: RgFeeTable, highlight: RgSizeId | null, feeNote: string): string {
  const FONT = "'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif";
  const rowH = [46, 54, 54, 40, 40, 44]; // 헤더, 가로+세로+높이, 무게, 입출고비, 배송비, 합계
  const top = 64;
  const ys: number[] = [];
  let acc = top;
  for (const h of rowH) {
    ys.push(acc);
    acc += h;
  }
  const tableBottom = acc;
  const noteY = tableBottom + 26;
  const noteLines = 4 + wrapNote(feeNote).length;
  const H = noteY + noteLines * 20 + 8;
  const colX = (i: number) => 10 + LABEL_W + i * COL_W;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`);
  out.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  out.push(`<text x="12" y="34" font-size="22" font-weight="700" fill="#111">로켓그로스 사이즈 유형 · 입출고/배송 요금</text>`);
  out.push(`<text x="12" y="54" font-size="12" fill="#666">개별 포장 상품 기준 · 세 변의 합과 무게 중 큰 쪽이 사이즈 유형</text>`);

  // 가로 줄 배경 + 선
  const rowLabels = ['사이즈 유형', '가로+세로+높이(cm)', '무게(kg)', '입출고비 (개당)', '배송비 (개당)', '입출고+배송 합계'];
  for (let r = 0; r < rowH.length; r++) {
    const y = ys[r];
    const fill = r === 0 ? '#eeeeee' : r === 5 ? '#f3f7ff' : '#ffffff';
    out.push(`<rect x="10" y="${y}" width="${W - 20}" height="${rowH[r]}" fill="${fill}" stroke="#d6d6d6"/>`);
    out.push(`<text x="${10 + LABEL_W / 2}" y="${y + rowH[r] / 2 + 5}" font-size="13" font-weight="700" fill="#333" text-anchor="middle">${esc(rowLabels[r])}</text>`);
  }
  // 현재 사이즈 열 강조
  const hi = highlight ? RG_SIZES.findIndex((s) => s.id === highlight) : -1;
  if (hi >= 0) {
    out.push(`<rect x="${colX(hi)}" y="${top}" width="${COL_W}" height="${tableBottom - top}" fill="none" stroke="#e11d48" stroke-width="3"/>`);
  }
  // 세로 줄
  out.push(`<line x1="${10 + LABEL_W}" y1="${top}" x2="${10 + LABEL_W}" y2="${tableBottom}" stroke="#d6d6d6"/>`);
  for (let i = 1; i < 6; i++) out.push(`<line x1="${colX(i)}" y1="${top}" x2="${colX(i)}" y2="${tableBottom}" stroke="#e4e4e4"/>`);

  RG_SIZES.forEach((s, i) => {
    const cx = colX(i) + COL_W / 2;
    const active = i === hi;
    out.push(`<text x="${cx}" y="${ys[0] + 29}" font-size="15" font-weight="700" fill="${active ? '#e11d48' : '#222'}" text-anchor="middle">${esc(s.name)}</text>`);
    const sum = rangeText(i, 'maxSumCm', 'cm');
    sum.forEach((t, k) => out.push(`<text x="${cx}" y="${ys[1] + (sum.length === 1 ? 31 : 23 + k * 17)}" font-size="12" fill="#333" text-anchor="middle">${esc(t)}</text>`));
    const kg = rangeText(i, 'maxKg', 'kg');
    kg.forEach((t, k) => out.push(`<text x="${cx}" y="${ys[2] + (kg.length === 1 ? 31 : 23 + k * 17)}" font-size="12" fill="#333" text-anchor="middle">${esc(t)}</text>`));
    const row = table.fees[s.id];
    out.push(`<text x="${cx}" y="${ys[3] + 25}" font-size="13" fill="#222" text-anchor="middle">${esc(won(row.inout))}</text>`);
    out.push(`<text x="${cx}" y="${ys[4] + 25}" font-size="13" fill="#222" text-anchor="middle">${esc(won(row.delivery))}</text>`);
    out.push(`<text x="${cx}" y="${ys[5] + 28}" font-size="14" font-weight="700" fill="${active ? '#e11d48' : '#1d4ed8'}" text-anchor="middle">${esc(won(rgFeeFor(s.id, table) ?? 0))}</text>`);
  });

  // 긴 안내는 이미지 폭에 맞게 줄을 나눠서 그린다 (SVG는 자동 줄바꿈이 없다)
  const notes = [
    '• 세 변의 합과 무게를 모두 충족해야 해당 유형이에요. 둘 중 하나라도 초과하면',
    '   상위 사이즈로 분류돼요 (예: 세 변의 합은 극소형, 무게는 소형 → 소형).',
    '• 특대형(세 변의 합 250cm·30kg)보다 큰 상품은 입고가 불가능해요.',
    '   최초 입고 시 물류센터가 측정한 값으로 최종 유형이 정해져요.',
    ...wrapNote(feeNote),
  ];
  notes.forEach((t, i) => out.push(`<text x="12" y="${noteY + i * 20}" font-size="12" fill="#555">${esc(t)}</text>`));
  out.push('</svg>');
  return out.join('');
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
