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

  const { data: products } = await supabase
    .from('products')
    .select('id, name, coupang_vendor_item_id')
    .not('coupang_vendor_item_id', 'is', null);

  if (!products || products.length === 0) {
    return {
      error:
        '쿠팡 옵션ID(vendorItemId)가 등록된 상품이 없어요. 상품 관리에서 먼저 등록해줘.',
    };
  }

  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const product of products) {
    try {
      const result = await fetchCoupangInventoryForItem({
        vendorId: cred.vendor_id,
        accessKey: cred.access_key,
        secretKey: cred.secret_key,
        vendorItemId: String(product.coupang_vendor_item_id),
      });

      if (!result) {
        failed++;
        continue;
      }

      const newQty = result.totalOrderableQuantity;

      const { data: stockRow } = await supabase
        .from('warehouse_stock')
        .select('id, quantity')
        .eq('product_id', product.id)
        .eq('warehouse', 'coupang')
        .maybeSingle();

      const prevQty = stockRow?.quantity ?? 0;

      if (stockRow) {
        await supabase
          .from('warehouse_stock')
          .update({ quantity: newQty })
          .eq('id', stockRow.id);
      } else {
        await supabase.from('warehouse_stock').insert({
          product_id: product.id,
          warehouse: 'coupang',
          quantity: newQty,
        });
      }

      if (newQty !== prevQty) {
        await supabase.from('stock_movements').insert({
          product_id: product.id,
          warehouse: 'coupang',
          type: newQty > prevQty ? 'in' : 'out',
          quantity: newQty - prevQty,
          note: `쿠팡 로켓창고 재고 동기화 (${prevQty} → ${newQty})`,
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
  authorEmail: string
) {
  const { data: cred } = await supabase
    .from('channel_credentials')
    .select('*')
    .eq('channel', 'coupang')
    .maybeSingle();

  if (!cred || !cred.connected || !cred.vendor_id) {
    return { logged: 0, registered: 0, skipped: 0 };
  }

  const { data: products } = await supabase
    .from('products')
    .select('id, coupang_vendor_item_id')
    .not('coupang_vendor_item_id', 'is', null);

  const mapByVendorItem: Record<string, string> = {};
  for (const p of products || []) {
    if (p.coupang_vendor_item_id) {
      mapByVendorItem[String(p.coupang_vendor_item_id)] = p.id;
    }
  }

  // 최근 2일치를 조회 (하루 1번 자동동기화라도 놓치는 날 없게 여유를 둠)
  const fmt = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
      d.getDate()
    ).padStart(2, '0')}`;
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 1);

  let logged = 0;
  let registered = 0;
  let skipped = 0;

  try {
    let nextToken: string | undefined = undefined;
    do {
      const { data: orders, nextToken: next } = await fetchCoupangRGOrders({
        vendorId: cred.vendor_id,
        accessKey: cred.access_key,
        secretKey: cred.secret_key,
        paidDateFrom: fmt(from),
        paidDateTo: fmt(today),
        nextToken,
      });
      nextToken = next;

      for (const order of orders) {
        for (const item of order.orderItems || []) {
          const vendorItemId = String(item.vendorItemId);
          let productId = mapByVendorItem[vendorItemId];
          const externalRef = `coupang-order:${order.orderId}:${vendorItemId}`;

          // 우리 시스템에 없는 상품이면 자동으로 새로 등록
          if (!productId) {
            const { data: newProduct } = await supabase
              .from('products')
              .insert({
                name: item.productName || `쿠팡 상품 (${vendorItemId})`,
                coupang_vendor_item_id: vendorItemId,
                author_email: authorEmail,
                notes: '쿠팡 판매 동기화 중 자동 등록됨',
              })
              .select('id')
              .single();

            if (!newProduct) continue;
            productId = newProduct.id;
            mapByVendorItem[vendorItemId] = productId;
            registered++;
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
                note: `쿠팡 판매 (${item.productName || ''})`,
                author_email: authorEmail,
              },
              { onConflict: 'external_ref', ignoreDuplicates: true }
            )
            .select();

          if (error) {
            // 유니크 제약이 아직 없는 등 예기치 못한 오류 - 조용히 건너뜀
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
  } catch (e) {
    // 재고 동기화는 이미 끝났으니, 판매내역 조회 실패는 조용히 무시
  }

  return { logged, registered, skipped };
}
