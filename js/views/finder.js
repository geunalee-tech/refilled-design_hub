/* finder.js — 파일 파인더: 인덱스 기반 빠른 검색 + AI 추론 검색 */
import { store } from '../store.js';
import { esc, toast, copyText, $ } from '../ui.js';
import { ai } from '../ai.js';

let index = null; // [{path, name, ext, size, mtime}]

async function loadIndex() {
  if (index) return index;
  // 1) 같은 저장소에 배포된 data/fileindex.json 시도
  try {
    const res = await fetch('data/fileindex.json', { cache: 'no-store' });
    if (res.ok) { index = await res.json(); return index; }
  } catch {}
  // 2) GitHub API 시도 (설정된 경우)
  if (store.hasRemote()) {
    try {
      const url = `https://api.github.com/repos/${store.settings.repo}/contents/data/fileindex.json?ref=${store.settings.branch || 'main'}`;
      const res = await fetch(url, { headers: store.ghHeaders() });
      if (res.ok) {
        const j = await res.json();
        index = JSON.parse(decodeURIComponent(escape(atob(j.content.replace(/\n/g, '')))));
        return index;
      }
    } catch {}
  }
  return null;
}

function quickSearch(q, idx) {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  return idx
    .map(f => {
      const hay = f.path.toLowerCase();
      const hit = tokens.filter(t => hay.includes(t)).length;
      return { ...f, score: hit };
    })
    .filter(f => f.score > 0)
    .sort((a, b) => b.score - a.score || a.path.length - b.path.length)
    .slice(0, 30);
}

function prefilter(q, idx) {
  // AI에 보낼 후보군: 토큰 부분일치 + 이미지/디자인 확장자 우선, 최대 300개
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = idx.map(f => {
    const hay = f.path.toLowerCase();
    let s = tokens.filter(t => hay.includes(t)).length * 10;
    if (/\.(png|psd|ai|jpg|jpeg|tif|svg|webp)$/i.test(f.path)) s += 1;
    return { f, s };
  }).sort((a, b) => b.s - a.s);
  return scored.slice(0, 300).map(x => x.f);
}

const hitRow = (f, q) => {
  let p = esc(f.path);
  q.toLowerCase().split(/\s+/).filter(Boolean).forEach(t => {
    p = p.replace(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<b>$1</b>');
  });
  return `<div class="find-hit">
    <div><div class="fp">${p}</div>
      ${f.reason ? `<div class="muted" style="font-size:11px;margin-top:2px">→ ${esc(f.reason)}</div>` : ''}</div>
    <div style="display:flex;gap:8px;align-items:center">
      <span class="fm">${f.ext || ''} ${f.size ? '· ' + (f.size / 1048576).toFixed(1) + 'MB' : ''}</span>
      <button class="btn sm" data-cp="${esc(f.path)}">경로 복사</button></div>
  </div>`;
};

export function renderFinder(main) {
  main.innerHTML = `
  <div class="page-head"><span class="eyebrow">File Finder</span>
    <h1>파일 파인더</h1><p>"루미 누끼"처럼 경로에 단어가 없어도, AI 추론 검색이 폴더 구조와 파일명 관례로 찾아내요.</p></div>
  <div class="card" style="margin-bottom:16px"><div class="card-b">
    <div class="search-big"><input id="fd-q" placeholder="예: 루미 누끼, 7월 배너 최종, 엑소좀 인포그래픽 psd">
      <button class="btn" id="fd-quick">빠른 검색</button>
      <button class="btn primary" id="fd-ai">✦ AI 추론 검색</button></div>
    <div class="ai-note" id="fd-status">인덱스를 확인하는 중...</div>
  </div></div>
  <div class="card"><div class="card-h"><h3>검색 결과</h3><span class="sub" id="fd-count"></span></div>
    <div class="card-b" id="fd-results"><div class="empty">검색어를 입력해주세요</div></div></div>
  <div class="mt card"><div class="card-h"><h3>인덱스 만드는 방법</h3></div><div class="card-b" style="font-size:12.5px;line-height:1.7">
    ① 저장소의 <span class="mono">tools/build_index.py</span>를 팀 공유 드라이브가 연결된 PC에서 실행:<br>
    <span class="mono" style="background:#182420;color:#DCE8E2;padding:3px 8px;border-radius:6px;display:inline-block;margin:6px 0">python tools/build_index.py "D:/디자인팀" </span><br>
    ② 생성된 <span class="mono">fileindex.json</span>을 저장소 <span class="mono">data/</span> 폴더에 커밋하면 팀 전체가 검색할 수 있어요.<br>
    ③ 주기적으로(주 1회 등) 다시 실행해서 갱신하면 됩니다. GitHub Actions로 자동화도 가능해요.
  </div></div>`;

  const status = $('#fd-status');
  loadIndex().then(idx => {
    status.textContent = idx
      ? `✓ 인덱스 로드 완료 — 파일 ${idx.length.toLocaleString()}개 검색 가능`
      : '아직 인덱스가 없어요. 아래 "인덱스 만드는 방법"을 따라 fileindex.json을 먼저 만들어주세요.';
  });

  const show = (list, q) => {
    $('#fd-results').innerHTML = list.map(f => hitRow(f, q)).join('') || '<div class="empty">일치하는 파일이 없어요</div>';
    $('#fd-count').textContent = list.length + '건';
    $('#fd-results').querySelectorAll('[data-cp]').forEach(b => b.onclick = e => copyText(b.dataset.cp, e.target));
  };

  $('#fd-quick').onclick = async () => {
    const q = $('#fd-q').value.trim(); if (!q) return;
    const idx = await loadIndex(); if (!idx) return toast('인덱스가 없어요', true);
    show(quickSearch(q, idx), q);
  };
  $('#fd-ai').onclick = async e => {
    const q = $('#fd-q').value.trim(); if (!q) return;
    const idx = await loadIndex(); if (!idx) return toast('인덱스가 없어요', true);
    const btn = e.target; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> 추론 중';
    try { show(await ai.inferFiles(q, prefilter(q, idx)), q); }
    catch (err) { toast(err.message, true); }
    btn.disabled = false; btn.textContent = '✦ AI 추론 검색';
  };
  $('#fd-q').onkeydown = e => { if (e.key === 'Enter') $('#fd-quick').click(); };
}
