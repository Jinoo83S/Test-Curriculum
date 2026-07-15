// ================================================================
// app-auth-ui.js · Main app login/logout status UI
// ================================================================
import { login, logout } from "./auth.js?v=2026-07-14-school-year-isolation-r351";

const AUTH_SESSION_KEY = "his_auth_recent_user_v1";
const AUTH_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const authStatusEl = document.getElementById("authStatus");
const loginBtn = document.getElementById("loginBtn");
// 이전 HTML에 남아 있을 수 있는 레거시 로그아웃 버튼입니다.
const logoutBtn = document.getElementById("logoutBtn");
const loginOverlayEl = document.getElementById("loginOverlay");

let currentAuthUser = null;
let authUiReady = false;

function readRecentAuthSession() {
  try {
    const raw = sessionStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.ts || Date.now() - data.ts > AUTH_SESSION_MAX_AGE_MS) {
      sessionStorage.removeItem(AUTH_SESSION_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function writeRecentAuthSession(user) {
  try {
    if (!user) {
      sessionStorage.removeItem(AUTH_SESSION_KEY);
      return;
    }
    sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({
      ts: Date.now(),
      label: user.displayName || user.email || "사용자"
    }));
  } catch {
    // sessionStorage가 막힌 환경에서도 앱은 계속 동작해야 합니다.
  }
}

export function getCurrentAuthUser() {
  return currentAuthUser;
}

export function setAuthCheckingUI() {
  const recent = readRecentAuthSession();
  currentAuthUser = null;

  if (authStatusEl) {
    authStatusEl.textContent = recent?.label
      ? `${recent.label} 로그인 확인 중…`
      : "로그인 확인 중…";
  }

  if (loginBtn) {
    loginBtn.textContent = "로그인 확인 중…";
    loginBtn.disabled = true;
    loginBtn.classList.remove("hidden");
    loginBtn.classList.add("primary-btn");
    loginBtn.classList.remove("secondary-btn");
  }

  logoutBtn?.classList.add("hidden");
  loginOverlayEl?.classList.add("hidden");
}

export function updateAuthUI(user) {
  currentAuthUser = user || null;
  writeRecentAuthSession(user);

  if (loginBtn) {
    loginBtn.disabled = false;
    loginBtn.classList.remove("hidden");
    loginBtn.textContent = user ? "로그아웃" : "Google 로그인";
    loginBtn.title = user ? "현재 계정에서 로그아웃합니다." : "Google 계정으로 로그인합니다.";
    loginBtn.classList.toggle("primary-btn", !user);
    loginBtn.classList.toggle("secondary-btn", !!user);
  }

  logoutBtn?.classList.add("hidden");

  if (user) {
    if (authStatusEl) authStatusEl.textContent = `${user.displayName || user.email || "사용자"} 로그인됨`;
    loginOverlayEl?.classList.add("hidden");
  } else {
    if (authStatusEl) authStatusEl.textContent = "로그인이 필요합니다";
    loginOverlayEl?.classList.remove("hidden");
  }
}

export function setupAuthUi() {
  if (authUiReady) return;
  authUiReady = true;

  loginBtn?.addEventListener("click", () => {
    if (currentAuthUser) logout();
    else login();
  });

  logoutBtn?.addEventListener("click", logout);
}
