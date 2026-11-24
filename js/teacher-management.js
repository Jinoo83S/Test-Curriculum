import { login, logout, onAuth } from "./auth.js?v=r424";
import { ACTIVE_SCHOOL_YEAR, getSchoolYearRefs } from "./config.js?v=2026-07-15-room-availability-separation-r355";
import { getKnownSchoolYears, setActiveSchoolYear } from "./school-year.js?v=2026-07-15-room-availability-separation-r355";
import { readTeacherPortalAccess, normalizePortalRole } from "./teacher-portal-auth.js?v=r424";
import { setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { appliedYearsForTeacher, buildTeacherYearRoster, schoolEmailKey } from "./teacher-year-directory.js?v=r431";
import { readRegisteredPortalYears, readTeacherYearSources, readCurriculumPublication, saveCurriculumPublication } from "./school-portal-settings-data.js?v=r431";

const byId = id => document.getElementById(id);
const clean = value => String(value || "").trim();
const normalizeEmail = value => clean(value).toLocaleLowerCase();
let teachers = [];
let dirty = false;
let settingsYears = getKnownSchoolYears();
let yearSources = new Map();
let yearLoadErrors = [];
let publicationLoad;
let settingsAuthorized = false;
let authRequest = 0;

function uid() { return `tch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
function setVisible(id, visible) { const node = byId(id); if (node) node.hidden = !visible; }
function showGate(id, message = "") {
  ["portalLoading", "portalSignedOut", "portalDenied", "teacherAdminApp"].forEach(name => setVisible(name, name === id));
  if (id === "portalDenied") byId("portalDeniedMessage").textContent = message;
}
function setStatus(message, type = "") { const node = byId("teacherAdminStatus"); node.textContent = message; node.className = `teacher-admin-status ${type}`; }
function markDirty() { dirty = true; setStatus("저장되지 않은 변경사항이 있습니다."); }

function renderYearSelector() {
  const select = byId("portalYearSelect");
  select.replaceChildren();
  [...new Set([...settingsYears, ACTIVE_SCHOOL_YEAR])].sort((a,b) => Number(b)-Number(a)).forEach(year => {
    const option = document.createElement("option"); option.value = year; option.textContent = `${year}학년도`; option.selected = year === ACTIVE_SCHOOL_YEAR; select.append(option);
  });
}

function renderRows() {
  const body = byId("teacherAdminRows"); body.replaceChildren();
  const directory = [...yearSources.values()].flatMap(source => source.teachers);
  const rosters = new Map([...yearSources].map(([year, source]) =>
    [year, buildTeacherYearRoster(year === ACTIVE_SCHOOL_YEAR ? { ...source, teachers } : source, directory)]));
  const yearsCell = teacher => {
    const cell = document.createElement("td");
    cell.className = "teacher-applied-years";
    const years = appliedYearsForTeacher(teacher, rosters);
    cell.textContent = years.length ? years.join(" · ") : yearLoadErrors.length ? "확인 가능한 배정 없음" : "미배정";
    return cell;
  };
  teachers.forEach((teacher, index) => {
    const row = document.createElement("tr");
    const fields = [["name","이름","text"],["email","name@his.sc.kr","email"],["note","메모","text"]];
    fields.forEach(([key, placeholder, type]) => { const td=document.createElement("td"); const input=document.createElement("input"); input.type=type; input.id=`teacher-${key}-${teacher.id}`; input.name=`teacher_${key}_${teacher.id}`; input.value=teacher[key]||""; input.placeholder=placeholder; input.addEventListener("input",()=>{ teacher[key]=input.value; markDirty(); }); td.append(input); row.append(td); });
    row.append(yearsCell(teacher));
    const roleTd=document.createElement("td"); const role=document.createElement("select"); role.id=`teacher-role-${teacher.id}`;role.name=`teacher_role_${teacher.id}`; [["basic","기본"],["curriculum","커리큘럼"],["admin","관리자"]].forEach(([value,label])=>{const option=document.createElement("option");option.value=value;option.textContent=label;option.selected=normalizePortalRole(teacher.accessRole)===value;role.append(option);}); role.addEventListener("change",()=>{teacher.accessRole=role.value;markDirty();});roleTd.append(role);row.append(roleTd);
    const statusTd=document.createElement("td"); const statusLabel=document.createElement("label"); statusLabel.className="teacher-status"; const enabled=document.createElement("input");enabled.type="checkbox";enabled.id=`teacher-enabled-${teacher.id}`;enabled.name=`teacher_enabled_${teacher.id}`;enabled.checked=!teacher.portalDisabled;enabled.addEventListener("change",()=>{teacher.portalDisabled=!enabled.checked;markDirty();});statusLabel.append(enabled,document.createTextNode("사용"));statusTd.append(statusLabel);row.append(statusTd);
    const deleteTd=document.createElement("td"); const remove=document.createElement("button");remove.type="button";remove.className="portal-btn teacher-delete-btn";remove.textContent="삭제";remove.addEventListener("click",()=>{if(!confirm(`${teacher.name||teacher.email||"이 교사"}를 교사목록에서 삭제할까요?\n연결된 과목이 있다면 담당 교사 연결을 다시 확인해야 합니다.`))return;teachers.splice(index,1);markDirty();renderRows();});deleteTd.append(remove);row.append(deleteTd); body.append(row);
  });
  const currentRoster = rosters.get(ACTIVE_SCHOOL_YEAR) || [];
  const currentRecords = new Set(currentRoster.filter(teacher => !teacher.automatic).map(schoolIdentity));
  const additional = new Map(currentRoster.filter(teacher => teacher.automatic)
    .map(teacher => [schoolIdentity(teacher), { teacher, assignedHere: true }]));
  for (const [year, roster] of rosters) {
    if (year === ACTIVE_SCHOOL_YEAR) continue;
    for (const teacher of roster) {
      if (!teacher.subjects.length) continue;
      const key = schoolIdentity(teacher);
      if (!currentRecords.has(key) && !additional.has(key)) additional.set(key, { teacher, assignedHere: false });
    }
  }
  for (const { teacher, assignedHere } of additional.values()) {
    const row = body.insertRow();
    row.className = "teacher-automatic-row";
    for (const value of [teacher.name, teacher.email, teacher.note]) row.insertCell().textContent = value || "—";
    row.append(yearsCell(teacher));
    row.insertCell().textContent = "—";
    row.insertCell().textContent = assignedHere ? "자동 표시" : "다른 학년도 배정";
    const add = document.createElement("button");
    add.type = "button";
    add.className = "portal-btn";
    add.textContent = "등록";
    add.addEventListener("click", () => {
      const id = teacher.id && !teachers.some(item => item.id === teacher.id) ? teacher.id : uid();
      teachers.push({ id, name: teacher.name, email: teacher.email, note: teacher.note, accessRole: "basic", portalDisabled: false });
      markDirty();
      renderRows();
    });
    row.insertCell().append(add);
  }
}

function schoolIdentity(teacher) {
  return schoolEmailKey(teacher.email) || teacher.id || clean(teacher.name).normalize("NFKC").toLowerCase();
}

async function saveTeachers() {
  if (!settingsAuthorized) return;
  const emails = new Set();
  for (const teacher of teachers) {
    teacher.name = clean(teacher.name); teacher.email = normalizeEmail(teacher.email); teacher.note = clean(teacher.note); teacher.accessRole = normalizePortalRole(teacher.accessRole);
    if (!teacher.name || (teacher.email && !teacher.email.endsWith("@his.sc.kr"))) { setStatus("교사 이름을 입력하고, 이메일이 있다면 @his.sc.kr 계정을 입력해 주세요.","error"); return; }
    if (teacher.email && emails.has(teacher.email)) { setStatus(`중복 이메일이 있습니다: ${teacher.email}`,"error"); return; }
    if (teacher.email) emails.add(teacher.email);
  }
  const button=byId("saveTeachersBtn");button.disabled=true;setStatus("저장 중…");
  try { await setDoc(getSchoolYearRefs(ACTIVE_SCHOOL_YEAR).domains.teachers,{teachers,updatedAt:serverTimestamp()},{merge:true});dirty=false;setStatus(`${teachers.length}명의 교사와 권한을 저장했습니다.`,"saved"); }
  catch(error){console.error("[teacher management save]",error);setStatus(`저장 실패: ${error?.message||error}`,"error");}
  finally{button.disabled=false;}
}

function openSettingsPanel(publication) {
  for (const [id, active] of [["teacherSettingsTab", !publication], ["publicationSettingsTab", publication]]) {
    byId(id).classList.toggle("primary", active);
    byId(id).setAttribute("aria-pressed", String(active));
  }
  setVisible("teacherSettingsPanel", !publication);
  setVisible("publicationSettingsPanel", publication);
  if (publication && settingsAuthorized && !publicationLoad) publicationLoad = renderPublicationRows();
}

async function renderPublicationRows() {
  const body = byId("publicationRows");
  const status = byId("publicationStatus");
  body.replaceChildren();
  status.textContent = "학년도별 공개 상태를 불러오는 중입니다.";
  await Promise.all(settingsYears.map(async year => {
    const row = body.insertRow();
    row.insertCell().textContent = `${year}학년도`;
    const badge = row.insertCell();
    const cell = row.insertCell();
    badge.textContent = "불러오는 중";
    try {
      let { published, configured } = await readCurriculumPublication(year);
      const select = document.createElement("select");
      select.setAttribute("aria-label", `${year}학년도 커리큘럼 공개 여부`);
      select.append(new Option("공개", "true"), new Option("비공개", "false"));
      const update = () => {
        select.value = String(published);
        badge.textContent = published ? (configured ? "공개" : "공개 (기본값)") : "비공개";
        badge.dataset.published = String(published);
      };
      update();
      select.addEventListener("change", async () => {
        if (!settingsAuthorized) { update(); return; }
        const next = select.value === "true";
        select.disabled = true;
        try {
          await saveCurriculumPublication(year, next);
          published = next;
          configured = true;
          status.textContent = `${year}학년도 상태를 저장했습니다.`;
        } catch (error) {
          status.textContent = `${year}학년도 저장 실패 · ${error.message}`;
        } finally {
          update();
          select.disabled = false;
        }
      });
      cell.append(select);
    } catch (error) {
      badge.textContent = "조회 실패";
      cell.textContent = error.message;
    }
  }));
  if (status.textContent === "학년도별 공개 상태를 불러오는 중입니다.") {
    status.textContent = `등록된 학년도 ${settingsYears.length}개`;
  }
}

function setupControls() {
  byId("portalLoginBtn").addEventListener("click",login);byId("portalLoginMainBtn").addEventListener("click",login);byId("portalLogoutBtn").addEventListener("click",logout);
  byId("addTeacherBtn").addEventListener("click",()=>{teachers.push({id:uid(),name:"",email:"",note:"",accessRole:"basic",portalDisabled:false});markDirty();renderRows();});
  byId("saveTeachersBtn").addEventListener("click",saveTeachers);
  byId("teacherSettingsTab").addEventListener("click", () => openSettingsPanel(false));
  byId("publicationSettingsTab").addEventListener("click", () => openSettingsPanel(true));
  const select = byId("portalYearSelect");
  select.addEventListener("change", () => { if (!dirty || confirm("저장하지 않은 변경사항을 버리고 학년도를 바꿀까요?")) setActiveSchoolYear(select.value); else select.value = ACTIVE_SCHOOL_YEAR; });
  const lang=byId("portalLanguageBtn");lang.addEventListener("click",()=>{const english=document.documentElement.lang!=="en";document.documentElement.lang=english?"en":"ko";lang.textContent=english?"한국어":"English";});
}

renderYearSelector();setupControls();
onAuth(async user => {
  const request = ++authRequest;
  settingsAuthorized = false;
  publicationLoad = null;
  byId("portalAuthStatus").textContent=user?.email||"로그인 필요";setVisible("portalLoginBtn",!user);setVisible("portalLogoutBtn",!!user);
  if(!user){showGate("portalSignedOut");return;}showGate("portalLoading");
  try {
    const access = await readTeacherPortalAccess(user);
    if (request !== authRequest) return;
    if (!access.allowed || !access.isAdmin) {
      showGate("portalDenied", access.reason || "관리자 권한이 필요합니다.");
      return;
    }
    settingsAuthorized = true;
    let yearListFailed = false;
    settingsYears = await readRegisteredPortalYears().catch(() => { yearListFailed = true; return getKnownSchoolYears(); });
    if (request !== authRequest) return;
    renderYearSelector();
    showGate("teacherAdminApp");
    openSettingsPanel(false);
    setStatus("학년도별 교사와 담당 과목을 불러오는 중입니다.");
    byId("teacherAdminRows").replaceChildren();
    byId("addTeacherBtn").disabled = byId("saveTeachersBtn").disabled = true;
    const years = [...new Set([ACTIVE_SCHOOL_YEAR, ...settingsYears])];
    const data = await Promise.allSettled(years.map(year => readTeacherYearSources(year)));
    if (request !== authRequest) return;
    yearSources = new Map(years.flatMap((year, index) => data[index].status === "fulfilled" ? [[year, data[index].value]] : []));
    yearLoadErrors = years.filter(year => !yearSources.has(year));
    if (!yearSources.has(ACTIVE_SCHOOL_YEAR)) {
      setStatus("현재 학년도의 교사 정보를 불러오지 못했습니다.", "error");
      return;
    }
    teachers = structuredClone(yearSources.get(ACTIVE_SCHOOL_YEAR).teachers);
    dirty = false;
    renderRows();
    byId("addTeacherBtn").disabled = byId("saveTeachersBtn").disabled = false;
    const notes = [yearListFailed ? "서버 학년도 목록 조회 실패" : "", yearLoadErrors.length ? `조회 실패 ${yearLoadErrors.join(", ")}학년도` : ""].filter(Boolean);
    setStatus([`등록 교사 ${teachers.length}명`, ...notes].join(" · "));
  } catch (error) {
    if (request !== authRequest) return;
    console.error("[teacher management]", error);
    showGate("portalDenied", `자료를 불러오지 못했습니다: ${error?.message || error}`);
  }
});
