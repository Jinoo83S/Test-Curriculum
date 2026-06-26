// ================================================================
// app-health-check.js · Runtime regression / integration diagnostics
// ================================================================
import {
  appState,
  initialLoad,
  getDirtyDomains,
  isAutoSaveEnabled,
  getFirestoreUsageStats,
} from "./state.js";
import { LOCAL_DEV_MODE } from "./local-dev.js";
import { APP_VERSION, versioned } from "./version.js";

const MODULE_FILES = [
  "./js/app.js",
  "./js/state.js",
  "./js/config.js",
  "./js/auth.js",
  "./js/utils.js",
  "./js/version.js",
  "./js/app-auth-ui.js",
  "./js/save-status-ui.js",
  "./js/app-sidebar-ui.js",
  "./js/app-navigation-ui.js",
  "./js/app-domains.js",
  "./js/app-module-loader.js",
  "./js/app-students-ui.js",
  "./js/app-templates-ui.js",
  "./js/app-board-ui.js",
  "./js/app-render-orchestrator.js",
  "./js/curriculum.js",
  "./js/templates.js",
  "./js/students.js",
  "./js/teachers.js",
  "./js/rooms.js",
  "./js/rosters.js",
  "./js/results.js",
  "./js/subject-setup.js",
  "./js/ttcards.js",
  "./js/timetable.js",
  "./js/timetable-autoassign.js",
  "./js/timetable-sidebar.js",
  "./js/timetable-grid.js",
  "./js/timetable-data.js",
  "./js/timetable-detail.js",
  "./js/timetable-log.js",
  "./js/timetable-conflicts.js",
  "./js/timetable-constraints.js",
  "./js/data-cleanup.js",
];

const APP_DOM_ELEMENTS = [
  "topbarMainNav",
  "saveStatusEl",
  "authStatus",
  "loginBtn",
  "subNavBar",
  "appSidebar",
  "boardView",
  "gradeBoard",
  "templateManagerView",
  "templateList",
];

const TIMETABLE_DOM_ELEMENTS = [
  "ttGrid",
  "ttBottom",
  "ttSubjectsContent",
  "ttConstraintsContent",
  "ttRoomsContent",
  "ttLogsContent",
  "ttAutoAssignBtn",
  "ttScheduleVersionsBtn",
  "ttSaveBtn",
  "ttGradeSelect",
  "ttConflictBar",
];

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function uniq(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getTtCardIdsFromEntry(entry = {}) {
  return uniq([
    entry.ttcardId,
    ...asArray(entry.ttcardIds),
    ...asArray(entry.cardIds),
  ]);
}

function extractCompoundPartIdFromCard(card = {}) {
  const direct = card.partId || card.compoundPartId || card.sourcePartId || card.templatePartId;
  if (direct) return String(direct).trim();
  const id = String(card.id || "").trim();
  const m = id.match(/_part_(.+)$/);
  return m ? String(m[1] || "").trim() : "";
}

function getCardTemplateKey(card = {}) {
  // r175: 복합과목의 파트 카드(예: 미적분(2), 심화물리(2))는
  // 같은 학년·templateId·sectionIdx를 공유하지만 서로 다른 실제 수업입니다.
  // partId를 키에 포함하지 않으면 앱점검이 잘못된 중복 경고를 냅니다.
  const partId = extractCompoundPartIdFromCard(card);
  return [
    card.gradeKey || card.grade || "",
    card.templateId || "",
    card.sectionIdx ?? card.sectionIndex ?? "",
    partId ? `part:${partId}` : "whole"
  ].join("::");
}

function collectGroupCardRefs(group = {}) {
  const ids = [];
  ids.push(...asArray(group.poolCardIds));
  ids.push(...asArray(group.excludedCardIds));
  ids.push(...asArray(group.cardIds));
  asArray(group.units).forEach(unit => {
    ids.push(...asArray(unit.ttcardIds));
    ids.push(...asArray(unit.cardIds));
    ids.push(...asArray(unit.poolCardIds));
  });
  return uniq(ids);
}

function statusWeight(status) {
  return status === "error" ? 3 : status === "warn" ? 2 : status === "ok" ? 1 : 0;
}

function add(report, section, status, title, detail = "", meta = {}) {
  report.items.push({ section, status, title, detail, meta });
  report.counts[status] = (report.counts[status] || 0) + 1;
}

function countBy(items, keyFn) {
  const map = new Map();
  (items || []).forEach(item => {
    const key = keyFn(item);
    if (!key) return;
    map.set(key, (map.get(key) || 0) + 1);
  });
  return map;
}

function summarizeRuntime(report) {
  const usage = (() => { try { return getFirestoreUsageStats?.(); } catch (_) { return null; } })();
  const loaded = Object.entries(initialLoad || {}).filter(([, v]) => !!v).map(([k]) => k);
  const notLoaded = Object.entries(initialLoad || {}).filter(([, v]) => !v).map(([k]) => k);

  add(report, "실행 환경", "info", "앱 버전", APP_VERSION);
  add(report, "실행 환경", LOCAL_DEV_MODE ? "warn" : "ok", "실행 모드", LOCAL_DEV_MODE ? "LOCAL DEV 모드" : "온라인/Firestore 모드");
  add(report, "실행 환경", isAutoSaveEnabled() ? "ok" : "warn", "자동저장", isAutoSaveEnabled() ? "ON" : "OFF");

  const dirty = getDirtyDomains?.() || [];
  add(report, "저장 상태", dirty.length ? "warn" : "ok", "저장 대기 도메인", dirty.length ? dirty.join(", ") : "없음");
  add(report, "도메인 로드", notLoaded.length ? "warn" : "ok", "로드 완료 도메인", `${loaded.length}/${Object.keys(initialLoad || {}).length}개 로드됨${notLoaded.length ? ` · 미로드: ${notLoaded.join(", ")}` : ""}`);

  if (usage?.subscribedDomains) {
    add(report, "도메인 로드", "info", "현재 구독 도메인", usage.subscribedDomains.length ? usage.subscribedDomains.join(", ") : "없음");
  }
}

function summarizeData(report) {
  const curriculumGrades = Object.keys(appState.curriculum?.gradeBoards || {});
  const templates = asArray(appState.templates?.templates);
  const classes = asArray(appState.classes?.classes);
  const teachers = asArray(appState.teachers?.teachers);
  const rooms = asArray(appState.rooms?.rooms);
  const rosters = appState.rosters?.rosters || {};
  const tt = appState.timetable || {};
  const cards = asArray(tt.ttcards);
  const entries = asArray(tt.entries);
  const groups = asArray(tt.ttcardGroups);
  const savedSchedules = asArray(tt.savedSchedules);
  const periodCount = Number(tt.config?.periodCount || 0);

  add(report, "데이터 요약", curriculumGrades.length ? "ok" : "warn", "커리큘럼 학년", curriculumGrades.length ? curriculumGrades.join(", ") : "없음");
  add(report, "데이터 요약", templates.length ? "ok" : "warn", "과목카드 템플릿", `${templates.length}개`);
  add(report, "데이터 요약", classes.length ? "ok" : "warn", "학급", `${classes.length}개`);
  add(report, "데이터 요약", teachers.length ? "ok" : "warn", "교사", `${teachers.length}명`);
  add(report, "데이터 요약", rooms.length ? "ok" : "warn", "교실", `${rooms.length}개`);
  add(report, "데이터 요약", Object.keys(rosters).length ? "ok" : "warn", "수강명단 과목", `${Object.keys(rosters).length}개`);
  add(report, "시간표 데이터", periodCount > 0 ? "ok" : "error", "하루 교시 설정", periodCount ? `${periodCount}교시` : "설정 없음");
  add(report, "시간표 데이터", cards.length ? "ok" : "warn", "시간표 카드", `${cards.length}개`);
  add(report, "시간표 데이터", entries.length ? "ok" : "warn", "배치 엔트리", `${entries.length}개`);
  add(report, "시간표 데이터", groups.length ? "ok" : "info", "동시배정/그룹", `${groups.length}개`);
  add(report, "시간표 데이터", savedSchedules.length ? "ok" : "info", "보관된 배치 버전", `${savedSchedules.length}개`);
}

function checkDom(report) {
  const isTimetablePage = !!document.getElementById("ttGrid") || document.body?.dataset?.initialView === "timetable";
  const expected = isTimetablePage ? TIMETABLE_DOM_ELEMENTS : APP_DOM_ELEMENTS;
  const missing = expected.filter(id => !document.getElementById(id));
  add(report, "DOM 점검", missing.length ? "error" : "ok", isTimetablePage ? "시간표 편집 필수 DOM" : "메인 앱 필수 DOM", missing.length ? `누락: ${missing.join(", ")}` : "필수 요소 확인됨");
}

async function checkModuleFiles(report) {
  const missing = [];
  const checked = [];
  for (const path of MODULE_FILES) {
    try {
      const url = new URL(versioned(path), document.baseURI).toString();
      let res = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (!res.ok) {
        // 일부 호스팅은 HEAD를 막을 수 있어 GET으로 한 번 더 확인합니다.
        res = await fetch(url, { method: "GET", cache: "no-store" });
      }
      if (!res.ok) missing.push(`${path} (${res.status})`);
      else checked.push(path);
    } catch (error) {
      missing.push(`${path} (${error?.message || error})`);
    }
  }
  add(report, "모듈 파일", missing.length ? "warn" : "ok", "주요 JS 파일 접근성", missing.length ? `확인 실패 ${missing.length}개: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? " …" : ""}` : `${checked.length}개 파일 확인됨`);
}

function checkTimetableReferences(report) {
  const tt = appState.timetable || {};
  const cards = asArray(tt.ttcards);
  const entries = asArray(tt.entries);
  const groups = asArray(tt.ttcardGroups);
  const periodCount = Number(tt.config?.periodCount || 7);

  const cardIds = new Set(cards.map(c => c.id).filter(Boolean));
  const groupIds = new Set(groups.map(g => g.id).filter(Boolean));
  const placedCardIds = new Set();
  const missingEntryCardRefs = [];
  const missingEntryGroupRefs = [];
  const invalidSlotEntries = [];

  entries.forEach(entry => {
    const day = Number(entry.day);
    const period = Number(entry.period);
    if (!Number.isInteger(day) || day < 0 || day > 4 || !Number.isInteger(period) || period < 0 || period >= periodCount) {
      invalidSlotEntries.push(entry.id || "id 없음");
    }

    getTtCardIdsFromEntry(entry).forEach(id => {
      placedCardIds.add(id);
      if (!cardIds.has(id)) missingEntryCardRefs.push(`${entry.id || "entry"} → ${id}`);
    });

    if (entry.groupId && !groupIds.has(entry.groupId)) {
      missingEntryGroupRefs.push(`${entry.id || "entry"} → ${entry.groupId}`);
    }
  });

  const missingGroupCardRefs = [];
  groups.forEach(group => {
    collectGroupCardRefs(group).forEach(id => {
      if (!cardIds.has(id)) missingGroupCardRefs.push(`${group.name || group.groupName || group.id} → ${id}`);
    });
  });

  const duplicateCardIds = [...countBy(cards, c => c.id).entries()].filter(([, n]) => n > 1);
  const duplicateCardKeys = [...countBy(cards, getCardTemplateKey).entries()]
    .filter(([key, n]) => key && !key.endsWith("::") && n > 1);
  const unplacedCards = cards.filter(c => c.id && !placedCardIds.has(c.id));
  const emptyGroups = groups.filter(g => !collectGroupCardRefs(g).length);

  add(report, "시간표 참조", missingEntryCardRefs.length ? "error" : "ok", "배치 엔트리 → 카드 참조", missingEntryCardRefs.length ? `${missingEntryCardRefs.length}개 깨짐: ${missingEntryCardRefs.slice(0, 8).join(", ")}${missingEntryCardRefs.length > 8 ? " …" : ""}` : "정상");
  add(report, "시간표 참조", missingEntryGroupRefs.length ? "error" : "ok", "배치 엔트리 → 그룹 참조", missingEntryGroupRefs.length ? `${missingEntryGroupRefs.length}개 깨짐: ${missingEntryGroupRefs.slice(0, 8).join(", ")}${missingEntryGroupRefs.length > 8 ? " …" : ""}` : "정상");
  add(report, "시간표 참조", missingGroupCardRefs.length ? "error" : "ok", "그룹 → 카드 참조", missingGroupCardRefs.length ? `${missingGroupCardRefs.length}개 깨짐: ${missingGroupCardRefs.slice(0, 8).join(", ")}${missingGroupCardRefs.length > 8 ? " …" : ""}` : "정상");
  add(report, "시간표 참조", duplicateCardIds.length ? "error" : "ok", "중복 카드 ID", duplicateCardIds.length ? `${duplicateCardIds.length}종 발견: ${duplicateCardIds.slice(0, 8).map(([id, n]) => `${id}×${n}`).join(", ")}` : "없음");
  add(report, "시간표 참조", duplicateCardKeys.length ? "warn" : "ok", "같은 학년/템플릿/섹션 카드 중복", duplicateCardKeys.length ? `${duplicateCardKeys.length}종 발견 · DB 정리 대상 가능성 있음` : "없음");
  add(report, "시간표 참조", invalidSlotEntries.length ? "error" : "ok", "요일/교시 범위", invalidSlotEntries.length ? `${invalidSlotEntries.length}개 엔트리의 위치가 범위를 벗어남` : "정상");
  add(report, "시간표 참조", emptyGroups.length ? "warn" : "ok", "빈 그룹", emptyGroups.length ? `${emptyGroups.length}개 그룹에 카드 참조가 없음` : "없음");
  add(report, "배치 현황", "info", "배치 완료 카드", `${placedCardIds.size}/${cards.length}개 카드가 배치 엔트리에서 참조됨`);
  add(report, "배치 현황", unplacedCards.length ? "warn" : "ok", "미배치 카드", unplacedCards.length ? `${unplacedCards.length}개 · 실제 미배치인지, 의도적 예외/대표카드 중복인지 확인 필요` : "없음");
}

function buildReportHtml(report) {
  const totalIssues = (report.counts.error || 0) + (report.counts.warn || 0);
  const overall = report.counts.error ? "error" : report.counts.warn ? "warn" : "ok";
  const bySection = new Map();
  report.items.forEach(item => {
    if (!bySection.has(item.section)) bySection.set(item.section, []);
    bySection.get(item.section).push(item);
  });

  const statusLabel = {
    ok: "정상",
    warn: "주의",
    error: "오류",
    info: "정보",
  };

  const sectionHtml = [...bySection.entries()].map(([section, items]) => {
    const maxStatus = items.reduce((acc, item) => statusWeight(item.status) > statusWeight(acc) ? item.status : acc, "info");
    return `
      <section class="hc-section">
        <h3><span class="hc-dot ${maxStatus}"></span>${esc(section)}</h3>
        <div class="hc-items">
          ${items.map(item => `
            <div class="hc-item ${item.status}">
              <div class="hc-item-head"><span class="hc-badge ${item.status}">${statusLabel[item.status] || item.status}</span><strong>${esc(item.title)}</strong></div>
              ${item.detail ? `<div class="hc-detail">${esc(item.detail)}</div>` : ""}
            </div>
          `).join("")}
        </div>
      </section>
    `;
  }).join("");

  return `
    <style>
      .hc-overlay{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;}
      .hc-dialog{width:min(1040px,calc(100vw - 32px));max-height:calc(100vh - 48px);background:#fff;border-radius:18px;box-shadow:0 24px 80px rgba(15,23,42,.28);display:flex;flex-direction:column;overflow:hidden;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
      .hc-header{padding:18px 22px;border-bottom:1px solid #e2e8f0;display:flex;gap:16px;align-items:flex-start;justify-content:space-between;background:linear-gradient(135deg,#f8fafc,#eef2ff);}
      .hc-header h2{margin:0;font-size:20px;color:#0f172a;}
      .hc-header p{margin:6px 0 0;color:#64748b;font-size:13px;}
      .hc-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;}
      .hc-btn{border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:10px;padding:8px 12px;font-weight:800;cursor:pointer;}
      .hc-btn.primary{background:#2563eb;border-color:#2563eb;color:#fff;}
      .hc-body{overflow:auto;padding:18px 22px 22px;}
      .hc-summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-bottom:16px;}
      .hc-card{border:1px solid #e2e8f0;border-radius:14px;padding:12px;background:#fff;}
      .hc-card strong{display:block;font-size:22px;color:#0f172a;line-height:1;}
      .hc-card span{display:block;margin-top:6px;color:#64748b;font-size:12px;font-weight:800;}
      .hc-card.overall.ok{border-color:#bbf7d0;background:#f0fdf4}.hc-card.overall.warn{border-color:#fde68a;background:#fffbeb}.hc-card.overall.error{border-color:#fecaca;background:#fef2f2}
      .hc-section{border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;margin-top:12px;background:#fff;}
      .hc-section h3{margin:0;padding:12px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-size:14px;color:#0f172a;display:flex;gap:8px;align-items:center;}
      .hc-dot{width:10px;height:10px;border-radius:999px;background:#94a3b8;display:inline-block}.hc-dot.ok{background:#16a34a}.hc-dot.warn{background:#f59e0b}.hc-dot.error{background:#dc2626}.hc-dot.info{background:#64748b}
      .hc-items{display:grid;grid-template-columns:1fr;}
      .hc-item{padding:11px 14px;border-bottom:1px solid #f1f5f9;}.hc-item:last-child{border-bottom:0;}
      .hc-item-head{display:flex;gap:8px;align-items:center;font-size:13px;color:#0f172a;}
      .hc-badge{font-size:11px;border-radius:999px;padding:3px 7px;color:#fff;background:#64748b;min-width:36px;text-align:center;}.hc-badge.ok{background:#16a34a}.hc-badge.warn{background:#f59e0b}.hc-badge.error{background:#dc2626}.hc-badge.info{background:#64748b}
      .hc-detail{margin-top:5px;color:#475569;font-size:12px;line-height:1.45;white-space:pre-wrap;word-break:break-word;}
      @media (max-width:780px){.hc-summary{grid-template-columns:repeat(2,minmax(0,1fr));}.hc-header{flex-direction:column}.hc-actions{justify-content:flex-start}}
    </style>
    <div class="hc-dialog" role="dialog" aria-modal="true" aria-label="앱 상태 점검">
      <div class="hc-header">
        <div>
          <h2>🔍 앱 상태 점검</h2>
          <p>${esc(new Date(report.createdAt).toLocaleString())} 기준 · ${totalIssues ? "확인이 필요한 항목이 있습니다." : "주요 항목이 정상입니다."}</p>
        </div>
        <div class="hc-actions">
          <button type="button" class="hc-btn" data-hc-export>JSON 내보내기</button>
          <button type="button" class="hc-btn primary" data-hc-refresh>다시 점검</button>
          <button type="button" class="hc-btn" data-hc-close>닫기</button>
        </div>
      </div>
      <div class="hc-body">
        <div class="hc-summary">
          <div class="hc-card overall ${overall}"><strong>${overall === "ok" ? "OK" : overall === "warn" ? "주의" : "오류"}</strong><span>종합 상태</span></div>
          <div class="hc-card"><strong>${report.counts.error || 0}</strong><span>오류</span></div>
          <div class="hc-card"><strong>${report.counts.warn || 0}</strong><span>주의</span></div>
          <div class="hc-card"><strong>${report.counts.ok || 0}</strong><span>정상</span></div>
          <div class="hc-card"><strong>${report.counts.info || 0}</strong><span>정보</span></div>
        </div>
        ${sectionHtml}
      </div>
    </div>
  `;
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function runAppHealthCheck() {
  const report = {
    version: 1,
    mode: "his-app-health-check",
    appVersion: APP_VERSION,
    createdAt: new Date().toISOString(),
    counts: { ok: 0, warn: 0, error: 0, info: 0 },
    items: [],
  };

  summarizeRuntime(report);
  summarizeData(report);
  checkDom(report);
  checkTimetableReferences(report);
  await checkModuleFiles(report);

  report.overall = report.counts.error ? "error" : report.counts.warn ? "warn" : "ok";
  return report;
}


function ensureHealthToastRoot() {
  let root = document.querySelector(".his-toast-root");
  if (!root) {
    root = document.createElement("div");
    root.className = "his-toast-root";
    document.body.appendChild(root);
  }
  return root;
}

function showHealthToast(message, kind = "") {
  const root = ensureHealthToastRoot();
  const toast = document.createElement("div");
  toast.className = `his-toast ${kind || ""}`.trim();
  toast.textContent = message;
  root.appendChild(toast);
  setTimeout(() => { toast.style.opacity = "0"; toast.style.transform = "translateY(6px)"; }, 1600);
  setTimeout(() => toast.remove(), 2200);
}

function applyHealthOverlayBaseStyle(overlay) {
  if (!overlay) return;
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;";
}

function applyHealthDialogBaseStyle(overlay) {
  const dialog = overlay?.querySelector?.(".hc-dialog");
  if (dialog) {
    dialog.style.cssText = dialog.getAttribute("style") || "width:min(1040px,calc(100vw - 32px));max-height:calc(100vh - 48px);background:#fff;border-radius:18px;box-shadow:0 24px 80px rgba(15,23,42,.28);display:flex;flex-direction:column;overflow:hidden;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";
  }
}

export async function openAppHealthCheckDialog() {
  showHealthToast("앱 상태를 점검하는 중입니다…", "ok");
  let overlay = document.querySelector(".hc-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "hc-overlay";
    document.body.appendChild(overlay);
  }
  applyHealthOverlayBaseStyle(overlay);
  overlay.innerHTML = `<div class="hc-dialog"><div class="hc-header"><h2>🔍 앱 상태 점검</h2></div><div class="hc-body">점검 중입니다…</div></div>`;
  applyHealthDialogBaseStyle(overlay);

  const render = async () => {
    try {
      const report = await runAppHealthCheck();
      overlay.innerHTML = buildReportHtml(report);
      applyHealthOverlayBaseStyle(overlay);
      showHealthToast(report.overall === "ok" ? "앱점검 완료: 정상" : "앱점검 완료: 확인 필요", report.overall === "ok" ? "ok" : "warn");
      overlay.querySelector("[data-hc-close]")?.addEventListener("click", () => overlay.remove());
      overlay.addEventListener("click", ev => { if (ev.target === overlay) overlay.remove(); }, { once: true });
      overlay.querySelector("[data-hc-refresh]")?.addEventListener("click", () => void render());
      overlay.querySelector("[data-hc-export]")?.addEventListener("click", () => {
        downloadJson(`his-app-health-check-${new Date().toISOString().slice(0,10)}.json`, report);
      });
    } catch (error) {
      console.error("[app health check]", error);
      overlay.innerHTML = `<div class="hc-dialog"><div class="hc-header"><h2>🔍 앱 상태 점검 오류</h2><button type="button" class="hc-btn" data-hc-close>닫기</button></div><div class="hc-body">${esc(error?.message || error)}</div></div>`;
      applyHealthOverlayBaseStyle(overlay);
      applyHealthDialogBaseStyle(overlay);
      showHealthToast("앱점검 오류", "error");
      overlay.querySelector("[data-hc-close]")?.addEventListener("click", () => overlay.remove());
    }
  };

  await render();
}
