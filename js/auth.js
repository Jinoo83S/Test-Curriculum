// ================================================================
// auth.js · Authentication
// ================================================================
import { auth, provider } from "./config.js";
import {
  signInWithPopup, signInWithRedirect, getRedirectResult,
  signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

export const canEdit = () => !!auth.currentUser;

// GitHub Pages / 배포 환경에서는 signInWithRedirect 사용
// (signInWithPopup은 Firebase Hosting이 아닌 도메인에서 /__/firebase/init.json 404 오류 발생)
const isLocalhost = ["localhost", "127.0.0.1"].includes(location.hostname);

export async function login() {
  try {
    if (isLocalhost) {
      await signInWithPopup(auth, provider);
    } else {
      await signInWithRedirect(auth, provider);
    }
  } catch (e) {
    if (e.code === "auth/unauthorized-domain") {
      alert("이 도메인은 Firebase에서 허용되지 않습니다.\n\nFirebase Console → Authentication → Settings → Authorized domains 에서\n현재 도메인(" + location.hostname + ")을 추가해주세요.");
    } else if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") {
      console.error(e);
      alert("로그인에 실패했습니다: " + e.message);
    }
  }
}

export async function logout() {
  try { await signOut(auth); }
  catch (e) { console.error(e); alert("로그아웃에 실패했습니다."); }
}

export function onAuth(cb) { return onAuthStateChanged(auth, cb); }

// 페이지 로드 시 redirect 결과 처리 (signInWithRedirect 완료 후 복귀 시)
getRedirectResult(auth)
  .then(result => {
    if (result?.user) {
      console.log("✅ Redirect login 완료:", result.user.email);
    }
  })
  .catch(e => {
    if (e.code === "auth/unauthorized-domain") {
      alert("Firebase 도메인 오류 (" + location.hostname + ")\nFirebase Console → Authentication → Authorized domains 에서 추가하세요.");
    } else if (e.code !== "auth/no-current-user") {
      console.error("Redirect result error:", e.code, e.message);
    }
  });
