/* timeline.js — 프로젝트 타임라인 (드래그로 일정 조정 + 하위 업무 관리) */
import { store, uid, todayISO } from '../store.js';
import { esc, toast, dday, STATUS, openModal, closeModal, $ } from '../ui.js';
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
          <span class="ta">${t.due ? `<b class="td ${t.due < today && t.status !== 'done' ? 'over' : ''}">${t.due.slice(5).replace('-', '/')} · ${dday(t.due)}</b>` : ''} ${esc(store.assigneeNames(t))}</span>
          <button class="tl-x" data-deltask="${t.id}" title="업무 삭제">✕</button>
        </div>
        <div class="g-track tl-ttrack">
          ${t.due ? `<div class="g-due" data-drag="due" data-tid="${t.id}" style="left:calc(${pctL(t.due)}% - 7px)" title="${t.due} · 드래그로 마감일 조정"></div><span class="g-due-lb" style="left:calc(${pctL(t.due)}% + 11px)">${t.due.slice(5).replace('-', '/')}</span>` : '<span class="tl-nodue">마감일 없음</span>'}
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
          <span class="pm">${(p.start || '').slice(5).replace('-', '/')} ~ ${(p.end || '').slice(5).replace('-', '/')} · ${esc(store.memberName(p.owner))} · ${tasks.length}건</span>
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
