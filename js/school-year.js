// ================================================================
// school-year.js · Active academic-year workspace context
// ================================================================
// 2026 keeps the existing Firestore paths for backward compatibility.
// New years use isolated schoolYears/{year}/... paths.

import { LEGACY_PATH_YEAR } from "./school-year-paths.js?v=2026-07-15-room-availability-separation-r355";

export const SCHOOL_YEAR_UI_BUILD = "2026-07-15-room-availability-separation-r355";
export const LEGACY_SCHOOL_YEAR = LEGACY_PATH_YEAR;
export const SCHOOL_YEAR_KEY = "his_active_school_year_v1";
export const KNOWN_SCHOOL_YEARS_KEY = "his_known_school_years_v1";
export const SCHOOL_YEAR_VERIFICATION_KEY = "his_school_year_verification_v1";

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

export function getRequestedSchoolYear() {
  const fromQuery = querySchoolYear();
  if (fromQuery) return fromQuery;
  return readStoredSchoolYear();
}

export function assertSchoolYearRuntimeConsistency(context = "write") {
  const requested = getRequestedSchoolYear();
  const selectorValue = (() => {
    try { return normalizeSchoolYear(document.getElementById("hisSchoolYearSelect")?.value, ""); }
    catch (_) { return ""; }
  })();

  const mismatches = [];
  if (requested && requested !== ACTIVE_SCHOOL_YEAR) {
    mismatches.push(`브라우저 선택=${requested}, 실행 모듈=${ACTIVE_SCHOOL_YEAR}`);
  }
  if (selectorValue && selectorValue !== ACTIVE_SCHOOL_YEAR) {
    mismatches.push(`화면 선택=${selectorValue}, 실행 모듈=${ACTIVE_SCHOOL_YEAR}`);
  }

  if (mismatches.length) {
    const error = new Error(
      `학년도 실행 상태가 일치하지 않아 ${context} 작업을 차단했습니다. ` +
      `${mismatches.join(" / ")}. Ctrl+F5 후 다시 시도해 주세요.`
    );
    error.code = "school-year-runtime-mismatch";
    error.activeSchoolYear = ACTIVE_SCHOOL_YEAR;
    error.requestedSchoolYear = requested;
    error.selectorSchoolYear = selectorValue;
    throw error;
  }

  return {
    ok: true,
    activeSchoolYear: ACTIVE_SCHOOL_YEAR,
    requestedSchoolYear: requested,
    selectorSchoolYear: selectorValue,
  };
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

export function unregisterKnownSchoolYear(value) {
  const target = normalizeSchoolYear(value, "");
  if (!target || target === LEGACY_SCHOOL_YEAR) return getKnownSchoolYears();
  let stored = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(KNOWN_SCHOOL_YEARS_KEY) || "[]");
    if (Array.isArray(parsed)) stored = parsed;
  } catch (_) {}
  const years = [...new Set([LEGACY_SCHOOL_YEAR, ...stored]
    .map(y => normalizeSchoolYear(y, "")).filter(Boolean))]
    .filter(year => year !== target)
    .sort((a, b) => Number(b) - Number(a));
  try { localStorage.setItem(KNOWN_SCHOOL_YEARS_KEY, JSON.stringify(years)); } catch (_) {}
  clearSchoolYearVerification(target);
  return years;
}


function readVerificationStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SCHOOL_YEAR_VERIFICATION_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writeVerificationStore(store) {
  try { localStorage.setItem(SCHOOL_YEAR_VERIFICATION_KEY, JSON.stringify(store || {})); }
  catch (_) {}
}

function normalizeCreationVerificationRow(year, row) {
  if (!row || typeof row !== "object") return null;

  // r349-r351 downgraded a successfully created workspace whenever ordinary
  // data was edited. That marker did not mean the creation copy had failed.
  // Migrate it once so normal editing no longer blocks year switching.
  if (row.stale === true && String(row.source || "") === "workspace-edit") {
    return {
      ...row,
      ok: true,
      stale: false,
      source: "creation-verification-migrated-r352",
      migratedFromWorkspaceEdit: true,
      invalidatedAt: "",
      reason: "",
    };
  }

  return { ...row, stale: false };
}

export function getSchoolYearVerification(value) {
  const year = normalizeSchoolYear(value, "");
  if (!year) return null;
  if (year === LEGACY_SCHOOL_YEAR) {
    return { year, ok: true, checkedAt: "legacy-operating-workspace", source: "legacy" };
  }

  const store = readVerificationStore();
  const original = store[year];
  const row = normalizeCreationVerificationRow(year, original);
  if (!row) return null;

  if (original?.stale === true && row.stale === false) {
    store[year] = row;
    writeVerificationStore(store);
  }

  return { year, ...row };
}

export function isSchoolYearVerified(value) {
  const year = normalizeSchoolYear(value, "");
  return year === LEGACY_SCHOOL_YEAR || getSchoolYearVerification(year)?.ok === true;
}

export function setSchoolYearVerification(value, report = {}) {
  const year = normalizeSchoolYear(value, "");
  if (!year || year === LEGACY_SCHOOL_YEAR) return getSchoolYearVerification(year);
  const store = readVerificationStore();
  store[year] = {
    ok: report?.ok === true,
    checkedAt: String(report?.checkedAt || new Date().toISOString()),
    signature: String(report?.signature || ""),
    errorCount: Number(report?.errorCount || 0) || 0,
    warningCount: Number(report?.warningCount || 0) || 0,
    counts: report?.counts && typeof report.counts === "object" ? report.counts : {},
    source: String(report?.source || "creation-verification"),
    phase: "creation",
    sourceYear: String(report?.sourceYear || ""),
    createMode: String(report?.createMode || ""),
    stale: false,
    invalidatedAt: "",
    reason: "",
  };
  writeVerificationStore(store);
  registerKnownSchoolYears([year]);
  return { year, ...store[year] };
}


// Deprecated compatibility export. Creation verification is immutable after
// the workspace has been created successfully, so ordinary edits must not
// invalidate it. Kept as a no-op for any stale cached module still calling it.
export function invalidateSchoolYearVerification(value, _reason = "workspace-edited") {
  return getSchoolYearVerification(value);
}

export function clearSchoolYearVerification(value) {
  const year = normalizeSchoolYear(value, "");
  if (!year || year === LEGACY_SCHOOL_YEAR) return false;
  const store = readVerificationStore();
  const existed = Object.prototype.hasOwnProperty.call(store, year);
  delete store[year];
  writeVerificationStore(store);
  return existed;
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
  if (typeof document === "undefined") return false;
  injectStyle();

  // The mode switch can be nested after another topbar helper rearranges the DOM.
  // Always use the anchor's real parent as the insertion host. Calling
  // host.insertBefore() with a descendant (not a direct child) throws NotFoundError
  // and previously stopped the entire login bootstrap.
  const modeSwitch = document.querySelector(".top-mode-switch, .tt-mode-switch");
  const fallbackHost = document.querySelector(".topbar-right, .tt-topbar-right, header .right, .topbar");
  const host = modeSwitch?.parentElement || fallbackHost;
  if (!host || document.getElementById("hisSchoolYearSwitch")) return false;

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
    option.textContent = year === LEGACY_SCHOOL_YEAR || isSchoolYearVerified(year)
      ? `${year}학년도`
      : `${year}학년도 · 생성 검증 필요`;
    option.selected = year === ACTIVE_SCHOOL_YEAR;
    select.appendChild(option);
  });

  select.addEventListener("change", () => {
    const next = normalizeSchoolYear(select.value);
    if (next === ACTIVE_SCHOOL_YEAR) return;
    if (!isSchoolYearVerified(next)) {
      alert(`${schoolYearLabel(next)}는 복제 정합성 점검을 통과하지 않았습니다.\n학년도 관리에서 먼저 정합성 점검을 실행해 주세요.`);
      select.value = ACTIVE_SCHOOL_YEAR;
      globalThis.location.href = "school-years.html";
      return;
    }
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
  const spacer = host.querySelector?.(":scope > .spacer") || host.querySelector?.(".spacer");

  try {
    if (modeSwitch?.parentNode) {
      modeSwitch.parentNode.insertBefore(wrap, modeSwitch);
    } else if (spacer?.parentNode) {
      spacer.parentNode.insertBefore(wrap, spacer.nextSibling);
    } else {
      host.insertBefore(wrap, host.firstChild);
    }
    return true;
  } catch (error) {
    // Academic-year switching is auxiliary UI. It must never block authentication
    // or the main application bootstrap if a page has an unexpected topbar layout.
    console.error("[school-year] UI insertion failed; continuing without switch.", error);
    wrap.remove();
    return false;
  }
}

if (typeof window !== "undefined") {
  window.HIS_SCHOOL_YEAR = {
    active: ACTIVE_SCHOOL_YEAR,
    legacy: LEGACY_SCHOOL_YEAR,
    getKnownSchoolYears,
    registerKnownSchoolYears,
    unregisterKnownSchoolYear,
    getSchoolYearVerification,
    isSchoolYearVerified,
    setSchoolYearVerification,
    invalidateSchoolYearVerification,
    clearSchoolYearVerification,
    setActiveSchoolYear,
    assertSchoolYearRuntimeConsistency,
    setupSchoolYearUi,
  };
}
