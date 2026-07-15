/* store.js — 단일 원천 데이터 스토어
   로컬(localStorage) 우선 + GitHub 저장소(data/db.json)를 팀 공유 DB로 동기화 */

const LS_DB = 'rfhub_db_v1';
const LS_SET = 'rfhub_settings_v1';

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const todayISO = (offset = 0) => {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

const DEFAULT_DB = {
  tasks: [], projects: [], members: [], rituals: [], archive: [], trends: [],
  config: {}, updatedAt: null, seeded: false
};

function loadJSON(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}

class Store {
  constructor() {
    this.db = { ...DEFAULT_DB, ...loadJSON(LS_DB, {}) };
    this.settings = loadJSON(LS_SET, {
      userName: '', repo: '', branch: 'main', githubToken: '', anthropicKey: ''
    });
    this.migrate();
    this.sha = null;          // GitHub 파일 sha (충돌 방지용)
    this.status = 'local';    // local | synced | syncing | error
    this.listeners = [];
    this._pushTimer = null;
  }

  onChange(fn) { this.listeners.push(fn); }
  emit() { this.listeners.forEach(f => f()); }

  saveSettings() { localStorage.setItem(LS_SET, JSON.stringify(this.settings)); }

  save({ push = true } = {}) {
    this.db.updatedAt = new Date().toISOString();
    localStorage.setItem(LS_DB, JSON.stringify(this.db));
    this.emit();
    if (push && this.hasRemote()) this.schedulePush();
  }

  hasRemote() { return !!(this.settings.githubToken && this.settings.repo); }

  ghUrl() {
    return `https://api.github.com/repos/${this.settings.repo}/contents/data/db.json` +
      (this.settings.branch ? `?ref=${this.settings.branch}` : '');
  }
  ghHeaders() {
    return {
      'Authorization': `Bearer ${this.settings.githubToken}`,
      'Accept': 'application/vnd.github+json'
    };
  }

  async pull() {
    if (!this.hasRemote()) return false;
    this.status = 'syncing'; this.emit();
    try {
      const res = await fetch(this.ghUrl(), { headers: this.ghHeaders() });
      if (res.status === 404) { this.status = 'synced'; this.sha = null; this.emit(); return true; } // 파일 없음 → 첫 push에서 생성
      if (!res.ok) throw new Error('GitHub 응답 ' + res.status);
      const json = await res.json();
      this.sha = json.sha;
      const remote = JSON.parse(decodeURIComponent(escape(atob(json.content.replace(/\n/g, '')))));
      // 최신 쪽 우선 (last-write-wins)
      if (!this.db.updatedAt || (remote.updatedAt && remote.updatedAt > this.db.updatedAt)) {
        this.db = { ...DEFAULT_DB, ...remote };
        this.migrate();
        localStorage.setItem(LS_DB, JSON.stringify(this.db));
      }
      this.status = 'synced'; this.emit();
      return true;
    } catch (e) {
      console.error(e); this.status = 'error'; this.emit(); return false;
    }
  }

  schedulePush() {
    clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => this.push(), 1200); // 연속 편집 디바운스
  }

  async push(retry = true) {
    if (!this.hasRemote()) return;
    this.status = 'syncing'; this.emit();
    try {
      const content = btoa(unescape(encodeURIComponent(JSON.stringify(this.db, null, 2))));
      const body = {
        message: `hub: ${this.settings.userName || 'member'} 데이터 업데이트`,
        content, branch: this.settings.branch || 'main'
      };
      if (this.sha) body.sha = this.sha;
      const res = await fetch(this.ghUrl().split('?')[0], {
        method: 'PUT', headers: this.ghHeaders(), body: JSON.stringify(body)
      });
      if (res.status === 409 || res.status === 422) {
        // 다른 팀원이 먼저 저장함 → 최신 sha 받아서 1회 재시도
        if (retry) { await this.pull(); return this.push(false); }
        throw new Error('동기화 충돌');
      }
      if (!res.ok) throw new Error('GitHub 저장 실패 ' + res.status);
      const json = await res.json();
      this.sha = json.content.sha;
      this.status = 'synced'; this.emit();
    } catch (e) {
      console.error(e); this.status = 'error'; this.emit();
    }
  }

  /* ── 편의 메서드 ── */
  member(id) { return this.db.members.find(m => m.id === id); }
  project(id) { return this.db.projects.find(p => p.id === id); }
  memberName(id) { return this.member(id)?.name || '미지정'; }
  projectName(id) { return this.project(id)?.name || '기타'; }
  assigneeNames(t) {
    const ids = t.assignees || (t.assignee ? [t.assignee] : []);
    return ids.map(id => this.memberName(id)).join(', ') || '미지정';
  }

  /* ── 구버전 데이터 → 신규 스키마 마이그레이션 ── */
  migrate() {
    if (!this.db.config) this.db.config = {};
    const map = { inbox: 'req', todo: 'req', blocked: 'confirm' };
    (this.db.tasks || []).forEach(t => {
      if (map[t.status]) t.status = map[t.status];
      if (!t.assignees) t.assignees = t.assignee ? [t.assignee] : [];
      delete t.assignee;
      if (t.requester === undefined) {
        t.requester = (t.source && t.source !== '디자인팀') ? t.source : '';
        delete t.source;
      }
      if (!t.kind) t.kind = t.requester ? 'request' : 'project';
      if (!t.priority) t.priority = '중간';
      if (t.link === undefined) t.link = '';
      if (!Array.isArray(t.files)) t.files = [];
      if (!t.requestedAt) t.requestedAt = (t.createdAt || new Date().toISOString()).slice(0, 10);
      if (t.status === 'done' && !t.doneAt) t.doneAt = t.requestedAt;
    });
  }

  /* ── 첨부 파일 업로드: 저장소 files/ 폴더에 커밋 ── */
  async uploadAttachment(fileName, base64) {
    if (!this.hasRemote()) throw new Error('GitHub 연결이 필요해요 (설정에서 저장소·토큰 등록)');
    const safe = fileName.replace(/[\/\\?%*:|"<>]/g, '_');
    const path = `files/${Date.now().toString(36)}_${safe}`;
    const url = `https://api.github.com/repos/${this.settings.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
    const res = await fetch(url, {
      method: 'PUT', headers: this.ghHeaders(),
      body: JSON.stringify({ message: `hub: 첨부 업로드 (${this.settings.userName || 'member'})`, content: base64, branch: this.settings.branch || 'main' })
    });
    if (!res.ok) throw new Error('업로드 실패 ' + res.status);
    const json = await res.json();
    return { name: fileName, url: json.content.download_url };
  }

  /* ── Slack 알림 (Incoming Webhook) ── */
  get slackWebhook() {
    try { return this.db.config?.slackHookB64 ? atob(this.db.config.slackHookB64) : ''; }
    catch { return ''; }
  }
  set slackWebhook(url) {
    this.db.config.slackHookB64 = url ? btoa(url) : '';
    this.save();
  }
  async notifySlack(text, blocks = null) {
    const hook = this.slackWebhook;
    if (!hook) return false;
    // no-cors 단순 요청: 프리플라이트 없이 슬랙이 수신 (응답은 확인 불가)
    await fetch(hook, {
      method: 'POST', mode: 'no-cors',
      body: JSON.stringify(blocks ? { text, blocks } : { text })
    });
    return true;
  }
  notifyNewRequest(t) {
    const hook = this.slackWebhook;
    if (!hook) return;
    const appUrl = location.origin + location.pathname;
    const proj = this.projectName(t.project);
    const lines = [
      `:inbox_tray: *새 요청 업무가 등록됐어요*`,
      `*업무:* ${t.title}`,
      `*프로젝트:* ${proj}`,
      `*요청일:* ${t.requestedAt || '-'}   *마감일:* ${t.due || '미정'}`,
      `*요청자:* ${t.requester || '미기재'}   *담당:* ${this.assigneeNames(t)}`,
      t.link ? `*작업 링크:* ${t.link}` : '',
      t.notes ? `*메모:* ${t.notes}` : '',
      `<${appUrl}#/tasks/requests|→ 업무 보드에서 확인>`
    ].filter(Boolean);
    this.notifySlack(lines.join('\n')).catch(() => {});
  }

  seedIfEmpty() {
    if (this.db.seeded || this.db.tasks.length || this.db.members.length) return;
    const t = todayISO;
    const m = [
      { id: 'm-guena', name: '근아', role: '팀장 · BX 리드' },
      { id: 'm-yeonwoo', name: '김연우', role: '시니어 디자이너' },
      { id: 'm-eunseo', name: '김은서', role: '인턴 · AI 워크플로' },
      { id: 'm-minhyun', name: '민현', role: '인턴 · 해외 채널' },
    ];
    const p = [
      { id: 'p-detail', name: '상세페이지 리뉴얼', color: '#006DE2', start: t(-10), end: t(14), owner: 'm-yeonwoo' },
      { id: 'p-exo', name: 'cADPR Exo 캠페인', color: '#0F7B5F', start: t(-3), end: t(25), owner: 'm-guena' },
      { id: 'p-global', name: '해외 채널 비주얼', color: '#B7791F', start: t(0), end: t(30), owner: 'm-minhyun' },
      { id: 'p-ops', name: '팀 운영 · AI 워크플로', color: '#6B5CA5', start: t(-20), end: t(40), owner: 'm-eunseo' },
    ];
    const mk = (title, project, assignees, status, due, requester, notes = '', priority = '중간') =>
      ({ id: uid(), kind: requester ? 'request' : 'project', title, project, assignees, status, due,
         requester, priority, link: '', files: [], notes,
         requestedAt: t(0), createdAt: new Date().toISOString(),
         ...(status === 'done' ? { doneAt: t(-1) } : {}) });
    const tasks = [
      mk('엑소좀 77% 인포그래픽 최종 시안', 'p-exo', ['m-guena'], 'doing', t(0), ''),
      mk('상세페이지 성분 섹션 카피 반영', 'p-detail', ['m-yeonwoo'], 'doing', t(1), ''),
      mk('아마존 A+ 콘텐츠 배너 3종', 'p-global', ['m-minhyun'], 'req', t(3), ''),
      mk('프로모션 배너 요청 (7월 기획전)', 'p-detail', ['m-yeonwoo', 'm-guena'], 'req', t(2), '마케팅팀 이지수', '메인/서브 2사이즈', '높음'),
      mk('프롬프트 프리셋 v2 정리', 'p-ops', ['m-eunseo'], 'req', t(4), ''),
      mk('제품 촬영 원본 셀렉', 'p-exo', ['m-guena'], 'confirm', t(1), '', '상현님 컨펌 대기'),
      mk('인스타 릴스 커버 템플릿', 'p-global', ['m-minhyun'], 'done', t(-1), 'SNS팀 박서연'),
    ];
    this.db.members = m; this.db.projects = p; this.db.tasks = tasks;
    this.db.seeded = true;
    this.save({ push: false });
  }
}

export const store = new Store();
