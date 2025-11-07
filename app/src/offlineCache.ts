// IndexedDB cache for offline support
const DB_NAME = 'github-review-cache';
const DB_VERSION = 1;
const CACHE_EXPIRY_DAYS = 7;

interface CachedFileContent {
  owner: string;
  repo: string;
  prNumber: number;
  filePath: string;
  headSha: string;
  baseSha: string;
  headContent: string | null;
  baseContent: string | null;
  cachedAt: number;
}

interface CachedPRDetail {
  owner: string;
  repo: string;
  prNumber: number;
  data: string; // JSON stringified PR detail
  cachedAt: number;
}

let dbInstance: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Store for file contents
      if (!db.objectStoreNames.contains('fileContents')) {
        const fileStore = db.createObjectStore('fileContents', { keyPath: ['owner', 'repo', 'prNumber', 'filePath'] });
        fileStore.createIndex('cachedAt', 'cachedAt', { unique: false });
        fileStore.createIndex('pr', ['owner', 'repo', 'prNumber'], { unique: false });
      }

      // Store for PR details
      if (!db.objectStoreNames.contains('prDetails')) {
        const prStore = db.createObjectStore('prDetails', { keyPath: ['owner', 'repo', 'prNumber'] });
        prStore.createIndex('cachedAt', 'cachedAt', { unique: false });
      }
    };
  });
}

export async function cacheFileContent(
  owner: string,
  repo: string,
  prNumber: number,
  filePath: string,
  headSha: string,
  baseSha: string,
  headContent: string | null,
  baseContent: string | null
): Promise<void> {
  const db = await openDB();
  const transaction = db.transaction(['fileContents'], 'readwrite');
  const store = transaction.objectStore('fileContents');

  const data: CachedFileContent = {
    owner,
    repo,
    prNumber,
    filePath,
    headSha,
    baseSha,
    headContent,
    baseContent,
    cachedAt: Date.now(),
  };

  return new Promise((resolve, reject) => {
    const request = store.put(data);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getCachedFileContent(
  owner: string,
  repo: string,
  prNumber: number,
  filePath: string,
  headSha: string,
  baseSha: string
): Promise<{ headContent: string | null; baseContent: string | null } | null> {
  const db = await openDB();
  const transaction = db.transaction(['fileContents'], 'readonly');
  const store = transaction.objectStore('fileContents');

  return new Promise((resolve, reject) => {
    const request = store.get([owner, repo, prNumber, filePath]);
    request.onsuccess = () => {
      const result = request.result as CachedFileContent | undefined;
      if (!result) {
        resolve(null);
        return;
      }

      // Verify SHA matches (content validity)
      if (result.headSha !== headSha || result.baseSha !== baseSha) {
        resolve(null);
        return;
      }

      // Check if expired
      const age = Date.now() - result.cachedAt;
      const maxAge = CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
      if (age > maxAge) {
        resolve(null);
        return;
      }

      resolve({
        headContent: result.headContent,
        baseContent: result.baseContent,
      });
    };
    request.onerror = () => reject(request.error);
  });
}

export async function cachePRDetail(
  owner: string,
  repo: string,
  prNumber: number,
  data: any
): Promise<void> {
  const db = await openDB();
  const transaction = db.transaction(['prDetails'], 'readwrite');
  const store = transaction.objectStore('prDetails');

  const cached: CachedPRDetail = {
    owner,
    repo,
    prNumber,
    data: JSON.stringify(data),
    cachedAt: Date.now(),
  };

  return new Promise((resolve, reject) => {
    const request = store.put(cached);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getCachedPRDetail(
  owner: string,
  repo: string,
  prNumber: number
): Promise<any | null> {
  const db = await openDB();
  const transaction = db.transaction(['prDetails'], 'readonly');
  const store = transaction.objectStore('prDetails');

  return new Promise((resolve, reject) => {
    const request = store.get([owner, repo, prNumber]);
    request.onsuccess = () => {
      const result = request.result as CachedPRDetail | undefined;
      if (!result) {
        resolve(null);
        return;
      }

      // Check if expired
      const age = Date.now() - result.cachedAt;
      const maxAge = CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
      if (age > maxAge) {
        resolve(null);
        return;
      }

      try {
        resolve(JSON.parse(result.data));
      } catch {
        resolve(null);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export async function cleanExpiredCache(): Promise<void> {
  const db = await openDB();
  const expiryTime = Date.now() - (CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  // Clean file contents
  const fileTransaction = db.transaction(['fileContents'], 'readwrite');
  const fileStore = fileTransaction.objectStore('fileContents');
  const fileIndex = fileStore.index('cachedAt');
  const fileRange = IDBKeyRange.upperBound(expiryTime);

  return new Promise((resolve, reject) => {
    const fileRequest = fileIndex.openCursor(fileRange);
    fileRequest.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    fileRequest.onerror = () => reject(fileRequest.error);

    fileTransaction.oncomplete = () => {
      // Clean PR details
      const prTransaction = db.transaction(['prDetails'], 'readwrite');
      const prStore = prTransaction.objectStore('prDetails');
      const prIndex = prStore.index('cachedAt');
      const prRange = IDBKeyRange.upperBound(expiryTime);

      const prRequest = prIndex.openCursor(prRange);
      prRequest.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      prRequest.onerror = () => reject(prRequest.error);

      prTransaction.oncomplete = () => resolve();
    };
  });
}

export async function clearPRCache(owner: string, repo: string, prNumber: number): Promise<void> {
  const db = await openDB();
  
  // Clear file contents for this PR
  const fileTransaction = db.transaction(['fileContents'], 'readwrite');
  const fileStore = fileTransaction.objectStore('fileContents');
  const fileIndex = fileStore.index('pr');
  
  return new Promise((resolve, reject) => {
    const fileRequest = fileIndex.openCursor(IDBKeyRange.only([owner, repo, prNumber]));
    fileRequest.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    fileRequest.onerror = () => reject(fileRequest.error);

    fileTransaction.oncomplete = () => {
      // Clear PR detail
      const prTransaction = db.transaction(['prDetails'], 'readwrite');
      const prStore = prTransaction.objectStore('prDetails');
      const prRequest = prStore.delete([owner, repo, prNumber]);
      
      prRequest.onsuccess = () => resolve();
      prRequest.onerror = () => reject(prRequest.error);
    };
  });
}

// Run cleanup on startup
if (typeof window !== 'undefined') {
  cleanExpiredCache().catch((error) => {
    console.error('Failed to clean expired cache:', error);
  });
}
