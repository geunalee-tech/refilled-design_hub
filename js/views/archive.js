/* archive.js — 아카이브
 *  · 최종 파일 아카이브: 최종 파일 링크 + 메타데이터 (기존)
 *  · 인사이트 아카이브: 디자인팀 인사이트 게시판 (URL·제목·태그라인·메모)  ← 신규
 * 저장은 기존 archive 테이블 공유, kind='insight' 로 구분 (새 테이블 불필요 → 동기화 안전).
 * 생성/수정/삭제는 디자인팀만 (store.isDesignTeam, UI 게이트). 읽기는 로그인 전원.
 */
import { store, uid, todayISO } from '../store.js';
import { esc, openModal, closeModal, toast, $ } from '../ui.js';

let tab = 'files';   // files | insight
let fq = '';         // 파일 탭 검색어
let iq = '';         // 인사이트 탭 검색어
let iTag = '';       // 인사이트 태그라인 필터

const isInsight = a => a.kind === 'insight';
const splitTags = s => (s || '').split(',').map(t => t.trim()).filter(Boolean);

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
  if (iTag) list = list.filter(a => splitTags(a.tagline).includes(iTag));
  if (iq) { const k = iq.toLowerCase(); list = list.filter(a => (a.title + ' ' + (a.tagline || '') + ' ' + (a.notes || '')).toLowerCase().includes(k)); }
  return list;
}

function taglineChips() {
  const counts = {};
  store.db.archive.filter(isInsight).forEach(a => splitTags(a.tagline).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
  const total = store.db.archive.filter(isInsight).length;
  const chip = (val, label, n) => `<button class="tag ${iTag === val ? 'blue' : 'gray'}" data-itag="${esc(val)}"
      style="cursor:pointer;border:none;font:inherit;padding:3px 9px">${esc(label)}${n != null ? ` <b>${n}</b>` : ''}</button>`;
  const tags = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  return chip('', '전체', total) + tags.map(t => chip(t, t, counts[t])).join('');
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
          <div style="margin-top:4px">${splitTags(a.tagline).map(t => `<span class="tag gray" style="margin:1px 3px 1px 0">${esc(t)}</span>`).join('') || '<span class="muted" style="font-size:11.5px">태그라인 없음</span>'}</div>
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
  <p class="hint" style="margin:2px 0 12px">디자인팀 인사이트 게시판이에요. 슬랙·웹사이트 등 URL과 제목·태그라인으로 남기면 한 곳에 모여요.
    ${canEdit ? '' : '<b>· 읽기 전용 (디자인팀만 등록·수정)</b>'}</p>
  <div class="board-bar">
    ${canEdit ? '<button class="btn primary" id="ins-add">+ 인사이트 추가</button>' : ''}
    <input id="ins-q" placeholder="제목 · 태그라인 · 메모 검색" value="${esc(iq)}" style="border:1px solid var(--line);border-radius:8px;padding:7px 11px;width:260px">
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
  const addBtn = $('#ins-add');
  if (addBtn) addBtn.onclick = () => editInsight(null, main);
  // 검색: 목록만 갱신 (한글 조합 유지)
  $('#ins-q').oninput = e => { iq = e.target.value; $('#ins-list').innerHTML = insightCards(); bindCards(); };
  // 태그라인 필터: 칩 클릭 → 탭 재렌더
  main.querySelectorAll('[data-itag]').forEach(b => b.onclick = () => { iTag = b.dataset.itag; renderInsightTab(main); });
  bindCards();
}

function editInsight(id, main) {
  if (!store.isDesignTeam()) return toast('디자인팀만 등록·수정할 수 있어요', true);
  const db = store.db;
  const a = id ? db.archive.find(x => x.id === id)
    : { title: '', tagline: '', url: '', notes: '', author: store.settings.userName || '', date: todayISO() };
  openModal(`
    <h2>${id ? '인사이트 수정' : '인사이트 추가'}</h2>
    <div class="field"><label>제목</label><input id="i-title" value="${esc(a.title)}" placeholder="예: 무신사 신규 브랜드관 UI 레퍼런스"></div>
    <div class="field"><label>태그라인 (카테고리 · 쉼표로 여러 개)</label><input id="i-tag" value="${esc(a.tagline)}" placeholder="예: UI참고, 컬러, 경쟁사"></div>
    <div class="field"><label>URL (슬랙 메시지 · 웹사이트 등)</label><input id="i-url" value="${esc(a.url)}" placeholder="https://..."></div>
    <div class="field"><label>메모 (선택)</label><textarea id="i-notes" placeholder="왜 저장했는지 · 참고 포인트">${esc(a.notes)}</textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center">
      <span class="muted" style="font-size:11.5px;margin-right:auto">${id ? `생성자 ${esc(a.author || '—')} · ${esc(a.date || '')}` : `생성자 ${esc(store.settings.userName || '나')}`}</span>
      ${id ? '<button class="btn danger" id="i-del">삭제</button>' : ''}
      <button class="btn" data-close>취소</button>
      <button class="btn primary" id="i-save">저장</button></div>
  `, body => {
    body.querySelector('#i-save').onclick = () => {
      const v = s => body.querySelector(s).value.trim();
      if (!v('#i-title')) return toast('제목은 필수예요', true);
      const url = v('#i-url');
      if (url && !/^https?:\/\//i.test(url)) return toast('URL은 http(s):// 로 시작해야 해요', true);
      const data = { title: v('#i-title'), tagline: v('#i-tag'), url, notes: v('#i-notes') };
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

/* ───────── 진입점 ───────── */
export function renderArchive(main) {
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
