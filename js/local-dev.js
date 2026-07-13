// ================================================================
// local-dev.js · Firebase-free local development mode
// ================================================================
const MODE_KEY = "his_local_dev_mode_v1";
const DEV_TOOLS_KEY = "his_developer_tools_v1";

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




// ── Developer tools visibility switch ───────────────────────────
export function isDeveloperToolsEnabled() {
  try { return localStorage.getItem(DEV_TOOLS_KEY) !== "off"; }
  catch (_) { return true; }
}

export function setDeveloperToolsEnabled(enabled) {
  try { localStorage.setItem(DEV_TOOLS_KEY, enabled ? "on" : "off"); } catch (_) {}
  applyDeveloperToolsVisibility();
}

function ensureDeveloperToggleButton() {
  const localBtn = document.getElementById("topLocalModeBtn");
  const modeSwitch = localBtn?.closest?.(".top-mode-switch, .tt-mode-switch");
  const host = modeSwitch?.parentElement || document.querySelector(".topbar-right, .tt-topbar-right");
  if (!host) return null;
  let btn = document.getElementById("topDeveloperToolsBtn");
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "topDeveloperToolsBtn";
    btn.type = "button";
    btn.className = host.classList.contains("tt-topbar-right") ? "tt-mode-btn developer-toggle-btn" : "secondary-btn top-mode-btn developer-toggle-btn";
    btn.title = "개발자 도구 버튼 표시/숨김";
    if (modeSwitch) modeSwitch.insertAdjacentElement("beforebegin", btn);
    else host.insertBefore(btn, host.firstChild);
  }
  return btn;
}

function applyDeveloperToolsVisibility() {
  const enabled = isDeveloperToolsEnabled();
  document.documentElement.classList.toggle("his-dev-tools-off", !enabled);
  document.documentElement.classList.toggle("his-dev-tools-on", enabled);
  if (document.body) {
    document.body.classList.toggle("his-dev-tools-off", !enabled);
    document.body.classList.toggle("his-dev-tools-on", enabled);
  }
  const btn = ensureDeveloperToggleButton();
  if (btn) {
    btn.textContent = enabled ? "개발자 ON" : "개발자 OFF";
    btn.classList.toggle("mode-active", enabled);
    btn.classList.toggle("developer-on", enabled);
    btn.classList.toggle("developer-off", !enabled);
    btn.setAttribute("aria-pressed", enabled ? "true" : "false");
    btn.onclick = (event) => {
      event.preventDefault();
      setDeveloperToolsEnabled(!isDeveloperToolsEnabled());
    };
  }
}

// ── Top Local/Online mode switch buttons ─────────────────────────
function currentModeFromStorage() {
  try { return localStorage.getItem(MODE_KEY) === "on"; }
  catch (_) { return LOCAL_DEV_MODE; }
}

function applyModeToUrl(local) {
  const url = new URL(window.location.href);
  url.searchParams.set("local", local ? "1" : "0");
  window.location.href = url.toString();
}

async function seedLocalStateFromCurrentRuntime() {
  // 온라인 화면에서 이미 불러온 Firestore 데이터를 로컬 저장소로 복사합니다.
  // Firestore quota가 막힌 뒤에도, 현재 화면에 로드된 데이터만큼은 local=1에서 계속 테스트할 수 있습니다.
  try {
    const mod = await import("./state.js?v=2026-07-13-system-audit-r343");
    if (typeof mod.seedLocalSnapshotFromRuntime === "function") {
      return mod.seedLocalSnapshotFromRuntime();
    }
  } catch (e) {
    console.warn("Local mode seed skipped.", e);
  }
  return null;
}

async function switchModeToLocal() {
  const localBtn = document.getElementById("topLocalModeBtn");
  try {
    if (localBtn) {
      localBtn.disabled = true;
      localBtn.textContent = "로컬 전환 중…";
    }
    if (!currentModeFromStorage()) {
      await seedLocalStateFromCurrentRuntime();
    }
  } finally {
    enableLocalDevMode();
    applyModeToUrl(true);
  }
}

function switchModeToOnline() {
  disableLocalDevMode();
  applyModeToUrl(false);
}

function setupTopModeSwitchButtons() {
  applyDeveloperToolsVisibility();
  const localBtn = document.getElementById("topLocalModeBtn");
  const onlineBtn = document.getElementById("topOnlineModeBtn");
  if (!localBtn || !onlineBtn) return;

  const isLocal = currentModeFromStorage();
  document.documentElement.classList.toggle("his-local-mode", isLocal);
  document.documentElement.classList.toggle("his-online-mode", !isLocal);
  if (document.body) {
    document.body.classList.toggle("his-local-mode", isLocal);
    document.body.classList.toggle("his-online-mode", !isLocal);
  }

  localBtn.textContent = "로컬 모드";
  onlineBtn.textContent = "온라인 모드";
  localBtn.classList.toggle("mode-active", isLocal);
  localBtn.classList.toggle("mode-local-active", isLocal);
  localBtn.classList.remove("mode-online-active");
  localBtn.setAttribute("aria-pressed", isLocal ? "true" : "false");
  localBtn.title = isLocal
    ? "현재 로컬 모드입니다. Firebase를 읽거나 쓰지 않습니다."
    : "현재 화면에 로드된 데이터를 로컬 저장소로 복사한 뒤 로컬 모드로 전환합니다.";

  onlineBtn.classList.remove("mode-active");
  onlineBtn.classList.toggle("mode-online-active", !isLocal);
  onlineBtn.setAttribute("aria-pressed", !isLocal ? "true" : "false");
  onlineBtn.title = isLocal
    ? "온라인 모드로 전환합니다. 이후 Firebase를 사용합니다."
    : "현재 온라인 모드입니다. Firebase를 사용합니다.";

  localBtn.onclick = (event) => {
    event.preventDefault();
    if (!currentModeFromStorage()) switchModeToLocal();
  };
  onlineBtn.onclick = (event) => {
    event.preventDefault();
    if (currentModeFromStorage()) switchModeToOnline();
  };
}

export { switchModeToLocal, switchModeToOnline, setupTopModeSwitchButtons };

if (typeof window !== "undefined") {
  window.HIS_MODE_SWITCH = {
    toLocal: switchModeToLocal,
    toOnline: switchModeToOnline,
    refresh: setupTopModeSwitchButtons,
    isLocal: currentModeFromStorage,
    isDeveloperToolsEnabled,
    setDeveloperToolsEnabled,
  };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupTopModeSwitchButtons, { once: true });
} else {
  setupTopModeSwitchButtons();
}
