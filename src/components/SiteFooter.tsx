import React from 'react';
import type { ProfileMode } from '../utils/modes';
import type { LegalDocType } from './LegalModal';
import { playClickFx } from '../utils/soundFx';

interface SiteFooterProps {
  mode: ProfileMode;
  onOpenLegal: (doc: LegalDocType) => void;
  onOpenDocs: () => void;
}

export const SiteFooter: React.FC<SiteFooterProps> = ({ mode, onOpenLegal, onOpenDocs }) => {
  const isKids = mode === 'kids';

  return (
    <footer
      className={`mt-16 border-t pb-24 md:pb-10 ${
        isKids
          ? 'border-sky-200 bg-white/70 text-slate-600'
          : 'border-white/10 bg-black/30 text-zinc-400'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs">
        <div className="space-y-1">
          <div className={`font-semibold font-display ${isKids ? 'text-slate-900' : 'text-white'}`}>
            XEROTV · Developed by XIAN IN PRODUCTION
          </div>
          <p>
            Powered by real-time TMDB catalog synchronization. Need subscription activation or support?{' '}
            <a
              href="https://web.facebook.com/share/p/1E7E6y8HAD/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:opacity-80"
            >
              Support / Contact Developer on Facebook
            </a>
            .
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4 md:pr-12">
          <button
            type="button"
            onClick={() => {
              playClickFx();
              onOpenDocs();
            }}
            className="hover:underline cursor-pointer"
          >
            Docs &amp; Feedback
          </button>
          <button type="button" onClick={() => onOpenLegal('about')} className="hover:underline cursor-pointer">
            About
          </button>
          <button type="button" onClick={() => onOpenLegal('disclaimer')} className="hover:underline cursor-pointer">
            Disclaimer
          </button>
          <button type="button" onClick={() => onOpenLegal('privacy')} className="hover:underline cursor-pointer">
            Privacy Policy
          </button>
          <button type="button" onClick={() => onOpenLegal('terms')} className="hover:underline cursor-pointer">
            Terms
          </button>
        </div>
      </div>
    </footer>
  );
};
