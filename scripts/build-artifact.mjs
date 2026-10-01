#!/usr/bin/env node
// claude.ai 아티팩트판을 dist/artifact/ 에 조립한다.
//
//   node scripts/build-artifact.mjs
//
// artifact/ 에는 아티팩트 전용 파일만 있고, 공통 로직(PDF 읽기·프롬프트·채점 파싱·
// 통계·문장 정렬)은 public/ 의 것을 그대로 가져다 쓴다. 채점 규칙(rules.js)은
// prompts/ 에서 만든다. 그래서 같은 코드가 두 벌 생기지 않는다.
//
// 시험 지문은 여기 들어가지 않는다. 문항은 아티팩트의 개인 저장소(db)에 있다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist', 'artifact');
const SHARED = ['pdftext.js', 'extract.js', 'compose.js', 'parse.js', 'stats.js', 'align.js'];
const CATEGORIES = ['어휘', '구문', '논리', '지시어', '범위'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const f of fs.readdirSync(path.join(root, 'artifact'))) {
  fs.copyFileSync(path.join(root, 'artifact', f), path.join(out, f));
}
for (const f of SHARED) {
  fs.copyFileSync(path.join(root, 'public', f), path.join(out, f));
}

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const rules = [read('prompts/coach.md'), read('prompts/adapter.md')].join('\n\n');
const tips = Object.fromEntries(CATEGORIES.map((c) => [c, read(`prompts/tips/${c}.md`).trim()]));
fs.writeFileSync(path.join(out, 'rules.js'),
  '// 생성물 — prompts/ 를 고치고 다시 조립해라.\n'
  + `export const RULES = ${JSON.stringify(rules)};\n`
  + `export const TIPS = ${JSON.stringify(tips)};\n`);

console.log(`조립 완료 → ${path.relative(root, out)}/`);
for (const f of fs.readdirSync(out).sort()) console.log('  ', f);
