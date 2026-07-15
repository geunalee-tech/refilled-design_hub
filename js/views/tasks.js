/* tasks.js — 업무 보드 (요청 → 진행 중 → 컨펌중 → 완료 아카이브) */
import { store, uid, todayISO } from '../store.js';
import { esc, openModal, closeModal, toast, dday, fmtDate, STATUS, PRIORITY, $ } from '../ui.js';
import { renderTimeline } from './timeline.js';

const ORDER = ['req', 'doing', 'confirm'];
const NEXT = { req: 'doing', doing: 'confirm', confirm: 'done' };
const NEXT_LABEL = { req: '진행 →', doing: '컨펌 요청 →', confirm: '완료 ✓' };
const PALETTE = ['#006DE2', '#0F7B5F', '#B7791F', '#6B5CA5', '#8A3B5E', '#3B7A8A'];

let filter = { kind: '', assignee: '', project: '' };
let doneQ = { q: '', assignee: '', month: '' };
let doneOpen = false;

export const subTabs = active => `
  <div class="subtabs">
    <a href="#/tasks" class="${active === '' ? 'on' : ''}">통합 보드</a>
    <a href="#/tasks/requests" class="${active === 'requests' ? 'on' : ''}">타팀 요청</a>
    <a href="#/tasks/projects" class="${active === 'projects' ? 'on' : ''}">프로젝트 타임라인</a>
  </div>`;

export function renderTasks(main, sub = '') {
  if (sub === 'projects') return renderTimeline(main);
  const db = store.db;
  const forceKind = sub === 'requests' ? 'request' : '';
  const match = t =>
    (!(forceKind || filter.kind) || t.kind === (forceKind || filter.kind)) &&
    (!filter.assignee || (t.assignees || []).includes(filter.assignee)) &&
    (!filter.project || t.project === filter.project);
  const tasks = db.tasks.filter(match);

  const cols = ORDER.map(st => {
    const list = tasks.filter(t => t.status === st)
      .sort((a, b) => (a.due || '9') < (b.due || '9') ? -1 : 1);
    return `<div class="kb-col">
      <div class="kb-col-h">${STATUS[st].label}<span class="cnt">${list.length}</span></div>
      ${list.map(t => card(t)).join('') || '<div class="empty" style="padding:14px 4px">비어 있어요</div>'}
    </div>`;
  }).join('');

  main.innerHTML = `
  <div class="page-head"><span class="eyebrow">Task Stream</span>
    <h1>업무 보드</h1><p>${sub === 'requests' ? '타팀에서 인입된 단건 요청만 모아 봐요.' : '타팀 요청과 프로젝트 업무를 한 흐름에서 관리해요. 요청 → 진행 중 → 컨펌중 → 완료.'}</p></div>
  ${subTabs(sub)}
  <div class="board-bar">
    <button class="btn primary" id="new-task">+ 업무 추가</button>
    ${sub === 'requests' ? '' : `<div class="kind-chips">
      ${[['', '전체'], ['request', '타팀 요청'], ['project', '프로젝트']].map(([v, l]) =>
        `<button class="chip ${filter.kind === v ? 'on' : ''}" data-kind="${v}">${l}</button>`).join('')}
    </div>`}
    <select id="f-assignee"><option value="">담당자 전체</option>
      ${db.members.map(m => `<option value="${m.id}" ${filter.assignee === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
    <select id="f-project"><option value="">프로젝트 전체</option>
      ${db.projects.map(p => `<option value="${p.id}" ${filter.project === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <span style="flex:1"></span>
    <button class="btn sm" id="mng-project">프로젝트 관리</button>
  </div>
  <div class="kanban k3">${cols}</div>
  ${doneSection(tasks)}`;

  $('#new-task').onclick = () => editTask(null, sub === 'requests');
  main.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => { filter.kind = b.dataset.kind; renderTasks(main, sub); });
  $('#f-assignee').onchange = e => { filter.assignee = e.target.value; renderTasks(main, sub); };
  $('#f-project').onchange = e => { filter.project = e.target.value; renderTasks(main, sub); };
  $('#mng-project').onclick = manageProjects;

  main.querySelectorAll('[data-task]').forEach(el => {
    el.onclick = e => {
      if (e.target.matches('[data-move]')) {
        const t = store.db.tasks.find(x => x.id === el.dataset.task);
        t.status = e.target.dataset.move;
        if (t.status === 'done') t.doneAt = todayISO(); else delete t.doneAt;
        store.save(); renderTasks(main, sub);
      } else if (e.target.matches('a')) {
        /* 링크는 그대로 통과 */
      } else editTask(el.dataset.task);
    };
  });

  bindDoneSection(main, sub);
}

function card(t) {
  const over = t.due && t.due < todayISO() && t.status !== 'done';
  const p = store.project(t.project);
  const urgent = t.priority === '🚨긴급' || t.priority === '높음';
  const moves = [`<button data-move="${NEXT[t.status]}">${NEXT_LABEL[t.status]}</button>`];
  if (t.status === 'doing') moves.unshift(`<button data-move="req">← 요청</button>`);
  if (t.status === 'confirm') moves.unshift(`<button data-move="doing">← 진행</button>`);
  return `<div class="kb-card" data-task="${t.id}">
    <div class="t">${urgent ? `<span class="pri">${t.priority === '🚨긴급' ? '🚨' : '↑'}</span>` : ''}${esc(t.title)}</div>
    <div class="m">
      <span class="tag" style="background:${(p?.color || '#888') + '22'};color:${p?.color || '#666'}">${esc(store.projectName(t.project))}</span>
      <span class="muted" style="font-size:10.5px">${esc(store.assigneeNames(t))}</span>
      ${t.due ? `<span class="due ${over ? 'over' : ''}">${t.due.slice(5)} · ${dday(t.due)}</span>` : ''}
      ${t.kind === 'request' ? `<span class="tag blue">${esc(t.requester || '타팀')}</span>` : ''}
      ${t.files?.length ? `<span class="muted" style="font-size:10px">📎${t.files.length}</span>` : ''}
      ${t.link ? `<span class="muted" style="font-size:10px">🔗</span>` : ''}
    </div>
    <div class="mv">${moves.join('')}</div>
  </div>`;
}

/* ── 완료 아카이브 (토글 + 검색) ── */
function doneSection(tasks) {
  let done = tasks.filter(t => t.status === 'done');
  const months = [...new Set(done.map(t => (t.doneAt || '').slice(0, 7)).filter(Boolean))].sort().reverse();
  if (doneQ.q) done = done.filter(t => t.title.toLowerCase().includes(doneQ.q.toLowerCase()));
  if (doneQ.assignee) done = done.filter(t => (t.assignees || []).includes(doneQ.assignee));
  if (doneQ.month) done = done.filter(t => (t.doneAt || '').startsWith(doneQ.month));
  done.sort((a, b) => (b.doneAt || '') < (a.doneAt || '') ? -1 : 1);

  return `<details class="done-sec" id="done-sec" ${doneOpen ? 'open' : ''}>
    <summary>완료 <span class="cnt">${done.length}건</span><span class="hint">날짜·제목·담당자로 검색</span></summary>
    <div class="done-bar">
      <input id="dq-text" placeholder="제목 검색" value="${esc(doneQ.q)}">
      <select id="dq-assignee"><option value="">담당자 전체</option>
        ${store.db.members.map(m => `<option value="${m.id}" ${doneQ.assignee === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
      <select id="dq-month"><option value="">전체 기간</option>
        ${months.map(mo => `<option value="${mo}" ${doneQ.month === mo ? 'selected' : ''}>${mo.replace('-', '년 ')}월</option>`).join('')}</select>
    </div>
    <table class="arc-table done-table"><thead><tr><th>완료일</th><th>업무</th><th>프로젝트</th><th>담당자</th><th></th></tr></thead>
    <tbody>${done.map(t => `<tr data-done="${t.id}">
      <td style="white-space:nowrap">${esc(t.doneAt || '—')}</td>
      <td>${esc(t.title)}${t.kind === 'request' ? ` <span class="tag blue">${esc(t.requester || '타팀')}</span>` : ''}</td>
      <td>${esc(store.projectName(t.project))}</td>
      <td>${esc(store.assigneeNames(t))}</td>
      <td style="text-align:right"><button class="btn sm" data-reopen="${t.id}">되돌리기</button></td>
    </tr>`).join('') || '<tr><td colspan="5" class="empty">완료된 업무가 없어요</td></tr>'}</tbody></table>
  </details>`;
}

function bindDoneSection(main, sub = '') {
  const sec = $('#done-sec'); if (!sec) return;
  sec.querySelector('summary').addEventListener('click', () => { doneOpen = !sec.open; });
  const re = () => { doneOpen = true; renderTasks(main, sub); };
  $('#dq-text').oninput = e => { doneQ.q = e.target.value; re(); $('#dq-text').focus(); $('#dq-text').setSelectionRange(doneQ.q.length, doneQ.q.length); };
  $('#dq-assignee').onchange = e => { doneQ.assignee = e.target.value; re(); };
  $('#dq-month').onchange = e => { doneQ.month = e.target.value; re(); };
  main.querySelectorAll('[data-reopen]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    const t = store.db.tasks.find(x => x.id === b.dataset.reopen);
    t.status = 'doing'; delete t.doneAt; store.save();
    doneOpen = true; renderTasks(main, sub); toast('진행 중으로 되돌렸어요');
  });
  main.querySelectorAll('[data-done]').forEach(tr => tr.onclick = e => {
    if (e.target.matches('button')) return;
    editTask(tr.dataset.done);
  });
}

/* ── 업무 추가/수정 모달 ── */
export function editTask(id, isRequest = false, preset = {}) {
  const db = store.db;
  const t = id ? db.tasks.find(x => x.id === id) : {
    kind: preset.kind || (isRequest ? 'request' : 'project'),
    title: preset.title || '', project: preset.project || db.projects[0]?.id || '',
    assignees: [], status: 'req', priority: '중간',
    requester: '', requestedAt: todayISO(), due: '', link: '', files: [],
    notes: preset.notes || ''
  };
  const files = [...(t.files || [])];

  const fileRows = () => files.map((f, i) => `
    <div class="att-item">
      <a href="${esc(f.url)}" target="_blank" rel="noopener">📎 ${esc(f.name)}</a>
      <button class="att-del" data-fi="${i}" title="삭제">✕</button>
    </div>`).join('') || '<div class="empty" style="padding:6px 2px">첨부 없음 (최대 5개)</div>';

  openModal(`
    <h2>${id ? '업무 수정' : '업무 추가'}</h2>
    <div class="frow">
      <div class="field"><label>구분</label><select id="t-kind">
        <option value="request" ${t.kind === 'request' ? 'selected' : ''}>타팀 요청</option>
        <option value="project" ${t.kind === 'project' ? 'selected' : ''}>프로젝트</option></select></div>
      <div class="field"><label>우선순위</label><select id="t-pri">
        ${PRIORITY.map(p => `<option ${t.priority === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label>업무 제목</label><input id="t-title" value="${esc(t.title)}" placeholder="예: 7월 기획전 메인 배너"></div>
    <div class="field"><label>프로젝트</label>
      <select id="t-project">
        ${db.projects.map(p => `<option value="${p.id}" ${t.project === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        <option value="__new">＋ 새 프로젝트 추가…</option>
      </select>
      <input id="t-newproj" placeholder="새 프로젝트 이름" style="display:none;margin-top:6px">
    </div>
    <div class="field"><label>담당자 (복수 선택)</label>
      <div class="chk-group">${db.members.map(m => `
        <label class="chk"><input type="checkbox" value="${m.id}" ${(t.assignees || []).includes(m.id) ? 'checked' : ''}>${esc(m.name)}</label>`).join('')}
      </div>
    </div>
    <div class="frow3">
      <div class="field"><label>상태</label><select id="t-status">
        ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${t.status === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
      <div class="field"><label>요청일</label><input type="date" id="t-reqat" value="${t.requestedAt || todayISO()}"></div>
      <div class="field"><label>마감일</label><input type="date" id="t-due" value="${t.due || ''}"></div>
    </div>
    <div class="field" id="f-requester"><label>요청자</label><input id="t-requester" value="${esc(t.requester || '')}" placeholder="예: 마케팅팀 이지수"></div>
    <div class="field"><label>링크 (피그마·노션·드라이브 등)</label><input id="t-link" value="${esc(t.link || '')}" placeholder="https://"></div>
    <div class="field"><label>파일 첨부 <span class="muted" style="font-weight:400">(최대 5개 · 개당 8MB)</span></label>
      <div id="att-list">${fileRows()}</div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button class="btn sm" id="att-file">파일 선택</button>
        <button class="btn sm" id="att-link">링크로 추가</button>
        <input type="file" id="att-input" multiple hidden>
        <span id="att-status" class="muted" style="font-size:11px;align-self:center"></span>
      </div>
    </div>
    <div class="field"><label>세부내용 / 메모</label><textarea id="t-notes">${esc(t.notes)}</textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      ${id ? '<button class="btn danger" id="t-del">삭제</button>' : ''}
      <button class="btn" data-close>취소</button>
      <button class="btn primary" id="t-save">저장</button>
    </div>
  `, body => {
    const q = s => body.querySelector(s);

    // 구분에 따라 요청자 필드 강조
    const syncKind = () => { q('#f-requester').style.display = q('#t-kind').value === 'request' ? '' : 'none'; };
    q('#t-kind').onchange = syncKind; syncKind();

    // 새 프로젝트 인라인 추가
    q('#t-project').onchange = e => q('#t-newproj').style.display = e.target.value === '__new' ? '' : 'none';

    // 첨부: 파일 업로드 (GitHub 저장소 files/ 커밋)
    const redraw = () => { q('#att-list').innerHTML = fileRows(); bindDel(); };
    const bindDel = () => body.querySelectorAll('.att-del').forEach(b => b.onclick = () => { files.splice(+b.dataset.fi, 1); redraw(); });
    bindDel();
    q('#att-file').onclick = () => {
      if (!store.hasRemote()) return toast('파일 업로드는 GitHub 연결 후 가능해요 (설정). 링크로 추가는 바로 가능해요.', true);
      q('#att-input').click();
    };
    q('#att-input').onchange = async e => {
      for (const file of [...e.target.files]) {
        if (files.length >= 5) { toast('첨부는 최대 5개까지예요', true); break; }
        if (file.size > 8 * 1024 * 1024) { toast(`${file.name}: 8MB를 넘어요. 링크로 첨부해주세요.`, true); continue; }
        q('#att-status').textContent = `${file.name} 업로드 중…`;
        try {
          const base64 = await new Promise((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(r.result.split(',')[1]);
            r.onerror = () => rej(new Error('읽기 실패'));
            r.readAsDataURL(file);
          });
          files.push(await store.uploadAttachment(file.name, base64));
          redraw();
        } catch (err) { toast(`${file.name}: ${err.message}`, true); }
      }
      q('#att-status').textContent = ''; e.target.value = '';
    };
    q('#att-link').onclick = () => {
      if (files.length >= 5) return toast('첨부는 최대 5개까지예요', true);
      const url = prompt('첨부할 링크(URL)를 입력해주세요');
      if (!url) return;
      const name = prompt('표시할 이름', url.split('/').pop() || '링크') || '링크';
      files.push({ name, url }); redraw();
    };

    q('#t-save').onclick = () => {
      const v = s => q(s).value.trim();
      let projectId = v('#t-project');
      if (projectId === '__new') {
        const name = v('#t-newproj');
        if (!name) return toast('새 프로젝트 이름을 입력해주세요', true);
        const np = { id: uid(), name, color: PALETTE[db.projects.length % PALETTE.length], start: todayISO(), end: v('#t-due') || todayISO(30), owner: null };
        db.projects.push(np); projectId = np.id;
      }
      const assignees = [...body.querySelectorAll('.chk input:checked')].map(c => c.value);
      const data = {
        kind: q('#t-kind').value, title: v('#t-title'), project: projectId, assignees,
        status: v('#t-status'), priority: v('#t-pri'), requestedAt: v('#t-reqat'),
        due: v('#t-due'), requester: v('#t-requester'), link: v('#t-link'),
        files, notes: v('#t-notes')
      };
      if (!data.title) return toast('업무 제목을 입력해주세요', true);
      if (!assignees.length) return toast('담당자를 1명 이상 선택해주세요', true);
      if (data.status === 'done') data.doneAt = (id && t.doneAt) || todayISO();
      if (id) { if (data.status !== 'done') delete t.doneAt; Object.assign(t, data); }
      else db.tasks.push({ id: uid(), createdAt: new Date().toISOString(), ...data });
      store.save(); closeModal(); toast('저장했어요');
      window.dispatchEvent(new Event('hashchange'));
    };
    const del = q('#t-del');
    if (del) del.onclick = () => {
      if (!confirm('이 업무를 삭제할까요?')) return;
      db.tasks = db.tasks.filter(x => x.id !== id);
      store.save(); closeModal(); toast('삭제했어요');
      window.dispatchEvent(new Event('hashchange'));
    };
  });
}

/* ── 프로젝트 관리 ── */
function manageProjects() {
  const db = store.db;
  const rows = () => db.projects.map(p => `
    <div class="frow3" style="align-items:end;margin-bottom:8px" data-pid="${p.id}">
      <div class="field" style="margin:0"><label>이름</label>
        <div style="display:flex;gap:6px;align-items:center">
          <input type="color" class="p-color" value="${p.color || '#0F7B5F'}" style="width:30px;height:30px;padding:2px;border:1px solid var(--line);border-radius:6px">
          <input class="p-name" value="${esc(p.name)}" style="flex:1"></div></div>
      <div class="field" style="margin:0"><label>시작</label><input type="date" class="p-start" value="${p.start || ''}"></div>
      <div class="field" style="margin:0"><label>종료</label>
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
      db.projects.push({ id: uid(), name: '새 프로젝트', color: PALETTE[db.projects.length % PALETTE.length], start: todayISO(), end: todayISO(21), owner: db.members[0]?.id });
      body.querySelector('#p-rows').innerHTML = rows(); bindDel(body);
    };
    const bindDel = b => b.querySelectorAll('.p-del').forEach(btn => btn.onclick = e => {
      const pid = e.target.closest('[data-pid]').dataset.pid;
      const cnt = db.tasks.filter(t => t.project === pid).length;
      if (!confirm(`이 프로젝트를 삭제할까요?${cnt ? `\n연결된 업무 ${cnt}건은 '기타'로 남아요.` : ''}`)) return;
      db.projects = db.projects.filter(p => p.id !== pid);
      b.querySelector('#p-rows').innerHTML = rows(); bindDel(b);
    });
    bindDel(body);
    body.querySelector('#p-save').onclick = () => {
      body.querySelectorAll('[data-pid]').forEach(row => {
        const p = db.projects.find(x => x.id === row.dataset.pid);
        if (!p) return;
        p.name = row.querySelector('.p-name').value.trim() || p.name;
        p.color = row.querySelector('.p-color').value;
        p.start = row.querySelector('.p-start').value;
        p.end = row.querySelector('.p-end').value;
      });
      store.save(); closeModal(); toast('프로젝트를 저장했어요');
      window.dispatchEvent(new Event('hashchange'));
    };
  });
}
