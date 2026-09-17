'use client';

import { useRef, useState, useTransition } from 'react';
import {
  addSourceImage,
  runTranslate,
  runRemoveBackground,
  runResize,
  deleteSourcingImage,
} from '@/app/dashboard/sales/images/actions';

type Stage = 'translated' | 'cutout' | 'resized';

const STAGE_LABEL: Record<Stage, string> = {
  translated: '번역',
  cutout: '누끼',
  resized: '쿠팡 규격(860px)',
};

const STAGE_RUNNER: Record<Stage, (id: string) => Promise<{ error: string } | { success: true; url: string }>> = {
  translated: runTranslate,
  cutout: runRemoveBackground,
  resized: runResize,
};

function ImageCard({ image }: { image: any }) {
  const [isPending, startTransition] = useTransition();
  const [runningStage, setRunningStage] = useState<Stage | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Stage, string>>>({});

  const urls: Record<Stage, string | null> = {
    translated: image.translated_url,
    cutout: image.cutout_url,
    resized: image.resized_url,
  };

  function run(stage: Stage) {
    setRunningStage(stage);
    setErrors((e) => ({ ...e, [stage]: undefined }));
    startTransition(async () => {
      const res = await STAGE_RUNNER[stage](image.id);
      setRunningStage(null);
      if ('error' in res) {
        setErrors((e) => ({ ...e, [stage]: res.error }));
      }
    });
  }

  return (
    <div className="card p-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div>
          <p className="text-[11px] font-semibold text-inkSoft mb-1">원본</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.original_url} alt="원본" className="w-full aspect-square object-cover rounded bg-paper" />
        </div>
        {(['translated', 'cutout', 'resized'] as Stage[]).map((stage) => (
          <div key={stage}>
            <p className="text-[11px] font-semibold text-inkSoft mb-1">{STAGE_LABEL[stage]}</p>
            {urls[stage] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={urls[stage]!}
                alt={STAGE_LABEL[stage]}
                className="w-full aspect-square object-cover rounded bg-paper"
              />
            ) : (
              <div className="w-full aspect-square rounded bg-paper flex items-center justify-center">
                <button
                  onClick={() => run(stage)}
                  disabled={isPending}
                  className="text-[11px] text-accent font-semibold disabled:opacity-50 text-center px-1"
                >
                  {runningStage === stage ? '처리 중...' : `${STAGE_LABEL[stage]} 실행`}
                </button>
              </div>
            )}
            {urls[stage] && (
              <button onClick={() => run(stage)} disabled={isPending} className="text-[10px] text-inkSoft hover:text-ink mt-0.5">
                {runningStage === stage ? '처리 중...' : '다시 실행'}
              </button>
            )}
            {errors[stage] && <p className="text-[10px] text-warn mt-0.5 leading-snug">{errors[stage]}</p>}
          </div>
        ))}
      </div>
      <button
        onClick={() => startTransition(() => deleteSourcingImage(image.id))}
        disabled={isPending}
        className="text-[11px] text-inkSoft hover:text-red-700 mt-2"
      >
        이미지 삭제
      </button>
    </div>
  );
}

function AddImageForm({ sourcingItemId, onDone }: { sourcingItemId: string; onDone: () => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      ref={formRef}
      action={(fd) =>
        startTransition(async () => {
          setError(null);
          const res = await addSourceImage(sourcingItemId, fd);
          if ('error' in res) {
            setError(res.error);
            return;
          }
          formRef.current?.reset();
          onDone();
        })
      }
      className="grid gap-2 bg-paper rounded-md p-3"
    >
      <input name="file" type="file" accept="image/*" className="text-xs" />
      <p className="text-[11px] text-inkSoft">또는</p>
      <input
        name="url"
        placeholder="이미지 URL (1688 상품 이미지 링크 등)"
        className="border border-paperLine bg-white px-2 py-1.5 text-xs"
      />
      {error && <p className="text-[11px] text-warn bg-warnBg rounded px-2 py-1">{error}</p>}
      <button
        type="submit"
        disabled={isPending}
        className="btn-primary py-1.5 text-xs font-semibold disabled:opacity-50 self-start px-4"
      >
        {isPending ? '추가 중...' : '이미지 추가'}
      </button>
    </form>
  );
}

export default function ImageWorkbench({ items }: { items: any[] }) {
  const [selectedId, setSelectedId] = useState(items[0]?.id ?? '');
  const [adding, setAdding] = useState(false);

  const selected = items.find((it) => it.id === selectedId);
  const images: any[] = selected?.sourcing_item_images || [];

  if (items.length === 0) {
    return <p className="text-sm text-inkSoft">등록된 소싱 후보가 없어요.</p>;
  }

  return (
    <div>
      <select
        value={selectedId}
        onChange={(e) => {
          setSelectedId(e.target.value);
          setAdding(false);
        }}
        className="border border-paperLine bg-white px-3 py-2 text-sm w-full mb-4"
      >
        {items.map((it) => (
          <option key={it.id} value={it.id}>
            {it.title}
          </option>
        ))}
      </select>

      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-inkSoft">이미지 ({images.length})</span>
        <button onClick={() => setAdding((v) => !v)} className="text-xs text-accent font-semibold">
          {adding ? '닫기' : '+ 이미지 추가'}
        </button>
      </div>

      {adding && (
        <div className="mb-3">
          <AddImageForm sourcingItemId={selectedId} onDone={() => setAdding(false)} />
        </div>
      )}

      {images.length === 0 ? (
        <p className="text-sm text-inkSoft">아직 등록된 이미지가 없어요.</p>
      ) : (
        <div className="grid gap-3">
          {images.map((img) => (
            <ImageCard key={img.id} image={img} />
          ))}
        </div>
      )}
    </div>
  );
}
