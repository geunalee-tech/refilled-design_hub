/* api/_lib/cf-access.js — Cloudflare Access JWT 검증 (Edge 미들웨어 · Node 함수 공용)
 *
 * Cloudflare Zero Trust(Access)를 통과한 요청에는 CF가 서명한 JWT가 실려 와요
 * (Cf-Access-Jwt-Assertion 헤더 또는 CF_Authorization 쿠키).
 * 이 모듈은 그 서명을 CF 공개키로 검증해요 — *.vercel.app 등 CF를 우회한 접근을 막는 핵심.
 *
 * 필요한 환경변수 (Vercel → Settings → Environment Variables):
 *  CF_ACCESS_TEAM_DOMAIN = Zero Trust 팀 도메인 (예: theconst.cloudflareaccess.com)
 *  CF_ACCESS_AUD         = Access 애플리케이션 Overview의 Audience(AUD) 태그
 * 둘 중 하나라도 없으면 { configured: false } — 게이트 해제 여부는 호출부가 결정해요.
 */

let certCache = { keys: null, at: 0 }; // CF 공개키 1시간 캐시 (함수 인스턴스 단위)

const b64uToBytes = s => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s.padEnd(s.length + ((4 - (s.length % 4)) % 4), '='));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
};
const b64uToJSON = s => JSON.parse(new TextDecoder().decode(b64uToBytes(s)));

async function findKey(kid, teamDomain) {
  if (!certCache.keys || Date.now() - certCache.at > 3600_000) {
    const r = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
    if (!r.ok) throw new Error('Access 공개키 조회 실패 ' + r.status);
    certCache = { keys: (await r.json()).keys || [], at: Date.now() };
  }
  return certCache.keys.find(k => k.kid === kid) || null;
}

/* Edge(Request)와 Node(IncomingMessage) 요청 객체 모두 지원 */
function getToken(req) {
  const h = typeof req.headers.get === 'function'
    ? n => req.headers.get(n)
    : n => req.headers[n];
  const direct = h('cf-access-jwt-assertion');
  if (direct) return direct;
  const cookie = h('cookie') || '';
  const found = cookie.split(/;\s*/).find(c => c.startsWith('CF_Authorization='));
  return found ? found.slice('CF_Authorization='.length) : null;
}

/** @returns {Promise<{configured: boolean, ok: boolean, payload?: object}>}
 *  payload.email = 로그인한 사내 구성원 이메일 */
export async function verifyCfAccess(req) {
  const teamDomain = process.env.CF_ACCESS_TEAM_DOMAIN;
  const aud = process.env.CF_ACCESS_AUD;
  if (!teamDomain || !aud) return { configured: false, ok: false };
  try {
    const token = getToken(req);
    if (!token) return { configured: true, ok: false };
    const [h64, p64, s64] = token.split('.');
    if (!s64) return { configured: true, ok: false };
    const header = b64uToJSON(h64);
    const payload = b64uToJSON(p64);
    if (!payload.exp || payload.exp < Date.now() / 1000) return { configured: true, ok: false };
    if (![].concat(payload.aud || []).includes(aud)) return { configured: true, ok: false };
    const jwk = await findKey(header.kid, teamDomain);
    if (!jwk) return { configured: true, ok: false };
    const key = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', key, b64uToBytes(s64),
      new TextEncoder().encode(`${h64}.${p64}`));
    return { configured: true, ok, payload: ok ? payload : undefined };
  } catch {
    return { configured: true, ok: false };
  }
}
