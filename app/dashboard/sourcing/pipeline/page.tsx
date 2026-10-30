import { createClient } from '@/lib/supabase/server';
import PipelineList from '@/components/PipelineList';

export default async function PipelinePage() {
  const supabase = createClient();

  const { data: candidates } = await supabase
    .from('pipeline_candidates')
    .select('*')
    .order('created_at', { ascending: false });

  // 메모(item_notes)는 소싱리스트와 같은 폴리모픽 테이블을 공유한다 -
  // entity_type='pipeline_candidate'로 구분해서 같은 메모 UI/알림을
  // 그대로 재사용한다.
  const { data: notes } = await supabase
    .from('item_notes')
    .select('*')
    .eq('entity_type', 'pipeline_candidate')
    .order('created_at', { ascending: false });

  const { data: noteCategories } = await supabase
    .from('item_note_categories')
    .select('*')
    .order('position', { ascending: true });

  // AI 소싱추천(트렌드 탭)에서 실데이터로 검증되어 자동으로 적재된, 아직
  // 자동소싱에 담지 않은 후보 - 탭을 옮기지 않고 여기서 바로 타이핑 없이
  // 담을 수 있게 한다.
  const { data: recommendations } = await supabase
    .from('ai_product_recommendations')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30);

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl font-bold mb-1">자동소싱</h1>
      <p className="text-sm text-inkSoft mb-5">
        쿠팡 서치 → 1688 탐색 → 발주협의 → 이미지제작 → 등록까지, 아직 소싱리스트에 올릴지 확정 안 된
        탐색 중인 후보를 여기서 따로 관리해요. 발주까지 확정되면 "소싱리스트로 전환"으로 넘겨요.
      </p>
      <PipelineList
        candidates={candidates || []}
        notes={notes || []}
        noteCategories={noteCategories || []}
        recommendations={recommendations || []}
      />
    </div>
  );
}
