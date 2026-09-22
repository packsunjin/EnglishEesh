// tool_use 응답 정제. 모델이 스키마를 어겨도(선택지 3개, correctIndex 범위 밖 등)
// 그 문항만 버리고 나머지는 쓴다 — 포맷 깨진 응답이라고 전부 버리면 아깝다.

const MAX_QUESTIONS = 100;

function clean(q) {
  if (!q || typeof q !== 'object') return null;
  const question = String(q.question ?? '').trim();
  const explanation = String(q.explanation ?? '').trim();
  const choices = Array.isArray(q.choices) ? q.choices.map((c) => String(c ?? '').trim()) : [];
  const correctIndex = Number.isInteger(q.correctIndex) ? q.correctIndex : -1;

  if (!question || !explanation) return null;
  if (choices.length !== 4 || choices.some((c) => !c)) return null;
  if (correctIndex < 0 || correctIndex > 3) return null;

  return { question, choices, correctIndex, explanation };
}

/**
 * @param {*} raw tool_use 블록의 input.questions (모델이 준 그대로, 형태가 안 맞을 수 있다)
 * @returns {{question, choices:string[4], correctIndex:number, explanation}[]}
 */
export function normalizeQuestions(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const cleaned = list.map(clean).filter(Boolean).slice(0, MAX_QUESTIONS);
  if (!cleaned.length) throw new Error('문제를 하나도 못 만들었다. 학습지 내용을 다시 확인해라.');
  return cleaned;
}
