// 브라우저 저장소. 문항 은행과 채점 기록은 이 기기에만 남는다.
//
// 저작권 있는 지문이 서버 디스크에 남지 않게 하려는 설계이기도 하다.
// 서버는 채점 한 건을 잠깐 거칠 뿐 아무것도 저장하지 않는다.

const NAME = 'englisheesh';
const VERSION = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('records')) {
        db.createObjectStore('records', { keyPath: 'id', autoIncrement: true })
          .createIndex('no', 'no');
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

export const getKV = (key) => tx('kv', 'readonly', (s) => s.get(key));
export const setKV = (key, value) => tx('kv', 'readwrite', (s) => s.put(value, key));
export const delKV = (key) => tx('kv', 'readwrite', (s) => s.delete(key));

export const getBank = () => getKV('bank');
export const setBank = (bank) => setKV('bank', bank);

export const listRecords = () => tx('records', 'readonly', (s) => s.getAll());
export const addRecord = (rec) => tx('records', 'readwrite', (s) => s.add(rec));
export const clearRecords = () => tx('records', 'readwrite', (s) => s.clear());

/** 타이핑 중인 해석 초안. 실수로 새로고침해도 안 날아가게. */
export const getDraft = (no) => getKV(`draft:${no}`);
export const setDraft = (no, text) => setKV(`draft:${no}`, text);
export const delDraft = (no) => delKV(`draft:${no}`);

/** 기록 내보내기 — 폰과 PC를 오갈 때 쓰는 유일한 수단. */
export async function exportRecords() {
  const records = await listRecords();
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), records }, null, 2);
}

/** 기록 불러오기. 같은 시각·같은 문항의 중복은 건너뛴다. */
export async function importRecords(json) {
  const data = JSON.parse(json);
  if (!Array.isArray(data?.records)) throw new Error('기록 파일 형식이 아니다.');
  const existing = await listRecords();
  const seen = new Set(existing.map((r) => `${r.no}|${r.ts}`));
  let added = 0;
  for (const r of data.records) {
    const key = `${r.no}|${r.ts}`;
    if (seen.has(key)) continue;
    const { id, ...rest } = r;
    await addRecord(rest);
    seen.add(key);
    added++;
  }
  return added;
}
