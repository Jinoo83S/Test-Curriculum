import { auth, db, getSchoolYearRefs, ACTIVE_SCHOOL_YEAR, LEGACY_SCHOOL_YEAR } from "./config.js?v=2026-07-15-room-availability-separation-r355";
import { getDoc, doc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const normalizePortalEmail = value => String(value || "").trim().toLocaleLowerCase();
export const isSchoolEmail = value => normalizePortalEmail(value).endsWith("@his.sc.kr");
export const TEACHER_PORTAL_ADMIN_EMAILS = new Set([
  "jinwoosuk@his.sc.kr",
]);

export async function readTeacherPortalAccess(user, year = ACTIVE_SCHOOL_YEAR) {
  const email = normalizePortalEmail(user?.email);
  if (!user || !email) return { allowed: false, reason: "Google 로그인이 필요합니다." };
  if (!isSchoolEmail(email)) return { allowed: false, reason: `${email} 계정은 @his.sc.kr 학교 계정이 아닙니다.` };
  if (TEACHER_PORTAL_ADMIN_EMAILS.has(email)) return {
    allowed: true,
    isAdmin: true,
    user,
    email,
    teacher: { id: "teacher-portal-admin", name: user.displayName || "관리자", email },
    teachers: [],
  };
  const ref = getSchoolYearRefs(year).domains.teachers;
  const snapshot = await getDoc(ref);
  const teachers = snapshot.exists() && Array.isArray(snapshot.data()?.teachers) ? snapshot.data().teachers : [];
  const teacher = teachers.find(item => normalizePortalEmail(item?.email) === email) || null;
  if (!teacher) return {
    allowed: false,
    reason: `${year}학년도 교사목록에서 ${email} 계정을 찾지 못했습니다. 관리자에게 교사 이메일 등록을 요청해 주세요.`,
    teachers,
  };
  return { allowed: true, user, email, teacher, teachers };
}

export function teacherChecklistDocRef(user, year = ACTIVE_SCHOOL_YEAR) {
  if (!user?.uid) throw new Error("로그인 사용자 ID가 없습니다.");
  return year === LEGACY_SCHOOL_YEAR
    ? doc(db, "boards", `teacherChecklist_${user.uid}`)
    : doc(db, "schoolYears", String(year), "teacherChecklist", user.uid);
}

export { auth };
