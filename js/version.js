// ================================================================
// version.js · HIS Curriculum ver1.0 release/cache identity
// ================================================================
export const RELEASE_LABEL = String(globalThis.HIS_RELEASE || "v1.0.0");
export const APP_VERSION = String(globalThis.HIS_APP_VERSION || "1.0.0-20260724.1");
export const ASSET_VERSION = String(globalThis.HIS_RUNTIME_ASSET_VERSION || APP_VERSION);

export function versioned(path) {
  const raw = String(path || "");
  if (!raw) return raw;
  const joiner = raw.includes("?") ? "&" : "?";
  return `${raw}${joiner}v=${encodeURIComponent(ASSET_VERSION)}`;
}
