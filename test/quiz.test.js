import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeQuestions } from '../public/quizAI.js';
import { buildQuizUserTurn, QUIZ_TOOL } from '../public/quizCompose.js';

const 정상문항 = {
  question: '다음 중 "alert"의 뜻으로 가장 적절한 것은?',
  choices: ['경계하는', '게으른', '시끄러운', '작은'],
  correctIndex: 0,
  explanation: '학습지 3번째 줄 "alert 경계하는"에 나온다.',
};

test('normalizeQuestions: 정상 문항은 그대로 통과시킨다', () => {
  const out = normalizeQuestions([정상문항]);
  assert.deepEqual(out, [정상문항]);
});

test('normalizeQuestions: 선지가 4개가 아니면 그 문항만 버린다', () => {
  const bad = { ...정상문항, choices: ['경계하는', '게으른', '시끄러운'] };
  const out = normalizeQuestions([정상문항, bad]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], 정상문항);
});

test('normalizeQuestions: correctIndex가 범위 밖이면 버린다', () => {
  const bad = { ...정상문항, correctIndex: 4 };
  const out = normalizeQuestions([정상문항, bad]);
  assert.equal(out.length, 1);
});

test('normalizeQuestions: 빈 선지·빈 질문·빈 설명은 버린다', () => {
  const 빈선지 = { ...정상문항, choices: ['경계하는', '', '시끄러운', '작은'] };
  const 빈질문 = { ...정상문항, question: '   ' };
  const 빈설명 = { ...정상문항, explanation: '' };
  const out = normalizeQuestions([정상문항, 빈선지, 빈질문, 빈설명]);
  assert.equal(out.length, 1);
});

test('normalizeQuestions: 배열이 아니거나 죄다 깨지면 에러', () => {
  assert.throws(() => normalizeQuestions(undefined));
  assert.throws(() => normalizeQuestions([{ question: '', choices: [], correctIndex: -1, explanation: '' }]));
});

test('normalizeQuestions: 앞뒤 공백은 정리한다', () => {
  const messy = { ...정상문항, question: '  질문  ', choices: [' a ', 'b', 'c', 'd'] };
  const out = normalizeQuestions([messy]);
  assert.equal(out[0].question, '질문');
  assert.equal(out[0].choices[0], 'a');
});

test('buildQuizUserTurn: 학습지 원문이 글자 그대로 들어간다', () => {
  const turn = buildQuizUserTurn({ name: '3단원', sourceText: '광합성은 빛에너지를 화학에너지로 바꾼다.', count: 20 });
  assert.match(turn, /<학습지>/);
  assert.match(turn, /광합성은 빛에너지를 화학에너지로 바꾼다\./);
  assert.match(turn, /최대 20개/);
  assert.match(turn, /3단원/);
});

test('QUIZ_TOOL: 스키마가 4지선다를 강제한다', () => {
  const items = QUIZ_TOOL.input_schema.properties.questions.items;
  assert.equal(items.properties.choices.minItems, 4);
  assert.equal(items.properties.choices.maxItems, 4);
  assert.deepEqual(items.required, ['question', 'choices', 'correctIndex', 'explanation']);
});
