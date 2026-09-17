import { createClient } from '@/lib/supabase/server';
import ImageWorkbench from '@/components/ImageWorkbench';

// Replicate 업스케일 폴링이 최대 90초까지 걸릴 수 있어서 기본
// 타임아웃보다 넉넉하게 잡음.
export const maxDuration = 120;

export default async function SalesImagesPage() {
  const supabase = createClient();
  let { data: items, error } = await supabase
    .from('sourcing_items')
    .select('id, title, sourcing_item_images(*)')
    .order('created_at', { ascending: false });

  if (error) {
    const fallback = await supabase
      .from('sourcing_items')
      .select('id, title')
      .order('created_at', { ascending: false });
    items = (fallback.data as any) || [];
  }

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl font-bold mb-1">상세페이지 이미지</h1>
      <p className="text-sm text-inkSoft mb-6">
        1688 원본 이미지를 올리면 중국어 번역, 배경 제거(누끼), 해상도 업스케일을 각각 처리해줘요.
      </p>
      <ImageWorkbench items={items || []} />
    </div>
  );
}
