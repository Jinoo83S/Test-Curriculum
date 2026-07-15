// ================================================================
// version.js · Release label + runtime asset cache version
// ================================================================
// HIS_APP_VERSION is the user-visible release label.
// HIS_RUNTIME_ASSET_VERSION is intentionally separate: a release may change
// only a few modules, so unchanged files can keep their previous cache URL.
// This prevents every patch from containing nearly the entire application.
export const APP_VERSION = String(globalThis.HIS_APP_VERSION || "2026-07-15-print-output-hotfix-r364");
export const ASSET_VERSION = String(globalThis.HIS_RUNTIME_ASSET_VERSION || APP_VERSION);

export function versioned(path) {
  const raw = String(path || "");
  if (!raw) return raw;
  const joiner = raw.includes("?") ? "&" : "?";
  return `${raw}${joiner}v=${encodeURIComponent(ASSET_VERSION)}`;
}
