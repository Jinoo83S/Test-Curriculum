import { auth, db, getSchoolYearRefs, LEGACY_SCHOOL_YEAR } from "./config.js?v=2026-07-15-room-availability-separation-r355";
import { getKnownSchoolYears, registerKnownSchoolYears } from "./school-year.js?v=2026-07-15-room-availability-separation-r355";
import { deleteField, doc, getDoc, getDocFromServer, getDocs, getDocsFromServer, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { summarizeFacultyWorkload } from "./faculty-workload.js?v=r434";
import { normalizeChecklistReportOptions } from "./checklist-report-options.js?v=r440";
import { readTeacherPortalAccess } from "./teacher-portal-auth.js?v=r424";

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
    templateGroups: Array.isArray(values.templates?.templateGroups) ? values.templates.templateGroups.filter(Boolean) : [],
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
  const data = snapshot.data();
  const value = data?.curriculumPublished;
  // Workspaces without a saved preference retain their existing portal visibility.
  return {
    published: value !== false,
    configured: typeof value === "boolean",
    workload: Array.isArray(data?.facultyWorkload) ? data.facultyWorkload : null,
    reportOptions: normalizeChecklistReportOptions(data?.checklistReportOptions),
  };
}

export async function saveChecklistReportOptions(year, draft, baseline) {
  if (!/^20[2-9]\d$/.test(year)) throw new Error("학년도를 확인해 주세요.");
  const access = await readTeacherPortalAccess(auth.currentUser, year);
  if (!access.allowed || !access.isAdmin || access.user.uid !== auth.currentUser?.uid) {
    throw new Error("관리자 권한이 필요합니다.");
  }
  const reportOptions = normalizeChecklistReportOptions(draft);
  const expected = JSON.stringify(normalizeChecklistReportOptions(baseline));
  const ref = publicationRef(year);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists() && year !== LEGACY_SCHOOL_YEAR) throw new Error("등록된 학년도가 아닙니다.");
    if (access.user.uid !== auth.currentUser?.uid) throw new Error("로그인 계정이 변경되었습니다.");
    const current = normalizeChecklistReportOptions(snapshot.data()?.checklistReportOptions);
    if (JSON.stringify(current) !== expected) throw new Error("다른 곳에서 선택지가 변경됐습니다. 다시 불러온 뒤 수정해 주세요.");
    transaction.set(ref, { checklistReportOptions: reportOptions }, { merge: true });
  });
  return reportOptions;
}

export async function saveCurriculumPublication(year, published) {
  if (!/^20[2-9]\d$/.test(year) || typeof published !== "boolean") throw new Error("학년도와 공개 상태를 확인해 주세요.");
  const ref = publicationRef(year);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists() && year !== LEGACY_SCHOOL_YEAR) throw new Error("이 학년도가 삭제되었거나 등록되지 않았습니다.");
    transaction.set(ref, {
      curriculumPublished: published,
      curriculumPublicationUpdatedAt: serverTimestamp(),
      ...(!published ? { facultyWorkload: deleteField() } : {}),
    }, { merge: true });
  });
}

export async function readFacultyWorkloadFromRosters(year) {
  if (!/^20[2-9]\d$/.test(year)) throw new Error("학년도를 확인해 주세요.");
  const { collections, domains } = getSchoolYearRefs(year);
  let splitError;
  const current = await withDeadline(getDocsFromServer(collections.rosters), "학급 수와 교사시수 조회 시간이 초과되었습니다.")
    .catch(error => { splitError = error; });
  let entries;
  if (current && !current.empty) {
    entries = current.docs.map(item => {
      const data = item.data();
      return { id: data.templateId || item.id, meta: data.meta };
    });
  } else {
    const legacy = await withDeadline(getDocFromServer(domains.rosters), "과목 설정 조회 시간이 초과되었습니다.");
    if (splitError && !legacy.data()?.rosterMeta) throw splitError;
    entries = Object.entries(legacy.data()?.rosterMeta || {}).map(([id, meta]) => ({ id, meta }));
  }
  return summarizeFacultyWorkload(entries).map(([id, meta]) => ({ id, ...meta }));
}

export async function publishFacultyWorkload(year, workload) {
  if (!/^20[2-9]\d$/.test(year)) throw new Error("학년도를 확인해 주세요.");
  const cleanWorkload = records => summarizeFacultyWorkload(records.map(({ id, classCount, teacherLoadHours }) =>
    ({ id, meta: { classCount, teacherLoadHours } })))
    .map(([id, meta]) => ({ id, ...meta })).sort((a, b) => a.id.localeCompare(b.id));
  const next = cleanWorkload(workload);
  const ref = publicationRef(year);
  await runTransaction(db, async transaction => {
    const setting = await transaction.get(ref);
    const data = setting.data();
    if ((!setting.exists() && year !== LEGACY_SCHOOL_YEAR) || data?.curriculumPublished === false) {
      throw new Error("등록된 공개 학년도만 시수를 갱신할 수 있습니다.");
    }
    if (Array.isArray(data?.facultyWorkload) && JSON.stringify(cleanWorkload(data.facultyWorkload)) === JSON.stringify(next)) return;
    transaction.set(ref, { facultyWorkload: next, facultyWorkloadUpdatedAt: serverTimestamp() }, { merge: true });
  });
  return next.length;
}

export async function syncPublishedFacultyWorkload(year) {
  return publishFacultyWorkload(year, await readFacultyWorkloadFromRosters(year));
}
