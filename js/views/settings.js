/* settings.js — 설정: 팀 동기화 · API 키 · 팀원 관리 · 백업 */
import { store, uid } from '../store.js';
import { esc, toast, $ } from '../ui.js';

export function renderSettings(main) {
  const s = store.settings, db = store.db;
  main.innerHTML = `
  <div class="page-head"><span class="eyebrow">Settings</span>
    <h1>설정</h1><p>팀 공유 동기화와 AI 기능을 연결해요. 키는 이 브라우저에만 저장됩니다.</p></div>

  <div class="grid2">
    <div class="card"><div class="card-h"><h3>내 정보 · 팀원</h3></div><div class="card-b">
      <div class="field"><label>내 이름 (커밋/문서 작성자에 표시)</label><input id="s-name" value="${esc(s.userName)}" placeholder="예: 근아"></div>
      <label style="font-size:11.5px;font-weight:600;color:var(--muted)">팀원 목록</label>
      <div id="s-members" style="margin:8px 0">
        ${db.members.map(m => `<div class="goal-row" data-mid="${m.id}">
          <span class="gt">${esc(m.name)} <span class="muted" style="font-size:11px">${esc(m.role || '')}</span></span>
          <button class="btn sm danger" data-mdel="${m.id}">✕</button></div>`).join('')}
      </div>
      <div style="display:flex;gap:6px">
        <input id="s-new-mname" placeholder="이름" style="flex:1;border:1px solid var(--line);border-radius:8px;padding:8px 10px">
        <input id="s-new-mrole" placeholder="역할" style="flex:1;border:1px solid var(--line);border-radius:8px;padding:8px 10px">
        <button class="btn sm" id="s-madd">추가</button></div>
    </div></div>

    <div class="card"><div class="card-h"><h3>팀 공유 동기화 (GitHub)</h3></div><div class="card-b">
      <div class="field"><label>저장소 (owner/repo)</label><input id="s-repo" value="${esc(s.repo)}" placeholder="예: refilled-design/hub"></div>
      <div class="frow">
        <div class="field"><label>브랜치</label><input id="s-branch" value="${esc(s.branch)}" placeholder="main"></div>
        <div class="field"><label>GitHub 토큰 (fine-grained PAT)</label><input id="s-token" type="password" value="${esc(s.githubToken)}" placeholder="github_pat_..."></div></div>
      <div style="display:flex;gap:8px">
        <button class="btn primary" id="s-sync-save">저장 후 연결 테스트</button>
        <button class="btn" id="s-pull">지금 불러오기</button>
        <button class="btn" id="s-push">지금 올리기</button></div>
      <div class="ai-note">토큰은 이 저장소 하나에 <b>Contents: Read and write</b> 권한만 주면 돼요. 팀원 각자 자기 토큰을 넣으면 커밋 기록으로 누가 수정했는지 남습니다.</div>
    </div></div>

    <div class="card"><div class="card-h"><h3>AI 기능 (Anthropic)</h3></div><div class="card-b">
      <div class="field"><label>Anthropic API 키</label><input id="s-akey" type="password" value="${esc(s.anthropicKey)}" placeholder="sk-ant-..."></div>
      <button class="btn primary" id="s-akey-save">저장</button>
      <div class="ai-note">메일 생성·트렌드 리서치·AI 추론 검색·프롬프트 다듬기에 사용돼요. 콘솔에서 <b>월 예산 한도</b>를 꼭 설정한 팀 공용 키를 권장합니다. 키는 서버로 전송되지 않고 각자 브라우저(localStorage)에만 저장돼요.</div>
    </div></div>

    <div class="card"><div class="card-h"><h3>팀 알림 (Slack)</h3></div><div class="card-b">
      <div class="field"><label>Incoming Webhook URL</label>
        <input id="s-slack" type="password" placeholder="https://hooks.slack.com/services/..." value="${esc(store.slackWebhook)}"></div>
      <div style="display:flex;gap:8px">
        <button class="btn primary" id="s-slack-save">저장</button>
        <button class="btn" id="s-slack-test">테스트 전송</button>
      </div>
      <p class="hint">새 <b>요청 업무</b>가 등록되면 디자인팀 채널로 알림이 가요. 웹훅은 팀 공유 데이터에 저장돼 팀원 모두에게 적용됩니다. 발급: Slack 앱 → <b>Incoming Webhooks</b> → 채널 선택 → URL 복사. 저장소가 Public이면 웹훅이 노출될 수 있으니 Private 저장소를 권장해요.</p>
    </div></div>

    <div class="card"><div class="card-h"><h3>데이터 백업</h3></div><div class="card-b">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="s-export">JSON 내보내기</button>
        <label class="btn" style="cursor:pointer">JSON 가져오기<input type="file" id="s-import" accept=".json" hidden></label>
        <button class="btn danger" id="s-reset">로컬 데이터 초기화</button></div>
      <div class="ai-note">GitHub 동기화를 켜면 모든 변경이 커밋으로 남아 자동 백업돼요. 이 버튼들은 로컬 전용 백업용입니다.</div>
    </div></div>
  </div>`;

  $('#s-name').onchange = e => { s.userName = e.target.value.trim(); store.saveSettings(); toast('저장했어요'); };

  $('#s-madd').onclick = () => {
    const name = $('#s-new-mname').value.trim();
    if (!name) return;
    db.members.push({ id: uid(), name, role: $('#s-new-mrole').value.trim() });
    store.save(); renderSettings(main);
  };
  main.querySelectorAll('[data-mdel]').forEach(b => b.onclick = () => {
    db.members = db.members.filter(m => m.id !== b.dataset.mdel);
    store.save(); renderSettings(main);
  });

  const saveSync = () => {
    s.repo = $('#s-repo').value.trim(); s.branch = $('#s-branch').value.trim() || 'main';
    s.githubToken = $('#s-token').value.trim(); store.saveSettings();
  };
  $('#s-sync-save').onclick = async () => {
    saveSync();
    if (!store.hasRemote()) return toast('저장소와 토큰을 입력해주세요', true);
    const ok = await store.pull();
    toast(ok ? '연결 성공! 팀 데이터와 동기화됐어요' : '연결 실패 — 저장소 이름과 토큰 권한을 확인해주세요', !ok);
    window.dispatchEvent(new Event('hashchange'));
  };
  $('#s-pull').onclick = async () => { saveSync(); await store.pull(); toast('최신 데이터를 불러왔어요'); window.dispatchEvent(new Event('hashchange')); };
  $('#s-push').onclick = async () => { saveSync(); await store.push(); toast(store.status === 'synced' ? '팀 저장소에 올렸어요' : '업로드 실패', store.status !== 'synced'); };

  $('#s-akey-save').onclick = () => { s.anthropicKey = $('#s-akey').value.trim(); store.saveSettings(); toast('API 키를 저장했어요'); };

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
  $('#s-import').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try { store.db = JSON.parse(r.result); store.save(); toast('가져오기 완료'); renderSettings(main); }
      catch { toast('JSON 형식이 올바르지 않아요', true); }
    };
    r.readAsText(f);
  };
  $('#s-reset').onclick = () => {
    if (!confirm('이 브라우저의 로컬 데이터를 모두 지울까요? (GitHub의 팀 데이터는 유지됩니다)')) return;
    localStorage.removeItem('rfhub_db_v1'); location.reload();
  };
}
