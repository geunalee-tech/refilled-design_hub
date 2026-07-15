# Refilled Design Hub

리필드 디자인팀의 업무 허브 — 대시보드 · 업무 보드 · 위클리 리추얼 · 파일 아카이브 · AI 스튜디오 · 파일 파인더를 하나의 사이트에서.

서버 없이 **GitHub Pages(무료)** 로 배포하고, **이 저장소의 `data/db.json`** 을 팀 공유 데이터베이스로 사용합니다. 모든 변경이 커밋으로 남아 자동 백업·이력 관리가 됩니다.

---

## 1. 배포하기 (5분)

1. 이 폴더 전체를 GitHub에 새 저장소로 올립니다 (팀 계정 권장, **Private 가능** — Private이어도 Pages는 유료 플랜 필요하니, 무료로 쓰려면 Public + 민감정보는 db.json에 넣지 않기).
   ```bash
   git init
   git add .
   git commit -m "Refilled Design Hub 초기 세팅"
   git remote add origin https://github.com/<팀계정>/<저장소이름>.git
   git push -u origin main
   ```
2. 저장소 → **Settings → Pages → Source: Deploy from a branch → main / (root)** 저장.
3. 1~2분 뒤 `https://<팀계정>.github.io/<저장소이름>/` 에서 접속 가능. 이 주소를 팀에 공유하세요.

## 2. 팀 동기화 켜기 (각자 1회)

앱 접속 → **설정 → 팀 공유 동기화**:

- **저장소**: `<팀계정>/<저장소이름>`
- **토큰**: GitHub → Settings → Developer settings → **Fine-grained personal access token** 생성
  - Repository access: 이 저장소 하나만
  - Permissions: **Contents → Read and write** 만
- "저장 후 연결 테스트" 클릭 → `팀 동기화 ✓` 배지가 뜨면 완료.

이후 업무/문서/아카이브를 수정하면 자동으로 `data/db.json`에 커밋됩니다. 팀원 각자 자기 토큰을 쓰면 **누가 수정했는지 커밋 기록에 남습니다.**

## 3. AI 기능 켜기 (선택)

설정 → **Anthropic API 키** 등록. 다음 기능에 사용됩니다:

- 메일 포맷 자동 생성
- 트렌드 리서치 (웹 검색 기반)
- 파일 파인더 AI 추론 검색 ("루미 누끼" → 경로에 '루미'가 없어도 추론)
- 프롬프트/리포트 AI 다듬기

> ⚠ 키는 각자 브라우저에만 저장되지만, 팀 공용 키를 쓸 경우 [콘솔](https://console.anthropic.com)에서 **월 사용 한도(예: $20)** 를 꼭 설정하세요. 프롬프트 빌더의 기본 생성은 API 없이 무료로 동작합니다.

## 4. 파일 파인더 인덱스 만들기 (선택)

공유 드라이브가 연결된 PC에서:

```bash
python tools/build_index.py "D:/디자인팀"
git add data/fileindex.json && git commit -m "파일 인덱스 갱신" && git push
```

주 1회 정도 갱신하면 됩니다.

## 구조

```
index.html          앱 셸
css/style.css       스타일 (리필드 무드 토큰)
js/store.js         데이터 스토어 + GitHub 동기화
js/ai.js            Anthropic API 호출
js/views/           대시보드·업무·리추얼·아카이브·스튜디오·파인더·설정
data/db.json        팀 공유 데이터 (앱이 자동 생성/갱신)
data/fileindex.json 파일 파인더 인덱스 (스크립트로 생성)
tools/build_index.py 인덱스 생성 스크립트
```

## 운영 팁 (팀장용)

- **금요일 오후**: 위클리 리추얼 → 금요 리포트 → "⚡ 자동 초안" → 의사결정 포인트만 채우고 "전체 복사" → 슬랙/메일 공유. 5분 컷이 목표.
- **타팀 요청**: 요청이 오면 업무 보드 → "타팀 요청 받기"로 인입 컬럼에 먼저 쌓고, 위클리에서 수락/배정. 요청이 대시보드 "타팀 인입" 숫자로 보이는 것 자체가 협상 근거가 됩니다.
- **미팅록 액션 아이템**: 회의 중 바로 입력하고 "업무로 보내기" — 회의록과 업무 보드가 어긋나지 않게 하는 핵심 습관.
