import { createClient } from '@/lib/supabase/server';
import DetailPageStudio from '@/components/DetailPageStudio';

// Gemini 이미지 생성 1회 호출이 꽤 걸릴 수 있어서(수십 초) 기본
// 타임아웃보다 넉넉하게 잡음.
export const maxDuration = 120;

export default async function DetailPagesPage() {
  const supabase = createClient();
  let { data: projects, error } = await supabase
    .from('detail_page_projects')
    .select('*, detail_page_sections(*)')
    .order('created_at', { ascending: false });

  if (error) {
    const fallback = await supabase
      .from('detail_page_projects')
      .select('*')
      .order('created_at', { ascending: false });
    projects = (fallback.data as any) || [];
  }

  return (
    <div className="max-w-5xl">
      <h1 className="font-display text-2xl font-bold mb-1">상세페이지 제작</h1>
      <p className="text-sm text-inkSoft mb-6">
        상품 이미지와 문구(키워드·분위기·설명)를 섹션 단위로 넣으면, AI가 섹션마다 쿠팡 상세페이지 한
        장면씩 만들어줘요. 이미지 없이 문구만 넣으면 상황에 맞는 이미지를 새로 생성해요.
      </p>
      <DetailPageStudio projects={projects || []} />
    </div>
  );
}
