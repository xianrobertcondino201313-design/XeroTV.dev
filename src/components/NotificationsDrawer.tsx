import React from 'react';
import { Bell, CheckCircle2, Film, Sparkles, X } from 'lucide-react';
import { useDownloadManager, type AppNotificationItem } from '../lib/downloadContext';
import { playClickFx } from '../utils/soundFx';

interface NotificationsDrawerProps {
  open: boolean;
  onClose: () => void;
  onNavigateSection: (section: 'vault' | 'docs' | 'apps') => void;
}

export const NotificationsDrawer: React.FC<NotificationsDrawerProps> = ({
  open,
  onClose,
  onNavigateSection,
}) => {
  const { notifications, markAllNotificationsRead } = useDownloadManager();

  if (!open) return null;

  const getIcon = (kind: AppNotificationItem['kind']) => {
    if (kind === 'download') return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
    if (kind === 'update') return <Sparkles className="w-4 h-4 text-sky-300 shrink-0" />;
    return <Film className="w-4 h-4 text-zinc-200 shrink-0" />;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="notifications-title"
      className="fixed inset-0 z-50 flex items-start justify-end p-4 bg-black/65 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md liquid-glass-strong rounded-3xl p-5 text-white space-y-4 mt-14 max-h-[82vh] overflow-y-auto border border-white/20 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5" />
            <h2 id="notifications-title" className="text-base font-bold font-display">
              Notifications &amp; Releases
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                playClickFx();
                markAllNotificationsRead();
              }}
              className="text-xs underline text-zinc-300 hover:text-white cursor-pointer"
            >
              Mark all read
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close notifications"
              className="p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="space-y-2.5">
          {notifications.map((item) => (
            <div
              key={item.id}
              className={`rounded-2xl p-3.5 border transition-colors space-y-1.5 ${
                item.read
                  ? 'bg-white/5 border-white/10 opacity-80'
                  : 'bg-white/10 border-white/25'
              }`}
            >
              <div className="flex items-start gap-2.5">
                {getIcon(item.kind)}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="text-xs font-bold leading-snug">{item.title}</div>
                  <p className="text-xs text-zinc-300 leading-relaxed">{item.description}</p>
                  {item.actionSection && (
                    <button
                      type="button"
                      onClick={() => {
                        playClickFx();
                        onNavigateSection(item.actionSection!);
                        onClose();
                      }}
                      className="text-[11px] font-semibold underline text-white hover:opacity-80 cursor-pointer pt-1"
                    >
                      Open Now
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
