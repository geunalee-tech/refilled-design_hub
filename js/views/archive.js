/* archive.js — 디자인 최종 파일 아카이브 (링크 + 메타데이터) */
import { store, uid, todayISO } from '../store.js';
import { esc, openModal, closeModal, toast, $ } from '../ui.js';

let q = '';

export function renderArchive(main) {
  const db = store.db;
  let list = db.archive.slice().sort((a, b) => b.date < a.date ? -1 : 1);
  if (q) {
    const k = q.toLowerCase();
    list = list.filter(a => (a.title + a.tags + store.projectName(a.project)).toLowerCase().includes(k));
  }
  main.innerHTML = `
  <div class="page-head"><span class="eyebrow">Final Files</span>
    <h1>파일 아카이브</h1><p>최종 파일은 드라이브/NAS에 두고, 여기엔 링크와 맥락을 남겨요. "어디 있지?"를 없애는 목록입니다.</p></div>
  <div class="board-bar">
    <button class="btn primary" id="arc-add">+ 최종 파일 등록</button>
    <input id="arc-q" placeholder="제목 · 태그 · 프로젝트 검색" value="${esc(q)}"
      style="border:1px solid var(--line);border-radius:8px;padding:7px 11px;width:260px">
  </div>
  <div class="card"><div class="card-b" style="padding:0 6px">
    <table class="arc-table"><thead><tr>
      <th style="width:34%">파일</th><th>프로젝트</th><th>버전</th><th>태그</th><th>담당</th><th>날짜</th><th></th>
    </tr></thead><tbody>
    ${list.map(a => `<tr>
      <td><a class="flink" href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a>
        ${a.notes ? `<div class="muted" style="font-size:11px;margin-top:2px">${esc(a.notes)}</div>` : ''}</td>
      <td>${esc(store.projectName(a.project))}</td>
      <td class="mono">${esc(a.version || '—')}</td>
      <td>${(a.tags || '').split(',').filter(Boolean).map(t => `<span class="tag gray" style="margin:1px">${esc(t.trim())}</span>`).join('')}</td>
      <td>${esc(store.memberName(a.owner))}</td>
      <td class="mono">${a.date?.slice(5) || ''}</td>
      <td><button class="btn sm" data-edit="${a.id}">수정</button></td>
    </tr>`).join('') || `<tr><td colspan="7"><div class="empty">등록된 최종 파일이 없어요</div></td></tr>`}
    </tbody></table>
  </div></div>`;

  $('#arc-add').onclick = () => editItem(null, main);
  $('#arc-q').oninput = e => { q = e.target.value; renderArchive(main); $('#arc-q').focus(); $('#arc-q').setSelectionRange(q.length, q.length); };
  main.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editItem(b.dataset.edit, main));
}

function editItem(id, main) {
  const db = store.db;
  const a = id ? db.archive.find(x => x.id === id)
    : { title: '', url: '', project: db.projects[0]?.id || '', version: 'v1.0', tags: '', owner: db.members[0]?.id || '', date: todayISO(), notes: '' };
  openModal(`
    <h2>${id ? '파일 정보 수정' : '최종 파일 등록'}</h2>
    <div class="field"><label>파일 이름</label><input id="a-title" value="${esc(a.title)}" placeholder="예: cADPR Exo 상세페이지 메인비주얼_final"></div>
    <div class="field"><label>파일 링크 (구글 드라이브 / NAS / 피그마)</label><input id="a-url" value="${esc(a.url)}" placeholder="https://drive.google.com/..."></div>
    <div class="frow3">
      <div class="field"><label>프로젝트</label><select id="a-project">
        ${db.projects.map(p => `<option value="${p.id}" ${a.project === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
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
      const data = { title: v('#a-title'), url: v('#a-url'), project: v('#a-project'), version: v('#a-ver'), date: v('#a-date'), tags: v('#a-tags'), owner: v('#a-owner'), notes: v('#a-notes') };
      if (id) Object.assign(a, data); else db.archive.push({ id: uid(), ...data });
      store.save(); closeModal(); toast('저장했어요'); renderArchive(main);
    };
    body.querySelector('#a-del')?.addEventListener('click', () => {
      db.archive = db.archive.filter(x => x.id !== id);
      store.save(); closeModal(); toast('삭제했어요'); renderArchive(main);
    });
  });
}
