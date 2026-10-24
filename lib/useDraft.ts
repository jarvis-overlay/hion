'use client';

import { useEffect, useState } from 'react';

// 공장과 메시지 주고받는 중 다른 앱(1688 등)으로 왔다갔다 하다가 입력
// 중이던 메모/번역 내용이 날아가는 걸 막기 위한 draft 저장 - 브라우저
// localStorage에 남겨두고, 같은 입력창을 다시 열면 그대로 복원한다.
export function useDraft(key: string): [string, (next: string) => void] {
  const [value, setValue] = useState('');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved) setValue(saved);
    } catch {
      // 프라이빗 브라우징 등 localStorage 접근 불가 - 조용히 무시 (draft 기능만 빠짐)
    }
  }, [key]);

  function update(next: string) {
    setValue(next);
    try {
      if (next) localStorage.setItem(key, next);
      else localStorage.removeItem(key);
    } catch {
      // 위와 동일
    }
  }

  return [value, update];
}
