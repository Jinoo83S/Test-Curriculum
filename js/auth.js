// ================================================================
// auth.js · Authentication
// ================================================================
import { auth, provider } from "./config.js";
import {
  signInWithPopup, signInWithRedirect, getRedirectResult,
  signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

export const canEdit = () => !!auth.currentUser;

export async function login() {
  try {
    // Try popup first; fall back to redirect (e.g. GitHub Pages blocks popups)
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === "auth/popup-blocked" || e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request") {
      try { await signInWithRedirect(auth, provider); }
      catch (e2) { console.error(e2); alert("로그인에 실패했습니다: " + e2.message); }
    } else if (e.code === "auth/unauthorized-domain") {
      alert("이 도메인은 Firebase에서 허용되지 않습니다.\n\nFirebase Console → Authentication → Settings → Authorized domains 에서\n현재 도메인을 추가해주세요.");
    } else {
      console.error(e); alert("로그인에 실패했습니다: " + e.message);
    }
  }
}

export async function logout() {
  try { await signOut(auth); }
  catch (e) { console.error(e); alert("로그아웃에 실패했습니다."); }
}

export function onAuth(cb) { return onAuthStateChanged(auth, cb); }

// Handle redirect result on page load (for signInWithRedirect flow)
getRedirectResult(auth)
  .then(result => { if (result?.user) console.log("Redirect login:", result.user.email); })
  .catch(e => { if (e.code !== "auth/no-current-user") console.error("Redirect result error:", e); });
