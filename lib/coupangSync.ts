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

  // 로켓그로스 반품이 발생하면 원래 상품이 아니라 offerCondition이
  // RETURN_GOOD/RETURN_NORMAL 등인 완전히 별도의 sellerProductId로 새로
  // 등록된다 (실측 확인). displayProductName/barcode는 원본과 다르지만
  // rocketGrowthItemData.skuInfo.inboundName(입고명)은 원본과 동일하게
  // 유지되길래, 이걸로 "같은 물리적 상품"을 매칭해서 새 상품으로 쪼개지
  // 않고 원본에 옵션ID만 추가 매핑한다. 정상(NEW) 상품을 먼저 전부 처리한
  // 뒤에, 반품 등급 항목들은 나중에 한꺼번에 매칭 처리한다.
  const inboundNameToProductId: Record<string, string> = {};
  const pendingReturnItems: {
    sellerProductId: string | number;
    sellerProductName?: string;
    vendorItemId: string;
    inboundName?: string;
  }[] = [];
  let mergedReturnItems = 0;
  let unmatchedReturnItems = 0;

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

          const inboundName = rgData.skuInfo?.inboundName?.trim();

          // 반품 등급(offerCondition이 NEW가 아님) 옵션은 새 상품으로 바로
          // 등록하지 않고, 정상 상품을 다 처리한 뒤 inboundName으로 원본을
          // 찾아서 매핑한다.
          if (item.offerCondition && item.offerCondition !== 'NEW') {
            pendingReturnItems.push({
              sellerProductId,
              sellerProductName:
                p.sellerProductName || detailData.sellerProductName,
              vendorItemId,
              inboundName,
            });
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

          if (inboundName && !inboundNameToProductId[inboundName]) {
            inboundNameToProductId[inboundName] = productRowId!;
          }

          qualified++;
        }
      }
    } while (nextToken);

    // 반품 등급 옵션들을 원본 상품에 매핑 (inboundName 매칭). 매칭되는 원본이
    // 없으면(원본이 이미 삭제됐거나 하는 예외) 예전처럼 별도 상품으로 등록.
    for (const pending of pendingReturnItems) {
      let productRowId = pending.inboundName
        ? inboundNameToProductId[pending.inboundName]
        : undefined;

      if (productRowId) {
        mergedReturnItems++;
      } else {
        unmatchedReturnItems++;
        const displayName =
          pending.sellerProductName || `쿠팡 상품 (${pending.sellerProductId})`;

        const { data: existing } = await supabase
          .from('products')
          .select('id')
          .eq('coupang_seller_product_id', String(pending.sellerProductId))
          .maybeSingle();

        if (existing) {
          productRowId = existing.id;
        } else {
          const { data: created, error: createErr } = await supabase
            .from('products')
            .insert({
              name: displayName,
              coupang_seller_product_id: String(pending.sellerProductId),
              author_email: authorEmail,
              notes:
                '쿠팡 상품 카탈로그 동기화로 등록됨 (반품등급, 원본 상품 매칭 실패)',
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
          { product_id: productRowId, vendor_item_id: pending.vendorItemId },
          { onConflict: 'vendor_item_id' }
        );
      if (!mapErr) mappedVendorItems++;
      else lastError = mapErr.message;

      qualified++;
    }
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
    mergedReturnItems,
    unmatchedReturnItems,
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