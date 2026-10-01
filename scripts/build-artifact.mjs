#!/usr/bin/env node
// 앱을 두 곳에 올릴 수 있게 조립한다.
//
//   node scripts/build-artifact.mjs
//
//   dist/artifact/  claude.ai 아티팩트에 올릴 묶음 (채점·저장소가 Claude 안에서 돈다)
//   docs/           GitHub Pages 웹사이트 (Claude 밖이라 채점은 복사 방식, 문항은 PDF 한 번 올리기)
//
// artifact/ 에는 앱 전용 파일만 있고, 공통 로직(PDF 읽기·프롬프트·채점 파싱·통계·문장 정렬)은
// public/ 의 것을 그대로 가져다 쓴다. 채점 규칙(rules.js)은 prompts/ 에서 만든다.
// 시험 지문은 어느 묶음에도 들어가지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = ['pdftext.js', 'extract.js', 'compose.js', 'parse.js', 'stats.js', 'align.js'];
const CATEGORIES = ['어휘', '구문', '논리', '지시어', '범위'];

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function rulesModule() {
  const rules = [read('prompts/coach.md'), read('prompts/adapter.md')].join('\n\n');
  const tips = Object.fromEntries(CATEGORIES.map((c) => [c, read(`prompts/tips/${c}.md`).trim()]));
  return '// 생성물 — prompts/ 를 고치고 다시 조립해라.\n'
    + `export const RULES = ${JSON.stringify(rules)};\n`
    + `export const TIPS = ${JSON.stringify(tips)};\n`;
}

function assemble(outRel, { standalone }) {
  const out = path.join(root, outRel);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  for (const f of fs.readdirSync(path.join(root, 'artifact'))) {
    fs.copyFileSync(path.join(root, 'artifact', f), path.join(out, f));
  }
  for (const f of SHARED) {
    fs.copyFileSync(path.join(root, 'public', f), path.join(out, f));
  }
  fs.writeFileSync(path.join(out, 'rules.js'), rulesModule());

  if (standalone) {
    // 아티팩트는 플랫폼이 <head>(문자셋·뷰포트·[hidden] 리셋)를 씌워 준다.
    // 웹사이트로 낼 때는 그걸 직접 씌운다. 안 그러면 한글이 깨질 수 있다.
    const page = read('artifact/index.html');
    fs.writeFileSync(path.join(out, 'index.html'),
      '<!doctype html>\n<html lang="ko">\n<head>\n'
      + '<meta charset="utf-8">\n'
      + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
      + '<style>[hidden]{display:none!important}</style>\n'
      + page
      + '\n</html>\n');
    fs.writeFileSync(path.join(out, '.nojekyll'), '');   // Jekyll 처리 없이 그대로 내보낸다
  }

  console.log(`조립 완료 → ${outRel}/  (${fs.readdirSync(out).length}개 파일)`);
}

assemble('dist/artifact', { standalone: false });
assemble('docs', { standalone: true });
