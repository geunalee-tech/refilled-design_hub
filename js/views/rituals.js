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
  if (tab === 'goals') return renderWig(main);
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
  const line = t => `- ${t.title} (${store.assigneeNames(t)}${t.due ? ', ~' + t.due.slice(5) : ''})`;
  return {
    today: open.filter(t => t.status === 'doing' || t.due === today).map(line).join('\n'),
    blocked: open.filter(t => t.status === 'confirm').map(t => line(t) + (t.notes ? ` — ${t.notes}` : '')).join('\n'),
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
    <div class="field"><label>막힌 일 · 컨펌 대기</label><textarea id="f-blk">${esc(d.blocked)}</textarea></div>
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

/* ════════════════════════════════════════════════════════════
   가중목 (4DX 위그 세션) — 노션 '가중목 회의' 플로우를 한 페이지로
   ① 지난 주 공약 체크 → ② 선행지표 스코어보드(자동 집계)
   → ③ 후행지표 → ④ 이번 주 공약 (다음 주에 ①로 자동 이월)
   모든 입력은 자동 저장 · 팀 전체 공유
   ════════════════════════════════════════════════════════════ */
const wAddDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = iso => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.toISOString().slice(0, 10); };
const wigLabel = mon => {
  const d = new Date(mon + 'T00:00:00');
  const off = (new Date(d.getFullYear(), d.getMonth(), 1).getDay() + 6) % 7; // 1일의 요일(월=0)
  return `${d.getMonth() + 1}월 ${Math.ceil((d.getDate() + off) / 7)}주차`;   // 노션과 동일한 주차 계산
};
let wigWeek = null; // 현재 보고 있는 주 (월요일 ISO)

function wigConfig() {
  let c = store.db.rituals.find(r => r.type === 'goals-config');
  if (!c) { // 최초 1회: 노션 26Y 가중목(3분기)에서 가져온 기본값
    c = {
      id: uid(), type: 'goals-config', createdAt: new Date().toISOString(),
      goal: '리필드의 브랜드 아이덴티티를 확고히 하여, 브랜드 인지도 향상 및 매출 증대에 기여한다.',
      lag: [
        { id: uid(), label: '자사몰 비주얼 개편 후, 프로모션 실험을 통한 CVR +5%' },
        { id: uid(), label: '국내 채널 리브랜딩 적용 완료율 100% (올영·무신사·쿠팡 등)' },
        { id: uid(), label: '아마존 채널 비주얼 개편을 통한 CVR 평균 8% 이상' },
      ],
      lead: [
        { id: uid(), label: '자사몰 프로모션 비주얼 실험', target: 2 },
        { id: uid(), label: '국내 채널 에셋 적용 (썸네일·상페·배너)', target: 4 },
        { id: uid(), label: '아마존 채널 비주얼 실험', target: 4 },
        { id: uid(), label: '디자인 트렌드 발굴 및 시도', target: 4 },
      ],
    };
    store.db.rituals.push(c); store.save();
  }
  return c;
}

function wigDoc(mon, create = false) {
  let d = store.db.rituals.find(r => r.type === 'goals' && r.date && mondayOf(r.date) === mon);
  if (!d && create) {
    d = { id: uid(), type: 'goals', date: mon, title: `${wigLabel(mon)} 가중목`,
      author: store.settings.userName || '', createdAt: new Date().toISOString(),
      data: { commitments: [], leadWeek: {}, lagMonth: {}, evalNote: '' } };
    store.db.rituals.push(d); store.save();
  }
  if (d && !d.data.commitments) d.data = { commitments: [], leadWeek: {}, lagMonth: {}, evalNote: '', ...d.data };
  return d;
}

/* 같은 달 누적 실적 (이번 주까지) */
function wigCum(leadId, mon) {
  const m = mon.slice(0, 7);
  return store.db.rituals
    .filter(r => r.type === 'goals' && r.date && r.date.slice(0, 7) === m && r.date <= mon)
    .reduce((s, r) => s + (+((r.data || {}).leadWeek || {})[leadId] || 0), 0);
}
/* 신호등: 월 경과 페이스 대비 달성률 */
function wigSignal(ratio, mon) {
  const sun = new Date(wAddDays(mon, 6) + 'T00:00:00');
  const dim = new Date(sun.getFullYear(), sun.getMonth() + 1, 0).getDate();
  const pace = Math.min(1, sun.getDate() / dim);
  if (ratio >= pace * 0.9) return ['🟢', '페이스 이상'];
  if (ratio >= pace * 0.45) return ['🟡', '주의 — 페이스보다 느려요'];
  return ['🔴', '위험 — 레버를 당겨야 해요'];
}

function renderWig(main) {
  const db = store.db;
  const cfg = wigConfig();
  if (!wigWeek) wigWeek = mondayOf(todayISO());
  const mon = wigWeek, sun = wAddDays(mon, 6);
  const cur = wigDoc(mon, true);
  const prev = wigDoc(wAddDays(mon, -7));
  const isThisWeek = mon === mondayOf(todayISO());

  /* ① 지난 주 공약 */
  const pc = prev ? (prev.data.commitments || []) : [];
  const pcDone = pc.filter(c => c.done).length;
  const sec1 = pc.length ? pc.map((c, i) => `
    <div class="wig-cmt ${c.done ? 'ok' : ''}">
      <input type="checkbox" data-pchk="${i}" ${c.done ? 'checked' : ''}>
      <div class="wig-cmt-b">
        <div class="wig-cmt-t"><b>${esc(c.member || '')}</b> ${esc(c.text)}</div>
        ${c.criteria ? `<div class="wig-cmt-c">완료 기준: ${esc(c.criteria)}</div>` : ''}
        ${!c.done ? `<input class="wig-reason" data-prsn="${i}" placeholder="미달성 사유 (선택)" value="${esc(c.reason || '')}">` : ''}
      </div>
      ${c.leadId ? `<span class="tag gray" title="연결 선행지표">${esc((cfg.lead.find(l => l.id === c.leadId) || {}).label || '')}</span>` : ''}
    </div>`).join('')
    : `<div class="empty" style="padding:10px 4px">지난 주(${prev ? '' : wigLabel(wAddDays(mon, -7))}) 공약 기록이 없어요. 이번 주 ④에서 공약을 만들면 다음 주에 여기로 자동으로 넘어와요.</div>`;

  /* ② 선행지표 */
  const sec2 = cfg.lead.map(l => {
    const wk = +((cur.data.leadWeek || {})[l.id] || 0);
    const cum = wigCum(l.id, mon);
    const ratio = l.target ? cum / l.target : 0;
    const [sig, sigTip] = wigSignal(ratio, mon);
    return `<div class="wig-lead">
      <div class="wig-lead-l"><b>${esc(l.label)}</b><span class="muted">월 목표 ${l.target}건</span></div>
      <div class="wig-step"><button class="btn sm" data-lstep="${l.id}" data-d="-1">−</button>
        <b>${wk}</b><button class="btn sm" data-lstep="${l.id}" data-d="1">＋</button>
        <span class="muted" style="font-size:10.5px">이번 주</span></div>
      <div class="wig-lead-r">
        <span class="muted">누적 ${cum}/${l.target}</span>
        <div class="progress" style="width:90px"><i style="width:${Math.min(100, Math.round(ratio * 100))}%"></i></div>
        <b>${Math.round(ratio * 100)}%</b><span title="${sigTip}">${sig}</span>
      </div>
    </div>`;
  }).join('');

  /* ③ 후행지표 */
  const lm = cur.data.lagMonth || {};
  const sec3 = cfg.lag.map(g => {
    const v = lm[g.id] || {};
    return `<div class="wig-lag">
      <div class="wig-lag-l">${esc(g.label)}</div>
      <input class="wig-lag-in" data-lag="${g.id}" data-f="prev" placeholder="지난 달" value="${esc(v.prev || '')}">
      <input class="wig-lag-in" data-lag="${g.id}" data-f="cur" placeholder="이번 달" value="${esc(v.cur || '')}">
      <input class="wig-lag-note" data-lag="${g.id}" data-f="note" placeholder="비고" value="${esc(v.note || '')}">
    </div>`;
  }).join('');

  /* ④ 이번 주 공약 */
  const cc = cur.data.commitments || [];
  const sec4 = cc.map((c, i) => `
    <div class="wig-new">
      <select data-cf="member" data-ci="${i}">${db.members.map(m =>
        `<option ${c.member === m.name ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
      <input data-cf="text" data-ci="${i}" placeholder="공약 — 이번 주에 무엇을 해낼 것인가" value="${esc(c.text)}">
      <input data-cf="criteria" data-ci="${i}" placeholder="완료 기준 (예: 7/24까지 시안 공유)" value="${esc(c.criteria || '')}">
      <select data-cf="leadId" data-ci="${i}" title="연결 선행지표"><option value="">지표 연결 안 함</option>
        ${cfg.lead.map(l => `<option value="${l.id}" ${c.leadId === l.id ? 'selected' : ''}>${esc(l.label)}</option>`).join('')}</select>
      <button class="btn sm danger" data-cdel="${i}">✕</button>
    </div>`).join('');

  main.innerHTML = `
  <div class="page-head"><span class="eyebrow">Weekly Rituals</span>
    <h1>위클리 리추얼</h1><p>매주 반복되는 문서를 템플릿과 자동 초안으로 처리해요.</p></div>
  <div class="tabs">${Object.entries(TYPES).map(([k, v]) =>
    `<button data-tab="${k}" class="${tab === k ? 'active' : ''}">${v.label}</button>`).join('')}</div>

  <div class="board-bar">
    <button class="btn sm" id="w-prev">◀ 이전 주</button>
    <b style="font-size:13.5px">${wigLabel(mon)} <span class="muted" style="font-weight:400">(${mon.slice(5).replace('-', '/')} ~ ${sun.slice(5).replace('-', '/')})${isThisWeek ? ' · 이번 주' : ''}</span></b>
    <button class="btn sm" id="w-next">다음 주 ▶</button>
    ${isThisWeek ? '' : '<button class="btn sm" id="w-today">이번 주로</button>'}
    <span style="flex:1"></span>
    <button class="btn sm" id="w-copy">📋 회의록 복사</button>
    <button class="btn sm" id="w-cfg">⚙️ 목표 설정</button>
  </div>

  <div class="wig-banner">
    <div class="wig-goal">🚩 <b>${esc(cfg.goal)}</b></div>
    <div class="wig-lags">${cfg.lag.map((g, i) => `<span>${i + 1}. ${esc(g.label)}</span>`).join('')}</div>
  </div>

  <div class="card wig-sec"><div class="card-h"><h3>1️⃣ 지난 주 공약 체크</h3>
    ${pc.length ? `<span class="tag ${pcDone === pc.length ? 'green' : 'gray'}">${pcDone}/${pc.length} 달성</span>` : ''}</div>
    ${sec1}</div>

  <div class="card wig-sec"><div class="card-h"><h3>2️⃣ 선행지표 스코어보드</h3>
    <span class="muted" style="font-size:11px">누적·달성률·신호등은 자동 계산 (월 경과 페이스 기준)</span></div>
    ${sec2}</div>

  <div class="card wig-sec"><div class="card-h"><h3>3️⃣ 후행지표 — 결과가 따라오고 있나</h3></div>
    ${sec3}
    <textarea id="w-eval" rows="2" placeholder="선행 → 후행 연결 평가 (레버가 결과를 움직이고 있는지 한 줄 평)" style="width:100%;margin-top:8px">${esc(cur.data.evalNote || '')}</textarea></div>

  <div class="card wig-sec"><div class="card-h"><h3>4️⃣ 이번 주 공약 — 다음 주에 확인할 것</h3>
    <button class="btn sm" id="w-addcmt">+ 공약 추가</button></div>
    ${sec4 || '<div class="empty" style="padding:10px 4px">아직 공약이 없어요. 팀원별로 이번 주 가장 중요한 한 가지를 약속해보세요.</div>'}
    <p class="muted" style="font-size:11px;margin:8px 0 0">여기 적은 공약은 다음 주 세션의 1️⃣에 자동으로 나타나요. 모든 변경은 자동 저장돼요.</p></div>`;

  /* ── 바인딩 ── */
  main.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; renderRituals(main); });
  $('#w-prev').onclick = () => { wigWeek = wAddDays(mon, -7); renderWig(main); };
  $('#w-next').onclick = () => { wigWeek = wAddDays(mon, 7); renderWig(main); };
  $('#w-today') && ($('#w-today').onclick = () => { wigWeek = mondayOf(todayISO()); renderWig(main); });
  $('#w-cfg').onclick = () => wigConfigModal(main);
  $('#w-copy').onclick = () => { copyText(wigMarkdown(cfg, cur, prev, mon)); toast('회의록을 마크다운으로 복사했어요 — 노션에 그대로 붙여넣을 수 있어요'); };

  /* ① 지난 주 체크 */
  main.querySelectorAll('[data-pchk]').forEach(el => el.onchange = () => {
    prev.data.commitments[+el.dataset.pchk].done = el.checked; store.save(); renderWig(main);
  });
  main.querySelectorAll('[data-prsn]').forEach(el => el.onchange = () => {
    prev.data.commitments[+el.dataset.prsn].reason = el.value.trim(); store.save();
  });

  /* ② 스코어 스텝퍼 */
  main.querySelectorAll('[data-lstep]').forEach(b => b.onclick = () => {
    const id = b.dataset.lstep, w = cur.data.leadWeek = cur.data.leadWeek || {};
    w[id] = Math.max(0, (+w[id] || 0) + +b.dataset.d);
    store.save(); renderWig(main);
  });

  /* ③ 후행지표 */
  main.querySelectorAll('.wig-lag input').forEach(el => el.onchange = () => {
    const lm2 = cur.data.lagMonth = cur.data.lagMonth || {};
    (lm2[el.dataset.lag] = lm2[el.dataset.lag] || {})[el.dataset.f] = el.value.trim();
    store.save();
  });
  $('#w-eval').onchange = e => { cur.data.evalNote = e.target.value.trim(); store.save(); };

  /* ④ 이번 주 공약 */
  $('#w-addcmt').onclick = () => {
    cur.data.commitments.push({ id: uid(), member: db.members[0]?.name || '', text: '', criteria: '', leadId: '', done: false, reason: '' });
    store.save(); renderWig(main);
  };
  main.querySelectorAll('[data-cf]').forEach(el => el.onchange = () => {
    cur.data.commitments[+el.dataset.ci][el.dataset.cf] = el.value;
    store.save();
    if (el.tagName === 'SELECT') renderWig(main);
  });
  main.querySelectorAll('[data-cdel]').forEach(b => b.onclick = () => {
    cur.data.commitments.splice(+b.dataset.cdel, 1); store.save(); renderWig(main);
  });
}

/* ⚙️ 목표 설정: 가중목 · 선행/후행지표 편집 */
function wigConfigModal(main) {
  const cfg = wigConfig();
  const w = JSON.parse(JSON.stringify({ goal: cfg.goal, lead: cfg.lead, lag: cfg.lag }));
  const leadRows = () => w.lead.map((l, i) => `
    <div style="display:flex;gap:6px;margin-bottom:6px">
      <input data-le="${i}" value="${esc(l.label)}" style="flex:1" placeholder="선행지표">
      <input data-lt="${i}" type="number" min="0" value="${l.target}" style="width:76px" title="월 목표(건)">
      <button class="btn sm danger" data-ld="${i}">✕</button></div>`).join('');
  const lagRows = () => w.lag.map((g, i) => `
    <div style="display:flex;gap:6px;margin-bottom:6px">
      <input data-ge="${i}" value="${esc(g.label)}" style="flex:1" placeholder="후행지표">
      <button class="btn sm danger" data-gd="${i}">✕</button></div>`).join('');
  openModal(`
    <h2>가중목 · 지표 설정</h2>
    <div class="field"><label>가중목 (팀의 가장 중요한 목표)</label><textarea id="c-goal" rows="2" style="width:100%">${esc(w.goal)}</textarea></div>
    <div class="field"><label>선행지표 <span class="muted" style="font-weight:400">(우리가 매주 직접 움직일 수 있는 레버 · 월 목표 건수)</span></label>
      <div id="c-lead">${leadRows()}</div><button class="btn sm" id="c-addlead">+ 선행지표 추가</button></div>
    <div class="field"><label>후행지표 <span class="muted" style="font-weight:400">(결과로 따라오는 숫자 — CVR, 완료율 등)</span></label>
      <div id="c-lag">${lagRows()}</div><button class="btn sm" id="c-addlag">+ 후행지표 추가</button></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn" data-close>취소</button><button class="btn primary" id="c-save">저장</button></div>
  `, body => {
    const q = s => body.querySelector(s);
    const rebind = () => {
      q('#c-lead').innerHTML = leadRows(); q('#c-lag').innerHTML = lagRows();
      body.querySelectorAll('[data-le]').forEach(el => el.onchange = () => w.lead[+el.dataset.le].label = el.value);
      body.querySelectorAll('[data-lt]').forEach(el => el.onchange = () => w.lead[+el.dataset.lt].target = Math.max(0, +el.value || 0));
      body.querySelectorAll('[data-ld]').forEach(b => b.onclick = () => { w.lead.splice(+b.dataset.ld, 1); rebind(); });
      body.querySelectorAll('[data-ge]').forEach(el => el.onchange = () => w.lag[+el.dataset.ge].label = el.value);
      body.querySelectorAll('[data-gd]').forEach(b => b.onclick = () => { w.lag.splice(+b.dataset.gd, 1); rebind(); });
    };
    rebind();
    q('#c-addlead').onclick = () => { w.lead.push({ id: uid(), label: '', target: 4 }); rebind(); };
    q('#c-addlag').onclick = () => { w.lag.push({ id: uid(), label: '' }); rebind(); };
    q('#c-save').onclick = () => {
      cfg.goal = q('#c-goal').value.trim() || cfg.goal;
      cfg.lead = w.lead.filter(l => l.label.trim());
      cfg.lag = w.lag.filter(g => g.label.trim());
      store.save(); closeModal(); renderWig(main); toast('가중목 설정을 저장했어요');
    };
  });
}

/* 노션 붙여넣기용 마크다운 */
function wigMarkdown(cfg, cur, prev, mon) {
  const pc = prev ? (prev.data.commitments || []) : [];
  const lm = cur.data.lagMonth || {};
  return `## 🏆 ${wigLabel(mon)} 가중목 회의 (${mon} ~ ${wAddDays(mon, 6)})

> **가중목**: ${cfg.goal}

### 1️⃣ 공약 달성 현황 (지난 주)
| 담당자 | 공약 | 달성 | 미달성 사유 |
| --- | --- | --- | --- |
${pc.map(c => `| ${c.member} | ${c.text} | ${c.done ? '✅' : ''} | ${c.reason || ''} |`).join('\n') || '| - | 기록 없음 | | |'}

### 2️⃣ 선행지표 현황
| 선행지표 | 월 목표 | 이번 주 실적 | 누적 | 달성률 |
| --- | --- | --- | --- | --- |
${cfg.lead.map(l => {
    const wk = +((cur.data.leadWeek || {})[l.id] || 0), cum = wigCum(l.id, mon);
    return `| ${l.label} | ${l.target}건 | ${wk} | ${cum} | ${l.target ? Math.round(cum / l.target * 100) : 0}% |`;
  }).join('\n')}

### 3️⃣ 후행지표 현황
| 후행지표 | 지난 달 | 이번 달 | 비고 |
| --- | --- | --- | --- |
${cfg.lag.map(g => { const v = lm[g.id] || {}; return `| ${g.label} | ${v.prev || ''} | ${v.cur || ''} | ${v.note || ''} |`; }).join('\n')}

선행 → 후행 평가: ${cur.data.evalNote || ''}

### 4️⃣ 이번 주 공약
| 담당자 | 공약 | 완료 기준 |
| --- | --- | --- |
${(cur.data.commitments || []).map(c => `| ${c.member} | ${c.text} | ${c.criteria || ''} |`).join('\n') || '| | | |'}`;
}
