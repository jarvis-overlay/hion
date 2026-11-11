'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

function numOrNull(fd: FormData, key: string): number | null {
  const v = fd.get(key);
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ShippingCostCalculator가 hidden input에 JSON 문자열로 담아 보낸다 -
// jsonb 컬럼에는 파싱한 객체로 넣어야 나중에 읽을 때(Supabase가 자동
// 파싱) 다시 그대로 쓸 수 있다.
function jsonOrNull(fd: FormData, key: string): unknown | null {
  const v = fd.get(key);
  if (v == null || v === '') return null;
  try {
    return JSON.parse(String(v));
  } catch {
    return null;
  }
}

// 비교 상품군 링크 하나 - 쿠팡/네이버에서 관찰한 가격대·시장규모를 각각
// 여러 건 남길 수 있다(같은 플랫폼 안에서도 가격대별 시장규모가 다르게
// 형성돼 있을 수 있어서).
export interface ComparisonPriceInput {
  platform: 'coupang' | 'naver';
  priceRange: string;
  marketSize: 'high' | 'mid' | 'low' | '';
}
// source: 사용자가 손으로 입력했는지('manual'), "쿠팡 실데이터로 조사"
// 기능으로 자동 저장했는지('coupang_auto') 구분. 생략하면 'manual'로
// 저장(과거 호출부와 호환).
export interface ComparisonInput {
  title: string;
  link: string;
  prices: ComparisonPriceInput[];
  source?: 'manual' | 'coupang_auto';
}

// title+link 쌍으로 비교 상품을 구분하기 위한 키 - insert 전 입력값과
// insert 후 반환값에 항상 같은 변환(빈 문자열 -> null)을 적용해야 매칭된다.
function comparisonKey(title: string, link: string): string {
  return `${title || ''}|||${link || ''}`;
}

// comparisons 전체를 sourcing_item_comparisons에 한 번에(배열로) insert한다
// - 예전엔 한 건씩 루프로 insert해서, 여러 건 저장 중 중간에 하나가
// 실패하면 이미 저장된 건까지 포함해 "저장 실패"로 보이고 사용자가
// 재시도하면 중복 저장되는 문제가 있었다. 완벽한 트랜잭션은 아니지만,
// 이 테이블에 대한 insert 자체를 단일 statement로 묶어서 부분 실패
// 가능성을 크게 줄인다.
//
// 반환된 id를 원래 입력과 매칭할 때 inserted[i] <-> comparisons[i] 인덱스
// 순서가 그대로 보존된다고 가정하면 안 된다(Postgres/PostgREST가 공식으로
// 보장하는 동작이 아님) - 실제로 순서가 어긋나면 A 상품에 B 상품의
// 가격대가 조용히 붙는 데이터 오염이 생기고 에러도 안 난다. 그래서 title+link
// 쌍으로 다시 매칭한다. 같은 배치 안에 title+link가 완전히 동일한 항목이
// 여러 개 들어오는 극단적 경우는 큐(순서대로 소비)로 대충 구분되지만
// 완벽히 보장되진 않는다 - 이 프로젝트 규모(2인용, 배치당 몇 건)에선
// 감당할 만한 리스크로 보고 넘어간다.
async function insertComparisons(
  supabase: ReturnType<typeof createClient>,
  sourcingItemId: string,
  comparisons: ComparisonInput[]
): Promise<string | null> {
  if (comparisons.length === 0) return null;

  const { data: inserted, error: compErr } = await supabase
    .from('sourcing_item_comparisons')
    .insert(
      comparisons.map((c) => ({
        sourcing_item_id: sourcingItemId,
        title: c.title || null,
        link: c.link || null,
        source: c.source || 'manual',
      }))
    )
    .select('id, title, link');
  if (compErr) {
    // source 컬럼 마이그레이션(supabase/migrations/..._add_comparison_source.sql)이
    // 원격 DB에 아직 적용 안 됐으면 기존 수동 "비교 상품 추가"까지 전부
    // 깨질 수 있어서, 컬럼 없음 에러를 알아보기 쉬운 한국어 안내로
    // 바꿔준다 (updateSourcingPriority/archiveSourcingItem과 같은 패턴).
    if (/source/i.test(compErr.message) && /column|schema cache/i.test(compErr.message)) {
      return '비교 상품 구분(수동/쿠팡 자동조사) 컬럼이 DB에 아직 없어요. supabase/migrations의 add_comparison_source 마이그레이션을 원격 DB에 먼저 적용해주세요(npx supabase db push --remote).';
    }
    return compErr.message;
  }

  // (title, link) -> id 큐. 같은 키가 여러 번 나오면 순서대로 하나씩 빼서 쓴다.
  const idQueueByKey = new Map<string, string[]>();
  for (const row of (inserted as { id: string; title: string | null; link: string | null }[]) || []) {
    const key = comparisonKey(row.title || '', row.link || '');
    const queue = idQueueByKey.get(key) || [];
    queue.push(row.id);
    idQueueByKey.set(key, queue);
  }

  const priceRows: {
    comparison_id: string;
    platform: ComparisonPriceInput['platform'];
    price_range: string | null;
    market_size: ComparisonPriceInput['marketSize'] | null;
  }[] = [];
  for (const c of comparisons) {
    const key = comparisonKey(c.title, c.link);
    const id = idQueueByKey.get(key)?.shift();
    if (!id) return '비교 상품을 저장했지만 가격대 정보를 연결하지 못했어요. 새로고침 후 다시 시도해주세요.';
    for (const p of c.prices) {
      priceRows.push({
        comparison_id: id,
        platform: p.platform,
        price_range: p.priceRange || null,
        market_size: p.marketSize || null,
      });
    }
  }

  if (priceRows.length > 0) {
    const { error: priceErr } = await supabase.from('sourcing_comparison_prices').insert(priceRows);
    if (priceErr) return priceErr.message;
  }
  return null;
}

export async function addSourcingItem(
  formData: FormData,
  comparisons: ComparisonInput[] = []
): Promise<{ error: string } | { success: true }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: '로그인이 필요해요.' };

  const title = String(formData.get('title') || '').trim();
  const link = String(formData.get('link') || '').trim();
  const content = String(formData.get('content') || '').trim();
  const moq = String(formData.get('moq') || '').trim();

  if (!title) return { error: '상품명을 입력해주세요.' };

  const priceNum = numOrNull(formData, 'price');
  const costNum = numOrNull(formData, 'cost');

  const { data: item, error } = await supabase
    .from('sourcing_items')
    .insert({
      title,
      link: link || null,
      content: content || null,
      moq: moq || null,
      price: priceNum,
      cost: costNum,
      // 등록 시점엔 판매가·원가가 둘 다 있으면 '입력'으로 시작하고,
      // 이후로는 카드에서 수동으로 바꿀 수 있는 독립적인 값이다 (가격을
      // 나중에 고쳐도 이 값이 자동으로 따라 바뀌진 않음).
      input_status: priceNum != null && costNum != null ? 'entered' : 'not_entered',
      coupon: numOrNull(formData, 'coupon'),
      output_vat: numOrNull(formData, 'output_vat'),
      import_vat: numOrNull(formData, 'import_vat'),
      coupang_fee: numOrNull(formData, 'coupang_fee'),
      shipping: numOrNull(formData, 'shipping'),
      intl_shipping: numOrNull(formData, 'intl_shipping'),
      intl_shipping_calc: jsonOrNull(formData, 'intl_shipping_calc'),
      ad_cost: numOrNull(formData, 'ad_cost'),
      etc_cost: numOrNull(formData, 'etc_cost'),
      cost_fx_currency: String(formData.get('cost_fx_currency') || '').trim() || null,
      cost_fx_amount: numOrNull(formData, 'cost_fx_amount'),
      cost_fx_rate: numOrNull(formData, 'cost_fx_rate'),
      author_email: user.email,
    })
    .select('id')
    .single();

  if (error) return { error: error.message };

  if (comparisons.length > 0 && item) {
    const compErr = await insertComparisons(supabase, (item as { id: string }).id, comparisons);
    if (compErr) return { error: compErr };
  }

  revalidatePath('/dashboard/sourcing/list');
  return { success: true };
}

// 이미 등록된 소싱 후보에 비교 상품군을 나중에 추가 (옵션 구성/공급처
// 비교와 같은 패턴 - 카드 안에서 펼쳐서 즉시 추가).
export async function addSourcingComparison(
  sourcingItemId: string,
  comparison: ComparisonInput
): Promise<{ error: string } | { success: true }> {
  const supabase = createClient();
  const err = await insertComparisons(supabase, sourcingItemId, [comparison]);
  if (err) return { error: err };

  revalidatePath('/dashboard/sourcing/list');
  return { success: true };
}

// "쿠팡 실데이터로 조사"에서 선택한 후보 여러 건을 한 번에 저장한다 -
// insertComparisons가 이미 배열을 받으므로 N번 왕복 없이 그대로 재사용.
export async function addSourcingComparisons(
  sourcingItemId: string,
  comparisons: ComparisonInput[]
): Promise<{ error: string } | { success: true }> {
  if (comparisons.length === 0) return { error: '저장할 비교 상품을 선택해주세요.' };
  const supabase = createClient();
  const err = await insertComparisons(supabase, sourcingItemId, comparisons);
  if (err) return { error: err };

  revalidatePath('/dashboard/sourcing/list');
  return { success: true };
}

// 비교 상품 하나를 수정 - 가격/시장규모 관측치는 개별로 diff하지 않고
// 통째로 지우고 새로 넣는 게 단순하고 안전하다 (편집 중 추가/삭제/수정이
// 뒤섞여도 항상 최종 상태만 반영하면 됨).
export async function updateSourcingComparison(
  comparisonId: string,
  comparison: ComparisonInput
): Promise<{ error: string } | { success: true }> {
  const supabase = createClient();

  const { error: updateErr } = await supabase
    .from('sourcing_item_comparisons')
    .update({ title: comparison.title || null, link: comparison.link || null })
    .eq('id', comparisonId);
  if (updateErr) return { error: updateErr.message };

  const { error: delErr } = await supabase
    .from('sourcing_comparison_prices')
    .delete()
    .eq('comparison_id', comparisonId);
  if (delErr) return { error: delErr.message };

  if (comparison.prices.length > 0) {
    const { error: insErr } = await supabase.from('sourcing_comparison_prices').insert(
      comparison.prices.map((p) => ({
        comparison_id: comparisonId,
        platform: p.platform,
        price_range: p.priceRange || null,
        market_size: p.marketSize || null,
      }))
    );
    if (insErr) return { error: insErr.message };
  }

  revalidatePath('/dashboard/sourcing/list');
  return { success: true };
}

export async function deleteSourcingComparison(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from('sourcing_item_comparisons').delete().eq('id', id);
  if (error) console.error('[sourcing] deleteSourcingComparison 실패:', error.message);
  revalidatePath('/dashboard/sourcing/list');
}

// 카드 인라인 수정 - 상태/후보-확정 말고 나머지 항목(상품명, 링크,
// 메모, 마진 관련 수치 전체)까지 한번에 고칠 수 있어야 한다는 요청으로
// 추가함.
export async function updateSourcingItem(
  id: string,
  formData: FormData
): Promise<{ error: string } | { success: true }> {
  const supabase = createClient();
  const title = String(formData.get('title') || '').trim();
  if (!title) return { error: '상품명을 입력해주세요.' };

  const { error } = await supabase
    .from('sourcing_items')
    .update({
      title,
      link: String(formData.get('link') || '').trim() || null,
      content: String(formData.get('content') || '').trim() || null,
      moq: String(formData.get('moq') || '').trim() || null,
      price: numOrNull(formData, 'price'),
      cost: numOrNull(formData, 'cost'),
      coupon: numOrNull(formData, 'coupon'),
      output_vat: numOrNull(formData, 'output_vat'),
      import_vat: numOrNull(formData, 'import_vat'),
      coupang_fee: numOrNull(formData, 'coupang_fee'),
      shipping: numOrNull(formData, 'shipping'),
      intl_shipping: numOrNull(formData, 'intl_shipping'),
      intl_shipping_calc: jsonOrNull(formData, 'intl_shipping_calc'),
      ad_cost: numOrNull(formData, 'ad_cost'),
      etc_cost: numOrNull(formData, 'etc_cost'),
      cost_fx_currency: String(formData.get('cost_fx_currency') || '').trim() || null,
      cost_fx_amount: numOrNull(formData, 'cost_fx_amount'),
      cost_fx_rate: numOrNull(formData, 'cost_fx_rate'),
    })
    .eq('id', id);

  if (error) return { error: error.message };

  revalidatePath('/dashboard/sourcing/list');
  return { success: true };
}

export async function updateSourcingStatus(id: string, status: string) {
  const supabase = createClient();
  const { error } = await supabase.from('sourcing_items').update({ status }).eq('id', id);
  if (error) console.error('[sourcing] updateSourcingStatus 실패:', error.message);
  revalidatePath('/dashboard/sourcing/list');
}

export async function updateSourcingStage(id: string, stage: string) {
  const supabase = createClient();
  const { error } = await supabase.from('sourcing_items').update({ stage }).eq('id', id);
  if (error) console.error('[sourcing] updateSourcingStage 실패:', error.message);
  revalidatePath('/dashboard/sourcing/list');
}

// priority: '1' | '2' | '3' | '' (빈 문자열 = 미지정, null로 저장)
// 저장에 실패하면 화면에 원인을 보여줘야 한다 - 예전엔 서버 로그에만 남겨서
// DB에 priority 컬럼이 없어도 값이 조용히 "미지정"으로 되돌아갈 뿐이라
// 원인을 알 수 없었다.
export async function updateSourcingPriority(
  id: string,
  priority: string
): Promise<{ error: string } | { success: true }> {
  const supabase = createClient();
  const { error } = await supabase
    .from('sourcing_items')
    .update({ priority: priority || null })
    .eq('id', id);
  if (error) {
    console.error('[sourcing] updateSourcingPriority 실패:', error.message);
    if (/priority/i.test(error.message) && /column|schema cache/i.test(error.message)) {
      return {
        error:
          '우선순위를 저장할 DB 컬럼이 아직 없어요. Supabase SQL Editor에서 supabase/sourcing_items_add_priority.sql을 실행해주세요.',
      };
    }
    return { error: error.message };
  }
  revalidatePath('/dashboard/sourcing/list');
  return { success: true };
}

export async function updateSourcingInputStatus(id: string, inputStatus: string) {
  const supabase = createClient();
  const { error } = await supabase
    .from('sourcing_items')
    .update({ input_status: inputStatus })
    .eq('id', id);
  if (error) console.error('[sourcing] updateSourcingInputStatus 실패:', error.message);
  revalidatePath('/dashboard/sourcing/list');
}

// 더 이상 소싱하지 않기로 한 항목을 지우지 않고 "보관함"으로만 옮긴다 -
// 메인 목록에서는 안 보이지만 나중에 다시 꺼내볼 수 있어야 한다는
// 요청으로 추가함. priority 컬럼 때와 같은 이유로, 마이그레이션을 아직
// 안 돌렸으면 명확한 안내 메시지를 보여준다.
export async function archiveSourcingItem(id: string): Promise<{ error: string } | { success: true }> {
  const supabase = createClient();
  const { error } = await supabase
    .from('sourcing_items')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    console.error('[sourcing] archiveSourcingItem 실패:', error.message);
    if (/archived_at/i.test(error.message) && /column|schema cache/i.test(error.message)) {
      return {
        error:
          '보관함 기능을 쓰려면 DB 컬럼이 필요해요. Supabase SQL Editor에서 supabase/sourcing_items_add_archived.sql을 실행해주세요.',
      };
    }
    return { error: error.message };
  }
  revalidatePath('/dashboard/sourcing/list');
  return { success: true };
}

export async function unarchiveSourcingItem(id: string): Promise<{ error: string } | { success: true }> {
  const supabase = createClient();
  const { error } = await supabase.from('sourcing_items').update({ archived_at: null }).eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/dashboard/sourcing/list');
  return { success: true };
}

export async function deleteSourcingItem(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from('sourcing_items').delete().eq('id', id);
  if (error) console.error('[sourcing] deleteSourcingItem 실패:', error.message);
  revalidatePath('/dashboard/sourcing/list');
}

// 같은 상품이라도 색상/사이즈 등 옵션마다 가격·원가가 달라서 마진을
// 따로 계산해야 한다는 요청으로 추가함 - sourcing_items 1건에 여러
// 옵션을 붙일 수 있음.
export async function addSourcingOption(
  sourcingItemId: string,
  formData: FormData
): Promise<{ error: string } | { success: true }> {
  const supabase = createClient();
  const name = String(formData.get('name') || '').trim();
  if (!name) return { error: '옵션명을 입력해주세요.' };

  const { error } = await supabase.from('sourcing_item_options').insert({
    sourcing_item_id: sourcingItemId,
    name,
    price: numOrNull(formData, 'price'),
    cost: numOrNull(formData, 'cost'),
    coupon: numOrNull(formData, 'coupon'),
    output_vat: numOrNull(formData, 'output_vat'),
    import_vat: numOrNull(formData, 'import_vat'),
    coupang_fee: numOrNull(formData, 'coupang_fee'),
    shipping: numOrNull(formData, 'shipping'),
    ad_cost: numOrNull(formData, 'ad_cost'),
    etc_cost: numOrNull(formData, 'etc_cost'),
  });

  if (error) return { error: error.message };

  revalidatePath('/dashboard/sourcing/list');
  return { success: true };
}

export async function deleteSourcingOption(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from('sourcing_item_options').delete().eq('id', id);
  if (error) console.error('[sourcing] deleteSourcingOption 실패:', error.message);
  revalidatePath('/dashboard/sourcing/list');
}

// 하나의 상품을 소싱할 때 여러 1688/알리바바 공급처를 가격 비교하면서
// 찾는 경우가 있다는 요청으로 추가함 - sourcing_items 1건에 여러
// 공급처 후보(링크+가격)를 붙일 수 있음.
export async function addSourcingSupplier(
  sourcingItemId: string,
  formData: FormData
): Promise<{ error: string } | { success: true }> {
  const supabase = createClient();
  const link = String(formData.get('link') || '').trim();
  const price = numOrNull(formData, 'price');
  if (!link && price == null) return { error: '링크나 가격 중 하나는 입력해주세요.' };

  const { error } = await supabase.from('sourcing_item_suppliers').insert({
    sourcing_item_id: sourcingItemId,
    title: String(formData.get('title') || '').trim() || null,
    link: link || null,
    price,
    currency: String(formData.get('currency') || 'CNY'),
    notes: String(formData.get('notes') || '').trim() || null,
  });

  if (error) return { error: error.message };

  revalidatePath('/dashboard/sourcing/list');
  return { success: true };
}

export async function updateSourcingSupplier(
  id: string,
  formData: FormData
): Promise<{ error: string } | { success: true }> {
  const supabase = createClient();
  const link = String(formData.get('link') || '').trim();
  const price = numOrNull(formData, 'price');
  if (!link && price == null) return { error: '링크나 가격 중 하나는 입력해주세요.' };

  const { error } = await supabase
    .from('sourcing_item_suppliers')
    .update({
      title: String(formData.get('title') || '').trim() || null,
      link: link || null,
      price,
      currency: String(formData.get('currency') || 'CNY'),
      notes: String(formData.get('notes') || '').trim() || null,
    })
    .eq('id', id);

  if (error) return { error: error.message };

  revalidatePath('/dashboard/sourcing/list');
  return { success: true };
}

export async function deleteSourcingSupplier(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from('sourcing_item_suppliers').delete().eq('id', id);
  if (error) console.error('[sourcing] deleteSourcingSupplier 실패:', error.message);
  revalidatePath('/dashboard/sourcing/list');
}
