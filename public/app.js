// 화면 전체의 상태와 흐름.
//
// 두 가지 모드로 돈다.
//   자동 모드 — 서버가 Claude API를 불러 채점한다 (ANTHROPIC_API_KEY가 있을 때)
//   복사 모드 — 프롬프트를 만들어주고, 사용자가 Claude 앱에 붙여넣고 결과를 도로 붙여넣는다
// 두 모드는 compose.js의 같은 함수로 프롬프트를 만든다. 채점 품질이 갈리면 안 된다.

import * as pdfjs from './vendor/pdf.min.mjs';
import { documentToPages } from './pdftext.js';
import { buildBank, identifyPdfs, FIRST, LAST } from './extract.js';
import { buildCopyPrompt, buildUserTurn, CATEGORIES, NOT_IN_KEY } from './compose.js';
import { parseVerdict, verifyQuote } from './parse.js';
import { summarize, latestByQuestion, attemptsFor } from './stats.js';
import { align } from './align.js';
import * as db from './db.js';

pdfjs.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';

const $ = (id) => document.getElementById(id);
const CHOICES = ['①', '②', '③', '④', '⑤'];

const state = {
  mode: 'copy',
  rules: '',
  bank: null,
  records: [],
  no: null,
  answer: '',
  pendingPrompt: '',
  rulesPasted: false,   // 복사 모드에서 규칙을 이미 한 번 보냈는가
};

// ── 화면 전환 ──────────────────────────────────────────
function show(view) {
  for (const el of document.querySelectorAll('.view')) el.classList.remove('active');
  $(`view-${view}`).classList.add('active');
  window.scrollTo(0, 0);
}

function text(el, s) { el.textContent = s; }

// ── 부팅 ──────────────────────────────────────────────
async function boot() {
  let status;
  try {
    status = await fetch('/api/status').then((r) => r.json());
  } catch {
    status = { mode: 'copy', needsPassword: false };
  }
  state.mode = status.mode;
  state.rules = status.rules || '';

  $('boot').hidden = true;
  $('app').hidden = false;

  if (status.needsPassword && !status.authed) { show('login'); return; }
  await enterApp();
}

async function enterApp() {
  state.bank = await db.getBank();
  state.records = await db.listRecords();
  if (!state.bank) { show('setup'); return; }
  renderMain();
  show('main');
}

// ── 로그인 ────────────────────────────────────────────
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
  state.rules = status.rules || '';
  await enterApp();
});

// ── 자료 올리기 ────────────────────────────────────────
$('pdf-input').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  const status = $('setup-status');
  const err = $('setup-error');
  err.hidden = true;

  if (files.length !== 2) {
    err.hidden = false;
    text(err, `PDF 두 개(문제지, 해설지)를 골라라. ${files.length}개 골랐다.`);
    return;
  }

  try {
    text(status, 'PDF 읽는 중…');
    const [a, b] = await Promise.all(files.map(readPdfFile));
    text(status, '문항 나누는 중…');
    const { exam, solution } = identifyPdfs(a, b);
    const { bank, warnings } = buildBank(exam, solution);
    text(status, '');
    reviewBank(bank, warnings);
  } catch (ex) {
    text(status, '');
    err.hidden = false;
    text(err, `읽지 못했다: ${ex.message}`);
  }
});

async function readPdfFile(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data: buf, useSystemFonts: true }).promise;
  return documentToPages(doc);
}

function reviewBank(bank, warnings) {
  const rows = [];
  for (let n = FIRST; n <= LAST; n++) {
    const q = bank[n];
    if (!q) { rows.push(`<tr class="bad"><td>${n}</td><td colspan="4">찾지 못함</td></tr>`); continue; }
    const 선지ok = q.선지내장 ? q.선지.length === 0 : q.선지.length === 5;
    const ok = q.지문.length >= 80 && 선지ok && q.정답 && q.모범해석;
    rows.push(
      `<tr class="${ok ? '' : 'bad'}"><td>${n}</td><td>${esc(q.유형)}</td>`
      + `<td>${q.정답 || '?'}</td><td>${q.지문.length}자</td>`
      + `<td>${q.선지내장 ? '지문 내' : `선지 ${q.선지.length}`}</td></tr>`,
    );
  }
  $('setup-table').innerHTML =
    `<table><thead><tr><th>번호</th><th>유형</th><th>정답</th><th>지문</th><th>선지</th></tr></thead>`
    + `<tbody>${rows.join('')}</tbody></table>`;

  $('setup-warnings').innerHTML = warnings.length
    ? `<div class="warn"><strong>확인할 것</strong><ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`
    : '<p class="ok-note">23문항 전부 정상으로 읽혔다.</p>';

  $('setup-review').hidden = false;
  $('setup-confirm').onclick = async () => {
    await db.setBank(bank);
    state.bank = bank;
    $('setup-review').hidden = true;
    renderMain();
    show('main');
  };
  $('setup-redo').onclick = () => {
    $('setup-review').hidden = true;
    $('pdf-input').value = '';
  };
}

// ── 메인 ──────────────────────────────────────────────
function renderMain() {
  const badge = $('mode-badge');
  badge.textContent = state.mode === 'auto' ? '자동 채점' : '복사 모드';
  badge.className = `badge ${state.mode}`;
  $('btn-grade').textContent = state.mode === 'auto' ? '채점' : '프롬프트 복사';
  renderBoard();
}

function renderBoard() {
  const latest = latestByQuestion(state.records);
  const board = $('board');
  board.innerHTML = '';
  for (let n = FIRST; n <= LAST; n++) {
    const q = state.bank?.[n];
    const rec = latest.get(n);
    const btn = document.createElement('button');
    btn.className = 'cell';
    btn.textContent = n;
    if (!q) { btn.classList.add('missing'); btn.title = NOT_IN_KEY; }
    else if (rec) btn.classList.add(({ 맞음: 'right', 부분맞음: 'partial', 틀림: 'wrong' })[rec.결과] || '');
    if (n === state.no) btn.classList.add('current');
    btn.onclick = () => selectQuestion(n);
    board.append(btn);
  }
}

async function selectQuestion(no) {
  state.no = no;
  state.answer = '';
  state.pendingPrompt = '';
  $('verdict').innerHTML = '';
  $('panel').innerHTML = '';
  $('copy-flow').hidden = true;
  $('paste').value = '';
  $('q-source').hidden = true;
  $('btn-source').textContent = '원문 보기';

  const q = state.bank?.[no];
  if (!q) {
    $('workspace').hidden = true;
    $('verdict').innerHTML = `<div class="verdict"><div class="line"><b>${NOT_IN_KEY}</b></div></div>`;
    renderBoard();
    return;
  }

  $('workspace').hidden = false;
  text($('q-title'), `${no}번 · ${q.유형}`);
  $('q-source').innerHTML = renderSource(q);
  $('translation').value = (await db.getDraft(no)) || '';
  renderAnswerChoices();
  renderBoard();
  $('translation').focus();
}

function renderSource(q) {
  const parts = [];
  if (q.발문) parts.push(`<p class="prompt">${esc(q.발문)}</p>`);
  parts.push(`<p class="passage">${esc(q.지문)}</p>`);
  if (q.선지.length) parts.push(`<ul class="opts">${q.선지.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`);
  if (q.각주.length) parts.push(`<p class="muted small">${esc(q.각주.join(' '))}</p>`);
  return parts.join('');
}

function renderAnswerChoices() {
  const box = $('answer-choices');
  box.innerHTML = '';
  for (const c of CHOICES) {
    const b = document.createElement('button');
    b.className = `choice${state.answer === c ? ' on' : ''}`;
    b.textContent = c;
    b.onclick = () => { state.answer = state.answer === c ? '' : c; renderAnswerChoices(); };
    box.append(b);
  }
}

$('btn-source').onclick = () => {
  const box = $('q-source');
  box.hidden = !box.hidden;
  $('btn-source').textContent = box.hidden ? '원문 보기' : '원문 가리기';
};

$('translation').addEventListener('input', (e) => {
  if (state.no) db.setDraft(state.no, e.target.value);
});

$('btn-clear-answer').onclick = () => { state.answer = ''; renderAnswerChoices(); };

// ── 채점 ──────────────────────────────────────────────
$('btn-grade').onclick = async () => {
  const q = state.bank?.[state.no];
  if (!q) return;
  const translation = $('translation').value.trim();
  if (!translation) { flash('해석을 먼저 써라.'); return; }

  const history = attemptsFor(state.records, state.no)
    .map((r) => ({ translation: r.translation, 결과: r.결과, 분류: r.분류 }));

  if (state.mode === 'auto') {
    const btn = $('btn-grade');
    btn.disabled = true;
    btn.textContent = '채점 중…';
    try {
      const res = await fetch('/api/grade', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q, input: { translation, answer: state.answer }, history }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `서버 오류 ${res.status}`);
      const { text: out } = await res.json();
      await record(q, translation, out);
    } catch (ex) {
      flash(`채점 실패: ${ex.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = '채점';
    }
    return;
  }

  // 복사 모드
  const standalone = !state.rulesPasted;
  state.pendingPrompt = buildCopyPrompt(
    q, { translation, answer: state.answer },
    { rules: state.rules, history, standalone },
  );
  await copyToClipboard(state.pendingPrompt);
  $('copy-flow').hidden = false;
  text($('copy-hint'), standalone
    ? '복사했다. Claude 앱에 붙여넣어라 — 채점 규칙까지 같이 들어갔으니 새 대화여도 된다.'
    : '복사했다. 아까 그 대화에 이어서 붙여넣어라.');
  state.rulesPasted = true;
  $('paste').focus();
};

$('btn-copy-again').onclick = () => copyToClipboard(state.pendingPrompt);

$('btn-accept').onclick = async () => {
  const q = state.bank?.[state.no];
  const out = $('paste').value.trim();
  if (!q || !out) { flash('붙여넣은 게 없다.'); return; }
  await record(q, $('translation').value.trim(), out);
  $('copy-flow').hidden = true;
  $('paste').value = '';
};

/** 채점 결과를 파싱해 화면에 띄우고 기록에 남긴다. */
async function record(q, translation, out) {
  const v = parseVerdict(out);
  const quote = v.결정문장 ? verifyQuote(v.결정문장, q.지문) : '해당없음';
  renderVerdict(v, quote);

  // 포맷이 깨진 응답은 통계를 오염시키지 않는다.
  if (!v.ok) return;

  const rec = {
    no: q.no, ts: Date.now(), translation,
    결과: v.결과, 분류: v.분류, 결정문장: v.결정문장, 다음: v.다음, raw: v.raw, 근거: quote,
  };
  await db.addRecord(rec);
  state.records = await db.listRecords();
  await db.delDraft(q.no);
  renderBoard();
}

function renderVerdict(v, quote) {
  if (!v.ok) {
    $('verdict').innerHTML =
      '<div class="verdict broken"><div class="line"><b>포맷이 안 맞아 기록하지 않았다.</b></div>'
      + `<pre>${esc(v.raw)}</pre></div>`;
    return;
  }
  if (v.결과 === NOT_IN_KEY) {
    $('verdict').innerHTML = `<div class="verdict"><div class="line"><b>${NOT_IN_KEY}</b></div></div>`;
    return;
  }

  const badge = quote === '없음'
    ? '<span class="quote-warn">⚠ 지문에 없는 문장</span>'
    : (quote === '확인' ? '<span class="quote-ok">지문 확인됨</span>' : '');

  $('verdict').innerHTML = `
    <div class="verdict ${({ 맞음: 'right', 부분맞음: 'partial', 틀림: 'wrong' })[v.결과] || ''}">
      <div class="line"><span class="k">결과</span><b>${esc(v.결과)}</b>
        <span class="cat cat-${CATEGORIES.indexOf(v.분류)}">${esc(v.분류)}</span></div>
      ${v.오류 ? `<div class="line"><span class="k">오류</span>${esc(v.오류)}</div>` : ''}
      ${v.결정문장 ? `<div class="line quote"><span class="k">결정문장</span>
        <span><em>${esc(v.결정문장)}</em> ${badge}
        ${v.올바른해석 ? `<br>→ ${esc(v.올바른해석)}` : ''}</span></div>` : ''}
      ${v.다음 ? `<div class="line next"><span class="k">다음</span><b>${esc(v.다음)}</b></div>` : ''}
    </div>`;
}

// ── 추가 명령 (API를 타지 않는다) ────────────────────────
$('btn-cmd-word').onclick = () => {
  const q = state.bank?.[state.no];
  if (!q) return;
  const rows = q.어휘.map((v) => {
    const head = v.match(/^([A-Za-z][A-Za-z'’\- ]*)/)?.[1]?.trim() || '';
    const 뜻 = v.slice(head.length).trim();
    const 문장 = head ? findSentence(q.지문, head) : '';
    return `<tr><td><b>${esc(head || v)}</b></td><td>${esc(뜻)}</td><td class="muted small">${esc(문장)}</td></tr>`;
  });
  showPanel(rows.length
    ? `<div class="card"><h3>단어</h3><table class="vocab">
        <thead><tr><th>단어</th><th>뜻</th><th>그 문장</th></tr></thead>
        <tbody>${rows.join('')}</tbody></table>
        <p class="muted small">해설지 [어휘 및 어구]에 실린 것이다.</p></div>`
    : '<div class="card"><h3>단어</h3><p class="muted">이 문항은 해설지에 실린 어휘가 없다.</p></div>');
};

/**
 * 그 낱말이 든 문장을 지문에서 찾는다.
 * 해설지 표제어는 원형이라(`by the skin of one's teeth`) 지문의 활용형
 * (`by the skin of my teeth`)과 통째로는 안 맞는다.
 * 그래서 표제어에서 가장 드문 낱말 하나로 다시 찾아본다.
 */
function findSentence(지문, head) {
  const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hit = (w) => 지문.match(new RegExp(`[^.!?]*\\b${esc(w)}[a-z]*\\b[^.!?]*[.!?]`, 'i'))?.[0]?.trim();

  const whole = hit(head);
  if (whole) return whole;

  const STOP = new Set(['a','an','the','of','in','on','to','for','by','with','one','s','at','as','or','and']);
  const words = head.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !STOP.has(w));
  // 긴 낱말일수록 그 지문에서 드물다
  for (const w of words.sort((a, b) => b.length - a.length)) {
    const found = hit(w);
    if (found) return found;
  }
  return '';
}

function showPanel(html) {
  const panel = $('panel');
  panel.innerHTML = html;
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('btn-cmd-whole').onclick = () => {
  const q = state.bank?.[state.no];
  if (!q) return;
  const a = align(q.지문, q.모범해석, q.유형);
  const given = a.주어진문장
    ? `<p class="given"><span class="k">주어진 문장</span> ${esc(a.주어진문장)}
       <br><span class="muted small">삽입 문항이라 이 문장은 해석에서 끼워 넣어진 자리에 가 있다.</span></p>`
    : '';
  const body = a.mode === '짝'
    ? `<ol class="pairs">${a.pairs.map((p) =>
        `<li><div class="en">${esc(p.en)}</div><div class="ko">${esc(p.ko)}</div></li>`).join('')}</ol>`
    : `<div class="side"><div><h4>원문</h4>${a.en.map((s) => `<p>${esc(s)}</p>`).join('')}</div>
        <div><h4>해석</h4>${a.ko.map((s) => `<p>${esc(s)}</p>`).join('')}</div></div>
        <p class="muted small">문장이 1:1로 안 맞아 전문으로 대조한다.</p>`;
  showPanel(`<div class="card"><h3>통째로</h3>${given}${body}</div>`);
};

// ── 통계 (정리) ────────────────────────────────────────
$('btn-stats').onclick = async () => { await renderStats(); show('stats'); };
$('btn-stats-back').onclick = () => show('main');

async function renderStats() {
  const s = summarize(state.records);
  const box = $('stats-body');

  if (!s.총시도) {
    box.innerHTML = '<div class="card"><p class="muted">아직 채점한 게 없다.</p></div>';
    return;
  }

  const max = Math.max(...Object.values(s.분류별), 1);
  const bars = CATEGORIES.map((c, i) => `
    <div class="bar-row">
      <span class="bar-label">${c}</span>
      <div class="bar-track">${s.분류별[c] ? `<div class="bar cat-${i}" style="inline-size:${(s.분류별[c] / max) * 100}%"></div>` : ''}</div>
      <span class="bar-value">${s.분류별[c]}</span>
    </div>`).join('');

  let tips = '';
  if (s.최다분류) {
    const res = await fetch(`/api/tips/${encodeURIComponent(s.최다분류)}`).catch(() => null);
    const body = res?.ok ? (await res.json()).text : '';
    tips = `<div class="card"><h3>가장 많이 틀린 건 <span class="cat cat-${CATEGORIES.indexOf(s.최다분류)}">${s.최다분류}</span></h3>
      <pre class="tips">${esc(body)}</pre></div>`;
  }

  box.innerHTML = `
    <div class="card">
      <h3>푼 문항 ${s.푼문항.length} / ${LAST - FIRST + 1}</h3>
      <p class="tally">
        <span class="right">맞음 ${s.맞음}</span>
        <span class="partial">부분맞음 ${s.부분맞음}</span>
        <span class="wrong">틀림 ${s.틀림}</span>
      </p>
    </div>
    <div class="card"><h3>분류별 오답</h3>${bars}
      <p class="muted small">맞은 문항은 세지 않는다. 이 집계는 기기에 저장된 기록으로 직접 계산한 것이다.</p>
    </div>
    ${tips}`;
}

// ── 메뉴 ──────────────────────────────────────────────
$('btn-menu').onclick = () => { text($('menu-status'), ''); show('menu'); };
$('btn-menu-back').onclick = () => show('main');

$('btn-export').onclick = async () => {
  const blob = new Blob([await db.exportRecords()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `해석코치-기록-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};

$('import-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const added = await db.importRecords(await file.text());
    state.records = await db.listRecords();
    renderBoard();
    text($('menu-status'), `${added}건 불러왔다.`);
  } catch (ex) {
    text($('menu-status'), `불러오지 못했다: ${ex.message}`);
  }
  e.target.value = '';
});

$('btn-reset-bank').onclick = async () => {
  await db.setBank(null);
  state.bank = null;
  $('pdf-input').value = '';
  $('setup-review').hidden = true;
  show('setup');
};

$('btn-clear').onclick = async () => {
  if (!confirm('채점 기록을 전부 지운다. 되돌릴 수 없다. 계속할까?')) return;
  await db.clearRecords();
  state.records = [];
  renderBoard();
  text($('menu-status'), '기록을 지웠다.');
};

// ── 잡동사니 ───────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function copyToClipboard(s) {
  try {
    await navigator.clipboard.writeText(s);
    flash('복사했다.');
  } catch {
    // 클립보드 권한이 없거나 http로 열었을 때
    const ta = document.createElement('textarea');
    ta.value = s;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    flash(ok ? '복사했다.' : '복사하지 못했다. 아래 칸을 길게 눌러 직접 복사해라.');
    if (!ok) {
      $('panel').innerHTML = `<div class="card"><h3>프롬프트</h3><pre class="prompt-dump">${esc(s)}</pre></div>`;
    }
  }
}

let toastTimer;
function flash(msg) {
  let el = $('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2200);
}

boot();
