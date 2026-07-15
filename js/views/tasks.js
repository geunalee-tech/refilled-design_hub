/* tasks.js — 업무 보드 (칸반) */
import { store, uid, todayISO } from '../store.js';
import { esc, openModal, closeModal, toast, dday, STATUS, $ } from '../ui.js';

const ORDER = ['inbox', 'todo', 'doing', 'blocked', 'done'];
const NEXT = { inbox: 'todo', todo: 'doing', doing: 'done', blocked: 'doing', done: null };

let filter = { assignee: '', project: '' };

export function renderTasks(main) {
  const db = store.db;
  let tasks = db.tasks;
  if (filter.assignee) tasks = tasks.filter(t => t.assignee === filter.assignee);
  if (filter.project) tasks = tasks.filter(t => t.project === filter.project);

  const cols = ORDER.map(st => {
    const list = tasks.filter(t => t.status === st)
      .sort((a, b) => (a.due || '9') < (b.due || '9') ? -1 : 1);
    return `<div class="kb-col">
      <div class="kb-col-h">${STATUS[st].label}<span class="cnt">${list.length}</span></div>
      ${list.map(t => card(t)).join('')}
    </div>`;
  }).join('');

  main.innerHTML = `
  <div class="page-head"><span class="eyebrow">Task Stream</span>
    <h1>업무 보드</h1><p>타팀 요청은 "인입 요청"으로 받고, 수락하면 팀 업무 흐름에 합류해요.</p></div>
  <div class="board-bar">
    <button class="btn primary" id="new-task">+ 업무 추가</button>
    <button class="btn" id="new-request">타팀 요청 받기</button>
    <select id="f-assignee"><option value="">담당자 전체</option>
      ${db.members.map(m => `<option value="${m.id}" ${filter.assignee === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
    <select id="f-project"><option value="">프로젝트 전체</option>
      ${db.projects.map(p => `<option value="${p.id}" ${filter.project === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <span style="flex:1"></span>
    <button class="btn sm" id="mng-project">프로젝트 관리</button>
  </div>
  <div class="kanban">${cols}</div>`;

  $('#new-task').onclick = () => editTask(null, false);
  $('#new-request').onclick = () => editTask(null, true);
  $('#f-assignee').onchange = e => { filter.assignee = e.target.value; renderTasks(main); };
  $('#f-project').onchange = e => { filter.project = e.target.value; renderTasks(main); };
  $('#mng-project').onclick = manageProjects;

  main.querySelectorAll('[data-task]').forEach(el => {
    el.onclick = e => {
      if (e.target.matches('[data-move]')) {
        const t = store.db.tasks.find(x => x.id === el.dataset.task);
        t.status = e.target.dataset.move; store.save(); renderTasks(main);
      } else editTask(el.dataset.task);
    };
  });
}

function card(t) {
  const over = t.due && t.due < todayISO() && t.status !== 'done';
  const moves = [];
  if (NEXT[t.status]) moves.push(`<button data-move="${NEXT[t.status]}">${STATUS[NEXT[t.status]].label} →</button>`);
  if (t.status !== 'blocked' && t.status !== 'done') moves.push(`<button data-move="blocked">막힘</button>`);
  return `<div class="kb-card" data-task="${t.id}">
    <div class="t">${esc(t.title)}</div>
    <div class="m">
      <span class="tag" style="background:${(store.project(t.project)?.color || '#888') + '22'};color:${store.project(t.project)?.color || '#666'}">${esc(store.projectName(t.project))}</span>
      <span class="muted" style="font-size:10.5px">${esc(store.memberName(t.assignee))}</span>
      ${t.due ? `<span class="due ${over ? 'over' : ''}">${t.due.slice(5)} · ${dday(t.due)}</span>` : ''}
      ${t.source && t.source !== '디자인팀' ? `<span class="tag blue">${esc(t.source)}</span>` : ''}
    </div>
    <div class="mv">${moves.join('')}</div>
  </div>`;
}

export function editTask(id, isRequest = false, preset = {}) {
  const db = store.db;
  const t = id ? db.tasks.find(x => x.id === id) : {
    title: preset.title || '', project: db.projects[0]?.id || '', assignee: db.members[0]?.id || '',
    status: isRequest ? 'inbox' : 'todo', due: '', source: isRequest ? '' : '디자인팀', notes: preset.notes || ''
  };
  openModal(`
    <h2>${id ? '업무 수정' : isRequest ? '타팀 요청 받기' : '업무 추가'}</h2>
    <div class="field"><label>업무 제목</label><input id="t-title" value="${esc(t.title)}" placeholder="예: 7월 기획전 메인 배너"></div>
    <div class="frow">
      <div class="field"><label>프로젝트</label><select id="t-project">
        ${db.projects.map(p => `<option value="${p.id}" ${t.project === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      <div class="field"><label>담당자</label><select id="t-assignee">
        ${db.members.map(m => `<option value="${m.id}" ${t.assignee === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
    </div>
    <div class="frow3">
      <div class="field"><label>상태</label><select id="t-status">
        ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${t.status === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
      <div class="field"><label>마감일</label><input type="date" id="t-due" value="${t.due || ''}"></div>
      <div class="field"><label>요청 출처</label><input id="t-source" value="${esc(t.source)}" placeholder="예: 마케팅팀"></div>
    </div>
    <div class="field"><label>메모</label><textarea id="t-notes">${esc(t.notes)}</textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      ${id ? '<button class="btn danger" id="t-del">삭제</button>' : ''}
      <button class="btn" data-close>취소</button>
      <button class="btn primary" id="t-save">저장</button>
    </div>
  `, body => {
    body.querySelector('#t-save').onclick = () => {
      const v = s => body.querySelector(s).value.trim();
      const data = { title: v('#t-title'), project: v('#t-project'), assignee: v('#t-assignee'), status: v('#t-status'), due: v('#t-due'), source: v('#t-source') || '디자인팀', notes: v('#t-notes') };
      if (!data.title) return toast('업무 제목을 입력해주세요', true);
      if (id) Object.assign(t, data);
      else db.tasks.push({ id: uid(), createdAt: new Date().toISOString(), ...data });
      store.save(); closeModal(); toast('저장했어요');
      location.hash = location.hash; window.dispatchEvent(new Event('hashchange'));
    };
    const del = body.querySelector('#t-del');
    if (del) del.onclick = () => {
      db.tasks = db.tasks.filter(x => x.id !== id);
      store.save(); closeModal(); toast('삭제했어요');
      window.dispatchEvent(new Event('hashchange'));
    };
  });
}

function manageProjects() {
  const db = store.db;
  const rows = () => db.projects.map(p => `
    <div class="frow3" style="align-items:end;margin-bottom:8px" data-pid="${p.id}">
      <div class="field" style="margin:0"><label>이름</label><input class="p-name" value="${esc(p.name)}"></div>
      <div class="field" style="margin:0"><label>시작</label><input type="date" class="p-start" value="${p.start || ''}"></div>
      <div class="field" style="margin:0;position:relative"><label>종료</label>
        <div style="display:flex;gap:6px"><input type="date" class="p-end" value="${p.end || ''}" style="flex:1">
        <button class="btn sm danger p-del" title="삭제">✕</button></div></div>
    </div>`).join('');
  openModal(`
    <h2>프로젝트 관리</h2>
    <div id="p-rows">${rows()}</div>
    <div style="display:flex;gap:8px;justify-content:space-between;margin-top:14px">
      <button class="btn" id="p-add">+ 프로젝트 추가</button>
      <div style="display:flex;gap:8px"><button class="btn" data-close>닫기</button>
      <button class="btn primary" id="p-save">저장</button></div>
    </div>
  `, body => {
    body.querySelector('#p-add').onclick = () => {
      db.projects.push({ id: uid(), name: '새 프로젝트', color: '#2F6B5A', start: todayISO(), end: todayISO(21), owner: db.members[0]?.id });
      body.querySelector('#p-rows').innerHTML = rows(); bindDel(body);
    };
    const bindDel = b => b.querySelectorAll('.p-del').forEach(btn => btn.onclick = e => {
      const pid = e.target.closest('[data-pid]').dataset.pid;
      db.projects = db.projects.filter(p => p.id !== pid);
      b.querySelector('#p-rows').innerHTML = rows(); bindDel(b);
    });
    bindDel(body);
    body.querySelector('#p-save').onclick = () => {
      body.querySelectorAll('[data-pid]').forEach(row => {
        const p = db.projects.find(x => x.id === row.dataset.pid);
        if (!p) return;
        p.name = row.querySelector('.p-name').value.trim() || p.name;
        p.start = row.querySelector('.p-start').value;
        p.end = row.querySelector('.p-end').value;
      });
      store.save(); closeModal(); toast('프로젝트를 저장했어요');
      window.dispatchEvent(new Event('hashchange'));
    };
  });
}
