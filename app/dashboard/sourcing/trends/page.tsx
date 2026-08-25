import TrendForm from '@/components/TrendForm';

export default function TrendsPage() {
  return (
    <div>
      <h1 className="font-display text-2xl font-bold mb-1">트렌드 발굴</h1>
      <p className="text-sm text-inkSoft mb-5">
        네이버 데이터랩으로 후보 아이템/카테고리의 검색·쇼핑 클릭 추이를
        비교해서 뜨는 아이템을 찾아봐요. 절대적인 판매량이 아니라 기간 내
        상대적인 관심도(0~100)예요.
      </p>
      <TrendForm />
    </div>
  );
}
