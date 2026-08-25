import AiRecommendation from '@/components/AiRecommendation';
import TrendForm from '@/components/TrendForm';

export default function TrendsPage() {
  return (
    <div>
      <h1 className="font-display text-2xl font-bold mb-1">트렌드 발굴</h1>
      <p className="text-sm text-inkSoft mb-6">
        지금 소싱하기 좋은 아이템을 찾아봐요.
      </p>

      <AiRecommendation />

      <details className="mt-8 group">
        <summary className="cursor-pointer text-sm font-semibold text-inkSoft hover:text-ink list-none flex items-center gap-1">
          <span className="transition-transform group-open:rotate-90">▸</span>
          직접 키워드/카테고리 비교하기
        </summary>
        <div className="mt-4">
          <p className="text-sm text-inkSoft mb-5">
            네이버 데이터랩으로 후보 아이템/카테고리의 검색·쇼핑 클릭 추이를
            직접 비교해볼 수도 있어요. 절대적인 판매량이 아니라 기간 내
            상대적인 관심도(0~100)예요.
          </p>
          <TrendForm />
        </div>
      </details>
    </div>
  );
}
