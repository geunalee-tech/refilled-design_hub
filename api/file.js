/* api/file.js — 첨부파일 서버 업로드/다운로드 (files/ 폴더 커밋)
 * POST {name, base64} → {name, url, path}
 * GET ?path=files/... → {contentB64}
 * api/db.js와 동일한 인증(Cloudflare Access 검증, 전환기엔 구 쿠키 폴백)을 사용해요.
 */
import crypto from 'crypto';
import { verifyCfAccess } from './_lib/cf-access.js';

/* 인증: CF Access JWT 우선, CF 미설정(전환기)일 때만 구 쿠키 임시 허용 (api/db.js와 동일) */
async function requireUser(req) {
  const cf = await verifyCfAccess(req);
  if (cf.ok) {
    const e = cf.payload?.email || '';
    return { e, n: e.split('@')[0] };
  }
  if (!cf.configured) return sessionUser(req);
  return null;
}

const REPO = () => process.env.GITHUB_REPO || 'geunalee-tech/refilled-design_hub';
const BRANCH = () => process.env.GITHUB_BRANCH || 'main';

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

  if (req.method === 'POST') {
    const { name, base64 } = req.body || {};
    if (!name || !base64) return res.status(400).json({ error: 'name/base64가 필요해요.' });
    const safe = String(name).replace(/[\/\\?%*:|"<>]/g, '_');
    const path = `files/${Date.now().toString(36)}_${safe}`;
    const r = await gh(path.split('/').map(encodeURIComponent).join('/'), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `hub: 첨부 업로드 (${user.n || user.e || 'member'})`, content: base64, branch: BRANCH() }),
    });
    if (!r.ok) return res.status(502).json({ error: '업로드 실패 ' + r.status });
    const j = await r.json();
    return res.status(200).json({ name, url: j.content.download_url, path });
  }

  if (req.method === 'GET') {
    const path = String(req.query?.path || '');
    if (!path.startsWith('files/')) return res.status(400).json({ error: 'files/ 경로만 가능해요.' });
    const r = await gh(path.split('/').map(encodeURIComponent).join('/') + `?ref=${BRANCH()}`);
    if (!r.ok) return res.status(502).json({ error: 'GitHub 응답 ' + r.status });
    const j = await r.json();
    return res.status(200).json({ contentB64: j.content });
  }

  return res.status(405).json({ error: 'GET/POST only' });
}
