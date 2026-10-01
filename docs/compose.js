// 채점 요청 문자열을 만든다.
//
// 자동 모드(서버가 API 호출)와 복사 모드(사용자가 Claude 앱에 붙여넣기)가
// **같은 함수**를 쓴다. 두 모드의 채점 결과가 갈리면 안 되기 때문이다.

export const CATEGORIES = ['어휘', '구문', '논리', '지시어', '범위'];

/** 해설지에 없는 문항일 때 모델을 태우지 않고 코드가 바로 내놓는 답. */
export const NOT_IN_KEY = '해설지에 없음';

/**
 * 한 문항의 근거 자료 블록.
 * 여기 없는 내용은 존재하지 않는 것으로 취급하라고 프롬프트가 못박는다.
 */
export function buildSource(q) {
  const parts = [
    '<자료>',
    `문항: ${q.no}번${q.유형 ? ` (${q.유형})` : ''}`,
  ];
  if (q.발문) parts.push(`발문: ${q.발문}`);
  parts.push('지문:', q.지문);
  if (q.선지?.length) parts.push('선지:', q.선지.join('\n'));
  if (q.각주?.length) parts.push(`각주: ${q.각주.join(' ')}`);
  if (q.정답) parts.push(`정답: ${q.정답}`);
  if (q.모범해석) parts.push('해설지 모범해석:', q.모범해석);
  if (q.어휘?.length) parts.push(`해설지 어휘: ${q.어휘.join(' / ')}`);
  parts.push('</자료>');
  return parts.join('\n');
}

/** 사양이 정한 입력 형식 그대로. */
export function buildInput({ no, translation, answer }) {
  const lines = [`[문항] ${no}번`, `[내 해석] ${(translation || '').trim()}`];
  if (answer) lines.push(`[내 답] ${answer}`);
  return lines.join('\n');
}

/**
 * 모델에게 보낼 사용자 턴.
 * @param {object} q       문항 은행 항목
 * @param {object} input   { translation, answer }
 * @param {Array}  history 같은 문항의 이전 시도 [{ translation, 결과, 분류 }]
 */
export function buildUserTurn(q, input, history = []) {
  const parts = [buildSource(q)];

  if (history.length) {
    parts.push(
      '',
      `<이전시도> 이 문항을 ${history.length}번 채점했다. 같은 실수를 또 했는지 먼저 봐라.`,
      ...history.map((h, i) => `${i + 1}회차 [${h.결과 || '?'}/${h.분류 || '?'}] ${h.translation}`),
      '</이전시도>',
    );
  }

  parts.push('', buildInput({ no: q.no, ...input }));
  return parts.join('\n');
}

/**
 * 복사 모드용 전체 프롬프트.
 * @param {string} rules   prompts/coach.md + adapter.md 합본
 * @param {boolean} standalone true면 규칙까지 통째로(새 대화용),
 *                             false면 문항만(규칙이 이미 올라간 대화용)
 */
export function buildCopyPrompt(q, input, { rules = '', history = [], standalone = true } = {}) {
  const turn = buildUserTurn(q, input, history);
  return standalone && rules ? `${rules.trim()}\n\n---\n\n${turn}` : turn;
}
