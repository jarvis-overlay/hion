-- Supabase SQL Editor에서 실행하세요.
-- "판매" 대분류 - 1688 원본 이미지를 한국 판매용으로 가공(번역/누끼/
-- 쿠팡 규격 리사이즈)하는 기능에 쓸 저장소 버킷 + 테이블. 각 처리 단계는
-- 독립적으로 실행 가능해서, 한 이미지 행에 단계별 결과 URL을 각각
-- 저장한다 (원본은 항상 있고 나머지는 처리한 것만 채워짐).

insert into storage.buckets (id, name, public)
values ('detail-images', 'detail-images', true)
on conflict (id) do nothing;

-- 버킷은 public이라 읽기는 누구나 가능(실제 판매 이미지로 쓰려면
-- 어차피 공개 URL이어야 함) - 쓰기/삭제만 허용된 사용자로 제한.
drop policy if exists "detail_images_select" on storage.objects;
create policy "detail_images_select" on storage.objects
  for select using (bucket_id = 'detail-images');

drop policy if exists "detail_images_insert" on storage.objects;
create policy "detail_images_insert" on storage.objects
  for insert with check (
    bucket_id = 'detail-images'
    and auth.jwt() ->> 'email' in (select email from allowed_users)
  );

drop policy if exists "detail_images_update" on storage.objects;
create policy "detail_images_update" on storage.objects
  for update using (
    bucket_id = 'detail-images'
    and auth.jwt() ->> 'email' in (select email from allowed_users)
  );

drop policy if exists "detail_images_delete" on storage.objects;
create policy "detail_images_delete" on storage.objects
  for delete using (
    bucket_id = 'detail-images'
    and auth.jwt() ->> 'email' in (select email from allowed_users)
  );

create table if not exists sourcing_item_images (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sourcing_item_id uuid not null references sourcing_items(id) on delete cascade,
  original_url text not null,
  translated_url text,  -- 중국어->한국어 텍스트 합성 결과
  cutout_url text,      -- 배경 제거(누끼) 결과
  resized_url text      -- 쿠팡 상세페이지 규격(가로 860px) 리사이즈 결과
);

alter table sourcing_item_images enable row level security;

create policy "sourcing_item_images_select" on sourcing_item_images
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_item_images_insert" on sourcing_item_images
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_item_images_update" on sourcing_item_images
  for update using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_item_images_delete" on sourcing_item_images
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));
