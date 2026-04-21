// ================================================================
// SECTION 1 · Firebase Imports & Initialization
// ================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBwUERcfAYMiqewOsp9zsY6_CnHef-nfK0",
  authDomain: "his-curriculum-8e737.firebaseapp.com",
  projectId: "his-curriculum-8e737",
  storageBucket: "his-curriculum-8e737.firebasestorage.app",
  messagingSenderId: "1091130688532",
  appId: "1:1091130688532:web:79622f9da3591ab2d3d301",
};

const fbApp     = initializeApp(firebaseConfig);
const auth      = getAuth(fbApp);
const db        = getFirestore(fbApp);
const provider  = new GoogleAuthProvider();
const boardRef  = doc(db, "boards", "main");

// ================================================================
// SECTION 2 · DOM References
// ================================================================
const authStatus        = document.getElementById("authStatus");
const loginBtn          = document.getElementById("loginBtn");
const logoutBtn         = document.getElementById("logoutBtn");
const resetBoardBtn     = document.getElementById("resetBoardBtn");
const loginOverlay      = document.getElementById("loginOverlay");
const exportXlsxBtn     = document.getElementById("exportXlsxBtn");

const templateNameKo    = document.getElementById("templateNameKo");
const templateNameEn    = document.getElementById("templateNameEn");
const templateTeacher   = document.getElementById("templateTeacher");
const templateLanguage  = document.getElementById("templateLanguage");
const templateSubmitBtn = document.getElementById("templateSubmitBtn");
const templateCancelBtn = document.getElementById("templateCancelBtn");
const templateList      = document.getElementById("templateList");

const templateSeparateSemesters = document.getElementById("templateSeparateSemesters");
const semesterTemplateFields    = document.getElementById("semesterTemplateFields");
const templateSem1NameKo  = document.getElementById("templateSem1NameKo");
const templateSem1NameEn  = document.getElementById("templateSem1NameEn");
const templateSem1Teacher = document.getElementById("templateSem1Teacher");
const templateSem2NameKo  = document.getElementById("templateSem2NameKo");
const templateSem2NameEn  = document.getElementById("templateSem2NameEn");
const templateSem2Teacher = document.getElementById("templateSem2Teacher");

const categoryOptionList   = document.getElementById("categoryOptionList");
const trackOptionList      = document.getElementById("trackOptionList");
const groupOptionList      = document.getElementById("groupOptionList");
const categoryOptionInput  = document.getElementById("categoryOptionInput");
const trackOptionInput     = document.getElementById("trackOptionInput");
const groupOptionInput     = document.getElementById("groupOptionInput");
const addCategoryOptionBtn = document.getElementById("addCategoryOptionBtn");
const addTrackOptionBtn    = document.getElementById("addTrackOptionBtn");
const addGroupOptionBtn    = document.getElementById("addGroupOptionBtn");

const tab7to9Btn   = document.getElementById("tab7to9Btn");
const tab10to12Btn = document.getElementById("tab10to12Btn");
const gradeBoard   = document.getElementById("gradeBoard");

const boardView           = document.getElementById("boardView");
const groupManagerView    = document.getElementById("groupManagerView");
const templateManagerView = document.getElementById("templateManagerView");
const groupManagerBoard   = document.getElementById("groupManagerBoard");

const openGroupManagerBtn    = document.getElementById("openGroupManagerBtn");
const openTemplateManagerBtn = document.getElementById("openTemplateManagerBtn");
const groupManagerBackBtn    = document.getElementById("groupManagerBackBtn");
const sidebarSchoolLevelFilter   = document.getElementById("sidebarSchoolLevelFilter");
const templateSchoolLevelPicker  = document.getElementById("templateSchoolLevelPicker");
const templateManagerLevelFilter = document.getElementById("templateManagerLevelFilter");
const groupManagerAddGroupBtn= document.getElementById("groupManagerAddGroupBtn");

const templateManagerBackBtn        = document.getElementById("templateManagerBackBtn");
const templateManagerSearchInput    = document.getElementById("templateManagerSearchInput");
const templateManagerLanguageFilter = document.getElementById("templateManagerLanguageFilter");
const templateManagerSplitFilter    = document.getElementById("templateManagerSplitFilter");
const templateManagerSortSelect     = document.getElementById("templateManagerSortSelect");
const templateManagerCount          = document.getElementById("templateManagerCount");
const templateManagerTableWrap      = document.getElementById("templateManagerTableWrap");
const templateManagerAddRowBtn      = document.getElementById("templateManagerAddRowBtn");
const templateManagerSaveBtn        = document.getElementById("templateManagerSaveBtn");
const templateManagerDiscardBtn     = document.getElementById("templateManagerDiscardBtn");

// ================================================================
// SECTION 3 · Constants
// ================================================================
const GRADE_KEYS = ["7학년","8학년","9학년","10학년","11학년","12학년"];
const GRADE_GROUPS = {
  tab7to9:   ["7학년","8학년","9학년"],
  tab10to12: ["10학년","11학년","12학년"]
};
const DEFAULT_OPTIONS = {
  category: ["교과","창체"],
  track:    ["공통","배정","선택"],
  group:    ["선택","국어","영어","수학","사회","과학","정보","예술","체육","자율활동","동아리","채플","기타"]
};
const DEFAULT_ROW_COUNT  = 4;
const SEMESTER_LABELS    = { sem1: "1학기", sem2: "2학기" };
const CATEGORY_PALETTE   = [
  { bg:"#dbeafe",text:"#1e3a8a"},{ bg:"#dcfce7",text:"#166534"},
  { bg:"#fef3c7",text:"#92400e"},{ bg:"#fce7f3",text:"#9d174d"},
  { bg:"#ede9fe",text:"#5b21b6"},{ bg:"#cffafe",text:"#155e75"}
];
const DEFAULT_COL_WIDTHS = ["52px","52px","58px","1fr","1fr","40px","24px"];
const colWidthsKey = (g) => `his_cw_${g}`;

// ================================================================
// SECTION 4 · Utilities
// ================================================================
const uid  = (p="id") => `${p}-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
const clean= (v) => String(v??"").trim();
const cloneJson = (v) => JSON.parse(JSON.stringify(v));

function uniqueOrdered(arr) {
  const out=[];
  arr.forEach(v=>{ if(v!=null&&v!==""&&!out.includes(v)) out.push(v); });
  return out;
}
function makeBtn(text,cls,onClick) {
  const b=document.createElement("button");
  b.type="button"; if(cls) b.className=cls; b.textContent=text;
  if(onClick) b.addEventListener("click",onClick);
  return b;
}
function escapeHtml(v){
  return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ================================================================
// SECTION 5 · Data Model: Templates & Groups
// ================================================================
function normalizeTemplateGroup(item={}) {
  return { id:item.id||uid("grp"), name:clean(item.name), creditValue:clean(item.creditValue) };
}

function normalizeTemplate(item={}) {
  const lang = ["Korean","English","Both"].includes(item.language)?item.language:"Both";
  const s1ko=clean(item.sem1NameKo), s1en=clean(item.sem1NameEn), s1te=clean(item.sem1Teacher);
  const s2ko=clean(item.sem2NameKo), s2en=clean(item.sem2NameEn), s2te=clean(item.sem2Teacher);
  const useSemesterOverrides = Boolean(item.useSemesterOverrides||item.separateBySemester||item.splitBySemester||s1ko||s1en||s1te||s2ko||s2en||s2te);
  return {
    id: item.id||uid("tpl"), language:lang, useSemesterOverrides,
    nameKo:clean(item.nameKo), nameEn:clean(item.nameEn), teacher:clean(item.teacher),
    sem1NameKo:s1ko, sem1NameEn:s1en, sem1Teacher:s1te,
    sem2NameKo:s2ko, sem2NameEn:s2en, sem2Teacher:s2te,
    calcGroupId: clean(item.calcGroupId)||null,
    schoolLevel: ["중등","고등","공통"].includes(item.schoolLevel)?item.schoolLevel:"공통"
  };
}

function getSemesterTemplateData(tplOrId, semKey) {
  const item = typeof tplOrId==="string" ? getTemplateById(tplOrId) : tplOrId;
  if(!item) return {nameKo:"",nameEn:"",teacher:"",language:"Both"};
  const p = semKey==="sem2"?"sem2":"sem1";
  return {
    nameKo:   clean(item[`${p}NameKo`])  || clean(item.nameKo)  || clean(item.nameEn),
    nameEn:   clean(item[`${p}NameEn`])  || clean(item.nameEn)  || clean(item.nameKo),
    teacher:  clean(item[`${p}Teacher`]) || clean(item.teacher),
    language: item.language||"Both"
  };
}

function getTemplateById(id)           { return state.templates.find(t=>t.id===id)||null; }
function getTemplateGroupById(id,src=state) { return (src.templateGroups||[]).find(g=>g.id===id)||null; }

function getTemplateCardTitle(item) {
  if(!item) return "-";
  return clean(item.nameKo)||clean(item.sem1NameKo)||clean(item.sem2NameKo)||clean(item.nameEn)||clean(item.sem1NameEn)||clean(item.sem2NameEn)||"-";
}
function getTemplateTeacherSummary(item) {
  return uniqueOrdered([getSemesterTemplateData(item,"sem1").teacher,getSemesterTemplateData(item,"sem2").teacher].filter(Boolean)).join(" · ");
}
function getCommonTeacherCandidate(item) {
  if(clean(item.teacher)) return clean(item.teacher);
  const t1=clean(item.sem1Teacher), t2=clean(item.sem2Teacher);
  return t1&&t1===t2?t1:"";
}
function isSemesterDataSame(item) {
  if(!item) return false;
  if(!item.useSemesterOverrides) return true;
  const s1=getSemesterTemplateData(item,"sem1"), s2=getSemesterTemplateData(item,"sem2");
  return s1.nameKo===s2.nameKo&&s1.nameEn===s2.nameEn&&s1.teacher===s2.teacher;
}

/** Returns grade numbers ["7","8",...] where the template is applied */
function getTemplateAppliedGrades(templateId) {
  return GRADE_KEYS
    .filter(grade=>(state.gradeBoards[grade]||[]).some(r=>r.sem1TemplateId===templateId||r.sem2TemplateId===templateId))
    .map(g=>g.replace("학년",""));
}

function createDefaultTemplates() {
  return [
    normalizeTemplate({id:uid("tpl"),nameKo:"영어",nameEn:"English Language Arts",language:"English"}),
    normalizeTemplate({id:uid("tpl"),nameKo:"국어",nameEn:"Korean Language Arts",language:"Korean"}),
    normalizeTemplate({id:uid("tpl"),nameKo:"수학",nameEn:"Mathematics",language:"Both"}),
    normalizeTemplate({id:uid("tpl"),nameKo:"과학",nameEn:"Science",language:"Both"})
  ];
}

// ================================================================
// SECTION 6 · Data Model: Rows & Boards
// ================================================================
function createRow(opts=DEFAULT_OPTIONS, seed={}) {
  return {
    id:uid("row"),
    category:clean(seed.category)||opts.category[0]||"",
    track:   clean(seed.track)   ||opts.track[0]   ||"",
    group:   clean(seed.group)   ||opts.group[0]   ||"",
    credits: clean(seed.credits),
    sem1TemplateId:null, sem2TemplateId:null
  };
}

function normalizeRow(row={}, opts=DEFAULT_OPTIONS) {
  const safeC = opts.category.includes(row.category)?row.category:(clean(row.category)||opts.category[0]||"");
  const safeT = opts.track.includes(row.track)      ?row.track   :(clean(row.track)   ||opts.track[0]   ||"");
  const safeG = opts.group.includes(row.group)      ?row.group   :(clean(row.group)   ||opts.group[0]   ||"");
  const legId = row.templateId??row.sem1??row.sem2??null;
  const s1id  = row.sem1TemplateId!==undefined?(row.sem1TemplateId??null):legId;
  const s2id  = row.sem2TemplateId!==undefined?(row.sem2TemplateId??null):legId;
  return { id:row.id||uid("row"), category:safeC, track:safeT, group:safeG, credits:clean(row.credits), sem1TemplateId:s1id, sem2TemplateId:s2id };
}

function createDefaultState() {
  const gradeBoards={};
  GRADE_KEYS.forEach(g=>{ gradeBoards[g]=Array.from({length:DEFAULT_ROW_COUNT},()=>createRow(DEFAULT_OPTIONS)); });
  return {
    options:{ category:[...DEFAULT_OPTIONS.category], track:[...DEFAULT_OPTIONS.track], group:[...DEFAULT_OPTIONS.group] },
    templates:createDefaultTemplates(), templateGroups:[], gradeBoards
  };
}

function normalizeState(raw={}) {
  const safeOpts = {
    category: Array.isArray(raw.options?.category)&&raw.options.category.length?uniqueOrdered(raw.options.category.map(clean)):[...DEFAULT_OPTIONS.category],
    track:    Array.isArray(raw.options?.track)   &&raw.options.track.length   ?uniqueOrdered(raw.options.track.map(clean))   :[...DEFAULT_OPTIONS.track],
    group:    Array.isArray(raw.options?.group)   &&raw.options.group.length   ?uniqueOrdered(raw.options.group.map(clean))   :[...DEFAULT_OPTIONS.group]
  };
  const safeTpls  = Array.isArray(raw.templates)&&raw.templates.length?raw.templates.map(normalizeTemplate):createDefaultTemplates();
  const safeGrps  = Array.isArray(raw.templateGroups)?raw.templateGroups.map(normalizeTemplateGroup).filter(g=>g.name):[];
  const gBoards   = {};
  GRADE_KEYS.forEach(grade=>{
    const rows=Array.isArray(raw.gradeBoards?.[grade])?raw.gradeBoards[grade]:[];
    gBoards[grade]=rows.length?rows.map(r=>normalizeRow(r,safeOpts)):Array.from({length:DEFAULT_ROW_COUNT},()=>createRow(safeOpts));
  });
  return { options:safeOpts, templates:safeTpls, templateGroups:safeGrps, gradeBoards:gBoards };
}

// ================================================================
// SECTION 7 · Application State
// ================================================================
let state            = createDefaultState();
let unsubscribeBoard = null;
let currentDrag      = null;
let templateEditId   = null;
let saveTimer        = null;
let activeTab        = "tab7to9";
// "board" | "groups" | "manager"
let activeMainView   = "board";
let templateManagerDraft = null;
const templateManagerUi  = { search:"", language:"all", split:"all", sort:"ko-asc", level:"전체" };
let sidebarSchoolLevel   = "전체";
let templateFormSchoolLevel = "공통";
let groupManagerSchoolLevel = "전체";

const tabBoardCache = { tab7to9:null, tab10to12:null };
const dirtyTabs     = new Set(["tab7to9","tab10to12"]);

function invalidateTabs(){ dirtyTabs.add("tab7to9"); dirtyTabs.add("tab10to12"); }
function resetTemplateManagerDraft(){ templateManagerDraft=null; }
function ensureTemplateManagerDraft(){
  if(!templateManagerDraft){
    templateManagerDraft={
      templates:     state.templates.map(t=>normalizeTemplate(cloneJson(t))),
      templateGroups:(state.templateGroups||[]).map(g=>normalizeTemplateGroup(cloneJson(g)))
    };
  }
  return templateManagerDraft;
}

function openTemplateManager(){ activeMainView="manager"; ensureTemplateManagerDraft(); render(); }
function openGroupManager()   { activeMainView="groups";  render(); }
function closeToBoard()       { activeMainView="board";   resetTemplateManagerDraft(); render(); }

// ================================================================
// SECTION 8 · Authentication
// ================================================================
function canEdit(){ return !!auth.currentUser; }

function updateAuthUI(user){
  if(user){
    authStatus.textContent=`${user.displayName||user.email||"사용자"} 로그인됨`;
    loginBtn.classList.add("hidden"); logoutBtn.classList.remove("hidden"); loginOverlay.classList.add("hidden");
  } else {
    authStatus.textContent="로그인이 필요합니다";
    loginBtn.classList.remove("hidden"); logoutBtn.classList.add("hidden"); loginOverlay.classList.remove("hidden");
  }
}
async function login() { try{ await signInWithPopup(auth,provider); }catch(e){ console.error(e); alert("로그인에 실패했습니다."); }}
async function logout(){ try{ await signOut(auth); }              catch(e){ console.error(e); alert("로그아웃에 실패했습니다."); }}

function subscribeBoard(){
  if(unsubscribeBoard){ unsubscribeBoard(); unsubscribeBoard=null; }
  unsubscribeBoard=onSnapshot(boardRef,async snap=>{
    if(!snap.exists()){ state=createDefaultState(); resetTemplateManagerDraft(); invalidateTabs(); render(); await saveNow(); return; }
    const prevClasses = state.classes||[];
    state=normalizeState(snap.data().state||{});
    // Prevent snapshot from wiping in-memory students not yet saved
    if(state.classes.length===0 && prevClasses.length>0) state.classes=prevClasses;
    resetTemplateManagerDraft(); invalidateTabs(); render();
  },err=>{ console.error(err); alert("Firestore 데이터를 불러오지 못했습니다."); });
}

onAuthStateChanged(auth,user=>{
  updateAuthUI(user);
  if(user){ subscribeBoard(); }
  else{
    if(unsubscribeBoard){ unsubscribeBoard(); unsubscribeBoard=null; }
    state=createDefaultState(); resetTemplateManagerDraft(); resetTemplateForm(); invalidateTabs(); render();
  }
});

// ================================================================
// SECTION 9 · Persistence
// ================================================================
function ensureStateConsistency(){ state=normalizeState(state); }
function scheduleSave(){ if(!canEdit()) return; clearTimeout(saveTimer); saveTimer=setTimeout(saveNow,250); }
async function saveNow(){ if(!canEdit()) return; ensureStateConsistency(); await setDoc(boardRef,{state,updatedAt:serverTimestamp()}); }

// ================================================================
// SECTION 10 · Column Resize (localStorage persisted)
// ================================================================
function loadColWidths(grade){
  try{ const s=localStorage.getItem(colWidthsKey(grade)); if(s){ const p=JSON.parse(s); if(Array.isArray(p)&&p.length===DEFAULT_COL_WIDTHS.length) return p; }}catch(_){}
  return [...DEFAULT_COL_WIDTHS];
}
function saveColWidths(grade,widths){ try{ localStorage.setItem(colWidthsKey(grade),JSON.stringify(widths)); }catch(_){} }
function applyColWidths(col,widths){
  const t=widths.join(" ");
  col.querySelectorAll(".grade-header-row,.grade-data-row").forEach(r=>{ r.style.gridTemplateColumns=t; });
}
function initColResize(col,headerRow,grade){
  const widths=loadColWidths(grade); applyColWidths(col,widths);
  headerRow.querySelectorAll(".col-resize-handle").forEach((h,i)=>{
    let sx,sw;
    h.addEventListener("mousedown",e=>{
      e.preventDefault(); sx=e.clientX; sw=h.parentElement.getBoundingClientRect().width; h.classList.add("resizing");
      const onMove=ev=>{ widths[i]=`${Math.max(36,sw+ev.clientX-sx)}px`; applyColWidths(col,widths); };
      const onUp  =()=>{ h.classList.remove("resizing"); saveColWidths(grade,widths); document.removeEventListener("mousemove",onMove); document.removeEventListener("mouseup",onUp); };
      document.addEventListener("mousemove",onMove); document.addEventListener("mouseup",onUp);
    });
  });
}

// ================================================================
// SECTION 11 · State Mutations — Options
// ================================================================
function addOption(type,value){
  if(!canEdit()) return;
  const v=clean(value); if(!v) return;
  if(state.options[type].includes(v)){ alert("이미 있는 옵션입니다."); return; }
  state.options[type].push(v); ensureStateConsistency(); invalidateTabs(); render(); scheduleSave();
}
function removeOption(type,value){
  if(!canEdit()) return;
  if(state.options[type].length<=1){ alert("최소 1개의 옵션은 남겨두어야 합니다."); return; }
  if(!confirm(`"${value}" 옵션을 삭제할까요?`)) return;
  state.options[type]=state.options[type].filter(v=>v!==value); ensureStateConsistency(); invalidateTabs(); render(); scheduleSave();
}
function moveOption(type,index,dir){
  if(!canEdit()) return;
  const arr=state.options[type]; const ni=index+dir;
  if(ni<0||ni>=arr.length) return;
  [arr[index],arr[ni]]=[arr[ni],arr[index]]; invalidateTabs(); render(); scheduleSave();
}

// ================================================================
// SECTION 12 · State Mutations — Rows
// ================================================================
function getRowById(grade,rowId){ return (state.gradeBoards[grade]||[]).find(r=>r.id===rowId)||null; }
function updateRowField(grade,rowId,field,value){
  if(!canEdit()) return;
  const row=getRowById(grade,rowId); if(!row) return;
  row[field]=value; ensureStateConsistency(); invalidateTabs(); render(); scheduleSave();
}
function addRow(grade){
  if(!canEdit()) return;
  const rows=state.gradeBoards[grade]||[]; const last=rows[rows.length-1]||{};
  state.gradeBoards[grade].push(createRow(state.options,{category:last.category,track:last.track,group:last.group,credits:last.credits}));
  invalidateTabs(); render(); scheduleSave();
}
function deleteRow(grade,rowId){
  if(!canEdit()) return;
  if(!confirm("이 행을 삭제할까요?")) return;
  state.gradeBoards[grade]=state.gradeBoards[grade].filter(r=>r.id!==rowId);
  if(!state.gradeBoards[grade].length) state.gradeBoards[grade].push(createRow(state.options));
  invalidateTabs(); render(); scheduleSave();
}

// ================================================================
// SECTION 13 · State Mutations — Board Drag & Drop
// ================================================================
function placeTemplateTo(templateId,grade,rowId,semKey){
  if(!canEdit()) return;
  const row=getRowById(grade,rowId); if(!row) return;
  const ex=row[`${semKey}TemplateId`];
  if(ex&&ex!==templateId){
    if(!confirm(`${SEMESTER_LABELS[semKey]}에 이미 "${getTemplateCardTitle(getTemplateById(ex))}" 카드가 있습니다.\n"${getTemplateCardTitle(getTemplateById(templateId))}" 카드로 바꿀까요?`)) return;
  }
  row[`${semKey}TemplateId`]=templateId; invalidateTabs(); render(); scheduleSave();
}
function placeBothSems(templateId,grade,rowId){
  if(!canEdit()) return;
  const row=getRowById(grade,rowId); if(!row) return;
  row.sem1TemplateId=templateId; row.sem2TemplateId=templateId; invalidateTabs(); render(); scheduleSave();
}
function clearRowSem(grade,rowId,semKey){
  if(!canEdit()) return;
  const row=getRowById(grade,rowId); if(!row) return;
  row[`${semKey}TemplateId`]=null; invalidateTabs(); render(); scheduleSave();
}
function clearRowBoth(grade,rowId){
  if(!canEdit()) return;
  const row=getRowById(grade,rowId); if(!row) return;
  row.sem1TemplateId=null; row.sem2TemplateId=null; invalidateTabs(); render(); scheduleSave();
}
function movePlaced(sGrade,sRowId,sSemKey,dGrade,dRowId,dSemKey){
  if(!canEdit()) return;
  const sRow=getRowById(sGrade,sRowId); const dRow=getRowById(dGrade,dRowId);
  if(!sRow||!dRow) return;
  if(sGrade===dGrade&&sRowId===dRowId&&sSemKey===dSemKey) return;
  const mv=sRow[`${sSemKey}TemplateId`]; const re=dRow[`${dSemKey}TemplateId`];
  sRow[`${sSemKey}TemplateId`]=re; dRow[`${dSemKey}TemplateId`]=mv;
  invalidateTabs(); render(); scheduleSave();
}

// ================================================================
// SECTION 13b · State Mutations — Group Assignment (Live, no draft)
// ================================================================

/** Assign template to a group (groupId=null → remove from group) */
function assignTemplateGroup(templateId, groupId){
  if(!canEdit()) return;
  const item=state.templates.find(t=>t.id===templateId); if(!item) return;
  item.calcGroupId = groupId||null;
  ensureStateConsistency(); invalidateTabs();
  renderTemplates();
  if(activeMainView==="groups") renderGroupManager();
  scheduleSave();
}

/** Add a new group directly to state */
function addLiveTemplateGroup(){
  if(!canEdit()) return;
  if(!state.templateGroups) state.templateGroups=[];
  state.templateGroups.push(normalizeTemplateGroup({ id:uid("grp"), name:`그룹 ${state.templateGroups.length+1}`, creditValue:"" }));
  ensureStateConsistency();
  renderTemplates(); renderGroupManager(); scheduleSave();
}

/** Rename a live group */
function renameLiveTemplateGroup(groupId,newName){
  if(!canEdit()) return;
  const g=state.templateGroups.find(g=>g.id===groupId); if(!g) return;
  g.name=newName; ensureStateConsistency(); renderTemplates(); scheduleSave();
}

/** Delete a live group */
function deleteLiveTemplateGroup(groupId){
  if(!canEdit()) return;
  if(!confirm("이 그룹을 삭제할까요? 소속 카드는 미배정으로 돌아갑니다.")) return;
  state.templateGroups=(state.templateGroups||[]).filter(g=>g.id!==groupId);
  state.templates.forEach(t=>{ if(t.calcGroupId===groupId) t.calcGroupId=null; });
  ensureStateConsistency(); invalidateTabs(); renderTemplates(); renderGroupManager(); scheduleSave();
}

// ================================================================
// SECTION 14 · Template Form Logic
// ================================================================
function populateSemesterFieldsFromCommon(force=false){
  const ko=clean(templateNameKo.value), en=clean(templateNameEn.value), te=clean(templateTeacher.value);
  [[templateSem1NameKo,ko],[templateSem1NameEn,en],[templateSem1Teacher,te],
   [templateSem2NameKo,ko],[templateSem2NameEn,en],[templateSem2Teacher,te]
  ].forEach(([inp,val])=>{ if(force||!clean(inp.value)) inp.value=val; });
}
function toggleSemesterMode(){ semesterTemplateFields.classList.toggle("hidden",!templateSeparateSemesters.checked); }
function setLevelPickerActive(level){
  templateFormSchoolLevel=level;
  if(templateSchoolLevelPicker){
    templateSchoolLevelPicker.querySelectorAll(".level-btn").forEach(b=>{
      b.classList.toggle("active", b.dataset.level===level);
    });
  }
}

function resetTemplateForm(){
  templateEditId=null; templateNameKo.value=""; templateNameEn.value=""; templateTeacher.value="";
  templateLanguage.value="Korean"; templateSeparateSemesters.checked=false;
  setLevelPickerActive("공통");
  [templateSem1NameKo,templateSem1NameEn,templateSem1Teacher,templateSem2NameKo,templateSem2NameEn,templateSem2Teacher].forEach(i=>{ i.value=""; });
  templateSubmitBtn.textContent="카드 추가"; templateCancelBtn.classList.add("hidden"); toggleSemesterMode();
}
function submitTemplate(){
  if(!canEdit()) return;
  const useSep=templateSeparateSemesters.checked;
  const data=normalizeTemplate({
    id:templateEditId||uid("tpl"), language:templateLanguage.value, useSemesterOverrides:useSep,
    schoolLevel:templateFormSchoolLevel,
    nameKo:templateNameKo.value, nameEn:templateNameEn.value, teacher:templateTeacher.value,
    sem1NameKo:templateSem1NameKo.value, sem1NameEn:templateSem1NameEn.value, sem1Teacher:templateSem1Teacher.value,
    sem2NameKo:templateSem2NameKo.value, sem2NameEn:templateSem2NameEn.value, sem2Teacher:templateSem2Teacher.value
  });
  const hasName=clean(data.nameKo)||clean(data.nameEn);
  const hasSem =clean(data.sem1NameKo)||clean(data.sem1NameEn)||clean(data.sem2NameKo)||clean(data.sem2NameEn);
  if(!hasName&&!(useSep&&hasSem)){ alert("한글 이름 또는 영어 이름을 입력해 주세요."); return; }
  if(templateEditId){
    const prev=getTemplateById(templateEditId);
    if(prev?.calcGroupId) data.calcGroupId=prev.calcGroupId;
    state.templates=state.templates.map(t=>t.id===templateEditId?data:t);
  } else { state.templates.push(data); }
  resetTemplateManagerDraft(); resetTemplateForm(); invalidateTabs(); render(); scheduleSave();
}
function editTemplate(templateId){
  if(!canEdit()) return;
  const item=getTemplateById(templateId); if(!item) return;
  templateEditId=templateId;
  templateNameKo.value  =clean(item.nameKo)||clean(getSemesterTemplateData(item,"sem1").nameKo);
  templateNameEn.value  =clean(item.nameEn)||clean(getSemesterTemplateData(item,"sem1").nameEn);
  templateTeacher.value =getCommonTeacherCandidate(item);
  templateLanguage.value=item.language;
  templateSeparateSemesters.checked=item.useSemesterOverrides;
  templateSem1NameKo.value =getSemesterTemplateData(item,"sem1").nameKo;
  templateSem1NameEn.value =getSemesterTemplateData(item,"sem1").nameEn;
  templateSem1Teacher.value=getSemesterTemplateData(item,"sem1").teacher;
  templateSem2NameKo.value =getSemesterTemplateData(item,"sem2").nameKo;
  templateSem2NameEn.value =getSemesterTemplateData(item,"sem2").nameEn;
  templateSem2Teacher.value=getSemesterTemplateData(item,"sem2").teacher;
  setLevelPickerActive(item.schoolLevel||"공통");
  templateSubmitBtn.textContent="카드 수정 저장"; templateCancelBtn.classList.remove("hidden"); toggleSemesterMode();
}
function deleteTemplate(templateId){
  if(!canEdit()) return;
  const item=getTemplateById(templateId); if(!item) return;
  if(!confirm(`"${getTemplateCardTitle(item)}" 카드를 삭제할까요?`)) return;
  state.templates=state.templates.filter(t=>t.id!==templateId);
  GRADE_KEYS.forEach(grade=>{ state.gradeBoards[grade].forEach(row=>{ if(row.sem1TemplateId===templateId) row.sem1TemplateId=null; if(row.sem2TemplateId===templateId) row.sem2TemplateId=null; }); });
  if(templateEditId===templateId) resetTemplateForm();
  resetTemplateManagerDraft(); invalidateTabs(); render(); scheduleSave();
}

// ================================================================
// SECTION 15 · UI Helpers
// ================================================================
function setControlsDisabled(disabled){
  [templateNameKo,templateNameEn,templateTeacher,templateLanguage,
   templateSubmitBtn,templateCancelBtn,templateSeparateSemesters,
   templateSem1NameKo,templateSem1NameEn,templateSem1Teacher,
   templateSem2NameKo,templateSem2NameEn,templateSem2Teacher,
   categoryOptionInput,trackOptionInput,groupOptionInput,
   addCategoryOptionBtn,addTrackOptionBtn,addGroupOptionBtn,
   resetBoardBtn,exportXlsxBtn,
   openGroupManagerBtn,openTemplateManagerBtn,
   groupManagerBackBtn,groupManagerAddGroupBtn,
   templateManagerBackBtn,templateManagerAddRowBtn,templateManagerSaveBtn,
   templateManagerDiscardBtn,
   templateManagerSearchInput,templateManagerLanguageFilter,
   templateManagerSplitFilter,templateManagerSortSelect
  ].forEach(el=>{ if(el) el.disabled=disabled; });
}
function languageClass(lang){ return `lang-${String(lang||"both").toLowerCase()}`; }
function getCategoryColor(cat){
  const idx=state.options.category.indexOf(cat);
  return idx<0?{bg:"#f3f4f6",text:"#374151"}:CATEGORY_PALETTE[idx%CATEGORY_PALETTE.length];
}

// ================================================================
// SECTION 16 · Sidebar: Grouped Template List
// ================================================================
function createSemesterPreviewItem(item,semKey){
  const data=getSemesterTemplateData(item,semKey);
  const wrap=document.createElement("div"); wrap.className="semester-preview-item";
  const lbl=document.createElement("div"); lbl.className="semester-preview-label"; lbl.textContent=SEMESTER_LABELS[semKey];
  const nm =document.createElement("div"); nm.className ="semester-preview-name";  nm.textContent =data.nameKo||data.nameEn||"-";
  wrap.append(lbl,nm);
  if(data.nameEn&&data.nameEn!==data.nameKo){ const e=document.createElement("div"); e.className="semester-preview-en"; e.textContent=data.nameEn; wrap.appendChild(e); }
  if(data.teacher)                           { const t=document.createElement("div"); t.className="semester-preview-teacher"; t.textContent=data.teacher; wrap.appendChild(t); }
  return wrap;
}

function createTemplateCard(item){
  const card=document.createElement("div");
  card.className=`template-card compact-card ${languageClass(item.language)}`;
  card.draggable=canEdit();
  card.addEventListener("dragstart",()=>{ currentDrag={kind:"template",templateId:item.id}; card.classList.add("dragging"); });
  card.addEventListener("dragend",  ()=>{ currentDrag=null; card.classList.remove("dragging"); });

  const main=document.createElement("div"); main.className="template-main";
  const titleEl=document.createElement("div"); titleEl.className="template-name-ko"; titleEl.textContent=getTemplateCardTitle(item);
  main.appendChild(titleEl);
  // School level color badge (color only, no text label except tooltip)
  if(item.schoolLevel && item.schoolLevel!=="공통"){
    const lvBadge=document.createElement("span");
    lvBadge.className=`school-level-dot level-dot-${item.schoolLevel==="중등"?"middle":"high"}`;
    lvBadge.title=item.schoolLevel;
    main.appendChild(lvBadge);
  }

  const actions=document.createElement("div"); actions.className="template-actions compact-actions";
  const editBtn  =makeBtn("수정","edit-btn",  ()=>editTemplate(item.id));
  const deleteBtn=makeBtn("삭제","delete-btn",()=>deleteTemplate(item.id));
  editBtn.disabled=!canEdit(); deleteBtn.disabled=!canEdit();
  [editBtn,deleteBtn].forEach(b=>b.addEventListener("mousedown",e=>e.stopPropagation()));
  const teacherInfo=document.createElement("span"); teacherInfo.className="template-teacher-inline";
  teacherInfo.textContent=getTemplateTeacherSummary(item)||"-";
  actions.append(editBtn,deleteBtn,teacherInfo);

  const preview=document.createElement("div"); preview.className="template-semester-preview";
  if(isSemesterDataSame(item)){
    const single=createSemesterPreviewItem(item,"sem1"); single.style.gridColumn="1 / -1"; preview.appendChild(single);
  } else { preview.append(createSemesterPreviewItem(item,"sem1"),createSemesterPreviewItem(item,"sem2")); }

  card.append(main,actions,preview);
  card.addEventListener("click",e=>{
    if(e.target.closest("button")) return;
    const was=card.classList.contains("expanded");
    document.querySelectorAll(".template-card.expanded").forEach(el=>el.classList.remove("expanded"));
    if(!was) card.classList.add("expanded");
  });
  return card;
}

/** Renders sidebar template list grouped by calcGroupId */
function renderTemplates(){
  templateList.innerHTML="";
  const groups=state.templateGroups||[];
  // Filter by school level
  const levelFilter = t => sidebarSchoolLevel==="전체" || t.schoolLevel===sidebarSchoolLevel || t.schoolLevel==="공통";

  // ① Grouped templates
  groups.forEach(group=>{
    const members=state.templates.filter(t=>t.calcGroupId===group.id&&levelFilter(t))
      .sort((a,b)=>getTemplateCardTitle(a).localeCompare(getTemplateCardTitle(b),"ko"));
    if(!members.length) return;
    const hdr=document.createElement("div"); hdr.className="template-group-header"; hdr.textContent=group.name;
    templateList.appendChild(hdr);
    members.forEach(t=>templateList.appendChild(createTemplateCard(t)));
  });

  // ② Ungrouped templates
  const validGroupIds=new Set(groups.map(g=>g.id));
  const ungrouped=state.templates
    .filter(t=>(!t.calcGroupId||!validGroupIds.has(t.calcGroupId))&&levelFilter(t))
    .sort((a,b)=>getTemplateCardTitle(a).localeCompare(getTemplateCardTitle(b),"ko"));

  if(ungrouped.length){
    if(groups.length){
      const sep=document.createElement("div"); sep.className="template-group-header template-group-header-none"; sep.textContent="그룹 없음";
      templateList.appendChild(sep);
    }
    ungrouped.forEach(t=>templateList.appendChild(createTemplateCard(t)));
  }
}

function renderOptionChips(container,type){
  container.innerHTML="";
  state.options[type].forEach((value,index)=>{
    const chip=document.createElement("div"); chip.className="option-chip";
    const up  =makeBtn("↑","order-btn",()=>moveOption(type,index,-1));
    const down=makeBtn("↓","order-btn",()=>moveOption(type,index,1));
    const del =makeBtn("×","",()=>removeOption(type,value));
    const txt =document.createElement("span"); txt.textContent=value;
    up.disabled  =!canEdit()||index===0;
    down.disabled=!canEdit()||index===state.options[type].length-1;
    del.disabled =!canEdit();
    chip.append(up,txt,down,del); container.appendChild(chip);
  });
}

// ================================================================
// SECTION 16b · Group Manager View
// ================================================================

/** Compact draggable card shown inside group manager columns */
function createGroupManagerCard(item){
  const card=document.createElement("div");
  card.className=`group-mgr-card ${languageClass(item.language)}`;
  card.draggable=canEdit();
  card.addEventListener("dragstart",()=>{ currentDrag={kind:"template",templateId:item.id}; card.classList.add("dragging"); });
  card.addEventListener("dragend",  ()=>{ currentDrag=null; card.classList.remove("dragging"); });
  const tRow=document.createElement("div"); tRow.className="group-mgr-card-top";
  const t=document.createElement("div"); t.className="group-mgr-card-title"; t.textContent=getTemplateCardTitle(item);
  tRow.appendChild(t);
  if(item.schoolLevel&&item.schoolLevel!=="공통"){
    const dot=document.createElement("span"); dot.className=`school-level-dot level-dot-${item.schoolLevel==="중등"?"middle":"high"}`; dot.title=item.schoolLevel;
    tRow.appendChild(dot);
  }
  const s=document.createElement("div"); s.className="group-mgr-card-teacher"; s.textContent=getTemplateTeacherSummary(item);
  card.append(tRow,s); return card;
}

/** Build one group column (header + droppable body) */
function createGroupCol(colGroupId, colGroupName){
  const col=document.createElement("div");
  col.className="group-col"; if(!colGroupId) col.classList.add("group-col-unassigned");

  // Header
  const hdr=document.createElement("div"); hdr.className="group-col-header";
  if(colGroupId){
    const inp=document.createElement("input"); inp.type="text"; inp.className="group-col-name-input";
    inp.value=colGroupName; inp.disabled=!canEdit();
    inp.addEventListener("change",e=>renameLiveTemplateGroup(colGroupId,e.target.value));
    hdr.appendChild(inp);
    const del=makeBtn("삭제","group-col-del-btn",()=>deleteLiveTemplateGroup(colGroupId));
    del.disabled=!canEdit(); hdr.appendChild(del);
  } else {
    const lbl=document.createElement("span"); lbl.className="group-col-name-label"; lbl.textContent="미배정"; hdr.appendChild(lbl);
  }
  col.appendChild(hdr);

  // Body (drop zone)
  const body=document.createElement("div"); body.className="group-col-body";
  body.addEventListener("dragover",e=>{ if(!canEdit()) return; e.preventDefault(); body.classList.add("dragover"); });
  body.addEventListener("dragleave",()=>body.classList.remove("dragover"));
  body.addEventListener("drop",e=>{
    if(!canEdit()) return; e.preventDefault(); body.classList.remove("dragover");
    if(!currentDrag) return;
    if(currentDrag.kind==="template") assignTemplateGroup(currentDrag.templateId,colGroupId);
  });

  const validGroupIds=new Set((state.templateGroups||[]).map(g=>g.id));
  const gmLevelFilter = t => groupManagerSchoolLevel==="전체" || t.schoolLevel===groupManagerSchoolLevel || t.schoolLevel==="공통";
  const members=state.templates.filter(t=>
    gmLevelFilter(t)&&(colGroupId ? t.calcGroupId===colGroupId : (!t.calcGroupId||!validGroupIds.has(t.calcGroupId)))
  ).sort((a,b)=>getTemplateCardTitle(a).localeCompare(getTemplateCardTitle(b),"ko"));

  if(!members.length){
    const ph=document.createElement("div"); ph.className="group-col-placeholder"; ph.textContent="카드를 여기로 드래그";
    body.appendChild(ph);
  } else { members.forEach(item=>body.appendChild(createGroupManagerCard(item))); }

  col.appendChild(body); return col;
}

function renderGroupManager(){
  groupManagerBoard.innerHTML="";
  // Level filter bar
  const filterBar=document.createElement("div"); filterBar.className="group-level-filter-bar";
  ["전체","중등","고등"].forEach(level=>{
    const btn=document.createElement("button"); btn.type="button";
    btn.className="group-level-btn"+(groupManagerSchoolLevel===level?" active":"");
    btn.textContent=level==="전체"?"전체":level==="중등"?"📘 중등":"📗 고등";
    btn.addEventListener("click",()=>{ groupManagerSchoolLevel=level; renderGroupManager(); });
    filterBar.appendChild(btn);
  });
  groupManagerBoard.appendChild(filterBar);
  // Columns
  const colWrap=document.createElement("div"); colWrap.className="group-col-wrap";
  colWrap.appendChild(createGroupCol(null,"미배정"));
  (state.templateGroups||[]).forEach(g=>colWrap.appendChild(createGroupCol(g.id,g.name)));
  groupManagerBoard.appendChild(colWrap);
}

// ================================================================
// SECTION 17 · Board: Placed Cards
// ================================================================
function buildExpandedMeta(s1Item,s2Item){
  const meta=document.createElement("div"); meta.className="placed-meta placed-meta-hidden";
  const s1=s1Item?getSemesterTemplateData(s1Item,"sem1"):null;
  const s2=s2Item?getSemesterTemplateData(s2Item,"sem2"):null;
  uniqueOrdered([s1?.teacher,s2?.teacher].filter(Boolean)).forEach(t=>{
    const c=document.createElement("span"); c.className="meta-chip"; c.textContent=t; meta.appendChild(c);
  });
  return meta;
}
function attachExpandClick(card,meta){
  card.addEventListener("click",e=>{
    if(e.target.closest("button")) return;
    if(!meta.children.length) return;
    const exp=card.classList.toggle("placed-expanded");
    meta.classList.toggle("placed-meta-hidden",!exp);
    document.querySelectorAll(".placed-card.placed-expanded").forEach(o=>{ if(o!==card){ o.classList.remove("placed-expanded"); o.querySelector(".placed-meta")?.classList.add("placed-meta-hidden"); }});
  });
}
function createPlacedCard(templateId,grade,rowData,semKey){
  const item=getTemplateById(templateId); if(!item) return document.createTextNode("");
  const sem=getSemesterTemplateData(item,semKey);
  const card=document.createElement("div"); card.className=`placed-card ${languageClass(sem.language)}`; card.draggable=canEdit();
  card.addEventListener("dragstart",()=>{ currentDrag={kind:"placed",sourceGrade:grade,sourceRowId:rowData.id,sourceSemKey:semKey,templateId}; card.classList.add("dragging"); });
  card.addEventListener("dragend",  ()=>{ currentDrag=null; card.classList.remove("dragging"); });
  const top=document.createElement("div"); top.className="placed-top";
  const tw=document.createElement("div"); tw.className="placed-title-wrap";
  const ko=document.createElement("div"); ko.className="placed-title-ko"; ko.textContent=sem.nameKo||sem.nameEn||"-";
  const en=document.createElement("div"); en.className="placed-title-en"; en.textContent=sem.nameEn||"-";
  tw.append(ko,en); top.appendChild(tw);
  if(canEdit()){
    const cb=makeBtn("×","clear-cell-btn",e=>{ e.stopPropagation(); clearRowSem(grade,rowData.id,semKey); });
    cb.title="과목 제거"; cb.addEventListener("mousedown",e=>e.stopPropagation()); top.appendChild(cb);
  }
  const oth=semKey==="sem1"?rowData.sem2TemplateId:rowData.sem1TemplateId;
  const othItem=oth?getTemplateById(oth):null;
  const meta=buildExpandedMeta(semKey==="sem1"?item:othItem, semKey==="sem2"?item:othItem);
  card.append(top,meta); attachExpandClick(card,meta); return card;
}
function createMergedPlacedCard(templateId,grade,rowData){
  const item=getTemplateById(templateId); if(!item) return document.createTextNode("");
  const sd=getSemesterTemplateData(item,"sem1");
  const card=document.createElement("div"); card.className=`placed-card placed-card-merged ${languageClass(sd.language)}`; card.draggable=canEdit();
  card.addEventListener("dragstart",()=>{ currentDrag={kind:"placed",sourceGrade:grade,sourceRowId:rowData.id,sourceSemKey:"merged",templateId}; card.classList.add("dragging"); });
  card.addEventListener("dragend",  ()=>{ currentDrag=null; card.classList.remove("dragging"); });
  const top=document.createElement("div"); top.className="placed-top";
  const tw=document.createElement("div"); tw.className="placed-title-wrap";
  const ko=document.createElement("div"); ko.className="placed-title-ko"; ko.textContent=sd.nameKo||sd.nameEn||"-";
  const en=document.createElement("div"); en.className="placed-title-en"; en.textContent=sd.nameEn||"-";
  tw.append(ko,en); top.appendChild(tw);
  if(canEdit()){
    const cb=makeBtn("×","clear-cell-btn",e=>{ e.stopPropagation(); clearRowBoth(grade,rowData.id); });
    cb.title="과목 제거"; cb.addEventListener("mousedown",e=>e.stopPropagation()); top.appendChild(cb);
  }
  const meta=buildExpandedMeta(item,item); card.append(top,meta); attachExpandClick(card,meta); return card;
}

// ================================================================
// SECTION 18 · Board: Drop Cells
// ================================================================
function createDropCell(grade,rowData,semKey,templateId){
  const cell=document.createElement("div"); cell.className=templateId?"drop-cell":"drop-cell empty";
  if(templateId) cell.appendChild(createPlacedCard(templateId,grade,rowData,semKey));
  cell.addEventListener("dragover",e=>{ if(!canEdit()) return; e.preventDefault(); cell.classList.add("dragover"); });
  cell.addEventListener("dragleave",()=>cell.classList.remove("dragover"));
  cell.addEventListener("drop",e=>{
    if(!canEdit()) return; e.preventDefault(); cell.classList.remove("dragover"); if(!currentDrag) return;
    if(currentDrag.kind==="template"){ placeBothSems(currentDrag.templateId,grade,rowData.id); return; }
    if(currentDrag.kind==="placed"){
      if(currentDrag.sourceSemKey==="merged"){
        const mv=currentDrag.templateId; const dRow=getRowById(grade,rowData.id); const sRow=getRowById(currentDrag.sourceGrade,currentDrag.sourceRowId);
        if(dRow){ const rep=dRow[`${semKey}TemplateId`]; dRow[`${semKey}TemplateId`]=mv; if(sRow&&!(currentDrag.sourceGrade===grade&&currentDrag.sourceRowId===rowData.id)){ sRow.sem1TemplateId=rep; sRow.sem2TemplateId=rep; } invalidateTabs(); render(); scheduleSave(); }
      } else { movePlaced(currentDrag.sourceGrade,currentDrag.sourceRowId,currentDrag.sourceSemKey,grade,rowData.id,semKey); }
    }
  });
  return cell;
}
function createMergedDropCell(grade,rowData,templateId){
  const cell=document.createElement("div"); cell.className="drop-cell merged-drop-cell"; cell.style.gridColumn="4 / 6";
  cell.appendChild(createMergedPlacedCard(templateId,grade,rowData));
  cell.addEventListener("dragover",e=>{ if(!canEdit()) return; e.preventDefault(); cell.classList.add("dragover"); });
  cell.addEventListener("dragleave",()=>cell.classList.remove("dragover"));
  cell.addEventListener("drop",e=>{
    if(!canEdit()) return; e.preventDefault(); cell.classList.remove("dragover"); if(!currentDrag) return;
    if(currentDrag.kind==="template"){ placeBothSems(currentDrag.templateId,grade,rowData.id); return; }
    if(currentDrag.kind==="placed"){
      const mv=currentDrag.templateId; const dRow=getRowById(grade,rowData.id); const sRow=getRowById(currentDrag.sourceGrade,currentDrag.sourceRowId);
      if(!dRow) return;
      if(currentDrag.sourceSemKey==="merged"){ if(sRow&&!(currentDrag.sourceGrade===grade&&currentDrag.sourceRowId===rowData.id)){ const od=dRow.sem1TemplateId; dRow.sem1TemplateId=mv; dRow.sem2TemplateId=mv; sRow.sem1TemplateId=od; sRow.sem2TemplateId=od; invalidateTabs(); render(); scheduleSave(); }}
      else { dRow.sem1TemplateId=mv; dRow.sem2TemplateId=mv; if(sRow) sRow[`${currentDrag.sourceSemKey}TemplateId`]=null; invalidateTabs(); render(); scheduleSave(); }
    }
  });
  return cell;
}

// ================================================================
// SECTION 19 · Board: Rows, Headers, Summary
// ================================================================
function createSelect(options,cur,onChange){
  const sel=document.createElement("select"); sel.className="row-select"; sel.disabled=!canEdit();
  options.forEach(v=>{ const o=document.createElement("option"); o.value=v; o.textContent=v; if(v===cur) o.selected=true; sel.appendChild(o); });
  sel.addEventListener("change",e=>onChange(e.target.value)); return sel;
}
function styleCategorySelect(sel,cat){ const c=getCategoryColor(cat); sel.classList.add("category-select"); sel.style.backgroundColor=c.bg; sel.style.color=c.text; }
function shouldRenderMergedRow(r){ return !!(r?.sem1TemplateId&&r?.sem2TemplateId&&r.sem1TemplateId===r.sem2TemplateId&&isSemesterDataSame(getTemplateById(r.sem1TemplateId))); }
function createGradeRow(grade,rowData){
  const row=document.createElement("div"); row.className="grade-data-row";
  const cat=createSelect(state.options.category,rowData.category,v=>updateRowField(grade,rowData.id,"category",v));
  styleCategorySelect(cat,rowData.category); row.appendChild(cat);
  row.appendChild(createSelect(state.options.track,rowData.track,v=>updateRowField(grade,rowData.id,"track",v)));
  row.appendChild(createSelect(state.options.group,rowData.group,v=>updateRowField(grade,rowData.id,"group",v)));
  if(shouldRenderMergedRow(rowData)){ row.appendChild(createMergedDropCell(grade,rowData,rowData.sem1TemplateId)); }
  else { row.appendChild(createDropCell(grade,rowData,"sem1",rowData.sem1TemplateId)); row.appendChild(createDropCell(grade,rowData,"sem2",rowData.sem2TemplateId)); }
  const ci=document.createElement("input"); ci.className="credit-input"; ci.type="text"; ci.value=rowData.credits; ci.placeholder="0"; ci.disabled=!canEdit();
  ci.addEventListener("change",e=>updateRowField(grade,rowData.id,"credits",e.target.value)); row.appendChild(ci);
  const db=makeBtn("×","row-delete-btn",()=>deleteRow(grade,rowData.id)); db.disabled=!canEdit(); row.appendChild(db);
  return row;
}
function createSpacerGradeRow(){
  const r=document.createElement("div"); r.className="grade-data-row spacer-row";
  for(let i=0;i<7;i++){ const c=document.createElement("div"); c.className="spacer-cell"; r.appendChild(c); }
  return r;
}
function createTrackGroupDivider(track){ const d=document.createElement("div"); d.className="track-group-divider"; d.textContent=track||"구분 없음"; return d; }
function createGradeHeader(col){
  const r=document.createElement("div"); r.className="grade-header-row";
  ["범주","구분","교과군","1학기","2학기","시수",""].forEach((lbl,i)=>{
    const c=document.createElement("div"); c.className="header-cell"; c.textContent=lbl;
    if(i<6){ const h=document.createElement("div"); h.className="col-resize-handle"; c.appendChild(h); }
    r.appendChild(c);
  });
  return r;
}
function getOrderedCategoriesForGrades(grades){
  const cats=[...state.options.category];
  grades.forEach(g=>(state.gradeBoards[g]||[]).forEach(r=>{ if(r.category&&!cats.includes(r.category)) cats.push(r.category); }));
  return cats;
}
function getOrderedTracksForCategory(grades,cat){
  const tracks=[...state.options.track];
  grades.forEach(g=>(state.gradeBoards[g]||[]).filter(r=>r.category===cat).forEach(r=>{ if(r.track&&!tracks.includes(r.track)) tracks.push(r.track); }));
  return tracks;
}
const hasPlacedTemplate=r=>!!(r?.sem1TemplateId||r?.sem2TemplateId);
const parseCreditValue=v=>{ const n=Number(String(v??"").replace(/[^0-9.-]/g,"")); return Number.isFinite(n)?n:0; };
const getRepresentativeTrackCredit=rows=>rows.reduce((mx,r)=>Math.max(mx,parseCreditValue(r.credits)),0);
function getRowTemplateGroupId(row){
  const ids=uniqueOrdered([row.sem1TemplateId,row.sem2TemplateId].filter(Boolean));
  const gids=uniqueOrdered(ids.map(id=>getTemplateById(id)?.calcGroupId).filter(Boolean));
  return gids.length===1?gids[0]:null;
}
function summarizeCategoryRows(cat,rows){
  const active=(rows||[]).filter(hasPlacedTemplate);
  if(clean(cat)==="교과"){
    const cRows=active.filter(r=>clean(r.track)==="공통"); const ncRows=active.filter(r=>clean(r.track)!=="공통");
    const cgMap=new Map(); const cUng=[];
    cRows.forEach(r=>{ const gid=getRowTemplateGroupId(r); if(gid){ if(!cgMap.has(gid)) cgMap.set(gid,[]); cgMap.get(gid).push(r); } else cUng.push(r); });
    const gtMap=new Map(); ncRows.forEach(r=>{ const k=clean(r.track)||r.id; if(!gtMap.has(k)) gtMap.set(k,[]); gtMap.get(k).push(r); });
    const totalCourses=cUng.length+cgMap.size+gtMap.size;
    const cc=cUng.reduce((s,r)=>s+parseCreditValue(r.credits),0);
    const cgc=Array.from(cgMap.entries()).reduce((s,[gid,grs])=>{ const g=getTemplateGroupById(gid); return s+(clean(g?.creditValue)?parseCreditValue(g.creditValue):getRepresentativeTrackCredit(grs)); },0);
    const gtc=Array.from(gtMap.values()).reduce((s,grs)=>{ const tgids=uniqueOrdered(grs.map(getRowTemplateGroupId).filter(Boolean)); if(tgids.length===1){ const g=getTemplateGroupById(tgids[0]); return s+(clean(g?.creditValue)?parseCreditValue(g.creditValue):getRepresentativeTrackCredit(grs)); } return s+getRepresentativeTrackCredit(grs); },0);
    return { totalCourses, totalCredits:cc+cgc+gtc };
  }
  return { totalCourses:active.length, totalCredits:active.length };
}
function getCategorySummary(grade,cat){ return summarizeCategoryRows(cat,(state.gradeBoards[grade]||[]).filter(r=>r.category===cat)); }
function getGradeSummary(grade){
  return [...state.options.category].reduce((acc,cat)=>{ const s=getCategorySummary(grade,cat); acc.totalCourses+=s.totalCourses; acc.totalCredits+=s.totalCredits; return acc; },{totalCourses:0,totalCredits:0});
}
function createCategorySummaryRow(grade,cat){
  const s=getCategorySummary(grade,cat);
  const row=document.createElement("div"); row.className="category-summary-row";
  const lbl=document.createElement("div"); lbl.className="category-summary-label"; lbl.textContent=`${cat} 합계`;
  const crs=document.createElement("div"); crs.className="category-summary-value"; crs.textContent=`Total #Courses ${s.totalCourses}`;
  const crd=document.createElement("div"); crd.className="category-summary-value"; crd.textContent=`Total #Credits ${s.totalCredits}`;
  row.append(lbl,crs,crd); return row;
}

// ================================================================
// SECTION 20 · Board: Build & Render with Tab Cache
// ================================================================
function buildTabBoard(visibleGrades){
  const columns=[];
  visibleGrades.forEach(grade=>{
    const col=document.createElement("section"); col.className="grade-column";
    const gs=getGradeSummary(grade);
    const titleEl=document.createElement("div"); titleEl.className="grade-title";
    titleEl.innerHTML=`
      <div class="grade-title-top">
        <span class="grade-title-name">${grade}</span>
        <div class="grade-title-totals">
          <span class="grade-title-badge">Total #Courses ${gs.totalCourses}</span>
          <span class="grade-title-badge">Total #Credits ${gs.totalCredits}</span>
        </div>
      </div>
      <div class="grade-subtitle">Category / Semester / Credits</div>`;
    col.appendChild(titleEl);
    const hr=createGradeHeader(col); col.appendChild(hr);
    columns.push({grade,column:col,headerRow:hr});
  });

  const cats=getOrderedCategoriesForGrades(visibleGrades);
  const cbg=Object.fromEntries(columns.map(c=>[c.grade,c]));

  cats.forEach(cat=>{
    const hasAny=visibleGrades.some(g=>(state.gradeBoards[g]||[]).some(r=>r.category===cat)); if(!hasAny) return;
    getOrderedTracksForCategory(visibleGrades,cat).forEach(track=>{
      const rbg={}; let maxRows=0;
      visibleGrades.forEach(g=>{ const rs=(state.gradeBoards[g]||[]).filter(r=>r.category===cat&&r.track===track); rbg[g]=rs; maxRows=Math.max(maxRows,rs.length); });
      if(!maxRows) return;
      visibleGrades.forEach(g=>cbg[g].column.appendChild(createTrackGroupDivider(track)));
      for(let i=0;i<maxRows;i++) visibleGrades.forEach(g=>{ const rd=rbg[g][i]; cbg[g].column.appendChild(rd?createGradeRow(g,rd):createSpacerGradeRow()); });
    });
    visibleGrades.forEach(g=>cbg[g].column.appendChild(createCategorySummaryRow(g,cat)));
  });

  columns.forEach(({grade,column,headerRow})=>{
    const footer=document.createElement("div"); footer.className="grade-footer";
    const addBtn=makeBtn(`${grade} 행 추가`,"add-row-btn",()=>addRow(grade));
    addBtn.disabled=!canEdit(); footer.appendChild(addBtn); column.appendChild(footer);
    initColResize(column,headerRow,grade);
  });

  return columns.map(c=>c.column);
}

function renderTabs(){ tab7to9Btn.classList.toggle("active",activeTab==="tab7to9"); tab10to12Btn.classList.toggle("active",activeTab==="tab10to12"); }
function renderGradeBoard(){
  const tab=activeTab;
  if(!dirtyTabs.has(tab)&&tabBoardCache[tab]){ gradeBoard.innerHTML=""; tabBoardCache[tab].forEach(el=>gradeBoard.appendChild(el)); return; }
  const els=buildTabBoard(GRADE_GROUPS[tab]); gradeBoard.innerHTML=""; els.forEach(el=>gradeBoard.appendChild(el)); tabBoardCache[tab]=els; dirtyTabs.delete(tab);
}

function render(){
  ensureStateConsistency();
  renderTemplates();
  renderOptionChips(categoryOptionList,"category");
  renderOptionChips(trackOptionList,"track");
  renderOptionChips(groupOptionList,"group");
  renderTabs();
  renderGradeBoard();

  boardView.classList.toggle("hidden",          activeMainView!=="board");
  groupManagerView.classList.toggle("hidden",   activeMainView!=="groups");
  templateManagerView.classList.toggle("hidden",activeMainView!=="manager");
  if(studentMgmtView) studentMgmtView.classList.toggle("hidden", activeMainView!=="students");

  openGroupManagerBtn.textContent   =activeMainView==="groups"  ?"보드 보기":"그룹 관리";
  openTemplateManagerBtn.textContent=activeMainView==="manager" ?"보드 보기":"표 편집";
  if(openStudentMgmtBtn) openStudentMgmtBtn.classList.toggle("active", activeMainView==="students");

  if(activeMainView==="groups")   renderGroupManager();
  if(activeMainView==="manager")  renderTemplateManager();
  if(activeMainView==="students") renderClassList();

  setControlsDisabled(!canEdit());
  toggleSemesterMode();
}

// ================================================================
// SECTION 21 · Template Manager (Table View)
// ================================================================
function getTemplateManagerFilteredRows(){
  const draft=ensureTemplateManagerDraft();
  const srch=clean(templateManagerUi.search).toLowerCase();
  const filtered=draft.templates.filter(item=>{
    if(templateManagerUi.language!=="all"&&item.language!==templateManagerUi.language) return false;
    if(templateManagerUi.split==="split"&&!item.useSemesterOverrides) return false;
    if(templateManagerUi.split==="same" &&item.useSemesterOverrides)  return false;
    if(templateManagerUi.level!=="전체"&&item.schoolLevel!==templateManagerUi.level) return false;
    if(srch){ const h=[item.nameKo,item.nameEn,item.teacher,item.sem1NameKo,item.sem1NameEn,item.sem1Teacher,item.sem2NameKo,item.sem2NameEn,item.sem2Teacher].join(" ").toLowerCase(); if(!h.includes(srch)) return false; }
    return true;
  });
  const sv=(item,k)=>clean(k==="en"?(item.nameEn||item.sem1NameEn||item.nameKo):(item.nameKo||item.sem1NameKo||item.nameEn));
  filtered.sort((a,b)=>{
    switch(templateManagerUi.sort){
      case "ko-desc": return sv(b,"ko").localeCompare(sv(a,"ko"),"ko");
      case "en-asc":  return sv(a,"en").localeCompare(sv(b,"en"),"en");
      case "language": return `${a.language}-${sv(a,"ko")}`.localeCompare(`${b.language}-${sv(b,"ko")}`,"ko");
      case "group": { const ga=getTemplateGroupById(a.calcGroupId,draft)?.name||""; const gb=getTemplateGroupById(b.calcGroupId,draft)?.name||""; return `${ga}-${sv(a,"ko")}`.localeCompare(`${gb}-${sv(b,"ko")}`,"ko"); }
      default: return sv(a,"ko").localeCompare(sv(b,"ko"),"ko");
    }
  });
  return filtered;
}

function renderTemplateManagerTable(){
  const draft=ensureTemplateManagerDraft();
  const rows=getTemplateManagerFilteredRows();
  templateManagerCount.textContent=`${rows.length} / ${draft.templates.length}개 표시`;
  if(!rows.length){ templateManagerTableWrap.innerHTML='<div class="manager-empty">검색 조건에 맞는 과목카드가 없습니다.</div>'; return; }

  const buildGroupOpts=(selId)=>['<option value="">없음</option>']
    .concat(draft.templateGroups.map(g=>`<option value="${escapeHtml(g.id)}" ${selId===g.id?"selected":""}>${escapeHtml(g.name)}</option>`)).join("");

  // Applied grades — from LIVE state (not draft)
  const bodyRows=rows.map(item=>{
    const grades=getTemplateAppliedGrades(item.id);
    const gradeChips=grades.length
      ?grades.map(g=>`<span class="usage-chip">${g}</span>`).join("")
      :'<span style="color:#9ca3af;font-size:10px">-</span>';
    return `<tr data-template-id="${item.id}">
      <td class="col-delete"><button type="button" class="row-delete-btn-inline" data-action="delete-template">삭제</button></td>
      <td class="col-usage usage-cell">${gradeChips}</td>
      <td class="col-schoollevel">
        <select data-field="schoolLevel">
          ${["중등","고등","공통"].map(l=>`<option value="${l}" ${item.schoolLevel===l?"selected":""}>${l}</option>`).join("")}
        </select>
      </td>
      <td><input type="text" data-field="nameKo" value="${escapeHtml(item.nameKo)}" /></td>
      <td><input type="text" data-field="nameEn" value="${escapeHtml(item.nameEn)}" /></td>
      <td><input type="text" data-field="teacher" value="${escapeHtml(item.teacher)}" /></td>
      <td class="col-language"><select data-field="language">${["Korean","English","Both"].map(l=>`<option value="${l}" ${item.language===l?"selected":""}>${l}</option>`).join("")}</select></td>
      <td class="col-group"><select data-field="calcGroupId">${buildGroupOpts(item.calcGroupId||"")}</select></td>
      <td class="col-toggle toggle-cell"><input type="checkbox" data-field="useSemesterOverrides" ${item.useSemesterOverrides?"checked":""} /></td>
      <td><input type="text" data-field="sem1NameKo" value="${escapeHtml(item.sem1NameKo)}" /></td>
      <td><input type="text" data-field="sem1NameEn" value="${escapeHtml(item.sem1NameEn)}" /></td>
      <td><input type="text" data-field="sem1Teacher" value="${escapeHtml(item.sem1Teacher)}" /></td>
      <td><input type="text" data-field="sem2NameKo" value="${escapeHtml(item.sem2NameKo)}" /></td>
      <td><input type="text" data-field="sem2NameEn" value="${escapeHtml(item.sem2NameEn)}" /></td>
      <td><input type="text" data-field="sem2Teacher" value="${escapeHtml(item.sem2Teacher)}" /></td>
    </tr>`;
  }).join("");

  templateManagerTableWrap.innerHTML=`
    <table class="manager-table">
      <thead><tr>
        <th class="col-delete">삭제</th>
        <th class="col-usage">적용 학년</th>
        <th class="col-schoollevel">구분</th>
        <th>한글 이름</th><th>영어 이름</th><th>공통 교사</th>
        <th class="col-language">언어</th>
        <th class="col-group">계산 그룹</th>
        <th class="col-toggle">학기 분리</th>
        <th>1학기 한글</th><th>1학기 영어</th><th>1학기 교사</th>
        <th>2학기 한글</th><th>2학기 영어</th><th>2학기 교사</th>
      </tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>`;
}


function renderTemplateManager(){ ensureTemplateManagerDraft(); renderTemplateManagerTable(); }

function addTemplateManagerRow(){ if(!canEdit()) return; const d=ensureTemplateManagerDraft(); d.templates.unshift(normalizeTemplate({id:uid("tpl"),language:"Both"})); renderTemplateManager(); }
function saveTemplateManagerDraftLocally(){
  const d=ensureTemplateManagerDraft(); const vgids=new Set(d.templateGroups.map(g=>g.id));
  d.templates=d.templates.map(item=>{ const n=normalizeTemplate(item); if(n.calcGroupId&&!vgids.has(n.calcGroupId)) n.calcGroupId=null; return n; });
  d.templateGroups=d.templateGroups.map(normalizeTemplateGroup);
}
async function commitTemplateManagerDraft(){
  if(!canEdit()) return; saveTemplateManagerDraftLocally();
  state.templates     =ensureTemplateManagerDraft().templates.map(t=>normalizeTemplate(cloneJson(t)));
  state.templateGroups=ensureTemplateManagerDraft().templateGroups.map(g=>normalizeTemplateGroup(cloneJson(g)));
  if(templateEditId){ const ed=getTemplateById(templateEditId); if(ed) editTemplate(templateEditId); else resetTemplateForm(); }
  invalidateTabs(); render(); await saveNow();
}

// ================================================================
// SECTION 22 · Excel Export
// ================================================================
function exportXLSX(){
  const wb=XLSX.utils.book_new(); const grades=GRADE_GROUPS[activeTab];
  const rows=[["학년","범주","구분","교과군","1학기(한글)","1학기(영어)","1학기(교사)","2학기(한글)","2학기(영어)","2학기(교사)","시수"]];
  grades.forEach(grade=>{
    (state.gradeBoards[grade]||[]).forEach(row=>{
      const t1=row.sem1TemplateId?getTemplateById(row.sem1TemplateId):null;
      const t2=row.sem2TemplateId?getTemplateById(row.sem2TemplateId):null;
      const s1=t1?getSemesterTemplateData(t1,"sem1"):{nameKo:"",nameEn:"",teacher:""};
      const s2=t2?getSemesterTemplateData(t2,"sem2"):{nameKo:"",nameEn:"",teacher:""};
      rows.push([grade,row.category,row.track,row.group,s1.nameKo||"",s1.nameEn||"",s1.teacher||"",s2.nameKo||"",s2.nameEn||"",s2.teacher||"",row.credits||""]);
    });
  });
  const ws=XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"]=[10,8,10,12,18,22,14,18,22,14,6].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb,ws,activeTab==="tab7to9"?"7-9학년":"10-12학년");
  XLSX.writeFile(wb,"HIS_Curriculum.xlsx");
}

// ================================================================
// SECTION 23 · Event Listeners
// ================================================================
loginBtn.addEventListener("click",login);
logoutBtn.addEventListener("click",logout);
exportXlsxBtn.addEventListener("click",exportXLSX);
resetBoardBtn.addEventListener("click",async()=>{
  if(!canEdit()) return;
  if(!confirm("공용 보드를 기본 상태로 초기화할까요?")) return;
  state=createDefaultState(); resetTemplateManagerDraft(); resetTemplateForm(); invalidateTabs(); render(); await saveNow();
});

tab7to9Btn.addEventListener("click",()=>{ if(activeTab==="tab7to9") return; activeTab="tab7to9"; renderTabs(); renderGradeBoard(); });
tab10to12Btn.addEventListener("click",()=>{ if(activeTab==="tab10to12") return; activeTab="tab10to12"; renderTabs(); renderGradeBoard(); });

// View nav
openGroupManagerBtn.addEventListener("click",   ()=>{ activeMainView==="groups"  ?closeToBoard():openGroupManager(); });
openTemplateManagerBtn.addEventListener("click", ()=>{ activeMainView==="manager" ?closeToBoard():openTemplateManager(); });
groupManagerBackBtn.addEventListener("click",    closeToBoard);
templateManagerBackBtn.addEventListener("click", closeToBoard);

// Group manager actions
groupManagerAddGroupBtn.addEventListener("click", addLiveTemplateGroup);

// Template form
templateSubmitBtn.addEventListener("click",submitTemplate);
templateCancelBtn.addEventListener("click",resetTemplateForm);
templateSeparateSemesters.addEventListener("change",()=>{
  if(templateSeparateSemesters.checked){
    const hasData=[templateSem1NameKo,templateSem1NameEn,templateSem1Teacher,templateSem2NameKo,templateSem2NameEn,templateSem2Teacher].some(inp=>clean(inp.value));
    if(!hasData) populateSemesterFieldsFromCommon(true);
  }
  toggleSemesterMode();
});
[templateNameKo,templateNameEn,templateTeacher].forEach(inp=>inp.addEventListener("keydown",e=>{ if(e.key==="Enter") submitTemplate(); }));
[templateSem1NameKo,templateSem1NameEn,templateSem1Teacher,templateSem2NameKo,templateSem2NameEn,templateSem2Teacher].forEach(inp=>inp.addEventListener("keydown",e=>{ if(e.key==="Enter") submitTemplate(); }));

// Options
addCategoryOptionBtn.addEventListener("click",()=>{ addOption("category",categoryOptionInput.value); categoryOptionInput.value=""; categoryOptionInput.focus(); });
addTrackOptionBtn.addEventListener("click",   ()=>{ addOption("track",   trackOptionInput.value);    trackOptionInput.value="";    trackOptionInput.focus(); });
addGroupOptionBtn.addEventListener("click",   ()=>{ addOption("group",   groupOptionInput.value);    groupOptionInput.value="";    groupOptionInput.focus(); });
[[categoryOptionInput,addCategoryOptionBtn],[trackOptionInput,addTrackOptionBtn],[groupOptionInput,addGroupOptionBtn]].forEach(([inp,btn])=>inp.addEventListener("keydown",e=>{ if(e.key==="Enter") btn.click(); }));

// Template manager
templateManagerAddRowBtn.addEventListener("click",addTemplateManagerRow);
templateManagerDiscardBtn.addEventListener("click",()=>{ if(!canEdit()) return; if(!confirm("변경 내용을 취소할까요?")) return; resetTemplateManagerDraft(); renderTemplateManager(); });
templateManagerSaveBtn.addEventListener("click",commitTemplateManagerDraft);
templateManagerSearchInput.addEventListener("input",   e=>{ templateManagerUi.search=e.target.value; renderTemplateManager(); });
templateManagerLanguageFilter.addEventListener("change",e=>{ templateManagerUi.language=e.target.value; renderTemplateManager(); });
templateManagerSplitFilter.addEventListener("change",  e=>{ templateManagerUi.split=e.target.value; renderTemplateManager(); });
templateManagerSortSelect.addEventListener("change",   e=>{ templateManagerUi.sort=e.target.value; renderTemplateManager(); });
templateManagerLevelFilter.addEventListener("change",  e=>{ templateManagerUi.level=e.target.value; renderTemplateManager(); });
sidebarSchoolLevelFilter.addEventListener("change",    e=>{ sidebarSchoolLevel=e.target.value; renderTemplates(); });
// School level picker buttons in form
if(templateSchoolLevelPicker){
  templateSchoolLevelPicker.addEventListener("click", e=>{
    const btn=e.target.closest(".level-btn"); if(!btn) return;
    setLevelPickerActive(btn.dataset.level);
  });
}

templateManagerTableWrap.addEventListener("input",e=>{
  const row=e.target.closest("tr[data-template-id]"); if(!row) return;
  const d=ensureTemplateManagerDraft(); const item=d.templates.find(t=>t.id===row.dataset.templateId); if(!item) return;
  const f=e.target.dataset.field; if(!f) return; item[f]=e.target.type==="checkbox"?e.target.checked:e.target.value;
});
templateManagerTableWrap.addEventListener("change",e=>{
  const row=e.target.closest("tr[data-template-id]"); if(!row) return;
  const d=ensureTemplateManagerDraft(); const item=d.templates.find(t=>t.id===row.dataset.templateId); if(!item) return;
  const f=e.target.dataset.field; if(!f) return; item[f]=e.target.type==="checkbox"?e.target.checked:e.target.value;
  if(["language","calcGroupId","useSemesterOverrides","schoolLevel"].includes(f)) renderTemplateManager();
});
templateManagerTableWrap.addEventListener("click",e=>{
  const btn=e.target.closest("button[data-action='delete-template']"); if(!btn) return;
  if(!canEdit()) return;
  const row=btn.closest("tr[data-template-id]"); if(!row) return;
  const d=ensureTemplateManagerDraft(); const tgt=d.templates.find(t=>t.id===row.dataset.templateId); if(!tgt) return;
  if(!confirm(`"${getTemplateCardTitle(tgt)}" 카드를 삭제할까요?`)) return;
  d.templates=d.templates.filter(t=>t.id!==tgt.id); renderTemplateManager();
});

// ================================================================
// SECTION 24 · Initialize
// ================================================================
render();

// ================================================================
// SECTION 25 · Student Management
// ================================================================

// ── DOM refs ──────────────────────────────────────────────────────
const openStudentMgmtBtn  = document.getElementById("openStudentMgmtBtn");
const studentMgmtView     = document.getElementById("studentMgmtView");
const classList           = document.getElementById("classList");
const addClassBtn         = document.getElementById("addClassBtn");

const studentMainEmpty    = document.getElementById("studentMainEmpty");
const studentMainContent  = document.getElementById("studentMainContent");
const classNameInput      = document.getElementById("classNameInput");
const classGradeSelect    = document.getElementById("classGradeSelect");
const deleteClassBtn      = document.getElementById("deleteClassBtn");
const studentCount        = document.getElementById("studentCount");

const excelPasteArea      = document.getElementById("excelPasteArea");
const parsePasteBtn       = document.getElementById("parsePasteBtn");
const clearPasteBtn       = document.getElementById("clearPasteBtn");

const studentTableBody    = document.getElementById("studentTableBody");
const studentTableEmpty   = document.getElementById("studentTableEmpty");
const addStudentRowBtn    = document.getElementById("addStudentRowBtn");
const exportStudentXlsxBtn= document.getElementById("exportStudentXlsxBtn");

// ── State ─────────────────────────────────────────────────────────
let studentMgmtOpen   = false;
let selectedClassId   = null;

// Ensure state has classes array
if (!state.classes) state.classes = [];

// ── Data helpers ──────────────────────────────────────────────────
function normalizeStudent(s = {}) {
  return {
    id:     s.id     || uid("stu"),
    name:   clean(s.name),
    gender: clean(s.gender),
    birth:  clean(s.birth),
    extra:  clean(s.extra)
  };
}

function normalizeClass(c = {}) {
  return {
    id:       c.id       || uid("cls"),
    grade:    GRADE_KEYS.includes(c.grade) ? c.grade : "7학년",
    name:     clean(c.name) || "새 반",
    students: Array.isArray(c.students) ? c.students.map(normalizeStudent) : []
  };
}

function getClassById(classId) {
  return (state.classes || []).find(c => c.id === classId) || null;
}

function ensureClasses() {
  if (!state.classes) state.classes = [];
}

// ── Normalise state (extend existing fn) ─────────────────────────
// Patch: keep classes on every normalizeState call
const _origNormalizeState = normalizeState;
function normalizeStateWithClasses(raw = {}) {
  const s = _origNormalizeState(raw);
  s.classes = Array.isArray(raw.classes) ? raw.classes.map(normalizeClass) : [];
  return s;
}

// Override saveNow to include classes
async function saveNowWithClasses() {
  if (!canEdit()) return;
  ensureClasses();
  // merge classes into state before save
  await setDoc(boardRef, { state, updatedAt: serverTimestamp() });
}

// ── Parse Excel paste ─────────────────────────────────────────────
function parseExcelPaste(raw) {
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const students = [];
  for (const line of lines) {
    // Try tab-separated first (Excel default), then 2+ spaces
    let cols = line.split(/\t/).map(c => c.trim());
    if (cols.length === 1) {
      // Fallback: split on 2+ consecutive spaces
      cols = line.split(/\s{2,}/).map(c => c.trim()).filter(Boolean);
    }
    if (!cols.length || !cols[0]) continue;
    const firstLower = cols[0].toLowerCase().replace(/\s/g, "");
    // Skip header rows
    if (["이름","name","학생","성명","student"].includes(firstLower)) continue;
    // Skip purely numeric rows that look like row numbers
    if (/^\d+$/.test(cols[0]) && cols.length === 1) continue;
    // If first col is a number and next is a name, shift
    let nameIdx = 0;
    if (/^\d+$/.test(cols[0]) && cols.length > 1) nameIdx = 1;
    students.push(normalizeStudent({
      name:   cols[nameIdx]   || "",
      gender: cols[nameIdx+1] || "",
      birth:  cols[nameIdx+2] || "",
      extra:  cols.slice(nameIdx+3).join(" ").trim()
    }));
  }
  return students;
}

// ── Render: class sidebar ─────────────────────────────────────────
function renderClassList() {
  classList.innerHTML = "";
  ensureClasses();
  if (!state.classes.length) {
    const empty = document.createElement("div");
    empty.className = "class-list-empty";
    empty.textContent = "반이 없습니다. '+ 반 추가'를 눌러 시작하세요.";
    classList.appendChild(empty);
    return;
  }

  // Group by grade
  const byGrade = {};
  GRADE_KEYS.forEach(g => { byGrade[g] = []; });
  state.classes.forEach(c => {
    if (!byGrade[c.grade]) byGrade[c.grade] = [];
    byGrade[c.grade].push(c);
  });

  GRADE_KEYS.forEach(grade => {
    const items = byGrade[grade] || [];
    if (!items.length) return;

    const grpHdr = document.createElement("div");
    grpHdr.className = "class-grade-header";
    grpHdr.textContent = grade;
    classList.appendChild(grpHdr);

    items.forEach(cls => {
      const item = document.createElement("div");
      item.className = "class-list-item" + (cls.id === selectedClassId ? " active" : "");
      item.dataset.classId = cls.id;

      const nameEl = document.createElement("span");
      nameEl.className = "class-item-name";
      nameEl.textContent = cls.name;

      const cnt = document.createElement("span");
      cnt.className = "class-item-count";
      cnt.textContent = `${cls.students.length}명`;

      item.append(nameEl, cnt);
      item.addEventListener("click", () => selectClass(cls.id));
      classList.appendChild(item);
    });
  });
}

// ── Render: student table ─────────────────────────────────────────
function renderStudentTable() {
  const cls = getClassById(selectedClassId);
  if (!cls) return;

  classNameInput.value   = cls.name;
  classGradeSelect.value = cls.grade;
  studentCount.textContent = cls.students.length;

  studentTableBody.innerHTML = "";
  const hasStudents = cls.students.length > 0;
  studentTableEmpty.classList.toggle("hidden", hasStudents);

  cls.students.forEach((stu, idx) => {
    const tr = document.createElement("tr");
    tr.dataset.stuId = stu.id;

    const fields = [
      { key: "name",   placeholder: "이름",   cls: "" },
      { key: "gender", placeholder: "성별",   cls: "col-gender" },
      { key: "birth",  placeholder: "생년월일", cls: "col-birth" },
      { key: "extra",  placeholder: "기타",   cls: "col-extra" }
    ];

    // Number cell
    const numTd = document.createElement("td");
    numTd.className = "col-num";
    numTd.textContent = idx + 1;
    tr.appendChild(numTd);

    fields.forEach(f => {
      const td = document.createElement("td");
      if (f.cls) td.className = f.cls;
      const inp = document.createElement("input");
      inp.type = "text";
      inp.value = stu[f.key];
      inp.placeholder = f.placeholder;
      inp.disabled = !canEdit();
      inp.addEventListener("change", e => {
        stu[f.key] = e.target.value;
        if (f.key === "name") renderClassList(); // refresh count
        scheduleSaveStudents();
      });
      td.appendChild(inp);
      tr.appendChild(td);
    });

    // Delete button
    const delTd = document.createElement("td");
    delTd.className = "col-del";
    const delBtn = makeBtn("×", "stu-del-btn", () => {
      cls.students = cls.students.filter(s => s.id !== stu.id);
      renderStudentTable();
      renderClassList();
      scheduleSaveStudents();
    });
    delBtn.disabled = !canEdit();
    delTd.appendChild(delBtn);
    tr.appendChild(delTd);

    studentTableBody.appendChild(tr);
  });
}

// ── Actions ───────────────────────────────────────────────────────
function selectClass(classId) {
  selectedClassId = classId;
  const cls = getClassById(classId);
  if (!cls) { studentMainEmpty.classList.remove("hidden"); studentMainContent.classList.add("hidden"); return; }
  studentMainEmpty.classList.add("hidden");
  studentMainContent.classList.remove("hidden");
  renderStudentTable();
  renderClassList();
}

function addNewClass() {
  if (!canEdit()) return;
  ensureClasses();
  const cls = normalizeClass({ grade: "7학년", name: `새 반 ${state.classes.length + 1}` });
  state.classes.push(cls);
  renderClassList();
  selectClass(cls.id);
  scheduleSaveStudents();
  // Focus name input
  setTimeout(() => { classNameInput.focus(); classNameInput.select(); }, 50);
}

function deleteSelectedClass() {
  if (!canEdit()) return;
  const cls = getClassById(selectedClassId);
  if (!cls) return;
  if (!confirm(`"${cls.grade} ${cls.name}" 반을 삭제할까요? 학생 명단도 함께 삭제됩니다.`)) return;
  state.classes = state.classes.filter(c => c.id !== selectedClassId);
  selectedClassId = null;
  studentMainEmpty.classList.remove("hidden");
  studentMainContent.classList.add("hidden");
  renderClassList();
  scheduleSaveStudents();
}

function applyExcelPaste() {
  const raw = excelPasteArea ? excelPasteArea.value.trim() : "";
  if (!raw) { alert("붙여넣기 영역이 비어 있습니다.\n엑셀에서 셀을 복사(Ctrl+C) 후 붙여넣기(Ctrl+V) 해주세요."); return; }
  const cls = getClassById(selectedClassId);
  if (!cls) { alert("먼저 왼쪽에서 반을 선택해 주세요."); return; }
  const parsed = parseExcelPaste(raw);
  if (!parsed.length) { alert("파싱된 학생이 없습니다.\n엑셀에서 이름이 포함된 셀을 선택 후 복사해 주세요."); return; }
  cls.students.push(...parsed);
  if (excelPasteArea) excelPasteArea.value = "";
  renderStudentTable();
  renderClassList();
  if (canEdit()) scheduleSaveStudents();
  alert(`${parsed.length}명이 추가되었습니다.`);
}

function addBlankStudent() {
  if (!canEdit()) return;
  const cls = getClassById(selectedClassId); if (!cls) return;
  cls.students.push(normalizeStudent({}));
  renderStudentTable();
  studentCount.textContent = cls.students.length;
  // Scroll to bottom and focus last name input
  setTimeout(() => {
    const rows = studentTableBody.querySelectorAll("tr");
    const last = rows[rows.length - 1];
    if (last) { last.scrollIntoView({ behavior: "smooth", block: "nearest" }); last.querySelector("input")?.focus(); }
  }, 50);
  scheduleSaveStudents();
}

function exportStudentXlsx() {
  const cls = getClassById(selectedClassId); if (!cls) return;
  const wb = XLSX.utils.book_new();
  const rows = [["번호", "이름", "성별", "생년월일", "기타"]];
  cls.students.forEach((s, i) => rows.push([i + 1, s.name, s.gender, s.birth, s.extra]));
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 6 }, { wch: 12 }, { wch: 6 }, { wch: 14 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws, `${cls.grade} ${cls.name}`);
  XLSX.writeFile(wb, `HIS_${cls.grade}_${cls.name}_명단.xlsx`);
}

// ── Save ──────────────────────────────────────────────────────────
let studentSaveTimer = null;
function scheduleSaveStudents() {
  if (!canEdit()) return;
  clearTimeout(studentSaveTimer);
  // Save immediately — no delay to prevent Firestore snapshot overwriting in-memory changes
  studentSaveTimer = setTimeout(async () => {
    try {
      await setDoc(boardRef, { state, updatedAt: serverTimestamp() });
    } catch(e) {
      console.error("Student save failed:", e);
    }
  }, 200);
}

// ── View toggle ───────────────────────────────────────────────────
function openStudentMgmt() {
  activeMainView = "students";
  studentMgmtOpen = true;
  openStudentMgmtBtn.classList.add("active");
  ensureClasses();
  render();  // render() now handles all view switching including students
  renderClassList();
}

function closeStudentMgmt() {
  studentMgmtOpen = false;
  activeMainView = "board";
  openStudentMgmtBtn.classList.remove("active");
  render();
}

// render() override removed — handled directly in open/close functions

// ── Event listeners ───────────────────────────────────────────────
openStudentMgmtBtn.addEventListener("click", () => {
  studentMgmtOpen ? closeStudentMgmt() : openStudentMgmt();
});

addClassBtn.addEventListener("click", addNewClass);
deleteClassBtn.addEventListener("click", deleteSelectedClass);

classNameInput.addEventListener("change", e => {
  const cls = getClassById(selectedClassId); if (!cls) return;
  cls.name = e.target.value;
  renderClassList();
  scheduleSaveStudents();
});

classGradeSelect.addEventListener("change", e => {
  const cls = getClassById(selectedClassId); if (!cls) return;
  cls.grade = e.target.value;
  renderClassList();
  scheduleSaveStudents();
});

parsePasteBtn.addEventListener("click", applyExcelPaste);
clearPasteBtn.addEventListener("click", () => { excelPasteArea.value = ""; });
addStudentRowBtn.addEventListener("click", addBlankStudent);
exportStudentXlsxBtn.addEventListener("click", exportStudentXlsx);

// ── Also load classes on Firestore snapshot ───────────────────────
// Patch subscribeBoard to restore classes after snapshot
const _origSubscribeBoard = subscribeBoard;
