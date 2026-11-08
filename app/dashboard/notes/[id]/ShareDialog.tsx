'use client';

import { useEffect, useState, useTransition } from 'react';
import { getShareTargets, getNoteShares, setNoteShare } from '../actions';

type Permission = 'view' | 'edit' | null;

export default function ShareDialog({
  noteId,
  onClose,
}: {
  noteId: string;
  onClose: () => void;
}) {
  const [emails, setEmails] = useState<string[] | null>(null);
  const [permissions, setPermissions] = useState<Record<string, Permission>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    (async () => {
      const [targetsResult, sharesResult] = await Promise.all([
        getShareTargets(),
        getNoteShares(noteId),
      ]);
      if (!active) return;

      if ('error' in targetsResult) {
        setLoadError(targetsResult.error);
        setEmails([]);
      } else {
        setEmails(targetsResult.emails);
      }

      if ('error' in sharesResult) {
        // 공유 "대상 목록"은 받았는데 "현재 공유 상태"만 못 가져온 경우 -
        // 편집 자체는 되지만 기존 선택값이 빈 채로 보일 수 있음을 알린다.
        setLoadError((prev) => prev ?? sharesResult.error);
      } else {
        const next: Record<string, Permission> = {};
        for (const s of sharesResult.shares) next[s.email] = s.permission;
        setPermissions(next);
      }
    })();
    return () => {
      active = false;
    };
  }, [noteId]);

  function handleChange(email: string, value: Permission) {
    setPermissions((prev) => ({ ...prev, [email]: value }));
    setRowErrors((prev) => ({ ...prev, [email]: '' }));
    startTransition(async () => {
      const result = await setNoteShare(noteId, email, value);
      if ('error' in result) {
        setRowErrors((prev) => ({ ...prev, [email]: result.error }));
      }
    });
  }

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 px-4"
      onClick={onClose}
    >
      <div className="card p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-base font-bold">공유 설정</h2>
          <button type="button" onClick={onClose} className="text-sm text-inkSoft">
            닫기
          </button>
        </div>

        {loadError && <p className="text-sm text-red-700 mb-3">⚠️ {loadError}</p>}

        {emails === null ? (
          <p className="text-sm text-inkSoft">불러오는 중...</p>
        ) : emails.length === 0 ? (
          <p className="text-sm text-inkSoft">공유할 수 있는 다른 계정이 없어요.</p>
        ) : (
          <div className="grid gap-2">
            {emails.map((email) => (
              <div key={email}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm truncate">{email}</span>
                  <select
                    value={permissions[email] ?? ''}
                    disabled={isPending}
                    onChange={(e) =>
                      handleChange(email, (e.target.value || null) as Permission)
                    }
                    className="text-xs border border-paperLine rounded-md px-1.5 py-1 shrink-0"
                  >
                    <option value="">공유 안 함</option>
                    <option value="view">보기</option>
                    <option value="edit">편집</option>
                  </select>
                </div>
                {rowErrors[email] && (
                  <p className="text-xs text-red-700 mt-1">⚠️ {rowErrors[email]}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
