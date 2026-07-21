/* directory.js — 사내 디렉토리 API (사내 표준)
 * 구성원·팀 정보의 원천. 명단을 코드·DB에 복사해 두지 않기 위한 연동이에요
 * (사본은 입사·퇴사가 반영되지 않으므로).
 * CORS: *.constanthub.kr 와 localhost:3000/3001 에서만 호출 가능 — 브릿지와 동일.
 */
const BASE = 'https://data.constanthub.kr/api/directory';

let cache = null;

/** { me, members } — me는 현재 접속자(실패 시 null), members는 활성 구성원 전체 */
export async function fetchDirectory() {
  if (cache) return cache;
  const get = async path => {
    const r = await fetch(`${BASE}/${path}`, { credentials: 'include' });
    if (!r.ok) throw new Error(`디렉토리 ${path} 응답 ${r.status}`);
    return (await r.json()).response;
  };
  const [me, members] = await Promise.all([
    get('me').catch(() => null),
    get('members'),
  ]);
  cache = { me, members: members || [] };
  return cache;
}
