'use client';

import { useRef, useState } from 'react';
import SourcingOrderForm from '@/components/SourcingOrderForm';
import { summarizeMoney } from '@/lib/sourcingSummary';
import { summarizeOrders, summarizeOrderTotals, nextOrderPrefill, sortOrders } from '@/lib/orderSummary';

export type OrdersStatus = 'ok' | 'missing' | 'error';

const won = (n: number | null) => (n == null ? '-' : Math.round(n).toLocaleString('ko-KR') + '원');
const signedWon = (n: number | null) => (n == null ? '-' : (n < 0 ? '-' : '') + Math.abs(Math.round(n)).toLocaleString('ko-KR') + '원');
const pct = (n: number | null) => (n == null ? '-' : n.toFixed(1) + '%');
const tone = (n: number | null) => (n == null ? '' : n < 0 ? 'text-red-700' : 'text-profit');

// 소싱 카드의 "발주 이력" 탭: 같은 상품을 다시 주문한 회차별 수량·마진을 비교 표로 보고, 회차를 추가/수정/삭제한다.
export default function SourcingOrdersPanel({
  item,
  orders,
  status,
}: {
  item: any;
  orders: any[];
  status: OrdersStatus;
}) {
  // 열려 있는 폼은 하나만: 새 회차(uuid) 또는 수정 중인 회차 id
  const [form, setForm] = useState<{ kind: 'new' | 'edit'; id: string } | null>(null);
  // 열려 있는 폼에 아직 저장 안 한 변경이 있는지 (폼이 알려준다). 다른 폼으로 바꿀 때 확인창을 띄우는 데 쓴다.
  const dirtyRef = useRef(false);
  function guardLeave(): boolean {
    if (form && dirtyRef.current && !window.confirm('작성 중인 내용이 사라져요. 계속할까요?')) return false;
    dirtyRef.current = false;
    return true;
  }

  if (status === 'missing') {
    return <p className="text-xs text-inkSoft bg-paper px-3 py-2">발주 이력 기능 준비 중이에요 (DB 적용 전). 다른 탭은 그대로 쓸 수 있어요.</p>;
  }
  if (status === 'error') {
    return <p className="text-xs text-warn bg-warnBg px-3 py-2">발주 이력을 불러오지 못했어요. 새로고침 해주세요.</p>;
  }

  const sorted = sortOrders(orders);
  const rows = summarizeOrders(orders);
  const base = summarizeMoney(item);
  const hasBase = item.price != null || item.cost != null;
  const editing = form?.kind === 'edit' ? sorted.find((o) => o.id === form.id) : null;
  const newId = form?.kind === 'new' ? form.id : null;
  const prefill = nextOrderPrefill(orders, item);
  const totals = summarizeOrderTotals(orders);

  function closeForm() {
    dirtyRef.current = false;
    setForm(null);
  }
  function openNew() {
    if (!guardLeave()) return;
    setForm({ kind: 'new', id: crypto.randomUUID() });
  }

  return (
    <div className="grid gap-3">
      <p className="text-[11px] text-inkSoft">같은 상품을 다시 주문한 기록이에요 (색상·사이즈 같은 종류별 마진은 옵션 구성 탭).</p>

      {rows.length === 0 && !form && (
        <div className="grid gap-2 justify-items-start">
          <p className="text-xs text-inkSoft">아직 발주 기록이 없어요.</p>
          <button type="button" onClick={openNew} className="btn-primary px-3 py-2 text-xs font-semibold">
            현재 마진 정보로 1차 발주 만들기
          </button>
        </div>
      )}

      {rows.length > 0 && (
        <div>
          <div className="overflow-x-auto border border-paperLine rounded-md">
            <table className="w-full min-w-[640px] text-xs">
              <thead className="bg-paper text-inkSoft">
                <tr>
                  <th className="sticky left-0 bg-paper text-left font-semibold px-2 py-1.5">회차</th>
                  <th className="text-left font-semibold px-2 py-1.5">발주일</th>
                  <th className="text-right font-semibold px-2 py-1.5">수량</th>
                  <th className="text-right font-semibold px-2 py-1.5">개당 원가</th>
                  <th className="text-right font-semibold px-2 py-1.5">개당 해외배송</th>
                  <th className="text-right font-semibold px-2 py-1.5">개당 마진</th>
                  <th className="text-right font-semibold px-2 py-1.5">마진율</th>
                  <th className="text-right font-semibold px-2 py-1.5">총 마진</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {hasBase && (
                  <tr className="text-inkSoft/70 border-t border-paperLine bg-white">
                    <td className="sticky left-0 bg-white px-2 py-1.5 font-sans">기준(견적)</td>
                    <td className="px-2 py-1.5">-</td>
                    <td className="px-2 py-1.5 text-right">-</td>
                    <td className="px-2 py-1.5 text-right">{won(base.cost)}</td>
                    <td className="px-2 py-1.5 text-right">{won(base.intlShipping)}</td>
                    <td className="px-2 py-1.5 text-right">{signedWon(base.price != null ? base.profit : null)}</td>
                    <td className="px-2 py-1.5 text-right">{pct(base.marginPct)}</td>
                    <td className="px-2 py-1.5 text-right">-</td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => {
                      if (form?.kind === 'edit' && form.id === r.id) return;
                      if (!guardLeave()) return;
                      setForm({ kind: 'edit', id: r.id });
                    }}
                    className={`border-t border-paperLine cursor-pointer hover:bg-paper ${form?.kind === 'edit' && form.id === r.id ? 'bg-paper' : 'bg-white'}`}
                  >
                    <td className="sticky left-0 bg-inherit px-2 py-1.5 font-sans font-semibold">{r.roundNo}차</td>
                    <td className="px-2 py-1.5">{r.orderedAt ?? '-'}</td>
                    <td className="px-2 py-1.5 text-right">{r.quantity != null ? r.quantity.toLocaleString('ko-KR') + '개' : '-'}</td>
                    <td className="px-2 py-1.5 text-right">{won(r.cost)}</td>
                    <td className="px-2 py-1.5 text-right">{won(r.intlShipping)}</td>
                    <td className={`px-2 py-1.5 text-right font-semibold ${tone(r.profit)}`}>{signedWon(r.profit)}</td>
                    <td className={`px-2 py-1.5 text-right ${tone(r.marginPct)}`}>{pct(r.marginPct)}</td>
                    <td className={`px-2 py-1.5 text-right font-semibold ${tone(r.totalProfit)}`}>{signedWon(r.totalProfit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totals && (
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs bg-paper rounded-md px-3 py-1.5">
              <span className="font-semibold text-ink">합계</span>
              <span>총 발주 수량 <span className="font-mono font-semibold">{totals.totalQuantity.toLocaleString('ko-KR')}개</span></span>
              <span>총 마진 <span className={`font-mono font-semibold ${tone(totals.totalProfit)}`}>{signedWon(totals.totalProfit)}</span></span>
              <span>가중평균 마진율 <span className={`font-mono font-semibold ${tone(totals.weightedMarginPct)}`}>{pct(totals.weightedMarginPct)}</span></span>
            </div>
          )}
          <p className="text-[10px] text-inkSoft mt-1">
            총 마진 = 개당 마진 × 수량. 수량을 입력하지 않으면 &apos;-&apos;. 합계는 수량을 입력한 회차만 합산해요. 판매가가 없는 회차의 마진은 &apos;-&apos;. 행을 누르면 수정할 수 있어요.
          </p>
        </div>
      )}

      {rows.length > 0 && !form && (
        <button type="button" onClick={openNew} className="btn-primary px-3 py-2 text-xs font-semibold w-fit">
          + 발주 추가
        </button>
      )}

      {newId && (
        <SourcingOrderForm key={newId} itemId={item.id} newId={newId} prefill={prefill} dirtyRef={dirtyRef} onClose={closeForm} />
      )}
      {editing && <SourcingOrderForm key={editing.id} itemId={item.id} order={editing} dirtyRef={dirtyRef} onClose={closeForm} />}
      {form?.kind === 'edit' && !editing && (
        <p className="text-xs text-warn bg-warnBg px-3 py-2">
          이 발주 기록을 찾지 못했어요 (이미 삭제됐을 수 있어요).{' '}
          <button type="button" onClick={closeForm} className="underline">
            닫기
          </button>
        </p>
      )}
    </div>
  );
}
