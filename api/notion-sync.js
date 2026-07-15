/* api/notion-sync.js — 노션 요청 DB → 허브 미러링 (Vercel Serverless Function)
 *
 * 노션 데이터베이스 자동화("페이지 추가됨 → 웹훅 전송")가 이 엔드포인트를 호출하면:
 *  1) 노션 페이지 속성을 허브 업무 형식으로 변환
 *  2) 저장소 data/db.json에 업무 추가 (중복 방지: notionId)
 *  3) 슬랙 채널로 등록 알림 발송
 *
 * 필요한 Vercel 환경변수:
 *  GH_TOKEN      — 저장소 쓰기 가능한 fine-grained PAT (Contents: Read and write)
 *  GH_REPO       — 예: geunalee-tech/refilled-design_hub
 *  GH_BRANCH     — 기본 main
 *  SLACK_WEBHOOK — https://hooks.slack.com/services/...
 *  SYNC_SECRET   — 임의의 긴 문자열 (웹훅 URL의 ?key= 와 일치해야 동작)
 */

const GH_API = 'https://api.github.com';
const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VER = '2022-06-28';

/* ── 노션 API: 페이지 속성 + 본문 텍스트 가져오기 (NOTION_TOKEN 설정 시) ── */
async function fetchNotionPage(pageId, token) {
  const h = { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VER };
  const pres = await fetch(`${NOTION_API}/pages/${pageId}`, { headers: h });
  if (!pres.ok) throw new Error('노션 페이지 조회 실패 ' + pres.status);
  const page = await pres.json();

  // 본문 블록 → 평문 (최대 2페이지 분량)
  let body = '', cursor = null;
  for (let i = 0; i < 3; i++) {
    const url = `${NOTION_API}/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
    const bres = await fetch(url, { headers: h });
    if (!bres.ok) break;
    const json = await bres.json();
    for (const bl of json.results || []) {
      const rt = bl[bl.type]?.rich_text;
      if (!rt) continue;
      const line = rt.map(x => x.plain_text || '').join('');
      if (!line.trim()) continue;
      const prefix = bl.type.startsWith('heading') ? '■ '
        : bl.type === 'to_do' ? (bl.to_do?.checked ? '☑ ' : '☐ ')
        : /list_item/.test(bl.type) ? '- ' : '';
      body += prefix + line + '\n';
    }
    if (!json.has_more) break;
    cursor = json.next_cursor;
  }
  return { page, body: body.trim().slice(0, 1800) };
}

const STATUS_MAP = {
  '요청': 'req', '시작 전': 'req', '진행 중': 'doing',
  '컨펌요청': 'confirm', '컨펌 요청': 'confirm', '완료': 'done',
};

/* ── 노션 속성 파서 (자동화 페이로드의 다양한 형태를 관대하게 처리) ── */
function prop(props, ...names) {
  for (const n of names) if (props?.[n] !== undefined) return props[n];
  return undefined;
}
function plain(p) {
  if (!p) return '';
  const arr = p.title || p.rich_text;
  if (arr) return arr.map(x => x?.plain_text || x?.text?.content || '').join('');
  if (p.select) return p.select.name || '';
  if (p.status) return p.status.name || '';
  if (p.date) return p.date.start?.slice(0, 10) || '';
  if (p.created_time) return String(p.created_time).slice(0, 10);
  if (p.url) return p.url;
  if (typeof p === 'string') return p;
  return '';
}
function people(p) {
  const arr = p?.people || p?.created_by ? (p.people || [p.created_by]) : [];
  return arr.map(u => u?.name || '').filter(Boolean);
}

function mapTask(page) {
  const props = page.properties || {};
  const title = plain(prop(props, '이름', 'Name', '제목')) || '(제목 없음)';
  const statusKo = plain(prop(props, '상태', 'Status'));
  const status = STATUS_MAP[statusKo] || 'req';
  const priority = plain(prop(props, '우선순위', 'Priority')) || '중간';
  const due = plain(prop(props, '마감일', 'Due', '마감'));
  const reqAt = plain(prop(props, '요청일', 'Created', '생성일')) || new Date().toISOString().slice(0, 10);
  const designers = people(prop(props, '디자인 담당자', '담당자'));
  const planners = people(prop(props, '기획자'));
  const createdBy = page.created_by?.name || '';
  const plannerNames = planners.length ? planners : (createdBy ? [createdBy] : []);
  const requester = (plannerNames[0] || '노션 요청') + (plannerNames.length > 1 ? ` 외 ${plannerNames.length - 1}` : '');
  return {
    id: 'nt_' + (page.id || Math.random().toString(36).slice(2)).replace(/-/g, '').slice(0, 12),
    notionId: page.id || null,
    kind: 'request', title, project: '', assignees: [], _designerNames: designers, _plannerNames: plannerNames,
    status, priority: ['🚨긴급', '높음', '중간', '낮음', '보류'].includes(priority) ? priority : '중간',
    requester, requestedAt: reqAt, due, link: page.url || '',
    files: [], notes: '노션 요청 DB에서 자동 등록', createdAt: new Date().toISOString(),
    ...(status === 'done' ? { doneAt: reqAt } : {}),
  };
}

/* ── GitHub db.json 읽기/쓰기 ── */
async function ghGet(repo, branch, token) {
  const res = await fetch(`${GH_API}/repos/${repo}/contents/data/db.json?ref=${branch}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error('db.json 읽기 실패 ' + res.status);
  const json = await res.json();
  return { sha: json.sha, db: JSON.parse(Buffer.from(json.content, 'base64').toString('utf-8')) };
}
async function ghPut(repo, branch, token, db, sha) {
  const res = await fetch(`${GH_API}/repos/${repo}/contents/data/db.json`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    body: JSON.stringify({
      message: 'hub: 노션 요청 미러링', branch, sha,
      content: Buffer.from(JSON.stringify(db, null, 2)).toString('base64'),
    }),
  });
  if (!res.ok) throw new Error('db.json 쓰기 실패 ' + res.status);
}

/* ── 슬랙 알림 (허브와 동일한 Block Kit 포맷) ── */
// SLACK_USER_MAP 환경변수(JSON: {"이름":"U0XXXXXXX"})에 등록된 사람은 진짜 @멘션, 없으면 이름 표기
function mentionName(name, userMap) {
  const id = userMap[name] || userMap[name?.replace(/\s/g, '')];
  return id ? `<@${id}>` : name;
}
async function notifySlack(hook, t, boardUrl, userMap = {}) {
  if (!hook) return;
  // 디자인팀-CT 사용자 그룹 멘션 (SLACK_TEAM_MENTION 환경변수로 교체 가능)
  const teamMention = process.env.SLACK_TEAM_MENTION || '<!subteam^S06BYJ0KS5T|@디자인팀-ct>';
  const requesterText = (t._plannerNames?.length
    ? t._plannerNames.map(n => mentionName(n, userMap)).join(', ')
    : t.requester) || '미기재';
  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: `:inbox_tray: 새 요청 업무가 등록됐어요 ${teamMention}` } },
    { type: 'header', text: { type: 'plain_text', text: t.title.slice(0, 148), emoji: true } },
    { type: 'section', fields: [
      { type: 'mrkdwn', text: `*기획자·요청자:*\n${requesterText}` },
      { type: 'mrkdwn', text: `*우선순위:*\n${t.priority}` },
      { type: 'mrkdwn', text: `*요청일:*\n${t.requestedAt || '-'}` },
      { type: 'mrkdwn', text: `*마감일:*\n${t.due || '미정'}` },
    ]},
    { type: 'actions', elements: [
      ...(t.link ? [{ type: 'button', text: { type: 'plain_text', text: '📄 노션 페이지 바로가기', emoji: true }, url: t.link }] : []),
      { type: 'button', text: { type: 'plain_text', text: '업무 보드에서 확인', emoji: true }, url: boardUrl },
    ]},
  ];
  await fetch(hook, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: `📥 새 요청 업무: ${t.title} (${t.requester} · 마감 ${t.due || '미정'})`, blocks }),
  });
}

export default async function handler(req, res) {
  const { GH_TOKEN, GH_REPO, GH_BRANCH = 'main', SLACK_WEBHOOK, SYNC_SECRET, NOTION_TOKEN, SLACK_USER_MAP } = process.env;
  let userMap = {}; try { userMap = JSON.parse(SLACK_USER_MAP || '{}'); } catch {}
  if (!GH_TOKEN || !GH_REPO) return res.status(500).json({ error: '환경변수(GH_TOKEN/GH_REPO) 미설정' });
  if (!SYNC_SECRET || req.query.key !== SYNC_SECRET) return res.status(401).json({ error: 'key 불일치' });
  if (req.method !== 'POST') return res.status(200).json({ ok: true, hint: '노션 자동화 웹훅용 엔드포인트예요' });

  try {
    // 노션 자동화 페이로드: { data: {page} } 또는 {page} 또는 페이지 객체 자체
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    let page = body.data?.properties ? body.data : (body.page || (body.properties ? body : null));
    if (!page?.id && body.data?.id) page = body.data;
    if (!page) return res.status(400).json({ error: '페이지 데이터를 찾지 못했어요', got: Object.keys(body) });

    // NOTION_TOKEN이 있으면 웹훅 페이로드 대신 API로 최신 속성 + 본문을 가져와요
    let pageBody = '';
    if (NOTION_TOKEN && page.id) {
      try {
        const fresh = await fetchNotionPage(page.id, NOTION_TOKEN);
        page = fresh.page; pageBody = fresh.body;
      } catch { /* 실패 시 페이로드 속성으로 진행 */ }
    }

    const task = mapTask(page);
    if (pageBody) task.notes = pageBody;

    // 내용이 비어 있는 템플릿 페이지는 미러링하지 않아요 (작성 완료 후 트리거 권장)
    if (!task.title || task.title === '(제목 없음)') {
      return res.status(200).json({ ok: true, skipped: '제목이 비어 있어 건너뛰었어요 (작성 완료 후 전송해주세요)' });
    }

    // db.json 갱신 (sha 충돌 시 1회 재시도)
    for (let attempt = 0; attempt < 2; attempt++) {
      const { sha, db } = await ghGet(GH_REPO, GH_BRANCH, GH_TOKEN);
      if (task.notionId && (db.tasks || []).some(t => t.notionId === task.notionId)) {
        return res.status(200).json({ ok: true, skipped: '이미 미러링된 페이지' });
      }
      // 담당자 이름 → 허브 멤버 매칭
      task.assignees = (db.members || [])
        .filter(m => task._designerNames?.some(n => n.includes(m.name) || m.name.includes(n)))
        .map(m => m.id);
      const { _designerNames, ...clean } = task;
      db.tasks = db.tasks || []; db.tasks.push(clean);
      db.updatedAt = new Date().toISOString();
      try { await ghPut(GH_REPO, GH_BRANCH, GH_TOKEN, db, sha); break; }
      catch (e) { if (attempt === 1) throw e; }
    }

    const boardUrl = `https://${req.headers.host}/#/tasks/requests`;
    await notifySlack(SLACK_WEBHOOK, task, boardUrl, userMap).catch(() => {});
    return res.status(200).json({ ok: true, task: task.title });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
