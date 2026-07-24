import { fetchCoupangInventoryForItem, fetchCoupangRGOrders } from '@/lib/coupang';

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
        '쿠팡 옵션ID(vendorItemId)가 등록된 상품이 없어요. 상품 관리에서 먼저 등록해줘.',
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
  let registered = 0;
  let skipped = 0;
  let lastError: string | undefined;
  let rawOrderCount = 0;
  let firstUpsertError: string | undefined;
  let firstProductUpsertError: string | undefined;
  const rangesTried: string[] = [];

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
            let productId = mapByVendorItem[vendorItemId];
            const externalRef = `coupang-order:${order.orderId}:${vendorItemId}`;
            const productName =
              item.productName || `쿠팡 상품 (${vendorItemId})`;

            if (!productId) {
              // 옵션ID는 처음 보지만, 이름이 같은 상품이 이미 있으면
              // (판매자배송/로켓그로스 등 같은 상품의 다른 옵션ID인 경우)
              // 새 상품을 만들지 않고 기존 상품에 옵션ID만 추가로 매핑한다.
              const { data: existingByName } = await supabase
                .from('products')
                .select('id')
                .eq('name', productName)
                .maybeSingle();

              let targetProductId = existingByName?.id;

              if (!targetProductId) {
                const { data: newProduct, error: productError } = await supabase
                  .from('products')
                  .insert({
                    name: productName,
                    author_email: authorEmail,
                    notes: '쿠팡 판매 동기화 중 자동 등록됨',
                  })
                  .select('id')
                  .single();

                if (productError && !firstProductUpsertError) {
                  firstProductUpsertError = productError.message;
                }
                if (!newProduct) continue;
                targetProductId = newProduct.id;
                registered++;
              }

              const { error: mapError } = await supabase
                .from('product_vendor_items')
                .upsert(
                  { product_id: targetProductId, vendor_item_id: vendorItemId },
                  { onConflict: 'vendor_item_id' }
                );
              if (mapError && !firstProductUpsertError) {
                firstProductUpsertError = mapError.message;
              }

              productId = targetProductId;
              mapByVendorItem[vendorItemId] = productId;
            }

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
    registered,
    skipped,
    error: lastError,
    debug: {
      vendorId: cred.vendor_id,
      rangesTried,
      rawOrderCount,
      mappedProductCount: Object.keys(mapByVendorItem).length,
      firstUpsertError,
      firstProductUpsertError,
    },
  };
}
