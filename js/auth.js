// ================================================================
// auth.js · Authentication
// ================================================================
import { auth, provider } from "./config.js";
import {
  signInWithPopup, signInWithRedirect, getRedirectResult,
  signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

export const canEdit = () => !!auth.currentUser;

// Popup on localhost, redirect on deployed sites (GitHub Pages etc.)
const isLocalhost = ["localhost", "127.0.0.1"].includes(location.hostname);

export async function login() {
  if (isLocalhost) {
    try {
      await signInWithPopup(auth, provider);
      return;
    } catch (e) {
      if (e.code !== "auth/popup-blocked" && e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") {
        if (e.code === "auth/unauthorized-domain") {
          alert("이 도메인은 Firebase에서 허용되지 않습니다.\nFirebase Console → Authentication → Authorized domains 에서 도메인을 추가하세요.");
          return;
        }
        console.error(e); alert("로그인 실패: " + e.message); return;
      }
    }
  }
  // Deployed: use redirect
  try {
    await signInWithRedirect(auth, provider);
  } catch (e) {
    if (e.code === "auth/unauthorized-domain") {
      alert("이 도메인은 Firebase에서 허용되지 않습니다.\nFirebase Console → Authentication → Settings → Authorized domains 에서\n현재 도메인(" + location.hostname + ")을 추가해주세요.");
    } else {
      console.error(e); alert("로그인 실패: " + e.message);
    }
  }
}

export async function logout() {
  try { await signOut(auth); }
  catch (e) { console.error(e); alert("로그아웃에 실패했습니다."); }
}

export function onAuth(cb) { return onAuthStateChanged(auth, cb); }

// Handle redirect result on page load
getRedirectResult(auth)
  .then(result => { if (result?.user) console.log("Redirect login:", result.user.email); })
  .catch(e => {
    if (e.code === "auth/unauthorized-domain") {
      alert("Firebase 도메인 오류: " + location.hostname + "\nFirebase Console → Authentication → Authorized domains 에서 추가하세요.");
    } else if (e.code !== "auth/no-current-user" && e.code !== "auth/null-user") {
      console.error("Redirect error:", e.code, e.message);
    }
  });
