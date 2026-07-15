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
  updatedAt: null, seeded: false
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
      { id: 'p-detail', name: '상세페이지 리뉴얼', color: '#2F6B5A', start: t(-10), end: t(14), owner: 'm-yeonwoo' },
      { id: 'p-exo', name: 'cADPR Exo 캠페인', color: '#3E6B8C', start: t(-3), end: t(25), owner: 'm-guena' },
      { id: 'p-global', name: '해외 채널 비주얼', color: '#B97F3B', start: t(0), end: t(30), owner: 'm-minhyun' },
      { id: 'p-ops', name: '팀 운영 · AI 워크플로', color: '#7A5FA0', start: t(-20), end: t(40), owner: 'm-eunseo' },
    ];
    const mk = (title, project, assignee, status, due, source, notes = '') =>
      ({ id: uid(), title, project, assignee, status, due, source, notes, createdAt: new Date().toISOString() });
    const tasks = [
      mk('엑소좀 77% 인포그래픽 최종 시안', 'p-exo', 'm-guena', 'doing', t(0), '디자인팀'),
      mk('상세페이지 성분 섹션 카피 반영', 'p-detail', 'm-yeonwoo', 'doing', t(1), '디자인팀'),
      mk('아마존 A+ 콘텐츠 배너 3종', 'p-global', 'm-minhyun', 'todo', t(3), '디자인팀'),
      mk('프로모션 배너 요청 (7월 기획전)', 'p-detail', 'm-yeonwoo', 'inbox', t(2), '마케팅팀', '메인/서브 2사이즈'),
      mk('프롬프트 프리셋 v2 정리', 'p-ops', 'm-eunseo', 'todo', t(4), '디자인팀'),
      mk('제품 촬영 원본 셀렉 컨펌 대기', 'p-exo', 'm-guena', 'blocked', t(1), '디자인팀', '상현님 컨펌 대기'),
      mk('인스타 릴스 커버 템플릿', 'p-global', 'm-minhyun', 'done', t(-1), 'SNS팀'),
    ];
    this.db.members = m; this.db.projects = p; this.db.tasks = tasks;
    this.db.seeded = true;
    this.save({ push: false });
  }
}

export const store = new Store();
