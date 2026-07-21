/* supabase.js — Supabase 클라이언트 + 사내 인증 브릿지 (사내 표준 패턴)
 *
 * 로그인 UX는 Cloudflare Access 하나로 통일돼요:
 *  1) 사용자는 CF Access를 통과해 허브에 들어옴 (별도 로그인 화면 없음)
 *  2) ensureSession()이 사내 브릿지에 토큰을 요청 → 정품 Supabase 세션 생성
 *  3) 이후 RLS의 auth.role() = 'authenticated' 가 그대로 동작
 *
 * 연결 정보(URL·anon 키)는 /api/config 가 Vercel 환경변수에서 내려줘요.
 * ⚠️ 브릿지 CORS: *.constanthub.kr 와 localhost:3000/3001 에서만 호출 가능.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PROJECT = 'refilled-design-hub';
const BRIDGE = `https://data.constanthub.kr/api/supabase/token?project=${PROJECT}`;
export const LOGIN_URL = 'https://data.constanthub.kr';
const LOGIN_GUIDE = `사내 로그인이 필요해요 — 새 탭에서 ${LOGIN_URL} 에 로그인한 뒤 다시 시도해주세요`;

export let supabase = null;
/* mode: init | ready | need-login | no-config  (no-config = 로컬 정적 서버·환경변수 미설정) */
export const supaState = { mode: 'init', detail: '' };
/* /api/config 가 내려주는 서버 고정 설정값 (env 기반). slackWebhook 있으면 브라우저 저장분보다 우선 */
export const serverConfig = { slackWebhook: '' };

async function loadConfig() {
  let r;
  try { r = await fetch('/api/config'); }
  catch { supaState.mode = 'no-config'; supaState.detail = '/api/config 연결 실패 (배포/네트워크 확인)'; return null; }
  const isJson = (r.headers.get('content-type') || '').includes('json');
  if (!r.ok || !isJson) {
    supaState.mode = 'no-config';
    supaState.detail = !isJson
      ? '정적 서버 로컬 실행 — 로컬 모드로 동작해요 (팀 동기화는 vercel dev 또는 배포 환경에서)'
      : (await r.json().catch(() => ({}))).error || `/api/config 응답 오류 ${r.status}`;
    return null;
  }
  return r.json();
}

/* 앱 시작 시(데이터 로드 전에) 호출 — 성공하면 true */
export async function initSupabase() {
  if (supaState.mode === 'ready') return true;
  if (!supabase) {
    const cfg = await loadConfig();
    if (!cfg) return false;
    serverConfig.slackWebhook = cfg.slackWebhook || '';
    supabase = createClient(cfg.url, cfg.anonKey);
  }
  try {
    await ensureSession();
    supaState.mode = 'ready'; supaState.detail = '';
    return true;
  } catch (e) {
    supaState.mode = 'need-login';
    supaState.detail = String(e.message || e);
    return false;
  }
}

export async function ensureSession() {
  const { data } = await supabase.auth.getSession();
  if (data?.session) return; // 이미 세션 있음 — supabase-js가 자동 갱신
  let r;
  try { r = await fetch(BRIDGE, { credentials: 'include' }); }
  catch { throw new Error(LOGIN_GUIDE); } // CORS/네트워크 → 미로그인과 동일 안내
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    const serverMsg = body?.response?.error || body?.error;
    throw new Error(serverMsg ? `브릿지 오류: ${serverMsg}` : LOGIN_GUIDE);
  }
  const { response } = await r.json();
  const { error } = await supabase.auth.verifyOtp({
    type: response.verificationType || 'magiclink',
    token_hash: response.tokenHash,
  });
  if (error) throw new Error('세션 생성 실패: ' + error.message);
}
