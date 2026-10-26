import { createClient } from '@/lib/supabase/server';
import AiRecommendation from '@/components/AiRecommendation';

// 상품 추천 단계에서 쿠팡/알리바바를 실시간으로 여러 번 조회하느라
// 기본 서버리스 타임아웃을 넘길 수 있다. 600/800으로 올려 배포해봤더니
// 플랜 한도(300초) 초과로 배포 자체가 거부됐다 - 이 값을 더 못 올리므로
// 아래 알리바바 재시도 제거 등으로 파이프라인 최악 소요 시간을 줄여서
// 300초 안에 맞추는 쪽으로 대응함.
export const maxDuration = 300;

export default async function TrendsPage() {
  const supabase = createClient();
  // "조건 모드"에서 매번 다시 입력 안 해도 되게 저장해둔 제외 카테고리
  // 목록 (마이그레이션 전이면 빈 배열 - 조건 모드 자체는 그대로 쓸 수
  // 있고 저장된 제외 목록만 비어있게 됨).
  const { data: excludedCategories } = await supabase
    .from('sourcing_excluded_categories')
    .select('*')
    .order('created_at', { ascending: true });

  return (
    <div>
      <h1 className="font-display text-2xl font-bold mb-1">AI 소싱 추천</h1>
      <p className="text-sm text-inkSoft mb-6">
        지금 소싱하기 좋은 아이템을 찾아봐요.
      </p>

      <AiRecommendation excludedCategories={excludedCategories || []} />
    </div>
  );
}
