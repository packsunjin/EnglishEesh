// 정적 파일 + 얇은 API.
//
// 서버는 저작물을 저장하지 않는다. 문항 데이터는 브라우저(IndexedDB)에 있고,
// 채점할 때 한 건만 잠깐 거쳐 간다. 서버가 들고 있는 비밀은 API 키뿐이다.

import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { grade, hasApiKey } from './claude.js';
import { CATEGORIES } from '../public/compose.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const app = express();

app.use(express.json({ limit: '2mb' }));

// 채점 규칙: 사양 원본 + 자료 전달 방식 어댑터.
// coach.md는 사용자가 쓴 사양 그대로이고 손대지 않는다. PDF 첨부 대신
// 지문을 직접 넣는다는 사실만 adapter.md가 덧붙인다.
const rules = [
  await fs.readFile(path.join(root, 'prompts/coach.md'), 'utf8'),
  await fs.readFile(path.join(root, 'prompts/adapter.md'), 'utf8'),
].join('\n\n');

const PASSWORD = process.env.APP_PASSWORD || '';
const sessions = new Set();

function authed(req) {
  if (!PASSWORD) return true;
  const token = (req.headers.cookie || '')
    .split(';').map((s) => s.trim())
    .find((s) => s.startsWith('sid='))?.slice(4);
  return Boolean(token && sessions.has(token));
}

function requireAuth(req, res, next) {
  if (authed(req)) return next();
  res.status(401).json({ error: '로그인이 필요하다.' });
}

app.get('/api/status', (req, res) => {
  const ok = authed(req);
  res.json({
    mode: hasApiKey() ? 'auto' : 'copy',
    needsPassword: Boolean(PASSWORD),
    authed: ok,
    // 복사 모드에서 붙여넣을 규칙 전문. 로그인 전에는 주지 않는다.
    rules: ok ? rules : '',
  });
});

app.post('/api/login', (req, res) => {
  if (!PASSWORD) return res.json({ mode: hasApiKey() ? 'auto' : 'copy', authed: true, rules });
  const given = String(req.body?.password ?? '');
  // 길이가 달라도 타이밍이 새지 않도록 해시를 비교한다.
  const h = (s) => crypto.createHash('sha256').update(s).digest();
  if (!crypto.timingSafeEqual(h(given), h(PASSWORD))) {
    return res.status(401).json({ error: '비밀번호가 틀렸다.' });
  }
  const sid = crypto.randomUUID();
  sessions.add(sid);
  res.setHeader('Set-Cookie',
    `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${process.env.RENDER ? '; Secure' : ''}`);
  res.json({ mode: hasApiKey() ? 'auto' : 'copy', authed: true, rules });
});

app.post('/api/grade', requireAuth, async (req, res) => {
  if (!hasApiKey()) return res.status(400).json({ error: 'API 키가 없다. 복사 모드로 써라.' });

  const { q, input, history } = req.body ?? {};
  if (!q?.no || !q?.지문) return res.status(400).json({ error: '문항 자료가 없다.' });
  if (!input?.translation?.trim()) return res.status(400).json({ error: '해석이 비었다.' });

  try {
    const { text, usage } = await grade(rules, q, input, history || []);
    // 캐시가 붙는지 보려면 로그를 봐라. 두 번째 호출부터 cache_read가 0이 아니어야 한다.
    console.log(
      `[채점] ${q.no}번 in=${usage.input_tokens} `
      + `cache_write=${usage.cache_creation_input_tokens ?? 0} `
      + `cache_read=${usage.cache_read_input_tokens ?? 0} out=${usage.output_tokens}`,
    );
    res.json({ text });
  } catch (err) {
    console.error('[채점 실패]', err.message);
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/tips/:category', requireAuth, async (req, res) => {
  const category = req.params.category;
  if (!CATEGORIES.includes(category)) return res.status(404).json({ error: '없는 분류다.' });
  const text = await fs.readFile(path.join(root, 'prompts/tips', `${category}.md`), 'utf8');
  res.json({ text: text.trim() });
});

// pdf.js는 브라우저에서 돌린다. 레포에 1.7MB를 넣지 않으려고 node_modules에서 그대로 낸다.
app.use('/vendor', express.static(path.join(root, 'node_modules/pdfjs-dist/build')));
app.use(express.static(path.join(root, 'public')));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`영어 해석 코치 → http://localhost:${port}`);
  console.log(hasApiKey()
    ? '  모드: 자동 채점 (ANTHROPIC_API_KEY 있음)'
    : '  모드: 복사 (ANTHROPIC_API_KEY 없음 — 프롬프트를 만들어 주고 결과를 받아 적는다)');
  if (!PASSWORD) console.log('  APP_PASSWORD가 없다. 배포한다면 꼭 설정해라.');
});
