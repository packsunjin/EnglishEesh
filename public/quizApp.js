// 학습지 문제 생성 — 화면 상태와 흐름.
// 해석 코치(app.js)와 로그인 세션을 공유하지만(같은 쿠키), 자료와 로직은 완전히 별개다.
//
// 문제는 기계적으로 만들지 않는다. 학습지 원문을 서버(Claude API)에 보내서 실제로 생성한다 —
// 그래서 이 기능은 자동 모드 전용이다(API 키가 없으면 막힌다). 해석 코치처럼 API 키 없이
// 쓰는 복사 모드는 만들지 않았다.

import * as pdfjs from './vendor/pdf.min.mjs';
import { documentToPages } from './pdftext.js';
import * as db from './quizDb.js';

pdfjs.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';

const $ = (id) => document.getElementById(id);

const state = {
  mode: 'copy',
  banks: [],
  pending: null,        // 저장 전 미리보기 { name, sourceText, questions }
  currentBank: null,
  round: null,           // 현재 시험 문제 배열
  answers: [],           // 문항별 고른 선지 인덱스, -1 = 안 고름
  no: 0,
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
    status = { needsPassword: false, authed: true, mode: 'copy' };
  }
  state.mode = status.mode;
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
  const status = await res.json();
  state.mode = status.mode;
  await enterApp();
});

async function enterApp() {
  state.banks = await db.listBanks();
  renderBankList();
  show('list');
}

// ── 학습지 목록 ────────────────────────────────────────
function renderBankList() {
  $('list-no-key').hidden = state.mode === 'auto';
  $('btn-new-bank').disabled = state.mode !== 'auto';

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
        <p class="muted small">${b.questions?.length ?? 0}문제 · ${new Date(b.createdAt).toLocaleDateString()}</p>
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
  if (state.mode !== 'auto') return;
  $('bank-name').value = '';
  $('bank-text').value = '';
  $('bank-file').value = '';
  $('gen-count').value = '50';
  $('upload-review').hidden = true;
  $('upload-error').hidden = true;
  state.pending = null;
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
    text(status, '읽었다.');
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

/** 서버(Claude API)에 문제 생성을 요청한다. */
async function requestQuiz(name, sourceText, count) {
  const res = await fetch('/api/quiz-generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, sourceText, count }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `서버 오류 ${res.status}`);
  return data.questions;
}

$('btn-generate').onclick = async () => {
  const err = $('upload-error');
  err.hidden = true;
  const name = $('bank-name').value.trim() || `학습지 ${new Date().toLocaleDateString()}`;
  const sourceText = $('bank-text').value.trim();
  const count = Math.max(1, Math.min(50, Number($('gen-count').value) || 50));

  if (!sourceText) { err.hidden = false; text(err, '학습지 내용을 붙여넣거나 파일을 올려라.'); return; }

  const btn = $('btn-generate');
  btn.disabled = true;
  btn.textContent = '만드는 중… (자료가 길면 시간이 좀 걸린다)';
  text($('upload-status'), '');
  try {
    const questions = await requestQuiz(name, sourceText, count);
    state.pending = { name, sourceText, questions };
    reviewGenerated(questions);
  } catch (ex) {
    err.hidden = false;
    text(err, `문제를 만들지 못했다: ${ex.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'AI로 문제 만들기';
  }
};

function reviewGenerated(questions) {
  $('upload-preview').innerHTML = `
    <p class="ok-note">${questions.length}문제를 만들었다.</p>
    ${questions.map((q, i) => `
      <div class="qpreview">
        <p><b>${i + 1}.</b> ${esc(q.question)}</p>
        <ol class="qpreview-choices">
          ${q.choices.map((c, j) => `<li class="${j === q.correctIndex ? 'correct' : ''}">${esc(c)}</li>`).join('')}
        </ol>
        <p class="muted small">${esc(q.explanation)}</p>
      </div>`).join('')}
  `;
  $('upload-review').hidden = false;
  $('upload-review').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('btn-redo-bank').onclick = () => { $('upload-review').hidden = true; state.pending = null; };

$('btn-save-bank').onclick = async () => {
  if (!state.pending) return;
  const { name, sourceText, questions } = state.pending;
  const id = await db.addBank(name, sourceText, questions);
  state.pending = null;
  state.banks = await db.listBanks();
  renderBankList();
  openSetup(id);
};

// ── 학습지 상세 / 시험 시작 ─────────────────────────────
async function openSetup(bankId) {
  const bank = await db.getBank(bankId);
  if (!bank) return;
  state.currentBank = bank;
  text($('setup-title'), bank.name);
  text($('setup-hint'), `이 학습지에는 문제 ${bank.questions?.length ?? 0}개가 저장돼 있다.`);
  $('setup-regen-count').value = String(Math.min(50, bank.questions?.length || 50));
  text($('regen-status'), '');
  $('btn-regenerate').disabled = state.mode !== 'auto';

  const attempts = (await db.listAttempts(bankId)).sort((a, b) => b.ts - a.ts);
  $('setup-history').hidden = attempts.length === 0;
  if (attempts.length) {
    $('history-body').innerHTML = `<table><thead><tr><th>날짜</th><th>점수</th></tr></thead><tbody>${
      attempts.slice(0, 10).map((a) => `<tr>
        <td>${new Date(a.ts).toLocaleString()}</td>
        <td>${a.correct} / ${a.total}</td>
      </tr>`).join('')
    }</tbody></table>`;
  }
  show('setup');
}

$('btn-setup-back').onclick = () => show('list');

$('btn-start-round').onclick = () => {
  const bank = state.currentBank;
  if (!bank?.questions?.length) { alert('저장된 문제가 없다.'); return; }
  startRound(bank.questions);
};

$('btn-regenerate').onclick = async () => {
  const bank = state.currentBank;
  if (!bank || state.mode !== 'auto') return;
  const count = Math.max(1, Math.min(50, Number($('setup-regen-count').value) || 50));
  const btn = $('btn-regenerate');
  btn.disabled = true;
  btn.textContent = '만드는 중…';
  text($('regen-status'), '');
  try {
    const questions = await requestQuiz(bank.name, bank.sourceText, count);
    await db.setQuestions(bank.id, questions);
    state.currentBank = { ...bank, questions };
    text($('setup-hint'), `이 학습지에는 문제 ${questions.length}개가 저장돼 있다.`);
    text($('regen-status'), `${questions.length}문제로 새로 만들었다.`);
    state.banks = await db.listBanks();
    renderBankList();
  } catch (ex) {
    text($('regen-status'), `실패: ${ex.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '문제 새로 생성';
  }
};

function startRound(questions) {
  state.round = questions;
  state.answers = new Array(questions.length).fill(-1);
  state.no = 0;
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
  text($('test-prompt'), q.question);

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

  const details = state.round.map((q, i) => {
    const chosenIndex = state.answers[i];
    return { ...q, chosenIndex, isCorrect: chosenIndex === q.correctIndex };
  });
  const correct = details.filter((d) => d.isCorrect).length;
  const result = { total: details.length, correct, wrong: details.length - correct, details };

  await db.addAttempt({ bankId: state.currentBank.id, ts: Date.now(), total: result.total, correct: result.correct });
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
    <div class="qpreview">
      <p>${esc(d.question)}</p>
      <p class="error small">내가 고른 것: ${d.chosenIndex === -1 ? '(안 고름)' : esc(d.choices[d.chosenIndex])}</p>
      <p class="ok-note small">정답: ${esc(d.choices[d.correctIndex])}</p>
      <p class="muted small">${esc(d.explanation)}</p>
    </div>`).join('');

  $('result-body').innerHTML = `
    <div class="card centered">
      <h2>${result.correct} / ${result.total}</h2>
      <p class="muted">${pct}%</p>
    </div>
    ${wrongRows ? `
      <div class="card">
        <h3>틀린 것 ${result.wrong}개</h3>
        ${wrongRows}
      </div>
      <div class="row">
        <button id="btn-retry-wrong" class="primary">틀린 것만 다시</button>
      </div>` : '<div class="card"><p class="ok-note">전부 맞았다.</p></div>'}
  `;

  const retryBtn = $('btn-retry-wrong');
  if (retryBtn) {
    retryBtn.onclick = () => {
      const wrongQuestions = result.details.filter((d) => !d.isCorrect)
        .map(({ question, choices, correctIndex, explanation }) => ({ question, choices, correctIndex, explanation }));
      startRound(wrongQuestions);
    };
  }
}

$('btn-result-back').onclick = () => show('list');

boot();
