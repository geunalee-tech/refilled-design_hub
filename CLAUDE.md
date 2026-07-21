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
- 노션 미러링·펄스 크론(`api/notion-sync.js`, `api/pulse-sync.js`)도 Supabase 행 단위로 전환
- 구성원 정보: 사내 디렉토리 API 자동 동기화 (`js/directory.js` → `store.syncDirectory()`).
  디자인팀 필터는 `teamName`에 '디자인' 포함 기준. 슬랙 멘션도 디렉토리 `slackUserId` 우선,
  `js/slackmap.js` 정적 맵은 폴백 (안정 확인 후 제거 가능)

**남은 차이 (새 기능 작성 시 표준을 따를 것):**

| 항목 | 현재 | 표준 |
|---|---|---|
| 파일 저장 | `files/` 폴더에 Git 커밋 (`/api/file`) | 사내 파일 API (`data.constanthub.kr/api/files/upload`) → URL만 저장. constanthub.kr 서브도메인 연결 완료 — 전환 가능 상태 |

**정리 예정 (안정화 후):**
- `api/db.js`(구 GitHub 동기화)와 `api/db.js`·`api/file.js`의 구 쿠키(hub_s) 폴백 — CF Access·Supabase 안정 확인 후 제거
- `data/db.json` — 읽기 전용 백업으로 유지, 더 이상 갱신되지 않음
- 브릿지 CORS 제약: Supabase 동기화는 `*.constanthub.kr`·`localhost:3000/3001`에서만 동작 (vercel.app 기본 도메인 불가)

## 주의

- `refilled-design-hub-v48/`는 과거 스냅샷 폴더 — 수정하지 않습니다. 작업은 루트의 `index.html`/`js`/`api`에서.
- API 키·토큰은 절대 코드에 하드코딩하지 않고 Vercel 환경변수로 관리 (표준과 동일).
- 커밋 메시지는 기존 관례(`hub: ...`)를 따릅니다.
