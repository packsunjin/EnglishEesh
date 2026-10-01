// 해석 코치 — 아티팩트판.
//
// 설치도 서버도 API 키도 없다.
//   채점  : claude.use("sample") — 보는 사람의 Claude 계정으로 물어본다
//   기록  : claude.use("db")     — 폰·PC가 같은 기록을 본다 (없으면 localStorage)
//   자료  : 네가 올린 PDF를 이 브라우저에서 읽는다. 지문은 이 기기 밖으로 안 나간다
//           (채점할 때 그 문항 하나만 간다). 그래서 지어낼 여지도 없다.

import { RULES, TIPS } from './rules.js';
import { documentToPages } from './pdftext.js';
import { buildBank, identifyPdfs, FIRST, LAST } from './extract.js';
import { buildUserTurn, CATEGORIES } from './compose.js';
import { parseVerdict, verifyQuote } from './parse.js';
import { summarize, latestByQuestion, attemptsFor } from './stats.js';
import { align } from './align.js';
import { initVocab } from './vocabview.js';

const $ = (id) => document.getElementById(id);

/** 클릭 연결. 화면에 없는 요소 하나 때문에 나머지가 통째로 멈추지 않게 한다. */
function on(id, handler) {
  const el = $(id);
  if (el) el.onclick = handler;
  else console.warn(`요소 없음: #${id}`);
}
const CHOICES = ['①', '②', '③', '④', '⑤'];

const state = {
  sample: null,
  db: null,
  bank: null,
  numbers: [],
  records: [],
  no: null,
  answer: '',
  grading: null,   // AbortController
};

const Q = (no) => state.bank?.[no];

// ── 기록 저장소 ────────────────────────────────────────
// db가 있으면 기기 사이에 같이 간다. 없으면 이 브라우저에만 남는다.
const local = {
  read() {
    try { return JSON.parse(localStorage.getItem('records') || '[]'); }
    catch { return []; }
  },
  write(rs) {
    try { localStorage.setItem('records', JSON.stringify(rs)); } catch { /* 사생활 보호 창 등 */ }
  },
};

async function loadRecords() {
  if (state.db) {
    try {
      const snap = await state.db.collection('records').get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch { /* 아래 localStorage로 */ }
  }
  return local.read();
}

async function saveRecord(rec) {
  state.records.push(rec);
  if (state.db) {
    try { await state.db.collection('records').add(rec); return; }
    catch { /* 아래 localStorage로 */ }
  }
  local.write(state.records.map(({ id, ...r }) => r));
}

// ── 문항 은행: 이 기기에만 둔다 ────────────────────────
// 시험지는 저작물이라 페이지에도 서버에도 넣지 않는다.
const bankStore = {
  read() {
    try { return JSON.parse(localStorage.getItem('bank') || 'null'); } catch { return null; }
  },
  write(bank) {
    try { localStorage.setItem('bank', JSON.stringify(bank)); return true; }
    catch { return false; }   // 용량 초과·사생활 보호 창
  },
  clear() { try { localStorage.removeItem('bank'); } catch { /* 무시 */ } },
};

function useBank(bank) {
  state.bank = bank;
  state.numbers = Object.keys(bank).map(Number).sort((a, b) => a - b);
  $('setup').hidden = true;
  $('main').hidden = false;
  renderBoard();
}

/** 두 은행이 같은 문항 묶음인가. 범위가 바뀌었는지 보려는 것이다. */
function sameQuestions(a, b) {
  if (!a || !b) return false;
  const ka = Object.keys(a).sort().join(',');
  const kb = Object.keys(b).sort().join(',');
  return ka === kb;
}

/** 저장소에 미리 넣어둔 문항을 읽는다. 있으면 PDF를 올릴 일이 없다. */
async function loadBankFromDb() {
  if (!state.db) return null;
  try {
    const snap = await state.db.collection('bank').get();
    if (snap.empty) return null;
    const bank = {};
    for (const d of snap.docs) {
      const q = d.data();
      if (q?.no && q?.지문) bank[q.no] = q;
    }
    return Object.keys(bank).length ? bank : null;
  } catch {
    return null;   // 권한이 없거나 연결이 안 되면 올려 받는 쪽으로
  }
}

// ── 부팅 ──────────────────────────────────────────────
async function boot() {
  const [sample, db] = await Promise.all([
    window.claude?.use('sample').catch(() => null) ?? null,
    window.claude?.use('db').catch(() => null) ?? null,
  ]);
  state.sample = sample;
  state.db = db;
  initVocab(db, () => state.bank);   // 예문은 문항 은행에서 찾는다 (없어도 단어장은 돈다)
  state.records = await loadRecords();

  // 이 기기에 있으면 그걸 먼저 띄워서 기다리지 않게 하고,
  // 그 다음 저장소와 맞춰본다. 시험 범위가 바뀌면 여기서 따라잡는다.
  const cached = bankStore.read();
  if (cached) useBank(cached);

  const fresh = await loadBankFromDb();
  if (fresh && !sameQuestions(cached, fresh)) {
    bankStore.write(fresh);
    useBank(fresh);
    if (cached) flash('문항이 바뀌어서 새로 받았다.');
  }

  if (!cached && !fresh) $('setup').hidden = false;

  $('sync-note').textContent = db ? '기록은 기기 사이에 같이 간다' : '기록은 이 브라우저에만 남는다';
  if (!sample) {
    $('btn-grade').disabled = true;
    $('btn-grade').textContent = '채점 불가';
  }
}

// ── 자료 올리기 ────────────────────────────────────────
if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

$('pdf-input').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  const status = $('setup-status');
  const err = $('setup-error');
  err.hidden = true;

  if (files.length !== 2) {
    err.hidden = false;
    err.textContent = `PDF 두 개(문제지, 해설지)를 골라라. ${files.length}개 골랐다.`;
    return;
  }
  if (!window.pdfjsLib) {
    err.hidden = false;
    err.textContent = 'PDF 읽기 기능을 못 불러왔다. 새로고침해봐라.';
    return;
  }

  try {
    status.textContent = 'PDF 읽는 중…';
    const [a, b] = await Promise.all(files.map(readPdfFile));
    status.textContent = '문항 나누는 중…';
    const { exam, solution } = identifyPdfs(a, b);
    const { bank, warnings } = buildBank(exam, solution);
    status.textContent = '';
    reviewBank(bank, warnings);
  } catch (ex) {
    status.textContent = '';
    err.hidden = false;
    err.textContent = `읽지 못했다: ${ex.message}`;
  }
});

async function readPdfFile(file) {
  const doc = await window.pdfjsLib.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    useSystemFonts: true,
  }).promise;
  return documentToPages(doc);
}

function reviewBank(bank, warnings) {
  const rows = [];
  for (let n = FIRST; n <= LAST; n++) {
    const q = bank[n];
    if (!q) { rows.push(`<tr><td>${n}</td><td colspan="4" style="color:var(--wrong)">찾지 못함</td></tr>`); continue; }
    const choicesOk = q.선지내장 ? q.선지.length === 0 : q.선지.length === 5;
    const ok = q.지문.length >= 80 && choicesOk && q.정답 && q.모범해석;
    rows.push(`<tr${ok ? '' : ' style="color:var(--wrong)"'}><td>${n}</td><td>${esc(q.유형)}</td>`
      + `<td>${q.정답 || '?'}</td><td>${q.지문.length}자</td>`
      + `<td>${q.선지내장 ? '지문 안' : `선지 ${q.선지.length}`}</td></tr>`);
  }
  $('setup-table').innerHTML =
    '<table><thead><tr><th>번호</th><th>유형</th><th>정답</th><th>지문</th><th>선지</th></tr></thead>'
    + `<tbody>${rows.join('')}</tbody></table>`;
  $('setup-warnings').innerHTML = warnings.length
    ? `<p class="small" style="color:var(--partial);margin-block-start:10px"><b>확인할 것</b><br>${warnings.map(esc).join('<br>')}</p>`
    : '<p class="small" style="color:var(--right);margin-block-start:10px">23문항 전부 정상으로 읽혔다.</p>';

  $('setup-review').hidden = false;
  on('setup-confirm', () => {
    if (!bankStore.write(bank)) flash('저장 공간이 부족하다. 다음에 다시 올려야 한다.');
    $('setup-review').hidden = true;
    useBank(bank);
    window.scrollTo(0, 0);
  });
  on('setup-redo', () => {
    $('setup-review').hidden = true;
    $('pdf-input').value = '';
  });
}

on('btn-repdf', async () => {
  if (!confirm('문항을 다시 읽어온다. 채점 기록은 그대로 남는다. 계속할까?')) return;
  bankStore.clear();
  state.bank = null;
  state.no = null;
  $('pdf-input').value = '';
  $('setup-review').hidden = true;
  $('stats-view').hidden = true;
  $('vocab-view').hidden = true;
  window.scrollTo(0, 0);

  // 저장소에 있으면 거기서 다시 받는다. 없을 때만 PDF를 올려달라고 한다.
  const bank = await loadBankFromDb();
  if (bank) { bankStore.write(bank); useBank(bank); return; }
  $('main').hidden = true;
  $('setup').hidden = false;
});

// ── 진행판 ────────────────────────────────────────────
function renderBoard() {
  const latest = latestByQuestion(state.records);
  const board = $('board');
  board.textContent = '';
  for (const n of state.numbers) {
    const rec = latest.get(n);
    const btn = document.createElement('button');
    btn.className = 'cell';
    btn.textContent = n;
    btn.setAttribute('aria-label', `${n}번${rec ? ` — ${rec.결과}` : ''}`);
    if (rec) btn.classList.add({ 맞음: 'right', 부분맞음: 'partial', 틀림: 'wrong' }[rec.결과] || '');
    if (n === state.no) btn.classList.add('current');
    btn.onclick = () => selectQuestion(n);
    board.append(btn);
  }
}

function selectQuestion(no) {
  state.no = no;
  state.answer = '';
  state.grading?.abort();
  $('verdict').textContent = '';
  $('panel').textContent = '';
  $('q-source').hidden = true;
  $('btn-source').textContent = '원문 보기';
  $('empty').hidden = true;
  $('workspace').hidden = false;

  const q = Q(no);
  $('q-title').innerHTML = `${no}번 <span class="qtype">${esc(q.유형)}</span>`;
  $('q-source').innerHTML = renderSource(q);
  $('translation').value = draft.get(no);
  renderChoices();
  renderBoard();
  $('translation').focus();
}

function renderSource(q) {
  const out = [];
  if (q.발문) out.push(`<p class="ask">${esc(q.발문)}</p>`);
  out.push(`<p class="passage">${esc(q.지문)}</p>`);
  if (q.선지?.length) out.push(`<ul class="opts">${q.선지.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`);
  if (q.각주?.length) out.push(`<p class="small muted">${esc(q.각주.join(' '))}</p>`);
  return out.join('');
}

function renderChoices() {
  const box = $('answer-choices');
  box.textContent = '';
  for (const c of CHOICES) {
    const b = document.createElement('button');
    b.className = `choice${state.answer === c ? ' on' : ''}`;
    b.textContent = c;
    b.setAttribute('aria-pressed', String(state.answer === c));
    b.onclick = () => { state.answer = state.answer === c ? '' : c; renderChoices(); };
    box.append(b);
  }
}

on('btn-source', () => {
  const box = $('q-source');
  box.hidden = !box.hidden;
  $('btn-source').textContent = box.hidden ? '원문 보기' : '원문 가리기';
});

// 타이핑 중인 해석. 실수로 닫아도 안 날아가게.
const draft = {
  get(no) { try { return localStorage.getItem(`draft:${no}`) || ''; } catch { return ''; } },
  set(no, v) { try { localStorage.setItem(`draft:${no}`, v); } catch { /* 무시 */ } },
  clear(no) { try { localStorage.removeItem(`draft:${no}`); } catch { /* 무시 */ } },
};
$('translation').addEventListener('input', (e) => {
  if (state.no) draft.set(state.no, e.target.value);
});

// ── 채점 ──────────────────────────────────────────────
on('btn-grade', async () => {
  const q = Q(state.no);
  if (!q || !state.sample) return;

  const translation = $('translation').value.trim();
  if (!translation) { flash('해석을 먼저 써라.'); return; }

  const history = attemptsFor(state.records, state.no)
    .map((r) => ({ translation: r.translation, 결과: r.결과, 분류: r.분류 }));

  // 규칙 + 그 문항의 자료 + 내 해석. sample은 대화를 기억하지 않으므로 매번 전부 보낸다.
  const prompt = `${RULES.trim()}\n\n---\n\n${buildUserTurn(q, { translation, answer: state.answer }, history)}`;

  const btn = $('btn-grade');
  const out = $('verdict');
  const ctl = new AbortController();
  state.grading = ctl;

  btn.disabled = true;
  btn.textContent = '채점 중';
  out.innerHTML = '<div class="verdict"><span class="thinking">채점하는 중</span></div>';

  try {
    const { text } = await state.sample(prompt, {
      signal: ctl.signal,
      onText: ({ text }) => {
        out.innerHTML = `<div class="verdict"><pre>${esc(text)}</pre></div>`;
      },
    });
    await record(q, translation, text);
  } catch (e) {
    if (e?.code === 'cancelled') { out.textContent = ''; return; }
    out.innerHTML = `<div class="verdict"><div class="vline"><b>${esc(errorCopy(e?.code))}</b></div>`
      + (e?.text ? `<pre>${esc(e.text)}</pre>` : '') + '</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = '채점';
    state.grading = null;
  }
});

function errorCopy(code) {
  switch (code) {
    case 'not_granted':
    case 'sampling_disabled': return '이 페이지가 Claude를 쓰도록 허용해야 채점할 수 있다.';
    case 'rate_limited': return '요청이 몰렸다. 잠시 뒤에 다시 눌러라.';
    case 'session_expired': return '로그인이 풀렸다. 새로고침하고 다시 해라.';
    case 'refused': return 'Claude가 이 입력은 채점하지 않았다. 해석을 고쳐서 다시 해봐라.';
    case 'empty_completion': return '답이 비어서 왔다. 해석을 조금 줄여서 다시 해봐라.';
    case 'prompt_too_large': return '보낼 내용이 너무 길다. 해석을 줄여라.';
    default: return '채점이 중간에 끊겼다. 다시 눌러봐라.';
  }
}

/** 채점 결과를 파싱해 띄우고 기록에 남긴다. 포맷이 깨지면 기록하지 않는다. */
async function record(q, translation, text) {
  const v = parseVerdict(text);
  const quote = v.결정문장 ? verifyQuote(v.결정문장, q.지문) : '해당없음';
  renderVerdict(v, quote);
  if (!v.ok || v.결과 === '해설지에 없음') return;

  await saveRecord({
    no: q.no, ts: Date.now(), translation,
    결과: v.결과, 분류: v.분류, 결정문장: v.결정문장, 다음: v.다음, 근거: quote,
  });
  draft.clear(q.no);
  renderBoard();
}

function renderVerdict(v, quote) {
  const out = $('verdict');
  if (!v.ok) {
    out.innerHTML = '<div class="verdict"><div class="vline"><b>정해진 형식이 아니라 기록하지 않았다.</b></div>'
      + `<pre>${esc(v.raw)}</pre></div>`;
    return;
  }
  const tone = { 맞음: 'right', 부분맞음: 'partial', 틀림: 'wrong' }[v.결과] || '';
  const flag = quote === '없음'
    ? '<span class="flag warn">⚠ 지문에 없는 문장</span>'
    : quote === '확인' ? '<span class="flag ok">지문 확인됨</span>' : '';

  out.innerHTML = `
    <div class="verdict ${tone}">
      <div class="vline"><span class="vkey">결과</span>
        <b>${esc(v.결과)}</b>
        ${v.분류 ? `<span class="cat cat-${CATEGORIES.indexOf(v.분류)}">${esc(v.분류)}</span>` : ''}</div>
      ${v.오류 ? `<div class="vline"><span class="vkey">오류</span><span>${esc(v.오류)}</span></div>` : ''}
      ${v.결정문장 ? `<div class="vline"><span class="vkey">결정문장</span><span>
        <span class="vquote">${esc(v.결정문장)}</span> ${flag}
        ${v.올바른해석 ? `<div class="vgloss">→ ${esc(v.올바른해석)}</div>` : ''}</span></div>` : ''}
      ${v.다음 ? `<div class="vline vnext"><span class="vkey">다음</span><b>${esc(v.다음)}</b></div>` : ''}
    </div>`;
}

// ── 단어 · 통째로 (해설지에 있는 내용이라 물어볼 게 없다) ──
on('btn-word', () => {
  const q = Q(state.no);
  if (!q) return;
  const rows = (q.어휘 || []).map((v) => {
    const head = v.match(/^([A-Za-z][A-Za-z'’\- ]*)/)?.[1]?.trim() || '';
    const 뜻 = v.slice(head.length).trim();
    return `<tr><td>${esc(head || v)}</td><td>${esc(뜻)}</td><td>${esc(findSentence(q.지문, head))}</td></tr>`;
  });
  showPanel(rows.length
    ? `<div class="card"><h3>단어</h3><table class="vocab">
         <thead><tr><th>단어</th><th>뜻</th><th>그 문장</th></tr></thead>
         <tbody>${rows.join('')}</tbody></table>
       <p class="small muted" style="margin-block-start:10px">해설지 [어휘 및 어구]에 실린 것이다.</p></div>`
    : '<div class="card"><h3>단어</h3><p class="muted">이 문항은 해설지에 실린 어휘가 없다.</p></div>');
});

/** 그 낱말이 든 문장을 지문에서 찾는다. 표제어는 원형이라 활용형과 안 맞을 수 있다. */
function findSentence(지문, head) {
  if (!head) return '';
  const esc2 = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hit = (w) => 지문.match(new RegExp(`[^.!?]*\\b${esc2(w)}[a-z]*\\b[^.!?]*[.!?]`, 'i'))?.[0]?.trim();
  const whole = hit(head);
  if (whole) return whole;
  const STOP = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'to', 'for', 'by', 'with', 'one', 'at', 'as', 'or', 'and']);
  const words = head.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !STOP.has(w));
  for (const w of words.sort((a, b) => b.length - a.length)) {
    const found = hit(w);
    if (found) return found;
  }
  return '';
}

on('btn-whole', () => {
  const q = Q(state.no);
  if (!q) return;
  const a = align(q.지문, q.모범해석, q.유형);
  const given = a.주어진문장
    ? `<div class="given"><div class="eyebrow">주어진 문장</div>
       <div class="vquote">${esc(a.주어진문장)}</div>
       <p class="small muted" style="margin-block-start:4px">삽입 문항이라 이 문장은 해석에서 끼워 넣어진 자리에 가 있다.</p></div>`
    : '';
  const body = a.mode === '짝'
    ? `<ol class="pairs">${a.pairs.map((p) =>
        `<li><div class="en">${esc(p.en)}</div><div class="ko">${esc(p.ko)}</div></li>`).join('')}</ol>`
    : `<div class="side"><div class="en"><div class="eyebrow">원문</div>${a.en.map((s) => `<p>${esc(s)}</p>`).join('')}</div>
         <div><div class="eyebrow">해석</div>${a.ko.map((s) => `<p>${esc(s)}</p>`).join('')}</div></div>
       <p class="small muted">문장이 1:1로 안 맞아 전문으로 대조한다.</p>`;
  showPanel(`<div class="card"><h3>통째로</h3>${given}${body}</div>`);
});

function showPanel(html) {
  const panel = $('panel');
  panel.innerHTML = html;
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── 정리 (집계는 코드가 한다) ──────────────────────────
on('btn-stats', () => {
  renderStats();
  $('main').hidden = true;
  $('vocab-view').hidden = true;
  $('stats-view').hidden = false;
  window.scrollTo(0, 0);
});
on('btn-stats-back', () => {
  $('stats-view').hidden = true;
  if (state.bank) $('main').hidden = false; else $('setup').hidden = false;
});

function renderStats() {
  const s = summarize(state.records);
  const box = $('stats-body');

  if (!s.총시도) {
    box.innerHTML = '<div class="card"><h3>정리</h3><p class="muted">아직 채점한 게 없다. 한 문항 풀고 오면 여기 쌓인다.</p></div>';
    return;
  }

  const max = Math.max(...Object.values(s.분류별), 1);
  const bars = CATEGORIES.map((c, i) => `
    <div class="bar-row">
      <span class="bar-label">${c}</span>
      <div class="bar-track">${s.분류별[c] ? `<div class="bar cat-${i}" style="inline-size:${(s.분류별[c] / max) * 100}%"></div>` : ''}</div>
      <span class="bar-value">${s.분류별[c]}</span>
    </div>`).join('');

  const tip = s.최다분류
    ? `<div class="card">
         <h3>가장 많이 틀린 건 <span class="cat cat-${CATEGORIES.indexOf(s.최다분류)}">${s.최다분류}</span></h3>
         <pre class="tips">${esc(TIPS[s.최다분류] || '')}</pre></div>`
    : '';

  box.innerHTML = `
    <div class="card">
      <h3>푼 문항 ${s.푼문항.length} / ${state.numbers.length}</h3>
      <p class="tally"><span class="r">맞음 ${s.맞음}</span><span class="p">부분맞음 ${s.부분맞음}</span><span class="w">틀림 ${s.틀림}</span></p>
    </div>
    <div class="card">
      <h3>분류별 오답</h3>${bars}
      <p class="small muted" style="margin-block-start:10px">
        맞은 문항은 세지 않는다. 이 집계는 저장된 기록으로 직접 계산한 것이다.</p>
    </div>
    ${tip}`;
}

// ── 잡동사니 ──────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
function flash(msg) {
  let el = $('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.append(el); }
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2200);
}

boot();
