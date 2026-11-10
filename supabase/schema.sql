-- Budapest Építészettörténeti Atlasz – PostGIS séma (Supabase), 2. fázis
-- A kliensoldali modell (src/domain/types.ts) relációs megfelelője.
-- Futtatás: Supabase SQL Editor, vagy `psql -f supabase/schema.sql`.

create extension if not exists postgis;

-- Városok (később más magyar városokra is kiterjeszthető)
create table if not exists city (
  id text primary key,                 -- pl. 'budapest'
  name text not null
);
insert into city (id, name) values ('budapest', 'Budapest') on conflict do nothing;

create table if not exists district (
  id text primary key,                 -- pl. 'budapest-VII'
  city_id text not null references city(id),
  code text not null,                  -- 'VII'
  name text not null,
  geom geometry(MultiPolygon, 4326)
);
create index if not exists district_geom_idx on district using gist (geom);

-- Források: minden történeti adat ezekre hivatkozik
create table if not exists source (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  url text,
  kind text,                           -- levéltári, szakirodalom, adatbázis, terepbejárás, demo …
  license text,
  archive_ref text,                    -- pl. levéltári jelzet (BFL XV.17.d.329 …)
  note text,
  created_at timestamptz not null default now()
);

create type year_precision as enum ('exact', 'probable', 'range', 'unknown');
create type reliability as enum ('documented', 'probable', 'community', 'demo', 'unknown');
create type protection_status as enum ('muemlek', 'muemleki_kornyezet', 'helyi', 'nincs', 'ismeretlen');
create type record_status as enum ('draft', 'submitted', 'approved', 'rejected'); -- közösségi bővítés (3. fázis)

create table if not exists building (
  id text primary key,
  city_id text not null references city(id) default 'budapest',
  is_demo boolean not null default false,
  origin text not null default 'manual',       -- demo | osm | manual | import
  osm_ref text,                                -- 'way/123' – OSM-kontúrhoz kötés
  name text,
  address text,
  district_code text,
  geom geometry(Geometry, 4326) not null,      -- Polygon / MultiPolygon
  geometry_approx boolean not null default false,
  centroid geometry(Point, 4326) generated always as (st_pointonsurface(geom)) stored,

  -- építési idő: a pontosság mindig explicit, nincs „kitalált” év
  year_precision year_precision not null default 'unknown',
  year_exact int,
  year_from int,
  year_to int,
  year_note text,
  constraint year_consistency check (
    (year_precision in ('exact','probable') and year_exact is not null and year_from is null and year_to is null) or
    (year_precision = 'range' and year_exact is null and year_from is not null and year_to is not null and year_from <= year_to) or
    (year_precision = 'unknown' and year_exact is null and year_from is null and year_to is null)
  ),

  style text,
  original_function text,
  building_type text,
  floors int,
  structure text,
  current_function text,
  protection protection_status not null default 'ismeretlen',
  description text,

  status record_status not null default 'approved',
  created_by uuid,
  updated_at timestamptz not null default now()
);
create index if not exists building_geom_idx on building using gist (geom);
create index if not exists building_year_idx on building (year_exact, year_from, year_to);
create index if not exists building_district_idx on building (district_code);
create index if not exists building_style_idx on building (style);

create table if not exists architect (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  birth_year int,
  death_year int,
  note text
);
create table if not exists building_architect (
  building_id text references building(id) on delete cascade,
  architect_id uuid references architect(id),
  role text,                                   -- tervező, kivitelező, átépítés tervezője …
  primary key (building_id, architect_id, role)
);

create table if not exists alteration (
  id uuid primary key default gen_random_uuid(),
  building_id text not null references building(id) on delete cascade,
  year_exact int, year_from int, year_to int,
  description text not null
);

create table if not exists building_image (
  id uuid primary key default gen_random_uuid(),
  building_id text not null references building(id) on delete cascade,
  url text not null,                           -- Supabase Storage vagy külső (pl. Fortepan) URL
  kind text not null check (kind in ('archive','current','plan','facade','other')),
  year int,
  caption text,
  author text,
  license text,
  source_id uuid references source(id)
);

-- Mezőszintű forrás és megbízhatóság (pl. field = 'construction', 'architects', 'style' …)
create table if not exists field_citation (
  building_id text not null references building(id) on delete cascade,
  field text not null,
  source_id uuid references source(id),
  reliability reliability not null,
  note text,
  primary key (building_id, field, source_id)
);

-- Változásnapló (adminisztráció, közösségi bővítés ellenőrzése)
create table if not exists building_revision (
  id bigserial primary key,
  building_id text not null,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  diff jsonb not null,
  status record_status not null default 'submitted',
  reviewed_by uuid,
  review_note text
);

-- A kliens által fogyasztott GeoJSON-nézet (bbox-szűréssel RPC-n keresztül)
create or replace function buildings_in_bbox(min_lng float, min_lat float, max_lng float, max_lat float)
returns setof jsonb language sql stable as $$
  select jsonb_build_object(
    'type', 'Feature',
    'id', b.id,
    'geometry', st_asgeojson(b.geom)::jsonb,
    'properties', jsonb_build_object(
      'id', b.id, 'isDemo', b.is_demo, 'city', b.city_id, 'name', b.name, 'address', b.address,
      'district', b.district_code, 'centroid', jsonb_build_array(st_x(b.centroid), st_y(b.centroid)),
      'construction', jsonb_strip_nulls(jsonb_build_object('precision', b.year_precision, 'year', b.year_exact,
        'from', b.year_from, 'to', b.year_to, 'note', b.year_note, 'sourceIds', '[]'::jsonb)),
      'style', b.style, 'originalFunction', b.original_function, 'buildingType', b.building_type,
      'floors', b.floors, 'structure', b.structure, 'currentFunction', b.current_function,
      'protection', b.protection, 'description', b.description, 'origin', b.origin, 'updatedAt', b.updated_at,
      'architects', coalesce((select jsonb_agg(a.name) from building_architect ba join architect a on a.id = ba.architect_id where ba.building_id = b.id), '[]'::jsonb)
    )
  )
  from building b
  where b.status = 'approved'
    and b.geom && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326);
$$;

-- Sorszintű jogosultság: olvasás mindenkinek, írás hitelesített szerkesztőknek
alter table building enable row level security;
create policy building_read on building for select using (status = 'approved');
create policy building_write on building for all to authenticated using (true) with check (true);
