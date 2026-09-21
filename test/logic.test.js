// 순수 로직 단위 테스트.
// ※ 여기 쓰이는 지문은 전부 가짜다. 실제 모의고사 지문은 커밋하지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseVerdict, verifyQuote, lineCount } from '../public/parse.js';
import { summarize, latestByQuestion, attemptsFor } from '../public/stats.js';
import { buildSource, buildInput, buildUserTurn, buildCopyPrompt } from '../public/compose.js';
import { splitChoices, parseAnswerKey, parseSolutions, collectSharedInstructions } from '../public/extract.js';
import { joinLines, detectGutters, stripChrome } from '../public/pdftext.js';

const 문항 = {
  no: 31,
  유형: '빈칸 추론하기',
  발문: '다음 빈칸에 들어갈 말로 가장 적절한 것을 고르시오.',
  지문: 'Cats are ______ and shaped by the house they live in. Even when a cat sleeps all day, it still watches the door.',
  선지: ['① alert', '② lazy', '③ loud', '④ small', '⑤ fast'],
  각주: [],
  정답: '①',
  모범해석: '고양이는 경계심이 많다. 하루 종일 자더라도 문을 지켜본다.',
  어휘: ['alert 경계하는'],
};

const 정상응답 = `[결과]     틀림
[오류]     'alert'를 '게으른'으로 옮김
[분류]     어휘
[결정문장] Cats are alert.
           → 고양이는 경계심이 많다.
[다음]     형용사 뜻 헷갈린 것 10개 정리해라`;

test('parseVerdict: 사양의 5줄 포맷을 필드로 깬다', () => {
  const v = parseVerdict(정상응답);
  assert.equal(v.ok, true);
  assert.equal(v.결과, '틀림');
  assert.equal(v.분류, '어휘');
  assert.equal(v.결정문장, 'Cats are alert.');
  assert.equal(v.올바른해석, '고양이는 경계심이 많다.');
  assert.equal(v.다음, '형용사 뜻 헷갈린 것 10개 정리해라');
});

test('parseVerdict: 해설지에 없는 문항은 한 줄로 끝난다', () => {
  const v = parseVerdict('해설지에 없음');
  assert.equal(v.ok, true);
  assert.equal(v.결과, '해설지에 없음');
});

test('parseVerdict: 포맷이 깨지면 ok=false, 원문은 보존한다', () => {
  const v = parseVerdict('잘 하셨어요! 대체로 맞는 해석입니다 :)');
  assert.equal(v.ok, false);
  assert.equal(v.raw, '잘 하셨어요! 대체로 맞는 해석입니다 :)');
});

test('parseVerdict: 화살표 해석줄이 없어도 나머지는 읽는다', () => {
  const v = parseVerdict('[결과] 맞음\n[오류] 없음\n[분류] 어휘\n[결정문장] Cats are alert.\n[다음] 다음 문항 풀어라');
  assert.equal(v.ok, true);
  assert.equal(v.올바른해석, '');
});

test('verifyQuote: 빈칸을 채워 인용해도 지문에 있는 것으로 본다', () => {
  assert.equal(
    verifyQuote('Cats are alert and shaped by the house they live in.', 문항.지문),
    '확인',
  );
});

test('verifyQuote: 글자까지 똑같으면 당연히 확인', () => {
  assert.equal(verifyQuote('Even when a cat sleeps all day, it still watches the door.', 문항.지문), '확인');
});

test('verifyQuote: 지어낸 문장은 걸러낸다', () => {
  assert.equal(
    verifyQuote('Dogs never sleep during the long winter months of the year.', 문항.지문),
    '없음',
  );
});

test('verifyQuote: 판정하기엔 너무 짧은 인용은 해당없음', () => {
  assert.equal(verifyQuote('Cats are alert.', 문항.지문), '해당없음');
  assert.equal(verifyQuote('Cats', 문항.지문), '해당없음');
});

test('lineCount: 빈 줄은 세지 않는다', () => {
  assert.equal(lineCount(정상응답), 6);
});

test('buildSource: 근거 자료에 지문·정답·모범해석이 모두 들어간다', () => {
  const s = buildSource(문항);
  assert.match(s, /<자료>/);
  assert.match(s, /Cats are ______/);
  assert.match(s, /정답: ①/);
  assert.match(s, /고양이는 경계심이 많다/);
  assert.match(s, /① alert/);
});

test('buildInput: 사양이 정한 입력 형식을 그대로 만든다', () => {
  assert.equal(
    buildInput({ no: 31, translation: '고양이는 게으르다.', answer: '②' }),
    '[문항] 31번\n[내 해석] 고양이는 게으르다.\n[내 답] ②',
  );
});

test('buildInput: 답은 없을 수 있다', () => {
  const s = buildInput({ no: 31, translation: '고양이는 게으르다.' });
  assert.equal(s.includes('[내 답]'), false);
});

test('buildUserTurn: 이전 시도가 있으면 같이 넣는다', () => {
  const turn = buildUserTurn(문항, { translation: '고양이는 경계한다.' }, [
    { translation: '고양이는 게으르다.', 결과: '틀림', 분류: '어휘' },
  ]);
  assert.match(turn, /<이전시도>/);
  assert.match(turn, /1회차 \[틀림\/어휘\]/);
});

test('buildUserTurn: 이전 시도가 없으면 그 블록을 넣지 않는다', () => {
  const turn = buildUserTurn(문항, { translation: '고양이는 경계한다.' });
  assert.equal(turn.includes('<이전시도>'), false);
});

test('buildCopyPrompt: standalone은 규칙까지 붙이고, 아니면 문항만 낸다', () => {
  const rules = '# 역할\n너는 코치다.';
  const withRules = buildCopyPrompt(문항, { translation: 'x' }, { rules, standalone: true });
  const without = buildCopyPrompt(문항, { translation: 'x' }, { rules, standalone: false });
  assert.match(withRules, /# 역할/);
  assert.equal(without.includes('# 역할'), false);
  assert.match(without, /<자료>/);
});

test('summarize: 맞은 문항의 분류는 세지 않는다', () => {
  const s = summarize([
    { no: 18, 결과: '맞음', 분류: '어휘', ts: 1 },
    { no: 19, 결과: '틀림', 분류: '구문', ts: 2 },
    { no: 20, 결과: '틀림', 분류: '구문', ts: 3 },
    { no: 21, 결과: '부분맞음', 분류: '논리', ts: 4 },
  ]);
  assert.equal(s.총시도, 4);
  assert.equal(s.맞음, 1);
  assert.equal(s.분류별.구문, 2);
  assert.equal(s.분류별.어휘, 0, '맞은 문항의 분류는 집계에서 빠져야 한다');
  assert.equal(s.최다분류, '구문');
  assert.deepEqual(s.푼문항, [18, 19, 20, 21]);
});

test('summarize: 해설지에 없는 문항은 통계를 오염시키지 않는다', () => {
  const s = summarize([{ no: 44, 결과: '해설지에 없음', ts: 1 }]);
  assert.equal(s.총시도, 0);
  assert.deepEqual(s.푼문항, []);
});

test('summarize: 기록이 없으면 최다분류는 빈 문자열', () => {
  assert.equal(summarize([]).최다분류, '');
});

test('latestByQuestion: 같은 문항은 최신 기록만 남는다', () => {
  const m = latestByQuestion([
    { no: 31, 결과: '틀림', 분류: '어휘', ts: 1 },
    { no: 31, 결과: '맞음', 분류: '', ts: 2 },
  ]);
  assert.equal(m.get(31).결과, '맞음');
});

test('attemptsFor: 시도를 오래된 순으로 준다', () => {
  const a = attemptsFor([
    { no: 31, ts: 3, translation: 'c' },
    { no: 32, ts: 1, translation: 'x' },
    { no: 31, ts: 1, translation: 'a' },
  ], 31);
  assert.deepEqual(a.map((r) => r.translation), ['a', 'c']);
});

test('splitChoices: 한 줄에 붙은 선지를 다섯 개로 가른다', () => {
  assert.deepEqual(
    splitChoices(['① alert ② lazy', '③ loud ④ small', '⑤ fast']),
    ['① alert', '② lazy', '③ loud', '④ small', '⑤ fast'],
  );
});

test('parseAnswerKey: 정답표를 문항번호별로 읽는다', () => {
  const key = parseAnswerKey([{ text: '31 ① 32 ② 33 ① 34 ② 35 ④' }]);
  assert.equal(key[31], '①');
  assert.equal(key[35], '④');
});

test('parseSolutions: 범위 표기(41~42.)도 한 묶음으로 잡는다', () => {
  const sol = parseSolutions([
    { text: '40. [출제의도] 요약문 완성하기' },
    { text: '[해석] 사십번 해석이다.' },
    { text: '41~42. [출제의도] 글의 제목 파악하기' },
    { text: '[해석] 사십일번 해석이다.' },
  ]);
  assert.equal(sol[40].모범해석, '사십번 해석이다.');
  assert.equal(sol[41].유형, '글의 제목 파악하기');
  assert.equal(sol[42].유형, '글의 제목 파악하기', '범위 표기는 양쪽 문항에 모두 걸린다');
  assert.equal(sol[40].모범해석.includes('사십일번'), false, '다음 문항 해석을 삼키면 안 된다');
});

test('collectSharedInstructions: 묶음 발문을 문항마다 펼친다', () => {
  const shared = collectSharedInstructions([
    { text: '[31~34] 다음 빈칸에 들어갈 말로 가장 적절한 것을 고르시오.' },
  ]);
  assert.equal(shared.get(31), '다음 빈칸에 들어갈 말로 가장 적절한 것을 고르시오.');
  assert.equal(shared.get(34), '다음 빈칸에 들어갈 말로 가장 적절한 것을 고르시오.');
  assert.equal(shared.get(35), undefined);
});

test('joinLines: 한글 줄바꿈은 붙이고 영문은 띄운다', () => {
  assert.equal(joinLines([{ text: '고양이는 경계심이 많' }, { text: '은 동물이다.' }]), '고양이는 경계심이 많은 동물이다.');
  assert.equal(joinLines([{ text: 'Cats are' }, { text: 'alert.' }]), 'Cats are alert.');
});

test('stripChrome: 낱말과 숫자만 있는 머리글을 버린다', () => {
  const kept = stripChrome([
    { text: '영역 고 1' },
    { text: '고 1 영어 영역' },
    { text: '4' },
    { text: 'Cats are alert.' },
  ]);
  assert.deepEqual(kept.map((l) => l.text), ['Cats are alert.']);
});

test('detectGutters: 두 단 사이의 빈 세로띠를 찾는다', () => {
  // 왼쪽 단 0~100, 오른쪽 단 150~250. 사이 100~150은 아무 줄도 지나가지 않는다.
  const page = [];
  for (let y = 0; y < 20; y++) {
    page.push({ s: 'L', x: 0, y: y * 10, w: 100, h: 10 });
    page.push({ s: 'R', x: 150, y: y * 10, w: 100, h: 10 });
  }
  const g = detectGutters([page], 260);
  assert.equal(g.length, 1);
  assert.ok(g[0] > 100 && g[0] < 150, `빈틈이 100~150 사이여야 하는데 ${g[0]}`);
});

// ── align.js ─────────────────────────────────────────────────────────
import { align, splitEnglish, splitKorean } from '../public/align.js';

test('splitEnglish: 약어의 마침표에서 문장을 끊지 않는다', () => {
  assert.deepEqual(
    splitEnglish('Dr. Kim arrived at 9 a.m. She was late.'),
    ['Dr. Kim arrived at 9 a.m. She was late.'],
  );
  assert.deepEqual(splitEnglish('Cats sleep. Dogs run.'), ['Cats sleep.', 'Dogs run.']);
});

test('splitKorean: 문장부호로 나눈다', () => {
  assert.deepEqual(splitKorean('고양이는 잔다. 개는 뛴다.'), ['고양이는 잔다.', '개는 뛴다.']);
});

test('align: 문장 수가 같으면 그대로 짝짓는다', () => {
  const r = align('Cats sleep. Dogs run.', '고양이는 잔다. 개는 뛴다.');
  assert.equal(r.mode, '짝');
  assert.equal(r.pairs.length, 2);
  assert.equal(r.pairs[1].ko, '개는 뛴다.');
});

test('align: 문장 수가 달라도 길이 비례로 짝짓는다', () => {
  // 한국어 쪽이 두 문장으로 쪼개진 경우
  const r = align(
    'Cats are alert animals that watch the door all day long. Dogs run outside.',
    '고양이는 경계심이 많은 동물이다. 하루 종일 문을 지켜본다. 개는 밖에서 뛴다.',
  );
  assert.equal(r.mode, '짝');
  assert.equal(r.pairs.length, 2, '영어 문장 수에 맞춰 묶인다');
  assert.match(r.pairs[0].ko, /경계심/);
  assert.match(r.pairs[1].ko, /개는 밖에서 뛴다/);
});

test('align: 삽입 문항은 주어진 문장을 따로 떼어낸다', () => {
  const r = align(
    'This is the given sentence. Body starts here. ( ① ) More body text follows.',
    '본문이 여기서 시작한다. 더 많은 본문이 이어진다.',
    '문장의 위치 파악하기',
  );
  assert.equal(r.주어진문장, 'This is the given sentence.');
  assert.equal(r.pairs.some((p) => p.en.includes('given sentence')), false);
});

test('align: 한쪽이 비면 전문 대조로 넘긴다', () => {
  assert.equal(align('Cats sleep.', '').mode, '전문');
});

test('align: 영어 한 문장이 한국어 세 문장으로 쪼개져도 따라간다', () => {
  // 실제 해설지가 긴 관계절 문장을 이렇게 쪼갠다. 1:2까지만 허용하면
  // 여기서부터 짝이 한 칸씩 밀린다.
  const r = align(
    'Cats sleep. Even when a cat naps all day, there is still the door, yes, but there is also '
    + 'the person behind the door who will have shaped the cat for the years after that. Dogs run.',
    '고양이는 잔다. 고양이가 하루 종일 낮잠을 자도, 문이 있었다. 그렇다. '
    + '하지만 그 문 뒤에는 이후 몇 년 동안 그 고양이를 만들어 온 사람도 있었다. 개는 뛴다.',
  );
  assert.equal(r.mode, '짝');
  assert.equal(r.pairs.length, 3, '영어 문장 수만큼 짝이 나와야 한다');
  assert.match(r.pairs[0].ko, /^고양이는 잔다/);
  assert.match(r.pairs[1].ko, /그렇다/);
  assert.match(r.pairs[1].ko, /사람도 있었다/, '쪼개진 세 문장이 한 짝으로 묶여야 한다');
  assert.equal(r.pairs[2].ko, '개는 뛴다.');
});

test('align: 짝이 도저히 안 맞으면 전문 대조로 넘긴다', () => {
  // 영어 여덟 문장에 대응하는 한국어가 한 문장뿐이라 길이가 전혀 비례하지 않는다.
  const en = Array.from({ length: 8 }, (_, i) => `The cat number ${i} sleeps on the warm windowsill.`).join(' ');
  const r = align(en, '고양이가 잔다.');
  assert.equal(r.mode, '전문', '어긋난 짝을 보여주느니 전문 대조가 낫다');
});
