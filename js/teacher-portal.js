import { login, logout, onAuth } from "./auth.js?v=2026-07-15-room-availability-separation-r355";
import { ACTIVE_SCHOOL_YEAR, GRADE_KEYS, getSchoolYearRefs } from "./config.js?v=2026-07-15-room-availability-separation-r355";
import { getKnownSchoolYears, setActiveSchoolYear } from "./school-year.js?v=2026-07-15-room-availability-separation-r355";
import { getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { readTeacherPortalAccess, teacherChecklistDocRef } from "./teacher-portal-auth.js?v=r417";

const page = document.body.dataset.portalPage || "menu";
const byId = id => document.getElementById(id);
const clean = value => String(value ?? "").trim();
const unique = values => [...new Set(values.filter(Boolean))];
let authSerial = 0;

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
  const status = byId("portalAuthStatus");
  if (status) status.textContent = user?.email || "로그인 필요";
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

function buildTeacherCourses(curriculum, templatesDomain, teacher, semester) {
  const templates = new Map((templatesDomain?.templates || []).map(item => [item.id, item]));
  const field = semester === "sem2" ? "sem2TemplateId" : "sem1TemplateId";
  const courses = [];
  GRADE_KEYS.forEach(grade => {
    (curriculum?.gradeBoards?.[grade] || []).forEach(row => {
      const templateId = row?.[field];
      const template = templates.get(templateId);
      if (!template) return;
      const info = semesterInfo(template, semester);
      if (!teacherMatches(info, teacher)) return;
      courses.push({
        key: `${semester}|${grade}|${clean(row.id) || templateId}|${templateId}`,
        semester, grade, templateId,
        category: clean(row.category) || "교과",
        track: clean(row.track) || "구분 없음",
        group: clean(row.group) || "교과군 없음",
        credits: clean(row.credits),
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
});

function safeUrl(value) {
  try {
    const url = new URL(clean(value));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (_) { return ""; }
}

async function startChecklist(access, user) {
  const refs = getSchoolYearRefs(ACTIVE_SCHOOL_YEAR).domains;
  const [curriculumSnap, templatesSnap, savedSnap] = await Promise.all([
    getDoc(refs.curriculum), getDoc(refs.templates), getDoc(teacherChecklistDocRef(user)),
  ]);
  const curriculum = curriculumSnap.exists() ? curriculumSnap.data() || {} : {};
  const templates = templatesSnap.exists() ? templatesSnap.data() || {} : {};
  const saved = savedSnap.exists() ? savedSnap.data() || {} : {};
  const state = {
    semester: "sem1",
    items: saved.items && typeof saved.items === "object" ? structuredClone(saved.items) : {},
    courses: {
      sem1: buildTeacherCourses(curriculum, templates, access.teacher, "sem1"),
      sem2: buildTeacherCourses(curriculum, templates, access.teacher, "sem2"),
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
        await setDoc(teacherChecklistDocRef(user), {
          schoolYear: ACTIVE_SCHOOL_YEAR,
          userUid: user.uid,
          email: access.email,
          teacherId: clean(access.teacher.id),
          teacherName: clean(access.teacher.name),
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
    const courses = state.courses[state.semester];
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
      head.innerHTML = `<div class="checklist-course-title"><div class="checklist-badges"><span>${course.grade}</span><span>${course.category}</span><span>${course.track}</span></div><h2>${escapeHtml(course.nameKo)}</h2><p>${escapeHtml(course.nameEn || "")}</p></div><div class="checklist-course-meta"><strong>${escapeHtml(course.group)}</strong><span>${course.credits ? `${escapeHtml(course.credits)}시수` : "시수 미입력"}</span></div>`;
      const body = document.createElement("div"); body.className = "checklist-course-body";
      const folder = document.createElement("div"); folder.className = "checklist-folder-row";
      const folderLabel = document.createElement("label"); folderLabel.textContent = "Google Folder";
      const folderInput = document.createElement("input"); folderInput.type = "url"; folderInput.placeholder = "https://drive.google.com/..."; folderInput.value = item.folderUrl || "";
      const folderLink = document.createElement("a"); folderLink.className = "portal-btn folder-open"; folderLink.target = "_blank"; folderLink.rel = "noopener noreferrer"; folderLink.textContent = "폴더 열기";
      const syncFolderLink = () => { const url = safeUrl(folderInput.value); folderLink.href = url || "#"; folderLink.classList.toggle("disabled", !url); };
      folderInput.addEventListener("change", () => { item.folderUrl = folderInput.value.trim(); syncFolderLink(); save(); });
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
        input.addEventListener("change", () => { item[key] = input.checked; save(); });
        const copy = document.createElement("span"); copy.innerHTML = `<strong>${title}</strong><small>${description}</small>`;
        label.append(input, copy); checks.append(label);
      });
      const confirm = document.createElement("label"); confirm.className = "checklist-confirm";
      const confirmInput = document.createElement("input"); confirmInput.type = "checkbox"; confirmInput.checked = !!item.confirmed;
      const confirmCopy = document.createElement("span"); confirmCopy.innerHTML = "<strong>최종 확인</strong><small>이 과목의 내용을 모두 확인했습니다.</small>";
      confirmInput.addEventListener("change", () => { item.confirmed = confirmInput.checked; card.classList.toggle("complete", item.confirmed); updateProgress(); save(); });
      confirm.append(confirmInput, confirmCopy);
      body.append(folder, checks, confirm); card.append(head, body); container.append(card);
    });
    updateProgress();
  };

  document.querySelectorAll(".semester-tab").forEach(button => button.addEventListener("click", () => {
    state.semester = button.dataset.semester; render();
  }));
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
    if (page === "curriculum-checklist") await startChecklist(access, user);
    else renderMenu(access);
  } catch (error) {
    console.error("[teacher portal]", error);
    showGate("portalDenied", `자료를 불러오지 못했습니다: ${error?.message || error}`);
  }
}

setupYearSelector();
setupAuthButtons();
onAuth(handleAuth);
