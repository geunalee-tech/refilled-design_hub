/* api/config.js — 브라우저용 공개 설정값 (Supabase 연결 정보)
 * anon 키는 공개 전제 키예요 — 데이터 보호는 RLS + 인증 브릿지가 담당해요 (사내 표준).
 * 필요한 환경변수: SUPABASE_URL, SUPABASE_ANON_KEY
 * 선택: SLACK_WEBHOOK — 팀 알림 웹훅. 여기 넣으면 브라우저 저장(사라지기 쉬움) 대신
 *       서버 env로 고정돼요. 값은 CF Access 뒤에서만 내려가고 코드/깃엔 없음.
 */
export default function handler(req, res) {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return res.status(503).json({ error: 'SUPABASE_URL / SUPABASE_ANON_KEY 환경변수를 Vercel에 추가하고 Redeploy 해주세요.' });
  }
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).json({ url, anonKey, slackWebhook: process.env.SLACK_WEBHOOK || '' });
}
