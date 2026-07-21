/* settings.js — 설정: 구성원(읽기 전용) · API 키 · 슬랙 알림 · 문제 해결 */
import { store } from '../store.js';
import { esc, toast, $ } from '../ui.js';

/* 팀장(리더)을 목록 맨 위에 — 직책 기준 */
const isLeader = m => /팀장|리드|lead/i.test(m.role || '') ? 1 : 0;

export function renderSettings(main) {
  const db = store.db;
  main.innerHTML = `
  <div class="page-head"><span class="eyebrow">Settings</span>
    <h1>설정</h1><p>팀 알림과 구성원 정보를 확인해요. AI·팀 동기화는 사내 로그인만 돼 있으면 자동이에요 (좌측 하단 배지에서 상태 확인).</p></div>

  <div class="grid2">
    <div class="card"><div class="card-h"><h3>디자인팀 구성원</h3></div><div class="card-b">
      <p class="hint" style="margin-top:0">업무 보드에서 담당자로 지정할 수 있는 목록이에요 — 사내 디렉토리에서 자동 동기화돼요.</p>
      <div id="s-members" style="margin:8px 0">
        ${[...db.members].sort((a, b) => isLeader(b) - isLeader(a)).map(m => `<div class="goal-row" data-mid="${m.id}">
          <span class="gt">${isLeader(m) ? '👑 ' : ''}${esc(m.name)} <span class="muted" style="font-size:11px">${esc(m.role || '')}</span></span></div>`).join('')
          || '<p class="hint">팀 동기화가 연결되면 자동으로 채워져요</p>'}
      </div>
      <p class="hint">입사·퇴사는 사내 디렉토리(data.constanthub.kr) 기준으로 반영돼요. 목록이 비어 있으면 좌측 하단 배지로 연결 상태를 확인해주세요.</p>
    </div></div>

    <div class="card"><div class="card-h"><h3>AI 기능</h3></div><div class="card-b">
      <p class="hint" style="margin-top:0">메일 생성·트렌드 리서치·AI 추론 검색·프롬프트 다듬기에 쓰여요. <b>키 설정이 필요 없어요</b> — 회사 키가 서버에 등록돼 있어 사내 로그인만 돼 있으면 바로 사용돼요.</p>
      <div class="ai-note">API 키는 서버(환경변수)에만 있고 브라우저로 전송되지 않아요. 사용량은 회사 계정에서 관리돼요.</div>
    </div></div>

    <div class="card"><div class="card-h"><h3>팀 알림 (Slack)</h3></div><div class="card-b">
      <div class="field"><label>Incoming Webhook URL${store.slackWebhookFixed ? ' <span class="muted" style="font-weight:400">(서버 고정 · 테크팀 관리)</span>' : ''}</label>
        <input id="s-slack" type="password" placeholder="https://hooks.slack.com/services/..." value="${esc(store.slackWebhook)}"${store.slackWebhookFixed ? ' readonly style="background:#F6F7F9;color:var(--muted);cursor:default"' : ''}></div>
      <div style="display:flex;gap:8px">
        ${store.slackWebhookFixed ? '' : '<button class="btn primary" id="s-slack-save">저장</button>'}
        <button class="btn" id="s-slack-test">테스트 전송</button>
      </div>
      <p class="hint">${store.slackWebhookFixed ? '이 웹훅은 <b>서버 환경변수(<code>SLACK_WEBHOOK</code>)로 고정</b>돼 있어요 — 브라우저 저장분처럼 사라지지 않아요. 변경은 Vercel 환경변수에서 하세요(테크팀). ' : ''}새 <b>요청 업무</b>·<b>컨펌요청</b> 알림은 <b>디자인팀 업무 요청 알림</b> 봇(서버 <code>SLACK_BOT_TOKEN</code>/<code>SLACK_CHANNEL_ID</code>, 테크팀 설정)으로 발송돼요 — 컨펌요청 시 원 메시지 스레드에 댓글+멘션이 달리려면 봇이 필요합니다(스코프 <code>chat:write</code>, 채널에 봇 초대).<br>아래 <b>웹훅</b>은 봇 미설정 시 폴백 + '일정 협의 요청' 발송용이에요(스레드 댓글 불가).${store.slackWebhookFixed ? '' : ' 웹훅은 팀 공유 데이터(Supabase)에 저장돼 팀원 모두에게 적용됩니다.'}</p>
    </div></div>

    <div class="card"><div class="card-h"><h3>문제 해결</h3></div><div class="card-b">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn danger" id="s-reset">서버에서 다시 불러오기</button></div>
      <div class="ai-note">팀 데이터는 Supabase에 저장·백업돼요. 화면이 이상하거나 데이터가 안 맞아 보이면 이 버튼을 눌러주세요 — 이 브라우저의 캐시를 지우고 팀 데이터를 처음부터 다시 받아와요 (팀 데이터는 안전해요).</div>
    </div></div>
  </div>`;

  const saveBtn = $('#s-slack-save');
  if (saveBtn) saveBtn.onclick = () => {
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

  $('#s-reset').onclick = () => {
    if (!confirm('이 브라우저의 캐시를 지우고 팀 데이터를 서버에서 다시 받아올까요? (팀 데이터는 유지됩니다)')) return;
    localStorage.removeItem('rfhub_db_v1'); location.reload();
  };
}
