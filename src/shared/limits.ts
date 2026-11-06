/**
 * Upload limits, in one place. Sized for Supabase's free plan: 1 GB of storage
 * in total and a 50 MB cap per file. When storage moves to a paid plan (Supabase
 * Pro includes 100 GB) or another vendor, raise these numbers here and nowhere else.
 */
const MB = 1024 * 1024;

export const LIMITS = {
  /** Largest single file a member can upload. */
  maxFileBytes: 25 * MB,
  /** Storage each group gets by default. */
  defaultGroupQuotaBytes: 100 * MB,
  /** New uploads stop platform-wide at this total, leaving headroom under the 1 GB free plan. */
  platformUploadStopBytes: 900 * MB,
  /** Warn the owner (you) when the platform total reaches this. */
  platformAlertBytes: 700 * MB,
} as const;
