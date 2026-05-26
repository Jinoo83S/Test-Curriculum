// ================================================================
// timetable-auth-ui.js · Auth status UI for timetable page
// ================================================================

const AUTH_SESSION_KEY = "his_auth_recent_user_v1";
const AUTH_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

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

export function createTimetableAuthUi({ statusEl, loginBtn, logoutBtn }) {
  let authResolved = false;

  function setAuthCheckingUI() {
    const recent = readRecentAuthSession();
    if (statusEl()) statusEl().textContent = recent?.label ? `${recent.label} 로그인 확인 중…` : "로그인 확인 중…";
    loginBtn()?.classList.add("hidden");
    logoutBtn()?.classList.add("hidden");
  }

  function updateAuthUI(user) {
    authResolved = true;
    writeRecentAuthSession(user);
    if (user) {
      if (statusEl()) statusEl().textContent = user.displayName || user.email || "로그인됨";
      loginBtn()?.classList.add("hidden");
      logoutBtn()?.classList.remove("hidden");
    } else {
      if (statusEl()) statusEl().textContent = "로그인 필요";
      loginBtn()?.classList.remove("hidden");
      logoutBtn()?.classList.add("hidden");
    }
  }

  return { get authResolved() { return authResolved; }, setAuthCheckingUI, updateAuthUI };
}
