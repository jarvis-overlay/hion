import ProductSearch from '@/components/ProductSearch';
import TrendForm from '@/components/TrendForm';

// 쿠팡 실시간 조회는 캡차 재시도 때문에 최대 135초 가까이 걸릴 수 있다.
// 이 값이 없으면 기본 타임아웃(짧음)에 걸려 조회가 일찍 끊길 수 있음.
export const maxDuration = 180;

export default function ComparePage() {
  return (
    <div>
      <h1 className="font-display text-2xl font-bold mb-1">키워드 리서치</h1>
      <p className="text-sm text-inkSoft mb-6">
        키워드/카테고리를 직접 조회하고 비교해봐요.
      </p>

      <ProductSearch />

      <div className="card p-6 sm:p-8">
        <h2 className="text-lg font-bold mb-1">트렌드 비교</h2>
        <div className="text-sm text-inkSoft mb-5 space-y-2">
          <p>
            네이버 트렌드(상대적 관심도 0~100)와{' '}
            <strong className="text-ink">쿠팡 실제 판매 데이터</strong>(다른
            셀러 포함, 리뷰수·가격 등 진짜 판매 신호)를 같은 이름으로 조회해서
            나란히 보여줘요. 메인 판매 채널이 쿠팡이니 최종 판단은 쿠팡
            데이터를 더 우선해서 봐주세요 — 네이버는 검색 관심도 트렌드를
            보는 보조 지표예요. 탭 세 개는 이런 차이가 있어요:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong className="text-ink">키워드 비교(통합검색)</strong>: 네이버
              통합검색에서 여러 키워드의 검색량 추이를 비교해요 (예: "선풍기" vs
              "에어컨")
            </li>
            <li>
              <strong className="text-ink">쇼핑 카테고리 비교</strong>: 네이버쇼핑
              대분류 카테고리끼리 클릭 추이를 비교해요 (예: "패션의류" vs
              "디지털/가전")
            </li>
            <li>
              <strong className="text-ink">카테고리 내 키워드 비교</strong>: 카테고리
              하나를 고른 다음, 그 안에서 여러 키워드끼리 비교해요 (예:
              "디지털/가전" 안에서 "선풍기" vs "에어컨")
            </li>
          </ul>
        </div>
        <TrendForm />
      </div>
    </div>
  );
}
