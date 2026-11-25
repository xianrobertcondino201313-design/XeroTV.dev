import React, { useEffect, useState } from 'react';
import {
  Bug,
  CheckCircle2,
  Copy,
  FileArchive,
  Gift,
  HelpCircle,
  Lock,
  Plus,
  ShieldCheck,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import {
  adminCreatePromoCode,
  adminDeletePromoCode,
  adminFetchUsersList,
  adminGrantSubscriptionByUserId,
  adminListPromoCodes,
  adminSetFeedbackStatus,
  adminTogglePromoCode,
  fetchFeedbackReports,
  type FeedbackReportItem,
} from '../lib/authClient';
import {
  formatBytes,
  isXeroStarActive,
  type AdminGrantType,
  type CustomPromoDefinition,
  type UserSubscriptionState,
} from '../utils/subscription';
import { playClickFx, playErrorFx, playUnlockFx } from '../utils/soundFx';

interface AdminTriggerAndModalProps {
  isSignedIn?: boolean;
  onOpenAccount?: () => void;
}

type AdminTab = 'grants' | 'codes' | 'reports' | 'zip';

export const AdminTriggerAndModal: React.FC<AdminTriggerAndModalProps> = () => {
  const [open, setOpen] = useState(false);
  const [verified, setVerified] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>('grants');
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [accessCode, setAccessCode] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [verifying, setVerifying] = useState(false);

  // Grants & Users
  const [targetUserId, setTargetUserId] = useState('');
  const [grantType, setGrantType] = useState<AdminGrantType>('download_2m');
  const [customDays, setCustomDays] = useState(30);
  const [grantBusy, setGrantBusy] = useState(false);
  const [grantFeedback, setGrantFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [usersList, setUsersList] = useState<UserSubscriptionState[]>([]);
  const [usersError, setUsersError] = useState('');

  // Code Generator
  const [promoList, setPromoList] = useState<CustomPromoDefinition[]>([]);
  const [newCodeStr, setNewCodeStr] = useState('');
  const [newCodeDays, setNewCodeDays] = useState(14);
  const [newCodeGb, setNewCodeGb] = useState(5);
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeFeedback, setCodeFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // Feedback & Bug Reports
  const [reports, setReports] = useState<FeedbackReportItem[]>([]);

  // Vercel Full-Stack ZIP Export
  const [zipBusy, setZipBusy] = useState(false);
  const [zipStatus, setZipStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!open || !verified) return;

    let cancelled = false;
    adminFetchUsersList(adminToken)
      .then((list) => {
        if (cancelled) return;
        setUsersList(list);
        setUsersError('');
      })
      .catch((err) => {
        if (cancelled) return;
        setUsersError(err instanceof Error ? err.message : 'Unable to load user directory.');
      });

    adminListPromoCodes(adminToken)
      .then((list) => {
        if (!cancelled) setPromoList(list);
      })
      .catch(() => {});

    fetchFeedbackReports()
      .then((list) => {
        if (!cancelled) setReports(list);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [open, verified, adminToken]);

  const handleOpen = async () => {
    playClickFx();
    setOpen(true);
    try {
      const headers: Record<string, string> = {};
      if (adminToken) headers.Authorization = `Bearer ${adminToken}`;
      const res = await fetch('/api/admin/status', { headers, credentials: 'include' });
      const data = await res.json();
      if (data.verified) {
        setVerified(true);
      } else {
        setVerified(false);
        setAdminToken(null);
      }
    } catch {
      // keep prompt open
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerifyError('');
    setVerifying(true);
    try {
      const res = await fetch('/api/admin/verify', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessCode }),
      });
      const data = await res.json();
      if (!res.ok || !data.verified) {
        playErrorFx();
        setVerifyError(data.error || 'Access denied.');
        return;
      }
      playUnlockFx();
      setVerified(true);
      setAdminToken(data.token || null);
      setAccessCode('');
    } catch {
      playErrorFx();
      setVerifyError('Verification service unreachable.');
    } finally {
      setVerifying(false);
    }
  };

  const handleGrantSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGrantFeedback(null);
    setGrantBusy(true);
    try {
      const res = await adminGrantSubscriptionByUserId(adminToken, targetUserId, grantType, customDays);
      playUnlockFx();
      setGrantFeedback({
        ok: true,
        text: `Updated ${res.shortUserId} · Tier: ${res.patch.downloadTier} · Quota: ${formatBytes(res.patch.storageQuotaBytes)}${res.patch.xerostarActive ? ' · XEROSTAR VIP Active' : ''}${res.amountPesos > 0 ? ` · Ledger +₱${res.amountPesos}` : ''}`,
      });
      setTargetUserId('');
      const refreshed = await adminFetchUsersList(adminToken).catch(() => null);
      if (refreshed) setUsersList(refreshed);
    } catch (err) {
      playErrorFx();
      setGrantFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to update subscription.',
      });
    } finally {
      setGrantBusy(false);
    }
  };

  const handleGenerateRandomCode = () => {
    playClickFx();
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    setNewCodeStr(`XTV-${rand}`);
  };

  const handleCreatePromoCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setCodeFeedback(null);
    setCodeBusy(true);
    try {
      const created = await adminCreatePromoCode(adminToken, {
        code: newCodeStr,
        daysGranted: newCodeDays,
        storageBonusGb: newCodeGb,
      });
      playUnlockFx();
      setCodeFeedback({
        ok: true,
        text: `Generated ${created.code} (+${created.daysGranted} days, +${formatBytes(created.storageBonusBytes)})`,
      });
      setNewCodeStr('');
      const refreshed = await adminListPromoCodes(adminToken).catch(() => null);
      if (refreshed) setPromoList(refreshed);
    } catch (err) {
      playErrorFx();
      setCodeFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to create promo code.',
      });
    } finally {
      setCodeBusy(false);
    }
  };

  const handleDownloadSourceZip = async () => {
    if (zipBusy) return;
    playClickFx();
    setZipBusy(true);
    setZipStatus({ ok: true, text: 'Packaging XEROTV-Vercel-FullStack.zip...' });
    try {
      const headers: Record<string, string> = {};
      if (adminToken) headers.Authorization = `Bearer ${adminToken}`;
      const res = await fetch('/api/admin/download-source-zip', {
        headers,
        credentials: 'include',
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || `Export failed (HTTP ${res.status})`);
      }
      const buffer = await res.arrayBuffer();
      const zipBlob = new Blob([buffer], { type: 'application/zip' });
      const blobUrl = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = 'XEROTV-Vercel-FullStack.zip';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 15_000);
      playUnlockFx();
      setZipStatus({ ok: true, text: 'XEROTV-Vercel-FullStack.zip downloaded cleanly and ready for Vercel.' });
    } catch (err) {
      playErrorFx();
      setZipStatus({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to export Vercel ZIP.',
      });
    } finally {
      setZipBusy(false);
    }
  };

  return (
    <>
      {/* Tiny question mark icon in bottom-right */}
      <button
        type="button"
        onClick={handleOpen}
        aria-label="Developer access"
        title="Developer Access"
        className="fixed bottom-20 md:bottom-4 right-4 z-40 w-8 h-8 rounded-full liquid-glass text-zinc-400 hover:text-white hover:scale-105 transition-all flex items-center justify-center cursor-pointer opacity-75 hover:opacity-100"
      >
        <HelpCircle className="w-4 h-4" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto"
        >
          <div className="w-full max-w-3xl liquid-glass-strong rounded-2xl p-6 sm:p-8 text-white space-y-6 my-auto max-h-[90vh] overflow-y-auto border border-white/15">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="admin-modal-title" className="text-xl sm:text-2xl font-bold font-display">
                  {verified ? 'XEROTV Admin Console' : 'Developer Access Verification'}
                </h2>
                <p className="text-xs text-zinc-400 mt-1 flex items-center gap-1.5">
                  {verified ? (
                    <>
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Privacy-Protected Admin Session Active (Credentials Redacted)</span>
                    </>
                  ) : (
                    <span>We need your access code. Please input here.</span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close developer modal"
                className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {!verified ? (
              <form onSubmit={handleVerifyCode} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="dev-access-code" className="block text-xs font-medium text-zinc-300">
                    Developer Access Code
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="dev-access-code"
                      type="password"
                      autoFocus
                      value={accessCode}
                      onChange={(e) => setAccessCode(e.target.value)}
                      placeholder="Enter access code..."
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-black/50 border border-white/15 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-white/40"
                    />
                  </div>
                </div>
                {verifyError && (
                  <p className="text-xs text-rose-400 font-medium" role="alert">
                    {verifyError}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={verifying}
                  className="w-full py-3 rounded-xl bg-white text-zinc-950 text-sm font-semibold hover:bg-zinc-200 transition-colors cursor-pointer disabled:opacity-60"
                >
                  {verifying ? 'Verifying...' : 'Unlock Admin Console'}
                </button>
              </form>
            ) : (
              <div className="space-y-6">
                {/* Admin Navigation Tabs */}
                <div className="flex flex-wrap gap-1.5 p-1 rounded-xl bg-white/5 border border-white/10">
                  {[
                    { id: 'grants' as const, label: 'Subscriptions & Users' },
                    { id: 'codes' as const, label: 'Code Generator' },
                    { id: 'reports' as const, label: `Reports (${reports.length})` },
                    { id: 'zip' as const, label: 'Files ZIP' },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        playClickFx();
                        setActiveTab(tab.id);
                      }}
                      className={`px-3.5 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                        activeTab === tab.id
                          ? 'bg-white text-zinc-950'
                          : 'text-zinc-300 hover:bg-white/10'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {activeTab === 'grants' && (
                  <>
                    <form
                      onSubmit={handleGrantSubmit}
                      className="rounded-2xl bg-white/5 border border-white/10 p-5 space-y-4"
                    >
                      <div className="flex items-center gap-2">
                        <UserCheck className="w-5 h-5" />
                        <h3 className="text-base font-bold font-display">Subscription Giver (By UserID)</h3>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label htmlFor="admin-target-userid" className="block text-xs text-zinc-300 mb-1">
                            Target UserID (XTV-... or UID)
                          </label>
                          <input
                            id="admin-target-userid"
                            type="text"
                            required
                            value={targetUserId}
                            onChange={(e) => setTargetUserId(e.target.value)}
                            placeholder="e.g. XTV-ABC12345"
                            className="w-full px-3.5 py-2.5 rounded-xl bg-black/50 border border-white/15 text-sm font-mono text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-white/40"
                          />
                        </div>

                        <div>
                          <label htmlFor="admin-grant-type" className="block text-xs text-zinc-300 mb-1">
                            Available Subscription Grant
                          </label>
                          <select
                            id="admin-grant-type"
                            value={grantType}
                            onChange={(e) => setGrantType(e.target.value as AdminGrantType)}
                            className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-white/15 text-sm text-white focus:outline-none focus:ring-2 focus:ring-white/40"
                          >
                            <option value="download_2m">Download Access — 2 Months (₱500)</option>
                            <option value="storage_1tb">1TB Permanent Storage (₱1,090)</option>
                            <option value="xerostar">XEROSTAR VIP — XeroHots Access (₱150)</option>
                            <option value="bundle_2m_1tb">Bundle: 2 Months + 1TB + XEROSTAR (₱1,590)</option>
                            <option value="custom_days">Custom Download Days</option>
                            <option value="revoke">Revoke / Reset to Free</option>
                          </select>
                        </div>
                      </div>

                      {grantType === 'custom_days' && (
                        <div>
                          <label htmlFor="admin-custom-days" className="block text-xs text-zinc-300 mb-1">
                            Number of Days
                          </label>
                          <input
                            id="admin-custom-days"
                            type="number"
                            min={1}
                            max={3650}
                            value={customDays}
                            onChange={(e) => setCustomDays(Number(e.target.value))}
                            className="w-40 px-3.5 py-2 rounded-xl bg-black/50 border border-white/15 text-sm font-mono text-white"
                          />
                        </div>
                      )}

                      {grantFeedback && (
                        <p
                          role="status"
                          className={`text-xs font-medium flex items-center gap-1.5 ${
                            grantFeedback.ok ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {grantFeedback.ok && <CheckCircle2 className="w-4 h-4 shrink-0" />}
                          <span>{grantFeedback.text}</span>
                        </p>
                      )}

                      <button
                        type="submit"
                        disabled={grantBusy}
                        className="px-5 py-2.5 rounded-xl bg-white text-zinc-950 text-xs font-semibold hover:bg-zinc-200 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {grantBusy ? 'Applying Grant...' : 'Submit Subscription Grant'}
                      </button>
                    </form>

                    {/* Registered Users Directory */}
                    <div className="rounded-2xl bg-white/5 border border-white/10 p-5 space-y-3">
                      <h3 className="text-sm font-bold font-display">Registered Users Directory (Privacy Redacted)</h3>
                      {usersError ? (
                        <p className="text-xs text-zinc-400">{usersError}</p>
                      ) : usersList.length === 0 ? (
                        <p className="text-xs text-zinc-400">No user accounts loaded yet.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs tabular-nums">
                            <thead className="text-zinc-400 border-b border-white/10">
                              <tr>
                                <th className="py-2 pr-3">UserID</th>
                                <th className="py-2 pr-3">Download Tier</th>
                                <th className="py-2 pr-3">Storage Quota</th>
                                <th className="py-2 pr-3">XEROSTAR</th>
                                <th className="py-2">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                              {usersList.map((u) => (
                                <tr key={u.uid}>
                                  <td className="py-2 pr-3 font-mono font-semibold">{u.shortUserId}</td>
                                  <td className="py-2 pr-3">{u.downloadTier}</td>
                                  <td className="py-2 pr-3">{formatBytes(u.storageQuotaBytes)}</td>
                                  <td className="py-2 pr-3">
                                    {isXeroStarActive(u) ? (
                                      <span className="text-rose-300 font-semibold">VIP Active</span>
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                  <td className="py-2">
                                    <button
                                      type="button"
                                      onClick={() => setTargetUserId(u.shortUserId)}
                                      className="underline text-zinc-200 hover:text-white cursor-pointer"
                                    >
                                      Select
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {activeTab === 'codes' && (
                  <div className="space-y-4">
                    <form
                      onSubmit={handleCreatePromoCode}
                      className="rounded-2xl bg-white/5 border border-white/10 p-5 space-y-4"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Gift className="w-5 h-5" />
                          <h3 className="text-base font-bold font-display">Promo Code Generator</h3>
                        </div>
                        <button
                          type="button"
                          onClick={handleGenerateRandomCode}
                          className="text-xs underline text-zinc-300 hover:text-white cursor-pointer"
                        >
                          Generate Random Code
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label htmlFor="admin-gen-code" className="block text-xs text-zinc-300 mb-1">
                            Promo Code
                          </label>
                          <input
                            id="admin-gen-code"
                            type="text"
                            required
                            value={newCodeStr}
                            onChange={(e) => setNewCodeStr(e.target.value.toUpperCase())}
                            placeholder="e.g. XTV-VIP30"
                            className="w-full px-3.5 py-2.5 rounded-xl bg-black/50 border border-white/15 text-sm font-mono text-white"
                          />
                        </div>
                        <div>
                          <label htmlFor="admin-gen-days" className="block text-xs text-zinc-300 mb-1">
                            Reward Days Access
                          </label>
                          <input
                            id="admin-gen-days"
                            type="number"
                            min={0}
                            max={3650}
                            value={newCodeDays}
                            onChange={(e) => setNewCodeDays(Number(e.target.value))}
                            className="w-full px-3.5 py-2.5 rounded-xl bg-black/50 border border-white/15 text-sm font-mono text-white"
                          />
                        </div>
                        <div>
                          <label htmlFor="admin-gen-gb" className="block text-xs text-zinc-300 mb-1">
                            Storage Bonus (GB)
                          </label>
                          <input
                            id="admin-gen-gb"
                            type="number"
                            min={0}
                            max={1024}
                            value={newCodeGb}
                            onChange={(e) => setNewCodeGb(Number(e.target.value))}
                            className="w-full px-3.5 py-2.5 rounded-xl bg-black/50 border border-white/15 text-sm font-mono text-white"
                          />
                        </div>
                      </div>

                      {codeFeedback && (
                        <p
                          role="status"
                          className={`text-xs font-medium ${codeFeedback.ok ? 'text-emerald-400' : 'text-rose-400'}`}
                        >
                          {codeFeedback.text}
                        </p>
                      )}

                      <button
                        type="submit"
                        disabled={codeBusy}
                        className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-white text-zinc-950 text-xs font-semibold hover:bg-zinc-200 cursor-pointer disabled:opacity-50"
                      >
                        <Plus className="w-4 h-4" />
                        <span>{codeBusy ? 'Saving...' : 'Create & Activate Code'}</span>
                      </button>
                    </form>

                    <div className="rounded-2xl bg-white/5 border border-white/10 p-5 space-y-3">
                      <h3 className="text-sm font-bold font-display">Active Promo Codes</h3>
                      <div className="text-xs text-zinc-400 space-y-1">
                        <div>
                          Built-in: <code className="text-white font-mono">VER-1-0XEROTV</code> (20 days + 5GB) ·{' '}
                          <code className="text-white font-mono">NEWUSER2026</code> (2 days + 2GB)
                        </div>
                      </div>
                      {promoList.length === 0 ? (
                        <p className="text-xs text-zinc-400">No custom generated codes yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {promoList.map((p) => (
                            <div
                              key={p.code}
                              className="flex items-center justify-between gap-3 rounded-xl bg-black/40 border border-white/10 px-3.5 py-2.5 text-xs"
                            >
                              <div className="space-y-0.5">
                                <div className="font-mono font-bold text-white">{p.code}</div>
                                <div className="text-zinc-400 tabular-nums">
                                  +{p.daysGranted} Days · +{formatBytes(p.storageBonusBytes)} ·{' '}
                                  {p.active ? 'Active' : 'Paused'}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await adminTogglePromoCode(adminToken, p.code, !p.active);
                                    const refreshed = await adminListPromoCodes(adminToken);
                                    setPromoList(refreshed);
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 cursor-pointer"
                                >
                                  {p.active ? 'Pause' : 'Activate'}
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Delete ${p.code}`}
                                  onClick={async () => {
                                    await adminDeletePromoCode(adminToken, p.code);
                                    const refreshed = await adminListPromoCodes(adminToken);
                                    setPromoList(refreshed);
                                  }}
                                  className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeTab === 'reports' && (
                  <div className="rounded-2xl bg-white/5 border border-white/10 p-5 space-y-3">
                    <div className="flex items-center gap-2">
                      <Bug className="w-5 h-5" />
                      <h3 className="text-base font-bold font-display">User Feedback &amp; Bug Reports</h3>
                    </div>
                    {reports.length === 0 ? (
                      <p className="text-xs text-zinc-400">No feedback or bug reports submitted yet.</p>
                    ) : (
                      <div className="space-y-2.5">
                        {reports.map((rep) => (
                          <div
                            key={rep.id}
                            className="rounded-xl bg-black/40 border border-white/10 p-3.5 space-y-1.5 text-xs"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-bold text-white flex items-center gap-2">
                                <span className="uppercase text-[10px] font-mono text-zinc-400">
                                  [{rep.category}]
                                </span>
                                <span>{rep.title}</span>
                              </div>
                              <button
                                type="button"
                                onClick={async () => {
                                  const nextStatus = rep.status === 'open' ? 'resolved' : 'open';
                                  await adminSetFeedbackStatus(adminToken, rep.id, nextStatus);
                                  const next = await fetchFeedbackReports();
                                  setReports(next);
                                }}
                                className={`px-2.5 py-1 rounded-lg font-semibold cursor-pointer ${
                                  rep.status === 'resolved'
                                    ? 'bg-emerald-500/20 text-emerald-300'
                                    : 'bg-amber-500/20 text-amber-200'
                                }`}
                              >
                                {rep.status === 'resolved' ? 'Resolved' : 'Mark Resolved'}
                              </button>
                            </div>
                            <p className="text-zinc-300 leading-relaxed">{rep.message}</p>
                            <div className="text-[11px] text-zinc-500">
                              Rating: {rep.rating}/5 · Build {rep.appVersion}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'zip' && (
                  <div className="space-y-3">
                    <div className="rounded-2xl bg-white/5 border border-white/10 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <FileArchive className="w-5 h-5" />
                          <h3 className="text-base font-bold font-display">Files &quot;ZIP&quot; — GitHub &amp; Vercel Ready</h3>
                        </div>
                        <p className="text-xs text-zinc-400">
                          Packages the full-stack XEROTV codebase (src, api, public, server.ts, vercel.json, .npmrc, .gitignore, .gitattributes, and GitHub CI) for error-free GitHub sync &amp; Vercel deployment.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleDownloadSourceZip}
                        disabled={zipBusy}
                        data-testid="download-vercel-zip-btn"
                        className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-white text-zinc-950 text-xs font-semibold whitespace-nowrap shrink-0 hover:bg-zinc-200 transition-colors cursor-pointer disabled:opacity-60"
                      >
                        <FileArchive className="w-4 h-4" />
                        <span>{zipBusy ? 'Packaging ZIP...' : 'Download Files ZIP'}</span>
                      </button>
                    </div>
                    <div className="rounded-2xl bg-white/5 border border-white/10 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="text-xs font-semibold text-zinc-200">
                          GitHub Sync Commands (Zero-Error LF + Binary Presets Included)
                        </div>
                        <code className="block text-[11px] text-zinc-400 font-mono truncate">
                          git init -b main &amp;&amp; git add . &amp;&amp; git commit -m &quot;Deploy XEROTV&quot; &amp;&amp; git push -u origin main
                        </code>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          playClickFx();
                          const cmd =
                            'git init -b main\ngit add .\ngit commit -m "Deploy XEROTV"\ngit remote add origin https://github.com/YOUR_USERNAME/xerotv.git\ngit push -u origin main';
                          navigator.clipboard?.writeText(cmd).catch(() => {});
                          setZipStatus({
                            ok: true,
                            text: 'Copied GitHub push commands to clipboard (replace YOUR_USERNAME/xerotv.git).',
                          });
                        }}
                        className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-semibold text-white whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Git Commands</span>
                      </button>
                    </div>
                    {zipStatus && (
                      <div
                        role={zipStatus.ok ? 'status' : 'alert'}
                        className={`rounded-xl px-4 py-2.5 text-xs border ${
                          zipStatus.ok
                            ? 'bg-emerald-500/10 border-emerald-400/25 text-emerald-300'
                            : 'bg-red-500/15 border-red-400/30 text-red-200'
                        }`}
                      >
                        {zipStatus.text}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
