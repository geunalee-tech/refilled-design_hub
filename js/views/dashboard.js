/* dashboard.js — 메인 써머리 */
import { store, todayISO } from '../store.js';
import { esc, fmtDate, dday, openModal, closeModal } from '../ui.js';
import { editTask } from './tasks.js';

/* 마일스톤 클릭 팝업 — 이동 대신 마커 변경 + 진행상황 체크 (타임라인 편집과 동일 데이터) */
const TL_ST = { wait: { label: '대기중', color: '#9AA1AC' }, doing: { label: '진행중', color: '#D97706' }, done: { label: '완료', color: '#059669' } };
function openMsModal(tid, mi) {
  const t = store.db.tasks.find(x => x.id === tid); if (!t || !t.milestones?.[mi]) return;
  const m = t.milestones[mi];
  const markers = store.db.config?.timelineMarkers || [];
  const pill = (active, color, label, attr) => `<button type="button" ${attr} style="cursor:pointer;border:1.5px solid ${active ? color : 'transparent'};background:${color}22;color:${color};border-radius:999px;padding:5px 12px;font-size:12.5px;font-weight:700">${esc(label)}</button>`;
  const picker = markers.map(mk => pill(m.typeId === mk.id, mk.color, mk.name, `data-mk="${mk.id}"`)).join('') || '<span class="muted" style="font-size:12px">마커가 없어요 — 타임라인에서 추가하세요</span>';
  const stBtns = Object.entries(TL_ST).map(([k, v]) => pill((t.tlStatus || 'wait') === k, v.color, v.label, `data-st="${k}"`)).join('');
  openModal(`<h2>${esc(store.projectName(t.project))} · ${esc(t.title)}</h2>
    <div class="field"><label>날짜</label><input type="date" id="ms-date" value="${m.date}"></div>
    <div class="field"><label>단계 (마커)</label><div style="display:flex;flex-wrap:wrap;gap:8px">${picker}</div></div>
    <div class="field"><label>진행 상황</label><div style="display:flex;flex-wrap:wrap;gap:8px">${stBtns}</div></div>
    <div style="display:flex;justify-content:space-between;align-items:center">
      <button class="btn danger" id="ms-del">마커 삭제</button>
      <span style="display:flex;gap:8px"><button class="btn" data-close>취소</button><button class="btn primary" id="ms-save">저장</button></span></div>`, body => {
    let typeId = m.typeId, st = t.tlStatus || 'wait';
    body.querySelectorAll('[data-mk]').forEach(b => b.onclick = () => { typeId = b.dataset.mk; body.querySelectorAll('[data-mk]').forEach(x => x.style.borderColor = 'transparent'); const d = markers.find(x => x.id === typeId); b.style.borderColor = d ? d.color : '#999'; });
    body.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { st = b.dataset.st; body.querySelectorAll('[data-st]').forEach(x => x.style.borderColor = 'transparent'); b.style.borderColor = TL_ST[st].color; });
    body.querySelector('#ms-save').onclick = () => { m.typeId = typeId; m.date = body.querySelector('#ms-date').value || m.date; t.tlStatus = st; store.save(); closeModal(); window.dispatchEvent(new Event('hashchange')); };
    body.querySelector('#ms-del').onclick = () => { if (!confirm('이 마커를 삭제할까요?')) return; t.milestones.splice(mi, 1); store.save(); closeModal(); window.dispatchEvent(new Event('hashchange')); };
  });
}

let dashMonth = null; // 캘린더 표시 월(YYYY-MM) — prev/next로 이동

// 담당자 색(캘린더·업무 카드 공통). renderDashboard 진입 시 채워짐
const MCOLORS = ['#006DE2', '#0F7B5F', '#B7791F', '#6B5CA5', '#8A3B5E', '#3B7A8A', '#C2410C', '#0891B2', '#7C3AED', '#DB2777'];
let _memColor = {};
/* 담당자를 컬러 칩으로 강조 (더 잘 보이게) */
const assigneeChips = t => {
  const ids = t.assignees || [];
  if (!ids.length) return '<span class="asg asg-none">미지정</span>';
  return ids.map(id => { const c = _memColor[id] || '#9AA1AC'; return `<span class="asg" style="background:${c}1e;color:${c}"><i style="background:${c}"></i>${esc(store.memberName(id))}</span>`; }).join('');
};

const taskRow = t => `
  <div class="tk-row" data-task="${t.id}" style="cursor:pointer" title="클릭해 상세 보기·수정">
    <div class="tk-dot ${t.status}"></div>
    <div class="tk-main">
      <div class="tk-title" style="font-size:13.5px">${esc(t.title)}</div>
      <div class="tk-meta" style="font-size:11.5px">
        ${t.due ? `<b class="tk-dd ${t.due < todayISO() ? 'over' : (dday(t.due).match(/D-[0-3]$/) ? 'warn' : '')}">${dday(t.due)}</b><span class="mono" style="font-size:10px">${t.due.slice(5).replace('-', '/')}</span>` : ''}
        ${assigneeChips(t)}
        ${t.kind === 'request' && t.requester ? `<span class="muted">요청 ${esc(t.requester)}</span>` : ''}
        ${t.project ? `<span class="muted">${esc(store.projectName(t.project))}</span>` : ''}
      </div>
    </div>
  </div>`;

export function renderDashboard(main) {
  const db = store.db;
  const today = todayISO(), tomorrow = todayISO(1);
  const open = db.tasks.filter(t => t.status !== 'done');
  const todayTasks = open.filter(t => t.due === today || (t.status === 'doing' && (!t.due || t.due <= today)));
  const tomorrowTasks = open.filter(t => t.due === tomorrow);
  const confirm = open.filter(t => t.status === 'confirm');
  const requests = open.filter(t => t.kind === 'request' && t.status === 'req');
  const overdue = open.filter(t => t.due && t.due < today);

  // 프로젝트 마일스톤 임박·최근 (−3 ~ +7일, 완료 하위업무 제외)
  const tlMarkers = store.db.config?.timelineMarkers || [];
  const mkOf = id => tlMarkers.find(m => m.id === id);
  const msLo = todayISO(-3), msHi = todayISO(7);
  const msAlerts = [];
  db.projects.filter(p => !p.archived).forEach(p =>
    db.tasks.filter(t => t.kind === 'project' && t.project === p.id && t.tlStatus !== 'done').forEach(t =>
      (t.milestones || []).forEach((m, mi) => {
        if (m.date && m.date >= msLo && m.date <= msHi)
          msAlerts.push({ date: m.date, proj: p.name, task: t.title, mk: mkOf(m.typeId), assignees: t.assignees || [], overdue: m.date < today, tid: t.id, mi });
      })));
  msAlerts.sort((a, b) => (a.date < b.date ? -1 : 1));

  // 예정 일정: 향후 7일 due 기준 그룹
  const upcoming = {};
  for (let i = 0; i <= 7; i++) {
    const d = todayISO(i);
    const list = open.filter(t => t.due === d);
    if (list.length) upcoming[d] = list;
  }

  // ── 월 캘린더: 요청 마감 + 프로젝트 마일스톤을 담당자 색으로 (담당자별 뷰를 색으로 흡수) ──
  if (!dashMonth) dashMonth = today.slice(0, 7);
  _memColor = {}; db.members.forEach((m, i) => _memColor[m.id] = MCOLORS[i % MCOLORS.length]);
  const colorOf = ids => { const id = (ids || [])[0]; return id && _memColor[id] ? _memColor[id] : '#9AA1AC'; };
  const [cy, cm] = dashMonth.split('-').map(Number);
  const monthLabel = `${cy}년 ${cm}월`;
  const daysInMonth = new Date(cy, cm, 0).getDate();
  const firstDow = new Date(cy, cm - 1, 1).getDay();
  const evByDate = {};
  const pushEv = (date, ev) => { if (String(date).slice(0, 7) !== dashMonth) return; (evByDate[date] = evByDate[date] || []).push(ev); };
  db.tasks.filter(t => t.kind === 'request' && t.status !== 'done' && t.due)
    .forEach(t => pushEv(t.due, { label: t.title, color: colorOf(t.assignees), who: store.assigneeNames(t), route: '#/tasks', kind: '요청' }));
  db.projects.filter(p => !p.archived).forEach(p =>
    db.tasks.filter(t => t.kind === 'project' && t.project === p.id && t.tlStatus !== 'done')
      .forEach(t => (t.milestones || []).forEach(m => { if (m.date) pushEv(m.date, { label: `${p.name}·${t.title}`, color: colorOf(t.assignees), who: store.assigneeNames(t), route: '#/tasks/projects', kind: '프로젝트' }); })));
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const dowLb = ['일', '월', '화', '수', '목', '금', '토'];
  const calHead = dowLb.map((d, i) => `<div class="cal-dow ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${d}</div>`).join('');
  const calCells = cells.map(d => {
    if (d === null) return '<div class="cal-cell empty"></div>';
    const iso = `${dashMonth}-${String(d).padStart(2, '0')}`;
    const evs = evByDate[iso] || [];
    const chips = evs.slice(0, 3).map(e => `<div class="cal-ev" style="background:${e.color}1e;color:${e.color}" title="[${e.kind}] ${esc(e.label)} · ${esc(e.who)}" onclick="location.hash='${e.route}'">${esc(e.label)}</div>`).join('');
    const more = evs.length > 3 ? `<div class="cal-more" title="${esc(evs.slice(3).map(e => e.label).join(', '))}">+${evs.length - 3}건 더</div>` : '';
    return `<div class="cal-cell ${iso === today ? 'today' : ''}"><div class="cal-daynum">${d}</div>${chips}${more}</div>`;
  }).join('');
  const calLegend = db.members.map(m => `<span><i style="background:${_memColor[m.id]}"></i>${esc(m.name)}</span>`).join('') + '<span><i style="background:#9AA1AC"></i>미지정</span>';

  const d = new Date();
  main.innerHTML = `
  <div class="dash-hero">
    <div>
      <div class="d-date">${d.getMonth() + 1}월 ${d.getDate()}일 ${'일월화수목금토'[d.getDay()]}요일</div>
      <div class="d-sub">${store.settings.userName ? esc(store.settings.userName) + '님, ' : ''}오늘 디자인팀의 흐름이에요.</div>
    </div>
    <div class="d-stats">
      <div class="d-stat"><b>${todayTasks.length}</b><span>오늘 할 일</span></div>
      <div class="d-stat"><b>${requests.length}</b><span>요청 업무</span></div>
      <div class="d-stat ${confirm.length ? 'warn' : ''}"><b>${confirm.length}</b><span>컨펌중</span></div>
      <div class="d-stat ${overdue.length ? 'warn' : ''}"><b>${overdue.length}</b><span>기한 초과</span></div>
      <div class="d-stat ${msAlerts.length ? 'warn' : ''}"><b>${msAlerts.length}</b><span>마일스톤 임박</span></div>
    </div>
  </div>

  <div class="dash-cols">
    <div class="card"><div class="card-h"><h3>오늘 할 일</h3><span class="sub">${fmtDate(today)}</span></div>
      <div class="card-b">${todayTasks.map(taskRow).join('') || '<div class="empty">오늘 마감/진행 업무가 없어요</div>'}</div></div>
    <div class="card"><div class="card-h"><h3>내일 할 일</h3><span class="sub">${fmtDate(tomorrow)}</span></div>
      <div class="card-b">${tomorrowTasks.map(taskRow).join('') || '<div class="empty">내일 마감 업무가 없어요</div>'}</div></div>
    <div class="card"><div class="card-h"><h3>예정된 일정</h3><span class="sub">향후 7일</span></div>
      <div class="card-b">${Object.entries(upcoming).map(([d, list]) => `
        <div class="sched-day"><div class="sd-label">${fmtDate(d)} · ${dday(d)}</div>
        ${list.map(t => `<div class="tk-title" data-task="${t.id}" style="font-size:13.5px;padding:3px 0;display:flex;align-items:center;gap:6px;flex-wrap:wrap;cursor:pointer" title="클릭해 상세 보기·수정">· ${esc(t.title)} ${assigneeChips(t)}</div>`).join('')}</div>`).join('')
        || '<div class="empty">7일 내 예정 일정이 없어요</div>'}</div></div>
  </div>

  ${msAlerts.length ? `<div class="card" style="margin-bottom:20px"><div class="card-h"><h3>🔔 프로젝트 마일스톤</h3><span class="sub">임박·최근 (−3 ~ +7일) · 클릭 시 타임라인</span></div>
    <div class="card-b">${msAlerts.map(a => { const c = a.mk?.color || '#9AA1AC'; const nm = a.mk?.name || '일정'; return `
      <div class="tk-row" style="cursor:pointer" data-msrow="${a.tid}:${a.mi}" title="클릭해 마커·진행상황 변경">
        <span style="background:${c}22;color:${c};border-radius:999px;padding:2px 9px;font-size:11px;font-weight:700;flex-shrink:0">${esc(nm)}</span>
        <div class="tk-main"><div class="tk-title" style="font-size:13px">${esc(a.proj)} · ${esc(a.task)}</div>
          <div class="tk-meta" style="font-size:11.5px"><b class="tk-dd ${a.overdue ? 'over' : 'warn'}">${a.date.slice(5).replace('-', '/')} · ${dday(a.date)}</b>${assigneeChips({ assignees: a.assignees })}</div></div>
      </div>`; }).join('')}</div></div>` : ''}

  <style>
    .cal-toolbar{display:flex;align-items:center;gap:6px}
    .cal-legend{display:flex;flex-wrap:wrap;gap:10px 14px;margin-bottom:12px;font-size:11.5px;color:var(--muted,#667)}
    .cal-legend span{display:flex;align-items:center;gap:5px}
    .cal-legend i{width:10px;height:10px;border-radius:3px;display:inline-block;flex-shrink:0}
    .cal-grid-head{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:6px}
    .cal-dow{text-align:center;font-size:11.5px;font-weight:700;color:#8a909a}
    .cal-dow.sun{color:#DC2626}.cal-dow.sat{color:#2563EB}
    .cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
    .cal-cell{min-height:94px;border:1px solid var(--line);border-radius:10px;padding:5px 6px;overflow:hidden}
    .cal-cell.empty{border:none;background:transparent}
    .cal-cell.today{border-color:#006DE2;box-shadow:inset 0 0 0 1px #006DE2}
    .cal-daynum{font-size:11.5px;font-weight:700;color:#556;margin-bottom:4px}
    .cal-cell.today .cal-daynum{color:#006DE2}
    .cal-ev{font-size:10.5px;font-weight:600;border-radius:5px;padding:2px 6px;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
    .cal-more{font-size:10px;color:#8a909a;padding-left:3px;cursor:default}
    .asg{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;border-radius:999px;padding:1px 8px;margin-right:2px}
    .asg i{width:6px;height:6px;border-radius:50%;display:inline-block;flex-shrink:0}
    .asg-none{background:#eef1f5;color:#8a909a}
  </style>
  <div class="card" style="margin-bottom:20px"><div class="card-h">
      <h3>${monthLabel} 일정 <span class="sub">요청 마감 · 프로젝트 마일스톤 · 담당자 색</span></h3>
      <span class="cal-toolbar"><button class="btn sm" id="cal-prev">‹</button><button class="btn sm" id="cal-today">이번 달</button><button class="btn sm" id="cal-next">›</button></span></div>
    <div class="card-b">
      <div class="cal-legend">${calLegend}</div>
      <div class="cal-grid-head">${calHead}</div>
      <div class="cal-grid">${calCells}</div>
    </div></div>`;

  const shiftMonth = n => {
    let [y, m] = dashMonth.split('-').map(Number); m += n;
    if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
    dashMonth = `${y}-${String(m).padStart(2, '0')}`; renderDashboard(main);
  };
  main.querySelector('#cal-prev').onclick = () => shiftMonth(-1);
  main.querySelector('#cal-next').onclick = () => shiftMonth(1);
  main.querySelector('#cal-today').onclick = () => { dashMonth = todayISO().slice(0, 7); renderDashboard(main); };

  // 업무 클릭 → 상세/수정 팝업 (요청 여부 자동 판별)
  main.querySelectorAll('[data-task]').forEach(el => el.onclick = () => {
    const tk = store.db.tasks.find(x => x.id === el.dataset.task);
    if (tk) editTask(tk.id, tk.kind === 'request');
  });
  // 마일스톤 클릭 → 이동 대신 마커·진행상황 변경 팝업
  main.querySelectorAll('[data-msrow]').forEach(el => el.onclick = () => {
    const [tid, mi] = el.dataset.msrow.split(':'); openMsModal(tid, +mi);
  });
}
