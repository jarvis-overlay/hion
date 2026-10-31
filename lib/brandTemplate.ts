// 상세페이지 "브랜드 템플릿" (순수 로직 - 화면과 서버가 같이 쓴다).
// 브랜드 템플릿은 마지막 내보내기 단계에서 적용된다:
//   - 색상(대표색/포인트색)으로 문구·표 장면을 다시 그린다 (applyColors)
//   - 맨 위 브랜드 머리글(로고 + 브랜드명 + 한 줄 소개), 맨 아래 바닥글(안내사항) 이미지를 붙인다
// 어떤 상세페이지든 같은 템플릿을 고를 수 있다 (프로젝트에 묶이지 않음).
export interface BrandTemplate {
  id: string; // 저장된 템플릿은 uuid, 기본 제공은 'builtin:...'
  name: string;
  brandName: string;
  tagline: string;
  logoUrl: string | null;
  primary: string; // #rrggbb
  accent: string; // #rrggbb
  applyColors: boolean;
  headerEnabled: boolean;
  footerEnabled: boolean;
  footerTitle: string;
  footerNotice: string; // 줄바꿈으로 구분
  builtIn?: boolean;
}

export const HEX_RE = /^#[0-9a-f]{6}$/i;

// 저장하지 않아도 바로 쓸 수 있는 색상 템플릿 (머리글/바닥글은 내용이 없어서 만들지 않는다)
export const BUILT_IN_BRANDS: BrandTemplate[] = [
  { id: 'builtin:mono', name: '모노 블랙 + 골드', primary: '#111111', accent: '#c9a25a' },
  { id: 'builtin:navy', name: '딥 네이비 + 오렌지', primary: '#14213d', accent: '#f08a24' },
  { id: 'builtin:forest', name: '포레스트 그린 + 민트', primary: '#1f3d36', accent: '#5cc4a0' },
  { id: 'builtin:plum', name: '플럼 퍼플 + 라벤더', primary: '#3b2461', accent: '#b79df0' },
].map((b) => ({
  ...b,
  brandName: '',
  tagline: '',
  logoUrl: null,
  applyColors: true,
  headerEnabled: false,
  footerEnabled: false,
  footerTitle: '안내사항',
  footerNotice: '',
  builtIn: true,
}));

export function rowToBrand(r: any): BrandTemplate {
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    brandName: String(r.brand_name ?? ''),
    tagline: String(r.tagline ?? ''),
    logoUrl: r.logo_url ? String(r.logo_url) : null,
    primary: HEX_RE.test(r.primary_color) ? r.primary_color : '#1c1c1c',
    accent: HEX_RE.test(r.accent_color) ? r.accent_color : '#7c4fd1',
    applyColors: r.apply_colors !== false,
    headerEnabled: r.header_enabled !== false,
    footerEnabled: r.footer_enabled !== false,
    footerTitle: String(r.footer_title ?? '안내사항'),
    footerNotice: String(r.footer_notice ?? ''),
  };
}

export interface BrandInput {
  name: string;
  brandName: string;
  tagline: string;
  primary: string;
  accent: string;
  applyColors: boolean;
  headerEnabled: boolean;
  footerEnabled: boolean;
  footerTitle: string;
  footerNotice: string;
}

// 입력값 검사/정리 (저장 전 서버에서 한 번 더 한다)
export function normalizeBrandInput(raw: Partial<Record<keyof BrandInput, unknown>>): { value: BrandInput | null; error: string | null } {
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r/g, '').trim().slice(0, max) : '');
  const name = str(raw.name, 30).replace(/\s+/g, ' ');
  if (!name) return { value: null, error: '템플릿 이름을 입력해주세요.' };
  const primary = str(raw.primary, 7).toLowerCase();
  const accent = str(raw.accent, 7).toLowerCase();
  if (!HEX_RE.test(primary) || !HEX_RE.test(accent)) return { value: null, error: '색상은 #rrggbb 형식이어야 해요.' };
  const notice = str(raw.footerNotice, 600)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((l) => l.slice(0, 120))
    .join('\n');
  return {
    value: {
      name,
      brandName: str(raw.brandName, 30).replace(/\s+/g, ' '),
      tagline: str(raw.tagline, 60).replace(/\s+/g, ' '),
      primary,
      accent,
      applyColors: raw.applyColors !== false,
      headerEnabled: raw.headerEnabled !== false,
      footerEnabled: raw.footerEnabled !== false,
      footerTitle: str(raw.footerTitle, 30) || '안내사항',
      footerNotice: notice,
    },
    error: null,
  };
}

// 내보내기에서 어떤 장면 이미지를 만들지 정하는 이름표 (ZIP 안 파일 이름 등)
export interface ExportItem {
  name: string; // 내려받을 파일 이름 (한글 가능)
  url: string;
  width: number;
  height: number;
}
