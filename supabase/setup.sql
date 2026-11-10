-- Budapest Építészettörténeti Atlasz – online adatbázis beállítása (Supabase)
-- Használat: Supabase → SQL Editor → New query → ide másolod az egészet → Run.
-- Többször is lefuttatható, nem töröl adatot.
--
-- Felépítés: a weboldalba épített adatkészletek (pl. a kvízépületek) fájlként élnek tovább;
-- ebben a táblában a felvitt és módosított épületek vannak (teljes rekord JSON-ként),
-- valamint a törlések jelölése. Olvasni bárki tud, írni csak bejelentkezett szerkesztő.

create table if not exists public.buildings (
  id          text primary key,
  data        jsonb not null,                 -- a teljes épületrekord (az alkalmazás formátumában)
  deleted     boolean not null default false, -- törölt (pl. egy beépített rekord elrejtése)
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) default auth.uid()
);

create index if not exists buildings_updated_idx on public.buildings (updated_at desc);

-- Módosítási napló: minden mentés és törlés visszakereshető
create table if not exists public.building_history (
  id          bigserial primary key,
  building_id text not null,
  data        jsonb,
  deleted     boolean not null default false,
  changed_at  timestamptz not null default now(),
  changed_by  uuid default auth.uid()
);

create or replace function public.log_building_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.building_history (building_id, data, deleted, changed_by)
  values (new.id, new.data, new.deleted, auth.uid());
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists buildings_log on public.buildings;
create trigger buildings_log before insert or update on public.buildings
for each row execute function public.log_building_change();

-- Jogosultságok (Row Level Security)
alter table public.buildings enable row level security;
alter table public.building_history enable row level security;

drop policy if exists "buildings: mindenki olvashatja" on public.buildings;
create policy "buildings: mindenki olvashatja" on public.buildings
  for select using (true);

drop policy if exists "buildings: szerkesztő írhatja" on public.buildings;
create policy "buildings: szerkesztő írhatja" on public.buildings
  for all to authenticated using (true) with check (true);

drop policy if exists "history: szerkesztő olvashatja" on public.building_history;
create policy "history: szerkesztő olvashatja" on public.building_history
  for select to authenticated using (true);
