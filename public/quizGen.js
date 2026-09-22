// 단어 항목 → 4지선다 문제 (클래스카드 식 단어 시험).
//
// API를 타지 않는다. 항목 목록만 있으면 그 안에서 오답(distractor)을 뽑아
// 즉석에서 문제를 만든다 — 서버도 필요 없고, 무엇을 올리든 항상 동작한다.

export const DIRECTIONS = ['term-to-meaning', 'meaning-to-term', 'mixed'];

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildQuestion(item, allItems, direction, rng) {
  const askTerm = direction === 'term-to-meaning';
  const field = askTerm ? 'meaning' : 'term';
  const correct = item[field];

  const uniqueValues = [...new Set(
    allItems.filter((o) => o !== item && o[field] !== correct).map((o) => o[field]),
  )];
  const distractors = shuffle(uniqueValues, rng).slice(0, 3);
  const choices = shuffle([correct, ...distractors], rng);

  return {
    direction,
    term: item.term,
    meaning: item.meaning,
    prompt: askTerm ? item.term : item.meaning,
    choices,
    correctIndex: choices.indexOf(correct),
  };
}

/**
 * 항목 목록에서 한 회분 시험 문제를 만든다.
 * 항목이 size보다 적으면 있는 만큼만 만든다(부풀리지 않는다).
 */
export function buildRound(items, { size = 50, direction = 'term-to-meaning', rng = Math.random } = {}) {
  if (!Array.isArray(items) || items.length < 2) {
    throw new Error('문제를 만들려면 항목이 최소 2개는 있어야 한다.');
  }
  const picked = shuffle(items, rng).slice(0, Math.min(size, items.length));
  return picked.map((item) => {
    const dir = direction === 'mixed' ? (rng() < 0.5 ? 'term-to-meaning' : 'meaning-to-term') : direction;
    return buildQuestion(item, items, dir, rng);
  });
}

/** 채점: 문제 배열 + 고른 선지 인덱스 배열(-1 = 안 고름) → 결과 요약. */
export function scoreRound(questions, answers) {
  const details = questions.map((q, i) => {
    const chosenIndex = answers[i] ?? -1;
    return { ...q, chosenIndex, isCorrect: chosenIndex === q.correctIndex };
  });
  const correct = details.filter((d) => d.isCorrect).length;
  return { total: questions.length, correct, wrong: questions.length - correct, details };
}
