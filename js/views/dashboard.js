/* dashboard.js — 메인 써머리 */
import { store, todayISO } from '../store.js';
import { esc, fmtDate, dday, STATUS } from '../ui.js';

const taskRow = t => `
  <div class="tk-row">
    <div class="tk-dot ${t.status}"></div>
    <div class="tk-main">
      <div class="tk-title" style="font-size:13.5px">${esc(t.title)}</div>
      <div class="tk-meta" style="font-size:11.5px">
        ${t.due ? `<b class="tk-dd ${t.due < todayISO() ? 'over' : (dday(t.due).match(/D-[0-3]$/) ? 'warn' : '')}">${dday(t.due)}</b><span class="mono" style="font-size:10px">${t.due.slice(5).replace('-', '/')}</span>` : ''}
        <span>${esc(store.assigneeNames(t))}</span>
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
      (t.milestones || []).forEach(m => {
        if (m.date && m.date >= msLo && m.date <= msHi)
          msAlerts.push({ date: m.date, proj: p.name, task: t.title, mk: mkOf(m.typeId), assignees: t.assignees || [], overdue: m.date < today });
      })));
  msAlerts.sort((a, b) => (a.date < b.date ? -1 : 1));

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
  }).join('') + `<span class="g-today-lb" style="left:${pct(today)}%">오늘</span>`;
  /* 주말 음영: 창 시작 요일 기준으로 토·일 반복 */
  const dow0 = new Date(todayISO(-7) + 'T00:00:00').getDay();
  const satOff = (6 - dow0 + 7) % 7;
  const dayPct = 100 / 35;
  // 바: 시작일·마지막일 칸만 진한 색, 중간은 연한 색
  const gBarBg = (c, w, dp) => {
    if (w <= dp * 2) return c;
    const capPct = Math.min(48, (dp / w) * 100); // 바 내부 기준 하루 폭(%)
    const light = `color-mix(in srgb, ${c} 22%, #eef1f5)`;
    return `linear-gradient(90deg, ${c} 0 ${capPct.toFixed(2)}%, ${light} ${capPct.toFixed(2)}% ${(100 - capPct).toFixed(2)}%, ${c} ${(100 - capPct).toFixed(2)}% 100%)`;
  };
  const wkndBg = `background-image:repeating-linear-gradient(90deg,rgba(120,120,120,.08) 0 ${(2 * dayPct).toFixed(3)}%,transparent ${(2 * dayPct).toFixed(3)}% ${(7 * dayPct).toFixed(3)}%);background-position:${(satOff * dayPct).toFixed(3)}% 0`;

  // 프로젝트별 마일스톤(하위 업무의 milestones) 기준으로 바·다음 일정 계산
  const projMs = pid => db.tasks.filter(t => t.kind === 'project' && t.project === pid)
    .flatMap(t => (t.milestones || []).map(m => m.date)).filter(Boolean).sort();
  const ganttRows = db.projects.filter(p => !p.archived)
    .map(p => ({ p, ms: projMs(p.id) }))
    .sort((a, b) => {
      const an = a.ms.find(d => d >= today) || a.ms.slice(-1)[0] || '9999';
      const bn = b.ms.find(d => d >= today) || b.ms.slice(-1)[0] || '9999';
      return an < bn ? -1 : 1;
    })
    .map(({ p, ms }) => {
    const cnt = db.tasks.filter(t => t.kind === 'project' && t.project === p.id).length;
    const next = ms.find(d => d >= today);
    const lo = ms[0], hi = ms[ms.length - 1];
    const l = lo ? pct(lo) : 0, r = hi ? pct(hi) : 0, w = Math.max(2, r - l);
    const ddCls = next ? (next < today ? 'over' : (Math.round((new Date(next + 'T00:00:00') - new Date(today + 'T00:00:00')) / 864e5) <= 7 ? 'warn' : '')) : '';
    return `<div class="g-row g-link" onclick="location.hash='#/tasks/projects'" title="클릭하면 프로젝트 타임라인으로 이동">
      <div class="g-name">${esc(p.name)}<span>${next ? `<b class="tl-dd ${ddCls}">다음 ${dday(next)}</b> · ` : ''}${esc(store.memberName(p.owner))} · 하위 ${cnt}건</span></div>
      <div class="g-track" style="${wkndBg}">
        ${ms.length ? `<div class="g-bar" style="left:${l}%;width:${w}%;background:${gBarBg(p.color || 'var(--accent)', w, dayPct)}"></div>` : '<span style="position:absolute;left:8px;top:5px;font-size:10px;color:#9AA1AC">일정 미정</span>'}
        <div class="g-today" style="left:${pct(today)}%"></div>
      </div>
    </div>`;
  }).join('') || '<div class="empty">진행 중인 프로젝트가 없어요. 업무 보드 → 프로젝트 타임라인에서 추가해주세요.</div>';

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
      <div class="d-stat ${msAlerts.length ? 'warn' : ''}"><b>${msAlerts.length}</b><span>마일스톤 임박</span></div>
    </div>
  </div>

  ${msAlerts.length ? `<div class="card" style="margin-bottom:20px"><div class="card-h"><h3>🔔 프로젝트 마일스톤</h3><span class="sub">임박·최근 (−3 ~ +7일) · 클릭 시 타임라인</span></div>
    <div class="card-b">${msAlerts.map(a => { const c = a.mk?.color || '#9AA1AC'; const nm = a.mk?.name || '일정'; return `
      <div class="tk-row" style="cursor:pointer" onclick="location.hash='#/tasks/projects'">
        <span style="background:${c}22;color:${c};border-radius:999px;padding:2px 9px;font-size:11px;font-weight:700;flex-shrink:0">${esc(nm)}</span>
        <div class="tk-main"><div class="tk-title" style="font-size:13px">${esc(a.proj)} · ${esc(a.task)}</div>
          <div class="tk-meta" style="font-size:11.5px"><b class="tk-dd ${a.overdue ? 'over' : 'warn'}">${a.date.slice(5).replace('-', '/')} · ${dday(a.date)}</b><span>${esc(store.assigneeNames({ assignees: a.assignees }))}</span></div></div>
      </div>`; }).join('')}</div></div>` : ''}

  <div class="dash-cols">
    <div class="card"><div class="card-h"><h3>오늘 할 일</h3><span class="sub">${fmtDate(today)}</span></div>
      <div class="card-b">${todayTasks.map(taskRow).join('') || '<div class="empty">오늘 마감/진행 업무가 없어요</div>'}</div></div>
    <div class="card"><div class="card-h"><h3>내일 할 일</h3><span class="sub">${fmtDate(tomorrow)}</span></div>
      <div class="card-b">${tomorrowTasks.map(taskRow).join('') || '<div class="empty">내일 마감 업무가 없어요</div>'}</div></div>
    <div class="card"><div class="card-h"><h3>예정된 일정</h3><span class="sub">향후 7일</span></div>
      <div class="card-b">${Object.entries(upcoming).map(([d, list]) => `
        <div class="sched-day"><div class="sd-label">${fmtDate(d)} · ${dday(d)}</div>
        ${list.map(t => `<div class="tk-title" style="font-size:13.5px;padding:3px 0">· ${esc(t.title)} <span class="muted" style="font-size:12px">${esc(store.assigneeNames(t))}</span></div>`).join('')}</div>`).join('')
        || '<div class="empty">7일 내 예정 일정이 없어요</div>'}</div></div>
  </div>

  <div class="card" style="margin-bottom:20px"><div class="card-h"><h3>프로젝트 타임라인</h3><span class="sub">마일스톤 기준 · 다음 일정 임박순</span></div>
    <div class="card-b gantt">
      <div class="g-scale"><div></div><div class="g-scale-track">${weekMarks}</div></div>
      ${ganttRows}
    </div></div>

  <span class="eyebrow">담당자별 업무</span>
  <div class="assign-grid">${assignCols}</div>`;
}
