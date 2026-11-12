// 푸시 알림 기기 한 대에 "알림 받을 이메일"을 여러 개 달 수 있게, push_subscriptions.user_email
// 한 칸에 쉼표로 이어 붙여 저장한다(예: "a@x.com,b@y.com"). 브라우저 한 개는 구독 주소가
// 하나뿐이라(DB에서도 endpoint가 유일) 같은 기기를 두 줄로 나눠 저장할 수 없기 때문.
// DB 구조를 바꾸지 않고 쓰기 위한 방식이며, 예전에 이메일 1개만 저장된 행도 그대로 읽힌다.
// 클라이언트/서버 공용 순수 함수.

export function parseOwners(value: string | null | undefined): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value.split(',')) {
    const e = raw.trim().toLowerCase();
    if (e && !seen.has(e)) {
      seen.add(e);
      out.push(e);
    }
  }
  return out;
}

export function joinOwners(list: string[]): string {
  return parseOwners(list.join(',')).join(',');
}

export function hasOwner(value: string | null | undefined, email: string): boolean {
  return parseOwners(value).includes(email.trim().toLowerCase());
}
