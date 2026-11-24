import { login, logout, onAuth } from "./auth.js?v=r424";
import { ACTIVE_SCHOOL_YEAR, GRADE_KEYS, getSchoolYearRefs } from "./config.js?v=2026-07-15-room-availability-separation-r355";
import { getKnownSchoolYears, setActiveSchoolYear } from "./school-year.js?v=2026-07-15-room-availability-separation-r355";
import { getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { normalizePortalEmail, readTeacherPortalAccess, teacherChecklistDocRef, teacherChecklistSharedDocRef } from "./teacher-portal-auth.js?v=r424";
import { publishFacultyWorkload, readCurriculumPublication, readFacultyWorkloadFromRosters, readRegisteredPortalYears, readTeacherYearSources } from "./school-portal-settings-data.js?v=r444";
import { buildReadOnlyCurriculumRows, groupTeacherAssignments, renderAnnualCurriculumTable, renderTeacherAssignmentTable, summarizeCurriculumGrades } from "./curriculum-read-view.js?v=r442";
import { facultyCourseWorkload } from "./faculty-workload.js?v=r434";
import { CHAPEL_PERIODS, isChapelTitle } from "./chapel-schedule.js?v=r439";
import { CHECKLIST_REPORT_SECTIONS, REPORT_FIELDS, localizedReportValue,
  normalizeChecklistReportOptions, normalizeReportValue } from "./checklist-report-options.js?v=r444";

const page = document.body.dataset.portalPage || "menu";
const teachersView = page === "curriculum-view" && new URLSearchParams(location.search).get("view") === "teachers";
const byId = id => document.getElementById(id);
const withTimeout = (promise, milliseconds, message) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(message)), milliseconds)),
]);
const clean = value => String(value ?? "").trim();
const unique = values => [...new Set(values.filter(Boolean))];
let authSerial = 0;
let currentPortalUser = null;
let redrawPortalPage = null;
const LANGUAGE_KEY = "his_portal_language_v1";
const translations = {
  ko: { curriculumShortcut:"커리큘럼 편집", teacherManagement:"교사관리", schoolYear:"학년도", schoolYearShort:"학년도", googleLogin:"Google 로그인", logout:"로그아웃", checkingAccess:"접근 권한을 확인하고 있습니다", checkingAccessDescription:"교사목록의 학교 이메일과 로그인 계정을 대조합니다.", signInTitle:"학교 Google 계정으로 로그인해 주세요", signInDescription:"교사목록에 등록된 @his.sc.kr 계정만 이용할 수 있습니다.", accessDenied:"교사용 메뉴 접근 권한이 없습니다", portalTitle:"교직원 업무 메뉴", portalDescription:"본인 계정으로 로그인하면 담당 과목과 필요한 확인 업무만 표시됩니다.", welcome:"환영합니다", facultyArea:"교사 업무", facultyAreaDescription:"일반 교사가 사용하는 확인·제출 페이지입니다.", courseChecklist:"담당 과목 확인", courseChecklistDescription:"학기별 담당 과목, Google 폴더, 교과계획서 필수 항목을 확인합니다.", openTask:"업무 열기", moreTasks:"추가 교직원 업무", moreTasksDescription:"새로운 확인 페이지가 이 메뉴에 순차적으로 추가됩니다.", operationsArea:"커리큘럼·시간표 관리", operationsAreaDescription:"권한이 있는 교직원만 접근하는 편집 영역입니다.", curriculumEditor:"커리큘럼 편집", curriculumEditorDescription:"연간·3개년 커리큘럼과 과목카드를 편집합니다.", timetable:"시간표", timetableDescription:"시간표 사전작업, 자동배치와 결과를 관리합니다.", openEditor:"편집 열기", teacherManagementDescription:"교사를 등록·편집·삭제하고 접근 권한을 설정합니다.", manage:"관리하기" },
  en: { curriculumShortcut:"Edit Curriculum", teacherManagement:"Teacher Management", schoolYear:"School Year", schoolYearShort:"School Year", googleLogin:"Sign in with Google", logout:"Sign out", checkingAccess:"Checking your access", checkingAccessDescription:"Matching your school email with the teacher list.", signInTitle:"Sign in with your school Google account", signInDescription:"Only @his.sc.kr accounts registered in the teacher list can use this portal.", accessDenied:"You do not have access to the faculty portal", portalTitle:"Faculty Work Portal", portalDescription:"Sign in to see only your assigned courses and required tasks.", welcome:"Welcome", facultyArea:"Faculty Tasks", facultyAreaDescription:"Check and submission pages used by all teachers.", courseChecklist:"Assigned Course Checklist", courseChecklistDescription:"Review assigned courses, Google folders, and required curriculum items by semester.", openTask:"Open task", moreTasks:"More Faculty Tasks", moreTasksDescription:"New faculty pages will be added here as they become available.", operationsArea:"Curriculum & Timetable", operationsAreaDescription:"Editing area for staff with curriculum or administrator access.", curriculumEditor:"Curriculum Editor", curriculumEditorDescription:"Edit annual and three-year curricula and course cards.", timetable:"Timetable", timetableDescription:"Manage preparation, automatic scheduling, and results.", openEditor:"Open editor", teacherManagementDescription:"Add, edit, delete teachers and assign access levels.", manage:"Manage" }
};
Object.assign(translations.ko, { settings: "설정", settingsDescription: "교사와 학년도별 커리큘럼 공개 여부를 관리합니다." });
Object.assign(translations.en, { settings: "Settings", settingsDescription: "Manage teachers and curriculum visibility by school year." });
Object.assign(translations.ko, {
  facultyCurriculum: "커리큘럼 열람", facultyCurriculumDescription: "공개된 연간 커리큘럼을 학년별로 확인합니다.",
  facultyAssignments: "교사별 담당 현황", facultyAssignmentsDescription: "1·2학기 담당 과목과 시수를 나란히 확인합니다. 내 담당은 목록 위에 표시됩니다.",
  backToWorkPage: "업무 메뉴로 돌아가기", readOnly: "보기 전용", facultyUnavailable: "열람할 수 없습니다",
});
Object.assign(translations.en, {
  facultyCurriculum: "View Curriculum", facultyCurriculumDescription: "Browse the published annual curriculum by grade.",
  facultyAssignments: "Teacher Assignments", facultyAssignmentsDescription: "Compare course assignments across both semesters. Your courses appear first.",
  backToWorkPage: "Back to Faculty Menu", readOnly: "Read only", facultyUnavailable: "This page is unavailable",
});
let portalLanguage = localStorage.getItem(LANGUAGE_KEY) === "en" ? "en" : "ko";

Object.assign(translations.ko, {
  checklistTitle: "전체 담당 과목 확인", checklistHelp: "모든 과목을 볼 수 있으며 본인 담당 과목을 편집할 수 있습니다.",
  checklistAdminHelp: "관리자는 모든 과목을 편집할 수 있습니다.", checklistProgress: "현재 목록 최종 확인",
  semester1: "1학기", semester2: "2학기", allCourses: "전체 과목", myCourses: "내 담당만", allGrades: "전체 학년",
  checklistCourse: "과목", checklistFolder: "Google 폴더", checklistFolderUrl: "Drive 폴더 URL", checklistOpen: "열기",
  syllabus: "실라버스", safetyEducation: "안전교육", safetySexEducation: "성교육", absentStudentPolicy: "결석 학생 정책",
  checklistConfirm: "확인", checklistEmpty: "현재 조건에 맞는 과목이 없습니다", checklistSearch: "과목·교사 검색",
  checklistReady: "저장 준비", checklistSaving: "저장 중…", checklistSaved: "저장됨", checklistError: "저장 실패",
  previousReportValue: "기존 값",
});
Object.assign(translations.en, {
  checklistTitle: "Assigned Course Checklist", checklistHelp: "You can view all courses and edit your assigned courses.",
  checklistAdminHelp: "Administrators can edit all courses.", checklistProgress: "Confirmed in this view",
  semester1: "Semester 1", semester2: "Semester 2", allCourses: "All courses", myCourses: "My courses", allGrades: "All grades",
  checklistCourse: "Course", checklistFolder: "Google Folder", checklistFolderUrl: "Drive folder URL", checklistOpen: "Open",
  syllabus: "Syllabus", safetyEducation: "Safety Education", safetySexEducation: "Safety (Sex) Education", absentStudentPolicy: "Policy for Absent Students",
  checklistConfirm: "Confirm", checklistEmpty: "No courses match the current filters", checklistSearch: "Search courses or teachers",
  checklistReady: "Ready to save", checklistSaving: "Saving…", checklistSaved: "Saved", checklistError: "Save failed",
  previousReportValue: "Previous value",
});
const translate = key => translations[portalLanguage][key];

function applyLanguage() {
  document.documentElement.lang = portalLanguage;
  document.querySelectorAll("[data-i18n]").forEach(node => {
    const text = translations[portalLanguage]?.[node.dataset.i18n];
    if (text) node.textContent = text;
  });
  document.querySelectorAll("#portalYearSelect option").forEach(option => {
    if (option.value) option.textContent = portalLanguage === "ko" ? `${option.value}학년도` : `School Year ${option.value}`;
    else option.textContent = portalLanguage === "ko" ? "공개 학년도 선택" : "Select a published year";
  });
  const button = byId("portalLanguageBtn");
  if (button) button.textContent = portalLanguage === "ko" ? "English" : "한국어";
  const status = byId("portalAuthStatus");
  if (status && !currentPortalUser) status.textContent = portalLanguage === "ko" ? "로그인 필요" : "Sign-in required";
  redrawPortalPage?.();
}

function setupLanguage() {
  applyLanguage();
  byId("portalLanguageBtn")?.addEventListener("click", () => {
    portalLanguage = portalLanguage === "ko" ? "en" : "ko";
    localStorage.setItem(LANGUAGE_KEY, portalLanguage);
    applyLanguage();
  });
}

function setVisible(id, visible) {
  const node = byId(id);
  if (node) node.hidden = !visible;
}

function setupYearSelector() {
  const select = byId("portalYearSelect");
  if (!select) return;
  const years = [...new Set([...getKnownSchoolYears(), ACTIVE_SCHOOL_YEAR])].sort((a, b) => Number(b) - Number(a));
  select.replaceChildren(...years.map(year => {
    const option = document.createElement("option");
    option.value = year; option.textContent = `${year}학년도`; option.selected = year === ACTIVE_SCHOOL_YEAR;
    return option;
  }));
  select.addEventListener("change", () => { if (select.value) setActiveSchoolYear(select.value); });
  if (byId("portalHeroYear")) byId("portalHeroYear").textContent = ACTIVE_SCHOOL_YEAR;
}

function setupAuthButtons() {
  byId("portalLoginBtn")?.addEventListener("click", login);
  byId("portalLoginMainBtn")?.addEventListener("click", login);
  byId("portalLogoutBtn")?.addEventListener("click", logout);
}

function renderAuthChrome(user) {
  currentPortalUser = user || null;
  const status = byId("portalAuthStatus");
  if (status) status.textContent = user?.email || (portalLanguage === "ko" ? "로그인 필요" : "Sign-in required");
  if (byId("portalLoginBtn")) byId("portalLoginBtn").hidden = !!user;
  if (byId("portalLogoutBtn")) byId("portalLogoutBtn").hidden = !user;
}

function showGate(name, message = "") {
  ["portalLoading", "portalSignedOut", "portalDenied", "portalDashboard", "checklistApp", "facultyCurriculumApp"].forEach(id => setVisible(id, id === name));
  if (name === "portalDenied" && byId("portalDeniedMessage")) byId("portalDeniedMessage").textContent = message;
}

function renderMenu(access) {
  byId("portalTeacherName").textContent = `${access.teacher.name || "선생님"} 선생님`;
  byId("portalTeacherEmail").textContent = access.email;
  const curriculumAllowed = ["curriculum", "admin"].includes(access.role);
  setVisible("portalCurriculumShortcut", curriculumAllowed);
  setVisible("portalManagementArea", curriculumAllowed);
  setVisible("portalTeacherManageShortcut", access.isAdmin);
  setVisible("portalTeacherManagementCard", access.isAdmin);
  showGate("portalDashboard");
}

function splitTeacherNames(value) {
  return clean(value).split(/[,，·]+/).map(clean).filter(Boolean);
}

function semesterInfo(template, semester) {
  const prefix = semester === "sem2" ? "sem2" : "sem1";
  const teacherList = field => Array.isArray(template?.[field]) ? template[field].map(clean).filter(Boolean) : [];
  const assignment = term => ({
    ids: teacherList(term ? `${term}TeacherIds` : "teacherIds"),
    names: teacherList(term ? `${term}TeacherNames` : "teacherNames"),
    text: template?.[term ? `${term}Teacher` : "teacher"],
  });
  const base = assignment("");
  const selected = [assignment(prefix), ...(prefix === "sem2" ? [assignment("sem1")] : []), base]
    .find(({ ids, names, text }) => ids.length || names.length || clean(text)) || base;
  return {
    nameKo: clean(template?.[`${prefix}NameKo`]) || clean(template?.nameKo) || clean(template?.nameEn) || "이름 없는 과목",
    nameEn: clean(template?.[`${prefix}NameEn`]) || clean(template?.nameEn),
    teacherIds: selected.ids,
    teacherNames: unique([...selected.names, ...splitTeacherNames(selected.text)]),
  };
}

function teacherMatches(info, teacher) {
  const id = clean(teacher?.id);
  const names = unique([clean(teacher?.name), ...(Array.isArray(teacher?.aliases) ? teacher.aliases.map(clean) : [])]);
  return (id && info.teacherIds.includes(id)) || names.some(name => info.teacherNames.includes(name));
}

function buildTeacherCourses(curriculum, templatesDomain, teacher, semester, isAdmin = false) {
  const templates = new Map((templatesDomain?.templates || []).map(item => [item.id, item]));
  const field = semester === "sem2" ? "sem2TemplateId" : "sem1TemplateId";
  const courses = [];
  GRADE_KEYS.forEach(grade => {
    (curriculum?.gradeBoards?.[grade] || []).forEach(row => {
      const templateId = row?.[field];
      const template = templates.get(templateId);
      if (!template) return;
      const info = semesterInfo(template, semester);
      const isOwner = teacherMatches(info, teacher);
      courses.push({
        key: `${semester}|${grade}|${clean(row.id) || templateId}|${templateId}`,
        semester, grade, templateId,
        category: clean(row.category) || "교과",
        track: clean(row.track) || "구분 없음",
        group: clean(row.group) || "교과군 없음",
        credits: clean(row.credits),
        reportingRequirements: Object.keys(template.sem1ReportingRequirements || {}).length || Object.keys(template.sem2ReportingRequirements || {}).length
          ? template[`${semester}ReportingRequirements`] || {} : template.reportingRequirements || {},
        isOwner,
        editable: isAdmin || isOwner,
        ...info,
      });
    });
  });
  return courses;
}

const blankChecklistItem = () => ({
  confirmed: false,
  folderUrl: "",
  safetyEducation: false,
  safetySexEducation: false,
  absentStudentPolicy: false,
  reportCategory: "",
  reportRawScore: "",
  reportAverage: "",
  reportStandardDeviation: "",
  reportAchievementLevels: "",
  reportEnrollmentCount: "",
  reportRanking: "",
});

function checklistItemForCourse(course, stored) {
  const item = { ...blankChecklistItem(), ...(stored || {}) };
  for (const [key] of REPORT_FIELDS) {
    if (typeof item[key] !== "string" || !(stored && Object.hasOwn(stored, key))) {
      item[key] = normalizeReportValue(course.reportingRequirements?.[key]);
    }
  }
  return item;
}

function createValueSelect({ id, name, value, values, disabled, onChange }) {
  const select = document.createElement("select");
  select.id = id; select.name = name; select.disabled = disabled;
  const options = values.includes(value) ? values : [...values, value];
  for (const optionValue of options) {
    const option = document.createElement("option");
    option.value = optionValue;
    const existingOnly = !values.includes(optionValue);
    const label = localizedReportValue(optionValue, portalLanguage);
    option.textContent = existingOnly ? `${label} (${translate("previousReportValue")})` : label;
    option.disabled = existingOnly;
    option.selected = optionValue === value;
    select.append(option);
  }
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

function safeUrl(value) {
  try {
    const url = new URL(clean(value));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (_) { return ""; }
}

async function startChecklist(access, user, reportOptions, serial) {
  const refs = getSchoolYearRefs(ACTIVE_SCHOOL_YEAR).domains;
  // The fixed portal admin may also be listed as a teacher in this school year.
  const rosterTeacher = access.teacher.id === "teacher-portal-admin"
    ? withTimeout(getDoc(refs.teachers), 4500, "교사목록 조회 시간 초과").then(snapshot => {
      const teachers = snapshot.data()?.teachers;
      return Array.isArray(teachers)
        ? teachers.find(teacher => normalizePortalEmail(teacher?.email) === access.email)
        : null;
    }).catch(error => {
      console.warn("[teacher checklist] admin teacher lookup failed", error);
      return null;
    })
    : Promise.resolve(null);
  const [curriculumSnap, templatesSnap, savedSnap, personalSnap, listedTeacher] = await withTimeout(Promise.all([
    getDoc(refs.curriculum), getDoc(refs.templates), getDoc(teacherChecklistSharedDocRef()), getDoc(teacherChecklistDocRef(user)),
    rosterTeacher,
  ]), 12000, "Firebase 자료를 불러오는 시간이 초과되었습니다. 인터넷 연결을 확인한 뒤 새로고침해 주세요.");
  if (serial !== authSerial) return;
  const assignedTeacher = listedTeacher || access.teacher;
  const curriculum = curriculumSnap.exists() ? curriculumSnap.data() || {} : {};
  const templates = templatesSnap.exists() ? templatesSnap.data() || {} : {};
  const saved = savedSnap.exists() ? savedSnap.data() || {} : {};
  const personal = personalSnap.exists() ? personalSnap.data() || {} : {};
  const items = structuredClone(personal.items || {});
  for (const [key, fields] of Object.entries(saved.items || {})) items[key] = { ...items[key], ...fields };
  const state = {
    semester: "sem1",
    scope: "all",
    grade: "all",
    query: "",
    items,
    courses: {
      sem1: buildTeacherCourses(curriculum, templates, assignedTeacher, "sem1", access.isAdmin),
      sem2: buildTeacherCourses(curriculum, templates, assignedTeacher, "sem2", access.isAdmin),
    },
    saveTimer: null,
    pendingChanges: {},
  };
  byId("checklistTeacherName").textContent = access.teacher.name || access.email;
  showGate("checklistApp");

  let saveStatus = ["checklistReady", ""];
  const renderSaveStatus = () => {
    const [label, type] = saveStatus;
    const node = byId("checklistSaveStatus");
    node.textContent = translate(label);
    node.className = `checklist-save-status ${type}`;
  };
  const setSaveStatus = (label, type) => {
    saveStatus = [label, type];
    renderSaveStatus();
  };
  const save = (course, key, value) => {
    if (!course.editable) return;
    state.pendingChanges[course.key] = { ...state.pendingChanges[course.key], [key]: value };
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(async () => {
      if (currentPortalUser?.uid !== user.uid) return;
      const changes = state.pendingChanges;
      state.pendingChanges = {};
      setSaveStatus("checklistSaving", "saving");
      try {
        await setDoc(teacherChecklistSharedDocRef(), {
          schoolYear: ACTIVE_SCHOOL_YEAR,
          userUid: user.uid,
          email: access.email,
          teacherId: clean(access.teacher.id),
          teacherName: clean(access.teacher.name),
          updatedBy: access.email,
          items: changes,
          updatedAt: serverTimestamp(),
        }, { merge: true });
        setSaveStatus("checklistSaved", "saved");
      } catch (error) {
        for (const [courseKey, fields] of Object.entries(changes)) {
          state.pendingChanges[courseKey] = { ...fields, ...state.pendingChanges[courseKey] };
        }
        console.error("[teacher checklist save]", error);
        setSaveStatus("checklistError", "error");
      }
    }, 250);
  };

  const updateProgress = courses => {
    const completed = courses.filter(course => state.items[course.key]?.confirmed).length;
    byId("checklistProgress").textContent = `${completed} / ${courses.length}`;
    byId("checklistProgressBar").style.width = `${courses.length ? Math.round(completed / courses.length * 100) : 0}%`;
  };

  const render = () => {
    const english = portalLanguage === "en";
    byId("checklistYear").textContent = english ? `School Year ${ACTIVE_SCHOOL_YEAR}` : `${ACTIVE_SCHOOL_YEAR}학년도`;
    byId("checklistEditHelp").textContent = translate(access.isAdmin ? "checklistAdminHelp" : "checklistHelp");
    const search = byId("courseSearchInput");
    search.placeholder = translate("checklistSearch");
    search.setAttribute("aria-label", search.placeholder);
    byId("courseGradeFilter").querySelectorAll("option[value$='학년']").forEach(option => {
      option.textContent = english ? `Grade ${parseInt(option.value, 10)}` : option.value;
    });
    renderSaveStatus();
    document.querySelectorAll(".semester-tab").forEach(button => {
      const active = button.dataset.semester === state.semester;
      button.classList.toggle("active", active); button.setAttribute("aria-selected", String(active));
    });
    const container = byId("checklistCourses");
    const courses = state.courses[state.semester].filter(course => {
      if (state.scope === "mine" && !course.isOwner) return false;
      if (state.grade !== "all" && course.grade !== state.grade) return false;
      const haystack = [course.nameKo, course.nameEn, course.group, ...course.teacherNames].join(" ").toLocaleLowerCase();
      return !state.query || haystack.includes(state.query);
    });
    container.replaceChildren();
    if (!courses.length) {
      const empty = document.createElement("div"); empty.className = "portal-state-card compact";
      const title = document.createElement("h2"); title.textContent = translate("checklistEmpty"); empty.append(title);
      container.append(empty); updateProgress(courses); return;
    }
    const header = document.createElement("div");
    header.className = "checklist-compact-header";
    const headerText = (parent, title, className = "") => {
      const cell = document.createElement("span"); cell.textContent = title; cell.className = className; parent.append(cell);
    };
    headerText(header, translate("checklistCourse"));
    for (const [section, korean, englishTitle, fields] of CHECKLIST_REPORT_SECTIONS) {
      const group = document.createElement("div");
      group.className = `compact-reporting-header report-${section}`;
      headerText(group, english ? englishTitle : korean, "compact-section-title");
      for (const [, title, , englishField] of fields) headerText(group, english ? englishField : title);
      header.append(group);
    }
    for (const key of ["checklistFolder", "syllabus", "checklistConfirm"]) headerText(header, translate(key));
    container.append(header);
    courses.forEach(course => {
      const fieldIdBase = course.key.replace(/[^a-zA-Z0-9_-]/g, "_");
      const item = checklistItemForCourse(course, state.items[course.key]);
      state.items[course.key] = item;
      const card = document.createElement("article");
      card.className = "checklist-compact-row";
      card.classList.toggle("complete", !!item.confirmed);
      card.classList.toggle("readonly", !course.editable);
      card.classList.toggle("own-course", !!course.isOwner);

      const courseCell = document.createElement("div"); courseCell.className = "compact-course-cell";
      const creative = course.category === "창체";
      const amount = course.credits ? `${course.credits}${creative ? "시간" : "시수"}` : "";
      const chapel = isChapelTitle(course.nameKo, course.nameEn);
      const subtitle = [course.nameEn !== course.nameKo ? course.nameEn : "", course.group,
        course.teacherNames.join(", ") || "담당 교사 미지정", amount,
        chapel ? `시간표 편성 ${CHAPEL_PERIODS}시수` : (!amount ? "시수 미입력" : "")]
        .filter(Boolean).join(" · ");
      const accessBadge = course.isOwner ? "내 담당" : access.isAdmin ? "관리자" : "조회";
      courseCell.innerHTML = `<strong>${escapeHtml(course.nameKo)}</strong> <small>· ${escapeHtml(subtitle)}</small>
        <span class="checklist-badges"><span>${escapeHtml(course.grade)}</span><span>${escapeHtml(course.category)}</span><span>${escapeHtml(course.track)}</span><span class="compact-access-badge">${accessBadge}</span></span>`;

      const folder = document.createElement("div"); folder.className = "compact-folder-cell";
      const folderInput = document.createElement("input"); folderInput.type = "url"; folderInput.placeholder = translate("checklistFolderUrl"); folderInput.value = item.folderUrl || "";
      folderInput.setAttribute("aria-label", `${course.nameKo} ${folderInput.placeholder}`);
      folderInput.id = `folder-${fieldIdBase}`; folderInput.name = `folder_${fieldIdBase}`; folderInput.disabled = !course.editable;
      const folderLink = document.createElement("a"); folderLink.className = "compact-folder-open"; folderLink.target = "_blank"; folderLink.rel = "noopener noreferrer"; folderLink.textContent = translate("checklistOpen");
      const syncFolderLink = () => { const url = safeUrl(folderInput.value); folderLink.href = url || "#"; folderLink.classList.toggle("disabled", !url); };
      folderInput.addEventListener("change", () => { item.folderUrl = folderInput.value.trim(); syncFolderLink(); save(course, "folderUrl", item.folderUrl); });
      folderLink.addEventListener("click", event => { if (!safeUrl(folderInput.value)) event.preventDefault(); });
      syncFolderLink(); folder.append(folderInput, folderLink);

      const checks = document.createElement("div"); checks.className = "compact-required-cell";
      headerText(checks, translate("syllabus"), "compact-section-title compact-row-section");
      for (const key of ["safetyEducation", "safetySexEducation", "absentStudentPolicy"]) {
        const label = document.createElement("label"); label.className = "compact-check";
        const input = document.createElement("input"); input.type = "checkbox"; input.checked = !!item[key]; input.id = `${key}-${fieldIdBase}`; input.name = `${key}_${fieldIdBase}`; input.disabled = !course.editable;
        input.addEventListener("change", () => { item[key] = input.checked; save(course, key, item[key]); });
        label.append(input, document.createTextNode(translate(key))); checks.append(label);
      }

      const reporting = CHECKLIST_REPORT_SECTIONS.map(([section, korean, englishTitle, fields]) => {
        const group = document.createElement("div"); group.className = `compact-reporting-cell report-${section}`;
        headerText(group, english ? englishTitle : korean, "compact-section-title compact-row-section");
        for (const [key, koreanField, , englishField] of fields) {
          const title = english ? englishField : koreanField;
          const values = ["", ...reportOptions[key]];
          const label = document.createElement("label"); const caption = document.createElement("span"); caption.textContent = title;
          const select = createValueSelect({ id:`${key}-${fieldIdBase}`, name:`${key}_${fieldIdBase}`, value:normalizeReportValue(item[key]), values, disabled:!course.editable, onChange:value=>{ item[key]=value; save(course, key, value); } });
          select.setAttribute("aria-label", `${course.nameKo} ${english ? englishTitle : korean} ${title}`);
          label.append(caption, select); group.append(label);
        }
        return group;
      });

      const confirm = document.createElement("label"); confirm.className = "compact-confirm-cell";
      const confirmInput = document.createElement("input"); confirmInput.type = "checkbox"; confirmInput.checked = !!item.confirmed; confirmInput.id = `confirmed-${fieldIdBase}`; confirmInput.name = `confirmed_${fieldIdBase}`; confirmInput.disabled = !course.editable;
      confirmInput.addEventListener("change", () => { item.confirmed = confirmInput.checked; card.classList.toggle("complete", item.confirmed); updateProgress(courses); save(course, "confirmed", item.confirmed); });
      const confirmLabel = document.createElement("span"); confirmLabel.textContent = translate("checklistConfirm");
      confirmInput.setAttribute("aria-label", `${course.nameKo} ${confirmLabel.textContent}`);
      confirm.append(confirmInput, confirmLabel);
      card.append(courseCell, ...reporting, folder, checks, confirm); container.append(card);
    });
    updateProgress(courses);
  };

  document.querySelectorAll(".semester-tab").forEach(button => button.addEventListener("click", () => {
    state.semester = button.dataset.semester; render();
  }));
  byId("courseScopeFilter")?.addEventListener("change", event => { state.scope = event.target.value; render(); });
  byId("courseGradeFilter")?.addEventListener("change", event => { state.grade = event.target.value; render(); });
  byId("courseSearchInput")?.addEventListener("input", event => { state.query = clean(event.target.value).toLocaleLowerCase(); render(); });
  redrawPortalPage = render;
  render();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[char]));
}

async function showPublishedYearOptions(currentPublication, serial) {
  const years = await readRegisteredPortalYears().catch(() => getKnownSchoolYears());
  const statuses = await Promise.all(years.map(year => year === ACTIVE_SCHOOL_YEAR ? currentPublication :
    readCurriculumPublication(year).catch(() => ({ published: false }))));
  if (serial !== authSerial) return;
  const select = byId("portalYearSelect");
  const publishedYears = years.filter((_, index) => statuses[index].published);
  const options = publishedYears.map(year => new Option(year, year, false, year === ACTIVE_SCHOOL_YEAR));
  if (!publishedYears.includes(ACTIVE_SCHOOL_YEAR)) {
    const placeholder = new Option("", "", true, true);
    placeholder.disabled = true;
    options.unshift(placeholder);
  }
  select.replaceChildren(...options);
  select.disabled = !publishedYears.length;
  applyLanguage();
}

async function startFacultyCurriculum(access, serial) {
  const publication = await readCurriculumPublication(ACTIVE_SCHOOL_YEAR);
  if (serial !== authSerial) return;
  void showPublishedYearOptions(publication, serial);
  if (!publication.published) {
    showGate("portalDenied", `${ACTIVE_SCHOOL_YEAR}학년도는 비공개입니다. 상단에서 공개된 학년도를 선택해 주세요.`);
    return;
  }
  // Only administrators read the roster source. A teacher sees the aggregate
  // fields published for this year, without downloading roster documents.
  const liveWorkloadRequest = teachersView && access.isAdmin
    ? readFacultyWorkloadFromRosters(ACTIVE_SCHOOL_YEAR).catch(error => {
      console.warn("[faculty workload] live read failed", error);
      return null;
    }) : Promise.resolve(null);
  const [source, liveWorkload] = await Promise.all([readTeacherYearSources(ACTIVE_SCHOOL_YEAR), liveWorkloadRequest]);
  if (serial !== authSerial) return;
  const workloadRows = liveWorkload ?? publication.workload;
  const workload = new Map((workloadRows || []).map(item => [item.id, item]));
  const rows = buildReadOnlyCurriculumRows(source.curriculum, source.templates, source.teachers,
    (id, credits) => facultyCourseWorkload(workload.get(id), credits));
  const self = source.teachers.find(teacher => normalizePortalEmail(teacher.email) === access.email) || access.teacher;
  const gradeSummaries = teachersView ? null : summarizeCurriculumGrades(rows, source.templateGroups);
  const titleKey = teachersView ? "facultyAssignments" : "facultyCurriculum";
  const activeLink = byId("facultyCurriculumApp").querySelector(`[data-i18n="${titleKey}"].portal-btn`);
  activeLink?.setAttribute("aria-current", "page");
  activeLink?.classList.add("primary");
  const controls = byId("facultyViewFilters");
  const content = byId("facultyViewContent");
  const filter = document.createElement("select");
  const search = document.createElement("input");
  search.type = "search";
  search.id = "facultyCourseSearch";
  const ownLabel = document.createElement("label");
  const own = document.createElement("input");
  own.type = "checkbox";
  const ownText = document.createElement("span");
  ownLabel.append(own, ownText);
  const workloadNote = document.createElement("small");
  const syncNote = document.createElement("small");
  syncNote.setAttribute("role", "status");
  controls.replaceChildren(...(teachersView ? [search, ownLabel, workloadNote, syncNote] : [filter, search]));
  const show = () => {
    const query = clean(search.value).toLowerCase();
    const hasMatch = values => !query || values.some(value => clean(value).toLowerCase().includes(query));
    let visible, table;
    if (teachersView) {
      visible = groupTeacherAssignments(rows, null, self).filter(group =>
        (!own.checked || group.own) && (hasMatch([group.name]) || group.rows.some(row => hasMatch([
          row.sem1?.name, row.sem1?.english, row.sem2?.name, row.sem2?.english, row.grade,
        ]))));
      table = () => renderTeacherAssignmentTable(visible, { language: portalLanguage, workload: true });
    } else {
      const grades = filter.value === "high" ? ["10학년", "11학년", "12학년"] : ["7학년", "8학년", "9학년"];
      visible = rows.filter(row => grades.includes(row.grade) && hasMatch([
        row.category, row.track, row.group, ...[row.sem1, row.sem2].flatMap(subject =>
          subject ? [subject.name, subject.english, ...subject.teachers.map(teacher => teacher.name)] : []),
      ]));
      table = () => renderAnnualCurriculumTable(visible, portalLanguage, grades, gradeSummaries);
    }
    if (visible.length) content.replaceChildren(table());
    else {
      const empty = document.createElement("p");
      empty.className = "faculty-view-empty";
      empty.textContent = portalLanguage === "ko" ? "표시할 과목이 없습니다." : "No courses to show.";
      content.replaceChildren(empty);
    }
  };
  redrawPortalPage = () => {
    const en = portalLanguage === "en";
    byId("facultyViewTitle").textContent = translations[portalLanguage][titleKey];
    byId("facultyViewYear").textContent = en ? `School Year ${ACTIVE_SCHOOL_YEAR}` : `${ACTIVE_SCHOOL_YEAR}학년도`;
    const value = filter.value;
    const options = [["middle", en ? "Middle School · Grades 7–9" : "중등 · 7~9학년"], ["high", en ? "High School · Grades 10–12" : "고등 · 10~12학년"]];
    filter.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
    filter.value = value || (!rows.some(row => parseInt(row.grade, 10) <= 9) ? "high" : "middle");
    filter.setAttribute("aria-label", en ? "School level" : "학교급");
    search.placeholder = en ? "Search courses or teachers" : "과목·교사 검색";
    search.setAttribute("aria-label", search.placeholder);
    ownText.textContent = en ? "My courses only" : "내 담당만";
    workloadNote.textContent = workloadRows?.length
      ? (en ? "Different values appear as S1 / S2. Teacher totals use saved workload overrides." : "학기별 값은 1학기 / 2학기 순입니다. 교사 합계에는 별도 교사시수 설정을 우선 반영합니다.")
      : workloadRows
        ? (en ? "No class counts or teacher hours have been set for this year." : "이 학년도에 설정된 학급 수와 교사시수가 없습니다.")
        : (en ? "Class counts and hours will appear after an administrator opens this report." : "관리자가 이 학년도의 담당 현황을 열면 학급 수와 시수가 자동으로 반영됩니다.");
    show();
  };
  search.addEventListener("input", show);
  filter.addEventListener("change", show);
  own.addEventListener("change", show);
  redrawPortalPage();
  showGate("facultyCurriculumApp");
  if (liveWorkload) {
    void publishFacultyWorkload(ACTIVE_SCHOOL_YEAR, liveWorkload).catch(error => {
      if (serial !== authSerial) return;
      console.warn("[faculty workload] publication refresh failed", error);
      syncNote.textContent = portalLanguage === "ko"
        ? "관리자 화면에는 최신 시수가 표시됩니다. 교사용 공개 자료 갱신은 실패했습니다."
        : "The administrator view is current. Updating the shared figures failed.";
    });
  } else if (teachersView && access.isAdmin) {
    syncNote.textContent = portalLanguage === "ko" ? "최신 과목 설정을 읽지 못했습니다." : "The latest workload settings could not be read.";
  }
}

async function handleAuth(user) {
  const serial = ++authSerial;
  redrawPortalPage = null;
  if (page === "curriculum-view") {
    byId("portalYearSelect").disabled = true;
    byId("facultyViewFilters").replaceChildren();
    byId("facultyViewContent").replaceChildren();
  }
  renderAuthChrome(user);
  if (!user) { showGate("portalSignedOut"); return; }
  showGate("portalLoading");
  try {
    const access = await readTeacherPortalAccess(user);
    if (serial !== authSerial) return;
    if (!access.allowed) {
      showGate("portalDenied", access.reason);
      if (page === "curriculum-view" && normalizePortalEmail(user.email).endsWith("@his.sc.kr")) {
        void showPublishedYearOptions({ published: false }, serial);
      }
      return;
    }
    const curriculumAllowed = ["curriculum", "admin"].includes(access.role);
    setVisible("portalCurriculumShortcut", curriculumAllowed);
    setVisible("portalTeacherManageShortcut", access.isAdmin);
    if (page === "curriculum-view") {
      await startFacultyCurriculum(access, serial);
    } else if (page === "curriculum-checklist") {
      const publication = await readCurriculumPublication(ACTIVE_SCHOOL_YEAR).catch(error => {
        if (!access.isAdmin) throw error;
        console.warn("[teacher checklist] report options fallback", error);
        return { reportOptions: normalizeChecklistReportOptions() };
      });
      if (serial !== authSerial) return;
      if (!access.isAdmin && !publication.published) {
        showGate("portalDenied", `${ACTIVE_SCHOOL_YEAR}학년도 커리큘럼은 교사용 포털에 비공개 상태입니다.`);
        return;
      }
      await startChecklist(access, user, publication.reportOptions, serial);
    } else renderMenu(access);
  } catch (error) {
    if (serial !== authSerial) return;
    console.error("[teacher portal]", error);
    showGate("portalDenied", `자료를 불러오지 못했습니다: ${error?.message || error}`);
  }
}

setupYearSelector();
if (teachersView) byId("facultyHeaderTitle").dataset.i18n = "facultyAssignments";
setupLanguage();
setupAuthButtons();
onAuth(handleAuth);
