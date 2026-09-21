#!/usr/bin/env node
// 자동 모드 실제 호출 점검. **진짜 돈이 나간다** (호출 2번, 몇 센트).
//
//   ANTHROPIC_API_KEY=sk-... node scripts/smoke.mjs data/eng_1_mun.pdf data/eng_1_hsj.pdf 31
//
// 확인하는 것
//   · 사양의 5줄 포맷을 지키는가, 10줄을 넘지 않는가
//   · 칭찬·서론 없이 바로 결론부터 나오는가
//   · [결정문장]이 진짜 지문에 있는 문장인가
//   · 두 번째 호출에서 프롬프트 캐시가 붙는가
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readPdf } from './pdf-node.mjs';
import { buildBank, identifyPdfs } from '../public/extract.js';
import { grade, hasApiKey } from '../server/claude.js';
import { parseVerdict, verifyQuote, lineCount } from '../public/parse.js';

if (!hasApiKey()) {
  console.error('ANTHROPIC_API_KEY가 없다. 이 점검은 실제 API를 부른다.');
  console.error('키 없이 요청 형태만 보려면: npm test');
  process.exit(2);
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const pdfs = args.filter((a) => a.endsWith('.pdf'));
const no = Number(args.find((a) => /^\d+$/.test(a)) || 31);

if (pdfs.length < 2) {
  console.error('사용법: node scripts/smoke.mjs <문제지.pdf> <해설지.pdf> [문항번호]');
  process.exit(2);
}

const rules = [
  await fs.readFile(path.join(root, 'prompts/coach.md'), 'utf8'),
  await fs.readFile(path.join(root, 'prompts/adapter.md'), 'utf8'),
].join('\n\n');

const [a, b] = await Promise.all(pdfs.map(readPdf));
const { exam, solution } = identifyPdfs(a, b);
const { bank } = buildBank(exam, solution);
const q = bank[no];
if (!q) { console.error(`${no}번이 은행에 없다.`); process.exit(1); }

// 일부러 엉뚱한 해석을 준다. 어느 문항이든 틀린 해석이라, 채점이 실제로
// 잡아내는지(그리고 [결정문장]을 지문에서 제대로 가져오는지) 볼 수 있다.
const 틀린해석 = '이 글은 그냥 일상적인 이야기를 늘어놓은 것이고, 특별한 주장은 없다. '
  + '글쓴이는 모든 것이 타고난 것이라고 말한다.';

function 검사(label, { text, usage }) {
  const v = parseVerdict(text);
  const 줄 = lineCount(text);
  const 인용 = v.결정문장 ? verifyQuote(v.결정문장, q.지문) : '해당없음';

  console.log(`\n── ${label} ────────────────────────`);
  console.log(text);
  console.log('──────────────────────────────');
  const chk = (ok, msg) => console.log(`  ${ok ? '✓' : '✗'} ${msg}`);
  chk(v.ok, `포맷 파싱 ${v.ok ? '성공' : '실패'}`);
  chk(줄 <= 10, `${줄}줄 (사양: 10줄 이내)`);
  chk(v.결과 !== '맞음', `결과=${v.결과} (일부러 틀린 해석을 줬다)`);
  chk(['어휘', '구문', '논리', '지시어', '범위'].includes(v.분류), `분류=${v.분류}`);
  chk(인용 !== '없음', `결정문장 지문 대조: ${인용}`);
  chk(Boolean(v.다음), `다음 행동: ${v.다음 || '(없음)'}`);
  console.log(`  토큰 in=${usage.input_tokens} cache_write=${usage.cache_creation_input_tokens ?? 0} `
    + `cache_read=${usage.cache_read_input_tokens ?? 0} out=${usage.output_tokens}`);
  return { v, usage };
}

console.log(`${no}번 (${q.유형}) 으로 점검한다.`);

const 첫번째 = 검사('1회차', await grade(rules, q, { translation: 틀린해석, answer: '⑤' }));
const 두번째 = 검사('2회차 (캐시 확인)', await grade(rules, q, { translation: 틀린해석, answer: '⑤' }));

const cached = (두번째.usage.cache_read_input_tokens ?? 0) > 0;
console.log(`\n${cached ? '✓' : '✗'} 프롬프트 캐시 ${cached ? '적중' : '미적중 — system 프리픽스에 가변값이 섞였는지 봐라'}`);

// 실측값을 README에 적어두면 비용 감이 잡힌다
const 총in = 첫번째.usage.input_tokens + 두번째.usage.input_tokens;
console.log(`\n이번 점검 2회 호출 합계: 입력 ${총in} + 캐시쓰기 ${첫번째.usage.cache_creation_input_tokens ?? 0}`
  + ` + 캐시읽기 ${두번째.usage.cache_read_input_tokens ?? 0} 토큰`);
