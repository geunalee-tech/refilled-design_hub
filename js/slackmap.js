/* slackmap.js — 이름 → 슬랙 사용자 ID (알림 멘션용)
 * 요청자 텍스트에 이 이름이 포함되면 슬랙 알림에서 진짜 @멘션으로 변환돼요.
 * 새 팀원은 여기에 한 줄 추가하면 돼요. */
export const SLACK_NAME_MAP = {
  '이근아': 'U08HG3CLKQF', '김연우': 'U09EDALN0G4', '방민현': 'U0BEY32ACP2',
  '김재휘': 'U0627C1LZ9P', '정근식': 'U016HJAQ91U', '고상현': 'U02L1CZV8TH',
  '양지현': 'U09631S0D2A', '이경윤': 'U05P0RJC03T', '장정호': 'U09P8N7UFE1',
  '정세인': 'U0BBKPTDT3K', '정라영': 'U07LDC1AD09', '한아름': 'U08105KBB4G',
  '김주현': 'U07ADJ3TCFM', '형혜진': 'U07KU35AU0N', '김대홍': 'U096Q1VAQ83',
  '최민경': 'U08PE6L08K0', '차준후': 'U0B7HM92Y6L', '송승한': 'U0AH0FHQV9Q',
  '왕케런': 'U0ATKA75BNW', '권정은': 'U0ARE4ZBE05', '김다솜': 'U0BBEFM471T',
  '오은수': 'U08HG3CFQ5D', '우정애': 'U09J48NUTMH', '강다현': 'U0924NBUB6K',
  '김상준': 'U0AQ9FP5A2Y', '김수희': 'U06GWPZ4746', '김태연': 'U0B6PCWUHM0',
  '남기승': 'U0A2R0P80AX', '백선아': 'U0B5CTHNZ3N', '신경환': 'U08UZ5XAUP4',
  '윤여림': 'U06LMKCSCP3', '김민준': 'U0AKMTWD815', '이근영': 'U0262TL1CUV',
  '조희정': 'U09TESAKZNX', '이재영': 'U0A6L7TF3K3', '이재훈': 'U017E5MAGJU',
  '장가영': 'U0BEGGEKZSP', '안이찬': 'U0BERABSLE5', '양미경': 'U0BE651NE5V',
  '신지원': 'U07TS97GAEL',
};

/* 텍스트 속 이름을 슬랙 멘션으로 변환 ("MD팀 강다현" → "MD팀 <@U...>") */
export function mentionizeNames(text) {
  if (!text) return text;
  let out = text;
  for (const name of Object.keys(SLACK_NAME_MAP).sort((a, b) => b.length - a.length)) {
    if (out.includes(name)) out = out.split(name).join(`<@${SLACK_NAME_MAP[name]}>`);
  }
  return out;
}
