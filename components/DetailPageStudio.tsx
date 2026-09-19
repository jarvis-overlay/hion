'use client';

import { useState, useTransition } from 'react';
import {
  createProject,
  deleteProject,
  addSection,
  retrySection,
  deleteSection,
  extractImageText,
  recommendSectionCopy,
} from '@/app/dashboard/sales/detail-pages/actions';

// 이미지(왼쪽) - 문구(가운데) - 결과(오른쪽) - 관리 순서로 행이 쌓이는
// 스프레드시트 형태. 미완성 행(초안, draft)을 여러 개 동시에 쌓아두고
// 하나씩(또는 순서대로) 생성할 수 있다 - 이미지 여러 장을 한 번에
// 선택하면 그만큼 초안 행이 바로 생김.
const THUMB = 'w-64 h-64';
const GRID_COLS = 'grid-cols-[280px_1fr_280px_56px]';

type LayoutStyle = 'white' | 'overlay' | 'typography';
type Theme = 'dark' | 'purple' | 'light';

interface Draft {
  id: string;
  file: File | null;
  previewUrl: string | null;
  keyword: string;
  mood: string;
  description: string;
  eyebrow: string;
  accentTitle: string;
  accentSubtitle: string;
  stat: string;
  statCaption: string;
  layoutStyle: LayoutStyle;
  theme: Theme;
  extractedTexts: { original: string; translated: string }[] | null;
  extracting: boolean;
  extractError: string | null;
  recommending: boolean;
}

function newDraft(): Draft {
  return {
    id: crypto.randomUUID(),
    file: null,
    previewUrl: null,
    keyword: '',
    mood: '',
    description: '',
    eyebrow: '',
    accentTitle: '',
    accentSubtitle: '',
    stat: '',
    statCaption: '',
    layoutStyle: 'white',
    theme: 'dark',
    extractedTexts: null,
    extracting: false,
    extractError: null,
    recommending: false,
  };
}

function ProjectEditor({ project, onClose }: { project: any; onClose: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null); // 재시도 중인 section id 또는 생성 중인 draft id
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([newDraft()]);
  const sections: any[] = [...(project.detail_page_sections || [])].sort((a, b) => a.position - b.position);

  function updateDraft(id: string, patch: Partial<Draft>) {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  function removeDraft(id: string) {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
  }

  function addRow() {
    setDrafts((prev) => [...prev, newDraft()]);
  }

  function handleGenerate(draft: Draft) {
    const hasText =
      draft.keyword.trim() ||
      draft.mood.trim() ||
      draft.description.trim() ||
      draft.eyebrow.trim() ||
      draft.accentTitle.trim() ||
      draft.stat.trim();
    if (!hasText) {
      setError('문구 항목(설명/작은 문구/브랜드명/통계 중 하나)은 입력해주세요.');
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set('keyword', draft.keyword);
    fd.set('mood', draft.mood);
    fd.set('description', draft.description);
    fd.set('eyebrow', draft.eyebrow);
    fd.set('accentTitle', draft.accentTitle);
    fd.set('accentSubtitle', draft.accentSubtitle);
    fd.set('stat', draft.stat);
    fd.set('statCaption', draft.statCaption);
    fd.set('layoutStyle', draft.layoutStyle);
    fd.set('theme', draft.theme);
    if (draft.file) fd.set('image', draft.file);
    setBusyId(draft.id);
    startTransition(async () => {
      const res = await addSection(project.id, sections.length, fd);
      setBusyId(null);
      if ('error' in res) {
        setError(res.error);
        return;
      }
      removeDraft(draft.id);
      // 초안이 하나도 안 남으면 다음 입력을 위해 빈 줄 하나 다시 만들어준다
      setDrafts((prev) => (prev.length === 0 ? [newDraft()] : prev));
    });
  }

  function handleRetry(sectionId: string) {
    setBusyId(sectionId);
    startTransition(async () => {
      await retrySection(sectionId);
      setBusyId(null);
    });
  }

  // 첨부한 원본 사진에 박힌 중국어 문구가 뭐라고 써있는지 미리 뽑아서
  // 보여준다 - 이걸 보고 사용자가 원하는 한국어 문구를 직접 입력한다.
  function handleExtractText(draft: Draft) {
    if (!draft.file) return;
    updateDraft(draft.id, { extracting: true, extractError: null, extractedTexts: null });
    const fd = new FormData();
    fd.set('image', draft.file);
    startTransition(async () => {
      const res = await extractImageText(fd);
      if ('error' in res) {
        updateDraft(draft.id, { extracting: false, extractError: res.error });
        return;
      }
      updateDraft(draft.id, { extracting: false, extractedTexts: res.texts });
    });
  }

  // 문구/디자인 칸을 사용자가 하나씩 채우는 대신 AI가 한 번에 초안을
  // 채워준다 - 추출해둔 원본 문구(있으면)와 이미 입력해둔 내용을 참고
  // 자료로 넘긴다.
  function handleRecommend(draft: Draft) {
    updateDraft(draft.id, { recommending: true });
    const extractedText = (draft.extractedTexts || [])
      .map((t) => `${t.original} -> ${t.translated}`)
      .join('\n');
    const existingHints = [
      draft.keyword && `키워드: ${draft.keyword}`,
      draft.mood && `분위기: ${draft.mood}`,
      draft.description && `헤드라인: ${draft.description}`,
    ]
      .filter(Boolean)
      .join('\n');
    startTransition(async () => {
      const res = await recommendSectionCopy({
        productName: project.title || '',
        extractedText,
        existingHints,
      });
      if ('error' in res) {
        updateDraft(draft.id, { recommending: false });
        setError(res.error);
        return;
      }
      updateDraft(draft.id, { recommending: false, ...res.data });
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
          const isRetrying = isPending && busyId === s.id;
          return (
            <div key={s.id} className={`grid ${GRID_COLS} border-t border-paperLine items-start`}>
              <div className="p-2">
                {s.input_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={s.input_image_url}
                    alt="첨부 이미지"
                    className={`${THUMB} object-cover rounded bg-paper`}
                  />
                ) : (
                  <div className={`${THUMB} rounded bg-paper flex items-center justify-center text-[11px] text-inkSoft text-center px-1`}>
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
                  <div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={s.output_image_url}
                      alt="생성 결과"
                      className={`${THUMB} object-cover rounded bg-paper`}
                    />
                    <a
                      href={s.output_image_url}
                      download
                      target="_blank"
                      rel="noreferrer"
                      className="block text-center text-[11px] text-accent underline mt-1"
                    >
                      다운로드
                    </a>
                  </div>
                ) : s.error ? (
                  <button
                    onClick={() => handleRetry(s.id)}
                    disabled={isRetrying}
                    className={`${THUMB} rounded bg-warnBg flex items-center justify-center text-[11px] text-warn font-semibold text-center px-1 disabled:opacity-50`}
                  >
                    {isRetrying ? '재시도 중...' : '실패 - 다시 생성'}
                  </button>
                ) : (
                  <div className={`${THUMB} rounded bg-paper flex items-center justify-center text-[11px] text-inkSoft`}>
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

        {/* 초안 행들 - 이미지 칸을 클릭하면 그 행에 사진을 붙일 수 있고,
            안 붙이면 그대로 AI가 새로 생성한다. */}
        {drafts.map((d) => {
          const isGenerating = isPending && busyId === d.id;
          return (
            <div key={d.id} className={`grid ${GRID_COLS} border-t border-paperLine items-start bg-paper/60`}>
              <div className="p-2">
                {d.layoutStyle === 'typography' ? (
                  <div
                    className={`${THUMB} rounded bg-paper flex items-center justify-center text-[11px] text-inkSoft text-center px-2`}
                  >
                    사진 없음
                    <br />
                    (그라데이션 배경)
                  </div>
                ) : (
                  <label className="cursor-pointer block">
                    {d.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={d.previewUrl} alt="" className={`${THUMB} object-cover rounded bg-paper`} />
                    ) : (
                      <div
                        className={`${THUMB} rounded bg-paper flex items-center justify-center text-[11px] text-inkSoft text-center px-2 hover:bg-paperLine transition`}
                      >
                        클릭해서 이미지 첨부
                        <br />
                        (없으면 AI가 생성)
                      </div>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null;
                        updateDraft(d.id, {
                          file: f,
                          previewUrl: f ? URL.createObjectURL(f) : null,
                          extractedTexts: null,
                          extractError: null,
                        });
                      }}
                    />
                  </label>
                )}
                {d.file && d.layoutStyle !== 'typography' && (
                  <div className="mt-1.5">
                    <button
                      onClick={() => handleExtractText(d)}
                      disabled={d.extracting}
                      className="text-[11px] text-accent font-semibold underline disabled:opacity-50"
                    >
                      {d.extracting ? '텍스트 추출 중...' : '원본 사진 속 문구 추출'}
                    </button>
                    {d.extractError && <p className="text-[11px] text-warn mt-1">{d.extractError}</p>}
                    {d.extractedTexts && (
                      <div className="mt-1 bg-paper rounded p-1.5 text-[11px] leading-relaxed resize-y overflow-auto h-32 min-h-[3.5rem] max-h-[28rem]">
                        {d.extractedTexts.length === 0 ? (
                          <p className="text-inkSoft">인식된 문구가 없어요.</p>
                        ) : (
                          d.extractedTexts.map((t, i) => (
                            <p key={i} className="mb-1 last:mb-0">
                              <span className="text-inkSoft">{t.original}</span>
                              <br />→ {t.translated}
                            </p>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="p-2 grid gap-1.5">
                <button
                  onClick={() => handleRecommend(d)}
                  disabled={d.recommending}
                  className="text-[11px] text-accent font-semibold underline justify-self-start disabled:opacity-50"
                >
                  {d.recommending ? 'AI 추천 생성 중...' : '✨ AI 추천으로 문구+디자인 채우기'}
                </button>
                <div className="flex gap-1.5">
                  <select
                    value={d.layoutStyle}
                    onChange={(e) => updateDraft(d.id, { layoutStyle: e.target.value as LayoutStyle })}
                    className="border border-paperLine bg-white px-2 py-1.5 text-xs flex-1"
                  >
                    <option value="white">화이트 섹션 (사진+문구 분리)</option>
                    <option value="overlay">오버레이 (사진 위 그라데이션+문구)</option>
                    <option value="typography">타이포그래피 (사진 없이 문구만)</option>
                  </select>
                  {d.layoutStyle !== 'white' && (
                    <select
                      value={d.theme}
                      onChange={(e) => updateDraft(d.id, { theme: e.target.value as Theme })}
                      className="border border-paperLine bg-white px-2 py-1.5 text-xs w-24"
                    >
                      <option value="dark">다크</option>
                      <option value="purple">퍼플</option>
                      <option value="light">라이트</option>
                    </select>
                  )}
                </div>
                {d.layoutStyle !== 'typography' && (
                  <>
                    <input
                      value={d.keyword}
                      onChange={(e) => updateDraft(d.id, { keyword: e.target.value })}
                      placeholder="키워드 (예: 여름 휴대용 선풍기)"
                      className="border border-paperLine bg-white px-2 py-1.5 text-xs w-full"
                    />
                    <input
                      value={d.mood}
                      onChange={(e) => updateDraft(d.id, { mood: e.target.value })}
                      placeholder="분위기 (예: 시원한 파란 톤)"
                      className="border border-paperLine bg-white px-2 py-1.5 text-xs w-full"
                    />
                  </>
                )}
                <input
                  value={d.eyebrow}
                  onChange={(e) => updateDraft(d.id, { eyebrow: e.target.value })}
                  placeholder="작은 상단 문구 (선택, 예: 처음 시향한 순간)"
                  className="border border-paperLine bg-white px-2 py-1.5 text-xs w-full"
                />
                <input
                  value={d.description}
                  onChange={(e) => updateDraft(d.id, { description: e.target.value })}
                  placeholder="헤드라인 문구 (예: '한여름 폭염도 거뜬' 강조)"
                  className="border border-paperLine bg-white px-2 py-1.5 text-xs w-full"
                />
                {d.layoutStyle !== 'white' && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-inkSoft select-none">
                      고급 문구 (브랜드명/통계, 선택)
                    </summary>
                    <div className="grid gap-1.5 mt-1.5">
                      <input
                        value={d.accentTitle}
                        onChange={(e) => updateDraft(d.id, { accentTitle: e.target.value })}
                        placeholder="브랜드/제품명 영문 (예: Saffron Luminous Arcana)"
                        className="border border-paperLine bg-white px-2 py-1.5 text-xs w-full"
                      />
                      <input
                        value={d.accentSubtitle}
                        onChange={(e) => updateDraft(d.id, { accentSubtitle: e.target.value })}
                        placeholder="한글 표기 (예: 사프란 루미너스 아르카나)"
                        className="border border-paperLine bg-white px-2 py-1.5 text-xs w-full"
                      />
                      <input
                        value={d.stat}
                        onChange={(e) => updateDraft(d.id, { stat: e.target.value })}
                        placeholder="강조 숫자 (예: 110%, 부향률 30%)"
                        className="border border-paperLine bg-white px-2 py-1.5 text-xs w-full"
                      />
                      <input
                        value={d.statCaption}
                        onChange={(e) => updateDraft(d.id, { statCaption: e.target.value })}
                        placeholder="숫자 아래 설명 문구"
                        className="border border-paperLine bg-white px-2 py-1.5 text-xs w-full"
                      />
                    </div>
                  </details>
                )}
              </div>
              <div className="p-2 grid gap-1">
                <button
                  onClick={() => handleGenerate(d)}
                  disabled={isPending}
                  className={`btn-primary ${THUMB} text-xs font-semibold disabled:opacity-50`}
                >
                  {isGenerating ? '생성 중...' : '섹션 생성'}
                </button>
              </div>
              <div className="p-2">
                <button onClick={() => removeDraft(d.id)} className="text-[11px] text-inkSoft hover:text-red-700">
                  삭제
                </button>
              </div>
            </div>
          );
        })}

        <div className="border-t border-paperLine p-2">
          <button onClick={addRow} className="text-xs text-accent font-semibold">
            + 행 추가
          </button>
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
