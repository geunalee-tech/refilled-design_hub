/* api/auth/session.js — 구글 로그인 처리
 * 로그인 페이지에서 받은 구글 ID 토큰을 검증하고,
 * Constant 멤버(허용 도메인 또는 허용 이메일)인 경우에만 30일 세션 쿠키를 발급해요.
 *
 * 필요한 환경변수: GOOGLE_CLIENT_ID, SESSION_SECRET,
 *                 ALLOWED_DOMAIN 그리고/또는 ALLOWED_EMAILS (middleware.js 주석 참고)
 */
import crypto from 'crypto';

const DAYS30 = 30 * 24 * 3600;

const b64url = buf => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function signToken(payload, secret) {
  const p = b64url(JSON.stringify(payload));
  const s = crypto.createHmac('sha256', secret).update(p).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${p}.${s}`;
}

function isAllowed(claims) {
  const email = String(claims.email || '').toLowerCase();
  const domains = (process.env.ALLOWED_DOMAIN || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  const emails = (process.env.ALLOWED_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  if (!domains.length && !emails.length) return { ok: false, reason: 'unconfigured' };
  if (emails.includes(email)) return { ok: true };
  const hd = String(claims.hd || '').toLowerCase();
  const mailDomain = email.split('@')[1] || '';
  if (domains.some(d => d === hd || d === mailDomain)) return { ok: true };
  return { ok: false, reason: 'not_member' };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.SESSION_SECRET;
  if (!clientId || !secret)
    return res.status(500).json({ error: 'GOOGLE_CLIENT_ID / SESSION_SECRET 환경변수를 먼저 설정하고 재배포해주세요.' });

  const credential = req.body?.credential;
  if (!credential) return res.status(400).json({ error: '구글 인증 정보가 없어요.' });

  // 구글에 ID 토큰 검증 위임 (서명·만료 확인)
  const vr = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
  if (!vr.ok) return res.status(401).json({ error: '구글 인증 토큰이 유효하지 않아요. 다시 로그인해주세요.' });
  const claims = await vr.json();

  if (claims.aud !== clientId)
    return res.status(401).json({ error: '이 앱을 위한 인증 토큰이 아니에요. (클라이언트 ID 불일치)' });
  if (claims.email_verified !== 'true' && claims.email_verified !== true)
    return res.status(401).json({ error: '이메일 인증이 완료되지 않은 구글 계정이에요.' });

  const allowed = isAllowed(claims);
  if (!allowed.ok) {
    if (allowed.reason === 'unconfigured')
      return res.status(500).json({ error: 'ALLOWED_DOMAIN 또는 ALLOWED_EMAILS 환경변수를 설정하고 재배포해주세요.' });
    return res.status(403).json({ error: `접근 권한이 없는 계정이에요 (${claims.email}). Constant 멤버 계정으로 로그인하거나, 관리자에게 계정 추가를 요청해주세요.` });
  }

  const payload = { e: claims.email, n: claims.name || claims.email, exp: Math.floor(Date.now() / 1000) + DAYS30 };
  const token = signToken(payload, secret);
  const userInfo = encodeURIComponent(JSON.stringify({ n: payload.n, e: payload.e }));

  res.setHeader('Set-Cookie', [
    `hub_s=${token}; Path=/; Max-Age=${DAYS30}; HttpOnly; Secure; SameSite=Lax`,
    `hub_u=${userInfo}; Path=/; Max-Age=${DAYS30}; Secure; SameSite=Lax`,
  ]);
  return res.status(200).json({ ok: true, name: payload.n, email: payload.e });
}
