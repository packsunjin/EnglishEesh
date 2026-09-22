// 문제 생성 요청 조립. 자동 모드 전용이라(복사 모드 없음) 사람이 읽을 포맷을
// 맞출 필요가 없다 — 출력은 tool use(JSON)로 받는다.

/** Claude에게 강제하는 출력 스키마. 서버(claude.js)가 tools로 그대로 보낸다. */
export const QUIZ_TOOL = {
  name: 'submit_quiz',
  description: '학습지 내용을 근거로 만든 4지선다 문제를 제출한다.',
  input_schema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string', description: '문제 지문' },
            choices: {
              type: 'array',
              items: { type: 'string' },
              minItems: 4,
              maxItems: 4,
              description: '선택지 4개, 그중 하나만 정답',
            },
            correctIndex: { type: 'integer', minimum: 0, maximum: 3, description: '정답 인덱스(0~3)' },
            explanation: { type: 'string', description: '학습지의 어느 부분이 근거인지 한 줄' },
          },
          required: ['question', 'choices', 'correctIndex', 'explanation'],
        },
      },
    },
    required: ['questions'],
  },
};

/**
 * 모델에게 보낼 사용자 턴.
 * @param {object} p
 * @param {string} p.name       학습지 이름 (참고용)
 * @param {string} p.sourceText 학습지 원문 텍스트 그대로
 * @param {number} p.count      요청 문항 수 (넘을 수 있고, 분량이 적으면 이보다 적게 와도 된다)
 */
export function buildQuizUserTurn({ name, sourceText, count }) {
  return [
    `학습지 이름: ${name || '(이름 없음)'}`,
    `요청 문항 수: 최대 ${count}개`,
    '',
    '<학습지>',
    sourceText,
    '</학습지>',
  ].join('\n');
}
