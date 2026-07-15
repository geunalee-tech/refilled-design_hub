/* studio.js — AI 스튜디오: 프롬프트 빌더 · 메일 포맷 · 트렌드 리서치 */
import { store, uid, todayISO } from '../store.js';
import { esc, toast, copyText, $ } from '../ui.js';
import { ai } from '../ai.js';

let tab = 'prompt';

const MOODS = ['투명한 액체', '물방울 클로즈업', '부드러운 자연광', '클리니컬 미니멀', '스파 리추얼', '두피/모발 매크로', '유리 질감', '안개 낀 아침', '따뜻한 뉴트럴 톤', '실험실 유리기구'];
const RATIOS = ['1:1', '4:5', '9:16', '16:9', '3:4'];

/* 오프라인 템플릿 조합 — API 없이도 즉시 생성 */
function buildPrompt({ model, subject, purpose, moods, light, color, comp, ratio }) {
  const moodMap = {
    '투명한 액체': 'transparent liquid formula', '물방울 클로즈업': 'macro water droplets',
    '부드러운 자연광': 'soft diffused natural light', '클리니컬 미니멀': 'clean clinical minimal set',
    '스파 리추얼': 'serene spa ritual atmosphere', '두피/모발 매크로': 'macro scalp and hair strand detail',
    '유리 질감': 'frosted and clear glass textures', '안개 낀 아침': 'misty morning ambience',
    '따뜻한 뉴트럴 톤': 'warm neutral tones', '실험실 유리기구': 'laboratory glassware',
  };
  const m = moods.map(x => moodMap[x] || x).join(', ');
  if (model === 'higgsfield') {
    return `A photorealistic ${purpose || 'product'} shot of ${subject || 'a premium haircare product'}. ${m}. ${light || 'Soft window light with gentle falloff'}. Color palette: ${color || 'ivory, sage green, glass-clear'}. ${comp || 'Centered composition with generous negative space'}. Shot on medium format, 80mm lens, shallow depth of field, editorial beauty photography, Refilled brand mood: clean, clinical yet warm. Aspect ratio ${ratio}.`;
  }
  return `${purpose || 'Premium beauty product scene'}: ${subject || 'a minimal haircare bottle'} surrounded by ${m}. Lighting: ${light || 'soft diffused daylight'}. Colors: ${color || 'ivory, translucent, muted sage'}. Composition: ${comp || 'clean centered layout, ample negative space'}. Style: refined, clinical-warm, high-end Korean beauty brand aesthetic, ultra detailed, ${ratio} aspect ratio.`;
}

export function renderStudio(main) {
  main.innerHTML = `
  <div class="page-head"><span class="eyebrow">AI Studio</span>
    <h1>AI 스튜디오</h1><p>리필드 무드가 내장된 생성 도구예요. API 키가 없어도 프롬프트 빌더는 바로 쓸 수 있어요.</p></div>
  <div class="tabs">
    <button data-tab="prompt" class="${tab === 'prompt' ? 'active' : ''}">프롬프트 빌더</button>
    <button data-tab="mail" class="${tab === 'mail' ? 'active' : ''}">메일 포맷</button>
    <button data-tab="trend" class="${tab === 'trend' ? 'active' : ''}">트렌드 리서치</button>
  </div>
  <div id="studio-body"></div>`;
  main.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; renderStudio(main); });
  ({ prompt: promptTab, mail: mailTab, trend: trendTab }[tab])($('#studio-body'));
}

/* ── 프롬프트 빌더 ── */
function promptTab(root) {
  root.innerHTML = `
  <div class="grid2">
    <div class="card"><div class="card-h"><h3>입력</h3></div><div class="card-b">
      <div class="field"><label>모델</label><select id="pb-model">
        <option value="nanobanana">나노바나나 프로</option>
        <option value="higgsfield">힉스필드 소울 2</option></select></div>
      <div class="field"><label>목적 / 용도</label><input id="pb-purpose" placeholder="예: 상세페이지 히어로 컷"></div>
      <div class="field"><label>피사체</label><input id="pb-subject" placeholder="예: 리필드 세럼 보틀, 손에 든 모습"></div>
      <div class="field"><label>리필드 무드 키워드</label><div class="chips" id="pb-moods">
        ${MOODS.map(m => `<button class="chip" data-mood="${esc(m)}">${esc(m)}</button>`).join('')}</div></div>
      <div class="frow">
        <div class="field"><label>조명</label><input id="pb-light" placeholder="비우면 브랜드 기본값"></div>
        <div class="field"><label>컬러</label><input id="pb-color" placeholder="비우면 브랜드 기본값"></div></div>
      <div class="frow">
        <div class="field"><label>구도</label><input id="pb-comp" placeholder="예: 로우앵글, 여백 강조"></div>
        <div class="field"><label>비율</label><select id="pb-ratio">${RATIOS.map(r => `<option>${r}</option>`).join('')}</select></div></div>
      <div style="display:flex;gap:8px">
        <button class="btn primary" id="pb-gen">프롬프트 생성</button>
        <button class="btn" id="pb-refine">✦ AI로 더 다듬기</button></div>
    </div></div>
    <div class="card"><div class="card-h"><h3>결과 프롬프트</h3></div><div class="card-b">
      <div class="output-box" id="pb-out">무드 키워드를 고르고 "프롬프트 생성"을 눌러주세요.<button class="copy-btn" id="pb-copy">복사</button></div>
      <div class="ai-note">💡 "프롬프트 생성"은 내장 템플릿이라 즉시·무료예요. "AI로 더 다듬기"는 Anthropic API 키가 필요해요 (설정).</div>
    </div></div>
  </div>`;
  const picked = new Set();
  root.querySelectorAll('[data-mood]').forEach(c => c.onclick = () => {
    c.classList.toggle('on');
    c.classList.contains('on') ? picked.add(c.dataset.mood) : picked.delete(c.dataset.mood);
  });
  const params = () => ({
    model: $('#pb-model').value, subject: $('#pb-subject').value.trim(), purpose: $('#pb-purpose').value.trim(),
    moods: [...picked], light: $('#pb-light').value.trim(), color: $('#pb-color').value.trim(),
    comp: $('#pb-comp').value.trim(), ratio: $('#pb-ratio').value,
  });
  const setOut = txt => { $('#pb-out').innerHTML = `${esc(txt)}<button class="copy-btn" id="pb-copy">복사</button>`; $('#pb-copy').onclick = e => copyText(txt, e.target); };
  $('#pb-gen').onclick = () => setOut(buildPrompt(params()));
  $('#pb-refine').onclick = async e => {
    const draft = buildPrompt(params());
    const btn = e.target; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> 다듬는 중';
    try { setOut(await ai.refinePrompt(draft, params().model)); }
    catch (err) { toast(err.message, true); }
    btn.disabled = false; btn.textContent = '✦ AI로 더 다듬기';
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
      <div class="card-b"><div class="mail-out" id="ml-out"><span class="muted">정보를 입력하고 생성을 눌러주세요. (Anthropic API 키 필요)</span></div></div></div>
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

/* ── 트렌드 리서치 ── */
function trendTab(root) {
  const trends = store.db.trends.slice().reverse();
  root.innerHTML = `
  <div class="card" style="margin-bottom:18px"><div class="card-b">
    <label style="font-size:11.5px;font-weight:600;color:var(--muted);display:block;margin-bottom:6px">키워드로 최신 비주얼 트렌드 조사 (웹 검색 기반)</label>
    <div class="search-big"><input id="tr-q" placeholder="예: 뷰티 상세페이지 트렌드, 클린뷰티 패키지, 유리 질감 그래픽">
      <button class="btn primary" id="tr-go">✦ 조사</button></div>
  </div></div>
  <div id="tr-list">${trends.map(t => trendCard(t)).join('') || '<div class="empty">저장된 트렌드 리포트가 없어요</div>'}</div>`;
  $('#tr-go').onclick = async e => {
    const q = $('#tr-q').value.trim();
    if (!q) return toast('키워드를 입력해주세요', true);
    const btn = e.target; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> 조사 중 (30초 내외)';
    try {
      const body = await ai.researchTrend(q);
      store.db.trends.push({ id: uid(), q, body, date: todayISO(), author: store.settings.userName });
      store.save(); renderStudio(document.querySelector('#main'));
      toast('트렌드 리포트를 저장했어요');
    } catch (err) { toast(err.message, true); btn.disabled = false; btn.textContent = '✦ 조사'; }
  };
  root.querySelectorAll('[data-tdel]').forEach(b => b.onclick = () => {
    store.db.trends = store.db.trends.filter(t => t.id !== b.dataset.tdel);
    store.save(); renderStudio(document.querySelector('#main'));
  });
}
const trendCard = t => `<div class="trend-item">
  <div style="display:flex;justify-content:space-between;align-items:center">
    <h4>${esc(t.q)}</h4>
    <span style="display:flex;gap:8px;align-items:center"><span class="mono muted">${t.date}</span>
    <button class="btn sm danger" data-tdel="${t.id}">삭제</button></span></div>
  <div class="trend-body">${esc(t.body)}</div></div>`;
