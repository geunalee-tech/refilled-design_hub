/* studio.js — AI 스튜디오: 프롬프트 빌더(3타입·이미지 참조) · 메일 포맷 · 트렌드 리서치 */
import { store } from '../store.js';
import { esc, toast, copyText, $ } from '../ui.js';
import { ai, SOUL_GUIDE } from '../ai.js';

let tab = 'prompt';

const RATIOS = ['1:1', '4:5', '9:16', '16:9', '3:4', '2:3'];

/* ── 프롬프트 빌더: 3가지 타입 ── */
const PB_TYPES = [
  { id: 'midjourney', name: '미드저니', desc: '한 줄 프롬프트 + --ar 등 파라미터. 무드·컨셉 탐색에 강해요.' },
  { id: 'nanobanana', name: '나노바나나 프로', desc: '참조 이미지와 함께 쓰는 구조화 프롬프트. 제품 디자인 보존·합성에 강해요.' },
  { id: 'higgsfield', name: '힉스필드 소울 2.0', desc: '텍스트 전용 — 레퍼런스의 모든 시각 정보를 글로 변환해요. (이미지+텍스트 동시 입력 불가)' },
];
const IMG_ROLES = ['무드·조명 레퍼런스', '히어로 제품', '보조 제품 / 소품', '모델·인물 레퍼런스', '구도 레퍼런스', '기타 참고'];
const MAX_IMGS = 5;

let pbType = 'nanobanana';
let pbImages = []; // [{mime, data(base64), preview(dataURL), role, name}]

/* 이미지 리사이즈(긴 변 1280px, JPEG) → API 전송량·토큰 절약 */
function fileToRef(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 1280;
      const sc = Math.min(1, MAX / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      const dataURL = cv.toDataURL('image/jpeg', 0.87);
      URL.revokeObjectURL(url);
      resolve({ mime: 'image/jpeg', data: dataURL.split(',')[1], preview: dataURL, role: IMG_ROLES[0], name: file.name });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(file.name + ' 을 이미지로 읽지 못했어요')); };
    img.src = url;
  });
}

export function renderStudio(main) {
  main.innerHTML = `
  <div class="page-head"><span class="eyebrow">AI Studio</span>
    <h1>AI 스튜디오</h1><p>리필드 무드가 내장된 생성 도구예요. 프롬프트 빌더는 레퍼런스 이미지를 최대 ${MAX_IMGS}장까지 읽고 생성해요.</p></div>
  <div class="tabs">
    <button data-tab="prompt" class="${tab === 'prompt' ? 'active' : ''}">프롬프트 빌더</button>
    <button data-tab="mail" class="${tab === 'mail' ? 'active' : ''}">메일 포맷</button>
  </div>
  <div id="studio-body"></div>`;
  main.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; renderStudio(main); });
  ({ prompt: promptTab, mail: mailTab }[tab] || promptTab)($('#studio-body'));
}

/* ── 프롬프트 빌더 ── */
function promptTab(root) {
  root.innerHTML = `
  <div class="card" style="margin-bottom:14px"><div class="card-b">
    <label style="font-size:11.5px;font-weight:600;color:var(--muted);display:block;margin-bottom:8px">어떤 도구용 프롬프트인가요?</label>
    <div id="pb-types" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
      ${PB_TYPES.map(t => `<button class="pb-type ${pbType === t.id ? 'on' : ''}" data-type="${t.id}"
        style="text-align:left;border:1.5px solid ${pbType === t.id ? 'var(--accent)' : 'var(--line)'};background:${pbType === t.id ? 'rgba(45,106,255,.06)' : '#fff'};border-radius:10px;padding:10px 12px;cursor:pointer">
        <b style="font-size:13px;display:block;margin-bottom:3px">${esc(t.name)}</b>
        <span class="muted" style="font-size:11px;line-height:1.5">${esc(t.desc)}</span></button>`).join('')}
    </div>
  </div></div>
  <div class="grid2">
    <div class="card"><div class="card-h"><h3>입력</h3></div><div class="card-b">
      <div class="field"><label>레퍼런스 이미지 (최대 ${MAX_IMGS}장) — 무드·제품·구도를 AI가 읽고 프롬프트에 녹여요</label>
        <div id="pb-drop" style="border:1.5px dashed var(--line);border-radius:10px;padding:14px;text-align:center;font-size:12px;color:var(--muted);cursor:pointer">
          클릭하거나 이미지를 끌어다 놓으세요 (${pbImages.length}/${MAX_IMGS})</div>
        <input type="file" id="pb-file" accept="image/*" multiple hidden>
        <div id="pb-previews" style="display:flex;flex-direction:column;gap:6px;margin-top:8px"></div></div>
      <div class="field"><label>목적 / 용도</label><input id="pb-purpose" placeholder="예: 상세페이지 히어로 컷, 기획세트 KV"></div>
      <div class="field"><label>피사체</label><input id="pb-subject" placeholder="예: 리필드 부스터 + 세럼 2종 제품 연출"></div>
      <div class="field"><label>추가 디렉션 (선택)</label><textarea id="pb-direction" rows="3" placeholder="예: 물기 있는 아크릴 선반 위, 부스터가 주인공, 단상자는 배경에 은은하게"></textarea></div>
      <div class="frow">
        <div class="field"><label>비율</label><select id="pb-ratio">${RATIOS.map(r => `<option>${r}</option>`).join('')}</select></div>
        <div class="field"><label>&nbsp;</label><button class="btn primary" id="pb-gen" style="width:100%">✦ 프롬프트 생성</button></div></div>
      <div class="ai-note">💡 이미지를 첨부하면 AI가 무드·조명·구도·제품을 분석해 타입별 형식으로 변환해요. Gemini(무료) 또는 Anthropic 키 필요 (설정).</div>
    </div></div>
    <div class="card"><div class="card-h"><h3>결과 프롬프트</h3></div><div class="card-b">
      <div class="output-box" id="pb-out">타입을 고르고, 레퍼런스와 정보를 넣은 뒤 "프롬프트 생성"을 눌러주세요.<button class="copy-btn" id="pb-copy">복사</button></div>
      <div id="pb-note" style="margin-top:10px"></div>
      <div id="pb-guide" style="margin-top:10px"></div>
    </div></div>
  </div>`;

  /* 타입 선택 */
  root.querySelectorAll('.pb-type').forEach(b => b.onclick = () => { pbType = b.dataset.type; promptTab(root); });

  /* 이미지 업로드 */
  const drawPreviews = () => {
    $('#pb-drop').textContent = `클릭하거나 이미지를 끌어다 놓으세요 (${pbImages.length}/${MAX_IMGS})`;
    $('#pb-previews').innerHTML = pbImages.map((im, i) => `
      <div style="display:flex;gap:10px;align-items:center;border:1px solid var(--line);border-radius:10px;padding:6px 8px">
        <img src="${im.preview}" style="width:52px;height:52px;object-fit:cover;border-radius:8px;flex:none">
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;font-weight:600;margin-bottom:3px">Image ${i + 1} <span class="muted" style="font-weight:400">· ${esc(im.name)}</span></div>
          <select data-role="${i}" style="width:100%;font-size:11.5px;border:1px solid var(--line);border-radius:6px;padding:3px 6px">
            ${IMG_ROLES.map(r => `<option ${im.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
        <button class="btn sm danger" data-rm="${i}">✕</button>
      </div>`).join('');
    $('#pb-previews').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { pbImages.splice(+b.dataset.rm, 1); drawPreviews(); });
    $('#pb-previews').querySelectorAll('[data-role]').forEach(s => s.onchange = () => { pbImages[+s.dataset.role].role = s.value; });
  };
  drawPreviews();

  const addFiles = async files => {
    for (const f of [...files]) {
      if (pbImages.length >= MAX_IMGS) { toast(`이미지는 최대 ${MAX_IMGS}장까지예요`, true); break; }
      if (!f.type.startsWith('image/')) continue;
      try { pbImages.push(await fileToRef(f)); } catch (e) { toast(e.message, true); }
    }
    drawPreviews();
  };
  $('#pb-drop').onclick = () => $('#pb-file').click();
  $('#pb-file').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
  $('#pb-drop').ondragover = e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--accent)'; };
  $('#pb-drop').ondragleave = e => { e.currentTarget.style.borderColor = 'var(--line)'; };
  $('#pb-drop').ondrop = e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--line)'; addFiles(e.dataTransfer.files); };

  /* 생성 */
  const setOut = full => {
    // '---' 앞부분 = 붙여넣을 프롬프트, 뒷부분 = 한국어 노트
    const cut = full.split(/\n-{3,}\n/);
    const promptPart = cut[0].trim();
    const notePart = cut.slice(1).join('\n---\n').trim();
    $('#pb-out').innerHTML = `${esc(promptPart)}<button class="copy-btn" id="pb-copy">프롬프트 복사</button>`;
    $('#pb-copy').onclick = e => copyText(promptPart, e.target);
    $('#pb-note').innerHTML = notePart
      ? `<div style="border:1px solid var(--line);border-radius:10px;padding:12px 14px;font-size:12px;line-height:1.7;background:#fff;white-space:pre-wrap">${esc(notePart)}</div>` : '';
    $('#pb-guide').innerHTML = pbType === 'higgsfield'
      ? `<details style="border:1px solid var(--line);border-radius:10px;padding:10px 14px;background:#fff">
          <summary style="font-size:12px;font-weight:600;cursor:pointer">힉스필드 Soul 2.0 사용 가이드 (펼치기)</summary>
          <div style="font-size:12px;line-height:1.75;margin-top:8px;white-space:pre-wrap">${esc(SOUL_GUIDE)}</div></details>` : '';
  };
  $('#pb-gen').onclick = async e => {
    const btn = e.target; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> 생성 중';
    try {
      const out = await ai.buildImagePrompt({
        type: pbType,
        purpose: $('#pb-purpose').value.trim(),
        subject: $('#pb-subject').value.trim(),
        direction: $('#pb-direction').value.trim(),
        ratio: $('#pb-ratio').value,
        images: pbImages,
      });
      setOut(out);
    } catch (err) { toast(err.message, true); }
    btn.disabled = false; btn.textContent = '✦ 프롬프트 생성';
  };
  $('#pb-copy').onclick = () => toast('먼저 프롬프트를 생성해주세요');
}

/* ── 메일 포맷 ── */
function mailTab(root) {
  root.innerHTML = `
  <div class="grid2">
    <div class="card"><div class="card-h"><h3>메일 정보</h3></div><div class="card-b">
      <div class="field"><label>받는 대상</label><input id="ml-to" placeholder="예: 마케팅팀 이OO 매니저님"></div>
      <div class="field"><label>목적 / 성격</label><input id="ml-purpose" placeholder="예: 시안 전달 및 피드백 요청"></div>
      <div class="field"><label>핵심 포인트</label><textarea id="ml-points" placeholder="예: 배너 2종 첨부, 수요일까지 피드백 필요, 카피는 확정본 기준"></textarea></div>
      <div class="frow">
        <div class="field"><label>키워드 (선택)</label><input id="ml-kw" placeholder="예: 7월 기획전, 엑소좀"></div>
        <div class="field"><label>톤</label><select id="ml-tone">
          <option>정중한 기본</option><option>간결한 실무</option><option>부드러운 요청</option><option>공식적/대외</option></select></div></div>
      <button class="btn primary" id="ml-gen">✦ 메일 생성</button>
    </div></div>
    <div class="card"><div class="card-h"><h3>생성된 메일</h3><button class="btn sm" id="ml-copy">복사</button></div>
      <div class="card-b"><div class="mail-out" id="ml-out"><span class="muted">정보를 입력하고 생성을 눌러주세요.</span></div></div></div>
  </div>`;
  let lastMail = '';
  $('#ml-gen').onclick = async e => {
    const btn = e.target; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> 작성 중';
    try {
      lastMail = await ai.composeMail({
        to: $('#ml-to').value, purpose: $('#ml-purpose').value,
        points: $('#ml-points').value, keywords: $('#ml-kw').value, tone: $('#ml-tone').value,
      });
      $('#ml-out').textContent = lastMail;
    } catch (err) { toast(err.message, true); }
    btn.disabled = false; btn.textContent = '✦ 메일 생성';
  };
  $('#ml-copy').onclick = e => lastMail ? copyText(lastMail, e.target) : toast('먼저 메일을 생성해주세요');
}
