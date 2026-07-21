/* tools/import-notion-tasks.mjs — 노션 "디자인팀 업무 목록" → 허브(Supabase) 1회 임포트
 *
 * 노션 자동 수신(구 api/notion-sync.js)은 제거됐고, 이 스크립트는 그 매핑을 그대로 이어받아
 * "현재 노출된 업무(요청·시작 전·진행 중·컨펌요청)"만 골라 허브 tasks 테이블에 반영해요.
 *  - 기획안 링크(url) → task.link
 *  - 기획 텍스트(페이지 본문) → task.notes
 *  - 멱등(upsert): notionId 기반 nt_ id라 몇 번 돌려도 중복 안 생겨요.
 *
 * 실행:
 *   1) tools/.env.migrate 에 SUPABASE_URL / SUPABASE_SERVICE_KEY 채우기 (.env.migrate.example 참고)
 *   2) NOTION_TOKEN 준비 — 노션 인테그레이션 시크릿(이 DB에 연결돼 있어야 함, pulse-sync와 동일 토큰 가능)
 *   3) 미리보기(쓰기 없음):  NOTION_TOKEN=secret_xxx node tools/import-notion-tasks.mjs --dry
 *      실제 반영:            NOTION_TOKEN=secret_xxx node tools/import-notion-tasks.mjs
 *
 * 환경변수:
 *   NOTION_TOKEN            — (필수) 노션 인테그레이션 시크릿
 *   NOTION_DB              — (선택) 대상 DB id. 기본: 디자인팀 업무 목록
 *   SUPABASE_URL / SUPABASE_SERVICE_KEY — (필수, --dry 아닐 때) 팀 Supabase. tools/.env.migrate 또는 환경변수
 *   IMPORT_STATUSES        — (선택) 콤마 구분 상태. 기본: "요청,시작 전,진행 중,컨펌요청"
 */
import { readFileSync } from 'node:fs';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VER = '2022-06-28';
const DEFAULT_DB = 'd67521c7b3aa437e8402912dc9b294c4'; // 🚐 디자인팀 업무 목록
const DRY = process.argv.includes('--dry');
// 기본: 누락분만 추가(이미 있는 notionId는 건너뜀 → 허브에서 바꾼 상태·내용 보존). --overwrite 로 전체 덮어쓰기.
const MISSING_ONLY = !process.argv.includes('--overwrite');

/* tools/.env.migrate 값을 process.env로 로드 (migrate-supabase.mjs와 동일 방식) */
try {
  for (const line of readFileSync(new URL('./.env.migrate', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* 파일 없으면 환경변수만 사용 */ }

const { NOTION_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
const NOTION_DB = process.env.NOTION_DB || DEFAULT_DB;
const STATUSES = (process.env.IMPORT_STATUSES || '요청,시작 전,진행 중,컨펌요청').split(',').map(s => s.trim()).filter(Boolean);
// 안내/템플릿/테스트 행은 제외 (제목 완전 일치). IMPORT_EXCLUDE_TITLES 로 재정의 가능
const EXCLUDE_TITLES = (process.env.IMPORT_EXCLUDE_TITLES
  || '[요청 전 필독] 디자인팀 업무 요청 가이드,디자인 요청서,테스트입니다')
  .split(',').map(s => s.trim()).filter(Boolean);

if (!NOTION_TOKEN) { console.error('❌ NOTION_TOKEN 이 필요해요 (노션 인테그레이션 시크릿)'); process.exit(1); }
if (!DRY && (!SUPABASE_URL || !SUPABASE_SERVICE_KEY)) {
  console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_KEY 가 필요해요 (tools/.env.migrate 참고). 먼저 --dry 로 미리보기 하세요.');
  process.exit(1);
}

/* ── 노션 ── */
const nh = { Authorization: `Bearer ${NOTION_TOKEN}`, 'Notion-Version': NOTION_VER, 'Content-Type': 'application/json' };

async function queryPages() {
  const pages = [];
  let cursor;
  do {
    const res = await fetch(`${NOTION_API}/databases/${NOTION_DB}/query`, {
      method: 'POST', headers: nh,
      body: JSON.stringify({
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
        filter: { or: STATUSES.map(s => ({ property: '상태', status: { equals: s } })) },
      }),
    });
    if (!res.ok) throw new Error(`노션 DB 쿼리 실패 ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    pages.push(...(json.results || []));
    cursor = json.has_more ? json.next_cursor : null;
  } while (cursor);
  return pages;
}

async function fetchBody(pageId) {
  let body = '', cursor = null;
  for (let i = 0; i < 3; i++) {
    const url = `${NOTION_API}/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
    const bres = await fetch(url, { headers: nh });
    if (!bres.ok) break;
    const json = await bres.json();
    for (const bl of json.results || []) {
      const rt = bl[bl.type]?.rich_text;
      if (!rt) continue;
      const line = rt.map(x => x.plain_text || '').join('');
      if (!line.trim()) continue;
      const prefix = bl.type.startsWith('heading') ? '■ '
        : bl.type === 'to_do' ? (bl.to_do?.checked ? '☑ ' : '☐ ')
        : /list_item/.test(bl.type) ? '- ' : '';
      body += prefix + line + '\n';
    }
    if (!json.has_more) break;
    cursor = json.next_cursor;
  }
  return body.trim().slice(0, 1800);
}

/* ── 속성 파서 (구 notion-sync.js와 동일) ── */
const STATUS_MAP = {
  '요청': 'req', '시작 전': 'req', '진행 중': 'doing',
  '컨펌요청': 'confirm', '컨펌 요청': 'confirm', '완료': 'done',
};
function prop(props, ...names) { for (const n of names) if (props?.[n] !== undefined) return props[n]; return undefined; }
function plain(p) {
  if (!p) return '';
  const arr = p.title || p.rich_text;
  if (arr) return arr.map(x => x?.plain_text || x?.text?.content || '').join('');
  if (p.select) return p.select.name || '';
  if (p.status) return p.status.name || '';
  if (p.date) return p.date.start?.slice(0, 10) || '';
  if (p.created_time) return String(p.created_time).slice(0, 10);
  if (p.url) return p.url;
  if (typeof p === 'string') return p;
  return '';
}
function people(p) {
  const arr = p?.people ? p.people : (p?.created_by ? [p.created_by] : []);
  return arr.map(u => ({ id: u?.id || '', name: u?.name || '' })).filter(u => u.id || u.name);
}

function mapTask(page, body) {
  const props = page.properties || {};
  const title = plain(prop(props, '이름', 'Name', '제목')) || '(제목 없음)';
  const statusKo = plain(prop(props, '상태', 'Status'));
  const status = STATUS_MAP[statusKo] || 'req';
  const priorityRaw = plain(prop(props, '우선순위', 'Priority')) || '중간';
  const priority = ['🚨긴급', '높음', '중간', '낮음', '보류'].includes(priorityRaw) ? priorityRaw : '중간';
  const due = plain(prop(props, '마감일', 'Due', '마감'));
  const rawPlan = (plain(prop(props, '기획안 링크', '기획안', '링크', 'Link')) || '').trim();
  const planLink = !rawPlan ? ''
    : /^https?:\/\//i.test(rawPlan) ? rawPlan
    : /^[\w-]+(\.[\w-]+)+([\/?#]|$)/.test(rawPlan) ? 'https://' + rawPlan
    : '';
  const reqAt = plain(prop(props, '요청일', 'Created', '생성일')) || new Date().toISOString().slice(0, 10);
  const designers = people(prop(props, '디자인 담당자', '담당자')).map(u => u.name).filter(Boolean);
  const cb = page.created_by || {};
  let planners = people(prop(props, '기획자'));
  if (!planners.length && (cb.id || cb.name)) planners = [{ id: cb.id || '', name: cb.name || '' }];
  const plannerNames = planners.map(u => u.name).filter(Boolean);
  const requester = (plannerNames[0] || '노션 요청') + (plannerNames.length > 1 ? ` 외 ${plannerNames.length - 1}` : '');
  return {
    id: 'nt_' + (page.id ? page.id.replace(/-/g, '') : Math.random().toString(36).slice(2) + Date.now().toString(36)),
    notionId: page.id || null,
    kind: 'request', title, project: '', assignees: [], _designerNames: designers,
    status, priority, requester, requestedAt: reqAt, due,
    link: planLink || page.url || '', _planLink: planLink, _notionUrl: page.url || '',
    files: [],
    notes: body || '(기획 텍스트 없음 — 노션 본문 비어 있음)',
    createdAt: new Date().toISOString(),
    importedFrom: 'notion', importedAt: new Date().toISOString(),
  };
}

/* ── Supabase upsert (행 단위, tasks 테이블: {id, data}) ── */
async function upsertTasks(tasks) {
  const rows = tasks.map(t => ({ id: String(t.id), data: t }));
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tasks?on_conflict=id`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase upsert 실패 ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

/* 허브 tasks에 이미 있는 notionId 집합 (누락분만 판별용) */
async function fetchExistingNotionIds() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tasks?select=data`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase 조회 실패 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const rows = await res.json();
  return new Set(rows.map(r => r.data?.notionId).filter(Boolean));
}

/* ── 실행 ── */
console.log(`🚐 노션 → 허브 임포트  (상태: ${STATUSES.join(' / ')})${DRY ? '   [DRY RUN — 쓰기 안 함]' : ''}`);
const pages = await queryPages();
console.log(`· 대상 페이지 ${pages.length}건 조회됨 — 본문 수집 중...`);
const tasks = [];
const skipped = [];
for (const page of pages) {
  const title = plain(prop(page.properties || {}, '이름', 'Name', '제목')).trim();
  if (EXCLUDE_TITLES.includes(title)) { skipped.push(title || '(제목 없음)'); continue; }
  const body = await fetchBody(page.id);
  tasks.push(mapTask(page, body));
}
if (skipped.length) console.log(`· 제외 ${skipped.length}건 (안내/템플릿/테스트): ${skipped.join(' · ')}`);
tasks.sort((a, b) => a.status.localeCompare(b.status));
for (const t of tasks) {
  console.log(`  [${t.status}] ${t.title}  · 요청 ${t.requester} · 마감 ${t.due || '미정'} · 링크 ${t.link ? 'O' : '-'} · 기획텍스트 ${t.notes.startsWith('(기획 텍스트 없음') ? '-' : t.notes.length + '자'}`);
}
if (DRY) { console.log(`\n✅ DRY RUN — 후보 ${tasks.length}건. 실제 실행 시 ${MISSING_ONLY ? '이미 있는 건 건너뛰고 누락분만 추가' : '전체 덮어쓰기(--overwrite)'}됩니다.`); process.exit(0); }

let toWrite = tasks;
if (MISSING_ONLY) {
  const existing = await fetchExistingNotionIds();
  toWrite = tasks.filter(t => !existing.has(t.notionId));
  console.log(`\n· 이미 있는 ${tasks.length - toWrite.length}건은 건너뜀(허브 수정 보존) → 누락 ${toWrite.length}건만 추가`);
  toWrite.forEach(t => console.log(`  + [${t.status}] ${t.title}`));
}
if (!toWrite.length) { console.log('\n✅ 추가할 누락 업무가 없어요 — 노션의 모든 업무가 이미 반영돼 있어요.'); process.exit(0); }
await upsertTasks(toWrite);
console.log(`\n✅ 누락 ${toWrite.length}건 추가 완료. 허브 새로고침 후 요청 업무 보드에서 확인하세요. (전체 덮어쓰기는 --overwrite)`);
