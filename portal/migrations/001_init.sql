create table if not exists uploads (
  id uuid primary key,
  kind text not null check (kind in ('team', 'poster', 'video')),
  file text not null unique,
  bytes bigint not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists submissions (
  id uuid primary key,
  slug text not null unique,
  team_name text not null,
  team_key text not null unique,
  project_name text not null,
  site_url text not null,
  hypothesis text not null,
  methods text not null,
  results text not null,
  team_photo text not null,
  poster_photo text not null,
  video text,
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists submissions_created_at_idx on submissions (created_at desc);
