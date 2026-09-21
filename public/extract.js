// 문제지·해설지 줄 배열 → 문항 은행(bank).
//
// pdf.js에 의존하지 않는 순수 함수라 Node에서 그대로 테스트할 수 있다.
// 입력은 pdftext.js가 만든 { page, lines:[{col,y,text}] } 배열.

import { WIDE } from './pdftext.js';

export const FIRST = 18;
export const LAST = 40;

const CIRCLED = '①②③④⑤';
const reSharedInstruction = /^\[(\d{1,2})\s*[~∼-]\s*(\d{1,2})\]\s*(.*)$/;
const reFootnote = /^\s*\*/;
const reChoiceLine = new RegExp(`[${CIRCLED}]`);

/** 페이지 배열을 하나의 줄 목록으로 편다 (페이지 → 단 → 위에서 아래). */
export function flatten(pages) {
  const out = [];
  for (const p of pages) for (const l of p.lines) out.push({ ...l, page: p.page });
  return out;
}

/**
 * 문항 번호로 블록을 자른다.
 * `2026.` 같은 우연한 일치를 막기 위해 **다음에 와야 할 번호만** 인정한다.
 */
function splitByNumber(lines, from, to) {
  const blocks = new Map();
  let expect = from;
  let current = null;
  const preamble = [];

  for (const line of lines) {
    const m = expect <= to ? line.text.match(new RegExp(`^${expect}\\.(?:\\s+(.*))?$`)) : null;
    if (m) {
      current = { no: expect, page: line.page, lines: [] };
      if (m[1]) current.lines.push({ ...line, text: m[1] });
      blocks.set(expect, current);
      expect++;
      continue;
    }
    // 다음 묶음의 안내문([41~45] …)이 나오면 현재 블록은 거기서 끝난다.
    const grouped = line.text.match(reSharedInstruction);
    if (grouped && current && Number(grouped[1]) > current.no) current = null;

    if (current) current.lines.push(line);
    else preamble.push(line);
  }
  return { blocks, preamble };
}

/** `[31~34] 다음 빈칸에…` 형태의 묶음 발문을 문항 번호별로 펼친다. */
export function collectSharedInstructions(lines) {
  const shared = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].text.match(reSharedInstruction);
    if (!m) continue;
    const [, a, b, rest] = m;
    let text = rest.trim();
    // 발문이 다음 줄로 넘어가는 경우가 있다 (물음표로 끝나야 완성)
    for (let j = i + 1; j < lines.length && !/[?.]$/.test(text) && j <= i + 2; j++) {
      const next = lines[j].text;
      if (/^\d{1,2}\./.test(next)) break;
      text += ' ' + next.trim();
    }
    for (let n = Number(a); n <= Number(b); n++) shared.set(n, text.replace(/\s+/g, ' ').trim());
  }
  return shared;
}

/** 한 문항 블록을 발문/지문/선지/각주로 가른다. */
function parseExamBlock(block, sharedInstruction) {
  const lines = block.lines.map((l) => l.text);

  // 1) 발문: 블록 맨 앞의 한국어 물음(물음표로 끝난다). 없으면 묶음 발문을 쓴다.
  //    "Marie Curie에 관한 다음 글의…" 처럼 영문 고유명사로 시작하는 발문도 있어
  //    첫 글자가 아니라 **한글 비중**으로 판정한다.
  let i = 0;
  let 발문 = '';
  if (lines.length && isKoreanPrompt(lines[0])) {
    const buf = [];
    while (i < lines.length && i < 4) {
      buf.push(lines[i]); i++;
      if (/\?/.test(buf[buf.length - 1])) break;
    }
    발문 = buf.join(' ').replace(/\s+/g, ' ').trim();
    if (!/\?/.test(발문)) { 발문 = ''; i = 0; }   // 물음표가 없으면 발문이 아니다
  }
  if (!발문) 발문 = sharedInstruction || '';

  // 2) 뒤에서부터 선지·각주를 떼어낸다.
  //    선지 줄은 동그라미 숫자로 시작한다. 선지가 이어지며 줄바꿈된 경우도 있어
  //    ①이 나올 때까지 계속 거슬러 올라간다.
  const body = lines.slice(i);
  const 선지 = [];
  const 각주 = [];
  let end = body.length;
  let sawFirst = false;
  while (end > 0) {
    const t = body[end - 1];
    if (reFootnote.test(t)) { 각주.unshift(t.trim()); end--; continue; }
    if (sawFirst) break;
    if (/^\s*[①②③④⑤]/.test(t)) {
      if (/^\s*①/.test(t)) sawFirst = true;
      선지.unshift(t); end--; continue;
    }
    // 선지 첫 줄을 이미 찾기 시작했다면 줄바꿈된 선지 꼬리일 수 있다
    if (선지.length && !/[.?!]$/.test(t) && t.length < 60) { 선지.unshift(t); end--; continue; }
    break;
  }

  return {
    발문,
    지문Lines: body.slice(0, end),
    선지: splitChoices(선지),
    각주: 각주.map((t) => t.replaceAll(WIDE, ' ').replace(/\s+/g, ' ').trim()),
  };
}

/** 한국어 발문인가? 영문 고유명사로 시작할 수 있으므로 한글 비중으로 판정한다. */
function isKoreanPrompt(line) {
  const t = line.replaceAll(WIDE, ' ');
  const hangul = (t.match(/[가-힣]/g) || []).length;
  return hangul >= 6 && hangul / t.replace(/\s/g, '').length >= 0.35;
}

/** `① social◻② fixed` 같은 줄을 선지 5개로 가른다. */
export function splitChoices(lines) {
  const joined = lines.join(' ').replaceAll(WIDE, ' ').replace(/\s+/g, ' ').trim();
  if (!joined) return [];
  const out = [];
  const re = /([①②③④⑤])\s*([^①②③④⑤]*)/g;
  let m;
  while ((m = re.exec(joined))) out.push(`${m[1]} ${m[2].trim()}`.trim());
  return out;
}

/** 지문 줄들을 하나의 문단으로 잇는다. 한글 줄바꿈은 붙이고 나머지는 띄운다. */
function joinBody(lines, markBlanks) {
  const isHangul = (c) => c >= '가' && c <= '힣';
  let out = '';
  for (const t of lines) {
    if (!t) continue;
    if (!out) { out = t; continue; }
    const a = out[out.length - 1];
    const b = t[0];
    if (isHangul(a) && isHangul(b)) out += t;
    else out += ' ' + t;
  }
  out = markBlanks ? out.replaceAll(WIDE, ' ______ ') : out.replaceAll(WIDE, ' ');
  return out.replace(/\s+/g, ' ').replace(/\s+([.,;:?!])/g, '$1').trim();
}

/** 해설지 정답표 → { 문항번호: '①' } */
export function parseAnswerKey(lines) {
  const key = {};
  for (const l of lines) {
    const re = /(\d{1,2})\s*([①②③④⑤])/g;
    let m;
    while ((m = re.exec(l.text))) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 45) key[n] = m[2];
    }
  }
  return key;
}

/** 해설지 → { 문항번호: { 유형, 모범해석, 어휘[] } } */
export function parseSolutions(lines) {
  const out = {};
  let cur = null;
  let section = null;
  const push = (t) => {
    if (!cur || !section) return;
    cur[section].push(t);
  };

  for (const l of lines) {
    // 한 지문에 여러 문항이 걸린 경우 해설지는 `41~42. [출제의도] …` 처럼 묶어 쓴다.
    // 이걸 못 잡으면 앞 문항의 [해석]이 뒤 지문까지 통째로 삼킨다.
    const head = l.text.match(/^(\d{1,2})(?:\s*[~∼-]\s*(\d{1,2}))?\.\s*\[출제의도\]\s*(.*)$/);
    if (head) {
      const from = Number(head[1]);
      const to = head[2] ? Number(head[2]) : from;
      cur = { no: from, to, 유형: head[3].trim(), 해석: [], 어휘: [] };
      for (let n = from; n <= to; n++) out[n] = cur;
      section = null;
      continue;
    }
    if (!cur) continue;
    let t = l.text;
    if (t.includes('[해석]')) { section = '해석'; t = t.slice(t.indexOf('[해석]') + 4); }
    else if (t.includes('[어휘 및 어구]')) { section = '어휘'; t = t.slice(t.indexOf('[어휘 및 어구]') + 9); }
    else if (/^\[[^\]]+\]/.test(t)) { section = null; continue; }   // [해설] 등 다른 절
    if (t.trim()) push(t.trim());
  }

  const result = {};
  for (const [no, v] of Object.entries(out)) {
    result[no] = {
      유형: v.유형,
      모범해석: joinBody(v.해석, false),
      어휘: splitVocab(v.어휘),
    };
  }
  return result;
}

/** `[어휘 및 어구]` 묶음을 항목별로 가른다. */
export function splitVocab(lines) {
  const joined = joinBody(lines, false);
  if (!joined) return [];
  // 영어 표제어가 새로 시작하는 지점에서 끊는다
  return joined
    .split(/\s{2,}|·/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 어느 쪽이 문제지고 어느 쪽이 해설지인지 내용으로 가린다.
 * 파일명이나 고르는 순서에 기대지 않는다.
 * @returns {{exam: Array, solution: Array}}
 */
export function identifyPdfs(a, b) {
  const score = (pages) => {
    let n = 0;
    for (const p of pages) for (const l of p.lines) {
      if (l.text.includes('[출제의도]')) n += 3;
      if (l.text.includes('[해석]')) n += 2;
      if (/^정답$/.test(l.text.trim())) n += 2;
    }
    return n;
  };
  const sa = score(a);
  const sb = score(b);
  if (sa === sb) throw new Error('문제지와 해설지를 구분할 수 없다. 두 파일이 같은 것은 아닌지 확인해라.');
  return sa > sb ? { exam: b, solution: a } : { exam: a, solution: b };
}

/**
 * 문제지·해설지 페이지 배열 → 문항 은행.
 * @returns {{bank: Object, warnings: string[]}}
 */
export function buildBank(examPages, solutionPages, { from = FIRST, to = LAST } = {}) {
  const examLines = flatten(examPages);
  const solLines = flatten(solutionPages);

  const shared = collectSharedInstructions(examLines);
  const { blocks } = splitByNumber(examLines, from, Math.min(to + 5, 45));
  const answers = parseAnswerKey(solLines);
  const solutions = parseSolutions(solLines);

  const bank = {};
  const warnings = [];

  for (let n = from; n <= to; n++) {
    const block = blocks.get(n);
    if (!block) { warnings.push(`${n}번: 문제지에서 찾지 못함`); continue; }

    const sol = solutions[n] || {};
    const 유형 = sol.유형 || '';
    const markBlanks = /빈칸/.test(유형);
    const parsed = parseExamBlock(block, shared.get(n));
    const 지문 = joinBody(parsed.지문Lines, markBlanks);

    bank[n] = {
      no: n,
      page: block.page,
      유형,
      발문: parsed.발문,
      지문,
      선지: parsed.선지,
      각주: parsed.각주,
      정답: answers[n] || '',
      모범해석: sol.모범해석 || '',
      어휘: sol.어휘 || [],
    };

    // 도표·어법·어휘·무관·순서·위치 문항은 ①~⑤가 지문 안에 박혀 있어
    // 따로 떼어낼 선지가 없다. 그건 정상이다.
    bank[n].선지내장 = CIRCLED.split('').every((c) => 지문.includes(c));

    if (!지문 || 지문.length < 80) warnings.push(`${n}번: 지문이 너무 짧다 (${지문.length}자)`);
    if (!bank[n].선지내장 && parsed.선지.length !== 5) {
      warnings.push(`${n}번: 선지가 ${parsed.선지.length}개`);
    }
    if (!bank[n].정답) warnings.push(`${n}번: 정답을 못 찾음`);
    if (!bank[n].모범해석) warnings.push(`${n}번: 해설지 [해석]을 못 찾음`);
    if (!유형) warnings.push(`${n}번: 해설지 [출제의도]를 못 찾음`);
  }

  return { bank, warnings };
}
