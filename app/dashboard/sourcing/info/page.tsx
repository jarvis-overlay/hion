import { redirect } from 'next/navigation';

// "소싱 정보"와 "소싱 리스트"를 "소싱" 한 탭으로 통합했다 - 옛 링크로
// 들어오는 경우를 위해 리다이렉트만 남겨둔다.
export default function SourcingInfoRedirect() {
  redirect('/dashboard/sourcing/list');
}
