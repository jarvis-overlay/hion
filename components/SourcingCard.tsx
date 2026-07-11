'use client';

import { useTransition } from 'react';
import { updateSourcingStatus, deleteSourcingPost } from '@/app/dashboard/sourcing/list/actions';

const STATUS_LABEL: Record<string, string> = {
  checking: '검토중',
  ordered: '발주완료',
  hold: '보류',
};

const STATUS_STYLE: Record<string, string> = {
  checking: 'bg-warnBg text-warn',
  ordered: 'bg-profitBg text-profit',
  hold: 'bg-paperLine text-inkSoft',
};

export default function SourcingCard({ post }: { post: any }) {
  const [isPending, startTransition] = useTransition();
  const status = post.status || 'checking';

  return (
    <div className="card p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-sm">{post.title}</h3>
        <span
          className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_STYLE[status]}`}
        >
          {STATUS_LABEL[status]}
        </span>
      </div>

      {post.source_url && (
        <a
          href={post.source_url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-profit underline break-all"
        >
          {post.source_url}
        </a>
      )}

      <div className="flex gap-4 text-xs text-inkSoft font-mono">
        {post.price != null && <span>단가 {post.price}</span>}
        {post.moq && <span>MOQ {post.moq}</span>}
      </div>

      {post.notes && <p className="text-xs text-ink">{post.notes}</p>}

      <div className="flex items-center justify-between mt-1 pt-2 border-t border-paperLine">
        <span className="text-[11px] text-inkSoft">
          {post.author_email?.split('@')[0]} ·{' '}
          {new Date(post.created_at).toLocaleDateString('ko-KR')}
        </span>
        <div className="flex gap-2 text-xs">
          <select
            value={status}
            disabled={isPending}
            onChange={(e) =>
              startTransition(() => updateSourcingStatus(post.id, e.target.value))
            }
            className="border border-paperLine bg-white text-xs px-1 py-0.5"
          >
            <option value="checking">검토중</option>
            <option value="ordered">발주완료</option>
            <option value="hold">보류</option>
          </select>
          <button
            onClick={() => startTransition(() => deleteSourcingPost(post.id))}
            className="text-inkSoft hover:text-red-700"
          >
            삭제
          </button>
        </div>
      </div>
    </div>
  );
}
