/* timeline.js — 프로젝트 타임라인 v31
   일 단위 그리드 + 좌우 스크롤 캔버스 · 드래그 = 1일 = DAY_W px (정확한 마우스 추적) */
import { store, uid, todayISO, addDaysISO, localISO } from '../store.js';
import { esc, toast, dday, STATUS, openModal, closeModal, $ } from '../ui.js';
import { editTask, subTabs } from './tasks.js';

const DAY_W = 30;            // 하루 = 30px
const LAB_W = 264;           // 왼쪽 라벨 열 너비
let expanded = new Set();
let lastScrollX = null;      // 렌더 간 스크롤 위치 유지 (null = 오늘로 이동)

const addDays = (iso, n) => addDaysISO(iso, n);
const WD = ['일', '월', '화', '수', '목', '금', '토'];

export function renderTimeline(main) {
  const db = store.db;
  const today = todayISO();

  /* ── 전체 범위: 가장 이른 시작 ~ 가장 늦은 종료 (월 단위로 스냅) ── */
  let lo = today, hi = addDays(today, 45);
  db.projects.forEach(p => {
    if (p.start && p.start < lo) lo = p.start;
    if (p.end && p.end > hi) hi = p.end;
  });
  db.tasks.forEach(t => { if (t.due && t.due > hi) hi = t.due; });
  const rangeStart = lo.slice(0, 8) + '01';
  const hiD = new Date(hi + 'T00:00:00'); hiD.setMonth(hiD.getMonth() + 1, 0); // 그 달의 말일
  const rangeEnd = localISO(hiD);
  const idx = iso => Math.round((new Date(iso + 'T00:00:00') - new Date(rangeStart + 'T00:00:00')) / 864e5);
  const totalDays = idx(rangeEnd) + 1;
  const W = totalDays * DAY_W;
  const px = iso => idx(iso) * DAY_W;

  /* ── 헤더: 월 밴드 + 일 숫자 ── */
  const monthCells = [], dayCells = [];
  let mStart = 0, mLabel = '';
  for (let i = 0; i <= totalDays; i++) {
    const iso = i < totalDays ? addDays(rangeStart, i) : null;
    const lb = iso ? `${+iso.slice(0, 4)}년 ${+iso.slice(5, 7)}월` : '';
    if (lb !== mLabel) {
      if (mLabel) monthCells.push(`<div class="t2-m" style="left:${mStart * DAY_W}px;width:${(i - mStart) * DAY_W}px">${mLabel}</div>`);
      mStart = i; mLabel = lb;
    }
    if (!iso) break;
    const dow = new Date(iso + 'T00:00:00').getDay();
    const cls = iso === today ? 'today' : dow === 0 ? 'sun' : dow === 6 ? 'sat' : '';
    dayCells.push(`<div class="t2-d ${cls}" style="left:${i * DAY_W}px;width:${DAY_W}px">${iso === today ? '오늘' : +iso.slice(8)}</div>`);
  }

  /* ── 트랙 공통 배경: 주말 음영(반복 그라디언트) + 월 경계선 + 오늘 컬럼 ── */
  const satOff = (6 - new Date(rangeStart + 'T00:00:00').getDay() + 7) % 7;
  const wkndBg = `background-image:repeating-linear-gradient(90deg,rgba(120,120,120,.075) 0 ${2 * DAY_W}px,transparent ${2 * DAY_W}px ${7 * DAY_W}px);background-position:${satOff * DAY_W}px 0`;
  let lines = `<span class="t2-todaycol" style="left:${px(today)}px;width:${DAY_W}px"></span><span class="t2-todayline" style="left:${px(today) + DAY_W / 2}px"></span>`;
  for (let i = 1; i < totalDays; i++) {
    if (addDays(rangeStart, i).endsWith('-01')) lines += `<span class="t2-mline" style="left:${i * DAY_W}px"></span>`;
  }

  /* ── 프로젝트 행 (마감 임박 순) ── */
  const projs = [...db.projects].sort((a, b) => ((a.end || '9999') < (b.end || '9999') ? -1 : 1));

  const rows = projs.map(p => {
    const tasks = db.tasks.filter(t => t.project === p.id && t.status !== 'done')
      .sort((a, b) => (a.due || '9') < (b.due || '9') ? -1 : 1);
    const doneCnt = db.tasks.filter(t => t.project === p.id && t.status === 'done').length;
    const isOpen = expanded.has(p.id);
    const s = p.start || today, e = p.end || today;
    const bl = px(s), bw = (idx(e) - idx(s) + 1) * DAY_W;
    const remain = p.end ? idx(p.end) - idx(today) : null;
    const ddCls = remain === null ? '' : remain < 0 ? 'over' : remain <= 7 ? 'warn' : '';
    const rangeLb = `${s.slice(5).replace('-', '/')} ~ ${e.slice(5).replace('-', '/')}`;

    const taskRows = isOpen ? tasks.map(t => `
      <div class="t2-row t2-taskrow" data-tid="${t.id}">
        <div class="t2-lab t2-tlab">
          <span class="tk-dot ${t.status}"></span>
          <div class="t2-lab-main">
            <span class="tt" title="${esc(t.title)}">${esc(t.title)}</span>
            <span class="t2-meta">${t.due ? `<b class="td ${t.due < today ? 'over' : ''}">${t.due.slice(5).replace('-', '/')} · ${dday(t.due)}</b> · ` : ''}${esc(store.assigneeNames(t))}</span>
          </div>
          <button class="tl-x" data-deltask="${t.id}" title="업무 삭제">✕</button>
        </div>
        <div class="t2-canvas" style="width:${W}px;${wkndBg}">
          ${lines}
          ${t.due
            ? `<div class="g-due" data-drag="due" data-tid="${t.id}" style="left:${px(t.due) + DAY_W / 2 - 7}px" title="${t.due} · 드래그로 마감일 조정"></div><span class="g-due-lb" style="left:${px(t.due) + DAY_W / 2 + 11}px">${t.due.slice(5).replace('-', '/')}</span>`
            : '<span class="tl-nodue">마감일 없음</span>'}
        </div>
      </div>`).join('') +
      `<div class="t2-row t2-addrow">
        <div class="t2-lab"><button class="btn sm" data-addtask="${p.id}">+ 하위 업무 추가</button>
          ${doneCnt ? `<span class="muted" style="font-size:11px">완료 ${doneCnt}건은 아카이브에</span>` : ''}</div>
        <div class="t2-canvas" style="width:${W}px"></div>
      </div>` : '';

    return `<div class="t2-proj" data-pid="${p.id}">
      <div class="t2-row">
        <div class="t2-lab">
          <button class="tl-toggle ${isOpen ? 'open' : ''}" data-toggle="${p.id}">▸</button>
          <div class="t2-lab-main">
            <span class="pn2 pn2-click" data-editproj="${p.id}" title="${esc(p.name)} · 클릭하면 전체 일정을 조정할 수 있어요">${esc(p.name)}</span>
            <span class="t2-meta">${p.end ? `<b class="tl-dd ${ddCls}">${dday(p.end)}</b> · ` : ''}${rangeLb} · ${esc(store.memberName(p.owner))} · ${tasks.length}건</span>
          </div>
          <button class="tl-x" data-delproj="${p.id}" title="프로젝트 삭제">✕</button>
        </div>
        <div class="t2-canvas" style="width:${W}px;${wkndBg}">
          ${lines}
          <div class="g-bar tl-bar" data-drag="move" data-pid="${p.id}"
               title="${s} ~ ${e}${p.end ? ` · ${dday(p.end)}` : ''} · 드래그로 기간 이동"
               style="left:${bl}px;width:${bw}px;background:${p.color || 'var(--accent)'}">
            <span class="g-h g-hl" data-drag="l" data-pid="${p.id}"></span>
            ${bw >= 118 ? `<span class="t2-barlb">${rangeLb}</span>` : ''}
            <span class="g-h g-hr" data-drag="r" data-pid="${p.id}"></span>
          </div>
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
    <button class="btn sm" id="tl-today">📍 오늘로 이동</button>
    <span class="muted" style="font-size:11.5px;font-variant-numeric:tabular-nums">${rangeStart} ~ ${rangeEnd} · 좌우로 스크롤하세요</span>
    <span style="flex:1"></span>
    <button class="btn primary" id="tl-addproj">+ 프로젝트 추가</button>
  </div>
  <div class="card" style="padding:0;overflow:hidden">
    <div class="t2-scroll" id="t2-scroll">
      <div class="t2-inner" style="width:${LAB_W + W}px">
        <div class="t2-row t2-head">
          <div class="t2-lab t2-corner"></div>
          <div class="t2-canvas t2-headcv" style="width:${W}px">
            ${monthCells.join('')}
            <div class="t2-days">${dayCells.join('')}</div>
            <span class="t2-todayline" style="left:${px(today) + DAY_W / 2}px;top:auto;height:0"></span>
          </div>
        </div>
        <div id="tl-body">${rows}</div>
      </div>
    </div>
    <p class="muted" style="font-size:11px;margin:10px 16px">양끝 핸들 = 시작/종료일 변경 · 바 가운데 = 기간 통째로 이동 · ▸ = 하위 업무 펼치기 · 회색 세로줄 = 주말</p>
  </div>`;

  /* ── 스크롤: 오늘 중심 (렌더 간 위치 유지) ── */
  const sc = $('#t2-scroll');
  sc.scrollLeft = lastScrollX === null ? Math.max(0, px(today) - DAY_W * 6) : lastScrollX;
  sc.addEventListener('scroll', () => { lastScrollX = sc.scrollLeft; }, { passive: true });
  $('#tl-today').onclick = () => sc.scrollTo({ left: Math.max(0, px(today) - DAY_W * 6), behavior: 'smooth' });
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
  main.querySelectorAll('.t2-lab .tt').forEach(el => el.onclick = () =>
    editTask(el.closest('[data-tid]').dataset.tid));
  main.querySelectorAll('[data-editproj]').forEach(el => el.onclick = () =>
    editProjectFlow(el.dataset.editproj, main));

  bindDrag(main);
}

/* ── 드래그: 하루 = DAY_W px 고정이라 마우스와 1:1로 움직여요 ── */
function bindDrag(main) {
  main.querySelectorAll('[data-drag]').forEach(el => {
    el.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      const mode = el.dataset.drag;
      const startX = e.clientX;
      let deltaDays = 0;

      const p = el.dataset.pid ? store.db.projects.find(x => x.id === el.dataset.pid) : null;
      const t = el.dataset.tid ? store.db.tasks.find(x => x.id === el.dataset.tid) : null;
      const orig = p ? { start: p.start, end: p.end } : { due: t.due };
      const bar = mode === 'due' ? el : el.closest('.tl-bar');
      const origLeft = parseFloat(bar.style.left), origW = parseFloat(bar.style.width || 0);
      bar.classList.add('dragging');
      el.setPointerCapture(e.pointerId);

      const onMove = ev => {
        deltaDays = Math.round((ev.clientX - startX) / DAY_W);
        const dx = deltaDays * DAY_W;
        if (mode === 'due') bar.style.left = origLeft + dx + 'px';
        if (mode === 'move') bar.style.left = origLeft + dx + 'px';
        if (mode === 'l') { const w = Math.max(DAY_W, origW - dx); bar.style.left = origLeft + (origW - w) + 'px'; bar.style.width = w + 'px'; }
        if (mode === 'r') bar.style.width = Math.max(DAY_W, origW + dx) + 'px';
      };
      const onUp = () => {
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        bar.classList.remove('dragging');
        if (!deltaDays) return;
        if (mode === 'due') { t.due = addDays(orig.due, deltaDays); toast(`마감일 → ${t.due} (${dday(t.due)})`); }
        else {
          if (mode === 'move' || mode === 'l') p.start = addDays(orig.start, deltaDays);
          if (mode === 'move' || mode === 'r') p.end = addDays(orig.end, deltaDays);
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

/* ── 전체 플로우 편집: 프로젝트 기간 + 하위 업무 마감을 한 화면에서 조정 ── */
function editProjectFlow(pid, main) {
  const db = store.db;
  const p = db.projects.find(x => x.id === pid);
  if (!p) return;
  const today = todayISO();

  /* 작업본 (저장 전까지 원본 미변경) */
  const w = { name: p.name, owner: p.owner || '', start: p.start || today, end: p.end || today };
  const items = db.tasks.filter(t => t.project === pid && t.status !== 'done')
    .sort((a, b) => (a.due || '9') < (b.due || '9') ? -1 : 1)
    .map(t => ({ id: t.id, title: t.title, status: t.status, due: t.due || '' }));

  openModal(`
    <h2>전체 일정 조정</h2>
    <div class="field"><label>프로젝트 이름</label><input id="pf-name" value="${esc(w.name)}"></div>
    <div class="frow">
      <div class="field"><label>시작일</label><input type="date" id="pf-start" value="${w.start}"></div>
      <div class="field"><label>종료일</label><input type="date" id="pf-end" value="${w.end}"></div>
      <div class="field"><label>담당자 (오너)</label><select id="pf-owner">
        <option value="">미지정</option>
        ${db.members.map(m => `<option value="${m.id}" ${m.id === w.owner ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label>전체 밀기·당기기 <span class="muted" style="font-weight:400">(프로젝트 기간 + 하위 업무 마감일이 통째로 이동해요)</span></label>
      <div class="pf-shift">
        <button class="btn sm" data-shift="-7">◀ 1주</button>
        <button class="btn sm" data-shift="-1">◀ 1일</button>
        <span class="pf-shift-sum" id="pf-shift-sum">±0일</span>
        <button class="btn sm" data-shift="1">1일 ▶</button>
        <button class="btn sm" data-shift="7">1주 ▶</button>
      </div>
    </div>
    <div class="field"><label>플로우 미리보기 <span class="muted" style="font-weight:400">(점 = 하위 업무 마감 · 드래그로 조정)</span></label>
      <div id="pf-preview" class="np-preview"></div>
    </div>
    <div class="field"><label>하위 업무 마감일</label><div id="pf-items"></div></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn" data-close>취소</button>
      <button class="btn primary" id="pf-save">저장</button>
    </div>
  `, body => {
    const q = sel => body.querySelector(sel);
    let shifted = 0;

    /* 미리보기 범위: 기간·마감을 모두 포함 + 여유 2일 */
    const draw = () => {
      const dues = items.filter(i => i.due).map(i => i.due);
      const lo = addDays([w.start, ...dues].sort()[0], -2);
      const hi0 = [w.end, ...dues].sort().slice(-1)[0];
      const span = Math.max(7, Math.round((new Date(hi0 + 'T00:00:00') - new Date(lo + 'T00:00:00')) / 864e5) + 3);
      const pos = iso => Math.round((new Date(iso + 'T00:00:00') - new Date(lo + 'T00:00:00')) / 864e5) / span * 100;

      const ticks = [];
      const step = span > 90 ? 30 : span > 40 ? 14 : 7;
      for (let d = 0; d <= span; d += step)
        ticks.push(`<span class="np-tick" style="left:${d / span * 100}%">${addDays(lo, d).slice(5).replace('-', '/')}</span>`);
      const todayPos = pos(today);

      q('#pf-preview').innerHTML = `
        <div class="np-track">
          ${ticks.join('')}
          ${todayPos >= 0 && todayPos <= 100 ? `<span class="pf-today" style="left:${todayPos}%"></span>` : ''}
          <div class="pf-bar" data-pfdrag="move" style="left:${pos(w.start)}%;width:${Math.max(2, pos(w.end) - pos(w.start) + 100 / span)}%;background:${p.color || 'var(--accent)'}">
            <span class="g-h g-hl" data-pfdrag="l"></span><span class="g-h g-hr" data-pfdrag="r"></span>
          </div>
          ${(() => {
            const seen = new Set(); const placed = [];
            return items.map((it, i) => {
              if (!it.due) return '';
              const x = pos(it.due);
              /* 가까운 점(3.5% 이내)들은 상·하단 순환 + 가로 미세 오프셋으로 분산 */
              const close = placed.filter(q2 => Math.abs(q2.x - x) < 3.5).length;
              const lane = close % 2, nudge = Math.floor(close / 2) * 9;
              placed.push({ x, lane });
              const showLb = !seen.has(it.due); seen.add(it.due);
              return `
            <div class="np-dot" data-pfdot="${i}" style="left:calc(${x}% + ${nudge - 7}px);top:${lane ? 19 : 3}px" title="${esc(it.title)} · ${it.due}"></div>
            ${showLb ? `<span class="np-dot-lb" style="left:calc(${x}% - 7px);top:${seen.size % 2 ? -15 : 38}px">${it.due.slice(5).replace('-', '/')}</span>` : ''}`;
            }).join('');
          })()}
        </div>`;

      const pxPerDay = () => q('.np-track').getBoundingClientRect().width / span;

      /* 점 드래그 = 하위 업무 마감 */
      q('#pf-preview').querySelectorAll('[data-pfdot]').forEach(el => {
        el.addEventListener('pointerdown', e => {
          e.preventDefault();
          const i = +el.dataset.pfdot, startX = e.clientX, orig = items[i].due;
          el.setPointerCapture(e.pointerId);
          let dd = 0;
          const mv = ev => {
            dd = Math.round((ev.clientX - startX) / pxPerDay());
            el.style.left = `calc(${pos(addDays(orig, dd))}% - 7px)`;
          };
          const up = () => {
            el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up);
            if (dd) items[i].due = addDays(orig, dd);
            draw(); drawItems();
          };
          el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
        });
      });

      /* 바 드래그 = 프로젝트 기간 (이동/양끝) */
      q('#pf-preview').querySelectorAll('[data-pfdrag]').forEach(el => {
        el.addEventListener('pointerdown', e => {
          e.preventDefault(); e.stopPropagation();
          const mode = el.dataset.pfdrag, startX = e.clientX;
          const o = { s: w.start, e: w.end };
          el.setPointerCapture(e.pointerId);
          let dd = 0;
          const mv = ev => { dd = Math.round((ev.clientX - startX) / pxPerDay()); };
          const up = () => {
            el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up);
            if (dd) {
              if (mode === 'move' || mode === 'l') w.start = addDays(o.s, dd);
              if (mode === 'move' || mode === 'r') w.end = addDays(o.e, dd);
              if (w.start > w.end) [w.start, w.end] = [w.end, w.start];
              q('#pf-start').value = w.start; q('#pf-end').value = w.end;
            }
            draw();
          };
          el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
        });
      });
    };

    /* 하위 업무 목록: 날짜 인풋으로도 조정 */
    const drawItems = () => {
      q('#pf-items').innerHTML = items.map((it, i) => `
        <div class="pf-item">
          <span class="tk-dot ${it.status}"></span>
          <span class="pf-it-title" title="${esc(it.title)}">${esc(it.title)}</span>
          <span class="pf-it-dd">${it.due ? dday(it.due) : ''}</span>
          <input type="date" class="pf-it-due" data-item="${i}" value="${it.due}">
        </div>`).join('')
        || '<div class="empty" style="padding:8px 2px">진행 중인 하위 업무가 없어요.</div>';
      q('#pf-items').querySelectorAll('.pf-it-due').forEach(inp => inp.onchange = () => {
        items[+inp.dataset.item].due = inp.value; draw(); drawItems();
      });
    };

    /* 전체 밀기 */
    body.querySelectorAll('[data-shift]').forEach(b => b.onclick = () => {
      const n = +b.dataset.shift;
      shifted += n;
      w.start = addDays(w.start, n); w.end = addDays(w.end, n);
      items.forEach(it => { if (it.due) it.due = addDays(it.due, n); });
      q('#pf-start').value = w.start; q('#pf-end').value = w.end;
      q('#pf-shift-sum').textContent = (shifted > 0 ? '+' : '') + shifted + '일';
      q('#pf-shift-sum').classList.toggle('on', shifted !== 0);
      draw(); drawItems();
    });

    q('#pf-start').onchange = e => { if (e.target.value) { w.start = e.target.value; if (w.start > w.end) w.end = w.start; q('#pf-end').value = w.end; draw(); } };
    q('#pf-end').onchange = e => { if (e.target.value) { w.end = e.target.value; if (w.end < w.start) w.start = w.end; q('#pf-start').value = w.start; draw(); } };

    q('#pf-save').onclick = () => {
      const name = q('#pf-name').value.trim();
      if (!name) return toast('프로젝트 이름을 입력해주세요', true);
      p.name = name; p.owner = q('#pf-owner').value || null;
      p.start = w.start; p.end = w.end;
      items.forEach(it => {
        const t = db.tasks.find(x => x.id === it.id);
        if (t) t.due = it.due || t.due;
      });
      store.save(); closeModal(); renderTimeline(main);
      toast(`"${name}" 일정을 저장했어요${shifted ? ` (전체 ${shifted > 0 ? '+' : ''}${shifted}일 이동)` : ''}`);
    };

    draw(); drawItems();
  });
}


/* ── 프로젝트 성격별 템플릿 (기존 구글시트 운영 패턴 기반) ── */
const TEMPLATES = {
  detail: { label: '상세페이지 (신규·리뉴얼)', dur: 42, steps: [
    ['방향성 기획', 5], ['기획 전달·자료 취합', 8], ['1차 디자인', 16],
    ['2차 디자인', 26], ['최종 컨펌', 34], ['최종 발주·업로드', 40]] },
  banner: { label: '배너·프로모션 (기획전·자사몰)', dur: 14, steps: [
    ['기획 전달 확인', 1], ['1차 디자인', 5], ['2차 디자인', 9], ['최종·사이즈 파생', 12]] },
  pkg: { label: '패키지 (용기·단상자·리플렛)', dur: 56, steps: [
    ['문안·칼선 수령', 3], ['1차 디자인', 12], ['1차 문안 검수', 18], ['2차 디자인', 26],
    ['수정 문안 반영', 32], ['용기·단상자 최종', 40], ['샘플링 파일 전달', 45],
    ['인쇄 감리', 50], ['최종 발주파일', 54]] },
  content: { label: '제품 콘텐츠 (누끼컷·썸네일)', dur: 21, steps: [
    ['촬영본·누끼컷 수령', 3], ['썸네일 1차', 8], ['보정·2차', 14], ['최종 발주파일', 19]] },
  gwp: { label: '기획세트·GWP (제휴몰·올영)', dur: 42, steps: [
    ['용기·구성품 1차', 7], ['용기 최종', 16], ['문안 검수용 전달', 22],
    ['샘플링 파일 전달', 28], ['IP·채널 검수', 34], ['최종 발주·수정 반영', 40]] },
  shoot: { label: '촬영 프로젝트', dur: 21, steps: [
    ['촬영용 제품 수령', 3], ['촬영 (제품·연출)', 8], ['셀렉', 12],
    ['보정컷 수령·확인', 17], ['최종 아카이빙', 20]] },
  blank: { label: '빈 프로젝트 (직접 구성)', dur: 21, steps: [] },
};
const PALETTE = ['#006DE2', '#0F7B5F', '#B7791F', '#6B5CA5', '#8A3B5E', '#3B7A8A'];

function addProject(main) {
  const db = store.db;
  /* 편집 가능한 단계 상태: [{name, off, on}] */
  let steps = [];
  const loadTpl = key => { steps = TEMPLATES[key].steps.map(([name, off]) => ({ name, off, on: true })); };
  loadTpl('detail');
  const maxOff = () => Math.max(3, ...steps.filter(st => st.on).map(st => st.off), 0);

  openModal(`
    <h2>프로젝트 추가</h2>
    <div class="field"><label>프로젝트 이름</label><input id="np-name" placeholder="예: [신규] 클렌저 패키지"></div>
    <div class="frow">
      <div class="field"><label>프로젝트 성격</label><select id="np-type">
        ${Object.entries(TEMPLATES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join('')}</select></div>
      <div class="field"><label>담당자 (오너)</label><select id="np-owner">
        ${db.members.map(m => `<option value="${m.id}" ${m.name === store.settings.userName ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
    </div>
    <div class="frow">
      <div class="field"><label>시작일</label><input type="date" id="np-start" value="${todayISO()}"></div>
      <div class="field"><label>예상 기간 <span class="muted" style="font-weight:400">(마지막 단계 D+n으로 자동 계산)</span></label>
        <div><input id="np-dur" type="number" min="3" max="180" value="${TEMPLATES.detail.dur}"> <span class="muted" style="font-size:11px">일</span></div></div>
    </div>
    <div class="field"><label>하위 업무 <span class="muted" style="font-weight:400">(이름·D+n 수정 가능 · 미리보기의 점을 드래그해도 돼요)</span></label>
      <div id="np-preview" class="np-preview"></div>
      <div id="np-steps"></div>
      <button class="btn sm" id="np-addstep" style="margin-top:2px">+ 단계 추가</button>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn" data-close>취소</button>
      <button class="btn primary" id="np-save">프로젝트 생성</button>
    </div>
  `, body => {
    const q = sel => body.querySelector(sel);

    /* ── 예상 기간 = 체크된 단계의 최대 D+n (공통 규칙) ── */
    const syncDur = () => { q('#np-dur').value = maxOff(); drawPreview(); };

    /* ── 미니 간트 미리보기: 점 드래그로 D+n 조정 ── */
    const drawPreview = () => {
      const dur = Math.max(+q('#np-dur').value || maxOff(), maxOff());
      const ticks = [];
      const tickStep = dur > 35 ? 14 : 7;
      for (let d = 0; d <= dur; d += tickStep) ticks.push(`<span class="np-tick" style="left:${d / dur * 100}%">D+${d}</span>`);
      q('#np-preview').innerHTML = `
        <div class="np-track">
          ${ticks.join('')}
          ${steps.map((st, i) => st.on ? `
            <div class="np-dot" data-dot="${i}" style="left:calc(${st.off / dur * 100}% - 7px)" title="${esc(st.name)} · D+${st.off}"></div>
            <span class="np-dot-lb" style="left:calc(${st.off / dur * 100}% - 7px);top:${i % 2 ? 24 : -14}px">${st.off}</span>` : '').join('')}
        </div>`;
      // 점 드래그
      q('#np-preview').querySelectorAll('[data-dot]').forEach(el => {
        el.addEventListener('pointerdown', e => {
          e.preventDefault();
          const i = +el.dataset.dot;
          const track = el.closest('.np-track');
          const pxPerDay = track.getBoundingClientRect().width / dur;
          const startX = e.clientX, orig = steps[i].off;
          el.setPointerCapture(e.pointerId);
          const mv = ev => {
            steps[i].off = Math.max(0, Math.min(180, orig + Math.round((ev.clientX - startX) / pxPerDay)));
            el.style.left = `calc(${steps[i].off / dur * 100}% - 7px)`;
            const row = body.querySelector(`[data-row="${i}"] .st-off`);
            if (row) row.value = steps[i].off;
          };
          const up = () => {
            el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up);
            syncDur();
          };
          el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
        });
      });
    };

    /* ── 단계 행: 체크 + 이름 입력 + D+n 입력 + 삭제 ── */
    const drawRows = () => {
      q('#np-steps').innerHTML = steps.map((st, i) => `
        <div class="tpl-step tpl-edit ${st.on ? '' : 'off'}" data-row="${i}">
          <input type="checkbox" class="st-on" ${st.on ? 'checked' : ''}>
          <input class="st-name" value="${esc(st.name)}" placeholder="단계 이름">
          <span class="st-d">D+</span><input class="st-off" type="number" min="0" max="180" value="${st.off}">
          <button class="st-del" title="단계 삭제">✕</button>
        </div>`).join('')
        || '<div class="empty" style="padding:8px 2px">하위 업무 없이 시작해요. "+ 단계 추가"로 직접 구성할 수 있어요.</div>';
      q('#np-steps').querySelectorAll('[data-row]').forEach(row => {
        const i = +row.dataset.row;
        row.querySelector('.st-on').onchange = e => { steps[i].on = e.target.checked; row.classList.toggle('off', !steps[i].on); syncDur(); };
        row.querySelector('.st-name').onchange = e => { steps[i].name = e.target.value.trim() || steps[i].name; };
        row.querySelector('.st-off').onchange = e => { steps[i].off = Math.max(0, Math.min(180, +e.target.value || 0)); syncDur(); };
        row.querySelector('.st-del').onclick = () => { steps.splice(i, 1); drawRows(); syncDur(); };
      });
    };

    q('#np-type').onchange = e => { loadTpl(e.target.value); drawRows(); syncDur(); };
    q('#np-dur').onchange = () => { q('#np-dur').value = Math.max(+q('#np-dur').value || 3, maxOff()); drawPreview(); };
    q('#np-addstep').onclick = () => {
      steps.push({ name: '새 단계', off: maxOff() + 3, on: true });
      drawRows(); syncDur();
    };
    drawRows(); syncDur();

    q('#np-save').onclick = () => {
      const name = q('#np-name').value.trim();
      if (!name) return toast('프로젝트 이름을 입력해주세요', true);
      const start = q('#np-start').value || todayISO();
      const dur = Math.max(3, +q('#np-dur').value || maxOff(), maxOff());
      const owner = q('#np-owner').value || null;
      const p = { id: uid(), name, color: PALETTE[db.projects.length % PALETTE.length],
                  start, end: addDays(start, dur), owner };
      db.projects.push(p);
      const use = steps.filter(st => st.on && st.name.trim());
      use.forEach(st => {
        db.tasks.push({
          id: uid(), kind: 'project', title: `${name} — ${st.name.trim()}`, project: p.id,
          assignees: owner ? [owner] : [], status: 'req', priority: '중간',
          requester: '', requestedAt: todayISO(), due: addDays(start, st.off),
          link: '', files: [], notes: '', createdAt: new Date().toISOString()
        });
      });
      expanded.add(p.id);
      store.save(); closeModal(); renderTimeline(main);
      toast(`"${name}" 생성 — 하위 업무 ${use.length}건이 일정에 배치됐어요`);
    };
  });
}
