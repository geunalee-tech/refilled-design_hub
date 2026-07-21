/* settings.js — 설정: 팀 동기화 · API 키 · 팀원 관리 · 백업 */
import { store } from '../store.js';
import { esc, toast, $ } from '../ui.js';

export function renderSettings(main) {
  const s = store.settings, db = store.db;
  main.innerHTML = `
  <div class="page-head"><span class="eyebrow">Settings</span>
    <h1>설정</h1><p>AI 기능과 팀 알림을 연결해요. 키는 이 브라우저에만 저장됩니다. (팀 동기화는 자동 — 좌측 하단 배지에서 상태 확인)</p></div>

  <div class="grid2">
    <div class="card"><div class="card-h"><h3>내 정보 · 팀원</h3></div><div class="card-b">
      <div class="field"><label>내 이름 (문서 작성자·대시보드 인사에 표시)</label>
        <div class="gt" style="padding:8px 2px">${esc(s.userName) || '<span class="muted">사내 로그인 후 디렉토리에서 자동으로 채워져요</span>'}</div></div>
      <label style="font-size:11.5px;font-weight:600;color:var(--muted)">팀원 목록 <span style="font-weight:400">(사내 디렉토리 자동 동기화)</span></label>
      <div id="s-members" style="margin:8px 0">
        ${db.members.map(m => `<div class="goal-row" data-mid="${m.id}">
          <span class="gt">${esc(m.name)} <span class="muted" style="font-size:11px">${esc(m.role || '')}</span></span></div>`).join('')
          || '<p class="hint">팀 동기화가 연결되면 디자인팀 구성원이 자동으로 채워져요</p>'}
      </div>
      <p class="hint">입사·퇴사는 사내 디렉토리(data.constanthub.kr) 기준으로 반영돼요. 목록이 비어 있으면 좌측 하단 배지로 연결 상태를 확인해주세요.</p>
    </div></div>

    <div class="card"><div class="card-h"><h3>AI 기능</h3></div><div class="card-b">
      <div class="field"><label>Google Gemini API 키 <span class="muted" style="font-weight:400">(무료 · 권장)</span></label>
        <input id="s-gkey" type="password" value="${esc(s.geminiKey || '')}" placeholder="AIza..."></div>
      <div class="field"><label>Anthropic API 키 <span class="muted" style="font-weight:400">(선택 · 종량 과금)</span></label>
        <input id="s-akey" type="password" value="${esc(s.anthropicKey)}" placeholder="sk-ant-..."></div>
      <button class="btn primary" id="s-akey-save">저장</button>
      <div class="ai-note">메일 생성·트렌드 리서치·AI 추론 검색·프롬프트 다듬기에 사용돼요. <b>Gemini 키는 aistudio.google.com/apikey에서 구글 로그인만으로 무료 발급</b>되고, Gemini 키가 있으면 그걸 우선 사용해요. 키는 서버로 전송되지 않고 각자 브라우저(localStorage)에만 저장돼요.</div>
    </div></div>

    <div class="card"><div class="card-h"><h3>팀 알림 (Slack)</h3></div><div class="card-b">
      <div class="field"><label>Incoming Webhook URL</label>
        <input id="s-slack" type="password" placeholder="https://hooks.slack.com/services/..." value="${esc(store.slackWebhook)}"></div>
      <div style="display:flex;gap:8px">
        <button class="btn primary" id="s-slack-save">저장</button>
        <button class="btn" id="s-slack-test">테스트 전송</button>
      </div>
      <p class="hint">새 <b>요청 업무</b>가 등록되면 디자인팀 채널로 알림이 가요. 웹훅은 팀 공유 데이터(Supabase, 사내 구성원만 접근)에 저장돼 팀원 모두에게 적용됩니다. 발급: Slack 앱 → <b>Incoming Webhooks</b> → 채널 선택 → URL 복사.</p>
    </div></div>

    <div class="card"><div class="card-h"><h3>문제 해결</h3></div><div class="card-b">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="s-export">JSON 내보내기</button>
        <button class="btn danger" id="s-reset">서버에서 다시 불러오기</button></div>
      <div class="ai-note">팀 데이터는 Supabase에 저장·백업돼요. 화면이 이상하거나 데이터가 안 맞아 보이면 <b>"서버에서 다시 불러오기"</b>를 눌러주세요 — 이 브라우저의 캐시를 지우고 팀 데이터를 처음부터 다시 받아와요 (팀 데이터는 안전해요). 내보내기는 데이터를 파일로 뽑아 볼 때 쓰는 버튼이에요.</div>
    </div></div>
  </div>`;

  $('#s-akey-save').onclick = () => {
    s.geminiKey = $('#s-gkey').value.trim();
    s.anthropicKey = $('#s-akey').value.trim();
    store.saveSettings(); toast('API 키를 저장했어요');
  };

  $('#s-slack-save').onclick = () => {
    const url = $('#s-slack').value.trim();
    if (url && !url.startsWith('https://hooks.slack.com/')) return toast('슬랙 웹훅 URL 형식이 아니에요 (https://hooks.slack.com/...)', true);
    store.slackWebhook = url;
    toast(url ? '슬랙 웹훅을 저장했어요' : '슬랙 알림을 껐어요');
  };
  $('#s-slack-test').onclick = async () => {
    const url = $('#s-slack').value.trim() || store.slackWebhook;
    if (!url) return toast('웹훅 URL을 먼저 입력해주세요', true);
    if ($('#s-slack').value.trim()) store.slackWebhook = $('#s-slack').value.trim();
    await store.notifySlack(':white_check_mark: Refilled Design Hub 알림 테스트예요. 이 메시지가 보이면 연결 성공!');
    toast('테스트를 보냈어요 — 슬랙 채널을 확인해주세요');
  };

  $('#s-export').onclick = () => {
    const blob = new Blob([JSON.stringify(store.db, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `refilled-hub-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
  $('#s-reset').onclick = () => {
    if (!confirm('이 브라우저의 캐시를 지우고 팀 데이터를 서버에서 다시 받아올까요? (팀 데이터는 유지됩니다)')) return;
    localStorage.removeItem('rfhub_db_v1'); location.reload();
  };
}
