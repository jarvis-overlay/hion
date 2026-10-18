'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import {
  updateSourcingStatus,
  updateSourcingStage,
  updateSourcingPriority,
  updateSourcingInputStatus,
  updateSourcingItem,
  deleteSourcingItem,
  addSourcingOption,
  deleteSourcingOption,
  addSourcingSupplier,
  updateSourcingSupplier,
  deleteSourcingSupplier,
  addSourcingComparison,
  updateSourcingComparison,
  deleteSourcingComparison,
} from '@/app/dashboard/sourcing/list/actions';
import {
  upsertChecklistItem,
  addCustomChecklistItem,
  updateCustomChecklistItem,
  deleteChecklistItem,
  addChecklistTemplateItem,
  updateChecklistTemplateItem,
  deleteChecklistTemplateItem,
  generateChecklistMessage,
} from '@/app/dashboard/sourcing/list/checklistActions';
import { runTranslateToChinese, runTranslateToKorean } from '@/app/dashboard/sourcing/translate/actions';
import { computeMargin as computeMarginShared } from '@/lib/marginCalc';
import { useMarginFields } from '@/lib/useMarginFields';
import FxCalculator from '@/components/FxCalculator';
import { MarginDetailFields } from '@/components/MarginDetailFields';
import type { ShippingCalcState } from '@/components/ShippingCostCalculator';
import ComparisonEntryEditor, { MARKET_SIZE_LABEL } from '@/components/ComparisonEntryEditor';
import type { SourcingZhTranslation } from '@/lib/ai';

const PLATFORM_LABEL: Record<string, string> = { coupang: '쿠팡', naver: '네이버' };

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

const STAGE_LABEL: Record<string, string> = {
  candidate: '후보',
  confirmed: '확정',
};

const STAGE_STYLE: Record<string, string> = {
  candidate: 'bg-paper text-inkSoft ring-1 ring-inset ring-paperLine',
  confirmed: 'bg-accentBg text-accent ring-1 ring-inset ring-accent/20',
};

const PRIORITY_LABEL: Record<string, string> = {
  '1': '1순위',
  '2': '2순위',
  '3': '3순위',
};

const PRIORITY_STYLE: Record<string, string> = {
  '1': 'bg-red-50 text-red-700',
  '2': 'bg-warnBg text-warn',
  '3': 'bg-paperLine text-inkSoft',
};

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR') + '원';

// 마진 계산기 페이지와 완전히 동일한 공식(lib/marginCalc.ts 공용).
// 매출부가세/매입부가세/쿠팡수수료는 환차·프로모션·카테고리별 수수료
// 차이로 실제 정산액이 공식과 다를 수 있어서 자동계산하지 않고 사용자가
// 직접 입력한 값을 그대로 쓴다.
function computeMargin(it: any) {
  const result = computeMarginShared({
    price: it.price ?? null,
    coupon: it.coupon ?? null,
    cost: it.cost ?? null,
    outputVat: it.output_vat ?? null,
    importVat: it.import_vat ?? null,
    coupangFee: it.coupang_fee ?? null,
    shipping: it.shipping ?? null,
    intlShipping: it.intl_shipping ?? null,
    adCost: it.ad_cost ?? null,
    etcCost: it.etc_cost ?? null,
  });
  return {
    p: result.actualPrice,
    c: it.cost ?? 0,
    fee: it.coupang_fee ?? 0,
    outputVat: it.output_vat ?? 0,
    importVat: it.import_vat ?? 0,
    s: it.shipping ?? 0,
    is: it.intl_shipping ?? 0,
    a: it.ad_cost ?? 0,
    e: it.etc_cost ?? 0,
    profit: result.profit,
    marginPct: result.marginPct,
  };
}

// 메모에 링크를 같이 적어두는 경우가 많은데, 긴 URL이 공백 없는 한
// 덩어리라 줄바꿈 없이 카드 밖으로 넘쳐서 잘려 보이고 클릭도 안 됐다 -
// URL 부분만 잘라서 실제 <a> 링크로 바꿔준다. "coupang.com/vp/..."처럼
// http(s):// 없이 붙여넣는 경우도 많아서 스킴 없는 도메인도 인식한다.
const URL_SPLIT_RE = /((?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/[^\s]*)?)/g;
const URL_TEST_RE = /^(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/[^\s]*)?$/;

function linkifyText(text: string) {
  const parts = text.split(URL_SPLIT_RE);
  return parts.map((part, i) =>
    URL_TEST_RE.test(part) ? (
      <a
        key={i}
        href={part.startsWith('http') ? part : `https://${part}`}
        target="_blank"
        rel="noreferrer"
        className="text-profit underline break-all"
      >
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

function marginBadgeClass(pct: number) {
  if (pct < 0) return 'bg-red-100 text-red-700';
  if (pct < 15) return 'bg-warnBg text-warn';
  return 'bg-profitBg text-profit';
}

type SortKey =
  | 'created_desc'
  | 'created_asc'
  | 'price_desc'
  | 'price_asc'
  | 'cost_desc'
  | 'cost_asc'
  | 'margin_desc'
  | 'margin_asc'
  | 'market_desc'
  | 'market_asc';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'created_desc', label: '최신 등록순' },
  { value: 'created_asc', label: '오래된 등록순' },
  { value: 'price_desc', label: '판매가 높은순' },
  { value: 'price_asc', label: '판매가 낮은순' },
  { value: 'cost_desc', label: '원가 높은순' },
  { value: 'cost_asc', label: '원가 낮은순' },
  { value: 'margin_desc', label: '마진율 높은순' },
  { value: 'margin_asc', label: '마진율 낮은순' },
  { value: 'market_desc', label: '시장규모 큰순' },
  { value: 'market_asc', label: '시장규모 작은순' },
];

// 상품마다 시장규모를 직접 조사해서 넣진 않고, 이미 입력해둔 "비교
// 상품군"의 시장규모(상/중/하) 값들 중 가장 큰 등급을 대표값으로 쓴다 -
// 실시간 쿠팡 조회 없이 이미 갖고 있는 데이터를 재활용.
const MARKET_SIZE_RANK: Record<string, number> = { high: 3, mid: 2, low: 1 };

function aggregateMarketSize(item: any): 'high' | 'mid' | 'low' | null {
  const comparisons: any[] = item.sourcing_item_comparisons || [];
  let best: 'high' | 'mid' | 'low' | null = null;
  let bestRank = 0;
  for (const c of comparisons) {
    const prices: any[] = c.sourcing_comparison_prices || [];
    for (const p of prices) {
      const rank = MARKET_SIZE_RANK[p.market_size];
      if (rank && rank > bestRank) {
        bestRank = rank;
        best = p.market_size;
      }
    }
  }
  return best;
}

function EditForm({ item, onDone }: { item: any; onDone: () => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const f = useMarginFields({
    price: item.price,
    cost: item.cost,
    coupon: item.coupon,
    importVat: item.import_vat,
    // 기존에 저장된 쿠팡수수료/광고비 금액으로부터 역산한 비율을
    // 기본값으로 보여준다 - 실제 판매가가 있어야 역산 가능, 없으면 각각
    // 기본 8.6%/10%.
    feeRatePct:
      item.price && item.coupang_fee != null
        ? Number(((item.coupang_fee / (item.price - (item.coupon || 0))) * 100).toFixed(2))
        : null,
    adRatePct:
      item.price && item.ad_cost != null
        ? Number(((item.ad_cost / (item.price - (item.coupon || 0))) * 100).toFixed(2))
        : null,
    shipping: item.shipping,
    intlShipping: item.intl_shipping,
    etcCost: item.etc_cost,
  });

  // jsonb 컬럼이라 Supabase 클라이언트가 이미 객체로 파싱해서 준다.
  const intlShippingCalcInitial: ShippingCalcState | null = item.intl_shipping_calc || null;

  return (
    <form
      ref={formRef}
      action={(fd) =>
        startTransition(async () => {
          setError(null);
          const res = await updateSourcingItem(item.id, fd);
          if ('error' in res) {
            setError(res.error);
            return;
          }
          onDone();
        })
      }
      className="grid gap-3"
    >
      <input
        name="title"
        defaultValue={item.title}
        required
        className="border border-paperLine bg-white px-3 py-2 text-sm"
      />
      <input
        name="link"
        defaultValue={item.link || ''}
        placeholder="소싱 링크"
        className="border border-paperLine bg-white px-3 py-2 text-sm"
      />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <input
          name="price"
          value={f.price}
          onChange={(e) => f.setPrice(e.target.value)}
          type="number"
          step="0.01"
          placeholder="판매가"
          className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
        />
        <input
          readOnly
          name="output_vat"
          value={f.price !== '' ? Math.round(f.outputVat) : ''}
          placeholder="매출부가세 (자동)"
          title="판매가 / 11로 자동 계산돼요"
          className="border border-paperLine bg-paper text-inkSoft px-3 py-2 text-sm font-mono cursor-not-allowed"
        />
        <input
          name="cost"
          value={f.cost}
          onChange={(e) => f.setCost(e.target.value)}
          type="number"
          step="0.01"
          placeholder="매입 원가"
          className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
        />
        <input
          name="moq"
          defaultValue={item.moq || ''}
          placeholder="MOQ"
          className="border border-paperLine bg-white px-3 py-2 text-sm"
        />
      </div>

      <FxCalculator
        onApply={(krw) => f.setCost(String(Math.round(krw)))}
        initial={{
          currency: item.cost_fx_currency,
          amount: item.cost_fx_amount,
          rate: item.cost_fx_rate,
        }}
      />

      <MarginDetailFields fields={f} intlShippingCalcInitial={intlShippingCalcInitial} />

      {f.price && (
        <div className="rounded-md bg-paper px-3 py-2 text-sm grid gap-1">
          <div className="flex items-center justify-between">
            <span className="text-inkSoft">예상 마진 (광고비 적용)</span>
            <span className={`font-mono font-semibold ${f.margin.profit < 0 ? 'text-red-700' : 'text-profit'}`}>
              {(f.margin.profit < 0 ? '-' : '') + fmt(Math.abs(f.margin.profit))}
              {f.margin.marginPct != null && ` (${f.margin.marginPct.toFixed(1)}%)`}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-inkSoft text-xs">예상 마진 (광고비 미적용)</span>
            <span className="font-mono text-xs text-inkSoft">
              {(f.pureProfit < 0 ? '-' : '') + fmt(Math.abs(f.pureProfit))}
              {f.pureMarginPct != null && ` (${f.pureMarginPct.toFixed(1)}%)`}
            </span>
          </div>
        </div>
      )}

      <textarea
        name="content"
        defaultValue={item.content || ''}
        placeholder="메모"
        rows={2}
        className="border border-paperLine bg-white px-3 py-2 text-sm"
      />
      {error && (
        <p className="text-xs text-warn bg-warnBg rounded-md px-3 py-2">저장 실패: {error}</p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="btn-primary px-4 py-2 text-xs font-semibold disabled:opacity-50"
        >
          {isPending ? '저장 중...' : '저장'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="px-4 py-2 text-xs font-semibold text-inkSoft ring-1 ring-paperLine rounded"
        >
          취소
        </button>
      </div>
    </form>
  );
}

// 같은 상품이라도 색상/사이즈 등 옵션마다 가격·원가가 달라서 마진을
// 따로 계산해야 한다는 요청으로 추가함.
function OptionAddForm({ sourcingItemId, onDone }: { sourcingItemId: string; onDone: () => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const f = useMarginFields();

  return (
    <form
      ref={formRef}
      action={(fd) =>
        startTransition(async () => {
          setError(null);
          const res = await addSourcingOption(sourcingItemId, fd);
          if ('error' in res) {
            setError(res.error);
            return;
          }
          formRef.current?.reset();
          f.reset();
          onDone();
        })
      }
      className="grid gap-2 bg-paper rounded-md p-3"
    >
      <input
        name="name"
        placeholder="옵션명 (예: 블랙/L)"
        required
        className="border border-paperLine bg-white px-2 py-1.5 text-xs"
      />
      <div className="grid grid-cols-3 gap-2">
        <input
          name="price"
          value={f.price}
          onChange={(e) => f.setPrice(e.target.value)}
          type="number"
          step="0.01"
          placeholder="판매가"
          className="border border-paperLine bg-white px-2 py-1.5 text-xs font-mono"
        />
        <input
          readOnly
          name="output_vat"
          value={f.price !== '' ? Math.round(f.outputVat) : ''}
          placeholder="매출부가세(자동)"
          title="판매가 / 11로 자동 계산돼요"
          className="border border-paperLine bg-paper text-inkSoft px-2 py-1.5 text-xs font-mono cursor-not-allowed"
        />
        <input
          name="cost"
          value={f.cost}
          onChange={(e) => f.setCost(e.target.value)}
          type="number"
          step="0.01"
          placeholder="매입 원가"
          className="border border-paperLine bg-white px-2 py-1.5 text-xs font-mono"
        />
      </div>

      <FxCalculator onApply={(krw) => f.setCost(String(Math.round(krw)))} />

      <button
        type="button"
        onClick={() => setShowDetail((v) => !v)}
        className="text-left text-[11px] font-semibold text-inkSoft hover:text-ink flex items-center gap-1"
      >
        <span className={`transition-transform ${showDetail ? 'rotate-90' : ''}`}>▸</span>
        마진 상세 항목
      </button>
      {showDetail && <MarginDetailFields fields={f} compact />}

      {f.price && (
        <div className="text-xs grid gap-0.5">
          <div className="flex items-center justify-between">
            <span className="text-inkSoft">예상 마진 (광고비 적용)</span>
            <span className={`font-mono font-semibold ${f.margin.profit < 0 ? 'text-red-700' : 'text-profit'}`}>
              {(f.margin.profit < 0 ? '-' : '') + fmt(Math.abs(f.margin.profit))}
              {f.margin.marginPct != null && ` (${f.margin.marginPct.toFixed(1)}%)`}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-inkSoft text-[11px]">예상 마진 (광고비 미적용)</span>
            <span className="font-mono text-[11px] text-inkSoft">
              {(f.pureProfit < 0 ? '-' : '') + fmt(Math.abs(f.pureProfit))}
              {f.pureMarginPct != null && ` (${f.pureMarginPct.toFixed(1)}%)`}
            </span>
          </div>
        </div>
      )}

      {error && <p className="text-[11px] text-warn bg-warnBg rounded px-2 py-1">{error}</p>}
      <button
        type="submit"
        disabled={isPending}
        className="btn-primary py-1.5 text-xs font-semibold disabled:opacity-50"
      >
        {isPending ? '추가 중...' : '옵션 추가'}
      </button>
    </form>
  );
}

function OptionsSection({ item }: { item: any }) {
  const [adding, setAdding] = useState(false);
  const [isPending, startTransition] = useTransition();
  const options: any[] = item.sourcing_item_options || [];

  return (
    <div className="rounded-md ring-1 ring-paperLine p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-inkSoft">옵션 구성 ({options.length})</span>
        <button
          onClick={() => setAdding((v) => !v)}
          className="text-xs text-accent font-semibold"
        >
          {adding ? '닫기' : '+ 옵션 추가'}
        </button>
      </div>

      {options.length > 0 && (
        <div className="grid gap-1.5 mb-2">
          {options.map((o) => {
            const m = computeMarginShared({
              price: o.price ?? null,
              coupon: o.coupon ?? null,
              cost: o.cost ?? null,
              outputVat: o.output_vat ?? null,
              importVat: o.import_vat ?? null,
              coupangFee: o.coupang_fee ?? null,
              shipping: o.shipping ?? null,
              adCost: o.ad_cost ?? null,
              etcCost: o.etc_cost ?? null,
            });
            return (
              <div key={o.id} className="flex items-center justify-between gap-2 text-xs bg-paper rounded px-2 py-1.5">
                <span className="font-medium truncate">{o.name}</span>
                <div className="flex items-center gap-2 shrink-0">
                  {o.price != null && <span className="font-mono text-inkSoft">{o.price.toLocaleString()}원</span>}
                  {m.marginPct != null && (
                    <span className={`px-1.5 py-0.5 rounded-full ${marginBadgeClass(m.marginPct)}`}>
                      {fmt(m.profit)} ({m.marginPct.toFixed(1)}%)
                    </span>
                  )}
                  <button
                    onClick={() => startTransition(() => deleteSourcingOption(o.id))}
                    disabled={isPending}
                    className="text-inkSoft hover:text-red-700"
                  >
                    삭제
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {adding && <OptionAddForm sourcingItemId={item.id} onDone={() => setAdding(false)} />}
    </div>
  );
}

const CURRENCY_LABEL: Record<string, string> = { CNY: '¥', USD: '$', KRW: '₩' };

// 하나의 상품을 소싱할 때 여러 1688/알리바바 공급처를 비교하면서
// 찾는 경우가 있다는 요청으로 추가함 - 링크+가격을 여러 개 저장.
function SupplierAddForm({
  sourcingItemId,
  initial,
  saveLabel = '공급처 추가',
  onDone,
  onCancel,
}: {
  sourcingItemId: string;
  initial?: any;
  saveLabel?: string;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      ref={formRef}
      action={(fd) =>
        startTransition(async () => {
          setError(null);
          const res = initial
            ? await updateSourcingSupplier(initial.id, fd)
            : await addSourcingSupplier(sourcingItemId, fd);
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
      <input
        name="title"
        defaultValue={initial?.title || ''}
        placeholder="상품명 (구분용)"
        className="border border-paperLine bg-white px-2 py-1.5 text-xs"
      />
      <input
        name="link"
        defaultValue={initial?.link || ''}
        placeholder="공급처 링크 (1688, 알리바바 등)"
        className="border border-paperLine bg-white px-2 py-1.5 text-xs"
      />
      <div className="grid grid-cols-3 gap-2">
        <select
          name="currency"
          defaultValue={initial?.currency || 'CNY'}
          className="border border-paperLine bg-white px-2 py-1.5 text-xs"
        >
          <option value="CNY">위안 (CNY)</option>
          <option value="USD">달러 (USD)</option>
          <option value="KRW">원 (KRW)</option>
        </select>
        <input
          name="price"
          type="number"
          step="0.01"
          defaultValue={initial?.price ?? ''}
          placeholder="가격"
          className="border border-paperLine bg-white px-2 py-1.5 text-xs font-mono col-span-2"
        />
      </div>
      <input
        name="notes"
        defaultValue={initial?.notes || ''}
        placeholder="메모 (MOQ, 품질 등, 선택)"
        className="border border-paperLine bg-white px-2 py-1.5 text-xs"
      />
      {error && <p className="text-[11px] text-warn bg-warnBg rounded px-2 py-1">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="btn-primary py-1.5 text-xs font-semibold disabled:opacity-50"
        >
          {isPending ? '저장 중...' : saveLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="py-1.5 text-xs font-semibold text-inkSoft ring-1 ring-paperLine rounded px-4"
          >
            취소
          </button>
        )}
      </div>
    </form>
  );
}

function SuppliersSection({ item }: { item: any }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const suppliers: any[] = item.sourcing_item_suppliers || [];
  // 가격 비교가 목적이니 싼 순으로 정렬 (가격 없는 건 뒤로)
  const sorted = [...suppliers].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  const minPrice = sorted.find((s) => s.price != null)?.price;

  return (
    <div className="rounded-md ring-1 ring-paperLine p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-inkSoft">공급처 비교 ({suppliers.length})</span>
        <button
          onClick={() => {
            setAdding((v) => !v);
            setEditingId(null);
          }}
          className="text-xs text-accent font-semibold"
        >
          {adding ? '닫기' : '+ 공급처 추가'}
        </button>
      </div>

      {sorted.length > 0 && (
        <div className="grid gap-1.5 mb-2">
          {sorted.map((s) => {
            if (editingId === s.id) {
              return (
                <SupplierAddForm
                  key={s.id}
                  sourcingItemId={item.id}
                  initial={s}
                  saveLabel="저장"
                  onCancel={() => setEditingId(null)}
                  onDone={() => setEditingId(null)}
                />
              );
            }
            return (
              <div
                key={s.id}
                className={`flex items-center justify-between gap-2 text-xs rounded px-2 py-1.5 ${
                  s.price != null && s.price === minPrice ? 'bg-accentBg' : 'bg-paper'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-ink truncate">{s.title || '(이름 없음)'}</span>
                    {s.link && (
                      <a href={s.link} target="_blank" rel="noreferrer" className="text-profit underline shrink-0">
                        [링크]
                      </a>
                    )}
                  </div>
                  {s.notes && <p className="text-inkSoft mt-0.5">{s.notes}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {s.price != null && (
                    <span className="font-mono">
                      {CURRENCY_LABEL[s.currency] || ''}
                      {s.price.toLocaleString()}
                    </span>
                  )}
                  <button
                    onClick={() => {
                      setEditingId(s.id);
                      setAdding(false);
                    }}
                    className="text-inkSoft hover:text-ink"
                  >
                    수정
                  </button>
                  <button
                    onClick={() => startTransition(() => deleteSourcingSupplier(s.id))}
                    disabled={isPending}
                    className="text-inkSoft hover:text-red-700"
                  >
                    삭제
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {adding && <SupplierAddForm sourcingItemId={item.id} onDone={() => setAdding(false)} />}
    </div>
  );
}

function ChecklistCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // 클립보드 권한 없는 브라우저 - 조용히 무시 (텍스트는 화면에 그대로 있어서 직접 선택 복사 가능)
        }
      }}
      className="text-[10px] text-accent font-semibold underline shrink-0"
    >
      {copied ? '복사됨' : '복사'}
    </button>
  );
}

type FreeTranslateDirection = 'ko-zh' | 'zh-ko';
interface FreeTranslateEntry {
  id: string;
  direction: FreeTranslateDirection;
  input: string;
  casual?: string;
  formal?: string;
  translation?: string;
}

// 체크리스트 항목뿐 아니라, 공장과 주고받는 그때그때의 메시지(주문
// 확인, 가격 문의, 답장 해석 등)도 이 화면을 안 벗어나고 바로 번역할
// 수 있게 하는 자유 입력 번역기 - /dashboard/sourcing/translate 페이지와
// 같은 서버 액션을 그대로 재사용한다.
function FreeTranslateBox() {
  const [direction, setDirection] = useState<FreeTranslateDirection>('ko-zh');
  const [text, setText] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<FreeTranslateEntry[]>([]);

  function handleTranslate() {
    setError(null);
    const inputSnapshot = text;
    startTransition(async () => {
      if (direction === 'ko-zh') {
        const res = await runTranslateToChinese(inputSnapshot);
        if ('error' in res) {
          setError(res.error);
          return;
        }
        setHistory((prev) => [
          { id: crypto.randomUUID(), direction, input: inputSnapshot, casual: res.data.casual, formal: res.data.formal },
          ...prev,
        ]);
      } else {
        const res = await runTranslateToKorean(inputSnapshot);
        if ('error' in res) {
          setError(res.error);
          return;
        }
        setHistory((prev) => [
          { id: crypto.randomUUID(), direction, input: inputSnapshot, translation: res.translation },
          ...prev,
        ]);
      }
      setText('');
    });
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-inkSoft">자유 번역 (공장과 주고받는 메시지)</span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setDirection('ko-zh')}
            className={`px-2 py-1 text-[11px] font-semibold border ${
              direction === 'ko-zh' ? 'bg-ink text-white border-ink' : 'border-paperLine text-inkSoft'
            }`}
          >
            한→중
          </button>
          <button
            type="button"
            onClick={() => setDirection('zh-ko')}
            className={`px-2 py-1 text-[11px] font-semibold border ${
              direction === 'zh-ko' ? 'bg-ink text-white border-ink' : 'border-paperLine text-inkSoft'
            }`}
          >
            중→한
          </button>
        </div>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder={
          direction === 'ko-zh' ? '보낼 메시지를 한국어로 입력하세요' : '공장이 보낸 중국어 메시지를 붙여넣으세요'
        }
        className="border border-paperLine bg-white px-2 py-1.5 text-xs w-full"
      />
      <button
        onClick={handleTranslate}
        disabled={isPending || !text.trim()}
        className="btn-primary px-3 py-1.5 text-xs font-semibold justify-self-start disabled:opacity-40"
      >
        {isPending ? '번역 중...' : '번역하기'}
      </button>
      {error && <p className="text-[11px] text-warn">{error}</p>}

      {history.length > 0 && (
        <div className="grid gap-2">
          {history.map((h) => (
            <div key={h.id} className="bg-paper rounded px-2 py-1.5 text-xs grid gap-1.5">
              <p className="text-inkSoft whitespace-pre-wrap">{h.input}</p>
              {h.direction === 'ko-zh' ? (
                <>
                  {h.casual && (
                    <div className="bg-white rounded px-2 py-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[10px] text-inkSoft font-semibold uppercase">편한 톤</span>
                        <ChecklistCopyButton text={h.casual} />
                      </div>
                      <p className="mt-1 whitespace-pre-wrap">{h.casual}</p>
                    </div>
                  )}
                  {h.formal && (
                    <div className="bg-white rounded px-2 py-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[10px] text-inkSoft font-semibold uppercase">격식 톤</span>
                        <ChecklistCopyButton text={h.formal} />
                      </div>
                      <p className="mt-1 whitespace-pre-wrap">{h.formal}</p>
                    </div>
                  )}
                </>
              ) : (
                <div className="bg-white rounded px-2 py-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[10px] text-inkSoft font-semibold uppercase">번역</span>
                    <ChecklistCopyButton text={h.translation || ''} />
                  </div>
                  <p className="mt-1 whitespace-pre-wrap">{h.translation}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface ChecklistRow {
  id: string | null;
  itemKey: string;
  label: string;
  checked: boolean;
  note: string;
  isCustom: boolean;
  zhHint: string;
}

// 1688 공장 담당자에게 매번 확인해야 하는 기본 항목(모든 아이템 공통,
// DB의 sourcing_checklist_templates에서 관리 - 화면에서 추가/삭제
// 가능) + 이 아이템에서만 쓰는 커스텀 항목을 함께 보여준다. 기본
// 항목은 아직 체크/메모 행이 없어도(한 번도 안 건드렸어도) 화면엔
// 미체크 상태로 항상 보인다 - 체크하거나 메모를 남기는 순간에만 실제로
// 저장됨.
function ChecklistSection({ item, template }: { item: any; template: any[] }) {
  const [isPending, startTransition] = useTransition();
  const [addingCustom, setAddingCustom] = useState(false);
  const [customLabel, setCustomLabel] = useState('');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<SourcingZhTranslation | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [managingTemplate, setManagingTemplate] = useState(false);
  const [newTemplateLabel, setNewTemplateLabel] = useState('');
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editTemplateLabel, setEditTemplateLabel] = useState('');
  const [editingCustomId, setEditingCustomId] = useState<string | null>(null);
  const [editCustomLabel, setEditCustomLabel] = useState('');

  const dbRows: any[] = item.sourcing_item_checklist || [];
  const dbByKey = new Map(dbRows.map((r) => [r.item_key, r]));

  const templateRows: ChecklistRow[] = template.map((t) => {
    const db = dbByKey.get(t.item_key);
    return {
      id: db?.id ?? null,
      itemKey: t.item_key,
      label: t.label,
      checked: db?.checked ?? false,
      note: db?.note ?? '',
      isCustom: false,
      zhHint: t.zh_hint || '',
    };
  });
  const customRows: ChecklistRow[] = dbRows
    .filter((r) => r.item_key.startsWith('custom-'))
    .map((r) => ({
      id: r.id,
      itemKey: r.item_key,
      label: r.label,
      checked: r.checked,
      note: r.note || '',
      isCustom: true,
      zhHint: r.zh_hint || '',
    }));
  const rows = [...templateRows, ...customRows];
  const checkedCount = rows.filter((r) => r.checked).length;

  function toggle(row: ChecklistRow) {
    startTransition(() => upsertChecklistItem(item.id, row.itemKey, row.label, { checked: !row.checked }));
  }
  function saveNote(row: ChecklistRow, note: string) {
    if (note === row.note) return;
    startTransition(() => upsertChecklistItem(item.id, row.itemKey, row.label, { note }));
  }
  function handleAddCustom() {
    if (!customLabel.trim()) return;
    startTransition(() => addCustomChecklistItem(item.id, customLabel.trim()));
    setCustomLabel('');
    setAddingCustom(false);
  }
  function handleAddTemplate() {
    if (!newTemplateLabel.trim()) return;
    startTransition(() => addChecklistTemplateItem(newTemplateLabel.trim()));
    setNewTemplateLabel('');
  }
  function handleSaveTemplateEdit(id: string) {
    if (!editTemplateLabel.trim()) return;
    startTransition(() => updateChecklistTemplateItem(id, editTemplateLabel.trim()));
    setEditingTemplateId(null);
  }
  function handleSaveCustomEdit(row: ChecklistRow) {
    if (!editCustomLabel.trim() || !row.id) return;
    startTransition(() => updateCustomChecklistItem(item.id, row.itemKey, editCustomLabel.trim()));
    setEditingCustomId(null);
  }
  function handleGenerateMessage() {
    const checkedLabels = rows.filter((r) => r.checked).map((r) => r.label);
    setMessageError(null);
    setGenerating(true);
    startTransition(async () => {
      const res = await generateChecklistMessage(checkedLabels);
      setGenerating(false);
      if ('error' in res) {
        setMessageError(res.error);
        return;
      }
      setMessage(res.data);
    });
  }

  return (
    <div className="rounded-md ring-1 ring-paperLine p-3">
      <FreeTranslateBox />

      <p className="text-[11px] text-inkSoft mb-2 mt-3 pt-3 border-t border-paperLine">
        항목을 체크하면서 공장과 확인하세요. 항목을 누르면 바로 쓸 수 있는 중국어 문구가 펼쳐져요.
      </p>
      <div className="grid gap-1.5">
        {rows.map((row) => (
          <div key={row.itemKey} className="bg-paper rounded px-2 py-1.5 text-xs">
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={row.checked}
                onChange={() => toggle(row)}
                className="mt-0.5 shrink-0"
              />
              {row.isCustom && editingCustomId === row.id ? (
                <>
                  <input
                    value={editCustomLabel}
                    onChange={(e) => setEditCustomLabel(e.target.value)}
                    autoFocus
                    className="flex-1 border border-paperLine bg-white px-1.5 py-1 text-xs"
                  />
                  <button
                    onClick={() => handleSaveCustomEdit(row)}
                    className="text-accent font-semibold shrink-0"
                  >
                    저장
                  </button>
                  <button
                    onClick={() => {
                      setEditingCustomId(null);
                      setEditCustomLabel('');
                    }}
                    className="text-inkSoft shrink-0"
                  >
                    취소
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setExpandedKey((k) => (k === row.itemKey ? null : row.itemKey))}
                    className="flex-1 text-left"
                  >
                    <span className={row.checked ? 'line-through text-inkSoft' : 'text-ink'}>{row.label}</span>
                  </button>
                  {row.isCustom && row.id && (
                    <>
                      <button
                        onClick={() => {
                          setEditingCustomId(row.id);
                          setEditCustomLabel(row.label);
                        }}
                        className="text-inkSoft hover:text-ink shrink-0"
                      >
                        수정
                      </button>
                      <button
                        onClick={() => startTransition(() => deleteChecklistItem(row.id as string))}
                        className="text-inkSoft hover:text-red-700 shrink-0"
                      >
                        삭제
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
            {expandedKey === row.itemKey && (
              <div className="mt-1.5 ml-5 grid gap-1.5">
                {row.zhHint && (
                  <div className="flex items-start justify-between gap-2 bg-white rounded px-2 py-1.5">
                    <span className="text-inkSoft">{row.zhHint}</span>
                    <ChecklistCopyButton text={row.zhHint} />
                  </div>
                )}
                <textarea
                  defaultValue={row.note}
                  onBlur={(e) => saveNote(row, e.target.value)}
                  placeholder="메모 (공장 답변, 특이사항 등)"
                  rows={2}
                  className="border border-paperLine bg-white px-2 py-1 text-xs w-full"
                />
              </div>
            )}
          </div>
        ))}

        {addingCustom ? (
          <div className="flex gap-1.5">
            <input
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              placeholder="커스텀 확인 항목"
              className="border border-paperLine bg-white px-2 py-1.5 text-xs flex-1"
            />
            <button onClick={handleAddCustom} className="text-xs text-accent font-semibold shrink-0">
              추가
            </button>
            <button
              onClick={() => {
                setAddingCustom(false);
                setCustomLabel('');
              }}
              className="text-xs text-inkSoft shrink-0"
            >
              취소
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAddingCustom(true)}
            className="text-xs text-accent font-semibold text-left"
          >
            + 커스텀 항목 추가 (이 상품에만)
          </button>
        )}
      </div>

      <div className="border-t border-paperLine pt-2 mt-2">
        <button
          onClick={() => setManagingTemplate((v) => !v)}
          className="text-xs text-inkSoft hover:text-ink font-semibold"
        >
          ⚙️ 기본 항목 관리 (모든 상품 공통) {managingTemplate ? '▲' : '▼'}
        </button>
        {managingTemplate && (
          <div className="grid gap-1.5 mt-2">
            <p className="text-[11px] text-inkSoft">
              한국어 설명만 입력하면 공장에 바로 쓸 수 있는 중국어 문구가 자동으로 만들어져요.
            </p>
            {template.map((t) =>
              editingTemplateId === t.id ? (
                <div key={t.id} className="flex items-center gap-1.5 bg-paper rounded px-2 py-1.5 text-xs">
                  <input
                    value={editTemplateLabel}
                    onChange={(e) => setEditTemplateLabel(e.target.value)}
                    autoFocus
                    className="flex-1 border border-paperLine bg-white px-1.5 py-1 text-xs"
                  />
                  <button
                    onClick={() => handleSaveTemplateEdit(t.id)}
                    disabled={isPending}
                    className="text-accent font-semibold shrink-0 disabled:opacity-40"
                  >
                    {isPending ? '저장 중...' : '저장'}
                  </button>
                  <button
                    onClick={() => {
                      setEditingTemplateId(null);
                      setEditTemplateLabel('');
                    }}
                    className="text-inkSoft shrink-0"
                  >
                    취소
                  </button>
                </div>
              ) : (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-2 bg-paper rounded px-2 py-1.5 text-xs"
                >
                  <span className="text-ink">{t.label}</span>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => {
                        setEditingTemplateId(t.id);
                        setEditTemplateLabel(t.label);
                      }}
                      className="text-inkSoft hover:text-ink"
                    >
                      수정
                    </button>
                    <button
                      onClick={() => startTransition(() => deleteChecklistTemplateItem(t.id))}
                      className="text-inkSoft hover:text-red-700"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              )
            )}
            <div className="flex gap-1.5 bg-paper rounded px-2 py-1.5">
              <input
                value={newTemplateLabel}
                onChange={(e) => setNewTemplateLabel(e.target.value)}
                placeholder="새 기본 항목 (한국어 설명)"
                className="border border-paperLine bg-white px-2 py-1.5 text-xs flex-1"
              />
              <button
                onClick={handleAddTemplate}
                disabled={!newTemplateLabel.trim() || isPending}
                className="text-xs text-accent font-semibold shrink-0 disabled:opacity-40"
              >
                {isPending ? '추가 중...' : '+ 추가'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-paperLine pt-2 mt-2">
        <button
          onClick={handleGenerateMessage}
          disabled={generating || isPending || checkedCount === 0}
          className="btn-primary px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
        >
          {generating ? '메시지 생성 중...' : `체크한 ${checkedCount}개 항목 중국어 메시지로 만들기`}
        </button>
        {messageError && <p className="text-[11px] text-warn mt-1">{messageError}</p>}
        {message && (
          <div className="grid gap-1.5 mt-2">
            <div className="bg-paper rounded px-2 py-1.5">
              <div className="flex items-start justify-between gap-2">
                <span className="text-[10px] text-inkSoft font-semibold uppercase tracking-wide">편한 톤</span>
                <ChecklistCopyButton text={message.casual} />
              </div>
              <p className="text-xs mt-1 whitespace-pre-wrap">{message.casual}</p>
            </div>
            <div className="bg-paper rounded px-2 py-1.5">
              <div className="flex items-start justify-between gap-2">
                <span className="text-[10px] text-inkSoft font-semibold uppercase tracking-wide">격식 톤</span>
                <ChecklistCopyButton text={message.formal} />
              </div>
              <p className="text-xs mt-1 whitespace-pre-wrap">{message.formal}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// 경쟁/비교 상품군 링크 - 쿠팡·네이버에서 관찰한 가격대·시장규모를
// 남겨서 이 후보가 시장에서 어느 위치인지 참고하려는 목적으로 추가함.
function ComparisonsSection({ item }: { item: any }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const comparisons: any[] = item.sourcing_item_comparisons || [];

  return (
    <div className="rounded-md ring-1 ring-paperLine p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-inkSoft">비교 상품군 ({comparisons.length})</span>
        <button
          onClick={() => {
            setAdding((v) => !v);
            setEditingId(null);
          }}
          className="text-xs text-accent font-semibold"
        >
          {adding ? '닫기' : '+ 비교 상품 추가'}
        </button>
      </div>

      {comparisons.length > 0 && (
        <div className="grid gap-1.5 mb-2">
          {comparisons.map((c) => {
            const prices: any[] = c.sourcing_comparison_prices || [];

            if (editingId === c.id) {
              return (
                <ComparisonEntryEditor
                  key={c.id}
                  saveLabel="저장"
                  initial={{
                    title: c.title || '',
                    link: c.link || '',
                    prices: prices.map((p) => ({
                      platform: p.platform,
                      priceRange: p.price_range || '',
                      marketSize: p.market_size || '',
                    })),
                  }}
                  onCancel={() => setEditingId(null)}
                  onSave={(updated) =>
                    startTransition(async () => {
                      setError(null);
                      const res = await updateSourcingComparison(c.id, updated);
                      if ('error' in res) {
                        setError(res.error);
                        return;
                      }
                      setEditingId(null);
                    })
                  }
                />
              );
            }

            return (
              <div key={c.id} className="flex items-start justify-between gap-2 text-xs bg-paper rounded px-2 py-1.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-ink truncate">{c.title || '(이름 없음)'}</span>
                    {c.link && (
                      <a
                        href={c.link}
                        target="_blank"
                        rel="noreferrer"
                        className="text-profit underline shrink-0"
                      >
                        [링크]
                      </a>
                    )}
                  </div>
                  {prices.length > 0 && (
                    <p className="text-inkSoft mt-0.5">
                      {prices
                        .map(
                          (p) =>
                            `${PLATFORM_LABEL[p.platform] || p.platform} ${p.price_range || '가격대 미입력'}${
                              p.market_size ? ` (규모 ${MARKET_SIZE_LABEL[p.market_size]})` : ''
                            }`
                        )
                        .join(' · ')}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => {
                      setEditingId(c.id);
                      setAdding(false);
                    }}
                    className="text-inkSoft hover:text-ink"
                  >
                    수정
                  </button>
                  <button
                    onClick={() => startTransition(() => deleteSourcingComparison(c.id))}
                    disabled={isPending}
                    className="text-inkSoft hover:text-red-700"
                  >
                    삭제
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="text-[11px] text-warn bg-warnBg rounded px-2 py-1 mb-2">{error}</p>}

      {adding && (
        <ComparisonEntryEditor
          onSave={(c) =>
            startTransition(async () => {
              setError(null);
              const res = await addSourcingComparison(item.id, c);
              if ('error' in res) {
                setError(res.error);
                return;
              }
              setAdding(false);
            })
          }
        />
      )}
    </div>
  );
}

export default function SourcingList({
  items,
  checklistTemplate,
}: {
  items: any[];
  checklistTemplate: any[];
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [stageFilter, setStageFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [enteredFilter, setEnteredFilter] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('created_desc');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedMarginId, setExpandedMarginId] = useState<string | null>(null);
  const [expandedOptionsId, setExpandedOptionsId] = useState<string | null>(null);
  const [expandedSuppliersId, setExpandedSuppliersId] = useState<string | null>(null);
  const [expandedComparisonsId, setExpandedComparisonsId] = useState<string | null>(null);
  const [expandedChecklistId, setExpandedChecklistId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const rows = useMemo(() => {
    const withMargin = items.map((it) => ({
      ...it,
      margin: computeMargin(it),
      marketSize: aggregateMarketSize(it),
    }));

    const q = search.trim().toLowerCase();
    const filtered = withMargin.filter((it) => {
      if (statusFilter !== 'all' && (it.status || 'checking') !== statusFilter) return false;
      if (stageFilter !== 'all' && (it.stage || 'candidate') !== stageFilter) return false;
      if (priorityFilter !== 'all' && (it.priority || 'none') !== priorityFilter) return false;
      if (enteredFilter !== 'all' && (it.input_status || 'not_entered') !== enteredFilter) return false;
      if (!q) return true;
      return (
        it.title?.toLowerCase().includes(q) ||
        it.content?.toLowerCase().includes(q) ||
        it.link?.toLowerCase().includes(q)
      );
    });

    const sorted = [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'created_asc':
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case 'price_desc':
          return (b.price ?? -Infinity) - (a.price ?? -Infinity);
        case 'price_asc':
          return (a.price ?? Infinity) - (b.price ?? Infinity);
        case 'cost_desc':
          return (b.cost ?? -Infinity) - (a.cost ?? -Infinity);
        case 'cost_asc':
          return (a.cost ?? Infinity) - (b.cost ?? Infinity);
        case 'margin_desc':
          return (b.margin.marginPct ?? -Infinity) - (a.margin.marginPct ?? -Infinity);
        case 'margin_asc':
          return (a.margin.marginPct ?? Infinity) - (b.margin.marginPct ?? Infinity);
        case 'market_desc':
          return (MARKET_SIZE_RANK[b.marketSize ?? ''] ?? 0) - (MARKET_SIZE_RANK[a.marketSize ?? ''] ?? 0);
        case 'market_asc':
          return (MARKET_SIZE_RANK[a.marketSize ?? ''] ?? 4) - (MARKET_SIZE_RANK[b.marketSize ?? ''] ?? 4);
        case 'created_desc':
        default:
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    });

    return sorted;
  }, [items, search, statusFilter, stageFilter, priorityFilter, enteredFilter, sortKey]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="상품명 · 메모 · 링크 검색"
          className="border border-paperLine bg-white px-3 py-2 text-sm flex-1 min-w-[180px]"
        />
        <select
          value={enteredFilter}
          onChange={(e) => setEnteredFilter(e.target.value)}
          className="border border-paperLine bg-white px-2 py-2 text-sm"
        >
          <option value="all">입력/미입력 전체</option>
          <option value="entered">입력</option>
          <option value="not_entered">미입력</option>
        </select>
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="border border-paperLine bg-white px-2 py-2 text-sm"
        >
          <option value="all">후보/확정 전체</option>
          <option value="candidate">후보</option>
          <option value="confirmed">확정</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-paperLine bg-white px-2 py-2 text-sm"
        >
          <option value="all">상태 전체</option>
          <option value="checking">검토중</option>
          <option value="ordered">발주완료</option>
          <option value="hold">보류</option>
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="border border-paperLine bg-white px-2 py-2 text-sm"
        >
          <option value="all">우선순위 전체</option>
          <option value="1">1순위</option>
          <option value="2">2순위</option>
          <option value="3">3순위</option>
          <option value="none">미지정</option>
        </select>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="border border-paperLine bg-white px-2 py-2 text-sm"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-inkSoft">
          {items.length === 0 ? '아직 등록된 소싱 후보가 없어요.' : '조건에 맞는 항목이 없어요.'}
        </p>
      ) : (
        <div className="grid gap-3">
          {rows.map((it) => {
            const status = it.status || 'checking';
            const stage = it.stage || 'candidate';
            const priority: string | null = it.priority || null;
            // 등록 시점엔 판매가·원가가 둘 다 있으면 "입력"으로
            // 시작하지만, 그 뒤로는 카드에서 직접 바꿀 수 있는 독립적인
            // 값이다 (input_status 컬럼 - 가격을 나중에 고쳐도 자동으로
            // 안 바뀜).
            const entered = (it.input_status || 'not_entered') === 'entered';
            const m = it.margin;
            const isEditing = editingId === it.id;
            const isMarginExpanded = expandedMarginId === it.id;
            const isOptionsExpanded = expandedOptionsId === it.id;
            const isSuppliersExpanded = expandedSuppliersId === it.id;
            const isComparisonsExpanded = expandedComparisonsId === it.id;
            const isChecklistExpanded = expandedChecklistId === it.id;
            const optionCount = (it.sourcing_item_options || []).length;
            const supplierCount = (it.sourcing_item_suppliers || []).length;
            const comparisonCount = (it.sourcing_item_comparisons || []).length;
            const checklistCheckedCount = (it.sourcing_item_checklist || []).filter((c: any) => c.checked).length;

            if (isEditing) {
              return (
                <div key={it.id} className="card p-4">
                  <EditForm item={it} onDone={() => setEditingId(null)} />
                </div>
              );
            }

            return (
              <div key={it.id} className="card p-4 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="font-semibold text-sm">{it.title}</h3>
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${
                          priority
                            ? PRIORITY_STYLE[priority]
                            : 'bg-paper text-inkSoft ring-1 ring-inset ring-paperLine'
                        }`}
                      >
                        {priority ? PRIORITY_LABEL[priority] : '우선순위 미지정'}
                      </span>
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_STYLE[status]}`}
                      >
                        {STATUS_LABEL[status]}
                      </span>
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${STAGE_STYLE[stage]}`}
                      >
                        {STAGE_LABEL[stage]}
                      </span>
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${
                          entered ? 'bg-profitBg text-profit' : 'bg-warnBg text-warn'
                        }`}
                      >
                        {entered ? '입력' : '미입력'}
                      </span>
                      {it.marketSize && (
                        <span
                          title="비교 상품군에 입력한 시장규모 중 가장 큰 등급"
                          className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${
                            it.marketSize === 'high'
                              ? 'bg-profitBg text-profit'
                              : it.marketSize === 'low'
                              ? 'bg-warnBg text-warn'
                              : 'bg-paperLine text-inkSoft'
                          }`}
                        >
                          시장 {MARKET_SIZE_LABEL[it.marketSize]}
                        </span>
                      )}
                      {m.marginPct != null && (
                        <button
                          onClick={() => setExpandedMarginId(isMarginExpanded ? null : it.id)}
                          className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${marginBadgeClass(m.marginPct)}`}
                        >
                          마진 {fmt(m.profit)} ({m.marginPct.toFixed(1)}%) {isMarginExpanded ? '▲' : '▼'}
                        </button>
                      )}
                    </div>
                    {it.link && (
                      <a
                        href={it.link}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-profit underline"
                      >
                        [링크]
                      </a>
                    )}
                  </div>
                </div>

                <div className="flex gap-4 text-xs text-inkSoft font-mono">
                  {it.price != null && <span>판매가 {it.price.toLocaleString()}</span>}
                  {it.cost != null && <span>원가 {it.cost.toLocaleString()}</span>}
                  {it.moq && <span>MOQ {it.moq}</span>}
                </div>

                {isMarginExpanded && m.marginPct != null && (
                  <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs bg-paper rounded-md px-3 py-2">
                    <div className="flex justify-between gap-2">
                      <dt className="text-inkSoft">실판매가</dt>
                      <dd className="font-mono">{fmt(m.p)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-inkSoft">매입원가</dt>
                      <dd className="font-mono">{fmt(m.c)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-inkSoft">쿠팡수수료</dt>
                      <dd className="font-mono">-{fmt(m.fee)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-inkSoft">매출부가세</dt>
                      <dd className="font-mono">-{fmt(m.outputVat)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-inkSoft">매입부가세 환급</dt>
                      <dd className="font-mono">+{fmt(m.importVat)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-inkSoft">배송(국내+해외)·광고·기타</dt>
                      <dd className="font-mono">-{fmt(m.s + m.is + m.a + m.e)}</dd>
                    </div>
                    <div className="flex justify-between gap-2 col-span-2 sm:col-span-3 pt-1 border-t border-paperLine font-semibold">
                      <dt>순이익</dt>
                      <dd className="font-mono">{fmt(m.profit)}</dd>
                    </div>
                  </dl>
                )}

                {it.content && (
                  <p className="text-xs text-ink whitespace-pre-wrap break-words">
                    {linkifyText(it.content)}
                  </p>
                )}

                <div className="flex flex-wrap gap-2 text-xs">
                  <button
                    onClick={() => setExpandedOptionsId(isOptionsExpanded ? null : it.id)}
                    className="text-inkSoft hover:text-ink ring-1 ring-paperLine rounded-full px-2.5 py-1"
                  >
                    옵션 구성 {optionCount > 0 && `(${optionCount})`} {isOptionsExpanded ? '▲' : '▼'}
                  </button>
                  <button
                    onClick={() => setExpandedSuppliersId(isSuppliersExpanded ? null : it.id)}
                    className="text-inkSoft hover:text-ink ring-1 ring-paperLine rounded-full px-2.5 py-1"
                  >
                    공급처 비교 {supplierCount > 0 && `(${supplierCount})`} {isSuppliersExpanded ? '▲' : '▼'}
                  </button>
                  <button
                    onClick={() => setExpandedComparisonsId(isComparisonsExpanded ? null : it.id)}
                    className="text-inkSoft hover:text-ink ring-1 ring-paperLine rounded-full px-2.5 py-1"
                  >
                    비교 상품군 {comparisonCount > 0 && `(${comparisonCount})`} {isComparisonsExpanded ? '▲' : '▼'}
                  </button>
                  <button
                    onClick={() => setExpandedChecklistId(isChecklistExpanded ? null : it.id)}
                    className="text-inkSoft hover:text-ink ring-1 ring-paperLine rounded-full px-2.5 py-1"
                  >
                    소싱 체크리스트 {checklistCheckedCount > 0 && `(${checklistCheckedCount})`} {isChecklistExpanded ? '▲' : '▼'}
                  </button>
                </div>

                {isOptionsExpanded && <OptionsSection item={it} />}
                {isComparisonsExpanded && <ComparisonsSection item={it} />}
                {isSuppliersExpanded && <SuppliersSection item={it} />}
                {isChecklistExpanded && <ChecklistSection item={it} template={checklistTemplate} />}

                <div className="flex items-center justify-between mt-1 pt-2 border-t border-paperLine">
                  <span className="text-[11px] text-inkSoft">
                    {it.author_email?.split('@')[0]} ·{' '}
                    {new Date(it.created_at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}
                  </span>
                  <div className="flex gap-2 text-xs items-center">
                    <select
                      value={entered ? 'entered' : 'not_entered'}
                      disabled={isPending}
                      onChange={(e) =>
                        startTransition(() => updateSourcingInputStatus(it.id, e.target.value))
                      }
                      className="border border-paperLine bg-white text-xs px-1 py-0.5"
                    >
                      <option value="not_entered">미입력</option>
                      <option value="entered">입력</option>
                    </select>
                    <select
                      value={priority ?? ''}
                      disabled={isPending}
                      onChange={(e) =>
                        startTransition(() => updateSourcingPriority(it.id, e.target.value))
                      }
                      className="border border-paperLine bg-white text-xs px-1 py-0.5"
                    >
                      <option value="">우선순위 미지정</option>
                      <option value="1">1순위</option>
                      <option value="2">2순위</option>
                      <option value="3">3순위</option>
                    </select>
                    <select
                      value={stage}
                      disabled={isPending}
                      onChange={(e) =>
                        startTransition(() => updateSourcingStage(it.id, e.target.value))
                      }
                      className="border border-paperLine bg-white text-xs px-1 py-0.5"
                    >
                      <option value="candidate">후보</option>
                      <option value="confirmed">확정</option>
                    </select>
                    <select
                      value={status}
                      disabled={isPending}
                      onChange={(e) =>
                        startTransition(() => updateSourcingStatus(it.id, e.target.value))
                      }
                      className="border border-paperLine bg-white text-xs px-1 py-0.5"
                    >
                      <option value="checking">검토중</option>
                      <option value="ordered">발주완료</option>
                      <option value="hold">보류</option>
                    </select>
                    <button onClick={() => setEditingId(it.id)} className="text-inkSoft hover:text-ink">
                      수정
                    </button>
                    <button
                      onClick={() => startTransition(() => deleteSourcingItem(it.id))}
                      className="text-inkSoft hover:text-red-700"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
