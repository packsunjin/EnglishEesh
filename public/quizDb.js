// 단어 시험 전용 브라우저 저장소. 해석 코치의 db.js와 별개 DB를 쓴다
// (문항 은행/채점 기록과 성격이 달라 섞을 이유가 없다).

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

export const addBank = (name, items) => tx('banks', 'readwrite', (s) =>
  s.add({ name, items, createdAt: Date.now() }));

export async function deleteBank(id) {
  await tx('banks', 'readwrite', (s) => s.delete(id));
  const attempts = await listAttempts(id);
  await tx('attempts', 'readwrite', (s) => { for (const a of attempts) s.delete(a.id); });
}

export const listAttempts = (bankId) => tx('attempts', 'readonly', (s) =>
  s.index('bankId').getAll(bankId));

export const addAttempt = (attempt) => tx('attempts', 'readwrite', (s) => s.add(attempt));
