'use client';

import { useRef, useState, useTransition } from 'react';
import { shrinkImageForUpload } from '@/lib/clientImage';
import {
  createProject,
  updateProjectCategory,
  deleteProject,
  addThumbnailImage,
  generateThumbnailBatch,
  relearnStyle,
  retryThumbnailImage,
  editThumbnailImage,
  duplicateThumbnailStrip,
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

// 1688 "상품 페이지" 링크(예: detail.1688.com/offer/...html)를 사진
// 주소로 착각해서 붙여넣는 실수가 반복돼서, 서버 에러가 뜨기 전에
// 화면에서 먼저 알려준다 - 사진 파일 자체의 주소(보통 .jpg/.png 등으로
// 끝남)만 여기 들어갈 수 있다.
function looksLikeImageUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    return /\.(jpe?g|png|webp|gif|bmp)$/i.test(path);
  } catch {
    return false;
  }
}

function UrlWarning({ url }: { url: string }) {
  const v = url.trim();
  if (!v || looksLikeImageUrl(v)) return null;
  return (
    <p className="text-[10px] text-warn">
      ⚠️ 사진 파일 주소가 아니라 상품 페이지 링크 같아요. 1688에서 사진 위에 마우스 우클릭 →
      &quot;이미지 주소 복사&quot;로 받은, .jpg/.png로 끝나는 주소를 넣어주세요. 소싱 확장프로그램으로
      사진을 다운로드 폴더에 받으셨다면, URL 대신 왼쪽 &quot;사진 첨부&quot;로 그 파일을 직접 선택하세요.
    </p>
  );
}

interface ImageDraft {
  id: string;
  file: File | null;
  previewUrl: string | null;
  imageUrl: string;
  position: ThumbnailPosition;
  effectPrompt: string;
  generating: boolean;
}

function newImageDraft(): ImageDraft {
  return {
    id: crypto.randomUUID(),
    file: null,
    previewUrl: null,
    imageUrl: '',
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
          onChange={async (e) => {
            const raw = e.target.files?.[0] || null;
            const f = raw ? await shrinkImageForUpload(raw) : null;
            onChange({ file: f, previewUrl: f ? URL.createObjectURL(f) : null, imageUrl: f ? '' : draft.imageUrl });
          }}
        />
      </label>
      <div className="grid gap-1.5">
        <input
          value={draft.imageUrl}
          onChange={(e) => onChange({ imageUrl: e.target.value, file: e.target.value ? null : draft.file, previewUrl: e.target.value ? null : draft.previewUrl })}
          placeholder="또는 이미지 URL 붙여넣기 (예: 1688에서 복사한 사진 주소)"
          className="border border-paperLine bg-white px-2 py-1.5 text-xs w-full"
        />
        <UrlWarning url={draft.imageUrl} />
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
          disabled={busy || (!draft.file && !draft.imageUrl.trim())}
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
  // 이미 나온 결과를 처음부터 다시 만들지 않고, 프롬프트로 부분 수정만
  // 하고 싶다는 요청으로 추가함 - 수정도 같은 이미지에 덮어써서 생성/
  // 재시도와 같은 카드 하나로 관리한다.
  const [editing, setEditing] = useState(false);
  const [editPrompt, setEditPrompt] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [isEditPending, startEditTransition] = useTransition();

  // 효과 프롬프트(AI)로는 "똑같은 띠를 하나 더 반복해달라" 같은 요청이
  // 잘 안 먹혀서, 이미지 안의 한 구간을 그대로 복사해 다른 위치에
  // 붙여넣는 결정적 도구를 별도로 둔다 - 비율(%)로 영역을 지정하고,
  // 미리보기 사각형으로 어디를 복사해서 어디에 붙이는지 보여준다.
  const [duplicating, setDuplicating] = useState(false);
  const [srcTopPct, setSrcTopPct] = useState(0);
  const [srcBottomPct, setSrcBottomPct] = useState(20);
  const [destTopPct, setDestTopPct] = useState(0);
  const [dupError, setDupError] = useState<string | null>(null);
  const [isDupPending, startDupTransition] = useTransition();

  function handleEdit() {
    if (!editPrompt.trim()) return;
    setEditError(null);
    startEditTransition(async () => {
      const res = await editThumbnailImage(img.id, editPrompt.trim());
      if (!res || 'error' in res) {
        setEditError(res?.error ?? '요청이 실패했어요. 다시 시도해주세요.');
        return;
      }
      setEditing(false);
      setEditPrompt('');
    });
  }

  function handleDuplicate() {
    setDupError(null);
    startDupTransition(async () => {
      const res = await duplicateThumbnailStrip(img.id, {
        sourceTopPct: srcTopPct,
        sourceBottomPct: srcBottomPct,
        destTopPct: destTopPct,
      });
      if (!res || 'error' in res) {
        setDupError(res?.error ?? '요청이 실패했어요. 다시 시도해주세요.');
        return;
      }
      setDuplicating(false);
    });
  }

  return (
    <div className="card p-2 grid gap-1.5 justify-items-center">
      {img.output_image_url ? (
        <div className={`${size} relative`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={img.output_image_url}
            alt="썸네일"
            className="absolute inset-0 w-full h-full object-contain rounded bg-paper border border-paperLine"
          />
          {duplicating && (
            <>
              <div
                className="absolute left-0 right-0 border-2 border-blue-500 bg-blue-500/20 pointer-events-none"
                style={{ top: `${srcTopPct}%`, height: `${Math.max(0, srcBottomPct - srcTopPct)}%` }}
              />
              <div
                className="absolute left-0 right-0 border-2 border-red-500 pointer-events-none"
                style={{ top: `${destTopPct}%`, height: `${Math.max(0, srcBottomPct - srcTopPct)}%` }}
              />
            </>
          )}
        </div>
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
      {img.error && <p className="text-[10px] text-warn text-center px-1 max-w-[16rem]">{img.error}</p>}
      {img.style_spec?.shot ? (
        <p className="text-[11px] text-inkSoft text-center px-1 max-w-[16rem]">
          컷: {img.style_spec.shot.title}
          {img.style_spec.copy?.headline ? ` · "${img.style_spec.copy.headline}"` : ''}
        </p>
      ) : (
        <p className="text-[11px] text-inkSoft">{POSITION_LABEL[img.product_position as ThumbnailPosition] || '정중앙'}</p>
      )}
      {img.effect_prompt && <p className="text-[10px] text-inkSoft text-center px-1">효과: {img.effect_prompt}</p>}
      <div className="flex gap-2">
        {img.output_image_url && (
          <>
            <a href={img.output_image_url} download target="_blank" rel="noreferrer" className="text-[11px] text-accent underline">
              다운로드
            </a>
            <button
              onClick={() => {
                setEditing((v) => !v);
                setEditError(null);
              }}
              className="text-[11px] text-accent font-semibold"
            >
              {editing ? '취소' : '수정'}
            </button>
            <button
              onClick={() => {
                setDuplicating((v) => !v);
                setDupError(null);
              }}
              className="text-[11px] text-accent font-semibold"
            >
              {duplicating ? '취소' : '조각 복제'}
            </button>
          </>
        )}
        <button onClick={onDelete} className="text-[11px] text-inkSoft hover:text-red-700">
          삭제
        </button>
      </div>
      {editing && img.output_image_url && (
        <div className="grid gap-1.5 w-full">
          <textarea
            value={editPrompt}
            onChange={(e) => setEditPrompt(e.target.value)}
            rows={2}
            placeholder="수정할 내용을 입력하세요 (예: 그림자를 더 연하게 해줘, 제품을 살짝 왼쪽으로 옮겨줘)"
            className="border border-paperLine bg-white px-2 py-1.5 text-[11px] w-full"
          />
          <button
            onClick={handleEdit}
            disabled={isEditPending || !editPrompt.trim()}
            className="btn-primary py-1 text-[11px] font-semibold disabled:opacity-50"
          >
            {isEditPending ? '수정 중...' : '수정 적용'}
          </button>
          {editError && <p className="text-[10px] text-warn">{editError}</p>}
        </div>
      )}
      {duplicating && img.output_image_url && (
        <div className="grid gap-1.5 w-full">
          <p className="text-[10px] text-inkSoft">
            파란 영역(복사할 구간)을 빨간 영역(붙여넣을 위치)으로 복제해요. 반복되는 띠 하나를 더 추가할 때 써요.
          </p>
          <label className="text-[10px] text-inkSoft grid gap-0.5">
            복사할 구간 - 시작 {srcTopPct}%
            <input
              type="range"
              min={0}
              max={99}
              value={srcTopPct}
              onChange={(e) => setSrcTopPct(Math.min(Number(e.target.value), srcBottomPct - 1))}
            />
          </label>
          <label className="text-[10px] text-inkSoft grid gap-0.5">
            복사할 구간 - 끝 {srcBottomPct}%
            <input
              type="range"
              min={1}
              max={100}
              value={srcBottomPct}
              onChange={(e) => setSrcBottomPct(Math.max(Number(e.target.value), srcTopPct + 1))}
            />
          </label>
          <label className="text-[10px] text-inkSoft grid gap-0.5">
            붙여넣을 위치 - 시작 {destTopPct}%
            <input
              type="range"
              min={0}
              max={99}
              value={destTopPct}
              onChange={(e) => setDestTopPct(Number(e.target.value))}
            />
          </label>
          <button
            onClick={handleDuplicate}
            disabled={isDupPending}
            className="btn-primary py-1 text-[11px] font-semibold disabled:opacity-50"
          >
            {isDupPending ? '복제 중...' : '복제 적용'}
          </button>
          {dupError && <p className="text-[10px] text-warn">{dupError}</p>}
        </div>
      )}
    </div>
  );
}

function ProjectEditor({
  project,
  styleBrief,
  onClose,
}: {
  project: any;
  styleBrief?: any; // category_style_briefs 행 (이 프로젝트 카테고리에 학습된 스타일)
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [styleMsg, setStyleMsg] = useState<string | null>(null);
  const [mainDraft, setMainDraft] = useState<ImageDraft>(newImageDraft());
  const [additionalDrafts, setAdditionalDrafts] = useState<ImageDraft[]>([newImageDraft()]);
  const [editingCategory, setEditingCategory] = useState(false);
  const [categoryInput, setCategoryInput] = useState(project.category || '');

  // URL/사진 하나만 넣으면 매번 "+ 행 추가"로 직접 여러 장을 만들지
  // 않아도, 메인 썸네일 1장 + 추가 이미지 3~7장을 자동으로 한 번에
  // 만들어주는 일괄 생성 - 요청: "URL을 넣으면 메인 하나와 추가
  // 이미지를 최소 3~7가지를 만들어줘야해".
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchPreviews, setBatchPreviews] = useState<string[]>([]);
  // 사진마다 색상을 태그해두면, 같은 색상끼리 묶어서 색상별로 완전히
  // 별도 세트(메인+추가)를 만들어준다("색상마다 완전히 별도 세트로
  // 생성해달라"는 요청) - 같은 색상 중 먼저 선택한 사진이 그 색상의
  // 메인이 된다. 비워두면(태그 없음) 기존처럼 전체가 한 세트로 묶인다.
  const [batchColorLabels, setBatchColorLabels] = useState<string[]>([]);
  const [batchUrl, setBatchUrl] = useState('');
  const [batchCount, setBatchCount] = useState(5);
  const [batchResult, setBatchResult] = useState<string | null>(null);
  const batchFileInputRef = useRef<HTMLInputElement>(null);

  const images: any[] = project.thumbnail_images || [];
  const mainImages = images.filter((i) => i.kind === 'main');
  const additionalImages = [...images.filter((i) => i.kind === 'additional')].sort((a, b) => a.position - b.position);
  // 색상 라벨별로 묶어서 보여준다 - 라벨이 없는(null) 기존 데이터는
  // 그대로 "기본" 그룹 하나로 표시돼서 이전 화면과 동일하게 보인다.
  const colorGroupKeys = Array.from(
    new Set([...mainImages, ...additionalImages].map((i) => i.color_label || ''))
  ).sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));

  function handleGenerateMain() {
    if (!mainDraft.file && !mainDraft.imageUrl.trim()) return;
    setError(null);
    const fd = new FormData();
    if (mainDraft.file) fd.set('image', mainDraft.file);
    else fd.set('imageUrl', mainDraft.imageUrl.trim());
    fd.set('productPosition', mainDraft.position);
    fd.set('effectPrompt', mainDraft.effectPrompt);
    setBusyId('main-draft');
    startTransition(async () => {
      const res = await addThumbnailImage(project.id, 'main', 0, fd);
      setBusyId(null);
      if (!res || 'error' in res) {
        setError(res?.error ?? '요청이 실패했어요. 다시 시도해주세요.');
        return;
      }
      setMainDraft(newImageDraft());
    });
  }

  function handleGenerateAdditional(draft: ImageDraft) {
    if (!draft.file && !draft.imageUrl.trim()) return;
    setError(null);
    const fd = new FormData();
    if (draft.file) fd.set('image', draft.file);
    else fd.set('imageUrl', draft.imageUrl.trim());
    fd.set('productPosition', draft.position);
    fd.set('effectPrompt', draft.effectPrompt);
    setBusyId(draft.id);
    startTransition(async () => {
      const res = await addThumbnailImage(project.id, 'additional', additionalImages.length, fd);
      setBusyId(null);
      if (!res || 'error' in res) {
        setError(res?.error ?? '요청이 실패했어요. 다시 시도해주세요.');
        return;
      }
      setAdditionalDrafts((prev) => prev.filter((d) => d.id !== draft.id));
      setAdditionalDrafts((prev) => (prev.length === 0 ? [newImageDraft()] : prev));
    });
  }

  function handleBatchGenerate() {
    if (batchFiles.length === 0 && !batchUrl.trim()) return;
    setError(null);
    setBatchResult(null);
    const fd = new FormData();
    if (batchFiles.length > 0) {
      // 색상 라벨이 같은 사진끼리 서버에서 그룹으로 묶여서, 같은 라벨
      // 중 먼저 온 사진이 그 색상의 메인이 된다.
      batchFiles.forEach((f, i) => {
        fd.append('images', f);
        fd.append('colorLabels', batchColorLabels[i] || '');
      });
    } else {
      fd.set('imageUrl', batchUrl.trim());
    }
    fd.set('additionalCount', String(batchCount));
    setBusyId('batch');
    startTransition(async () => {
      const res = await generateThumbnailBatch(project.id, fd);
      setBusyId(null);
      if (!res || 'error' in res) {
        setError(res?.error ?? '요청이 실패했어요. 다시 시도해주세요.');
        return;
      }
      setBatchResult(
        `메인 썸네일 ${res.mainOk}/${res.mainTotal}장` +
          (res.colorGroups > 1 ? ` (색상 ${res.colorGroups}개)` : '') +
          ` · 추가 이미지 ${res.additionalOk}/${res.additionalTotal}장 생성 완료` +
          (res.styledApplied ? ` (쿠팡 인기상품 ${res.styleSourceCount}개 분석 스타일 적용)` : '') +
          (res.notes.length ? `\n${res.notes.join('\n')}` : '')
      );
      setBatchFiles([]);
      setBatchPreviews([]);
      setBatchColorLabels([]);
      setBatchUrl('');
    });
  }

  function handleRelearn() {
    setError(null);
    setStyleMsg(null);
    setBusyId('relearn');
    startTransition(async () => {
      const res = await relearnStyle(project.id);
      setBusyId(null);
      if (!res || 'error' in res) {
        setError(res?.error ?? '요청이 실패했어요. 다시 시도해주세요.');
        return;
      }
      setStyleMsg(
        `쿠팡 인기상품 ${res.sourceCount}개를 분석해서 스타일을 새로 학습했어요.` + (res.warning ? ` ${res.warning}` : '')
      );
    });
  }

  function handleBatchFileRemove(index: number) {
    setBatchFiles((prev) => prev.filter((_, i) => i !== index));
    setBatchPreviews((prev) => prev.filter((_, i) => i !== index));
    setBatchColorLabels((prev) => prev.filter((_, i) => i !== index));
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

      <div className="text-xs text-inkSoft">
        {editingCategory ? (
          <div className="flex items-center gap-2">
            <input
              value={categoryInput}
              onChange={(e) => setCategoryInput(e.target.value)}
              placeholder="카테고리/검색어 (예: 휴대용 선풍기) - 쿠팡 인기상품을 참고해서 효과를 더 퀄리티 있게 만들어요"
              className="border border-paperLine bg-white px-2 py-1 text-xs flex-1"
            />
            <button
              onClick={() =>
                startTransition(() => {
                  updateProjectCategory(project.id, categoryInput);
                  setEditingCategory(false);
                })
              }
              className="text-accent font-semibold"
            >
              저장
            </button>
          </div>
        ) : (
          <button onClick={() => setEditingCategory(true)} className="hover:text-ink">
            {project.category ? `카테고리: ${project.category}` : '+ 카테고리 설정 (쿠팡 인기상품 스타일로 추가 이미지 만들기)'}
          </button>
        )}
      </div>

      {project.category && (
        <div className="text-xs bg-paper rounded-lg p-3 grid gap-2 max-w-3xl">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="font-semibold">
              인기상품 스타일 학습
              {styleBrief
                ? ` · ${styleBrief.source_count}개 분석 · ${new Date(styleBrief.learned_at).toLocaleDateString('ko-KR', {
                    timeZone: 'Asia/Seoul',
                  })}`
                : ' · 아직 학습 전'}
            </span>
            <button
              onClick={handleRelearn}
              disabled={isPending && busyId === 'relearn'}
              className="text-accent font-semibold disabled:opacity-50"
            >
              {isPending && busyId === 'relearn'
                ? '학습 중... (1~2분 걸려요)'
                : styleBrief
                  ? '스타일 다시 학습'
                  : '지금 학습하기'}
            </button>
          </div>
          {styleBrief?.brief ? (
            <>
              <p className="text-inkSoft leading-relaxed">{styleBrief.brief.summary}</p>
              <div className="flex flex-wrap gap-1.5">
                {(styleBrief.brief.shots || []).map((s: any) => (
                  <span key={s.id} className="px-2 py-0.5 rounded-full bg-white border border-paperLine text-[11px]">
                    {s.title}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p className="text-inkSoft">
              일괄 생성을 누르면 자동으로 학습해서 적용해요. 미리 학습해서 어떤 구성이 나오는지 먼저 볼 수도 있어요.
            </p>
          )}
          {styleMsg && <p className="text-profit">{styleMsg}</p>}
        </div>
      )}

      <section className="card p-4 grid gap-3 border-2 border-accent/30">
        <div>
          <h3 className="text-sm font-semibold">한 번에 만들기</h3>
          <p className="text-[11px] text-inkSoft">
            상품 사진(여러 장 가능)이나 URL을 넣으면 <strong>메인 썸네일은 쿠팡 규정대로 흰 배경</strong>으로,
            <strong> 추가 이미지는 쿠팡 인기상품을 분석해 학습한 스타일</strong>(배경·소품·컷 구성 + 한국어 강조
            문구)로 새로 만들어요. 위에서 <strong>카테고리를 설정</strong>해야 적용되고, 안 하면 예전처럼 누끼
            방식으로 만들어요. 사진마다 <strong>색상을 태그</strong>해두면 같은 색상끼리 묶여 색상별로 완전히 별도
            세트(메인+추가)가 만들어져요 - 같은 색상 중 먼저 선택한 사진이 그 색상의 메인이 돼요. 문구는 AI가 만든
            초안이니 사실과 다른 내용이 없는지 확인하세요.
          </p>
        </div>

        {batchFiles.length === 0 ? (
          <button
            type="button"
            onClick={() => batchFileInputRef.current?.click()}
            className="w-40 h-40 rounded bg-paper flex items-center justify-center text-[11px] text-inkSoft text-center px-2 hover:bg-paperLine transition"
          >
            클릭해서 상품 사진 첨부 (여러 장 선택 가능)
          </button>
        ) : (
          <div className="grid gap-1.5 max-w-md">
            {batchFiles.map((f, i) => (
              <div key={i} className="flex items-center gap-2 bg-paper rounded px-2 py-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={batchPreviews[i]} alt="" className="w-10 h-10 object-cover rounded shrink-0" />
                <input
                  value={batchColorLabels[i] || ''}
                  onChange={(e) =>
                    setBatchColorLabels((prev) => {
                      const next = [...prev];
                      next[i] = e.target.value;
                      return next;
                    })
                  }
                  placeholder="색상(선택, 예: 검정)"
                  className="border border-paperLine bg-white px-2 py-1 text-xs flex-1 min-w-0"
                />
                <button
                  type="button"
                  onClick={() => handleBatchFileRemove(i)}
                  className="text-[11px] text-inkSoft hover:text-red-700 shrink-0"
                >
                  삭제
                </button>
              </div>
            ))}
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => batchFileInputRef.current?.click()}
                className="text-xs text-accent font-semibold"
              >
                + 사진 추가
              </button>
              <span className="text-[11px] text-inkSoft">{batchFiles.length}장 선택됨</span>
            </div>
          </div>
        )}
        <input
          ref={batchFileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={async (e) => {
            const raws = Array.from(e.target.files || []);
            if (raws.length === 0) return;
            const shrunk = await Promise.all(raws.map((r) => shrinkImageForUpload(r)));
            setBatchFiles((prev) => [...prev, ...shrunk]);
            setBatchPreviews((prev) => [...prev, ...shrunk.map((f) => URL.createObjectURL(f))]);
            setBatchColorLabels((prev) => [...prev, ...shrunk.map(() => '')]);
            setBatchUrl('');
            e.target.value = '';
          }}
        />

        <div className="grid gap-1.5 max-w-md">
          <input
            value={batchUrl}
            onChange={(e) => {
              const v = e.target.value;
              setBatchUrl(v);
              if (v) {
                setBatchFiles([]);
                setBatchPreviews([]);
                setBatchColorLabels([]);
              }
            }}
            disabled={batchFiles.length > 1}
            placeholder="또는 이미지 URL 1개 붙여넣기 (예: 1688에서 복사한 사진 주소)"
            className="border border-paperLine bg-white px-2 py-1.5 text-xs w-full disabled:opacity-50"
          />
          {batchFiles.length <= 1 && <UrlWarning url={batchUrl} />}
          {(batchFiles.length <= 1 || project.category) && (
            <label className="text-[11px] text-inkSoft">
              {project.category ? '추가 이미지 개수' : '사진 1장으로 만들 때 추가 이미지 개수'} ({batchCount}장
              {project.category && batchFiles.length > 1 ? ', 색상마다' : ''})
              <input
                type="range"
                min={3}
                max={7}
                value={batchCount}
                onChange={(e) => setBatchCount(Number(e.target.value))}
                className="w-full"
              />
            </label>
          )}
          <button
            onClick={handleBatchGenerate}
            disabled={(isPending && busyId === 'batch') || (batchFiles.length === 0 && !batchUrl.trim())}
            className="btn-primary px-4 py-1.5 text-xs font-semibold disabled:opacity-50 justify-self-start"
          >
            {isPending && busyId === 'batch'
              ? '생성 중... (시간이 좀 걸려요)'
              : batchFiles.length > 1
                ? `선택한 사진 ${batchFiles.length}장으로 한 번에 생성`
                : `메인 + 추가 ${batchCount}장 한 번에 생성`}
          </button>
          {batchResult && <p className="text-[11px] text-accent whitespace-pre-line">{batchResult}</p>}
        </div>
      </section>

      <section className="grid gap-3">
        <div>
          <h3 className="text-sm font-semibold">메인 썸네일</h3>
          <p className="text-[11px] text-inkSoft">
            쿠팡 검색결과에 노출되는 대표 이미지예요. 색상을 태그해서 올리면 색상별로 메인이 따로 생겨요.
          </p>
        </div>

        {colorGroupKeys.length <= 1 ? (
          mainImages.length > 0 ? (
            <div className="flex flex-wrap gap-4">
              <ImageCard
                img={mainImages[0]}
                size={LARGE}
                onRetry={() => handleRetry(mainImages[0].id)}
                onDelete={() => startTransition(() => deleteThumbnailImage(mainImages[0].id))}
                busy={isPending && busyId === mainImages[0].id}
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
          )
        ) : (
          <div className="grid gap-3">
            {colorGroupKeys.map((colorKey) => {
              const groupMain = mainImages.find((i) => (i.color_label || '') === colorKey);
              return (
                <div key={colorKey || '__default__'} className="grid gap-1">
                  <p className="text-xs font-semibold text-accent">색상: {colorKey || '기본'}</p>
                  {groupMain ? (
                    <ImageCard
                      img={groupMain}
                      size={MEDIUM}
                      onRetry={() => handleRetry(groupMain.id)}
                      onDelete={() => startTransition(() => deleteThumbnailImage(groupMain.id))}
                      busy={isPending && busyId === groupMain.id}
                    />
                  ) : (
                    <p className="text-xs text-inkSoft">이 색상의 메인이 아직 없어요.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid gap-3">
        <div>
          <h3 className="text-sm font-semibold">추가 이미지</h3>
          <p className="text-[11px] text-inkSoft">상세 갤러리에 들어가는 나머지 이미지예요. 여러 장 추가할 수 있어요.</p>
        </div>

        {colorGroupKeys.length <= 1
          ? additionalImages.length > 0 && (
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
            )
          : colorGroupKeys.map((colorKey) => {
              const groupAdditional = additionalImages.filter((i) => (i.color_label || '') === colorKey);
              if (groupAdditional.length === 0) return null;
              return (
                <div key={colorKey || '__default__'} className="grid gap-1">
                  <p className="text-xs font-semibold text-accent">색상: {colorKey || '기본'}</p>
                  <div className="flex flex-wrap gap-3">
                    {groupAdditional.map((img) => (
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
                </div>
              );
            })}

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

export default function ThumbnailStudio({
  projects,
  styleBriefs = {},
}: {
  projects: any[];
  styleBriefs?: Record<string, any>; // 카테고리 -> category_style_briefs 행
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const active = projects.find((p) => p.id === activeId);

  if (active) {
    return (
      <ProjectEditor
        project={active}
        styleBrief={styleBriefs[(active.category || '').trim()]}
        onClose={() => setActiveId(null)}
      />
    );
  }

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const res = await createProject(newTitle, newCategory);
      if (!res || 'error' in res) {
        setError(res?.error ?? '요청이 실패했어요. 다시 시도해주세요.');
        return;
      }
      setActiveId(res.id);
      setCreating(false);
      setNewTitle('');
      setNewCategory('');
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
        <div className="grid gap-2 mb-4 bg-paper rounded-md p-3">
          <div className="flex gap-2">
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
          <input
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="카테고리/검색어 (선택, 예: 휴대용 선풍기) - 쿠팡 인기상품을 참고해서 효과를 더 퀄리티 있게 만들어요"
            className="border border-paperLine bg-white px-2 py-1.5 text-xs w-full"
          />
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
                    이미지 {images.length}개 · {new Date(p.created_at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}
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
