import { mentionizeNames } from './slackmap.js';
import { supabase, supaState, initSupabase, serverConfig } from './supabase.js';
import { fetchDirectory } from './directory.js';
import { uploadFile } from './files.js';
/* store.js — 단일 원천 데이터 스토어 (Supabase 행 단위 저장, 사내 표준)
   localStorage는 즉시 표시용 캐시 — 원본은 Supabase 도메인 테이블.
   저장은 변경된 행만 upsert/delete 해요 (통짜 JSON 저장 금지 — 동시 수정 유실 방지). */

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
  config: {}, guardLog: [], updatedAt: null
};

function loadJSON(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}

class Store {
  static ARR_KEYS = ['tasks', 'projects', 'members', 'rituals', 'archive', 'trends'];

  constructor() {
    this.db = { ...DEFAULT_DB, ...loadJSON(LS_DB, {}) }; // 캐시 즉시 표시 → 연결 후 pull()이 원본으로 교체
    this.settings = loadJSON(LS_SET, { userName: '' });
    this.migrate();
    this.connected = false;   // Supabase 연결·인증 완료 여부
    this.status = 'local';    // local | synced | syncing | error
    this.serverDetail = '';   // 로컬 모드인 이유 (배지 안내용)
    this.lastError = '';
    this.me = null;           // 사내 디렉토리 /me (현재 접속자) — 디자인팀 판별 등에 사용
    this.listeners = [];
    this._pushTimer = null;
    this._pending = null;     // 아직 서버에 안 올라간 변경 묶음
    this._snap = {};          // 항목별 스냅샷 (변경·삭제 감지용)
    this._cfgSnap = JSON.stringify(this.db.config || {});
    this._guardSeen = new Set((this.db.guardLog || []).map(g => g?.at).filter(Boolean));
    this.rebuildSnap();
  }

  /* ── 변경 감지 ──
     save() 때 스냅샷과 비교해 실제로 바뀐 행만 골라 서버에 올려요.
     mt(수정시각)는 바뀐 항목에만 찍혀요 — 다른 탭·팀원과의 충돌 판단 기준. */
  _sig(item) { const { mt, ...rest } = item; return JSON.stringify(rest); }
  rebuildSnap() {
    this._snap = {};
    Store.ARR_KEYS.forEach(k => (this.db[k] || []).forEach(it =>
      it && it.id && (this._snap[k + ':' + it.id] = this._sig(it))));
  }

  /* 스냅샷 대비 바뀐 행·지워진 행을 수집하고 스냅샷을 갱신해요 */
  collectChanges() {
    const now = new Date().toISOString();
    const out = { upserts: {}, deletes: {}, config: false, guards: [] };
    let any = false;
    for (const k of Store.ARR_KEYS) {
      const cur = new Map((this.db[k] || []).filter(x => x && x.id).map(x => [String(x.id), x]));
      const changed = [], deleted = [];
      for (const [id, it] of cur) {
        if (this._snap[k + ':' + id] !== this._sig(it)) { it.mt = now; changed.push(it); }
      }
      for (const key of Object.keys(this._snap)) {
        if (!key.startsWith(k + ':')) continue;
        const id = key.slice(k.length + 1);
        if (!cur.has(id)) deleted.push(id);
      }
      if (changed.length) { out.upserts[k] = changed; any = true; }
      if (deleted.length) { out.deletes[k] = deleted; any = true; }
    }
    const cfgSig = JSON.stringify(this.db.config || {});
    if (cfgSig !== this._cfgSnap) { out.config = true; this._cfgSnap = cfgSig; any = true; }
    for (const g of this.db.guardLog || []) {
      if (g?.at && !this._guardSeen.has(g.at)) { out.guards.push(g); this._guardSeen.add(g.at); any = true; }
    }
    this.rebuildSnap();
    return any ? out : null;
  }

  onChange(fn) { this.listeners.push(fn); }
  emit() { this.listeners.forEach(f => f()); }

  saveSettings() { localStorage.setItem(LS_SET, JSON.stringify(this.settings)); }

  hasRemote() { return this.connected; }

  save({ push = true } = {}) {
    const changes = this.collectChanges();
    this.db.updatedAt = new Date().toISOString();
    localStorage.setItem(LS_DB, JSON.stringify(this.db));
    this.emit();
    if (push && changes) { this._mergePending(changes); this.schedulePush(); }
  }

  _mergePending(c) {
    if (!this._pending) { this._pending = c; return; }
    const p = this._pending;
    for (const k of Object.keys(c.upserts)) {
      const map = new Map((p.upserts[k] || []).map(x => [String(x.id), x]));
      c.upserts[k].forEach(x => map.set(String(x.id), x));
      p.upserts[k] = [...map.values()];
    }
    for (const k of Object.keys(c.deletes)) {
      p.deletes[k] = [...new Set([...(p.deletes[k] || []), ...c.deletes[k]])];
      // 같은 id가 upsert 대기 중이었다면 삭제가 이겨요
      if (p.upserts[k]) p.upserts[k] = p.upserts[k].filter(x => !p.deletes[k].includes(String(x.id)));
    }
    p.config = p.config || c.config;
    p.guards.push(...c.guards);
  }

  schedulePush() {
    clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => this.push(), 800); // 연속 편집 디바운스
  }

  /* ── 연결: Supabase 초기화 + 브릿지 세션 ── */
  async connect() {
    const ok = await initSupabase();
    this.connected = ok;
    this.serverDetail = supaState.detail;
    return ok;
  }

  /* ── 읽기: 테이블 전체 → 메모리 (원본은 항상 서버) ── */
  async pull() {
    if (!this.connected && !(await this.connect())) { this.status = 'local'; this.emit(); return false; }
    if (this._pending) await this.push(); // 안 올라간 변경 먼저 반영
    this.status = 'syncing'; this.emit();
    try {
      const reads = Store.ARR_KEYS.map(t => supabase.from(t).select('data').order('id'));
      reads.push(supabase.from('app_state').select('key,data'));
      reads.push(supabase.from('guard_log').select('data').order('at'));
      const results = await Promise.all(reads);
      for (const r of results) if (r.error) throw new Error(r.error.message);

      const fresh = { ...DEFAULT_DB };
      Store.ARR_KEYS.forEach((t, i) => { fresh[t] = results[i].data.map(row => row.data); });
      const states = Object.fromEntries(results[Store.ARR_KEYS.length].data.map(r => [r.key, r.data]));
      fresh.config = states.config || {};
      fresh.guardLog = results[Store.ARR_KEYS.length + 1].data.map(r => r.data);
      fresh.updatedAt = new Date().toISOString();

      this.db = fresh;
      this.migrate();
      this._cfgSnap = JSON.stringify(this.db.config || {});
      this._guardSeen = new Set((this.db.guardLog || []).map(g => g?.at).filter(Boolean));
      this.rebuildSnap();
      localStorage.setItem(LS_DB, JSON.stringify(this.db));
      this.status = 'synced'; this.emit();
      this.syncDirectory(); // 사내 디렉토리에서 내 이름·팀원 목록 자동 반영 (비동기, 실패해도 무해)
      return true;
    } catch (e) {
      console.error(e); this.lastError = String(e.message || e);
      this.status = 'error'; this.emit(); return false;
    }
  }

  /* ── 사내 디렉토리 연동: 내 이름 + 디자인팀 구성원 자동 반영 ──
     로스터를 디렉토리에 그대로 미러링해요(사내 표준: 명단을 복사해두지 않음 — 사본은 팀 이동이 반영 안 됨).
     기존 멤버는 이름으로 매칭해 id를 보존(과거 업무의 담당자 참조 유지), 새 구성원은 email을 id로 추가,
     그리고 더 이상 디자인팀이 아닌 사람(팀 이동·퇴사)은 로스터에서 제거해요.
     과거 업무의 assignees에 남은 id는 memberName 조회 시 '미지정'으로 표시(이름 노출 안 됨). */
  async syncDirectory() {
    if (this._dirSynced) return;
    try {
      const { me, members } = await fetchDirectory();
      this._directory = members; // 슬랙 멘션용 전 구성원 캐시
      if (me) this.me = me;      // 디자인팀 판별용
      if (me?.name && this.settings.userName !== me.name) {
        this.settings.userName = me.name; this.saveSettings(); // 디렉토리가 원천 — 항상 동기화
      }
      const design = members.filter(m => (m.teamName || '').includes('디자인'));
      if (design.length) { // 필터 결과가 비면 건드리지 않음 (디렉토리 오류 시 로스터 보호)
        let changed = false;
        for (const d of design) {
          const ex = this.db.members.find(m => m.email === d.email || m.name === d.name);
          const role = d.position || d.teamName || '';
          if (ex) {
            if (ex.email !== d.email || (role && ex.role !== role) || ex.slackUserId !== d.slackUserId) {
              ex.email = d.email; if (role) ex.role = role; ex.slackUserId = d.slackUserId;
              changed = true;
            }
          } else {
            this.db.members.push({ id: d.email, name: d.name, role, email: d.email, slackUserId: d.slackUserId });
            changed = true;
          }
        }
        // 디렉토리 디자인팀에 없는 로스터 멤버 제거 (팀 이동·퇴사 반영). email 우선, 이름 폴백으로 매칭
        const validEmail = new Set(design.map(d => d.email).filter(Boolean));
        const validName = new Set(design.map(d => d.name).filter(Boolean));
        const stale = this.db.members.filter(m => !(validEmail.has(m.email) || validName.has(m.name)));
        if (stale.length) {
          const staleIds = new Set(stale.map(m => m.id));
          this.db.members = this.db.members.filter(m => !staleIds.has(m.id));
          changed = true;
        }
        if (changed) this.save(); // 변경 멤버 upsert + 제거 멤버 행 삭제(행 단위 diff)
      }
      this._dirSynced = true;
      this.emit();
    } catch { /* 디렉토리 미접근(로컬 정적 서버 등) → 기존 목록 그대로 사용 */ }
  }

  /* 텍스트 속 이름 → 슬랙 멘션. 디렉토리(전 구성원) 우선, 정적 맵(slackmap.js)은 폴백 */
  mentionize(text) {
    if (!text) return text;
    let out = text;
    const dyn = (this._directory || []).filter(m => m.name && m.slackUserId);
    for (const m of [...dyn].sort((a, b) => b.name.length - a.name.length)) {
      if (out.includes(m.name)) out = out.split(m.name).join(`<@${m.slackUserId}>`);
    }
    return mentionizeNames(out);
  }

  /* ── 쓰기: 대기 중인 변경만 행 단위 upsert/delete ── */
  async push() {
    if (!this.connected || !this._pending) return;
    const batch = this._pending; this._pending = null;
    this.status = 'syncing'; this.emit();
    try {
      for (const [t, items] of Object.entries(batch.upserts)) {
        const { error } = await supabase.from(t)
          .upsert(items.map(x => ({ id: String(x.id), data: x })));
        if (error) throw new Error(`${t} 저장 실패: ${error.message}`);
      }
      for (const [t, ids] of Object.entries(batch.deletes)) {
        const { error } = await supabase.from(t).delete().in('id', ids);
        if (error) throw new Error(`${t} 삭제 실패: ${error.message}`);
      }
      if (batch.config) {
        const { error } = await supabase.from('app_state')
          .upsert({ key: 'config', data: this.db.config || {} });
        if (error) throw new Error('설정 저장 실패: ' + error.message);
      }
      if (batch.guards.length) {
        const { error } = await supabase.from('guard_log')
          .upsert(batch.guards.map(g => ({ at: g.at, data: g })), { onConflict: 'at', ignoreDuplicates: true });
        if (error) throw new Error('로그 저장 실패: ' + error.message);
      }
      this.status = 'synced'; this.emit();
    } catch (e) {
      console.error(e); this.lastError = String(e.message || e);
      // 실패분 복원 — 그 사이 쌓인 새 변경이 있으면 새 쪽이 이기도록 순서 유지
      const newer = this._pending; this._pending = batch;
      if (newer) this._mergePending(newer);
      this.status = 'error'; this.emit();
    }
  }

  /* ── 편의 메서드 ── */
  /* 현재 접속자가 디자인팀인가 — /me teamName 기준. 알 수 없으면(로컬·디렉토리 미연결) 허용.
     ⚠️ UI 편의 게이트예요(하드 보안 아님) — 데이터는 로그인 전 구성원이 접근 가능(RLS authenticated). */
  isDesignTeam() { return this.me ? (this.me.teamName || '').includes('디자인') : true; }
  member(id) { return this.db.members.find(m => m.id === id); }
  project(id) { return this.db.projects.find(p => p.id === id); }
  memberName(id) { return this.member(id)?.name || '미지정'; }
  projectName(id) { return this.project(id)?.name || '기타'; }
  assigneeNames(t) {
    const ids = t.assignees || (t.assignee ? [t.assignee] : []);
    return ids.map(id => this.memberName(id)).join(', ') || '미지정';
  }

  /* ── 구버전 데이터 → 신규 스키마 정규화 (메모리 내) ── */
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
      // 가중목 config는 분기별 1개로 정리 (분기 없는 구 config는 _legacy 그룹) — 분기 도입 후 분기별 유지
      const cfgGroups = {};
      this.db.rituals.filter(r => r.type === 'goals-config')
        .forEach(r => { const k = r.quarter || '_legacy'; (cfgGroups[k] = cfgGroups[k] || []).push(r); });
      Object.values(cfgGroups).forEach(arr => {
        if (arr.length > 1) { const keep = pick(arr); arr.forEach(r => { if (r !== keep) drop.add(r.id); }); }
      });
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

    // 같은 이름의 멤버가 중복이면 하나로 병합 (시드/기본값이 팀 DB에 섞인 경우 복구)
    {
      const refCount = id =>
        (this.db.tasks || []).filter(t => (t.assignees || []).includes(id)).length +
        (this.db.projects || []).filter(p => p.owner === id).length;
      const byName = {}, remap = {};
      const kept = [];
      (this.db.members || []).forEach(m => {
        const key = (m.name || '').replace(/\s+/g, '');
        if (!key) { kept.push(m); return; }
        const prev = byName[key];
        if (!prev) { byName[key] = m; kept.push(m); return; }
        if (refCount(m.id) > refCount(prev.id)) {           // 참조 많은 쪽을 대표로
          remap[prev.id] = m.id; kept[kept.indexOf(prev)] = m; byName[key] = m;
        } else {
          remap[m.id] = prev.id;
        }
      });
      if (Object.keys(remap).length) {
        this.db.members = kept;
        (this.db.tasks || []).forEach(t => {
          t.assignees = [...new Set((t.assignees || []).map(id => remap[id] || id))];
        });
        (this.db.projects || []).forEach(p => { if (remap[p.owner]) p.owner = remap[p.owner]; });
      }
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

  /* ── 첨부 파일: 사내 파일허브 업로드, DB에는 URL만 저장 (사내 표준) ── */
  async uploadAttachment(file) {
    const url = await uploadFile(file);      // 실패 시 안내 메시지가 담긴 Error를 던져요
    return { name: file.name, url };
  }

  async downloadAttachment(f) {
    // 구 첨부(files/ 폴더 커밋분)는 서버 경유로 받아요 — path가 있는 레거시 레코드
    try {
      if (f.path) {
        const r = await fetch('/api/file?path=' + encodeURIComponent(f.path));
        if (!r.ok) throw new Error(r.status);
        const { contentB64 } = await r.json();
        const bin = atob(contentB64.replace(/\n/g, ''));
        const blob = new Blob([Uint8Array.from(bin, c => c.charCodeAt(0))]);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = f.name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        return true;
      }
    } catch { /* API 실패 시 원본 URL로 폴백 */ }
    window.open(f.url, '_blank'); // 파일허브 URL은 그대로 열면 돼요
    return true;
  }

  /* ── Slack 알림 (Incoming Webhook) ── */
  /* 서버 env(SLACK_WEBHOOK)에 값이 있으면 그게 우선 — 브라우저 저장분처럼 사라지지 않아요.
     env가 없을 때만 팀 공유 config(Supabase)에 저장된 값을 사용 (폴백·하위호환). */
  get slackWebhookFixed() { return !!serverConfig.slackWebhook; }
  get slackWebhook() {
    if (serverConfig.slackWebhook) return serverConfig.slackWebhook;
    try { return this.db.config?.slackHookB64 ? atob(this.db.config.slackHookB64) : ''; }
    catch { return ''; }
  }
  set slackWebhook(url) {
    if (this.slackWebhookFixed) return; // 서버 env로 고정된 경우 브라우저 저장 무시
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
  /* '새 요청 업무' 알림 Block Kit + 제목 (프로젝트 프리픽스 포함) */
  _requestBlocks(t) {
    const appUrl = location.origin + location.pathname + '#/tasks/requests';
    const proj = this.projectName(t.project);
    // 제목에 [프로젝트] 프리픽스 (이미 [로 시작하면 그대로)
    const title = (t.project && proj !== '기타' && !t.title.trim().startsWith('[') ? `[${proj}] ` : '') + t.title;
    const blocks = [
      { type: 'section', text: { type: 'mrkdwn', text: ':inbox_tray: 새 요청 업무가 등록됐어요 <!subteam^S06BYJ0KS5T|@디자인팀-ct>' } },
      { type: 'header', text: { type: 'plain_text', text: title.slice(0, 148), emoji: true } },
      { type: 'section', fields: [
        { type: 'mrkdwn', text: `*기획자·요청자:* ${this.mentionize(t.requester) || '미기재'}` },
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
    return { title, blocks };
  }

  /* 새 요청 업무 알림. 봇(서버 /api/slack-notify) 우선 — 반환된 ts를 업무에 저장해
     나중에 컨펌요청 시 그 스레드에 댓글을 달 수 있게 함. 봇 미설정 시 웹훅으로 폴백(스레드 댓글 불가). */
  async notifyNewRequest(t) {
    const { title, blocks } = this._requestBlocks(t);
    const fallback = `📥 새 요청 업무: ${title} (${t.requester || '요청'} · 마감 ${t.due || '미정'})`;
    try {
      const r = await fetch('/api/slack-notify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: fallback, blocks }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) { if (j.ts) { t.slackTs = j.ts; t.slackChannel = j.channel; } return true; }
      // 503(봇 미설정) 등 → 아래 웹훅 폴백
    } catch { /* 네트워크 실패 → 웹훅 폴백 */ }
    if (this.slackWebhook) return this.notifySlack(fallback, blocks);
    return false;
  }

  /* 컨펌요청 전환 시 상태 업데이트 알림 + 요청자·담당자 멘션 (요청 업무만).
     원 메시지 ts(봇 발송분)가 있으면 그 스레드에 댓글, 없으면(임포트·구 업무·봇 이후 등록분)
     새 메시지로 발송하고 그 ts를 앵커로 저장 → 이후 회수도 가능. 봇 실패 시 웹훅 폴백. */
  async notifyConfirmUpdate(t) {
    if (!t || t.kind !== 'request') return false;
    const proj = this.projectName(t.project);
    const title = (t.project && proj !== '기타' && !t.title.trim().startsWith('[') ? `[${proj}] ` : '') + t.title;
    const mentions = this._confirmMentions(t);
    const threaded = !!t.slackTs;
    let text = `:bell: *컨펌 요청 상태 업데이트*\n*${title}* 업무가 *컨펌요청* 단계로 넘어갔어요.`;
    if (!threaded && t.link) text += `\n<${t.link}|📋 기획안 바로가기>`;
    if (mentions) text += `\n${mentions} 확인 부탁드려요 🙏`;
    const body = threaded ? { text, threadTs: t.slackTs, channel: t.slackChannel } : { text };
    try {
      const r = await fetch('/api/slack-notify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) {
        if (j.ts) {
          if (threaded) t.slackConfirmTs = j.ts;                 // 스레드 댓글 ts
          else { t.slackTs = j.ts; t.slackChannel = j.channel; } // 원본 없던 경우 이 메시지를 앵커로
          this.save();
        }
        return true;
      }
    } catch { /* 봇 실패 → 웹훅 폴백 */ }
    if (this.slackWebhook) return this.notifySlack(text);
    return false;
  }

  /* 업무 카드 → 연결된 슬랙 메시지 바로가기. Slack 정식 permalink를 서버에서 받아와 캐시(t.slackPermalink).
     링크를 임의 조합하지 않아 깨질 일이 없음. 봇 메시지(slackTs)가 없으면 빈 문자열. */
  async slackPermalink(t) {
    if (t?.slackPermalink) return t.slackPermalink;
    if (!t?.slackTs || !t?.slackChannel) return '';
    try {
      const r = await fetch('/api/slack-notify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'permalink', ts: t.slackTs, channel: t.slackChannel }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok && j.permalink) { t.slackPermalink = j.permalink; this.save(); return j.permalink; }
    } catch { /* 실패 → 빈 문자열 (버튼 클릭 시 안내) */ }
    return '';
  }

  /* 업무 삭제 시 봇이 보낸 슬랙 메시지 회수 (컨펌 댓글 → 원본 순). 봇 발송분(slackTs 보유)만 가능. */
  async recallSlack(t) {
    if (!t?.slackTs) return false;
    const del = async ts => {
      if (!ts) return;
      try {
        await fetch('/api/slack-notify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete', ts, channel: t.slackChannel }),
        });
      } catch { /* 회수 실패해도 업무 삭제는 진행 */ }
    };
    await del(t.slackConfirmTs); // 스레드 댓글 먼저
    await del(t.slackTs);        // 원본 메시지
    return true;
  }

  /* 요청자(이름 문자열) + 담당자(assignees 멤버 id / 임포트 이름)를 슬랙 멘션 토큰으로 */
  _confirmMentions(t) {
    const set = new Set();
    const push = tok => { if (tok) set.add(tok); };
    if (t.requester) push(this.mentionize(t.requester));
    (t.assignees || []).forEach(id => {
      const m = this.member(id);
      if (m?.slackUserId) push(`<@${m.slackUserId}>`);
      else if (m?.name) push(this.mentionize(m.name));
    });
    (t._designerNames || []).forEach(n => push(this.mentionize(n)));
    return [...set].join(' ');
  }
}

export const store = new Store();
