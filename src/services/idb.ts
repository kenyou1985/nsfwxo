/**
 * IndexedDB wrapper — provides a promise-based, synchronous-style API
 * for storing large binary data (images) without localStorage's 5MB ceiling.
 *
 * Usage:
 *   const db = await openDB('nsfwxo_img', 1, (db) => {
 *     db.createObjectStore('images', { keyPath: 'key' });
 *   });
 *   await db.put('images', { key: 'abc123', dataUrl: '...' });
 *   const entry = await db.get('images', 'abc123');
 *   await db.delete('images', 'abc123');
 */

const DB_CACHE: Record<string, IDBDatabase> = {};

function dbName(name: string, ver: number): string {
  return `${name}_v${ver}`;
}

export function openDB(
  name: string,
  version: number,
  upgrade?: (db: IDBDatabase) => void,
): Promise<IDBDatabase> {
  const key = dbName(name, version);
  if (DB_CACHE[key]) return Promise.resolve(DB_CACHE[key]);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = (e) => {
      try {
        upgrade?.(req.result);
      } catch (err) {
        console.error('[IndexedDB] upgrade error:', err);
      }
    };
    req.onsuccess = () => {
      DB_CACHE[key] = req.result;
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet(
  db: IDBDatabase,
  storeName: string,
  key: string,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGetAll(
  db: IDBDatabase,
  storeName: string,
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbPut(
  db: IDBDatabase,
  storeName: string,
  value: unknown,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function idbDelete(
  db: IDBDatabase,
  storeName: string,
  key: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function idbClear(
  db: IDBDatabase,
  storeName: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function idbCount(
  db: IDBDatabase,
  storeName: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
