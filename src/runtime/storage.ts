/**
 * Where the autosave lives (GDD 12.3): IndexedDB, with localStorage as a fallback for
 * browsers or modes where IndexedDB is unavailable (some private windows).
 *
 * Saves are stored as the JSON text `sim/save.ts` produces. This layer knows nothing
 * about what is inside; it only puts one string somewhere durable and gets it back.
 * Every call resolves rather than throws: a game that cannot save should keep running
 * and say so, not crash.
 */

const DB_NAME = 'factorization';
const STORE = 'saves';
const AUTOSAVE_KEY = 'autosave';
const FALLBACK_KEY = 'factorization.autosave';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('could not open IndexedDB'));
  });
}

function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = body(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error('IndexedDB transaction failed'));
        };
      }),
  );
}

/**
 * Every autosave copy there is: IndexedDB's and localStorage's. There can be two
 * because closing the tab writes a synchronous localStorage copy as well (an IndexedDB
 * write started while the page unloads may not finish). The caller keeps the newer.
 */
export async function readAutosaves(): Promise<string[]> {
  const out: string[] = [];
  try {
    const value = await run<unknown>('readonly', (s) => s.get(AUTOSAVE_KEY));
    if (typeof value === 'string') out.push(value);
  } catch {
    // Unavailable; the fallback may still have one.
  }
  try {
    const value = localStorage.getItem(FALLBACK_KEY);
    if (value) out.push(value);
  } catch {
    // Storage blocked.
  }
  return out;
}

/**
 * A synchronous copy for the moment the page is going away, when an asynchronous
 * write may be cut off. Returns false if it did not fit or storage is blocked.
 */
export function writeAutosaveNow(text: string): boolean {
  try {
    localStorage.setItem(FALLBACK_KEY, text);
    return true;
  } catch {
    return false;
  }
}

/** Writes the autosave. Resolves true if it landed somewhere durable. */
export async function writeAutosave(text: string): Promise<boolean> {
  try {
    await run('readwrite', (s) => s.put(text, AUTOSAVE_KEY));
    return true;
  } catch {
    try {
      localStorage.setItem(FALLBACK_KEY, text);
      return true;
    } catch {
      return false;
    }
  }
}

/** Deletes the autosave everywhere it might be. */
export async function clearAutosave(): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(AUTOSAVE_KEY));
  } catch {
    // Nothing to delete.
  }
  try {
    localStorage.removeItem(FALLBACK_KEY);
  } catch {
    // Storage blocked; nothing to delete.
  }
}
