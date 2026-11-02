// 상세페이지 문구 안전장치 (순수 함수 - 서버/클라이언트 어디서나 쓸 수 있다)
// AI 카피가 상품 정보에 없는 소재·원산지를 지어내는 걸 코드에서 걸러낸다.
//  - 소재(면·실크·울 …): 상품명/사진 문구/사용자 입력 어디에도 없으면 문구에서 뺀다
//  - 원산지 지명(신장·Xinjiang 등): 근거가 있어도 쓰지 않는다 (원산지·노동 이슈로 분쟁 소지)
//  - 소재 함량 단정(100%): 사용자가 입력한 근거에 같은 표기가 없으면 뺀다

interface MaterialFamily {
  name: string;
  claim: RegExp; // 문구에서 이 소재를 말하는 표현
  evidence: RegExp; // 근거 글(상품명·사진 문구·입력)에서 이 소재를 뒷받침하는 표현
}

const FAMILIES: MaterialFamily[] = [
  { name: '면', claim: /순면|면\s?소재|면\s?직|면\s?혼방|면\s?\d|\d\s?%\s?면|고급\s?면|코튼|cotton/i, evidence: /(?<![가-힣])면(?![가-힣])|순면|면\s?\d|\d\s?%\s?면|면\s?소재|면\s?혼방|코튼|cotton|棉/i },
  { name: '실크', claim: /실크|비단|silk/i, evidence: /실크|비단|silk|丝绸|真丝/i },
  { name: '울', claim: /울\s?소재|울\s?혼방|양모|(?<![가-힣])울(?![가-힣])|wool|캐시미어|cashmere/i, evidence: /울|양모|wool|캐시미어|cashmere|羊毛|羊绒/i },
  { name: '린넨', claim: /린넨|리넨|linen|마\s?소재/i, evidence: /린넨|리넨|linen|麻/i },
  { name: '가죽', claim: /가죽|레더|leather/i, evidence: /가죽|레더|leather|皮/i },
  { name: '모달/텐셀', claim: /모달|텐셀|tencel|modal/i, evidence: /모달|텐셀|tencel|modal|莫代尔|天丝/i },
  { name: '나일론', claim: /나일론|nylon/i, evidence: /나일론|nylon|尼龙|锦纶/i },
  { name: '스판덱스', claim: /스판|spandex|elastane|라이크라/i, evidence: /스판|spandex|elastane|라이크라|氨纶|弹力|신축/i },
];

// 원산지 지명 - 근거가 있어도 쓰지 않는다
const ORIGIN_RE = /신장|新疆|xinjiang|shinjang|신쟝/i;

// 함량 단정(100%) - "면 100%"처럼 소재와 붙은 것
const PURE_CLAIM_RE = /(100\s?%\s?[가-힣A-Za-z]{1,6}|[가-힣A-Za-z]{1,6}\s?100\s?%)/;

export interface CopyIssue {
  kind: 'material' | 'origin' | 'purity';
  text: string;
}

// text 안에서 근거 없는 주장을 찾는다. evidence는 상품명·사진 문구·사용자 입력을 이어붙인 글.
export function findUnsupportedClaims(text: string, evidence: string): CopyIssue[] {
  const t = String(text || '');
  if (!t.trim()) return [];
  const ev = String(evidence || '');
  const out: CopyIssue[] = [];
  const m0 = t.match(ORIGIN_RE);
  if (m0) out.push({ kind: 'origin', text: m0[0] });
  for (const f of FAMILIES) {
    const m = t.match(f.claim);
    if (m && !f.evidence.test(ev)) out.push({ kind: 'material', text: m[0].trim() });
  }
  // "OO 100%"는 근거 글에 같은 100%가 있을 때만 허용
  const p = t.match(PURE_CLAIM_RE);
  if (p && !/100\s?%/.test(ev)) out.push({ kind: 'purity', text: p[0].trim() });
  return out;
}

// 한 칸의 문구를 검사해 문제가 있으면 비운다 (고쳐 쓰지 않는다 - 비워 두는 게 안전).
export function guardCopyText(text: string, evidence: string): { text: string; issues: CopyIssue[] } {
  const issues = findUnsupportedClaims(text, evidence);
  return { text: issues.length > 0 ? '' : text, issues };
}

// 여러 줄(목록) 문구: 문제 있는 줄만 뺀다
export function guardCopyLines(text: string, evidence: string): { text: string; issues: CopyIssue[] } {
  const issues: CopyIssue[] = [];
  const kept = String(text || '')
    .split(/\r?\n/)
    .filter((l) => {
      const r = findUnsupportedClaims(l, evidence);
      issues.push(...r);
      return r.length === 0;
    })
    .join('\n');
  return { text: kept, issues };
}

export function describeIssues(issues: CopyIssue[]): string {
  return Array.from(new Set(issues.map((i) => `${i.text}(${i.kind === 'origin' ? '원산지' : i.kind === 'purity' ? '함량 단정' : '근거 없는 소재'})`))).join(', ');
}
