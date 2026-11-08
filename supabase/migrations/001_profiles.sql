-- Profiles table
-- Stores user profile data and role for role-based access.
-- Each row links 1:1 to auth.users via the id column.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner', 'worker', 'customer')),
  first_name text not null default '',
  last_name text not null default '',
  avatar_url text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Enable Row Level Security
alter table public.profiles enable row level security;

-- Policy: Users can read their own profile
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- Policy: Users can update their own profile (but not role)
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Policy: Owners can view all profiles (for team/client management)
create policy "Owners can view all profiles"
  on public.profiles for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'owner'
    )
  );

-- Policy: Allow insert during sign-up
create policy "Enable insert for authenticated users"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Auto-update the updated_at timestamp
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_updated_at
  before update on public.profiles
  for each row
  execute function public.handle_updated_at();
