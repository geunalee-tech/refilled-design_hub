-- Refilled Design Hub 스키마 — db.json 통짜 커밋 → 도메인별 테이블 (행 단위, RLS)
-- 새 Supabase 프로젝트의 SQL Editor에서 실행하세요.
-- refilled-pms schema-v2.sql과 동일 패턴: 엔티티당 1행, payload는 data(jsonb)
-- — 필드 추가/변경에 스키마 수정이 필요 없고, 행 단위 저장으로 동시편집 유실을 해결합니다.

-- ── 공통: updated_at 자동 갱신 트리거 ──────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ── 도메인 테이블 (db.json의 배열 키와 1:1 대응) ─────────────────────
-- tasks    : 업무 보드 카드 (요청/프로젝트 업무)
-- projects : 프로젝트 (타임라인 바)
-- members  : 팀 구성원 — 추후 사내 디렉토리 API(/api/directory/*)로 대체 예정,
--            이관 호환을 위해 우선 유지
-- rituals  : 위클리 리추얼 문서 (goals / goals-config / pulse)
-- archive  : 파일 아카이브 항목
-- trends   : 트렌드 리서치 결과
do $$
declare t text;
begin
  foreach t in array array[
    'tasks','projects','members','rituals','archive','trends'
  ] loop
    execute format($f$
      create table if not exists %I (
        id text primary key,
        data jsonb not null,
        updated_at timestamptz not null default now()
      )$f$, t);
    execute format('alter table %I enable row level security', t);
    -- 사내 구성원(브릿지 인증 사용자)만 접근 — 표준 기본 정책
    execute format($f$
      do $p$ begin
        create policy "authenticated only" on %I
          for all
          using (auth.role() = 'authenticated')
          with check (auth.role() = 'authenticated');
      exception when duplicate_object then null; end $p$;
    $f$, t);
    execute format($f$
      do $p$ begin
        create trigger %I before update on %I
          for each row execute function set_updated_at();
      exception when duplicate_object then null; end $p$;
    $f$, 'trg_' || t || '_updated', t);
  end loop;
end $$;

-- ── 싱글턴 저장소 (구 db.json의 config 등 배열이 아닌 값) ─────────────
-- keys: 'config' (슬랙 훅 제외 — 시크릿은 Vercel 환경변수로 이동)
create table if not exists app_state (
  key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table app_state enable row level security;
do $p$ begin
  create policy "authenticated only" on app_state
    for all
    using (auth.role() = 'authenticated')
    with check (auth.role() = 'authenticated');
exception when duplicate_object then null; end $p$;
do $p$ begin
  create trigger trg_app_state_updated before update on app_state
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $p$;

-- ── 안전망: 새 테이블 RLS 자동 활성화 (회사 표준 — 테크팀 기본 설정) ──
-- 이후 디자인팀이 어떤 방식으로 테이블을 만들어도 RLS가 자동으로 켜집니다.
-- (정책은 별도로 만들어야 조회 가능 — 정책 없이는 기본 차단이므로 안전한 방향으로 실패)
create or replace function enforce_rls_on_new_tables()
returns event_trigger language plpgsql as $$
declare obj record;
begin
  for obj in select * from pg_event_trigger_ddl_commands()
  loop
    if obj.schema_name = 'public' and obj.command_tag in ('CREATE TABLE', 'CREATE TABLE AS') then
      execute format('alter table %s enable row level security', obj.object_identity);
    end if;
  end loop;
end $$;

do $p$ begin
  create event trigger trg_enforce_rls
    on ddl_command_end
    when tag in ('CREATE TABLE', 'CREATE TABLE AS')
    execute function enforce_rls_on_new_tables();
exception when duplicate_object then null; end $p$;

-- ── 가드 로그 (구 db.json guardLog — append 전용 이력) ────────────────
create table if not exists guard_log (
  id bigint generated always as identity primary key,
  at timestamptz not null,
  data jsonb not null
);
alter table guard_log enable row level security;
do $p$ begin
  create policy "authenticated only" on guard_log
    for all
    using (auth.role() = 'authenticated')
    with check (auth.role() = 'authenticated');
exception when duplicate_object then null; end $p$;
create unique index if not exists idx_guard_log_at on guard_log (at);
