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

  // 날짜 문자열은 서버에서 한 번만 만들어 넘긴다 - 브라우저가 같은 날짜를
  // 다시 계산하면 서버 HTML과 달라져서 하이드레이션 에러가 나므로.
  const projectsWithLabel = (projects || []).map((p: any) => ({
    ...p,
    created_label: new Date(p.created_at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }),
  }));

  return (
    <div className="max-w-6xl">
      <h1 className="font-display text-2xl font-bold mb-1">상세페이지 제작</h1>
      <p className="text-sm text-inkSoft mb-6">
        상품 이미지와 문구(키워드·분위기·설명)를 섹션 단위로 넣으면, AI가 섹션마다 쿠팡 상세페이지 한
        장면씩 만들어줘요. 이미지 없이 문구만 넣으면 상황에 맞는 이미지를 새로 생성해요.
      </p>
      <DetailPageStudio projects={projectsWithLabel} />
    </div>
  );
}
