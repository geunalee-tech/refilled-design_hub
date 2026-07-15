/* timeline.js — 프로젝트 타임라인 (드래그로 일정 조정 + 하위 업무 관리) */
import { store, uid, todayISO } from '../store.js';
import { esc, toast, dday, STATUS, $ } from '../ui.js';
import { editTask, subTabs } from './tasks.js';

const DAYS = 42; // 6주 창
let winStart = todayISO(-7);
let expanded = new Set();

const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayIdx = iso => Math.round((new Date(iso + 'T00:00:00') - new Date(winStart + 'T00:00:00')) / 864e5);
const pctL = iso => dayIdx(iso) / DAYS * 100;

export function renderTimeline(main) {
  const db = store.db;
  const today = todayISO();

  const scaleMarks = [];
  for (let i = 0; i <= DAYS; i += 7) {
    const d = addDays(winStart, i);
    scaleMarks.push(`<span style="left:${i / DAYS * 100}%">${d.slice(5).replace('-', '/')}</span>`);
  }

  const projRows = db.projects.map(p => {
    const tasks = db.tasks.filter(t => t.project === p.id && t.status !== 'done')
      .sort((a, b) => (a.due || '9') < (b.due || '9') ? -1 : 1);
    const doneCnt = db.tasks.filter(t => t.project === p.id && t.status === 'done').length;
    const isOpen = expanded.has(p.id);
    const l = pctL(p.start || today), r = pctL(p.end || today) + 100 / DAYS;

    const taskRows = isOpen ? tasks.map(t => `
      <div class="tl-task" data-tid="${t.id}">
        <div class="tl-tname">
          <span class="tk-dot ${t.status}"></span>
          <span class="tt" title="${esc(t.title)}">${esc(t.title)}</span>
          <span class="ta">${esc(store.assigneeNames(t))}</span>
          <button class="tl-x" data-deltask="${t.id}" title="업무 삭제">✕</button>
        </div>
        <div class="g-track tl-ttrack">
          ${t.due ? `<div class="g-due" data-drag="due" data-tid="${t.id}" style="left:calc(${pctL(t.due)}% - 7px)" title="${t.due} · 드래그로 마감일 조정"></div>` : '<span class="tl-nodue">마감일 없음</span>'}
          <div class="g-today" style="left:${pctL(today)}%"></div>
        </div>
      </div>`).join('') +
      `<div class="tl-task tl-addrow"><div class="tl-tname">
        <button class="btn sm" data-addtask="${p.id}">+ 하위 업무 추가</button>
        ${doneCnt ? `<span class="muted" style="font-size:11px">완료 ${doneCnt}건은 보드의 완료 아카이브에</span>` : ''}
      </div><div></div></div>` : '';

    return `<div class="tl-proj" data-pid="${p.id}">
      <div class="tl-prow">
        <div class="tl-pname">
          <button class="tl-toggle ${isOpen ? 'open' : ''}" data-toggle="${p.id}">▸</button>
          <span class="pn" title="${esc(p.name)}">${esc(p.name)}</span>
          <span class="pm">${esc(store.memberName(p.owner))} · ${tasks.length}건</span>
          <button class="tl-x" data-delproj="${p.id}" title="프로젝트 삭제">✕</button>
        </div>
        <div class="g-track tl-ptrack">
          <div class="g-bar tl-bar" data-drag="move" data-pid="${p.id}"
               style="left:${l}%;width:${Math.max(2, r - l)}%;background:${p.color || 'var(--accent)'}">
            <span class="g-h g-hl" data-drag="l" data-pid="${p.id}"></span>
            <span class="g-h g-hr" data-drag="r" data-pid="${p.id}"></span>
          </div>
          <div class="g-today" style="left:${pctL(today)}%"></div>
        </div>
      </div>
      ${taskRows}
    </div>`;
  }).join('') || '<div class="empty" style="padding:30px">프로젝트가 없어요. 오른쪽 위 버튼으로 추가해주세요.</div>';

  main.innerHTML = `
  <div class="page-head"><span class="eyebrow">Task Stream</span>
    <h1>업무 보드</h1><p>바를 드래그해 프로젝트 기간을, 마커를 드래그해 하위 업무 마감일을 조정해요.</p></div>
  ${subTabs('projects')}
  <div class="board-bar">
    <button class="btn sm" id="tl-prev">◀ 2주</button>
    <button class="btn sm" id="tl-today">오늘</button>
    <button class="btn sm" id="tl-next">2주 ▶</button>
    <span class="muted" style="font-size:11.5px;font-variant-numeric:tabular-nums">${winStart} ~ ${addDays(winStart, DAYS)}</span>
    <span style="flex:1"></span>
    <button class="btn primary" id="tl-addproj">+ 프로젝트 추가</button>
  </div>
  <div class="card" style="padding:16px 18px">
    <div class="g-scale tl-scale"><div></div><div class="g-scale-track">${scaleMarks.join('')}</div></div>
    <div id="tl-body">${projRows}</div>
    <p class="muted" style="font-size:11px;margin-top:12px">양끝 핸들 = 시작/종료일 변경 · 바 가운데 = 기간 통째로 이동 · ▸ = 하위 업무 펼치기</p>
  </div>`;

  /* ── 내비게이션 ── */
  $('#tl-prev').onclick = () => { winStart = addDays(winStart, -14); renderTimeline(main); };
  $('#tl-next').onclick = () => { winStart = addDays(winStart, 14); renderTimeline(main); };
  $('#tl-today').onclick = () => { winStart = todayISO(-7); renderTimeline(main); };
  $('#tl-addproj').onclick = () => addProject(main);

  /* ── 토글/추가/삭제 ── */
  main.querySelectorAll('[data-toggle]').forEach(b => b.onclick = () => {
    const id = b.dataset.toggle;
    expanded.has(id) ? expanded.delete(id) : expanded.add(id);
    renderTimeline(main);
  });
  main.querySelectorAll('[data-addtask]').forEach(b => b.onclick = () =>
    editTask(null, false, { project: b.dataset.addtask, kind: 'project' }));
  main.querySelectorAll('[data-deltask]').forEach(b => b.onclick = () => {
    const t = store.db.tasks.find(x => x.id === b.dataset.deltask);
    if (!confirm(`"${t.title}" 업무를 삭제할까요?`)) return;
    store.db.tasks = store.db.tasks.filter(x => x.id !== b.dataset.deltask);
    store.save(); renderTimeline(main); toast('삭제했어요');
  });
  main.querySelectorAll('[data-delproj]').forEach(b => b.onclick = () => {
    const p = store.db.projects.find(x => x.id === b.dataset.delproj);
    const cnt = store.db.tasks.filter(t => t.project === p.id).length;
    if (!confirm(`"${p.name}" 프로젝트를 삭제할까요?${cnt ? `\n연결된 업무 ${cnt}건은 '기타'로 남아요.` : ''}`)) return;
    store.db.projects = store.db.projects.filter(x => x.id !== p.id);
    store.save(); renderTimeline(main); toast('프로젝트를 삭제했어요');
  });
  main.querySelectorAll('.tl-tname .tt').forEach(el => el.onclick = () =>
    editTask(el.closest('[data-tid]').dataset.tid));

  bindDrag(main);
}

/* ── 드래그: 프로젝트 바(move/l/r) + 업무 마감 마커(due) ── */
function bindDrag(main) {
  main.querySelectorAll('[data-drag]').forEach(el => {
    el.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      const mode = el.dataset.drag;
      const track = el.closest('.g-track');
      const pxPerDay = track.getBoundingClientRect().width / DAYS;
      const startX = e.clientX;
      let deltaDays = 0;

      const p = el.dataset.pid ? store.db.projects.find(x => x.id === el.dataset.pid) : null;
      const t = el.dataset.tid ? store.db.tasks.find(x => x.id === el.dataset.tid) : null;
      const orig = p ? { start: p.start, end: p.end } : { due: t.due };
      const bar = mode === 'due' ? el : el.closest('.tl-bar');
      bar.classList.add('dragging');
      el.setPointerCapture(e.pointerId);

      const onMove = ev => {
        deltaDays = Math.round((ev.clientX - startX) / pxPerDay);
        if (mode === 'due') {
          bar.style.left = `calc(${pctL(addDays(orig.due, deltaDays))}% - 7px)`;
        } else {
          let s = orig.start, en = orig.end;
          if (mode === 'move') { s = addDays(s, deltaDays); en = addDays(en, deltaDays); }
          if (mode === 'l') { s = addDays(s, deltaDays); if (s > en) s = en; }
          if (mode === 'r') { en = addDays(en, deltaDays); if (en < s) en = s; }
          const l = pctL(s), r = pctL(en) + 100 / DAYS;
          bar.style.left = l + '%'; bar.style.width = Math.max(2, r - l) + '%';
        }
      };
      const onUp = () => {
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        bar.classList.remove('dragging');
        if (!deltaDays) return;
        if (mode === 'due') { t.due = addDays(orig.due, deltaDays); toast(`마감일 → ${t.due} (${dday(t.due)})`); }
        else {
          if (mode === 'move' || mode === 'l') p.start = addDays(orig.start, mode === 'r' ? 0 : deltaDays);
          if (mode === 'move' || mode === 'r') p.end = addDays(orig.end, mode === 'l' ? 0 : deltaDays);
          if (p.start > p.end) [p.start, p.end] = [p.end, p.start];
          toast(`${p.name}: ${p.start} ~ ${p.end}`);
        }
        store.save(); renderTimeline(main);
      };
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
    });
  });
}

/* ── 프로젝트 빠른 추가 ── */
function addProject(main) {
  const name = prompt('새 프로젝트 이름을 입력해주세요');
  if (!name) return;
  const PALETTE = ['#006DE2', '#0F7B5F', '#B7791F', '#6B5CA5', '#8A3B5E', '#3B7A8A'];
  const p = {
    id: uid(), name: name.trim(),
    color: PALETTE[store.db.projects.length % PALETTE.length],
    start: todayISO(), end: todayISO(21),
    owner: store.db.members.find(m => m.name === store.settings.userName)?.id || store.db.members[0]?.id || null
  };
  store.db.projects.push(p);
  expanded.add(p.id);
  store.save(); renderTimeline(main);
  toast('프로젝트를 추가했어요. 바를 드래그해 기간을 잡아주세요.');
}
