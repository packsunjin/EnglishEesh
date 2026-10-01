// `통째로` 명령: 영어 지문과 해설지 모범해석을 문장 단위로 나란히 놓는다.
// API를 타지 않는다 — 해설지에 이미 정답 해석이 있기 때문이다.

/** 약어 뒤의 마침표에서 잘리지 않게 조심하며 영어를 문장으로 나눈다. */
export function splitEnglish(text) {
  if (!text) return [];
  const guarded = text
    .replace(/\b(Mr|Mrs|Ms|Dr|Prof|St|vs|etc|e\.g|i\.e|U\.S|a\.m|p\.m)\./gi, '$1\u0001')
    .replace(/\b([A-Z])\./g, '$1\u0001');
  return guarded
    .split(/(?<=[.!?])["'’”)\]]*\s+/)
    .map((s) => s.replaceAll('\u0001', '.').trim())
    .filter(Boolean);
}

/** 한국어를 문장으로 나눈다. */
export function splitKorean(text) {
  if (!text) return [];
  return text
    .split(/(?<=[.!?])["'’”)\]]*\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 영어 문장과 한국어 문장을 짝짓는다.
 *
 * 해설지 해석은 영어와 1:1이 아니다(실측 23문항 중 14문항이 문장 수가 다르다).
 * 번역문은 원문 길이에 대체로 비례하므로, **누적 길이 비율**로 맞춘다.
 * 1:1뿐 아니라 1:2·2:1 묶음도 허용해서 쪼개지거나 합쳐진 문장을 흡수한다.
 * (Gale-Church 문장 정렬의 축소판)
 */
function alignByLength(en, ko) {
  const le = en.map((s) => s.length);
  const lk = ko.map((s) => s.length);
  const totalE = le.reduce((a, b) => a + b, 0) || 1;
  const totalK = lk.reduce((a, b) => a + b, 0) || 1;
  const ratio = totalK / totalE;

  const sum = (arr, i, n) => arr.slice(i, i + n).reduce((a, b) => a + b, 0);
  // 묶음 하나를 붙였을 때의 벌점. 길이가 안 맞을수록, 여러 문장을 묶을수록 비싸다.
  const cost = (i, j, a, b) => {
    const e = sum(le, i, a);
    const k = sum(lk, j, b);
    const expected = e * ratio;
    const spread = Math.max(expected, 20);
    return Math.abs(k - expected) / spread + (a + b - 2) * 0.3;
  };

  // 해설지는 영어 한 문장을 한국어 세 문장으로 쪼개기도 한다(긴 관계절 문장).
  // 1:2까지만 허용하면 그 지점부터 짝이 한 칸씩 밀린다.
  const MOVES = [[1, 1], [1, 2], [2, 1], [1, 3], [3, 1], [2, 2], [1, 0], [0, 1]];
  const INF = Infinity;
  const dp = Array.from({ length: en.length + 1 }, () => new Array(ko.length + 1).fill(INF));
  const back = Array.from({ length: en.length + 1 }, () => new Array(ko.length + 1).fill(null));
  dp[0][0] = 0;

  for (let i = 0; i <= en.length; i++) {
    for (let j = 0; j <= ko.length; j++) {
      if (dp[i][j] === INF) continue;
      for (const [a, b] of MOVES) {
        if (i + a > en.length || j + b > ko.length) continue;
        if (a === 0 && b === 0) continue;
        // 한쪽만 소비하는 수는 정말 남을 때만 쓰도록 비싸게 매긴다
        const penalty = (a === 0 || b === 0) ? 1.6 : 0;
        const c = dp[i][j] + cost(i, j, a, b) + penalty;
        if (c < dp[i + a][j + b]) {
          dp[i + a][j + b] = c;
          back[i + a][j + b] = [i, j, a, b];
        }
      }
    }
  }

  if (!Number.isFinite(dp[en.length][ko.length])) return null;

  const pairs = [];
  let i = en.length, j = ko.length;
  while (i > 0 || j > 0) {
    const step = back[i][j];
    if (!step) return null;               // 정렬 실패 — 전문 대조로 넘긴다
    const [pi, pj, a, b] = step;
    pairs.unshift({
      en: en.slice(pi, pi + a).join(' '),
      ko: ko.slice(pj, pj + b).join(' '),
    });
    i = pi; j = pj;
  }

  // 짝이 어긋난 채로 보여주면 잘못된 대응을 외우게 된다.
  // 평균 벌점이 크면 짝짓기를 포기하고 전문 대조로 넘긴다.
  const avg = dp[en.length][ko.length] / pairs.length;
  if (avg > 0.8) return null;
  return pairs;
}

/**
 * 두 문장 목록을 짝짓는다.
 *
 * 삽입 문항(38~39번)은 맨 앞의 '주어진 문장'이 지문 흐름에 속하지 않는다.
 * 해설지 해석에서는 그 문장이 **끼워 넣어진 자리**에 가 있어서, 그냥 짝지으면
 * 처음부터 한 칸씩 밀린다. 그래서 따로 떼어 보여준다.
 *
 * @returns {{주어진문장?:string, mode:'짝', pairs:[{en,ko}]}
 *          |{주어진문장?:string, mode:'전문', en:string[], ko:string[]}}
 */
export function align(지문, 모범해석, 유형 = '') {
  let en = splitEnglish(지문);
  const ko = splitKorean(모범해석);
  if (!en.length || !ko.length) return { mode: '전문', en, ko };

  let 주어진문장;
  if (/위치/.test(유형) && en.length > 1 && !en[0].includes('①')) {
    주어진문장 = en[0];
    en = en.slice(1);
  }

  const base = 주어진문장 ? { 주어진문장 } : {};
  if (en.length === ko.length) {
    return { ...base, mode: '짝', pairs: en.map((e, idx) => ({ en: e, ko: ko[idx] })) };
  }
  const pairs = alignByLength(en, ko);
  return pairs ? { ...base, mode: '짝', pairs } : { ...base, mode: '전문', en, ko };
}
