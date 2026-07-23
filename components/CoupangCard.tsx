'use client';

import { useState, useTransition } from 'react';
import {
  saveCoupangCredentials,
  disconnectChannel,
} from '@/app/dashboard/inventory/channels/actions';

export default function CoupangCard({ connected }: { connected: boolean }) {
  const [editing, setEditing] = useState(!connected);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display font-bold">쿠팡</h3>
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${
            connected ? 'bg-profitBg text-profit' : 'bg-warnBg text-warn'
          }`}
        >
          {connected ? '연결됨' : '미연결'}
        </span>
      </div>

      {!editing ? (
        <div className="flex gap-2">
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-inkSoft hover:text-ink underline"
          >
            키 변경
          </button>
          <button
            onClick={() =>
              startTransition(() => disconnectChannel('coupang'))
            }
            disabled={isPending}
            className="text-xs text-inkSoft hover:text-red-700 underline"
          >
            연결 해제
          </button>
        </div>
      ) : (
        <form
          action={(fd) =>
            startTransition(async () => {
              await saveCoupangCredentials(fd);
              setEditing(false);
            })
          }
          className="grid gap-2"
        >
          <input
            name="vendor_id"
            placeholder="VENDOR ID"
            required
            className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
          />
          <input
            name="access_key"
            placeholder="ACCESS KEY"
            required
            className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
          />
          <input
            name="secret_key"
            type="password"
            placeholder="SECRET KEY"
            required
            className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="btn-primary px-3 py-2 text-xs font-semibold disabled:opacity-50"
            >
              {isPending ? '저장 중...' : '저장'}
            </button>
            {connected && (
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="text-xs text-inkSoft px-2"
              >
                취소
              </button>
            )}
          </div>
        </form>
      )}

      <p className="text-[11px] text-inkSoft mt-3">
        쿠팡 윙(Wing) → 확장서비스 → Open API 이용 신청에서 발급받은 값을
        입력해줘.
      </p>
    </div>
  );
}
