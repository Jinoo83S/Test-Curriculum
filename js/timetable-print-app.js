import { login, logout, onAuth } from "./auth.js?v=1.0.0-20260724.1";
import { appState, subscribeDomains, setOnUpdate, initialLoad } from "./state.js?v=1.0.0-20260724.1";
import { LOCAL_DEV_MODE } from "./local-dev.js?v=1.0.0-20260724.1";
import { auth, db } from "./config.js?v=1.0.0-20260724.1";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  buildPrintTemplateMap,
  normalizePrintSemester,
  printSemesterLabel,
  resolveSemesterCardValues,
  resolveSemesterEntryValues,
} from "./timetable-print-semester.js?v=1.0.0-20260724.1";
import { downloadBlobFile, downloadTextFile, safeFilePart } from "./timetable-print-file-utils.js?v=1.0.0-20260724.1";
import { officeXmlEsc as xmlEsc } from "./timetable-print-archive.js?v=1.0.0-20260724.1";
import { createDocxBuilder } from "./timetable-print-word.js?v=1.0.0-20260724.1";
import { buildXlsxDatabaseBlob } from "./timetable-print-excel.js?v=1.0.0-20260724.1";
import { createPdfExporter } from "./timetable-print-pdf.js?v=1.0.0-20260724.1";
import {
  allocateProportionalHeights,
  card3x3Dimensions,
  cardGridDimensions,
  docxCellSize,
  wordSpanWidth,
  wordTableWidths as computeWordTableWidths,
} from "./timetable-print-word-layout.js?v=1.0.0-20260724.1";

const VERSION = "1.0.0-20260724.1";
const SOURCE_PRINT_RUNTIME = "r368";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const FIELD_DEFS = [
  { key:"subject", label:"과목", pos:"mc", bold:true, enabled:true },
  { key:"english", label:"영문명", pos:"bc", bold:false, enabled:true },
  { key:"teacher", label:"교사", pos:"bl", bold:false, enabled:true },
  { key:"room", label:"교실", pos:"br", bold:true, enabled:true },
  { key:"class", label:"반", pos:"tl", bold:false, enabled:false },
];
const POSITIONS = [["tl","↖"],["tc","↑"],["tr","↗"],["ml","←"],["mc","●"],["mr","→"],["bl","↙"],["bc","↓"],["br","↘"]];
const FIELD_FONT_OPTIONS = [["xsmall","아주 작게"],["small","작게"],["normal","기본"],["large","크게"]];
const FIELD_FONT_SCALE = { xsmall:0.72, small:0.86, normal:1, large:1.18 };
const FIELD_FONT_PX_DEFAULTS = { subject:10, english:7.2, teacher:8.4, room:8.4, class:7.5 };
const FIELD_FONT_PRESET_VALUES = {
  xsmall:{ subject:7, english:5.2, teacher:5.8, room:5.8, class:5.4 },
  small:{ subject:8.4, english:6.2, teacher:7.0, room:7.0, class:6.4 },
  normal:{ subject:10, english:7.2, teacher:8.4, room:8.4, class:7.5 },
  large:{ subject:12, english:8.6, teacher:9.8, room:9.8, class:8.8 }
};
function fontValueToPx(value, key="subject") {
  const raw = clean(value);
  if (!raw) return "";
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.max(3, Math.min(24, n));
  const named = { xsmall:7, small:8, normal:FIELD_FONT_PX_DEFAULTS[key] || 9, large:11 };
  return named[raw] || "";
}

const SPLIT_DEFAULTS = {
  // r341: 자르기는 분할별 숨은 값이 아니라 하나의 공통 옵션으로만 관리합니다.
  "1": { font: "normal", layout: "standard", clip: false },
  "2": { font: "small", layout: "compact", clip: false },
  "3": { font: "xsmall", layout: "simple", clip: false },
  "4": { font: "xsmall", layout: "simple", clip: false }
};
const SPLIT_FONT = {
  xsmall: { px: 7.8, print: 5.8 },
  small: { px: 8.8, print: 6.5 },
  normal: { px: 10.0, print: 7.4 },
  large: { px: 11.4, print: 8.4 },
  custom: { px: 10.0, print: 7.4 }
};
const STORE_KEY = "his_print_designer_profiles_v2";
const LAST_KEY = "his_print_designer_last_profile_v2";
const LAST_SEMESTER_KEY = "his_print_designer_last_semester_v1";
const LEGACY_STORE_KEYS = ["his_print_designer_profiles_r246","his_print_designer_profiles_r244","his_print_designer_profiles_r243","his_print_designer_profiles_r242","his_print_designer_profiles_r241","his_print_designer_profiles_r240"];
const LEGACY_LAST_KEYS = ["his_print_designer_last_profile_r246","his_print_designer_last_profile_r244","his_print_designer_last_profile_r243","his_print_designer_last_profile_r242","his_print_designer_last_profile_r241","his_print_designer_last_profile_r240"];
const FIRESTORE_SETTINGS_REF = doc(db, "boards", "printDesignerProfiles");
let firestoreSettingsLoaded = false;
let firestoreSettingsLoading = false;
const OFFICE_PROFILE_MATRIX = [
  "class:individual", "class:overview",
  "teacher:individual", "teacher:overview",
  "room:individual", "room:overview",
  "student:individual"
];
const PRINT_FORMATS = ["pdf", "word"];
const PRINT_ORIENTATIONS = ["landscape", "portrait"];
function isOverviewProfileName(profile="") { return /:overview$/.test(String(profile || "")); }
function isPortraitAllowedForProfile(profile="") { return !isOverviewProfileName(profile); }
function isFormatAllowedForProfile(fmt="pdf", profile="") {
  // r343: Excel은 출력 형식 선택에서 분리하고 상단의 전용 DB 저장 버튼으로만 제공합니다.
  const value = String(fmt || "");
  if (value === "excel") return false;
  // 학급/교사/교실 전체표는 Word 저장을 제공하지 않습니다.
  return !(value === "word" && isOverviewProfileName(profile));
}
// r318: Excel은 가로/세로 출력 프로필을 나누지 않습니다.
// Excel은 편집 가능한 격자 파일이므로 용지 방향은 PDF/Word에서만 의미를 갖습니다.
const PRINT_ORIENTATION_BY_FORMAT = { pdf: PRINT_ORIENTATIONS, word: PRINT_ORIENTATIONS, excel: ["sheet"] };
const PRINT_PROFILE_MATRIX = PRINT_FORMATS.flatMap(fmt => (PRINT_ORIENTATION_BY_FORMAT[fmt] || PRINT_ORIENTATIONS).flatMap(ori => OFFICE_PROFILE_MATRIX
  .filter(profile => ((fmt === "excel") || ori !== "portrait" || isPortraitAllowedForProfile(profile)) && isFormatAllowedForProfile(fmt, profile))
  .map(profile => `${fmt}:${ori}:${profile}`)));
const PRINT_PROFILE_LABELS = {
  pdf:"PDF", word:"Word", excel:"Excel",
  landscape:"가로", portrait:"세로", sheet:"방향없음",
  class:"학급", teacher:"교사", room:"교실", student:"학생",
  individual:"개별", overview:"전체"
};
function currentOfficeProfile() { return `${targetType()}:${layoutMode()}`; }
function isOverviewProfile(profile=currentOfficeProfile()) { return /:overview$/.test(profile); }
function isExcelFormatValue(fmt=format()) { return String(fmt || "") === "excel"; }
function normalizedPaperValue(paper=$("paper")?.value || "a4-landscape", profile=currentOfficeProfile(), fmt=format()) {
  if (isExcelFormatValue(fmt)) return "a4-landscape";
  return isOverviewProfile(profile) && paper === "a4-portrait" ? "a4-landscape" : (paper || "a4-landscape");
}
function paperOrientation(fmt=format()) { return normalizedPaperValue($("paper")?.value || "a4-landscape", currentOfficeProfile(), fmt) === "a4-portrait" ? "portrait" : "landscape"; }
function printOrientationForFormat(fmt=format()) { return isExcelFormatValue(fmt) ? "sheet" : paperOrientation(fmt); }
function currentPrintProfileKey() { return `${format()}:${printOrientationForFormat()}:${currentOfficeProfile()}`; }
function enforcePaperAvailability() {
  const paperEl = $("paper");
  if (!paperEl) return;
  const excel = isExcelFormatValue();
  const overview = isOverviewProfile();
  const portraitOpt = paperEl.querySelector('option[value="a4-portrait"]');
  const landscapeOpt = paperEl.querySelector('option[value="a4-landscape"]');
  paperEl.disabled = excel;
  paperEl.title = excel ? "Excel은 가로/세로 구분 없이 동일한 실제 격자로 저장됩니다." : "";
  if (landscapeOpt) landscapeOpt.textContent = excel ? "방향 구분 없음" : "가로";
  if (portraitOpt) {
    portraitOpt.disabled = excel || overview;
    portraitOpt.hidden = excel || overview;
    portraitOpt.textContent = excel ? "세로 (Excel 제외)" : (overview ? "세로 (전체 출력 제외)" : "세로");
  }
  if (excel || (overview && paperEl.value === "a4-portrait")) {
    paperEl.value = "a4-landscape";
    applyPaper("a4-landscape");
  }
}
function enforceFormatAvailability() {
  const formatEl = $("format");
  if (!formatEl) return;
  const profile = currentOfficeProfile();
  const wordOpt = formatEl.querySelector('option[value="word"]');
  const blockWord = !isFormatAllowedForProfile("word", profile);
  if (wordOpt) {
    wordOpt.disabled = blockWord;
    wordOpt.hidden = blockWord;
    wordOpt.textContent = blockWord ? "Word (전체 출력 제외)" : "Word";
  }
  if (blockWord && formatEl.value === "word") {
    formatEl.value = "pdf";
  }
}
function updateProfileStatus() {
  // r286: 좌측 출력종류 패널의 프로필 설명 문구는 표시하지 않습니다.
  enforcePaperAvailability();
  enforceFormatAvailability();
}

const $ = id => document.getElementById(id);
const clean = v => String(v ?? "").trim();
const esc = v => clean(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const unique = list => [...new Set((list||[]).map(clean).filter(Boolean))];
let subscribed = false;
let applying = false;
let renderTimer = 0;
let entitiesCache = [];
let dataReady = false;
let activeSplitTab = "1";
let splitFieldDraft = null;
let splitFieldStyleDraft = null;
let scopeMemory = {};
let currentScopeType = "class";
let printTemplateMapSource = null;
let printTemplateMapCache = new Map();
// r367: 교사/교실 전체의 페이지당 행 수는 저장 전에도 프로필별로 유지합니다.
const overviewRowsDraftByProfile = new Map();

function gradeNo(value="") { const m = clean(value).match(/\d{1,2}/); return m ? Number(m[0]) : 0; }
function classLabel(cls) { const g = gradeNo(cls.gradeKey || cls.grade); const n = clean(cls.name || cls.section || cls.label).replace(/^\d+/, ""); return g && n ? `${g}${n}` : clean(cls.label || cls.name || cls.id); }
function classKey(cls) { const g = gradeNo(cls.gradeKey || cls.grade); const n = clean(cls.name || cls.section || cls.label).replace(/^\d+/, ""); return g && n ? `${g}:${n}` : clean(cls.key || cls.id); }
function normalizeClassKey(v="") { const raw = clean(v).replace(/학년/g,"").replace(/\s+/g,""); const m = raw.match(/^(\d{1,2})[:\-]?([A-Z가-힣])$/i); return m ? `${Number(m[1])}:${m[2].toUpperCase()}` : raw; }
function classSortTuple(label="") {
  const raw = clean(label).replace(/학년/g,"").replace(/\s+/g,"");
  const m = raw.match(/(7|8|9|10|11|12)[:\-]?([A-Z가-힣])?/i);
  const grade = m ? Number(m[1]) : 99;
  const section = m && m[2] ? m[2].toUpperCase() : raw;
  return [grade, section];
}
function sortClassLabels(labels=[]) {
  return unique(labels).sort((a,b)=>{
    const A=classSortTuple(a), B=classSortTuple(b);
    return A[0]-B[0] || String(A[1]).localeCompare(String(B[1]),"ko",{numeric:true}) || clean(a).localeCompare(clean(b),"ko",{numeric:true});
  });
}
function classLabelFromKey(k="") { const n=normalizeClassKey(k); const m=n.match(/^(\d{1,2})[:\-]?(.+)$/); return m ? `${Number(m[1])}${m[2].toUpperCase()}` : clean(k).replace(":",""); }
function splitTeachers(v="") { return unique(Array.isArray(v) ? v : clean(v).split(/[,，、\/]+/)); }
function readRememberedSemester(fallback="") {
  try {
    const stored = clean(localStorage.getItem(LAST_SEMESTER_KEY));
    if (stored === "1" || stored === "2") return stored;
  } catch {}
  return fallback ? normalizePrintSemester(fallback) : "";
}
function rememberSemester(value=selectedSemester()) {
  const semester = normalizePrintSemester(value);
  try { localStorage.setItem(LAST_SEMESTER_KEY, semester); } catch {}
  return semester;
}
function selectedSemester() { return normalizePrintSemester($("semester")?.value || readRememberedSemester("1") || "1"); }
function selectedSemesterLabel() { return printSemesterLabel(selectedSemester()); }
function selectedSemesterTitle() { return `Semester ${selectedSemester()}`; }
function individualTimetableTitle(label="") { return `${clean(label)} Timetable · ${selectedSemesterTitle()}`; }
function templateMap() { const source=appState.templates?.templates || []; if (source !== printTemplateMapSource) { printTemplateMapSource=source; printTemplateMapCache=buildPrintTemplateMap(source); } return printTemplateMapCache; }
function semesterCardValues(c, e={}) { return resolveSemesterCardValues(c || {}, e || {}, templateMap(), selectedSemester()); }
function semesterEntryValues(e) { return resolveSemesterEntryValues(e || {}, templateMap(), selectedSemester()); }
function classes() { return (appState.classes?.classes || []).map(c => ({...c, key:classKey(c), label:classLabel(c), gradeNo:gradeNo(c.gradeKey || c.grade)})).filter(c => c.gradeNo>=7 && c.gradeNo<=12).sort((a,b)=>a.gradeNo-b.gradeNo || a.label.localeCompare(b.label,"ko",{numeric:true})); }
function rooms() { return (appState.rooms?.rooms || []).map(r => ({...r, label:clean(r.name || r.short || r.id)})).filter(r=>r.id && r.label).sort((a,b)=>a.label.localeCompare(b.label,"ko",{numeric:true})); }
function entries() { return appState.timetable?.entries || []; }
function cards() { return appState.timetable?.ttcards || []; }
function cardMap() { return new Map(cards().map(c => [c.id,c])); }
function roomMap() { return new Map(rooms().map(r => [r.id,r])); }
function periodLabels() { const cfg = appState.timetable?.config || {}; const raw = Array.isArray(cfg.periodLabels) ? cfg.periodLabels : []; const count = Math.max(1, raw.length || Number(cfg.periodCount) || 7); return Array.from({length:count},(_,i)=>clean(raw[i] || String(i+1)).replace(/교시/g,"") || String(i+1)); }
function entryCardIds(e) { return unique([...(e?.ttcardIds||[]), e?.ttcardId]); }
function cardClassKeys(c) { return unique([...(c?.classKeys||[]), ...(c?.classLabels||[]).map(normalizeClassKey)]).map(normalizeClassKey); }
function entryClassKeys(e) { const cm = cardMap(); const keys = unique([...(e?.audienceClassKeys||[]).map(normalizeClassKey), ...entryCardIds(e).flatMap(id => cardClassKeys(cm.get(id)))]); return keys; }
function entryMatchesClass(e, cls) { return entryClassKeys(e).includes(cls.key); }
function cardTeachers(c, e={}) { return semesterCardValues(c,e).teachers; }
function entryTeachers(e) { const cm=cardMap(); const ids=entryCardIds(e); if (ids.length) return unique(ids.flatMap(id => cardTeachers(cm.get(id), e))); return semesterEntryValues(e).teachers; }
function entryMatchesTeacher(e, teacher) { return entryTeachers(e).includes(clean(teacher.key)); }
function entryRoomIds(e) { const cm=cardMap(); const ids = unique([e?.roomId, ...(e?.roomIds||[]), ...Object.values(e?.roomAssignmentsByTtCardId||{}), ...entryCardIds(e).map(id=>cm.get(id)?.fixedRoomId)]); return ids; }
function entryMatchesRoom(e, room) { return entryRoomIds(e).includes(room.id); }
function roomName(id) { return roomMap().get(id)?.label || clean(id); }
function roomIdsForCard(e, c) {
  const explicit = unique([e?.roomAssignmentsByTtCardId?.[c?.id], c?.fixedRoomId, c?.roomId, ...(c?.roomIds||[])]);
  if (explicit.length) return explicit;
  const all = unique([e?.roomId, ...(e?.roomIds||[])]);
  return all.length <= 1 ? all : [];
}
function itemRoomForCard(e, c) { return roomIdsForCard(e,c).map(roomName).filter(Boolean).join(", "); }
function entryRoomNames(e) { return entryRoomIds(e).map(roomName).filter(Boolean).join(", "); }
function displaySubjectWithContext(subject, c=null) {
  const base = clean(subject);
  if (!base) return "";
  const track = clean(c?.track);
  const n = normSpecial(base);
  if ((n === normSpecial("온라인 AP 과목") || n === normSpecial("Online AP Course")) && track && track !== "공통" && track !== "수동") {
    return `${base}(${track})`;
  }
  return base;
}
function cardTitle(c,e) { const resolved=semesterCardValues(c,e); return displaySubjectWithContext(resolved.subject || "수업", c); }
function cardEnglish(c,e) {
  const v = clean(semesterCardValues(c,e).english || "");
  const track = clean(c?.track);
  const subjNorm = normSpecial(semesterCardValues(c,e).subject || c?.subject || "");
  if (v && (subjNorm === normSpecial("온라인 AP 과목") || normSpecial(v) === normSpecial("Online AP Course")) && track && track !== "공통" && track !== "수동") {
    return `${v} (${track})`;
  }
  return v;
}
function cardClasses(c,e) { const labels = sortClassLabels([...(c?.classLabels||[]), ...(c?.classKeys||[]).map(classLabelFromKey), ...(e?.audienceClassKeys||[]).map(classLabelFromKey)]); return labels.join(", "); }
function currentScopeMode() { return document.querySelector('input[name="scope"]:checked')?.value || "all"; }
function selectedScopeKeys() { return [...document.querySelectorAll('[data-scope-key]:checked')].map(el=>el.dataset.scopeKey).filter(Boolean); }
function captureScopeState() { return { scope: currentScopeMode(), selectedScopeKeys: selectedScopeKeys() }; }
function restoreScopeState(state) {
  if (!state) return;
  const scope = targetType() === "student" ? "custom" : (state.scope || "all");
  const radio = document.querySelector(`input[name="scope"][value="${scope}"]`);
  if (radio) radio.checked = true;
  const keys = new Set(state.selectedScopeKeys || state.keys || []);
  document.querySelectorAll('[data-scope-key]').forEach(el => { el.checked = keys.has(el.dataset.scopeKey); });
  ensureStudentSingleClassScope();
  updateScopeChipEnabled();
}
function updateScopeChipEnabled() {
  const type = targetType();
  const mode = currentScopeMode();
  const enabled = type === "student" || mode === "custom";
  document.querySelectorAll('[data-scope-key]').forEach(el => {
    el.disabled = !enabled;
    const chip = el.closest('.chip');
    if (chip) chip.classList.toggle('disabled-scope', !enabled);
  });
}
function ensureStudentSingleClassScope() {
  if (targetType() !== "student") return;
  const radio = document.querySelector('input[name="scope"][value="custom"]');
  if (radio) radio.checked = true;
  const boxes = [...document.querySelectorAll('[data-scope-key]')];
  if (!boxes.length) return;
  let firstChecked = boxes.find(el=>el.checked);
  if (!firstChecked) { firstChecked = boxes[0]; firstChecked.checked = true; }
  boxes.forEach(el=>{ if (el !== firstChecked) el.checked = false; });
}
function classAllowedByScope(cls) { if (targetType() === "student") { const key = selectedScopeKeys()[0] || classes()[0]?.key || ""; return cls.key === key; } const mode = currentScopeMode(); if (mode === "middle") return cls.gradeNo >= 7 && cls.gradeNo <= 9; if (mode === "high") return cls.gradeNo >= 10 && cls.gradeNo <= 12; if (mode === "custom") return selectedScopeKeys().includes(cls.key); return true; }
function teacherAllowedByScope(name) { const mode=currentScopeMode(); return mode !== "custom" || selectedScopeKeys().includes(clean(name)); }
function roomAllowedByScope(id) { const mode=currentScopeMode(); return mode !== "custom" || selectedScopeKeys().includes(clean(id)); }
function entryAllowedByScope(e) { const type=targetType(); if (type === "teacher" || type === "room") return true; const allowed = classes().filter(classAllowedByScope).map(c=>c.key); if (!allowed.length) return false; const keys = entryClassKeys(e); return !keys.length || keys.some(k => allowed.includes(k)); }
function outputKindValue() { return $("outputKind")?.value || `${$("targetType")?.value || "class"}:${$("layoutMode")?.value || "individual"}`; }
function parseOutputKind(value=outputKindValue()) { const [t="class",m="individual"] = clean(value).split(":"); return { type:t || "class", mode:t === "student" ? "individual" : (m || "individual") }; }
function syncOutputKindToHidden(value=outputKindValue()) { const p=parseOutputKind(value); if ($("targetType")) $("targetType").value=p.type; if ($("layoutMode")) $("layoutMode").value=p.mode; if ($("outputKind") && $("outputKind").value !== `${p.type}:${p.mode}`) $("outputKind").value = `${p.type}:${p.mode}`; return p; }
function setOutputKind(type, mode="individual") { const t=type || "class"; const m=t === "student" ? "individual" : (mode || "individual"); const v=`${t}:${m}`; if ($("outputKind")) $("outputKind").value=v; syncOutputKindToHidden(v); }
function targetType() { return parseOutputKind().type; }
function layoutMode() { return parseOutputKind().mode; }
function isOverviewRowsControlProfile() {
  return layoutMode() === "overview" && (targetType() === "teacher" || targetType() === "room");
}
function normalizeOverviewRowsValue(value="auto") {
  const raw = clean(value || "auto").toLowerCase();
  if (raw === "auto") return "auto";
  const n = Number(raw);
  return Number.isInteger(n) && n >= 6 && n <= 12 ? String(n) : "auto";
}
function overviewRowsProfileKey() { return canonicalProfileKey(profileKey()); }
function overviewRowsValueFromUi() { return normalizeOverviewRowsValue($("overviewRowsPerPage")?.value || "auto"); }
function rememberOverviewRowsDraft(value=overviewRowsValueFromUi()) {
  if (!isOverviewRowsControlProfile()) return "auto";
  const normalized = normalizeOverviewRowsValue(value);
  overviewRowsDraftByProfile.set(overviewRowsProfileKey(), normalized);
  return normalized;
}
function overviewRowsDraftValue(fallback="auto") {
  if (!isOverviewRowsControlProfile()) return "auto";
  const key = overviewRowsProfileKey();
  return normalizeOverviewRowsValue(overviewRowsDraftByProfile.has(key) ? overviewRowsDraftByProfile.get(key) : fallback);
}
function updateOverviewRowsControl() {
  const field = $("overviewRowsField");
  const select = $("overviewRowsPerPage");
  const visible = isOverviewRowsControlProfile();
  if (field) field.classList.toggle("hidden", !visible);
  if (select) select.disabled = !visible;
  if (visible && select) select.value = overviewRowsDraftValue(select.value || "auto");
}
function format() {
  const el = $("format");
  if (!el) return "pdf";
  // r343: 과거 저장값이 Excel이어도 현재 UI 형식은 PDF/Word 중 하나로 정규화합니다.
  if (el.value !== "pdf" && el.value !== "word") el.value = "pdf";
  if (!isFormatAllowedForProfile(el.value, currentOfficeProfile())) el.value = "pdf";
  return el.value;
}
function syncLayoutModeOptions() { syncOutputKindToHidden(); }
function applyPaper(paper) {
  const portrait = paper === "a4-portrait";
  document.documentElement.style.setProperty("--page-w", portrait ? "794px" : "1123px");
  document.documentElement.style.setProperty("--page-h", portrait ? "1123px" : "794px");
  document.body.classList.toggle("print-portrait", portrait);
  document.body.classList.toggle("print-landscape", !portrait);
  const el=$("printPageStyle");
  if (el) el.textContent = `@page{size:${portrait ? "A4 portrait" : "A4 landscape"};margin:5mm}@media print{@page{size:${portrait ? "210mm 297mm" : "297mm 210mm"};margin:5mm}}`;
}
function applyFontMode(mode="system") { const modes=["system","malgun","malgun-tight","pretty","nanum"]; document.body.classList.remove(...modes.map(m=>"font-"+m)); document.body.classList.add("font-"+(modes.includes(mode)?mode:"system")); }
function legacyProfileKey() { const t=targetType(); const m=t === "student" ? "individual" : layoutMode(); return `${t}:${m}:pdf`; }
function profileKey() { const t=targetType(); const m=t === "student" ? "individual" : layoutMode(); return `${format()}:${printOrientationForFormat()}:${t}:${m}`; }
function lastProfileKey() {
  try {
    const direct = clean(localStorage.getItem(LAST_KEY));
    if (direct) return canonicalProfileKey(direct);
    for (const key of LEGACY_LAST_KEYS) {
      const v = clean(localStorage.getItem(key));
      if (v) return canonicalProfileKey(v);
    }
  } catch {}
  return canonicalProfileKey(profileKey());
}
function defaultFieldSettings() { return Object.fromEntries(FIELD_DEFS.map(f=>[f.key,{enabled:f.enabled,bold:f.bold,pos:f.pos,font:"normal",fontPx:""}])); }
function normalizeFields(raw) { const base=defaultFieldSettings(); if (raw && typeof raw === "object") FIELD_DEFS.forEach(f=>{ base[f.key]={...base[f.key], ...(raw[f.key]||{})}; }); return base; }
function normalizeSplitFields(raw, fallbackFields=null) { const fallback=normalizeFields(fallbackFields); const out={}; [1,2,3,4].forEach(n=>{ const k=String(n); out[k]=normalizeFields(raw?.[k] || fallback); }); return out; }
function defaultSettings() { return { targetType:"class", layoutMode:"individual", semester:"1", format:"pdf", paper:"a4-landscape", overviewRowsPerPage:"auto", fontMode:"system", previewMode:"sample", headerLeft:"", headerRight:"", cellLayout:"auto", applyMode:"card", fontScale:"normal", ellipsisMode:false, scope:"all", selectedScopeKeys:[], specialSubjects:["CA","SA"], splitStyles: structuredClone(SPLIT_DEFAULTS), splitDirections:{"2":"cols","3":"grid","4":"grid"}, fields:defaultFieldSettings(), splitFields:normalizeSplitFields(null) }; }
function formatFromPaper(paper="a4-landscape") { return clean(paper).includes("portrait") ? "portrait" : "landscape"; }
function normalizeOrientationForProfile(fmt="pdf", ori="landscape", t="class", m="individual") {
  const f = clean(fmt || "pdf");
  if (f === "excel") return "sheet";
  const layoutProfile = `${t || "class"}:${m || "individual"}`;
  if (f === "word" && isOverviewProfileName(layoutProfile)) return "landscape";
  if (ori === "portrait" && !isPortraitAllowedForProfile(layoutProfile)) return "landscape";
  return ori === "portrait" ? "portrait" : "landscape";
}
function canonicalProfileKey(key=profileKey()) {
  const raw = clean(key);
  if (!raw) return "";
  const parts = raw.split(":");
  if (parts[0] === "excel" && parts.length >= 4) return `excel:sheet:${parts[2]}:${parts[3]}`;
  if ((parts[0] === "pdf" || parts[0] === "word") && parts.length >= 4) {
    const ori = normalizeOrientationForProfile(parts[0], parts[1], parts[2], parts[3]);
    return `${parts[0]}:${ori}:${parts[2]}:${parts[3]}`;
  }
  if (parts.length === 3 && (parts[2] === "pdf" || parts[2] === "word")) {
    const ori = normalizeOrientationForProfile(parts[2], "landscape", parts[0], parts[1]);
    return `${parts[2]}:${ori}:${parts[0]}:${parts[1]}`;
  }
  return raw;
}
function canonicalProfileKeyFromValue(key="", value=null) {
  const raw = clean(key);
  const parts = raw.split(":");
  const v = value && typeof value === "object" ? value : {};
  if (parts[0] === "excel" && parts.length >= 4) return `excel:sheet:${parts[2]}:${parts[3]}`;
  if ((parts[0] === "pdf" || parts[0] === "word") && parts.length >= 4) {
    const ori = normalizeOrientationForProfile(parts[0], parts[1] || formatFromPaper(v.paper), parts[2], parts[3]);
    return `${parts[0]}:${ori}:${parts[2]}:${parts[3]}`;
  }
  if (parts.length === 3 && (parts[2] === "pdf" || parts[2] === "word")) {
    const ori = normalizeOrientationForProfile(parts[2], formatFromPaper(v.paper), parts[0], parts[1]);
    return `${parts[2]}:${ori}:${parts[0]}:${parts[1]}`;
  }
  return canonicalProfileKey(raw);
}
function isLegacyExcelProfileKey(key="") {
  const parts = clean(key).split(":");
  return parts[0] === "excel" && (parts[1] === "portrait" || parts[1] === "landscape") && parts.length >= 4;
}
function isLegacyFormatProfileKey(key="") {
  const parts = clean(key).split(":");
  return parts.length === 3 && (parts[2] === "pdf" || parts[2] === "word");
}
function normalizeProfileValue(key, value) {
  const canonical = canonicalProfileKeyFromValue(key, value);
  const parts = canonical.split(":");
  const v = value && typeof value === "object" ? value : {};
  if ((parts[0] !== "excel" && parts[0] !== "pdf" && parts[0] !== "word") || parts.length < 4) return { ...v, printProfile: canonical || v.printProfile || key };
  const fmt = parts[0];
  const ori = normalizeOrientationForProfile(fmt, parts[1], parts[2], parts[3]);
  const target = parts[2] || "class";
  const mode = target === "student" ? "individual" : (parts[3] || "individual");
  const printProfile = `${fmt}:${ori}:${target}:${mode}`;
  // r323: 프로필 key가 기준입니다.
  // 구버전/복사 설정 안에 targetType/layoutMode/format/orientation 값이 섞여 있어도
  // 적용 시 엉뚱한 출력 종류로 이동하지 않도록 내부 메타값을 key 기준으로 강제 정합화합니다.
  return {
    ...v,
    targetType: target,
    layoutMode: mode,
    format: fmt,
    paper: fmt === "excel" ? "a4-landscape" : (ori === "portrait" ? "a4-portrait" : "a4-landscape"),
    orientation: fmt === "excel" ? "sheet" : ori,
    outputProfile: `${target}:${mode}`,
    printProfile
  };
}
function profileKeyCandidates(key=profileKey()) {
  const k = canonicalProfileKey(key);
  const parts = k.split(":");
  const out = [k, clean(key)];
  if ((parts[0] === "excel" || parts[0] === "pdf" || parts[0] === "word") && parts.length >= 4) {
    out.push(`${parts[0]}:landscape:${parts[2]}:${parts[3]}`);
    if (parts[0] !== "excel") out.push(`${parts[0]}:portrait:${parts[2]}:${parts[3]}`);
    if (parts[0] === "excel") {
      out.push(`excel:landscape:${parts[2]}:${parts[3]}`);
      out.push(`excel:portrait:${parts[2]}:${parts[3]}`);
    }
    out.push(`${parts[2]}:${parts[3]}:pdf`);
    out.push(`${parts[2]}:${parts[3]}:word`);
  }
  const legacy = legacyProfileKey();
  out.push(legacy);
  out.push(`${targetType()}:${targetType() === "student" ? "individual" : layoutMode()}:pdf`);
  return [...new Set(out.filter(Boolean))];
}
function normalizeDesignerStore(store) {
  const src = store && typeof store === "object" ? store : {};
  const out = {};
  Object.entries(src).forEach(([key, value]) => {
    if (!value || typeof value !== "object") return;
    const canonical = canonicalProfileKeyFromValue(key, value);
    const normalized = normalizeProfileValue(key, value);
    if (!canonical) return;
    if (isLegacyExcelProfileKey(key) || isLegacyFormatProfileKey(key)) {
      if (!out[canonical]) out[canonical] = normalized;
      return;
    }
    out[canonical] = normalized;
  });
  return out;
}
function readStore() {
  try { return normalizeDesignerStore(JSON.parse(localStorage.getItem(STORE_KEY)||"{}")); } catch { return {}; }
}
function writeStore(store) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(normalizeDesignerStore(store||{}))); } catch {}
}
function normalizeLocalDesignerStorage() {
  try {
    const normalized = readStore();
    writeStore(normalized);
    const last = clean(localStorage.getItem(LAST_KEY));
    if (last) localStorage.setItem(LAST_KEY, canonicalProfileKey(last));
    return normalized;
  } catch { return {}; }
}
function findProfileSettings(store, key=profileKey()) {
  for (const k of profileKeyCandidates(key)) {
    if (store && store[k]) return store[k];
  }
  return null;
}
function getSettings() {
  const store = readStore();
  const found = findProfileSettings(store, profileKey());
  const settings = {...defaultSettings(), ...(found||{})};
  settings.semester = readRememberedSemester(settings.semester) || normalizePrintSemester(settings.semester || "1");
  return settings;
}
function splitStylesFromDom() {
  const out = {};
  const clip = !!$("ellipsisMode")?.checked;
  [1,2,3,4].forEach(n => {
    const k = String(n);
    out[k] = {
      font: $("splitFont"+n)?.value || SPLIT_DEFAULTS[k].font,
      layout: $("splitLayout"+n)?.value || SPLIT_DEFAULTS[k].layout,
      // r341: 저장 호환성 때문에 clip 필드는 남기되, 모든 분할에 같은 공통값을 기록합니다.
      clip
    };
  });
  return out;
}
function splitDirectionsFromDom() { return {"2":$("splitDir2")?.value || "cols", "3":$("splitDir3")?.value || "grid", "4":$("splitDir4")?.value || "grid"}; }
function normalizeSplitDirections(raw) {
  // r341: 자동분할은 계산에서 제외합니다. 저장소에 남은 auto/legacy 값도 명시 규칙으로 정규화합니다.
  const map = (v, fallback) => {
    if (v === "columns" || v === "vertical") v = v === "columns" ? "cols" : "rows";
    if (v === "rows" || v === "cols" || v === "grid") return v;
    return fallback;
  };
  const d2 = map(raw?.["2"], "cols");
  return {"2":d2 === "grid" ? "cols" : d2, "3":map(raw?.["3"], "grid"), "4":map(raw?.["4"], "grid")};
}
function applySplitDirections(raw) { const dirs=normalizeSplitDirections(raw); [2,3,4].forEach(n=>{ const el=$("splitDir"+n); if(el) el.value=dirs[String(n)]; }); }
function normalizeSplitStyles(raw) { const out=structuredClone(SPLIT_DEFAULTS); if (raw && typeof raw === "object") [1,2,3,4].forEach(n=>{ const k=String(n); out[k]={...out[k], ...(raw[k]||{})}; out[k].clip = !!out[k].clip; }); return out; }
function applySplitStyles(raw) {
  const styles = normalizeSplitStyles(raw);
  splitFieldStyleDraft = structuredClone(styles);
  [1,2,3,4].forEach(n => {
    const k = String(n);
    const font = $("splitFont"+n);
    const layout = $("splitLayout"+n);
    if (font) font.value = styles[k].font;
    if (layout) layout.value = styles[k].layout;
  });
  // r341: ellipsisMode은 applySettings에서 불러온 공통값을 유지합니다.
  // 분할 탭을 바꾸거나 과거 splitStyles.clip 값이 checkbox를 덮어쓰지 않습니다.
}
function cardControlChanged(el) { return !!el.closest('#fieldRows') || ['cellLayout','fontScale','applyMode','fontMode','splitFont1','splitFont2','splitFont3','splitFont4','splitLayout1','splitLayout2','splitLayout3','splitLayout4','splitDir2','splitDir3','splitDir4','ellipsisMode'].includes(el.id); }
function markDirty(msg='설정 저장 필요') { const btn=$("saveSettingsBtn"); if(btn){ btn.textContent=msg; btn.classList.add('dirty'); btn.classList.remove('saved'); } }
function markSaved(msg='설정 저장됨') { const btn=$("saveSettingsBtn"); if(btn){ btn.textContent=msg; btn.classList.remove('dirty'); btn.classList.add('saved'); clearTimeout(markSaved.t); markSaved.t=setTimeout(()=>{ btn.textContent='설정 저장'; btn.classList.remove('saved'); },1400); } }
function markCardApplyNeeded() { const btn=$("applyCardSettingsBtn"); if(btn) btn.classList.add('pending'); markDirty(); }
function markCardApplied() { const btn=$("applyCardSettingsBtn"); if(btn) btn.classList.remove('pending'); }
function readFieldControls() { const fields={}; FIELD_DEFS.forEach(f=>{ fields[f.key]={ enabled: !!document.querySelector(`[data-field-enabled="${f.key}"]`)?.checked, bold: !!document.querySelector(`[data-field-bold="${f.key}"]`)?.checked, pos: document.querySelector(`[data-field-pos="${f.key}"]`)?.value || f.pos, fontPx: document.querySelector(`[data-field-font="${f.key}"]`)?.value || "" }; }); return normalizeFields(fields); }
function writeFieldControls(fields) { const s=normalizeFields(fields); FIELD_DEFS.forEach(f=>{ const v=s[f.key] || f; const en=document.querySelector(`[data-field-enabled="${f.key}"]`); const bo=document.querySelector(`[data-field-bold="${f.key}"]`); const po=document.querySelector(`[data-field-pos="${f.key}"]`); const fo=document.querySelector(`[data-field-font="${f.key}"]`); if(en) en.checked = v.enabled !== false; if(bo) bo.checked = !!v.bold; if(fo) fo.value = fontValueToPx(v.fontPx || v.font, f.key) || ""; if(po) po.value = v.pos || f.pos; }); }
function fieldsWithPresetFont(font, fields=null) {
  const out = normalizeFields(fields);
  const preset = FIELD_FONT_PRESET_VALUES[font] || FIELD_FONT_PRESET_VALUES.normal;
  FIELD_DEFS.forEach(f => { out[f.key].fontPx = String(preset[f.key] ?? FIELD_FONT_PX_DEFAULTS[f.key] ?? 9); });
  return out;
}
function activeSplitFontMode() { return $("splitFont" + (activeSplitTab || "1"))?.value || "normal"; }
function updateFieldFontInputState() {
  const custom = activeSplitFontMode() === "custom";
  document.querySelectorAll("[data-field-font]").forEach(el => { el.disabled = !custom; });
}
function applySplitFontPresetToControls(font) {
  if (font === "custom") { updateFieldFontInputState(); return; }
  writeFieldControls(fieldsWithPresetFont(font, readFieldControls()));
  updateFieldFontInputState();
}

function syncActiveFieldDraft() { if (!splitFieldDraft) splitFieldDraft = normalizeSplitFields(null); splitFieldDraft[String(activeSplitTab||"1")] = readFieldControls(); }
function syncActiveStyleDraft() {
  if (!splitFieldStyleDraft) splitFieldStyleDraft = normalizeSplitStyles(null);
  const activeKey = String(activeSplitTab || "1");
  const clip = !!$("ellipsisMode")?.checked;
  [1,2,3,4].forEach(n => {
    const k = String(n);
    splitFieldStyleDraft[k] = {
      ...(splitFieldStyleDraft[k] || SPLIT_DEFAULTS[k]),
      clip
    };
  });
  splitFieldStyleDraft[activeKey] = {
    ...splitFieldStyleDraft[activeKey],
    font: $("splitFont"+activeKey)?.value || SPLIT_DEFAULTS[activeKey].font,
    layout: $("splitLayout"+activeKey)?.value || SPLIT_DEFAULTS[activeKey].layout,
    clip
  };
}
function collectSettings() { if (!applying) { syncActiveFieldDraft(); syncActiveStyleDraft(); } const splitFields=normalizeSplitFields(splitFieldDraft); const fields=splitFields[String(activeSplitTab||"1")] || normalizeFields(null); return { targetType:targetType(), layoutMode:layoutMode(), semester:selectedSemester(), format:format(), paper:normalizedPaperValue($("paper").value, currentOfficeProfile(), format()), overviewRowsPerPage:overviewRowsDraftValue(overviewRowsValueFromUi()), fontMode:$("fontMode")?.value || "system", previewMode:$("previewMode")?.value || "sample", headerLeft:clean($("headerLeft")?.value || ""), headerRight:clean($("headerRight")?.value || ""), cellLayout:"auto", applyMode:$("applyMode").value, fontScale:$("fontScale")?.value || "normal", ellipsisMode:!!$("ellipsisMode")?.checked, scope:currentScopeMode(), selectedScopeKeys:selectedScopeKeys(), specialSubjects:[...document.querySelectorAll("[data-special-subject]:checked")].map(el=>el.dataset.specialSubject).concat($("specialShowRoom")?.checked?["__showRoom"]:[]).concat($("specialShowClass")?.checked?["__showClass"]:[]), splitStyles: splitStylesFromDom(), splitDirections: splitDirectionsFromDom(), fields, splitFields }; }
function normalizeFirestoreDesignerPayload(payload) {
  const profiles = payload?.profiles && typeof payload.profiles === "object" ? payload.profiles : (payload?.store && typeof payload.store === "object" ? payload.store : {});
  return { profiles, lastProfile: clean(payload?.lastProfile || payload?.activeProfile || "") };
}
function currentDesignerSettingsPayload(activeProfile=profileKey(), activeSettings=null) {
  const store = readStore();
  const canonicalActiveProfile = canonicalProfileKey(activeProfile || profileKey());
  const lastProfile = canonicalProfileKey(clean(localStorage.getItem(LAST_KEY) || canonicalActiveProfile || profileKey()));
  return {
    version: 1,
    appVersion: VERSION,
    source: "timetable-print-designer",
    storeKey: STORE_KEY,
    lastKey: LAST_KEY,
    exportedAt: new Date().toISOString(),
    lastProfile,
    activeProfile: canonicalActiveProfile,
    activeSettings: activeSettings || findProfileSettings(store, canonicalActiveProfile) || null,
    profiles: store
  };
}
function exportDesignerSettings() {
  try {
    normalizeLocalDesignerStorage();
    syncActiveFieldDraft();
    syncActiveStyleDraft();
    const payload = { ...currentDesignerSettingsPayload(profileKey()), mode: LOCAL_DEV_MODE ? "local-dev" : "online" };
    const stamp = new Date().toISOString().replace(/[:.]/g,"-").slice(0,19);
    downloadTextFile(`timetable-print-designer-settings_${stamp}_r364.json`, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
  } catch (e) {
    console.error("출력 디자이너 설정 내보내기 실패", e);
    alert("출력 디자이너 설정 내보내기에 실패했습니다: " + (e?.message || e));
  }
}
function mergeFirestoreDesignerSettings(payload) {
  const incoming = normalizeFirestoreDesignerPayload(payload);
  const local = readStore();
  const incomingProfiles = normalizeDesignerStore(incoming.profiles);
  const localHasProfiles = Object.keys(local || {}).length > 0;
  const merged = localHasProfiles ? { ...incomingProfiles, ...local } : { ...incomingProfiles };
  if (Object.keys(merged).length) writeStore(merged);
  try {
    if (!clean(localStorage.getItem(LAST_KEY)) && incoming.lastProfile) localStorage.setItem(LAST_KEY, canonicalProfileKey(incoming.lastProfile));
  } catch {}
  return Object.keys(incomingProfiles || {}).length;
}
async function loadDesignerSettingsFromFirestore(applyToUi=false) {
  if (LOCAL_DEV_MODE || firestoreSettingsLoaded || firestoreSettingsLoading) return false;
  firestoreSettingsLoading = true;
  try {
    const snap = await getDoc(FIRESTORE_SETTINGS_REF);
    firestoreSettingsLoaded = true;
    if (!snap.exists()) return false;
    const count = mergeFirestoreDesignerSettings(snap.data());
    if (applyToUi && count) {
      const last = lastProfileKey();
      const store = readStore();
      const base = last && store[last] ? store[last] : defaultSettings();
      applySettings(base, false, true);
      currentScopeType = targetType();
      buildScopeUi();
      buildSpecialSubjects();
      restoreScopeState(scopeMemory[currentScopeType] || base);
      applySpecialSubjects(base.specialSubjects || []);
      renderEntityList();
      updateExportButtonLabel();
      updateProfileStatus();
      scheduleRender();
    }
    return true;
  } catch (e) {
    console.warn("Firestore 출력 디자이너 설정 불러오기 실패", e);
    return false;
  } finally {
    firestoreSettingsLoading = false;
  }
}
async function saveDesignerSettingsToFirestore(store, activeProfile, activeSettings) {
  if (LOCAL_DEV_MODE) return { skipped: true, reason: "local-dev" };
  const payload = {
    ...currentDesignerSettingsPayload(activeProfile, activeSettings),
    profiles: store || readStore(),
    updatedAt: serverTimestamp(),
    updatedAtClient: new Date().toISOString(),
    updatedBy: auth.currentUser ? { uid: auth.currentUser.uid || "", email: auth.currentUser.email || "", displayName: auth.currentUser.displayName || "" } : null
  };
  await setDoc(FIRESTORE_SETTINGS_REF, payload, { merge: false });
  firestoreSettingsLoaded = true;
  return { saved: true };
}
function saveSettings() { if (applying) return; normalizeLocalDesignerStorage(); syncActiveFieldDraft(); const store=readStore(); const key=canonicalProfileKey(profileKey()); const s=collectSettings(); const saved={ targetType:s.targetType, layoutMode:s.layoutMode, semester:s.semester, format:s.format, paper:normalizedPaperValue(s.paper, currentOfficeProfile(), s.format), overviewRowsPerPage:normalizeOverviewRowsValue(s.overviewRowsPerPage), orientation:printOrientationForFormat(), outputProfile:currentOfficeProfile(), printProfile:key, fontMode:s.fontMode, previewMode:s.previewMode, headerLeft:s.headerLeft, headerRight:s.headerRight, cellLayout:"auto", applyMode:s.applyMode, fontScale:s.fontScale, ellipsisMode:!!s.ellipsisMode, specialSubjects:s.specialSubjects, splitStyles:s.splitStyles, splitDirections:s.splitDirections, fields:s.fields, splitFields:s.splitFields }; store[key]=saved; writeStore(store); localStorage.setItem(LAST_KEY, key); showSaved(); markSaved(LOCAL_DEV_MODE ? "로컬 저장됨" : "로컬 저장됨"); updateProfileStatus(); renderPreview(); saveDesignerSettingsToFirestore(store,key,saved).then(result=>{ if(result?.saved) markSaved("Firestore 저장됨"); }).catch(e=>{ console.warn("Firestore 출력 디자이너 설정 저장 실패", e); markDirty("로컬 저장됨 · Firestore 실패"); }); }
function showSaved() { markCardApplied(); }
function applySettings(settings, keepMain=false, preserveScope=false) {
  applying=true;
  const s={...defaultSettings(),...settings};
  if (!keepMain) {
    setOutputKind(s.targetType, s.layoutMode);
    $("format").value = s.format === "word" ? "word" : "pdf";
    enforceFormatAvailability();
  } else {
    syncOutputKindToHidden();
    enforceFormatAvailability();
  }
  syncLayoutModeOptions();
  const nextPaper = normalizedPaperValue(s.paper || "a4-landscape", currentOfficeProfile(), format());
  $("paper").value = nextPaper;
  applyPaper(nextPaper); enforcePaperAvailability(); updateProfileStatus();
  const rowsSelect = $("overviewRowsPerPage");
  if (isOverviewRowsControlProfile()) {
    const key = overviewRowsProfileKey();
    const savedRows = normalizeOverviewRowsValue(s.overviewRowsPerPage || "auto");
    if (!overviewRowsDraftByProfile.has(key)) overviewRowsDraftByProfile.set(key, savedRows);
    if (rowsSelect) rowsSelect.value = overviewRowsDraftValue(savedRows);
  } else if (rowsSelect) rowsSelect.value = "auto";
  updateOverviewRowsControl();
  if ($("fontMode")) $("fontMode").value=s.fontMode || "system";
  applyFontMode(s.fontMode || "system");
  if($("semester")) $("semester").value = readRememberedSemester(s.semester) || normalizePrintSemester(s.semester || "1");
  if($("previewMode")) $("previewMode").value=s.previewMode || "sample";
  if($("headerLeft")) $("headerLeft").value=s.headerLeft || "";
  if($("headerRight")) $("headerRight").value=s.headerRight || "";
  if($("cellLayout")) $("cellLayout").value="auto";
  if($("applyMode")) $("applyMode").value=s.applyMode || "card";
  if($("fontScale")) $("fontScale").value=s.fontScale || "normal";
  if($("ellipsisMode")) $("ellipsisMode").checked=!!s.ellipsisMode;
  document.body.classList.toggle("ellipsis-enabled", !!s.ellipsisMode);
  if (!preserveScope) {
    const scopeVal=s.scope || "all";
    document.querySelectorAll("input[name=\"scope\"]").forEach(el=>{ el.checked = el.value === scopeVal; });
    const selected=new Set(s.selectedScopeKeys || []);
    document.querySelectorAll("[data-scope-key]").forEach(el=>{ el.checked = selected.has(el.dataset.scopeKey); });
  }
  applySplitStyles(s.splitStyles);
  applySplitDirections(s.splitDirections);
  splitFieldDraft=normalizeSplitFields(s.splitFields, s.fields);
  const tabKey=String(activeSplitTab || "1");
  writeFieldControls(splitFieldDraft[tabKey] || s.fields || normalizeFields(null));
  updateFieldFontInputState();
  applying=false;
}
function switchProfile() { showRenderOverlay("출력 대상을 바꾸는 중입니다…"); setTimeout(()=>{ scopeMemory[currentScopeType] = captureScopeState(); syncLayoutModeOptions(); const nextType = targetType(); currentScopeType = nextType; buildScopeUi(); const s = getSettings(); applySettings(s, true, true); buildScopeUi(); restoreScopeState(scopeMemory[nextType]); applySpecialSubjects(s.specialSubjects || []); markCardApplied(); updateProfileStatus(); updateOverviewRowsControl(); scheduleHeavyRender("미리보기를 다시 그리는 중입니다…", 30); }, 30); }
function buildFieldRows() {
  $("fieldRows").innerHTML = FIELD_DEFS.map(f => {
    const pos = f.key === "english" ? `<span class="pos-fixed" title="영문명은 과목 아래 고정">↓</span>` : `<select data-field-pos="${f.key}" title="위치">${POSITIONS.map(([v,l])=>`<option value="${v}">${esc(l)}</option>`).join("")}</select>`;
    const font = `<input type="number" min="3" max="24" step="0.5" data-field-font="${f.key}" placeholder="${FIELD_FONT_PX_DEFAULTS[f.key]||9}" title="글자 크기(px)">`;
    return `<div class="checkrow"><input type="checkbox" data-field-enabled="${f.key}" title="표시"><span>${esc(f.label)}</span><label class="bold-only" title="굵게"><input type="checkbox" data-field-bold="${f.key}"></label>${font}${pos}</div>`;
  }).join("");
}
function buildScopeUi() { const type=targetType(); const scopeBox=$("scopeOptions"); const listBox=$("classChips"); if(!scopeBox || !listBox) return; if (type === "teacher") { scopeBox.innerHTML = `<label class="check"><input type="radio" name="scope" value="all" checked><span>전체 교사</span></label><label class="check"><input type="radio" name="scope" value="custom"><span>교사 선택</span></label>`; const names=unique(entries().flatMap(entryTeachers)).sort((a,b)=>a.localeCompare(b,"ko")); listBox.innerHTML = names.map(n=>`<label class="chip"><input type="checkbox" data-scope-key="${esc(n)}"><span>${esc(n)}</span></label>`).join(""); $("scopeHint").textContent = "교사별 출력은 선택한 교사의 본인 과목·본인 교실만 표시합니다."; updateScopeChipEnabled(); return; } if (type === "room") { scopeBox.innerHTML = `<label class="check"><input type="radio" name="scope" value="all" checked><span>전체 교실</span></label><label class="check"><input type="radio" name="scope" value="custom"><span>교실 선택</span></label>`; listBox.innerHTML = rooms().map(r=>`<label class="chip"><input type="checkbox" data-scope-key="${esc(r.id)}"><span>${esc(r.label)}</span></label>`).join(""); $("scopeHint").textContent = "교실별 출력은 선택한 교실에 배정된 대표 수업만 표시합니다."; updateScopeChipEnabled(); return; } if (type === "student") { scopeBox.innerHTML = `<label class="check"><input type="radio" name="scope" value="custom" checked><span>학급 1개 선택</span></label>`; listBox.innerHTML = classes().map(c=>`<label class="chip"><input type="checkbox" data-scope-key="${esc(c.key)}"><span>${esc(c.label)}</span></label>`).join(""); $("scopeHint").textContent = "학생 개인표는 프리징 방지를 위해 한 번에 1개 학급 학생만 출력합니다."; ensureStudentSingleClassScope(); updateScopeChipEnabled(); return; } scopeBox.innerHTML = `<label class="check"><input type="radio" name="scope" value="all" checked><span>전체</span></label><label class="check"><input type="radio" name="scope" value="middle"><span>중등 7–9</span></label><label class="check"><input type="radio" name="scope" value="high"><span>고등 10–12</span></label><label class="check"><input type="radio" name="scope" value="custom"><span>학급 선택</span></label>`; listBox.innerHTML = classes().map(c=>`<label class="chip"><input type="checkbox" data-scope-key="${esc(c.key)}"><span>${esc(c.label)}</span></label>`).join(""); $("scopeHint").textContent = "학급 출력은 선택 범위 안의 학급만 출력합니다."; updateScopeChipEnabled(); }
function subjectGradeNoFromText(value="") {
  const raw = clean(value);
  let m = raw.match(/^(?:G|Grade)?\s*(7|8|9|10|11|12)(?:학년)?\s*[-_.:·⋅ ]*/i);
  if (m) return Number(m[1]);
  m = raw.match(/\b(7|8|9|10|11|12)(?:학년|[A-C])?\b/);
  return m ? Number(m[1]) : 0;
}
function subjectGradeNoFromCard(c) {
  const rawKeys = [
    ...(c?.classKeys||[]), ...(c?.classLabels||[]), ...(c?.audienceClassKeys||[]),
    ...(c?.classes||[]), ...(c?.classNames||[]), c?.classKey, c?.classLabel, c?.gradeLabel
  ];
  const keys = unique(rawKeys.map(normalizeClassKey));
  for (const k of keys) { const m=clean(k).match(/(7|8|9|10|11|12)/); if (m) return Number(m[1]); }
  const textGrade = subjectGradeNoFromText([c?.subject, c?.label, c?.group, c?.track, c?.nameKo, c?.title, c?.templateName].filter(Boolean).join(" "));
  if (textGrade) return textGrade;
  const g = gradeNo(c?.grade || c?.gradeKey || c?.schoolGrade || c?.classGrade || "");
  return (g>=7 && g<=12) ? g : 0;
}
function subjectLabelFromCard(c) {
  const raw = clean(c?.subject || c?.nameKo || c?.title || c?.label || c?.group || c?.track || "");
  return raw.replace(/^(?:G|Grade)?\s*(?:7|8|9|10|11|12)(?:학년)?\s*[-_.:·⋅ ]*/i, "").trim() || raw;
}
function normalizedSubjectCandidate(label) {
  const raw = clean(label);
  if (!raw) return "";
  return raw.replace(/^(?:G|Grade)?\s*(?:7|8|9|10|11|12)(?:학년)?\s*[-_.:·⋅ ]*/i, "").replace(/^(?:7|8|9|10|11|12)(?=[^0-9]|$)/, "").trim() || raw;
}
function pushSubjectGroup(map, grade, label) {
  const name = normalizedSubjectCandidate(label);
  if (!name) return;
  const key = grade ? `${grade}학년` : "공통";
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(name);
}
function buildSpecialSubjects() {
  const selectedNow = [...document.querySelectorAll("[data-special-subject]:checked")].map(el=>el.dataset.specialSubject).concat($("specialShowRoom")?.checked?["__showRoom"]:[]).concat($("specialShowClass")?.checked?["__showClass"]:[]);
  const groups = new Map();
  pushSubjectGroup(groups, 0, "CA");
  pushSubjectGroup(groups, 0, "SA");
  for (const c of cards()) {
    const g = subjectGradeNoFromCard(c);
    pushSubjectGroup(groups, g, subjectLabelFromCard(c));
  }
  for (const g of appState.timetable?.ttcardGroups || []) {
    const label = clean(g.name || g.label || g.groupName);
    const grade = gradeNo(g.grade || g.gradeKey || "") || subjectGradeNoFromText(label);
    pushSubjectGroup(groups, grade, label);
  }
  const order = ["공통","7학년","8학년","9학년","10학년","11학년","12학년"];
  const html = `<div class="special-options"><label class="check"><input type="checkbox" id="specialShowRoom"><span>간략 카드 교실 표시</span></label><label class="check"><input type="checkbox" id="specialShowClass"><span>간략 카드 반 표시</span></label></div>` + order.filter(k => groups.has(k)).map(k => {
    const names = [...groups.get(k)].sort((a,b)=>{
      if (a === "CA") return -1; if (b === "CA") return 1;
      if (a === "SA") return -1; if (b === "SA") return 1;
      return a.localeCompare(b,"ko",{numeric:true});
    });
    return `<div class="subject-grade">${esc(k)}</div><div class="subject-grade-grid">${names.map(n=>`<label class="check"><input type="checkbox" data-special-subject="${esc(n)}"><span>${esc(n)}</span></label>`).join("")}</div>`;
  }).join("");
  $("specialSubjects").innerHTML = html || `<div class="hint">간략 출력 과목 후보가 없습니다.</div>`;
  applySpecialSubjects(selectedNow);
}
function applySpecialSubjects(selected=[]) { const arr = Array.isArray(selected) ? selected : []; document.querySelectorAll('[data-special-subject]').forEach(el=>{ el.checked = arr.includes(el.dataset.specialSubject); }); if($("specialShowRoom")) $("specialShowRoom").checked = arr.includes("__showRoom"); if($("specialShowClass")) $("specialShowClass").checked = arr.includes("__showClass"); }
function visibleEntriesForScope() { return entries().filter(entryAllowedByScope); }
function students() { return classes().filter(classAllowedByScope).flatMap(c => (c.students||[]).map(st => ({type:"student", key:clean(st.id || `${c.key}:${st.name}`), label:clean(st.name || st.label || st.id), sub:c.label, classId:c.id, classKey:c.key, classLabel:c.label, match:e=>entryMatchesStudent(e, st, c)}))).filter(st=>st.key && st.label).sort((a,b)=>a.sub.localeCompare(b.sub,"ko",{numeric:true}) || a.label.localeCompare(b.label,"ko")); }
function rosterStore() {
  const r = appState.rosters || {};
  return r.rosters || r.data?.rosters || r;
}
function rosterRowsForCard(c) {
  const store = rosterStore();
  const keys = unique([c?.templateId, c?.compoundParentTemplateId, c?.parentTemplateId, c?.subjectTemplateId, c?.templateKey]);
  const rows = [];
  for (const k of keys) {
    const value = store?.[k];
    if (Array.isArray(value)) rows.push(...value);
    else if (Array.isArray(value?.rows)) rows.push(...value.rows);
    else if (Array.isArray(value?.students)) rows.push(...value.students);
  }
  return rows;
}
function isLikelyWholeClassCard(c, cls) {
  const keys = cardClassKeys(c);
  const subject = clean(c?.subject || c?.label);
  const track = clean(c?.track);
  if (!keys.includes(cls?.key)) return false;
  if (subject.includes("[남]") || subject.includes("[여]")) return false;
  if (track === "공통" && keys.length === 1) return true;
  return !!(c?.isWholeClass || c?.entireClass || c?.audienceMode === "whole");
}
function rosterMatchForStudent(c, st, cls) {
  const rows = rosterRowsForCard(c);
  if (!rows.length) return null;
  const sid = clean(st.id || st.key);
  const sname = clean(st.name || st.label);
  const cid = clean(cls?.id || cls?.classId);
  const ckey = clean(cls?.key || cls?.classKey);
  const cardSection = c?.sectionIdx ?? c?.sectionIndex ?? null;
  return rows.some(r => {
    const rs = clean(r.studentId || r.studentKey || r.id || r.name);
    const rn = clean(r.studentName || r.name);
    const rcid = clean(r.classId || r.classKey || r.className);
    const rowSection = r.sectionIdx ?? r.sectionIndex ?? null;
    const classOk = !rcid || rcid === cid || normalizeClassKey(rcid) === ckey;
    const sectionOk = rowSection == null || cardSection == null || String(rowSection) === String(cardSection);
    const studentOk = rs === sid || rs === sname || rn === sname || rn === sid;
    return classOk && sectionOk && studentOk;
  });
}
function cardMatchesStudent(c, e, st, cls) {
  if (!c) return false;
  const sid = clean(st.id || st.key);
  const sname = clean(st.name || st.label);
  const sk = (c?.studentKeys || c?.studentIds || []).map(clean).filter(Boolean);
  if (sk.length) return sk.includes(sid) || sk.includes(sname);
  const rosterMatch = rosterMatchForStudent(c, st, cls);
  if (rosterMatch !== null) return rosterMatch;
  // roster가 없는 경우는 수동 HR/전체반 공통카드만 포함한다. 선택/그룹카드는 학생 개인표에 fallback으로 넣지 않는다.
  if (!!c.isManual && entryMatchesClass(e, cls)) return true;
  return isLikelyWholeClassCard(c, cls);
}
function entryMatchesStudent(e, st, cls) {
  const sid=clean(st.id || st.key);
  const sname=clean(st.name || st.label);
  if ((e.audienceStudentKeys||[]).some(x=>clean(x)===sid || clean(x)===sname)) return true;
  const cm=cardMap();
  for (const id of entryCardIds(e)) {
    if (cardMatchesStudent(cm.get(id), e, st, cls)) return true;
  }
  return false;
}
function buildEntities() { const type=targetType(); const visibleEntries=visibleEntriesForScope(); if (type === "class") return classes().filter(classAllowedByScope).map(c=>({type,key:c.key,label:c.label,sub:`${c.gradeNo}학년`, match:e=>entryMatchesClass(e,c)})).filter(ent=>visibleEntries.some(ent.match)); if (type === "student") return students().filter(ent=>visibleEntries.some(ent.match)); if (type === "teacher") { const names=unique(entries().flatMap(entryTeachers)).filter(teacherAllowedByScope).sort((a,b)=>a.localeCompare(b,"ko")); return names.map(n=>({type,key:n,label:n,sub:"교사",match:e=>entryMatchesTeacher(e,{key:n})})).filter(ent=>entries().some(ent.match)); } const rm=rooms().filter(r=>roomAllowedByScope(r.id)); return rm.map(r=>({type,key:r.id,label:r.label,sub:r.type||"교실",room:r,match:e=>entryMatchesRoom(e,r)})).filter(ent=>entries().some(ent.match)); }
function renderEntityList() { entitiesCache = buildEntities(); if ($("scopeHint")) $("scopeHint").textContent = `${entitiesCache.length}개 대상이 출력됩니다.`; }
function selectedEntities() { entitiesCache = buildEntities(); return entitiesCache; }
function itemFromCard(e,c,periodLabel) { const resolved=semesterCardValues(c,e); return { entry:e, card:c, subject:cardTitle(c,e), english:cardEnglish(c,e), teacher:clean(resolved.teacher || e?.teacherName), room:itemRoomForCard(e,c), class:cardClasses(c,e), period:periodLabel, group:clean(c?.group), track:clean(c?.track), rawSubject:clean(c?.subject), rawLabel:clean(c?.label) }; }
function inferEntrySubject(e, cardsForEntry=[]) {
  const direct = clean(e?.groupName || e?.subject || e?.title || e?.name || e?.label || e?.displayName || e?.templateName || e?.subjectName || e?.courseName || e?.lessonName);
  if (direct) return direct;
  const titles = unique(cardsForEntry.map(c=>cardTitle(c,e)));
  if (titles.length === 1) return titles[0];
  if (titles.length > 1) {
    const first = titles[0];
    if (titles.every(t=>normSpecial(t)===normSpecial(first))) return first;
    return first;
  }
  const teacherText = clean(e?.teacherName);
  if (entryRoomIds(e).length >= 4 && ["윤미자","김장미","박정미","Joshua"].every(t=>teacherText.includes(t))) return "선교적 생활";
  return "수업";
}
function joinedSubjectFromCards(e, cardsForEntry=[]) {
  const titles = unique((cardsForEntry||[]).map(c=>cardTitle(c,e)).filter(Boolean));
  if (!titles.length) return inferEntrySubject(e, cardsForEntry);
  if (titles.length === 1) return titles[0];
  return titles.join(" / ");
}
function representativeItemFromCards(e, cardsForEntry, periodLabel, overrides={}) {
  const cs = (cardsForEntry||[]).filter(Boolean);
  const first = cs[0] || null;
  const classes = sortClassLabels([...(e?.audienceClassKeys||[]).map(classLabelFromKey), ...cs.flatMap(c=>[...(c?.classLabels||[]), ...(c?.classKeys||[]).map(classLabelFromKey)])]);
  const teachers = unique([...cs.flatMap(c=>cardTeachers(c,e)), ...splitTeachers(overrides.teacher || "")]);
  const cardRoomText = unique(cs.flatMap(c=>itemRoomForCard(e,c).split(/,\s*/))).filter(Boolean).join(", ");
  const rooms = clean(overrides.room) || cardRoomText || (cs.length ? "" : entryRoomNames(e));
  const englishes = unique(cs.map(c=>cardEnglish(c,e)));
  return { entry:e, card:first, subject:joinedSubjectFromCards(e, cs), english:englishes.length===1?englishes[0]:"", teacher:clean(overrides.teacher) || teachers.join(", ") || clean(e.teacherName), room:rooms, class:classes.join(", "), period:periodLabel, rawSubject:clean(first?.subject || e?.subject), rawLabel:clean(first?.label || e?.label) };
}
function itemFromEntry(e,periodLabel) { const cs=entryCardIds(e).map(id=>cardMap().get(id)).filter(Boolean); const resolved=semesterEntryValues(e); return { entry:e, card:cs[0]||null, subject:cs.length?inferEntrySubject(e, cs):resolved.subject, english:unique(cs.map(c=>cardEnglish(c,e))).length===1?unique(cs.map(c=>cardEnglish(c,e)))[0]:resolved.english, teacher:cs.length?unique(cs.flatMap(c=>cardTeachers(c,e))).join(", "):resolved.teacher, room:entryRoomNames(e), class:sortClassLabels((e.audienceClassKeys||[]).map(classLabelFromKey)).join(", "), period:periodLabel }; }
function entryItems(e, ent, periodLabel) {
  const cm=cardMap();
  const type=targetType();
  const ids=entryCardIds(e);
  const entryCards = ids.map(id=>cm.get(id)).filter(Boolean);

  if (type === "teacher") {
    if (entryCards.length) {
      const matched = entryCards.filter(c => {
        const teachers = cardTeachers(c,e);
        return teachers.length ? teachers.includes(ent.key) : splitTeachers(e.teacherName).includes(ent.key);
      });
      return matched.length ? [representativeItemFromCards(e, matched, periodLabel, { teacher: ent.key })] : [];
    }
    return semesterEntryValues(e).teachers.includes(ent.key) ? [itemFromEntry(e, periodLabel)] : [];
  }

  if (type === "room") {
    if (entryCards.length) {
      const matched = entryCards.filter(c => {
        const rids = roomIdsForCard(e,c);
        return rids.length ? rids.includes(ent.key) : entryRoomIds(e).includes(ent.key);
      });
      return matched.length ? [representativeItemFromCards(e, matched, periodLabel, { room: roomName(ent.key) })] : [];
    }
    return entryRoomIds(e).includes(ent.key) ? [itemFromEntry(e, periodLabel)] : [];
  }

  let out=[];
  if (entryCards.length) {
    if (type === "student") {
      const matched = entryCards.filter(c=>cardMatchesStudent(c, e, {id:ent.key, name:ent.label}, {id:ent.classId, key:ent.classKey, label:ent.classLabel}));
      if (matched.length > 1) {
        const titles = unique(matched.map(c=>cardTitle(c,e)));
        const firstNorm = normSpecial(titles[0] || "");
        const sameTitle = titles.length <= 1 || titles.every(t=>normSpecial(t) === firstNorm);
        out = sameTitle ? [representativeItemFromCards(e, matched, periodLabel)] : matched.map(c=>itemFromCard(e,c,periodLabel));
      } else {
        out = matched.map(c=>itemFromCard(e,c,periodLabel));
      }
    } else {
      for (const c of entryCards) {
        if (type === "class") {
          const keys = cardClassKeys(c);
          if (keys.length ? keys.includes(ent.key) : entryMatchesClass(e, ent)) out.push(itemFromCard(e,c,periodLabel));
        }
      }
    }
  }
  if (!out.length && type !== "student" && ent.match(e)) out=[itemFromEntry(e,periodLabel)];
  return out;
}
function fieldFontStyle(settings={}, key="subject") { const px = fontValueToPx(settings.fontPx || settings.font, key); if (px) return `style="font-size:${px}px"`; const scale = FIELD_FONT_SCALE[settings.font || "normal"] || 1; return `style="font-size:calc(var(--card-font,10px) * ${scale})"`; }
function isClassOfficialPrint() { return targetType() === "class"; }
function conciseEnglishLabel(eng="") {
  const v = clean(eng);
  if (!v) return "";
  if (/^(English\s?(10|11|12)|Algebra|Pre-Calculus|Calculus\s?II|Chemistry|Physics|Biology|Music|Art|Chapel|Korean|HR\d?|CA|SA)$/i.test(v)) return v;
  if (/^[A-Z]{1,4}\d?$/i.test(v)) return v;
  return "";
}
function shouldShowEnglishLabel(item={}, splitCount=1) {
  // 미리보기·PDF·Word가 같은 표시 규칙을 사용합니다.
  // 분할 수나 출력 대상 때문에 영문명을 임의로 숨기지 않습니다.
  return !!clean(item.english);
}
function englishForCard(item={}, splitCount=1) {
  return shouldShowEnglishLabel(item, splitCount) ? clean(item.english) : "";
}
function fieldHtml(item, f, settings) { const v = clean(item[f.key]); if (!v || settings.enabled === false) return ""; return `<span class="field-item field-${f.key} pos-${esc(settings.pos||f.pos)} ${settings.bold?"bold":""}" ${fieldFontStyle(settings, f.key)}>${esc(v)}</span>`; }
function subjectEnglishHtml(item, fields, splitCount=1) { const subjCfg=fields.subject || {}; const engCfg=fields.english || {}; const subj=clean(item.subject); const eng=englishForCard(item, splitCount); const showSubj = subj && subjCfg.enabled !== false; const showEng = eng && engCfg.enabled !== false; if (!showSubj && !showEng) return ""; const pos = subjCfg.pos || "mc"; const bold = subjCfg.bold ? "bold" : ""; return `<span class="field-item field-subject-group pos-${esc(pos)} ${bold}">${showSubj?`<span class="field-subject" ${fieldFontStyle(subjCfg,"subject")}>${esc(subj)}</span>`:""}${showEng?`<span class="field-english-inline ${engCfg.bold?"bold":""}" ${fieldFontStyle(engCfg,"english")}>${esc(eng)}</span>`:""}</span>`; }
function standardCardHtml(item, fields, splitCount=1) { return subjectEnglishHtml(item, fields, splitCount) + FIELD_DEFS.filter(f=>f.key!=="subject" && f.key!=="english").map(f=>fieldHtml(item,f,fields[f.key]||{})).join(""); }
function splitStyleFor(count, settings) { const key=String(Math.max(1, Math.min(4, count || 1))); const cfg={...SPLIT_DEFAULTS[key], ...(settings.splitStyles?.[key]||{})}; const font=SPLIT_FONT[cfg.font] || SPLIT_FONT.normal; return { key, cfg, font }; }
function compactCardHtml(item, cfg, fields=null) {
  const fs = normalizeFields(fields);
  const subjCfg = fs.subject || {};
  const engCfg = fs.english || {};
  const teacherCfg = fs.teacher || {};
  const roomCfg = fs.room || {};
  const classCfg = fs.class || {};
  const subj = subjCfg.enabled === false ? "" : esc(item.subject);
  const safeEng = englishForCard(item, cfg?.splitCount || 1);
  const eng = engCfg.enabled === false || !safeEng ? "" : `<div class="compact-sub ${engCfg.bold?"bold":""}" ${fieldFontStyle(engCfg,"english")}>${esc(safeEng)}</div>`;
  const metaParts = [];
  if (teacherCfg.enabled !== false && item.teacher) metaParts.push(item.teacher);
  if (roomCfg.enabled !== false && item.room) metaParts.push(item.room);
  if (classCfg.enabled !== false && item.class) metaParts.push(item.class);
  const meta = metaParts.filter(Boolean).join(" · ");
  const subjLine = subj ? `<div class="compact-subject ${subjCfg.bold?"bold":""}" ${fieldFontStyle(subjCfg,"subject")}>${subj}</div>` : "";
  if (cfg.layout === "subject") return subjLine;
  if (cfg.layout === "simple") {
    const roomLine = roomCfg.enabled !== false && item.room ? `<div class="compact-meta ${roomCfg.bold?"bold":""}" ${fieldFontStyle(roomCfg,"room")}>${esc(item.room)}</div>` : "";
    return `${subjLine}${roomLine}`;
  }
  return `${subjLine}${eng}${meta?`<div class="compact-meta" ${fieldFontStyle(teacherCfg,"teacher")}>${esc(meta)}</div>`:""}`;
}
function miniCardDataAttrs(item) {
  const title = [item.subject, item.english, item.teacher, item.room].map(clean).filter(Boolean).join(" / ");
  return ` title="${esc(title)}" data-subject="${esc(item.subject)}" data-english="${esc(item.english)}" data-teacher="${esc(item.teacher)}" data-room="${esc(item.room)}" data-class="${esc(item.class)}"`;
}
function normSpecial(v) { return clean(v).toLowerCase().replace(/[\s·⋅・_\-\/()\[\]]+/g, ""); }
function specialMatchValues(item) {
  return unique([
    item.subject, item.english, item.rawSubject, item.rawLabel,
    item.card?.subject, item.card?.subjectEn, item.card?.label, item.card?.nameKo, item.card?.title,
    item.entry?.groupName, item.entry?.subject, item.entry?.subjectEn
  ]).map(normSpecial).filter(Boolean);
}
function hasCAValue(values) { return values.some(v => v === "ca" || v === normSpecial("동아리활동") || v === normSpecial("Club Activity")); }
function hasSAValue(values) { return values.some(v => v === "sa" || v === normSpecial("자율활동") || v === normSpecial("Self-regulated Activity")); }
function specialLabelForItem(item, selected=[]) {
  if (!selected || !selected.length) return "";
  const values = specialMatchValues(item);
  for (const n of selected) {
    if (String(n).startsWith("__")) continue;
    const k = normSpecial(n);
    if (!k) continue;
    if (k === "ca") { if (hasCAValue(values)) return "CA"; continue; }
    if (k === "sa") { if (hasSAValue(values)) return "SA"; continue; }
    if (values.includes(k)) return clean(n);
  }
  return "";
}

function miniCardHtml(item, fields, splitCount, settings) {
  const specialLabel = specialLabelForItem(item, settings.specialSubjects||[]);
  // r279: 간략 출력 과목은 항상 "1과목 카드 설정"을 기준으로 렌더링합니다.
  // 이전에는 별도 special-card 스타일을 사용해서 CA/SA가 카드 표시 설정을 무시했습니다.
  const effectiveCount = specialLabel ? 1 : splitCount;
  const st=splitStyleFor(effectiveCount, settings);
  const splitFieldsAll = normalizeSplitFields(settings.splitFields, settings.fields);
  const splitFields=normalizeFields(specialLabel ? (splitFieldsAll["1"] || settings.fields) : fields);
  const customBase = st.cfg.font === "custom" ? (fontValueToPx(splitFields.subject?.fontPx, "subject") || st.font.px) : st.font.px;
  const style=`--card-font:${customBase}px;--print-card-font:${Math.max(4, customBase*.74)}px`;
  const layoutClass = `split-${st.key} card-layout-${st.cfg.layout} ${st.cfg.clip ? "clip-text" : "wrap-text"}`;
  const renderItem = specialLabel ? {...item, subject:specialLabel, english:"", teacher:""} : item;
  const layout = st.cfg.layout;
  if (layout !== "standard") return `<div class="mini-card ${layoutClass} ${specialLabel?"special-card":""}" style="${style}"${miniCardDataAttrs(renderItem)}>${compactCardHtml(renderItem,{...st.cfg,layout,splitCount:effectiveCount}, splitFields)}</div>`;
  return `<div class="mini-card ${layoutClass} ${specialLabel?"special-card":""}" style="${style}"${miniCardDataAttrs(renderItem)}>${standardCardHtml(renderItem, splitFields, effectiveCount)}</div>`;
}
function collapseSpecialItems(cellItems, settings) {
  const out=[]; const seen=new Set(); const opts=settings.specialSubjects||[];
  for (const item of cellItems) {
    const label=specialLabelForItem(item, opts);
    if (!label) { out.push(item); continue; }
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({...item, subject:label, english:"", teacher:"", room: opts.includes("__showRoom") ? item.room : "", class: opts.includes("__showClass") ? item.class : "", __specialLabel:label});
  }
  return out;
}
function mergeEquivalentItems(cellItems=[]) {
  if (!Array.isArray(cellItems) || cellItems.length <= 1) return cellItems || [];
  const map = new Map();
  const order = [];
  for (const item of cellItems) {
    const subj = clean(item.subject);
    const key = `${normSpecial(subj)}|${normSpecial(item.english||"")}`;
    if (!subj || !key.replace("|", "")) { order.push(item); continue; }
    if (!map.has(key)) { map.set(key, {...item}); order.push(map.get(key)); continue; }
    const base = map.get(key);
    base.teacher = unique([base.teacher, item.teacher].join(",").split(/,\s*/)).join(", ");
    base.room = unique([base.room, item.room].join(",").split(/,\s*/)).join(", ");
    base.class = sortClassLabels(unique([base.class, item.class].join(",").split(/,\s*/))).join(", ");
  }
  return order;
}
function cellHtml(cellItems) {
  if (!cellItems.length) return `<div class="empty"></div>`;
  const settings=collectSettings();
  const collapsed=collapseSpecialItems(mergeEquivalentItems(cellItems), settings);
  const count = collapsed.length >=5 ? "many" : String(collapsed.length);
  const splitCount = Math.max(1, Math.min(4, collapsed.length));
  const dirs = normalizeSplitDirections(settings.splitDirections);
  const dir = splitCount >= 2 ? (dirs[String(splitCount)] || "auto") : "auto";
  const layout = dir === "auto" ? "" : `layout-${dir}`;
  const visibleItems = collapsed.slice(0,6);
  const fieldsForSplit = normalizeSplitFields(settings.splitFields, settings.fields)[String(splitCount)] || settings.fields;
  return `<div class="lesson-cell count-${count} ${layout}" style="--split-count:${splitCount}">${visibleItems.map(it=>miniCardHtml(it, fieldsForSplit, splitCount, settings)).join("")}</div>`;
}
function tableForEntity(ent) { const labels=periodLabels(); const rows = labels.map((plabel,pidx)=>`<tr><th>${esc(plabel)}</th>${DAYS.map((d,day)=>{ const items=visibleEntriesForScope().filter(e=>e.day===day && e.period===pidx && ent.match(e)).flatMap(e=>entryItems(e,ent,plabel)); return `<td>${cellHtml(items)}</td>`; }).join("")}</tr>`).join(""); return `<table class="tt-table"><thead><tr><th></th>${DAYS.map(d=>`<th>${d}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`; }
function paperClass() { return ($("paper")?.value || "a4-landscape") === "a4-portrait" ? "paper-portrait" : "paper-landscape"; }

function todayLabel() { return new Date().toLocaleDateString("ko-KR"); }
function headerLeftText(defaultText="") { const v=clean($("headerLeft")?.value || ""); return v || clean(defaultText); }
function headerRightText(defaultText="") { const v=clean($("headerRight")?.value || ""); return v || clean(defaultText); }
function titleRowHtml(title, left="", right="") { return `<div class="print-title-row"><div class="title-note title-note-left">${esc(left)}</div><h3>${esc(title)}</h3><div class="title-note title-note-right">${esc(right)}</div></div>`; }
function pageForEntity(ent) { const title=individualTimetableTitle(ent.label); const left=headerLeftText(ent.sub||""); const right=headerRightText(todayLabel()); return `<section class="preview-page ${paperClass()} ${collectSettings().fontScale}">${titleRowHtml(title,left,right)}${tableForEntity(ent)}</section>`; }
function overviewTitle() {
  const base = targetType()==="class" ? "Class Timetable Overview"
    : targetType()==="teacher" ? "Teacher Timetable Overview"
    : targetType()==="room" ? "Room Timetable Overview"
    : "Student Timetable";
  return `${base} · ${selectedSemesterTitle()}`;
}
function balancedChunkList(list, maxSize) {
  const arr = Array.isArray(list) ? list : [];
  const max = Math.max(1, Number(maxSize) || 1);
  const pageCount = Math.max(1, Math.ceil(arr.length / max));
  const out = [];
  let idx = 0;
  for (let page = 0; page < pageCount; page++) {
    const remain = arr.length - idx;
    const remainPages = pageCount - page;
    const take = Math.ceil(remain / remainPages);
    out.push(arr.slice(idx, idx + take));
    idx += take;
  }
  return out;
}
function fixedChunkList(list, size) {
  const arr = Array.isArray(list) ? list : [];
  const take = Math.max(1, Number(size) || 1);
  const out = [];
  for (let idx = 0; idx < arr.length; idx += take) out.push(arr.slice(idx, idx + take));
  return out.length ? out : [[]];
}
function overviewRowGroups(list) {
  const applied = overviewRowsPerPage();
  if (!isOverviewRowsControlProfile()) return balancedChunkList(list, applied);
  const selected = overviewRowsDraftValue(overviewRowsValueFromUi());
  return selected === "auto" ? balancedChunkList(list, applied) : fixedChunkList(list, applied);
}
function overviewRowMetrics(rowCount=1) {
  const n = Math.max(1, Number(rowCount) || 1);
  const printableHmm = paperOrientation() === "portrait" ? 262 : 182;
  const printableHpx = paperOrientation() === "portrait" ? 980 : 650;
  const rowMm = Math.max(10, Math.min(34, printableHmm / n));
  const rowPx = Math.max(38, Math.min(86, printableHpx / n));
  return { rowMm: rowMm.toFixed(2), rowPx: rowPx.toFixed(1) };
}
function overviewCellHtml(cellItems) {
  if (!cellItems.length) return `<div class="empty"></div>`;
  const settings=collectSettings();
  const collapsed=collapseSpecialItems(mergeEquivalentItems(cellItems), settings);
  const visible=collapsed.slice(0,4);
  const splitCount=Math.max(1, Math.min(4, visible.length || 1));
  const count = visible.length >= 5 ? "many" : String(visible.length || 1);
  const dirs = normalizeSplitDirections(settings.splitDirections);
  const dir = splitCount >= 2 ? (dirs[String(splitCount)] || "auto") : "auto";
  const layout = dir === "auto" ? "" : `layout-${dir}`;
  const fields=normalizeSplitFields(settings.splitFields, settings.fields)[String(splitCount)] || settings.fields || normalizeFields(null);
  return `<div class="lesson-cell overview-cell count-${count} ${layout}" style="--split-count:${splitCount}">${visible.map(it=>miniCardHtml(it, fields, splitCount, settings)).join("")}</div>`;
}
function overviewRowsPerPage() {
  const paper = $("paper")?.value || "a4-landscape";
  if (targetType() === "class") return paper === "a4-portrait" ? 4 : 9;
  if (isOverviewRowsControlProfile()) {
    const selected = overviewRowsDraftValue(overviewRowsValueFromUi());
    if (selected !== "auto") return Number(selected);
  }
  return paper === "a4-portrait" ? 8 : 10;
}
function overviewFullPages(ents) {
  const labels=periodLabels();
  const appliedRows = overviewRowsPerPage();
  const rowGroups=overviewRowGroups(ents);
  if (isOverviewRowsControlProfile()) {
    const selected = overviewRowsDraftValue(overviewRowsValueFromUi());
    console.info(`[print-rows:r368] target=${targetType()} selected=${selected} applied=${appliedRows} distribution=${rowGroups.map(group=>group.length).join(",")} entities=${ents.length} pages=${rowGroups.length}`);
  }
  const allEntries=visibleEntriesForScope();
  const pageClass=paperClass();
  const fontClass=collectSettings().fontScale;
  const pages=[];
  const dayHeader = DAYS.map(d=>`<th colspan="${labels.length}">${esc(d)}</th>`).join("");
  const periodHeader = DAYS.map(()=>labels.map(p=>`<th>${esc(p)}</th>`).join("")).join("");
  const colgroup = `<colgroup><col class="corner-col">${DAYS.map(()=>labels.map(()=>`<col class="period-col">`).join("")).join("")}</colgroup>`;
  rowGroups.forEach((group,gi)=>{
    const rows = group.map(ent=>`<tr><th>${esc(ent.label)}</th>${DAYS.map((d,day)=>labels.map((plabel,pidx)=>{
      const items=allEntries.filter(e=>e.day===day && e.period===pidx && ent.match(e)).flatMap(e=>entryItems(e,ent,plabel));
      return `<td>${overviewCellHtml(items)}</td>`;
    }).join("")).join("")}</tr>`).join("");
    const rowPart = rowGroups.length > 1 ? ` · ${gi+1}/${rowGroups.length}` : "";
    const title = `${overviewTitle()}${rowPart}`;
    const left = headerLeftText("Handong International School");
    const right = headerRightText("");
    const fitClass = targetType() === "class" ? "class-overview-fit9" : "";
    const rowMetrics = overviewRowMetrics(group.length);
    const rowStyle = ` style="--overview-rows:${group.length};--overview-row-mm:${rowMetrics.rowMm}mm;--overview-row-px:${rowMetrics.rowPx}px"`;
    pages.push(`<section class="preview-page overview overview-wide dynamic-overview-rows ${fitClass} ${pageClass} ${fontClass}"${rowStyle}>${titleRowHtml(title,left,right)}<table class="tt-table overview-full-days">${colgroup}<thead><tr><th rowspan="2" class="corner-cell"></th>${dayHeader}</tr><tr>${periodHeader}</tr></thead><tbody>${rows}</tbody></table></section>`);
  });
  return pages;
}
function overviewDayPages(ents) {
  const labels=periodLabels();
  const rowGroups=overviewRowGroups(ents);
  const allEntries=visibleEntriesForScope();
  const pageClass=paperClass();
  const fontClass=collectSettings().fontScale;
  const pages=[];
  DAYS.forEach((dayName,day)=>{
    rowGroups.forEach((group,gi)=>{
      const rows = group.map(ent=>`<tr><th>${esc(ent.label)}</th>${labels.map((plabel,pidx)=>{
        const items=allEntries.filter(e=>e.day===day && e.period===pidx && ent.match(e)).flatMap(e=>entryItems(e,ent,plabel));
        return `<td>${overviewCellHtml(items)}</td>`;
      }).join("")}</tr>`).join("");
      const rowPart = rowGroups.length > 1 ? ` · ${gi+1}/${rowGroups.length}` : "";
      const title = `${overviewTitle()} - ${dayName}${rowPart}`;
      const left = headerLeftText("Handong International School");
      const right = headerRightText("");
      pages.push(`<section class="preview-page overview day-view pdf-day-overview ${pageClass} ${fontClass}">${titleRowHtml(title,left,right)}<table class="tt-table"><thead><tr><th></th>${labels.map(p=>`<th>${esc(p)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></section>`);
    });
  });
  return pages;
}
function overviewPages(ents) { return overviewFullPages(ents); }
let zoomFrame = 0;
let zoomClearTimer = 0;
function showRenderOverlay(text="미리보기를 다시 그리는 중입니다…") { const ov=$("renderOverlay"); const tx=$("renderOverlayText"); if (tx) tx.textContent=text; if (ov) ov.classList.add("show"); }
function hideRenderOverlay() { const ov=$("renderOverlay"); if (ov) ov.classList.remove("show"); }
function renderPreviewSafe() {
  try {
    renderPreview();
  } catch (err) {
    console.error('[preview render failed]', err);
    const meta = $("previewMeta");
    if (meta) meta.textContent = "미리보기 렌더링 오류: " + (err && err.message ? err.message : String(err));
    const inner = $("previewInner");
    if (inner) inner.innerHTML = `<section class="preview-page"><div class="disabled-note">시간표 미리보기를 그리는 중 오류가 발생했습니다.<br>${esc(err && err.message ? err.message : String(err))}</div></section>`;
    alert("시간표 미리보기 생성 중 오류가 발생했습니다. 콘솔 로그를 확인해 주세요.");
  } finally {
    hideRenderOverlay();
  }
}
function nextPaint() { return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))); }
function sleep(ms=0) { return new Promise(resolve=>setTimeout(resolve, ms)); }
function scheduleHeavyRender(text="미리보기를 다시 그리는 중입니다…", delay=40) {
  clearTimeout(renderTimer);
  showRenderOverlay(text);
  requestAnimationFrame(()=>{ renderTimer=setTimeout(renderPreviewSafe, delay); });
}
function renderPagesFor(ents, metaPrefix="") {
  const pages = layoutMode()==="overview" ? overviewPages(ents) : ents.map(pageForEntity);
  const inner = $("previewInner");
  const rowsMeta = isOverviewRowsControlProfile() ? ` · 페이지당 최대 ${overviewRowsPerPage()}행` : "";
  $("previewMeta").textContent = `${selectedSemesterLabel()} · ${metaPrefix}${ents.length}개 대상 · ${entries().length}개 배치 · ${cards().length}개 카드${rowsMeta}`;
  inner.innerHTML = pages.length ? pages.join("") : `<section class="preview-page"><div class="disabled-note">출력할 대상이 없습니다. 오른쪽 범위를 확인해 주세요.</div></section>`;
  applyZoom();
}
function renderPreview() {
  if (!dataReady) return;
  renderEntityList();
  const allEnts = selectedEntities();
  const mode = $("previewMode")?.value || "sample";
  const previewEnts = mode === "sample" ? allEnts.slice(0,1) : allEnts;
  const prefix = mode === "sample" && allEnts.length > 1 ? `샘플 ${previewEnts.length}/${allEnts.length} · ` : "";
  renderPagesFor(previewEnts, prefix);
}
function scheduleRender() { scheduleHeavyRender("미리보기를 다시 그리는 중입니다…", 180); }
function applyZoom(anchorEvent=null) {
  const el=$("zoom");
  const sc=$("previewScroll");
  const inner=$("previewInner");
  const oldZoom = Number(inner?.dataset.zoom || 75);
  const z=Math.max(Number(el?.min)||35, Math.min(Number(el?.max)||250, Number(el?.value)||75));
  if (el) el.value = z;
  $("zoomText").textContent=`${z}%`;
  inner.classList.add("is-zooming");
  cancelAnimationFrame(zoomFrame);
  const before = anchorEvent && sc ? { x: anchorEvent.clientX + sc.scrollLeft, y: anchorEvent.clientY + sc.scrollTop, scale: oldZoom ? z/oldZoom : 1 } : null;
  zoomFrame=requestAnimationFrame(()=>{
    inner.style.transform="none";
    inner.style.zoom=`${z}%`;
    inner.dataset.zoom=String(z);
    if (before && Number.isFinite(before.scale)) {
      sc.scrollLeft = before.x * before.scale - anchorEvent.clientX;
      sc.scrollTop = before.y * before.scale - anchorEvent.clientY;
    }
  });
  clearTimeout(zoomClearTimer);
  zoomClearTimer=setTimeout(()=>inner.classList.remove("is-zooming"),180);
}
function preset(name) { const s=collectSettings(); Object.keys(s.fields).forEach(k=>{ s.fields[k].enabled=false; s.fields[k].bold=false; }); if (name==="simple") { s.fields.subject={enabled:true,bold:true,pos:"mc"}; s.fields.room={enabled:true,bold:false,pos:"bc"}; s.cellLayout="auto"; s.applyMode="card"; s.fontScale="normal"; s.splitStyles=structuredClone(SPLIT_DEFAULTS); }
  else if (name==="detail") { FIELD_DEFS.forEach(f=>{ s.fields[f.key]={enabled:true,bold:f.key==="subject"||f.key==="room",pos:f.pos}; }); s.fields.class.pos="tl"; s.fields.period.pos="tr"; s.fields.teacher.pos="bl"; s.fields.room.pos="br"; s.fields.english.pos="bc"; s.fontScale="small"; s.splitStyles={"1":{font:"small",layout:"standard"},"2":{font:"small",layout:"compact"},"3":{font:"xsmall",layout:"simple"},"4":{font:"xsmall",layout:"simple"}}; }
  else { s.fields.subject={enabled:true,bold:true,pos:"mc"}; s.fields.english={enabled:true,bold:false,pos:"bc"}; s.fields.teacher={enabled:true,bold:false,pos:"bl"}; s.fields.room={enabled:true,bold:true,pos:"br"}; s.fields.class={enabled:false,bold:false,pos:"tl"}; s.fields.period={enabled:false,bold:false,pos:"tr"}; s.fontScale="normal"; s.splitStyles=structuredClone(SPLIT_DEFAULTS); }
  applySettings(s,true); markCardApplyNeeded(); }
function initialUi() { buildFieldRows(); const last=lastProfileKey(); const store=readStore(); const base=last && store[last] ? store[last] : defaultSettings(); applySettings(base,false,true); currentScopeType = targetType(); buildScopeUi(); buildSpecialSubjects(); restoreScopeState(scopeMemory[currentScopeType] || base); applying=true; setSplitTab(1); applying=false; renderEntityList(); applySpecialSubjects(base.specialSubjects||[]); updateExportButtonLabel(); updateOverviewRowsControl(); }
function setSplitTab(n) {
  const next = String(n);
  if (!applying) {
    if (!splitFieldDraft) splitFieldDraft = normalizeSplitFields(null);
    splitFieldDraft[String(activeSplitTab || "1")] = readFieldControls();
    syncActiveStyleDraft();
  }
  activeSplitTab = next;
  document.querySelectorAll("[data-split-tab]").forEach(btn => btn.classList.toggle("active", btn.dataset.splitTab === next));
  document.querySelectorAll("[data-split-panel]").forEach(panel => panel.classList.toggle("hidden", panel.dataset.splitPanel !== next));
  if (splitFieldDraft) writeFieldControls(splitFieldDraft[next]);
  // r341: 자르기 옵션은 1~4분할 공통이므로 탭 전환 시 값을 바꾸지 않습니다.
  updateFieldFontInputState();
}

function setupPreviewPan() {
  const sc = $("previewScroll");
  if (!sc || sc.__panReady) return;
  sc.__panReady = true;
  let active=false, sx=0, sy=0, sl=0, st=0;
  sc.addEventListener("pointerdown", e=>{
    if (e.button !== 0) return;
    active=true; sx=e.clientX; sy=e.clientY; sl=sc.scrollLeft; st=sc.scrollTop;
    sc.classList.add("dragging"); sc.setPointerCapture?.(e.pointerId);
  });
  sc.addEventListener("pointermove", e=>{
    if (!active) return;
    sc.scrollLeft = sl - (e.clientX - sx);
    sc.scrollTop = st - (e.clientY - sy);
    e.preventDefault();
  });
  const end=e=>{ if(!active) return; active=false; sc.classList.remove("dragging"); try{sc.releasePointerCapture?.(e.pointerId)}catch{} };
  sc.addEventListener("pointerup", end); sc.addEventListener("pointercancel", end); sc.addEventListener("mouseleave", ()=>{ if(active){ active=false; sc.classList.remove("dragging"); } });
  sc.addEventListener("wheel", e=>{
    if (e.target && e.target.closest && e.target.closest(".sidebar,.topbar,select,input,button")) return;
    e.preventDefault();
    const zEl=$("zoom");
    const current=Number(zEl?.value)||75;
    const step=e.deltaY < 0 ? 10 : -10;
    const next=Math.max(Number(zEl?.min)||35, Math.min(Number(zEl?.max)||250, current+step));
    if (zEl) zEl.value=next;
    applyZoom(e);
  }, {passive:false});
}

function updateExportButtonLabel() {
  updateProfileStatus();
  const btn = $("printBtn");
  if (!btn) return;
  const f = format();
  btn.textContent = f === "word" ? "Word 저장" : "인쇄/PDF";
}
function exportFileName(ext) {
  const kindText = $("outputKind")?.selectedOptions?.[0]?.textContent || "시간표";
  const scope = currentScopeMode();
  const stamp = new Date().toISOString().slice(0,10);
  return `${safeFilePart(kindText)}_${safeFilePart(selectedSemesterLabel())}_${safeFilePart(scope)}_${stamp}.${ext}`;
}
function officeProtectText(value="") {
  let s = clean(value).replace(/\s+/g, " ").trim();
  // Office는 좁은 셀에서 아주 짧은 단어도 문자 단위로 끊는 경우가 있어, 자주 깨지는 패턴은 붙여 둡니다.
  s = s.replace(/영어\s+I\b/g, "영어\u00a0I")
       .replace(/English\s+11\b/g, "English\u00a011")
       .replace(/기본한국어\s*([0-9]+)/g, "기본한국어$1")
       .replace(/삶과\s+종교\s*([0-9]+)/g, "삶과\u00a0종교$1")
       .replace(/스포츠생활\s*([0-9]+)/g, "스포츠생활$1")
       .replace(/체육\s*([0-9]+)/g, "체육$1")
       .replace(/\[\s*/g, "[").replace(/\s*\]/g, "]")
       .replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
  return s;
}

const OFFICE_LAYOUT_PROFILES = Object.freeze({
  "class:individual":   { profile:"class:individual",   mode:"individual", textMode:"subjectEnglishMeta", word:{page:"standard", bodyHalf:14, headerHalf:16}, excel:{bodyStyle:0, headerStyle:1, colWidth:23.2, firstColWidth:4.0, bodyHeight:78} },
  "student:individual": { profile:"student:individual", mode:"individual", textMode:"subjectEnglishMeta", word:{page:"standard", bodyHalf:14, headerHalf:16}, excel:{bodyStyle:0, headerStyle:1, colWidth:23.2, firstColWidth:4.0, bodyHeight:78} },
  "teacher:individual": { profile:"teacher:individual", mode:"individual", textMode:"subjectMeta",        word:{page:"standard", bodyHalf:14, headerHalf:16}, excel:{bodyStyle:0, headerStyle:1, colWidth:23.2, firstColWidth:4.0, bodyHeight:78} },
  "room:individual":    { profile:"room:individual",    mode:"individual", textMode:"subjectMeta",        word:{page:"standard", bodyHalf:14, headerHalf:16}, excel:{bodyStyle:0, headerStyle:1, colWidth:23.2, firstColWidth:4.0, bodyHeight:78} },
  "class:overview":     { profile:"class:overview",     mode:"overview",   textMode:"subject",            word:{page:"wide", bodyHalf:7,  headerHalf:7},  excel:{bodyStyle:4, headerStyle:5, colWidth:4.9, firstColWidth:5.0, bodyHeight:58} },
  "teacher:overview":   { profile:"teacher:overview",   mode:"overview",   textMode:"subjectMeta",        word:{page:"wide", bodyHalf:7,  headerHalf:7},  excel:{bodyStyle:4, headerStyle:5, colWidth:4.9, firstColWidth:5.0, bodyHeight:58} },
  "room:overview":      { profile:"room:overview",      mode:"overview",   textMode:"subjectMeta",        word:{page:"wide", bodyHalf:7,  headerHalf:7},  excel:{bodyStyle:4, headerStyle:5, colWidth:4.9, firstColWidth:5.0, bodyHeight:58} }
});
function officeProfileKey(profile=currentOfficeProfile()) {
  const raw = String(profile || currentOfficeProfile() || "class:individual");
  if (OFFICE_LAYOUT_PROFILES[raw]) return raw;
  const [t="class", m="individual"] = raw.split(":");
  const mode = t === "student" ? "individual" : (m === "overview" ? "overview" : "individual");
  const key = `${t}:${mode}`;
  return OFFICE_LAYOUT_PROFILES[key] ? key : "class:individual";
}
function officeLayoutProfile(profile=currentOfficeProfile()) {
  return OFFICE_LAYOUT_PROFILES[officeProfileKey(profile)] || OFFICE_LAYOUT_PROFILES["class:individual"];
}
function officeModelProfile(model=null) {
  return officeLayoutProfile(model?.profile || currentOfficeProfile());
}
function officeCellDisplayMode(card=null, model=null) {
  return card?.officeTextMode || officeModelProfile(model).textMode || "subjectEnglishMeta";
}
function officePageRatioProfile(model=null) {
  return officeModelProfile(model).word?.page || (isWideOfficeOverview(model) ? "wide" : "standard");
}
const WORD_PAGE_MARGIN_DXA = 360;          // 약 6.35mm: 일반 프린터의 비인쇄 영역까지 고려
const WORD_TABLE_SAFETY_DXA = 80;          // 표 테두리가 인쇄 가능 폭에 걸리지 않도록 남기는 총 안전폭
const WORD_TITLE_ROW_HEIGHT_DXA = 430;      // 제목 영역
const WORD_DAY_HEADER_HEIGHT_LANDSCAPE = 250;
const WORD_DAY_HEADER_HEIGHT_PORTRAIT = 260;
const WORD_BODY_HEIGHT_SCALE_PORTRAIT = 1.06;   // 세로 출력은 r343 검증값 유지
const WORD_BODY_HEIGHT_SCALE_LANDSCAPE = 1.085;  // r344: 가로 출력의 남는 하단 공간을 교시 행에 비례 배분
const WORD_PAGE_BOTTOM_RESERVE_PORTRAIT_DXA = 420;
const WORD_PAGE_BOTTOM_RESERVE_LANDSCAPE_DXA = 180; // 약 3.2mm: 1페이지 안전영역은 유지하면서 본문 높이 확보

function officeWordIsPortrait() {
  return ($("paper")?.value || "a4-landscape") === "a4-portrait";
}
function officeWordPageSize(model=null) {
  const portrait = officeWordIsPortrait();
  const wide = officePageRatioProfile(model) === "wide";
  if (wide) return portrait ? { w:16838, h:23811 } : { w:23811, h:16838 };
  return portrait ? { w:11906, h:16838 } : { w:16838, h:11906 };
}
function officeWordPageMargins() {
  return {
    top: WORD_PAGE_MARGIN_DXA,
    right: WORD_PAGE_MARGIN_DXA,
    bottom: WORD_PAGE_MARGIN_DXA,
    left: WORD_PAGE_MARGIN_DXA
  };
}
function officeWordTitleRowHeight() {
  return WORD_TITLE_ROW_HEIGHT_DXA;
}
function officeWordDayHeaderHeight() {
  return officeWordIsPortrait() ? WORD_DAY_HEADER_HEIGHT_PORTRAIT : WORD_DAY_HEADER_HEIGHT_LANDSCAPE;
}
function officeWordTableWidth(model=null) {
  // r341: 표 폭을 용지의 실제 인쇄 가능 폭에서 계산합니다.
  // 특정 데이터나 특정 연도에 맞춘 숫자가 아니라 용지 크기·여백·안전폭의 함수이므로,
  // 다음 학년도 데이터가 바뀌어도 같은 규칙으로 자동 완성됩니다.
  const page = officeWordPageSize(model);
  const mar = officeWordPageMargins();
  return Math.max(1200, page.w - mar.left - mar.right - WORD_TABLE_SAFETY_DXA);
}

function officeSettingsSnapshot() {
  const s = collectSettings();
  return {
    splitDirections: normalizeSplitDirections(s.splitDirections),
    splitFields: normalizeSplitFields(s.splitFields, s.fields),
    fields: normalizeFields(s.fields),
    splitStyles: normalizeSplitStyles(s.splitStyles),
    specialSubjects: s.specialSubjects || [],
    fontScale: s.fontScale || "normal",
    ellipsisMode: !!s.ellipsisMode
  };
}
function officeSettingsForModel(model=null) {
  return model?.officeSettings || officeSettingsSnapshot();
}
function officeCardsForLayout(cards=[]) {
  return (cards || []).filter(c => c && c.lines && c.lines.length);
}
function officeSplitDirectionForCount(count=1, model=null) {
  if (count <= 1) return "single";
  const dirs = normalizeSplitDirections(officeSettingsForModel(model).splitDirections || {});
  const key = String(Math.max(2, Math.min(4, count)));
  const dir = dirs[key];
  // r341: rows / cols / grid 세 가지 명시 분할만 사용합니다. auto는 여기까지 들어오지 않습니다.
  if (dir === "rows" || dir === "cols" || dir === "grid") return dir;
  return count >= 3 ? "grid" : "cols";
}
function officeCardGridShape(count=1, model=null) {
  const n = Math.max(1, Math.min(4, Number(count) || 1));
  const dir = officeSplitDirectionForCount(n, model);
  if (n <= 1) return { cols:1, rows:1, dir:"single" };
  if (dir === "rows") return { cols:1, rows:n, dir };
  if (dir === "cols") return { cols:n, rows:1, dir };
  return { cols:2, rows:Math.ceil(n/2), dir:"grid" };
}
function officeFieldsForCardCount(model=null, count=1) {
  const st = officeSettingsForModel(model);
  const splitFields = normalizeSplitFields(st.splitFields, st.fields);
  return normalizeFields(splitFields[String(Math.max(1, Math.min(4, Number(count)||1)))] || st.fields || null);
}
function officeCardValue(card={}, key="subject") {
  if (key === "class") return officeProtectText(card.className || card.class || "");
  return officeProtectText(card[key] || "");
}
function officeClipEnabled(model=null, splitCount=1) {
  const st = officeSettingsForModel(model);
  // r341: 화면에 보이는 공통 checkbox만 진실의 원천입니다.
  // 과거 분할별 splitStyles.clip 값은 호환 데이터로만 보존하고 출력 판단에는 사용하지 않습니다.
  return st?.ellipsisMode === true;
}
function officeClipLimit(fieldKey="subject", splitCount=1) {
  const n = Math.max(1, Math.min(4, Number(splitCount) || 1));
  if (fieldKey === "subject") return n <= 1 ? 18 : (n === 2 ? 13 : 10);
  if (fieldKey === "english") return n <= 1 ? 28 : (n === 2 ? 18 : 14);
  if (fieldKey === "teacher") return n <= 1 ? 10 : 7;
  if (fieldKey === "room") return n <= 1 ? 8 : 6;
  return n <= 1 ? 10 : 7;
}
function officeClipText(value="", fieldKey="subject", model=null, splitCount=1) {
  const text = officeProtectText(value);
  if (!text || !officeClipEnabled(model, splitCount)) return text;
  const limit = officeClipLimit(fieldKey, splitCount);
  if (text.length <= limit) return text;
  return text.slice(0, Math.max(1, limit - 1)).trimEnd() + "…";
}
function officeVisualUnits(text="") {
  return Array.from(String(text || "")).reduce((sum, ch) => {
    if (/\s/.test(ch)) return sum + 0.45;
    if (/[\u3131-\u318e\uac00-\ud7a3\u4e00-\u9fff]/.test(ch)) return sum + 1.65;
    if (/[A-Z0-9]/.test(ch)) return sum + 1.0;
    if (/[a-z]/.test(ch)) return sum + 0.82;
    return sum + 0.7;
  }, 0);
}
function officeClipToVisualUnits(text="", maxUnits=12) {
  const src = officeProtectText(text);
  const cap = Math.max(1.5, Number(maxUnits) || 12);
  if (officeVisualUnits(src) <= cap) return src;
  let out = "";
  for (const ch of Array.from(src)) {
    if (officeVisualUnits(out + ch + "…") > cap) break;
    out += ch;
  }
  return (out || src.slice(0,1)).trimEnd() + "…";
}
function officePlacedClipUnits(fieldKey="subject", splitCount=1, place=null, allocatedCols=3) {
  const n = Math.max(1, Math.min(4, Number(splitCount) || 1));
  const span = Math.max(1, Number(place?.colspan) || 1);
  const cols = Math.max(1, Number(allocatedCols) || 3);
  const widthRatio = Math.max(0.34, Math.min(2.2, span / Math.max(3, cols >= 6 ? cols / Math.max(1, Math.ceil(cols / 6)) : 3)));
  if (fieldKey === "subject") return (n <= 1 ? 13.2 : n === 2 ? 11.2 : 9.2) * Math.max(1, span / 3);
  if (fieldKey === "english") return (n <= 1 ? 24.0 : n === 2 ? 18.0 : 13.5) * Math.max(1, span / 3);
  if (fieldKey === "room") return Math.max(5.4, 6.4 * widthRatio);
  if (fieldKey === "teacher" || fieldKey === "class" || fieldKey === "meta") return Math.max(5.8, 7.2 * widthRatio);
  return 10.0 * widthRatio;
}
function officeClipTextForPlace(value="", fieldKey="subject", model=null, splitCount=1, place=null, allocatedCols=3) {
  const text = officeProtectText(value);
  if (!text) return "";
  // r341: 과목/영문명도 사용자가 "긴 과목/영문명 칸에서 자르기"를 켠 경우에만 말줄임표로 자릅니다.
  // 표 크기는 고정하고, 옵션이 꺼져 있으면 Word 셀의 noWrap/고정 높이에서 자연스럽게 잘리도록 둡니다.
  if (!officeClipEnabled(model, splitCount)) return text;
  return officeClipToVisualUnits(text, officePlacedClipUnits(fieldKey, splitCount, place, allocatedCols));
}
function officeCardDisplayValue(card={}, key="subject", model=null, splitCount=1) {
  return officeClipText(officeCardValue(card, key), key, model, splitCount);
}
function officeFieldHalfSize(fieldCfg={}, key="subject", fallback=12) {
  const px = fontValueToPx(fieldCfg.fontPx || fieldCfg.font, key);
  return wordHalfFromPx(px, fallback, 6, 28);
}
function officeFieldHalfSizeForSplit(fieldCfg={}, key="subject", fallback=12, splitCount=1, fieldScale=1) {
  const base = officeFieldHalfSize(fieldCfg, key, fallback);
  // r341: 분할 개수의 임의 고정계수를 중복 적용하지 않습니다.
  // 각 분할 탭의 설정 글꼴을 기준으로, 실제 카드가 차지하는 폭/높이 비율(fieldScale)만 적용합니다.
  const scale = Math.max(0.46, Math.min(1.25, Number(fieldScale) || 1));
  const scaled = Math.round(base * scale);
  const minSize = (key === "room" || key === "teacher" || key === "class" || key === "meta") ? 5 : 6;
  return Math.max(minSize, Math.min(28, scaled));
}
function officeCellFieldScale(cell={}) {
  const n = Number(cell?.fieldScale);
  return Number.isFinite(n) && n > 0 ? Math.max(0.46, Math.min(1.25, n)) : 1;
}
// r364: Word/Office 출력에서 실제로 사용하는 공통 배치 보조 함수입니다.
// r361의 사용하지 않는 XLSX 코드 정리 과정에서 함께 제거되어 런타임 오류가 발생했으므로,
// 호출 경로와 분리된 안정적인 공통 함수로 복구합니다.
function xlsxFieldPt(fieldKey="subject", cfg={}) {
  const px = fontValueToPx(cfg?.fontPx || cfg?.font, fieldKey) || FIELD_FONT_PX_DEFAULTS[fieldKey] || 8;
  return Math.max(5, Math.min(16, Math.round(Number(px) * 0.75 * 10) / 10));
}
function officeFieldVerticalAlign(cfg={}, def={}) {
  return "center";
}
function officeFieldPosition(fieldCfg={}, fieldDef={}) {
  return (fieldCfg && fieldCfg.pos) || fieldDef?.pos || "mc";
}
function officeCellMatrixIndex(pos="mc") {
  const map = { tl:[0,0], tc:[0,1], tr:[0,2], ml:[1,0], mc:[1,1], mr:[1,2], bl:[2,0], bc:[2,1], br:[2,2] };
  return map[pos] || map.mc;
}
function officeCardStructuredIndex(def, cfg) {
  if (def?.key === "subject") return [1, 0];
  if (def?.key === "english") return [2, 0];
  const [rr, cc] = officeCellMatrixIndex(officeFieldPosition(cfg, def));
  return [rr <= 0 ? 0 : 3, cc];
}
function officeCardStructuredColspan(def, cfg) {
  return (def?.key === "subject" || def?.key === "english") ? 3 : 1;
}

function officeFieldScaleForPlacement(fieldKey="subject", cardBand={}, place={}, splitCount=1, model=null) {
  // r341 규칙 엔진:
  // 1) 데이터 글자 수는 크기 계산에 사용하지 않습니다.
  // 2) 카드의 실제 폭/높이, 필드가 차지한 폭, 용지의 실제 표 폭만 비율로 계산합니다.
  // 3) 같은 데이터 구조는 학년도/과목명이 바뀌어도 같은 비율을 얻습니다.
  const totalCols = Math.max(1, Number(cardBand.totalCols) || Number(cardBand.w) || 3);
  const totalRows = Math.max(1, Number(cardBand.totalRows) || Number(cardBand.h) || 4);
  const cardWidthRatio = Math.max(0.12, Math.min(1, Math.max(1, Number(cardBand.w) || 1) / totalCols));
  const cardHeightRatio = Math.max(0.12, Math.min(1, Math.max(1, Number(cardBand.h) || 1) / totalRows));
  const placeWidthRatio = Math.max(0.08, Math.min(1, Math.max(1, Number(place?.colspan) || 1) / totalCols));
  const fullRow = fieldKey === "subject" || fieldKey === "english";
  const expectedWidth = fullRow ? cardWidthRatio : Math.max(0.08, cardWidthRatio / 3);
  const localWidthRatio = Math.max(0.36, Math.min(1.12, placeWidthRatio / expectedWidth));

  // 폭과 높이를 따로 반영합니다. 2×2, 가로, 세로 분할이 같은 개수라도 실제 모양에 따라 달라집니다.
  const widthScale = Math.pow(cardWidthRatio, fullRow ? 0.18 : 0.25) * Math.pow(localWidthRatio, fullRow ? 0.08 : 0.18);
  const heightScale = Math.pow(cardHeightRatio, fullRow ? 0.22 : 0.18);
  const pageWidthRatio = Math.max(0.68, Math.min(1, officeWordTableWidth(model) / 16580));
  const pageScale = Math.pow(pageWidthRatio, 0.22);
  const min = fullRow ? 0.58 : 0.50;
  return Math.max(min, Math.min(1, Math.min(widthScale, heightScale) * pageScale));
}
function officeTextFrom(el) { return officeProtectText(el?.innerText || el?.textContent || ""); }
function cssPxFromEl(el, fallback=0) {
  if (!el) return fallback;
  let raw = "";
  try { raw = getComputedStyle(el).fontSize || ""; } catch(_) {}
  const n = Number(String(raw).replace(/px/i, ""));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
function wordHalfFromPx(px, fallback=12, min=8, max=22) {
  const n = Number(px);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(min, Math.min(max, Math.round(n * 1.5)));
}
function cssBoldFromEl(el) {
  if (!el) return false;
  try {
    const w = getComputedStyle(el).fontWeight || "";
    return /bold/i.test(w) || Number(w) >= 600;
  } catch(_) { return false; }
}
function officeCardFromMini(card) {
  const subjectEl = card.querySelector(".field-subject,.compact-subject");
  const englishEl = card.querySelector(".field-english-inline,.field-english,.compact-sub");
  const teacherEl = card.querySelector(".field-teacher");
  const roomEl = card.querySelector(".field-room,.compact-meta");
  const classEl = card.querySelector(".field-class");
  const subject = officeTextFrom(subjectEl);
  const english = officeTextFrom(englishEl);
  const teacher = officeTextFrom(teacherEl);
  const room = officeTextFrom(roomEl);
  const cls = officeTextFrom(classEl);
  const meta = [teacher, room, cls].filter(Boolean).join(" · ");
  const lines = [subject, english, meta].filter(Boolean);
  // r279: PDF 미리보기에서 이미 적용된 카드 설정(표시 여부/글자 크기/굵게)을 Word/Excel export 모델에 보존합니다.
  // Word는 절대 위치 배치는 어렵지만, 같은 분할/필드 설정의 크기와 표시 상태를 따라가야 합니다.
  return {
    subject, english, teacher, room, className: cls, meta, lines,
    subjectPx: cssPxFromEl(subjectEl, 0),
    englishPx: cssPxFromEl(englishEl, 0),
    metaPx: cssPxFromEl(teacherEl || roomEl || classEl, cssPxFromEl(roomEl, 0)),
    subjectBold: cssBoldFromEl(subjectEl),
    metaBold: cssBoldFromEl(teacherEl || roomEl || classEl)
  };
}
function officeCardsFromCell(cell) {
  const minis = [...cell.querySelectorAll(".mini-card")];
  if (minis.length) {
    const cards = minis.map(officeCardFromMini).filter(c => c.lines.length);
    if (cards.length) return cards;
  }
  const txt=(cell.innerText||"").replace(/\u00a0/g," ").replace(/[ \t]+\n/g,"\n").replace(/\n[ \t]+/g,"\n").trim();
  return txt ? [{subject:"", english:"", teacher:"", room:"", className:"", meta:"", lines:txt.split(/\n+/).map(officeProtectText).filter(Boolean)}] : [];
}
function officeLinesForCard(card, count=1, kind="excel", model=null) {
  const subject = officeProtectText(card.subject || "");
  const english = officeProtectText(card.english || "");
  const meta = officeProtectText(card.meta || [card.teacher, card.room, card.className].map(officeProtectText).filter(Boolean).join(" · "));
  const mode = officeCellDisplayMode(card, model);
  if (mode === "subject") return [subject].filter(Boolean);
  if (mode === "subjectMeta") return [subject, meta].filter(Boolean);
  if (mode === "subjectInlineMeta") return [[subject, meta].filter(Boolean).join(" · ")].filter(Boolean);
  if (count >= 3) return [subject, meta].filter(Boolean);
  if (count === 2) return [subject, english, meta].filter(Boolean);
  return [subject, english, meta].filter(Boolean);
}
function officeCellText(cell, kind="excel", model=null) {
  if (!cell) return "";
  if (cell.header) return cell.text || "";
  const cards = Array.isArray(cell.cards) ? cell.cards : [];
  if (!cards.length) return cell.text || "";
  return cards.map(c => officeLinesForCard(c, cards.length, kind, model).join("\n")).join("\n");
}
function tableToGrid(table) {
  const grid=[]; const merges=[]; const occupied=[];
  [...table.rows].forEach((tr,r)=>{
    if (!grid[r]) grid[r]=[]; if (!occupied[r]) occupied[r]=[];
    let c=0;
    [...tr.cells].forEach(cell=>{
      while(occupied[r][c]) c++;
      const rs=Math.max(1, Number(cell.rowSpan)||1), cs=Math.max(1, Number(cell.colSpan)||1);
      const txt=(cell.innerText||"").replace(/\u00a0/g," ").replace(/[ \t]+\n/g,"\n").replace(/\n[ \t]+/g,"\n").trim();
      grid[r][c]={ text:txt, cards:officeCardsFromCell(cell), header: cell.tagName === "TH" || !!cell.closest?.("thead"), colspan:cs, rowspan:rs };
      if (rs>1 || cs>1) merges.push({r1:r+1,c1:c+1,r2:r+rs,c2:c+cs});
      for(let rr=r; rr<r+rs; rr++){ if(!occupied[rr]) occupied[rr]=[]; if(!grid[rr]) grid[rr]=[]; for(let cc=c; cc<c+cs; cc++){ occupied[rr][cc]=true; if (rr!==r || cc!==c) grid[rr][cc]=grid[rr][cc]||null; } }
      c += cs;
    });
  });
  const cols=Math.max(1,...grid.map(row=>row.length));
  grid.forEach(row=>{ for(let i=0;i<cols;i++) if(row[i]===undefined) row[i]={text:"",header:false}; });
  return {grid, merges, cols};
}
function pagesForExport() {
  renderEntityList();
  const allEnts = selectedEntities();
  renderPagesFor(allEnts, "출력 전체 · ");
  return [...$("previewInner").querySelectorAll(".preview-page")];
}
function exportMatrixHeaderCell(text="", colspan=1) {
  return { text: officeProtectText(text), cards: [], header: true, colspan: Math.max(1, Number(colspan) || 1), rowspan: 1 };
}
function exportMatrixBlankCell(header=false) {
  return { text: "", cards: [], header: !!header, colspan: 1, rowspan: 1 };
}
function exportMetaForItem(item={}, profile=currentOfficeProfile()) {
  const p = officeLayoutProfile(profile);
  const [t="class"] = String(p.profile || "class:individual").split(":");
  const teacher = officeProtectText(item.teacher || "");
  const room = officeProtectText(item.room || "");
  const cls = officeProtectText(item.class || "");
  if (t === "teacher") return [cls, room].filter(Boolean).join(" · ");
  if (t === "room") return [cls, teacher].filter(Boolean).join(" · ");
  return [teacher, room].filter(Boolean).join(" · ");
}
function officeCardFromDataItem(item={}, profile=currentOfficeProfile()) {
  const p = officeLayoutProfile(profile);
  const subject = officeProtectText(item.subject || "");
  const english = officeProtectText(item.english || "");
  const teacher = officeProtectText(item.teacher || "");
  const room = officeProtectText(item.room || "");
  const className = officeProtectText(item.class || "");
  const meta = exportMetaForItem(item, p.profile);
  const lines = [subject, english, meta].filter(Boolean);
  return { subject, english, teacher, room, className, meta, lines, officeProfile:p.profile, officeTextMode:p.textMode, subjectPx: 0, englishPx: 0, metaPx: 0, subjectBold: true, metaBold: false };
}
function exportCardsFromItems(items=[], profile=currentOfficeProfile()) {
  const settings = collectSettings();
  const normalized = collapseSpecialItems(mergeEquivalentItems(items || []), settings);
  return normalized.map(item => officeCardFromDataItem(item, profile)).filter(c => c.lines.length);
}
function exportMatrixCellFromItems(items=[], profile=currentOfficeProfile()) {
  return { text: "", cards: exportCardsFromItems(items, profile), header: false, colspan: 1, rowspan: 1, officeProfile: officeProfileKey(profile) };
}
function exportItemsForSlot(ent, allEntries, day, periodIndex, periodLabel) {
  return allEntries.filter(e => e.day === day && e.period === periodIndex && ent.match(e)).flatMap(e => entryItems(e, ent, periodLabel));
}
function normalizeExportGrid(grid, cols) {
  const colCount = Math.max(1, Number(cols) || 1);
  return (grid || []).map(row => {
    const out = Array.isArray(row) ? row.slice(0, colCount) : [];
    for (let i = 0; i < colCount; i++) {
      const cell = out[i];
      const span = cell && Number(cell.colspan) > 1 ? Math.min(colCount - i, Number(cell.colspan)) : 1;
      for (let k = 1; k < span; k++) out[i + k] = null;
    }
    for (let i = 0; i < colCount; i++) if (out[i] === undefined) out[i] = exportMatrixBlankCell(false);
    return out;
  });
}
function individualExportMatrix(ent, allEntries=visibleEntriesForScope()) {
  const labels = periodLabels();
  const profile = `${targetType()}:individual`;
  const layoutProfile = officeLayoutProfile(profile);
  const grid = [];
  grid.push([exportMatrixHeaderCell(""), ...DAYS.map(d => exportMatrixHeaderCell(d))]);
  labels.forEach((plabel, pidx) => {
    const row = [exportMatrixHeaderCell(plabel)];
    DAYS.forEach((_, day) => row.push(exportMatrixCellFromItems(exportItemsForSlot(ent, allEntries, day, pidx, plabel), profile)));
    grid.push(row);
  });
  return {
    title: individualTimetableTitle(ent.label),
    sub: ent.sub || "",
    leftNote: headerLeftText(ent.sub || ""),
    rightNote: headerRightText(todayLabel()),
    profile: layoutProfile.profile,
    officeProfile: layoutProfile,
    officeSettings: officeSettingsSnapshot(),
    targetType: targetType(),
    layoutMode: "individual",
    source: "data-matrix",
    grid: normalizeExportGrid(grid, DAYS.length + 1),
    merges: [],
    cols: DAYS.length + 1
  };
}
function overviewExportMatrixPages(ents, allEntries=visibleEntriesForScope()) {
  const labels = periodLabels();
  const profile = `${targetType()}:overview`;
  const layoutProfile = officeLayoutProfile(profile);
  const cols = 1 + DAYS.length * labels.length;
  const rowGroups = overviewRowGroups(ents);
  const pages = [];
  rowGroups.forEach((group, gi) => {
    const grid = [];
    const merges = [];
    const dayRow = Array.from({ length: cols }, () => undefined);
    dayRow[0] = exportMatrixHeaderCell("");
    DAYS.forEach((dayName, day) => {
      const start = 1 + day * labels.length;
      dayRow[start] = exportMatrixHeaderCell(dayName, labels.length);
      if (labels.length > 1) merges.push({ r1: 1, c1: start + 1, r2: 1, c2: start + labels.length });
    });
    const periodRow = Array.from({ length: cols }, () => undefined);
    periodRow[0] = exportMatrixHeaderCell("");
    DAYS.forEach((_, day) => labels.forEach((plabel, pidx) => { periodRow[1 + day * labels.length + pidx] = exportMatrixHeaderCell(plabel); }));
    grid.push(dayRow, periodRow);
    group.forEach(ent => {
      const row = Array.from({ length: cols }, () => exportMatrixBlankCell(false));
      row[0] = exportMatrixHeaderCell(ent.label);
      DAYS.forEach((_, day) => labels.forEach((plabel, pidx) => {
        row[1 + day * labels.length + pidx] = exportMatrixCellFromItems(exportItemsForSlot(ent, allEntries, day, pidx, plabel), profile);
      }));
      grid.push(row);
    });
    const part = rowGroups.length > 1 ? ` ${gi + 1}/${rowGroups.length}` : "";
    pages.push({
      title: `${overviewTitle()}${part}`,
      sub: headerLeftText("Handong International School"),
      leftNote: headerLeftText("Handong International School"),
      rightNote: headerRightText(""),
      profile: layoutProfile.profile,
      officeProfile: layoutProfile,
      officeSettings: officeSettingsSnapshot(),
      targetType: targetType(),
      layoutMode: "overview",
      source: "data-matrix",
      grid: normalizeExportGrid(grid, cols),
      merges,
      cols
    });
  });
  return pages;
}
function sheetModelsFromData() {
  renderEntityList();
  const ents = selectedEntities();
  const allEntries = visibleEntriesForScope();
  return layoutMode() === "overview" ? overviewExportMatrixPages(ents, allEntries) : ents.map(ent => individualExportMatrix(ent, allEntries));
}
function sheetModelsFromPreview() {
  // r299: Word/Excel은 더 이상 화면 DOM을 해석하지 않고, 시간표 데이터에서 표준 ExportMatrix를 직접 작성합니다.
  // PDF/미리보기 렌더러와 Office 출력 모델을 분리해야 7개 출력종류 × 가로/세로 × Word/Excel을 안정적으로 확장할 수 있습니다.
  return sheetModelsFromData();
}
function wText(text="") {
  const lines=String(text||"").replace(/\r/g,"").split(/\n/);
  return lines.map((line,i)=>`${i?"<w:br/>":""}<w:t xml:space="preserve">${xmlEsc(line)}</w:t>`).join("");
}
function wSafeLineTwips(line=0, size=12, text="") {
  // r318: Word에서 글자 윗부분이 잘리는 주원인은 셀 여백이 아니라
  // 폰트 크기보다 작은 exact line-height입니다. w:sz는 half-point, w:line은 twip이므로
  // 최소 줄높이를 글자 크기보다 크게 잡아야 한글/영문 ascender가 잘리지 않습니다.
  const sz = Math.max(1, Number(size) || 12);
  const requested = Math.max(0, Number(line) || 0);
  if (!String(text || "").trim() && sz <= 2) return Math.max(18, requested || 18);
  const minLine = Math.ceil(sz * 12.4); // (sz/2 pt) * 20 twip * 1.24
  return Math.max(requested || 0, minLine, 96);
}
function wPara(text="", opts={}) {
  const bold=opts.bold?"<w:b/>":"";
  const sizeVal = Math.max(1, Number(opts.size || 12));
  const sz=opts.size?`<w:sz w:val="${sizeVal}"/><w:szCs w:val="${sizeVal}"/>`:"";
  const color=opts.color?`<w:color w:val="${opts.color}"/>`:"";
  const noBreak=opts.noBreak?"<w:noBreak/>":"";
  const charScale = opts.charScale ? `<w:w w:val="${Math.max(70, Math.min(100, Math.round(Number(opts.charScale)||100)))}"/>` : "";
  const charSpacing = opts.charSpacing ? `<w:spacing w:val="${Math.max(-30, Math.min(30, Math.round(Number(opts.charSpacing)||0)))}"/>` : "";
  const jc=opts.align?`<w:jc w:val="${opts.align}"/>`:"";
  const line = wSafeLineTwips(opts.line || 0, sizeVal, text);
  const lineRule = opts.lineRule || "atLeast";
  const spacing=`<w:spacing w:before="0" w:after="0" w:line="${line}" w:lineRule="${lineRule}"/>`;
  return `<w:p><w:pPr>${jc}${spacing}</w:pPr><w:r><w:rPr>${bold}${sz}${color}${noBreak}${charScale}${charSpacing}<w:rFonts w:ascii="Malgun Gothic" w:hAnsi="Malgun Gothic" w:eastAsia="맑은 고딕"/></w:rPr>${wText(text)}</w:r></w:p>`;
}
function officeWordHalfSize(text="", opts={}) {
  const profile = officeModelProfile(opts.model || { profile: opts.officeProfile || opts.profile });
  if (opts.header) return profile.word?.headerHalf || (opts.wideOverview ? 8 : (opts.overview ? 11 : 16));
  if (opts.overview) return profile.word?.bodyHalf || (opts.wideOverview ? 7 : 10);
  return docxCellSize(text, !!opts.header, !!opts.overview, !!opts.wideOverview);
}
function wNoBorderTcPr(width=400, span=1) {
  const gridSpan = span > 1 ? `<w:gridSpan w:val="${span}"/>` : "";
  return `<w:tcPr><w:tcW w:w="${Math.max(1, Math.round(width))}" w:type="dxa"/>${gridSpan}<w:vAlign w:val="center"/><w:tcMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tcMar><w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tcBorders></w:tcPr>`;
}
function wSemanticTc(paras="", width=400, span=1) {
  return `<w:tc>${wNoBorderTcPr(width, span)}${paras || wPara("",{size:1,line:18})}</w:tc>`;
}
function wCardFieldPara(value="", fieldKey="subject", cfg={}, def={}, opts={}, splitCount=1) {
  const text = officeClipText(value, fieldKey, opts.model || { profile: opts.officeProfile || opts.profile }, splitCount);
  if (!text) return "";
  const isSubject = fieldKey === "subject";
  const isEnglish = fieldKey === "english";
  const fallback = isSubject ? 15 : (isEnglish ? 9 : 8);
  const size = officeFieldHalfSizeForSplit(cfg, fieldKey, fallback, splitCount);
  const color = isEnglish ? "475569" : (isSubject ? "111827" : "334155");
  const line = isSubject ? 104 : (isEnglish ? 76 : 70);
  // r341: 위치는 3/1/1/3 내부 어느 칸에 놓을지만 결정하고, 실제 텍스트는 그 칸 안에서 항상 가운데 정렬합니다.
  const align = "center";
  return wPara(text,{bold:!!cfg.bold,align,size,line,color,noBreak:true,charScale:92,charSpacing:-3});
}
function wOfficeCard3x3(card={}, opts={}, splitCount=1, totalW=1600, totalH=500) {
  const fields = officeFieldsForCardCount(opts.model || { profile: opts.officeProfile || opts.profile }, splitCount);
  const matrix = Array.from({length:4},()=>Array.from({length:3},()=>[]));
  FIELD_DEFS.forEach(def => {
    const cfg = fields[def.key] || def;
    if (cfg.enabled === false) return;
    const value = officeCardValue(card, def.key);
    if (!value) return;
    const [r,c] = officeCardStructuredIndex(def, cfg);
    matrix[r][c].push(wCardFieldPara(value, def.key, cfg, def, opts, splitCount));
  });
  const { widths, heights } = card3x3Dimensions(totalW, totalH);
  const rows = matrix.map((row, r) => {
    if (r === 1 || r === 2) {
      const paras = row.flat().join("") || wPara("",{size:1,line:18});
      return `<w:tr><w:trPr><w:trHeight w:val="${heights[r]}" w:hRule="atLeast"/></w:trPr>${wSemanticTc(paras, totalW, 3)}</w:tr>`;
    }
    return `<w:tr><w:trPr><w:trHeight w:val="${heights[r]}" w:hRule="atLeast"/></w:trPr>${row.map((paras,c)=>wSemanticTc(paras.join("") || wPara("",{size:1,line:18}), widths[c])).join("")}</w:tr>`;
  }).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${totalW}" w:type="dxa"/><w:jc w:val="center"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders></w:tblPr><w:tblGrid>${widths.map(w=>`<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${rows}</w:tbl>`;
}
function wOfficeCardsGrid(cards=[], opts={}) {
  const list = officeCardsForLayout(cards).slice(0,6);
  if (!list.length) return "";
  const count = Math.max(1, Math.min(4, list.length));
  const shape = officeCardGridShape(count, opts.model || { profile: opts.officeProfile || opts.profile });
  const { totalW, gridCols, rowH } = cardGridDimensions(opts.width || 1600, shape.rows, shape.cols, !!opts.overview);
  let idx = 0;
  const rows = [];
  for (let r=0; r<shape.rows; r++) {
    const tcs=[];
    for (let c=0; c<shape.cols; c++) {
      const card = list[idx++];
      const w = gridCols[c] || gridCols[0] || 900;
      tcs.push(wSemanticTc(card ? wOfficeCard3x3(card, opts, count, w, rowH) : wPara("",{size:1,line:18}), w));
    }
    rows.push(`<w:tr><w:trPr><w:trHeight w:val="${rowH}" w:hRule="atLeast"/></w:trPr>${tcs.join("")}</w:tr>`);
  }
  return `<w:tbl><w:tblPr><w:tblW w:w="${totalW}" w:type="dxa"/><w:jc w:val="center"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders></w:tblPr><w:tblGrid>${gridCols.map(w=>`<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${rows.join("")}</w:tbl>`;
}
function wordCellBody(text="", opts={}, sz=12) {
  const cards = Array.isArray(opts.cards) ? opts.cards.filter(c=>c && c.lines && c.lines.length) : [];
  if (!opts.header && cards.length) return wOfficeCardsGrid(cards, opts);
  if (!opts.header && opts.fieldKey) {
    const cfg = opts.fieldCfg || {};
    const def = opts.fieldDef || FIELD_DEFS.find(x => x.key === opts.fieldKey) || {};
    const scale = Number(opts.fieldScale || 1);
    const size = officeFieldHalfSizeForSplit(cfg, opts.fieldKey, sz, opts.splitCount || 1, scale);
    const align = "center";
    const color = opts.fieldKey === "english" ? "475569" : (opts.fieldKey === "subject" ? "111827" : "334155");
    const tightField = opts.fieldKey === "room" || opts.fieldKey === "teacher" || opts.fieldKey === "class" || opts.fieldKey === "meta";
    const charScale = tightField ? 82 : 90;
    const charSpacing = tightField ? -8 : -4;
    return wPara(officeProtectText(text),{bold:!!cfg.bold,align,size,line:Math.max(58, Math.min(130, Math.round(size*10.4))),color,noBreak:true,charScale,charSpacing});
  }
  return wPara(officeProtectText(text),{bold:opts.header,align:"center",size:sz,line:Math.max(100, Math.min(150, sz*12)),noBreak:String(text||"").length<=18});
}


function wBorderXmlValue(kind="") {
  if (kind === "nil" || kind === "none" || kind === "hidden") return { val:"nil" };
  return kind === "dashed" ? { val:"dashed", sz:3, color:"94A3B8" } : { val:"single", sz:4, color:"111827" };
}
function wTcBordersXml(borders=null) {
  if (!borders) return "";
  const sides = ["top","left","bottom","right"].filter(k => borders[k]);
  if (!sides.length) return "";
  const xml = sides.map(k => {
    const b = wBorderXmlValue(borders[k]);
    if (b.val === "nil") return `<w:${k} w:val="nil"/>`;
    return `<w:${k} w:val="${b.val}" w:sz="${b.sz}" w:space="0" w:color="${b.color}"/>`;
  }).join("");
  return `<w:tcBorders>${xml}</w:tcBorders>`;
}

function wCell(text="", opts={}) {
  const span=opts.colspan>1?`<w:gridSpan w:val="${opts.colspan}"/>`:"";
  const vMerge = opts.vmerge === "restart" ? `<w:vMerge w:val="restart"/>` : (opts.vmerge === "continue" ? `<w:vMerge/>` : "");
  const fill=opts.header?`<w:shd w:fill="F1F5F9"/>`:"";
  const sz=opts.size || officeWordHalfSize(text, opts);
  const def = opts.fieldDef || FIELD_DEFS.find(x => x.key === opts.fieldKey) || {};
  const cfg = opts.fieldCfg || {};
  const vAlign = (!opts.header && opts.fieldKey) ? officeFieldVerticalAlign(cfg, def) : "center";
  const mar=`<w:tcMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tcMar>`;
  const body = opts.vmerge === "continue" ? wPara("",{size:1,line:18}) : wordCellBody(text,opts,sz);
  const noWrapCell = (!opts.header && opts.fieldKey) ? "<w:noWrap/>" : "";
  const borders = wTcBordersXml(opts.borders || null);
  return `<w:tc><w:tcPr><w:tcW w:w="${opts.width||1600}" w:type="dxa"/>${span}${vMerge}<w:vAlign w:val="${vAlign}"/>${fill}${mar}${borders}${noWrapCell}</w:tcPr>${body}</w:tc>`;
}
function wordFlatRowKind(row=[]) {
  const cells = (row || []).filter(c => c && !c.skip);
  // r341: 교시 표시 셀이 세로 병합되어 같은 내부 행에 존재해도,
  // 그 행 전체를 header로 보면 과목/영문/하단 행 높이 비율 계산이 모두 무너집니다.
  // 행 전체가 헤더인 경우만 header로 보고, 데이터 셀이 섞인 행은 필드 위치 기준으로 계산합니다.
  if (cells.length && cells.every(c => c.header)) return "header";
  const keys = new Set(cells.map(c => c.fieldKey || "").filter(Boolean));
  if (keys.has("subject")) return "subject";
  if (keys.has("english")) return "english";
  if (keys.has("teacher") || keys.has("room") || keys.has("class") || keys.has("meta")) return "meta";
  if (cells.some(c => String(c.text || "").trim())) return "text";
  return "blank";
}
function officeFlatRowKind(row=[]) {
  return wordFlatRowKind(row);
}
function officeFlatPositionKind(model=null, idx=0, row=[]) {
  const meta = model?.officeFlatRowMeta?.[idx];
  if (!meta || meta.sourceRow == null) return officeFlatRowKind(row);
  const headerRows = isOverviewModel(model) ? 2 : 1;
  if (meta.sourceRow < headerRows) return "header";
  const k = Math.max(0, Number(meta.unitIndex) || 0) % 4;
  return k === 0 ? "top" : (k === 1 ? "subject" : (k === 2 ? "english" : "bottom"));
}
function officeFlatRowMaxHalfSize(row=[], posKind="blank") {
  const cells = (row || []).filter(c => c && !c.skip && c.fieldKey);
  if (!cells.length) return posKind === "subject" ? 16 : (posKind === "english" ? 10 : 8);
  return Math.max(...cells.map(c => {
    let fallback = 8;
    if (c.fieldKey === "subject") fallback = 15;
    else if (c.fieldKey === "english") fallback = 9;
    return officeFieldHalfSizeForSplit(c.fieldCfg || {}, c.fieldKey, fallback, c.splitCount || 1, officeCellFieldScale(c));
  }));
}
function officeFlatRowMetricRatio(model=null, idx=0, row=[]) {
  const posKind = officeFlatPositionKind(model, idx, row);
  if (posKind === "header") return 1;
  const half = officeFlatRowMaxHalfSize(row, posKind);
  const line = wSafeLineTwips(0, half, "가A");
  // 셀 여백은 0. 행의 몫은 해당 위치에 설정된 글꼴의 안전 줄높이로만 계산합니다.
  const factor = posKind === "subject" ? 1.04
    : (posKind === "english" ? 1.00
    : (posKind === "top" || posKind === "bottom" || posKind === "meta" || posKind === "text" ? 0.96 : 0.48));
  return Math.max(18, line * factor);
}
function officeFlatSiblingRatioTotal(model=null, idx=0) {
  return officeFlatSiblingIndexes(model, idx)
    .map(i => officeFlatRowMetricRatio(model, i, (model?.grid || [])[i] || []))
    .reduce((a,b)=>a+b,0) || 1;
}
function officeWordLandscapeThreeRowDirectMin(row=[]) {
  if (officeWordIsPortrait()) return 0;
  const protectedCells = (row || []).filter(c => {
    if (!c || c.skip || c.vmerge) return false;
    if (Number(c.splitCount || 1) !== 3 || Number(c.splitRows || 1) !== 3 || Number(c.splitCols || 1) !== 1) return false;
    if (c.fieldKey !== "subject" && c.fieldKey !== "english") return false;
    return !!officeProtectText(c.text || "").trim();
  });
  if (!protectedCells.length) return 0;
  return Math.max(...protectedCells.map(c => {
    const key = c.fieldKey || "";
    const fallback = key === "subject" ? 15 : 9;
    const size = officeFieldHalfSizeForSplit(c.fieldCfg || {}, key, fallback, c.splitCount || 1, officeCellFieldScale(c));
    const requested = Math.max(58, Math.round(Number(size || fallback) * 10.4));
    const line = wSafeLineTwips(requested, size, officeProtectText(c.text || ""));
    // 제목은 굵은 글꼴의 상·하단이 exact 행에서 잘리지 않도록 2twip만 추가합니다.
    return Math.ceil(line + (key === "subject" ? 2 : 0));
  }));
}
function officeWordLandscapeThreeRowAllocatedHeights(model=null, idx=0, overview=false, dayOverview=false, wideOverview=false) {
  const indexes = officeFlatSiblingIndexes(model, idx);
  const rows = indexes.map(i => (model?.grid || [])[i] || []);
  const mins = rows.map(r => officeWordLandscapeThreeRowDirectMin(r));
  if (!mins.some(v => v > 0)) return null;

  const total = Math.max(indexes.length * 18, Math.round(officeFlatLogicalRowBudget("word", model, idx, overview, dayOverview, wideOverview)));
  const ratios = indexes.map((i, n) => officeFlatRowMetricRatio(model, i, rows[n]));
  const minInts = mins.map(v => Math.max(18, Math.ceil(v || 18)));
  if (minInts.reduce((a,b)=>a+b,0) > total) return null;

  const ints = allocateProportionalHeights(total, ratios, minInts);
  return new Map(indexes.map((sourceIndex, i) => [sourceIndex, ints[i]]));
}
function officeFlatRatioHeight(kind="word", row=[], model=null, idx=0, overview=false, dayOverview=false, wideOverview=false) {
  const posKind = officeFlatPositionKind(model, idx, row);
  if (posKind === "header") return officeFlatBudgetedHeight(kind, row, model, idx, overview, dayOverview, wideOverview);
  if (kind === "word") {
    const protectedHeights = officeWordLandscapeThreeRowAllocatedHeights(model, idx, overview, dayOverview, wideOverview);
    if (protectedHeights?.has(idx)) return protectedHeights.get(idx);
  }
  const ratioSum = officeFlatSiblingRatioTotal(model, idx);
  const myRatio = officeFlatRowMetricRatio(model, idx, row);
  const baseBudget = officeFlatLogicalRowBudget(kind, model, idx, overview, dayOverview, wideOverview);
  // r341: 한 교시의 고정 총높이를 설정 글꼴의 비율로만 나눕니다. 실제 문자열 길이는 표 크기를 바꾸지 않습니다.
  const val = baseBudget * myRatio / ratioSum;
  return kind === "excel" ? Math.round(val * 10) / 10 : Math.max(18, Math.round(val));
}
function officeFlatPositionBaseHeight(kind="word", posKind="blank", row=[]) {
  if (kind === "excel") {
    if (posKind === "header") return 13.5;
    if (posKind === "subject") return 16.0;
    if (posKind === "english") return 11.8;
    if (posKind === "top" || posKind === "bottom" || posKind === "meta" || posKind === "text") return 10.4;
    return 4.0;
  }
  if (posKind === "header") return 168;
  if (posKind === "blank") return 34;
  const half = officeFlatRowMaxHalfSize(row, posKind);
  const line = wSafeLineTwips(0, half, "가A");
  if (posKind === "subject") return Math.ceil(line * 1.20);
  if (posKind === "english") return Math.ceil(line * 1.08);
  if (posKind === "top" || posKind === "bottom" || posKind === "meta" || posKind === "text") return Math.ceil(line * 1.02);
  return 34;
}
function officeFlatRowWeight(row=[]) {
  const kind = officeFlatRowKind(row);
  if (kind === "header") return 1;
  if (kind === "subject") return 3.4;
  if (kind === "english") return 2.25;
  if (kind === "meta" || kind === "text") return 2.05;
  return 0.65;
}
function officeFlatSiblingIndexes(model=null, idx=0) {
  const meta = model?.officeFlatRowMeta?.[idx];
  if (!meta || meta.sourceRow == null) return [idx];
  const arr = [];
  (model?.officeFlatRowMeta || []).forEach((m,i)=>{
    if (m && m.sourceRow === meta.sourceRow) arr.push(i);
  });
  return arr.length ? arr : [idx];
}
function officeFlatSiblingWeightTotal(model=null, idx=0) {
  return officeFlatSiblingIndexes(model, idx)
    .map(i => officeFlatRowWeight((model?.grid || [])[i] || []))
    .reduce((a,b)=>a+b,0) || 1;
}
function officeLogicalSourceRowCount(model=null) {
  const meta = model?.officeFlatRowMeta || [];
  if (meta.length) return Math.max(1, ...meta.map(m => Math.max(0, Number(m?.sourceRow) || 0))) + 1;
  return Math.max(1, Number(model?.grid?.length) || 1);
}
function officeLogicalBodyRowCount(model=null) {
  const headerRows = isOverviewModel(model) ? 2 : 1;
  return Math.max(1, officeLogicalSourceRowCount(model) - headerRows);
}
function officeWordFixedBodyHeight(model=null, overview=false, dayOverview=false, wideOverview=false) {
  // r341 규칙:
  // 1) r340에서 검증된 한 반 1페이지 표 높이를 기준값으로 둡니다.
  // 2) 남아 있던 하단 공간을 사용해 전체 교시 영역만 약 6% 확대합니다.
  // 3) 확대값은 용지 실제 높이 - 상하 여백 - 제목 - 요일 - 페이지 안전영역을 절대 넘지 않습니다.
  // 4) 실제 교시 수가 바뀌면 이 고정 총높이를 교시 수로 다시 나누므로 모든 교시 높이는 계속 동일합니다.
  if (overview || dayOverview || wideOverview) return wideOverview ? 620 * Math.max(1, officeLogicalBodyRowCount(model)) : 900 * Math.max(1, officeLogicalBodyRowCount(model));
  const portrait = officeWordIsPortrait();
  const base = portrait ? 11620 : 9520;
  const scale = portrait ? WORD_BODY_HEIGHT_SCALE_PORTRAIT : WORD_BODY_HEIGHT_SCALE_LANDSCAPE;
  const reserve = portrait ? WORD_PAGE_BOTTOM_RESERVE_PORTRAIT_DXA : WORD_PAGE_BOTTOM_RESERVE_LANDSCAPE_DXA;
  const page = officeWordPageSize(model);
  const mar = officeWordPageMargins();
  const safeMax = page.h - mar.top - mar.bottom - officeWordTitleRowHeight() - officeWordDayHeaderHeight() - reserve;
  return Math.max(base, Math.min(Math.round(base * scale), Math.floor(safeMax)));
}
function officeFlatLogicalRowBudget(kind="word", model=null, idx=0, overview=false, dayOverview=false, wideOverview=false) {
  const meta = model?.officeFlatRowMeta?.[idx];
  const portrait = officeWordIsPortrait();
  const headerRows = overview ? 2 : 1;
  if (meta && meta.sourceRow < headerRows) {
    if (kind === "excel") return overview ? 13 : 16;
    return (!overview && !dayOverview && !wideOverview) ? officeWordDayHeaderHeight() : (wideOverview ? 165 : 210);
  }
  if (kind === "excel") {
    const lpExcel = officeModelProfile(model).excel || {};
    return Math.max(34, Number(lpExcel.bodyHeight) || (overview ? 58 : 78));
  }
  const bodyRows = officeLogicalBodyRowCount(model);
  return officeWordFixedBodyHeight(model, overview, dayOverview, wideOverview) / bodyRows;
}
function officeFieldRequiredLineCount(text="", fieldKey="", kind="word") {
  const t = String(text || "").trim();
  if (!t) return 1;
  // r341: 셀 높이는 자동 줄바꿈을 전제로 키우지 않습니다.
  // 긴 과목/영문명은 폭 기준으로 미리 자르고, Word/Excel에서는 한 줄 유지가 원칙입니다.
  return Math.max(1, t.split(/\n/).length);
}
function officeWordFieldRequiredHeight(cell={}) {
  const fieldKey = cell?.fieldKey || "";
  const text = officeProtectText(cell?.text || "");
  if (cell?.header) return 176;
  if (!text && !fieldKey) return 34;
  const def = cell?.fieldDef || FIELD_DEFS.find(x => x.key === fieldKey) || {};
  const cfg = cell?.fieldCfg || {};
  let fallback = 8;
  if (fieldKey === "subject") fallback = 15;
  else if (fieldKey === "english") fallback = 9;
  const size = fieldKey ? officeFieldHalfSizeForSplit(cfg, fieldKey, fallback, cell?.splitCount || 1, officeCellFieldScale(cell)) : docxCellSize(text, false, false, false);
  const requested = Math.max(58, Math.round(Number(size || 8) * 10.4));
  const line = wSafeLineTwips(requested, size, text);
  const lines = officeFieldRequiredLineCount(text, fieldKey, "word");
  const boldPad = cfg?.bold ? 10 : 0;
  const cellPad = 8; // r341: 셀 내부 여백은 0으로 두고, 테두리/Word 내부 보정만 최소 반영
  return Math.ceil(line * lines + cellPad + boldPad);
}
function officeExcelFieldRequiredHeight(cell={}) {
  const fieldKey = cell?.fieldKey || "";
  const text = officeProtectText(cell?.text || "");
  if (cell?.header) return 13.5;
  if (!text && !fieldKey) return 4.0;
  const def = cell?.fieldDef || FIELD_DEFS.find(x => x.key === fieldKey) || {};
  const cfg = cell?.fieldCfg || {};
  const pt = fieldKey ? xlsxFieldPt(fieldKey, cfg) : 8.2;
  const lines = officeFieldRequiredLineCount(text, fieldKey, "excel");
  const boldPad = cfg?.bold ? 0.8 : 0;
  return Math.round((pt * 1.34 * lines + 3.2 + boldPad) * 10) / 10;
}
function officeFlatMinHeight(kind="word", row=[]) {
  const cells = (row || []).filter(c => c && !c.skip);
  const k = officeFlatRowKind(row);
  if (!cells.length) return kind === "excel" ? 4.0 : 34;
  const required = Math.max(...cells.map(c => kind === "excel" ? officeExcelFieldRequiredHeight(c) : officeWordFieldRequiredHeight(c)));
  if (kind === "excel") {
    if (k === "header") return Math.max(13.5, required);
    if (k === "subject") return Math.max(16.5, required);
    if (k === "english") return Math.max(13.0, required);
    if (k === "meta" || k === "text") return Math.max(12.5, required);
    return Math.max(4.0, required);
  }
  // r341: 고정 최솟값으로 모든 행을 같게 키우지 않습니다.
  // 행 위치별 기본값 + 실제 분할별 글꼴 크기로 계산한 required만 사용합니다.
  if (k === "header") return Math.max(160, required);
  if (k === "subject") return Math.max(96, required);
  if (k === "english") return Math.max(72, required);
  if (k === "meta" || k === "text") return Math.max(60, required);
  return Math.max(28, required);
}
function officeFlatBudgetedHeight(kind="word", row=[], model=null, idx=0, overview=false, dayOverview=false, wideOverview=false) {
  const posKind = officeFlatPositionKind(model, idx, row);
  const min = officeFlatMinHeight(kind, row);
  const base = officeFlatPositionBaseHeight(kind, posKind, row);
  // r341: 행 높이는 내용이 우연히 길어졌다고 제각각 달라지면 안 됩니다.
  // 같은 논리 교시 안의 4행 구조(상단/과목/영문/하단)는 위치별 기준 높이를 먼저 적용하고,
  // 실제 폰트 기준 최소값이 더 클 때만 보정합니다.
  const val = Math.max(base, min);
  return kind === "excel" ? Math.round(val * 10) / 10 : Math.round(val);
}
function wordFlatRowHeight(row=[], model=null, idx=0, total=1, overview=false, dayOverview=false, wideOverview=false) {
  const kind = wordFlatRowKind(row);
  const portrait = officeWordIsPortrait();
  const compact = !overview && !dayOverview && !wideOverview;
  if (kind === "header") return compact ? officeWordDayHeaderHeight() : (wideOverview ? 165 : 210);
  if (model?.officeFlatRowMeta?.[idx]) return officeFlatRatioHeight("word", row, model, idx, overview, dayOverview, wideOverview);
  if (kind === "subject") return compact ? (portrait ? 300 : 280) : (wideOverview ? 190 : 230);
  if (kind === "english") return compact ? (portrait ? 240 : 220) : (wideOverview ? 170 : 200);
  if (kind === "meta") return compact ? (portrait ? 230 : 210) : (wideOverview ? 160 : 190);
  if (kind === "text") return compact ? (portrait ? 230 : 210) : (wideOverview ? 160 : 190);
  return compact ? (portrait ? 150 : 130) : (wideOverview ? 100 : 120);
}
function wordRowHeight(idx, total, overview=false, dayOverview=false, wideOverview=false, row=null, model=null) {
  if (model?.flatOffice) return wordFlatRowHeight(row || [], model, idx, total, overview, dayOverview, wideOverview);
  if (idx === 0) return wideOverview ? 170 : (overview ? 220 : 270);
  if (overview && idx === 1) return wideOverview ? 150 : 190;
  const bodyRows=Math.max(1,total-(overview?2:1));
  const usable=wideOverview ? 15100 : (dayOverview ? 10000 : (overview ? 9200 : 10720));
  return Math.max(wideOverview ? 980 : (dayOverview ? 760 : 620), Math.floor(usable/bodyRows));
}
function wordTableWidths(colCount, overview=false, dayOverview=false, model=null) {
  return computeWordTableWidths(officeWordTableWidth(model), colCount, overview, dayOverview, isWideOfficeOverview(model));
}
function wordTableXml(model) {
  const colCount=Math.max(1,model.cols||1);
  const overview = model.layoutMode === "overview" || /전체표/.test(model.title||"");
  const dayOverview = !!model.wordDayOverview;
  const wideOverview = isWideOfficeOverview(model);
  const { tblW, widths } = wordTableWidths(colCount, overview, dayOverview, model);
  const rows=model.grid.map((row,ridx)=>{
    let tcs="";
    row.forEach((cell,cidx)=>{ if(cell && !cell.skip) tcs += wCell(officeCellText(cell, "word", model),{cards:cell.cards,header:cell.header,colspan:cell.colspan,width:wordSpanWidth(widths,cidx,cell.colspan),overview,wideOverview,model,officeProfile:model.profile,fieldKey:cell.fieldKey,fieldCfg:cell.fieldCfg,fieldDef:cell.fieldDef,fieldScale:cell.fieldScale||1,splitCount:cell.splitCount||1,splitRows:cell.splitRows||1,splitCols:cell.splitCols||1,vmerge:cell.vmerge,borders:cell.borders}); });
    const rowHeight = wordRowHeight(ridx, model.grid.length, overview, dayOverview, wideOverview, row, model);
    return `<w:tr><w:trPr><w:trHeight w:val="${rowHeight}" w:hRule="exact"/><w:cantSplit/></w:trPr>${tcs}</w:tr>`;
  }).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${tblW}" w:type="dxa"/><w:jc w:val="center"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar><w:tblBorders><w:top w:val="single" w:sz="8"/><w:left w:val="single" w:sz="8"/><w:bottom w:val="single" w:sz="8"/><w:right w:val="single" w:sz="8"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid>${widths.map(width=>`<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>${rows}</w:tbl>`;
}


function isOverviewModel(model) {
  return model?.layoutMode === "overview" || /전체표/.test(model?.title || "");
}
function isWideOfficeOverview(model) {
  return isOverviewModel(model) && Number(model?.cols || 0) >= 30;
}

function officeSubcellTextForCard(card={}, intraR=1, intraC=1, model=null, splitCount=1) {
  const fields = officeFieldsForCardCount(model, splitCount);
  const parts = [];
  FIELD_DEFS.forEach(def => {
    const cfg = fields[def.key] || def;
    if (cfg.enabled === false) return;
    const value = officeCardDisplayValue(card, def.key, model, splitCount);
    if (!value) return;
    const [rr, cc] = officeCardStructuredIndex(def, cfg);
    if (rr === intraR && cc === intraC) parts.push(value);
  });
  return parts.join("\n");
}
function officeCellRequiredGrid(cell={}, model=null) {
  if (!cell || cell.header) return { cols: 1, rows: 1, count: 0, shape: { cols: 1, rows: 1 } };
  const cards = officeCardsForLayout(cell.cards || []);
  if (!cards.length) return { cols: 1, rows: 1, count: 0, shape: { cols: 1, rows: 1 } };
  const count = Math.max(1, Math.min(4, cards.length));
  const shape = officeCardGridShape(count, model);
  return { cols: Math.max(3, (shape.cols || 1) * 3), rows: Math.max(4, (shape.rows || 1) * 4), count, shape };
}
function officeBlankFlatCell(header=false) {
  return { text:"", cards:[], header:!!header, colspan:1, rowspan:1, flat:true };
}
function officeTextFlatCell(text="", header=false, colspan=1, meta={}) {
  return {
    text:officeProtectText(text),
    cards:[],
    header:!!header,
    colspan:Math.max(1, Number(colspan)||1),
    rowspan:Math.max(1, Number(meta.rowspan)||1),
    flat:true,
    fieldKey: meta.fieldKey || "",
    fieldCfg: meta.fieldCfg || null,
    fieldDef: meta.fieldDef || null,
    splitCount: Math.max(1, Math.min(4, Number(meta.splitCount) || 1)),
    splitRows: Math.max(1, Number(meta.splitRows) || 1),
    splitCols: Math.max(1, Number(meta.splitCols) || 1),
    fieldScale: Math.max(0.38, Math.min(1.25, Number(meta.fieldScale) || 1)),
    vmerge: meta.vmerge || "",
    borders: meta.borders || null
  };
}
function officeSpanSkipCell() {
  return { text:"", cards:[], header:false, colspan:1, rowspan:1, flat:true, skip:true };
}
function officeBandStart(index=0, total=1, bands=1) {
  return Math.max(0, Math.min(total, Math.floor((Number(index)||0) * total / Math.max(1, bands))));
}
function officeBandSpanStartEnd(index=0, total=1, bands=1) {
  const start = officeBandStart(index, total, bands);
  const end = Math.max(start + 1, officeBandStart(index + 1, total, bands));
  return [start, Math.min(total, end)];
}
function officeMergeBorders(...items) {
  const out = {};
  items.filter(Boolean).forEach(b => ["top","left","bottom","right"].forEach(k => { if (b[k]) out[k] = b[k]; }));
  return Object.keys(out).length ? out : null;
}
function officeCardOwnerGrid(rows=1, cols=1) {
  return Array.from({length:Math.max(1, Number(rows)||1)},()=>Array.from({length:Math.max(1, Number(cols)||1)},()=>null));
}
function officeMarkCardOwner(owner, cardBand={}, cardId=0) {
  if (!Array.isArray(owner) || !owner.length) return;
  const r0 = Math.max(0, Number(cardBand.r0) || 0);
  const r1 = Math.min(owner.length, Math.max(r0 + 1, Number(cardBand.r1) || r0 + 1));
  const c0 = Math.max(0, Number(cardBand.c0) || 0);
  const c1 = Math.min(owner[0]?.length || 0, Math.max(c0 + 1, Number(cardBand.c1) || c0 + 1));
  for (let r=r0; r<r1; r++) for (let c=c0; c<c1; c++) owner[r][c] = cardId;
}
function officeOwnerAt(owner, r=0, c=0) {
  if (!Array.isArray(owner) || r < 0 || c < 0 || r >= owner.length || c >= (owner[r] || []).length) return null;
  return owner[r][c];
}
function officeHasDifferentOwnerAcross(owner, side="right", r=0, c=0, rowspan=1, colspan=1) {
  const rows = owner.length || 1;
  const cols = owner[0]?.length || 1;
  const r0 = Math.max(0, Number(r)||0);
  const c0 = Math.max(0, Number(c)||0);
  const rs = Math.max(1, Number(rowspan)||1);
  const cs = Math.max(1, Number(colspan)||1);
  if (side === "left") {
    if (c0 <= 0) return false;
    for (let rr=r0; rr<Math.min(rows, r0+rs); rr++) if (officeOwnerAt(owner, rr, c0-1) !== officeOwnerAt(owner, rr, c0)) return true;
    return false;
  }
  if (side === "right") {
    if (c0 + cs >= cols) return false;
    for (let rr=r0; rr<Math.min(rows, r0+rs); rr++) if (officeOwnerAt(owner, rr, c0+cs-1) !== officeOwnerAt(owner, rr, c0+cs)) return true;
    return false;
  }
  if (side === "top") {
    if (r0 <= 0) return false;
    for (let cc=c0; cc<Math.min(cols, c0+cs); cc++) if (officeOwnerAt(owner, r0-1, cc) !== officeOwnerAt(owner, r0, cc)) return true;
    return false;
  }
  if (side === "bottom") {
    if (r0 + rs >= rows) return false;
    for (let cc=c0; cc<Math.min(cols, c0+cs); cc++) if (officeOwnerAt(owner, r0+rs-1, cc) !== officeOwnerAt(owner, r0+rs, cc)) return true;
    return false;
  }
  return false;
}
function officeSlotBoundaryBorders(owner, r=0, c=0, cell={}) {
  // r341: 점선은 “분할 경계” 한쪽에서만 그립니다.
  // - 카드 내부 3/1/1/3 보조 구조는 모두 nil 처리해 보이지 않게 유지합니다.
  // - 1분할은 점선 없음.
  // - 2~4분할은 가로/세로/2x2 분할에서 카드 소유자가 달라지는 경계만 점선입니다.
  // - 같은 경계를 양쪽 셀이 중복해서 그리면 Word에서 끊기거나 진해지므로 right/bottom 한쪽만 사용합니다.
  const rows = owner.length || 1;
  const cols = owner[0]?.length || 1;
  const span = Math.max(1, Number(cell?.colspan) || 1);
  const rowSpan = Math.max(1, Number(cell?.rowspan) || 1);
  const b = { top:"nil", left:"nil", bottom:"nil", right:"nil" };

  // 논리 시간표 칸의 외곽선은 실선입니다.
  if (r <= 0) b.top = "single";
  if (c <= 0) b.left = "single";
  if (r + rowSpan >= rows) b.bottom = "single";
  else if (officeHasDifferentOwnerAcross(owner, "bottom", r, c, rowSpan, span)) b.bottom = "dashed";
  if (c + span >= cols) b.right = "single";
  else if (officeHasDifferentOwnerAcross(owner, "right", r, c, rowSpan, span)) b.right = "dashed";

  return b;
}
function officeApplyCardSlotBorders(out=[], owner=null, splitCount=1) {
  if (!Array.isArray(out) || !out.length || !Array.isArray(owner)) return out;
  for (let r=0; r<out.length; r++) {
    for (let c=0; c<(out[r] || []).length; c++) {
      const cell = out[r][c];
      if (!cell || cell.skip || cell.header) continue;
      cell.borders = officeSlotBoundaryBorders(owner, r, c, cell);
    }
  }
  return out;
}
function officeBordersForVMergePart(borders=null, part="single") {
  if (!borders) return null;
  const out = {};
  if (borders.left) out.left = borders.left;
  if (borders.right) out.right = borders.right;
  if ((part === "single" || part === "start") && borders.top) out.top = borders.top;
  if ((part === "single" || part === "end") && borders.bottom) out.bottom = borders.bottom;
  return Object.keys(out).length ? out : null;
}
function officePlaceFlatText(out, r, c, text="", colspan=1, meta={}) {
  if (!out[r] || c < 0 || c >= out[r].length) return;
  const force = !!meta.force;
  const incoming = officeProtectText(text);
  if (!incoming && !force) return;
  const span = Math.max(1, Math.min(Number(colspan)||1, out[r].length - c));
  const rowSpan = Math.max(1, Math.min(Number(meta.rowspan)||1, out.length - r));
  const current = out[r][c];
  const hasCurrentText = !!(current && current.text);
  const mergedText = hasCurrentText && incoming ? [current.text, incoming].filter(Boolean).join("\n") : (incoming || (hasCurrentText ? current.text : ""));
  const mergedMeta = hasCurrentText
    ? { ...meta, fieldKey: current.fieldKey || meta.fieldKey || "", fieldCfg: current.fieldCfg || meta.fieldCfg || null, fieldDef: current.fieldDef || meta.fieldDef || null, fieldScale: current.fieldScale || meta.fieldScale || 1, borders: officeMergeBorders(current.borders, meta.borders) }
    : meta;
  const allBorders = officeMergeBorders(current?.borders, mergedMeta.borders);
  // r341: 병합은 카드 내부 3/1/1/3 구조를 깨는 것이 아니라, 1~4분할 슬롯 범위를 카드가 차지하도록 만드는 작업입니다.
  // 2~4분할 카드 사이의 내부 경계만 점선으로 표시합니다.
  out[r][c] = officeTextFlatCell(mergedText, false, span, { ...mergedMeta, rowspan:rowSpan, vmerge:rowSpan > 1 ? "restart" : "", borders: officeBordersForVMergePart(allBorders, rowSpan > 1 ? "start" : "single") });
  for (let i=1; i<span; i++) out[r][c+i] = officeSpanSkipCell();
  for (let rr=r+1; rr<r+rowSpan; rr++) {
    if (!out[rr]) continue;
    const part = rr === r + rowSpan - 1 ? "end" : "middle";
    out[rr][c] = officeTextFlatCell("", false, span, { ...mergedMeta, rowspan:1, vmerge:"continue", borders: officeBordersForVMergePart(allBorders, part) });
    for (let i=1; i<span; i++) out[rr][c+i] = officeSpanSkipCell();
  }
}
function officeHeaderMergeBlock(cell={}, rows=1, cols=1) {
  // r341: 요일/교시 표시 영역은 내부 분할 격자에 끌려가면 안 됩니다.
  // 특히 교시 셀은 같은 논리 교시의 모든 내부 행을 세로 병합합니다.
  const rCount = Math.max(1, Number(rows) || 1);
  const cCount = Math.max(1, Number(cols) || 1);
  const out = Array.from({length:rCount},()=>Array.from({length:cCount},()=>officeBlankFlatCell(true)));
  officePlaceFlatText(out, 0, 0, cell?.text || "", cCount, { rowspan:rCount, force:true });
  for (let r=0; r<rCount; r++) {
    for (let c=0; c<cCount; c++) {
      if (out[r][c]) out[r][c].header = true;
    }
  }
  return out;
}
function officeCardBandPlacement(cardRow=0, cardCol=0, shapeRows=1, shapeCols=1, rows=1, cols=1, count=1, dir="grid") {
  // r341: 최대 4분할 슬롯을 기준으로, 카드가 차지해야 할 슬롯 범위를 먼저 병합합니다.
  // 카드 내부는 그 병합된 범위 안에서 다시 3/1/1/3 구조로 나뉘므로 반/교사/교실 위치 규칙은 깨지지 않습니다.
  const totalRows = Math.max(1, Number(rows) || 1);
  const totalCols = Math.max(1, Number(cols) || 1);
  const n = Math.max(1, Math.min(4, Number(count) || 1));
  const sr = Math.max(1, Number(shapeRows) || 1);
  const sc = Math.max(1, Number(shapeCols) || 1);
  let r0 = 0, r1 = totalRows, c0 = 0, c1 = totalCols;

  if (n >= 4) {
    [r0, r1] = officeBandSpanStartEnd(cardRow, totalRows, sr);
    [c0, c1] = officeBandSpanStartEnd(cardCol, totalCols, sc);
  } else if (n === 3 && dir === "grid" && sr === 2 && sc === 2) {
    if (Number(cardRow) === 0) {
      [r0, r1] = officeBandSpanStartEnd(0, totalRows, 2);
      [c0, c1] = officeBandSpanStartEnd(cardCol, totalCols, 2);
    } else {
      [r0, r1] = officeBandSpanStartEnd(1, totalRows, 2);
      c0 = 0; c1 = totalCols;
    }
  } else if (sr === 1 && sc > 1) {
    // 가로 분할: 각 카드가 전체 높이를 차지합니다.
    r0 = 0; r1 = totalRows;
    [c0, c1] = officeBandSpanStartEnd(cardCol, totalCols, sc);
  } else if (sc === 1 && sr > 1) {
    // 세로 분할: 각 카드가 전체 폭을 차지합니다.
    [r0, r1] = officeBandSpanStartEnd(cardRow, totalRows, sr);
    c0 = 0; c1 = totalCols;
  } else {
    [r0, r1] = officeBandSpanStartEnd(cardRow, totalRows, sr);
    [c0, c1] = officeBandSpanStartEnd(cardCol, totalCols, sc);
  }
  return { r0, r1, c0, c1, totalRows, totalCols, h:Math.max(1, r1-r0), w:Math.max(1, c1-c0) };
}
function officeFieldBandPlacement(cardBand, def, cfg) {
  const [rr, cc] = officeCardStructuredIndex(def, cfg);
  const [localR0, localR1] = officeBandSpanStartEnd(rr, cardBand.h, 4);
  const tr = cardBand.r0 + localR0;
  const rowSpan = Math.max(1, localR1 - localR0);
  const fullRow = officeCardStructuredColspan(def, cfg) > 1;
  if (fullRow) {
    return { r:tr, c:cardBand.c0, rowspan:rowSpan, colspan:Math.max(1, cardBand.w) };
  }
  const [localC0, localC1] = officeBandSpanStartEnd(cc, cardBand.w, 3);
  return { r:tr, c:cardBand.c0 + localC0, rowspan:rowSpan, colspan:Math.max(1, localC1 - localC0) };
}
function officeCardBandGroupPlacement(cardBand, intraR=0, intraC=0) {
  const [localR0, localR1] = officeBandSpanStartEnd(intraR, cardBand.h, 4);
  const r = cardBand.r0 + localR0;
  const rowspan = Math.max(1, localR1 - localR0);
  if (intraR === 1 || intraR === 2) {
    return { r, c:cardBand.c0, rowspan, colspan:Math.max(1, cardBand.w) };
  }
  const [localC0, localC1] = officeBandSpanStartEnd(intraC, cardBand.w, 3);
  return { r, c:cardBand.c0 + localC0, rowspan, colspan:Math.max(1, localC1 - localC0) };
}
function officePlaceCardBandSkeleton(out, card={}, cardBand, model=null, splitCount=1, fields=null) {
  const groupTexts = Array.from({length:4},()=>Array.from({length:3},()=>[]));
  const groupMeta = Array.from({length:4},()=>Array.from({length:3},()=>null));
  const cardFields = fields || officeFieldsForCardCount(model, splitCount);
  FIELD_DEFS.forEach(def => {
    const cfg = cardFields[def.key] || def;
    if (cfg.enabled === false) return;
    const [rr, cc] = officeCardStructuredIndex(def, cfg);
    const groupC = (def.key === "subject" || def.key === "english") ? 0 : cc;
    const place = officeCardBandGroupPlacement(cardBand, rr, groupC);
    const value = officeClipTextForPlace(officeCardValue(card, def.key), def.key, model, splitCount, place, cardBand.w);
    if (!value) return;
    groupTexts[rr][groupC].push(value);
    if (!groupMeta[rr][groupC]) groupMeta[rr][groupC] = { fieldKey:def.key, fieldCfg:cfg, fieldDef:def, fieldScale:officeFieldScaleForPlacement(def.key, cardBand, place, splitCount, model), splitCount, splitRows:1, splitCols:1 };
  });
  for (let rr=0; rr<4; rr++) {
    const cols = (rr === 1 || rr === 2) ? [0] : [0,1,2];
    cols.forEach(cc => {
      const place = officeCardBandGroupPlacement(cardBand, rr, cc);
      if (place.r >= out.length || place.c >= (out[place.r] || []).length) return;
      const text = groupTexts[rr][cc].join("\n");
      const meta = groupMeta[rr][cc] || { splitCount, splitRows:1, splitCols:1 };
      officePlaceFlatText(out, place.r, place.c, text, place.colspan, { ...meta, rowspan:place.rowspan, force:true });
    });
  }
}
function officeExpandCellIntoFlatGrid(cell={}, allocatedRows=1, allocatedCols=1, model=null) {
  const rows = Math.max(1, allocatedRows|0);
  const cols = Math.max(1, allocatedCols|0);
  const out = Array.from({length:rows},()=>Array.from({length:cols},()=>officeBlankFlatCell(false)));
  if (!cell) return out;
  if (cell.header) {
    officePlaceFlatText(out, 0, 0, cell.text || "", cols, {});
    out[0][0].header = true;
    return out;
  }
  const cards = officeCardsForLayout(cell.cards || []);
  if (!cards.length) {
    const text = officeCellText(cell, "excel", model);
    if (text) officePlaceFlatText(out, 0, 0, text, cols, { fieldKey: cell.fieldKey || "", fieldCfg: cell.fieldCfg || null, fieldDef: cell.fieldDef || null });
    return out;
  }
  // r341: 한 교시 칸 안에서 1~4분할을 먼저 계산하고, 카드가 차지하는 슬롯 범위를 병합합니다.
  // 카드 내부 3/1/1/3 구조는 병합된 카드 범위 안에서 다시 유지합니다.
  const count = Math.max(1, Math.min(4, cards.length));
  const shape = officeCardGridShape(count, model);
  const maxCardCols = Math.max(1, shape.cols || 1);
  const maxCardRows = Math.max(1, shape.rows || 1);
  const fields = officeFieldsForCardCount(model, count);
  const owner = officeCardOwnerGrid(rows, cols);
  cards.slice(0,4).forEach((card, idx) => {
    const cardRow = Math.floor(idx / maxCardCols);
    const cardCol = idx % maxCardCols;
    if (cardRow >= maxCardRows) return;
    const cardBand = officeCardBandPlacement(cardRow, cardCol, maxCardRows, maxCardCols, rows, cols, count, shape.dir || "grid");
    officeMarkCardOwner(owner, cardBand, idx + 1);
    officePlaceCardBandSkeleton(out, card, cardBand, model, count, fields);
  });
  officeApplyCardSlotBorders(out, owner, count);
  return out;
}
function officeFlattenModelToRealGrid(model) {
  if (!model || model.flatOffice) return model;
  const originalRows = model.grid || [];
  const logicalCols = Math.max(1, model.cols || Math.max(1, ...originalRows.map(r => (r||[]).length)));
  const colUnits = Array.from({length:logicalCols},()=>1);
  const rowUnits = Array.from({length:originalRows.length},()=>1);
  originalRows.forEach((row, r) => {
    (row || []).forEach((cell, c) => {
      if (!cell || cell.header || c >= logicalCols) return;
      const need = officeCellRequiredGrid(cell, model);
      colUnits[c] = Math.max(colUnits[c] || 1, need.cols);
      rowUnits[r] = Math.max(rowUnits[r] || 1, need.rows);
    });
  });
  // r341: 요일 너비 고정. 한 요일에 4분할이 있어도 다른 요일과 전체 너비가 달라지면 안 됩니다.
  // 첫 열은 교시 표시 열로 두고, 월~금 논리 열은 모두 같은 내부 단위 수를 사용합니다.
  if (!isOverviewModel(model) && logicalCols > 1) {
    const maxDayUnits = Math.max(1, ...colUnits.slice(1).map(v => Math.max(1, Number(v) || 1)));
    for (let c=1; c<logicalCols; c++) colUnits[c] = maxDayUnits;
  }
  const newGrid = [];
  const flatRowMeta = [];
  originalRows.forEach((row, r) => {
    const rowCount = Math.max(1, rowUnits[r] || 1);
    const outRows = Array.from({length:rowCount},()=>[]);
    for (let c=0; c<logicalCols; c++) {
      const cell = (row || [])[c];
      const colCount = Math.max(1, colUnits[c] || 1);
      const headerRows = isOverviewModel(model) ? 2 : 1;
      const block = (cell && cell.header && c === 0 && rowCount > 1 && r >= headerRows)
        ? officeHeaderMergeBlock(cell, rowCount, colCount)
        : officeExpandCellIntoFlatGrid(cell, rowCount, colCount, model);
      for (let rr=0; rr<rowCount; rr++) {
        for (let cc=0; cc<colCount; cc++) outRows[rr].push(block[rr][cc] || officeBlankFlatCell(false));
      }
    }
    outRows.forEach((_, rr) => flatRowMeta.push({ sourceRow:r, unitIndex:rr, unitCount:rowCount }));
    newGrid.push(...outRows);
  });
  return {
    ...model,
    title: model.title,
    source: "flat-office-rule-engine-r341",
    flatOffice: true,
    officeGridUnits: { rowUnits, colUnits },
    officeFlatRowMeta: flatRowMeta,
    grid: newGrid,
    cols: colUnits.reduce((a,b)=>a+(b||1),0),
    merges: []
  };
}

const WORD_TABLE_COL_LIMIT = 63;
function officeEstimatedFlatColCount(model) {
  if (!model || model.flatOffice) return Math.max(1, Number(model?.cols || 1));
  const rows = model.grid || [];
  const logicalCols = Math.max(1, model.cols || Math.max(1, ...rows.map(r => (r||[]).length)));
  const colUnits = Array.from({length:logicalCols},()=>1);
  rows.forEach((row)=>{
    (row || []).forEach((cell,c)=>{
      if (!cell || cell.header || c >= logicalCols) return;
      const need = officeCellRequiredGrid(cell, model);
      colUnits[c] = Math.max(colUnits[c] || 1, need.cols || 1);
    });
  });
  return colUnits.reduce((a,b)=>a+(b||1),0);
}
function wordSafeModelForExport(model) {
  // Word는 한 표의 열 수가 63개를 넘으면 파일이 열리지 않을 수 있습니다.
  // 학급/교사/교실 전체표는 35교시 × 내부 3x3 격자로 확장하면 100열을 넘으므로,
  // Word 전체표만 논리 교시 1칸 구조로 보존하고 Excel/개별표는 실제 격자를 유지합니다.
  const estimated = officeEstimatedFlatColCount(model);
  if (isOverviewModel(model) && estimated > WORD_TABLE_COL_LIMIT) {
    return { ...model, wordOverviewSafeGrid: true, source: "word-overview-safe-rule-engine-r341" };
  }
  return officeFlattenModelToRealGrid(model);
}
function wordModelsForExport(models) {
  // r318: Word 전체표 저장은 UI/내보내기에서 제거되었습니다. 개별 Word는 가로/세로 모두 같은 실제 격자 구조를 유지합니다.
  // 구조 변경 없이 카드 표시 설정(표시/위치/굵기/글자 크기/칸 자르기)만 반영합니다.
  return (models || []).map(wordSafeModelForExport);
}
function excelModelsForExport(models) {
  // r318: Excel은 전체/개별 모두 실제 격자를 유지하고 카드 표시 설정을 반영합니다.
  // 가로/세로 프로필을 나누지 않고 같은 XLSX 구조로 저장합니다.
  return (models || []).map(officeFlattenModelToRealGrid);
}
function officeProfileSummary(models) {
  const profile = currentOfficeProfile();
  return { profile, printProfile: currentPrintProfileKey(), pages: models.length, known: PRINT_PROFILE_MATRIX.includes(currentPrintProfileKey()), totalProfiles: PRINT_PROFILE_MATRIX.length };
}

function wordHeaderRowXml(model) {
  const left = model.leftNote || "";
  const right = model.rightNote || "";
  const wideOverview = isWideOfficeOverview(model);
  const tblW = officeWordTableWidth(model);
  const sideW = Math.max(2200, Math.round(tblW * (officePageRatioProfile(model) === "wide" ? 0.20 : 0.22)));
  const centerW = tblW - sideW*2;
  const row = `<w:tr><w:trPr><w:trHeight w:val="${officeWordTitleRowHeight()}" w:hRule="exact"/><w:cantSplit/></w:trPr>` +
    `<w:tc><w:tcPr><w:tcW w:w="${sideW}" w:type="dxa"/><w:vAlign w:val="center"/><w:tcMar><w:top w:w="18" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="18" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tcMar><w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders></w:tcPr>${wPara(left,{align:"left",size:11,line:132,color:"475569",noBreak:left.length<=26})}</w:tc>` +
    `<w:tc><w:tcPr><w:tcW w:w="${centerW}" w:type="dxa"/><w:vAlign w:val="center"/><w:tcMar><w:top w:w="18" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="18" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tcMar><w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders></w:tcPr>${wPara(model.title,{bold:true,align:"center",size:22,line:276,noBreak:true})}</w:tc>` +
    `<w:tc><w:tcPr><w:tcW w:w="${sideW}" w:type="dxa"/><w:vAlign w:val="center"/><w:tcMar><w:top w:w="18" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="18" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tcMar><w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders></w:tcPr>${wPara(right,{align:"right",size:11,line:132,color:"475569",noBreak:right.length<=26})}</w:tc>` +
    `</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${tblW}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="${sideW}"/><w:gridCol w:w="${centerW}"/><w:gridCol w:w="${sideW}"/></w:tblGrid>${row}</w:tbl>`;
}
const buildDocxBlob = createDocxBuilder({
  wordModelsForExport,
  isWideOfficeOverview,
  officeWordPageSize,
  officeWordPageMargins,
  wordHeaderRowXml,
  wordTableXml,
  isPortrait: () => ($("paper")?.value || "a4-landscape") === "a4-portrait",
});

function excelGradeFromClassLabel(label="") {
  const m = String(label || "").match(/(\d{1,2})\s*[A-Z]?/i);
  return m ? `${m[1]}학년` : "";
}
function excelDbGradeForItem(ent={}, item={}) {
  const entSub = clean(ent.sub || "");
  if (/\d+\s*학년/.test(entSub)) return entSub;
  const itemClass = clean(item.class || ent.classLabel || "");
  return excelGradeFromClassLabel(itemClass) || entSub || "";
}
function excelDbRowsForExport() {
  // r341: Excel은 더 이상 출력용 표 모양을 흉내 내지 않습니다.
  // 데이터베이스 다운로드 전용: 학년/이름/과목/영문/교사/교실 6개 컬럼만 제공합니다.
  renderEntityList();
  const ents = selectedEntities();
  const allEntries = visibleEntriesForScope();
  const labels = periodLabels();
  const rows = [["학년", "이름", "과목", "영문", "교사", "교실"]];
  ents.forEach(ent => {
    DAYS.forEach((_, day) => {
      labels.forEach((plabel, pidx) => {
        const items = exportItemsForSlot(ent, allEntries, day, pidx, plabel);
        items.forEach(item => {
          rows.push([
            excelDbGradeForItem(ent, item),
            clean(ent.label || item.class || ""),
            clean(item.subject || ""),
            clean(item.english || ""),
            clean(item.teacher || ""),
            clean(item.room || "")
          ]);
        });
      });
    });
  });
  return rows;
}
function downloadExcelDatabase() {
  if (!dataReady) return;
  downloadBlobFile(exportFileName("xlsx"), buildXlsxDatabaseBlob(excelDbRowsForExport()));
}

function exportOfficeReal(kind) {
  if (!dataReady) return;
  const models = sheetModelsFromPreview();
  if (kind === "excel") downloadBlobFile(exportFileName("xlsx"), buildXlsxDatabaseBlob(excelDbRowsForExport()));
  else downloadBlobFile(exportFileName("docx"), buildDocxBlob(models));
  setTimeout(renderPreview, 250);
}
const exportPdfReal = createPdfExporter({
  isDataReady: () => dataReady,
  showRenderOverlay,
  nextPaint,
  renderEntityList,
  selectedEntities,
  isPortrait: () => paperOrientation() === "portrait",
  pagesForEntities: allEnts => layoutMode() === "overview" ? overviewPages(allEnts) : allEnts.map(pageForEntity),
  exportTitle: () => exportFileName("pdf").replace(/\.pdf$/i, ""),
  escapeHtml: esc,
  sleep,
  setPreviewMeta: text => { const el = $("previewMeta"); if (el) el.textContent = text; },
  previewMetaText: allEnts => `${selectedSemesterLabel()} · 출력 전체 · ${allEnts.length}개 대상 · ${entries().length}개 배치 · ${cards().length}개 카드`,
  hideRenderOverlay,
});

function exportOffice(kind) {
  if (kind === "word" && isOverviewProfile()) {
    const fmt = $("format");
    if (fmt) fmt.value = "pdf";
    updateExportButtonLabel();
    return exportPdfReal();
  }
  return exportOfficeReal(kind);
}
function runMainExport() {
  const f = format();
  if (f === "word") return exportOffice("word");
  return exportPdfReal();
}
function wireEvents() { setupPreviewPan(); ["outputKind"].forEach(id=>$(id).addEventListener("change", switchProfile)); $("format")?.addEventListener("change",()=>{ updateExportButtonLabel(); markDirty("출력 형식 변경됨"); }); document.body.addEventListener("change", e=>{ if (applying) return;
 if (e.target.id === "format") { updateExportButtonLabel(); markDirty("출력 형식 변경됨"); return; }
 if (targetType() === "student" && e.target.matches('[data-scope-key]')) { document.querySelectorAll('[data-scope-key]').forEach(el=>{ if (el !== e.target) el.checked = false; }); e.target.checked = true; const radio=document.querySelector('input[name="scope"][value="custom"]'); if (radio) radio.checked=true; }
 if (e.target.matches('input[name="scope"],[data-scope-key]')) {
   if (e.target.matches('[data-scope-key]') && e.target.disabled) return;
   updateScopeChipEnabled();
   scheduleHeavyRender("출력 범위를 다시 계산하는 중입니다…", 30);
   return;
 }
 if (e.target.id === "outputKind") return;
 if (e.target.id === "overviewRowsPerPage") {
   const value = rememberOverviewRowsDraft(e.target.value);
   e.target.value = value;
   markDirty("페이지당 행 수 변경됨 · 설정 저장 가능");
   scheduleHeavyRender("페이지당 행 수를 적용하는 중입니다…", 30);
   return;
 }
 if (e.target.id === "semester") {
   rememberSemester(e.target.value);
   scopeMemory[currentScopeType] = captureScopeState();
   buildScopeUi();
   restoreScopeState(scopeMemory[currentScopeType]);
   markDirty("학기 변경됨 · 설정 저장 가능");
   scheduleHeavyRender(`${selectedSemesterLabel()} 시간표를 다시 그리는 중입니다…`, 30);
   return;
 }
 if (e.target.matches('input,select')) { if (e.target.id === "format") { enforceFormatAvailability(); enforcePaperAvailability(); updateProfileStatus(); markDirty("설정 저장 가능"); scheduleRender(); } if (e.target.id === "paper") { const nextPaper=normalizedPaperValue(e.target.value, currentOfficeProfile(), format()); if ($("paper").value !== nextPaper) $("paper").value=nextPaper; applyPaper(nextPaper); enforcePaperAvailability(); updateProfileStatus(); markDirty("설정 저장 가능"); } if (e.target.id === "headerLeft" || e.target.id === "headerRight") { markDirty("설정 저장 가능"); scheduleRender(); } if (e.target.id === "fontMode") { applyFontMode(e.target.value); markDirty("설정 저장 가능"); scheduleRender(); } if (/^splitFont[1-4]$/.test(e.target.id)) { applySplitFontPresetToControls(e.target.value); if (!splitFieldDraft) splitFieldDraft=normalizeSplitFields(null); splitFieldDraft[String(activeSplitTab||"1")] = readFieldControls(); syncActiveStyleDraft(); } if (/^splitLayout[1-4]$/.test(e.target.id) || /^splitDir[2-4]$/.test(e.target.id) || e.target.id === "ellipsisMode") { syncActiveStyleDraft(); } if (e.target.id === "ellipsisMode") { document.body.classList.toggle("ellipsis-enabled", !!e.target.checked); } if (e.target.matches('[data-special-subject]') || e.target.id === "specialShowRoom" || e.target.id === "specialShowClass") markDirty("설정 저장 가능"); if (cardControlChanged(e.target)) { markCardApplyNeeded(); } else { scheduleRender(); } } }); document.body.addEventListener("click", e=>{ const tab=e.target.closest("[data-split-tab]"); if(tab){ setSplitTab(tab.dataset.splitTab); return; } }); $("applyCardSettingsBtn").addEventListener("click",()=>{ syncActiveFieldDraft(); syncActiveStyleDraft(); markCardApplied(); markDirty("설정 저장 가능"); scheduleHeavyRender("카드 표시 설정을 적용하는 중입니다…", 30); }); $("saveSettingsBtn").addEventListener("click",()=>{ saveSettings(); }); $("exportSettingsBtn")?.addEventListener("click",()=>{ exportDesignerSettings(); }); $("refreshBtn").addEventListener("click",()=>scheduleHeavyRender("미리보기를 새로고침하는 중입니다…", 30)); $("excelDbBtn")?.addEventListener("click",downloadExcelDatabase); $("printBtn").addEventListener("click",runMainExport); $("zoom").addEventListener("input",applyZoom); $("loginBtn").addEventListener("click",login); $("logoutBtn").addEventListener("click",logout); }
function updateAuth(user) { $("authStatus").textContent = user ? (LOCAL_DEV_MODE ? "Local Dev" : (user.email || user.displayName || "로그인됨")) : "로그인 필요"; $("loginBtn").classList.toggle("hidden", !!user || LOCAL_DEV_MODE); $("logoutBtn").classList.toggle("hidden", !user || LOCAL_DEV_MODE); if (user && !subscribed) { subscribed=true; subscribeDomains(["classes","timetable","rooms","rosters","templates"]); } if (user && !LOCAL_DEV_MODE) { loadDesignerSettingsFromFirestore(true); } }
function boot() { initialUi(); wireEvents(); setOnUpdate(()=>{ dataReady = initialLoad.classes && initialLoad.timetable && initialLoad.rooms && initialLoad.templates; if (!dataReady) return; scopeMemory[currentScopeType] = captureScopeState(); buildScopeUi(); buildSpecialSubjects(); const s=getSettings(); applySettings(s,true,true); buildScopeUi(); restoreScopeState(scopeMemory[currentScopeType]); applySpecialSubjects(s.specialSubjects||[]); updateOverviewRowsControl(); scheduleHeavyRender("시간표 데이터를 불러와 미리보기를 그리는 중입니다…", 30); }); onAuth(updateAuth); }
try { boot(); } catch (err) { console.error(err); const meta=document.getElementById("previewMeta"); if(meta) meta.textContent="초기화 오류: " + (err && err.message ? err.message : String(err)); const box=document.getElementById("previewInner"); if(box) box.innerHTML=`<div class="preview-page"><div class="disabled-note">출력 디자이너 초기화 오류가 발생했습니다.<br>${err && err.message ? err.message : String(err)}</div></div>`; }
