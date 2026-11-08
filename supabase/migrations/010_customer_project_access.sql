-- Migration 010: Customer Project Access
-- Adds customer project codes for one-time project claiming.
-- A project code is generated when the owner enables the customer portal.
-- A customer enters the code to claim access; after that, access is by auth only.

alter table projects
  add column if not exists customer_project_code text unique,
  add column if not exists customer_claimed_by uuid references profiles(id),
  add column if not exists customer_claimed_at timestamptz;

create index if not exists idx_projects_customer_project_code
  on projects (customer_project_code) where customer_project_code is not null;

create index if not exists idx_projects_customer_claimed_by
  on projects (customer_claimed_by) where customer_claimed_by is not null;

-- Function: generate a unique 8-character alphanumeric project code
create or replace function generate_customer_project_code()
returns text
language plpgsql
as $$
declare
  new_code text;
  code_exists boolean;
begin
  loop
    new_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    select exists(select 1 from projects where customer_project_code = new_code)
      into code_exists;
    exit when not code_exists;
  end loop;
  return new_code;
end;
$$;

-- Function: claim a project by code
create or replace function claim_project_by_code(
  p_code text,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_project record;
begin
  select id, customer_project_code, customer_claimed_by, customer_claimed_at
    into v_project
    from projects
    where customer_project_code = upper(trim(p_code));

  if v_project is null then
    return jsonb_build_object('success', false, 'error', 'invalid_code');
  end if;

  if v_project.customer_claimed_by is not null then
    if v_project.customer_claimed_by = p_user_id then
      return jsonb_build_object('success', true, 'already_owned', true, 'project_id', v_project.id);
    end if;
    return jsonb_build_object('success', false, 'error', 'already_claimed');
  end if;

  update projects
    set customer_claimed_by = p_user_id,
        customer_claimed_at = now(),
        customer_id = p_user_id,
        updated_at = now()
    where id = v_project.id;

  return jsonb_build_object('success', true, 'project_id', v_project.id);
end;
$$;

-- RLS: customers can only see projects they have claimed
create policy "customers_view_claimed_projects"
  on projects for select
  using (
    customer_claimed_by = auth.uid()
    or company_id in (
      select company_id from company_memberships
      where person_id = auth.uid() and status = 'active'
    )
  );
