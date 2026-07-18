/* app.js — 라우터 & 부트스트랩 */
import { store } from './store.js';
import { $, $$, toast } from './ui.js';
import { renderDashboard } from './views/dashboard.js';
import { renderTasks } from './views/tasks.js';
import { renderRituals } from './views/rituals.js';
import { renderArchive } from './views/archive.js';
import { renderStudio } from './views/studio.js';
import { renderFinder } from './views/finder.js';
import { renderSettings } from './views/settings.js';

const routes = {
  dashboard: renderDashboard,
  tasks: renderTasks,
  rituals: renderRituals,
  archive: renderArchive,
  studio: renderStudio,
  finder: renderFinder,
  settings: renderSettings,
};

function route() {
  const parts = (location.hash || '#/dashboard').replace('#/', '').split('?')[0].split('/');
  const key = parts[0];
  const render = routes[key] || renderDashboard;
  $$('#nav a, .settings-link').forEach(a => a.classList.toggle('active', a.dataset.route === key));
  render($('#main'), parts.slice(1).join('/'));
}

function syncBadge() {
  const b = $('#sync-badge');
  const map = {
    local: ['로컬 모드', ''],
    syncing: ['동기화 중…', 'on'],
    synced: ['팀 동기화 ✓', 'on'],
    error: ['동기화 오류', 'err'],
  };
  const [label, cls] = map[store.status] || map.local;
  b.textContent = label;
  b.className = 'sync-badge ' + cls;
  b.title = store.status === 'error'
    ? `오류: ${store.lastError || '알 수 없음'} — 클릭하면 다시 동기화해요`
    : (store.hasRemote() ? '클릭하면 최신 데이터를 다시 불러와요' : '설정에서 GitHub를 연결하면 팀 공유가 켜져요');
  b.style.cursor = store.hasRemote() ? 'pointer' : 'default';
  b.onclick = async () => {
    if (!store.hasRemote()) return toast('설정에서 GitHub 저장소·토큰을 먼저 연결해주세요', true);
    toast('다시 동기화하는 중…');
    await store.push();               // 충돌 시 자동 병합 후 재시도
    if (store.status === 'error') {
      toast(`동기화 오류: ${store.lastError || '알 수 없는 문제'} — 설정에서 토큰·저장소를 확인해주세요`, true);
    } else {
      await store.pull();
      toast('동기화 완료 — 최신 데이터예요');
    }
    window.dispatchEvent(new Event('hashchange'));
  };
}

store.onChange(syncBadge);
window.addEventListener('hashchange', route);

/* 구글 로그인 상태 표시 (hub_u 쿠키 = 로그인 사용자 정보) */
function authBox() {
  const box = $('#auth-box');
  if (!box) return;
  const raw = document.cookie.split(/;\s*/).find(c => c.startsWith('hub_u='));
  if (!raw) return; // 게이트 미설정 or 로컬 테스트 → 표시 안 함
  try {
    const u = JSON.parse(decodeURIComponent(raw.slice(6)));
    box.hidden = false;
    box.innerHTML = `<span class="au-name" title="${u.e || ''}">👤 ${u.n || u.e}</span>
      <a href="/api/auth/logout" class="au-out">로그아웃</a>`;
  } catch {}
}

(async function boot() {
  store.seedIfEmpty();
  authBox();
  syncBadge();
  route();
  if (store.hasRemote()) {
    await store.pull();   // 팀 최신 데이터 반영
    route();
  }
})();
