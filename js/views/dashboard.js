/* dashboard.js — 메인 써머리 */
import { store, todayISO } from '../store.js';
import { esc, fmtDate, dday, STATUS } from '../ui.js';

const taskRow = t => `
  <div class="tk-row">
    <div class="tk-dot ${t.status}"></div>
    <div class="tk-main">
      <div class="tk-title">${esc(t.title)}</div>
      <div class="tk-meta">
        <span>${esc(store.projectName(t.project))}</span>
        <span>${esc(store.assigneeNames(t))}</span>
        ${t.due ? `<span class="mono">${dday(t.due)}</span>` : ''}
        ${t.kind === 'request' ? `<span class="tag blue">${esc(t.requester || '요청')}</span>` : ''}
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

  // 예정 일정: 향후 7일 due 기준 그룹
  const upcoming = {};
  for (let i = 0; i <= 7; i++) {
    const d = todayISO(i);
    const list = open.filter(t => t.due === d);
    if (list.length) upcoming[d] = list;
  }

  // 간트 윈도우: -7일 ~ +28일
  const winStart = new Date(todayISO(-7)), winEnd = new Date(todayISO(28));
  const span = winEnd - winStart;
  const pct = d => Math.max(0, Math.min(100, (new Date(d) - winStart) / span * 100));
  const weekMarks = [0, 7, 14, 21, 28].map(off => {
    const d = todayISO(off - 7);
    return `<span style="left:${pct(d)}%">${d.slice(5).replace('-', '/')}</span>`;
  }).join('');

  const ganttRows = db.projects.map(p => {
    const cnt = open.filter(t => t.project === p.id).length;
    const l = pct(p.start), r = pct(p.end);
    return `<div class="g-row g-link" onclick="location.hash='#/tasks/projects'" title="클릭하면 타임라인 편집으로 이동">
      <div class="g-name">${esc(p.name)}<span>${esc(store.memberName(p.owner))} · 진행 ${cnt}건</span></div>
      <div class="g-track">
        <div class="g-bar" style="left:${l}%;width:${Math.max(2, r - l)}%;background:${p.color || 'var(--accent)'}"></div>
        <div class="g-today" style="left:${pct(today)}%"></div>
      </div>
    </div>`;
  }).join('') || '<div class="empty">프로젝트가 없어요. 업무 보드에서 추가해주세요.</div>';

  const assignCols = db.members.map(m => {
    const mine = open.filter(t => (t.assignees || []).includes(m.id))
      .sort((a, b) => (a.due || '9') < (b.due || '9') ? -1 : 1);
    return `<div class="assign-col">
      <h4>${esc(m.name)} <span class="cnt">${mine.length}건</span></h4>
      ${mine.slice(0, 5).map(taskRow).join('') || '<div class="empty">배정된 업무 없음</div>'}
    </div>`;
  }).join('');

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
        ${list.map(t => `<div class="tk-title" style="font-size:12.5px;padding:2px 0">· ${esc(t.title)} <span class="muted" style="font-size:11px">${esc(store.assigneeNames(t))}</span></div>`).join('')}</div>`).join('')
        || '<div class="empty">7일 내 예정 일정이 없어요</div>'}</div></div>
  </div>

  <div class="card" style="margin-bottom:20px"><div class="card-h"><h3>프로젝트 타임라인</h3><span class="sub">지난 1주 ~ 앞으로 4주</span></div>
    <div class="card-b gantt">
      <div class="g-scale"><div></div><div class="g-scale-track">${weekMarks}</div></div>
      ${ganttRows}
    </div></div>

  <span class="eyebrow">담당자별 업무</span>
  <div class="assign-grid">${assignCols}</div>`;
}
