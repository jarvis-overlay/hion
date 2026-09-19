import { createClient } from '@/lib/supabase/server';
import ThumbnailStudio from '@/components/ThumbnailStudio';

// remove.bg + (선택) Gemini 효과 적용까지 이어질 수 있어서 기본
// 타임아웃보다 넉넉하게 잡음 (상세페이지 제작과 동일한 이유).
export const maxDuration = 120;

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

  return (
    <div className="max-w-6xl">
      <h1 className="font-display text-2xl font-bold mb-1">썸네일 제작</h1>
      <p className="text-sm text-inkSoft mb-6">
        상품 사진을 올리면 누끼를 따서 1000x1000 흰 배경 썸네일로 만들어줘요. 검색결과에 노출되는 대표
        이미지인 "메인 썸네일"과, 상세 갤러리에 들어가는 "추가 이미지"를 구분해서 관리해요.
      </p>
      <ThumbnailStudio projects={projects || []} />
    </div>
  );
}
