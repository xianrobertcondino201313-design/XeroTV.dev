export interface OfflineMovieRecord {
  key: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  overview: string;
  releaseDate: string;
  posterDataUrl: string | null;
  quality: 'standard' | 'hd';
  sizeBytes: number;
  downloadedAtMs: number;
  watched?: boolean;
  watchedAtMs?: number;
  videoBlob: Blob;
}

export type OfflineMovieSummary = Omit<OfflineMovieRecord, 'videoBlob'>;

const DB_NAME = 'xerotv_offline_vault';
const DB_VERSION = 1;
const STORE_NAME = 'movies';

let dbPromise: Promise<IDBDatabase> | null = null;

function openVaultDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error || new Error('Failed to open IndexedDB vault'));
    };
  });
  return dbPromise;
}

async function fetchPosterAsDataUrl(posterPath?: string | null): Promise<string | null> {
  if (!posterPath) return null;
  try {
    const res = await fetch(`https://image.tmdb.org/t/p/w342${posterPath}`, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function listOfflineMovies(): Promise<OfflineMovieSummary[]> {
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      const records = (req.result as OfflineMovieRecord[]) || [];
      const summaries = records
        .map(({ videoBlob: _blob, ...rest }) => rest)
        .sort((a, b) => b.downloadedAtMs - a.downloadedAtMs);
      resolve(summaries);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getVaultTotalBytes(): Promise<number> {
  const items = await listOfflineMovies();
  return items.reduce((sum, item) => sum + (item.sizeBytes || 0), 0);
}

export async function getDeviceStorageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  try {
    const est = await navigator.storage.estimate();
    return {
      usage: est.usage || 0,
      quota: est.quota || 0,
    };
  } catch {
    return null;
  }
}

export async function getOfflineMoviePlayUrl(key: string): Promise<{ record: OfflineMovieSummary; objectUrl: string } | null> {
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => {
      const rec = req.result as OfflineMovieRecord | undefined;
      if (!rec || !rec.videoBlob) {
        resolve(null);
        return;
      }
      const { videoBlob, ...summary } = rec;
      const objectUrl = URL.createObjectURL(videoBlob);
      resolve({ record: summary, objectUrl });
    };
    req.onerror = () => reject(req.error);
  });
}

export async function markOfflineMovieWatched(key: string, watched: boolean = true): Promise<void> {
  const db = await openVaultDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => {
      const rec = req.result as OfflineMovieRecord | undefined;
      if (!rec) {
        resolve();
        return;
      }
      rec.watched = watched;
      rec.watchedAtMs = watched ? Date.now() : undefined;
      store.put(rec);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteOfflineMovie(key: string): Promise<number> {
  const db = await openVaultDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return getVaultTotalBytes();
}

export async function deleteWatchedOfflineMovies(): Promise<{
  removedCount: number;
  remainingBytes: number;
}> {
  const db = await openVaultDb();
  const items = await listOfflineMovies();
  const watchedKeys = items.filter((item) => item.watched).map((item) => item.key);

  if (watchedKeys.length > 0) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const k of watchedKeys) {
        store.delete(k);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  const remainingBytes = await getVaultTotalBytes();
  return { removedCount: watchedKeys.length, remainingBytes };
}

export interface DownloadInfoPayload {
  ok: boolean;
  mirrorIndex: number;
  totalBytes: number;
  contentType: string;
  chunkBytes: number;
  filename: string;
}

export async function probeDownloadInfo(params: {
  tmdbId: number;
  quality: 'standard' | 'hd';
  title: string;
  signal?: AbortSignal;
}): Promise<DownloadInfoPayload> {
  const infoUrl = `/api/download/info?tmdbId=${encodeURIComponent(
    String(params.tmdbId),
  )}&quality=${encodeURIComponent(params.quality)}&title=${encodeURIComponent(params.title)}`;
  const res = await fetch(infoUrl, { signal: params.signal, cache: 'no-store' });
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new Error(errBody?.error || `Download probe failed with status ${res.status}`);
  }
  if (!ct.includes('application/json')) {
    throw new Error('Download service returned an unexpected response.');
  }
  const payload = (await res.json()) as DownloadInfoPayload;
  if (!payload || !payload.ok || !Number.isFinite(payload.totalBytes) || payload.totalBytes <= 0) {
    throw new Error('Download metadata incomplete. Please retry.');
  }
  return payload;
}

async function fetchChunkWithRetry(
  url: string,
  signal?: AbortSignal,
  maxRetries: number = 3,
): Promise<Uint8Array> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (signal?.aborted) {
      throw new DOMException('Download cancelled', 'AbortError');
    }
    try {
      const res = await fetch(url, { signal, cache: 'no-store' });
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (!res.ok && res.status !== 206) {
        throw new Error(`Download failed with status ${res.status}`);
      }
      if (ct.includes('text/html') || ct.includes('application/json')) {
        throw new Error('Stream endpoint returned an error page instead of video data.');
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength === 0) {
        throw new Error('Received empty video chunk.');
      }
      return new Uint8Array(buf);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      lastError = err;
      if (attempt < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Failed to download video chunk.');
}

export async function downloadMovieToVault(params: {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  overview: string;
  releaseDate: string;
  posterPath?: string | null;
  quality: 'standard' | 'hd';
  signal?: AbortSignal;
  onProgress?: (loadedBytes: number, totalBytes: number) => void;
}): Promise<{ summary: OfflineMovieSummary; totalVaultBytes: number }> {
  const key = `${params.mediaType}:${params.tmdbId}`;
  const info = await probeDownloadInfo({
    tmdbId: params.tmdbId,
    quality: params.quality,
    title: params.title,
    signal: params.signal,
  });

  const totalBytes = Math.max(1, info.totalBytes);
  const chunkSize = Math.max(262144, Math.min(info.chunkBytes || 1572864, 1572864));
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  params.onProgress?.(0, totalBytes);

  for (let start = 0; start < totalBytes; start += chunkSize) {
    const end = Math.min(totalBytes - 1, start + chunkSize - 1);
    const chunkUrl = `/api/download/stream?tmdbId=${encodeURIComponent(
      String(params.tmdbId),
    )}&quality=${encodeURIComponent(params.quality)}&title=${encodeURIComponent(
      params.title,
    )}&mirrorIndex=${encodeURIComponent(String(info.mirrorIndex))}&start=${start}&end=${end}`;

    const chunkData = await fetchChunkWithRetry(chunkUrl, params.signal, 3);
    chunks.push(chunkData);
    loaded += chunkData.byteLength;
    params.onProgress?.(Math.min(loaded, totalBytes), totalBytes);
  }

  const videoBlob = new Blob(chunks as BlobPart[], { type: info.contentType || 'video/mp4' });
  const posterDataUrl = await fetchPosterAsDataUrl(params.posterPath);

  const record: OfflineMovieRecord = {
    key,
    tmdbId: params.tmdbId,
    mediaType: params.mediaType,
    title: params.title,
    overview: params.overview,
    releaseDate: params.releaseDate,
    posterDataUrl,
    quality: params.quality,
    sizeBytes: videoBlob.size,
    downloadedAtMs: Date.now(),
    videoBlob,
  };

  const db = await openVaultDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  const totalVaultBytes = await getVaultTotalBytes();
  const { videoBlob: _vb, ...summary } = record;
  return { summary, totalVaultBytes };
}
