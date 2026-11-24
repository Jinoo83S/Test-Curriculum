import { login, logout, onAuth } from "./auth.js?v=r424";
import { ACTIVE_SCHOOL_YEAR, GRADE_KEYS, getSchoolYearRefs } from "./config.js?v=2026-07-15-room-availability-separation-r355";
import { getKnownSchoolYears, setActiveSchoolYear } from "./school-year.js?v=2026-07-15-room-availability-separation-r355";
import { getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { normalizePortalEmail, readTeacherPortalAccess, teacherChecklistDocRef, teacherChecklistSharedDocRef } from "./teacher-portal-auth.js?v=r424";

const page = document.body.dataset.portalPage || "menu";
const byId = id => document.getElementById(id);
const withTimeout = (promise, milliseconds, message) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(message)), milliseconds)),
]);
const clean = value => String(value ?? "").trim();
const unique = values => [...new Set(values.filter(Boolean))];
let authSerial = 0;
let currentPortalUser = null;
const LANGUAGE_KEY = "his_portal_language_v1";
const translations = {
  ko: { curriculumShortcut:"커리큘럼 편집", teacherManagement:"교사관리", schoolYear:"학년도", schoolYearShort:"학년도", googleLogin:"Google 로그인", logout:"로그아웃", checkingAccess:"접근 권한을 확인하고 있습니다", checkingAccessDescription:"교사목록의 학교 이메일과 로그인 계정을 대조합니다.", signInTitle:"학교 Google 계정으로 로그인해 주세요", signInDescription:"교사목록에 등록된 @his.sc.kr 계정만 이용할 수 있습니다.", accessDenied:"교사용 메뉴 접근 권한이 없습니다", portalTitle:"교직원 업무 메뉴", portalDescription:"본인 계정으로 로그인하면 담당 과목과 필요한 확인 업무만 표시됩니다.", welcome:"환영합니다", facultyArea:"교사 업무", facultyAreaDescription:"일반 교사가 사용하는 확인·제출 페이지입니다.", courseChecklist:"담당 과목 확인", courseChecklistDescription:"학기별 담당 과목, Google 폴더, 교과계획서 필수 항목을 확인합니다.", openTask:"업무 열기", moreTasks:"추가 교직원 업무", moreTasksDescription:"새로운 확인 페이지가 이 메뉴에 순차적으로 추가됩니다.", operationsArea:"커리큘럼·시간표 관리", operationsAreaDescription:"권한이 있는 교직원만 접근하는 편집 영역입니다.", curriculumEditor:"커리큘럼 편집", curriculumEditorDescription:"연간·3개년 커리큘럼과 과목카드를 편집합니다.", timetable:"시간표", timetableDescription:"시간표 사전작업, 자동배치와 결과를 관리합니다.", openEditor:"편집 열기", teacherManagementDescription:"교사를 등록·편집·삭제하고 접근 권한을 설정합니다.", manage:"관리하기" },
  en: { curriculumShortcut:"Edit Curriculum", teacherManagement:"Teacher Management", schoolYear:"School Year", schoolYearShort:"School Year", googleLogin:"Sign in with Google", logout:"Sign out", checkingAccess:"Checking your access", checkingAccessDescription:"Matching your school email with the teacher list.", signInTitle:"Sign in with your school Google account", signInDescription:"Only @his.sc.kr accounts registered in the teacher list can use this portal.", accessDenied:"You do not have access to the faculty portal", portalTitle:"Faculty Work Portal", portalDescription:"Sign in to see only your assigned courses and required tasks.", welcome:"Welcome", facultyArea:"Faculty Tasks", facultyAreaDescription:"Check and submission pages used by all teachers.", courseChecklist:"Assigned Course Checklist", courseChecklistDescription:"Review assigned courses, Google folders, and required curriculum items by semester.", openTask:"Open task", moreTasks:"More Faculty Tasks", moreTasksDescription:"New faculty pages will be added here as they become available.", operationsArea:"Curriculum & Timetable", operationsAreaDescription:"Editing area for staff with curriculum or administrator access.", curriculumEditor:"Curriculum Editor", curriculumEditorDescription:"Edit annual and three-year curricula and course cards.", timetable:"Timetable", timetableDescription:"Manage preparation, automatic scheduling, and results.", openEditor:"Open editor", teacherManagementDescription:"Add, edit, delete teachers and assign access levels.", manage:"Manage" }
};
let portalLanguage = localStorage.getItem(LANGUAGE_KEY) === "en" ? "en" : "ko";

function applyLanguage() {
  document.documentElement.lang = portalLanguage;
  document.querySelectorAll("[data-i18n]").forEach(node => {
    const text = translations[portalLanguage]?.[node.dataset.i18n];
    if (text) node.textContent = text;
  });
  document.querySelectorAll("#portalYearSelect option").forEach(option => { option.textContent = portalLanguage === "ko" ? `${option.value}학년도` : `School Year ${option.value}`; });
  const button = byId("portalLanguageBtn");
  if (button) button.textContent = portalLanguage === "ko" ? "English" : "한국어";
  const status = byId("portalAuthStatus");
  if (status && !currentPortalUser) status.textContent = portalLanguage === "ko" ? "로그인 필요" : "Sign-in required";
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
  select.addEventListener("change", () => setActiveSchoolYear(select.value));
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
  ["portalLoading", "portalSignedOut", "portalDenied", "portalDashboard", "checklistApp"].forEach(id => setVisible(id, id === name));
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

const reportFields = [
  ["reportCategory", "구분", ["", "체육•예술", "진로선택"]],
  ["reportRawScore", "원점수", ["", "O", "X"]],
  ["reportAverage", "평균", ["", "O", "X"]],
  ["reportStandardDeviation", "표준편차", ["", "O", "X", "성취도별 분포비율"]],
  ["reportAchievementLevels", "성취도", ["", "5 Levels", "3 Levels", "P/F", "P"]],
  ["reportEnrollmentCount", "수강자수", ["", "O", "X"]],
  ["reportRanking", "석차", ["", "O", "X"]],
];
const normalizeReportValue = value => clean(value).replace(/\s+/g, " ");

function checklistItemForCourse(course, stored) {
  const item = { ...blankChecklistItem(), ...(stored || {}) };
  for (const [key] of reportFields) {
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
    option.textContent = optionValue || "미설정";
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

async function startChecklist(access, user) {
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
  byId("checklistYear").textContent = `${ACTIVE_SCHOOL_YEAR}학년도`;
  byId("checklistTeacherName").textContent = access.teacher.name || access.email;
  showGate("checklistApp");

  const save = (course, key, value) => {
    if (!course.editable) return;
    state.pendingChanges[course.key] = { ...state.pendingChanges[course.key], [key]: value };
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(async () => {
      if (currentPortalUser?.uid !== user.uid) return;
      const changes = state.pendingChanges;
      state.pendingChanges = {};
      const status = byId("checklistSaveStatus");
      status.textContent = "저장 중…"; status.className = "checklist-save-status saving";
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
        status.textContent = "저장됨"; status.className = "checklist-save-status saved";
      } catch (error) {
        for (const [courseKey, fields] of Object.entries(changes)) {
          state.pendingChanges[courseKey] = { ...fields, ...state.pendingChanges[courseKey] };
        }
        console.error("[teacher checklist save]", error);
        status.textContent = "저장 실패"; status.className = "checklist-save-status error";
      }
    }, 250);
  };

  const updateProgress = courses => {
    const completed = courses.filter(course => state.items[course.key]?.confirmed).length;
    byId("checklistProgress").textContent = `${completed} / ${courses.length}`;
    byId("checklistProgressBar").style.width = `${courses.length ? Math.round(completed / courses.length * 100) : 0}%`;
  };

  const render = () => {
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
      empty.innerHTML = `<h2>현재 조건에 맞는 과목이 없습니다</h2>`;
      container.append(empty); updateProgress(courses); return;
    }
    const header = document.createElement("div");
    header.className = "checklist-compact-header";
    for (const title of ["과목", "Google 폴더", "필수 확인"]) {
      const cell = document.createElement("span"); cell.textContent = title; header.append(cell);
    }
    const reportHeader = document.createElement("div");
    reportHeader.className = "compact-reporting-header";
    for (const [, title] of reportFields) {
      const cell = document.createElement("span"); cell.textContent = title; reportHeader.append(cell);
    }
    const confirmedHeader = document.createElement("span"); confirmedHeader.textContent = "완료";
    header.append(reportHeader, confirmedHeader);
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
      const subtitle = [course.group, course.teacherNames.join(", ") || "담당 교사 미지정", course.credits ? `${course.credits}시수` : "시수 미입력"].join(" · ");
      const accessBadge = course.isOwner ? "내 담당" : access.isAdmin ? "관리자" : "조회";
      courseCell.innerHTML = `<div class="compact-course-title"><strong>${escapeHtml(course.nameKo)}</strong><div class="checklist-badges"><span>${escapeHtml(course.grade)}</span><span>${escapeHtml(course.category)}</span><span>${escapeHtml(course.track)}</span><span class="compact-access-badge">${accessBadge}</span></div></div><small title="${escapeHtml(course.nameEn)}">${escapeHtml(course.nameEn)}</small><em title="${escapeHtml(subtitle)}">${escapeHtml(subtitle)}</em>`;

      const folder = document.createElement("div"); folder.className = "compact-folder-cell";
      const folderInput = document.createElement("input"); folderInput.type = "url"; folderInput.placeholder = "Drive 폴더 URL"; folderInput.value = item.folderUrl || "";
      folderInput.setAttribute("aria-label", `${course.nameKo} Google 폴더 URL`);
      folderInput.id = `folder-${fieldIdBase}`; folderInput.name = `folder_${fieldIdBase}`; folderInput.disabled = !course.editable;
      const folderLink = document.createElement("a"); folderLink.className = "compact-folder-open"; folderLink.target = "_blank"; folderLink.rel = "noopener noreferrer"; folderLink.textContent = "열기";
      const syncFolderLink = () => { const url = safeUrl(folderInput.value); folderLink.href = url || "#"; folderLink.classList.toggle("disabled", !url); };
      folderInput.addEventListener("change", () => { item.folderUrl = folderInput.value.trim(); syncFolderLink(); save(course, "folderUrl", item.folderUrl); });
      folderLink.addEventListener("click", event => { if (!safeUrl(folderInput.value)) event.preventDefault(); });
      syncFolderLink(); folder.append(folderInput, folderLink);

      const checks = document.createElement("div"); checks.className = "compact-required-cell";
      [["safetyEducation", "안전교육"], ["safetySexEducation", "성교육"], ["absentStudentPolicy", "결석정책"]].forEach(([key, title]) => {
        const label = document.createElement("label"); label.className = "compact-check";
        const input = document.createElement("input"); input.type = "checkbox"; input.checked = !!item[key]; input.id = `${key}-${fieldIdBase}`; input.name = `${key}_${fieldIdBase}`; input.disabled = !course.editable;
        input.addEventListener("change", () => { item[key] = input.checked; save(course, key, item[key]); });
        label.append(input, document.createTextNode(title)); checks.append(label);
      });

      const reporting = document.createElement("div"); reporting.className = "compact-reporting-cell";
      reportFields.forEach(([key, title, values]) => {
        const label = document.createElement("label"); const caption = document.createElement("span"); caption.textContent = title;
        const select = createValueSelect({ id:`${key}-${fieldIdBase}`, name:`${key}_${fieldIdBase}`, value:normalizeReportValue(item[key]), values, disabled:!course.editable, onChange:value=>{ item[key]=value; save(course, key, value); } });
        select.setAttribute("aria-label", `${course.nameKo} ${title}`);
        label.append(caption, select); reporting.append(label);
      });

      const confirm = document.createElement("label"); confirm.className = "compact-confirm-cell";
      const confirmInput = document.createElement("input"); confirmInput.type = "checkbox"; confirmInput.checked = !!item.confirmed; confirmInput.id = `confirmed-${fieldIdBase}`; confirmInput.name = `confirmed_${fieldIdBase}`; confirmInput.disabled = !course.editable;
      confirmInput.addEventListener("change", () => { item.confirmed = confirmInput.checked; card.classList.toggle("complete", item.confirmed); updateProgress(courses); save(course, "confirmed", item.confirmed); });
      const confirmLabel = document.createElement("span"); confirmLabel.textContent = "완료";
      confirmInput.setAttribute("aria-label", `${course.nameKo} 최종 확인`);
      confirm.append(confirmInput, confirmLabel);
      card.append(courseCell, folder, checks, reporting, confirm); container.append(card);
    });
    updateProgress(courses);
  };

  document.querySelectorAll(".semester-tab").forEach(button => button.addEventListener("click", () => {
    state.semester = button.dataset.semester; render();
  }));
  byId("courseScopeFilter")?.addEventListener("change", event => { state.scope = event.target.value; render(); });
  byId("courseGradeFilter")?.addEventListener("change", event => { state.grade = event.target.value; render(); });
  byId("courseSearchInput")?.addEventListener("input", event => { state.query = clean(event.target.value).toLocaleLowerCase(); render(); });
  render();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[char]));
}

async function handleAuth(user) {
  const serial = ++authSerial;
  renderAuthChrome(user);
  if (!user) { showGate("portalSignedOut"); return; }
  showGate("portalLoading");
  try {
    const access = await readTeacherPortalAccess(user);
    if (serial !== authSerial) return;
    if (!access.allowed) { showGate("portalDenied", access.reason); return; }
    const curriculumAllowed = ["curriculum", "admin"].includes(access.role);
    setVisible("portalCurriculumShortcut", curriculumAllowed);
    setVisible("portalTeacherManageShortcut", access.isAdmin);
    if (page === "curriculum-checklist") await startChecklist(access, user);
    else renderMenu(access);
  } catch (error) {
    console.error("[teacher portal]", error);
    showGate("portalDenied", `자료를 불러오지 못했습니다: ${error?.message || error}`);
  }
}

setupYearSelector();
setupLanguage();
setupAuthButtons();
onAuth(handleAuth);
