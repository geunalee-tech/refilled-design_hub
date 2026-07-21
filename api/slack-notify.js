/* api/slack-notify.js — 슬랙 봇 발송 프록시 (봇 토큰은 서버 env에만, 브라우저 노출 안 됨)
 *
 * 브라우저(js/store.js)가 {text, blocks?, threadTs?, channel?}를 POST하면
 * 서버가 봇 토큰으로 chat.postMessage를 호출하고 {ok, ts, channel}을 돌려줘요.
 *  - threadTs 없음 → 채널에 새 메시지 (예: "새 요청 업무"). 반환된 ts를 업무에 저장.
 *  - threadTs 있음 → 그 메시지 스레드에 댓글 (예: "컨펌 요청 상태 업데이트").
 * Incoming Webhook은 스레드 댓글이 불가라 이 경로(봇 토큰)가 필요해요.
 *
 * 보안: /api/*는 미들웨어 게이트에서 제외되므로 이 함수가 직접 CF Access를 검증(fail-closed).
 *   프로덕션·프리뷰에선 검증 통과자만, 로컬(vercel dev)만 예외. (api/ai.js와 동일 패턴)
 *
 * 필요한 환경변수:
 *  SLACK_BOT_TOKEN  — 봇 토큰(xoxb-...). 스코프: chat:write. 대상 채널에 봇 초대 필요.
 *  SLACK_CHANNEL_ID — 기본 발송 채널 ID (요청 시 channel로 덮어쓸 수 있음)
 *  CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD — 호출자 인증 (middleware.js와 동일)
 */
import { verifyCfAccess } from './_lib/cf-access.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // 인증: CF Access 검증 (fail-closed). 로컬 vercel dev(development)만 예외.
  const cf = await verifyCfAccess(req);
  const isLocal = !process.env.VERCEL_ENV || process.env.VERCEL_ENV === 'development';
  if (!cf.ok && !isLocal) return res.status(401).json({ error: '사내 로그인이 필요해요.' });

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return res.status(503).json({ error: 'SLACK_BOT_TOKEN 미설정 — 테크팀에 봇 토큰(chat:write) 발급을 요청하세요.' });

  const { action, text, blocks, threadTs, channel, ts } = req.body || {};
  const ch = channel || process.env.SLACK_CHANNEL_ID;
  if (!ch) return res.status(400).json({ error: 'channel 또는 SLACK_CHANNEL_ID가 필요해요.' });

  // 메시지 회수 (chat.delete) — 봇이 보낸 메시지만 삭제 가능
  if (action === 'delete') {
    if (!ts) return res.status(400).json({ error: '삭제할 메시지 ts가 필요해요.' });
    try {
      const r = await fetch('https://slack.com/api/chat.delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ channel: ch, ts }),
      });
      const j = await r.json().catch(() => ({}));
      // 이미 지워진 메시지(message_not_found)는 성공으로 간주
      if (!j.ok && j.error !== 'message_not_found') return res.status(502).json({ error: `Slack 오류: ${j.error || r.status}` });
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  }

  // 메시지 permalink 조회 (chat.getPermalink) — 업무 카드 → 슬랙 메시지 바로가기용
  if (action === 'permalink') {
    if (!ts) return res.status(400).json({ error: '메시지 ts가 필요해요.' });
    try {
      const r = await fetch(
        `https://slack.com/api/chat.getPermalink?channel=${encodeURIComponent(ch)}&message_ts=${encodeURIComponent(ts)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const j = await r.json().catch(() => ({}));
      if (!j.ok || !j.permalink) return res.status(502).json({ error: `Slack 오류: ${j.error || r.status}` });
      return res.status(200).json({ ok: true, permalink: j.permalink });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  }

  if (!text) return res.status(400).json({ error: 'text가 필요해요.' });

  const payload = { channel: ch, text };
  if (Array.isArray(blocks) && blocks.length) payload.blocks = blocks;
  if (threadTs) payload.thread_ts = threadTs;

  try {
    const r = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) return res.status(502).json({ error: `Slack 오류: ${j.error || r.status}` });
    return res.status(200).json({ ok: true, ts: j.ts, channel: j.channel });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
