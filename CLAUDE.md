# Refilled Design Hub — 프로젝트 규칙

## 사내 개발 표준 (필수 적용)

@/Users/gylee/git/constant-dev-standards/claude-code-standard.md

> 위 표준은 `~/git/constant-dev-standards` 저장소의 회사 공통 개발 표준입니다.
> 이 프로젝트의 모든 신규 개발·수정 작업에 항상 적용하세요.
> (해당 경로가 없는 환경이라면 constant-dev-standards 저장소를 먼저 클론하거나,
> ONBOARDING.md 가이드로 전역 설치(`~/.claude/CLAUDE.md`)를 진행하세요.)

## 이 프로젝트가 뭔가

리필드 디자인팀의 업무 허브 — 대시보드 · 업무 보드 · 위클리 리추얼 · 파일 아카이브 · AI 스튜디오 · 파일 파인더.

- 정적 HTML/JS (`index.html`, `js/`) + Vercel 배포, `api/`에 서버리스 함수 (Notion 동기화, Slack 웹훅, 크론 등)
- 인증: Cloudflare Zero Trust(Access)가 앞단에서 로그인 처리, `middleware.js`와 `api/_lib/cf-access.js`가 CF 서명(JWT)을 검증해 vercel.app 우회 접근 차단 (표준 방식)
- 데이터: 팀 Supabase에 도메인별 테이블·행 단위 저장 (표준 방식). 스키마는 `supabase/schema.sql`,
  브라우저는 `js/supabase.js`(인증 브릿지 `ensureSession`), 서버 크론은 `SUPABASE_SERVICE_KEY` 사용
- 파일은 아직 `files/` 폴더 Git 커밋 (`/api/file`) — 사내 파일허브 전환 예정

## 표준 전환 현황 (2026-07)

**전환 완료:**
- 데이터 저장: `db.json` 통짜 커밋 → **Supabase 행 단위** (`js/store.js`가 변경 행만 upsert/delete). 이관 스크립트: `tools/migrate-supabase.mjs`
- 인증: 자체 구글 OAuth → **Cloudflare Access + 사내 인증 브릿지** (`js/supabase.js`의 `ensureSession`)
- 펄스 크론(`api/pulse-sync.js`, 위클리 리추얼 회의록 아카이빙)도 Supabase 행 단위로 전환
- 노션 업무 수신(구 `api/notion-sync.js`)은 제거됨 — 요청 업무는 허브에서만 등록. 리추얼용 노션 조회(`pulse-sync`)는 별개로 유지.
  - 현재 노션 업무를 허브로 1회 가져오려면 `tools/import-notion-tasks.mjs` (요청/시작 전/진행 중/컨펌요청만, 기획안 링크·기획 텍스트 반영, 멱등)
- 슬랙 알림은 **봇 프록시 `/api/slack-notify`** (봇 토큰 `SLACK_BOT_TOKEN`/`SLACK_CHANNEL_ID` env, CF Access fail-closed 검증):
  - 새 요청 업무 등록 → `store.notifyNewRequest()`가 `chat.postMessage`로 발송하고 반환 `ts`를 업무(`slackTs`/`slackChannel`)에 저장
  - 컨펌요청 전환(요청 업무만) → `store.notifyConfirmUpdate()`가 원본 `ts` 있으면 그 스레드에 "컨펌 요청 상태 업데이트" 댓글 + 요청자·담당자 멘션(`_confirmMentions`, 댓글 `ts`는 `slackConfirmTs`), 원본이 없으면(임포트·구 업무) 새 메시지로 발송하고 그 `ts`를 앵커(`slackTs`)로 저장. 봇 실패 시 웹훅 폴백
  - 업무 삭제 → `store.recallSlack()`가 `chat.delete`로 컨펌 댓글→원본 순 회수 (봇 발송분만; `action:'delete'`)
  - 봇 미설정 시 설정 화면의 Incoming Webhook으로 폴백(새 메시지만, 스레드 댓글 불가). 웹훅은 '일정 협의 요청' 발송에도 사용
- 구성원 정보: 사내 디렉토리 API 자동 동기화 (`js/directory.js` → `store.syncDirectory()`).
  디자인팀 필터는 `teamName`에 '디자인' 포함 기준. 슬랙 멘션도 디렉토리 `slackUserId` 우선,
  `js/slackmap.js` 정적 맵은 폴백 (안정 확인 후 제거 가능)
- AI 호출: 브라우저 직접 호출 → **서버 프록시 `/api/ai`** (키는 `GEMINI_API_KEY`·`ANTHROPIC_API_KEY`
  env에만, 브라우저 노출 없음). Gemini 무료 우선 → Claude 폴백. 프록시는 CF Access를 직접 검증하는
  **fail-closed** — 프로덕션/프리뷰에선 검증 통과자만, 로컬(vercel dev)만 예외. `CF_ACCESS_AUD` 없으면
  검증 불가라 프록시가 401로 잠김(키는 안전)
- 파일 업로드: 사내 파일허브(`data.constanthub.kr/api/files/upload`) → URL만 DB 저장 (`js/files.js`).
  클라이언트는 모든 파일을 업로드 시도(50MB) — **허용 확장자는 파일허브 서버가 판정**하고, 막힌 파일은
  서버 에러 메시지가 그대로 표시됨. 문서·디자인 파일이 막히면 파일허브 툴 설정(`tool=refilled-design-hub`)에서
  확장자 허용 필요 (테크팀). AI 스튜디오의 base64는 LLM 전송용(비저장)이라 표준 예외

**정리 예정 (안정화 후):**
- `api/db.js`(구 GitHub 동기화, 현재 미사용) 제거 — 클라이언트는 Supabase 직접 접근
- `api/file.js` — 업로드(POST)는 파일허브로 대체돼 미사용. 다운로드(GET)는 구 `files/` 첨부 조회에만 필요, 구 첨부 소진 후 제거
- `api/db.js`·`api/file.js`의 구 쿠키(hub_s) 폴백 — CF Access 안정 확인 후 제거
- `data/db.json`·`files/` — 읽기 전용, 더 이상 갱신되지 않음
- 브릿지·파일허브 CORS 제약: `*.constanthub.kr`·`localhost:3000/3001`에서만 동작 (vercel.app 기본 도메인 불가)

## 주의

- `refilled-design-hub-v48/`는 과거 스냅샷 폴더 — 수정하지 않습니다. 작업은 루트의 `index.html`/`js`/`api`에서.
- API 키·토큰은 절대 코드에 하드코딩하지 않고 Vercel 환경변수로 관리 (표준과 동일).
- 커밋 메시지는 기존 관례(`hub: ...`)를 따릅니다.
