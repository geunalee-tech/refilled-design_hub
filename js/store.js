import { mentionizeNames } from './slackmap.js';
/* store.js — 단일 원천 데이터 스토어
   로컬(localStorage) 우선 + GitHub 저장소(data/db.json)를 팀 공유 DB로 동기화 */

const LS_DB = 'rfhub_db_v1';
const LS_SET = 'rfhub_settings_v1';

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
/* 로컬(사용자 시간대) 기준 날짜 헬퍼 — toISOString은 UTC라 한국(UTC+9)에서 하루가 밀려요 */
export const localISO = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDaysISO = (iso, n = 0) => {
  const [y, m, dd] = iso.split('-').map(Number);
  return localISO(new Date(y, m - 1, dd + n));
};
export const todayISO = (offset = 0) => addDaysISO(localISO(new Date()), offset);

const DEFAULT_DB = {
  tasks: [], projects: [], members: [], rituals: [], archive: [], trends: [],
  config: {}, guardLog: [], updatedAt: null, seeded: false
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
    this._snap = {};          // 항목별 스냅샷 (변경 감지 → mt 스탬프용)
    this.rebuildSnap();
  }

  /* ── 항목 단위 수정시각(mt) ──
     save() 때 스냅샷과 비교해 실제로 바뀐 항목에만 mt를 찍어요.
     병합 시 같은 id가 충돌하면 mt가 최신인 쪽이 이겨서,
     오래 열어둔 다른 탭이 낡은 데이터로 최신 변경을 되돌리는 걸 막아요. */
  static ARR_KEYS = ['tasks', 'projects', 'members', 'rituals', 'archive', 'trends'];
  _sig(item) { const { mt, ...rest } = item; return JSON.stringify(rest); }
  rebuildSnap() {
    this._snap = {};
    Store.ARR_KEYS.forEach(k => (this.db[k] || []).forEach(it =>
      it && it.id && (this._snap[k + ':' + it.id] = this._sig(it))));
  }
  stampChanged() {
    const now = new Date().toISOString();
    Store.ARR_KEYS.forEach(k => (this.db[k] || []).forEach(it => {
      if (!it || !it.id) return;
      if (this._snap[k + ':' + it.id] !== this._sig(it)) it.mt = now;
    }));
    this.rebuildSnap();
  }
  static newer(a, b) { // 같은 id 충돌 → mt 최신 승, 없거나 같으면 a(로컬) 우선
    const ma = a?.mt || a?.createdAt || '', mb = b?.mt || b?.createdAt || '';
    return mb > ma ? b : a;
  }

  onChange(fn) { this.listeners.push(fn); }
  emit() { this.listeners.forEach(f => f()); }

  saveSettings() { localStorage.setItem(LS_SET, JSON.stringify(this.settings)); }

  save({ push = true } = {}) {
    this.stampChanged();
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
      if (this.db.seeded === true) {
        // 로컬이 데모 시드 상태 → 팀 데이터를 통째로 받아들여요 (샘플이 팀 DB에 섞이지 않게)
        this.db = { ...DEFAULT_DB, ...remote };
        this.migrate(); this.rebuildSnap();
        localStorage.setItem(LS_DB, JSON.stringify(this.db));
        this.status = 'synced'; this.emit();
        return true;
      }
      // 항목 단위 병합: 원격 최신은 받아들이고, 아직 푸시 못 한 내 변경(mt 최신)은 지켜요
      const before = JSON.stringify({ ...remote, updatedAt: 0 });
      this.db = { ...DEFAULT_DB, ...this.mergeDb(remote) };
      this.migrate();
      this.rebuildSnap();                       // 병합 결과에 내 mt가 새로 찍히지 않게
      localStorage.setItem(LS_DB, JSON.stringify(this.db));
      if (JSON.stringify({ ...this.db, updatedAt: 0 }) !== before) this.schedulePush(); // 로컬이 이긴 부분이 있으면 원격에도 반영
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

  /* 원격 db.json을 읽기만 (로컬 상태 안 건드림) */
  async fetchRemote() {
    const res = await fetch(this.ghUrl(), { headers: this.ghHeaders() });
    if (!res.ok) throw new Error('GitHub 응답 ' + res.status);
    const json = await res.json();
    return { sha: json.sha, db: JSON.parse(decodeURIComponent(escape(atob(json.content.replace(/\n/g, ''))))) };
  }

  /* 충돌 병합: 같은 항목은 '더 최근에 수정된 쪽(mt)'이 이겨요.
     mt가 없거나 같으면 로컬 우선 (기존 동작 유지) */
  mergeDb(remote) {
    const byId = arr => Object.fromEntries((arr || []).map(x => [x.id, x]));
    const mergeArr = (loc, rem) => {
      const L = byId(loc), R = byId(rem);
      return [...new Set([...Object.keys(R), ...Object.keys(L)])]
        .map(id => (id in L && id in R) ? Store.newer(L[id], R[id]) : (L[id] || R[id]));
    };
    const L = this.db, R = remote || {};
    return {
      ...R, ...L,
      tasks: mergeArr(L.tasks, R.tasks),
      projects: mergeArr(L.projects, R.projects),
      members: mergeArr(L.members, R.members),
      rituals: mergeArr(L.rituals, R.rituals),
      archive: mergeArr(L.archive, R.archive),
      trends: mergeArr(L.trends, R.trends),
      guardLog: [...(R.guardLog || []), ...(L.guardLog || []).filter(g => !(R.guardLog || []).some(r => r.at === g.at))],
      config: { ...(R.config || {}), ...(L.config || {}) },
      updatedAt: new Date().toISOString()
    };
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
        // 원격이 먼저 바뀜 (노션 미러링·다른 팀원) → 병합 후 1회 재시도
        if (retry) {
          const remote = await this.fetchRemote();
          this.db = this.mergeDb(remote.db);
          this.sha = remote.sha;
          this.migrate();
          this.rebuildSnap();                   // 원격에서 받아온 항목에 내 mt가 찍히지 않게
          this.save({ push: false });
          return this.push(false);
        }
        throw new Error('동기화 충돌 — 다시 시도해주세요');
      }
      if (!res.ok) throw new Error('GitHub 저장 실패 ' + res.status);
      const json = await res.json();
      this.sha = json.content.sha;
      this.status = 'synced'; this.emit();
    } catch (e) {
      console.error(e); this.lastError = String(e.message || e);
      this.status = 'error'; this.emit();
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
    if (!Array.isArray(this.db.guardLog)) this.db.guardLog = [];
    /* 가중목 문서 정리: 시간대 버그로 생긴 같은 주차 중복 문서를 하나로 통합
       (내용이 많은 것 → mt 최신 → id 순으로 대표를 뽑아 모든 클라이언트가 같은 결과) */
    if (Array.isArray(this.db.rituals)) {
      const monOf = iso => {
        try {
          const [y, m, d] = String(iso).split('-').map(Number);
          const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() - (dt.getDay() + 6) % 7);
          return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
        } catch { return String(iso); }
      };
      const score = r => { const d = r.data || {};
        return (d.commitments || []).length * 10
          + Object.values(d.leadWeek || {}).reduce((s, v) => s + (+v || 0), 0)
          + Object.keys(d.lagMonth || {}).length + (d.evalNote ? 1 : 0); };
      const pick = arr => [...arr].sort((a, b) =>
        score(b) - score(a) || String(b.mt || '').localeCompare(String(a.mt || '')) || String(a.id).localeCompare(String(b.id)))[0];
      const weeks = {};
      this.db.rituals.filter(r => r.type === 'goals' && r.date).forEach(r => {
        const k = monOf(r.date); (weeks[k] = weeks[k] || []).push(r);
      });
      const drop = new Set();
      Object.entries(weeks).forEach(([k, arr]) => {
        const keep = pick(arr);
        keep.date = k; // 날짜를 해당 주 월요일로 정규화
        arr.forEach(r => { if (r !== keep) drop.add(r.id); });
      });
      const cfgs = this.db.rituals.filter(r => r.type === 'goals-config');
      if (cfgs.length > 1) { const keep = pick(cfgs); cfgs.forEach(r => { if (r !== keep) drop.add(r.id); }); }
      if (drop.size) this.db.rituals = this.db.rituals.filter(r => !drop.has(r.id));
    }
    // 노션 미러링 업무의 id를 전체 UUID 기반으로 통일 + 중복 id 복구 (구버전 12자리 id 충돌 해결)
    const seenIds = new Set();
    (this.db.tasks || []).forEach(t => {
      if (t.notionId) {
        const nid = 'nt_' + String(t.notionId).replace(/-/g, '');
        if (t.id !== nid) t.id = nid;
      }
    });
    (this.db.tasks || []).forEach(t => {
      while (seenIds.has(t.id)) t.id = t.id + '_' + Math.random().toString(36).slice(2, 6);
      seenIds.add(t.id);
    });

    // 멤버 목록이 비어 있으면 디자인팀 기본 구성으로 복구
    if (!Array.isArray(this.db.members) || this.db.members.length === 0) {
      this.db.members = [
        { id: 'm-geuna', name: '이근아', role: '팀장' },
        { id: 'm-yeonwoo', name: '김연우', role: '시니어' },
        { id: 'm-minhyeon', name: '방민현', role: '인턴' },
      ];
    }
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
    return { name: fileName, url: json.content.download_url, path };
  }

  /* ── 첨부 파일 직접 다운로드 (GitHub API로 받아 blob 저장) ── */
  async downloadAttachment(f) {
    try {
      if (f.path && this.hasRemote()) {
        const url = `https://api.github.com/repos/${this.settings.repo}/contents/${f.path.split('/').map(encodeURIComponent).join('/')}?ref=${this.settings.branch || 'main'}`;
        const res = await fetch(url, { headers: { ...this.ghHeaders(), Accept: 'application/vnd.github.raw' } });
        if (!res.ok) throw new Error(res.status);
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = f.name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        return true;
      }
    } catch { /* API 실패 시 원본 URL로 폴백 */ }
    window.open(f.url, '_blank');
    return true;
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
    const appUrl = location.origin + location.pathname + '#/tasks/requests';
    const proj = this.projectName(t.project);
    // 노션 알림처럼 제목에 [프로젝트] 프리픽스 (이미 [로 시작하면 그대로)
    const title = (t.project && proj !== '기타' && !t.title.trim().startsWith('[') ? `[${proj}] ` : '') + t.title;
    const blocks = [
      { type: 'section', text: { type: 'mrkdwn', text: ':inbox_tray: 새 요청 업무가 등록됐어요 <!subteam^S06BYJ0KS5T|@디자인팀-ct>' } },
      { type: 'header', text: { type: 'plain_text', text: title.slice(0, 148), emoji: true } },
      { type: 'section', fields: [
        { type: 'mrkdwn', text: `*기획자·요청자:* ${mentionizeNames(t.requester) || '미기재'}` },
        { type: 'mrkdwn', text: `*우선순위:* ${t.priority || '중간'}` },
        { type: 'mrkdwn', text: `*요청일:* ${t.requestedAt || '-'}` },
        { type: 'mrkdwn', text: `*마감일:* ${t.due || '미정'}` },
      ]},
      ...(t.notes ? [{ type: 'section', text: { type: 'mrkdwn', text: `*메모:* ${t.notes.slice(0, 500)}` } }] : []),
      { type: 'actions', elements: [
        ...(t.link ? [{ type: 'button', text: { type: 'plain_text', text: '📋 기획안 바로가기', emoji: true }, url: t.link }] : []),
        ...(t.files?.length && t.files[0].url ? [{ type: 'button', text: { type: 'plain_text', text: `📎 첨부 파일${t.files.length > 1 ? ` (${t.files.length}개)` : ''}`, emoji: true }, url: t.files[0].url }] : []),
        { type: 'button', text: { type: 'plain_text', text: '업무 보드에서 확인', emoji: true }, url: appUrl }
      ]}
    ];
    const fallback = `📥 새 요청 업무: ${title} (${t.requester || '요청'} · 마감 ${t.due || '미정'})`;
    this.notifySlack(fallback, blocks).catch(() => {});
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
