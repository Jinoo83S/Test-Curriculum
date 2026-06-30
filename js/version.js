// ================================================================
// version.js · Central cache-busting version for runtime imports
// ================================================================
// r97: HTML과 JS 양쪽에서 같은 빌드 번호를 사용하도록 window.HIS_APP_VERSION을 우선합니다.
export const APP_VERSION = String(globalThis.HIS_APP_VERSION || "2026-06-30-group-card-multi-cell-r192");

export function versioned(path) {
  const raw = String(path || "");
  if (!raw) return raw;
  const joiner = raw.includes("?") ? "&" : "?";
  return `${raw}${joiner}v=${encodeURIComponent(APP_VERSION)}`;
}
