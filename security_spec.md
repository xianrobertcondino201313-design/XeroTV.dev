# XEROTV Firestore Security Specification

## 1. Data Invariants
1. **Owner-Isolated PII**: Email, displayName, and photoURL are isolated in `/users/{userId}/private/profile` and readable only by the owner (`request.auth.uid == userId`) or a verified admin.
2. **No Self-Privilege Escalation**: Users cannot create or update their `/users/{userId}` document with paid tiers (`download_2m`, `lifetime_bundle`, `permanent_1tb`) or arbitrary `storageQuotaBytes`, nor can non-admins alter `/stats/public.totalEarningsPesos`.
3. **One-Time Code Redemption**: Promo code redemption (`NEWUSER2026`, `VER-1-0XEROTV`, or active `/promoCodes/{codeId}`) requires an atomic batch creating `/users/{userId}/redemptions/{codeId}` (`existsAfter`) and updating `/users/{userId}` without duplicating codes in `redeemedCodes`.
4. **Immutable Ownership & Timestamps**: `uid`, `shortUserId`, and `createdAt` cannot be modified after creation; `createdAt` and `updatedAt` must equal `request.time`.
5. **Admin-Only Cross-User Grants & Code Generation**: Only verified admins (`email_verified == true` and bootstrapped email `xianrobertcondino201313@gmail.com` or `/admins/{uid}`) can list all users, look up arbitrary `userLookup` records, manage `/promoCodes`, resolve `/feedbackReports`, update `totalEarningsPesos`, or grant paid subscriptions.
6. **Non-PII Telemetry & Feedback**: `/presence/{sessionId}` and `/feedbackReports/{reportId}` store zero PII (strictly bounded strings and enum values) for honest live online counts and real user satisfaction ratings.

## 2. Dirty Dozen Payloads (Must Return PERMISSION_DENIED)
1. Unauthenticated read of `/users/user123`
2. Non-owner read of `/users/user123/private/profile`
3. User creating `/users/user123` with `downloadTier: "download_2m"` or `storageQuotaBytes: 1099511627776`
4. User updating `/users/user123` with `storageTier: "permanent_1tb"` (self-upgrade)
5. User updating `/users/user123` with a shadow/ghost field (`isAdmin: true`)
6. User updating `/users/user123` with forged `uid` or `shortUserId`
7. User creating `/users/user123/redemptions/NEWUSER2026` or `VER-1-0XEROTV` without atomically updating `/users/user123` (or claiming wrong bonus bytes)
8. User re-redeeming `NEWUSER2026` or `VER-1-0XEROTV` when already present in `redeemedCodes`
9. Non-admin modifying `/stats/public.totalEarningsPesos` or marking `/feedbackReports/{id}` resolved
10. Non-admin listing `/users` collection or creating `/promoCodes/FREEALL`
11. Unverified email spoof trying to claim admin access
12. Resource poisoning: creating document with ID > 128 chars or non-alphanumeric characters
