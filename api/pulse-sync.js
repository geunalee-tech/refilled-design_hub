/* api/pulse-sync.js — 주간 디자인 펄스 회의록 자동 아카이빙 (Vercel Serverless + Cron)
 *
 * 매주 월요일 14:00 KST (vercel.json crons "0 5 * * 1")에 실행:
 *  1) 노션 "회의" DB에서 제목에 '디자인 펄스'가 들어간 최신 회의록 조회
 *  2) 본문 블록 → 마크다운 텍스트 변환 (이미지 제외 — 만료되는 서명 URL이라)
 *  3) data/db.json의 rituals에 type:'pulse' 문서로 업서트 (노션 최종 수정시각 기준 갱신)
 *
 * 수동 실행: GET /api/pulse-sync?key=SYNC_SECRET (허브의 "지금 동기화" 버튼)
 *
 * 필요한 Vercel 환경변수:
 *  NOTION_TOKEN  — 노션 인테그레이션 시크릿 (회의 DB에 연결돼 있어야 함)
 *  GH_TOKEN / GH_REPO / GH_BRANCH / SYNC_SECRET — notion-sync.js와 동일
 *  PULSE_DB      — (선택) 회의 데이터베이스 ID. 기본: 2cef27f09cd64a2497ab51aed5be4829
 */

const GH_API = 'https://api.github.com';
const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VER = '2022-06-28';
const DEFAULT_DB = '2cef27f09cd64a2497ab51aed5be4829'; // C-Tribe "회의" DB

/* ── GitHub db.json 읽기/쓰기 (notion-sync.js와 동일 패턴) ── */
async function ghGet(repo, branch, token) {
  const res = await fetch(`${GH_API}/repos/${repo}/contents/data/db.json?ref=${branch}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error('GitHub 읽기 실패 ' + res.status);
  const json = await res.json();
  return { sha: json.sha, db: JSON.parse(Buffer.from(json.content, 'base64').toString('utf8')) };
}
async function ghPut(repo, branch, token, db, sha) {
  const res = await fetch(`${GH_API}/repos/${repo}/contents/data/db.json`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    body: JSON.stringify({
      message: 'hub: 디자인 펄스 회의록 자동 아카이브',
      content: Buffer.from(JSON.stringify(db, null, 2), 'utf8').toString('base64'),
      branch, sha,
    }),
  });
  if (!res.ok) throw new Error('GitHub 쓰기 실패 ' + res.status);
}

/* ── 노션: 회의 DB에서 디자인 펄스 회의록 조회 ── */
async function queryPulsePages(token, dbId) {
  const res = await fetch(`${NOTION_API}/databases/${dbId}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VER, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filter: { property: '이름', title: { contains: '디자인 펄스' } },
      sorts: [{ timestamp: 'created_time', direction: 'descending' }],
      page_size: 12,
    }),
  });
  if (!res.ok) throw new Error('노션 DB 조회 실패 ' + res.status + ' — 인테그레이션이 회의 DB에 연결됐는지 확인해주세요');
  return (await res.json()).results || [];
}

/* ── 노션 블록 → 마크다운 텍스트 (하위 블록 1단계 포함, 이미지 제외) ── */
async function blocksToMd(token, blockId, depth = 0) {
  if (depth > 2) return '';
  const h = { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VER };
  let md = '', cursor = null;
  for (let i = 0; i < 4; i++) {
    const url = `${NOTION_API}/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
    const res = await fetch(url, { headers: h });
    if (!res.ok) break;
    const json = await res.json();
    for (const bl of json.results || []) {
      const data = bl[bl.type] || {};
      const text = (data.rich_text || []).map(x => {
        let t = x.plain_text || '';
        if (x.href) t = `[${t}](${x.href})`;
        else if (x.annotations && x.annotations.bold) t = `**${t}**`;
        return t;
      }).join('');
      const indent = '  '.repeat(depth);
      if (bl.type === 'heading_1' || bl.type === 'heading_2') md += `\n## ${text}\n`;
      else if (bl.type === 'heading_3') md += `\n## ${text}\n`;
      else if (bl.type === 'bulleted_list_item' || bl.type === 'numbered_list_item') md += `${indent}- ${text}\n`;
      else if (bl.type === 'to_do') md += `${indent}- ${data.checked ? '☑' : '☐'} ${text}\n`;
      else if (bl.type === 'callout') md += `> ${text}\n`;
      else if (bl.type === 'quote') md += `> ${text}\n`;
      else if (bl.type === 'toggle') md += `${indent}- ${text}\n`;
      else if (bl.type === 'paragraph' && text.trim()) md += `${indent}${text}\n`;
      /* 하위 블록 (토글·콜아웃·리스트 내부) */
      if (bl.has_children && ['toggle', 'callout', 'bulleted_list_item', 'numbered_list_item', 'column_list', 'column'].includes(bl.type)) {
        md += await blocksToMd(token, bl.id, bl.type.startsWith('column') ? depth : depth + 1);
      }
    }
    if (!json.has_more) break;
    cursor = json.next_cursor;
  }
  return md;
}

export default async function handler(req, res) {
  const { GH_TOKEN, GH_REPO, GH_BRANCH = 'main', NOTION_TOKEN, SYNC_SECRET, PULSE_DB } = process.env;

  /* 인증: Vercel 크론 헤더 또는 ?key=SYNC_SECRET */
  const isCron = !!req.headers['x-vercel-cron'];
  const keyOk = SYNC_SECRET && req.query && req.query.key === SYNC_SECRET;
  if (!isCron && !keyOk) return res.status(401).json({ error: '인증 실패 — ?key= 값을 확인해주세요' });

  if (!GH_TOKEN || !GH_REPO) return res.status(500).json({ error: '환경변수(GH_TOKEN/GH_REPO) 미설정' });
  if (!NOTION_TOKEN) return res.status(500).json({ error: 'NOTION_TOKEN 미설정 — 노션 인테그레이션 시크릿을 Vercel에 추가해주세요' });

  try {
    const pages = await queryPulsePages(NOTION_TOKEN, PULSE_DB || DEFAULT_DB);
    let added = 0, updated = 0;

    /* 커밋 충돌 시 1회 재시도 */
    for (let attempt = 0; attempt < 2; attempt++) {
      const { sha, db } = await ghGet(GH_REPO, GH_BRANCH, GH_TOKEN);
      db.rituals = db.rituals || [];
      added = 0; updated = 0;

      for (const page of pages) {
        const id = 'np_' + page.id.replace(/-/g, '');
        const title = (page.properties?.['이름']?.title || []).map(t => t.plain_text).join('') || '주간 디자인 펄스';
        const date = page.properties?.['미팅 시간']?.date?.start
          || (page.created_time || '').slice(0, 10);
        const edited = page.last_edited_time || new Date().toISOString();
        const existing = db.rituals.find(r => r.id === id);
        if (existing && existing.mt === edited) continue; // 변경 없음

        const md = (await blocksToMd(NOTION_TOKEN, page.id)).trim().slice(0, 12000);
        const doc = {
          id, type: 'pulse', date, title,
          author: '노션 자동 아카이브',
          createdAt: existing ? existing.createdAt : new Date().toISOString(),
          syncedAt: new Date().toISOString(),
          mt: edited, // 노션 최종 수정시각 — 허브 병합에서도 최신 기준으로 동작
          data: { md, notionUrl: page.url || `https://www.notion.so/${page.id.replace(/-/g, '')}` },
        };
        if (existing) { Object.assign(existing, doc); updated++; }
        else { db.rituals.push(doc); added++; }
      }

      if (!added && !updated) return res.status(200).json({ ok: true, added: 0, updated: 0, note: '변경 없음' });
      db.updatedAt = new Date().toISOString();
      try { await ghPut(GH_REPO, GH_BRANCH, GH_TOKEN, db, sha); break; }
      catch (e) { if (attempt === 1) throw e; }
    }
    return res.status(200).json({ ok: true, added, updated });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
