// 단어장 — 클래스카드식.
//   카드   : 한 장씩. 눌러서 뒤집고 알아요/몰라요. 몰라요는 몇 장 뒤에 다시 나온다.
//   테스트 : 단어 보고 뜻 4지선다. 틀린 건 다시 나온다.
//   목록   : 전체를 한눈에.
// 외운 단어는 저장소(progress/vocab)에 남아서 폰과 PC가 같이 본다.

import { VOCAB } from './vocab.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const KEY = 'vocab-known';
const BACK_AFTER = 3;   // 몰라요/틀림 카드는 이만큼 뒤에 다시 끼운다

let db = null;
let getBank = () => null;
let known = new Set();

let range = 'all';      // 'all' | 'unknown' | '18' … '38'
let mode = 'card';      // 'card' | 'test' | 'list'
let deck = [];
let total = 0;
let flipped = false;
let test = null;        // { item, choices, picked }
let score = { right: 0, wrong: 0 };
let started = false;
const opened = new Set();   // 목록에서 뜻을 펼친 단어

// ── 저장 ─────────────────────────────────────────────
function readLocal() {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return new Set(); }
}
function writeLocal() {
  try { localStorage.setItem(KEY, JSON.stringify([...known])); } catch { /* 무시 */ }
}
async function readDb() {
  if (!db) return null;
  try {
    const snap = await db.doc('progress/vocab').get();
    if (!snap.exists) return new Set();
    const data = snap.data() || {};
    return new Set(Object.keys(data).filter((w) => data[w] === true));
  } catch {
    return null;
  }
}
async function save(word, value) {
  writeLocal();
  if (!db) return;
  try {
    // 한 단어씩 merge — 두 기기에서 동시에 해도 서로 덮어쓰지 않는다
    await db.doc('progress/vocab').update({ [word]: value });
  } catch {
    try { await db.doc('progress/vocab').set({ [word]: value }); } catch { /* 이 기기에는 남아 있다 */ }
  }
}
function setKnown(word, value) {
  if (value === known.has(word)) return;
  if (value) known.add(word); else known.delete(word);
  save(word, value);
}

// ── 판 구성 ──────────────────────────────────────────
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pool() {
  if (range === 'all') return VOCAB.slice();
  if (range === 'unknown') return VOCAB.filter((v) => !known.has(v.w));
  const n = Number(range);
  return VOCAB.filter((v) => v.no === n);
}

function startRound() {
  deck = shuffle(pool());
  total = deck.length;
  flipped = false;
  test = null;
  score = { right: 0, wrong: 0 };
  started = true;
  render();
}

/** 맨 앞 카드를 몇 장 뒤로 보낸다 (몰라요·틀림). */
function sendBack() {
  const card = deck.shift();
  deck.splice(Math.min(BACK_AFTER, deck.length), 0, card);
}

// ── 예문 ─────────────────────────────────────────────
/** 그 문항 지문에서 이 단어가 든 문장을 찾아 단어에 형광펜을 칠한다. */
function exampleFor(v) {
  const text = getBank()?.[v.no]?.지문;
  if (!text) return '';
  const w = v.w.toLowerCase().replace(/[^a-z]/g, '');
  const stems = [...new Set([w, w.replace(/e$/, ''), w.replace(/y$/, 'i'), w.slice(0, Math.max(4, w.length - 2))])];

  for (const stem of stems) {
    const re = new RegExp(`\\b${stem}[a-z]*`, 'i');
    const m = re.exec(text);
    if (!m) continue;

    let s = m.index;
    let e = m.index + m[0].length;
    while (s > 0 && !/[.!?]/.test(text[s - 1])) s--;
    while (e < text.length && !/[.!?]/.test(text[e])) e++;
    const sentence = text.slice(s, Math.min(e + 1, text.length)).trim();

    const hit = re.exec(sentence);
    if (!hit) return esc(sentence);
    return esc(sentence.slice(0, hit.index))
      + `<mark>${esc(hit[0])}</mark>`
      + esc(sentence.slice(hit.index + hit[0].length));
  }
  return '';
}

/** 테스트 보기용 짧은 뜻. 괄호 속 영어 설명이 정답을 흘리지 않게 뺀다. */
function shortMeaning(m) {
  return m.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── 그리기 ───────────────────────────────────────────
function renderTools() {
  const unknownCount = VOCAB.filter((v) => !known.has(v.w)).length;
  const nos = [...new Set(VOCAB.map((v) => v.no))].sort((a, b) => a - b);
  const opts = [
    ['all', `전체 (${VOCAB.length})`],
    ['unknown', `안 외운 것 (${unknownCount})`],
    ...nos.map((n) => [String(n), `${n}번 (${VOCAB.filter((v) => v.no === n).length})`]),
  ];
  $('vocab-range').innerHTML = opts
    .map(([val, label]) => `<option value="${val}"${val === range ? ' selected' : ''}>${label}</option>`)
    .join('');

  for (const m of ['card', 'test', 'list']) {
    const tab = $(`vtab-${m}`);
    tab.classList.toggle('on', mode === m);
    tab.setAttribute('aria-selected', String(mode === m));
  }
}

function meter() {
  const pct = total ? Math.round(((total - deck.length) / total) * 100) : 0;
  const done = VOCAB.filter((v) => known.has(v.w)).length;
  return `<div class="vmeter" aria-hidden="true"><div style="inline-size:${pct}%"></div></div>
    <p class="small muted vcount"><span>이번 판 ${total - deck.length} / ${total}</span>
      <span>전체 외움 ${done} / ${VOCAB.length}</span></p>`;
}

function doneView() {
  if (!total) {
    return `<div class="card vdone"><p>여기엔 외울 단어가 없다.</p>
      <button data-act="all">전체로 하기</button></div>`;
  }
  const left = VOCAB.filter((v) => !known.has(v.w)).length;
  const scoreLine = mode === 'test'
    ? `<p class="big">${score.right} / ${score.right + score.wrong}</p><p class="muted">처음 본 판에서 맞힌 수</p>`
    : `<p class="big">${total}장</p><p class="muted">이번 판 끝</p>`;
  return `<div class="card vdone">${scoreLine}
    <div class="row" style="justify-content:center;margin-block-start:14px">
      <button data-act="restart">다시 섞기</button>
      ${left && range !== 'unknown' ? `<button class="primary" data-act="unknown">안 외운 것만 (${left})</button>` : ''}
    </div></div>`;
}

function renderCard() {
  if (!deck.length) return doneView();
  const v = deck[0];
  const sentence = flipped ? exampleFor(v) : '';
  return `${meter()}
    <div class="fcard${flipped ? ' flipped' : ''}" data-act="flip" role="button" tabindex="0"
      aria-label="${flipped ? '앞면으로' : '뒤집어서 뜻 보기'}">
      <span class="fnum">${v.no}번</span>
      <div class="fin">
        <span class="fword">${esc(v.w)}</span>
        ${flipped
          ? `<span class="fmean">${esc(v.m)}</span>${sentence ? `<span class="fsent">${sentence}</span>` : ''}`
          : '<span class="fhint">눌러서 뜻 보기</span>'}
      </div>
    </div>
    <div class="fbtns">
      <button class="fbtn-no" data-act="dunno">몰라요</button>
      <button class="fbtn-yes" data-act="know">알아요</button>
    </div>
    <p class="small muted kbd-hint">키보드: 스페이스 뒤집기 · ← 몰라요 · → 알아요</p>`;
}

function newTest() {
  const item = deck[0];
  const answer = shortMeaning(item.m);
  const others = shuffle(VOCAB.filter((v) => shortMeaning(v.m) !== answer)).slice(0, 3);
  test = { item, choices: shuffle([item, ...others]), picked: null };
}

function renderTest() {
  if (!deck.length) return doneView();
  if (!test || test.item !== deck[0]) newTest();
  const { item, choices, picked } = test;
  const answered = picked !== null;
  return `${meter()}
    <div class="fcard small">
      <span class="fnum">${item.no}번</span>
      <div class="fin">
        <span class="fword">${esc(item.w)}</span>
        ${answered ? `<span class="fsent">${exampleFor(item)}</span>` : ''}
      </div>
    </div>
    <div class="tchoices">
      ${choices.map((c, i) => {
        let cls = 'tchoice';
        if (answered && c === item) cls += ' right';
        else if (answered && i === picked) cls += ' wrong';
        return `<button class="${cls}" data-act="pick" data-i="${i}"${answered ? ' disabled' : ''}>
          <span class="tnum">${i + 1}</span>${esc(shortMeaning(c.m))}</button>`;
      }).join('')}
    </div>
    ${answered ? '<button class="primary tnext" data-act="next">다음</button>' : ''}`;
}

function renderList() {
  let html = '';
  const groups = new Map();
  for (const v of pool()) {
    if (!groups.has(v.no)) groups.set(v.no, []);
    groups.get(v.no).push(v);
  }
  if (!groups.size) return '<div class="card"><p class="muted">여기엔 단어가 없다.</p></div>';
  for (const [no, items] of groups) {
    html += `<div class="card vgroup"><div class="eyebrow">${no}번</div><ul class="vlist">`;
    for (const v of items) {
      const isKnown = known.has(v.w);
      const isOpen = opened.has(v.w);
      html += `<li class="${isKnown ? 'known' : ''}">
        <button class="vword" data-act="peek" data-w="${esc(v.w)}" aria-expanded="${isOpen}">
          <span class="en">${esc(v.w)}</span>
          <span class="ko">${isOpen ? esc(v.m) : '뜻 보기'}</span>
        </button>
        <button class="vcheck" data-act="toggle" data-w="${esc(v.w)}" aria-pressed="${isKnown}"
          aria-label="${esc(v.w)} ${isKnown ? '외움 취소' : '외움'}">${isKnown ? '✓' : '○'}</button>
      </li>`;
    }
    html += '</ul></div>';
  }
  return html;
}

function render() {
  renderTools();
  const stage = $('vocab-stage');
  stage.className = mode;   // 목록만 칸 안에서 스크롤한다
  if (mode === 'card') stage.innerHTML = renderCard();
  else if (mode === 'test') stage.innerHTML = renderTest();
  else stage.innerHTML = renderList();
}

// ── 동작 ─────────────────────────────────────────────
function act(name, el) {
  switch (name) {
    case 'flip':
      flipped = !flipped;
      break;
    case 'know':
      if (!deck.length) return;
      setKnown(deck[0].w, true);
      deck.shift();
      flipped = false;
      break;
    case 'dunno':
      if (!deck.length) return;
      setKnown(deck[0].w, false);
      sendBack();
      flipped = false;
      break;
    case 'pick': {
      if (!test || test.picked !== null) return;
      const i = Number(el.dataset.i);
      test.picked = i;
      const right = test.choices[i] === test.item;
      // 같은 카드를 다시 맞힌 건 점수에 안 넣는다 — 처음 본 판의 실력만 센다
      if (!test.item._seen) { if (right) score.right++; else score.wrong++; }
      test.item._seen = true;
      setKnown(test.item.w, right);
      break;
    }
    case 'next': {
      if (!test) return;
      const right = test.choices[test.picked] === test.item;
      if (right) deck.shift(); else sendBack();
      test = null;
      break;
    }
    case 'restart':
      clearSeen();
      startRound();
      return;
    case 'unknown':
      range = 'unknown';
      clearSeen();
      startRound();
      return;
    case 'all':
      range = 'all';
      startRound();
      return;
    case 'peek': {
      const w = el.dataset.w;
      if (opened.has(w)) opened.delete(w); else opened.add(w);
      break;
    }
    case 'toggle':
      setKnown(el.dataset.w, !known.has(el.dataset.w));
      break;
    default:
      return;
  }
  render();
}

function clearSeen() {
  for (const v of VOCAB) delete v._seen;
}

function visible() {
  return !$('vocab-view').hidden;
}

/** 단어장 화면을 연결한다. app.js가 저장소를 연 뒤 한 번 부른다. */
export async function initVocab(database, bankGetter) {
  db = database;
  if (bankGetter) getBank = bankGetter;
  known = readLocal();

  $('vocab-stage').addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (el) act(el.dataset.act, el);
  });

  $('vocab-range').addEventListener('change', (e) => {
    range = e.target.value;
    clearSeen();
    startRound();
  });

  for (const m of ['card', 'test', 'list']) {
    $(`vtab-${m}`).addEventListener('click', () => {
      if (mode === m) return;
      mode = m;
      clearSeen();
      startRound();
    });
  }

  $('btn-vocab').addEventListener('click', () => {
    for (const id of ['main', 'stats-view', 'setup']) { const el = $(id); if (el) el.hidden = true; }
    $('vocab-view').hidden = false;
    if (!started) startRound(); else render();
    window.scrollTo(0, 0);
  });

  $('btn-vocab-back').addEventListener('click', () => {
    $('vocab-view').hidden = true;
    if (getBank()) $('main').hidden = false; else $('setup').hidden = false;
  });

  // PC에서 빠르게: 스페이스 뒤집기, ←/→ 몰라요/알아요, 1~4 보기 선택, 엔터 다음
  document.addEventListener('keydown', (e) => {
    if (!visible() || e.target.closest('select, textarea, input')) return;
    if (mode === 'card') {
      if (e.key === ' ' || (e.key === 'Enter' && e.target.closest('.fcard'))) { e.preventDefault(); act('flip'); }
      else if (e.key === 'ArrowLeft') act('dunno');
      else if (e.key === 'ArrowRight') act('know');
    } else if (mode === 'test') {
      if (/^[1-4]$/.test(e.key) && test && test.picked === null) {
        act('pick', { dataset: { i: String(Number(e.key) - 1) } });
      } else if (e.key === 'Enter' && test && test.picked !== null) {
        e.preventDefault();
        act('next');
      }
    }
  });

  // 다른 기기에서 외운 것까지 합친다
  const remote = await readDb();
  if (remote) {
    for (const w of remote) known.add(w);
    writeLocal();
    if (visible()) render();
  }
}
