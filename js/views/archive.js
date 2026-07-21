/* archive.js — 아카이브
 *  · 최종 파일 아카이브: 최종 파일 링크 + 메타데이터 (기존)
 *  · 인사이트 아카이브: 디자인팀 인사이트 게시판 (URL·제목·태그·메모)  ← 신규
 * 저장은 기존 archive 테이블 공유, kind='insight' 로 구분 (새 테이블 불필요 → 동기화 안전).
 * 태그는 색상 있는 옵션으로 정의(db.config.insightTags = [{id,name,color}]), 인사이트는 태그 id 배열(tags)로 참조.
 * 생성/수정/삭제·태그 관리는 디자인팀만 (store.isDesignTeam, UI 게이트). 읽기는 로그인 전원.
 */
import { store, uid, todayISO } from '../store.js';
import { esc, openModal, closeModal, toast, $ } from '../ui.js';

let tab = 'files';   // files | insight
let fq = '';         // 파일 탭 검색어
let iq = '';         // 인사이트 탭 검색어
let iTag = '';       // 인사이트 태그 필터 (태그 id)

const isInsight = a => a.kind === 'insight';
const splitTags = s => (s || '').split(',').map(t => t.trim()).filter(Boolean);

/* ───────── 태그 정의 (색상 옵션) ───────── */
const TAG_COLORS = ['#6B7280', '#2563EB', '#7C3AED', '#059669', '#D97706', '#DC2626', '#DB2777', '#0891B2'];
function tagDefs() { const c = store.db.config || (store.db.config = {}); if (!Array.isArray(c.insightTags)) c.insightTags = []; return c.insightTags; }
function tagById(id) { return tagDefs().find(t => t.id === id); }
function ensureTagByName(name) {
  const nm = (name || '').trim(); if (!nm) return null;
  let t = tagDefs().find(x => x.name.toLowerCase() === nm.toLowerCase());
  if (!t) { t = { id: uid(), name: nm, color: TAG_COLORS[tagDefs().length % TAG_COLORS.length] }; tagDefs().push(t); }
  return t.id;
}
function deleteTagDef(id) {
  store.db.config.insightTags = tagDefs().filter(t => t.id !== id);
  store.db.archive.filter(isInsight).forEach(a => { if (Array.isArray(a.tags) && a.tags.includes(id)) a.tags = a.tags.filter(x => x !== id); });
  store.save();
}
/* 구 tagline(문자열) → tags(id 배열) 1회 마이그레이션 */
function migrateInsightTags() {
  let changed = false;
  store.db.archive.filter(isInsight).forEach(a => {
    if (!Array.isArray(a.tags)) {
      a.tags = a.tagline != null ? splitTags(a.tagline).map(ensureTagByName).filter(Boolean) : [];
      delete a.tagline; changed = true;
    }
  });
  if (changed) store.save();
}
function tagChip(id, removable = false) {
  const t = tagById(id); if (!t) return '';
  return `<span style="background:${t.color}22;color:${t.color};border-radius:999px;padding:2px 9px;font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:5px;margin:1px 3px 1px 0">${esc(t.name)}${removable ? `<button data-rmtag="${id}" style="background:none;border:none;color:inherit;cursor:pointer;font-size:12px;line-height:1;padding:0">✕</button>` : ''}</span>`;
}

/* ───────── 최종 파일 아카이브 (기존) ───────── */
function fileRows() {
  let list = store.db.archive.filter(a => !isInsight(a)).sort((a, b) => (b.date < a.date ? -1 : 1));
  if (fq) { const k = fq.toLowerCase(); list = list.filter(a => (a.title + ' ' + (a.tags || '')).toLowerCase().includes(k)); }
  return list.map(a => `<tr>
      <td><a class="flink" href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a>
        ${a.notes ? `<div class="muted" style="font-size:11px;margin-top:2px">${esc(a.notes)}</div>` : ''}</td>
      <td class="mono">${esc(a.version || '—')}</td>
      <td>${splitTags(a.tags).map(t => `<span class="tag gray" style="margin:1px">${esc(t)}</span>`).join('')}</td>
      <td>${esc(store.memberName(a.owner))}</td>
      <td class="mono">${a.date?.slice(5) || ''}</td>
      <td><button class="btn sm" data-fedit="${a.id}">수정</button></td>
    </tr>`).join('') || `<tr><td colspan="6"><div class="empty">등록된 최종 파일이 없어요</div></td></tr>`;
}

function renderFilesTab(main) {
  $('#tab-body').innerHTML = `
  <p class="hint" style="margin:2px 0 12px">최종 파일은 드라이브/NAS에 두고, 여기엔 링크와 맥락을 남겨요. "어디 있지?"를 없애는 목록입니다.</p>
  <div class="board-bar">
    <button class="btn primary" id="arc-add">+ 최종 파일 등록</button>
    <input id="arc-q" placeholder="제목 · 태그 검색" value="${esc(fq)}" style="border:1px solid var(--line);border-radius:8px;padding:7px 11px;width:260px">
  </div>
  <div class="card"><div class="card-b" style="padding:0 6px">
    <table class="arc-table"><thead><tr>
      <th style="width:40%">파일</th><th>버전</th><th>태그</th><th>담당</th><th>날짜</th><th></th>
    </tr></thead><tbody id="arc-body">${fileRows()}</tbody></table>
  </div></div>`;

  const bindEdit = () => main.querySelectorAll('[data-fedit]').forEach(b => b.onclick = () => editFile(b.dataset.fedit, main));
  $('#arc-add').onclick = () => editFile(null, main);
  $('#arc-q').oninput = e => { fq = e.target.value; $('#arc-body').innerHTML = fileRows(); bindEdit(); };
  bindEdit();
}

function editFile(id, main) {
  const db = store.db;
  const a = id ? db.archive.find(x => x.id === id)
    : { title: '', url: '', project: '', version: 'v1.0', tags: '', owner: db.members[0]?.id || '', date: todayISO(), notes: '' };
  openModal(`
    <h2>${id ? '파일 정보 수정' : '최종 파일 등록'}</h2>
    <div class="field"><label>파일 이름</label><input id="a-title" value="${esc(a.title)}" placeholder="예: cADPR Exo 상세페이지 메인비주얼_final"></div>
    <div class="field"><label>파일 링크 (구글 드라이브 / NAS / 피그마)</label><input id="a-url" value="${esc(a.url)}" placeholder="https://drive.google.com/..."></div>
    <div class="frow3">
      <div class="field"><label>버전</label><input id="a-ver" value="${esc(a.version)}"></div>
      <div class="field"><label>날짜</label><input type="date" id="a-date" value="${a.date}"></div>
    </div>
    <div class="frow">
      <div class="field"><label>태그 (쉼표 구분)</label><input id="a-tags" value="${esc(a.tags)}" placeholder="배너, 누끼, 인쇄"></div>
      <div class="field"><label>담당자</label><select id="a-owner">
        ${db.members.map(m => `<option value="${m.id}" ${a.owner === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label>메모</label><textarea id="a-notes">${esc(a.notes)}</textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      ${id ? '<button class="btn danger" id="a-del">삭제</button>' : ''}
      <button class="btn" data-close>취소</button>
      <button class="btn primary" id="a-save">저장</button></div>
  `, body => {
    body.querySelector('#a-save').onclick = () => {
      const v = s => body.querySelector(s).value.trim();
      if (!v('#a-title') || !v('#a-url')) return toast('이름과 링크는 필수예요', true);
      const data = { title: v('#a-title'), url: v('#a-url'), project: a.project || '', version: v('#a-ver'), date: v('#a-date'), tags: v('#a-tags'), owner: v('#a-owner'), notes: v('#a-notes') };
      if (id) Object.assign(a, data); else db.archive.push({ id: uid(), ...data });
      store.save(); closeModal(); toast('저장했어요'); renderArchive(main);
    };
    body.querySelector('#a-del')?.addEventListener('click', () => {
      db.archive = db.archive.filter(x => x.id !== id);
      store.save(); closeModal(); toast('삭제했어요'); renderArchive(main);
    });
  });
}

/* ───────── 인사이트 아카이브 (신규 게시판) ───────── */
function insightItems() {
  let list = store.db.archive.filter(isInsight)
    .sort((a, b) => String(b.createdAt || b.date || '').localeCompare(String(a.createdAt || a.date || ''))); // 최신순
  if (iTag) list = list.filter(a => (a.tags || []).includes(iTag));
  if (iq) {
    const k = iq.toLowerCase();
    list = list.filter(a => {
      const names = (a.tags || []).map(id => tagById(id)?.name || '').join(' ');
      return (a.title + ' ' + names + ' ' + (a.notes || '')).toLowerCase().includes(k);
    });
  }
  return list;
}

function taglineChips() {
  const counts = {};
  store.db.archive.filter(isInsight).forEach(a => (a.tags || []).forEach(id => { counts[id] = (counts[id] || 0) + 1; }));
  const total = store.db.archive.filter(isInsight).length;
  const allChip = `<button data-itag="" class="tag ${iTag === '' ? 'blue' : 'gray'}" style="cursor:pointer;border:none;font:inherit;padding:3px 10px">전체 <b>${total}</b></button>`;
  const chips = tagDefs().filter(t => counts[t.id]).sort((a, b) => counts[b.id] - counts[a.id]).map(t => {
    const on = iTag === t.id;
    return `<button data-itag="${t.id}" style="cursor:pointer;border:1.5px solid ${on ? t.color : 'transparent'};background:${t.color}22;color:${t.color};border-radius:999px;padding:3px 10px;font-size:11.5px;font-weight:600">${esc(t.name)} <b>${counts[t.id]}</b></button>`;
  }).join('');
  return allChip + chips;
}

function insightCards() {
  const canEdit = store.isDesignTeam();
  const items = insightItems();
  if (!items.length) return `<div class="empty" style="padding:20px 4px">${iq || iTag ? '조건에 맞는 인사이트가 없어요' : ('아직 등록된 인사이트가 없어요' + (canEdit ? " — 오른쪽 위 '+ 인사이트 추가'로 첫 글을 남겨보세요" : ''))}</div>`;
  return items.map(a => `
    <div style="border:1px solid var(--line);border-radius:12px;padding:13px 15px;margin-bottom:10px;background:var(--card,#fff)">
      <div style="display:flex;align-items:flex-start;gap:8px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:14.5px;line-height:1.35">${esc(a.title)}</div>
          <div style="margin-top:4px">${(a.tags || []).map(id => tagChip(id)).join('') || '<span class="muted" style="font-size:11.5px">태그 없음</span>'}</div>
        </div>
        ${canEdit ? `<div style="display:flex;gap:5px;flex-shrink:0">
          <button class="btn sm" data-iedit="${a.id}">수정</button>
          <button class="btn sm danger" data-idel="${a.id}">삭제</button></div>` : ''}
      </div>
      ${a.notes ? `<div style="font-size:12.5px;color:var(--muted);margin-top:8px;white-space:pre-wrap">${esc(a.notes)}</div>` : ''}
      <div style="display:flex;align-items:center;gap:10px;margin-top:9px;font-size:11.5px;color:var(--muted)">
        ${a.url ? `<a class="flink" href="${esc(a.url)}" target="_blank" rel="noopener">🔗 링크 열기</a>` : ''}
        <span style="flex:1"></span>
        ${a.author ? `<span>✎ ${esc(a.author)}</span>` : ''}
        <span class="mono">${esc(a.date || '')}</span>
      </div>
    </div>`).join('');
}

function renderInsightTab(main) {
  const canEdit = store.isDesignTeam();
  $('#tab-body').innerHTML = `
  <p class="hint" style="margin:2px 0 12px">디자인팀 인사이트 게시판이에요. 슬랙·웹사이트 등 URL과 제목·태그로 남기면 한 곳에 모여요.
    ${canEdit ? '' : '<b>· 읽기 전용 (디자인팀만 등록·수정)</b>'}</p>
  <div class="board-bar">
    ${canEdit ? '<button class="btn primary" id="ins-add">+ 인사이트 추가</button>' : ''}
    ${canEdit ? '<button class="btn" id="ins-tags">🏷 태그 관리</button>' : ''}
    <input id="ins-q" placeholder="제목 · 태그 · 메모 검색" value="${esc(iq)}" style="border:1px solid var(--line);border-radius:8px;padding:7px 11px;width:240px">
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px" id="ins-chips">${taglineChips()}</div>
  <div id="ins-list">${insightCards()}</div>`;

  const bindCards = () => {
    main.querySelectorAll('[data-iedit]').forEach(b => b.onclick = () => editInsight(b.dataset.iedit, main));
    main.querySelectorAll('[data-idel]').forEach(b => b.onclick = () => {
      if (!store.isDesignTeam()) return toast('디자인팀만 삭제할 수 있어요', true);
      if (!confirm('이 인사이트를 삭제할까요?')) return;
      store.db.archive = store.db.archive.filter(x => x.id !== b.dataset.idel);
      store.save(); toast('삭제했어요'); renderInsightTab(main);
    });
  };
  const addBtn = $('#ins-add'); if (addBtn) addBtn.onclick = () => editInsight(null, main);
  const tagBtn = $('#ins-tags'); if (tagBtn) tagBtn.onclick = () => manageTags(main);
  $('#ins-q').oninput = e => { iq = e.target.value; $('#ins-list').innerHTML = insightCards(); bindCards(); };
  main.querySelectorAll('[data-itag]').forEach(b => b.onclick = () => { iTag = b.dataset.itag; renderInsightTab(main); });
  bindCards();
}

function editInsight(id, main) {
  if (!store.isDesignTeam()) return toast('디자인팀만 등록·수정할 수 있어요', true);
  const db = store.db;
  const a = id ? db.archive.find(x => x.id === id)
    : { title: '', tags: [], url: '', notes: '', author: store.settings.userName || '', date: todayISO() };
  let sel = Array.isArray(a.tags) ? [...a.tags] : [];
  openModal(`
    <h2>${id ? '인사이트 수정' : '인사이트 추가'}</h2>
    <div class="field"><label>제목</label><input id="i-title" value="${esc(a.title)}" placeholder="예: 무신사 신규 브랜드관 UI 레퍼런스"></div>
    <div class="field"><label>태그 (카테고리 · 골라 쓰거나 입력해 추가)</label>
      <div id="i-tags-sel" style="display:flex;flex-wrap:wrap;gap:2px;margin-bottom:6px"></div>
      <input id="i-tags-input" placeholder="태그 검색 · 새 이름 입력 후 Enter" autocomplete="off">
      <div id="i-tags-drop" style="display:flex;flex-wrap:wrap;gap:6px;border:1px solid var(--line);border-radius:8px;margin-top:5px;padding:8px;max-height:180px;overflow:auto"></div>
    </div>
    <div class="field"><label>URL (슬랙 메시지 · 웹사이트 등)</label><input id="i-url" value="${esc(a.url)}" placeholder="https://..."></div>
    <div class="field"><label>메모 (선택)</label><textarea id="i-notes" placeholder="왜 저장했는지 · 참고 포인트">${esc(a.notes)}</textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center">
      <span class="muted" style="font-size:11.5px;margin-right:auto">${id ? `생성자 ${esc(a.author || '—')} · ${esc(a.date || '')}` : `생성자 ${esc(store.settings.userName || '나')}`}</span>
      ${id ? '<button class="btn danger" id="i-del">삭제</button>' : ''}
      <button class="btn" data-close>취소</button>
      <button class="btn primary" id="i-save">저장</button></div>
  `, body => {
    const selBox = body.querySelector('#i-tags-sel');
    const input = body.querySelector('#i-tags-input');
    const drop = body.querySelector('#i-tags-drop');
    const renderSel = () => {
      selBox.innerHTML = sel.map(idv => tagChip(idv, true)).join('') || '<span class="muted" style="font-size:11.5px">선택된 태그 없음</span>';
      selBox.querySelectorAll('[data-rmtag]').forEach(b => b.onclick = () => { sel = sel.filter(x => x !== b.dataset.rmtag); renderSel(); renderDrop(); });
    };
    const renderDrop = () => {
      const kw = input.value.trim().toLowerCase();
      const opts = tagDefs().filter(t => !kw || t.name.toLowerCase().includes(kw));
      const exact = tagDefs().some(t => t.name.toLowerCase() === kw);
      // 옵션을 가로 칩으로 나열 → 폭을 넘으면 다음 줄로 줄바꿈. 칩 = [선택 토글] + [✕ 삭제]
      const optChip = t => {
        const on = sel.includes(t.id);
        return `<span data-optid="${t.id}" title="클릭해 선택/해제" style="cursor:pointer;display:inline-flex;align-items:center;gap:5px;background:${t.color}22;color:${t.color};border:1.5px solid ${on ? t.color : 'transparent'};border-radius:999px;padding:3px 9px;font-size:12px;font-weight:600">
          ${on ? '✓ ' : ''}${esc(t.name)}
          <button data-deltag="${t.id}" title="태그 삭제" style="background:none;border:none;color:inherit;cursor:pointer;font-size:11px;line-height:1;padding:0;opacity:.65">✕</button>
        </span>`;
      };
      const newChip = kw && !exact
        ? `<span data-newtag style="cursor:pointer;display:inline-flex;align-items:center;background:#2563EB1a;color:#2563EB;border:1.5px dashed #2563EB;border-radius:999px;padding:3px 9px;font-size:12px;font-weight:600">+ "${esc(input.value.trim())}" 추가</span>`
        : '';
      drop.innerHTML = (opts.map(optChip).join('') + newChip) || '<span class="muted" style="font-size:11.5px">등록된 태그가 없어요 — 이름을 입력해 추가하세요</span>';
      drop.querySelectorAll('[data-optid]').forEach(el => el.onclick = e => {
        if (e.target.closest('[data-deltag]')) return; // 삭제(✕)는 토글에서 제외
        const idv = el.dataset.optid; sel = sel.includes(idv) ? sel.filter(x => x !== idv) : [...sel, idv]; renderSel(); renderDrop();
      });
      drop.querySelectorAll('[data-deltag]').forEach(b => b.onclick = e => {
        e.stopPropagation();
        const t = tagById(b.dataset.deltag);
        if (!confirm(`태그 "${t?.name || ''}"를 삭제할까요?\n모든 인사이트에서 제거되고 되돌릴 수 없어요.`)) return;
        deleteTagDef(b.dataset.deltag); sel = sel.filter(x => x !== b.dataset.deltag);
        renderSel(); renderDrop();
      });
      const nt = drop.querySelector('[data-newtag]');
      if (nt) nt.onclick = () => { const idv = ensureTagByName(input.value); if (idv && !sel.includes(idv)) sel.push(idv); input.value = ''; store.save(); renderSel(); renderDrop(); };
    };
    input.oninput = renderDrop;
    input.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); const nt = drop.querySelector('[data-newtag]'); if (nt) nt.click(); else { const f = drop.querySelector('[data-optid]'); f && f.click(); } }
    };
    renderSel(); renderDrop();

    body.querySelector('#i-save').onclick = () => {
      const v = s => body.querySelector(s).value.trim();
      if (!v('#i-title')) return toast('제목은 필수예요', true);
      const url = v('#i-url');
      if (url && !/^https?:\/\//i.test(url)) return toast('URL은 http(s):// 로 시작해야 해요', true);
      const data = { title: v('#i-title'), tags: sel, url, notes: v('#i-notes') };
      if (id) Object.assign(a, data);
      else db.archive.push({ id: uid(), kind: 'insight', ...data, author: store.settings.userName || '', date: todayISO(), createdAt: new Date().toISOString() });
      store.save(); closeModal(); toast('저장했어요'); renderInsightTab(main);
    };
    body.querySelector('#i-del')?.addEventListener('click', () => {
      if (!confirm('이 인사이트를 삭제할까요?')) return;
      db.archive = db.archive.filter(x => x.id !== id);
      store.save(); closeModal(); toast('삭제했어요'); renderInsightTab(main);
    });
  });
}

function manageTags(main) {
  if (!store.isDesignTeam()) return toast('디자인팀만 태그를 관리할 수 있어요', true);
  const rowsHtml = () => tagDefs().map(t => `
    <div data-tagrow="${t.id}" style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      ${tagChip(t.id)}
      <input class="t-name" value="${esc(t.name)}" style="flex:1;border:1px solid var(--line);border-radius:7px;padding:5px 8px;font-size:12.5px">
      <div style="display:flex;gap:3px">${TAG_COLORS.map(c => `<button data-color="${c}" title="${c}" style="width:17px;height:17px;border-radius:50%;background:${c};border:${t.color === c ? '2px solid var(--fg,#111)' : '1px solid #ccc'};cursor:pointer;padding:0"></button>`).join('')}</div>
      <button class="btn sm danger" data-tdel="${t.id}">삭제</button>
    </div>`).join('') || '<div class="empty" style="padding:8px">아직 태그가 없어요</div>';
  openModal(`
    <h2>태그 관리</h2>
    <p class="hint" style="margin-top:0">이름·색상을 바꾸면 모든 인사이트에 바로 반영돼요. 삭제하면 인사이트에서도 제거됩니다.</p>
    <div id="tag-mgr">${rowsHtml()}</div>
    <div style="display:flex;gap:6px;margin-top:10px">
      <input id="tnew" placeholder="새 태그 이름" style="flex:1;border:1px solid var(--line);border-radius:8px;padding:7px 10px">
      <button class="btn" id="tadd">+ 추가</button>
    </div>
    <div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="btn primary" id="tdone">완료</button></div>
  `, body => {
    const rebind = () => { body.querySelector('#tag-mgr').innerHTML = rowsHtml(); bind(); };
    function bind() {
      body.querySelectorAll('[data-tagrow]').forEach(row => {
        const t = tagById(row.dataset.tagrow); if (!t) return;
        row.querySelector('.t-name').onchange = e => { const nm = e.target.value.trim(); if (nm) { t.name = nm; store.save(); rebind(); } };
        row.querySelectorAll('[data-color]').forEach(b => b.onclick = () => { t.color = b.dataset.color; store.save(); rebind(); });
        row.querySelector('[data-tdel]').onclick = () => { if (!confirm(`태그 "${t.name}"를 삭제할까요? 모든 인사이트에서 제거돼요.`)) return; deleteTagDef(t.id); rebind(); };
      });
    }
    body.querySelector('#tadd').onclick = () => { const el = body.querySelector('#tnew'); const nm = el.value.trim(); if (!nm) return; ensureTagByName(nm); el.value = ''; store.save(); rebind(); };
    body.querySelector('#tdone').onclick = () => { closeModal(); renderInsightTab(main); };
    bind();
  });
}

/* ───────── 진입점 ───────── */
export function renderArchive(main) {
  migrateInsightTags();
  main.innerHTML = `
  <div class="page-head"><span class="eyebrow">Archive</span>
    <h1>아카이브</h1><p>최종 파일과 디자인팀 인사이트를 한 곳에 모아둬요.</p></div>
  <div class="tabs">
    <button data-atab="files" class="${tab === 'files' ? 'active' : ''}">최종 파일 아카이브</button>
    <button data-atab="insight" class="${tab === 'insight' ? 'active' : ''}">인사이트 아카이브</button>
  </div>
  <div id="tab-body"></div>`;

  main.querySelectorAll('[data-atab]').forEach(b => b.onclick = () => { tab = b.dataset.atab; renderArchive(main); });
  if (tab === 'insight') renderInsightTab(main); else renderFilesTab(main);
}
