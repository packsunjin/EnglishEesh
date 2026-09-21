// 채점 결과(사양이 정한 5줄 포맷)를 구조로 깬다.
//
// 통계를 모델에게 세게 하지 않는 것이 목적이다. 모델이 대화 기억으로 세면
// 세션이 끊길 때 사라지고, 수도 틀린다.

import { CATEGORIES } from './compose.js';

const RESULTS = ['맞음', '부분맞음', '틀림'];

const FIELD = /^\s*\[(결과|오류|분류|결정문장|다음)\]\s*(.*)$/;

/**
 * @returns {{ok: boolean, 결과, 오류, 분류, 결정문장, 올바른해석, 다음, raw}}
 *          ok가 false면 포맷이 안 맞는 것이다. 원문(raw)을 그대로 보여주고
 *          통계에는 넣지 않는다.
 */
export function parseVerdict(text) {
  const raw = (text || '').trim();
  const out = {
    ok: false, 결과: '', 오류: '', 분류: '',
    결정문장: '', 올바른해석: '', 다음: '', raw,
  };
  if (!raw) return out;

  // 해설지에 없는 문항은 한 줄로 끝난다.
  if (/^해설지에\s*없음\.?$/.test(raw)) {
    return { ...out, ok: true, 결과: '해설지에 없음' };
  }

  let field = null;
  for (const line of raw.split('\n')) {
    const m = line.match(FIELD);
    if (m) {
      field = m[1];
      const value = m[2].trim();
      if (field === '결과') out.결과 = RESULTS.find((r) => value.startsWith(r)) || value;
      else if (field === '분류') out.분류 = CATEGORIES.find((c) => value.includes(c)) || value;
      else out[field] = value;
      continue;
    }
    // [결정문장] 아래 들여쓴 `→ 올바른 해석` 줄
    const arrow = line.match(/^\s*(?:→|->)\s*(.+)$/);
    if (arrow && field === '결정문장') { out.올바른해석 = arrow[1].trim(); continue; }
    // 필드 값이 다음 줄로 이어진 경우
    if (field && line.trim()) out[field] = `${out[field]} ${line.trim()}`.trim();
  }

  out.ok = Boolean(out.결과 && out.분류);
  return out;
}

/** 공백·따옴표·대소문자 차이를 무시하고 비교하기 위한 정규화. */
function normalize(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9']+/g, ' ')
    .trim();
}

/**
 * `[결정문장]`이 정말 그 문항 지문에 있는 문장인지 대조한다.
 * 모델이 지문을 지어냈는지 코드가 잡아내는 마지막 그물.
 *
 * 글자 그대로 비교하면 안 된다. 빈칸 문항에서 모델은 빈칸을 **채워서** 인용하고
 * (지문 "Cats are ______ and watch the door." → 인용 "Cats are alert and watch the door."),
 * 말줄임이나 문장부호 차이도 흔하다.
 * 그래서 이웃한 낱말 쌍(bigram)이 지문에 얼마나 남아 있는지로 본다.
 * 지어낸 문장은 낱말 쌍이 거의 안 걸린다.
 *
 * @returns {'확인'|'없음'|'해당없음'}
 */
export function verifyQuote(quote, 지문, { threshold = 0.5, minTokens = 5 } = {}) {
  const q = normalize(quote).split(' ').filter(Boolean);
  const p = normalize(지문);
  // 짧은 인용은 빈칸 하나만 껴도 낱말 쌍의 절반이 날아가 판정이 무의미해진다.
  if (!p || q.length < minTokens) return '해당없음';
  if (p.includes(q.join(' '))) return '확인';

  let hit = 0;
  for (let i = 0; i < q.length - 1; i++) {
    if (p.includes(`${q[i]} ${q[i + 1]}`)) hit++;
  }
  return hit / (q.length - 1) >= threshold ? '확인' : '없음';
}

/** 사양의 "한 문항당 10줄 이내"를 지켰는지. */
export function lineCount(text) {
  return (text || '').trim().split('\n').filter((l) => l.trim()).length;
}
