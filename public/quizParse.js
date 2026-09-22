// 학습지 텍스트 → 단어/뜻 항목 목록.
//
// 형식을 하나로 강제하지 않는다. 탭 구분, "단어 뜻", "단어 - 뜻", "단어: 뜻",
// "단어, 뜻" 등 흔한 붙여넣기 형태를 순서대로 시도한다. 아무 것도 안 맞으면
// 그 줄은 건너뛰고 warnings에 남긴다 — 지문 전체를 잘못 잘라 엉터리 항목을
// 만드는 것보다 낫다.

const NUMBERING = /^\s*(?:\d{1,3}[.)]|[①-⑳]|[-*•‣▪])\s+/;
const TRIM_TAIL = /[\s\-–—:*]+$/;
const TRIM_HEAD = /^[\s\-–—:*]+/;

function mk(term, meaning) {
  term = String(term).trim().replace(TRIM_TAIL, '').trim();
  meaning = String(meaning).trim().replace(TRIM_HEAD, '').trim();
  if (!term || !meaning) return null;
  // 통째로 문장이 잘못 끼어든 경우를 걸러낸다 — 단어장 항목치고 너무 길면 의심한다.
  if (term.length > 60 || meaning.length > 200) return null;
  return { term, meaning };
}

function splitPair(line) {
  if (line.includes('\t')) {
    const i = line.indexOf('\t');
    const a = line.slice(0, i);
    const b = line.slice(i + 1).replace(/\t+/g, ' ').trim();
    const pair = a.trim() && b ? mk(a, b) : null;
    if (pair) return pair;
  }

  let m = line.match(/^([A-Za-z][A-Za-z0-9'’.\- ]*?)\s+([가-힣].*)$/);
  if (m) return mk(m[1], m[2]);

  m = line.match(/^(.+?) {2,}(.+)$/);
  if (m) return mk(m[1], m[2]);

  m = line.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m) return mk(m[1], m[2]);

  m = line.match(/^(.+?)\s*[:：]\s*(.+)$/);
  if (m) return mk(m[1], m[2]);

  const ci = line.indexOf(',');
  if (ci > 0) {
    const a = line.slice(0, ci);
    const b = line.slice(ci + 1);
    if (/[A-Za-z]/.test(a) && a.trim().length <= 40) {
      const pair = mk(a, b);
      if (pair) return pair;
    }
  }

  return null;
}

/**
 * 학습지 원문 텍스트를 항목 목록으로 바꾼다.
 * @returns {{items: {term:string, meaning:string}[], skipped: string[]}}
 */
export function parseItems(raw) {
  const items = [];
  const skipped = [];
  for (const rawLine of String(raw ?? '').split(/\r?\n/)) {
    const line = rawLine.trim().replace(NUMBERING, '').trim();
    if (!line) continue;
    const pair = splitPair(line);
    if (pair) items.push(pair);
    else skipped.push(rawLine.trim());
  }
  return { items, skipped };
}
