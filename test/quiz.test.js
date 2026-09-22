import test from 'node:test';
import assert from 'node:assert/strict';

import { parseItems } from '../public/quizParse.js';
import { buildRound, scoreRound, shuffle } from '../public/quizGen.js';

test('parseItems: 탭 구분', () => {
  const { items } = parseItems('apple\t사과\nbanana\t바나나');
  assert.deepEqual(items, [{ term: 'apple', meaning: '사과' }, { term: 'banana', meaning: '바나나' }]);
});

test('parseItems: 단어 한 칸 + 한글 뜻', () => {
  const { items } = parseItems('give up 포기하다\nby the skin of one\'s teeth 아슬아슬하게');
  assert.deepEqual(items, [
    { term: 'give up', meaning: '포기하다' },
    { term: "by the skin of one's teeth", meaning: '아슬아슬하게' },
  ]);
});

test('parseItems: 여러 칸으로 정렬된 표', () => {
  const { items } = parseItems('apple      사과\nrun        달리다');
  assert.deepEqual(items, [{ term: 'apple', meaning: '사과' }, { term: 'run', meaning: '달리다' }]);
});

test('parseItems: 대시 구분', () => {
  const { items } = parseItems('apple - 사과\nrun - to move fast');
  assert.deepEqual(items, [{ term: 'apple', meaning: '사과' }, { term: 'run', meaning: 'to move fast' }]);
});

test('parseItems: 콜론 구분', () => {
  const { items } = parseItems('apple: 사과');
  assert.deepEqual(items, [{ term: 'apple', meaning: '사과' }]);
});

test('parseItems: 쉼표 구분, 뜻에 쉼표가 더 있어도 통째로 남긴다', () => {
  const { items } = parseItems('apple, 사과, 능금');
  assert.deepEqual(items, [{ term: 'apple', meaning: '사과, 능금' }]);
});

test('parseItems: 번호·기호 접두는 떼고 읽는다', () => {
  const { items } = parseItems('1. apple 사과\n② banana 바나나\n- cherry 체리');
  assert.deepEqual(items, [
    { term: 'apple', meaning: '사과' },
    { term: 'banana', meaning: '바나나' },
    { term: 'cherry', meaning: '체리' },
  ]);
});

test('parseItems: 못 읽은 줄은 skipped로 보고하고 나머지는 건진다', () => {
  const { items, skipped } = parseItems('apple 사과\n이건 그냥 아무 문장이다\nbanana 바나나');
  assert.equal(items.length, 2);
  assert.deepEqual(skipped, ['이건 그냥 아무 문장이다']);
});

test('parseItems: 빈 줄은 무시한다', () => {
  const { items, skipped } = parseItems('apple 사과\n\n\nbanana 바나나\n');
  assert.equal(items.length, 2);
  assert.equal(skipped.length, 0);
});

test('parseItems: 너무 긴 줄(지문이 잘못 들어간 경우)은 건너뛴다', () => {
  const long = 'This is a very long sentence that looks nothing like a vocabulary line at all '.repeat(3) + '이것도 마찬가지';
  const { items, skipped } = parseItems(`apple 사과\n${long}`);
  assert.equal(items.length, 1);
  assert.equal(skipped.length, 1);
});

const bank = [
  { term: 'apple', meaning: '사과' },
  { term: 'banana', meaning: '바나나' },
  { term: 'cherry', meaning: '체리' },
  { term: 'date', meaning: '대추야자' },
  { term: 'egg', meaning: '달걀' },
];

test('buildRound: 항목 수만큼 문제를 만들고, 정답이 선지 안에 있다', () => {
  const round = buildRound(bank, { size: 50, direction: 'term-to-meaning', rng: mulberry32(1) });
  assert.equal(round.length, bank.length); // 50개 요청해도 있는 만큼만
  for (const q of round) {
    assert.equal(q.prompt, q.term);
    assert.ok(q.choices.includes(q.meaning));
    assert.equal(q.choices[q.correctIndex], q.meaning);
    assert.ok(q.choices.length <= 4);
    assert.equal(new Set(q.choices).size, q.choices.length); // 선지 중복 없음
  }
});

test('buildRound: meaning-to-term 방향은 뜻을 묻고 단어를 고른다', () => {
  const round = buildRound(bank, { size: 3, direction: 'meaning-to-term', rng: mulberry32(2) });
  for (const q of round) {
    assert.equal(q.prompt, q.meaning);
    assert.equal(q.choices[q.correctIndex], q.term);
  }
});

test('buildRound: size가 항목 수보다 적으면 그만큼만 뽑는다', () => {
  const round = buildRound(bank, { size: 2, rng: mulberry32(3) });
  assert.equal(round.length, 2);
});

test('buildRound: 항목이 2개 미만이면 에러', () => {
  assert.throws(() => buildRound([{ term: 'a', meaning: 'b' }]));
});

test('scoreRound: 맞은 것과 틀린 것을 센다', () => {
  const round = buildRound(bank, { size: bank.length, rng: mulberry32(4) });
  const answers = round.map((q) => q.correctIndex);
  answers[0] = (answers[0] + 1) % round[0].choices.length; // 첫 문제만 일부러 틀림
  const result = scoreRound(round, answers);
  assert.equal(result.total, bank.length);
  assert.equal(result.correct, bank.length - 1);
  assert.equal(result.wrong, 1);
  assert.equal(result.details[0].isCorrect, false);
});

test('shuffle: 원본을 바꾸지 않고, 같은 요소를 그대로 담는다', () => {
  const a = [1, 2, 3, 4, 5];
  const b = shuffle(a, mulberry32(5));
  assert.notEqual(a, b);
  assert.deepEqual([...b].sort(), a);
});

// 결정적인 테스트를 위한 간단한 시드 난수 생성기.
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
