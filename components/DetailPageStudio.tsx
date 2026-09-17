'use client';

import { useRef, useState, useTransition } from 'react';
import {
  createProject,
  deleteProject,
  addSection,
  retrySection,
  deleteSection,
} from '@/app/dashboard/sales/detail-pages/actions';

function SectionAddForm({
  onSubmit,
  isPending,
}: {
  onSubmit: (fd: FormData) => void;
  isPending: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(fd) => {
        onSubmit(fd);
      }}
      className="grid gap-2 bg-paper rounded-md p-3"
    >
      <input name="image" type="file" accept="image/*" className="text-xs" />
      <p className="text-[11px] text-inkSoft">상품 사진 없이 문구만 넣으면 AI가 이미지를 새로 만들어요</p>
      <textarea
        name="text"
        placeholder="키워드/분위기/설명 (예: 여름 휴대용 선풍기, 시원한 파란 톤, '한여름 폭염도 거뜬' 문구 강조)"
        rows={2}
        className="border border-paperLine bg-white px-2 py-1.5 text-xs"
        required
      />
      <button
        type="submit"
        disabled={isPending}
        className="btn-primary py-1.5 text-xs font-semibold disabled:opacity-50 self-start px-4"
        onClick={() => {
          // 서버 액션이 끝나면(성공/실패 모두) 폼을 비워서 다음 섹션을 바로 이어 넣을 수 있게 함
          setTimeout(() => formRef.current?.reset(), 0);
        }}
      >
        {isPending ? '생성 중... (최대 1분 정도 걸려요)' : '섹션 생성'}
      </button>
    </form>
  );
}

function SectionCard({
  section,
  onRetry,
  onDelete,
  isPending,
}: {
  section: any;
  onRetry: () => void;
  onDelete: () => void;
  isPending: boolean;
}) {
  return (
    <div className="card p-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-[11px] font-semibold text-inkSoft mb-1">첨부 이미지</p>
          {section.input_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={section.input_image_url}
              alt="첨부 이미지"
              className="w-full aspect-square object-cover rounded bg-paper"
            />
          ) : (
            <div className="w-full aspect-square rounded bg-paper flex items-center justify-center text-[11px] text-inkSoft text-center px-1">
              없음 (AI가 새로 생성)
            </div>
          )}
        </div>
        <div>
          <p className="text-[11px] font-semibold text-inkSoft mb-1">생성 결과</p>
          {section.output_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={section.output_image_url}
              alt="생성 결과"
              className="w-full aspect-square object-cover rounded bg-paper"
            />
          ) : section.error ? (
            <div className="w-full aspect-square rounded bg-warnBg flex items-center justify-center p-1">
              <button
                onClick={onRetry}
                disabled={isPending}
                className="text-[11px] text-warn font-semibold text-center disabled:opacity-50"
              >
                {isPending ? '재시도 중...' : '실패 - 다시 생성'}
              </button>
            </div>
          ) : (
            <div className="w-full aspect-square rounded bg-paper flex items-center justify-center text-[11px] text-inkSoft">
              생성 중...
            </div>
          )}
        </div>
      </div>
      <p className="text-xs text-ink mt-2 leading-relaxed">{section.prompt_text}</p>
      {section.error && <p className="text-[11px] text-warn mt-1">{section.error}</p>}
      <button onClick={onDelete} className="text-[11px] text-inkSoft hover:text-red-700 mt-1.5">
        섹션 삭제
      </button>
    </div>
  );
}

function ProjectEditor({ project, onClose }: { project: any; onClose: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sections: any[] = [...(project.detail_page_sections || [])].sort((a, b) => a.position - b.position);

  function handleAdd(fd: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await addSection(project.id, sections.length, fd);
      if ('error' in res) setError(res.error);
    });
  }

  function handleRetry(sectionId: string) {
    setRetryingId(sectionId);
    startTransition(async () => {
      await retrySection(sectionId);
      setRetryingId(null);
    });
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">{project.title || '제목 없는 프로젝트'}</h2>
        <button onClick={onClose} className="text-xs text-inkSoft hover:text-ink">
          목록으로
        </button>
      </div>

      {sections.length > 0 && (
        <div className="grid gap-3">
          {sections.map((s) => (
            <SectionCard
              key={s.id}
              section={s}
              isPending={isPending && retryingId === s.id}
              onRetry={() => handleRetry(s.id)}
              onDelete={() => startTransition(() => deleteSection(s.id))}
            />
          ))}
        </div>
      )}

      {error && <p className="text-xs text-warn bg-warnBg rounded-md px-3 py-2">{error}</p>}

      <SectionAddForm onSubmit={handleAdd} isPending={isPending && retryingId === null} />
    </div>
  );
}

export default function DetailPageStudio({ projects }: { projects: any[] }) {
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
            placeholder="프로젝트 이름 (선택, 예: 여름 선풍기 상세페이지)"
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
        <p className="text-sm text-inkSoft">아직 만든 상세페이지가 없어요.</p>
      ) : (
        <div className="grid gap-2">
          {projects.map((p) => {
            const sections: any[] = p.detail_page_sections || [];
            return (
              <div key={p.id} className="card p-3 flex items-center justify-between gap-3">
                <button onClick={() => setActiveId(p.id)} className="min-w-0 flex-1 text-left">
                  <p className="font-semibold text-sm truncate">{p.title || '제목 없는 프로젝트'}</p>
                  <p className="text-xs text-inkSoft">
                    섹션 {sections.length}개 · {new Date(p.created_at).toLocaleDateString('ko-KR')}
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
