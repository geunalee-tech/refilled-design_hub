#!/usr/bin/env node
/* tools/migrate-supabase.mjs — data/db.json → Supabase 도메인 테이블 이관
 *
 * 사용법:
 *   1) cp .env.migrate.example .env.migrate  →  실제 값 채우기 (.gitignore 등록됨)
 *   2) git pull                              →  db.json을 팀 최신으로
 *   3) node tools/migrate-supabase.mjs       →  드라이런 (쓰기 없음, 검증만)
 *   4) node tools/migrate-supabase.mjs --run →  실제 이관
 *
 * 멱등(upsert) — 재실행 안전. db.json이 원본인 동안 몇 번이고 다시 돌려도 돼요.
 * 의존성 없음 (Node 18+ 내장 fetch + Supabase REST/PostgREST 사용).
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUN = process.argv.includes('--run');

/* ── .env.migrate 로드 (없으면 환경변수 사용) ── */
try {
  for (const line of readFileSync(resolve(ROOT, '.env.migrate'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* 파일 없으면 셸 환경변수로 */ }

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!URL_ || !KEY) {
  console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_KEY 가 필요해요 (.env.migrate 참고)');
  process.exit(1);
}

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

async function upsert(table, rows, onConflict = 'id') {
  if (!rows.length) return;
  const r = await fetch(`${URL_}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error(`${table} upsert 실패 ${r.status}: ${(await r.text()).slice(0, 300)}`);
}

async function count(table) {
  const r = await fetch(`${URL_}/rest/v1/${table}?select=id`, {
    method: 'HEAD', headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
  });
  return r.headers.get('content-range')?.split('/')[1] ?? '?';
}

/* ── db.json 읽기 & 변환 ── */
const db = JSON.parse(readFileSync(resolve(ROOT, 'data/db.json'), 'utf8'));
console.log(`📦 data/db.json (updatedAt: ${db.updatedAt || '없음'})`);
console.log(RUN ? '🚀 실제 이관 모드' : '🔍 드라이런 (쓰기 없음) — 실제 이관은 --run\n');

const ARR_TABLES = ['tasks', 'projects', 'members', 'rituals', 'archive', 'trends'];
const plan = [];

for (const t of ARR_TABLES) {
  const items = (db[t] || []).filter(x => x && x.id);
  const skipped = (db[t] || []).length - items.length;
  plan.push({ table: t, rows: items.map(x => ({ id: String(x.id), data: x })), skipped });
}

/* 싱글턴(config·meta) → app_state, guardLog → guard_log */
const states = [];
if (db.config && Object.keys(db.config).length) states.push({ key: 'config', data: db.config });
if (db.meta && Object.keys(db.meta).length) states.push({ key: 'meta', data: db.meta });

const guards = (db.guardLog || [])
  .filter(g => g && g.at)
  .map(g => ({ at: g.at, data: g }));

/* ── 리포트 & 실행 ── */
let total = 0;
for (const { table, rows, skipped } of plan) {
  console.log(`  ${table.padEnd(9)} ${String(rows.length).padStart(3)}건${skipped ? `  ⚠️ id 없어 제외 ${skipped}건` : ''}`);
  total += rows.length;
}
console.log(`  app_state  ${String(states.length).padStart(3)}건 (${states.map(s => s.key).join(', ') || '없음'})`);
console.log(`  guard_log  ${String(guards.length).padStart(3)}건`);
console.log(`  합계 ${total + states.length + guards.length}건\n`);

if (!RUN) {
  console.log('드라이런 종료 — 문제 없으면 --run 으로 실행하세요.');
  process.exit(0);
}

for (const { table, rows } of plan) await upsert(table, rows);
if (states.length) await upsert('app_state', states, 'key');
if (guards.length) await upsert('guard_log', guards, 'at');

console.log('✅ 이관 완료. 테이블별 행 수 검증:');
for (const t of [...ARR_TABLES, 'app_state', 'guard_log']) {
  console.log(`  ${t.padEnd(9)} ${await count(t)}행`);
}
console.log('\n※ db.json이 아직 원본이에요 — 앱 전환(store.js 재작성) 전까지 팀 수정이 계속 db.json에 쌓이니, 전환 직전에 한 번 더 돌려서 최신화하세요.');
