// ================================================================
// auth.js · Authentication
// ================================================================
import { auth, provider } from "./config.js";
import { signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

export const canEdit = () => !!auth.currentUser;

export async function login() {
  try { await signInWithPopup(auth, provider); }
  catch (e) { console.error(e); alert("로그인에 실패했습니다."); }
}
export async function logout() {
  try { await signOut(auth); }
  catch (e) { console.error(e); alert("로그아웃에 실패했습니다."); }
}

export function onAuth(cb) { return onAuthStateChanged(auth, cb); }
