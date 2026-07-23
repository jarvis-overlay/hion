'use client';

import { useState, useTransition } from 'react';
import {
  fetchImportableCoupangProducts,
  importCoupangProducts,
} from '@/app/dashboard/inventory/products/actions';

type Candidate = {
  sellerProductId: string;
  sellerProductName: string;
  vendorItemId: string;
  itemName: string;
  alreadyImported: boolean;
};

export default function CoupangImportPicker() {
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  function loadList() {
    setOpen(true);
    setError(null);
    setResultMsg(null);
    startTransition(async () => {
      const res: any = await fetchImportableCoupangProducts();
      if (res.error) {
        setError(res.error);
        setCandidates(null);
      } else {
        setCandidates(res.candidates);
        setSelected(new Set());
      }
    });
  }

  function toggle(vendorItemId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(vendorItemId)) next.delete(vendorItemId);
      else next.add(vendorItemId);
      return next;
    });
  }

  function handleImport() {
    if (!candidates) return;
    const toImport = candidates.filter((c) => selected.has(c.vendorItemId));
    startTransition(async () => {
      const res: any = await importCoupangProducts(toImport);
      setResultMsg(`${res.imported}개 상품을 등록했어요.`);
      setCandidates(null);
      setSelected(new Set());
      setOpen(false);
    });
  }

  return (
    <div className="mb-6">
      <button
        onClick={loadList}
        disabled={isPending}
        className="btn-primary px-4 py-2 text-sm font-semibold disabled:opacity-50"
      >
        {isPending && !candidates ? '불러오는 중...' : '쿠팡에서 상품 불러오기'}
      </button>
      {resultMsg && (
        <p className="text-xs text-profit mt-2">{resultMsg}</p>
      )}

      {open && (
        <div className="card p-5 mt-3">
          {error && <p className="text-sm text-red-700">{error}</p>}

          {isPending && !candidates && !error && (
            <p className="text-sm text-inkSoft">
              쿠팡에서 상품 목록을 가져오는 중이야, 상품 수에 따라 시간이 좀
              걸릴 수 있어...
            </p>
          )}

          {candidates && (
            <>
              <p className="text-xs text-inkSoft mb-3">
                이미 등록된 상품은 흐리게 표시돼. 등록할 상품을 선택하고 아래
                버튼을 눌러줘.
              </p>
              <div className="flex flex-col gap-1 max-h-80 overflow-y-auto mb-4">
                {candidates.map((c) => (
                  <label
                    key={c.vendorItemId}
                    className={`flex items-center gap-2 text-sm py-1.5 px-2 rounded ${
                      c.alreadyImported
                        ? 'opacity-40'
                        : 'hover:bg-[#F7F8FA] cursor-pointer'
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={c.alreadyImported}
                      checked={selected.has(c.vendorItemId)}
                      onChange={() => toggle(c.vendorItemId)}
                    />
                    <span className="flex-1">
                      {c.sellerProductName}
                      {c.itemName && c.itemName !== c.sellerProductName
                        ? ` - ${c.itemName}`
                        : ''}
                    </span>
                    <span className="font-mono text-xs text-inkSoft">
                      {c.vendorItemId}
                    </span>
                    {c.alreadyImported && (
                      <span className="text-xs text-profit">등록됨</span>
                    )}
                  </label>
                ))}
                {!candidates.length && (
                  <p className="text-sm text-inkSoft">
                    가져올 수 있는 상품이 없어요.
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleImport}
                  disabled={isPending || selected.size === 0}
                  className="btn-primary px-4 py-2 text-sm font-semibold disabled:opacity-50"
                >
                  {isPending ? '등록 중...' : `선택한 ${selected.size}개 등록`}
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="text-sm text-inkSoft px-2"
                >
                  닫기
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
