import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Download, Globe, Loader2, Share2, Smartphone, Wifi } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { DEFAULT_SHARED_APP_URL, isPrivateDevOrigin, resolvePublicAppOrigin } from '../utils/appLinks';
import type { ProfileMode } from '../utils/modes';

interface GetAppsViewProps {
  mode: ProfileMode;
  onOpenVault: () => void;
}

function triggerDirectHttpDownload(href: string, filename: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function triggerXmlBlobDownload(text: string, mimeType: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15_000);
}

async function probeApkEndpoint(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', credentials: 'include', cache: 'no-store' });
    if (!res.ok) return false;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('text/html') || ct.includes('application/json')) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export const GetAppsView: React.FC<GetAppsViewProps> = ({ mode, onOpenVault }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const [downloadingApk, setDownloadingApk] = useState(false);
  const [downloadingIos, setDownloadingIos] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const initialPublicOrigin = useMemo(() => {
    const raw = typeof window !== 'undefined' ? window.location.origin : DEFAULT_SHARED_APP_URL;
    return resolvePublicAppOrigin(raw, DEFAULT_SHARED_APP_URL);
  }, []);

  const [customDeployUrl, setCustomDeployUrl] = useState('');
  const [publicUrlLive, setPublicUrlLive] = useState<boolean | null>(null);
  const isKids = mode === 'kids';

  const effectivePublicOrigin = useMemo(() => {
    if (customDeployUrl.trim()) {
      return resolvePublicAppOrigin(customDeployUrl, initialPublicOrigin);
    }
    return initialPublicOrigin;
  }, [customDeployUrl, initialPublicOrigin]);

  useEffect(() => {
    let active = true;
    const browserOrigin = typeof window !== 'undefined' ? window.location.origin : '';
    if (browserOrigin && !isPrivateDevOrigin(browserOrigin) && !customDeployUrl.trim()) {
      setPublicUrlLive(true);
      return;
    }

    const controller = new AbortController();
    fetch(`/api/apps/check-public-url?url=${encodeURIComponent(effectivePublicOrigin)}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data: { reachable?: boolean }) => {
        if (active) setPublicUrlLive(Boolean(data?.reachable));
      })
      .catch(() => {
        if (active) setPublicUrlLive(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [effectivePublicOrigin, customDeployUrl]);

  const handleDownloadAndroidApk = async () => {
    if (downloadingApk) return;
    setDownloadingApk(true);
    setDownloadError(null);
    setDownloadStatus('Checking signed XEROTV.apk installer...');
    try {
      const staticApkUrl = '/apps/XEROTV.apk';
      const apiApkUrl = `/api/apps/android.apk?origin=${encodeURIComponent(effectivePublicOrigin)}`;
      const isStaticReady = await probeApkEndpoint(staticApkUrl);
      let chosenUrl = staticApkUrl;

      if (!isStaticReady) {
        const isApiReady = await probeApkEndpoint(apiApkUrl);
        if (!isApiReady) {
          throw new Error('Could not reach a valid signed XEROTV.apk package. Please retry.');
        }
        chosenUrl = apiApkUrl;
      }

      // Direct HTTP download avoids blob: MIME/filename corruption on Android Package Installer
      triggerDirectHttpDownload(chosenUrl, 'XEROTV.apk');
      setDownloadStatus(
        'Downloading XEROTV.apk directly (standalone app). Open Downloads -> tap XEROTV.apk -> allow "Install unknown apps" if asked -> tap Install.',
      );
    } catch (err) {
      setDownloadStatus(null);
      setDownloadError(err instanceof Error ? err.message : 'Download failed. Please try again.');
    } finally {
      setDownloadingApk(false);
    }
  };

  const handleDownloadIosApp = async () => {
    if (downloadingIos) return;
    setDownloadingIos(true);
    setDownloadError(null);
    setDownloadStatus('Preparing iPhone / iPad app installer...');
    try {
      const profileUrl = `/api/apps/ios.mobileconfig?origin=${encodeURIComponent(effectivePublicOrigin)}`;
      const res = await fetch(profileUrl, { credentials: 'include', cache: 'no-store' });
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (!res.ok || ct.includes('text/html') || ct.includes('application/json')) {
        throw new Error(`Could not prepare iPhone profile (HTTP ${res.status})`);
      }
      const text = await res.text();
      if (!text.trimStart().startsWith('<?xml')) {
        throw new Error('Invalid iOS configuration profile response.');
      }

      if (isIOS) {
        // Direct HTTPS navigation triggers native iOS Safari "Allow Profile Download" dialog cleanly
        window.location.assign(profileUrl);
        setDownloadStatus(
          'Tap Allow when Safari prompts, then open iPhone Settings -> Profile Downloaded -> Install.',
        );
      } else {
        triggerXmlBlobDownload(text, 'application/x-apple-aspen-config', 'XEROTV-iPhone.mobileconfig');
        setDownloadStatus('XEROTV-iPhone.mobileconfig downloaded. Open it on iPhone or iPad to install.');
      }
    } catch (err) {
      setDownloadStatus(null);
      setDownloadError(err instanceof Error ? err.message : 'Download failed. Please try again.');
    } finally {
      setDownloadingIos(false);
    }
  };

  const handleInstallClick = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowGuide(true);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-10">
      {/* Liquid Glass Mobile Splash & Hero */}
      <section
        className={`rounded-3xl overflow-hidden grid grid-cols-1 lg:grid-cols-2 items-stretch ${
          isKids ? 'bg-white border border-sky-200 text-slate-900' : 'liquid-glass-strong'
        }`}
      >
        <div className="p-8 sm:p-10 flex flex-col justify-between gap-6">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <img
                src="/src/assets/images/xerotv_app_icon_1795185548315.jpg"
                alt="XEROTV Official App Icon"
                className="w-14 h-14 rounded-2xl object-cover border border-white/20 shadow-lg"
              />
              <div>
                <h1 className="text-3xl sm:text-4xl font-bold font-display text-balance">
                  Get XEROTV App
                </h1>
                <p className={`text-xs ${isKids ? 'text-slate-500' : 'text-zinc-400'}`}>
                  XIAN IN PRODUCTION · Android APK &amp; iPhone Edition
                </p>
              </div>
            </div>

            <p className={`text-sm leading-relaxed max-w-xl ${isKids ? 'text-slate-600' : 'text-zinc-300'}`}>
              Install the real XEROTV app directly on Android or iPhone/iPad with a Liquid Glass
              splash screen and home icon. Android <span className="font-semibold">XEROTV.apk</span> runs standalone
              with the built-in TMDB engine and Offline Vault.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-xs">
              <div className={`p-3.5 rounded-2xl space-y-1 ${isKids ? 'bg-sky-50' : 'bg-white/5 border border-white/10'}`}>
                <div className="font-semibold flex items-center gap-1.5">
                  <Wifi className="w-4 h-4" />
                  <span>Standalone Android App</span>
                </div>
                <p className={isKids ? 'text-slate-600' : 'text-zinc-400'}>
                  Full XEROTV app bundled inside the APK with real TMDB streaming and no 404/403 link errors.
                </p>
              </div>
              <div className={`p-3.5 rounded-2xl space-y-1 ${isKids ? 'bg-sky-50' : 'bg-white/5 border border-white/10'}`}>
                <div className="font-semibold flex items-center gap-1.5">
                  <Smartphone className="w-4 h-4" />
                  <span>Watch Anywhere Offline</span>
                </div>
                <p className={isKids ? 'text-slate-600' : 'text-zinc-400'}>
                  Downloaded MP4 movies remain playable inside the app even with airplane mode enabled.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div
              className={`rounded-2xl p-3 space-y-1.5 ${
                isKids ? 'bg-sky-50 border border-sky-200' : 'bg-black/30 border border-white/10'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="xerotv-app-target-url"
                  className={`text-[11px] font-semibold flex items-center gap-1.5 ${
                    isKids ? 'text-slate-700' : 'text-zinc-300'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>Optional Deployed iPhone Profile URL (Vercel / Published App)</span>
                </label>
                {publicUrlLive !== null && (
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${
                      publicUrlLive
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-white/10 text-zinc-400'
                    }`}
                  >
                    {publicUrlLive ? 'Live' : 'Standalone Mode'}
                  </span>
                )}
              </div>
              <input
                id="xerotv-app-target-url"
                type="url"
                value={customDeployUrl}
                onChange={(e) => setCustomDeployUrl(e.target.value)}
                placeholder="https://xerotv.vercel.app (override only if self-hosting elsewhere)"
                className={`w-full rounded-xl px-3 py-2 text-xs font-mono outline-none border ${
                  isKids
                    ? 'bg-white border-sky-200 text-slate-900 focus:border-sky-400'
                    : 'bg-zinc-950/80 border-white/15 text-zinc-100 focus:border-white/40 placeholder:text-zinc-500'
                }`}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleDownloadAndroidApk}
                disabled={downloadingApk}
                data-testid="download-android-apk"
                className={`inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-colors cursor-pointer disabled:opacity-60 ${
                  isKids
                    ? 'bg-sky-600 text-white hover:bg-sky-700'
                    : 'bg-white text-zinc-950 hover:bg-zinc-200'
                }`}
              >
                {downloadingApk ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                <span>{downloadingApk ? 'Preparing APK...' : 'Download Android App (APK)'}</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadIosApp}
                disabled={downloadingIos}
                data-testid="download-ios-app"
                className={`inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold border transition-colors cursor-pointer disabled:opacity-60 ${
                  isKids
                    ? 'border-sky-300 text-sky-900 hover:bg-sky-50'
                    : 'border-white/25 bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                {downloadingIos ? <Loader2 className="w-4 h-4 animate-spin" /> : <Smartphone className="w-4 h-4" />}
                <span>{downloadingIos ? 'Preparing iOS App...' : 'Install iPhone / iPad App'}</span>
              </button>

              {isInstalled ? (
                <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-xs font-semibold">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Installed on Device</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleInstallClick}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold border cursor-pointer transition-colors ${
                    isKids
                      ? 'border-sky-200 text-sky-800 hover:bg-sky-50'
                      : 'border-white/15 text-zinc-200 hover:bg-white/10'
                  }`}
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>{isInstallable ? 'Quick WebApp Shortcut' : 'How to Install'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={onOpenVault}
                className="text-xs font-semibold underline opacity-80 hover:opacity-100 px-2 py-2 cursor-pointer"
              >
                Open Offline Vault
              </button>
            </div>

            {downloadStatus && (
              <div
                role="status"
                className={`rounded-xl px-3.5 py-2.5 text-xs border ${
                  isKids
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-emerald-500/10 border-emerald-400/25 text-emerald-300'
                }`}
              >
                {downloadStatus}
              </div>
            )}

            {downloadError && (
              <div
                role="alert"
                className="rounded-xl px-3.5 py-2.5 text-xs bg-red-500/15 border border-red-400/30 text-red-200"
              >
                {downloadError}
              </div>
            )}

            <div
              className={`rounded-2xl p-3.5 text-[11px] leading-relaxed grid grid-cols-1 sm:grid-cols-2 gap-3 ${
                isKids ? 'bg-sky-50 text-slate-700' : 'bg-white/5 border border-white/10 text-zinc-300'
              }`}
            >
              <div className="space-y-1">
                <div className="font-semibold text-xs">Android Phones &amp; Tablets</div>
                <p className="opacity-80">
                  Direct signed <span className="font-mono font-semibold">XEROTV.apk</span> (HTTP download — never blob). If Android asks, enable <strong>Install unknown apps</strong> for your browser, or use the{' '}
                  <a
                    href="/apps/XEROTV.apk"
                    download="XEROTV.apk"
                    className="underline font-semibold"
                  >
                    direct APK mirror
                  </a>
                  .
                </p>
              </div>
              <div className="space-y-1">
                <div className="font-semibold text-xs">iPhone &amp; iPad (iOS)</div>
                <p className="opacity-80">
                  On iPhone Safari, tap <span className="font-semibold">Share &rarr; Add to Home Screen</span> right away, or install the <span className="font-mono font-semibold">.mobileconfig</span> pointing to <span className="font-mono">xerotv.vercel.app</span>.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Liquid Glass Mobile Preview Card */}
        <div className="relative min-h-[320px] lg:h-full overflow-hidden bg-zinc-950">
          <img
            src="/src/assets/images/xerotv_splash_backdrop_1795185549127.jpg"
            alt="XEROTV Liquid Glass Cinema Backdrop"
            className="w-full h-full object-cover opacity-80"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent flex items-end p-8">
            <div className="w-full max-w-xs mx-auto liquid-glass-strong rounded-3xl p-5 text-white space-y-3 border border-white/20">
              <div className="flex items-center gap-3">
                <img
                  src="/src/assets/images/xerotv_app_icon_1795185548315.jpg"
                  alt="XEROTV Mobile Splash Icon"
                  className="w-11 h-11 rounded-2xl object-cover"
                />
                <div>
                  <div className="text-sm font-bold font-display">XEROTV Mobile</div>
                  <div className="text-[11px] text-zinc-400">Liquid Glass Splash Experience</div>
                </div>
              </div>
              <div className="h-1.5 w-full rounded-full bg-white/15 overflow-hidden">
                <div className="h-full w-2/3 bg-white rounded-full" />
              </div>
              <div className="flex justify-between text-[11px] text-zinc-300">
                <span>Android APK + iOS App</span>
                <span>Offline Vault Ready</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {showGuide && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="install-guide-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md"
        >
          <div className="w-full max-w-md liquid-glass-strong rounded-3xl p-6 text-white space-y-4">
            <div className="flex items-center gap-2.5">
              <Share2 className="w-5 h-5" />
              <h2 id="install-guide-title" className="text-lg font-bold font-display">
                Install XEROTV on Android &amp; iPhone
              </h2>
            </div>
            <div className="space-y-3 text-sm text-zinc-300">
              <p className="text-xs text-zinc-400">
                {publicUrlLive
                  ? 'Your public XEROTV server URL is live and ready for mobile installation.'
                  : 'Android XEROTV.apk already runs standalone with all files built in. For an iPhone Home Screen app right now:'}
              </p>
              <ol className="space-y-2 list-decimal list-inside">
                <li>
                  <strong>Android</strong>: Tap <strong>Download Android App (APK)</strong>, open <code className="text-white">XEROTV.apk</code> from Downloads, and tap <strong>Install</strong>.
                </li>
                <li>
                  <strong>iPhone / iPad (Instant PWA)</strong>: Open this page in Safari and tap <strong>Share &rarr; Add to Home Screen</strong>.
                </li>
                <li>
                  <strong>iPhone Profile (.mobileconfig)</strong>: After publishing via <strong>Share App</strong> or Vercel, paste that live URL above and tap <strong>Install iPhone / iPad App</strong>.
                </li>
              </ol>
            </div>
            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full py-2.5 rounded-xl bg-white text-zinc-950 text-sm font-semibold hover:bg-zinc-200 cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
