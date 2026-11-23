import React from 'react';
import { X } from 'lucide-react';

export type LegalDocType = 'about' | 'disclaimer' | 'privacy' | 'terms' | null;

interface LegalModalProps {
  docType: LegalDocType;
  onClose: () => void;
}

export const LegalModal: React.FC<LegalModalProps> = ({ docType, onClose }) => {
  if (!docType) return null;

  const content: Record<Exclude<LegalDocType, null>, { title: string; body: string[] }> = {
    about: {
      title: 'About XEROTV',
      body: [
        'XEROTV is a modern Liquid Glass cinema and series platform developed by XIAN IN PRODUCTION.',
        'Catalog metadata, posters, cast credits, trailers, and season guides are synchronized directly from The Movie Database (TMDB).',
        'Features include Kids PG Parental PIN Mode, 18+ Secret PIN Vault, Christmas Snowfall Theme, sandboxed multi-server playback (VidZen & NxSha), and local IndexedDB offline video storage.',
      ],
    },
    disclaimer: {
      title: 'Disclaimer',
      body: [
        'XEROTV uses the TMDB API for film and television metadata and does not claim ownership over third-party trademarks or media posters.',
        'Online streaming embeds (VidZen, NxSha, Zoryva, PrimeSrc, 2Embed HD) are rendered inside sandboxed iframes from external public embed providers.',
        'This product uses the TMDB API but is not endorsed or certified by TMDB.',
      ],
    },
    privacy: {
      title: 'Privacy Policy',
      body: [
        'Authentication and subscription records are stored securely in Firebase Authentication and Cloud Firestore with owner-only access rules.',
        'Offline downloaded movies are stored locally inside your browser/device IndexedDB storage vault and never uploaded to external trackers.',
        'Parental and 18+ PINs are stored as SHA-256 digests so raw PIN digits are never saved in plaintext.',
      ],
    },
    terms: {
      title: 'Terms of Use',
      body: [
        'Offline Download Access (₱500 / 2 Months) and 1TB Permanent Storage (₱1,090) are activated via XEROTV UserID verification through XIAN IN PRODUCTION.',
        'Promotional codes such as NEWUSER2026 are strictly one-time per account.',
        'Users are responsible for maintaining their Parental PIN when Kids Mode is active.',
      ],
    },
  };

  const active = content[docType];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md"
    >
      <div className="w-full max-w-lg liquid-glass-strong rounded-3xl p-6 text-white space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 id="legal-modal-title" className="text-xl font-bold font-display">
            {active.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close legal dialog"
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3 text-sm text-zinc-300 leading-relaxed">
          {active.body.map((p, idx) => (
            <p key={idx}>{p}</p>
          ))}
        </div>
        <div className="pt-2 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white text-zinc-950 text-xs font-semibold hover:bg-zinc-200 cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
