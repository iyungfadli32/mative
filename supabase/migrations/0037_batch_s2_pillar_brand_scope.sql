-- 0037_batch_s2_pillar_brand_scope.sql
-- Batch S-2, temuan S-6: trigger validate_content_item_scope kini juga menegakkan
-- pilar satu brand dengan konten (bila pilar punya brand). Sebelumnya trigger hanya
-- memeriksa pilar satu workspace, sehingga konten Brand A bisa berlabel pilar Brand B.
-- Pilar tanpa brand tetap berlaku untuk semua brand (dan untuk konten tanpa brand).
-- Form (ContentForm) memfilter opsi pilar dengan aturan yang sama.
create or replace function public.validate_content_item_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ws uuid;
begin
  -- Brand NULL diizinkan (kolom nullable; ide tanpa brand sah) — sama
  -- seperti validate_idea_scope(). Brand yang terisi tetap wajib satu
  -- workspace dengan item.
  if new.brand_id is not null then
    select workspace_id into v_ws from public.brands where id = new.brand_id;
    if v_ws is null or v_ws <> new.workspace_id then
      raise exception 'scope mismatch: content_items.brand_id belongs to a different workspace';
    end if;
  end if;
  if new.campaign_id is not null then
    select workspace_id into v_ws from public.campaigns where id = new.campaign_id;
    if v_ws is null or v_ws <> new.workspace_id then
      raise exception 'scope mismatch: content_items.campaign_id belongs to a different workspace';
    end if;
  end if;
  if new.pillar_id is not null then
    select workspace_id into v_ws from public.content_pillars where id = new.pillar_id;
    if v_ws is null or v_ws <> new.workspace_id then
      raise exception 'scope mismatch: content_items.pillar_id belongs to a different workspace';
    end if;
      -- S-6 (Batch S-2): pilar ber-brand hanya boleh dipakai konten brand yang sama;
      -- pilar tanpa brand berlaku untuk semua brand (dan untuk konten tanpa brand).
      if exists (
        select 1
        from public.content_pillars p
        where p.id = new.pillar_id
          and p.brand_id is not null
          and p.brand_id is distinct from new.brand_id
      ) then
        raise exception 'scope mismatch: content_items.pillar_id belongs to a different brand';
      end if;
  end if;
  if new.audience_id is not null then
    select workspace_id into v_ws from public.audiences where id = new.audience_id;
    if v_ws is null or v_ws <> new.workspace_id then
      raise exception 'scope mismatch: content_items.audience_id belongs to a different workspace';
    end if;
  end if;
  if new.origin_idea_id is not null then
    select workspace_id into v_ws from public.ideas where id = new.origin_idea_id;
    if v_ws is null or v_ws <> new.workspace_id then
      raise exception 'scope mismatch: content_items.origin_idea_id belongs to a different workspace';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.validate_content_item_scope() is 'Trigger scope (0007, diperbaiki 0011, 0037): item-brand/campaign/pillar/audience/origin-idea satu workspace; brand NULL diizinkan; pilar ber-brand harus satu brand dengan konten.';

revoke all on function public.validate_content_item_scope() from public;
