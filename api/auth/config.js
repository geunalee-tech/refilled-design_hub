/* api/auth/config.js — 로그인 페이지가 사용할 공개 설정값 전달 */
export default function handler(req, res) {
  res.status(200).json({
    clientId: process.env.GOOGLE_CLIENT_ID || null,
    configured: !!(process.env.GOOGLE_CLIENT_ID && process.env.SESSION_SECRET),
    hasAllowlist: !!(process.env.ALLOWED_DOMAIN || process.env.ALLOWED_EMAILS),
  });
}
