/* api/auth/logout.js — 세션 쿠키 삭제 후 로그인 페이지로 이동 */
export default function handler(req, res) {
  res.setHeader('Set-Cookie', [
    'hub_s=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
    'hub_u=; Path=/; Max-Age=0; Secure; SameSite=Lax',
  ]);
  res.writeHead(302, { Location: '/login.html' });
  res.end();
}
