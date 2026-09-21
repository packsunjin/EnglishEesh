// 채점 기록 집계. `정리` 명령은 이걸로 처리한다 — API를 타지 않는다.
//
// 모델에게 세게 하면 세션이 끊길 때 사라지고 수도 틀린다.
// 기록은 브라우저(IndexedDB)에 남고, 집계는 여기서 결정적으로 계산된다.

import { CATEGORIES } from './compose.js';

/**
 * @param {Array} records [{ no, 결과, 분류, ts }]
 * @returns {{총시도, 맞음, 부분맞음, 틀림, 분류별, 최다분류, 푼문항}}
 */
export function summarize(records = []) {
  const 분류별 = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  let 맞음 = 0, 부분맞음 = 0, 틀림 = 0;
  const 푼문항 = new Set();

  for (const r of records) {
    if (!r || r.결과 === '해설지에 없음') continue;
    푼문항.add(r.no);
    if (r.결과 === '맞음') 맞음++;
    else if (r.결과 === '부분맞음') 부분맞음++;
    else if (r.결과 === '틀림') 틀림++;
    // 맞은 문항엔 분류가 없다. 틀린 것만 센다.
    if (r.결과 !== '맞음' && CATEGORIES.includes(r.분류)) 분류별[r.분류]++;
  }

  const entries = Object.entries(분류별).filter(([, n]) => n > 0);
  entries.sort((a, b) => b[1] - a[1] || CATEGORIES.indexOf(a[0]) - CATEGORIES.indexOf(b[0]));

  return {
    총시도: 맞음 + 부분맞음 + 틀림,
    맞음, 부분맞음, 틀림,
    분류별,
    최다분류: entries.length ? entries[0][0] : '',
    푼문항: [...푼문항].sort((a, b) => a - b),
  };
}

/** 문항별 최신 상태. 진행판 색칠에 쓴다. */
export function latestByQuestion(records = []) {
  const map = new Map();
  for (const r of records) {
    if (!r || r.결과 === '해설지에 없음') continue;
    const prev = map.get(r.no);
    if (!prev || (r.ts || 0) >= (prev.ts || 0)) map.set(r.no, r);
  }
  return map;
}

/** 같은 문항의 시도 이력 (오래된 것부터). `다시` 명령이 쓴다. */
export function attemptsFor(records = [], no) {
  return records
    .filter((r) => r && r.no === no)
    .sort((a, b) => (a.ts || 0) - (b.ts || 0));
}
