'use client';

import { useRef, useState, useTransition } from 'react';
import {
  createProject,
  deleteProject,
  addSection,
  retrySection,
  deleteSection,
} from '@/app/dashboard/sales/detail-pages/actions';

// 이미지(왼쪽) - 문구(가운데) - 결과(오른쪽) - 관리 순서로 행이 쌓이는
// 스프레드시트 형태. 맨 아래 입력 행에 새 섹션을 채우면 위 목록에
// 행으로 추가되는 방식 - 여러 섹션을 한눈에 비교하며 작업하기 위함.
const GRID_COLS = 'grid-cols-[110px_1fr_110px_56px]';

function ProjectEditor({ project, onClose }: { project: any; onClose: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newText, setNewText] = useState('');
  const [newFile, setNewFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sections: any[] = [...(project.detail_page_sections || [])].sort((a, b) => a.position - b.position);
  const isAdding = isPending && retryingId === null;

  function handleAdd() {
    if (!newText.trim()) {
      setError('문구(키워드/분위기/설명)를 입력해주세요.');
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set('text', newText);
    if (newFile) fd.set('image', newFile);
    startTransition(async () => {
      const res = await addSection(project.id, sections.length, fd);
      if ('error' in res) {
        setError(res.error);
        return;
      }
      setNewText('');
      setNewFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
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

      <div className="card overflow-hidden">
        <div className={`grid ${GRID_COLS} bg-paper text-[11px] font-semibold text-inkSoft`}>
          <div className="px-2 py-2">이미지</div>
          <div className="px-2 py-2">키워드 / 분위기 / 설명</div>
          <div className="px-2 py-2">결과</div>
          <div className="px-2 py-2" />
        </div>

        {sections.map((s) => {
          const isRetrying = isPending && retryingId === s.id;
          return (
            <div key={s.id} className={`grid ${GRID_COLS} border-t border-paperLine items-start`}>
              <div className="p-2">
                {s.input_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={s.input_image_url}
                    alt="첨부 이미지"
                    className="w-24 h-24 object-cover rounded bg-paper"
                  />
                ) : (
                  <div className="w-24 h-24 rounded bg-paper flex items-center justify-center text-[10px] text-inkSoft text-center px-1">
                    없음 (AI 생성)
                  </div>
                )}
              </div>
              <div className="p-2 text-xs text-ink leading-relaxed">
                {s.prompt_text}
                {s.error && <p className="text-[11px] text-warn mt-1">{s.error}</p>}
              </div>
              <div className="p-2">
                {s.output_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={s.output_image_url}
                    alt="생성 결과"
                    className="w-24 h-24 object-cover rounded bg-paper"
                  />
                ) : s.error ? (
                  <button
                    onClick={() => handleRetry(s.id)}
                    disabled={isRetrying}
                    className="w-24 h-24 rounded bg-warnBg flex items-center justify-center text-[10px] text-warn font-semibold text-center px-1 disabled:opacity-50"
                  >
                    {isRetrying ? '재시도 중...' : '실패 - 다시 생성'}
                  </button>
                ) : (
                  <div className="w-24 h-24 rounded bg-paper flex items-center justify-center text-[10px] text-inkSoft">
                    생성 중...
                  </div>
                )}
              </div>
              <div className="p-2">
                <button
                  onClick={() => startTransition(() => deleteSection(s.id))}
                  className="text-[11px] text-inkSoft hover:text-red-700"
                >
                  삭제
                </button>
              </div>
            </div>
          );
        })}

        {/* 새 행 입력줄 - 여기 채우고 "섹션 생성" 누르면 위 목록에 행으로 쌓임 */}
        <div className={`grid ${GRID_COLS} border-t border-paperLine items-start bg-paper/60`}>
          <div className="p-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => setNewFile(e.target.files?.[0] || null)}
              className="text-[10px] w-24"
            />
            <p className="text-[9px] text-inkSoft mt-1 leading-tight">없으면 AI가 새로 생성</p>
          </div>
          <div className="p-2">
            <textarea
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="키워드/분위기/설명 (예: 여름 휴대용 선풍기, 시원한 파란 톤, '한여름 폭염도 거뜬' 문구 강조)"
              rows={3}
              className="border border-paperLine bg-white px-2 py-1.5 text-xs w-full"
            />
          </div>
          <div className="p-2">
            <button
              onClick={handleAdd}
              disabled={isAdding}
              className="btn-primary w-24 h-24 text-xs font-semibold disabled:opacity-50"
            >
              {isAdding ? '생성 중...' : '섹션 생성'}
            </button>
          </div>
          <div className="p-2" />
        </div>
      </div>

      {error && <p className="text-xs text-warn bg-warnBg rounded-md px-3 py-2">{error}</p>}
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
