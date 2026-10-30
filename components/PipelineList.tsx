'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  addPipelineCandidate,
  updatePipelineCandidate,
  updatePipelineStage,
  deletePipelineCandidate,
  promoteToSourcingList,
} from '@/app/dashboard/sourcing/pipeline/actions';
import NoteTimeline from './NoteTimeline';

const STAGE_LABEL: Record<string, string> = {
  coupang_search: '①쿠팡서치',
  market_1688: '②1688탐색',
  negotiating: '③발주협의',
  image_production: '④이미지제작',
  listed: '⑤등록완료',
};

const STAGE_STYLE: Record<string, string> = {
  coupang_search: 'bg-paper text-inkSoft ring-1 ring-paperLine',
  market_1688: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  negotiating: 'bg-accentBg text-accent ring-1 ring-accent/20',
  image_production: 'bg-accentBg text-accent ring-1 ring-accent/20',
  listed: 'bg-profitBg text-profit ring-1 ring-profit/20',
};

const STAGE_KEYS = Object.keys(STAGE_LABEL);

function AddCandidateForm({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary px-4 py-2 text-sm mb-5">
        + 새 후보 추가
      </button>
    );
  }

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          const res = await addPipelineCandidate(fd);
          if ('error' in res) {
            setError(res.error);
            return;
          }
          setOpen(false);
          setError(null);
          onAdded();
        })
      }
      className="card p-3 grid gap-2 mb-5"
    >
      <input
        name="title"
        placeholder="상품명 / 카테고리명"
        required
        className="border border-paperLine bg-white px-2 py-1.5 text-sm w-full"
      />
      <input
        name="category"
        placeholder="AI 추천 카테고리 (선택)"
        className="border border-paperLine bg-white px-2 py-1.5 text-sm w-full"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          name="coupang_price"
          type="number"
          placeholder="쿠팡 가격"
          className="border border-paperLine bg-white px-2 py-1.5 text-sm w-full"
        />
        <input
          name="coupang_review_count"
          type="number"
          placeholder="리뷰수"
          className="border border-paperLine bg-white px-2 py-1.5 text-sm w-full"
        />
      </div>
      <input
        name="coupang_link"
        placeholder="쿠팡 링크"
        className="border border-paperLine bg-white px-2 py-1.5 text-sm w-full"
      />
      {error && <p className="text-xs text-warn">{error}</p>}
      <div className="flex gap-2">
        <button disabled={isPending} className="btn-primary px-4 py-1.5 text-xs font-semibold disabled:opacity-50">
          {isPending ? '추가 중...' : '추가'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-inkSoft">
          취소
        </button>
      </div>
    </form>
  );
}

function CandidateCard({
  candidate,
  notes,
  noteCategories,
}: {
  candidate: any;
  notes: any[];
  noteCategories: { id: string; label: string }[];
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const itemNotes = notes.filter((n) => n.entity_id === candidate.id);
  const promoted = !!candidate.sourcing_item_id;

  return (
    <div className="card p-3 grid gap-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-sm">{candidate.title}</p>
          {candidate.category && <p className="text-xs text-inkSoft">{candidate.category}</p>}
        </div>
        <span
          className={`text-[11px] font-semibold px-2 py-1 rounded-full whitespace-nowrap ${STAGE_STYLE[candidate.stage]}`}
        >
          {STAGE_LABEL[candidate.stage]}
        </span>
      </div>

      <div className="text-xs text-inkSoft grid gap-0.5">
        {candidate.coupang_price != null && <p>쿠팡 가격 {candidate.coupang_price.toLocaleString()}원</p>}
        {candidate.coupang_review_count != null && <p>리뷰 {candidate.coupang_review_count.toLocaleString()}개</p>}
        {candidate.coupang_link && (
          <a href={candidate.coupang_link} target="_blank" rel="noreferrer" className="text-accent underline truncate">
            쿠팡 링크
          </a>
        )}
        {candidate.supplier_link && (
          <a
            href={candidate.supplier_link}
            target="_blank"
            rel="noreferrer"
            className="text-accent underline truncate"
          >
            1688 공급처 링크{candidate.supplier_price != null ? ` (¥${candidate.supplier_price})` : ''}
          </a>
        )}
        {candidate.supplier_notes && <p className="whitespace-pre-wrap">{candidate.supplier_notes}</p>}
      </div>

      {promoted && (
        <p className="text-[11px] text-profit bg-profitBg rounded px-2 py-1">
          ✅ 소싱리스트로 전환됨 ({new Date(candidate.promoted_at).toLocaleDateString('ko-KR')})
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select
          value={candidate.stage}
          disabled={isPending}
          onChange={(e) => startTransition(() => updatePipelineStage(candidate.id, e.target.value))}
          className="border border-paperLine bg-white text-xs px-1 py-0.5"
        >
          {STAGE_KEYS.map((k) => (
            <option key={k} value={k}>
              {STAGE_LABEL[k]}
            </option>
          ))}
        </select>
        <button onClick={() => setEditing((v) => !v)} className="text-inkSoft hover:text-ink">
          {editing ? '취소' : '수정'}
        </button>
        {!promoted && (
          <button
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const res = await promoteToSourcingList(candidate.id);
                if ('error' in res) setError(res.error);
              })
            }
            className="text-accent font-semibold"
          >
            소싱리스트로 전환
          </button>
        )}
        <button
          onClick={() => startTransition(() => deletePipelineCandidate(candidate.id))}
          className="text-inkSoft hover:text-red-700"
        >
          삭제
        </button>
      </div>
      {error && <p className="text-xs text-warn">{error}</p>}

      {editing && (
        <form
          action={(fd) =>
            startTransition(async () => {
              const res = await updatePipelineCandidate(candidate.id, fd);
              if ('error' in res) {
                setError(res.error);
                return;
              }
              setEditing(false);
              setError(null);
            })
          }
          className="grid gap-1.5 border-t border-paperLine pt-2 mt-1"
        >
          <input
            name="title"
            defaultValue={candidate.title}
            required
            className="border border-paperLine bg-white px-2 py-1.5 text-xs w-full"
          />
          <input
            name="category"
            defaultValue={candidate.category || ''}
            placeholder="카테고리"
            className="border border-paperLine bg-white px-2 py-1.5 text-xs w-full"
          />
          <div className="grid grid-cols-2 gap-1.5">
            <input
              name="coupang_price"
              type="number"
              defaultValue={candidate.coupang_price ?? ''}
              placeholder="쿠팡 가격"
              className="border border-paperLine bg-white px-2 py-1.5 text-xs w-full"
            />
            <input
              name="coupang_review_count"
              type="number"
              defaultValue={candidate.coupang_review_count ?? ''}
              placeholder="리뷰수"
              className="border border-paperLine bg-white px-2 py-1.5 text-xs w-full"
            />
          </div>
          <input
            name="coupang_link"
            defaultValue={candidate.coupang_link || ''}
            placeholder="쿠팡 링크"
            className="border border-paperLine bg-white px-2 py-1.5 text-xs w-full"
          />
          <input
            name="coupang_image_url"
            defaultValue={candidate.coupang_image_url || ''}
            placeholder="쿠팡 이미지 URL"
            className="border border-paperLine bg-white px-2 py-1.5 text-xs w-full"
          />
          <input
            name="supplier_link"
            defaultValue={candidate.supplier_link || ''}
            placeholder="1688 공급처 링크"
            className="border border-paperLine bg-white px-2 py-1.5 text-xs w-full"
          />
          <input
            name="supplier_price"
            type="number"
            step="0.01"
            defaultValue={candidate.supplier_price ?? ''}
            placeholder="1688 가격 (위안)"
            className="border border-paperLine bg-white px-2 py-1.5 text-xs w-full"
          />
          <textarea
            name="supplier_notes"
            defaultValue={candidate.supplier_notes || ''}
            rows={2}
            placeholder="1688 탐색 메모 (공장 신뢰도, MOQ 등)"
            className="border border-paperLine bg-white px-2 py-1.5 text-xs w-full"
          />
          <button disabled={isPending} className="btn-primary py-1 text-xs font-semibold disabled:opacity-50 justify-self-start px-4">
            {isPending ? '저장 중...' : '저장'}
          </button>
        </form>
      )}

      <NoteTimeline
        entityType="pipeline_candidate"
        entityId={candidate.id}
        notes={itemNotes}
        categories={noteCategories}
      />
    </div>
  );
}

export default function PipelineList({
  candidates,
  notes,
  noteCategories,
}: {
  candidates: any[];
  notes: any[];
  noteCategories: { id: string; label: string }[];
}) {
  const [showPromoted, setShowPromoted] = useState(false);

  const visible = useMemo(
    () => candidates.filter((c) => (showPromoted ? !!c.sourcing_item_id : !c.sourcing_item_id)),
    [candidates, showPromoted]
  );
  const promotedCount = useMemo(() => candidates.filter((c) => !!c.sourcing_item_id).length, [candidates]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <AddCandidateForm onAdded={() => {}} />
        <button
          onClick={() => setShowPromoted((v) => !v)}
          className={`text-xs px-3 py-1.5 rounded-md font-semibold ${
            showPromoted ? 'bg-accent text-white' : 'ring-1 ring-paperLine text-inkSoft'
          }`}
        >
          {showPromoted ? '탐색 중인 후보 보기' : `전환 완료${promotedCount > 0 ? ` (${promotedCount})` : ''}`}
        </button>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-inkSoft">
          {showPromoted ? '아직 소싱리스트로 전환된 후보가 없어요.' : '탐색 중인 후보가 없어요.'}
        </p>
      ) : (
        <div className="grid gap-3">
          {visible.map((c) => (
            <CandidateCard key={c.id} candidate={c} notes={notes} noteCategories={noteCategories} />
          ))}
        </div>
      )}
    </div>
  );
}
