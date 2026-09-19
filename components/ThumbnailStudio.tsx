'use client';

import { useState, useTransition } from 'react';
import {
  createProject,
  deleteProject,
  addThumbnailImage,
  retryThumbnailImage,
  deleteThumbnailImage,
} from '@/app/dashboard/sales/thumbnails/actions';

// 썸네일은 상세페이지 섹션과 달리 그 자체가 결과물이라 "좀 크게 보여야
// 한다"는 요청으로 큼직하게(288px) 보여준다.
const LARGE = 'w-72 h-72';
const MEDIUM = 'w-56 h-56';

type ThumbnailPosition = 'center' | 'top' | 'bottom' | 'left' | 'right';

const POSITION_LABEL: Record<ThumbnailPosition, string> = {
  center: '정중앙',
  top: '상단',
  bottom: '하단',
  left: '좌측',
  right: '우측',
};

interface ImageDraft {
  id: string;
  file: File | null;
  previewUrl: string | null;
  position: ThumbnailPosition;
  effectPrompt: string;
  generating: boolean;
}

function newImageDraft(): ImageDraft {
  return {
    id: crypto.randomUUID(),
    file: null,
    previewUrl: null,
    position: 'center',
    effectPrompt: '',
    generating: false,
  };
}

function DraftForm({
  draft,
  onChange,
  onGenerate,
  busy,
  label,
}: {
  draft: ImageDraft;
  onChange: (patch: Partial<ImageDraft>) => void;
  onGenerate: () => void;
  busy: boolean;
  label: string;
}) {
  return (
    <div className="card p-3 grid gap-2 sm:grid-cols-[160px_1fr] items-start">
      <label className="cursor-pointer block">
        {draft.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={draft.previewUrl} alt="" className="w-40 h-40 object-cover rounded bg-paper" />
        ) : (
          <div className="w-40 h-40 rounded bg-paper flex items-center justify-center text-[11px] text-inkSoft text-center px-2 hover:bg-paperLine transition">
            클릭해서 상품 사진 첨부
          </div>
        )}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] || null;
            onChange({ file: f, previewUrl: f ? URL.createObjectURL(f) : null });
          }}
        />
      </label>
      <div className="grid gap-1.5">
        <label className="text-[11px] text-inkSoft">제품 위치</label>
        <select
          value={draft.position}
          onChange={(e) => onChange({ position: e.target.value as ThumbnailPosition })}
          className="border border-paperLine bg-white px-2 py-1.5 text-xs w-full"
        >
          {(Object.keys(POSITION_LABEL) as ThumbnailPosition[]).map((p) => (
            <option key={p} value={p}>
              {POSITION_LABEL[p]}
            </option>
          ))}
        </select>
        <input
          value={draft.effectPrompt}
          onChange={(e) => onChange({ effectPrompt: e.target.value })}
          placeholder="효과 추가 프롬프트 (선택, 예: 은은한 그림자와 반짝이는 조명 효과 추가해줘)"
          className="border border-paperLine bg-white px-2 py-1.5 text-xs w-full"
        />
        <button
          onClick={onGenerate}
          disabled={busy || !draft.file}
          className="btn-primary px-4 py-1.5 text-xs font-semibold disabled:opacity-50 justify-self-start"
        >
          {busy ? '생성 중... (누끼+배치)' : label}
        </button>
      </div>
    </div>
  );
}

function ImageCard({
  img,
  size,
  onRetry,
  onDelete,
  busy,
}: {
  img: any;
  size: string;
  onRetry: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  return (
    <div className="card p-2 grid gap-1.5 justify-items-center">
      {img.output_image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img.output_image_url} alt="썸네일" className={`${size} object-contain rounded bg-paper border border-paperLine`} />
      ) : img.error ? (
        <button
          onClick={onRetry}
          disabled={busy}
          className={`${size} rounded bg-warnBg flex items-center justify-center text-xs text-warn font-semibold text-center px-2 disabled:opacity-50`}
        >
          {busy ? '재시도 중...' : '실패 - 다시 생성'}
        </button>
      ) : (
        <div className={`${size} rounded bg-paper flex items-center justify-center text-xs text-inkSoft`}>생성 중...</div>
      )}
      <p className="text-[11px] text-inkSoft">{POSITION_LABEL[img.product_position as ThumbnailPosition] || '정중앙'}</p>
      {img.effect_prompt && <p className="text-[10px] text-inkSoft text-center px-1">효과: {img.effect_prompt}</p>}
      <div className="flex gap-2">
        {img.output_image_url && (
          <a href={img.output_image_url} download target="_blank" rel="noreferrer" className="text-[11px] text-accent underline">
            다운로드
          </a>
        )}
        <button onClick={onDelete} className="text-[11px] text-inkSoft hover:text-red-700">
          삭제
        </button>
      </div>
    </div>
  );
}

function ProjectEditor({ project, onClose }: { project: any; onClose: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mainDraft, setMainDraft] = useState<ImageDraft>(newImageDraft());
  const [additionalDrafts, setAdditionalDrafts] = useState<ImageDraft[]>([newImageDraft()]);

  const images: any[] = project.thumbnail_images || [];
  const mainImage = images.find((i) => i.kind === 'main');
  const additionalImages = [...images.filter((i) => i.kind === 'additional')].sort((a, b) => a.position - b.position);

  function handleGenerateMain() {
    if (!mainDraft.file) return;
    setError(null);
    const fd = new FormData();
    fd.set('image', mainDraft.file);
    fd.set('productPosition', mainDraft.position);
    fd.set('effectPrompt', mainDraft.effectPrompt);
    setBusyId('main-draft');
    startTransition(async () => {
      const res = await addThumbnailImage(project.id, 'main', 0, fd);
      setBusyId(null);
      if ('error' in res) {
        setError(res.error);
        return;
      }
      setMainDraft(newImageDraft());
    });
  }

  function handleGenerateAdditional(draft: ImageDraft) {
    if (!draft.file) return;
    setError(null);
    const fd = new FormData();
    fd.set('image', draft.file);
    fd.set('productPosition', draft.position);
    fd.set('effectPrompt', draft.effectPrompt);
    setBusyId(draft.id);
    startTransition(async () => {
      const res = await addThumbnailImage(project.id, 'additional', additionalImages.length, fd);
      setBusyId(null);
      if ('error' in res) {
        setError(res.error);
        return;
      }
      setAdditionalDrafts((prev) => prev.filter((d) => d.id !== draft.id));
      setAdditionalDrafts((prev) => (prev.length === 0 ? [newImageDraft()] : prev));
    });
  }

  function handleRetry(imageId: string) {
    setBusyId(imageId);
    startTransition(async () => {
      await retryThumbnailImage(imageId);
      setBusyId(null);
    });
  }

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">{project.title || '제목 없는 프로젝트'}</h2>
        <button onClick={onClose} className="text-xs text-inkSoft hover:text-ink">
          목록으로
        </button>
      </div>

      <section className="grid gap-2">
        <div>
          <h3 className="text-sm font-semibold">메인 썸네일</h3>
          <p className="text-[11px] text-inkSoft">쿠팡 검색결과에 노출되는 대표 이미지 1장이에요.</p>
        </div>
        {mainImage ? (
          <div className="flex flex-wrap gap-4">
            <ImageCard
              img={mainImage}
              size={LARGE}
              onRetry={() => handleRetry(mainImage.id)}
              onDelete={() => startTransition(() => deleteThumbnailImage(mainImage.id))}
              busy={isPending && busyId === mainImage.id}
            />
            <div className="text-xs text-inkSoft self-center">
              새 사진을 올리면 지금 메인 썸네일을 교체해요.
              <div className="mt-2">
                <DraftForm
                  draft={mainDraft}
                  onChange={(patch) => setMainDraft((prev) => ({ ...prev, ...patch }))}
                  onGenerate={handleGenerateMain}
                  busy={isPending && busyId === 'main-draft'}
                  label="메인 썸네일 교체"
                />
              </div>
            </div>
          </div>
        ) : (
          <DraftForm
            draft={mainDraft}
            onChange={(patch) => setMainDraft((prev) => ({ ...prev, ...patch }))}
            onGenerate={handleGenerateMain}
            busy={isPending && busyId === 'main-draft'}
            label="메인 썸네일 만들기"
          />
        )}
      </section>

      <section className="grid gap-2">
        <div>
          <h3 className="text-sm font-semibold">추가 이미지</h3>
          <p className="text-[11px] text-inkSoft">상세 갤러리에 들어가는 나머지 이미지예요. 여러 장 추가할 수 있어요.</p>
        </div>

        {additionalImages.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {additionalImages.map((img) => (
              <ImageCard
                key={img.id}
                img={img}
                size={MEDIUM}
                onRetry={() => handleRetry(img.id)}
                onDelete={() => startTransition(() => deleteThumbnailImage(img.id))}
                busy={isPending && busyId === img.id}
              />
            ))}
          </div>
        )}

        <div className="grid gap-2">
          {additionalDrafts.map((d) => (
            <DraftForm
              key={d.id}
              draft={d}
              onChange={(patch) =>
                setAdditionalDrafts((prev) => prev.map((x) => (x.id === d.id ? { ...x, ...patch } : x)))
              }
              onGenerate={() => handleGenerateAdditional(d)}
              busy={isPending && busyId === d.id}
              label="추가 이미지 생성"
            />
          ))}
          <button
            onClick={() => setAdditionalDrafts((prev) => [...prev, newImageDraft()])}
            className="text-xs text-accent font-semibold justify-self-start"
          >
            + 행 추가
          </button>
        </div>
      </section>

      {error && <p className="text-xs text-warn bg-warnBg rounded-md px-3 py-2">{error}</p>}
    </div>
  );
}

export default function ThumbnailStudio({ projects }: { projects: any[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const active = projects.find((p) => p.id === activeId);

  if (active) {
    return <ProjectEditor project={active} onClose={() => setActiveId(null)} />;
  }

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const res = await createProject(newTitle);
      if ('error' in res) {
        setError(res.error);
        return;
      }
      setActiveId(res.id);
      setCreating(false);
      setNewTitle('');
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold">내 프로젝트 ({projects.length})</span>
        <button onClick={() => setCreating((v) => !v)} className="text-xs text-accent font-semibold">
          {creating ? '닫기' : '+ 생성하기'}
        </button>
      </div>

      {creating && (
        <div className="flex gap-2 mb-4 bg-paper rounded-md p-3">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="프로젝트 이름 (선택, 예: 여름 선풍기 썸네일)"
            className="border border-paperLine bg-white px-2 py-1.5 text-sm flex-1"
          />
          <button
            onClick={handleCreate}
            disabled={isPending}
            className="btn-primary px-4 py-1.5 text-sm font-semibold disabled:opacity-50"
          >
            {isPending ? '생성 중...' : '만들기'}
          </button>
        </div>
      )}
      {error && <p className="text-xs text-warn bg-warnBg rounded-md px-3 py-2 mb-3">{error}</p>}

      {projects.length === 0 ? (
        <p className="text-sm text-inkSoft">아직 만든 썸네일이 없어요.</p>
      ) : (
        <div className="grid gap-2">
          {projects.map((p) => {
            const images: any[] = p.thumbnail_images || [];
            return (
              <div key={p.id} className="card p-3 flex items-center justify-between gap-3">
                <button onClick={() => setActiveId(p.id)} className="min-w-0 flex-1 text-left">
                  <p className="font-semibold text-sm truncate">{p.title || '제목 없는 프로젝트'}</p>
                  <p className="text-xs text-inkSoft">
                    이미지 {images.length}개 · {new Date(p.created_at).toLocaleDateString('ko-KR')}
                  </p>
                </button>
                <button
                  onClick={() => startTransition(() => deleteProject(p.id))}
                  className="text-xs text-inkSoft hover:text-red-700 shrink-0"
                >
                  삭제
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
