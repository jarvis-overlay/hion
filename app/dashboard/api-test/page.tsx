import ApiTestForm from '@/components/ApiTestForm';

export const maxDuration = 30;

export default function ApiTestPage() {
  return (
    <div>
      <h1 className="font-display text-2xl font-bold mb-1">API 테스트</h1>
      <p className="text-sm text-inkSoft mb-5">
        쿠팡 오픈API를 직접 호출해서 원본 응답을 그대로 확인해볼 수 있어요.
        여기서 조회한 내용은 DB에 저장되지 않고, 실제 동기화와도 무관해요.
      </p>
      <ApiTestForm />
    </div>
  );
}
