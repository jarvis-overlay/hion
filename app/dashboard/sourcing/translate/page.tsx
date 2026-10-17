import SourcingTranslator from '@/components/SourcingTranslator';

export default function SourcingTranslatePage() {
  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl font-bold mb-1">중국어 번역기</h1>
      <p className="text-sm text-inkSoft mb-5">
        1688 공장 담당자와의 채팅에 바로 쓸 수 있도록, 직역이 아니라 비즈니스 톤으로 자연스럽게
        번역해드려요. 여러 조건을 한 번에 넣으면 하나의 메시지로 정리해줘요.
      </p>
      <SourcingTranslator />
    </div>
  );
}
