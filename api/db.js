/* api/db.js — 팀 DB(data/db.json) 서버 동기화
 * Cloudflare Access를 통과한 사내 구성원이라면 누구나, 브라우저에 GitHub 토큰 없이 동기화돼요.
 * 서버가 팀 공용 토큰(GITHUB_TOKEN 환경변수)으로 GitHub를 대신 읽고 써요.
 *
 * 필요한 환경변수:
 *  GITHUB_TOKEN  = fine-grained PAT (이 저장소에 Contents: Read and write)
 *  GITHUB_REPO   = (선택) owner/repo — 기본값: geunalee-tech/refilled-design_hub
 *  GITHUB_BRANCH = (선택) 기본값 main
 *  CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD = Cloudflare Access 검증용 (middleware.js와 동일)
 *  SESSION_SECRET = (전환기 임시) CF 미설정 시 구 로그인 쿠키 검증용 — CF 적용 후 제거
 */
import crypto from 'crypto';
import { verifyCfAccess } from './_lib/cf-access.js';

const REPO = () => process.env.GITHUB_REPO || 'geunalee-tech/refilled-design_hub';
const BRANCH = () => process.env.GITHUB_BRANCH || 'main';

/* 인증: CF Access JWT 우선 검증.
 * CF 미설정(전환기)일 때만 구 구글 로그인 쿠키(hub_s)를 임시 허용 — CF 적용 후 이 폴백 제거 */
async function requireUser(req) {
  const cf = await verifyCfAccess(req);
  if (cf.ok) {
    const e = cf.payload?.email || '';
    return { e, n: e.split('@')[0] };
  }
  if (!cf.configured) return sessionUser(req); // 레거시 폴백 (전환기 전용)
  return null;
}

function sessionUser(req) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const raw = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith('hub_s='));
  if (!raw) return null;
  try {
    const [p, s] = raw.slice(6).split('.');
    const expect = crypto.createHmac('sha256', secret).update(p).digest('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (expect !== s) return null;
    const payload = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch { return null; }
}

const gh = (path, init = {}) => fetch(`https://api.github.com/repos/${REPO()}/contents/${path}`, {
  ...init,
  headers: {
    'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'refilled-design-hub',
    ...(init.headers || {}),
  },
});

export default async function handler(req, res) {
  if (!process.env.GITHUB_TOKEN)
    return res.status(503).json({ error: 'GITHUB_TOKEN 환경변수가 설정되지 않았어요.' });
  const user = await requireUser(req);
  if (!user) return res.status(401).json({ error: '사내 로그인이 필요해요.' });

  if (req.method === 'GET') {
    const r = await gh(`data/db.json?ref=${BRANCH()}`);
    if (r.status === 404) return res.status(404).json({ error: 'db.json 없음' });
    if (!r.ok) return res.status(502).json({ error: 'GitHub 응답 ' + r.status });
    const j = await r.json();
    return res.status(200).json({ sha: j.sha, contentB64: j.content });
  }

  if (req.method === 'PUT') {
    const { contentB64, sha } = req.body || {};
    if (!contentB64) return res.status(400).json({ error: 'contentB64가 필요해요.' });
    const body = {
      message: `hub: ${user.n || user.e || 'member'} 데이터 업데이트`,
      content: contentB64.replace(/\n/g, ''),
      branch: BRANCH(),
    };
    if (sha) body.sha = sha;
    const r = await gh('data/db.json', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 409 || r.status === 422) return res.status(409).json({ error: 'conflict' });
    if (!r.ok) return res.status(502).json({ error: 'GitHub 저장 실패 ' + r.status });
    const j = await r.json();
    return res.status(200).json({ sha: j.content.sha });
  }

  return res.status(405).json({ error: 'GET/PUT only' });
}
