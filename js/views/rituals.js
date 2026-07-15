/* rituals.js — 반복 문서: 위클리 미팅록 · 가중목 · 디자인 펄스 · 금요 리포트 */
import { store, uid, todayISO } from '../store.js';
import { esc, openModal, closeModal, toast, fmtDate, $, copyText } from '../ui.js';
import { editTask } from './tasks.js';
import { ai } from '../ai.js';

const TYPES = {
  friday: { label: '금요 리포트', desc: '오늘 할 일 · 의사결정 포인트 · 막힌 일 · 차주 업무 — 태스크 데이터에서 자동 초안이 생성돼요.' },
  weekly: { label: '위클리 미팅록', desc: '참석자 · 안건 · 논의 · 액션 아이템. 액션 아이템은 버튼 하나로 업무 보드에 등록돼요.' },
  goals: { label: '가중목', desc: '이번 주 가장 중요한 목표와 공약. 체크하면 달성률이 자동 계산돼요.' },
  pulse: { label: '디자인 펄스', desc: '주간 디자인 크리틱 회의록 — 리뷰 대상 · 피드백 · 결정 사항.' },
};

let tab = 'friday';

export function renderRituals(main) {
  const docs = store.db.rituals.filter(r => r.type === tab)
    .sort((a, b) => b.date < a.date ? -1 : 1);

  main.innerHTML = `
  <div class="page-head"><span class="eyebrow">Weekly Rituals</span>
    <h1>위클리 리추얼</h1><p>매주 반복되는 문서를 템플릿과 자동 초안으로 처리해요.</p></div>
  <div class="tabs">${Object.entries(TYPES).map(([k, v]) =>
    `<button data-tab="${k}" class="${tab === k ? 'active' : ''}">${v.label}</button>`).join('')}</div>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
    <p class="muted" style="font-size:12.5px;max-width:560px">${TYPES[tab].desc}</p>
    <button class="btn primary" id="new-doc">+ 새 ${TYPES[tab].label}</button>
  </div>
  <div class="doc-list">
    ${docs.map(d => `<div class="doc-item" data-doc="${d.id}">
      <div><div class="dt">${esc(d.title || TYPES[tab].label)}</div>
      <div class="dm">${fmtDate(d.date)} · ${esc(d.author || '')}</div></div>
      <span class="tag gray">열기</span></div>`).join('')
      || `<div class="empty">아직 문서가 없어요. 첫 ${TYPES[tab].label}를 만들어보세요.</div>`}
  </div>`;

  main.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; renderRituals(main); });
  $('#new-doc').onclick = () => openDoc(null, main);
  main.querySelectorAll('[data-doc]').forEach(el => el.onclick = () => openDoc(el.dataset.doc, main));
}

function weekLabel(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${Math.ceil(d.getDate() / 7)}주차`;
}

function newDoc() {
  const date = todayISO();
  const base = { id: uid(), type: tab, date, author: store.settings.userName || '', createdAt: new Date().toISOString() };
  if (tab === 'weekly') return { ...base, title: `${weekLabel(date)} 위클리 미팅`, data: { attendees: store.db.members.map(m => m.name).join(', '), agenda: '', discussion: '', actions: [] } };
  if (tab === 'goals') return { ...base, title: `${weekLabel(date)} 가중목`, data: { goals: [] } };
  if (tab === 'pulse') return { ...base, title: `${weekLabel(date)} 디자인 펄스`, data: { targets: '', feedback: '', decisions: '' } };
  return { ...base, title: `${weekLabel(date)} 금요 리포트`, data: { today: '', decisions: '', blocked: '', nextWeek: '' } };
}

function openDoc(id, main) {
  const doc = id ? store.db.rituals.find(r => r.id === id) : newDoc();
  const isNew = !id;
  const render = { weekly: weeklyForm, goals: goalsForm, pulse: pulseForm, friday: fridayForm }[doc.type];
  render(doc, isNew, main);
}

function saveDoc(doc, isNew) {
  if (isNew) store.db.rituals.push(doc);
  store.save(); toast('저장했어요');
}
function deleteDoc(doc, main) {
  store.db.rituals = store.db.rituals.filter(r => r.id !== doc.id);
  store.save(); closeModal(); toast('삭제했어요'); renderRituals(main);
}
const footBtns = isNew => `
  <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px">
    ${isNew ? '' : '<button class="btn danger" id="d-del">삭제</button>'}
    <button class="btn" data-close>닫기</button>
    <button class="btn primary" id="d-save">저장</button></div>`;

/* ── 위클리 미팅록 ── */
function weeklyForm(doc, isNew, main) {
  const d = doc.data;
  const actionsHtml = () => d.actions.map((a, i) => `
    <div class="goal-row"><input type="checkbox" data-ai="${i}" ${a.done ? 'checked' : ''}>
      <span class="gt ${a.done ? 'done' : ''}">${esc(a.text)}</span>
      ${a.taskId ? '<span class="tag">업무 등록됨</span>' : `<button class="btn sm" data-to-task="${i}">업무로 보내기 →</button>`}
    </div>`).join('') || '<div class="empty">액션 아이템이 없어요</div>';
  openModal(`
    <h2>${esc(doc.title)}</h2>
    <div class="field"><label>제목</label><input id="w-title" value="${esc(doc.title)}"></div>
    <div class="frow"><div class="field"><label>날짜</label><input type="date" id="w-date" value="${doc.date}"></div>
    <div class="field"><label>참석자</label><input id="w-att" value="${esc(d.attendees)}"></div></div>
    <div class="field"><label>안건</label><textarea id="w-agenda">${esc(d.agenda)}</textarea></div>
    <div class="field"><label>논의 내용</label><textarea id="w-disc" style="min-height:110px">${esc(d.discussion)}</textarea></div>
    <div class="field"><label>액션 아이템</label>
      <div id="w-actions">${actionsHtml()}</div>
      <div style="display:flex;gap:6px"><input id="w-new-action" placeholder="새 액션 아이템 입력 후 Enter" style="flex:1;border:1px solid var(--line);border-radius:8px;padding:8px 10px">
      <button class="btn sm" id="w-add">추가</button></div></div>
    ${footBtns(isNew)}
  `, body => {
    const rebind = () => {
      body.querySelector('#w-actions').innerHTML = actionsHtml();
      body.querySelectorAll('[data-ai]').forEach(c => c.onchange = e => { d.actions[+e.target.dataset.ai].done = e.target.checked; rebind(); });
      body.querySelectorAll('[data-to-task]').forEach(b => b.onclick = e => {
        const a = d.actions[+e.target.dataset.toTask];
        closeModal();
        editTask(null, false, { title: a.text, notes: `출처: ${doc.title}` });
        a.taskId = 'linked'; saveDoc(doc, isNew);
      });
    };
    rebind();
    const add = () => {
      const inp = body.querySelector('#w-new-action');
      if (!inp.value.trim()) return;
      d.actions.push({ text: inp.value.trim(), done: false }); inp.value = ''; rebind();
    };
    body.querySelector('#w-add').onclick = add;
    body.querySelector('#w-new-action').onkeydown = e => { if (e.key === 'Enter') add(); };
    body.querySelector('#d-save').onclick = () => {
      doc.title = body.querySelector('#w-title').value; doc.date = body.querySelector('#w-date').value;
      d.attendees = body.querySelector('#w-att').value; d.agenda = body.querySelector('#w-agenda').value;
      d.discussion = body.querySelector('#w-disc').value;
      saveDoc(doc, isNew); closeModal(); renderRituals(main);
    };
    body.querySelector('#d-del')?.addEventListener('click', () => deleteDoc(doc, main));
  });
}

/* ── 가중목 ── */
function goalsForm(doc, isNew, main) {
  const d = doc.data;
  const pct = () => d.goals.length ? Math.round(d.goals.filter(g => g.done).length / d.goals.length * 100) : 0;
  const goalsHtml = () => d.goals.map((g, i) => `
    <div class="goal-row"><input type="checkbox" data-gi="${i}" ${g.done ? 'checked' : ''}>
      <span class="gt ${g.done ? 'done' : ''}">${esc(g.text)} <span class="muted" style="font-size:11px">— ${esc(g.owner || '')}</span></span>
      <button class="btn sm danger" data-gdel="${i}">✕</button></div>`).join('')
    || '<div class="empty">이번 주 가중목을 추가해주세요</div>';
  openModal(`
    <h2>${esc(doc.title)}</h2>
    <div class="frow"><div class="field"><label>제목</label><input id="g-title" value="${esc(doc.title)}"></div>
    <div class="field"><label>주차 기준일</label><input type="date" id="g-date" value="${doc.date}"></div></div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <label style="font-size:11.5px;font-weight:600;color:var(--muted)">공약 체크 · 달성률 <b id="g-pct">${pct()}%</b></label></div>
    <div class="progress" style="margin-bottom:12px"><i id="g-bar" style="width:${pct()}%"></i></div>
    <div id="g-list">${goalsHtml()}</div>
    <div style="display:flex;gap:6px;margin-top:10px">
      <input id="g-new" placeholder="목표 입력" style="flex:2;border:1px solid var(--line);border-radius:8px;padding:8px 10px">
      <select id="g-owner" style="border:1px solid var(--line);border-radius:8px;padding:8px">
        ${store.db.members.map(m => `<option>${esc(m.name)}</option>`).join('')}</select>
      <button class="btn sm" id="g-add">추가</button></div>
    ${footBtns(isNew)}
  `, body => {
    const rebind = () => {
      body.querySelector('#g-list').innerHTML = goalsHtml();
      body.querySelector('#g-pct').textContent = pct() + '%';
      body.querySelector('#g-bar').style.width = pct() + '%';
      body.querySelectorAll('[data-gi]').forEach(c => c.onchange = e => { d.goals[+e.target.dataset.gi].done = e.target.checked; rebind(); });
      body.querySelectorAll('[data-gdel]').forEach(b => b.onclick = e => { d.goals.splice(+e.target.dataset.gdel, 1); rebind(); });
    };
    rebind();
    body.querySelector('#g-add').onclick = () => {
      const inp = body.querySelector('#g-new');
      if (!inp.value.trim()) return;
      d.goals.push({ text: inp.value.trim(), owner: body.querySelector('#g-owner').value, done: false });
      inp.value = ''; rebind();
    };
    body.querySelector('#d-save').onclick = () => {
      doc.title = body.querySelector('#g-title').value; doc.date = body.querySelector('#g-date').value;
      saveDoc(doc, isNew); closeModal(); renderRituals(main);
    };
    body.querySelector('#d-del')?.addEventListener('click', () => deleteDoc(doc, main));
  });
}

/* ── 디자인 펄스 ── */
function pulseForm(doc, isNew, main) {
  const d = doc.data;
  openModal(`
    <h2>${esc(doc.title)}</h2>
    <div class="frow"><div class="field"><label>제목</label><input id="p-title" value="${esc(doc.title)}"></div>
    <div class="field"><label>날짜</label><input type="date" id="p-date" value="${doc.date}"></div></div>
    <div class="field"><label>리뷰 대상 (시안/작업물)</label><textarea id="p-targets">${esc(d.targets)}</textarea></div>
    <div class="field"><label>크리틱 · 피드백</label><textarea id="p-fb" style="min-height:120px">${esc(d.feedback)}</textarea></div>
    <div class="field"><label>결정 사항</label><textarea id="p-dec">${esc(d.decisions)}</textarea></div>
    ${footBtns(isNew)}
  `, body => {
    body.querySelector('#d-save').onclick = () => {
      doc.title = body.querySelector('#p-title').value; doc.date = body.querySelector('#p-date').value;
      d.targets = body.querySelector('#p-targets').value; d.feedback = body.querySelector('#p-fb').value;
      d.decisions = body.querySelector('#p-dec').value;
      saveDoc(doc, isNew); closeModal(); renderRituals(main);
    };
    body.querySelector('#d-del')?.addEventListener('click', () => deleteDoc(doc, main));
  });
}

/* ── 금요 리포트 (자동 초안 핵심) ── */
function autoDraft() {
  const today = todayISO();
  const nextWeekEnd = todayISO(9);
  const open = store.db.tasks.filter(t => t.status !== 'done');
  const line = t => `- ${t.title} (${store.memberName(t.assignee)}${t.due ? ', ~' + t.due.slice(5) : ''})`;
  return {
    today: open.filter(t => t.status === 'doing' || t.due === today).map(line).join('\n'),
    blocked: open.filter(t => t.status === 'blocked').map(t => line(t) + (t.notes ? ` — ${t.notes}` : '')).join('\n'),
    nextWeek: open.filter(t => t.due && t.due > today && t.due <= nextWeekEnd).map(line).join('\n'),
    doneThisWeek: store.db.tasks.filter(t => t.status === 'done').slice(-8).map(line).join('\n'),
  };
}

function fridayForm(doc, isNew, main) {
  const d = doc.data;
  openModal(`
    <h2>${esc(doc.title)}</h2>
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <button class="btn" id="f-auto">⚡ 태스크에서 자동 초안 채우기</button>
      <button class="btn" id="f-ai">✦ AI로 다듬기</button>
      <button class="btn" id="f-copy">전체 복사</button></div>
    <div class="frow"><div class="field"><label>제목</label><input id="f-title" value="${esc(doc.title)}"></div>
    <div class="field"><label>날짜</label><input type="date" id="f-date" value="${doc.date}"></div></div>
    <div class="field"><label>오늘 할 일 / 진행 중</label><textarea id="f-today">${esc(d.today)}</textarea></div>
    <div class="field"><label>의사결정 포인트 <span class="muted">(자동 초안 없음 — 직접 작성)</span></label><textarea id="f-dec">${esc(d.decisions)}</textarea></div>
    <div class="field"><label>막힌 일</label><textarea id="f-blk">${esc(d.blocked)}</textarea></div>
    <div class="field"><label>차주 진행 업무</label><textarea id="f-next">${esc(d.nextWeek)}</textarea></div>
    ${footBtns(isNew)}
  `, body => {
    const v = s => body.querySelector(s);
    body.querySelector('#f-auto').onclick = () => {
      const a = autoDraft();
      if (!v('#f-today').value) v('#f-today').value = a.today;
      if (!v('#f-blk').value) v('#f-blk').value = a.blocked;
      if (!v('#f-next').value) v('#f-next').value = a.nextWeek;
      toast('업무 보드 데이터로 초안을 채웠어요. 의사결정 포인트만 직접 채워주세요.');
    };
    const fullText = () => `[${v('#f-title').value}] ${v('#f-date').value}
■ 오늘 할 일 / 진행 중
${v('#f-today').value}
■ 의사결정 포인트
${v('#f-dec').value}
■ 막힌 일
${v('#f-blk').value}
■ 차주 진행 업무
${v('#f-next').value}`;
    body.querySelector('#f-copy').onclick = e => copyText(fullText(), e.target);
    body.querySelector('#f-ai').onclick = async e => {
      const btn = e.target; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> 다듬는 중';
      try {
        const out = await ai.polishReport(fullText());
        const grab = (label, next) => {
          const m = out.match(new RegExp(`■\\s*${label}[\\s\\S]*?(?=■\\s*${next}|$)`));
          return m ? m[0].replace(new RegExp(`■\\s*${label}\\s*`), '').trim() : null;
        };
        v('#f-today').value = grab('오늘 할 일.*?', '의사결정') ?? v('#f-today').value;
        v('#f-dec').value = grab('의사결정 포인트', '막힌') ?? v('#f-dec').value;
        v('#f-blk').value = grab('막힌 일', '차주') ?? v('#f-blk').value;
        v('#f-next').value = grab('차주 진행 업무', '$^') ?? v('#f-next').value;
        toast('AI가 문장을 다듬었어요');
      } catch (err) { toast(err.message, true); }
      btn.disabled = false; btn.textContent = '✦ AI로 다듬기';
    };
    body.querySelector('#d-save').onclick = () => {
      doc.title = v('#f-title').value; doc.date = v('#f-date').value;
      d.today = v('#f-today').value; d.decisions = v('#f-dec').value;
      d.blocked = v('#f-blk').value; d.nextWeek = v('#f-next').value;
      saveDoc(doc, isNew); closeModal(); renderRituals(main);
    };
    body.querySelector('#d-del')?.addEventListener('click', () => deleteDoc(doc, main));
  });
}
