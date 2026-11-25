// api/_app.ts
import express from "express";
import * as cheerio from "cheerio";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

// src/utils/authHelpers.ts
function normalizeAuthEmail(raw) {
  return String(raw || "").trim().replace(/[\u0000-\u001F\u007F]/g, "").toLowerCase();
}
function isValidAuthEmail(email) {
  const clean = normalizeAuthEmail(email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean) && clean.length <= 160;
}
function normalizeAuthUsername(raw) {
  return String(raw || "").trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "").slice(0, 32);
}
function sanitizeDisplayName(raw) {
  return String(raw || "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/[<>]/g, "").trim().slice(0, 50);
}
function validateRegistrationInput(input) {
  const displayName = sanitizeDisplayName(input.displayName);
  if (displayName.length < 2) {
    return { ok: false, error: "Display name must be at least 2 characters." };
  }
  const email = normalizeAuthEmail(input.email);
  if (!isValidAuthEmail(email)) {
    return { ok: false, error: "Please enter a valid email address." };
  }
  const password = String(input.password || "");
  if (password.length < 6) {
    return { ok: false, error: "Password must be at least 6 characters." };
  }
  if (password.length > 128) {
    return { ok: false, error: "Password must be 128 characters or fewer." };
  }
  if (input.confirmPassword !== void 0 && password !== String(input.confirmPassword)) {
    return { ok: false, error: "Passwords do not match." };
  }
  const emailLocal = email.split("@")[0] || "member";
  const username = normalizeAuthUsername(displayName) || normalizeAuthUsername(emailLocal) || "member";
  return {
    ok: true,
    displayName,
    username,
    email,
    password
  };
}
function validateLoginInput(input) {
  const identifier = String(input.identifier || "").trim().toLowerCase();
  if (identifier.length < 2 || identifier.length > 160) {
    return { ok: false, error: "Please enter your email address or username." };
  }
  const password = String(input.password || "");
  if (!password) {
    return { ok: false, error: "Please enter your password." };
  }
  return { ok: true, identifier, password };
}

// src/utils/security.ts
function sanitizePlainText(input, maxLength = 500) {
  return String(input || "").replace(/[\u0000-\u001F\u007F<>]/g, "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}
function sanitizePromoCode(input) {
  return String(input || "").toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32);
}

// src/utils/subscription.ts
var TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1e3;
var THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1e3;
var SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1e3;
var ONE_DAY_MS = 24 * 60 * 60 * 1e3;
var TWO_GB_BYTES = 2 * 1024 * 1024 * 1024;
var FIVE_GB_BYTES = 5 * 1024 * 1024 * 1024;
var ONE_GB_BYTES = 1024 * 1024 * 1024;
var ONE_TB_BYTES = 1024 * 1024 * 1024 * 1024;
var BUILT_IN_PROMO_CODES = {
  NEWUSER2026: { daysGranted: 2, storageBonusBytes: TWO_GB_BYTES },
  "VER-1-0XEROTV": { daysGranted: 20, storageBonusBytes: FIVE_GB_BYTES }
};
var SUBSCRIPTION_PLANS = {
  DOWNLOAD_2M: {
    id: "download_2m",
    name: "Offline Download Access",
    pricePesos: 500,
    durationLabel: "2 Months (60 Days)",
    description: "Unlock real offline movie downloads for web shortcut and mobile app."
  },
  STORAGE_1TB: {
    id: "storage_1tb",
    name: "1TB Permanent Vault Storage",
    pricePesos: 1090,
    durationLabel: "Permanent Storage",
    description: "Upgrade your offline vault capacity to 1TB permanently."
  },
  XEROSTAR: {
    id: "xerostar",
    name: "XEROSTAR VIP (XeroHots)",
    pricePesos: 150,
    durationLabel: "30 Days VIP Access",
    description: "Unlocks PIN-protected XeroHots 18+ video channels with open-source multi-provider streams."
  }
};
function generateShortUserId(uid) {
  let hash = 2166136261;
  for (let i = 0; i < uid.length; i++) {
    hash ^= uid.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const suffix = (hash >>> 0).toString(36).toUpperCase().padStart(6, "0");
  const tail = uid.replace(/[^a-zA-Z0-9]/g, "").slice(0, 3).toUpperCase().padEnd(3, "X");
  return `XTV-${tail}${suffix}`.slice(0, 14);
}
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, exp);
  return `${val >= 100 || exp === 0 ? val.toFixed(0) : val.toFixed(2)} ${units[exp]}`;
}
function calculateRedemptionUpdate(account, rawCode, nowMs = Date.now(), customPromo) {
  const code = rawCode.trim().toUpperCase();
  if (!code) {
    return { ok: false, error: "Please enter a redeem code." };
  }
  if (account.redeemedCodes.includes(code)) {
    return { ok: false, error: "This code is already redeemed." };
  }
  let reward = null;
  if (BUILT_IN_PROMO_CODES[code]) {
    reward = BUILT_IN_PROMO_CODES[code];
  } else if (customPromo && customPromo.code.toUpperCase() === code && customPromo.active) {
    reward = {
      daysGranted: Math.max(0, Math.min(3650, Math.floor(customPromo.daysGranted || 0))),
      storageBonusBytes: Math.max(0, Math.min(ONE_TB_BYTES, Math.floor(customPromo.storageBonusBytes || 0)))
    };
  }
  if (!reward) {
    return { ok: false, error: "Invalid or expired promo code." };
  }
  const baseExpiry = Math.max(account.downloadExpiresAtMs || 0, nowMs);
  const nextExpiry = baseExpiry + reward.daysGranted * ONE_DAY_MS;
  const nextQuota = (account.storageQuotaBytes || 0) + reward.storageBonusBytes;
  const nextDownloadTier = account.downloadTier === "free" && reward.daysGranted > 0 ? "trial_2d" : account.downloadTier;
  const nextStorageTier = account.storageTier === "none" && reward.storageBonusBytes > 0 ? "bonus_2gb" : account.storageTier;
  return {
    ok: true,
    code,
    daysGranted: reward.daysGranted,
    storageBonusBytes: reward.storageBonusBytes,
    patch: {
      downloadTier: nextDownloadTier,
      downloadExpiresAtMs: nextExpiry,
      storageTier: nextStorageTier,
      storageQuotaBytes: nextQuota,
      redeemedCodes: [...account.redeemedCodes, code],
      grantedBy: `code:${code}`
    }
  };
}
function calculateGrantAmountPesos(grantType) {
  switch (grantType) {
    case "download_2m":
      return SUBSCRIPTION_PLANS.DOWNLOAD_2M.pricePesos;
    case "storage_1tb":
      return SUBSCRIPTION_PLANS.STORAGE_1TB.pricePesos;
    case "bundle_2m_1tb":
      return SUBSCRIPTION_PLANS.DOWNLOAD_2M.pricePesos + SUBSCRIPTION_PLANS.STORAGE_1TB.pricePesos;
    case "xerostar":
      return SUBSCRIPTION_PLANS.XEROSTAR.pricePesos;
    default:
      return 0;
  }
}
function calculateAdminGrantUpdate(account, grantType, customDays = 30, nowMs = Date.now()) {
  if (grantType === "revoke") {
    return {
      downloadTier: "free",
      downloadExpiresAtMs: 0,
      storageTier: "none",
      storageQuotaBytes: 0,
      xerostarActive: false,
      xerostarExpiresAtMs: 0,
      grantedBy: "admin:revoked"
    };
  }
  if (grantType === "xerostar") {
    const baseXeroStarExpiry = Math.max(account.xerostarExpiresAtMs || 0, nowMs);
    return {
      downloadTier: account.downloadTier,
      downloadExpiresAtMs: account.downloadExpiresAtMs,
      storageTier: account.storageTier,
      storageQuotaBytes: account.storageQuotaBytes,
      xerostarActive: true,
      xerostarExpiresAtMs: baseXeroStarExpiry + THIRTY_DAYS_MS,
      grantedBy: "admin:xerostar"
    };
  }
  if (grantType === "download_2m") {
    const baseExpiry2 = Math.max(account.downloadExpiresAtMs || 0, nowMs);
    return {
      downloadTier: "download_2m",
      downloadExpiresAtMs: baseExpiry2 + SIXTY_DAYS_MS,
      storageTier: account.storageTier === "none" ? "bonus_2gb" : account.storageTier,
      storageQuotaBytes: Math.max(account.storageQuotaBytes || 0, 10 * 1024 * 1024 * 1024),
      xerostarActive: Boolean(account.xerostarActive),
      xerostarExpiresAtMs: account.xerostarExpiresAtMs || 0,
      grantedBy: "admin:download_2m"
    };
  }
  if (grantType === "storage_1tb") {
    return {
      downloadTier: account.downloadTier,
      downloadExpiresAtMs: account.downloadExpiresAtMs,
      storageTier: "permanent_1tb",
      storageQuotaBytes: Math.max(account.storageQuotaBytes || 0, ONE_TB_BYTES),
      xerostarActive: Boolean(account.xerostarActive),
      xerostarExpiresAtMs: account.xerostarExpiresAtMs || 0,
      grantedBy: "admin:storage_1tb"
    };
  }
  if (grantType === "bundle_2m_1tb") {
    const baseExpiry2 = Math.max(account.downloadExpiresAtMs || 0, nowMs);
    return {
      downloadTier: "download_2m",
      downloadExpiresAtMs: baseExpiry2 + SIXTY_DAYS_MS,
      storageTier: "permanent_1tb",
      storageQuotaBytes: Math.max(account.storageQuotaBytes || 0, ONE_TB_BYTES),
      xerostarActive: true,
      xerostarExpiresAtMs: Math.max(account.xerostarExpiresAtMs || 0, nowMs) + THIRTY_DAYS_MS,
      grantedBy: "admin:bundle_2m_1tb"
    };
  }
  const safeDays = Math.max(1, Math.min(3650, Math.floor(customDays || 30)));
  const baseExpiry = Math.max(account.downloadExpiresAtMs || 0, nowMs);
  return {
    downloadTier: "download_2m",
    downloadExpiresAtMs: baseExpiry + safeDays * ONE_DAY_MS,
    storageTier: account.storageTier === "none" ? "bonus_2gb" : account.storageTier,
    storageQuotaBytes: Math.max(account.storageQuotaBytes || 0, TWO_GB_BYTES),
    xerostarActive: Boolean(account.xerostarActive),
    xerostarExpiresAtMs: account.xerostarExpiresAtMs || 0,
    grantedBy: `admin:custom_${safeDays}d`
  };
}

// src/utils/cinemaStreams.ts
var VERIFIED_OPEN_CINEMA_CATALOG = [
  {
    id: "sintel",
    label: "Sintel Open Cinema",
    url: "https://archive.org/download/Sintel/sintel-2048-stereo_512kb.mp4",
    kind: "animation"
  },
  {
    id: "elephants-dream",
    label: "Elephants Dream HD",
    url: "https://archive.org/download/ElephantsDream/ed_1024_512kb.mp4",
    kind: "scifi"
  },
  {
    id: "superman-1941",
    label: "Superman Classic 1941",
    url: "https://archive.org/download/superman_1941/superman_1941_512kb.mp4",
    kind: "animation"
  },
  {
    id: "twilight-zone",
    label: "Twilight Zone Classic Series",
    url: "https://archive.org/download/the-twilight-zone-1959-s-01-e-00-original-pilot/The%20Twilight%20Zone%201959%20S01E29%20Nightmare%20as%20a%20Child.mp4",
    kind: "series"
  },
  {
    id: "child-scifi",
    label: "CHILD Sci-Fi Thriller",
    url: "https://archive.org/download/CHILD/CHILD_512kb.mp4",
    kind: "scifi"
  },
  {
    id: "sita-blues",
    label: "Sita Sings the Blues",
    url: "https://archive.org/download/Sita_Sings_the_Blues/Sita_Sings_the_Blues_DVD_NTSC4.mp4",
    kind: "animation"
  },
  {
    id: "lone-ranger",
    label: "The Lone Ranger Classic TV",
    url: "https://archive.org/download/theloneranger_201705/s01e13_finderskeepers.mp4",
    kind: "series"
  },
  {
    id: "popeye-president",
    label: "Popeye for President",
    url: "https://archive.org/download/Popeye_forPresident/Popeye_forPresident_512kb.mp4",
    kind: "classic"
  },
  {
    id: "pied-piper",
    label: "The Pied Piper of Hamelin",
    url: "https://archive.org/download/The_Pied_Piper_of_Hamelin/pied_512kb.mp4",
    kind: "classic"
  },
  {
    id: "travel-panorama",
    label: "Hanoi & Ha Long Panorama",
    url: "https://archive.org/download/vietnam-travel-guide-hanoi-ha-long-bay-ho-chi-minh-1_202101/Vietnam%20Travel%20Guide_%20Hanoi,%20Ha%20Long%20Bay,%20Ho%20Chi%20Minh1.ia.mp4",
    kind: "documentary"
  },
  {
    id: "popeye-private-eye",
    label: "Private Eye Popeye",
    url: "https://archive.org/download/popeye_private_eye_popeye/popeye_private_eye_popeye_512kb.mp4",
    kind: "classic"
  },
  {
    id: "popeye-patriotic",
    label: "Patriotic Popeye",
    url: "https://archive.org/download/popeye_patriotic_popeye/popeye_patriotic_popeye_512kb.mp4",
    kind: "classic"
  },
  {
    id: "popeye-shuteye",
    label: "Shuteye Popeye",
    url: "https://archive.org/download/popeye_shuteye_popeye/popeye_shuteye_popeye_512kb.mp4",
    kind: "classic"
  },
  {
    id: "popeye-mystery",
    label: "Popeye Mystery",
    url: "https://archive.org/download/popeye_i_dont_scare/popeye_i_dont_scare_512kb.mp4",
    kind: "classic"
  },
  {
    id: "flower-cc0",
    label: "Botanical CC0 Reel",
    url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    kind: "documentary"
  },
  {
    id: "big-buck-bunny",
    label: "Big Buck Bunny 720p",
    url: "https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4",
    kind: "animation"
  }
];
function hashTitleMediaSeed(mediaType, tmdbId, title) {
  const input = `${mediaType}:${tmdbId}:${title.trim().toLowerCase()}`;
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return h >>> 0;
}
function selectOrderedOpenStreams(params) {
  const total = VERIFIED_OPEN_CINEMA_CATALOG.length;
  const startIdx = typeof params.preferredMirror === "number" && Number.isFinite(params.preferredMirror) && params.preferredMirror >= 0 && params.preferredMirror < total ? Math.floor(params.preferredMirror) : hashTitleMediaSeed(params.mediaType || "movie", params.tmdbId, params.title || "") % total;
  const isCompact = params.quality === "standard";
  const ordered = [];
  for (let offset = 0; offset < total; offset++) {
    const idx = (startIdx + offset) % total;
    const entry = VERIFIED_OPEN_CINEMA_CATALOG[idx];
    if (isCompact && entry.id === "big-buck-bunny" && offset === 0) {
      continue;
    }
    ordered.push({ ...entry, mirrorIndex: idx });
  }
  if (ordered.length < total) {
    const idx = VERIFIED_OPEN_CINEMA_CATALOG.findIndex((e) => e.id === "big-buck-bunny");
    if (idx >= 0) {
      ordered.push({ ...VERIFIED_OPEN_CINEMA_CATALOG[idx], mirrorIndex: idx });
    }
  }
  return ordered;
}
function isAllowedCinemaArchiveUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return host === "archive.org" || host.endsWith(".archive.org") || host === "interactive-examples.mdn.mozilla.net";
  } catch {
    return false;
  }
}

// src/utils/xerohots.ts
var XEROHOTS_SORT_OPTIONS = [
  { id: "trending", label: "Trending" },
  { id: "popular", label: "Most Popular" },
  { id: "top-rated", label: "Top Rated" },
  { id: "newest", label: "Newest" },
  { id: "longest", label: "Longest" }
];
var UNIFIED_CATEGORIES = [
  { id: "all", label: "All Featured", query: "" },
  { id: "hd", label: "4K & Ultra HD", query: "hd 4k", epornerSlug: "4k-uhd", pornhubCatId: "38", xhamsterSlug: "hd-videos", hentaicitySlug: "hd", xvideosSlug: "hd" },
  { id: "amateur", label: "Amateur", query: "amateur", epornerSlug: "amateur", pornhubCatId: "3", xhamsterSlug: "amateur", hentaicitySlug: "amateur", xvideosSlug: "amateur" },
  { id: "milf", label: "MILF", query: "milf", epornerSlug: "milf", pornhubCatId: "29", xhamsterSlug: "milf", xvideosSlug: "milf" },
  { id: "asian", label: "Asian", query: "asian", epornerSlug: "asian", pornhubCatId: "1", xhamsterSlug: "asian", xvideosSlug: "asian" },
  { id: "japanese", label: "Japanese / JAV", query: "japanese", epornerSlug: "japanese", pornhubCatId: "111", xhamsterSlug: "japanese", xvideosSlug: "japanese" },
  { id: "hentai", label: "Hentai / Anime", query: "hentai", epornerSlug: "hentai", pornhubCatId: "36", xhamsterSlug: "hentai", hentaicitySlug: "hentai", xvideosSlug: "hentai" },
  { id: "pov", label: "POV", query: "pov", epornerSlug: "pov", pornhubCatId: "41", xhamsterSlug: "pov", xvideosSlug: "pov" },
  { id: "teen", label: "Teen 18+", query: "teen", epornerSlug: "teens", pornhubCatId: "37", xhamsterSlug: "teens", xvideosSlug: "teen" },
  { id: "big-tits", label: "Big Tits", query: "big tits", epornerSlug: "big-tits", pornhubCatId: "8", xhamsterSlug: "big-boobs", xvideosSlug: "big-tits" },
  { id: "anal", label: "Anal", query: "anal", epornerSlug: "anal", pornhubCatId: "35", xhamsterSlug: "anal", xvideosSlug: "anal" },
  { id: "lesbian", label: "Lesbian", query: "lesbian", epornerSlug: "lesbian", pornhubCatId: "27", xhamsterSlug: "lesbian", xvideosSlug: "lesbian" },
  { id: "latina", label: "Latina", query: "latina", epornerSlug: "latina", pornhubCatId: "26", xhamsterSlug: "latina", xvideosSlug: "latina" },
  { id: "ebony", label: "Ebony", query: "ebony", epornerSlug: "ebony", pornhubCatId: "17", xhamsterSlug: "ebony", xvideosSlug: "ebony" },
  { id: "cosplay", label: "Cosplay", query: "cosplay", epornerSlug: "cosplay", pornhubCatId: "241", xhamsterSlug: "cosplay", hentaicitySlug: "cosplay", xvideosSlug: "cosplay" },
  { id: "threesome", label: "Threesome", query: "threesome", epornerSlug: "threesome", pornhubCatId: "65", xhamsterSlug: "threesomes", xvideosSlug: "threesome" },
  { id: "massage", label: "Massage", query: "massage", epornerSlug: "massage", pornhubCatId: "78", xhamsterSlug: "massage", xvideosSlug: "massage" },
  { id: "solo", label: "Solo Girl", query: "solo", epornerSlug: "solo", pornhubCatId: "492", xhamsterSlug: "masturbation", xvideosSlug: "solo" }
];
var PROVIDER_EXTRA_CATEGORIES = {
  eporner: [
    { id: "ep-60fps", label: "60 FPS Smooth", query: "60fps", epornerSlug: "60fps" },
    { id: "ep-hqporn", label: "HQ Studios", query: "hqporn", epornerSlug: "hqporn" },
    { id: "ep-vr", label: "VR Porn", query: "vr", epornerSlug: "vr-porn" },
    { id: "ep-uncensored", label: "Uncensored", query: "uncensored", epornerSlug: "uncensored" }
  ],
  pornhub: [
    { id: "ph-verified", label: "Verified Amateurs", query: "verified amateur", pornhubCatId: "138" },
    { id: "ph-romantic", label: "Romantic", query: "romantic", pornhubCatId: "522" },
    { id: "ph-pinay", label: "Pinay / Filipino", query: "pinay" },
    { id: "ph-korean", label: "Korean", query: "korean" }
  ],
  xhamster: [
    { id: "xh-trending", label: "Homemade", query: "homemade", xhamsterSlug: "homemade" },
    { id: "xh-casting", label: "Casting", query: "casting", xhamsterSlug: "casting" },
    { id: "xh-stepmom", label: "Step Family", query: "stepmom", xhamsterSlug: "milf" },
    { id: "xh-fullhd", label: "1080p Full HD", query: "1080p", xhamsterSlug: "hd-videos" }
  ],
  hentaicity: [
    { id: "hc-uncensored", label: "Uncensored Hentai", query: "uncensored hentai", hentaicitySlug: "uncensored" },
    { id: "hc-3d", label: "3D / SFM", query: "3d hentai", hentaicitySlug: "3d" },
    { id: "hc-milf", label: "Hentai MILF", query: "milf hentai", hentaicitySlug: "milf" },
    { id: "hc-elf", label: "Fantasy & Elf", query: "elf hentai", hentaicitySlug: "fantasy" },
    { id: "hc-school", label: "Anime Academy", query: "anime school", hentaicitySlug: "school" }
  ],
  xvideos: [
    { id: "xv-best", label: "XVideos Hits", query: "best", xvideosSlug: "best" },
    { id: "xv-pinay", label: "Pinay", query: "pinay" },
    { id: "xv-creampie", label: "Creampie", query: "creampie", xvideosSlug: "creampie" },
    { id: "xv-squirt", label: "Squirt", query: "squirt", xvideosSlug: "squirt" }
  ],
  xnxx: [
    { id: "xn-hits", label: "XNXX Hits", query: "hits" },
    { id: "xn-best", label: "Best Videos", query: "best" },
    { id: "xn-pinay", label: "Pinay", query: "pinay" },
    { id: "xn-creampie", label: "Creampie", query: "creampie" }
  ]
};
function getCategoriesForProvider(provider) {
  const extras = PROVIDER_EXTRA_CATEGORIES[provider] || [];
  if (provider === "hentaicity") {
    return [
      UNIFIED_CATEGORIES[0],
      ...extras,
      ...UNIFIED_CATEGORIES.filter((c) => ["hentai", "cosplay", "asian", "japanese", "big-tits", "lesbian"].includes(c.id))
    ];
  }
  if (extras.length === 0) {
    return UNIFIED_CATEGORIES;
  }
  return [UNIFIED_CATEGORIES[0], ...extras, ...UNIFIED_CATEGORIES.slice(1)];
}
function findCategoryById(provider, categoryId) {
  const clean = String(categoryId || "").trim().toLowerCase();
  if (!clean || clean === "all") return null;
  const list = getCategoriesForProvider(provider);
  return list.find((c) => c.id === clean) || UNIFIED_CATEGORIES.find((c) => c.id === clean) || null;
}
var ALLOWED_PROVIDER_HOST_SUFFIXES = [
  "eporner.com",
  "pornhub.com",
  "pornhub.org",
  "phncdn.com",
  "xhamster.com",
  "xhcdn.com",
  "xheve2.com",
  "hentaicity.com",
  "xvideos.com",
  "xvideos-cdn.com",
  "xnxx.com",
  "xnxx-cdn.com",
  "spankbang.com",
  "spankbang.party",
  "sb-cd.com"
];
function isPrivateOrLoopbackHost(hostname) {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}
function isAllowedXeroHotsUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const host = parsed.hostname.toLowerCase();
    if (isPrivateOrLoopbackHost(host)) return false;
    return ALLOWED_PROVIDER_HOST_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`)
    );
  } catch {
    return false;
  }
}
function normalizeExternalThumbUrl(raw) {
  const s = String(raw || "").trim();
  if (!s || s.startsWith("data:")) return "";
  if (s.startsWith("//")) return `https:${s}`;
  return s;
}

// api/_app.ts
var execFileAsync = promisify(execFile);
var DEFAULT_SHARED_APP_URL = "https://xerotv.vercel.app";
function normalizeFallbackUrl(raw) {
  try {
    const u = new URL(raw.trim());
    if (u.hostname.toLowerCase().startsWith("ais-dev-")) {
      u.hostname = `ais-pre-${u.hostname.slice("ais-dev-".length)}`;
    }
    return u.origin.replace(/\/+$/, "");
  } catch {
    return DEFAULT_SHARED_APP_URL;
  }
}
function resolvePublicAppOrigin(rawOrigin, fallbackPublicUrl = DEFAULT_SHARED_APP_URL) {
  const safeFallback = normalizeFallbackUrl(fallbackPublicUrl);
  const candidate = (rawOrigin || "").trim();
  if (!candidate) {
    return safeFallback;
  }
  let parsed;
  try {
    parsed = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
  } catch {
    return safeFallback;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return safeFallback;
  }
  let hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0") {
    return safeFallback;
  }
  if (hostname.startsWith("ais-dev-")) {
    hostname = `ais-pre-${hostname.slice("ais-dev-".length)}`;
  }
  const portPart = parsed.port ? `:${parsed.port}` : "";
  return `${parsed.protocol}//${hostname}${portPart}`.replace(/\/+$/, "");
}
async function createZipArchiver() {
  const archiverPkg = await import("archiver");
  const pkg = archiverPkg;
  const resolved = pkg?.default ?? pkg;
  if (resolved && resolved.ZipArchive) {
    return new resolved.ZipArchive({ zlib: { level: 9 } });
  }
  if (typeof resolved === "function") {
    return resolved("zip", { zlib: { level: 9 } });
  }
  throw new Error("Zip archiver module did not resolve to a callable factory.");
}
function appendFilteredDirectory(archive, diskDir, zipPrefix, skipSubdirs = []) {
  const entries = fs.readdirSync(diskDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".DS_Store") || entry.name.endsWith(".idsig")) continue;
    if (skipSubdirs.includes(entry.name)) continue;
    const diskPath = path.join(diskDir, entry.name);
    const zipPath = `${zipPrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      appendFilteredDirectory(archive, diskPath, zipPath);
    } else if (entry.isFile()) {
      archive.file(diskPath, { name: zipPath });
    }
  }
}
var TMDB_BASE_URL = "https://api.themoviedb.org/3";
var DEFAULT_TMDB_READ_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiIyM2JmYjg4ZmRkMGYyYWIyZDViZTdkN2JhYjAwNDA2NSIsIm5iZiI6MTc5NDQ5NzA2MC42MjQsInN1YiI6IjZhZjVkYTI0NzNhYmYxYzg5YjJiZGZmYSIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.ygPWQOs_w9L5obHG6T36n5Y03AAHsoMC_WnL1GEnfqw";
var DEFAULT_TMDB_API_KEY = "23bfb88fdd0f2ab2d5be7d7bab004065";
var STABLE_DEPLOY_SEED = process.env.SESSION_SECRET || process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_ACCESS_CODE || `${process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_PROJECT_ID || process.env.HOSTNAME || "xerotv.vercel.app"}:xianinproduction-v1-key`;
var ADMIN_SECRET_SIGNING_KEY = crypto.createHash("sha256").update(STABLE_DEPLOY_SEED).digest();
var LOCAL_FALLBACK_MIRROR_INDEX = 999;
var MAX_CHUNK_BYTES = 1572864;
var STUDIO_QUERIES = {
  netflix: {
    name: "Netflix",
    tvParams: { with_networks: "213", sort_by: "popularity.desc" },
    movieParams: { with_watch_providers: "8", watch_region: "US", sort_by: "popularity.desc" }
  },
  disney: {
    name: "Disney+",
    tvParams: { with_networks: "2739", sort_by: "popularity.desc" },
    movieParams: { with_watch_providers: "337", watch_region: "US", sort_by: "popularity.desc" }
  },
  hbo: {
    name: "HBO / Max",
    tvParams: { with_networks: "49|3186", sort_by: "popularity.desc" },
    movieParams: { with_watch_providers: "1899|384", watch_region: "US", sort_by: "popularity.desc" }
  },
  apple: {
    name: "Apple TV+",
    tvParams: { with_networks: "2552", sort_by: "popularity.desc" },
    movieParams: { with_watch_providers: "350", watch_region: "US", sort_by: "popularity.desc" }
  },
  prime: {
    name: "Prime Video",
    tvParams: { with_networks: "1024", sort_by: "popularity.desc" },
    movieParams: { with_watch_providers: "9|119", watch_region: "US", sort_by: "popularity.desc" }
  },
  marvel: {
    name: "Marvel Studios",
    movieParams: { with_companies: "420", sort_by: "popularity.desc" },
    tvParams: { with_companies: "420|13252", sort_by: "popularity.desc" }
  },
  pixar: {
    name: "Pixar",
    movieParams: { with_companies: "3", sort_by: "popularity.desc" },
    tvParams: { with_companies: "3", sort_by: "popularity.desc" }
  },
  warner: {
    name: "Warner Bros.",
    movieParams: { with_companies: "174", sort_by: "popularity.desc" },
    tvParams: { with_companies: "1957|174", sort_by: "popularity.desc" }
  },
  a24: {
    name: "A24",
    movieParams: { with_companies: "41077", sort_by: "popularity.desc" },
    tvParams: { with_companies: "41077", sort_by: "popularity.desc" }
  }
};
function parseContentRangeTotal(headerValue) {
  if (!headerValue) return 0;
  const slashIdx = headerValue.lastIndexOf("/");
  if (slashIdx === -1) return 0;
  const total = Number(headerValue.slice(slashIdx + 1).trim());
  return Number.isFinite(total) && total > 0 ? total : 0;
}
var STREAM_BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9"
};
async function probeSingleStreamMirror(url, mirrorIndex, timeoutMs, label = "XEROTV Stream") {
  const probe = await fetch(url, {
    redirect: "follow",
    headers: { ...STREAM_BROWSER_HEADERS, Range: "bytes=0-0" },
    signal: AbortSignal.timeout(timeoutMs)
  });
  const contentType = (probe.headers.get("content-type") || "video/mp4").toLowerCase();
  if (!probe.ok && probe.status !== 206 || contentType.includes("text/html") || contentType.includes("application/json") || contentType.includes("mpegurl")) {
    await probe.body?.cancel().catch(() => {
    });
    throw new Error(`Invalid stream mirror (${probe.status})`);
  }
  const totalFromRange = parseContentRangeTotal(probe.headers.get("content-range"));
  const totalFromLength = Number(probe.headers.get("content-length") || 0);
  const totalBytes = totalFromRange || (probe.status === 200 ? totalFromLength : 0);
  await probe.body?.cancel().catch(() => {
  });
  if (totalBytes <= 0) {
    throw new Error("Zero byte length");
  }
  return {
    url,
    mirrorIndex,
    totalBytes,
    contentType: contentType.includes("webm") ? "video/webm" : "video/mp4",
    label
  };
}
function getLocalImprovingMp4Path() {
  const videoPath = path.resolve(process.cwd(), "public", "media", "improving-v1.mp4");
  return fs.existsSync(videoPath) ? videoPath : null;
}
var streamMetaCache = /* @__PURE__ */ new Map();
async function searchTitleMatchArchiveMp4(title, quality) {
  const cleanWords = title.replace(/[^a-zA-Z0-9\s]+/g, " ").trim().split(/\s+/).filter((w) => w.length >= 4).slice(0, 3);
  if (cleanWords.length === 0) return null;
  try {
    const query = `mediatype:movies AND format:MPEG4 AND -collection:adult AND -subject:nsfw AND title:(${cleanWords.join(" ")})`;
    const searchUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(
      query
    )}&fl[]=identifier,title&sort[]=downloads+desc&rows=4&page=1&output=json`;
    const r = await fetch(searchUrl, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return null;
    const j = await r.json();
    const topDoc = (j.response?.docs || [])[0];
    if (!topDoc?.identifier) return null;
    const metaRes = await fetch(
      `https://archive.org/metadata/${encodeURIComponent(topDoc.identifier)}/files`,
      { signal: AbortSignal.timeout(1500) }
    );
    if (!metaRes.ok) return null;
    const metaJson = await metaRes.json();
    const maxBytes = quality === "standard" ? 45e6 : 95e6;
    const mp4s = (metaJson.result || []).filter(
      (f) => f.name && f.name.endsWith(".mp4") && Number(f.size) > 15e5 && Number(f.size) <= maxBytes
    );
    if (mp4s.length === 0) return null;
    mp4s.sort((a, b) => Number(a.size) - Number(b.size));
    const url = `https://archive.org/download/${encodeURIComponent(topDoc.identifier)}/${encodeURI(mp4s[0].name)}`;
    if (!isAllowedCinemaArchiveUrl(url)) return null;
    return { url, label: String(topDoc.title || cleanWords.join(" ")) };
  } catch {
    return null;
  }
}
async function resolveWorkingStreamMeta(params) {
  if (params.directUrl && isAllowedXeroHotsUrl(params.directUrl)) {
    try {
      return await probeSingleStreamMirror(params.directUrl, 888, 3500, params.title || "XeroHots MP4");
    } catch {
    }
  }
  const ordered = selectOrderedOpenStreams({
    tmdbId: params.tmdbId,
    mediaType: params.mediaType,
    title: params.title,
    quality: params.quality,
    preferredMirror: params.preferredMirror
  });
  const primaryIdx = ordered[0].mirrorIndex;
  const cacheKey = `${params.mediaType}:${params.tmdbId}:${params.quality}:${primaryIdx}`;
  const cached = streamMetaCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  if (params.mediaType !== "xerohots" && params.title && params.preferredMirror === void 0) {
    const archiveHit = await searchTitleMatchArchiveMp4(params.title, params.quality);
    if (archiveHit) {
      try {
        const found = await probeSingleStreamMirror(
          archiveHit.url,
          primaryIdx,
          2e3,
          archiveHit.label
        );
        streamMetaCache.set(cacheKey, { value: found, expiresAt: Date.now() + 18e4 });
        return found;
      } catch {
      }
    }
  }
  for (let attempt = 0; attempt < Math.min(4, ordered.length); attempt++) {
    const candidate = ordered[attempt];
    try {
      const found = await probeSingleStreamMirror(
        candidate.url,
        candidate.mirrorIndex,
        2400,
        candidate.label
      );
      if (streamMetaCache.size > 300) {
        const oldest = streamMetaCache.keys().next().value;
        if (oldest) streamMetaCache.delete(oldest);
      }
      streamMetaCache.set(cacheKey, { value: found, expiresAt: Date.now() + 18e4 });
      return found;
    } catch {
    }
  }
  const localPath = getLocalImprovingMp4Path();
  if (localPath) {
    const stat = fs.statSync(localPath);
    if (stat.size > 0) {
      return {
        url: localPath,
        mirrorIndex: LOCAL_FALLBACK_MIRROR_INDEX,
        totalBytes: stat.size,
        contentType: "video/mp4",
        label: "XEROTV Local Stream"
      };
    }
  }
  if (params.reqOrigin && /^https?:\/\//i.test(params.reqOrigin)) {
    try {
      return await probeSingleStreamMirror(
        `${params.reqOrigin.replace(/\/+$/, "")}/media/improving-v1.mp4`,
        LOCAL_FALLBACK_MIRROR_INDEX,
        3e3,
        "XEROTV Stream"
      );
    } catch {
    }
  }
  return null;
}
function resolvePublicOrigin(req) {
  const vercelHost = (process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || "").trim();
  const vercelOrigin = vercelHost ? `https://${vercelHost.replace(/^https?:\/\//i, "")}` : "";
  const defaultPublic = resolvePublicAppOrigin(
    process.env.PUBLIC_APP_URL || process.env.SHARED_APP_URL || vercelOrigin || process.env.APP_URL,
    DEFAULT_SHARED_APP_URL
  );
  const queryOrigin = typeof req.query.origin === "string" ? req.query.origin.trim() : "";
  if (queryOrigin && /^https?:\/\/[a-zA-Z0-9._:-]+$/i.test(queryOrigin)) {
    return resolvePublicAppOrigin(queryOrigin, defaultPublic);
  }
  const envUrl = (process.env.APP_URL || "").trim();
  if (envUrl && envUrl !== "MY_APP_URL" && /^https?:\/\//i.test(envUrl)) {
    return resolvePublicAppOrigin(envUrl, defaultPublic);
  }
  const forwardedProto = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
  const proto = forwardedProto === "https" || forwardedProto === "http" ? forwardedProto : req.protocol || "https";
  const host = String(req.get("x-forwarded-host") || req.get("host") || "").split(",")[0].trim();
  return host ? resolvePublicAppOrigin(`${proto}://${host}`, defaultPublic) : defaultPublic;
}
function getTmdbAuth() {
  return {
    token: process.env.TMDB_READ_TOKEN || DEFAULT_TMDB_READ_TOKEN,
    apiKey: process.env.TMDB_API_KEY || DEFAULT_TMDB_API_KEY
  };
}
var tmdbServerCache = /* @__PURE__ */ new Map();
var tmdbInFlight = /* @__PURE__ */ new Map();
async function tmdbFetch(endpoint, params = {}, ttlMs = 5 * 60 * 1e3) {
  const { token, apiKey } = getTmdbAuth();
  const url = new URL(`${TMDB_BASE_URL}${endpoint}`);
  url.searchParams.set("language", "en-US");
  const sortedEntries = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
  for (const [k, v] of sortedEntries) {
    url.searchParams.set(k, String(v));
  }
  const cacheKey = url.toString();
  const cached = tmdbServerCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }
  const inflight = tmdbInFlight.get(cacheKey);
  if (inflight) {
    return inflight;
  }
  if (!token) {
    url.searchParams.set("api_key", apiKey);
  }
  const reqPromise = (async () => {
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        ...token ? { Authorization: `Bearer ${token}` } : {}
      },
      signal: AbortSignal.timeout(1e4)
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`TMDB API ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    if (tmdbServerCache.size > 300) {
      const oldestKey = tmdbServerCache.keys().next().value;
      if (oldestKey) tmdbServerCache.delete(oldestKey);
    }
    tmdbServerCache.set(cacheKey, { data: json, expiresAt: Date.now() + ttlMs });
    return json;
  })();
  tmdbInFlight.set(cacheKey, reqPromise);
  try {
    return await reqPromise;
  } finally {
    tmdbInFlight.delete(cacheKey);
  }
}
function createAdminToken() {
  const exp = Date.now() + 12 * 60 * 60 * 1e3;
  const payload = Buffer.from(JSON.stringify({ role: "admin", exp })).toString("base64url");
  const sig = crypto.createHmac("sha256", ADMIN_SECRET_SIGNING_KEY).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
function verifyAdminToken(token) {
  if (!token || !token.includes(".")) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expectedSig = crypto.createHmac("sha256", ADMIN_SECRET_SIGNING_KEY).update(payload).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return parsed.role === "admin" && typeof parsed.exp === "number" && parsed.exp > Date.now();
  } catch {
    return false;
  }
}
function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}
function getAdminTokenFromReq(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  const cookies = parseCookies(req);
  return cookies.xtv_admin_session;
}
function getClientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || req.ip || "unknown";
}
function signHmacPayload(obj) {
  const payload = Buffer.from(JSON.stringify(obj)).toString("base64url");
  const sig = crypto.createHmac("sha256", ADMIN_SECRET_SIGNING_KEY).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
function verifyHmacPayload(token) {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expectedSig = crypto.createHmac("sha256", ADMIN_SECRET_SIGNING_KEY).update(payload).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof parsed.exp === "number" && parsed.exp <= Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
var STORE_FILE_PATH = process.env.XEROTV_STORE_PATH || "/tmp/xerotv-store.json";
function createEmptyStore() {
  return {
    users: {},
    shortIdToUid: {},
    promoCodes: {},
    presence: {},
    feedbackReports: [],
    totalEarningsPesos: 0
  };
}
var inMemoryStore = null;
function readStore() {
  if (inMemoryStore) return inMemoryStore;
  try {
    if (fs.existsSync(STORE_FILE_PATH)) {
      const raw = fs.readFileSync(STORE_FILE_PATH, "utf8");
      const parsed = JSON.parse(raw);
      inMemoryStore = {
        users: parsed.users || {},
        shortIdToUid: parsed.shortIdToUid || {},
        promoCodes: parsed.promoCodes || {},
        presence: parsed.presence || {},
        feedbackReports: Array.isArray(parsed.feedbackReports) ? parsed.feedbackReports : [],
        totalEarningsPesos: typeof parsed.totalEarningsPesos === "number" ? parsed.totalEarningsPesos : 0
      };
      return inMemoryStore;
    }
  } catch {
  }
  inMemoryStore = createEmptyStore();
  return inMemoryStore;
}
function writeStore(store) {
  inMemoryStore = store;
  try {
    const tmpPath = `${STORE_FILE_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(store), "utf8");
    fs.renameSync(tmpPath, STORE_FILE_PATH);
  } catch {
  }
}
function hydrateStoreFromCookies(req) {
  const store = readStore();
  const cookies = parseCookies(req);
  const vaultToken = cookies.xtv_acct_vault;
  const vault = verifyHmacPayload(vaultToken);
  if (vault?.kind === "acct_vault" && Array.isArray(vault.records)) {
    let changed = false;
    for (const rec of vault.records) {
      if (!rec?.u?.uid || !rec?.a) continue;
      const uid = rec.u.uid;
      const existing = store.users[uid];
      const incomingTime = Number(rec.t || 0);
      if (!existing || incomingTime >= (existing.updatedAtMs || 0)) {
        const shortUserId = rec.a.shortUserId || generateShortUserId(uid);
        store.users[uid] = {
          user: rec.u,
          account: { ...rec.a, shortUserId },
          passwordHash: rec.p || existing?.passwordHash,
          emailNormalized: normalizeAuthEmail(rec.u.email),
          usernameNormalized: normalizeAuthUsername(rec.u.username || rec.u.displayName),
          createdAtMs: existing?.createdAtMs || incomingTime || Date.now(),
          updatedAtMs: incomingTime || Date.now()
        };
        store.shortIdToUid[shortUserId] = uid;
        changed = true;
      }
    }
    if (changed) {
      writeStore(store);
    }
  }
  return store;
}
function buildCookieString(name, value, maxAgeSec, isHttps) {
  const encoded = value ? encodeURIComponent(value) : "";
  if (isHttps) {
    return `${name}=${encoded}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${maxAgeSec}`;
  }
  return `${name}=${encoded}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
}
function isRequestHttps(req) {
  const fwdProto = String(req.get("x-forwarded-proto") || "").split(",")[0].trim().toLowerCase();
  if (fwdProto === "https") return true;
  if (req.secure) return true;
  const host = String(req.get("host") || "").toLowerCase();
  return !host.startsWith("localhost") && !host.startsWith("127.0.0.1") && !host.startsWith("0.0.0.0");
}
function buildAuthCookieHeader(token, maxAgeSec, req) {
  return buildCookieString("xtv_auth_session", token, maxAgeSec, req ? isRequestHttps(req) : true);
}
function buildAccountVaultCookieHeader(store, priorityUid, req) {
  const all = Object.values(store.users).filter((r) => Boolean(r.user?.uid)).sort((a, b) => {
    if (priorityUid && a.user.uid === priorityUid) return -1;
    if (priorityUid && b.user.uid === priorityUid) return 1;
    return (b.updatedAtMs || 0) - (a.updatedAtMs || 0);
  });
  for (let limit = Math.min(4, all.length); limit >= 1; limit--) {
    const records = all.slice(0, limit).map((r) => ({
      u: r.user,
      a: r.account,
      p: r.passwordHash,
      t: r.updatedAtMs || Date.now()
    }));
    const token = signHmacPayload({
      kind: "acct_vault",
      records,
      exp: Date.now() + 90 * 24 * 60 * 60 * 1e3
    });
    if (token.length < 3400 || limit === 1) {
      return buildCookieString(
        "xtv_acct_vault",
        token,
        90 * 24 * 60 * 60,
        req ? isRequestHttps(req) : true
      );
    }
  }
  return null;
}
function signUserAuthToken(user, account) {
  return signHmacPayload({
    kind: "user_auth",
    user,
    account,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1e3
  });
}
function getUserTokenFromReq(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const candidate = authHeader.slice(7).trim();
    const parsed = verifyHmacPayload(candidate);
    if (parsed?.kind === "user_auth") {
      return candidate;
    }
  }
  const cookies = parseCookies(req);
  return cookies.xtv_auth_session;
}
function hydrateSessionRecord(req) {
  const store = hydrateStoreFromCookies(req);
  const token = getUserTokenFromReq(req);
  const parsed = verifyHmacPayload(token);
  if (!parsed || parsed.kind !== "user_auth" || !parsed.user?.uid) {
    return null;
  }
  const uid = parsed.user.uid;
  const existing = store.users[uid];
  if (existing) {
    return { user: existing.user, account: existing.account };
  }
  const shortUserId = parsed.account?.shortUserId || generateShortUserId(uid);
  const restoredAccount = {
    uid,
    shortUserId,
    downloadTier: parsed.account?.downloadTier || "free",
    downloadExpiresAtMs: parsed.account?.downloadExpiresAtMs || 0,
    storageTier: parsed.account?.storageTier || "none",
    storageQuotaBytes: parsed.account?.storageQuotaBytes || 0,
    storageUsedBytes: parsed.account?.storageUsedBytes || 0,
    redeemedCodes: Array.isArray(parsed.account?.redeemedCodes) ? parsed.account.redeemedCodes : [],
    xerostarActive: Boolean(parsed.account?.xerostarActive),
    xerostarExpiresAtMs: parsed.account?.xerostarExpiresAtMs || 0,
    kidsPinHash: parsed.account?.kidsPinHash,
    adultPinHash: parsed.account?.adultPinHash,
    xerohotsPinHash: parsed.account?.xerohotsPinHash,
    grantedBy: parsed.account?.grantedBy
  };
  store.users[uid] = {
    user: parsed.user,
    account: restoredAccount,
    emailNormalized: normalizeAuthEmail(parsed.user.email),
    usernameNormalized: normalizeAuthUsername(parsed.user.username || parsed.user.displayName),
    createdAtMs: Date.now(),
    updatedAtMs: Date.now()
  };
  store.shortIdToUid[shortUserId] = uid;
  writeStore(store);
  return { user: parsed.user, account: restoredAccount };
}
function hashUserPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const derived = crypto.scryptSync(password, salt, 32).toString("base64url");
  return `s:${salt}:${derived}`;
}
function verifyUserPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(":")) return false;
  try {
    if (storedHash.startsWith("s:")) {
      const parts = storedHash.split(":");
      if (parts.length !== 3) return false;
      const [, salt2, b64] = parts;
      if (!salt2 || !b64) return false;
      const expected2 = Buffer.from(b64, "base64url");
      const actual2 = crypto.scryptSync(password, salt2, 32);
      return expected2.length === actual2.length && crypto.timingSafeEqual(expected2, actual2);
    }
    const [salt, hex] = storedHash.split(":");
    if (!salt || !hex) return false;
    const expected = Buffer.from(hex, "hex");
    const actual = crypto.scryptSync(password, salt, 64);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
function verifyBotTokenOrChallenge(body) {
  const existingBotToken = typeof body?.botToken === "string" ? body.botToken.trim() : "";
  if (existingBotToken) {
    const verified = verifyHmacPayload(existingBotToken);
    if (verified?.kind === "bot-verified") {
      return { ok: true, botToken: existingBotToken };
    }
  }
  const challengeToken = typeof body?.challengeToken === "string" ? body.challengeToken.trim() : "";
  const botAnswer = typeof body?.botAnswer === "string" ? body.botAnswer.trim() : "";
  if (!challengeToken || !botAnswer) {
    return { ok: false, error: "Please answer the human verification check." };
  }
  const parsedChallenge = verifyHmacPayload(challengeToken);
  if (!parsedChallenge || parsedChallenge.kind !== "bot-challenge" || !parsedChallenge.expected) {
    return { ok: false, error: "Verification challenge expired. Please try again." };
  }
  const a = Buffer.from(botAnswer);
  const b = Buffer.from(parsedChallenge.expected);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) {
    return { ok: false, error: "Incorrect human verification answer. Please check the math." };
  }
  const freshBotToken = signHmacPayload({
    kind: "bot-verified",
    exp: Date.now() + 30 * 60 * 1e3
  });
  return { ok: true, botToken: freshBotToken };
}
function isSafeBrowserMutation(req) {
  if (req.headers.authorization?.startsWith("Bearer ")) return true;
  if (String(req.get("x-requested-with") || "") === "XEROTV") return true;
  const origin = String(req.get("origin") || req.get("referer") || "").trim();
  const host = String(req.get("x-forwarded-host") || req.get("host") || "").split(",")[0].trim();
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
function normalizeVercelServerlessUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl, "http://localhost");
    const xeroPath = parsed.searchParams.get("__xero_path");
    if (xeroPath !== null) {
      parsed.searchParams.delete("__xero_path");
      const cleaned = xeroPath.replace(/^\/+/, "").replace(/^api\/+/, "");
      const qs = parsed.searchParams.toString();
      return `/api/${cleaned || "health"}${qs ? `?${qs}` : ""}`;
    }
    if (parsed.pathname === "/" || parsed.pathname === "/api" || parsed.pathname === "/api/index" || parsed.pathname === "/api/index.mjs" || parsed.pathname === "/api/index.ts") {
      const qs = parsed.searchParams.toString();
      return `/api/health${qs ? `?${qs}` : ""}`;
    }
    if (!parsed.pathname.startsWith("/api/")) {
      const qs = parsed.searchParams.toString();
      return `/api${parsed.pathname.startsWith("/") ? "" : "/"}${parsed.pathname}${qs ? `?${qs}` : ""}`;
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
}
function createApiApp() {
  const app = express();
  const jsonParser = express.json({ limit: "1mb" });
  app.use((req, res, next) => {
    if (req.url.includes("__xero_path=")) {
      req.url = normalizeVercelServerlessUrl(req.url);
    }
    if (req.body !== void 0 && req.method !== "GET" && req.method !== "HEAD") {
      return next();
    }
    return jsonParser(req, res, next);
  });
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });
  const apiRateMap = /* @__PURE__ */ new Map();
  app.use("/api", (req, res, next) => {
    if (req.path === "/download/stream" || req.path === "/xerohots/stream" || req.path === "/xerohots/download" || req.path === "/health") {
      return next();
    }
    if (apiRateMap.size > 5e3) {
      apiRateMap.clear();
    }
    const ip = getClientIp(req);
    const now = Date.now();
    const record = apiRateMap.get(ip);
    if (!record || record.resetAt <= now) {
      apiRateMap.set(ip, { count: 1, resetAt: now + 6e4 });
      return next();
    }
    record.count += 1;
    if (record.count > 300) {
      return res.status(429).json({ error: "Rate limit exceeded. Please wait a moment." });
    }
    return next();
  });
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "XEROTV", version: "1.0", developer: "XIAN IN PRODUCTION" });
  });
  app.get("/api/speedtest/ping", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, serverTimeMs: Date.now() });
  });
  app.get("/api/speedtest/payload", (req, res) => {
    const requested = Number(req.query.bytes || 524288) || 524288;
    const size = Math.max(1024, Math.min(2097152, Math.floor(requested)));
    const payload = Buffer.alloc(size, 85);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", String(size));
    res.setHeader("Cache-Control", "no-store, no-transform");
    res.send(payload);
  });
  app.get("/api/security/bot-challenge", (_req, res) => {
    const a = 3 + crypto.randomInt(15);
    const b = 1 + crypto.randomInt(9);
    const useSub = crypto.randomInt(2) === 1 && a > b;
    const expected = useSub ? a - b : a + b;
    const question = `Human Check: What is ${a} ${useSub ? "-" : "+"} ${b}?`;
    const challengeToken = signHmacPayload({
      kind: "bot-challenge",
      expected: String(expected),
      nonce: crypto.randomBytes(6).toString("hex"),
      exp: Date.now() + 5 * 60 * 1e3
    });
    res.setHeader("Cache-Control", "no-store");
    res.json({ question, challengeToken });
  });
  app.post("/api/security/bot-verify", (req, res) => {
    const challengeToken = String(req.body?.challengeToken || "");
    const answer = String(req.body?.answer || "").trim();
    const parsed = verifyHmacPayload(challengeToken);
    if (!parsed || parsed.kind !== "bot-challenge" || !parsed.expected) {
      return res.status(400).json({ verified: false, error: "Verification challenge expired. Refreshing..." });
    }
    const a = Buffer.from(answer);
    const b = Buffer.from(parsed.expected);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) {
      return res.status(400).json({ verified: false, error: "Incorrect answer. Please solve the math check." });
    }
    const botToken = signHmacPayload({
      kind: "bot-verified",
      exp: Date.now() + 30 * 60 * 1e3
    });
    return res.json({ verified: true, botToken });
  });
  const authFailMap = /* @__PURE__ */ new Map();
  app.post("/api/auth/register", (req, res) => {
    if (!isSafeBrowserMutation(req)) {
      return res.status(403).json({ ok: false, code: "auth/forbidden", error: "Invalid request origin." });
    }
    const botCheck = verifyBotTokenOrChallenge(req.body);
    if (!botCheck.ok) {
      return res.status(400).json({ ok: false, code: "auth/bot-check-failed", error: botCheck.error });
    }
    const validation = validateRegistrationInput({
      displayName: String(req.body?.displayName || ""),
      email: String(req.body?.email || ""),
      password: String(req.body?.password || ""),
      confirmPassword: req.body?.confirmPassword !== void 0 ? String(req.body.confirmPassword) : void 0
    });
    if (!validation.ok) {
      return res.status(400).json({ ok: false, code: "auth/invalid-input", error: validation.error });
    }
    const store = hydrateStoreFromCookies(req);
    const existingEmail = Object.values(store.users).find(
      (r) => (r.emailNormalized || normalizeAuthEmail(r.user.email)) === validation.email
    );
    if (existingEmail) {
      return res.status(409).json({
        ok: false,
        code: "auth/email-in-use",
        error: "An account with this email already exists. Switch to Sign In."
      });
    }
    const uid = `xtv_${crypto.createHash("sha256").update(validation.email).digest("hex").slice(0, 16)}`;
    const shortUserId = generateShortUserId(uid);
    const usernameConflict = Object.values(store.users).some(
      (r) => (r.usernameNormalized || normalizeAuthUsername(r.user.username || "")) === validation.username
    );
    const finalUsername = usernameConflict ? `${validation.username.slice(0, 24)}_${shortUserId.slice(-4).toLowerCase()}` : validation.username;
    const authUser = {
      uid,
      provider: "xerotv",
      username: finalUsername,
      displayName: validation.displayName,
      email: validation.email,
      photoURL: null
    };
    const account = {
      uid,
      shortUserId,
      downloadTier: "free",
      downloadExpiresAtMs: 0,
      storageTier: "none",
      storageQuotaBytes: 0,
      storageUsedBytes: 0,
      redeemedCodes: [],
      xerostarActive: false,
      xerostarExpiresAtMs: 0
    };
    const now = Date.now();
    store.users[uid] = {
      user: authUser,
      account,
      passwordHash: hashUserPassword(validation.password),
      emailNormalized: validation.email,
      usernameNormalized: finalUsername,
      createdAtMs: now,
      updatedAtMs: now
    };
    store.shortIdToUid[shortUserId] = uid;
    writeStore(store);
    const token = signUserAuthToken(authUser, account);
    const cookiesToSet = [buildAuthCookieHeader(token, 30 * 24 * 60 * 60, req)];
    const vaultCookie = buildAccountVaultCookieHeader(store, uid, req);
    if (vaultCookie) cookiesToSet.push(vaultCookie);
    res.setHeader("Set-Cookie", cookiesToSet);
    return res.status(201).json({
      ok: true,
      user: authUser,
      account,
      token,
      botToken: botCheck.botToken
    });
  });
  app.post("/api/auth/login", (req, res) => {
    if (!isSafeBrowserMutation(req)) {
      return res.status(403).json({ ok: false, code: "auth/forbidden", error: "Invalid request origin." });
    }
    const ip = getClientIp(req);
    const now = Date.now();
    const failTracker = authFailMap.get(ip);
    if (failTracker && failTracker.lockedUntil > now) {
      const waitSec = Math.ceil((failTracker.lockedUntil - now) / 1e3);
      return res.status(429).json({
        ok: false,
        code: "auth/too-many-requests",
        error: `Too many failed sign-in attempts. Locked for ${waitSec}s.`
      });
    }
    const botCheck = verifyBotTokenOrChallenge(req.body);
    if (!botCheck.ok) {
      return res.status(400).json({ ok: false, code: "auth/bot-check-failed", error: botCheck.error });
    }
    const validation = validateLoginInput({
      identifier: String(req.body?.identifier || ""),
      password: String(req.body?.password || "")
    });
    if (!validation.ok) {
      return res.status(400).json({ ok: false, code: "auth/invalid-input", error: validation.error });
    }
    const store = hydrateStoreFromCookies(req);
    const cleanId = validation.identifier;
    const cleanHandle = normalizeAuthUsername(cleanId);
    const record = Object.values(store.users).find((r) => {
      const em = r.emailNormalized || normalizeAuthEmail(r.user.email);
      const un = r.usernameNormalized || normalizeAuthUsername(r.user.username || "");
      const sid = (r.account.shortUserId || "").toLowerCase();
      return em === cleanId || cleanHandle && un === cleanHandle || sid === cleanId;
    });
    if (!record || !verifyUserPassword(validation.password, record.passwordHash)) {
      const nextAttempts = (failTracker && failTracker.lockedUntil <= now ? failTracker.attempts : 0) + 1;
      if (nextAttempts >= 5) {
        authFailMap.set(ip, { attempts: 0, lockedUntil: now + 6e4 });
        return res.status(429).json({
          ok: false,
          code: "auth/too-many-requests",
          error: "Too many failed sign-in attempts. Locked for 60s."
        });
      }
      authFailMap.set(ip, { attempts: nextAttempts, lockedUntil: 0 });
      return res.status(401).json({
        ok: false,
        code: "auth/invalid-credentials",
        error: "Incorrect email/username or password."
      });
    }
    authFailMap.delete(ip);
    record.updatedAtMs = now;
    writeStore(store);
    const token = signUserAuthToken(record.user, record.account);
    const cookiesToSet = [buildAuthCookieHeader(token, 30 * 24 * 60 * 60, req)];
    const vaultCookie = buildAccountVaultCookieHeader(store, record.user.uid, req);
    if (vaultCookie) cookiesToSet.push(vaultCookie);
    res.setHeader("Set-Cookie", cookiesToSet);
    return res.json({
      ok: true,
      user: record.user,
      account: record.account,
      token,
      botToken: botCheck.botToken
    });
  });
  app.get("/api/auth/me", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const session = hydrateSessionRecord(req);
    if (!session) {
      return res.json({ authenticated: false, user: null, account: null });
    }
    const freshToken = signUserAuthToken(session.user, session.account);
    return res.json({
      authenticated: true,
      user: session.user,
      account: session.account,
      token: freshToken
    });
  });
  app.post("/api/auth/logout", (req, res) => {
    if (!isSafeBrowserMutation(req)) {
      return res.status(403).json({ error: "Invalid request origin." });
    }
    res.setHeader("Set-Cookie", buildAuthCookieHeader("", 0, req));
    res.json({ ok: true });
  });
  app.post("/api/account/redeem", (req, res) => {
    if (!isSafeBrowserMutation(req)) {
      return res.status(403).json({ ok: false, error: "Invalid request origin." });
    }
    const session = hydrateSessionRecord(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: "Please sign in first." });
    }
    const code = sanitizePromoCode(String(req.body?.code || ""));
    if (!code) {
      return res.status(400).json({ ok: false, error: "Please enter a valid promo code." });
    }
    const store = hydrateStoreFromCookies(req);
    const record = store.users[session.user.uid];
    if (!record) {
      return res.status(404).json({ ok: false, error: "Account record not found." });
    }
    const customPromo = store.promoCodes[code] || null;
    const calc = calculateRedemptionUpdate(record.account, code, Date.now(), customPromo);
    if (!calc.ok) {
      return res.status(400).json({ ok: false, error: calc.error });
    }
    record.account = {
      ...record.account,
      ...calc.patch
    };
    record.updatedAtMs = Date.now();
    writeStore(store);
    const token = signUserAuthToken(record.user, record.account);
    const cookiesToSet = [buildAuthCookieHeader(token, 30 * 24 * 60 * 60, req)];
    const vaultCookie = buildAccountVaultCookieHeader(store, record.user.uid, req);
    if (vaultCookie) cookiesToSet.push(vaultCookie);
    res.setHeader("Set-Cookie", cookiesToSet);
    return res.json({
      ok: true,
      message: `Code ${calc.code} redeemed: +${calc.daysGranted} Days Download Access & +${formatBytes(calc.storageBonusBytes)} Storage unlocked.`,
      account: record.account,
      user: record.user,
      token
    });
  });
  app.post("/api/account/pin", (req, res) => {
    if (!isSafeBrowserMutation(req)) {
      return res.status(403).json({ ok: false, error: "Invalid request origin." });
    }
    const session = hydrateSessionRecord(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: "Sign in required." });
    }
    const kind = String(req.body?.kind || "");
    const pinHash = String(req.body?.pinHash || "").trim();
    if (!["kids", "adult", "hots"].includes(kind) || !/^[a-f0-9]{16,128}$/i.test(pinHash)) {
      return res.status(400).json({ ok: false, error: "Invalid PIN payload." });
    }
    const store = hydrateStoreFromCookies(req);
    const record = store.users[session.user.uid];
    if (!record) {
      return res.status(404).json({ ok: false, error: "Account not found." });
    }
    if (kind === "kids") record.account.kidsPinHash = pinHash;
    else if (kind === "adult") record.account.adultPinHash = pinHash;
    else record.account.xerohotsPinHash = pinHash;
    record.updatedAtMs = Date.now();
    writeStore(store);
    const token = signUserAuthToken(record.user, record.account);
    const cookiesToSet = [buildAuthCookieHeader(token, 30 * 24 * 60 * 60, req)];
    const vaultCookie = buildAccountVaultCookieHeader(store, record.user.uid, req);
    if (vaultCookie) cookiesToSet.push(vaultCookie);
    res.setHeader("Set-Cookie", cookiesToSet);
    return res.json({ ok: true, account: record.account, token });
  });
  app.post("/api/account/storage", (req, res) => {
    if (!isSafeBrowserMutation(req)) {
      return res.status(403).json({ ok: false, error: "Invalid request origin." });
    }
    const session = hydrateSessionRecord(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: "Sign in required." });
    }
    const bytes = Math.max(0, Math.round(Number(req.body?.storageUsedBytes || 0)));
    const store = hydrateStoreFromCookies(req);
    const record = store.users[session.user.uid];
    if (!record) {
      return res.status(404).json({ ok: false, error: "Account not found." });
    }
    record.account.storageUsedBytes = bytes;
    record.updatedAtMs = Date.now();
    writeStore(store);
    const token = signUserAuthToken(record.user, record.account);
    const cookiesToSet = [buildAuthCookieHeader(token, 30 * 24 * 60 * 60, req)];
    const vaultCookie = buildAccountVaultCookieHeader(store, record.user.uid, req);
    if (vaultCookie) cookiesToSet.push(vaultCookie);
    res.setHeader("Set-Cookie", cookiesToSet);
    return res.json({ ok: true, account: record.account, token });
  });
  app.post("/api/platform/presence", (req, res) => {
    const sessionId = sanitizePlainText(String(req.body?.sessionId || ""), 64);
    const mode = sanitizePlainText(String(req.body?.mode || "main"), 24);
    if (!sessionId || !/^[a-zA-Z0-9_-]{6,64}$/.test(sessionId)) {
      return res.status(400).json({ ok: false });
    }
    const store = readStore();
    const now = Date.now();
    store.presence[sessionId] = { sessionId, mode, lastSeenAtMs: now };
    for (const [k, entry] of Object.entries(store.presence)) {
      if (now - entry.lastSeenAtMs > 10 * 60 * 1e3) {
        delete store.presence[k];
      }
    }
    writeStore(store);
    return res.json({ ok: true });
  });
  app.get("/api/platform/pulse", (req, res) => {
    const store = hydrateStoreFromCookies(req);
    const cutoff = Date.now() - 3 * 60 * 1e3;
    const onlineUsers = Math.max(
      1,
      Object.values(store.presence).filter((p) => p.lastSeenAtMs >= cutoff).length
    );
    const registeredUsers = Object.keys(store.users).length;
    const ratings = store.feedbackReports.map((r) => r.rating).filter((n) => typeof n === "number" && n >= 1 && n <= 5);
    const ratingCount = ratings.length;
    const popularityPct = ratingCount > 0 ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratingCount / 5 * 100) : null;
    res.setHeader("Cache-Control", "no-store");
    res.json({
      registeredUsers,
      onlineUsers,
      totalEarningsPesos: store.totalEarningsPesos,
      popularityPct,
      ratingCount
    });
  });
  app.get("/api/platform/feedback", (_req, res) => {
    const store = readStore();
    res.setHeader("Cache-Control", "no-store");
    res.json({
      reports: store.feedbackReports.slice(0, 50)
    });
  });
  app.post("/api/platform/feedback", (req, res) => {
    const category = req.body?.category === "bug" ? "bug" : "feedback";
    const title = sanitizePlainText(String(req.body?.title || ""), 120);
    const message = sanitizePlainText(String(req.body?.message || ""), 800);
    if (title.length < 2 || message.length < 4) {
      return res.status(400).json({ error: "Please provide a clear title and description." });
    }
    const rating = Math.max(1, Math.min(5, Math.round(Number(req.body?.rating || 5))));
    const report = {
      id: `rep_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`,
      category,
      rating,
      title,
      message,
      appVersion: "v1.0",
      status: "open",
      createdAtMs: Date.now()
    };
    const store = readStore();
    store.feedbackReports.unshift(report);
    if (store.feedbackReports.length > 200) {
      store.feedbackReports = store.feedbackReports.slice(0, 200);
    }
    writeStore(store);
    return res.status(201).json({ report });
  });
  app.get("/api/media/improving-v1.mp4", (req, res) => {
    const videoPath = path.resolve(process.cwd(), "public", "media", "improving-v1.mp4");
    if (process.env.VERCEL || !fs.existsSync(videoPath)) {
      return res.redirect(307, "/media/improving-v1.mp4");
    }
    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=3600");
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = Math.max(0, parseInt(parts[0], 10) || 0);
      const end = parts[1] ? Math.min(fileSize - 1, parseInt(parts[1], 10)) : fileSize - 1;
      if (start >= fileSize || end < start) {
        res.status(416).setHeader("Content-Range", `bytes */${fileSize}`);
        return res.end();
      }
      const chunkSize = end - start + 1;
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
      res.setHeader("Content-Length", String(chunkSize));
      const stream2 = fs.createReadStream(videoPath, { start, end });
      stream2.on("error", () => {
        if (!res.writableEnded) res.end();
      });
      return stream2.pipe(res);
    }
    res.status(200);
    res.setHeader("Content-Length", String(fileSize));
    const stream = fs.createReadStream(videoPath);
    stream.on("error", () => {
      if (!res.writableEnded) res.end();
    });
    return stream.pipe(res);
  });
  app.use("/api/tmdb", (_req, res, next) => {
    res.setHeader("Cache-Control", "public, max-age=180, s-maxage=300, stale-while-revalidate=600");
    next();
  });
  app.get("/api/tmdb/feed", async (req, res) => {
    const mode = String(req.query.mode || "main");
    const page = Math.max(1, Math.min(20, Number(req.query.page || 1) || 1));
    try {
      if (mode === "kids") {
        const kidsBlocked = /* @__PURE__ */ new Set([27, 53, 80, 10752, 10768, 9648]);
        const [movies, animated, familyTv] = await Promise.all([
          tmdbFetch("/discover/movie", {
            page,
            include_adult: false,
            certification_country: "US",
            "certification.lte": "PG",
            with_genres: "16|10751",
            without_genres: "27,53,80,10752,10768,9648",
            sort_by: "popularity.desc"
          }),
          tmdbFetch("/discover/movie", {
            page,
            include_adult: false,
            certification_country: "US",
            "certification.lte": "PG",
            with_genres: "16",
            without_genres: "27,53,80,10752,10768,9648",
            "vote_count.gte": 50,
            sort_by: "vote_average.desc"
          }),
          tmdbFetch("/discover/tv", {
            page,
            include_adult: false,
            with_genres: "10762,16",
            without_genres: "27,53,80,10752,10768,9648",
            sort_by: "popularity.desc"
          })
        ]);
        const tag2 = (list, media_type) => (list || []).filter(
          (item) => !item.adult && !(Array.isArray(item.genre_ids) && item.genre_ids.some((g) => kidsBlocked.has(Number(g))))
        ).map((item) => ({ ...item, media_type }));
        return res.json({
          mode,
          sections: [
            { id: "featured", title: "Kids PG Cinema", items: tag2(movies.results, "movie") },
            { id: "animated", title: "Animated Adventures", items: tag2(animated.results, "movie") },
            { id: "series", title: "Family & Kids Series", items: tag2(familyTv.results, "tv") }
          ]
        });
      }
      if (mode === "adult") {
        const [matureRomance, thrillerR, darkDrama] = await Promise.all([
          tmdbFetch("/discover/movie", {
            page,
            include_adult: true,
            certification_country: "US",
            "certification.gte": "R",
            with_genres: "10749,18",
            sort_by: "popularity.desc"
          }),
          tmdbFetch("/discover/movie", {
            page,
            include_adult: true,
            certification_country: "US",
            "certification.gte": "R",
            with_genres: "53,80",
            sort_by: "popularity.desc"
          }),
          tmdbFetch("/discover/tv", {
            page,
            include_adult: true,
            with_genres: "18,80",
            "vote_count.gte": 100,
            sort_by: "popularity.desc"
          })
        ]);
        const tag2 = (list, media_type) => (list || []).map((item) => ({ ...item, media_type }));
        return res.json({
          mode,
          sections: [
            { id: "featured", title: "18+ Mature & Romance", items: tag2(matureRomance.results, "movie") },
            { id: "thriller", title: "R-Rated Thrillers & Noir", items: tag2(thrillerR.results, "movie") },
            { id: "series", title: "Uncut Mature Series", items: tag2(darkDrama.results, "tv") }
          ]
        });
      }
      if (mode === "christmas") {
        const [holidayMovies, santaSearch, holidayTv] = await Promise.all([
          tmdbFetch("/discover/movie", {
            page,
            include_adult: false,
            with_keywords: "207317",
            sort_by: "popularity.desc"
          }),
          tmdbFetch("/search/movie", {
            query: "Christmas",
            page,
            include_adult: false
          }),
          tmdbFetch("/discover/tv", {
            page,
            include_adult: false,
            with_keywords: "207317",
            sort_by: "popularity.desc"
          })
        ]);
        const tag2 = (list, media_type) => (list || []).map((item) => ({ ...item, media_type }));
        return res.json({
          mode,
          sections: [
            { id: "featured", title: "Christmas Spotlight", items: tag2(holidayMovies.results, "movie") },
            { id: "santa", title: "Santa & Holiday Classics", items: tag2(santaSearch.results, "movie") },
            { id: "series", title: "Winter Holiday Specials", items: tag2(holidayTv.results, "tv") }
          ]
        });
      }
      const [trending, popularMovies, nowPlaying, topTv] = await Promise.all([
        tmdbFetch("/trending/all/week", { page, include_adult: false }),
        tmdbFetch("/movie/popular", { page, include_adult: false }),
        tmdbFetch("/movie/now_playing", { page, include_adult: false }),
        tmdbFetch("/tv/top_rated", { page, include_adult: false })
      ]);
      const tag = (list, defaultType) => (list || []).filter((item) => item.media_type !== "person" && !item.adult).map((item) => ({ ...item, media_type: item.media_type || defaultType || "movie" }));
      return res.json({
        mode: "main",
        sections: [
          { id: "featured", title: "Trending Worldwide", items: tag(trending.results) },
          { id: "popular", title: "Popular Cinema", items: tag(popularMovies.results, "movie") },
          { id: "now_playing", title: "Now Playing in Theaters", items: tag(nowPlaying.results, "movie") },
          { id: "series", title: "Acclaimed Series", items: tag(topTv.results, "tv") }
        ]
      });
    } catch (error) {
      res.status(502).json({
        error: "Failed to fetch TMDB catalog",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });
  app.get("/api/tmdb/search", async (req, res) => {
    const query = String(req.query.query || "").trim();
    const mode = String(req.query.mode || "main");
    const page = Math.max(1, Math.min(20, Number(req.query.page || 1) || 1));
    if (!query) {
      return res.json({ results: [] });
    }
    try {
      const data = await tmdbFetch("/search/multi", {
        query,
        page,
        include_adult: mode === "adult"
      });
      let items = (data.results || []).filter(
        (item) => item.media_type === "movie" || item.media_type === "tv"
      );
      if (mode !== "adult") {
        items = items.filter((item) => !item.adult);
      }
      if (mode === "kids") {
        const blocked = /* @__PURE__ */ new Set([27, 53, 80, 10752]);
        items = items.filter((item) => !(item.genre_ids || []).some((g) => blocked.has(g)));
      }
      res.json({ results: items });
    } catch (error) {
      res.status(502).json({
        error: "Search failed",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });
  app.get("/api/tmdb/discover", async (req, res) => {
    const mediaType = req.query.mediaType === "tv" ? "tv" : "movie";
    const genre = String(req.query.genre || "");
    const mode = String(req.query.mode || "main");
    const page = Math.max(1, Math.min(20, Number(req.query.page || 1) || 1));
    try {
      const params = {
        page,
        include_adult: mode === "adult",
        sort_by: "popularity.desc"
      };
      if (genre) params.with_genres = genre;
      if (mode === "kids") {
        if (mediaType === "movie") {
          params.certification_country = "US";
          params["certification.lte"] = "PG";
        }
        if (!genre) params.with_genres = mediaType === "tv" ? "10762|16|10751" : "16|10751";
      }
      if (mode === "christmas") {
        params.with_keywords = "207317";
      }
      const data = await tmdbFetch(`/discover/${mediaType}`, params);
      res.json({
        results: (data.results || []).map((item) => ({ ...item, media_type: mediaType }))
      });
    } catch (error) {
      res.status(502).json({
        error: "Discover failed",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });
  app.get("/api/tmdb/details/:mediaType/:id", async (req, res) => {
    const mediaType = req.params.mediaType === "tv" ? "tv" : "movie";
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid TMDB ID" });
    }
    try {
      const data = await tmdbFetch(
        `/${mediaType}/${id}`,
        {
          append_to_response: "credits,videos,recommendations,similar,release_dates,content_ratings"
        },
        15 * 60 * 1e3
      );
      res.json({ ...data, media_type: mediaType });
    } catch (error) {
      res.status(502).json({
        error: "Failed to load TMDB details",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });
  app.get("/api/tmdb/season/:tvId/:seasonNumber", async (req, res) => {
    const tvId = Number(req.params.tvId);
    const seasonNumber = Number(req.params.seasonNumber);
    if (!Number.isFinite(tvId) || !Number.isFinite(seasonNumber)) {
      return res.status(400).json({ error: "Invalid TV ID or season number" });
    }
    try {
      const data = await tmdbFetch(`/tv/${tvId}/season/${seasonNumber}`, {}, 15 * 60 * 1e3);
      res.json(data);
    } catch (error) {
      res.status(502).json({
        error: "Failed to load season episodes",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });
  app.get("/api/tmdb/studios", async (req, res) => {
    const studioId = String(req.query.studio || "netflix").toLowerCase();
    const mode = String(req.query.mode || "main");
    const typeFilter = String(req.query.type || "all").toLowerCase();
    const page = Math.max(1, Math.min(10, Number(req.query.page || 1) || 1));
    const studioCfg = STUDIO_QUERIES[studioId];
    if (!studioCfg) {
      return res.status(400).json({ error: "Unknown network or studio" });
    }
    try {
      const wantMovies = typeFilter !== "tv" && Boolean(studioCfg.movieParams);
      const wantTv = typeFilter !== "movie" && Boolean(studioCfg.tvParams);
      const emptyDiscover = { results: [] };
      const moviePromise = wantMovies ? tmdbFetch("/discover/movie", {
        ...studioCfg.movieParams,
        page,
        include_adult: mode === "adult",
        ...mode === "kids" ? {
          certification_country: "US",
          "certification.lte": "PG",
          with_genres: "16|10751|12|35|14",
          without_genres: "27,53,80,10752,10768,9648"
        } : {}
      }).catch(() => emptyDiscover) : Promise.resolve(emptyDiscover);
      const tvPromise = wantTv ? tmdbFetch("/discover/tv", {
        ...studioCfg.tvParams,
        page,
        include_adult: mode === "adult",
        ...mode === "kids" ? {
          with_genres: "10762|16|10751",
          without_genres: "27,53,80,10752,10768,9648"
        } : {}
      }).catch(() => emptyDiscover) : Promise.resolve(emptyDiscover);
      const [movieData, tvData] = await Promise.all([moviePromise, tvPromise]);
      let movieItems = (movieData.results || []).map((item) => ({
        ...item,
        media_type: "movie"
      }));
      let tvItems = (tvData.results || []).map((item) => ({
        ...item,
        media_type: "tv"
      }));
      if (mode === "kids") {
        const blocked = /* @__PURE__ */ new Set([27, 53, 80, 10752, 10768, 9648]);
        const kidsSafe = (item) => !item.adult && !(Array.isArray(item.genre_ids) && item.genre_ids.some((g) => blocked.has(Number(g))));
        movieItems = movieItems.filter(kidsSafe);
        tvItems = tvItems.filter(kidsSafe);
      }
      const combined = [];
      const seen = /* @__PURE__ */ new Set();
      const maxLen = Math.max(movieItems.length, tvItems.length);
      for (let i = 0; i < maxLen; i++) {
        if (i < movieItems.length) {
          const m = movieItems[i];
          const k = `movie:${String(m.id)}`;
          if (!seen.has(k)) {
            seen.add(k);
            combined.push(m);
          }
        }
        if (i < tvItems.length) {
          const t = tvItems[i];
          const k = `tv:${String(t.id)}`;
          if (!seen.has(k)) {
            seen.add(k);
            combined.push(t);
          }
        }
      }
      res.json({
        studio: studioId,
        name: studioCfg.name,
        mediaType: typeFilter === "movie" || typeFilter === "tv" ? typeFilter : "mixed",
        movieCount: movieItems.length,
        tvCount: tvItems.length,
        results: combined
      });
    } catch (error) {
      res.status(502).json({
        error: "Failed to load studio catalog",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });
  app.get("/api/tmdb/releases", async (_req, res) => {
    try {
      const [nowPlaying, airingToday] = await Promise.all([
        tmdbFetch("/movie/now_playing", { page: 1, include_adult: false }),
        tmdbFetch("/tv/airing_today", { page: 1, include_adult: false })
      ]);
      const items = [
        ...(nowPlaying.results || []).slice(0, 4).map((m) => ({ ...m, media_type: "movie" })),
        ...(airingToday.results || []).slice(0, 3).map((t) => ({ ...t, media_type: "tv" }))
      ];
      res.json({ releases: items });
    } catch (error) {
      res.status(502).json({
        error: "Failed to fetch releases",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });
  app.get("/api/download/info", async (req, res) => {
    try {
      const tmdbId = Math.abs(Number(req.query.tmdbId || 1) || 1);
      const mediaType = String(req.query.mediaType || "movie");
      const quality = String(req.query.quality || "standard");
      const rawTitle = String(req.query.title || "xerotv-movie");
      const safeTitle = rawTitle.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 48) || "xerotv-movie";
      let verifiedDirectUrl;
      const directToken = typeof req.query.directToken === "string" ? req.query.directToken.trim() : "";
      if (directToken) {
        const parsed = verifyHmacPayload(directToken);
        if (parsed?.kind === "hots_media" && parsed.url && isAllowedXeroHotsUrl(parsed.url)) {
          verifiedDirectUrl = parsed.url;
        }
      }
      const origin = `${req.protocol}://${req.get("host") || "localhost:3000"}`;
      const meta = await resolveWorkingStreamMeta({
        tmdbId,
        mediaType,
        title: rawTitle,
        quality,
        reqOrigin: origin,
        directUrl: verifiedDirectUrl
      });
      if (!meta) {
        return res.status(502).json({
          error: "No upstream video mirror is currently reachable. Please try again in a moment."
        });
      }
      const isExternalRemote = /^https?:\/\//i.test(meta.url) && (isAllowedCinemaArchiveUrl(meta.url) || isAllowedXeroHotsUrl(meta.url));
      const streamToken = isExternalRemote ? signHmacPayload({
        kind: "download_stream",
        url: meta.url,
        exp: Date.now() + 6 * 60 * 60 * 1e3
      }) : "";
      res.setHeader("Cache-Control", "no-store");
      return res.json({
        ok: true,
        mirrorIndex: meta.mirrorIndex,
        streamToken,
        sourceLabel: meta.label,
        totalBytes: meta.totalBytes,
        contentType: meta.contentType,
        chunkBytes: MAX_CHUNK_BYTES,
        filename: `${safeTitle}-${tmdbId}.mp4`
      });
    } catch (error) {
      return res.status(502).json({
        error: "Failed to resolve downloadable stream metadata.",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });
  app.get("/api/download/stream", async (req, res) => {
    const tmdbId = Math.abs(Number(req.query.tmdbId || 1) || 1);
    const mediaType = String(req.query.mediaType || "movie");
    const quality = String(req.query.quality || "standard");
    const rawTitle = String(req.query.title || "xerotv-movie");
    const mirrorIndexParam = req.query.mirrorIndex !== void 0 ? Number(req.query.mirrorIndex) : void 0;
    const title = rawTitle.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 48) || "xerotv-movie";
    const hasExplicitChunk = req.query.start !== void 0 && req.query.end !== void 0;
    const startByte = hasExplicitChunk ? Math.max(0, Math.floor(Number(req.query.start) || 0)) : 0;
    const requestedEnd = hasExplicitChunk ? Math.max(startByte, Math.floor(Number(req.query.end) || startByte)) : 0;
    const cappedEnd = hasExplicitChunk ? Math.min(requestedEnd, startByte + MAX_CHUNK_BYTES - 1) : 0;
    const rangeHeader = hasExplicitChunk ? `bytes=${startByte}-${cappedEnd}` : req.headers.range ? String(req.headers.range) : void 0;
    if (mirrorIndexParam === LOCAL_FALLBACK_MIRROR_INDEX) {
      const localPath = getLocalImprovingMp4Path();
      if (localPath) {
        const fileSize = fs.statSync(localPath).size;
        const start = rangeHeader ? startByte : 0;
        const end = rangeHeader ? Math.min(fileSize - 1, cappedEnd || fileSize - 1) : fileSize - 1;
        const chunkLen = Math.max(1, end - start + 1);
        res.status(rangeHeader ? 206 : 200);
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Content-Length", String(chunkLen));
        if (rangeHeader) {
          res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
        }
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Content-Disposition", `inline; filename="${title}-${tmdbId}.mp4"`);
        res.setHeader("Cache-Control", "no-store");
        return fs.createReadStream(localPath, { start, end }).pipe(res);
      }
      const fallbackUrl = `${resolvePublicOrigin(req)}/media/improving-v1.mp4`;
      const upstreamLocal = await fetch(fallbackUrl, {
        redirect: "follow",
        headers: rangeHeader ? { Range: rangeHeader } : void 0,
        signal: AbortSignal.timeout(12e3)
      }).catch(() => null);
      if (upstreamLocal && (upstreamLocal.ok || upstreamLocal.status === 206) && upstreamLocal.body) {
        const buf = Buffer.from(await upstreamLocal.arrayBuffer());
        res.status(upstreamLocal.status);
        res.setHeader("Content-Type", upstreamLocal.headers.get("content-type") || "video/mp4");
        res.setHeader("Content-Length", String(buf.byteLength));
        const cr = upstreamLocal.headers.get("content-range");
        if (cr) res.setHeader("Content-Range", cr);
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Content-Disposition", `inline; filename="${title}-${tmdbId}.mp4"`);
        res.setHeader("Cache-Control", "no-store");
        return res.send(buf);
      }
    }
    let pinnedUrl = null;
    const streamToken = typeof req.query.streamToken === "string" ? req.query.streamToken.trim() : "";
    if (streamToken) {
      const verified = verifyHmacPayload(streamToken);
      if (verified?.kind === "download_stream" && verified.url && (isAllowedCinemaArchiveUrl(verified.url) || isAllowedXeroHotsUrl(verified.url))) {
        pinnedUrl = verified.url;
      }
    }
    const ordered = selectOrderedOpenStreams({
      tmdbId,
      mediaType,
      title: rawTitle,
      quality,
      preferredMirror: mirrorIndexParam
    });
    const candidateUrls = pinnedUrl ? [pinnedUrl, ...ordered.slice(0, 2).map((o) => o.url)] : ordered.map((o) => o.url);
    let clientDisconnected = false;
    req.on("close", () => {
      clientDisconnected = true;
    });
    try {
      let upstream = null;
      const maxAttempts = pinnedUrl ? 2 : Math.min(4, candidateUrls.length);
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (clientDisconnected) return;
        const candidateUrl = candidateUrls[attempt];
        const attemptRes = await fetch(candidateUrl, {
          redirect: "follow",
          headers: {
            ...STREAM_BROWSER_HEADERS,
            ...rangeHeader ? { Range: rangeHeader } : {}
          },
          signal: AbortSignal.timeout(12e3)
        }).catch(() => null);
        const ct = (attemptRes?.headers.get("content-type") || "").toLowerCase();
        if (attemptRes && (attemptRes.ok || attemptRes.status === 206) && !ct.includes("text/html") && !ct.includes("application/json")) {
          upstream = attemptRes;
          break;
        }
        await attemptRes?.body?.cancel().catch(() => {
        });
      }
      if (!upstream) {
        const localPath = getLocalImprovingMp4Path();
        if (localPath) {
          const fileSize = fs.statSync(localPath).size;
          const start = rangeHeader ? startByte : 0;
          const end = rangeHeader ? Math.min(fileSize - 1, cappedEnd || fileSize - 1) : fileSize - 1;
          const chunkLen = Math.max(1, end - start + 1);
          res.status(rangeHeader ? 206 : 200);
          res.setHeader("Content-Type", "video/mp4");
          res.setHeader("Content-Length", String(chunkLen));
          if (rangeHeader) {
            res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
          }
          res.setHeader("Accept-Ranges", "bytes");
          res.setHeader("Content-Disposition", `inline; filename="${title}-${tmdbId}.mp4"`);
          res.setHeader("Cache-Control", "no-store");
          return fs.createReadStream(localPath, { start, end }).pipe(res);
        }
        const fallbackUrl = `${resolvePublicOrigin(req)}/media/improving-v1.mp4`;
        const publicFallback = await fetch(fallbackUrl, {
          redirect: "follow",
          headers: rangeHeader ? { Range: rangeHeader } : void 0,
          signal: AbortSignal.timeout(8e3)
        }).catch(() => null);
        if (publicFallback && (publicFallback.ok || publicFallback.status === 206) && publicFallback.body) {
          upstream = publicFallback;
        } else {
          return res.status(502).json({ error: "All upstream video mirrors failed or timed out" });
        }
      }
      const contentType = upstream.headers.get("content-type") || "video/mp4";
      const contentLength = upstream.headers.get("content-length");
      const contentRange = upstream.headers.get("content-range");
      if (!upstream.body) {
        return res.status(502).json({ error: "Upstream video stream returned empty body" });
      }
      if (hasExplicitChunk) {
        const chunkBuffer = Buffer.from(await upstream.arrayBuffer());
        if (clientDisconnected) return;
        res.status(upstream.status);
        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Length", String(chunkBuffer.byteLength));
        if (contentRange) res.setHeader("Content-Range", contentRange);
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Content-Disposition", `inline; filename="${title}-${tmdbId}.mp4"`);
        res.setHeader("Cache-Control", "no-store");
        return res.send(chunkBuffer);
      }
      res.status(upstream.status);
      res.setHeader("Content-Type", contentType);
      if (contentLength) res.setHeader("Content-Length", contentLength);
      if (contentRange) res.setHeader("Content-Range", contentRange);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Disposition", `inline; filename="${title}-${tmdbId}.mp4"`);
      res.setHeader("Cache-Control", "no-store");
      const reader = upstream.body.getReader();
      req.on("close", () => {
        reader.cancel().catch(() => {
        });
      });
      while (true) {
        if (clientDisconnected || res.writableEnded || res.destroyed) break;
        const { done, value } = await reader.read();
        if (done) break;
        if (value && !res.writableEnded && !res.destroyed) {
          const canContinue = res.write(Buffer.from(value));
          if (!canContinue) {
            await new Promise((resolve) => res.once("drain", resolve));
          }
        }
      }
      if (!res.writableEnded && !res.destroyed) {
        res.end();
      }
    } catch (error) {
      if (!res.headersSent) {
        res.status(502).json({
          error: "Failed to stream offline video file",
          details: error instanceof Error ? error.message : String(error)
        });
      } else if (!res.writableEnded && !res.destroyed) {
        res.end();
      }
    }
  });
  const adminFailMap = /* @__PURE__ */ new Map();
  app.post("/api/admin/verify", (req, res) => {
    const ip = getClientIp(req);
    const now = Date.now();
    const tracker = adminFailMap.get(ip);
    if (tracker && tracker.lockedUntil > now) {
      const waitSec = Math.ceil((tracker.lockedUntil - now) / 1e3);
      return res.status(429).json({
        verified: false,
        error: `Too many invalid attempts. Locked for ${waitSec}s.`
      });
    }
    const provided = String(req.body?.accessCode || "");
    const expected = process.env.ADMIN_ACCESS_CODE || "xiancondino";
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    const match = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!match) {
      const nextAttempts = (tracker && tracker.lockedUntil <= now ? tracker.attempts : 0) + 1;
      if (nextAttempts >= 5) {
        adminFailMap.set(ip, { attempts: 0, lockedUntil: now + 6e4 });
        return res.status(429).json({
          verified: false,
          error: "Too many invalid attempts. Locked for 60s."
        });
      }
      adminFailMap.set(ip, { attempts: nextAttempts, lockedUntil: 0 });
      return res.status(401).json({
        verified: false,
        error: `Invalid developer access code. (${5 - nextAttempts} attempt(s) left)`
      });
    }
    adminFailMap.delete(ip);
    const token = createAdminToken();
    res.setHeader(
      "Set-Cookie",
      buildCookieString("xtv_admin_session", token, 43200, isRequestHttps(req))
    );
    return res.json({ verified: true, token });
  });
  app.get("/api/admin/status", (req, res) => {
    const verified = verifyAdminToken(getAdminTokenFromReq(req));
    res.json({ verified });
  });
  app.post("/api/admin/logout", (req, res) => {
    if (!isSafeBrowserMutation(req)) {
      return res.status(403).json({ error: "Invalid request origin." });
    }
    res.setHeader(
      "Set-Cookie",
      buildCookieString("xtv_admin_session", "", 0, isRequestHttps(req))
    );
    return res.json({ ok: true });
  });
  app.get("/api/admin/users", (req, res) => {
    if (!verifyAdminToken(getAdminTokenFromReq(req))) {
      return res.status(403).json({ error: "Admin verification required." });
    }
    const store = hydrateStoreFromCookies(req);
    const users = Object.values(store.users).sort((a, b) => b.updatedAtMs - a.updatedAtMs).slice(0, 100).map((r) => r.account);
    return res.json({ users });
  });
  app.post("/api/admin/grant", (req, res) => {
    if (!isSafeBrowserMutation(req)) {
      return res.status(403).json({ error: "Invalid request origin." });
    }
    if (!verifyAdminToken(getAdminTokenFromReq(req))) {
      return res.status(403).json({ error: "Admin verification required." });
    }
    const rawUserId = String(req.body?.userId || "").trim();
    const grantType = String(req.body?.grantType || "");
    const customDays = Number(req.body?.customDays || 30);
    const validGrants = [
      "download_2m",
      "storage_1tb",
      "bundle_2m_1tb",
      "xerostar",
      "custom_days",
      "revoke"
    ];
    if (!rawUserId || !validGrants.includes(grantType)) {
      return res.status(400).json({ error: "Invalid target UserID or subscription grant type." });
    }
    const store = hydrateStoreFromCookies(req);
    let targetUid = rawUserId;
    if (rawUserId.toUpperCase().startsWith("XTV-")) {
      const mapped = store.shortIdToUid[rawUserId.toUpperCase()];
      if (!mapped) {
        return res.status(404).json({ error: `No user found with UserID "${rawUserId.toUpperCase()}".` });
      }
      targetUid = mapped;
    }
    const record = store.users[targetUid];
    if (!record) {
      return res.status(404).json({ error: `User "${rawUserId}" does not exist.` });
    }
    const patch = calculateAdminGrantUpdate(record.account, grantType, customDays, Date.now());
    const amountPesos = calculateGrantAmountPesos(grantType);
    record.account = {
      ...record.account,
      ...patch
    };
    record.updatedAtMs = Date.now();
    if (amountPesos > 0) {
      store.totalEarningsPesos += amountPesos;
    }
    writeStore(store);
    const vaultCookie = buildAccountVaultCookieHeader(store, targetUid, req);
    const currentSession = hydrateSessionRecord(req);
    const cookiesToSet = [];
    if (vaultCookie) cookiesToSet.push(vaultCookie);
    if (currentSession?.user.uid === targetUid) {
      const freshToken = signUserAuthToken(record.user, record.account);
      cookiesToSet.push(buildAuthCookieHeader(freshToken, 30 * 24 * 60 * 60, req));
    }
    if (cookiesToSet.length > 0) {
      res.setHeader("Set-Cookie", cookiesToSet);
    }
    return res.json({
      targetUid,
      shortUserId: record.account.shortUserId,
      amountPesos,
      patch
    });
  });
  app.get("/api/admin/promos", (req, res) => {
    if (!verifyAdminToken(getAdminTokenFromReq(req))) {
      return res.status(403).json({ error: "Admin verification required." });
    }
    const store = readStore();
    const promos = Object.values(store.promoCodes).sort((a, b) => b.createdAtMs - a.createdAtMs);
    return res.json({ promos });
  });
  app.post("/api/admin/promos", (req, res) => {
    if (!isSafeBrowserMutation(req)) {
      return res.status(403).json({ error: "Invalid request origin." });
    }
    if (!verifyAdminToken(getAdminTokenFromReq(req))) {
      return res.status(403).json({ error: "Admin verification required." });
    }
    const code = sanitizePromoCode(String(req.body?.code || ""));
    if (code.length < 3) {
      return res.status(400).json({ error: "Promo code must be at least 3 characters (A-Z, 0-9, -, _)." });
    }
    const daysGranted = Math.max(0, Math.min(3650, Math.floor(Number(req.body?.daysGranted || 0))));
    const storageBonusGb = Math.max(0, Math.min(1024, Math.floor(Number(req.body?.storageBonusGb || 0))));
    const storageBonusBytes = storageBonusGb * ONE_GB_BYTES;
    const now = Date.now();
    const promo = {
      code,
      daysGranted,
      storageBonusBytes,
      active: true,
      createdAtMs: now,
      updatedAtMs: now
    };
    const store = readStore();
    store.promoCodes[code] = promo;
    writeStore(store);
    return res.status(201).json({ promo });
  });
  app.patch("/api/admin/promos/:code", (req, res) => {
    if (!isSafeBrowserMutation(req)) {
      return res.status(403).json({ error: "Invalid request origin." });
    }
    if (!verifyAdminToken(getAdminTokenFromReq(req))) {
      return res.status(403).json({ error: "Admin verification required." });
    }
    const clean = sanitizePromoCode(String(req.params.code || ""));
    const store = readStore();
    if (!store.promoCodes[clean]) {
      return res.status(404).json({ error: "Promo code not found." });
    }
    store.promoCodes[clean].active = Boolean(req.body?.active);
    store.promoCodes[clean].updatedAtMs = Date.now();
    writeStore(store);
    return res.json({ promo: store.promoCodes[clean] });
  });
  app.delete("/api/admin/promos/:code", (req, res) => {
    if (!isSafeBrowserMutation(req)) {
      return res.status(403).json({ error: "Invalid request origin." });
    }
    if (!verifyAdminToken(getAdminTokenFromReq(req))) {
      return res.status(403).json({ error: "Admin verification required." });
    }
    const clean = sanitizePromoCode(String(req.params.code || ""));
    const store = readStore();
    delete store.promoCodes[clean];
    writeStore(store);
    return res.json({ ok: true });
  });
  app.patch("/api/admin/feedback/:id", (req, res) => {
    if (!isSafeBrowserMutation(req)) {
      return res.status(403).json({ error: "Invalid request origin." });
    }
    if (!verifyAdminToken(getAdminTokenFromReq(req))) {
      return res.status(403).json({ error: "Admin verification required." });
    }
    const reportId = String(req.params.id || "");
    const nextStatus = req.body?.status === "resolved" ? "resolved" : "open";
    const store = readStore();
    const item = store.feedbackReports.find((r) => r.id === reportId);
    if (!item) {
      return res.status(404).json({ error: "Feedback report not found." });
    }
    item.status = nextStatus;
    writeStore(store);
    return res.json({ report: item });
  });
  app.get("/api/admin/download-source-zip", async (req, res) => {
    const token = getAdminTokenFromReq(req) || (typeof req.query.token === "string" ? req.query.token : void 0);
    if (!verifyAdminToken(token)) {
      return res.status(403).json({ error: "Admin verification required." });
    }
    try {
      const rootDir = process.cwd();
      const archive = await createZipArchiver();
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", 'attachment; filename="XEROTV-Vercel-FullStack.zip"');
      archive.on("error", (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (!res.headersSent) {
          res.status(500).json({ error: msg });
        } else if (!res.writableEnded) {
          res.end();
        }
      });
      archive.pipe(res);
      const includeFiles = [
        "package.json",
        "tsconfig.json",
        "vite.config.ts",
        "vercel.json",
        "index.html",
        "server.ts",
        "metadata.json",
        ".npmrc",
        ".gitignore",
        ".gitattributes",
        ".env.example",
        "eslint.config.js",
        ".github/workflows/ci.yml"
      ];
      for (const relPath of includeFiles) {
        const fullPath = path.join(rootDir, relPath);
        if (fs.existsSync(fullPath)) {
          archive.file(fullPath, { name: relPath });
        }
      }
      const skipPublicSubdirs = process.env.VERCEL ? ["apps", "media"] : [];
      const includeDirs = ["src", "public", "api"];
      for (const dirName of includeDirs) {
        const fullDir = path.join(rootDir, dirName);
        if (fs.existsSync(fullDir)) {
          appendFilteredDirectory(archive, fullDir, dirName, dirName === "public" ? skipPublicSubdirs : []);
        }
      }
      archive.append(
        `# XEROTV \u2014 GitHub & Vercel Full-Stack Deployment Guide

1. Extract \`XEROTV-Vercel-FullStack.zip\`.
2. Run \`npm install && npm run build\` (bundles Vite SPA + \`api/index.mjs\`).
3. Push cleanly to GitHub or run \`npx vercel --prod\`.
`,
        { name: "DEPLOY_VERCEL.md" }
      );
      await archive.finalize();
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          error: "Failed to export source ZIP archive.",
          details: error instanceof Error ? error.message : String(error)
        });
      }
    }
  });
  app.get("/api/apps/mobile-bundle", async (req, res) => {
    try {
      const hostUrl = resolvePublicOrigin(req);
      const archive = await createZipArchiver();
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", 'attachment; filename="XEROTV-Mobile-Native-App.zip"');
      archive.on("error", (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (!res.headersSent) res.status(500).json({ error: msg });
        else if (!res.writableEnded) res.end();
      });
      archive.pipe(res);
      const rootDir = process.cwd();
      const iconPath = path.join(rootDir, "public", "pwa-512x512.png");
      if (fs.existsSync(iconPath)) {
        archive.file(iconPath, { name: "assets/icon.png" });
      }
      archive.append(
        `# XEROTV Mobile App (Android APK)
Target URL: ${hostUrl}
`,
        { name: "README.md" }
      );
      await archive.finalize();
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          error: "Failed to package mobile bundle.",
          details: error instanceof Error ? error.message : String(error)
        });
      }
    }
  });
  app.get("/api/apps/check-public-url", async (req, res) => {
    const rawUrl = typeof req.query.url === "string" ? req.query.url : "";
    const cleanUrl = resolvePublicAppOrigin(rawUrl, DEFAULT_SHARED_APP_URL);
    try {
      const probe = await fetch(`${cleanUrl}/api/health`, {
        redirect: "manual",
        signal: AbortSignal.timeout(4500)
      });
      const ct = (probe.headers.get("content-type") || "").toLowerCase();
      const reachable = probe.ok && ct.includes("application/json");
      return res.json({ url: cleanUrl, reachable, status: probe.status });
    } catch {
      return res.json({ url: cleanUrl, reachable: false, status: 0 });
    }
  });
  app.get("/api/apps/android.apk", async (req, res) => {
    if (process.env.VERCEL) {
      return res.redirect(302, "/apps/XEROTV.apk");
    }
    const hostUrl = resolvePublicOrigin(req);
    const rootDir = process.cwd();
    const builderScript = path.join(rootDir, "android-builder", "build_apk.sh");
    const prebuiltApk = path.join(rootDir, "public", "apps", "XEROTV.apk");
    const sdkSigner = "/opt/android-sdk/build-tools/34.0.0/apksigner";
    try {
      let apkToServe = prebuiltApk;
      const versionTags = [
        path.join(rootDir, "android-builder", "LocalXeroServer.java"),
        path.join(rootDir, "android-builder", "MainActivity.java"),
        path.join(rootDir, "dist", "index.html")
      ].map((p) => fs.existsSync(p) ? String(Math.floor(fs.statSync(p).mtimeMs)) : "0").join(":");
      if (fs.existsSync(sdkSigner) && fs.existsSync(builderScript)) {
        const cacheKey = crypto.createHash("sha1").update(`${hostUrl}|${versionTags}`).digest("hex").slice(0, 16);
        const cacheDir = "/tmp/xerotv-apk-cache";
        fs.mkdirSync(cacheDir, { recursive: true });
        const cachedApk = path.join(cacheDir, `xerotv-${cacheKey}.apk`);
        if (!fs.existsSync(cachedApk)) {
          await execFileAsync("bash", [builderScript, hostUrl, cachedApk], { timeout: 6e4 });
        }
        if (fs.existsSync(cachedApk)) apkToServe = cachedApk;
      }
      if (!fs.existsSync(apkToServe)) {
        return res.status(503).json({ error: "Android APK artifact is not ready yet." });
      }
      const stat = fs.statSync(apkToServe);
      res.setHeader("Content-Type", "application/vnd.android.package-archive");
      res.setHeader("Content-Disposition", 'attachment; filename="XEROTV.apk"');
      res.setHeader("Content-Length", String(stat.size));
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "no-store");
      return fs.createReadStream(apkToServe).pipe(res);
    } catch (error) {
      if (fs.existsSync(prebuiltApk)) {
        const stat = fs.statSync(prebuiltApk);
        res.setHeader("Content-Type", "application/vnd.android.package-archive");
        res.setHeader("Content-Disposition", 'attachment; filename="XEROTV.apk"');
        res.setHeader("Content-Length", String(stat.size));
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Cache-Control", "no-store");
        return fs.createReadStream(prebuiltApk).pipe(res);
      }
      return res.status(500).json({
        error: "Failed to build XEROTV Android APK.",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });
  app.get("/api/apps/ios.mobileconfig", (req, res) => {
    const hostUrl = resolvePublicOrigin(req);
    const rootDir = process.cwd();
    const iosIconPath = path.join(rootDir, "public", "apple-touch-icon.png");
    const fallbackIconPath = path.join(rootDir, "public", "pwa-192x192.png");
    let iconBase64 = "";
    try {
      const iconFile = fs.existsSync(iosIconPath) ? iosIconPath : fallbackIconPath;
      if (fs.existsSync(iconFile)) {
        iconBase64 = fs.readFileSync(iconFile).toString("base64");
      }
    } catch {
      iconBase64 = "";
    }
    const escapeXml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
    const uuidHash = crypto.createHash("sha256").update(`xerotv-ios:${hostUrl}`).digest("hex");
    const fmtUuid = (offset) => `${uuidHash.slice(offset, offset + 8)}-${uuidHash.slice(offset + 8, offset + 12)}-4${uuidHash.slice(offset + 13, offset + 16)}-a${uuidHash.slice(offset + 17, offset + 20)}-${uuidHash.slice(offset + 20, offset + 32)}`.toUpperCase();
    const mobileConfigXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>FullScreen</key>
      <true/>
      <key>Icon</key>
      <data>${iconBase64}</data>
      <key>IgnoreManifestScope</key>
      <false/>
      <key>IsRemovable</key>
      <true/>
      <key>Label</key>
      <string>XEROTV</string>
      <key>PayloadDescription</key>
      <string>Installs standalone full-screen XEROTV App on iPhone and iPad Home Screen</string>
      <key>PayloadDisplayName</key>
      <string>XEROTV</string>
      <key>PayloadIdentifier</key>
      <string>com.xianinproduction.xerotv.webclip</string>
      <key>PayloadType</key>
      <string>com.apple.webClip.managed</string>
      <key>PayloadUUID</key>
      <string>${fmtUuid(0)}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
      <key>Precomposed</key>
      <true/>
      <key>URL</key>
      <string>${escapeXml(hostUrl)}</string>
    </dict>
  </array>
  <key>PayloadDescription</key>
  <string>Official XEROTV Mobile App for iPhone and iPad \u2014 Developed by XIAN IN PRODUCTION</string>
  <key>PayloadDisplayName</key>
  <string>XEROTV</string>
  <key>PayloadIdentifier</key>
  <string>com.xianinproduction.xerotv.profile</string>
  <key>PayloadOrganization</key>
  <string>XIAN IN PRODUCTION</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${fmtUuid(16)}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>
`;
    res.setHeader("Content-Type", "application/x-apple-aspen-config");
    res.setHeader("Content-Disposition", 'attachment; filename="XEROTV-iPhone.mobileconfig"');
    res.setHeader("Cache-Control", "no-store");
    res.send(mobileConfigXml);
  });
  const xeroHotsCache = /* @__PURE__ */ new Map();
  const HOTS_BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9"
  };
  function makeSignedXeroHotsMediaUrls(mediaUrl, title) {
    const cleanTitle = (title || "xerohots-video").replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 48);
    const tok = signHmacPayload({
      kind: "hots_media",
      url: mediaUrl,
      title: cleanTitle,
      exp: Date.now() + 6 * 60 * 60 * 1e3
    });
    const enc = encodeURIComponent(tok);
    return {
      proxiedStreamUrl: `/api/xerohots/stream?token=${enc}`,
      proxiedDownloadUrl: `/api/xerohots/download?token=${enc}`,
      directStreamToken: tok
    };
  }
  async function fetchEpornerAdultColony(q, page, sort, catId) {
    const cat = findCategoryById("eporner", catId);
    const query = (q || cat?.query || "all").trim() || "all";
    const orderMap = {
      trending: "top-weekly",
      popular: "most-popular",
      "top-rated": "top-rated",
      newest: "latest",
      longest: "longest"
    };
    const order = orderMap[sort] || "top-weekly";
    const url = `https://www.eporner.com/api/v2/video/search/?query=${encodeURIComponent(
      query
    )}&per_page=20&page=${page}&thumbsize=big&order=${encodeURIComponent(order)}&format=json`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", ...HOTS_BROWSER_HEADERS },
      signal: AbortSignal.timeout(4500)
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.videos || []).filter((v) => v.id && v.title && v.default_thumb?.src).map((v) => ({
      id: String(v.id),
      title: String(v.title),
      duration: v.length_min || "HD",
      views: typeof v.views === "number" ? v.views.toLocaleString() : "\u2014",
      rating: v.rate && Number(v.rate) > 0 ? `${v.rate}/5` : "HD",
      thumbnail: normalizeExternalThumbUrl(v.default_thumb?.src),
      embedUrl: `https://www.eporner.com/embed/${encodeURIComponent(String(v.id))}/`,
      sourceUrl: String(v.url || `https://www.eporner.com/video-${v.id}/`),
      provider: "eporner",
      uploader: "Eporner HD",
      category: cat?.label || "Featured",
      directDownloadable: true
    }));
  }
  async function fetchPornhubAdultColony(q, page, sort, catId) {
    const cat = findCategoryById("pornhub", catId);
    const term = (q || (!cat?.pornhubCatId ? cat?.query || "" : "")).trim();
    const phSortMap = {
      trending: "tr",
      popular: "mv",
      "top-rated": "tr",
      newest: "cm",
      longest: "lg"
    };
    const o = phSortMap[sort] || "tr";
    let url = `https://www.pornhub.com/video?o=${o}&page=${page}`;
    if (term) {
      url = `https://www.pornhub.com/video/search?search=${encodeURIComponent(term)}&o=${o}&page=${page}`;
    } else if (cat?.pornhubCatId) {
      url = `https://www.pornhub.com/video?c=${encodeURIComponent(cat.pornhubCatId)}&o=${o}&page=${page}`;
    }
    const res = await fetch(url, {
      headers: { ...HOTS_BROWSER_HEADERS, Cookie: "accessAgeDisclaimerPH=1" },
      signal: AbortSignal.timeout(4500)
    });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const items = [];
    $("li.pcVideoListItem, ul.videos li.videoblock").each((_, el) => {
      if (items.length >= 20) return false;
      const vk = $(el).attr("data-video-vkey") || "";
      const a = $(el).find("span.title a").first();
      const title = (a.attr("title") || a.text() || $(el).find("a").attr("title") || "").trim();
      const img = $(el).find("img").first();
      const thumb = normalizeExternalThumbUrl(
        img.attr("data-src") || img.attr("data-thumb_url") || img.attr("src")
      );
      const dur = $(el).find(".duration").first().text().trim();
      const views = $(el).find(".views var").first().text().trim();
      if (!vk || !title || !thumb) return;
      items.push({
        id: vk,
        title,
        duration: dur || "HD",
        views: views || "Hot",
        rating: "Pornhub",
        thumbnail: thumb,
        embedUrl: `https://www.pornhub.com/embed/${encodeURIComponent(vk)}`,
        sourceUrl: `https://www.pornhub.com/view_video.php?viewkey=${encodeURIComponent(vk)}`,
        provider: "pornhub",
        uploader: $(el).find(".usernameWrap a").first().text().trim() || "Pornhub Creator",
        category: cat?.label || "Trending",
        directDownloadable: true
      });
      return void 0;
    });
    return items;
  }
  async function fetchXhamsterAdultColony(q, page, sort, catId) {
    const cat = findCategoryById("xhamster", catId);
    const term = (q || (!cat?.xhamsterSlug ? cat?.query || "" : "")).trim();
    const sortPathMap = {
      trending: "",
      popular: "most-viewed/weekly",
      "top-rated": "best/weekly",
      newest: "newest",
      longest: "most-viewed/monthly"
    };
    let url = `https://xhamster.com/${sortPathMap[sort] || ""}${page > 1 ? `/${page}` : ""}`.replace(
      /([^:])\/\//g,
      "$1/"
    );
    if (term) {
      url = `https://xhamster.com/search/${encodeURIComponent(term)}?page=${page}`;
    } else if (cat?.xhamsterSlug) {
      url = `https://xhamster.com/categories/${encodeURIComponent(cat.xhamsterSlug)}${page > 1 ? `/${page}` : ""}`;
    }
    const res = await fetch(url, {
      headers: HOTS_BROWSER_HEADERS,
      signal: AbortSignal.timeout(4500)
    });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const items = [];
    $("a.video-thumb__image-container").each((_, el) => {
      if (items.length >= 20) return false;
      const href = $(el).attr("href") || "";
      const img = $(el).find("img").first();
      const title = (img.attr("alt") || $(el).closest('[data-role="video-item"], .video-thumb').find(".video-thumb-info__name").text() || "").trim();
      const thumb = normalizeExternalThumbUrl(img.attr("src") || img.attr("data-src"));
      const dur = $(el).find('[data-role="video-duration"]').text().trim();
      const views = $(el).parent().parent().find(".video-thumb-views").text().trim();
      if (!href || !title || !thumb) return;
      const embedSuffix = href.split("-").pop() || "";
      const id = embedSuffix || Buffer.from(href).toString("base64url").slice(0, 16);
      items.push({
        id,
        title,
        duration: dur || "HD",
        views: views || "HD",
        rating: "xHamster",
        thumbnail: thumb,
        embedUrl: `https://xheve2.com/embed/${encodeURIComponent(embedSuffix)}`,
        sourceUrl: href.startsWith("http") ? href : `https://xhamster.com${href}`,
        provider: "xhamster",
        uploader: "xHamster Channel",
        category: cat?.label || "Featured",
        directDownloadable: true
      });
      return void 0;
    });
    return items;
  }
  async function fetchHentaiCityAdultColony(q, page, _sort, catId) {
    const cat = findCategoryById("hentaicity", catId);
    const term = (q || (!cat?.hentaicitySlug ? cat?.query || "" : "")).trim();
    let url = page > 1 ? `https://www.hentaicity.com/videos/recent/${page}/` : "https://www.hentaicity.com/videos/";
    if (term) {
      url = `https://www.hentaicity.com/search/${encodeURIComponent(term)}/${page > 1 ? `${page}/` : ""}`;
    } else if (cat?.hentaicitySlug) {
      url = `https://www.hentaicity.com/search/${encodeURIComponent(cat.hentaicitySlug)}/${page > 1 ? `${page}/` : ""}`;
    }
    const res = await fetch(url, {
      headers: HOTS_BROWSER_HEADERS,
      signal: AbortSignal.timeout(4500)
    });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const items = [];
    $("div.thumb-list div.outer-item").each((_, el) => {
      if (items.length >= 20) return false;
      const anchor = $(el).find("a").first();
      const href = anchor.attr("href") || "";
      const title = ($(el).find("p a").attr("title") || $(el).find("p a").text() || anchor.attr("title") || "").trim();
      const img = $(el).find("img").first();
      const thumb = normalizeExternalThumbUrl(img.attr("src") || img.attr("data-src"));
      const dur = $(el).find("span.time").text().trim();
      const views = $(el).find("div.info span").last().text().trim();
      const rating = $(el).find("div.info span").first().text().trim();
      if (!href || !title || !thumb) return;
      const tail = href.split("-").at(-1)?.replace(".html", "") || "";
      const fullSource = href.startsWith("http") ? href : `https://www.hentaicity.com${href}`;
      items.push({
        id: tail || Buffer.from(fullSource).toString("base64url").slice(0, 16),
        title,
        duration: dur || "Anime",
        views: views || "Verified",
        rating: rating || "HentaiCity",
        thumbnail: thumb,
        embedUrl: `https://www.hentaicity.com/embed/${encodeURIComponent(tail)}`,
        sourceUrl: fullSource,
        provider: "hentaicity",
        uploader: "HentaiCity",
        category: cat?.label || "Hentai / Anime",
        directDownloadable: true
      });
      return void 0;
    });
    return items;
  }
  async function fetchXvideosAdultColony(q, page, _sort, catId) {
    const cat = findCategoryById("xvideos", catId);
    const term = (q || cat?.query || "").trim();
    const url = term ? `https://www.xvideos.com/?k=${encodeURIComponent(term)}&p=${Math.max(0, page - 1)}` : page > 1 ? `https://www.xvideos.com/new/${page}` : "https://www.xvideos.com/?k=trending";
    const res = await fetch(url, {
      headers: HOTS_BROWSER_HEADERS,
      signal: AbortSignal.timeout(4e3)
    });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const items = [];
    $("div.mozaique div.thumb-block").each((_, el) => {
      if (items.length >= 20) return false;
      const id = $(el).attr("data-id") || "";
      const a = $(el).find(".thumb-under p.title a");
      const img = $(el).find(".thumb img");
      const title = (a.attr("title") || a.text() || "").trim();
      const href = a.attr("href") || "";
      const dur = $(el).find(".thumb-under p.title span.duration").text().trim();
      const thumb = normalizeExternalThumbUrl(img.attr("data-src") || img.attr("src"));
      if (!id || !title || !thumb) return;
      items.push({
        id,
        title,
        duration: dur || "HD",
        views: "Verified",
        rating: "XVideos",
        thumbnail: thumb,
        embedUrl: `https://www.xvideos.com/embedframe/${encodeURIComponent(id)}`,
        sourceUrl: href.startsWith("http") ? href : `https://www.xvideos.com${href}`,
        provider: "xvideos",
        uploader: $(el).find(".metadata .name").text().trim() || "XVideos Channel",
        category: cat?.label || "Featured",
        directDownloadable: true
      });
      return void 0;
    });
    return items;
  }
  async function fetchXnxxAdultColony(q, page, _sort, catId) {
    const cat = findCategoryById("xnxx", catId);
    const term = (q || cat?.query || "").trim();
    const url = term ? `https://www.xnxx.com/search/${encodeURIComponent(term)}/${Math.max(0, page - 1)}` : page > 1 ? `https://www.xnxx.com/hits/${Math.max(0, page - 1)}` : "https://www.xnxx.com/hits";
    const res = await fetch(url, {
      headers: HOTS_BROWSER_HEADERS,
      signal: AbortSignal.timeout(4e3)
    });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const items = [];
    $("div.mozaique div.thumb-block").each((_, el) => {
      if (items.length >= 20) return false;
      const a = $(el).find("div.thumb-under p a").first();
      const href = a.attr("href") || "";
      const id = $(el).attr("data-id") || href.split("/")[1] || "";
      const img = $(el).find(".thumb img").first();
      const title = (a.attr("title") || a.text() || "").trim();
      const thumb = normalizeExternalThumbUrl(img.attr("data-src") || img.attr("src"));
      if (!id || !title || !thumb) return;
      items.push({
        id,
        title,
        duration: "HD",
        views: "Hits",
        rating: "XNXX",
        thumbnail: thumb,
        embedUrl: `https://www.xnxx.com/embedframe/${encodeURIComponent(id)}`,
        sourceUrl: href.startsWith("http") ? href : `https://www.xnxx.com${href}`,
        provider: "xnxx",
        uploader: "XNXX Channel",
        category: cat?.label || "Hits",
        directDownloadable: true
      });
      return void 0;
    });
    return items;
  }
  async function queryAdultColony(provider, query, page, sort, categoryId) {
    const cleanQuery = query.slice(0, 80).trim();
    const cleanCat = (categoryId || "all").slice(0, 40).toLowerCase();
    const cacheKey = `${provider}:${cleanCat}:${sort}:${cleanQuery}:${page}`;
    const hit = xeroHotsCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.items;
    }
    let items = [];
    if (provider === "eporner") {
      items = await fetchEpornerAdultColony(cleanQuery, page, sort, cleanCat).catch(() => []);
    } else if (provider === "pornhub") {
      items = await fetchPornhubAdultColony(cleanQuery, page, sort, cleanCat).catch(() => []);
    } else if (provider === "xhamster") {
      items = await fetchXhamsterAdultColony(cleanQuery, page, sort, cleanCat).catch(() => []);
    } else if (provider === "hentaicity") {
      items = await fetchHentaiCityAdultColony(cleanQuery, page, sort, cleanCat).catch(() => []);
    } else if (provider === "xvideos") {
      items = await fetchXvideosAdultColony(cleanQuery, page, sort, cleanCat).catch(() => []);
    } else if (provider === "xnxx") {
      items = await fetchXnxxAdultColony(cleanQuery, page, sort, cleanCat).catch(() => []);
    } else {
      const [epRes, phRes, xhRes, hcRes] = await Promise.allSettled([
        fetchEpornerAdultColony(cleanQuery, page, sort, cleanCat),
        fetchPornhubAdultColony(cleanQuery, page, sort, cleanCat),
        fetchXhamsterAdultColony(cleanQuery, page, sort, cleanCat),
        fetchHentaiCityAdultColony(cleanQuery, page, sort, cleanCat)
      ]);
      const buckets = [
        epRes.status === "fulfilled" ? epRes.value : [],
        phRes.status === "fulfilled" ? phRes.value : [],
        xhRes.status === "fulfilled" ? xhRes.value : [],
        hcRes.status === "fulfilled" ? hcRes.value : []
      ];
      const maxLen = Math.max(...buckets.map((b) => b.length), 0);
      for (let i = 0; i < maxLen; i++) {
        for (const list of buckets) {
          if (i < list.length) items.push(list[i]);
        }
      }
    }
    if (xeroHotsCache.size > 150) {
      const firstKey = xeroHotsCache.keys().next().value;
      if (firstKey) xeroHotsCache.delete(firstKey);
    }
    if (items.length > 0) {
      xeroHotsCache.set(cacheKey, { items, expiresAt: Date.now() + 9e4 });
    }
    return items;
  }
  app.get("/api/xerohots/categories", (req, res) => {
    const provider = String(req.query.provider || "all").toLowerCase() || "all";
    const categories = getCategoriesForProvider(provider);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({ ok: true, provider, categories, sortOptions: XEROHOTS_SORT_OPTIONS });
  });
  app.get("/api/xerohots/feed", async (req, res) => {
    const provider = String(req.query.provider || "all").toLowerCase() || "all";
    const category = String(req.query.category || "all").toLowerCase();
    const sort = String(req.query.sort || "trending").toLowerCase() || "trending";
    const page = Math.max(1, Math.min(20, Number(req.query.page || 1) || 1));
    try {
      const items = await queryAdultColony(provider, "", page, sort, category);
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
      res.json({ ok: true, provider, category, sort, page, items });
    } catch (error) {
      res.status(502).json({
        ok: false,
        error: "Unable to load XeroHots stream feed.",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });
  app.get("/api/xerohots/search", async (req, res) => {
    const q = String(req.query.q || req.query.query || "").trim();
    const provider = String(req.query.provider || "all").toLowerCase() || "all";
    const category = String(req.query.category || "all").toLowerCase();
    const sort = String(req.query.sort || "trending").toLowerCase() || "trending";
    const page = Math.max(1, Math.min(20, Number(req.query.page || 1) || 1));
    try {
      const items = await queryAdultColony(provider, q, page, sort, category);
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
      res.json({ ok: true, provider, category, sort, query: q, page, items });
    } catch (error) {
      res.status(502).json({
        ok: false,
        error: "XeroHots search failed.",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });
  app.get("/api/xerohots/random", async (req, res) => {
    const provider = String(req.query.provider || "all").toLowerCase() || "all";
    const randomPage = 1 + crypto.randomInt(5);
    try {
      const items = await queryAdultColony(provider, "", randomPage, "popular", "all");
      if (items.length === 0) {
        return res.status(404).json({ ok: false, error: "No random video available right now." });
      }
      const picked = items[crypto.randomInt(items.length)];
      return res.json({ ok: true, item: picked });
    } catch {
      return res.status(502).json({ ok: false, error: "Random video pickup failed." });
    }
  });
  app.get("/api/xerohots/video", async (req, res) => {
    const provider = String(req.query.provider || "eporner").toLowerCase();
    const id = String(req.query.id || "").trim();
    const rawSourceUrl = String(req.query.sourceUrl || "").trim();
    const fallbackTitle = String(req.query.title || "XeroHots Video").trim();
    const fallbackThumb = String(req.query.thumbnail || "").trim();
    const fallbackDuration = String(req.query.duration || "HD").trim();
    const fallbackUploader = String(req.query.uploader || provider).trim();
    if (!id && !rawSourceUrl) {
      return res.status(400).json({ ok: false, error: "Missing video identifier." });
    }
    let targetUrl = rawSourceUrl;
    if (!targetUrl) {
      if (provider === "eporner") targetUrl = `https://www.eporner.com/video-${encodeURIComponent(id)}/`;
      else if (provider === "pornhub") targetUrl = `https://www.pornhub.com/view_video.php?viewkey=${encodeURIComponent(id)}`;
      else if (provider === "xvideos") targetUrl = `https://www.xvideos.com/video.${encodeURIComponent(id)}/video`;
      else if (provider === "hentaicity") targetUrl = `https://www.hentaicity.com/video/${encodeURIComponent(id)}.html`;
    }
    if (targetUrl && !isAllowedXeroHotsUrl(targetUrl)) {
      return res.status(403).json({ ok: false, error: "Disallowed provider domain." });
    }
    let title = fallbackTitle;
    let duration = fallbackDuration;
    let views = "Verified";
    let rating = "HD";
    let upvoted = "\u2014";
    let downvoted = "\u2014";
    let uploaded = "";
    let thumbnail = normalizeExternalThumbUrl(fallbackThumb);
    let embedUrl = "";
    let uploader = fallbackUploader;
    let tags = [];
    let models = [];
    const directCandidates = [];
    let hlsUrl = null;
    const relatedVideos = [];
    try {
      if (targetUrl) {
        const pageRes = await fetch(targetUrl, {
          headers: { ...HOTS_BROWSER_HEADERS, Cookie: "accessAgeDisclaimerPH=1" },
          redirect: "follow",
          signal: AbortSignal.timeout(5500)
        });
        const html = pageRes.ok ? await pageRes.text() : "";
        if (html) {
          const $ = cheerio.load(html);
          if (provider === "eporner") {
            title = $("#video-info h1").clone().children("span").remove().end().text().trim() || $("meta[property='og:title']").attr("content") || title;
            thumbnail = normalizeExternalThumbUrl($("#EPvideo").attr("poster") || $("meta[property='og:image']").attr("content")) || thumbnail;
            views = $("#cinemaviews1").text().trim() || views;
            duration = $("span.vid-length").text().trim() || duration;
            upvoted = $("div.likeup i").text().trim() || upvoted;
            downvoted = $("div.likedown i").text().trim() || downvoted;
            embedUrl = `https://www.eporner.com/embed/${encodeURIComponent(id)}/`;
            $('div.dloaddivcol span.download-h264 a, a[href*="/dload/"]').each((_, el) => {
              const href = $(el).attr("href") || "";
              if (!href.includes(".mp4")) return;
              const full = href.startsWith("http") ? href : `https://www.eporner.com${href}`;
              if (!isAllowedXeroHotsUrl(full)) return;
              const label = $(el).text().trim() || (href.includes("720") ? "720p MP4" : href.includes("480") ? "480p MP4" : "360p MP4");
              if (!directCandidates.some((c) => c.url === full)) {
                directCandidates.push({ label, url: full });
              }
            });
            directCandidates.sort((a, b) => {
              const aAv1 = a.url.includes("-av1") ? 1 : 0;
              const bAv1 = b.url.includes("-av1") ? 1 : 0;
              return aAv1 - bAv1;
            });
            tags = $('#video-info-tags a, a[href*="/tag/"]').map((_, el) => $(el).text().trim()).get().filter(Boolean).slice(0, 12);
            uploader = $("#video-info .vit-uploader a").first().text().trim() || "Eporner HD";
            $("#relateddiv div.mb").each((_, el) => {
              if (relatedVideos.length >= 8) return false;
              const rHref = $(el).find("a").first().attr("href") || "";
              const rTitle = $(el).find("p.mbtit a").text().trim();
              const rImg = normalizeExternalThumbUrl($(el).find("img").attr("data-src") || $(el).find("img").attr("src"));
              const rDur = $(el).find("span.mbtim").text().trim();
              const rId = rHref.match(/video-([a-zA-Z0-9]+)/)?.[1] || "";
              if (rId && rTitle && rImg) {
                relatedVideos.push({
                  id: rId,
                  title: rTitle,
                  duration: rDur || "HD",
                  views: $(el).find("span.mbvie").text().trim() || "HD",
                  rating: "Eporner",
                  thumbnail: rImg,
                  embedUrl: `https://www.eporner.com/embed/${rId}/`,
                  sourceUrl: rHref.startsWith("http") ? rHref : `https://www.eporner.com${rHref}`,
                  provider: "eporner",
                  uploader: "Eporner HD",
                  directDownloadable: true
                });
              }
              return void 0;
            });
          } else if (provider === "pornhub") {
            title = $("meta[property='og:title']").attr("content")?.trim() || title;
            thumbnail = normalizeExternalThumbUrl($("meta[property='og:image']").attr("content")) || thumbnail;
            views = $("div.views > span.count").text().trim() || views;
            rating = $("div.ratingPercent > span.percent").text().trim() || rating;
            upvoted = $("span.votesUp").attr("data-rating") || upvoted;
            downvoted = $("span.votesDown").attr("data-rating") || downvoted;
            uploaded = $("div.videoInfo").text().trim() || uploaded;
            embedUrl = `https://www.pornhub.com/embed/${encodeURIComponent(id)}`;
            tags = $("div.video-info-row a").map((_, el) => $(el).text().trim()).get().filter((t) => t && t !== "Suggest").slice(0, 12);
            models = $("div.pornstarsWrapper a").map((_, el) => $(el).attr("data-mxptext") || $(el).text().trim()).get().filter(Boolean).slice(0, 8);
            const mediaMatches = [...html.matchAll(/"videoUrl"\s*:\s*"([^"]+)"/g)];
            for (const m of mediaMatches) {
              const rawUrl = m[1].replace(/\\\//g, "/");
              if (!isAllowedXeroHotsUrl(rawUrl)) continue;
              if (rawUrl.includes(".mp4") && !rawUrl.includes(".m3u8")) {
                directCandidates.push({ label: "MP4 Stream", url: rawUrl });
              } else if (rawUrl.includes(".m3u8") && !hlsUrl) {
                hlsUrl = rawUrl;
              }
            }
          } else if (provider === "xhamster") {
            title = $("meta[property='og:title']").attr("content")?.trim() || title;
            thumbnail = normalizeExternalThumbUrl($("meta[property='og:image']").attr("content")) || thumbnail;
            embedUrl = `https://xheve2.com/embed/${encodeURIComponent(id)}`;
            const mp4Matches = [...html.matchAll(/"(?:mp4File|file)"\s*:\s*"(https?:[^"]+\.mp4[^"]*)"/g)];
            for (const m of mp4Matches) {
              const rawUrl = m[1].replace(/\\\//g, "/");
              if (isAllowedXeroHotsUrl(rawUrl)) {
                directCandidates.push({ label: "xHamster MP4", url: rawUrl });
              }
            }
            const hlsMatch = html.match(/"hls"\s*:\s*\{[^}]*"url"\s*:\s*"([^"]+)"/);
            if (hlsMatch) {
              hlsUrl = hlsMatch[1].replace(/\\\//g, "/");
            }
          } else if (provider === "hentaicity") {
            title = $("section.content h1").first().text().trim() || $("meta[property='og:title']").attr("content")?.trim() || title;
            embedUrl = `https://www.hentaicity.com/embed/${encodeURIComponent(id)}`;
            const srcUrl = $("#video-id source").attr("src") || $("video source").attr("src") || "";
            if (srcUrl && isAllowedXeroHotsUrl(srcUrl)) {
              if (srcUrl.includes(".mp4") && !srcUrl.includes(".m3u8")) {
                directCandidates.push({ label: "Direct MP4", url: srcUrl });
              } else {
                hlsUrl = srcUrl;
              }
            }
            const regexMp4s = html.match(/https?:\/\/[^"'\s<>]+\.mp4(?:\?[^"'\s<>]*)?/gi) || [];
            for (const rawMp4 of regexMp4s) {
              if (!isAllowedXeroHotsUrl(rawMp4) || rawMp4.includes(".urlset")) continue;
              const lbl = rawMp4.includes("720") ? "720p MP4" : rawMp4.includes("480") ? "480p MP4" : "MP4 Stream";
              if (!directCandidates.some((c) => c.url === rawMp4)) {
                directCandidates.push({ label: lbl, url: rawMp4 });
              }
            }
            const hcHls = html.match(/https?:\/\/[^"'\s<>]+\.m3u8(?:\?[^"'\s<>]*)?/i)?.[0];
            if (hcHls && !hlsUrl) hlsUrl = hcHls;
          } else if (provider === "xvideos" || provider === "xnxx") {
            title = $("meta[property='og:title']").attr("content")?.trim() || title;
            thumbnail = normalizeExternalThumbUrl($("meta[property='og:image']").attr("content")) || thumbnail;
            embedUrl = provider === "xnxx" ? `https://www.xnxx.com/embedframe/${encodeURIComponent(id)}` : `https://www.xvideos.com/embedframe/${encodeURIComponent(id)}`;
            const highMatch = html.match(/html5player\.setVideoUrlHigh\(['"]([^'"]+)['"]\)/);
            const lowMatch = html.match(/html5player\.setVideoUrlLow\(['"]([^'"]+)['"]\)/);
            if (highMatch?.[1] && isAllowedXeroHotsUrl(highMatch[1])) {
              directCandidates.push({ label: "High HD MP4", url: highMatch[1] });
            }
            if (lowMatch?.[1] && isAllowedXeroHotsUrl(lowMatch[1])) {
              directCandidates.push({ label: "Compact MP4", url: lowMatch[1] });
            }
            tags = $("a.is-keyword, div.video-tags a").map((_, el) => $(el).text().trim()).get().filter(Boolean).slice(0, 12);
          }
        }
      }
    } catch {
    }
    if (!embedUrl) {
      if (provider === "eporner") embedUrl = `https://www.eporner.com/embed/${encodeURIComponent(id)}/`;
      else if (provider === "pornhub") embedUrl = `https://www.pornhub.com/embed/${encodeURIComponent(id)}`;
      else if (provider === "xhamster") embedUrl = `https://xheve2.com/embed/${encodeURIComponent(id)}`;
      else if (provider === "hentaicity") embedUrl = `https://www.hentaicity.com/embed/${encodeURIComponent(id)}`;
      else if (provider === "xnxx") embedUrl = `https://www.xnxx.com/embedframe/${encodeURIComponent(id)}`;
      else embedUrl = `https://www.xvideos.com/embedframe/${encodeURIComponent(id)}`;
    }
    const primaryDirectUrl = directCandidates[0]?.url || null;
    const primaryLinks = primaryDirectUrl ? makeSignedXeroHotsMediaUrls(primaryDirectUrl, title) : null;
    const qualities = directCandidates.slice(0, 4).map((q) => {
      const signed = makeSignedXeroHotsMediaUrls(q.url, title);
      return {
        label: q.label,
        proxiedStreamUrl: signed.proxiedStreamUrl,
        proxiedDownloadUrl: signed.proxiedDownloadUrl
      };
    });
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      ok: true,
      provider,
      id,
      title,
      duration,
      views,
      rating,
      upvoted,
      downvoted,
      uploaded,
      thumbnail,
      embedUrl,
      sourceUrl: targetUrl,
      uploader,
      tags,
      models,
      directVideoUrl: primaryDirectUrl,
      proxiedStreamUrl: primaryLinks?.proxiedStreamUrl || null,
      proxiedDownloadUrl: primaryLinks?.proxiedDownloadUrl || null,
      directStreamToken: primaryLinks?.directStreamToken || null,
      hlsUrl,
      qualities,
      relatedVideos
    });
  });
  async function handleXeroHotsMediaProxy(req, res, forceAttachment) {
    const token = typeof req.query.token === "string" ? req.query.token.trim() : "";
    const parsed = verifyHmacPayload(token);
    if (!parsed || parsed.kind !== "hots_media" || !parsed.url || !isAllowedXeroHotsUrl(parsed.url)) {
      return res.status(403).json({ error: "Invalid or expired media token." });
    }
    const safeTitle = (parsed.title || "xerohots-video").replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 48);
    const rangeHeader = req.headers.range ? String(req.headers.range) : void 0;
    try {
      const upstream = await fetch(parsed.url, {
        redirect: "follow",
        headers: {
          ...HOTS_BROWSER_HEADERS,
          Cookie: "accessAgeDisclaimerPH=1",
          ...rangeHeader ? { Range: rangeHeader } : {}
        },
        signal: AbortSignal.timeout(15e3)
      });
      if (!upstream.ok && upstream.status !== 206) {
        return res.status(502).json({ error: `Provider video stream returned ${upstream.status}` });
      }
      if (!upstream.body) {
        return res.status(502).json({ error: "Empty video stream body" });
      }
      const ct = upstream.headers.get("content-type") || "video/mp4";
      const contentType = ct.includes("octet-stream") ? "video/mp4" : ct;
      const cl = upstream.headers.get("content-length");
      const cr = upstream.headers.get("content-range");
      res.status(upstream.status);
      res.setHeader("Content-Type", contentType);
      if (cl) res.setHeader("Content-Length", cl);
      if (cr) res.setHeader("Content-Range", cr);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader(
        "Content-Disposition",
        `${forceAttachment ? "attachment" : "inline"}; filename="${safeTitle}.mp4"`
      );
      res.setHeader("Cache-Control", "no-store");
      let closed = false;
      const reader = upstream.body.getReader();
      req.on("close", () => {
        closed = true;
        reader.cancel().catch(() => {
        });
      });
      while (true) {
        if (closed || res.writableEnded || res.destroyed) break;
        const { done, value } = await reader.read();
        if (done) break;
        if (value && !res.writableEnded && !res.destroyed) {
          const ok = res.write(Buffer.from(value));
          if (!ok) {
            await new Promise((resolve) => res.once("drain", resolve));
          }
        }
      }
      if (!res.writableEnded && !res.destroyed) {
        res.end();
      }
    } catch (error) {
      if (!res.headersSent) {
        res.status(502).json({
          error: "Failed to proxy XeroHots video stream.",
          details: error instanceof Error ? error.message : String(error)
        });
      } else if (!res.writableEnded && !res.destroyed) {
        res.end();
      }
    }
  }
  app.get("/api/xerohots/stream", (req, res) => handleXeroHotsMediaProxy(req, res, false));
  app.get("/api/xerohots/download", (req, res) => handleXeroHotsMediaProxy(req, res, true));
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API endpoint not found" });
  });
  app.use((err, _req, res, _next) => {
    console.error("Unhandled XEROTV API error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Internal API error",
        details: err instanceof Error ? err.message : String(err)
      });
    }
  });
  return app;
}
var vercelAppInstance = null;
function handler(req, res) {
  try {
    req.url = normalizeVercelServerlessUrl(req.url || "/");
    if (!vercelAppInstance) {
      vercelAppInstance = createApiApp();
    }
    return vercelAppInstance(req, res);
  } catch (error) {
    console.error("Fatal XEROTV handler error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Serverless API handler error",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
export {
  createApiApp,
  handler as default,
  normalizeVercelServerlessUrl
};
