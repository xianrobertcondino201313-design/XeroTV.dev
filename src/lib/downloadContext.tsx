import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { downloadMovieToVault } from './offlineVault';
import { playDownloadDoneFx, playErrorFx } from '../utils/soundFx';

export interface BackgroundDownloadJob {
  key: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  quality: 'standard' | 'hd';
  loadedBytes: number;
  totalBytes: number;
  status: 'downloading' | 'error';
  errorMessage?: string;
}

export interface AppNotificationItem {
  id: string;
  kind: 'release' | 'update' | 'download';
  title: string;
  description: string;
  timestampMs: number;
  read: boolean;
  actionSection?: 'vault' | 'docs' | 'apps';
}

interface DownloadContextValue {
  jobs: Record<string, BackgroundDownloadJob>;
  notifications: AppNotificationItem[];
  unreadCount: number;
  startBackgroundDownload: (params: {
    tmdbId: number;
    mediaType: 'movie' | 'tv';
    title: string;
    overview: string;
    releaseDate: string;
    posterPath?: string | null;
    quality: 'standard' | 'hd';
    estimatedBytes: number;
    onVaultUpdated: (newUsedBytes: number) => void;
  }) => Promise<void>;
  cancelBackgroundDownload: (key: string) => void;
  dismissJobError: (key: string) => void;
  pushNotification: (item: Omit<AppNotificationItem, 'id' | 'timestampMs' | 'read'> & { id?: string }) => void;
  markAllNotificationsRead: () => void;
}

const DownloadContext = createContext<DownloadContextValue | null>(null);

const INITIAL_UPDATE_NOTIFICATION: AppNotificationItem = {
  id: 'update-v1-0',
  kind: 'update',
  title: 'XEROTV 1.0 Update — Improving at 1.0',
  description:
    'Background downloads, 3D Liquid Glass, Networks catalog, WebApp shortcuts, and promo VER-1-0XEROTV (+20 days / +5GB) are live.',
  timestampMs: Date.now(),
  read: false,
  actionSection: 'docs',
};

export const DownloadProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [jobs, setJobs] = useState<Record<string, BackgroundDownloadJob>>({});
  const [notifications, setNotifications] = useState<AppNotificationItem[]>([INITIAL_UPDATE_NOTIFICATION]);
  const controllersRef = useRef<Map<string, AbortController>>(new Map());

  const pushNotification = useCallback(
    (item: Omit<AppNotificationItem, 'id' | 'timestampMs' | 'read'> & { id?: string }) => {
      const id = item.id || `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      setNotifications((prev) => {
        if (item.id && prev.some((n) => n.id === item.id)) return prev;
        return [
          {
            ...item,
            id,
            timestampMs: Date.now(),
            read: false,
          },
          ...prev,
        ].slice(0, 25);
      });
    },
    [],
  );

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const cancelBackgroundDownload = useCallback((key: string) => {
    const ctrl = controllersRef.current.get(key);
    if (ctrl) {
      ctrl.abort();
      controllersRef.current.delete(key);
    }
    setJobs((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const dismissJobError = useCallback((key: string) => {
    setJobs((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const startBackgroundDownload = useCallback(
    async (params: {
      tmdbId: number;
      mediaType: 'movie' | 'tv';
      title: string;
      overview: string;
      releaseDate: string;
      posterPath?: string | null;
      quality: 'standard' | 'hd';
      estimatedBytes: number;
      onVaultUpdated: (newUsedBytes: number) => void;
    }) => {
      const key = `${params.mediaType}:${params.tmdbId}`;
      if (controllersRef.current.has(key)) {
        return; // already downloading
      }

      const controller = new AbortController();
      controllersRef.current.set(key, controller);

      setJobs((prev) => ({
        ...prev,
        [key]: {
          key,
          tmdbId: params.tmdbId,
          mediaType: params.mediaType,
          title: params.title,
          quality: params.quality,
          loadedBytes: 0,
          totalBytes: params.estimatedBytes,
          status: 'downloading',
        },
      }));

      try {
        const { totalVaultBytes } = await downloadMovieToVault({
          tmdbId: params.tmdbId,
          mediaType: params.mediaType,
          title: params.title,
          overview: params.overview,
          releaseDate: params.releaseDate,
          posterPath: params.posterPath,
          quality: params.quality,
          signal: controller.signal,
          onProgress: (loaded, total) => {
            setJobs((prev) => {
              const cur = prev[key];
              if (!cur) return prev;
              return {
                ...prev,
                [key]: { ...cur, loadedBytes: loaded, totalBytes: total },
              };
            });
          },
        });

        controllersRef.current.delete(key);
        setJobs((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });

        params.onVaultUpdated(totalVaultBytes);
        playDownloadDoneFx();
        pushNotification({
          kind: 'download',
          title: `Download Complete: ${params.title}`,
          description: 'Saved in your Offline Vault for playback anytime without internet.',
          actionSection: 'vault',
        });
      } catch (err) {
        controllersRef.current.delete(key);
        if (err instanceof DOMException && err.name === 'AbortError') {
          setJobs((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          return;
        }
        playErrorFx();
        const message = err instanceof Error ? err.message : 'Download failed.';
        setJobs((prev) => ({
          ...prev,
          [key]: {
            key,
            tmdbId: params.tmdbId,
            mediaType: params.mediaType,
            title: params.title,
            quality: params.quality,
            loadedBytes: 0,
            totalBytes: params.estimatedBytes,
            status: 'error',
            errorMessage: message,
          },
        }));
      }
    },
    [pushNotification],
  );

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <DownloadContext.Provider
      value={{
        jobs,
        notifications,
        unreadCount,
        startBackgroundDownload,
        cancelBackgroundDownload,
        dismissJobError,
        pushNotification,
        markAllNotificationsRead,
      }}
    >
      {children}
    </DownloadContext.Provider>
  );
};

export function useDownloadManager() {
  const ctx = useContext(DownloadContext);
  if (!ctx) {
    throw new Error('useDownloadManager must be used within DownloadProvider');
  }
  return ctx;
}
