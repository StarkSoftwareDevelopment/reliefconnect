-- ReliefConnect — Initial Schema Migration
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/YOUR_PROJECT_REF/sql

-- ============================================================
-- EXTENSIONS
-- ============================================================
create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm"; -- for fuzzy name search / autocomplete


-- ============================================================
-- PEOPLE
-- ============================================================
create table if not exists people (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique,           -- human-readable URL alias
  name         text not null,
  email        text,
  phone        text,
  is_coordinator boolean default false,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- Auto-generate slug from name on insert if not provided
create or replace function generate_slug(name text) returns text as $$
declare
  base text;
  candidate text;
  counter int := 0;
begin
  base := lower(regexp_replace(trim(name), '[^a-zA-Z0-9]+', '_', 'g'));
  base := trim(both '_' from base);
  candidate := base;
  loop
    if not exists (select 1 from people where slug = candidate) then
      return candidate;
    end if;
    counter := counter + 1;
    candidate := base || '_' || counter;
  end loop;
end;
$$ language plpgsql;

create or replace function set_person_slug() returns trigger as $$
begin
  if new.slug is null or new.slug = '' then
    new.slug := generate_slug(new.name);
  end if;
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger people_slug_trigger
  before insert or update on people
  for each row execute function set_person_slug();

-- Seed: default coordinator (BJ Linville)
insert into people (name, email, slug, is_coordinator)
values ('B.J. Linville', 'bjlinville1@gmail.com', 'bj_linville', true)
on conflict (slug) do nothing;


-- ============================================================
-- ASKS (raw intake)
-- ============================================================
create table if not exists asks (
  id            uuid primary key default gen_random_uuid(),
  name          text,
  phone         text,
  email         text,
  address       text,
  description   text,
  category      text,
  urgency       text default 'medium',
  people_count  text,
  access_notes  text,
  file_urls     jsonb default '[]',
  created_at    timestamptz default now(),
  project_id    uuid  -- set after AI generates project
);


-- ============================================================
-- PROJECTS
-- ============================================================
create table if not exists projects (
  id               uuid primary key default gen_random_uuid(),
  ask_id           uuid references asks(id),
  title            text not null,
  summary          text,
  address          text,
  category         text,
  urgency          text default 'medium',

  -- Human-facing state machine
  status           text not null default 'pending_approval'
                   check (status in (
                     'pending_approval',
                     'to_do',
                     'doing',
                     'done',
                     'passed_inspection'
                   )),

  -- PM chain of custody: ordered array of person IDs
  pm_chain         uuid[] default '{}',

  -- AI-generated content
  acceptance_tests jsonb default '[]',
  pm_briefing      text,
  agent_briefing   text,
  locked_fields    jsonb default '{}', -- {fieldName: required_credential}

  -- Geocoding cache
  coords           jsonb, -- {lat, lng}

  -- AI rewrite tracking
  ai_attempt_count int default 1,
  denial_reason    text,
  denial_count     int default 0,  -- after 2, flagged for manual only

  -- Approval tracking
  approved_at      timestamptz,
  approved_by      uuid references people(id),

  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

create or replace function update_project_timestamp() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger projects_updated_at
  before update on projects
  for each row execute function update_project_timestamp();


-- ============================================================
-- PROJECT ROLES
-- ============================================================
create table if not exists project_roles (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid references projects(id) on delete cascade,
  name                 text not null,  -- e.g. "Roofer", "Chainsaw operator"
  required_credential  text,           -- stub: credential type name (Phase 2: FK)
  created_by           uuid references people(id),
  created_at           timestamptz default now()
);


-- ============================================================
-- ROLE ASSIGNMENTS (person ↔ role on a project)
-- ============================================================
create table if not exists role_assignments (
  id           uuid primary key default gen_random_uuid(),
  role_id      uuid references project_roles(id) on delete cascade,
  person_id    uuid references people(id),
  approved     boolean default false,
  approved_by  uuid references people(id),
  created_at   timestamptz default now(),
  unique (role_id, person_id)
);


-- ============================================================
-- TASKS
-- ============================================================
create table if not exists tasks (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid references projects(id) on delete cascade,
  role_id          uuid references project_roles(id),  -- nullable
  assigned_to      uuid references people(id),          -- nullable
  title            text not null,
  description      text,
  tools            text,
  acceptance_tests jsonb default '[]',
  sequence         int default 0,

  status           text not null default 'task_setup_not_assigned'
                   check (status in (
                     'task_setup_not_assigned',
                     'task_setup_assigned_but_not_started',
                     'acceptance_test_written',
                     'acceptance_test_approved',
                     'task_requirements_written',
                     'task_requirements_approved',
                     'task_prioritized',
                     'task_not_assigned',
                     'task_assigned_but_not_started',
                     'task_assigned_and_in_progress',
                     'task_completed_review_not_assigned',
                     'task_completed_review_assigned',
                     'task_completed_review_in_progress',
                     'task_completed_review_satisfactory',
                     'task_completed_review_not_satisfactory_reassigned_but_not_started'
                   )),

  locked_fields    jsonb default '{}', -- {fieldName: required_credential}
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

create or replace function update_task_timestamp() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger tasks_updated_at
  before update on tasks
  for each row execute function update_task_timestamp();

-- Auto-update project status when task statuses change
create or replace function sync_project_status() returns trigger as $$
declare
  total_tasks int;
  doing_tasks int;
  satisfactory_tasks int;
begin
  select count(*) into total_tasks from tasks where project_id = new.project_id;
  select count(*) into doing_tasks from tasks
    where project_id = new.project_id
    and status in (
      'task_assigned_and_in_progress',
      'task_completed_review_not_assigned',
      'task_completed_review_assigned',
      'task_completed_review_in_progress',
      'task_completed_review_not_satisfactory_reassigned_but_not_started'
    );
  select count(*) into satisfactory_tasks from tasks
    where project_id = new.project_id
    and status = 'task_completed_review_satisfactory';

  -- Only update projects that are already published
  update projects set status =
    case
      when satisfactory_tasks = total_tasks and total_tasks > 0 then 'passed_inspection'
      when satisfactory_tasks = total_tasks and total_tasks > 0 then 'done'
      when doing_tasks > 0 or satisfactory_tasks > 0 then 'doing'
      else 'to_do'
    end
  where id = new.project_id
    and status not in ('pending_approval');

  return new;
end;
$$ language plpgsql;

create trigger tasks_sync_project_status
  after update on tasks
  for each row execute function sync_project_status();


-- ============================================================
-- TASK HISTORY (audit log)
-- ============================================================
create table if not exists task_history (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid references tasks(id) on delete cascade,
  changed_by   uuid references people(id),
  from_status  text,
  to_status    text,
  note         text,
  created_at   timestamptz default now()
);

-- Auto-log task status changes
create or replace function log_task_status_change() returns trigger as $$
begin
  if old.status is distinct from new.status then
    insert into task_history (task_id, from_status, to_status)
    values (new.id, old.status, new.status);
  end if;
  return new;
end;
$$ language plpgsql;

create trigger tasks_log_status
  after update on tasks
  for each row execute function log_task_status_change();


-- ============================================================
-- SUBMISSIONS (volunteer task updates)
-- ============================================================
create table if not exists submissions (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid references tasks(id) on delete cascade,
  person_id   uuid references people(id),
  notes       text,
  file_urls   jsonb default '[]',
  created_at  timestamptz default now()
);


-- ============================================================
-- REVIEWS (coordinator task reviews)
-- ============================================================
create table if not exists reviews (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid references tasks(id) on delete cascade,
  reviewer_id  uuid references people(id),
  submission_id uuid references submissions(id),
  outcome      text check (outcome in ('pass', 'fail')),
  notes        text,
  created_at   timestamptz default now()
);


-- ============================================================
-- BOTTLENECKS
-- ============================================================
create table if not exists bottlenecks (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid references tasks(id) on delete cascade,
  project_id   uuid references projects(id) on delete cascade,
  reporter_id  uuid references people(id),
  description  text not null,
  resolved     boolean default false,
  resolved_by  uuid references people(id),
  resolved_at  timestamptz,
  created_at   timestamptz default now()
);


-- ============================================================
-- VOLUNTEERS / PROJECT ENROLLMENT
-- ============================================================
create table if not exists project_volunteers (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references projects(id) on delete cascade,
  person_id   uuid references people(id),
  enrolled_at timestamptz default now(),
  unique (project_id, person_id)
);


-- ============================================================
-- INDEXES
-- ============================================================

-- People autocomplete (trigram for fuzzy name search)
create index if not exists idx_people_name_trgm on people using gin (name gin_trgm_ops);
create index if not exists idx_people_slug on people (slug);
create index if not exists idx_people_email on people (email);

-- Projects
create index if not exists idx_projects_status on projects (status);
create index if not exists idx_projects_ask_id on projects (ask_id);
create index if not exists idx_projects_urgency on projects (urgency);
create index if not exists idx_projects_pm_chain on projects using gin (pm_chain);

-- Tasks
create index if not exists idx_tasks_project_id on tasks (project_id);
create index if not exists idx_tasks_assigned_to on tasks (assigned_to);
create index if not exists idx_tasks_role_id on tasks (role_id);
create index if not exists idx_tasks_status on tasks (status);
create index if not exists idx_tasks_sequence on tasks (project_id, sequence);

-- Task history
create index if not exists idx_task_history_task_id on task_history (task_id);

-- Submissions & reviews
create index if not exists idx_submissions_task_id on submissions (task_id);
create index if not exists idx_reviews_task_id on reviews (task_id);

-- Bottlenecks
create index if not exists idx_bottlenecks_project_id on bottlenecks (project_id);
create index if not exists idx_bottlenecks_resolved on bottlenecks (resolved);

-- Role assignments
create index if not exists idx_role_assignments_role_id on role_assignments (role_id);
create index if not exists idx_role_assignments_person_id on role_assignments (person_id);


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- Enable RLS on all tables
alter table people enable row level security;
alter table asks enable row level security;
alter table projects enable row level security;
alter table project_roles enable row level security;
alter table role_assignments enable row level security;
alter table tasks enable row level security;
alter table task_history enable row level security;
alter table submissions enable row level security;
alter table reviews enable row level security;
alter table bottlenecks enable row level security;
alter table project_volunteers enable row level security;

-- PUBLIC READ: published projects and their tasks/roles are publicly readable
create policy "Public can read published projects"
  on projects for select
  using (status != 'pending_approval');

create policy "Public can read tasks on published projects"
  on tasks for select
  using (
    exists (
      select 1 from projects p
      where p.id = tasks.project_id
        and p.status != 'pending_approval'
    )
  );

create policy "Public can read project roles"
  on project_roles for select
  using (true);

create policy "Public can read people (name only)"
  on people for select
  using (true);

create policy "Public can read bottlenecks"
  on bottlenecks for select
  using (true);

-- ANON INSERT: anyone can submit an ask or enroll as volunteer
create policy "Anyone can submit an ask"
  on asks for insert
  with check (true);

create policy "Anyone can create a person record"
  on people for insert
  with check (true);

create policy "Anyone can submit a task update"
  on submissions for insert
  with check (true);

create policy "Anyone can report a bottleneck"
  on bottlenecks for insert
  with check (true);

create policy "Anyone can enroll as volunteer"
  on project_volunteers for insert
  with check (true);

-- COORDINATOR: full access via service role key (used server-side only)
-- The anon key gets the above public policies.
-- All coordinator writes (approve project, update task, etc.) go through
-- Netlify functions using the SERVICE ROLE key (never exposed to browser).

-- Allow anon to read asks (coordinator dashboard)
create policy "Public can read asks"
  on asks for select
  using (true);

-- Allow anon to read submissions and reviews
create policy "Public can read submissions"
  on submissions for select
  using (true);

create policy "Public can read reviews"
  on reviews for select
  using (true);

create policy "Public can read task history"
  on task_history for select
  using (true);

create policy "Public can read role assignments"
  on role_assignments for select
  using (true);

create policy "Public can read project volunteers"
  on project_volunteers for select
  using (true);

-- ============================================================
-- HELPFUL VIEWS
-- ============================================================

-- Project summary with PM name and task counts
create or replace view project_summary as
select
  p.id,
  p.title,
  p.summary,
  p.address,
  p.category,
  p.urgency,
  p.status,
  p.coords,
  p.acceptance_tests,
  p.ai_attempt_count,
  p.denial_count,
  p.created_at,
  p.approved_at,
  p.pm_chain,
  pm.name as primary_pm_name,
  pm.slug as primary_pm_slug,
  (select count(*) from tasks t where t.project_id = p.id) as total_tasks,
  (select count(*) from tasks t where t.project_id = p.id
    and t.status = 'task_completed_review_satisfactory') as completed_tasks,
  (select count(*) from bottlenecks b where b.project_id = p.id and b.resolved = false) as open_bottlenecks
from projects p
left join people pm on pm.id = p.pm_chain[1];

-- Task detail with assignee and project info
create or replace view task_detail as
select
  t.*,
  p.name as assignee_name,
  p.slug as assignee_slug,
  pr.name as role_name,
  proj.title as project_title,
  proj.status as project_status
from tasks t
left join people p on p.id = t.assigned_to
left join project_roles pr on pr.id = t.role_id
left join projects proj on proj.id = t.project_id;

-- Pending approval queue
create or replace view approval_queue as
select
  p.*,
  a.name as requester_name,
  a.address as requester_address,
  a.description as ask_description,
  a.urgency as ask_urgency,
  a.created_at as ask_created_at
from projects p
join asks a on a.id = p.ask_id
where p.status = 'pending_approval'
order by p.created_at asc;

-- Open bottlenecks with context
create or replace view open_bottlenecks as
select
  b.*,
  reporter.name as reporter_name,
  t.title as task_title,
  proj.title as project_title
from bottlenecks b
left join people reporter on reporter.id = b.reporter_id
left join tasks t on t.id = b.task_id
left join projects proj on proj.id = b.project_id
where b.resolved = false
order by b.created_at asc;
