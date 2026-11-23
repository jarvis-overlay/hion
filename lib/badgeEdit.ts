// 패키지 메인의 수량 배지("5P")를 말로 고치는 요청을 알아듣는 순수 모듈 (sharp/canvas 없음).
// 배지는 AI가 아니라 코드(node-canvas)로 그린 요소라서, "크기 키워줘 / 왼쪽 위로 / 빨간색으로 / 없애줘"
// 같은 요청은 완성된 이미지를 AI에게 다시 그리게 하지 않고(숫자·상품이 틀어짐) 설정값을 바꿔서 다시 합성한다.
import { normBadgeColor, normBadgeShape, type BadgeColor, type BadgeShape } from './packageTemplates';

export type BadgeUnit = 'P' | '개' | 'x';
export type BadgeCorner = 'auto' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

export interface BadgeSpec {
  enabled: boolean;
  shape: BadgeShape;
  color: BadgeColor;
  scale: number; // 기본 크기 대비 배율
  corner: BadgeCorner;
  unit: BadgeUnit;
}

export const BADGE_SCALE_MIN = 0.6;
export const BADGE_SCALE_MAX = 2.4;

export const DEFAULT_BADGE_SPEC: BadgeSpec = {
  enabled: true,
  shape: 'circle',
  color: 'white',
  scale: 1,
  corner: 'auto',
  unit: '개', // 쿠팡 광고 가이드의 수량 뱃지 예시("2개", "x3", "1 set")와 같은 표기
};

const CORNERS: BadgeCorner[] = ['auto', 'bottom-right', 'bottom-left', 'top-right', 'top-left'];

// DB의 style_spec({ badge: {...} })에서 설정을 읽는다. 없거나 이상하면 기본값.
export function readBadgeSpec(styleSpec: unknown): BadgeSpec {
  const b = (styleSpec as any)?.badge;
  const scale = Number(b?.scale);
  return {
    enabled: b?.enabled !== false,
    shape: normBadgeShape(b?.shape),
    color: normBadgeColor(b?.color),
    scale: Number.isFinite(scale) ? Math.max(BADGE_SCALE_MIN, Math.min(BADGE_SCALE_MAX, scale)) : 1,
    corner: CORNERS.includes(b?.corner) ? b.corner : 'auto',
    unit: b?.unit === 'P' || b?.unit === 'x' ? b.unit : '개',
  };
}

// 패키지 메인 라벨("패키지 블랙 1 + 다크그레이 1 반전 배지")에서 총 수량·반전·배지 여부를 되읽는다.
// (예전에 만든 이미지는 배지 설정이 저장돼 있지 않아서 라벨로 짐작한다)
export function parsePackageLabel(label: string | null | undefined): { isPackage: boolean; total: number; flip: boolean; badge: boolean } {
  const l = String(label || '');
  if (!l.startsWith('패키지 ')) return { isPackage: false, total: 0, flip: false, badge: false };
  const badge = /\s배지$/.test(l);
  const flip = /\s반전(\s배지)?$/.test(l);
  const body = l.slice('패키지 '.length);
  let total = 0;
  for (const part of body.split(' + ')) {
    const q = part.match(/\s(\d+)(?:\s|$)/); // 색상 이름 뒤의 수량 (뒤에 붙은 배치 이름/반전/배지 글자는 숫자가 아님)
    const n = Number(q?.[1]);
    if (Number.isFinite(n)) total += n;
  }
  return { isPackage: true, total, flip, badge };
}

const COLOR_WORDS: [RegExp, BadgeColor][] = [
  [/(흰|하얀|화이트|하양)/, 'white'],
  [/(빨강|빨간|레드)/, 'red'],
  [/(남색|네이비)/, 'navy'],
  [/(검정|검은|블랙)/, 'black'],
  [/(다크\s*그레이|회색|그레이)/, 'darkgray'],
  [/(초록|녹색|그린)/, 'green'],
  [/(주황|오렌지)/, 'orange'],
  [/(파랑|파란|블루)/, 'blue'],
  [/(보라|퍼플)/, 'purple'],
];

export interface BadgeEditResult {
  relevant: boolean; // 배지에 대한 요청으로 보이는가 (아니면 호출한 쪽이 다른 방식으로 처리)
  changed: boolean; // 바꿀 내용을 알아들었는가
  spec: BadgeSpec;
  summary: string[]; // 화면에 보여줄 "무엇을 바꿨는지"
}

export function parseBadgeEdit(prompt: string, current: BadgeSpec): BadgeEditResult {
  const t = String(prompt || '').replace(/\s+/g, ' ').trim();
  const strong = /(숫자|배지|뱃지|badge|표기|표시|\d+\s*[Pp](?![a-zA-Z]))/i.test(t);
  const weak = /수량/.test(t);
  const next: BadgeSpec = { ...current };
  const summary: string[] = [];

  if (/(없애|없이|지워|삭제|제거|빼\s*줘|빼줘|떼\s*줘|떼줘)/.test(t)) {
    next.enabled = false;
    summary.push('배지를 뺐어요');
  } else if (!current.enabled && /(다시|달아|붙여|추가|넣어|살려)/.test(t)) {
    next.enabled = true;
    summary.push('배지를 다시 달았어요');
  }

  if (next.enabled) {
    // 크기
    const mult = t.match(/(\d+(?:\.\d+)?)\s*배/);
    let factor = 1;
    if (mult) factor = Math.max(0.3, Math.min(4, parseFloat(mult[1])));
    else if (/(너무\s*작|더\s*크|크게|키워|키우|확대|커\s*지|잘\s*보이|잘보|눈에\s*(잘\s*)?띄|크기[를을]?\s*(좀|더)?\s*(올|높))/.test(t))
      factor = /(조금|살짝|약간)/.test(t) ? 1.2 : 1.45;
    else if (/(너무\s*크|작게|줄여|줄이|축소|작아지|작은\s*게\s*좋)/.test(t)) factor = 0.75;
    if (factor !== 1) {
      const scale = Math.max(BADGE_SCALE_MIN, Math.min(BADGE_SCALE_MAX, Math.round(current.scale * factor * 100) / 100));
      if (scale !== current.scale) {
        next.scale = scale;
        summary.push(factor > 1 ? '배지를 키웠어요' : '배지를 줄였어요');
      } else {
        summary.push(factor > 1 ? '배지가 이미 가장 큰 크기예요' : '배지가 이미 가장 작은 크기예요');
      }
    }

    // 위치
    const left = /(왼쪽|좌측|왼편)/.test(t);
    const right = /(오른쪽|우측|오른편)/.test(t);
    const top = /(위쪽|위로|위에|상단|맨\s*위|윗)/.test(t);
    const bottom = /(아래|하단|밑)/.test(t);
    if (left || right || top || bottom) {
      const cur = current.corner === 'auto' ? 'bottom-right' : current.corner;
      const h = left ? 'left' : right ? 'right' : cur.endsWith('left') ? 'left' : 'right';
      const v = top ? 'top' : bottom ? 'bottom' : cur.startsWith('top') ? 'top' : 'bottom';
      const corner = `${v}-${h}` as BadgeCorner;
      if (corner !== current.corner) {
        next.corner = corner;
        summary.push(`배지 위치를 ${v === 'top' ? '위' : '아래'} ${h === 'left' ? '왼쪽' : '오른쪽'}으로 옮겼어요`);
      }
    }

    // 색
    for (const [re, color] of COLOR_WORDS) {
      if (re.test(t)) {
        if (color !== 'white') {
          // 쿠팡 광고 이미지 가이드: 수량 뱃지는 흰 바탕 + 검은 외곽선·글자만 허용
          summary.push('쿠팡 규정상 수량 배지는 흰 바탕·검은 글자만 가능해서 색은 그대로 뒀어요');
        }
        break;
      }
    }

    // 모양
    const shape: BadgeShape | null = /(알약|타원)/.test(t) ? 'pill' : /(사각|네모)/.test(t) ? 'square' : /(동그라미|원형|둥글)/.test(t) ? 'circle' : null;
    if (shape && shape !== current.shape) {
      next.shape = shape;
      summary.push('배지 모양을 바꿨어요');
    }

    // 표기 단위
    const unit: BadgeUnit | null = /(개\s*(로|표기|단위)|P\s*대신\s*개|'개'|"개")/.test(t)
      ? '개'
      : /(x\s*\d|엑스\s*\d|x\s*표기)/i.test(t)
        ? 'x'
        : /(P\s*(로|표기)|개\s*대신\s*P)/.test(t)
          ? 'P'
          : null;
    if (unit && unit !== current.unit) {
      next.unit = unit;
      summary.push(`숫자 표기를 ${unit === 'P' ? '5P' : unit === '개' ? '5개' : 'x5'} 형태로 바꿨어요`);
    }
  }

  const changed = summary.length > 0;
  const relevant = strong || (weak && changed);
  return { relevant, changed, spec: next, summary };
}
