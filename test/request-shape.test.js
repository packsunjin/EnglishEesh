// 자동 모드가 실제로 어떤 요청을 보내는지 검증한다.
//
// API 키 없이도 돌아간다. 진짜 Anthropic SDK를 쓰되 base URL만 가짜 서버로 돌려서
// **SDK가 직렬화한 실제 본문**을 받아본다. 모델 ID 오타나 캐시 위치 실수,
// Opus 5가 400으로 거절하는 파라미터를 여기서 잡는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const 문항 = {
  no: 31,
  유형: '빈칸 추론하기',
  발문: '다음 빈칸에 들어갈 말로 가장 적절한 것을 고르시오.',
  지문: 'Cats are ______ and watch the door all day.',
  선지: ['① alert', '② lazy', '③ loud', '④ small', '⑤ fast'],
  각주: [],
  정답: '①',
  모범해석: '고양이는 경계심이 많고 하루 종일 문을 지켜본다.',
  어휘: ['alert 경계하는'],
};

const 응답 = {
  id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5',
  content: [{ type: 'text', text: '[결과]     틀림\n[분류]     어휘' }],
  stop_reason: 'end_turn', stop_sequence: null,
  usage: { input_tokens: 1200, output_tokens: 40, cache_creation_input_tokens: 900, cache_read_input_tokens: 0 },
};

const 문제생성응답 = {
  id: 'msg_quiz_test', type: 'message', role: 'assistant', model: 'claude-opus-5',
  content: [{
    type: 'tool_use', id: 'toolu_test', name: 'submit_quiz',
    input: {
      questions: [{
        question: '광합성이 일어나는 세포 소기관은?',
        choices: ['엽록체', '미토콘드리아', '리보솜', '핵'],
        correctIndex: 0,
        explanation: '학습지의 "광합성은 엽록체에서 일어난다" 문장.',
      }],
    },
  }],
  stop_reason: 'tool_use', stop_sequence: null,
  usage: { input_tokens: 800, output_tokens: 120, cache_creation_input_tokens: 500, cache_read_input_tokens: 0 },
};

/**
 * claude.js는 Anthropic 클라이언트를 모듈 안에 캐시한다(요청마다 새로 만들지 않으려고).
 * 그래서 테스트마다 새 가짜 서버를 띄우려면 모듈 자체를 새로 불러와야 한다.
 * ESM 모듈 캐시는 URL로 갈리므로 쿼리를 붙여 우회한다.
 */
let freshCount = 0;
const freshClaude = () => import(`../server/claude.js?t=${++freshCount}`);

async function captureRequest(fn, response = 응답) {
  let captured = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      captured = { path: req.url, headers: req.headers, body: JSON.parse(body) };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(response));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  const prev = { key: process.env.ANTHROPIC_API_KEY, url: process.env.ANTHROPIC_BASE_URL };
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
  try {
    const result = await fn();
    return { captured, result };
  } finally {
    if (prev.key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev.key;
    if (prev.url === undefined) delete process.env.ANTHROPIC_BASE_URL; else process.env.ANTHROPIC_BASE_URL = prev.url;
    server.close();
  }
}

test('grade(): Opus 5에 맞는 요청을 만든다', async () => {
  const rules = '# 역할\n너는 코치다.';
  const { captured, result } = await captureRequest(async () => {
    const { grade } = await freshClaude();
    return grade(rules, 문항, { translation: '고양이는 게으르다.', answer: '②' });
  });

  const b = captured.body;
  assert.equal(captured.path, '/v1/messages');
  assert.equal(b.model, 'claude-opus-5', '모델은 Opus 5로 고정이다');
  assert.equal(b.output_config.effort, 'high');
  assert.ok(b.max_tokens >= 1000);

  // Opus 5가 400으로 거절하는 것들
  assert.equal('budget_tokens' in (b.thinking ?? {}), false, 'budget_tokens는 Opus 5에서 400이다');
  assert.equal(b.temperature, undefined, 'sampling 파라미터는 Opus 5에서 400이다');
  assert.equal(b.top_p, undefined);

  // 캐시는 절대 안 바뀌는 규칙(system)에만 건다
  assert.equal(b.system[0].text, rules);
  assert.deepEqual(b.system[0].cache_control, { type: 'ephemeral', ttl: '1h' });

  // 가변분(문항·해석)은 캐시 뒤 messages에 온다
  assert.equal(b.messages.length, 1);
  assert.equal(b.messages[0].role, 'user');
  const turn = b.messages[0].content;
  assert.match(turn, /<자료>/);
  assert.match(turn, /Cats are ______/);
  assert.match(turn, /정답: ①/);
  assert.match(turn, /\[문항\] 31번/);
  assert.match(turn, /\[내 답\] ②/);
  assert.equal(turn.includes('# 역할'), false, '규칙은 system에만 있어야 캐시가 붙는다');

  // 응답 파싱
  assert.match(result.text, /^\[결과\]/);
  assert.equal(result.usage.input_tokens, 1200);
});

test('grade(): 이전 시도가 있으면 사용자 턴에 실린다', async () => {
  const { captured } = await captureRequest(async () => {
    const { grade } = await freshClaude();
    return grade('규칙', 문항, { translation: '고양이는 경계한다.' },
      [{ translation: '고양이는 게으르다.', 결과: '틀림', 분류: '어휘' }]);
  });
  assert.match(captured.body.messages[0].content, /<이전시도>/);
  assert.match(captured.body.messages[0].content, /1회차 \[틀림\/어휘\]/);
});

test('grade(): 캐시 프리픽스는 문항이 바뀌어도 그대로다', async () => {
  const rules = '# 역할\n너는 코치다.';
  const a = await captureRequest(async () => {
    const { grade } = await freshClaude();
    return grade(rules, 문항, { translation: 'ㄱ' });
  });
  const b = await captureRequest(async () => {
    const { grade } = await freshClaude();
    return grade(rules, { ...문항, no: 32 }, { translation: 'ㄴ' });
  });
  assert.deepEqual(a.captured.body.system, b.captured.body.system,
    'system이 호출마다 달라지면 캐시가 매번 깨진다');
});

test('generateQuiz(): tool use로 강제하고, 학습지 원문을 그대로 보낸다', async () => {
  const rules = '# 역할\n너는 출제자다.';
  const { captured, result } = await captureRequest(async () => {
    const { generateQuiz } = await freshClaude();
    return generateQuiz(rules, { name: '3단원', sourceText: '광합성은 엽록체에서 일어난다.', count: 30 });
  }, 문제생성응답);

  const b = captured.body;
  assert.equal(b.model, 'claude-opus-5');
  assert.equal(b.output_config.effort, 'high');

  // Opus 5가 400으로 거절하는 것들
  assert.equal('budget_tokens' in (b.thinking ?? {}), false);
  assert.equal(b.temperature, undefined);
  assert.equal(b.top_p, undefined);

  // 출력은 tool use로 강제한다 — 사람이 읽을 포맷을 파싱하지 않는다
  assert.equal(b.tools[0].name, 'submit_quiz');
  assert.deepEqual(b.tool_choice, { type: 'tool', name: 'submit_quiz' });

  // 규칙은 캐시 붙는 system에, 학습지 원문은 messages에
  assert.equal(b.system[0].text, rules);
  assert.deepEqual(b.system[0].cache_control, { type: 'ephemeral', ttl: '1h' });
  assert.match(b.messages[0].content, /<학습지>/);
  assert.match(b.messages[0].content, /광합성은 엽록체에서 일어난다\./);
  assert.match(b.messages[0].content, /최대 30개/);

  // tool_use 응답이 정제된 문제 배열로 나온다
  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0].correctIndex, 0);
  assert.equal(result.usage.input_tokens, 800);
});
