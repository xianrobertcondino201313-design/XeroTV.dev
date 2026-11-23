import React from 'react';
import { AlertTriangle, Download, X } from 'lucide-react';
import { useDownloadManager } from '../lib/downloadContext';
import { formatBytes } from '../utils/subscription';

export const BackgroundDownloadsTray: React.FC = () => {
  const { jobs, cancelBackgroundDownload, dismissJobError } = useDownloadManager();
  const jobList = Object.values(jobs);
  if (jobList.length === 0) return null;

  return (
    <aside
      aria-label="Background Downloads"
      className="fixed bottom-20 md:bottom-4 left-4 z-40 w-[min(340px,calc(100vw-2rem))] space-y-2"
    >
      {jobList.map((job) => {
        const pct = Math.min(
          100,
          Math.round((job.loadedBytes / Math.max(1, job.totalBytes)) * 100),
        );
        return (
          <div
            key={job.key}
            className="liquid-glass-strong rounded-2xl p-3.5 text-white border border-white/20 shadow-2xl space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {job.status === 'error' ? (
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                ) : (
                  <Download className="w-4 h-4 text-emerald-400 animate-bounce shrink-0" />
                )}
                <span className="text-xs font-semibold truncate">{job.title}</span>
              </div>
              <button
                type="button"
                onClick={() =>
                  job.status === 'error'
                    ? dismissJobError(job.key)
                    : cancelBackgroundDownload(job.key)
                }
                aria-label={job.status === 'error' ? 'Dismiss error' : `Cancel ${job.title}`}
                className="p-1 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {job.status === 'error' ? (
              <p className="text-[11px] text-rose-400 line-clamp-2">{job.errorMessage}</p>
            ) : (
              <>
                <div className="flex items-center justify-between text-[11px] text-zinc-300 tabular-nums">
                  <span>Background MP4 ({job.quality.toUpperCase()})</span>
                  <span>
                    {pct}% · {formatBytes(job.loadedBytes)} / {formatBytes(job.totalBytes)}
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-white/15 overflow-hidden">
                  <div
                    className="h-full bg-white transition-all duration-150"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </>
            )}
          </div>
        );
      })}
    </aside>
  );
};
