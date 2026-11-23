// ================================================================
// auth.js · Authentication
// ================================================================
import { auth, provider, getSchoolYearRefs, ACTIVE_SCHOOL_YEAR } from "./config.js?v=2026-07-15-room-availability-separation-r355";
import { LOCAL_DEV_MODE, LOCAL_DEV_USER } from "./local-dev.js?v=2026-07-15-room-availability-separation-r355";
import {
  signInWithPopup, getRedirectResult,
  signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const FIXED_PORTAL_ADMINS = new Set(["jinwoosuk@his.sc.kr"]);
const normalizeEmail = value => String(value || "").trim().toLocaleLowerCase();
const normalizeRole = value => ["basic", "curriculum", "admin"].includes(value) ? value : "basic";
let currentAccessRole = LOCAL_DEV_MODE ? "admin" : "none";
const withTimeout = (promise, milliseconds, message) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(message)), milliseconds)),
]);

export const getCurrentAccessRole = () => currentAccessRole;
export const canAccessCurriculum = () => LOCAL_DEV_MODE || ["curriculum", "admin"].includes(currentAccessRole);
export const canManageTeachers = () => LOCAL_DEV_MODE || currentAccessRole === "admin";
export const canEdit = () => !!auth.currentUser && canAccessCurriculum() || LOCAL_DEV_MODE;

async function resolveAccessRole(user) {
  const email = normalizeEmail(user?.email);
  if (!user || !email) return "none";
  if (FIXED_PORTAL_ADMINS.has(email)) return "admin";
  if (!email.endsWith("@his.sc.kr")) return "none";
  try {
    const snapshot = await withTimeout(getDoc(getSchoolYearRefs(ACTIVE_SCHOOL_YEAR).domains.teachers), 10000, "교사 권한 확인 시간이 초과되었습니다.");
    const teachers = snapshot.exists() && Array.isArray(snapshot.data()?.teachers) ? snapshot.data().teachers : [];
    const teacher = teachers.find(item => normalizeEmail(item?.email) === email);
    if (!teacher || teacher.portalDisabled) return "none";
    return normalizeRole(teacher.accessRole);
  } catch (error) {
    console.warn("[auth role]", error);
    return "none";
  }
}

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
    currentAccessRole = "admin";
    queueMicrotask(() => cb(LOCAL_DEV_USER, { role: currentAccessRole }));
    return () => {};
  }
  return onAuthStateChanged(auth, async user => {
    currentAccessRole = await resolveAccessRole(user);
    cb(user, { role: currentAccessRole });
  });
}

// redirect 로그인 잔여 처리 (이전 버전 호환)
if (!LOCAL_DEV_MODE) {
  getRedirectResult(auth)
    .then(result => { if (result?.user) console.log("Redirect login 완료:", result.user.email); })
    .catch(e => { if (e.code !== "auth/no-current-user") console.warn("Redirect result:", e.code); });
}
