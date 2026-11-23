import { login, logout, onAuth } from "./auth.js?v=r419";
import { ACTIVE_SCHOOL_YEAR, getSchoolYearRefs } from "./config.js?v=2026-07-15-room-availability-separation-r355";
import { getKnownSchoolYears, setActiveSchoolYear } from "./school-year.js?v=2026-07-15-room-availability-separation-r355";
import { readTeacherPortalAccess, normalizePortalRole } from "./teacher-portal-auth.js?v=r419";
import { getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const byId = id => document.getElementById(id);
const clean = value => String(value || "").trim();
const normalizeEmail = value => clean(value).toLocaleLowerCase();
let teachers = [];
let dirty = false;

function uid() { return `tch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
function setVisible(id, visible) { const node = byId(id); if (node) node.hidden = !visible; }
function showGate(id, message = "") {
  ["portalLoading", "portalSignedOut", "portalDenied", "teacherAdminApp"].forEach(name => setVisible(name, name === id));
  if (id === "portalDenied") byId("portalDeniedMessage").textContent = message;
}
function setStatus(message, type = "") { const node = byId("teacherAdminStatus"); node.textContent = message; node.className = `teacher-admin-status ${type}`; }
function markDirty() { dirty = true; setStatus("저장되지 않은 변경사항이 있습니다."); }

function setupYearSelector() {
  const select = byId("portalYearSelect");
  [...new Set([...getKnownSchoolYears(), ACTIVE_SCHOOL_YEAR])].sort((a,b) => Number(b)-Number(a)).forEach(year => {
    const option = document.createElement("option"); option.value = year; option.textContent = `${year}학년도`; option.selected = year === ACTIVE_SCHOOL_YEAR; select.append(option);
  });
  select.addEventListener("change", () => { if (!dirty || confirm("저장하지 않은 변경사항을 버리고 학년도를 바꿀까요?")) setActiveSchoolYear(select.value); else select.value = ACTIVE_SCHOOL_YEAR; });
}

function renderRows() {
  const body = byId("teacherAdminRows"); body.replaceChildren();
  teachers.forEach((teacher, index) => {
    const row = document.createElement("tr");
    const fields = [["name","이름","text"],["email","name@his.sc.kr","email"],["note","메모","text"]];
    fields.forEach(([key, placeholder, type]) => { const td=document.createElement("td"); const input=document.createElement("input"); input.type=type; input.value=teacher[key]||""; input.placeholder=placeholder; input.addEventListener("input",()=>{ teacher[key]=input.value; markDirty(); }); td.append(input); row.append(td); });
    const roleTd=document.createElement("td"); const role=document.createElement("select"); [["basic","기본"],["curriculum","커리큘럼"],["admin","관리자"]].forEach(([value,label])=>{const option=document.createElement("option");option.value=value;option.textContent=label;option.selected=normalizePortalRole(teacher.accessRole)===value;role.append(option);}); role.addEventListener("change",()=>{teacher.accessRole=role.value;markDirty();});roleTd.append(role);row.append(roleTd);
    const statusTd=document.createElement("td"); const statusLabel=document.createElement("label"); statusLabel.className="teacher-status"; const enabled=document.createElement("input");enabled.type="checkbox";enabled.checked=!teacher.portalDisabled;enabled.addEventListener("change",()=>{teacher.portalDisabled=!enabled.checked;markDirty();});statusLabel.append(enabled,document.createTextNode("사용"));statusTd.append(statusLabel);row.append(statusTd);
    const deleteTd=document.createElement("td"); const remove=document.createElement("button");remove.type="button";remove.className="portal-btn teacher-delete-btn";remove.textContent="삭제";remove.addEventListener("click",()=>{if(!confirm(`${teacher.name||teacher.email||"이 교사"}를 교사목록에서 삭제할까요?\n연결된 과목이 있다면 담당 교사 연결을 다시 확인해야 합니다.`))return;teachers.splice(index,1);markDirty();renderRows();});deleteTd.append(remove);row.append(deleteTd); body.append(row);
  });
}

async function saveTeachers() {
  const emails = new Set();
  for (const teacher of teachers) {
    teacher.name = clean(teacher.name); teacher.email = normalizeEmail(teacher.email); teacher.note = clean(teacher.note); teacher.accessRole = normalizePortalRole(teacher.accessRole);
    if (!teacher.name || !teacher.email.endsWith("@his.sc.kr")) { setStatus("모든 교사의 이름과 @his.sc.kr 이메일을 확인해 주세요.","error"); return; }
    if (emails.has(teacher.email)) { setStatus(`중복 이메일이 있습니다: ${teacher.email}`,"error"); return; }
    emails.add(teacher.email);
  }
  const button=byId("saveTeachersBtn");button.disabled=true;setStatus("저장 중…");
  try { await setDoc(getSchoolYearRefs(ACTIVE_SCHOOL_YEAR).domains.teachers,{teachers,updatedAt:serverTimestamp()},{merge:true});dirty=false;setStatus(`${teachers.length}명의 교사와 권한을 저장했습니다.`,"saved"); }
  catch(error){console.error("[teacher management save]",error);setStatus(`저장 실패: ${error?.message||error}`,"error");}
  finally{button.disabled=false;}
}

function setupControls() {
  byId("portalLoginBtn").addEventListener("click",login);byId("portalLoginMainBtn").addEventListener("click",login);byId("portalLogoutBtn").addEventListener("click",logout);
  byId("addTeacherBtn").addEventListener("click",()=>{teachers.push({id:uid(),name:"",email:"",note:"",accessRole:"basic",portalDisabled:false});markDirty();renderRows();});
  byId("saveTeachersBtn").addEventListener("click",saveTeachers);
  const lang=byId("portalLanguageBtn");lang.addEventListener("click",()=>{const english=document.documentElement.lang!=="en";document.documentElement.lang=english?"en":"ko";lang.textContent=english?"한국어":"English";});
}

setupYearSelector();setupControls();
onAuth(async user => {
  byId("portalAuthStatus").textContent=user?.email||"로그인 필요";setVisible("portalLoginBtn",!user);setVisible("portalLogoutBtn",!!user);
  if(!user){showGate("portalSignedOut");return;}showGate("portalLoading");
  try { const access=await readTeacherPortalAccess(user);if(!access.allowed||!access.isAdmin){showGate("portalDenied",access.reason||"관리자 권한이 필요합니다.");return;}const snapshot=await getDoc(getSchoolYearRefs(ACTIVE_SCHOOL_YEAR).domains.teachers);teachers=snapshot.exists()&&Array.isArray(snapshot.data()?.teachers)?structuredClone(snapshot.data().teachers):[];teachers.forEach(t=>{t.accessRole=normalizePortalRole(t.accessRole);t.portalDisabled=t.portalDisabled===true;});renderRows();setStatus(`총 ${teachers.length}명`);showGate("teacherAdminApp"); }
  catch(error){console.error("[teacher management]",error);showGate("portalDenied",`자료를 불러오지 못했습니다: ${error?.message||error}`);}
});
