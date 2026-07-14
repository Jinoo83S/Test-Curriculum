// ================================================================
// school-year.js · Active academic-year workspace context
// ================================================================
// 2026 keeps the existing Firestore paths for backward compatibility.
// New years use isolated schoolYears/{year}/... paths.

export const LEGACY_SCHOOL_YEAR = "2026";
export const SCHOOL_YEAR_KEY = "his_active_school_year_v1";
export const KNOWN_SCHOOL_YEARS_KEY = "his_known_school_years_v1";

export function normalizeSchoolYear(value, fallback = LEGACY_SCHOOL_YEAR) {
  const m = String(value ?? "").trim().match(/(20\d{2})/);
  if (!m) return fallback;
  const year = Number(m[1]);
  return year >= 2020 && year <= 2099 ? String(year) : fallback;
}

function querySchoolYear() {
  try {
    const params = new URLSearchParams(globalThis.location?.search || "");
    if (!params.has("year")) return "";
    return normalizeSchoolYear(params.get("year"), "");
  } catch (_) {
    return "";
  }
}

function readStoredSchoolYear() {
  try { return normalizeSchoolYear(localStorage.getItem(SCHOOL_YEAR_KEY), LEGACY_SCHOOL_YEAR); }
  catch (_) { return LEGACY_SCHOOL_YEAR; }
}

const queryYear = querySchoolYear();
if (queryYear) {
  try { localStorage.setItem(SCHOOL_YEAR_KEY, queryYear); } catch (_) {}
}

export const ACTIVE_SCHOOL_YEAR = queryYear || readStoredSchoolYear();
export const IS_LEGACY_SCHOOL_YEAR = ACTIVE_SCHOOL_YEAR === LEGACY_SCHOOL_YEAR;

export function getActiveSchoolYear() { return ACTIVE_SCHOOL_YEAR; }
export function isLegacySchoolYear(year = ACTIVE_SCHOOL_YEAR) {
  return normalizeSchoolYear(year) === LEGACY_SCHOOL_YEAR;
}
export function schoolYearLabel(year = ACTIVE_SCHOOL_YEAR) {
  return `${normalizeSchoolYear(year)}학년도`;
}

export function getKnownSchoolYears() {
  let years = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(KNOWN_SCHOOL_YEARS_KEY) || "[]");
    if (Array.isArray(parsed)) years = parsed;
  } catch (_) {}
  return [...new Set([LEGACY_SCHOOL_YEAR, ACTIVE_SCHOOL_YEAR, ...years].map(y => normalizeSchoolYear(y, "")).filter(Boolean))]
    .sort((a, b) => Number(b) - Number(a));
}

export function registerKnownSchoolYears(values = []) {
  const years = [...new Set([...getKnownSchoolYears(), ...(Array.isArray(values) ? values : [values])]
    .map(y => normalizeSchoolYear(y, "")).filter(Boolean))].sort((a, b) => Number(b) - Number(a));
  try { localStorage.setItem(KNOWN_SCHOOL_YEARS_KEY, JSON.stringify(years)); } catch (_) {}
  return years;
}

export function setActiveSchoolYear(year, options = {}) {
  const next = normalizeSchoolYear(year);
  registerKnownSchoolYears([next]);
  try { localStorage.setItem(SCHOOL_YEAR_KEY, next); } catch (_) {}
  if (options.reload !== false && globalThis.location) {
    const url = new URL(globalThis.location.href);
    url.searchParams.delete("year");
    globalThis.location.href = url.toString();
  }
  return next;
}

function injectStyle() {
  if (document.getElementById("hisSchoolYearStyle")) return;
  const style = document.createElement("style");
  style.id = "hisSchoolYearStyle";
  style.textContent = `
    .his-school-year-switch{display:inline-flex;align-items:center;gap:5px;flex:0 0 auto}
    .his-school-year-switch select{height:28px;min-width:92px;border:1px solid rgba(255,255,255,.35);border-radius:8px;background:#fff;color:#0f2946;padding:0 7px;font-size:12px;font-weight:900;cursor:pointer}
    .his-school-year-switch a{display:inline-flex;align-items:center;height:28px;padding:0 8px;border:1px solid rgba(255,255,255,.3);border-radius:8px;background:rgba(255,255,255,.12);color:#fff!important;text-decoration:none!important;font-size:11px;font-weight:900;white-space:nowrap}
    .his-school-year-switch a:hover{background:rgba(255,255,255,.22)}
    .topbar .his-school-year-switch{margin-right:2px}
    @media(max-width:900px){.his-school-year-switch a{display:none}.his-school-year-switch select{min-width:86px}}
  `;
  document.head.appendChild(style);
}

function hasUnsavedChanges() {
  try {
    const dirty = globalThis.HIS_GET_DIRTY_DOMAINS?.();
    return Array.isArray(dirty) && dirty.length ? dirty : [];
  } catch (_) {
    return [];
  }
}

export function setupSchoolYearUi() {
  if (typeof document === "undefined") return;
  injectStyle();
  const host = document.querySelector(".topbar-right, .tt-topbar-right, header .right, .topbar");
  if (!host || document.getElementById("hisSchoolYearSwitch")) return;

  const wrap = document.createElement("div");
  wrap.id = "hisSchoolYearSwitch";
  wrap.className = "his-school-year-switch";
  wrap.setAttribute("aria-label", "학년도 작업공간 선택");

  const select = document.createElement("select");
  select.id = "hisSchoolYearSelect";
  select.title = "현재 학년도 작업공간";
  getKnownSchoolYears().forEach(year => {
    const option = document.createElement("option");
    option.value = year;
    option.textContent = `${year}학년도`;
    option.selected = year === ACTIVE_SCHOOL_YEAR;
    select.appendChild(option);
  });

  select.addEventListener("change", () => {
    const next = normalizeSchoolYear(select.value);
    if (next === ACTIVE_SCHOOL_YEAR) return;
    const dirty = hasUnsavedChanges();
    if (dirty.length) {
      alert(`저장되지 않은 변경사항이 있습니다: ${dirty.join(", ")}\n저장을 완료한 뒤 학년도를 전환해 주세요.`);
      select.value = ACTIVE_SCHOOL_YEAR;
      return;
    }
    if (!confirm(`${schoolYearLabel(ACTIVE_SCHOOL_YEAR)}에서 ${schoolYearLabel(next)}로 전환할까요?\n화면이 새로고침됩니다.`)) {
      select.value = ACTIVE_SCHOOL_YEAR;
      return;
    }
    setActiveSchoolYear(next);
  });

  const manage = document.createElement("a");
  manage.href = "school-years.html";
  manage.textContent = "학년도 관리";
  manage.title = "새 학년도 생성·복제·전환";

  wrap.append(select, manage);
  const modeSwitch = host.querySelector(".top-mode-switch, .tt-mode-switch");
  const spacer = host.querySelector(".spacer");
  if (modeSwitch) host.insertBefore(wrap, modeSwitch);
  else if (spacer) host.insertBefore(wrap, spacer.nextSibling);
  else host.insertBefore(wrap, host.firstChild);
}

if (typeof window !== "undefined") {
  window.HIS_SCHOOL_YEAR = {
    active: ACTIVE_SCHOOL_YEAR,
    legacy: LEGACY_SCHOOL_YEAR,
    getKnownSchoolYears,
    registerKnownSchoolYears,
    setActiveSchoolYear,
    setupSchoolYearUi,
  };
}
