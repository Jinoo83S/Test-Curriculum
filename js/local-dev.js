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


// ── Top Local/Online mode switch buttons ─────────────────────────
function switchModeToLocal() {
  try { localStorage.setItem(MODE_KEY, "on"); } catch (_) {}
  const url = new URL(window.location.href);
  url.searchParams.set("local", "1");
  window.location.href = url.toString();
}

function switchModeToOnline() {
  try { localStorage.removeItem(MODE_KEY); } catch (_) {}
  const url = new URL(window.location.href);
  url.searchParams.set("local", "0");
  window.location.href = url.toString();
}

function setupTopModeSwitchButtons() {
  const localBtn = document.getElementById("topLocalModeBtn");
  const onlineBtn = document.getElementById("topOnlineModeBtn");
  if (!localBtn || !onlineBtn) return;

  localBtn.classList.toggle("mode-active", LOCAL_DEV_MODE);
  localBtn.classList.toggle("mode-online-active", false);
  localBtn.setAttribute("aria-pressed", LOCAL_DEV_MODE ? "true" : "false");
  localBtn.title = LOCAL_DEV_MODE
    ? "현재 로컬 모드입니다. Firebase를 읽거나 쓰지 않습니다."
    : "로컬 모드로 전환합니다. Firebase quota를 사용하지 않습니다.";

  onlineBtn.classList.toggle("mode-active", false);
  onlineBtn.classList.toggle("mode-online-active", !LOCAL_DEV_MODE);
  onlineBtn.setAttribute("aria-pressed", !LOCAL_DEV_MODE ? "true" : "false");
  onlineBtn.title = LOCAL_DEV_MODE
    ? "온라인 모드로 전환합니다. 이후 Firebase를 사용합니다."
    : "현재 온라인 모드입니다. Firebase를 사용합니다.";

  localBtn.addEventListener("click", (event) => {
    event.preventDefault();
    if (!LOCAL_DEV_MODE) switchModeToLocal();
  });
  onlineBtn.addEventListener("click", (event) => {
    event.preventDefault();
    if (LOCAL_DEV_MODE) switchModeToOnline();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupTopModeSwitchButtons, { once: true });
} else {
  setupTopModeSwitchButtons();
}
