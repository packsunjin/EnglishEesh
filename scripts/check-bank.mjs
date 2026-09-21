#!/usr/bin/env node
// 추출 품질 전수 점검. 여기가 틀리면 채점이 전부 틀린다.
//   node scripts/check-bank.mjs data/eng_1_mun.pdf data/eng_1_hsj.pdf
//   node scripts/check-bank.mjs data/*.pdf --dump 31
import { readPdf } from './pdf-node.mjs';
import { buildBank, identifyPdfs, FIRST, LAST } from '../public/extract.js';

const args = process.argv.slice(2);
const dumpAt = args.indexOf('--dump');
const dump = dumpAt >= 0 ? Number(args[dumpAt + 1]) : null;
const pdfs = args.filter((a) => a.endsWith('.pdf'));

if (pdfs.length < 2) {
  console.error('사용법: node scripts/check-bank.mjs <문제지.pdf> <해설지.pdf> [--dump 31]');
  process.exit(2);
}

const [a, b] = await Promise.all([readPdf(pdfs[0]), readPdf(pdfs[1])]);
const { exam, solution } = identifyPdfs(a, b);   // 고른 순서와 무관하게 내용으로 가린다
const { bank, warnings } = buildBank(exam, solution);

const pad = (s, n) => String(s).padEnd(n);

if (dump) {
  const q = bank[dump];
  if (!q) { console.error(`${dump}번 없음`); process.exitCode = 1; }
  else console.log(JSON.stringify(q, null, 2));
} else {
  console.log(pad('번호', 5), pad('유형', 22), pad('정답', 5), pad('지문', 7), pad('선지', 6), pad('해석', 7), '어휘');
  console.log('-'.repeat(74));

  let bad = 0;
  for (let n = FIRST; n <= LAST; n++) {
    const q = bank[n];
    if (!q) { console.log(pad(n, 5), '없음'); bad++; continue; }

    // 도표·어법·어휘·무관·위치 문항은 ①~⑤가 지문 안에 있어 떼어낼 선지가 없다.
    const 선지ok = q.선지내장 ? q.선지.length === 0 : q.선지.length === 5;
    const ok = q.지문.length >= 80 && 선지ok && q.정답 && q.모범해석 && q.유형;
    if (!ok) bad++;

    console.log(
      pad(n, 5), pad(q.유형 || '?', 22), pad(q.정답 || '?', 5),
      pad(q.지문.length, 7), pad(q.선지내장 ? '내장' : q.선지.length, 6),
      pad(q.모범해석.length, 7), q.어휘.length, ok ? '' : '  ← 확인필요',
    );
  }

  console.log('-'.repeat(74));
  if (warnings.length) {
    console.log('\n경고:');
    for (const w of warnings) console.log('  ·', w);
  }
  console.log(`\n${LAST - FIRST + 1}문항 중 ${bad}건 확인필요`);
  process.exitCode = bad ? 1 : 0;
}
