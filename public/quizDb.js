// 단어 시험 전용 브라우저 저장소. 해석 코치의 db.js와 별개 DB를 쓴다
// (문항 은행/채점 기록과 성격이 달라 섞을 이유가 없다).
//
// bank는 학습지 원문(sourceText)과 마지막으로 AI가 만든 문제 세트(questions)를 같이 든다.
// 문제는 서버(AI) 호출 없이는 새로 못 만들므로, 한 번 만든 세트를 저장해 뒀다가
// 재시험은 공짜로(API 재호출 없이) 볼 수 있게 한다.

const NAME = 'englisheesh-quiz';
const VERSION = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('banks')) {
        db.createObjectStore('banks', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('attempts')) {
        db.createObjectStore('attempts', { keyPath: 'id', autoIncrement: true })
          .createIndex('bankId', 'bankId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const listBanks = () => tx('banks', 'readonly', (s) => s.getAll());
export const getBank = (id) => tx('banks', 'readonly', (s) => s.get(id));

export const addBank = (name, sourceText, questions) => tx('banks', 'readwrite', (s) =>
  s.add({ name, sourceText, questions, createdAt: Date.now() }));

export async function setQuestions(id, questions) {
  const bank = await getBank(id);
  if (!bank) return;
  await tx('banks', 'readwrite', (s) => s.put({ ...bank, questions }));
}

export async function deleteBank(id) {
  await tx('banks', 'readwrite', (s) => s.delete(id));
  const attempts = await listAttempts(id);
  await tx('attempts', 'readwrite', (s) => { for (const a of attempts) s.delete(a.id); });
}

export const listAttempts = (bankId) => tx('attempts', 'readonly', (s) =>
  s.index('bankId').getAll(bankId));

export const addAttempt = (attempt) => tx('attempts', 'readwrite', (s) => s.add(attempt));
