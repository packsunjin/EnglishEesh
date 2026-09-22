// Claude API 호출. 자동 모드에서만 쓴다.
//
// 지문 전체를 PDF로 매번 올리지 않는다. 해당 문항의 지문·정답·모범해석만
// 뽑아 보내므로 호출당 몇 천 토큰이면 끝나고, 무엇보다 모델이 지문을
// 지어낼 여지가 없다.

import Anthropic from '@anthropic-ai/sdk';
import { buildUserTurn } from '../public/compose.js';
import { buildQuizUserTurn, QUIZ_TOOL } from '../public/quizCompose.js';
import { normalizeQuestions } from '../public/quizAI.js';

const MODEL = 'claude-opus-5';

let client = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

export const hasApiKey = () =>
  Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

/**
 * 한 문항을 채점한다.
 * @param {string} rules   coach.md + adapter.md 합본 (시스템 프롬프트)
 * @param {object} q       문항 은행 항목
 * @param {object} input   { translation, answer }
 * @param {Array}  history 같은 문항의 이전 시도
 * @returns {{text: string, usage: object}}
 */
export async function grade(rules, q, input, history = []) {
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: 'high' },
    // thinking은 생략한다 — Opus 5는 생략하면 adaptive가 기본이다.
    // budget_tokens를 보내면 400이 떨어진다.
    system: [
      // 규칙은 절대 안 바뀌므로 프리픽스가 안정적이다. 두 번째 호출부터 캐시가 붙는다.
      { type: 'text', text: rules, cache_control: { type: 'ephemeral', ttl: '1h' } },
    ],
    messages: [{ role: 'user', content: buildUserTurn(q, input, history) }],
  });

  const text = res.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  return { text, usage: res.usage };
}

/**
 * 학습지 원문으로 4지선다 문제를 만든다. 텍스트 파싱이 아니라 tool use(JSON)로 받는다 —
 * 복사 모드가 없는 기능이라 사람이 읽을 포맷을 맞출 이유가 없고, 파싱 실패 위험도 없앤다.
 * @param {string} rules   prompts/quiz.md
 * @param {object} p       { name, sourceText, count }
 * @returns {{questions: object[], usage: object}}
 */
export async function generateQuiz(rules, { name, sourceText, count }) {
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: Math.min(4000 + count * 300, 32000),
    output_config: { effort: 'high' },
    system: [
      { type: 'text', text: rules, cache_control: { type: 'ephemeral', ttl: '1h' } },
    ],
    tools: [QUIZ_TOOL],
    tool_choice: { type: 'tool', name: QUIZ_TOOL.name },
    messages: [{ role: 'user', content: buildQuizUserTurn({ name, sourceText, count }) }],
  });

  const call = res.content.find((b) => b.type === 'tool_use' && b.name === QUIZ_TOOL.name);
  const questions = normalizeQuestions(call?.input?.questions);

  return { questions, usage: res.usage };
}
