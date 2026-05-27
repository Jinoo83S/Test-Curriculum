// ================================================================
// auth.js · Authentication
// ================================================================
import { auth, provider } from "./config.js";
import { LOCAL_DEV_MODE, LOCAL_DEV_USER } from "./local-dev.js";
import {
  signInWithPopup, getRedirectResult,
  signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

export const canEdit = () => LOCAL_DEV_MODE || !!auth.currentUser;

export async function login() {
  if (LOCAL_DEV_MODE) {
    alert("로컬 개발 모드입니다. Firebase 로그인 없이 편집 가능합니다.");
    return;
  }
  if (location.protocol === "file:") {
    alert("파일을 직접 열면 로그인이 불가능합니다.\nlocalhost 또는 배포 주소에서 실행하세요.");
    return;
  }
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === "auth/unauthorized-domain") {
      alert(
        "이 도메인은 Firebase에서 허용되지 않습니다.\n\n" +
        "Firebase Console → Authentication → Settings → Authorized domains 에서\n" +
        "현재 도메인(" + location.hostname + ")을 추가해주세요."
      );
    } else if (e.code === "auth/popup-blocked") {
      alert("팝업이 차단되었습니다.\n브라우저에서 이 사이트의 팝업을 허용한 후 다시 시도하세요.");
    } else if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") {
      console.error("로그인 오류:", e);
      alert("로그인에 실패했습니다: " + e.message);
    }
  }
}

export async function logout() {
  try { await signOut(auth); }
  catch (e) { console.error(e); alert("로그아웃에 실패했습니다."); }
}

export function onAuth(cb) {
  if (LOCAL_DEV_MODE) {
    queueMicrotask(() => cb(LOCAL_DEV_USER));
    return () => {};
  }
  return onAuthStateChanged(auth, cb);
}

// redirect 로그인 잔여 처리 (이전 버전 호환)
if (!LOCAL_DEV_MODE) {
  getRedirectResult(auth)
    .then(result => { if (result?.user) console.log("Redirect login 완료:", result.user.email); })
    .catch(e => { if (e.code !== "auth/no-current-user") console.warn("Redirect result:", e.code); });
}
