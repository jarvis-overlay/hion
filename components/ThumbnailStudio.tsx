'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { shrinkImageForUpload } from '@/lib/clientImage';
import {
  createProject,
  updateProjectCategory,
  deleteProject,
  addThumbnailImage,
  generateThumbnailBatch,
  generateMoreAdditionalImages,
  relearnStyle,
  retryThumbnailImage,
  editThumbnailImage,
  keepMainSubjectOnly,
  revertThumbnailImage,
  duplicateThumbnailStrip,
  deleteThumbnailImage,
  deleteThumbnailImages,
} from '@/app/dashboard/sales/thumbnails/actions';
import { useSavedForm, FormHistoryPicker } from '@/components/useSavedForm';
import ImageLightbox from '@/components/ImageLightbox';
import { downloadImage, downloadImagesZip, safeFileName } from '@/lib/clientDownload';
import {
  PACKAGE_TEMPLATES,
  BADGE_SHAPES,
  BADGE_COLORS,
  getTemplate,
  templateFits,
  type TemplateChoice,
  type BadgeShape,
  type BadgeColor,
} from '@/lib/packageTemplates';

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

// 예전에 올려서 이미 저장돼 있는 상품 사진 한 장 (메인 썸네일 행의 원본 사진)
interface LibraryPhoto {
  id: string; // thumbnail_images 행 id (서버가 이 id로 사진을 다시 받아온다)
  url: string;
  colorLabel: string;
  projectId: string;
  projectTitle: string;
}

// "이전에 올린 사진에서 선택" - 사진을 매번 새로 올리지 않고, 예전에 올렸던 사진을 눌러서 다시 쓴다.
// 이 프로젝트에서 올린 사진을 먼저, 다른 프로젝트 사진은 한 번 더 눌러서 펼친다.
function SavedPhotoPicker({
  photos,
  currentProjectId,
  pickedIds = [],
  onPick,
}: {
  photos: LibraryPhoto[];
  currentProjectId: string;
  pickedIds?: string[];
  onPick: (photo: LibraryPhoto) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  if (photos.length === 0) {
    return (
      <p className="text-[11px] text-inkSoft">
        이전에 올린 사진: 아직 없어요 (한 번 만들고 나면 여기서 바로 골라 다시 쓸 수 있어요).
      </p>
    );
  }
  const mine = photos.filter((p) => p.projectId === currentProjectId);
  const others = photos.filter((p) => p.projectId !== currentProjectId).slice(0, 60);
  const tile = (p: LibraryPhoto, showProject: boolean) => {
    const picked = pickedIds.includes(p.id);
    return (
      <button
        key={p.id}
        type="button"
        disabled={picked}
        onClick={() => onPick(p)}
        title={`${p.projectTitle || '제목 없는 프로젝트'}${p.colorLabel ? ` · ${p.colorLabel}` : ''}`}
        className={`w-[72px] text-left rounded border p-1 bg-white ${
          picked ? 'border-accent opacity-60' : 'border-paperLine hover:border-accent'
        }`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={p.url} alt="" className="w-16 h-16 object-cover rounded bg-paper" loading="lazy" />
        <span className="block text-[10px] text-inkSoft truncate mt-0.5">
          {picked ? '✓ 선택됨' : showProject ? p.projectTitle || '제목 없음' : p.colorLabel || '색상 없음'}
        </span>
        {showProject && !picked && <span className="block text-[10px] text-accent truncate">{p.colorLabel || ''}</span>}
      </button>
    );
  };
  return (
    <div className="grid gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-accent font-semibold justify-self-start"
      >
        {open ? '이전에 올린 사진 닫기' : `이전에 올린 사진에서 선택 (${photos.length}장)`}
      </button>
      {open && (
        <div className="grid gap-2 bg-paper rounded p-2.5">
          <p className="text-[11px] text-inkSoft">
            눌러서 고르면 사진을 새로 올리지 않고 그대로 다시 써요. 색상 이름도 함께 가져와요.
          </p>
          {mine.length > 0 ? (
            <div className="flex flex-wrap gap-2">{mine.map((p) => tile(p, false))}</div>
          ) : (
            <p className="text-[11px] text-inkSoft">이 프로젝트에서 올린 사진은 아직 없어요.</p>
          )}
          {others.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowOthers((v) => !v)}
                className="text-[11px] text-accent font-semibold justify-self-start"
              >
                {showOthers ? '다른 프로젝트 사진 접기' : `다른 프로젝트의 사진 보기 (${others.length}장)`}
              </button>
              {showOthers && <div className="flex flex-wrap gap-2">{others.map((p) => tile(p, true))}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface ImageDraft {
  id: string;
  file: File | null;
  previewUrl: string | null;
  imageUrl: string;
  // 이전에 올린 사진을 골랐을 때(새로 올리지 않음): 그 행 id와 미리보기 주소
  savedId: string | null;
  savedUrl: string | null;
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
    savedId: null,
    savedUrl: null,
    position: 'center',
    effectPrompt: '',
    generating: false,
  };
}

const draftHasPhoto = (d: ImageDraft) => !!d.file || !!d.imageUrl.trim() || !!d.savedId;

function DraftForm({
  draft,
  onChange,
  onGenerate,
  busy,
  label,
  library = [],
  currentProjectId = '',
}: {
  draft: ImageDraft;
  onChange: (patch: Partial<ImageDraft>) => void;
  onGenerate: () => void;
  busy: boolean;
  label: string;
  library?: LibraryPhoto[];
  currentProjectId?: string;
}) {
  const shownPreview = draft.previewUrl || draft.savedUrl;
  return (
    <div className="card p-3 grid gap-2 sm:grid-cols-[160px_1fr] items-start">
      <label className="cursor-pointer block">
        {shownPreview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shownPreview} alt="" className="w-40 h-40 object-cover rounded bg-paper" />
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
            onChange({
              file: f,
              previewUrl: f ? URL.createObjectURL(f) : null,
              imageUrl: f ? '' : draft.imageUrl,
              // 새로 올리면 골라둔 저장 사진은 해제
              ...(f ? { savedId: null, savedUrl: null } : {}),
            });
          }}
        />
      </label>
      <div className="grid gap-1.5">
        {library.length > 0 && (
          <SavedPhotoPicker
            photos={library}
            currentProjectId={currentProjectId}
            pickedIds={draft.savedId ? [draft.savedId] : []}
            onPick={(p) => onChange({ savedId: p.id, savedUrl: p.url, file: null, previewUrl: null, imageUrl: '' })}
          />
        )}
        {draft.savedId && (
          <p className="text-[11px] text-accent">
            이전에 올린 사진을 쓰고 있어요.{' '}
            <button type="button" className="underline" onClick={() => onChange({ savedId: null, savedUrl: null })}>
              선택 해제
            </button>
          </p>
        )}
        <input
          value={draft.imageUrl}
          onChange={(e) =>
            onChange({
              imageUrl: e.target.value,
              file: e.target.value ? null : draft.file,
              previewUrl: e.target.value ? null : draft.previewUrl,
              ...(e.target.value ? { savedId: null, savedUrl: null } : {}),
            })
          }
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
          disabled={busy || !draftHasPhoto(draft)}
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
  selected = false,
  onToggleSelect,
  onPreview,
  onDownload,
  downloading = false,
}: {
  img: any;
  size: string;
  onRetry: (extraPrompt?: string) => void; // 다시 만들 때 덧붙일 요청(선택)
  onDelete: () => void;
  busy: boolean;
  // 여러 장을 골라 한 번에 지우기 위한 선택 상태 (안 넘기면 체크박스 없음)
  selected?: boolean;
  onToggleSelect?: () => void;
  onPreview?: () => void; // 이미지를 눌러 크게 보기
  onDownload?: () => void; // 새 창 없이 바로 내려받기
  downloading?: boolean;
}) {
  // 이미 나온 결과를 처음부터 다시 만들지 않고, 프롬프트로 부분 수정만
  // 하고 싶다는 요청으로 추가함 - 수정도 같은 이미지에 덮어써서 생성/
  // 재시도와 같은 카드 하나로 관리한다.
  const [editing, setEditing] = useState(false);
  const [editPrompt, setEditPrompt] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [isEditPending, startEditTransition] = useTransition();
  // 실패한 카드를 "다시 생성"할 때 덧붙일 요청(선택)
  const [retryPrompt, setRetryPrompt] = useState('');

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

  const [mainOnlyError, setMainOnlyError] = useState<string | null>(null);
  const [isMainOnlyPending, startMainOnlyTransition] = useTransition();
  function handleMainOnly() {
    setMainOnlyError(null);
    startMainOnlyTransition(async () => {
      const res = await keepMainSubjectOnly(img.id);
      if (!res || 'error' in res) setMainOnlyError(res?.error ?? '요청이 실패했어요. 다시 시도해주세요.');
    });
  }

  const [revertMsg, setRevertMsg] = useState<string | null>(null);
  const [isRevertPending, startRevertTransition] = useTransition();
  function handleRevert() {
    setRevertMsg(null);
    startRevertTransition(async () => {
      const res = await revertThumbnailImage(img.id);
      if (!res || 'error' in res) setRevertMsg(res?.error ?? '되돌리지 못했어요. 다시 시도해주세요.');
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
    <div
      className={`card p-2 grid gap-1.5 justify-items-center relative ${
        selected ? '!outline-2 !outline-accent bg-accentBg/40' : ''
      }`}
    >
      {onToggleSelect && (
        <label
          className="absolute top-3 left-3 z-10 w-7 h-7 rounded-md bg-white/90 border border-paperLine shadow-sm flex items-center justify-center cursor-pointer"
          title="선택 (여러 장 한 번에 삭제)"
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="w-4 h-4 accent-[#F5285C]"
            aria-label="이 이미지 선택"
          />
        </label>
      )}
      {img.output_image_url ? (
        <div
          className={`${size} relative ${onPreview && !duplicating ? 'cursor-zoom-in' : ''}`}
          onClick={onPreview && !duplicating ? onPreview : undefined}
          title={onPreview && !duplicating ? '눌러서 크게 보기' : undefined}
        >
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
          onClick={() => onRetry(retryPrompt.trim() || undefined)}
          disabled={busy}
          className={`${size} rounded bg-warnBg flex items-center justify-center text-xs text-warn font-semibold text-center px-2 disabled:opacity-50`}
        >
          {busy ? '재시도 중...' : '실패 - 다시 생성'}
        </button>
      ) : (
        <div className={`${size} rounded bg-paper flex items-center justify-center text-xs text-inkSoft`}>생성 중...</div>
      )}
      {img.error && <p className="text-[10px] text-warn text-center px-1 max-w-[16rem]">{img.error}</p>}
      {img.error && !img.output_image_url && (
        <textarea
          value={retryPrompt}
          onChange={(e) => setRetryPrompt(e.target.value)}
          rows={2}
          placeholder="다시 생성할 때 요청할 내용 (선택, 예: 배경을 더 밝게, 상품을 크게)"
          className="border border-paperLine bg-white px-2 py-1.5 text-[11px] w-full"
        />
      )}
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
            {onPreview && (
              <button onClick={onPreview} className="text-[11px] text-accent font-semibold" title="크게 보기">
                확대
              </button>
            )}
            {onDownload ? (
              <button
                onClick={onDownload}
                disabled={downloading}
                className="text-[11px] text-accent underline disabled:opacity-50"
                title="새 창 없이 바로 저장해요"
              >
                {downloading ? '받는 중...' : '다운로드'}
              </button>
            ) : (
              <a href={img.output_image_url} download target="_blank" rel="noreferrer" className="text-[11px] text-accent underline">
                다운로드
              </a>
            )}
            <button
              onClick={() => {
                setEditing((v) => !v);
                setEditError(null);
              }}
              className="text-[11px] text-accent font-semibold"
            >
              {editing ? '취소' : '수정'}
            </button>
            {!img.style_spec?.shot && img.input_image_url && (
              <button
                onClick={handleMainOnly}
                disabled={isMainOnlyPending}
                title="사진에 여러 조각이 섞여 있을 때 가장 큰 상품 하나만 남겨요"
                className="text-[11px] text-accent font-semibold disabled:opacity-50"
              >
                {isMainOnlyPending ? '처리 중...' : '대표 상품만'}
              </button>
            )}
            <button
              onClick={handleRevert}
              disabled={isRevertPending}
              title="수정하거나 다시 만들기 전 버전으로 되돌려요 (다시 누르면 원래대로)"
              className="text-[11px] text-accent font-semibold disabled:opacity-50"
            >
              {isRevertPending ? '되돌리는 중...' : '되돌리기'}
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
      {revertMsg && <p className="text-[10px] text-warn text-center px-1 max-w-[16rem]">{revertMsg}</p>}
      {mainOnlyError && <p className="text-[10px] text-warn text-center px-1 max-w-[16rem]">{mainOnlyError}</p>}
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
  library = [],
}: {
  project: any;
  styleBrief?: any; // category_style_briefs 행 (이 프로젝트 카테고리에 학습된 스타일)
  onClose: () => void;
  library?: LibraryPhoto[]; // 이전에 올려서 저장돼 있는 상품 사진들 (모든 프로젝트)
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
  // 이전에 올린 사진을 골라 넣은 칸이면 그 사진의 행 id(아니면 null). batchFiles/batchPreviews와
  // 같은 순서의 칸이고, 이 칸의 batchFiles 항목은 자리만 채우는 빈 파일이다(서버엔 id만 보낸다).
  const [batchSavedIds, setBatchSavedIds] = useState<(string | null)[]>([]);
  const [batchUrl, setBatchUrl] = useState('');
  // 색상(묶음)마다 만들 추가 이미지 개수. 키는 색상 라벨('' = 색상 미지정/URL 입력).
  // 아직 안 건드린 색상은 기본 5장.
  const [batchCounts, setBatchCounts] = useState<Record<string, number>>({});
  // 패키지(세트) 구성: 예) 검정 1 + 회색 1을 한 패키지로 파는 상품. 구성 그대로 한 장에 담은 메인 + 추가 이미지를 만든다.
  const [packages, setPackages] = useState<{ id: string; items: { color: string; qty: number }[]; additional: number; template?: TemplateChoice; flip?: boolean; badge?: boolean; badgeShape?: BadgeShape; badgeColor?: BadgeColor }[]>([]);
  const [packageOnly, setPackageOnly] = useState(false);
  const [productNote, setProductNote] = useState('');
  // 메인 썸네일에 적용할 요청(선택). 메인은 쿠팡 규정대로 흰 배경이라 기본은 비워둔다.
  const [mainPrompt, setMainPrompt] = useState('');
  // 장면을 AI가 학습한 스타일/기본 구성에 맡기지 않고 직접 입력하고 싶을 때
  // ("추가 이미지에다가 프롬프트를 내가 입력할 수 있어야해"라는 요청으로 추가) -
  // 입력하면 모든 추가 이미지가 이 장면 하나로 만들어진다.
  const [customScenePrompt, setCustomScenePrompt] = useState('');
  const [batchResult, setBatchResult] = useState<string | null>(null);
  // 적어둔 입력(URL·수량·패키지·메모)은 만들기를 돌린 뒤에도 남기고, 돌릴 때마다 기록해서 이전 입력으로 되돌릴 수 있게 한다
  const savedForm = useSavedForm(
    `thumb:${project.id}`,
    { batchUrl, batchCounts, packages, packageOnly, productNote, mainPrompt, customScenePrompt },
    (v) => {
      if (typeof v.mainPrompt === 'string') setMainPrompt(v.mainPrompt);
      if (typeof v.batchUrl === 'string') setBatchUrl(v.batchUrl);
      if (v.batchCounts && typeof v.batchCounts === 'object') setBatchCounts(v.batchCounts as Record<string, number>);
      if (Array.isArray(v.packages)) {
        setPackages(
          (v.packages as any[]).map((p) => ({ ...p, template: p.template ?? (p.layout === 'hero' ? 'hero-side' : 'grid') })) as typeof packages
        );
      }
      if (typeof v.packageOnly === 'boolean') setPackageOnly(v.packageOnly);
      if (typeof v.productNote === 'string') setProductNote(v.productNote);
      if (typeof v.customScenePrompt === 'string') setCustomScenePrompt(v.customScenePrompt);
    }
  );
  const [batchNotes, setBatchNotes] = useState<string[]>([]);
  const batchFileInputRef = useRef<HTMLInputElement>(null);

  // 메인은 그대로 두고 추가 이미지만 몇 장 더 만들기 - 사진을 다시 올릴 필요 없이
  // 저장해둔 메인의 원본 사진을 재사용한다. 키는 색상 라벨('' = 색상 미지정).
  const [moreCounts, setMoreCounts] = useState<Record<string, number>>({});
  const [moreResult, setMoreResult] = useState<Record<string, string>>({});
  const [morePrompt, setMorePrompt] = useState('');

  // 일괄 생성 박스의 카테고리(쿠팡 검색어) - 이걸로 인기상품을 분석해서 참고한다.
  // 위쪽 카테고리 설정과 같은 값이라, 거기서 바꾸면 여기도 따라가게 동기화한다.
  const [batchCategory, setBatchCategory] = useState(project.category || '');
  useEffect(() => {
    setBatchCategory(project.category || '');
  }, [project.category]);

  // 여러 장 선택해서 한 번에 삭제
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectMany = (ids: string[], on: boolean) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const DEFAULT_ADDITIONAL = 5;
  const MAX_ADDITIONAL = 8;
  // 올린 사진들이 어떤 색상 묶음으로 나뉘는지 (서버가 묶는 규칙과 같다: 라벨 같은
  // 사진끼리, 라벨 없는 사진은 한 묶음). URL 입력이면 묶음 하나.
  const batchColorKeys: string[] =
    batchFiles.length > 0
      ? Array.from(new Set(batchFiles.map((_, i) => (batchColorLabels[i] || '').trim())))
      : [''];
  const batchPhotoCount = (key: string) =>
    batchFiles.filter((_, i) => (batchColorLabels[i] || '').trim() === key).length;
  const batchCountOf = (key: string) => Math.min(MAX_ADDITIONAL, Math.max(0, batchCounts[key] ?? DEFAULT_ADDITIONAL));
  const batchAdditionalTotal = batchColorKeys.reduce((sum, k) => sum + batchCountOf(k), 0);
  // 패키지에 쓸 수 있는 색상 = 사진에 색상 라벨을 적은 색상
  const packageColors = batchColorKeys.filter((k) => k);
  const patchPackage = (id: string, fn: (p: (typeof packages)[number]) => (typeof packages)[number]) =>
    setPackages((prev) => prev.map((p) => (p.id === id ? fn(p) : p)));
  const validPackages = packages
    .map((p) => ({ ...p, items: p.items.filter((i) => i.color && packageColors.includes(i.color) && i.qty >= 1) }))
    .filter((p) => p.items.length > 0);
  const packageUnitCount = (p: { items: { qty: number }[] }) => p.items.reduce((s, i) => s + i.qty, 0);
  const usePackageOnly = packageOnly && validPackages.length > 0;
  const setBatchCountFor = (key: string, value: number) =>
    setBatchCounts((prev) => ({
      ...prev,
      [key]: Math.min(MAX_ADDITIONAL, Math.max(0, Number.isFinite(value) ? Math.round(value) : DEFAULT_ADDITIONAL)),
    }));
  const moreCountOf = (key: string) => Math.min(MAX_ADDITIONAL, Math.max(1, moreCounts[key] ?? DEFAULT_ADDITIONAL));
  const setMoreCountFor = (key: string, value: number) =>
    setMoreCounts((prev) => ({
      ...prev,
      [key]: Math.min(MAX_ADDITIONAL, Math.max(1, Number.isFinite(value) ? Math.round(value) : DEFAULT_ADDITIONAL)),
    }));

  const images: any[] = project.thumbnail_images || [];
  const mainImages = images.filter((i) => i.kind === 'main');
  const additionalImages = [...images.filter((i) => i.kind === 'additional')].sort((a, b) => a.position - b.position);
  // 색상 라벨별로 묶어서 보여준다 - 라벨이 없는(null) 기존 데이터는
  // 그대로 "기본" 그룹 하나로 표시돼서 이전 화면과 동일하게 보인다.
  const colorGroupKeys = Array.from(
    new Set([...mainImages, ...additionalImages].map((i) => i.color_label || ''))
  ).sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));

  function handleGenerateMain() {
    if (!draftHasPhoto(mainDraft)) return;
    setError(null);
    const fd = new FormData();
    if (mainDraft.file) fd.set('image', mainDraft.file);
    else if (mainDraft.savedId) fd.set('savedPhotoId', mainDraft.savedId);
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
    if (!draftHasPhoto(draft)) return;
    setError(null);
    const fd = new FormData();
    if (draft.file) fd.set('image', draft.file);
    else if (draft.savedId) fd.set('savedPhotoId', draft.savedId);
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
    savedForm.snapshot();
    setError(null);
    setBatchResult(null);
    setBatchNotes([]);
    const fd = new FormData();
    if (batchFiles.length > 0) {
      // 색상 라벨이 같은 사진끼리 서버에서 그룹으로 묶여서, 같은 라벨
      // 중 먼저 온 사진이 그 색상의 메인이 된다. 새로 올린 사진은 파일로, 이전에 올린 사진을
      // 고른 칸은 행 id로 보내고, 고른 순서는 photoOrder('f'=파일, 's'=저장된 사진)로 알려준다.
      const order: ('f' | 's')[] = [];
      const savedPhotos: { id: string; colorLabel: string }[] = [];
      batchFiles.forEach((f, i) => {
        const savedId = batchSavedIds[i];
        if (savedId) {
          order.push('s');
          savedPhotos.push({ id: savedId, colorLabel: (batchColorLabels[i] || '').trim() });
        } else {
          order.push('f');
          fd.append('images', f);
          fd.append('colorLabels', batchColorLabels[i] || '');
        }
      });
      fd.set('photoOrder', JSON.stringify(order));
      fd.set('savedPhotos', JSON.stringify(savedPhotos));
    } else {
      fd.set('imageUrl', batchUrl.trim());
    }
    fd.set('category', batchCategory.trim());
    fd.set('productNote', productNote.trim());
    fd.set('mainPrompt', mainPrompt.trim());
    fd.set('customPrompt', customScenePrompt.trim());
    fd.set('packages', JSON.stringify(validPackages.map((p) => ({ items: p.items, additional: p.additional, template: p.template, flip: p.flip, badge: p.badge, badgeShape: p.badgeShape, badgeColor: p.badgeColor }))));
    if (usePackageOnly) fd.set('packageOnly', '1');
    fd.set('additionalCount', String(DEFAULT_ADDITIONAL));
    fd.set(
      'additionalCounts',
      JSON.stringify(Object.fromEntries(batchColorKeys.map((k) => [k, batchCountOf(k)])))
    );
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
          (res.packageTotal > 0 ? ` · 패키지 ${res.packageOk}/${res.packageTotal}개` : '') +
          ` · 추가 이미지 ${res.additionalOk}/${res.additionalTotal}장 생성 완료` +
          (res.styleKind === 'learned'
            ? ` (쿠팡 인기상품 ${res.styleSourceCount}개 분석${
                res.styleAnalysis ? ` · 갤러리 이미지 ${res.styleAnalysis.galleryImages}장` : ''
              } 스타일 적용)`
            : ' (범용 기본 구성 - 쿠팡 참고 없음)')
      );
      setBatchNotes(res.notes);
      setBatchFiles([]);
      setBatchPreviews([]);
      setBatchColorLabels([]);
      setBatchSavedIds([]);
      setBatchCounts({});
      setPackages([]);
      setPackageOnly(false);
      setBatchUrl('');
    });
  }

  function handleGenerateMore(colorKey: string) {
    setError(null);
    const count = moreCountOf(colorKey);
    const busyKey = `more:${colorKey}`;
    setMoreResult((prev) => ({ ...prev, [colorKey]: '' }));
    setBusyId(busyKey);
    startTransition(async () => {
      const res = await generateMoreAdditionalImages(project.id, colorKey, count, productNote, morePrompt);
      setBusyId(null);
      if (!res || 'error' in res) {
        setError(res?.error ?? '요청이 실패했어요. 다시 시도해주세요.');
        return;
      }
      setMoreResult((prev) => ({ ...prev, [colorKey]: `추가 이미지 ${res.ok}/${res.total}장 더 생성 완료` }));
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
        `쿠팡 인기상품 ${res.sourceCount}개를 분석해서 스타일을 새로 학습했어요.` +
          (res.analysis
            ? res.analysis.galleryImages > 0
              ? ` (상품 ${res.analysis.galleryProducts}개의 추가 이미지 ${res.analysis.galleryImages}장 포함)`
              : ' 다만 상품 페이지의 추가 이미지는 읽지 못해서 대표 이미지만 분석했어요.'
            : '') +
          (res.warning ? ` ${res.warning}` : '')
      );
    });
  }

  // 존재하지 않게 된 이미지는 선택에서 빼서 개수가 어긋나지 않게 한다
  const existingIds = new Set<string>((project.thumbnail_images || []).map((i: any) => i.id));
  const selectedList = Array.from(selectedIds).filter((id) => existingIds.has(id));

  // 다운로드 순서/이름: 메인 -> 추가 이미지 (화면에 보이는 순서와 같게 번호를 붙인다)
  const downloadables = [...mainImages, ...additionalImages]
    .filter((i) => i.output_image_url)
    .map((i, idx) => {
      const isMain = i.kind === 'main';
      const color = i.color_label ? `_${i.color_label}` : '';
      const base = isMain ? `메인${color}` : `추가${String(i.position + 1).padStart(2, '0')}${color}`;
      const title = isMain
        ? `메인 썸네일${i.color_label ? ` · ${i.color_label}` : ''}`
        : i.style_spec?.shot?.title
          ? `컷: ${i.style_spec.shot.title}`
          : `추가 이미지 ${i.position + 1}`;
      return {
        id: i.id as string,
        url: i.output_image_url as string,
        name: `${safeFileName(`썸네일_${String(idx + 1).padStart(2, '0')}_${base}`)}.jpg`,
        title,
      };
    });
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewIndex = previewId ? downloadables.findIndex((d) => d.id === previewId) : -1;
  const openPreview = (id: string) => setPreviewId(id);
  const [dlBusy, setDlBusy] = useState<string | null>(null);
  const [dlMsg, setDlMsg] = useState<string | null>(null);
  const [dlError, setDlError] = useState<string | null>(null);

  async function handleDownloadOne(img: any) {
    const d = downloadables.find((x) => x.id === img.id);
    if (!d) return;
    setDlBusy(d.id);
    setDlError(null);
    try {
      await downloadImage(d.url, d.name);
    } catch (e: any) {
      setDlError(e?.message || '다운로드에 실패했어요. 다시 시도해주세요.');
    } finally {
      setDlBusy(null);
    }
  }

  async function handleDownloadZip(ids: string[] | null) {
    const list = downloadables.filter((d) => !ids || ids.includes(d.id));
    if (list.length === 0) {
      setDlError('내려받을 이미지가 없어요. 생성이 끝난 이미지만 받을 수 있어요.');
      return;
    }
    setDlBusy('zip');
    setDlError(null);
    setDlMsg(`0/${list.length}장 받는 중...`);
    try {
      const zipName = `${safeFileName(`썸네일_${project.title || '이미지'}_${list.length}장`)}.zip`;
      const r = await downloadImagesZip(list, zipName, (done, total) => setDlMsg(`${done}/${total}장 받는 중...`));
      const failedNote =
        r.failed.length > 0 ? ` (${r.failed.length}장은 받지 못했어요: ${r.failed.slice(0, 3).join(', ')}${r.failed.length > 3 ? ' 외' : ''})` : '';
      setDlMsg(`${r.ok}장을 ZIP으로 받았어요.${failedNote}`);
    } catch (e: any) {
      setDlMsg(null);
      setDlError(e?.message || 'ZIP 다운로드에 실패했어요. 다시 시도해주세요.');
    } finally {
      setDlBusy(null);
    }
  }

  function handleDeleteSelected() {
    if (selectedList.length === 0) return;
    if (!window.confirm(`선택한 이미지 ${selectedList.length}장을 삭제할까요? 되돌릴 수 없어요.`)) return;
    setError(null);
    setDeleteMsg(null);
    setBusyId('bulk-delete');
    startTransition(async () => {
      const res = await deleteThumbnailImages(project.id, selectedList);
      setBusyId(null);
      if (!res || 'error' in res) {
        setError(res?.error ?? '삭제에 실패했어요. 다시 시도해주세요.');
        return;
      }
      setSelectedIds(new Set());
      setDeleteMsg(`${res.deleted}장을 삭제했어요.`);
    });
  }

  function handleBatchFileRemove(index: number) {
    setBatchFiles((prev) => prev.filter((_, i) => i !== index));
    setBatchPreviews((prev) => prev.filter((_, i) => i !== index));
    setBatchColorLabels((prev) => prev.filter((_, i) => i !== index));
    setBatchSavedIds((prev) => prev.filter((_, i) => i !== index));
  }

  // 이전에 올린 사진을 일괄 생성 목록에 한 칸으로 추가 (색상 이름도 같이 가져온다)
  function handleBatchPickSaved(photo: LibraryPhoto) {
    setBatchFiles((prev) => [...prev, new File([], `saved-${photo.id}`)]);
    setBatchPreviews((prev) => [...prev, photo.url]);
    setBatchColorLabels((prev) => [...prev, photo.colorLabel || '']);
    setBatchSavedIds((prev) => [...prev, photo.id]);
    setBatchUrl('');
  }

  function handleRetry(imageId: string, extraPrompt?: string) {
    setBusyId(imageId);
    setError(null);
    startTransition(async () => {
      const res = await retryThumbnailImage(imageId, extraPrompt || '');
      setBusyId(null);
      if (res && 'error' in res) setError(res.error);
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
              {styleBrief.brief.analysis ? (
                <p className={styleBrief.brief.analysis.galleryImages > 0 ? 'text-profit' : 'text-warn'}>
                  {styleBrief.brief.analysis.galleryImages > 0
                    ? `분석 범위: 대표 이미지 ${styleBrief.brief.analysis.mainImages}장 + 상품 ${styleBrief.brief.analysis.galleryProducts}개의 추가 이미지(갤러리) ${styleBrief.brief.analysis.galleryImages}장`
                    : `분석 범위: 대표 이미지 ${styleBrief.brief.analysis.mainImages}장만 (상품 페이지의 추가 이미지는 읽지 못했어요)`}
                </p>
              ) : (
                <p className="text-warn">
                  예전 방식(대표 이미지만 분석)으로 학습된 스타일이에요. "스타일 다시 학습"을 누르면 추가 이미지까지
                  분석해요.
                </p>
              )}
              <p className="text-inkSoft leading-relaxed">{styleBrief.brief.summary}</p>
              <div className="flex flex-wrap gap-1.5">
                {(styleBrief.brief.shots || []).map((s: any) => (
                  <span key={s.id} className="px-2 py-0.5 rounded-full bg-white border border-paperLine text-[11px]">
                    {s.title}
                    {s.layout === 'bullets' ? ' · 목록형' : s.layout === 'badge' ? ' · 배지형' : ''}
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
            <strong> 추가 이미지는 한국어 강조 문구가 들어간 연출 컷</strong>으로 한 번에 만들어요. 위에서
            <strong>카테고리를 설정</strong>하면 쿠팡 인기상품을 분석해 학습한 스타일로, 안 하면 범용 기본
            구성(스튜디오·디테일·연출 컷 등)으로 만들어요. 사진마다 <strong>색상을 태그</strong>하면 같은 색상끼리
            묶여서, <strong>색상마다 메인 1장 + 추가 이미지</strong>가 따로 만들어져요(같은 색상 중 먼저 선택한
            사진이 그 색상의 메인). 추가 이미지 개수는 아래에서 색상별로 정할 수 있어요. 문구는 AI가 만든
            초안이니 사실과 다른 내용이 없는지 확인하세요.
          </p>
        </div>

        <div className="grid gap-1 max-w-md">
          <label className="text-[11px] font-semibold text-inkSoft">
            쿠팡 검색어(카테고리) - 이 검색어의 인기상품을 분석해서 참고해요
          </label>
          <input
            value={batchCategory}
            onChange={(e) => setBatchCategory(e.target.value)}
            placeholder="예: 남성 팬티, 휴대용 선풍기"
            className={`border bg-white px-2 py-1.5 text-xs w-full ${
              batchCategory.trim() ? 'border-paperLine' : 'border-warn'
            }`}
          />
          {!batchCategory.trim() && (
            <p className="text-[11px] text-warn">
              비워두면 쿠팡 인기상품을 참고하지 않고 범용 기본 구성으로 만들어요.
            </p>
          )}
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
            setBatchSavedIds((prev) => [...prev, ...shrunk.map(() => null)]);
            setBatchUrl('');
            e.target.value = '';
          }}
        />

        {/* 매번 새로 올리지 않도록, 예전에 올렸던 사진을 바로 골라서 쓴다 */}
        <SavedPhotoPicker
          photos={library}
          currentProjectId={project.id}
          pickedIds={batchSavedIds.filter((x): x is string => !!x)}
          onPick={handleBatchPickSaved}
        />

        <FormHistoryPicker
          history={savedForm.history}
          onRestore={savedForm.restore}
          status={savedForm.status}
          describe={(v) => [v.batchUrl, v.productNote].filter(Boolean).join(' / ') || '(빈 입력)'}
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
                setBatchSavedIds([]);
              }
            }}
            disabled={batchFiles.length > 1}
            placeholder="또는 이미지 URL 1개 붙여넣기 (예: 1688에서 복사한 사진 주소)"
            className="border border-paperLine bg-white px-2 py-1.5 text-xs w-full disabled:opacity-50"
          />
          {batchFiles.length <= 1 && <UrlWarning url={batchUrl} />}
          {(batchFiles.length > 0 || batchUrl.trim()) && (
            <div className="grid gap-1.5 bg-paper rounded p-2.5">
              <p className="text-[11px] font-semibold text-inkSoft">
                색상별 추가 이미지 개수 (메인은 색상마다 1장, 추가는 0~{MAX_ADDITIONAL}장)
              </p>
              {batchColorKeys.map((key) => (
                <div key={key || '__none__'} className="flex items-center gap-2 text-xs">
                  <span className="flex-1 min-w-0 truncate">
                    {key || (batchColorKeys.length > 1 ? '색상 미지정' : '추가 이미지')}
                    {batchFiles.length > 0 && (
                      <span className="text-inkSoft"> · 사진 {batchPhotoCount(key)}장</span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => setBatchCountFor(key, batchCountOf(key) - 1)}
                    disabled={batchCountOf(key) <= 0}
                    className="w-6 h-6 rounded border border-paperLine bg-white disabled:opacity-40"
                    aria-label="개수 줄이기"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={0}
                    max={MAX_ADDITIONAL}
                    value={batchCountOf(key)}
                    onChange={(e) => setBatchCountFor(key, Number(e.target.value))}
                    className="w-12 border border-paperLine bg-white px-1 py-0.5 text-center font-mono"
                    aria-label={`${key || '추가 이미지'} 추가 이미지 개수`}
                  />
                  <button
                    type="button"
                    onClick={() => setBatchCountFor(key, batchCountOf(key) + 1)}
                    disabled={batchCountOf(key) >= MAX_ADDITIONAL}
                    className="w-6 h-6 rounded border border-paperLine bg-white disabled:opacity-40"
                    aria-label="개수 늘리기"
                  >
                    +
                  </button>
                  <span className="text-inkSoft">장</span>
                </div>
              ))}
              {batchAdditionalTotal + batchColorKeys.length > 12 && (
                <p className="text-[11px] text-warn">
                  한 번에 12장을 넘으면 시간이 오래 걸려 일부가 만들어지지 않을 수 있어요. 색상을 나눠서 생성하는 걸
                  권장해요.
                </p>
              )}
            </div>
          )}
          {(batchFiles.length > 0 || batchUrl.trim()) && (
            <label className="grid gap-1 text-[11px] font-semibold text-inkSoft">
              메인 썸네일 프롬프트 (선택 - 메인 썸네일 전체에 적용. 메인은 쿠팡 규정상 흰 배경이라 배경을 바꾸는 요청은 피하세요)
              <textarea
                value={mainPrompt}
                onChange={(e) => setMainPrompt(e.target.value)}
                rows={2}
                placeholder="예: 그림자를 연하게, 상품을 조금 더 크게 (비우면 규정대로 흰 배경 메인만 만들어요)"
                className="border border-paperLine bg-white px-2 py-1.5 text-xs font-normal text-ink"
              />
            </label>
          )}
          {(batchFiles.length > 0 || batchUrl.trim()) && (
            <label className="grid gap-1 text-[11px] font-semibold text-inkSoft">
              상품 특징 메모 (AI가 꼭 지킬 내용 - 추가 이미지 전체에 적용)
              <textarea
                value={productNote}
                onChange={(e) => setProductNote(e.target.value)}
                rows={2}
                placeholder="예: 허벅지까지 올라오는 롱양말(니하이)이에요. 스타킹·타이츠·발목양말처럼 그리지 마세요."
                className="border border-paperLine bg-white px-2 py-1.5 text-xs font-normal text-ink"
              />
            </label>
          )}
          {(batchFiles.length > 0 || batchUrl.trim()) && (
            <label className="grid gap-1 text-[11px] font-semibold text-inkSoft">
              장면 프롬프트 직접 입력 (선택 - 입력하면 학습된 스타일 대신 이 장면으로 추가 이미지를 전부 만들어요)
              <textarea
                value={customScenePrompt}
                onChange={(e) => setCustomScenePrompt(e.target.value)}
                rows={2}
                placeholder="예: 눈이 소복이 쌓인 겨울 현관 바닥에 놓인 모습, 따뜻한 느낌의 조명"
                className="border border-paperLine bg-white px-2 py-1.5 text-xs font-normal text-ink"
              />
            </label>
          )}
          {batchFiles.length > 0 && (
            <div className="grid gap-2 bg-paper rounded p-2.5">
              <p className="text-[11px] font-semibold text-inkSoft">
                패키지(세트) 구성 - 예: 검정 1 + 회색 1을 한 패키지로 판매
              </p>
              {packageColors.length === 0 ? (
                <p className="text-[11px] text-inkSoft">
                  패키지를 만들려면 위 사진마다 색상을 적어주세요 (예: 검정, 회색). 색상별 사진을 구성 수량대로 한 장에 담아요.
                </p>
              ) : (
                <>
                  {packages.map((p, pi) => (
                    <div key={p.id} className="grid gap-1.5 bg-white rounded border border-paperLine p-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold">
                          패키지 {pi + 1}{' '}
                          <span className="font-normal text-inkSoft">
                            ({p.items.map((i) => `${i.color || '색상 선택'} ${i.qty}`).join(' + ')})
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setPackages((prev) => prev.filter((x) => x.id !== p.id))}
                          className="text-[11px] text-inkSoft hover:text-red-700"
                        >
                          삭제
                        </button>
                      </div>
                      {p.items.map((it, ii) => (
                        <div key={ii} className="flex items-center gap-2 text-xs">
                          <select
                            value={it.color}
                            onChange={(e) =>
                              patchPackage(p.id, (x) => ({
                                ...x,
                                items: x.items.map((y, j) => (j === ii ? { ...y, color: e.target.value } : y)),
                              }))
                            }
                            className="border border-paperLine bg-white px-2 py-1 text-xs flex-1 min-w-0"
                          >
                            <option value="">색상 선택</option>
                            {packageColors.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() =>
                              patchPackage(p.id, (x) => ({
                                ...x,
                                items: x.items.map((y, j) => (j === ii ? { ...y, qty: Math.max(1, y.qty - 1) } : y)),
                              }))
                            }
                            disabled={it.qty <= 1}
                            className="w-6 h-6 rounded border border-paperLine bg-white disabled:opacity-40"
                            aria-label="수량 줄이기"
                          >
                            −
                          </button>
                          <span className="w-6 text-center font-mono">{it.qty}</span>
                          <button
                            type="button"
                            onClick={() =>
                              patchPackage(p.id, (x) => ({
                                ...x,
                                items: x.items.map((y, j) => (j === ii ? { ...y, qty: Math.min(6, y.qty + 1) } : y)),
                              }))
                            }
                            disabled={it.qty >= 6 || packageUnitCount(p) >= 8}
                            className="w-6 h-6 rounded border border-paperLine bg-white disabled:opacity-40"
                            aria-label="수량 늘리기"
                          >
                            +
                          </button>
                          <span className="text-inkSoft">개</span>
                          <button
                            type="button"
                            onClick={() => patchPackage(p.id, (x) => ({ ...x, items: x.items.filter((_, j) => j !== ii) }))}
                            className="text-[11px] text-inkSoft hover:text-red-700"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() =>
                            patchPackage(p.id, (x) => ({ ...x, items: [...x.items, { color: '', qty: 1 }] }))
                          }
                          disabled={packageUnitCount(p) >= 8}
                          className="text-[11px] text-accent font-semibold disabled:opacity-40"
                        >
                          + 색상 추가
                        </button>
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <label className="flex items-center gap-1">
                            <span className="text-inkSoft">배치</span>
                            <select
                              value={p.template || 'grid'}
                              onChange={(e) => patchPackage(p.id, (x) => ({ ...x, template: e.target.value as TemplateChoice }))}
                              className="border border-paperLine rounded px-1 py-0.5 bg-white"
                            >
                              <option value="grid">나열형 (같은 크기로 나란히)</option>
                              <option value="auto">자동 추천 (수량·형태에 맞춰)</option>
                              {PACKAGE_TEMPLATES.filter((t) => t.id !== 'grid').map((t) => (
                                <option key={t.id} value={t.id} disabled={!templateFits(t.id, packageUnitCount(p))}>
                                  {t.name} ({t.min}~{t.max}개)
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="flex items-center gap-1" title="상품 위치를 좌우로 뒤집어요 (상품 사진 자체는 뒤집지 않아요)">
                            <input
                              type="checkbox"
                              checked={!!p.flip}
                              onChange={(e) => patchPackage(p.id, (x) => ({ ...x, flip: e.target.checked }))}
                            />
                            <span>좌우 반전</span>
                          </label>
                          <label className="flex items-center gap-1" title="맨 위 모서리에 수량 배지(예: 5P)를 붙여요. 메인 이미지에만 붙어요">
                            <input
                              type="checkbox"
                              checked={!!p.badge}
                              onChange={(e) => patchPackage(p.id, (x) => ({ ...x, badge: e.target.checked }))}
                            />
                            <span>수량 배지({packageUnitCount(p)}P)</span>
                          </label>
                          {p.badge && (
                            <>
                              <select
                                value={p.badgeShape || 'circle'}
                                onChange={(e) => patchPackage(p.id, (x) => ({ ...x, badgeShape: e.target.value as BadgeShape }))}
                                className="border border-paperLine rounded px-1 py-0.5 bg-white"
                                aria-label="배지 모양"
                              >
                                {BADGE_SHAPES.map((b) => (
                                  <option key={b.id} value={b.id}>
                                    {b.name}
                                  </option>
                                ))}
                              </select>
                              <select
                                value={p.badgeColor || 'navy'}
                                onChange={(e) => patchPackage(p.id, (x) => ({ ...x, badgeColor: e.target.value as BadgeColor }))}
                                className="border border-paperLine rounded px-1 py-0.5 bg-white"
                                aria-label="배지 색"
                              >
                                {BADGE_COLORS.map((b) => (
                                  <option key={b.id} value={b.id}>
                                    {b.name}
                                  </option>
                                ))}
                              </select>
                            </>
                          )}
                          {p.template && p.template !== 'grid' && p.template !== 'auto' && !templateFits(p.template, packageUnitCount(p)) && (
                            <span className="text-[11px] text-amber-700">이 배치는 상품 수가 안 맞아 나열형으로 만들어져요</span>
                          )}
                          {p.template === 'auto' && (
                            <span className="text-[11px] text-inkSoft">
                              {packageUnitCount(p) < 3 ? '2개 이하는 나열형으로 만들어요' : '상품이 가로로 넓은지 세로로 긴지 보고 골라요'}
                            </span>
                          )}
                          {p.template && p.template !== 'grid' && p.template !== 'auto' && getTemplate(p.template) && (
                            <span className="text-[11px] text-inkSoft">잘 맞는 상품: {getTemplate(p.template)!.best}</span>
                          )}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="text-inkSoft">추가 이미지</span>
                          <button
                            type="button"
                            onClick={() => patchPackage(p.id, (x) => ({ ...x, additional: Math.max(0, x.additional - 1) }))}
                            disabled={p.additional <= 0}
                            className="w-6 h-6 rounded border border-paperLine bg-white disabled:opacity-40"
                          >
                            −
                          </button>
                          <span className="w-5 text-center font-mono">{p.additional}</span>
                          <button
                            type="button"
                            onClick={() =>
                              patchPackage(p.id, (x) => ({ ...x, additional: Math.min(MAX_ADDITIONAL, x.additional + 1) }))
                            }
                            disabled={p.additional >= MAX_ADDITIONAL}
                            className="w-6 h-6 rounded border border-paperLine bg-white disabled:opacity-40"
                          >
                            +
                          </button>
                          <span className="text-inkSoft">장</span>
                        </span>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setPackages((prev) => [
                        ...prev,
                        {
                          id: crypto.randomUUID(),
                          items: packageColors.slice(0, 4).map((c) => ({ color: c, qty: 1 })),
                          additional: 3,
                        },
                      ])
                    }
                    disabled={packages.length >= 4}
                    className="text-xs text-accent font-semibold justify-self-start disabled:opacity-40"
                  >
                    + 패키지 추가 (색상별 1개씩으로 시작)
                  </button>
                  {packages.length > 0 && (
                    <>
                      <label className="flex items-center gap-2 text-[11px]">
                        <input type="checkbox" checked={packageOnly} onChange={(e) => setPackageOnly(e.target.checked)} />
                        패키지 이미지만 만들기 (색상별 개별 메인/추가 이미지는 만들지 않아요)
                      </label>
                      <p className="text-[11px] text-inkSoft">
                        수량 1 = 그 색상 사진에 찍힌 상품 한 묶음(사진에 보이는 그대로)이에요. 패키지 메인은 색상별 사진을 누끼로
                        따서 정해진 수량만큼 코드로 배치하므로 색상과 개수가 틀리지 않아요. 추가 이미지는 그 패키지 메인을 상품으로
                        써서 만들어요.
                      </p>
                    </>
                  )}
                </>
              )}
            </div>
          )}
          <button
            onClick={handleBatchGenerate}
            disabled={(isPending && busyId === 'batch') || (batchFiles.length === 0 && !batchUrl.trim())}
            className="btn-primary px-4 py-1.5 text-xs font-semibold disabled:opacity-50 justify-self-start"
          >
            {isPending && busyId === 'batch'
              ? '생성 중... (시간이 좀 걸려요)'
              : usePackageOnly
                ? `패키지 ${validPackages.length}개 (메인 ${validPackages.length}장 + 추가 ${validPackages.reduce((s, p) => s + p.additional, 0)}장) 한 번에 생성`
                : `메인 ${batchColorKeys.length}장 + 추가 ${batchAdditionalTotal}장${validPackages.length > 0 ? ` + 패키지 ${validPackages.length}개 (메인 ${validPackages.length}장 + 추가 ${validPackages.reduce((s, p) => s + p.additional, 0)}장)` : ''} 한 번에 생성`}
          </button>
          {batchResult && <p className="text-[11px] text-accent">{batchResult}</p>}
          {batchNotes.map((n, i) => (
            <p
              key={i}
              className={`text-[11px] rounded px-2 py-1.5 ${
                n.startsWith('⚠') ? 'bg-warnBg text-warn font-semibold' : 'bg-paper text-inkSoft'
              }`}
            >
              {n}
            </p>
          ))}

          {mainImages.length > 0 && (
            <div className="grid gap-2 border-t border-paperLine pt-3 mt-1">
              <p className="text-[11px] font-semibold text-inkSoft">
                메인은 그대로 두고 추가 이미지만 더 만들기 (사진을 다시 올릴 필요 없이 저장된 메인 사진을 재사용해요)
              </p>
              <label className="grid gap-1 text-[11px] font-semibold text-inkSoft">
                장면 프롬프트 직접 입력 (선택 - 비우면 학습된 스타일에서 자동으로 골라요)
                <textarea
                  value={morePrompt}
                  onChange={(e) => setMorePrompt(e.target.value)}
                  rows={2}
                  placeholder="예: 거실 러그 위에 올려둔 모습, 은은한 아침 햇살"
                  className="border border-paperLine bg-white px-2 py-1.5 text-xs font-normal text-ink"
                />
              </label>
              <div className="grid gap-2">
                {colorGroupKeys
                  .filter((key) => mainImages.some((i) => (i.color_label || '') === key))
                  .map((key) => {
                    const busyKey = `more:${key}`;
                    return (
                      <div key={key || '__default__'} className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-semibold text-accent min-w-[4rem]">
                          {key || (colorGroupKeys.length > 1 ? '색상 미지정' : '추가 이미지')}
                        </span>
                        <button
                          type="button"
                          onClick={() => setMoreCountFor(key, moreCountOf(key) - 1)}
                          disabled={moreCountOf(key) <= 1}
                          className="w-6 h-6 rounded border border-paperLine bg-white disabled:opacity-40"
                          aria-label="개수 줄이기"
                        >
                          −
                        </button>
                        <span className="w-6 text-center font-mono">{moreCountOf(key)}</span>
                        <button
                          type="button"
                          onClick={() => setMoreCountFor(key, moreCountOf(key) + 1)}
                          disabled={moreCountOf(key) >= MAX_ADDITIONAL}
                          className="w-6 h-6 rounded border border-paperLine bg-white disabled:opacity-40"
                          aria-label="개수 늘리기"
                        >
                          +
                        </button>
                        <span className="text-inkSoft">장</span>
                        <button
                          type="button"
                          onClick={() => handleGenerateMore(key)}
                          disabled={isPending && busyId === busyKey}
                          className="rounded border border-accent text-accent px-3 py-1 font-semibold disabled:opacity-50"
                        >
                          {isPending && busyId === busyKey ? '생성 중...' : `${moreCountOf(key)}장 더 만들기`}
                        </button>
                        {moreResult[key] && <span className="text-[11px] text-accent">{moreResult[key]}</span>}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      </section>

      {downloadables.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs bg-paper rounded-md px-3 py-2">
          <span className="font-semibold">전체 {downloadables.length}장</span>
          <button
            type="button"
            onClick={() => selectMany(downloadables.map((d) => d.id), !downloadables.every((d) => selectedIds.has(d.id)))}
            className="text-accent font-semibold"
          >
            {downloadables.every((d) => selectedIds.has(d.id)) ? '전체 선택 해제' : '전체 선택'}
          </button>
          <button
            type="button"
            onClick={() => handleDownloadZip(null)}
            disabled={dlBusy === 'zip'}
            className="text-accent font-semibold disabled:opacity-50"
          >
            {dlBusy === 'zip' ? dlMsg || '묶는 중...' : '전체 다운로드 (ZIP)'}
          </button>
          <span className="text-inkSoft">이미지를 누르면 크게 볼 수 있어요</span>
        </div>
      )}

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
                onRetry={(p) => handleRetry(mainImages[0].id, p)}
                onDelete={() => startTransition(() => deleteThumbnailImage(mainImages[0].id))}
                busy={isPending && busyId === mainImages[0].id}
                selected={selectedIds.has(mainImages[0].id)}
                onToggleSelect={() => toggleSelect(mainImages[0].id)}
                onPreview={() => openPreview(mainImages[0].id)}
                onDownload={() => handleDownloadOne(mainImages[0])}
                downloading={dlBusy === mainImages[0].id}
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
                    library={library}
                    currentProjectId={project.id}
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
              library={library}
              currentProjectId={project.id}
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
                      onRetry={(p) => handleRetry(groupMain.id, p)}
                      onDelete={() => startTransition(() => deleteThumbnailImage(groupMain.id))}
                      busy={isPending && busyId === groupMain.id}
                      selected={selectedIds.has(groupMain.id)}
                      onToggleSelect={() => toggleSelect(groupMain.id)}
                      onPreview={() => openPreview(groupMain.id)}
                      onDownload={() => handleDownloadOne(groupMain)}
                      downloading={dlBusy === groupMain.id}
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
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold">추가 이미지</h3>
            <p className="text-[11px] text-inkSoft">
              상세 갤러리에 들어가는 나머지 이미지예요. 여러 장 추가할 수 있고, 카드 왼쪽 위 체크박스로 골라서 한
              번에 삭제할 수 있어요.
            </p>
          </div>
          {additionalImages.length > 0 && (
            <div className="flex gap-3 text-[11px]">
              <button
                type="button"
                onClick={() => selectMany(additionalImages.map((i) => i.id), true)}
                className="text-accent font-semibold"
              >
                추가 이미지 전체 선택
              </button>
              {selectedList.length > 0 && (
                <button type="button" onClick={() => setSelectedIds(new Set())} className="text-inkSoft hover:text-ink">
                  선택 해제
                </button>
              )}
            </div>
          )}
        </div>

        {colorGroupKeys.length <= 1
          ? additionalImages.length > 0 && (
              <div className="flex flex-wrap gap-3">
                {additionalImages.map((img) => (
                  <ImageCard
                    key={img.id}
                    img={img}
                    size={MEDIUM}
                    onRetry={(p) => handleRetry(img.id, p)}
                    onDelete={() => startTransition(() => deleteThumbnailImage(img.id))}
                    busy={isPending && busyId === img.id}
                    selected={selectedIds.has(img.id)}
                    onToggleSelect={() => toggleSelect(img.id)}
                    onPreview={() => openPreview(img.id)}
                    onDownload={() => handleDownloadOne(img)}
                    downloading={dlBusy === img.id}
                  />
                ))}
              </div>
            )
          : colorGroupKeys.map((colorKey) => {
              const groupAdditional = additionalImages.filter((i) => (i.color_label || '') === colorKey);
              if (groupAdditional.length === 0) return null;
              return (
                <div key={colorKey || '__default__'} className="grid gap-1">
                  <div className="flex items-center gap-3">
                    <p className="text-xs font-semibold text-accent">색상: {colorKey || '기본'}</p>
                    <button
                      type="button"
                      onClick={() => {
                        const ids = groupAdditional.map((i) => i.id);
                        selectMany(ids, !ids.every((id) => selectedIds.has(id)));
                      }}
                      className="text-[11px] text-inkSoft hover:text-ink underline"
                    >
                      {groupAdditional.every((i) => selectedIds.has(i.id)) ? '이 색상 선택 해제' : '이 색상 전체 선택'}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {groupAdditional.map((img) => (
                      <ImageCard
                        key={img.id}
                        img={img}
                        size={MEDIUM}
                        onRetry={(p) => handleRetry(img.id, p)}
                        onDelete={() => startTransition(() => deleteThumbnailImage(img.id))}
                        busy={isPending && busyId === img.id}
                        selected={selectedIds.has(img.id)}
                        onToggleSelect={() => toggleSelect(img.id)}
                        onPreview={() => openPreview(img.id)}
                        onDownload={() => handleDownloadOne(img)}
                        downloading={dlBusy === img.id}
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
              library={library}
              currentProjectId={project.id}
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

      {deleteMsg && <p className="text-xs text-profit bg-profitBg rounded-md px-3 py-2">{deleteMsg}</p>}
      {dlMsg && <p className="text-xs text-profit bg-profitBg rounded-md px-3 py-2">{dlMsg}</p>}
      {dlError && <p className="text-xs text-warn bg-warnBg rounded-md px-3 py-2">{dlError}</p>}
      {error && <p className="text-xs text-warn bg-warnBg rounded-md px-3 py-2">{error}</p>}

      {/* 선택한 이미지가 있으면 화면 아래에 떠서 어디서든 한 번에 삭제할 수 있게 한다 */}
      {selectedList.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-full bg-ink text-white px-5 py-2.5 shadow-xl text-xs">
          <span className="font-semibold">{selectedList.length}장 선택됨</span>
          <button
            type="button"
            onClick={() => handleDownloadZip(selectedList)}
            disabled={dlBusy === 'zip'}
            className="rounded-full bg-white/20 px-3 py-1 font-semibold hover:bg-white/30 disabled:opacity-50"
          >
            {dlBusy === 'zip' ? dlMsg || '받는 중...' : '선택 다운로드'}
          </button>
          <button
            type="button"
            onClick={handleDeleteSelected}
            disabled={isPending && busyId === 'bulk-delete'}
            className="rounded-full bg-accent px-3 py-1 font-semibold disabled:opacity-50"
          >
            {isPending && busyId === 'bulk-delete' ? '삭제 중...' : '선택 삭제'}
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="text-white/70 hover:text-white"
          >
            해제
          </button>
        </div>
      )}

      {previewId && previewIndex >= 0 && (
        <ImageLightbox
          items={downloadables.map((d) => ({ url: d.url, title: d.title, fileName: d.name }))}
          index={previewIndex}
          onIndex={(i) => setPreviewId(downloadables[i]?.id ?? null)}
          onClose={() => setPreviewId(null)}
        />
      )}
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

  // 이전에 올린 상품 사진 목록: 메인 썸네일 행이 갖고 있는 원본 사진. 패키지 메인의 입력은 여러
  // 사진을 합성한 이미지(원본 사진이 아님)라 뺀다. 같은 사진 주소는 한 번만.
  const library: LibraryPhoto[] = [];
  const seenUrls = new Set<string>();
  for (const p of projects) {
    const mains = ((p.thumbnail_images || []) as any[])
      .filter((i) => i.kind === 'main' && i.input_image_url && !String(i.color_label || '').startsWith('패키지 '))
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    for (const i of mains) {
      if (seenUrls.has(i.input_image_url)) continue;
      seenUrls.add(i.input_image_url);
      library.push({
        id: i.id,
        url: i.input_image_url,
        colorLabel: i.color_label || '',
        projectId: p.id,
        projectTitle: p.title || '',
      });
    }
  }

  if (active) {
    return (
      <ProjectEditor
        project={active}
        styleBrief={styleBriefs[(active.category || '').trim()]}
        onClose={() => setActiveId(null)}
        library={library}
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
