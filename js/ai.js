/* ai.js — Anthropic API 브라우저 직접 호출
   설정 > Anthropic API 키가 필요합니다. (팀 공용 키, 예산 제한 권장) */
import { store } from './store.js';

async function callClaude({ system, prompt, tools = null, maxTokens = 1500 }) {
  const key = store.settings.anthropicKey;
  if (!key) throw new Error('설정에서 Anthropic API 키를 먼저 등록해주세요.');
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };
  if (system) body.system = system;
  if (tools) body.tools = tools;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || 'API 오류 ' + res.status);
  }
  const data = await res.json();
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}

const BRAND_SYSTEM = `당신은 리필드(Refilled) 헤어케어 브랜드 BX 디자인팀의 어시스턴트입니다.
브랜드 무드: clean & clinical + warm minimal. 투명한 액체, 물방울, 부드러운 자연광, 정제된 여백.
핵심 키워드: 엑소좀(cADPR Exo™), 두피 과학, 채움과 비움("Fill you, Be you"), 스파 리추얼.
톤: 과장 없이 정확하고, 절제되어 있으며, 신뢰감 있는 프리미엄.`;

export const ai = {
  /* 프롬프트 다듬기 (나노바나나 프로 / 힉스필드 소울 2) */
  refinePrompt(draft, model) {
    const guide = model === 'higgsfield'
      ? '힉스필드 Soul 2 모델용: 사실적 인물/제품 사진 스타일. 카메라·렌즈·조명 용어를 자연스럽게 포함한 영어 프롬프트 1개.'
      : '나노바나나 프로(이미지 생성)용: 장면을 구체적으로 묘사하는 자연어 영어 프롬프트 1개. 피사체→환경→조명→스타일 순.';
    return callClaude({
      system: BRAND_SYSTEM,
      prompt: `아래 초안 프롬프트를 리필드 브랜드 무드에 맞게 다듬어줘. ${guide}\n프롬프트 텍스트만 출력하고 다른 설명은 하지 마.\n\n초안:\n${draft}`,
    });
  },

  /* 메일 포맷 생성 */
  composeMail({ to, purpose, points, keywords, tone }) {
    return callClaude({
      system: BRAND_SYSTEM + '\n한국 회사 실무 이메일 형식으로 작성합니다.',
      prompt: `아래 정보로 업무 메일을 작성해줘. 제목 1줄 + 본문. 서명은 "리필드 디자인팀 드림"으로.
- 받는 대상: ${to}
- 목적/성격: ${purpose}
- 핵심 포인트: ${points}
- 키워드: ${keywords || '없음'}
- 톤: ${tone}
메일 텍스트만 출력해.`,
      maxTokens: 1200,
    });
  },

  /* 키워드 트렌드 리서치 (웹 검색 포함) */
  researchTrend(keywords) {
    return callClaude({
      system: BRAND_SYSTEM,
      prompt: `"${keywords}" 관련 최신 디자인/뷰티 비주얼 트렌드를 웹에서 조사해서 한국어로 정리해줘.
형식: ① 지금 뜨는 흐름 3가지 (각 2문장) ② 리필드에 적용할 포인트 3가지 ③ 참고할 만한 검색 키워드 5개.
간결하게, 총 400자 내외.`,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      maxTokens: 2000,
    });
  },

  /* 파일 경로 추론 검색: '루미 누끼'처럼 경로에 단어가 없어도 의미로 추론 */
  async inferFiles(query, candidates) {
    const list = candidates.slice(0, 300).map((c, i) => `${i}\t${c.path}`).join('\n');
    const out = await callClaude({
      system: '당신은 디자인팀 파일 서버 검색 도우미입니다. 파일명 관례(누끼=배경제거 PNG, 시안=draft, 최종=final 등)와 한/영 혼용, 약어, 프로젝트 코드명을 이해합니다.',
      prompt: `사용자 검색어: "${query}"
아래 파일 경로 목록에서 검색어의 의도와 맞을 가능성이 높은 파일을 최대 10개 골라줘.
경로에 검색어 단어가 없어도 폴더 구조·파일명·확장자로 추론해.
JSON 배열만 출력: [{"i": 인덱스, "reason": "한 줄 이유"}]

목록:
${list}`,
      maxTokens: 1000,
    });
    const clean = out.replace(/```json|```/g, '').trim();
    const picks = JSON.parse(clean);
    return picks.map(p => ({ ...candidates[p.i], reason: p.reason })).filter(x => x.path);
  },

  /* 금요 리포트 다듬기 */
  polishReport(raw) {
    return callClaude({
      system: BRAND_SYSTEM,
      prompt: `아래 디자인팀 주간 리포트 초안을 상급자 공유용으로 다듬어줘. 구조는 유지하고 문장만 간결하고 명확하게. 텍스트만 출력.\n\n${raw}`,
      maxTokens: 1500,
    });
  },
};
