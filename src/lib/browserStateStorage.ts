import type { StateStorage } from "zustand/middleware";

const DB_NAME = "gridsheet-local-history";
const STORE_NAME = "state";
const HISTORY_KEY_PREFIX = "history:";

let database: Promise<IDBDatabase> | null = null;
let writes = Promise.resolve();

function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    // Opening without a requested version works with both the original
    // database and newer builds. A version upgrade can be blocked by an older
    // hot-reloaded tab and would otherwise leave app hydration pending forever.
    const request = indexedDB.open(DB_NAME);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error("Unable to open local data storage"));
    request.onblocked = () => reject(new Error("Local data storage is currently in use"));
  });
  return database;
}

function read(db: IDBDatabase, key: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(typeof request.result === "string" ? request.result : null);
    request.onerror = () => reject(request.error);
  });
}

function write(db: IDBDatabase, key: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Unable to save local data"));
  });
}

function remove(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Unable to clear local data"));
  });
}

function legacyValue(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Async browser storage for full workbook history. IndexedDB has materially
 * more space than localStorage and does not throw when a normal workbook is
 * larger than the small synchronous storage quota. The localStorage fallback
 * imports an older small saved dashboard once, then future writes use IndexedDB.
 */
export const browserStateStorage: StateStorage = {
  async getItem(key) {
    if (typeof window === "undefined" || !("indexedDB" in window)) return legacyValue(key);
    try {
      const saved = await read(await openDatabase(), key);
      if (saved !== null) return saved;
      return legacyValue(key);
    } catch {
      return legacyValue(key);
    }
  },

  setItem(key, value) {
    // Zustand does not await state-storage writes. Serializing them ensures a
    // quick dashboard edit cannot overwrite a newer upload snapshot.
    writes = writes.catch(() => undefined).then(async () => {
      if (typeof window !== "undefined" && "indexedDB" in window) {
        try {
          await write(await openDatabase(), key, value);
          try {
            window.localStorage.removeItem(key);
          } catch {
            // The IndexedDB write succeeded; stale legacy state is harmless.
          }
          return;
        } catch {
          // Fall through for privacy modes that disable IndexedDB.
        }
      }
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // Persistence is best-effort when browser storage is entirely disabled.
      }
    });
    return writes;
  },

  removeItem(key) {
    writes = writes.catch(() => undefined).then(async () => {
      if (typeof window !== "undefined" && "indexedDB" in window) {
        try {
          await remove(await openDatabase(), key);
        } catch {
          // Also attempt local cleanup below.
        }
      }
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Nothing else to clear.
      }
    });
    return writes;
  },
};

/** Full workbook snapshots live separately from the lightweight history index. */
export async function saveHistoryRecord(record: { id: string }): Promise<void> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(record, HISTORY_KEY_PREFIX + record.id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Unable to save history"));
  });
}

export async function readHistoryRecord<T>(id: string): Promise<T | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return null;
  const db = await openDatabase();
  return new Promise<T | null>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(HISTORY_KEY_PREFIX + id);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function removeHistoryRecord(id: string): Promise<void> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(HISTORY_KEY_PREFIX + id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Unable to remove history"));
  });
}
