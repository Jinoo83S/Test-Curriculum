import { db, getSchoolYearRefs, LEGACY_SCHOOL_YEAR } from "./config.js?v=2026-07-15-room-availability-separation-r355";
import { getKnownSchoolYears, registerKnownSchoolYears } from "./school-year.js?v=2026-07-15-room-availability-separation-r355";
import { doc, getDoc, getDocFromServer, getDocs, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

function withDeadline(promise, message) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 9000); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function readRegisteredPortalYears() {
  const snapshot = await withDeadline(getDocs(getSchoolYearRefs().schoolYearsCollection), "학년도 목록 조회 시간이 초과되었습니다.");
  const years = snapshot.docs.map(item => item.id).filter(id => /^20[2-9]\d$/.test(id));
  registerKnownSchoolYears(years);
  return [...new Set([LEGACY_SCHOOL_YEAR, ...years])].sort((a, b) => Number(b) - Number(a));
}

export async function readTeacherYearSources(year, { teachersOnly = false } = {}) {
  const { domains } = getSchoolYearRefs(year);
  const fields = teachersOnly ? ["teachers"] : ["teachers", "curriculum", "templates"];
  const data = await withDeadline(Promise.all(fields.map(field => getDoc(domains[field]).then(snapshot => snapshot.data()))),
    `${year}학년도 교사 자료 조회 시간이 초과되었습니다.`);
  const values = Object.fromEntries(fields.map((field, index) => [field, data[index]]));
  return {
    teachers: Array.isArray(values.teachers?.teachers) ? values.teachers.teachers.filter(Boolean) : [],
    curriculum: values.curriculum,
    templates: Array.isArray(values.templates?.templates) ? values.templates.templates.filter(Boolean) : [],
  };
}

export async function readSavedTeacherDirectory(excludeYear) {
  const years = await readRegisteredPortalYears().catch(() => getKnownSchoolYears());
  const results = await Promise.allSettled(years.filter(year => year !== excludeYear)
    .map(year => readTeacherYearSources(year, { teachersOnly: true })));
  return results.flatMap(result => result.status === "fulfilled" ? result.value.teachers : []);
}

function publicationRef(year) {
  return getSchoolYearRefs(year).workspaceMeta || doc(db, "boards", "curriculumPublication");
}

export async function readCurriculumPublication(year) {
  const snapshot = await withDeadline(getDocFromServer(publicationRef(year)), "커리큘럼 공개 상태 조회 시간이 초과되었습니다.");
  const value = snapshot.data()?.curriculumPublished;
  // Workspaces without a saved preference retain their existing portal visibility.
  return { published: value !== false, configured: typeof value === "boolean" };
}

export async function saveCurriculumPublication(year, published) {
  if (!/^20[2-9]\d$/.test(year) || typeof published !== "boolean") throw new Error("학년도와 공개 상태를 확인해 주세요.");
  const ref = publicationRef(year);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists() && year !== LEGACY_SCHOOL_YEAR) throw new Error("이 학년도가 삭제되었거나 등록되지 않았습니다.");
    transaction.set(ref, { curriculumPublished: published, curriculumPublicationUpdatedAt: serverTimestamp() }, { merge: true });
  });
}
