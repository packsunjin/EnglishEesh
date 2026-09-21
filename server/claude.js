// Claude API 호출. 자동 모드에서만 쓴다.
//
// 지문 전체를 PDF로 매번 올리지 않는다. 해당 문항의 지문·정답·모범해석만
// 뽑아 보내므로 호출당 몇 천 토큰이면 끝나고, 무엇보다 모델이 지문을
// 지어낼 여지가 없다.

import Anthropic from '@anthropic-ai/sdk';
import { buildUserTurn } from '../public/compose.js';

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
