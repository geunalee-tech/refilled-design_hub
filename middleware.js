/* middleware.js — 구글 로그인 게이트 (Vercel Edge Middleware)
 *
 * 하는 일: 허브의 모든 페이지·데이터 요청을 가로채서, 로그인 세션 쿠키(hub_s)가
 * 유효한 경우에만 통과시켜요. 없거나 만료됐으면 /login.html로 보냅니다.
 *
 * ── 설정 방법 (한 번만, Vercel 프로젝트 → Settings → Environment Variables) ──
 *  GOOGLE_CLIENT_ID  = 구글 클라우드 콘솔에서 만든 OAuth 클라이언트 ID
 *  SESSION_SECRET    = 아무 긴 랜덤 문자열 (예: 비밀번호 생성기로 40자)
 *  ALLOWED_DOMAIN    = 회사 구글 워크스페이스 도메인 → theconst.kr
 *  ALLOWED_EMAILS    = (선택) 허용할 이메일 목록, 쉼표로 구분
 *  ※ ALLOWED_DOMAIN / ALLOWED_EMAILS 중 최소 하나는 꼭 설정하세요.
 *
 * 안전장치: GOOGLE_CLIENT_ID나 SESSION_SECRET이 아직 설정되지 않았다면
 * 게이트가 비활성화돼요 (설정 전에 스스로 잠기는 사고 방지).
 * 환경변수를 넣은 뒤에는 반드시 재배포(Redeploy)해야 적용돼요.
 */

export const config = {
  // /api/* (크론·슬랙 웹훅·로그인 API)와 로그인 페이지 자체는 게이트에서 제외
  matcher: ['/((?!api/|login.html).*)'],
};

function getCookie(header, name) {
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}

const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function verifyToken(token, secret) {
  try {
    const [p, s] = token.split('.');
    if (!p || !s) return null;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(p));
    if (b64url(sig) !== s) return null;
    const bin = atob(p.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
    if (!payload.exp || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch { return null; }
}

export default async function middleware(req) {
  const secret = process.env.SESSION_SECRET;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!secret || !clientId) return; // 아직 미설정 → 게이트 비활성 (통과)

  const token = getCookie(req.headers.get('cookie') || '', 'hub_s');
  if (token && await verifyToken(token, secret)) return; // 유효한 세션 → 통과

  return Response.redirect(new URL('/login.html', req.url), 302);
}
