/* ai.js — LLM 브라우저 직접 호출
   Google Gemini(무료 등급) 우선, Anthropic 키가 있으면 Claude 사용.
   설정 > AI 기능에서 키를 등록하세요. */
import { store } from './store.js';

/* ── Google Gemini (aistudio.google.com 무료 키) ── */
/* 모델 폴백 체인: 모델 은퇴(404)뿐 아니라 무료 사용량 초과(429)도 다음 모델로 자동 폴백 */
const GEMINI_MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash', 'gemini-2.5-flash'];
let geminiModelIdx = 0; // 성공한 모델을 기억해 다음 호출부터 바로 사용

function friendlyGeminiErr(status, raw) {
  if (status === 429 || /quota|RESOURCE_EXHAUSTED|rate.?limit/i.test(raw)) {
    const e = new Error('Gemini 무료 사용량 한도를 초과했어요. 몇 분 뒤 다시 시도하거나, 내일 한도가 초기화된 후 사용해주세요. (설정에서 다른 구글 계정 키로 교체도 가능해요)');
    e.quota = true; return e;
  }
  if (/API key not valid|API_KEY_INVALID/i.test(raw))
    return new Error('Gemini API 키가 올바르지 않아요. 설정 > AI 기능에서 키를 확인해주세요.');
  return new Error(raw || 'Gemini API 오류 ' + status);
}

async function callGemini({ system, prompt, images = null, tools = null, maxTokens = 1500 }) {
  const key = store.settings.geminiKey;
  const parts = [];
  (images || []).forEach(im => parts.push({ inline_data: { mime_type: im.mime, data: im.data } }));
  parts.push({ text: prompt });
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { maxOutputTokens: Math.max(maxTokens, 2048) },
  };
  if (system) body.system_instruction = { parts: [{ text: system }] };
  if (tools) body.tools = [{ google_search: {} }]; // 웹 검색 요청 → Gemini 그라운딩으로 매핑

  let res = null, lastStatus = 0, lastErr = '';
  for (let i = geminiModelIdx; i < GEMINI_MODELS.length; i++) {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODELS[i]}:generateContent?key=${encodeURIComponent(key)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) { geminiModelIdx = i; break; }
    const err = await res.json().catch(() => ({}));
    lastStatus = res.status;
    lastErr = err?.error?.message || ('Gemini API 오류 ' + res.status);
    // 폴백 대상: 모델 은퇴/미지원(404) + 해당 모델 사용량 초과(429). 키 오류 등은 즉시 중단
    const fallbackable = res.status === 404 || res.status === 429
      || /no longer available|not found|not supported|quota|RESOURCE_EXHAUSTED/i.test(lastErr);
    if (!fallbackable) throw friendlyGeminiErr(res.status, lastErr);
    res = null;
  }
  if (!res) throw friendlyGeminiErr(lastStatus, lastErr);
  const data = await res.json();
  const out = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('\n').trim();
  if (!out) throw new Error('Gemini 응답이 비어 있어요' + (data.candidates?.[0]?.finishReason ? ` (${data.candidates[0].finishReason})` : ''));
  return out;
}

/* ── 공용 진입점: Gemini 키 → Gemini, 아니면 Anthropic ── */
function callLLM(args) {
  if (store.settings.geminiKey) return callGemini(args);
  if (store.settings.anthropicKey) return callClaude(args);
  throw new Error('설정 > AI 기능에서 Gemini(무료) 또는 Anthropic API 키를 먼저 등록해주세요.');
}

async function callClaude({ system, prompt, images = null, tools = null, maxTokens = 1500 }) {
  const key = store.settings.anthropicKey;
  if (!key) throw new Error('설정에서 Anthropic API 키를 먼저 등록해주세요.');
  const content = [];
  (images || []).forEach(im => content.push({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.data } }));
  content.push({ type: 'text', text: prompt });
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content }],
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

/* ═══════════ 프롬프트 빌더: 3가지 타입별 시스템 프롬프트 ═══════════ */

const MJ_SYSTEM = `${BRAND_SYSTEM}

당신은 미드저니(Midjourney) 전문 프롬프트 엔지니어입니다. 팀이 준 레퍼런스 이미지·텍스트 디렉션을 분석해 미드저니에 바로 붙여넣을 수 있는 프롬프트를 만듭니다.

미드저니 프롬프트 작성 규칙:
- 영어로 작성. 문장보다 밀도 높은 구(phrase)의 나열이 효과적: [주제/피사체] → [환경/배경] → [조명] → [컬러 팔레트] → [질감/디테일] → [스타일/카메라] 순서.
- 사진 스타일이면 카메라·렌즈·필름 용어를 포함 (예: shot on Phase One, 80mm lens, f/8, editorial beauty photography).
- 부정 표현("no people")은 프롬프트 본문에 쓰지 않고 --no 파라미터로 분리 (예: --no people, hands, text).
- 파라미터는 마지막에: --ar (요청 비율), --style raw (제품/에디토리얼 사진의 정확도용), 필요 시 --s 50~250, --no ...
- 레퍼런스 이미지가 첨부되면: 이미지의 무드·조명·구도·컬러를 언어로 완전히 번역해 프롬프트에 녹입니다. (미드저니에 이미지 URL을 함께 쓰려면 프롬프트 맨 앞에 붙이라고 팁에 안내)
- 제품 패키지의 정확한 재현은 미드저니가 약하므로, 제품 로고·문구 재현이 핵심이면 팁에서 나노바나나 프로 사용을 권하세요.

출력 형식 (정확히 지킬 것):
1) 완성된 미드저니 프롬프트 한 덩어리 (파라미터 포함, 다른 텍스트 없이)
2) 그 아래 '---' 구분선 한 줄
3) 한국어로 짧은 활용 팁 2~3줄 (버전 파라미터, 변형 팁, 주의점)`;

const NB_SYSTEM = `${BRAND_SYSTEM}

당신은 나노바나나 프로(Nano Banana Pro) 전문 프롬프트 엔지니어입니다. 나노바나나 프로는 참조 이미지 여러 장 + 텍스트 프롬프트를 함께 입력받아, 제품 디자인을 보존하면서 합성·연출하는 데 강합니다.

나노바나나 프로 프롬프트 작성 규칙 (리필드 팀 표준 구조):
- 영어로 작성하며, 아래 섹션 구조를 따릅니다. 첨부된 참조 이미지들의 역할(무드 레퍼런스 / 히어로 제품 / 보조 제품 등)을 "Image 1", "Image 2"처럼 번호로 지정합니다. 사용자가 알려준 각 이미지의 역할을 그대로 매핑하세요.

섹션 구조:
[Opening] Create a ... 로 시작하는 전체 지시 1~2문장 (어떤 이미지를 무엇의 레퍼런스로 쓰는지 명시)
Reference roles: 각 이미지 번호 = 역할 목록
Overall direction: 전체 무드·톤 방향
Hero product focus: 주인공 제품이 무엇인지, 보조 요소는 어떻게 절제할지
Product fidelity: 패키지 보존 규칙 — exact silhouette / proportions / cap shapes / typography placement / logo placement / printed text / color details / material feel 을 명시하고 변형 금지를 선언
Composition: 배치·여백·플랫폼/표면
Mood and styling: 레퍼런스 무드를 구체 언어로
Lighting: 광원 방향·질감·반사
Background: 배경 톤과 정리
Material rendering: 제품별 재질 지시 (매트/새틴/글로시, 불투명/투명 여부를 오해 없게)
Restrictions: no people / no hands / no clutter / no text overlays / no label changes / no product deformation 등
Final goal: 최종 이미지 한 문장 요약

- 제품이 불투명해야 하면 "matte and opaque, not transparent"처럼 반대 해석을 차단하는 이중 표현을 쓰세요.
- 물방울·수분 연출은 "controlled, elegant, not messy"로 절제를 명시하세요.

출력 형식 (정확히 지킬 것):
1) 완성된 영어 프롬프트 전체 (위 섹션 구조)
2) '---' 구분선 한 줄
3) 한국어 활용 팁 2~3줄: 이미지를 어떤 순서로 첨부해야 하는지(생성된 프롬프트의 Image 번호 순서와 동일하게), 재생성 시 조정 포인트`;

const SOUL_SYSTEM = `${BRAND_SYSTEM}

You are a specialized prompt engineer for Higgsfield Soul 2.0, dedicated to the beauty brand "Refilled."
Analyze any visual or textual input from the team, then translate it into a precise text-only prompt for Soul 2.0.

IMPORTANT CONSTRAINT: Higgsfield Soul 2.0 accepts either an image upload OR a text prompt — not both. All prompts you generate are TEXT-ONLY. Encode all visual information — mood, composition, lighting, color, texture — entirely into words, so nothing is lost.

## REFILLED VISUAL LANGUAGE (apply to every prompt)
Composition: subject is the clearest, most dominant element; strong visual boundary between subject and background via precise edge definition (not darkness); deliberate negative space; tight crops and macro details exposing material surface.
Lighting: bright, clean studio lighting — never moody or dim; identifiable directional light source with crisp defined shadows on a light surface; no dark shadows filling the frame; high-key or near-high-key exposure; rim lighting to define subject edges.
Color: base palette always light — clean white, off-white, pale cool grey, light ice blue, translucent; contrast from precision and edge clarity, not dark-vs-light; accent colors pop against light neutral base; cool crisp temperature, no warmth or yellow cast; gradients shift abruptly (dramatic tonal snap, never soft fade). Avoid: dark backgrounds, heavy shadows, murky low-key tones.
Texture & Material: surface detail always visible and precise (frosted glass, clear liquid, matte packaging, skin pore texture); tactile and refined; no smoothing, no soft-focus.
Mood: refined, light, precise — like a well-lit high-end editorial; quiet authority from clarity and control; premium beauty magazine spread in a bright studio; not warm, not moody, not clinical — clean intelligence in a well-lit space.
Model Persona (if a person appears): East Asian female — natural double eyelid, brown eyes, non-westernized features; hair pulled back cleanly (slicked-back wet-look / all-back straight / tight all-back ponytail); neutral to subtle composed expression; white, light grey, or clean neutral clothing; luminous skin with visible texture — not airbrushed, not dewy; defined groomed full eyebrows; high-end fashion model in a bright beauty editorial.

## WORDS TO AVOID IN ALL PROMPTS
dark background / moody / dramatic darkness / low-key / deep shadows / murky / heavy contrast / dim / dreamy / romantic / soft and warm / hazy / bokeh blend / gentle / golden / cozy / natural light / soft gradient / gentle fade

## OUTPUT FORMAT (follow exactly)
Generate a single structured text prompt in English, ready to paste into Soul 2.0:

[Opening line] One sentence describing the shot type and overall direction.

MOOD & STYLE:
Concrete visual terms. Translate any reference image into precise descriptive language — lighting quality, color temperature, material feel, editorial style. Ground in Refilled language: refined / light / precise / high-contrast edges / tactile / quietly authoritative / bright studio.

COMPOSITION:
- Background: [specific color and quality — always bright and open]
- Subject: [exact position, angle, orientation]
- Supporting elements: [if any]
- Spatial relationships: [how elements relate in frame]
- Camera angle: [exact angle and height]

PHOTOGRAPHY:
- Lighting: [source direction, quality — bright, directional, crisp shadow definition on light surfaces]
- Lens feel: [focal length, depth of field]
- Color palette: [3–5 specific light and cool tones]
- Mood: [refined, light, precise — 1–2 descriptors]

OUTPUT SPECS:
- Aspect ratio: [as requested]
- Quality: photorealistic, magazine-grade, ultra-detailed
- [Preservation or rendering notes if needed]

End the English prompt with these fixed descriptors:
bright editorial lighting, sharp subject isolation, refined light contrast, analytical composition, high-end Korean beauty editorial

Then output a '---' separator line, then a short note in Korean explaining which elements are most critical for Refilled brand alignment and any watch-outs for this specific shot. (한국어 노트까지만 출력하고, 사용 가이드는 출력하지 마세요 — 앱이 자동으로 붙입니다.)`;

/* Soul 2.0 고정 사용 가이드 — 앱에서 결과 하단에 자동 표기 */
export const SOUL_GUIDE = `### 힉스필드 Soul 2.0 사용 가이드

**이것만 기억하세요**
Soul 2.0은 이미지 업로드와 텍스트 프롬프트를 동시에 사용할 수 없어요.
위 텍스트 프롬프트를 그대로 복사해서 입력하세요. 레퍼런스 이미지의 시각 정보는 이미 텍스트에 모두 담겨 있어요.

**1단계 — 모델 선택**: 힉스필드 Image 생성 메뉴에서 Soul 2.0 모델 선택
**2단계 — 텍스트 프롬프트 입력**: 위 프롬프트를 그대로 붙여넣고 생성 (이미지는 업로드하지 않음)
**3단계 — 생성 후 체크리스트**:
· 전체 톤이 밝고 정제된 느낌인가? (어둡거나 무겁지 않은가)
· 피사체와 배경이 명확하게 분리되어 있는가?
· 대비가 어둠이 아닌 선명한 경계와 색감에서 오는가?
· 그라데이션이 있다면 극적으로 전환되는가?
· 소재의 질감이 또렷하게 보이는가?
· 모델 샷이라면 헤어가 깔끔하게 넘겨져 있는가?

**4단계 — 재생성이 필요할 때** (프롬프트 끝에 추가):
· 너무 어두울 때 → "high-key lighting, bright white background, increase overall exposure"
· 배경 분리가 약할 때 → "sharpen subject edges, increase contrast at subject boundary"
· 톤이 너무 따뜻할 때 → "shift all tones cooler, remove warm cast"
· 그라데이션이 부드러울 때 → "make gradient more abrupt, dramatic tonal shift"
· 질감이 부족할 때 → "enhance surface texture detail, tactile material feel"
· 모델이 너무 인위적일 때 → "natural skin texture, reduce retouching, editorial beauty"`;

const PB_SYSTEMS = { midjourney: MJ_SYSTEM, nanobanana: NB_SYSTEM, higgsfield: SOUL_SYSTEM };

export const ai = {
  /* ═══ 프롬프트 빌더: 타입별 생성 (이미지 최대 5장 참조) ═══ */
  buildImagePrompt({ type, purpose, subject, direction, ratio, images }) {
    const roleLines = (images || []).map((im, i) => `Image ${i + 1} = ${im.role}`).join('\n');
    const prompt = `아래 정보와 첨부된 레퍼런스 이미지 ${images?.length || 0}장을 분석해서, 시스템 지침의 출력 형식대로 프롬프트를 생성해줘.

${roleLines ? `첨부 이미지 역할:\n${roleLines}\n` : '(첨부 이미지 없음 — 텍스트 정보만으로 생성)\n'}
- 목적/용도: ${purpose || '미지정'}
- 피사체: ${subject || '미지정'}
- 추가 디렉션: ${direction || '없음'}
- 비율: ${ratio}

지침의 출력 형식 외에 다른 설명은 붙이지 마.`;
    return callLLM({ system: PB_SYSTEMS[type] || NB_SYSTEM, prompt, images, maxTokens: 4000 });
  },

  /* (구버전 호환) 프롬프트 다듬기 */
  refinePrompt(draft, model) {
    const guide = model === 'higgsfield'
      ? '힉스필드 Soul 2 모델용: 사실적 인물/제품 사진 스타일. 카메라·렌즈·조명 용어를 자연스럽게 포함한 영어 프롬프트 1개.'
      : '나노바나나 프로(이미지 생성)용: 장면을 구체적으로 묘사하는 자연어 영어 프롬프트 1개. 피사체→환경→조명→스타일 순.';
    return callLLM({
      system: BRAND_SYSTEM,
      prompt: `아래 초안 프롬프트를 리필드 브랜드 무드에 맞게 다듬어줘. ${guide}\n프롬프트 텍스트만 출력하고 다른 설명은 하지 마.\n\n초안:\n${draft}`,
    });
  },

  /* 메일 포맷 생성 */
  composeMail({ to, purpose, points, keywords, tone }) {
    return callLLM({
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

  /* 파일 경로 추론 검색: '루미 누끼'처럼 경로에 단어가 없어도 의미로 추론 */
  async inferFiles(query, candidates) {
    const list = candidates.slice(0, 300).map((c, i) => `${i}\t${c.path}`).join('\n');
    const out = await callLLM({
      system: '당신은 디자인팀 파일 서버 검색 도우미입니다. 파일명 관례(누끼=배경제거 PNG, 시안=draft, 최종=final, 단상자=박스/패키지 등)와 한/영 혼용, 약어, 붙여쓰기/띄어쓰기 변형, 프로젝트 코드명을 이해합니다. 검색어의 모든 단어(개념)를 동시에 만족하는 파일을 최우선으로 고릅니다.',
      prompt: `사용자 검색어: "${query}"
아래 파일 경로 목록에서 검색어의 의도와 맞을 가능성이 높은 파일을 최대 10개 골라줘.
중요: 검색어를 단어별로 쪼개서 각 단어가 별개로 일부만 일치하는 파일보다, 모든 단어의 의미를 동시에 만족하는 파일을 우선해.
경로에 검색어 단어가 그대로 없어도 폴더 구조·파일명·확장자·동의어(단상자↔박스↔box, 최종↔final)로 추론해.
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
    return callLLM({
      system: BRAND_SYSTEM,
      prompt: `아래 디자인팀 주간 리포트 초안을 상급자 공유용으로 다듬어줘. 구조는 유지하고 문장만 간결하고 명확하게. 텍스트만 출력.\n\n${raw}`,
      maxTokens: 1500,
    });
  },
};
