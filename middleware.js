/* middleware.js — Cloudflare Access 게이트 (Vercel Edge Middleware)
 *
 * 로그인 자체는 Cloudflare Zero Trust(Access)가 design.constanthub.kr 앞단에서 처리해요.
 * 이 미들웨어는 CF가 요청에 실어 보내는 서명(JWT)을 검증해서,
 * *.vercel.app 주소 등 Cloudflare를 우회한 직접 접근을 차단하는 역할만 해요.
 *
 * 환경변수 (Vercel → Settings → Environment Variables):
 *  CF_ACCESS_TEAM_DOMAIN = Zero Trust 팀 도메인 (예: theconst.cloudflareaccess.com)
 *  CF_ACCESS_AUD         = Access 애플리케이션 Overview의 Audience(AUD) 태그
 *  PUBLIC_HOST           = (선택) 정식 접속 주소 (예: design.constanthub.kr)
 *                          — 우회 접근을 차단 대신 정식 주소로 안내 리다이렉트
 *
 * 안전장치: CF_ACCESS_* 미설정 시 게이트 비활성 (설정 전에 스스로 잠기는 사고 방지).
 * 환경변수를 넣은 뒤에는 반드시 재배포(Redeploy)해야 적용돼요.
 */
import { verifyCfAccess } from './api/_lib/cf-access.js';

export const config = {
  // /api/*는 게이트에서 제외 — 크론·노션 웹훅은 SYNC_SECRET으로,
  // /api/* (파일 다운로드·AI·슬랙·크론 등)은 함수 내부에서 자체 검증(CF/시크릿)을 수행해요.
  matcher: ['/((?!api/).*)'],
};

export default async function middleware(req) {
  // 1) 정식 주소가 아닌 호스트(*.vercel.app 등)는 무조건 정식 주소로 — CF 설정 여부와 무관
  const canonical = process.env.PUBLIC_HOST;
  const url = new URL(req.url);
  if (canonical && url.hostname !== canonical) {
    url.hostname = canonical;
    url.protocol = 'https:';
    return Response.redirect(url.toString(), 308);
  }

  // 2) 정식 주소로 온 요청은 CF Access 서명(JWT) 검증 — 프록시 우회(직접 접속) 차단
  const { configured, ok } = await verifyCfAccess(req);
  if (!configured || ok) return; // 통과 (게이트 미설정 포함)
  return new Response('사내 로그인이 필요해요 — https://' + (canonical || 'refilled-design.constanthub.kr') + ' 로 접속해주세요.', {
    status: 403,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
