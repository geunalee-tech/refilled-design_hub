/* finder.js — 파일 파인더: 인덱스 기반 빠른 검색 + AI 추론 검색 */
import { store } from '../store.js';
import { esc, toast, copyText, $ } from '../ui.js';
import { ai } from '../ai.js';

let index = null; // [{path, name, ext, size, mtime}]

async function loadIndex() {
  if (index) return index;
  // 같은 저장소에 배포된 data/fileindex.json (tools/build_index.py가 생성)
  try {
    const res = await fetch('data/fileindex.json', { cache: 'no-store' });
    if (res.ok) { index = await res.json(); return index; }
  } catch {}
  return null;
}

/* ── 구조화 검색: 검색어를 단어(개념) 단위로 쪼개고, 동의어·붙여쓰기 변형까지 고려해
      "모든 단어를 동시에 만족"하는 파일을 최우선으로 보여줘요. ── */
const SYN = {
  '단상자': ['박스', 'box', '케이스', 'case', '패키지', 'package', 'pkg', '상자', 'carton'],
  '박스': ['단상자', 'box', '케이스', 'case', '상자'],
  '누끼': ['png', 'cutout', '투명', 'transparent', 'clipped', '누끼컷'],
  '최종': ['final', 'fin', '확정'],
  'final': ['최종', 'fin', '확정'],
  '시안': ['draft', '초안'],
  '부스터': ['booster'],
  'booster': ['부스터'],
  '배너': ['banner'],
  'banner': ['배너'],
  '상세': ['상세페이지', 'detail', '상페'],
  '상세페이지': ['상세', 'detail', '상페'],
  '로고': ['logo'],
  'logo': ['로고'],
  '썸네일': ['thumbnail', 'thumb', '섬네일'],
  '영상': ['video', 'mp4', 'mov'],
  '올영': ['올리브영', 'oliveyoung'],
  '올리브영': ['올영', 'oliveyoung'],
  '기획세트': ['기획전', 'set', '세트'],
};
const squash = s => String(s).toLowerCase().replace(/[\s_\-./()\[\]]+/g, '');
const tokenize = q => q.toLowerCase().split(/\s+/).filter(Boolean);
const variants = t => [t, ...(SYN[t] || [])];
const tokenIn = (t, low, sq) => variants(t).some(v => low.includes(v) || sq.includes(squash(v)));

function quickSearch(q, idx) {
  const tokens = tokenize(q);
  const rows = [];
  for (const f of idx) {
    const low = f.path.toLowerCase(), sq = squash(f.path);
    const name = (f.path.split('/').pop() || '').toLowerCase(), nameSq = squash(name);
    const missing = []; let nameHits = 0;
    for (const t of tokens) {
      if (!tokenIn(t, low, sq)) missing.push(t);
      else if (tokenIn(t, name, nameSq)) nameHits++;
    }
    const hit = tokens.length - missing.length;
    if (!hit) continue;
    rows.push({ ...f, hit, nameHits, missing });
  }
  rows.sort((a, b) =>
    b.hit - a.hit                                   // ① 일치한 단어 수 (전체 일치가 항상 위)
    || b.nameHits - a.nameHits                      // ② 파일명 자체에 일치한 단어 수
    || String(b.mtime || '').localeCompare(String(a.mtime || '')) // ③ 최신순
    || a.path.length - b.path.length);
  const full = rows.filter(r => !r.missing.length).slice(0, 30);
  const partial = rows.filter(r => r.missing.length).slice(0, full.length ? 15 : 30);
  return { full, partial, tokens };
}

function prefilter(q, idx) {
  // AI에 보낼 후보군: 동의어 포함 토큰 일치 + 이미지/디자인 확장자 우선, 최대 300개
  const tokens = tokenize(q);
  const scored = idx.map(f => {
    const low = f.path.toLowerCase(), sq = squash(f.path);
    let s = tokens.filter(t => tokenIn(t, low, sq)).length * 10;
    if (/\.(png|psd|ai|jpg|jpeg|tif|svg|webp)$/i.test(f.path)) s += 1;
    return { f, s };
  }).sort((a, b) => b.s - a.s);
  return scored.slice(0, 300).map(x => x.f);
}

const hitRow = (f, q) => {
  let p = esc(f.path);
  const vs = [...new Set(tokenize(q).flatMap(variants))].sort((a, b) => b.length - a.length);
  vs.forEach(t => {
    p = p.replace(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<b>$1</b>');
  });
  return `<div class="find-hit">
    <div><div class="fp">${p}</div>
      ${f.reason ? `<div class="muted" style="font-size:11px;margin-top:2px">→ ${esc(f.reason)}</div>` : ''}
      ${f.missing?.length ? `<div style="font-size:11px;margin-top:2px;color:#B0763A">일부 일치 — 누락된 단어: ${f.missing.map(esc).join(', ')}</div>` : ''}</div>
    <div style="display:flex;gap:8px;align-items:center">
      <span class="fm">${f.ext || ''} ${f.size ? '· ' + (f.size / 1048576).toFixed(1) + 'MB' : ''}${f.mtime ? ' · ' + String(f.mtime).slice(0, 10) : ''}</span>
      ${f.url ? `<a class="btn sm" href="${esc(f.url)}" target="_blank" rel="noopener">드라이브에서 열기 ↗</a>` : `<button class="btn sm" data-cp="${esc(f.path)}">경로 복사</button>`}</div>
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
    ③ <b>구글 드라이브 연동</b>: 저장소의 <span class="mono">tools/drive-index.gs</span> 스크립트를 Apps Script에 붙여넣고 트리거를 걸면, 디자인팀 드라이브 전체가 매일 밤 자동으로 인덱싱돼요. 결과에 "드라이브에서 열기" 버튼이 생깁니다.
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
  const grpHead = (label, n, sub) => `<div style="display:flex;align-items:baseline;gap:8px;margin:14px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--line)">
    <b style="font-size:12.5px">${label}</b><span class="muted" style="font-size:11.5px">${n}건${sub ? ' — ' + esc(sub) : ''}</span></div>`;
  const showGrouped = (r, q) => {
    let html = '';
    if (r.full.length) html += grpHead('모든 단어 일치', r.full.length, r.tokens.join(' + ')) + r.full.map(f => hitRow(f, q)).join('');
    if (r.partial.length) html += grpHead('일부 단어만 일치', r.partial.length, '') + r.partial.map(f => hitRow(f, q)).join('');
    if (!html) html = '<div class="empty">일치하는 파일이 없어요' + (r.tokens.length > 1 ? ' — 단어 수를 줄이거나 "AI 추론 검색"을 눌러보세요' : '') + '</div>';
    $('#fd-results').innerHTML = html;
    $('#fd-count').textContent = (r.full.length + r.partial.length) + '건' + (r.full.length ? ` (전체 일치 ${r.full.length})` : '');
    $('#fd-results').querySelectorAll('[data-cp]').forEach(b => b.onclick = e => copyText(b.dataset.cp, e.target));
  };

  $('#fd-quick').onclick = async () => {
    const q = $('#fd-q').value.trim(); if (!q) return;
    const idx = await loadIndex(); if (!idx) return toast('인덱스가 없어요', true);
    showGrouped(quickSearch(q, idx), q);
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
