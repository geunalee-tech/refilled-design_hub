/* timeline.js — 프로젝트 타임라인 v2 (마일스톤 매트릭스)
   행: 프로젝트(카테고리) → 하위 업무 / 열: 날짜(좌우 스크롤) / 셀: 컬러 마일스톤 마커.
   - 하위 업무: 담당자 + 진행도(대기중/진행중/완료) + milestones:[{date,typeId}]
   - 마커 종류: 컬러 태그(db.config.timelineMarkers) — 기획전달·1차시안·2차시안·최종시안·발주 기본, 추가/편집/삭제
   - 완료 프로젝트: archived 플래그로 숨김 + 하단 '완료' 섹션에서 검색·복원
   구글시트 운영 패턴을 화면에서 그대로 크로스체크하는 용도. */
import { store, uid, todayISO, addDaysISO, localISO } from '../store.js';
import { esc, toast, openModal, closeModal, $ } from '../ui.js';
import { subTabs } from './tasks.js';

const DAY_W = 30, LAB_W = 264;
const addDays = (iso, n) => addDaysISO(iso, n);
let expanded = new Set();
let lastScrollX = null;
let doneQ = '';   // 완료 프로젝트 검색어

/* ── 진행도 ── */
const TL_STATUS = { wait: { label: '대기중', color: '#9AA1AC' }, doing: { label: '진행중', color: '#D97706' }, done: { label: '완료', color: '#059669' } };
const nextStatus = s => (s === 'wait' ? 'doing' : s === 'doing' ? 'done' : 'wait');

/* ── 마커 종류(컬러 태그) ── */
const MARKER_COLORS = ['#2563EB', '#7C3AED', '#D97706', '#059669', '#DC2626', '#DB2777', '#0891B2', '#6B7280'];
function ensureMarkers() {
  const c = store.db.config || (store.db.config = {});
  if (!Array.isArray(c.timelineMarkers)) c.timelineMarkers = [];
  if (!c.timelineMarkers.length) {
    ['기획전달', '1차시안', '2차시안', '최종시안', '발주'].forEach((n, i) => c.timelineMarkers.push({ id: uid(), name: n, color: MARKER_COLORS[i % MARKER_COLORS.length] }));
    store.save();
  }
  return c.timelineMarkers;
}
const markerById = id => (store.db.config?.timelineMarkers || []).find(m => m.id === id);
function deleteMarkerDef(id) {
  store.db.config.timelineMarkers = (store.db.config.timelineMarkers || []).filter(m => m.id !== id);
  store.db.tasks.forEach(t => (t.milestones || []).forEach(m => { if (m.typeId === id) m.typeId = ''; })); // 삭제 시 중립 마커로
  store.save();
}
/* 구 데이터 정규화: kind:'project' 업무에 milestones/tlStatus 없으면 부여 (due → 마일스톤 1개) */
function migrateProjectTasks() {
  let ch = false;
  store.db.tasks.forEach(t => {
    if (t.kind !== 'project') return;
    if (!Array.isArray(t.milestones)) { t.milestones = t.due ? [{ date: t.due, typeId: '' }] : []; ch = true; }
    if (!t.tlStatus) { t.tlStatus = t.status === 'done' ? 'done' : (t.status === 'req' ? 'wait' : 'doing'); ch = true; }
  });
  if (ch) store.save();
}

/* 마커 칩(캔버스 위 절대배치). typeId '' = 중립(회색·'일정') */
function markerHtml(tid, mi, m) {
  const def = m.typeId ? markerById(m.typeId) : null;
  const color = def ? def.color : '#9AA1AC';
  const name = def ? def.name : '일정';
  return `<div class="tl-ms" data-ms="${tid}:${mi}" title="${esc(name)} · ${m.date}"
    style="position:absolute;top:6px;left:${msLeft(m.date)}px;height:18px;display:flex;align-items:center;padding:0 7px;border-radius:9px;font-size:10px;font-weight:700;white-space:nowrap;cursor:pointer;background:${color}22;color:${color};border:1px solid ${color};z-index:2">${esc(name)}</div>`;
}
let _rangeStart = null;
const msLeft = date => Math.round((new Date(date + 'T00:00:00') - new Date(_rangeStart + 'T00:00:00')) / 864e5) * DAY_W;
/* 마커 드래그 상태(문서 리스너는 렌더마다 교체해 누수 방지) */
let _dragMove = null, _dragUp = null, _lastDragEnd = 0;

export function renderTimeline(main) {
  const db = store.db;
  const today = todayISO();
  ensureMarkers();
  migrateProjectTasks();

  const active = db.projects.filter(p => !p.archived);
  const archived = db.projects.filter(p => p.archived);
  const subOf = pid => db.tasks.filter(t => t.kind === 'project' && t.project === pid);

  /* ── 범위: 마일스톤 최소~최대 + 오늘, 월 경계로 스냅 ── */
  let lo = today;
  const hi3 = new Date(today + 'T00:00:00'); hi3.setMonth(hi3.getMonth() + 3);
  let hi = localISO(hi3); // 오늘로부터 최소 +3개월까지 항상 보이게, 이후는 마일스톤 따라 자동 연장
  db.tasks.forEach(t => { if (t.kind === 'project' && active.some(p => p.id === t.project)) (t.milestones || []).forEach(m => { if (m.date) { if (m.date < lo) lo = m.date; if (m.date > hi) hi = m.date; } }); });
  const rangeStart = lo.slice(0, 8) + '01';
  _rangeStart = rangeStart;
  const hiD = new Date(hi + 'T00:00:00'); hiD.setMonth(hiD.getMonth() + 1, 0);
  const rangeEnd = localISO(hiD);
  const idx = iso => Math.round((new Date(iso + 'T00:00:00') - new Date(rangeStart + 'T00:00:00')) / 864e5);
  const totalDays = idx(rangeEnd) + 1;
  const W = totalDays * DAY_W;
  const px = iso => idx(iso) * DAY_W;

  /* ── 헤더(월/일) + 배경(주말·월경계·오늘) ── */
  const monthCells = [], dayCells = [];
  let mStart = 0, mLabel = '';
  for (let i = 0; i <= totalDays; i++) {
    const iso = i < totalDays ? addDays(rangeStart, i) : null;
    const lb = iso ? `${+iso.slice(0, 4)}년 ${+iso.slice(5, 7)}월` : '';
    if (lb !== mLabel) { if (mLabel) monthCells.push(`<div class="t2-m" style="left:${mStart * DAY_W}px;width:${(i - mStart) * DAY_W}px">${mLabel}</div>`); mStart = i; mLabel = lb; }
    if (!iso) break;
    const dow = new Date(iso + 'T00:00:00').getDay();
    const cls = iso === today ? 'today' : dow === 0 ? 'sun' : dow === 6 ? 'sat' : '';
    dayCells.push(`<div class="t2-d ${cls}" style="left:${i * DAY_W}px;width:${DAY_W}px">${iso === today ? '오늘' : +iso.slice(8)}</div>`);
  }
  const satOff = (6 - new Date(rangeStart + 'T00:00:00').getDay() + 7) % 7;
  const wkndBg = `background-image:repeating-linear-gradient(90deg,rgba(120,120,120,.075) 0 ${2 * DAY_W}px,transparent ${2 * DAY_W}px ${7 * DAY_W}px);background-position:${satOff * DAY_W}px 0`;
  let lines = `<span class="t2-todaycol" style="left:${px(today)}px;width:${DAY_W}px"></span><span class="t2-todayline" style="left:${px(today) + DAY_W / 2}px"></span>`;
  for (let i = 1; i < totalDays; i++) if (addDays(rangeStart, i).endsWith('-01')) lines += `<span class="t2-mline" style="left:${i * DAY_W}px"></span>`;

  /* ── 프로젝트 행 ── */
  const rows = active.map(p => {
    const subs = subOf(p.id);
    const isOpen = expanded.has(p.id);
    const doneCnt = subs.filter(t => t.tlStatus === 'done').length;
    const subRows = isOpen ? subs.map(t => {
      const st = TL_STATUS[t.tlStatus] || TL_STATUS.wait;
      return `<div class="t2-row t2-taskrow" data-tid="${t.id}">
        <div class="t2-lab t2-tlab">
          <span title="진행도: ${st.label} (클릭해 변경)" data-stcycle="${t.id}" style="width:10px;height:10px;border-radius:50%;background:${st.color};flex-shrink:0;cursor:pointer"></span>
          <div class="t2-lab-main">
            <span class="tt" data-editsub="${t.id}" title="클릭해 수정">${esc(t.title)}</span>
            <span class="t2-meta">${st.label}${(t.assignees || []).length ? ' · ' + esc(store.assigneeNames(t)) : ''}</span>
          </div>
          <button class="tl-x" data-delsub="${t.id}" title="하위 업무 삭제">✕</button>
        </div>
        <div class="t2-canvas tl-cv" data-addms="${t.id}" title="빈 칸을 클릭하면 그 날짜에 마커를 추가해요" style="width:${W}px;${wkndBg};cursor:copy">
          ${lines}
          ${(t.milestones || []).length ? '' : `<span style="position:absolute;left:${px(today) + DAY_W + 6}px;top:8px;font-size:10px;color:#B8BEC8;pointer-events:none;white-space:nowrap">← 빈 칸을 클릭해 마커 추가</span>`}
          ${(t.milestones || []).map((m, mi) => markerHtml(t.id, mi, m)).join('')}
        </div>
      </div>`;
    }).join('') + `<div class="t2-row t2-addrow">
        <div class="t2-lab"><button class="btn sm" data-addsub="${p.id}">+ 하위 업무 추가</button></div>
        <div class="t2-canvas" style="width:${W}px"></div>
      </div>` : '';

    return `<div class="t2-proj" data-pid="${p.id}">
      <div class="t2-row">
        <div class="t2-lab">
          <button class="tl-toggle ${isOpen ? 'open' : ''}" data-toggle="${p.id}">▸</button>
          <div class="t2-lab-main">
            <span class="pn2 pn2-click" data-editproj="${p.id}" title="클릭해 이름·담당자 수정">${esc(p.name)}</span>
            <span class="t2-meta">${esc(store.memberName(p.owner))} · 하위 ${subs.length}건${doneCnt ? ` · 완료 ${doneCnt}` : ''}</span>
          </div>
          <button class="btn sm" data-doneproj="${p.id}" title="완료 처리(숨김)" style="flex-shrink:0">완료</button>
        </div>
        <div class="t2-canvas" style="width:${W}px;${wkndBg}">${lines}${(() => {
          const ms = subs.flatMap(t => (t.milestones || []).map(m => m.date)).filter(Boolean).sort();
          if (!ms.length) return '';
          const l = idx(ms[0]) * DAY_W, w = Math.max(DAY_W, (idx(ms[ms.length - 1]) - idx(ms[0]) + 1) * DAY_W);
          return `<div title="전체 기간 ${ms[0]} ~ ${ms[ms.length - 1]}" style="position:absolute;top:15px;left:${l}px;width:${w}px;height:7px;border-radius:4px;background:${(p.color || '#9AA1AC')}33"></div>`;
        })()}</div>
      </div>
      ${subRows}
    </div>`;
  }).join('') || '<div class="empty" style="padding:30px">진행 중인 프로젝트가 없어요. 오른쪽 위 버튼으로 추가해주세요.</div>';

  /* ── 완료 프로젝트 섹션 ── */
  const doneList = archived
    .filter(p => !doneQ || p.name.toLowerCase().includes(doneQ.toLowerCase()))
    .sort((a, b) => String(b.archivedAt || '').localeCompare(String(a.archivedAt || '')))
    .map(p => `<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--line);border-radius:9px;margin-bottom:6px">
      <b style="flex:1">${esc(p.name)}</b>
      <span class="muted" style="font-size:11px">하위 ${subOf(p.id).length}건 · ${esc(store.memberName(p.owner))}${p.archivedAt ? ' · 완료 ' + p.archivedAt.slice(0, 10) : ''}</span>
      <button class="btn sm" data-unarch="${p.id}">되돌리기</button>
    </div>`).join('') || `<div class="empty" style="padding:12px">${doneQ ? '검색 결과가 없어요' : '완료 처리된 프로젝트가 없어요'}</div>`;

  main.innerHTML = `
  <div class="page-head"><span class="eyebrow">Task Stream</span>
    <h1>업무 보드</h1><p>팀 내부 프로젝트를 하위 업무 · 날짜별 마일스톤으로 크로스체크해요. 빈 칸 클릭 = 마커 추가, 마커 클릭 = 변경/삭제.</p></div>
  ${subTabs('projects')}
  <div class="board-bar">
    <button class="btn sm" id="tl-today">📍 오늘로 이동</button>
    <button class="btn sm" id="tl-markers">🏷 마커 관리</button>
    <span class="muted" style="font-size:11.5px">${rangeStart} ~ ${rangeEnd} · 좌우로 스크롤</span>
    <span style="flex:1"></span>
    <button class="btn primary" id="tl-addproj">+ 프로젝트 추가</button>
  </div>
  <div class="card" style="padding:0;overflow:hidden">
    <div class="t2-scroll" id="t2-scroll">
      <div class="t2-inner" style="width:${LAB_W + W}px;position:relative">
        <div id="tl-hovcol" style="position:absolute;top:0;height:100%;width:${DAY_W}px;background:rgba(0,109,226,.07);border-left:1px solid rgba(0,109,226,.28);border-right:1px solid rgba(0,109,226,.28);pointer-events:none;display:none;z-index:1"></div>
        <div id="tl-hovdate" style="position:absolute;top:3px;transform:translateX(-50%);background:#006DE2;color:#fff;font-size:10px;font-weight:700;padding:1px 7px;border-radius:7px;pointer-events:none;display:none;z-index:6;white-space:nowrap"></div>
        <div class="t2-row t2-head">
          <div class="t2-lab t2-corner"></div>
          <div class="t2-canvas t2-headcv" style="width:${W}px">
            ${monthCells.join('')}<div class="t2-days">${dayCells.join('')}</div>
          </div>
        </div>
        <div id="tl-body">${rows}</div>
      </div>
    </div>
  </div>
  <details class="card" style="margin-top:16px" ${doneQ ? 'open' : ''}><summary style="cursor:pointer;font-weight:700;padding:4px 2px">완료 프로젝트 <span class="muted" style="font-weight:400">${archived.length}건</span></summary>
    <div style="margin-top:10px">
      <input id="tl-doneq" placeholder="완료 프로젝트 이름 검색" value="${esc(doneQ)}" style="border:1px solid var(--line);border-radius:8px;padding:7px 11px;width:260px;margin-bottom:10px">
      ${doneList}
    </div>
  </details>`;

  /* ── 스크롤 ── */
  const sc = $('#t2-scroll');
  sc.scrollLeft = lastScrollX === null ? Math.max(0, px(today) - DAY_W * 6) : lastScrollX;
  sc.addEventListener('scroll', () => { lastScrollX = sc.scrollLeft; }, { passive: true });
  $('#tl-today').onclick = () => sc.scrollTo({ left: Math.max(0, px(today) - DAY_W * 6), behavior: 'smooth' });
  $('#tl-addproj').onclick = () => addProject(main);
  $('#tl-markers').onclick = () => manageMarkers(main);

  /* ── 프로젝트 토글/편집/완료 ── */
  main.querySelectorAll('[data-toggle]').forEach(b => b.onclick = () => { const id = b.dataset.toggle; expanded.has(id) ? expanded.delete(id) : expanded.add(id); renderTimeline(main); });
  main.querySelectorAll('[data-editproj]').forEach(el => el.onclick = () => editProject(main, el.dataset.editproj));
  main.querySelectorAll('[data-doneproj]').forEach(b => b.onclick = () => {
    const p = db.projects.find(x => x.id === b.dataset.doneproj);
    if (!confirm(`"${p.name}"를 완료 처리할까요? 목록에서 숨겨지고, 아래 '완료 프로젝트'에서 다시 볼 수 있어요.`)) return;
    p.archived = true; p.archivedAt = new Date().toISOString(); store.save(); renderTimeline(main); toast('완료 처리했어요');
  });
  main.querySelectorAll('[data-unarch]').forEach(b => b.onclick = () => {
    const p = db.projects.find(x => x.id === b.dataset.unarch); p.archived = false; delete p.archivedAt;
    store.save(); renderTimeline(main); toast('되돌렸어요');
  });
  $('#tl-doneq').oninput = e => { doneQ = e.target.value; renderTimeline(main); };

  /* ── 하위 업무 추가/삭제/수정, 진행도 ── */
  main.querySelectorAll('[data-addsub]').forEach(b => b.onclick = () => addSubtask(main, b.dataset.addsub));
  main.querySelectorAll('[data-delsub]').forEach(b => b.onclick = () => {
    const t = db.tasks.find(x => x.id === b.dataset.delsub);
    if (!confirm(`"${t.title}" 하위 업무를 삭제할까요?`)) return;
    db.tasks = db.tasks.filter(x => x.id !== b.dataset.delsub); store.save(); renderTimeline(main); toast('삭제했어요');
  });
  main.querySelectorAll('[data-editsub]').forEach(el => el.onclick = () => editSubtask(main, el.dataset.editsub));
  main.querySelectorAll('[data-stcycle]').forEach(el => el.onclick = () => {
    const t = db.tasks.find(x => x.id === el.dataset.stcycle); t.tlStatus = nextStatus(t.tlStatus || 'wait');
    store.save(); renderTimeline(main);
  });

  /* ── 마일스톤: 마커 클릭=수정, 빈 칸 클릭=추가 (드래그 직후 클릭은 무시) ── */
  main.querySelectorAll('[data-addms]').forEach(cv => cv.onclick = e => {
    if (Date.now() - _lastDragEnd < 200) return; // 방금 드래그로 옮긴 경우
    const ms = e.target.closest('[data-ms]');
    if (ms) { const [tid, mi] = ms.dataset.ms.split(':'); return editMilestone(main, tid, +mi); }
    const rect = cv.getBoundingClientRect();
    const day = Math.floor((e.clientX - rect.left) / DAY_W);
    if (day < 0 || day >= totalDays) return;
    addMilestone(main, cv.dataset.addms, addDays(rangeStart, day));
  });

  /* ── 호버: 마우스가 있는 날짜 열을 하이라이트 + 상단에 날짜 표시 ── */
  const inner = main.querySelector('.t2-inner');
  const hovcol = $('#tl-hovcol'), hovdate = $('#tl-hovdate');
  const showHover = day => {
    const left = LAB_W + day * DAY_W;
    hovcol.style.left = left + 'px'; hovcol.style.display = 'block';
    const d = addDays(rangeStart, day);
    hovdate.textContent = `${+d.slice(5, 7)}/${+d.slice(8)}`;
    hovdate.style.left = (left + DAY_W / 2) + 'px'; hovdate.style.display = 'block';
  };
  const hideHover = () => { hovcol.style.display = 'none'; hovdate.style.display = 'none'; };
  inner.addEventListener('mousemove', e => {
    if (drag) return; // 드래그 중엔 드래그 핸들러가 하이라이트를 갱신
    const r = inner.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (x < LAB_W || x >= LAB_W + W) return hideHover();
    showHover(Math.floor((x - LAB_W) / DAY_W));
  });
  inner.addEventListener('mouseleave', () => { if (!drag) hideHover(); });

  /* ── 마커 드래그로 날짜 이동 ── */
  if (_dragMove) { document.removeEventListener('mousemove', _dragMove); document.removeEventListener('mouseup', _dragUp); }
  let drag = null;
  main.querySelectorAll('.tl-ms').forEach(el => el.addEventListener('mousedown', e => {
    e.preventDefault(); e.stopPropagation();
    drag = { el, ms: el.dataset.ms, startX: e.clientX, origLeft: parseFloat(el.style.left) || 0, moved: false };
    el.style.zIndex = 10; el.style.opacity = '.85'; el.style.cursor = 'grabbing';
  }));
  _dragMove = e => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    if (Math.abs(dx) > 3) drag.moved = true;
    const day = Math.max(0, Math.min(totalDays - 1, Math.round((drag.origLeft + dx) / DAY_W)));
    drag.el.style.left = day * DAY_W + 'px';
    showHover(day);
  };
  _dragUp = () => {
    if (!drag) return;
    const d = drag; drag = null;
    d.el.style.opacity = ''; d.el.style.cursor = '';
    hideHover();
    if (!d.moved) { d.el.style.zIndex = 2; return; } // 순수 클릭 → 클릭 핸들러가 처리
    _lastDragEnd = Date.now();
    const [tid, mi] = d.ms.split(':');
    const day = Math.max(0, Math.min(totalDays - 1, Math.round((parseFloat(d.el.style.left) || 0) / DAY_W)));
    const t = store.db.tasks.find(x => x.id === tid);
    if (t && t.milestones && t.milestones[+mi]) { t.milestones[+mi].date = addDays(rangeStart, day); store.save(); toast(`마커를 ${addDays(rangeStart, day).slice(5)}로 옮겼어요`); }
    renderTimeline(main);
  };
  document.addEventListener('mousemove', _dragMove);
  document.addEventListener('mouseup', _dragUp);
}

/* ── 마일스톤 추가/수정 ── */
function markerPickerHtml(markers, activeId) {
  return markers.map(m => `<button data-mk="${m.id}" style="cursor:pointer;border:1.5px solid ${activeId === m.id ? m.color : 'transparent'};background:${m.color}22;color:${m.color};border-radius:999px;padding:5px 12px;font-size:12.5px;font-weight:700">${esc(m.name)}</button>`).join('');
}
function addMilestone(main, tid, date) {
  const t = store.db.tasks.find(x => x.id === tid); if (!t) return;
  const markers = ensureMarkers();
  openModal(`<h2>${date} · 마커 추가</h2>
    <p class="hint" style="margin-top:0">이 날짜에 표시할 단계를 골라주세요.</p>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 16px">${markerPickerHtml(markers)}</div>
    <div style="display:flex;justify-content:space-between;align-items:center">
      <button class="btn sm" id="mk-manage">🏷 마커 관리</button>
      <button class="btn" data-close>취소</button></div>`, body => {
    body.querySelectorAll('[data-mk]').forEach(b => b.onclick = () => { (t.milestones = t.milestones || []).push({ date, typeId: b.dataset.mk }); store.save(); closeModal(); renderTimeline(main); });
    body.querySelector('#mk-manage').onclick = () => { closeModal(); manageMarkers(main); };
  });
}
function editMilestone(main, tid, mi) {
  const t = store.db.tasks.find(x => x.id === tid); if (!t || !t.milestones?.[mi]) return;
  const m = t.milestones[mi]; const markers = ensureMarkers();
  openModal(`<h2>마커 변경 · ${m.date}</h2>
    <div class="field"><label>날짜</label><input type="date" id="ms-date" value="${m.date}"></div>
    <div class="field"><label>단계</label><div style="display:flex;flex-wrap:wrap;gap:8px">${markerPickerHtml(markers, m.typeId)}</div></div>
    <div style="display:flex;justify-content:space-between;align-items:center">
      <button class="btn danger" id="ms-del">삭제</button>
      <span style="display:flex;gap:8px"><button class="btn" data-close>취소</button><button class="btn primary" id="ms-save">저장</button></span></div>`, body => {
    let typeId = m.typeId;
    body.querySelectorAll('[data-mk]').forEach(b => b.onclick = () => {
      typeId = b.dataset.mk;
      body.querySelectorAll('[data-mk]').forEach(x => x.style.borderColor = 'transparent');
      const d = markerById(typeId); b.style.borderColor = d ? d.color : '#999';
    });
    body.querySelector('#ms-save').onclick = () => { m.typeId = typeId; m.date = body.querySelector('#ms-date').value || m.date; store.save(); closeModal(); renderTimeline(main); };
    body.querySelector('#ms-del').onclick = () => { t.milestones.splice(mi, 1); store.save(); closeModal(); renderTimeline(main); toast('마커를 삭제했어요'); };
  });
}

/* ── 하위 업무 추가/수정 ── */
function subForm(t) {
  const db = store.db;
  return `<div class="field"><label>업무 이름</label><input id="st-title" value="${esc(t.title || '')}" placeholder="예: 상세페이지 · 용기 · 썸네일"></div>
    <div class="frow">
      <div class="field"><label>담당자</label><select id="st-owner"><option value="">미지정</option>
        ${db.members.map(m => `<option value="${m.id}" ${(t.assignees || [])[0] === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
      <div class="field"><label>진행도</label><select id="st-status">
        ${Object.entries(TL_STATUS).map(([k, v]) => `<option value="${k}" ${(t.tlStatus || 'wait') === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
    </div>`;
}
function addSubtask(main, pid) {
  const p = store.db.projects.find(x => x.id === pid); if (!p) return;
  openModal(`<h2>하위 업무 추가 — ${esc(p.name)}</h2>${subForm({})}
    <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" data-close>취소</button><button class="btn primary" id="st-save">추가</button></div>`, body => {
    body.querySelector('#st-save').onclick = () => {
      const title = body.querySelector('#st-title').value.trim(); if (!title) return toast('업무 이름을 입력해주세요', true);
      const owner = body.querySelector('#st-owner').value;
      store.db.tasks.push({ id: uid(), kind: 'project', title, project: pid, assignees: owner ? [owner] : [], tlStatus: body.querySelector('#st-status').value || 'wait', milestones: [], priority: '중간', requester: '', requestedAt: todayISO(), due: '', link: '', files: [], notes: '', createdAt: new Date().toISOString() });
      expanded.add(pid); store.save(); closeModal(); renderTimeline(main); toast('하위 업무를 추가했어요');
    };
  });
}
function editSubtask(main, tid) {
  const t = store.db.tasks.find(x => x.id === tid); if (!t) return;
  openModal(`<h2>하위 업무 수정</h2>${subForm(t)}
    <div style="display:flex;gap:8px;justify-content:space-between"><button class="btn danger" id="st-del">삭제</button>
      <span style="display:flex;gap:8px"><button class="btn" data-close>취소</button><button class="btn primary" id="st-save">저장</button></span></div>`, body => {
    body.querySelector('#st-save').onclick = () => {
      const title = body.querySelector('#st-title').value.trim(); if (!title) return toast('업무 이름을 입력해주세요', true);
      const owner = body.querySelector('#st-owner').value;
      t.title = title; t.assignees = owner ? [owner] : []; t.tlStatus = body.querySelector('#st-status').value || 'wait';
      store.save(); closeModal(); renderTimeline(main); toast('저장했어요');
    };
    body.querySelector('#st-del').onclick = () => { if (!confirm(`"${t.title}" 하위 업무를 삭제할까요?`)) return; store.db.tasks = store.db.tasks.filter(x => x.id !== tid); store.save(); closeModal(); renderTimeline(main); toast('삭제했어요'); };
  });
}

/* ── 프로젝트 추가/수정 ── */
const PALETTE = ['#006DE2', '#0F7B5F', '#B7791F', '#6B5CA5', '#8A3B5E', '#3B7A8A'];
function projForm(p) {
  const db = store.db;
  return `<div class="field"><label>프로젝트 이름</label><input id="pj-name" value="${esc(p.name || '')}" placeholder="예: [리브랜딩] 부스터 프로+리필+미니"></div>
    <div class="field"><label>담당자 (오너)</label><select id="pj-owner"><option value="">미지정</option>
      ${db.members.map(m => `<option value="${m.id}" ${p.owner === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>`;
}
/* 마커 이름 → id (없으면 생성). 템플릿의 대략 일정 산출에 사용 */
function ensureMarkerByName(name) {
  const arr = ensureMarkers(); let m = arr.find(x => x.name === name);
  if (!m) { m = { id: uid(), name, color: MARKER_COLORS[arr.length % MARKER_COLORS.length] }; arr.push(m); }
  return m.id;
}
/* 프로젝트 성격별 템플릿 (하위 업무 + 항목별 마일스톤 D+n) — 편집/삭제 가능한 초안 */
const TEMPLATES = {
  detail: { label: '상세페이지', subs: [{ name: '상세페이지', ms: [['기획전달', 0], ['1차시안', 8], ['2차시안', 18], ['최종시안', 28]] }] },
  pkg: { label: '패키지 (용기·단상자)', subs: [
    { name: '용기', ms: [['기획전달', 0], ['1차시안', 12], ['2차시안', 26], ['최종시안', 40], ['발주', 48]] },
    { name: '단상자', ms: [['기획전달', 0], ['1차시안', 14], ['2차시안', 28], ['최종시안', 42], ['발주', 50]] },
  ] },
  content: { label: '콘텐츠 (누끼컷·썸네일)', subs: [
    { name: '누끼컷', ms: [['기획전달', 0], ['최종시안', 6]] },
    { name: '썸네일', ms: [['기획전달', 2], ['1차시안', 8], ['최종시안', 14]] },
  ] },
  banner: { label: '배너·프로모션', subs: [{ name: '배너', ms: [['기획전달', 0], ['1차시안', 4], ['2차시안', 8], ['최종시안', 12]] }] },
  gwp: { label: '기획세트·GWP', subs: [
    { name: '용기', ms: [['기획전달', 0], ['1차시안', 8], ['최종시안', 20], ['발주', 30]] },
    { name: '상세페이지', ms: [['기획전달', 4], ['1차시안', 14], ['최종시안', 26]] },
  ] },
  blank: { label: '빈 프로젝트 (직접 구성)', subs: [] },
};

function addProject(main) {
  const db = store.db; ensureMarkers();
  const today = todayISO();
  let subs = []; // [{name, owner, ms:[{markerId, off}]}]
  const loadTpl = key => { subs = (TEMPLATES[key]?.subs || []).map(s => ({ name: s.name, owner: '', ms: s.ms.map(([mk, off]) => ({ markerId: ensureMarkerByName(mk), off })) })); };
  loadTpl('detail');
  const markers = () => store.db.config.timelineMarkers || [];
  const mkName = id => (markers().find(m => m.id === id) || {}).name || '?';

  openModal(`
    <h2>프로젝트 추가</h2>
    <div class="field"><label>프로젝트 이름</label><input id="pj-name" placeholder="예: [리브랜딩] 부스터 프로+리필+미니"></div>
    <div class="frow">
      <div class="field"><label>담당자 (오너)</label><select id="pj-owner"><option value="">미지정</option>
        ${db.members.map(m => `<option value="${m.id}" ${m.name === store.settings.userName ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
      <div class="field"><label>기준 시작일 <span class="muted" style="font-weight:400">(D+n 계산 기준)</span></label><input type="date" id="pj-base" value="${today}"></div>
      <div class="field"><label>템플릿</label><select id="pj-tpl">${Object.entries(TEMPLATES).map(([k, t]) => `<option value="${k}" ${k === 'detail' ? 'selected' : ''}>${t.label}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label>하위 업무 · 대략 일정 <span class="muted" style="font-weight:400">(항목별 마일스톤을 D+n으로 미리 배치 · 나중에 매트릭스에서 날짜 조정)</span></label>
      <div id="pj-subs"></div>
      <button class="btn sm" id="pj-addsub" style="margin-top:4px">+ 하위 업무</button></div>
    <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" data-close>취소</button><button class="btn primary" id="pj-save">생성</button></div>
  `, body => {
    const q = s => body.querySelector(s);
    const drawSubs = () => {
      q('#pj-subs').innerHTML = subs.map((s, i) => `
        <div class="pj-sub" data-si="${i}" style="border:1px solid var(--line);border-radius:9px;padding:8px 10px;margin-bottom:6px">
          <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
            <input class="ps-name" value="${esc(s.name)}" placeholder="하위 업무명" style="flex:1">
            <select class="ps-owner"><option value="">담당 미지정</option>${db.members.map(m => `<option value="${m.id}" ${s.owner === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
            <button class="btn sm danger ps-del">✕</button>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center">
            ${s.ms.map((m, mi) => { const c = (markers().find(x => x.id === m.markerId) || {}).color || '#9AA1AC'; return `<span style="background:${c}22;color:${c};border-radius:999px;padding:2px 8px;font-size:11px;font-weight:700">${esc(mkName(m.markerId))} D+${m.off} <button class="ps-msdel" data-mi="${mi}" style="background:none;border:none;color:inherit;cursor:pointer;padding:0">✕</button></span>`; }).join('')}
            <select class="ps-newmk" style="font-size:11px">${markers().map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select>
            <span style="font-size:11px">D+</span><input class="ps-newoff" type="number" min="0" value="0" style="width:52px">
            <button class="btn sm ps-msadd">+ 마일스톤</button>
          </div>
        </div>`).join('') || '<div class="empty" style="padding:8px 2px">하위 업무 없이 시작해요. "+ 하위 업무"로 추가하세요.</div>';
      q('#pj-subs').querySelectorAll('[data-si]').forEach(row => {
        const i = +row.dataset.si;
        row.querySelector('.ps-name').onchange = e => subs[i].name = e.target.value;
        row.querySelector('.ps-owner').onchange = e => subs[i].owner = e.target.value;
        row.querySelector('.ps-del').onclick = () => { subs.splice(i, 1); drawSubs(); };
        row.querySelectorAll('.ps-msdel').forEach(b => b.onclick = () => { subs[i].ms.splice(+b.dataset.mi, 1); drawSubs(); });
        row.querySelector('.ps-msadd').onclick = () => { subs[i].ms.push({ markerId: row.querySelector('.ps-newmk').value, off: Math.max(0, +row.querySelector('.ps-newoff').value || 0) }); subs[i].ms.sort((a, b) => a.off - b.off); drawSubs(); };
      });
    };
    q('#pj-tpl').onchange = e => { loadTpl(e.target.value); drawSubs(); };
    q('#pj-addsub').onclick = () => { subs.push({ name: '새 업무', owner: '', ms: [] }); drawSubs(); };
    drawSubs();

    q('#pj-save').onclick = () => {
      const name = q('#pj-name').value.trim(); if (!name) return toast('프로젝트 이름을 입력해주세요', true);
      const base = q('#pj-base').value || today, owner = q('#pj-owner').value || null;
      const p = { id: uid(), name, color: PALETTE[db.projects.length % PALETTE.length], owner };
      db.projects.push(p);
      const use = subs.filter(s => s.name.trim());
      use.forEach(s => db.tasks.push({
        id: uid(), kind: 'project', title: s.name.trim(), project: p.id, assignees: s.owner ? [s.owner] : [], tlStatus: 'wait',
        milestones: s.ms.map(m => ({ date: addDays(base, m.off), typeId: m.markerId })).sort((a, b) => (a.date < b.date ? -1 : 1)),
        priority: '중간', requester: '', requestedAt: today, due: '', link: '', files: [], notes: '', createdAt: new Date().toISOString(),
      }));
      expanded.add(p.id); store.save(); closeModal(); renderTimeline(main);
      toast(`"${name}" 생성 — 하위 업무 ${use.length}건 배치`);
    };
  });
}
function editProject(main, pid) {
  const p = store.db.projects.find(x => x.id === pid); if (!p) return;
  openModal(`<h2>프로젝트 수정</h2>${projForm(p)}
    <div style="display:flex;gap:8px;justify-content:space-between"><button class="btn danger" id="pj-del">삭제</button>
      <span style="display:flex;gap:8px"><button class="btn" data-close>취소</button><button class="btn primary" id="pj-save">저장</button></span></div>`, body => {
    body.querySelector('#pj-save').onclick = () => {
      const name = body.querySelector('#pj-name').value.trim(); if (!name) return toast('이름을 입력해주세요', true);
      p.name = name; p.owner = body.querySelector('#pj-owner').value || null; store.save(); closeModal(); renderTimeline(main); toast('저장했어요');
    };
    body.querySelector('#pj-del').onclick = () => {
      const cnt = store.db.tasks.filter(t => t.project === pid).length;
      if (!confirm(`"${p.name}" 프로젝트를 삭제할까요?${cnt ? `\n하위 업무 ${cnt}건도 함께 삭제돼요.` : ''}`)) return;
      store.db.projects = store.db.projects.filter(x => x.id !== pid);
      store.db.tasks = store.db.tasks.filter(t => t.project !== pid);
      store.save(); closeModal(); renderTimeline(main); toast('삭제했어요');
    };
  });
}

/* ── 마커 종류 관리 (아카이브 태그 관리와 동일 패턴) ── */
function manageMarkers(main) {
  const rowsHtml = () => ensureMarkers().map(m => `
    <div data-mkrow="${m.id}" style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <span style="background:${m.color}22;color:${m.color};border-radius:999px;padding:2px 10px;font-size:11px;font-weight:700">${esc(m.name)}</span>
      <input class="mk-name" value="${esc(m.name)}" style="flex:1;border:1px solid var(--line);border-radius:7px;padding:5px 8px;font-size:12.5px">
      <div style="display:flex;gap:3px">${MARKER_COLORS.map(c => `<button data-color="${c}" style="width:17px;height:17px;border-radius:50%;background:${c};border:${m.color === c ? '2px solid var(--fg,#111)' : '1px solid #ccc'};cursor:pointer;padding:0"></button>`).join('')}</div>
      <button class="btn sm danger" data-mkdel="${m.id}">삭제</button>
    </div>`).join('') || '<div class="empty" style="padding:8px">마커가 없어요</div>';
  openModal(`<h2>마일스톤 마커 관리</h2>
    <p class="hint" style="margin-top:0">이름·색을 바꾸면 모든 마커에 바로 반영돼요. 삭제하면 그 마커는 '일정'(중립)으로 바뀝니다.</p>
    <div id="mk-mgr">${rowsHtml()}</div>
    <div style="display:flex;gap:6px;margin-top:10px"><input id="mk-new" placeholder="새 마커 이름" style="flex:1;border:1px solid var(--line);border-radius:8px;padding:7px 10px"><button class="btn" id="mk-add">+ 추가</button></div>
    <div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="btn primary" id="mk-done">완료</button></div>`, body => {
    const rebind = () => { body.querySelector('#mk-mgr').innerHTML = rowsHtml(); bind(); };
    function bind() {
      body.querySelectorAll('[data-mkrow]').forEach(row => {
        const m = markerById(row.dataset.mkrow); if (!m) return;
        row.querySelector('.mk-name').onchange = e => { const n = e.target.value.trim(); if (n) { m.name = n; store.save(); rebind(); } };
        row.querySelectorAll('[data-color]').forEach(b => b.onclick = () => { m.color = b.dataset.color; store.save(); rebind(); });
        row.querySelector('[data-mkdel]').onclick = () => { if (!confirm(`마커 "${m.name}"를 삭제할까요?\n이 마커로 찍힌 일정은 '일정'(중립)으로 바뀌어요.`)) return; deleteMarkerDef(m.id); rebind(); };
      });
    }
    body.querySelector('#mk-add').onclick = () => { const el = body.querySelector('#mk-new'); const n = el.value.trim(); if (!n) return; ensureMarkers().push({ id: uid(), name: n, color: MARKER_COLORS[ensureMarkers().length % MARKER_COLORS.length] }); el.value = ''; store.save(); rebind(); };
    body.querySelector('#mk-done').onclick = () => { closeModal(); renderTimeline(main); };
    bind();
  });
}
