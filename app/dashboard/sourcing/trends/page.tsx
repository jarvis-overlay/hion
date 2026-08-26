import AiRecommendation from '@/components/AiRecommendation';
import TrendForm from '@/components/TrendForm';

// 상품 추천 단계에서 쿠팡/알리바바를 실시간으로 여러 번 조회하느라
// 기본 서버리스 타임아웃을 넘길 수 있다. 특히 알리바바는 봇 차단 때문에
// 요청 1건이 정상적으로도 60초 가까이 걸릴 수 있어서 넉넉하게 설정.
export const maxDuration = 240;

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
      </details>
    </div>
  );
}
