// ================================================================
// local-dev.js · Firebase-free local development mode
// ================================================================
const MODE_KEY = "his_local_dev_mode_v1";

function readQueryMode() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    if (!params.has("local")) return null;
    const v = String(params.get("local") || "1").toLowerCase();
    return !(v === "0" || v === "false" || v === "off" || v === "no");
  } catch (_) {
    return null;
  }
}

const queryMode = readQueryMode();
if (queryMode !== null) {
  try {
    if (queryMode) localStorage.setItem(MODE_KEY, "on");
    else localStorage.removeItem(MODE_KEY);
  } catch (_) {}
}

export const LOCAL_DEV_MODE = (() => {
  if (queryMode !== null) return queryMode;
  try { return localStorage.getItem(MODE_KEY) === "on"; }
  catch (_) { return false; }
})();

export const LOCAL_STATE_KEY = "his_local_dev_state_v1";

export const LOCAL_DEV_USER = {
  uid: "local-dev-user",
  email: "local-dev@his.local",
  displayName: "Local Dev",
  isAnonymous: false,
};

export function enableLocalDevMode() {
  try { localStorage.setItem(MODE_KEY, "on"); } catch (_) {}
}

export function disableLocalDevMode() {
  try { localStorage.removeItem(MODE_KEY); } catch (_) {}
}

export function readLocalStateStore() {
  try {
    const raw = localStorage.getItem(LOCAL_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    console.warn("Local dev state could not be read.", e);
    return {};
  }
}

export function writeLocalStateStore(data) {
  try {
    localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(data || {}));
    return true;
  } catch (e) {
    console.error("Local dev state could not be saved.", e);
    return false;
  }
}

export function clearLocalStateStore() {
  try { localStorage.removeItem(LOCAL_STATE_KEY); return true; }
  catch (_) { return false; }
}
