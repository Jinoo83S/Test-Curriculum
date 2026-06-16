// ================================================================
// version.js · Central cache-busting version for runtime imports
// ================================================================
// Update this value once per release. HTML entry points can override it by
// setting window.HIS_APP_VERSION before loading app modules.
export const APP_VERSION = "2026-06-16-카드그룹스냅샷보정-r54";

export function versioned(path) {
  const raw = String(path || "");
  if (!raw) return raw;
  const joiner = raw.includes("?") ? "&" : "?";
  return `${raw}${joiner}v=${encodeURIComponent(APP_VERSION)}`;
}
