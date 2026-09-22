// 학습지 단어 시험 — 화면 상태와 흐름.
// 해석 코치(app.js)와 로그인 세션을 공유하지만(같은 쿠키), 자료와 로직은 완전히 별개다.

import * as pdfjs from './vendor/pdf.min.mjs';
import { documentToPages } from './pdftext.js';
import { parseItems } from './quizParse.js';
import { buildRound, scoreRound } from './quizGen.js';
import * as db from './quizDb.js';

pdfjs.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';

const $ = (id) => document.getElementById(id);
const DIRECTION_LABEL = {
  'term-to-meaning': '단어 → 뜻',
  'meaning-to-term': '뜻 → 단어',
  mixed: '섞어서',
};

const state = {
  banks: [],
  parsed: null,       // 업로드 중 미리보기 { items, skipped, name }
  currentBank: null,
  round: null,         // 현재 시험 문제 배열
  answers: [],          // 문항별 고른 선지 인덱스, -1 = 안 고름
  no: 0,                // 현재 보고 있는 문항 인덱스
  direction: 'term-to-meaning',   // 이번 회차에서 고른 방향 (기록용)
};

function show(view) {
  for (const el of document.querySelectorAll('.view')) el.classList.remove('active');
  $(`view-${view}`).classList.add('active');
  window.scrollTo(0, 0);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function text(el, s) { el.textContent = s; }

// ── 부팅 / 로그인 ─────────────────────────────────────
async function boot() {
  let status;
  try {
    status = await fetch('/api/status').then((r) => r.json());
  } catch {
    status = { needsPassword: false, authed: true };
  }
  $('boot').hidden = true;
  $('app').hidden = false;
  if (status.needsPassword && !status.authed) { show('login'); return; }
  await enterApp();
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('login-error');
  err.hidden = true;
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: $('password').value }),
  });
  if (!res.ok) { err.hidden = false; text(err, '비밀번호가 틀렸다.'); return; }
  await enterApp();
});

async function enterApp() {
  state.banks = await db.listBanks();
  renderBankList();
  show('list');
}

// ── 학습지 목록 ────────────────────────────────────────
function renderBankList() {
  const box = $('bank-list');
  if (!state.banks.length) {
    box.innerHTML = '<div class="card"><p class="muted">아직 올린 학습지가 없다. 위 버튼으로 하나 올려라.</p></div>';
    return;
  }
  box.innerHTML = state.banks
    .slice().sort((a, b) => b.createdAt - a.createdAt)
    .map((b) => `
      <div class="card bank-card">
        <h3>${esc(b.name)}</h3>
        <p class="muted small">${b.items.length}개 항목 · ${new Date(b.createdAt).toLocaleDateString()}</p>
        <div class="row">
          <button class="primary small" data-act="test" data-id="${b.id}">시험 보기</button>
          <button class="ghost small" data-act="delete" data-id="${b.id}">삭제</button>
        </div>
      </div>`).join('');

  for (const btn of box.querySelectorAll('button[data-act]')) {
    const id = Number(btn.dataset.id);
    if (btn.dataset.act === 'test') btn.onclick = () => openSetup(id);
    if (btn.dataset.act === 'delete') btn.onclick = () => removeBank(id);
  }
}

async function removeBank(id) {
  const bank = state.banks.find((b) => b.id === id);
  if (!bank) return;
  if (!confirm(`"${bank.name}"을(를) 지운다. 시험 기록도 같이 지워진다. 계속할까?`)) return;
  await db.deleteBank(id);
  state.banks = await db.listBanks();
  renderBankList();
}

// ── 학습지 올리기 ──────────────────────────────────────
$('btn-new-bank').onclick = () => {
  $('bank-name').value = '';
  $('bank-text').value = '';
  $('bank-file').value = '';
  $('upload-review').hidden = true;
  $('upload-error').hidden = true;
  text($('upload-status'), '');
  show('upload');
};
$('btn-upload-back').onclick = () => show('list');

$('bank-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const status = $('upload-status');
  const err = $('upload-error');
  err.hidden = true;
  try {
    text(status, '파일 읽는 중…');
    const content = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
      ? await pdfToText(file)
      : await file.text();
    $('bank-text').value = content;
    if (!$('bank-name').value.trim()) $('bank-name').value = file.name.replace(/\.[^.]+$/, '');
    text(status, '읽었다. 아래에서 확인해라.');
  } catch (ex) {
    text(status, '');
    err.hidden = false;
    text(err, `파일을 읽지 못했다: ${ex.message}`);
  }
});

async function pdfToText(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data: buf, useSystemFonts: true }).promise;
  const pages = await documentToPages(doc);
  return pages.map((p) => p.lines.map((l) => l.text).join('\n')).join('\n');
}

$('btn-parse').onclick = () => {
  const err = $('upload-error');
  err.hidden = true;
  const raw = $('bank-text').value;
  if (!raw.trim()) { err.hidden = false; text(err, '학습지 내용을 붙여넣거나 파일을 올려라.'); return; }

  const { items, skipped } = parseItems(raw);
  if (!items.length) {
    err.hidden = false;
    text(err, '한 줄도 읽지 못했다. "단어 뜻" 형식인지 확인해라.');
    $('upload-review').hidden = true;
    return;
  }
  state.parsed = { items, skipped };
  reviewParsed(items, skipped);
};

function reviewParsed(items, skipped) {
  const rows = items.map((it) => `<tr><td>${esc(it.term)}</td><td>${esc(it.meaning)}</td></tr>`).join('');
  $('upload-table').innerHTML =
    `<p class="ok-note">${items.length}개 항목을 읽었다.</p>
     <table><thead><tr><th>단어</th><th>뜻</th></tr></thead><tbody>${rows}</tbody></table>`;

  $('upload-warnings').innerHTML = skipped.length
    ? `<div class="warn"><strong>못 읽은 줄 ${skipped.length}개</strong><ul>
        ${skipped.slice(0, 20).map((s) => `<li>${esc(s)}</li>`).join('')}
        ${skipped.length > 20 ? `<li>… 외 ${skipped.length - 20}줄</li>` : ''}
       </ul></div>`
    : '';

  $('upload-review').hidden = false;
  $('upload-review').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('btn-redo-bank').onclick = () => { $('upload-review').hidden = true; };

$('btn-save-bank').onclick = async () => {
  if (!state.parsed) return;
  const name = $('bank-name').value.trim() || `학습지 ${new Date().toLocaleDateString()}`;
  const id = await db.addBank(name, state.parsed.items);
  state.parsed = null;
  state.banks = await db.listBanks();
  renderBankList();
  openSetup(id);
};

// ── 시험 설정 ─────────────────────────────────────────
async function openSetup(bankId) {
  const bank = await db.getBank(bankId);
  if (!bank) return;
  state.currentBank = bank;
  text($('setup-title'), bank.name);
  const max = Math.min(50, bank.items.length);
  $('setup-size').max = String(max);
  $('setup-size').value = String(max);
  text($('setup-hint'), `이 학습지에는 ${bank.items.length}개 항목이 있다. 한 회 최대 ${max}문제.`);

  const attempts = (await db.listAttempts(bankId)).sort((a, b) => b.ts - a.ts);
  $('setup-history').hidden = attempts.length === 0;
  if (attempts.length) {
    $('history-body').innerHTML = `<table><thead><tr><th>날짜</th><th>방향</th><th>점수</th></tr></thead><tbody>${
      attempts.slice(0, 10).map((a) => `<tr>
        <td>${new Date(a.ts).toLocaleString()}</td>
        <td>${DIRECTION_LABEL[a.direction] || a.direction}</td>
        <td>${a.correct} / ${a.total}</td>
      </tr>`).join('')
    }</tbody></table>`;
  }
  show('setup');
}

$('btn-setup-back').onclick = () => show('list');

$('btn-start-round').onclick = () => {
  const bank = state.currentBank;
  if (!bank) return;
  const direction = $('setup-direction').value;
  const size = Math.max(2, Math.min(50, Number($('setup-size').value) || bank.items.length));
  try {
    startRound(bank.items, direction, size);
  } catch (ex) {
    alert(ex.message);
  }
};

function startRound(items, direction, size) {
  state.round = buildRound(items, { size, direction });
  state.answers = new Array(state.round.length).fill(-1);
  state.no = 0;
  state.direction = direction;
  renderTestBoard();
  renderQuestion();
  show('test');
}

// ── 시험 보기 ─────────────────────────────────────────
function renderTestBoard() {
  const board = $('test-board');
  board.innerHTML = '';
  state.round.forEach((_, i) => {
    const btn = document.createElement('button');
    btn.className = 'cell';
    btn.textContent = i + 1;
    if (state.answers[i] !== -1) btn.classList.add('answered');
    if (i === state.no) btn.classList.add('current');
    btn.onclick = () => { state.no = i; renderQuestion(); };
    board.append(btn);
  });
}

function renderQuestion() {
  const q = state.round[state.no];
  text($('test-progress'), `${state.no + 1} / ${state.round.length}`);
  text($('test-direction-label'), DIRECTION_LABEL[q.direction] || '');
  text($('test-prompt'), q.prompt);

  const box = $('test-choices');
  box.innerHTML = '';
  q.choices.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = `quiz-choice${state.answers[state.no] === i ? ' on' : ''}`;
    b.textContent = c;
    b.onclick = () => {
      state.answers[state.no] = i;
      renderTestBoard();
      renderQuestion();
      if (state.no < state.round.length - 1) setTimeout(() => { state.no++; renderQuestion(); renderTestBoard(); }, 220);
    };
    box.append(b);
  });

  $('btn-test-prev').disabled = state.no === 0;
  $('btn-test-next').disabled = state.no === state.round.length - 1;
}

$('btn-test-prev').onclick = () => { if (state.no > 0) { state.no--; renderQuestion(); renderTestBoard(); } };
$('btn-test-next').onclick = () => {
  if (state.no < state.round.length - 1) { state.no++; renderQuestion(); renderTestBoard(); }
};

$('btn-test-submit').onclick = async () => {
  const unanswered = state.answers.filter((a) => a === -1).length;
  if (unanswered && !confirm(`${unanswered}문제를 안 골랐다. 그래도 제출할까?`)) return;
  const result = scoreRound(state.round, state.answers);
  await db.addAttempt({
    bankId: state.currentBank.id,
    ts: Date.now(),
    total: result.total,
    correct: result.correct,
    direction: state.direction,
  });
  renderResult(result);
  show('result');
};

$('btn-test-quit').onclick = () => {
  if (state.answers.some((a) => a !== -1) && !confirm('시험을 그만둔다. 지금까지 고른 답은 저장되지 않는다. 계속할까?')) return;
  show('setup');
};

// ── 결과 ──────────────────────────────────────────────
function renderResult(result) {
  const pct = Math.round((result.correct / result.total) * 100);
  const wrongRows = result.details.filter((d) => !d.isCorrect).map((d) => `
    <tr>
      <td>${esc(d.term)}</td>
      <td>${esc(d.meaning)}</td>
      <td class="wrong">${d.chosenIndex === -1 ? '(안 고름)' : esc(d.choices[d.chosenIndex])}</td>
    </tr>`).join('');

  $('result-body').innerHTML = `
    <div class="card centered">
      <h2>${result.correct} / ${result.total}</h2>
      <p class="muted">${pct}%</p>
    </div>
    ${wrongRows ? `
      <div class="card">
        <h3>틀린 것 ${result.wrong}개</h3>
        <table><thead><tr><th>단어</th><th>뜻</th><th>내가 고른 것</th></tr></thead>
        <tbody>${wrongRows}</tbody></table>
      </div>
      <div class="row">
        <button id="btn-retry-wrong" class="primary">틀린 것만 다시</button>
      </div>` : '<div class="card"><p class="ok-note">전부 맞았다.</p></div>'}
  `;

  const retryBtn = $('btn-retry-wrong');
  if (retryBtn) {
    retryBtn.onclick = () => {
      const wrongItems = result.details.filter((d) => !d.isCorrect)
        .map((d) => ({ term: d.term, meaning: d.meaning }));
      if (wrongItems.length < 2) { alert('오답이 1개뿐이라 다시 시험을 만들 수 없다.'); return; }
      try {
        startRound(wrongItems, state.direction, wrongItems.length);
      } catch (ex) {
        alert(ex.message);
      }
    };
  }
}

$('btn-result-back').onclick = () => show('list');

boot();
