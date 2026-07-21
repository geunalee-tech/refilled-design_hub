/* api/notion-sync.js — 노션 요청 DB → 허브 미러링 (Vercel Serverless Function)
 *
 * 노션 데이터베이스 자동화("페이지 추가됨 → 웹훅 전송")가 이 엔드포인트를 호출하면:
 *  1) 노션 페이지 속성을 허브 업무 형식으로 변환
 *  2) Supabase tasks 테이블에 행 추가 (중복 방지: notionId)
 *  3) 슬랙 채널로 등록 알림 발송
 *
 * 필요한 Vercel 환경변수:
 *  SUPABASE_URL / SUPABASE_SERVICE_KEY — 팀 Supabase (service 키는 서버 전용, RLS 우회)
 *  SLACK_WEBHOOK — https://hooks.slack.com/services/...
 *  SYNC_SECRET   — 임의의 긴 문자열 (웹훅 URL의 ?key= 와 일치해야 동작)
 */

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VER = '2022-06-28';

/* ── Supabase REST (행 단위 접근 — 통짜 JSON 저장 금지, 사내 표준) ── */
async function sb(path, init = {}) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`Supabase ${path.split('?')[0]} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r;
}
const sbFindByNotion = async notionId =>
  (await (await sb(`tasks?data->>notionId=eq.${encodeURIComponent(notionId)}&select=id,data`)).json())[0] || null;
const sbUpsertTask = task =>
  sb('tasks?on_conflict=id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ id: String(task.id), data: task }]),
  });
const sbDeleteTask = id => sb(`tasks?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
const sbMembers = async () =>
  (await (await sb('members?select=data')).json()).map(r => r.data);

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
  const arr = p?.people ? p.people : (p?.created_by ? [p.created_by] : []);
  return arr.map(u => ({ id: u?.id || '', name: u?.name || '' })).filter(u => u.id || u.name);
}

function mapTask(page) {
  const props = page.properties || {};
  const title = plain(prop(props, '이름', 'Name', '제목')) || '(제목 없음)';
  const statusKo = plain(prop(props, '상태', 'Status'));
  const status = STATUS_MAP[statusKo] || 'req';
  const priority = plain(prop(props, '우선순위', 'Priority')) || '중간';
  const due = plain(prop(props, '마감일', 'Due', '마감'));
  const rawPlan = (plain(prop(props, '기획안 링크', '기획안', '링크', 'Link')) || '').trim();
  // https:// 없이 입력해도 보정 (figma.com/... → https://figma.com/...)
  const planLink = !rawPlan ? ''
    : /^https?:\/\//i.test(rawPlan) ? rawPlan
    : /^[\w-]+(\.[\w-]+)+([\/?#]|$)/.test(rawPlan) ? 'https://' + rawPlan
    : '';
  const reqAt = plain(prop(props, '요청일', 'Created', '생성일')) || new Date().toISOString().slice(0, 10);
  const designers = people(prop(props, '디자인 담당자', '담당자')).map(u => u.name).filter(Boolean);
  const cb = page.created_by || {};
  let planners = people(prop(props, '기획자'));
  if (!planners.length && (cb.id || cb.name)) planners = [{ id: cb.id || '', name: cb.name || '' }];
  const plannerNames = planners.map(u => u.name).filter(Boolean);
  const requester = (plannerNames[0] || '노션 요청') + (plannerNames.length > 1 ? ` 외 ${plannerNames.length - 1}` : '');
  return {
    id: 'nt_' + (page.id ? page.id.replace(/-/g, '') : Math.random().toString(36).slice(2) + Date.now().toString(36)),
    notionId: page.id || null,
    kind: 'request', title, project: '', assignees: [], _designerNames: designers, _planners: planners,
    status, priority: ['🚨긴급', '높음', '중간', '낮음', '보류'].includes(priority) ? priority : '중간',
    requester, requestedAt: reqAt, due,
    link: planLink || page.url || '', _planLink: planLink, _notionUrl: page.url || '',
    files: [], notes: '노션 요청 DB에서 자동 등록', createdAt: new Date().toISOString(),
    ...(status === 'done' ? { doneAt: reqAt } : {}),
  };
}

/* ── 슬랙 알림 (허브와 동일한 Block Kit 포맷) ── */
// SLACK_USER_MAP 환경변수(JSON: {"이름":"U0XXXXXXX"})에 등록된 사람은 진짜 @멘션, 없으면 이름 표기
function mentionName(name, userMap) {
  const id = userMap[name] || userMap[name?.replace(/\s/g, '')];
  return id ? `<@${id}>` : name;
}
async function notifySlack(hook, t, boardUrl, userMap = {}, notionMap = {}, bot = null) {
  if (!hook && !bot) return null;
  // 디자인팀-CT 사용자 그룹 멘션 (SLACK_TEAM_MENTION 환경변수로 교체 가능)
  const teamMention = process.env.SLACK_TEAM_MENTION || '<!subteam^S06BYJ0KS5T|@디자인팀-ct>';
  // 기획자 멘션: ① 노션ID→슬랙ID 맵 ② 이름→슬랙ID 맵 ③ 이름 표기
  const mentions = (t._planners || []).map(u => {
    const m = notionMap[u.id];
    if (m?.s) return `<@${m.s}>`;
    const name = u.name || m?.n;
    return name ? mentionName(name, userMap) : null;
  }).filter(Boolean);
  const requesterText = (mentions.length ? mentions.join(', ') : t.requester) || '미기재';
  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: `:inbox_tray: 새 요청 업무가 등록됐어요 ${teamMention}` } },
    { type: 'header', text: { type: 'plain_text', text: t.title.slice(0, 148), emoji: true } },
    { type: 'section', fields: [
      { type: 'mrkdwn', text: `*기획자·요청자:* ${requesterText}` },
      { type: 'mrkdwn', text: `*우선순위:* ${t.priority}` },
      { type: 'mrkdwn', text: `*요청일:* ${t.requestedAt || '-'}` },
      { type: 'mrkdwn', text: `*마감일:* ${t.due || '미정'}` },
    ]},
    { type: 'actions', elements: [
      ...(t._planLink ? [{ type: 'button', text: { type: 'plain_text', text: '📋 기획안 바로가기', emoji: true }, url: t._planLink }] : []),
      ...(t._notionUrl ? [{ type: 'button', text: { type: 'plain_text', text: '📄 노션 페이지', emoji: true }, url: t._notionUrl }] : []),
      { type: 'button', text: { type: 'plain_text', text: '업무 보드에서 확인', emoji: true }, url: boardUrl },
    ]},
  ];
  // 봇 토큰이 있으면 chat.postMessage(회수 가능한 방식) 우선, 없으면 기존 웹훅
  if (bot?.token && bot?.channel) {
    const r = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${bot.token}` },
      body: JSON.stringify({ channel: bot.channel, text: `📥 새 요청 업무: ${t.title}`, blocks }),
    });
    const j = await r.json().catch(() => ({}));
    if (j.ok) return { ts: j.ts, channel: j.channel };
    // 봇 실패(권한/미초대 등) 시 웹훅으로 폴백
  }
  if (!hook) return null;
  await fetch(hook, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: `📥 새 요청 업무: ${t.title} (${t.requester} · 마감 ${t.due || '미정'})`, blocks }),
  });
  return null;
}

/* ── 슬랙 메시지 회수 (봇 토큰 방식으로 보낸 메시지만 가능) ── */
async function deleteSlackMessage(bot, channel, ts) {
  if (!bot?.token || !channel || !ts) return false;
  const r = await fetch('https://slack.com/api/chat.delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${bot.token}` },
    body: JSON.stringify({ channel, ts }),
  });
  const j = await r.json().catch(() => ({}));
  return !!j.ok;
}

/* 페이로드/페이지 속성에서 체크박스 값 읽기 (이름 무관, 첫 체크박스 속성) */
function readCheckbox(page) {
  for (const [name, p] of Object.entries(page?.properties || {})) {
    if (p && p.type === 'checkbox') return { name, checked: !!p.checkbox };
  }
  return null;
}

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, SLACK_WEBHOOK, SYNC_SECRET, NOTION_TOKEN, SLACK_USER_MAP, NOTION_SLACK_MAP, SLACK_BOT_TOKEN, SLACK_CHANNEL_ID } = process.env;
  const bot = SLACK_BOT_TOKEN ? { token: SLACK_BOT_TOKEN, channel: SLACK_CHANNEL_ID } : null;
  let userMap = {}; try { userMap = JSON.parse(SLACK_USER_MAP || '{}'); } catch {}
  let notionMap = {}; try { notionMap = JSON.parse(NOTION_SLACK_MAP || '{}'); } catch {}
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(500).json({ error: '환경변수(SUPABASE_URL/SUPABASE_SERVICE_KEY) 미설정' });
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

    /* ── 체크 해제 = 요청 회수: 슬랙 메시지 삭제 + (아직 요청 상태면) 업무 제거 ── */
    const cb = readCheckbox(page);
    if (cb && !cb.checked && page.id) {
      const row = await sbFindByNotion(page.id);
      if (!row) return res.status(200).json({ ok: true, recalled: false, note: '미러링된 업무가 없어요' });
      const t = row.data;
      let recalled = false, removed = false;
      if (t.slackTs) {
        recalled = await deleteSlackMessage(bot, t.slackChannel || SLACK_CHANNEL_ID, t.slackTs).catch(() => false);
      }
      if (t.status === 'req') { // 아직 착수 전이면 보드에서도 제거
        await sbDeleteTask(row.id); removed = true;
      } else if (recalled) { // 진행 중이면 업무는 유지, 회수 표시만
        delete t.slackTs; delete t.slackChannel; t.mt = new Date().toISOString();
        await sbUpsertTask(t);
      }
      return res.status(200).json({ ok: true, recalled, removed,
        note: recalled ? '슬랙 알림을 회수했어요' : '슬랙 회수 실패 또는 회수 불가(웹훅 방식 메시지)' });
    }

    const task = mapTask(page);
    if (pageBody) task.notes = pageBody;

    if (task._planLink && task._notionUrl) {
      task.notes = (task.notes ? task.notes + '\n\n' : '') + '📄 노션 페이지: ' + task._notionUrl;
    }

    // 이름이 안 넘어온 기획자는 매핑표의 이름으로 보완 (허브 표시용)
    const resolvedNames = (task._planners || []).map(u => u.name || notionMap[u.id]?.n).filter(Boolean);
    if (resolvedNames.length) {
      task.requester = resolvedNames[0] + (resolvedNames.length > 1 ? ` 외 ${resolvedNames.length - 1}` : '');
    }

    // 내용이 비어 있는 템플릿 페이지는 미러링하지 않아요 (작성 완료 후 트리거 권장)
    if (!task.title || task.title === '(제목 없음)') {
      return res.status(200).json({ ok: true, skipped: '제목이 비어 있어 건너뛰었어요 (작성 완료 후 전송해주세요)' });
    }

    // 중복 방지: 이미 미러링된 노션 페이지면 건너뛰어요
    if (task.notionId && await sbFindByNotion(task.notionId)) {
      return res.status(200).json({ ok: true, skipped: '이미 미러링된 페이지' });
    }

    // 슬랙 알림을 먼저 보내 메시지 ID(ts)를 받아둬요 — 나중에 회수할 때 필요
    const boardUrl = `https://${req.headers.host}/#/tasks/requests`;
    const sent = await notifySlack(SLACK_WEBHOOK, task, boardUrl, userMap, notionMap, bot).catch(() => null);
    if (sent?.ts) { task.slackTs = sent.ts; task.slackChannel = sent.channel; }

    // 담당자 이름 → 허브 멤버 매칭 후 행 추가
    const members = await sbMembers().catch(() => []);
    task.assignees = members
      .filter(m => task._designerNames?.some(n => n.includes(m.name) || m.name.includes(n)))
      .map(m => m.id);
    const { _designerNames, _planners, _planLink, _notionUrl, ...clean } = task;
    await sbUpsertTask(clean);

    return res.status(200).json({ ok: true, task: task.title, slack: sent?.ts ? 'bot(회수 가능)' : 'webhook(회수 불가)' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
