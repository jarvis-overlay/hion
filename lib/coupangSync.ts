import {
  fetchCoupangInventoryForItem,
  fetchCoupangRGOrders,
  fetchCoupangProductDetail,
  fetchCoupangProductList,
} from '@/lib/coupang';

export async function runCoupangInventorySync(
  supabase: any,
  authorEmail: string
) {
  const { data: cred } = await supabase
    .from('channel_credentials')
    .select('*')
    .eq('channel', 'coupang')
    .maybeSingle();

  if (!cred || !cred.connected || !cred.vendor_id) {
    return {
      error: '쿠팡 연동이 안 되어있어요. 채널 연동에서 키를 먼저 저장해줘.',
    };
  }

  // 상품 1개에 여러 옵션ID(vendorItemId)가 매핑될 수 있으므로
  // product_vendor_items 테이블 기준으로 조회하고, 상품별로 그룹핑해서
  // 재고를 합산한다 (판매자배송/로켓그로스 등 옵션ID가 여러 개인 경우 대응).
  const { data: mappings } = await supabase
    .from('product_vendor_items')
    .select('product_id, vendor_item_id');

  if (!mappings || mappings.length === 0) {
    return {
      error:
        '매핑된 쿠팡 옵션ID가 없어요. 먼저 상품 카탈로그 동기화를 실행해줘.',
    };
  }

  const vendorItemsByProduct: Record<string, string[]> = {};
  for (const m of mappings) {
    if (!vendorItemsByProduct[m.product_id]) {
      vendorItemsByProduct[m.product_id] = [];
    }
    vendorItemsByProduct[m.product_id].push(m.vendor_item_id);
  }

  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const [productId, vendorItemIds] of Object.entries(
    vendorItemsByProduct
  )) {
    try {
      let totalQty = 0;
      for (const vendorItemId of vendorItemIds) {
        const result = await fetchCoupangInventoryForItem({
          vendorId: cred.vendor_id,
          accessKey: cred.access_key,
          secretKey: cred.secret_key,
          vendorItemId: String(vendorItemId),
        });
        if (result) totalQty += result.totalOrderableQuantity;
      }

      const { data: stockRow } = await supabase
        .from('warehouse_stock')
        .select('id, quantity')
        .eq('product_id', productId)
        .eq('warehouse', 'coupang')
        .maybeSingle();

      const prevQty = stockRow?.quantity ?? 0;

      if (stockRow) {
        await supabase
          .from('warehouse_stock')
          .update({ quantity: totalQty })
          .eq('id', stockRow.id);
      } else {
        await supabase.from('warehouse_stock').insert({
          product_id: productId,
          warehouse: 'coupang',
          quantity: totalQty,
        });
      }

      if (totalQty !== prevQty) {
        await supabase.from('stock_movements').insert({
          product_id: productId,
          warehouse: 'coupang',
          type: totalQty > prevQty ? 'in' : 'out',
          quantity: totalQty - prevQty,
          note: `쿠팡 로켓창고 재고 동기화 (${prevQty} → ${totalQty})`,
          author_email: authorEmail,
        });
        updated++;
      } else {
        unchanged++;
      }
    } catch (e) {
      failed++;
    }
  }

  return { updated, unchanged, failed };
}

// ============================================================
// 쿠팡 상품 카탈로그 동기화
// - "상품 목록 조회" API로 이 계정의 전체 등록상품(sellerProductId) 목록을 가져오고
// - 각 상품마다 "상품 상세 조회" API로 옵션(vendorItemId)별 바코드를 확인하고
// - 옵션별 "재고 조회" API로 실제 주문가능재고를 확인해서
// - 아래 기준을 모두 만족하는 옵션만 정식 상품/매핑으로 등록한다:
//   1) 로켓그로스 상품 (이 계정은 로켓그로스만 운영 중이라는 전제)
//   2) 재고가 0보다 큼 (품절 아님)
//   3) 바코드가 등록되어 있음
// 같은 sellerProductId 아래의 여러 옵션ID(판매자배송/로켓그로스, 색상 등)는
// 이름이 달라도 전부 같은 products 행 하나로 묶인다 (이름이 아니라
// sellerProductId를 기준으로 병합하기 때문에 표기 이름이 달라도 안전함).
// ============================================================
export async function syncCoupangProductCatalog(
  supabase: any,
  authorEmail: string
) {
  const { data: cred } = await supabase
    .from('channel_credentials')
    .select('*')
    .eq('channel', 'coupang')
    .maybeSingle();

  if (!cred || !cred.connected || !cred.vendor_id) {
    return { error: '쿠팡 연동이 안 되어있어요. 채널 연동에서 키를 먼저 저장해줘.' };
  }

  let scannedProducts = 0;
  let scannedItems = 0;
  let qualified = 0;
  let disqualified = 0;
  let createdProducts = 0;
  let mappedVendorItems = 0;
  let lastError: string | undefined;
  const disqualifiedReasons: Record<string, number> = {};
  let sampleDetailKeys: string[] | undefined;
  let sampleItemKeys: string[] | undefined;

  try {
    let nextToken: string | undefined = undefined;
    do {
      const { data: list, nextToken: next } = await fetchCoupangProductList({
        vendorId: cred.vendor_id,
        accessKey: cred.access_key,
        secretKey: cred.secret_key,
        nextToken,
      });
      nextToken = next;

      for (const p of list) {
        scannedProducts++;
        const sellerProductId = p.sellerProductId;
        if (!sellerProductId) continue;

        let detail: any;
        try {
          detail = await fetchCoupangProductDetail({
            vendorId: cred.vendor_id,
            accessKey: cred.access_key,
            secretKey: cred.secret_key,
            sellerProductId,
          });
        } catch (e: any) {
          lastError = e?.message || String(e);
          continue;
        }

        const detailData = detail?.data || detail || {};
        const items = detailData.items || [];
        if (!sampleDetailKeys) sampleDetailKeys = Object.keys(detailData);
        if (!sampleItemKeys && items[0]) sampleItemKeys = Object.keys(items[0]);

        let productRowId: string | undefined;

        for (const item of items) {
          scannedItems++;
          const vendorItemId = String(item.vendorItemId);
          const barcode = item.barcode || item.barCode || item.bar_code;

          if (!barcode) {
            disqualified++;
            disqualifiedReasons['no_barcode'] =
              (disqualifiedReasons['no_barcode'] || 0) + 1;
            continue;
          }

          let stockQty = 0;
          try {
            const inv = await fetchCoupangInventoryForItem({
              vendorId: cred.vendor_id,
              accessKey: cred.access_key,
              secretKey: cred.secret_key,
              vendorItemId,
            });
            stockQty = inv?.totalOrderableQuantity ?? 0;
          } catch {
            stockQty = 0;
          }

          if (stockQty <= 0) {
            disqualified++;
            disqualifiedReasons['out_of_stock'] =
              (disqualifiedReasons['out_of_stock'] || 0) + 1;
            continue;
          }

          // 기준 통과 - 이 sellerProductId에 해당하는 대표 상품 행을 찾거나 새로 만든다
          if (!productRowId) {
            const displayName =
              p.sellerProductName ||
              detailData.sellerProductName ||
              `쿠팡 상품 (${sellerProductId})`;

            const { data: existing } = await supabase
              .from('products')
              .select('id')
              .eq('coupang_seller_product_id', String(sellerProductId))
              .maybeSingle();

            if (existing) {
              productRowId = existing.id;
            } else {
              const { data: created, error: createErr } = await supabase
                .from('products')
                .insert({
                  name: displayName,
                  coupang_seller_product_id: String(sellerProductId),
                  author_email: authorEmail,
                  notes:
                    '쿠팡 상품 카탈로그 동기화로 등록됨 (로켓그로스·재고있음·바코드확인)',
                })
                .select('id')
                .single();

              if (createErr) {
                lastError = createErr.message;
                continue;
              }
              productRowId = created.id;
              createdProducts++;
            }
          }

          const { error: mapErr } = await supabase
            .from('product_vendor_items')
            .upsert(
              { product_id: productRowId, vendor_item_id: vendorItemId },
              { onConflict: 'vendor_item_id' }
            );
          if (!mapErr) mappedVendorItems++;
          else lastError = mapErr.message;

          qualified++;
        }
      }
    } while (nextToken);
  } catch (e: any) {
    lastError = e?.message || String(e);
  }

  return {
    scannedProducts,
    scannedItems,
    qualified,
    disqualified,
    disqualifiedReasons,
    createdProducts,
    mappedVendorItems,
    error: lastError,
    debug: { sampleDetailKeys, sampleItemKeys },
  };
}

export async function runCoupangOrderSync(
  supabase: any,
  authorEmail: string,
  daysBack: number = 2
) {
  const { data: cred } = await supabase
    .from('channel_credentials')
    .select('*')
    .eq('channel', 'coupang')
    .maybeSingle();

  if (!cred || !cred.connected || !cred.vendor_id) {
    return { logged: 0, registered: 0, skipped: 0, debug: 'no cred / not connected' };
  }

  // 상품 매핑은 이제 syncCoupangProductCatalog가 미리 만들어둔 것을 그대로 사용한다.
  // (주문 API에는 바코드/재고 정보가 없어서 이 시점에 자격을 판단할 수 없기 때문)
  const { data: mappings } = await supabase
    .from('product_vendor_items')
    .select('product_id, vendor_item_id');

  const mapByVendorItem: Record<string, string> = {};
  for (const m of mappings || []) {
    mapByVendorItem[String(m.vendor_item_id)] = m.product_id;
  }

  const fmt = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
      d.getDate()
    ).padStart(2, '0')}`;

  const MAX_RANGE_DAYS = 30;
  const today = new Date();
  const ranges: { from: Date; to: Date }[] = [];
  let remaining = daysBack;
  let cursor = new Date(today);

  while (remaining > 0) {
    const rangeDays = Math.min(remaining, MAX_RANGE_DAYS);
    const to = new Date(cursor);
    const from = new Date(cursor);
    from.setDate(from.getDate() - rangeDays);
    ranges.push({ from, to });
    cursor = new Date(from);
    remaining -= rangeDays;
  }

  let logged = 0;
  let skipped = 0;
  let unmapped = 0;
  let lastError: string | undefined;
  let rawOrderCount = 0;
  let firstUpsertError: string | undefined;
  const rangesTried: string[] = [];
  const unmappedVendorItemIds = new Set<string>();

  try {
    for (const range of ranges) {
      rangesTried.push(`${fmt(range.from)}~${fmt(range.to)}`);
      let nextToken: string | undefined = undefined;
      do {
        const { data: orders, nextToken: next } = await fetchCoupangRGOrders({
          vendorId: cred.vendor_id,
          accessKey: cred.access_key,
          secretKey: cred.secret_key,
          paidDateFrom: fmt(range.from),
          paidDateTo: fmt(range.to),
          nextToken,
        });
        nextToken = next;
        rawOrderCount += orders.length;

        for (const order of orders) {
          for (const item of order.orderItems || []) {
            const vendorItemId = String(item.vendorItemId);
            const productId = mapByVendorItem[vendorItemId];
            const productName = item.productName || `쿠팡 상품 (${vendorItemId})`;

            if (!productId) {
              // 카탈로그 동기화에서 기준(재고있음·바코드있음) 미달로 매핑 안 된 옵션 -
              // 정식 상품이 아니므로 판매기록도 남기지 않는다.
              unmapped++;
              unmappedVendorItemIds.add(vendorItemId);
              continue;
            }

            const externalRef = `coupang-order:${order.orderId}:${vendorItemId}`;
            const qty = Number(item.salesQuantity) || 0;
            if (qty <= 0) continue;

            const { data: inserted, error } = await supabase
              .from('stock_movements')
              .upsert(
                {
                  product_id: productId,
                  warehouse: 'coupang',
                  type: 'out',
                  quantity: -qty,
                  channel: 'coupang',
                  amount: qty * Number(item.unitSalesPrice || 0),
                  external_ref: externalRef,
                  occurred_at: new Date(Number(order.paidAt)).toISOString(),
                  note: `쿠팡 판매 (${productName})`,
                  author_email: authorEmail,
                },
                { onConflict: 'external_ref', ignoreDuplicates: true }
              )
              .select();

            if (error) {
              if (!firstUpsertError) firstUpsertError = error.message;
              continue;
            }

            if (inserted && inserted.length > 0) {
              logged++;
            } else {
              skipped++;
            }
          }
        }
      } while (nextToken);
    }
  } catch (e: any) {
    lastError = e?.message || String(e);
    console.error('runCoupangOrderSync error:', e);
  }

  return {
    logged,
    skipped,
    unmapped,
    error: lastError,
    debug: {
      vendorId: cred.vendor_id,
      rangesTried,
      rawOrderCount,
      mappedVendorItemCount: Object.keys(mapByVendorItem).length,
      firstUpsertError,
      unmappedVendorItemIds: Array.from(unmappedVendorItemIds).slice(0, 10),
    },
  };
}
