// 쿠팡 조사 후보가 "내가 찾는 상품과 얼마나 같은가"를 0~100점으로 매기는 순수 함수
// (네트워크 없음, 클라이언트/서버 공용). 정렬(정확도순)과 후보별 점수 표시에 쓴다.
//
// 원칙
// - 내가 입력한 조건(재질/사이즈/색상)만 채점한다. 입력 안 한 항목은 점수에 영향 없음.
// - 확인된 일치는 높게, 확인된 불일치는 깎고, "모름"은 중간보다 낮게 둔다
//   → 확인된 후보가 위로, 확인 안 된 후보가 그 아래로, 다른 게 확인된 후보가 맨 아래로 간다.
// - 상품 페이지를 읽어서 확인한 결과(detail)가 있으면 상품명 추정보다 우선한다.
import { colorStatus, sizeStatus, type MatchStatus } from '@/lib/candidateFilter';

export type DimState = 'match' | 'mismatch' | 'unknown';

export interface ScoreInput {
  title: string;
  keyword: string;
  conditions: { material: string; size: string; color: string };
  // 서버가 상품명으로 판정한 재질 배지: 사전(확정) / AI 추정 / 없음
  materialBadge: 'dict' | 'ai' | null;
  // 상품 페이지를 읽은 결과(있을 때만)
  detail?: {
    materialVerdict: 'same' | 'different' | 'unknown';
    sizeStatus: MatchStatus;
    colorStatus: MatchStatus;
  } | null;
}

export interface ScoreResult {
  score: number; // 0~100
  material: DimState | null; // null = 내가 조건을 안 적음
  size: DimState | null;
  color: DimState | null;
  aiGuess: boolean; // 재질 판정이 AI 추정에 기대고 있는지
  inspected: boolean; // 상품 페이지를 읽어서 확인한 결과가 반영됐는지
}

// 조건별 가중치(합이 아니라 "입력한 조건끼리" 비율로 환산한다)
const W = { material: 40, size: 25, color: 15, keyword: 20 };
const UNKNOWN_CREDIT = 0.3;

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[,/·\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function credit(state: DimState, weak = false): number {
  if (state === 'match') return 1;
  if (state === 'unknown') return UNKNOWN_CREDIT;
  return weak ? -0.6 : -1; // AI 추정 불일치는 덜 깎는다(틀릴 수 있음)
}

export function scoreCandidate(input: ScoreInput): ScoreResult {
  const { title, keyword, conditions, materialBadge, detail } = input;
  const t = title.toLowerCase();

  let earned = 0;
  let max = 0;

  // 검색 키워드가 상품명에 얼마나 들어 있나(항상 채점)
  const kw = tokens(keyword);
  if (kw.length > 0) {
    const hit = kw.filter((k) => t.includes(k)).length;
    earned += W.keyword * (hit / kw.length);
    max += W.keyword;
  }

  // 재질
  let material: DimState | null = null;
  let aiGuess = false;
  const matTokens = tokens(conditions.material);
  if (matTokens.length > 0) {
    if (detail?.materialVerdict === 'same') material = 'match';
    else if (detail?.materialVerdict === 'different') material = 'mismatch';
    else if (matTokens.some((m) => t.includes(m))) material = 'match';
    else if (materialBadge === 'dict') material = 'mismatch';
    else if (materialBadge === 'ai') {
      material = 'mismatch';
      aiGuess = true;
    } else material = 'unknown';
    earned += W.material * credit(material, aiGuess);
    max += W.material;
  }

  // 사이즈
  let size: DimState | null = null;
  if (conditions.size.trim()) {
    const fromTitle = sizeStatus(conditions.size, title);
    size = detail && detail.sizeStatus !== 'unknown' ? detail.sizeStatus : fromTitle;
    earned += W.size * credit(size);
    max += W.size;
  }

  // 색상
  let color: DimState | null = null;
  if (conditions.color.trim()) {
    const fromTitle = colorStatus(conditions.color, title).status;
    color = detail && detail.colorStatus !== 'unknown' ? detail.colorStatus : fromTitle;
    earned += W.color * credit(color);
    max += W.color;
  }

  const raw = max > 0 ? (earned / max) * 100 : 0;
  return {
    score: Math.max(0, Math.min(100, Math.round(raw))),
    material,
    size,
    color,
    aiGuess,
    inspected: !!detail,
  };
}
