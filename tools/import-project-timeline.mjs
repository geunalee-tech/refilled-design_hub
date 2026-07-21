/* tools/import-project-timeline.mjs — 디자인팀 프로젝트 캘린더 CSV → 허브 프로젝트 타임라인
 *
 * 구글시트(프로젝트 | 업무 | 세부내용 | 담당자 | 진행도 | 3월~12월 일자별 셀)를 CSV로 받아
 *  · 프로젝트(카테고리) → 하위 업무 → 날짜별 마일스톤 으로 변환해 Supabase(projects/tasks)에 반영.
 *  · 셀 텍스트(기획전달/1차 디자인/2차/최종/발주 등) → 우리 마커(기획전달·1차시안·2차시안·최종시안·발주 + 샘플·감리·촬영)로 매핑.
 *  · 7월 1일 이후 마일스톤만 반영(FROM 환경변수로 변경 가능). id는 이름 기반 고정 → 재실행 멱등.
 *
 * 실행:
 *   미리보기(쓰기 없음·Supabase 불필요):  node tools/import-project-timeline.mjs --dry "<CSV경로>"
 *   실제 반영:                            node tools/import-project-timeline.mjs "<CSV경로>"
 *   (tools/.env.migrate 에 SUPABASE_URL / SUPABASE_SERVICE_KEY 필요)
 */
import { readFileSync } from 'node:fs';

const DRY = process.argv.includes('--dry');
const FROM = process.env.FROM || '2026-07-01';
const csvPath = process.argv.slice(2).find(a => !a.startsWith('--'));
if (!csvPath) { console.error('❌ CSV 경로를 주세요: node tools/import-project-timeline.mjs [--dry] "<CSV경로>"'); process.exit(1); }

/* .env.migrate 로드 */
try {
  for (const line of readFileSync(new URL('./.env.migrate', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!DRY && (!SUPABASE_URL || !SUPABASE_SERVICE_KEY)) { console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_KEY 필요 (tools/.env.migrate). 먼저 --dry 로 확인하세요.'); process.exit(1); }

/* ── CSV 파서 (따옴표·개행 안전) ── */
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}

/* ── 마커 매핑 (셀 텍스트 → 마커 이름) ── */
function markerName(t) {
  if (/발주/.test(t)) return '발주';
  if (/기획/.test(t)) return '기획전달';
  if (/1차/.test(t)) return '1차시안';
  if (/2차|3차/.test(t)) return '2차시안';
  if (/최종/.test(t)) return '최종시안';
  if (/샘플/.test(t)) return '샘플';
  if (/감리|인쇄/.test(t)) return '감리';
  if (/촬영|셀렉|보정/.test(t)) return '촬영';
  return '일정';
}
const MARKER_COLORS = { '기획전달': '#2563EB', '1차시안': '#7C3AED', '2차시안': '#D97706', '최종시안': '#DC2626', '발주': '#059669', '샘플': '#0891B2', '감리': '#DB2777', '촬영': '#6B7280', '일정': '#9AA1AC' };
const TL_STATUS = t => /완료/.test(t) ? 'done' : /진행/.test(t) ? 'doing' : 'wait';
const uid = () => 'x' + Math.random().toString(36).slice(2, 10);
const idOf = s => 'p' + [...s].reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0).toString(36).replace('-', 'z');

/* ── 파싱 ── */
const rows = parseCSV(readFileSync(csvPath, 'utf8'));
const dayRow = rows[2] || [];
const DAY0 = 5; // 프로젝트,업무,세부내용,담당자,진행도 다음(0-based 5)부터 일자
const colDate = [];
{ let y = 2026, m = 3, prev = 0;
  for (let col = DAY0; col < dayRow.length; col++) {
    const dn = parseInt((dayRow[col] || '').trim(), 10);
    if (!dn) { colDate[col] = null; continue; }
    if (dn === 1 && prev !== 0) { m++; if (m > 12) { m = 1; y++; } }
    prev = dn;
    colDate[col] = `${y}-${String(m).padStart(2, '0')}-${String(dn).padStart(2, '0')}`;
  }
}

const projMap = new Map(); // name -> {name, subs:[{task,detail,owner,prog,ms:[{date,text}]}]}
let cur = '';
for (let r = 3; r < rows.length; r++) {
  const row = rows[r]; if (!row) continue;
  const pRaw = (row[0] || '').replace(/\s*\n\s*/g, ' ').trim();
  if (pRaw) cur = pRaw;
  const task = (row[1] || '').trim();
  if (!task || !cur) continue;
  const ms = [];
  for (let col = DAY0; col < row.length; col++) {
    const v = (row[col] || '').trim(); if (!v) continue;
    const date = colDate[col]; if (!date || date < FROM) continue;
    ms.push({ date, text: v });
  }
  if (!ms.length) continue; // 7/1 이후 마일스톤 없는 하위업무는 제외
  if (!projMap.has(cur)) projMap.set(cur, { name: cur, subs: [] });
  projMap.get(cur).subs.push({ task, detail: (row[2] || '').trim(), owner: (row[3] || '').trim(), prog: (row[4] || '').trim(), ms });
}
const projects = [...projMap.values()].filter(p => p.subs.length);

/* ── 요약 출력 ── */
const usedMarkers = new Set();
let subCnt = 0, msCnt = 0;
console.log(`📅 프로젝트 캘린더 CSV → 타임라인  (${FROM} 이후)${DRY ? '   [DRY — 쓰기 없음]' : ''}`);
for (const p of projects) {
  console.log(`\n▪ ${p.name}  (하위 ${p.subs.length})`);
  for (const s of p.subs) {
    subCnt++; msCnt += s.ms.length;
    const marks = s.ms.map(m => { const n = markerName(m.text); usedMarkers.add(n); return `${m.date.slice(5)} ${n}`; }).join(', ');
    console.log(`   · ${s.task} [${TL_STATUS(s.prog)}${s.owner ? '·' + s.owner : ''}] ${marks}`);
  }
}
console.log(`\n합계: 프로젝트 ${projects.length} · 하위업무 ${subCnt} · 마일스톤 ${msCnt}`);
console.log(`사용 마커: ${[...usedMarkers].join(', ')}`);
if (DRY) { console.log('\n✅ DRY 완료 — 위 내용이 반영될 예정. 실제 반영: --dry 빼고 실행.'); process.exit(0); }

/* ── Supabase 반영 ── */
async function sb(path, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`Supabase ${path.split('?')[0]} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r;
}
// 멤버(오너 매핑) + config(마커) 조회
const members = (await (await sb('members?select=data')).json()).map(x => x.data);
const ownerId = raw => { if (!raw) return ''; const m = members.find(mm => mm.name && (mm.name.includes(raw) || raw.includes(mm.name))); return m ? m.id : ''; };
const appState = (await (await sb('app_state?key=eq.config&select=data')).json())[0];
const config = appState?.data || {};
config.timelineMarkers = config.timelineMarkers || [];
const markerId = name => { let m = config.timelineMarkers.find(x => x.name === name); if (!m) { m = { id: uid(), name, color: MARKER_COLORS[name] || '#9AA1AC' }; config.timelineMarkers.push(m); } return m.id; };

const projRows = [], taskRows = [];
for (const p of projects) {
  const pid = 'pj_' + idOf(p.name);
  projRows.push({ id: pid, data: { id: pid, name: p.name, color: '#006DE2', owner: ownerId(p.subs[0].owner) || null, source: 'csv' } });
  for (const s of p.subs) {
    const sid = 'tl_' + idOf(p.name + '|' + s.task);
    taskRows.push({ id: sid, data: {
      id: sid, kind: 'project', title: s.task, project: pid,
      assignees: ownerId(s.owner) ? [ownerId(s.owner)] : [], tlStatus: TL_STATUS(s.prog),
      milestones: s.ms.map(m => ({ date: m.date, typeId: markerId(markerName(m.text)) })).sort((a, b) => a.date < b.date ? -1 : 1),
      priority: '중간', requester: '', requestedAt: FROM, due: '', link: '', files: [], notes: s.detail || '', createdAt: new Date().toISOString(), source: 'csv',
    } });
  }
}
// config(마커) 먼저 저장 → projects → tasks
await sb('app_state?on_conflict=key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ key: 'config', data: config }]) });
await sb('projects?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(projRows) });
await sb('tasks?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(taskRows) });
console.log(`\n✅ 반영 완료 — 프로젝트 ${projRows.length} · 하위업무 ${taskRows.length}. 허브 새로고침 후 프로젝트 타임라인에서 확인하세요.`);
