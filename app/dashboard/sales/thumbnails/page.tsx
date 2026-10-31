import { createClient } from '@/lib/supabase/server';
import ThumbnailStudio from '@/components/ThumbnailStudio';

// remove.bg + (선택) Gemini 효과 적용까지 이어질 수 있어서 기본
// 타임아웃보다 넉넉하게 잡음 (상세페이지 제작과 동일한 이유). URL 하나로
// 메인+추가이미지 최대 8장을 순차 생성하는 일괄 생성 기능이 추가되어
// 소싱추천/경쟁사비교와 같은 수준(280초)으로 늘림.
export const maxDuration = 280;

export default async function ThumbnailsPage() {
  const supabase = createClient();
  let { data: projects, error } = await supabase
    .from('thumbnail_projects')
    .select('*, thumbnail_images(*)')
    .order('created_at', { ascending: false });

  if (error) {
    const fallback = await supabase
      .from('thumbnail_projects')
      .select('*')
      .order('created_at', { ascending: false });
    projects = (fallback.data as any) || [];
  }

  // 학습해둔 카테고리별 인기상품 스타일 - 마이그레이션(category_style_briefs)을 아직
  // 안 돌렸으면 조회가 실패하니 빈 값으로 두고 화면은 그대로 동작하게 한다.
  const styleBriefs: Record<string, any> = {};
  const { data: briefRows } = await supabase.from('category_style_briefs').select('*');
  for (const row of briefRows || []) styleBriefs[row.category] = row;

  return (
    <div className="max-w-6xl">
      <h1 className="font-display text-2xl font-bold mb-1">썸네일 제작</h1>
      <p className="text-sm text-inkSoft mb-6">
        상품 사진을 올리면 1000x1000 썸네일을 만들어줘요. 검색결과에 노출되는 대표 이미지인 "메인 썸네일"은
        흰 배경 상품 사진으로, 상세 갤러리에 들어가는 "추가 이미지"는 카테고리를 설정하면 쿠팡 인기상품을
        분석한 스타일로 만들어요.
      </p>
      <ThumbnailStudio projects={projects || []} styleBriefs={styleBriefs} />
    </div>
  );
}
