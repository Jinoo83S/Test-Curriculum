import { login, logout, onAuth } from "./auth.js?v=r419";
import { ACTIVE_SCHOOL_YEAR, GRADE_KEYS, getSchoolYearRefs } from "./config.js?v=2026-07-15-room-availability-separation-r355";
import { getKnownSchoolYears, setActiveSchoolYear } from "./school-year.js?v=2026-07-15-room-availability-separation-r355";
import { getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { readTeacherPortalAccess, teacherChecklistDocRef, teacherChecklistSharedDocRef } from "./teacher-portal-auth.js?v=r421";

const page = document.body.dataset.portalPage || "menu";
const byId = id => document.getElementById(id);
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
  const overrideIds = Array.isArray(template?.[`${prefix}TeacherIds`]) ? template[`${prefix}TeacherIds`] : [];
  const overrideNames = Array.isArray(template?.[`${prefix}TeacherNames`]) ? template[`${prefix}TeacherNames`] : [];
  const baseIds = Array.isArray(template?.teacherIds) ? template.teacherIds : [];
  const baseNames = Array.isArray(template?.teacherNames) ? template.teacherNames : [];
  const teacherText = clean(template?.[`${prefix}Teacher`]) || clean(template?.teacher);
  return {
    nameKo: clean(template?.[`${prefix}NameKo`]) || clean(template?.nameKo) || clean(template?.nameEn) || "이름 없는 과목",
    nameEn: clean(template?.[`${prefix}NameEn`]) || clean(template?.nameEn),
    teacherIds: overrideIds.length ? overrideIds.map(clean) : baseIds.map(clean),
    teacherNames: unique([...(overrideNames.length ? overrideNames : baseNames).map(clean), ...splitTeacherNames(teacherText)]),
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
        reportingRequirements: template[`${semester}ReportingRequirements`] || template.reportingRequirements || {},
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
  reportRawScore: false,
  reportAverage: false,
  reportStandardDeviation: false,
  reportAchievementLevels: false,
  reportEnrollmentCount: false,
  reportRanking: false,
});

function safeUrl(value) {
  try {
    const url = new URL(clean(value));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (_) { return ""; }
}

async function startChecklist(access, user) {
  const refs = getSchoolYearRefs(ACTIVE_SCHOOL_YEAR).domains;
  const [curriculumSnap, templatesSnap, savedSnap, personalSnap] = await Promise.all([
    getDoc(refs.curriculum), getDoc(refs.templates), getDoc(teacherChecklistSharedDocRef()), getDoc(teacherChecklistDocRef(user)),
  ]);
  const curriculum = curriculumSnap.exists() ? curriculumSnap.data() || {} : {};
  const templates = templatesSnap.exists() ? templatesSnap.data() || {} : {};
  const saved = savedSnap.exists() ? savedSnap.data() || {} : {};
  const personal = personalSnap.exists() ? personalSnap.data() || {} : {};
  const state = {
    semester: "sem1",
    scope: "all",
    query: "",
    items: { ...(personal.items && typeof personal.items === "object" ? structuredClone(personal.items) : {}), ...(saved.items && typeof saved.items === "object" ? structuredClone(saved.items) : {}) },
    courses: {
      sem1: buildTeacherCourses(curriculum, templates, access.teacher, "sem1", access.isAdmin),
      sem2: buildTeacherCourses(curriculum, templates, access.teacher, "sem2", access.isAdmin),
    },
    saveTimer: null,
  };
  byId("checklistYear").textContent = `${ACTIVE_SCHOOL_YEAR}학년도`;
  byId("checklistTeacherName").textContent = access.teacher.name || access.email;
  showGate("checklistApp");

  const save = () => {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(async () => {
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
          items: state.items,
          updatedAt: serverTimestamp(),
        }, { merge: true });
        status.textContent = "저장됨"; status.className = "checklist-save-status saved";
      } catch (error) {
        console.error("[teacher checklist save]", error);
        status.textContent = "저장 실패"; status.className = "checklist-save-status error";
      }
    }, 250);
  };

  const updateProgress = () => {
    const all = [...state.courses.sem1, ...state.courses.sem2];
    const completed = all.filter(course => state.items[course.key]?.confirmed).length;
    byId("checklistProgress").textContent = `${completed} / ${all.length}`;
    byId("checklistProgressBar").style.width = `${all.length ? Math.round(completed / all.length * 100) : 0}%`;
  };

  const render = () => {
    document.querySelectorAll(".semester-tab").forEach(button => {
      const active = button.dataset.semester === state.semester;
      button.classList.toggle("active", active); button.setAttribute("aria-selected", String(active));
    });
    const container = byId("checklistCourses");
    const courses = state.courses[state.semester].filter(course => {
      if (state.scope === "mine" && !course.isOwner) return false;
      const haystack = [course.nameKo, course.nameEn, course.group, ...course.teacherNames].join(" ").toLocaleLowerCase();
      return !state.query || haystack.includes(state.query);
    });
    container.replaceChildren();
    if (!courses.length) {
      const empty = document.createElement("div"); empty.className = "portal-state-card compact";
      empty.innerHTML = `<div class="portal-state-icon">📭</div><h2>이 학기에 연결된 담당 과목이 없습니다</h2><p>과목카드의 담당 교사와 교사목록 연결을 관리자에게 확인해 주세요.</p>`;
      container.append(empty); updateProgress(); return;
    }
    courses.forEach(course => {
      const item = { ...blankChecklistItem(), ...(state.items[course.key] || {}) };
      state.items[course.key] = item;
      const card = document.createElement("article"); card.className = "checklist-course-card" + (item.confirmed ? " complete" : "");
      const head = document.createElement("div"); head.className = "checklist-course-head";
      head.innerHTML = `<div class="checklist-course-title"><div class="checklist-badges"><span>${course.grade}</span><span>${course.category}</span><span>${course.track}</span><span>${course.editable ? (access.isAdmin ? "관리자 편집" : "내 담당") : "조회 전용"}</span></div><h2>${escapeHtml(course.nameKo)}</h2><p>${escapeHtml(course.nameEn || "")}</p></div><div class="checklist-course-meta"><strong>${escapeHtml(course.group)}</strong><span>${escapeHtml(course.teacherNames.join(", ") || "담당 교사 미지정")}</span><span>${course.credits ? `${escapeHtml(course.credits)}시수` : "시수 미입력"}</span></div>`;
      const body = document.createElement("div"); body.className = "checklist-course-body";
      const folder = document.createElement("div"); folder.className = "checklist-folder-row";
      const folderLabel = document.createElement("label"); folderLabel.textContent = "Google Folder";
      const folderInput = document.createElement("input"); folderInput.type = "url"; folderInput.placeholder = "https://drive.google.com/..."; folderInput.value = item.folderUrl || "";
      folderInput.disabled = !course.editable;
      const folderLink = document.createElement("a"); folderLink.className = "portal-btn folder-open"; folderLink.target = "_blank"; folderLink.rel = "noopener noreferrer"; folderLink.textContent = "폴더 열기";
      const syncFolderLink = () => { const url = safeUrl(folderInput.value); folderLink.href = url || "#"; folderLink.classList.toggle("disabled", !url); };
      folderInput.addEventListener("change", () => { if (!course.editable) return; item.folderUrl = folderInput.value.trim(); syncFolderLink(); save(); });
      folderLink.addEventListener("click", event => { if (!safeUrl(folderInput.value)) event.preventDefault(); });
      syncFolderLink(); folder.append(folderLabel, folderInput, folderLink);
      const checks = document.createElement("div"); checks.className = "checklist-checkbox-grid";
      [
        ["safetyEducation", "Safety Education", "안전교육 반영"],
        ["safetySexEducation", "Safety (Sex) Education", "성교육 반영"],
        ["absentStudentPolicy", "Policy for Absent Students", "결석 학생 정책 반영"],
      ].forEach(([key, title, description]) => {
        const label = document.createElement("label"); label.className = "checklist-check";
        const input = document.createElement("input"); input.type = "checkbox"; input.checked = !!item[key];
        input.disabled = !course.editable;
        input.addEventListener("change", () => { item[key] = input.checked; save(); });
        const copy = document.createElement("span"); copy.innerHTML = `<strong>${title}</strong><small>${description}</small>`;
        label.append(input, copy); checks.append(label);
      });
      const reporting = document.createElement("div"); reporting.className = "checklist-reporting";
      const reportingTitle = document.createElement("h3");
      const reportCategory = clean(course.reportingRequirements?.reportCategory);
      reportingTitle.textContent = `성적표 표시 항목 / Report Card Fields${reportCategory ? ` · ${reportCategory}` : ""}`; reporting.append(reportingTitle);
      const reportingGrid = document.createElement("div"); reportingGrid.className = "checklist-checkbox-grid";
      [
        ["reportRawScore", "원점수 / Raw Score"], ["reportAverage", "과목평균 / Average"],
        ["reportStandardDeviation", "표준편차 / Standard Deviation"], ["reportAchievementLevels", "성취도 / Achievement Levels"],
        ["reportEnrollmentCount", "수강자수 / Enrollment"], ["reportRanking", "석차등급 / Ranking"],
      ].forEach(([key, title]) => {
        const label=document.createElement("label");label.className="checklist-check";const input=document.createElement("input");input.type="checkbox";input.checked=!!item[key];input.disabled=!course.editable;input.addEventListener("change",()=>{item[key]=input.checked;save();});
        const source=clean(course.reportingRequirements?.[key]);const copy=document.createElement("span");copy.innerHTML=`<strong>${title}</strong><small>${source ? `붙여넣기 값: ${escapeHtml(source)}` : "확인 후 체크"}</small>`;label.append(input,copy);reportingGrid.append(label);
      });
      reporting.append(reportingGrid);
      const confirm = document.createElement("label"); confirm.className = "checklist-confirm";
      const confirmInput = document.createElement("input"); confirmInput.type = "checkbox"; confirmInput.checked = !!item.confirmed;
      confirmInput.disabled = !course.editable;
      const confirmCopy = document.createElement("span"); confirmCopy.innerHTML = "<strong>최종 확인</strong><small>이 과목의 내용을 모두 확인했습니다.</small>";
      confirmInput.addEventListener("change", () => { item.confirmed = confirmInput.checked; card.classList.toggle("complete", item.confirmed); updateProgress(); save(); });
      confirm.append(confirmInput, confirmCopy);
      body.append(folder, checks, reporting, confirm); card.append(head, body); container.append(card);
    });
    updateProgress();
  };

  document.querySelectorAll(".semester-tab").forEach(button => button.addEventListener("click", () => {
    state.semester = button.dataset.semester; render();
  }));
  byId("courseScopeFilter")?.addEventListener("change", event => { state.scope = event.target.value; render(); });
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
