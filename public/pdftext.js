// PDF 페이지 → 단(column)·줄 단위 텍스트.
// 브라우저(pdf.js)와 Node 양쪽에서 같은 코드를 쓴다.
//
// 이 시험지들은 다단 조판이라 pdf.js가 주는 항목 순서를 그대로 믿으면
// 좌우 단이 한 줄로 섞인다. 그래서 좌표로 직접 재조립한다.

const BIN = 4;          // 가로 커버리지 히스토그램 해상도 (pt)
const LINE = 3;         // 같은 줄로 묶는 y 허용오차 (pt)
const GUTTER_MAX = 0.03; // 이 비율 이하의 줄만 지나가면 단 사이 빈틈으로 본다

// 글자 사이 간격을 글자 높이로 나눈 값의 기준.
// 두 PDF의 실측 분포는 이중봉이다: 붙어야 할 글자쌍은 0.05 이하,
// 띄어야 할 글자쌍은 0.10 이상. 0.08이 그 골짜기다.
const SPACE_RATIO = 0.08;
// 표 칸 구분·선지 구분·빈칸 밑줄처럼 비정상적으로 벌어진 자리.
const WIDE_RATIO = 2.0;
/** 비정상적으로 벌어진 자리 표식. 문항 유형을 안 뒤에 빈칸/공백 중 하나로 확정한다. */
export const WIDE = '\uE000';

const isHangul = (c) => c >= '가' && c <= '힣';

/** pdf.js 항목 배열을 정규화한다. 공백만 있는 항목은 버린다(간격으로 재계산하므로). */
export function normalizeItems(textContentItems) {
  return textContentItems
    .filter((i) => i.str && i.str.trim())
    .map((i) => ({
      s: i.str,
      x: i.transform[4],
      y: i.transform[5],
      w: i.width || 0,
      h: Math.abs(i.transform[3]) || 10,
    }));
}

/** y좌표로만 묶은 대략적인 줄. 빈틈 탐지에 쓴다. */
function roughLines(items) {
  const byY = new Map();
  for (const it of items) {
    const k = Math.round(it.y / LINE);
    if (!byY.has(k)) byY.set(k, []);
    byY.get(k).push(it);
  }
  return [...byY.values()];
}

/**
 * 문서 전체에서 단 사이의 빈틈(gutter)을 찾는다.
 *
 * 단의 왼쪽 정렬점을 세는 방식은 안내문·도표의 들여쓰기를 단 경계로 착각한다.
 * 그래서 "이 세로 띠를 가로지르는 줄이 몇 개인가"를 센다. 진짜 단 사이는
 * 어떤 줄도 지나가지 않으므로 0에 가깝고, 단 안쪽은 어디든 30% 이상이 지나간다.
 *
 * @param {Array<Array>} pageItems 페이지별 정규화된 항목 배열
 * @returns {number[]} 빈틈의 중앙 x 좌표들 (왼쪽부터)
 */
export function detectGutters(pageItems, pageWidth) {
  const bins = new Array(Math.ceil(pageWidth / BIN) + 1).fill(0);
  let total = 0;
  for (const items of pageItems) {
    for (const line of roughLines(items)) {
      total++;
      const covered = new Set();
      for (const it of line) {
        const from = Math.floor(it.x / BIN);
        const to = Math.floor((it.x + it.w) / BIN);
        for (let b = from; b <= to && b < bins.length; b++) covered.add(b);
      }
      for (const b of covered) bins[b]++;
    }
  }
  if (!total) return [];

  const empty = bins.map((n) => n / total <= GUTTER_MAX);
  // 양쪽에 본문이 있는 빈 구간만 단 사이로 인정한다(바깥 여백 제외)
  let first = empty.findIndex((e) => !e);
  let last = empty.length - 1;
  while (last >= 0 && empty[last]) last--;
  if (first < 0 || last <= first) return [];

  const gutters = [];
  let run = -1;
  for (let i = first; i <= last; i++) {
    if (empty[i]) { if (run < 0) run = i; continue; }
    if (run >= 0) gutters.push(((run + i) / 2) * BIN);
    run = -1;
  }
  return gutters;
}

/**
 * 한 줄 안의 항목들을 이어붙인다.
 * 공백은 PDF가 흘려준 " " 항목이 아니라 **글자 사이 간격**으로 판정한다.
 * 해설지는 양끝맞춤이라 한글 글자마다 위치가 따로 찍히는데, PDF의 공백 항목을
 * 믿으면 "생 겨 난 다" 처럼 가짜 공백이 박힌다.
 */
function joinLine(items) {
  items.sort((a, b) => a.x - b.x);
  let out = '';
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (i > 0) {
      const prev = items[i - 1];
      const gap = it.x - (prev.x + prev.w);
      if (gap > it.h * WIDE_RATIO) out += WIDE;
      else if (gap > it.h * SPACE_RATIO) out += ' ';
    }
    out += it.s;
  }
  return out.replace(/[ \t]+/g, ' ').trim();
}

/** 페이지 하나 → { col, y, text } 줄 배열 (단 순서 → 위에서 아래) */
export function pageToLines(items, gutters) {
  const colOf = (x) => {
    let c = 0;
    for (const g of gutters) if (x >= g) c++;
    return c;
  };

  const groups = new Map();
  for (const it of items) {
    const key = `${colOf(it.x)}|${Math.round(it.y / LINE)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }

  const lines = [];
  for (const [key, its] of groups) {
    const [col, yb] = key.split('|').map(Number);
    const text = joinLine(its);
    if (text) lines.push({ col, y: yb * LINE, text });
  }
  lines.sort((a, b) => a.col - b.col || b.y - a.y);
  return lines;
}

const HEADER_FOOTER = [
  /^\d{1,2}$/,                        // 쪽번호
  /^\d+\s+\d+$/,                      // 쪽번호 쌍
  /^고\s*\d+$/,
  /^영어$/,
  /^영역$/,
  /^영어\s*영역$/,
  /^(고\s*\d+\s*)?영어\s*영역(\s*고\s*\d+)?(\s*\d+)?$/,
  /^\d+\s*(고\s*\d+\s*)?영어\s*영역/,
  /EBSi/,
  /무단\s*전재/,
  /^\d{4}학년도/,
  /전국연합학력평가$/,
  /^※\s*본\s*전국연합/,
  /^고\s*\d+\s*영어$/,
  /^정답\s*및\s*해설$/,
];

// 다단 조판 탓에 머리글이 "영역 고 1", "고 1 영어", "1 영어 영역" 등
// 온갖 순서로 쪼개져 나온다. 정해진 낱말과 숫자만으로 이뤄진 줄이면 머리글이다.
const CHROME_TOKENS = new Set(['고', '영어', '영역', '정답', '및', '해설']);

function isChromeByTokens(t) {
  const tokens = t.split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens.length > 5) return false;
  if (!tokens.some((w) => CHROME_TOKENS.has(w))) return false;
  return tokens.every((w) => CHROME_TOKENS.has(w) || /^\d{1,2}$/.test(w));
}

/**
 * 머리글·꼬리글로 보이는 줄을 버린다.
 * 넓은 간격 표식(WIDE)은 머리글 안에서 단순 공백이므로 비교 전에 없앤다 —
 * 안 그러면 "고 1◻영어" 같은 줄이 본문으로 남아 문항 블록 끝에 들러붙는다.
 */
export function stripChrome(lines) {
  return lines.filter((l) => {
    const t = l.text.replaceAll(WIDE, ' ').replace(/\s+/g, ' ').trim();
    if (!t) return false;
    if (isChromeByTokens(t)) return false;
    return !HEADER_FOOTER.some((re) => re.test(t));
  });
}

/**
 * 줄들을 문단 텍스트로 잇는다.
 * 한글끼리 끊긴 줄은 공백 없이(한글은 줄바꿈으로 단어가 쪼개진다),
 * 그 외에는 공백을 넣어 잇는다.
 */
export function joinLines(lines) {
  let out = '';
  for (const l of lines) {
    const t = typeof l === 'string' ? l : l.text;
    if (!t) continue;
    if (!out) { out = t; continue; }
    const a = out[out.length - 1];
    const b = t[0];
    if (a === '­') out = out.slice(0, -1) + t;      // soft hyphen
    else if (isHangul(a) && isHangul(b)) out += t;        // 한글 줄바꿈 = 붙여쓰기
    else out += ' ' + t;
  }
  return out.replace(/[ \t]+/g, ' ').trim();
}

/** PDF 문서 하나를 페이지별 줄 배열로. pdfjs는 호출자가 주입한다(브라우저/Node 공용). */
export async function documentToPages(doc) {
  const raw = [];
  let width = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    width = Math.max(width, page.getViewport({ scale: 1 }).width);
    raw.push(normalizeItems((await page.getTextContent()).items));
  }
  const gutters = detectGutters(raw, width);
  return raw.map((items, i) => ({
    page: i + 1,
    lines: stripChrome(pageToLines(items, gutters)),
  }));
}
