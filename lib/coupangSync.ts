import {
  fetchCoupangInventoryForItem,
  fetchCoupangRGOrders,
  fetchCoupangProductDetail,
  fetchCoupangProductList,
  fetchCoupangReturnRequests,
} from '@/lib/coupang';

export async function runCoupangInventorySync(
  supabase: any,
  authorEmail: string,
  // 같은 실행 안에서 카탈로그 동기화가 이미 조회해둔 재고값이 있으면 이걸
  // 재사용하고, 없는 항목만 API를 호출한다 (Fixie 프록시 요청 수 절약).
  inventoryOverride?: Record<string, number>
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
        const key = String(vendorItemId);
        if (inventoryOverride && key in inventoryOverride) {
          totalQty += inventoryOverride[key];
          continue;
        }
        const result = await fetchCoupangInventoryForItem({
          vendorId: cred.vendor_id,
          accessKey: cred.access_key,
          secretKey: cred.secret_key,
          vendorItemId: key,
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
        const delta = totalQty - prevQty;

        // 재고 증가폭으로 반품 여부를 추정하는 로직은 재고 API를 자주
        // 호출할 때(수동 테스트, 짧은 폴링 등) 일시적인 재고 변동까지
        // "반품"으로 잘못 잡아서 매출 데이터를 오염시키는 문제가 있어
        // 제거했다. 그냥 재고 변화만 기록하고 매출 통계(channel)에는
        // 반영하지 않는다.
        await supabase.from('stock_movements').insert({
          product_id: productId,
          warehouse: 'coupang',
          type: delta > 0 ? 'in' : 'out',
          quantity: delta,
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
// 하루 단위 재고 대사(반품 추정)
// - 로켓그로스는 반품/취소를 조회할 수 있는 API가 없다는 게 실측으로
//   확인됐다 (rg/orders, returnRequests, revenue-history 전부 빈 값).
// - 대신 "그 사이 판매로 잡힌 수량"과 "실제 재고 감소량"을 하루 단위로만
//   비교한다. 순간 재고를 자주 비교하면(수동 테스트 등) API 응답의
//   일시적 흔들림을 반품으로 오판하는 문제가 있었어서, 이 함수는 하루에
//   한 번 도는 전체 동기화(자정)에서만 호출해야 한다.
// - 그 사이 대량 입고(RESTOCK_THRESHOLD개 초과 증가)가 있었으면 그 입고분만
//   빼고, 나머지 소량 변화만으로 실제 감소량을 계산한다 - 입고와 반품이
//   같은 기간에 섞여도 비교가 무의미해지지 않게 하기 위함.
// ============================================================
const RESTOCK_THRESHOLD = 5;

export async function runDailyReturnEstimate(supabase: any, authorEmail: string) {
  const { data: products } = await supabase
    .from('products')
    .select('id, prev_stock_snapshot, prev_stock_snapshot_at');

  const { data: stockRows } = await supabase
    .from('warehouse_stock')
    .select('product_id, quantity')
    .eq('warehouse', 'coupang');
  const currentQtyByProduct: Record<string, number> = {};
  for (const row of stockRows || []) {
    currentQtyByProduct[row.product_id] = Number(row.quantity) || 0;
  }

  let estimated = 0;
  let checked = 0;
  const now = new Date();

  for (const p of products || []) {
    const currentQty = currentQtyByProduct[p.id];
    if (currentQty === undefined) continue; // 쿠팡 창고 재고 자체가 없는 상품

    if (p.prev_stock_snapshot != null && p.prev_stock_snapshot_at) {
      checked++;
      const prevQty = Number(p.prev_stock_snapshot);
      const actualDecrease = prevQty - currentQty; // 양수 = 실제로 재고가 줄었음

      const { data: soldRows } = await supabase
        .from('stock_movements')
        .select('quantity')
        .eq('product_id', p.id)
        .eq('channel', 'coupang')
        .eq('type', 'out')
        .gte('occurred_at', p.prev_stock_snapshot_at);
      const soldQty = (soldRows || []).reduce(
        (sum: number, r: any) => sum + -Number(r.quantity),
        0
      );

      // 그 사이 대량 입고(RESTOCK_THRESHOLD 초과 증가)가 있었으면, 그 입고분은
      // 빼고 소량 변화만으로 실제 감소량을 다시 계산한다 - 입고랑 반품이
      // 같은 기간에 섞여도 비교가 무의미해지지 않게 하기 위함.
      const { data: invRows } = await supabase
        .from('stock_movements')
        .select('quantity')
        .eq('product_id', p.id)
        .like('note', '쿠팡 로켓창고 재고 동기화%')
        .gte('occurred_at', p.prev_stock_snapshot_at);
      const hasRestock = (invRows || []).some(
        (r: any) => Number(r.quantity) > RESTOCK_THRESHOLD
      );
      const adjustedDecrease = hasRestock
        ? -((invRows || []).reduce(
            (sum: number, r: any) =>
              Number(r.quantity) > RESTOCK_THRESHOLD ? sum : sum + Number(r.quantity),
            0
          ))
        : actualDecrease;

      {
        const gap = soldQty - adjustedDecrease;
        if (gap > 0) {
          const { data: lastSale } = await supabase
            .from('stock_movements')
            .select('quantity, amount')
            .eq('product_id', p.id)
            .eq('channel', 'coupang')
            .eq('type', 'out')
            .order('occurred_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          const unitPrice =
            lastSale && lastSale.quantity
              ? Math.abs(Number(lastSale.amount) / Number(lastSale.quantity))
              : 0;

          await supabase.from('stock_movements').insert({
            product_id: p.id,
            warehouse: 'coupang',
            type: 'in',
            quantity: gap,
            channel: 'coupang',
            amount: -gap * unitPrice,
            occurred_at: now.toISOString(),
            note: `일일 재고 대사 - 반품 추정 (자동, 확인 필요) - 판매 ${soldQty}개인데 실제 재고는 ${adjustedDecrease}개만 줄어듦${hasRestock ? ' (그 사이 대량 입고 있었음, 제외하고 계산)' : ''}`,
            author_email: authorEmail,
          });
          estimated++;
        }
      }
    }

    await supabase
      .from('products')
      .update({
        prev_stock_snapshot: currentQty,
        prev_stock_snapshot_at: now.toISOString(),
      })
      .eq('id', p.id);
  }

  return { checked, estimated };
}

// ============================================================
// 과거 날짜용 반품 추정 백필
// - runDailyReturnEstimate는 오늘부터 새로 시작하는 스냅샷이라 과거
//   날짜엔 적용이 안 된다. 대신 그동안 재고 동기화가 남겨둔 로그
//   (note가 "쿠팡 로켓창고 재고 동기화"인 stock_movements)를 하루 단위로
//   집계해서, 그날의 실제 재고 순변화 vs 판매수량을 비교하는 방식으로
//   과거에도 똑같이 계산한다.
// - 재고가 늘어난 날(그날 순변화가 0 이상)은 대량 입고로 보고 건너뛴다.
// - external_ref로 중복방지(upsert ignoreDuplicates)해서 여러 번 실행해도
//   안전하다.
// ============================================================
export async function backfillDailyReturnEstimates(
  supabase: any,
  authorEmail: string,
  daysBack: number = 14
) {
  const { data: products } = await supabase.from('products').select('id');

  const kstOffsetMs = 9 * 60 * 60 * 1000;
  let estimated = 0;
  let checkedDays = 0;
  const details: any[] = [];

  for (const p of products || []) {
    for (let d = 1; d <= daysBack; d++) {
      // KST 기준 그날의 00:00 ~ 다음날 00:00 (UTC로 변환)
      const kstNow = new Date(Date.now() + kstOffsetMs);
      const kstDayStart = new Date(
        Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate())
      );
      kstDayStart.setUTCDate(kstDayStart.getUTCDate() - d);
      const dayStartUtc = new Date(kstDayStart.getTime() - kstOffsetMs);
      const dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 60 * 60 * 1000);
      const dateStr = kstDayStart.toISOString().slice(0, 10);

      const { data: invRows } = await supabase
        .from('stock_movements')
        .select('quantity')
        .eq('product_id', p.id)
        .like('note', '쿠팡 로켓창고 재고 동기화%')
        .gte('occurred_at', dayStartUtc.toISOString())
        .lt('occurred_at', dayEndUtc.toISOString());
      // 대량 입고(RESTOCK_THRESHOLD 초과 증가) 건은 제외하고, 소량 변화만
      // 합산해서 그날의 "판매/반품으로 인한" 순변화를 따로 본다.
      const netInventoryChange = (invRows || []).reduce(
        (sum: number, r: any) =>
          Number(r.quantity) > RESTOCK_THRESHOLD ? sum : sum + Number(r.quantity),
        0
      );

      const { data: soldRows } = await supabase
        .from('stock_movements')
        .select('quantity, amount')
        .eq('product_id', p.id)
        .eq('channel', 'coupang')
        .eq('type', 'out')
        .gte('occurred_at', dayStartUtc.toISOString())
        .lt('occurred_at', dayEndUtc.toISOString());
      const soldQty = (soldRows || []).reduce(
        (sum: number, r: any) => sum + -Number(r.quantity),
        0
      );
      const soldAmount = (soldRows || []).reduce(
        (sum: number, r: any) => sum + Number(r.amount || 0),
        0
      );

      checkedDays++;
      if (soldQty === 0 || netInventoryChange >= 0) continue; // 판매 없음 또는 입고(순증가)일

      const actualDecrease = -netInventoryChange;
      const gap = soldQty - actualDecrease;
      if (gap <= 0) continue;

      const unitPrice = soldQty > 0 ? Math.abs(soldAmount) / soldQty : 0;
      const externalRef = `daily-return-backfill:${p.id}:${dateStr}`;
      const occurredAt = new Date(dayStartUtc.getTime() + 12 * 60 * 60 * 1000); // 그날 정오(KST)

      const { data: inserted } = await supabase
        .from('stock_movements')
        .upsert(
          {
            product_id: p.id,
            warehouse: 'coupang',
            type: 'in',
            quantity: gap,
            channel: 'coupang',
            amount: -gap * unitPrice,
            occurred_at: occurredAt.toISOString(),
            external_ref: externalRef,
            note: `일별 재고 대사 - 반품 추정 (백필, ${dateStr}) - 판매 ${soldQty}개인데 실제 재고는 ${actualDecrease}개만 줄어듦`,
            author_email: authorEmail,
          },
          { onConflict: 'external_ref', ignoreDuplicates: true }
        )
        .select();

      if (inserted && inserted.length > 0) {
        estimated++;
        details.push({ productId: p.id, date: dateStr, gap });
      }
    }
  }

  return { checkedDays, estimated, details };
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
// 상품 하나당 상세조회 1번 + 옵션 하나당 재고조회 1번씩 나가는 무거운
// 전체 재스캔이라, 뭐가 얼마나 자주 이 함수를 부르든 상관없이 최소 이
// 간격(분) 안에는 실제 API를 다시 두드리지 않는다. 프록시(Fixie) 요청
// 할당량이 반복 호출로 순식간에 소진되는 걸 막기 위한 안전장치.
// 하루 6/9/12/15/18/21/24시, 3시간 간격으로만 돌게 하려는 의도라 180분으로 맞춤.
const CATALOG_COOLDOWN_MINUTES = 180;

export async function syncCoupangProductCatalog(
  supabase: any,
  authorEmail: string,
  force: boolean = false
) {
  const { data: cred } = await supabase
    .from('channel_credentials')
    .select('*')
    .eq('channel', 'coupang')
    .maybeSingle();

  if (!cred || !cred.connected || !cred.vendor_id) {
    return { error: '쿠팡 연동이 안 되어있어요. 채널 연동에서 키를 먼저 저장해줘.' };
  }

  if (!force && cred.catalog_synced_at) {
    const elapsedMs = Date.now() - new Date(cred.catalog_synced_at).getTime();
    if (elapsedMs < CATALOG_COOLDOWN_MINUTES * 60 * 1000) {
      return {
        skipped: true,
        reason: 'cooldown',
        catalogSyncedAt: cred.catalog_synced_at,
        scannedProducts: 0,
        scannedItems: 0,
        qualified: 0,
        disqualified: 0,
        createdProducts: 0,
        mappedVendorItems: 0,
        inventoryByVendorItem: {},
      };
    }
  }

  let scannedProducts = 0;
  let scannedItems = 0;
  let qualified = 0;
  let disqualified = 0;
  let createdProducts = 0;
  let mappedVendorItems = 0;
  let lastError: string | undefined;
  let firstInventoryCheckError: string | undefined;
  const disqualifiedReasons: Record<string, number> = {};
  let sampleDetailKeys: string[] | undefined;
  let sampleItemKeys: string[] | undefined;
  let sampleItemAttributes: string | undefined;
  let sampleItemCertifications: string | undefined;
  let sampleItemContents: string | undefined;
  let sampleItemSearchTags: string | undefined;
  let sampleRocketGrowthItemData: string | undefined;
  let sampleMarketplaceItemData: string | undefined;
  let sampleRocketGrowthAdditionalInfo: string | undefined;
  const allScannedProducts: any[] = [];
  // 이 스캔 중 조회한 옵션별 재고값 (뒤이은 재고 동기화가 재조회 안 해도 되게)
  const inventoryByVendorItem: Record<string, number> = {};

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

        // 반품 상품 판별 기준을 찾기 위해, 스캔되는 상품 전체의 식별 정보를 기록
        allScannedProducts.push({
          sellerProductId: String(sellerProductId),
          sellerProductName: p.sellerProductName ?? detailData.sellerProductName,
          statusName: p.statusName ?? detailData.statusName,
          registrationType: detailData.registrationType,
          extraInfoMessage: detailData.extraInfoMessage,
          vendorItemIds: items.map(
            (it: any) => it.rocketGrowthItemData?.vendorItemId
          ),
        });

        if (!sampleDetailKeys) sampleDetailKeys = Object.keys(detailData);
        if (!sampleItemKeys && items[0]) {
          sampleItemKeys = Object.keys(items[0]);
          sampleItemAttributes = JSON.stringify(items[0].attributes ?? null);
          sampleItemCertifications = JSON.stringify(
            items[0].certifications ?? null
          );
          sampleItemContents = JSON.stringify(items[0].contents ?? null).slice(
            0,
            1500
          );
          sampleItemSearchTags = JSON.stringify(items[0].searchTags ?? null);
          sampleRocketGrowthItemData = JSON.stringify(
            items[0].rocketGrowthItemData ?? null
          );
          sampleMarketplaceItemData = JSON.stringify(
            items[0].marketplaceItemData ?? null
          );
          sampleRocketGrowthAdditionalInfo = JSON.stringify(
            detailData.rocketGrowthAdditionalInformation ?? null
          );
        }

        let productRowId: string | undefined;

        for (const item of items) {
          scannedItems++;

          // 로켓그로스 데이터가 없는 옵션(=판매자배송 전용)은 기준(로켓그로스)에서
          // 애초에 제외한다. vendorItemId/barcode 둘 다 여기 안에 들어있다
          // (item 최상위가 아니라 rocketGrowthItemData 안에 있다는 걸 실측으로 확인).
          const rgData = item.rocketGrowthItemData;
          if (!rgData || !rgData.vendorItemId) {
            disqualified++;
            disqualifiedReasons['not_rocket_growth'] =
              (disqualifiedReasons['not_rocket_growth'] || 0) + 1;
            continue;
          }

          const vendorItemId = String(rgData.vendorItemId);
          const barcode = rgData.barcode?.trim();

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
          } catch (e: any) {
            stockQty = 0;
            if (!firstInventoryCheckError) {
              firstInventoryCheckError = e?.message || String(e);
            }
          }
          inventoryByVendorItem[vendorItemId] = stockQty;

          if (stockQty <= 0) {
            disqualified++;
            disqualifiedReasons['out_of_stock'] =
              (disqualifiedReasons['out_of_stock'] || 0) + 1;
            continue;
          }

          // 반품 등급(offerCondition이 NEW가 아님) 옵션은 원본과 완전히 다른
          // sellerProductId로 등록되므로(실측 확인), 그냥 이 sellerProductId
          // 기준으로 별도 상품으로 등록한다 - 원가/마진을 원본과 따로
          // 입력해야 하기 때문에 합치지 않는다. is_return_grade만 표시해서
          // 판매 동기화 때 쿠폰 할인을 안 빼도록 구분한다.
          const isReturnGrade = !!(
            item.offerCondition && item.offerCondition !== 'NEW'
          );

          // 기준 통과 - 이 sellerProductId에 해당하는 대표 상품 행을 찾거나 새로 만든다
          if (!productRowId) {
            const baseName =
              p.sellerProductName ||
              detailData.sellerProductName ||
              `쿠팡 상품 (${sellerProductId})`;
            const displayName = isReturnGrade
              ? `${baseName} (반품등급)`
              : baseName;

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
                  notes: isReturnGrade
                    ? '쿠팡 상품 카탈로그 동기화로 등록됨 (반품등급 재판매, 쿠폰 할인 미적용)'
                    : '쿠팡 상품 카탈로그 동기화로 등록됨 (로켓그로스·재고있음·바코드확인)',
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
              {
                product_id: productRowId,
                vendor_item_id: vendorItemId,
                is_return_grade: isReturnGrade,
              },
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

  // 시도했다는 사실 자체를 기록 - 이번에 API 에러가 났어도 쿨다운은 갱신해서
  // 잘못된 설정 등으로 계속 재시도하며 할당량을 태우는 걸 막는다.
  await supabase
    .from('channel_credentials')
    .update({ catalog_synced_at: new Date().toISOString() })
    .eq('channel', 'coupang');

  return {
    scannedProducts,
    scannedItems,
    qualified,
    disqualified,
    disqualifiedReasons,
    createdProducts,
    mappedVendorItems,
    inventoryByVendorItem,
    error: lastError,
    debug: {
      firstInventoryCheckError,
      sampleDetailKeys,
      sampleItemKeys,
      sampleItemAttributes,
      sampleItemCertifications,
      sampleItemContents,
      sampleItemSearchTags,
      sampleRocketGrowthItemData,
      sampleMarketplaceItemData,
      sampleRocketGrowthAdditionalInfo,
      allScannedProducts,
    },
  };
}

export async function runCoupangOrderSync(
  supabase: any,
  authorEmail: string,
  daysBack: number = 2,
  // true면 쿠팡이 실제로 내려주는 주문 원본 JSON을 그대로 담아서 반환한다.
  // 반품이 API 응답에서 정확히 어떤 형태로 표현되는지 확인하기 위한 임시 디버그용.
  includeRawOrders = false
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
  // 서버는 UTC로 돌기 때문에 그냥 new Date()를 쓰면 한국시간 기준 "오늘"보다
  // 하루 늦게 계산될 수 있다. KST(UTC+9) 기준 오늘 날짜로 보정한다.
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const today = new Date(Date.now() + kstOffsetMs);
  const ranges: { from: Date; to: Date }[] = [];
  let remaining = daysBack;
  let cursor = new Date(today);
  let isFirstRange = true;

  while (remaining > 0) {
    const rangeDays = Math.min(remaining, MAX_RANGE_DAYS);
    const to = new Date(cursor);
    if (isFirstRange) {
      // 실측 확인: 쿠팡 API는 paidDateTo로 지정한 날짜를 포함하지 않는다
      // (그 이전까지만 조회됨). 그래서 항상 "오늘"을 paidDateTo로 넘기면
      // 오늘 주문이 통째로 빠진다 - 최신 구간의 끝은 하루 뒤로 잡는다.
      to.setDate(to.getDate() + 1);
      isFirstRange = false;
    }
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
  const unmappedNames: Record<string, string> = {};
  const rawOrdersSample: any[] = [];

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

        if (includeRawOrders && rawOrdersSample.length < 30) {
          rawOrdersSample.push(...orders.slice(0, 30 - rawOrdersSample.length));
        }

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
              unmappedNames[vendorItemId] = productName;
              continue;
            }

            const externalRef = `coupang-order:${order.orderId}:${vendorItemId}`;
            const salesQty = Number(item.salesQuantity) || 0;
            if (salesQty === 0) continue;

            // 쿠팡이 반품을 같은 주문 목록 안에서 음수 salesQuantity로 내려주는
            // 경우를 대비한 처리 - 무조건 버리지 않고 입고(반품)로 남긴다.
            const isReturn = salesQty < 0;
            const qty = Math.abs(salesQty);
            // 쿠팡 API가 주는 정가를 그대로 쓴다 - 쿠폰 할인을 빼면 오히려
            // 쿠팡 판매자센터 자체 대시보드(그것도 정가 기준으로 표시함)와
            // 안 맞게 된다는 게 실측으로 확인됐다. 할인 반영 마진은 별도
            // (상품 카드 마진 계산, 성과 분석)에서만 다룬다.
            const unitPrice = Number(item.unitSalesPrice || 0);

            const { data: inserted, error } = await supabase
              .from('stock_movements')
              .upsert(
                {
                  product_id: productId,
                  warehouse: 'coupang',
                  type: isReturn ? 'in' : 'out',
                  quantity: isReturn ? qty : -qty,
                  channel: 'coupang',
                  amount: (isReturn ? -1 : 1) * qty * unitPrice,
                  external_ref: externalRef,
                  occurred_at: new Date(Number(order.paidAt)).toISOString(),
                  note: isReturn
                    ? `쿠팡 반품 (${productName})`
                    : `쿠팡 판매 (${productName})`,
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
      unmappedNames,
      rawOrdersSample: includeRawOrders ? rawOrdersSample : undefined,
    },
  };
}

// ============================================================
// 쿠팡 반품/취소 동기화
// - 주문조회 API(rg/orders)는 반품 건을 아예 포함하지 않아서(실측 확인됨),
//   반품/취소 전용 API(returnRequests)를 별도로 호출해서 매출/재고 이력에
//   반영한다. 원래 판매가는 이 API가 안 주기 때문에, 같은 주문(orderId)의
//   판매 기록(stock_movements)에서 단가를 역산해서 환불액을 계산한다.
// ============================================================
export async function runCoupangReturnSync(
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
    return { logged: 0, skipped: 0, unmapped: 0, debug: 'no cred / not connected' };
  }

  const { data: mappings } = await supabase
    .from('product_vendor_items')
    .select('product_id, vendor_item_id');

  const mapByVendorItem: Record<string, string> = {};
  for (const m of mappings || []) {
    mapByVendorItem[String(m.vendor_item_id)] = m.product_id;
  }

  // yyyy-MM-ddTHH:mm (KST) 포맷
  const fmtDateTime = (d: Date) => {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(
      d.getUTCDate()
    )}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  };

  const MAX_RANGE_DAYS = 31;
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const today = new Date(Date.now() + kstOffsetMs);
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
  let rawReturnCount = 0;

  try {
    for (const range of ranges) {
      let nextToken: string | undefined = undefined;
      do {
        const { data: receipts, nextToken: next } =
          await fetchCoupangReturnRequests({
            vendorId: cred.vendor_id,
            accessKey: cred.access_key,
            secretKey: cred.secret_key,
            createdAtFrom: fmtDateTime(range.from),
            createdAtTo: fmtDateTime(range.to),
            nextToken,
          });
        nextToken = next;
        rawReturnCount += receipts.length;

        for (const receipt of receipts) {
          for (const item of receipt.returnItems || []) {
            const vendorItemId = String(item.vendorItemId);
            const productId = mapByVendorItem[vendorItemId];
            const productName =
              item.vendorItemName || item.sellerProductName || `쿠팡 상품 (${vendorItemId})`;
            const cancelCount = Number(item.cancelCount) || 0;

            if (!productId || cancelCount === 0) {
              if (!productId) unmapped++;
              continue;
            }

            // 원래 판매가를 이 API가 안 주므로, 같은 주문의 판매 기록에서
            // 단가를 역산한다 (없으면 환불액은 0으로 남는다).
            let unitPrice = 0;
            const { data: origSale } = await supabase
              .from('stock_movements')
              .select('quantity, amount')
              .eq('external_ref', `coupang-order:${receipt.orderId}:${vendorItemId}`)
              .maybeSingle();
            if (origSale && origSale.quantity) {
              unitPrice = Math.abs(Number(origSale.amount) / Number(origSale.quantity));
            }

            const externalRef = `coupang-return:${receipt.receiptId}:${vendorItemId}`;

            const { data: inserted, error } = await supabase
              .from('stock_movements')
              .upsert(
                {
                  product_id: productId,
                  warehouse: 'coupang',
                  type: 'in',
                  quantity: cancelCount,
                  channel: 'coupang',
                  amount: -cancelCount * unitPrice,
                  external_ref: externalRef,
                  occurred_at: new Date(receipt.createdAt).toISOString(),
                  note: `쿠팡 반품 (${productName}) - ${
                    receipt.reasonCodeText || receipt.cancelReasonCategory2 || '사유 미상'
                  }`,
                  author_email: authorEmail,
                },
                { onConflict: 'external_ref', ignoreDuplicates: true }
              )
              .select();

            if (error) {
              if (!lastError) lastError = error.message;
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
    console.error('runCoupangReturnSync error:', e);
  }

  return {
    logged,
    skipped,
    unmapped,
    error: lastError,
    debug: { rawReturnCount },
  };
}