/* app.js — 라우터 & 부트스트랩 */
import { store } from './store.js';
import { $, $$ } from './ui.js';
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
    if (!store.hasRemote()) return;
    const ok = await store.pull();
    if (ok) await store.push();
    window.dispatchEvent(new Event('hashchange'));
  };
}

store.onChange(syncBadge);
window.addEventListener('hashchange', route);

(async function boot() {
  store.seedIfEmpty();
  syncBadge();
  route();
  if (store.hasRemote()) {
    await store.pull();   // 팀 최신 데이터 반영
    route();
  }
})();
