// ================================================================
// save-status-ui.js · Unified save button + quota/local-dev controls
// ================================================================
import { canEdit } from "./auth.js";
import { LOCAL_DEV_MODE } from "./local-dev.js";
import {
  setOnSaveStatus,
  isAutoSaveEnabled,
  setAutoSaveEnabled,
  getDirtyDomains,
  savePendingNow,
  exportLocalSnapshot,
  importLocalSnapshot,
  resetLocalSnapshot,
  exportFirestoreDiagnosticSnapshot,
} from "./state.js?v=2026-07-06-stable-state-pdf-r234";
import { openDataCleanupDialog } from "./data-cleanup.js";
import { openFirestoreUsageDialog } from "./firestore-usage.js";
import { openAppHealthCheckDialog } from "./app-health-check.js";

const saveStatusEl = document.getElementById("saveStatusEl");
const topbarRight = document.querySelector(".topbar-right");
const authStatusEl = document.getElementById("authStatus");
let saveStatusTimer = null;
let saveModeBtn = null;
let initialized = false;
let lastSaveStatus = "mode";

function removeLegacySaveStatus() {
  if (!saveStatusEl) return;
  saveStatusEl.textContent = "";
  saveStatusEl.hidden = true;
  saveStatusEl.className = "save-status save-status-inline-hidden";
  saveStatusEl.setAttribute("aria-hidden", "true");
  saveStatusEl.style.setProperty("display", "none", "important");
  saveStatusEl.style.setProperty("width", "0", "important");
  saveStatusEl.style.setProperty("min-width", "0", "important");
  saveStatusEl.style.setProperty("max-width", "0", "important");
  saveStatusEl.style.setProperty("height", "0", "important");
  saveStatusEl.style.setProperty("min-height", "0", "important");
  saveStatusEl.style.setProperty("padding", "0", "important");
  saveStatusEl.style.setProperty("margin", "0", "important");
  saveStatusEl.style.setProperty("border", "0", "important");
  saveStatusEl.style.setProperty("overflow", "hidden", "important");
}

function insertBeforeAuth(el) {
  const parent = topbarRight || saveStatusEl?.parentElement || document.body;
  const anchor = authStatusEl?.parentElement === parent ? authStatusEl : null;
  parent.insertBefore(el, anchor);
}

function saveButtonText(autoSave, dirty, status) {
  const count = dirty.length;
  if (status === "saving") return count ? `저장 중(${count})` : "저장 중…";
  if (status === "error") return count ? `저장 실패(${count})` : "저장 실패";
  if ((status === "saved" || status === "skipped") && count === 0) {
    return status === "saved" ? "저장됨" : "변경 없음";
  }
  if (count) return autoSave ? `저장 대기(${count})` : `수동 저장(${count})`;
  return autoSave ? "자동저장 ON" : "자동저장 OFF";
}

function saveButtonTitle(autoSave, dirty, status) {
  const count = dirty.length;
  if (status === "saving") return "변경사항을 저장하는 중입니다.";
  if (status === "error") return count ? "저장에 실패했습니다. 클릭하면 다시 저장을 시도합니다." : "저장에 실패했습니다. 네트워크 또는 권한을 확인하세요.";
  if (count) {
    return autoSave
      ? "변경사항이 저장 대기 중입니다. 클릭하면 즉시 저장합니다."
      : "자동저장이 꺼져 있습니다. 클릭하면 변경사항을 수동 저장합니다.";
  }
  return autoSave
    ? "현재 자동저장 중입니다. 클릭하면 자동저장을 끕니다."
    : "자동저장이 꺼져 있습니다. 클릭하면 자동저장을 다시 켭니다.";
}

function applySaveButtonInlineStyle(btn, autoSave, dirty, status) {
  if (!btn) return;
  btn.style.setProperty("height", "28px", "important");
  btn.style.setProperty("min-height", "28px", "important");
  btn.style.setProperty("padding", "4px 10px", "important");
  btn.style.setProperty("border-radius", "999px", "important");
  btn.style.setProperty("font-weight", "900", "important");
  btn.style.setProperty("white-space", "nowrap", "important");
  btn.style.setProperty("display", "inline-flex", "important");
  btn.style.setProperty("align-items", "center", "important");
  btn.style.setProperty("justify-content", "center", "important");

  if (status === "error") {
    btn.style.setProperty("background", "#fee2e2", "important");
    btn.style.setProperty("color", "#991b1b", "important");
    btn.style.setProperty("border", "1px solid #fecaca", "important");
  } else if (dirty.length) {
    btn.style.setProperty("background", "#fef3c7", "important");
    btn.style.setProperty("color", "#92400e", "important");
    btn.style.setProperty("border", "1px solid #f59e0b", "important");
  } else if (autoSave) {
    btn.style.setProperty("background", "#dcfce7", "important");
    btn.style.setProperty("color", "#166534", "important");
    btn.style.setProperty("border", "1px solid #86efac", "important");
  } else {
    btn.style.setProperty("background", "#334155", "important");
    btn.style.setProperty("color", "#fef3c7", "important");
    btn.style.setProperty("border", "1px solid #f59e0b", "important");
  }
}

function updateSaveControlButtons() {
  const autoSave = isAutoSaveEnabled();
  const dirty = getDirtyDomains();
  if (!saveModeBtn) return;

  removeLegacySaveStatus();

  saveModeBtn.textContent = `💾 ${saveButtonText(autoSave, dirty, lastSaveStatus)}`;
  saveModeBtn.title = saveButtonTitle(autoSave, dirty, lastSaveStatus);
  saveModeBtn.disabled = lastSaveStatus === "saving";

  saveModeBtn.classList.toggle("save-mode-on", autoSave);
  saveModeBtn.classList.toggle("save-mode-off", !autoSave);
  saveModeBtn.classList.toggle("manual-save-pending", dirty.length > 0);
  saveModeBtn.classList.toggle("save-mode-saving", lastSaveStatus === "saving");
  saveModeBtn.classList.toggle("save-mode-error", lastSaveStatus === "error");
  saveModeBtn.classList.toggle("save-mode-saved", (lastSaveStatus === "saved" || lastSaveStatus === "skipped") && dirty.length === 0);
  saveModeBtn.setAttribute("aria-pressed", autoSave ? "true" : "false");
  applySaveButtonInlineStyle(saveModeBtn, autoSave, dirty, lastSaveStatus);
}

function downloadJsonFile(filename, data) {
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

function pickJsonFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.display = "none";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = () => {
        try { resolve(JSON.parse(String(reader.result || "{}"))); }
        catch (e) { reject(e); }
      };
      reader.onerror = () => reject(reader.error || new Error("파일을 읽지 못했습니다."));
      reader.readAsText(file);
    }, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

function styleTopbarToolButton(btn) {
  btn.style.setProperty("height", "28px", "important");
  btn.style.setProperty("min-height", "28px", "important");
  btn.style.setProperty("padding", "4px 10px", "important");
  btn.style.setProperty("border-radius", "6px", "important");
  btn.style.setProperty("font-size", "12px", "important");
  btn.style.setProperty("font-weight", "700", "important");
  btn.style.setProperty("white-space", "nowrap", "important");
}

function styleLocalDevMenu(menu, toggle, panel) {
  menu.className = "local-dev-menu local-dev-menu-fixed";
  menu.style.setProperty("position", "relative", "important");
  menu.style.setProperty("display", "inline-flex", "important");
  menu.style.setProperty("align-items", "center", "important");
  menu.style.setProperty("z-index", "1000", "important");

  toggle.className = "local-dev-toggle-btn";
  toggle.type = "button";
  toggle.style.setProperty("height", "28px", "important");
  toggle.style.setProperty("min-height", "28px", "important");
  toggle.style.setProperty("padding", "4px 12px", "important");
  toggle.style.setProperty("border-radius", "999px", "important");
  toggle.style.setProperty("background", "#fef3c7", "important");
  toggle.style.setProperty("color", "#92400e", "important");
  toggle.style.setProperty("border", "1px solid #fde68a", "important");
  toggle.style.setProperty("font-weight", "900", "important");
  toggle.style.setProperty("font-size", "12px", "important");
  toggle.style.setProperty("white-space", "nowrap", "important");

  panel.className = "local-dev-menu-panel local-dev-menu-panel-fixed";
  panel.hidden = true;
  panel.style.setProperty("position", "absolute", "important");
  panel.style.setProperty("right", "0", "important");
  panel.style.setProperty("top", "calc(100% + 6px)", "important");
  panel.style.setProperty("z-index", "9999", "important");
  panel.style.setProperty("display", "none", "important");
  panel.style.setProperty("grid-template-columns", "1fr", "important");
  panel.style.setProperty("gap", "6px", "important");
  panel.style.setProperty("min-width", "158px", "important");
  panel.style.setProperty("padding", "8px", "important");
  panel.style.setProperty("border-radius", "10px", "important");
  panel.style.setProperty("background", "#ffffff", "important");
  panel.style.setProperty("color", "#111827", "important");
  panel.style.setProperty("border", "1px solid #dbe2ef", "important");
  panel.style.setProperty("box-shadow", "0 12px 28px rgba(15,23,42,.22)", "important");
}

function setLocalDevMenuOpen(menu, toggle, panel, open) {
  menu.dataset.open = open ? "true" : "false";
  toggle.textContent = open ? "LOCAL DEV ▴" : "LOCAL DEV ▾";
  toggle.setAttribute("aria-expanded", open ? "true" : "false");
  panel.hidden = !open;
  panel.style.setProperty("display", open ? "grid" : "none", "important");
}

function styleLocalDevActionButton(btn) {
  btn.className = "local-dev-action";
  btn.style.setProperty("display", "block", "important");
  btn.style.setProperty("width", "100%", "important");
  btn.style.setProperty("height", "30px", "important");
  btn.style.setProperty("padding", "7px 10px", "important");
  btn.style.setProperty("border-radius", "8px", "important");
  btn.style.setProperty("background", "#eef4ff", "important");
  btn.style.setProperty("color", "#1e3a5f", "important");
  btn.style.setProperty("border", "1px solid #c7d2e8", "important");
  btn.style.setProperty("text-align", "center", "important");
  btn.style.setProperty("font-weight", "800", "important");
  btn.style.setProperty("font-size", "12px", "important");
  btn.style.setProperty("line-height", "1", "important");
}

function makeDevToolButton(text, title, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "secondary-btn dev-tool-control";
  btn.textContent = text;
  btn.title = title;
  styleTopbarToolButton(btn);
  btn.addEventListener("click", onClick);
  return btn;
}

function setupLocalDevMenu({ onLocalDataChanged } = {}) {
  const menu = document.createElement("span");
  const toggle = document.createElement("button");
  const panel = document.createElement("div");

  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.textContent = "로컬 내보내기";
  exportBtn.addEventListener("click", () => {
    downloadJsonFile(`his-local-dev-${new Date().toISOString().slice(0,10)}.json`, exportLocalSnapshot());
    setLocalDevMenuOpen(menu, toggle, panel, false);
  });

  const importBtn = document.createElement("button");
  importBtn.type = "button";
  importBtn.textContent = "로컬 가져오기";
  importBtn.addEventListener("click", async () => {
    try {
      const json = await pickJsonFile();
      if (!json) return;
      importLocalSnapshot(json);
      onLocalDataChanged?.();
      setLocalDevMenuOpen(menu, toggle, panel, false);
      alert("로컬 데이터를 가져왔습니다.");
    } catch (e) {
      console.error(e);
      alert("JSON 가져오기에 실패했습니다: " + (e?.message || e));
    }
  });

  const resetLocalBtn = document.createElement("button");
  resetLocalBtn.type = "button";
  resetLocalBtn.textContent = "로컬 초기화";
  resetLocalBtn.addEventListener("click", () => {
    if (!confirm("브라우저에 저장된 로컬 개발 데이터를 초기화할까요? Firebase 데이터에는 영향이 없습니다.")) return;
    resetLocalSnapshot();
    onLocalDataChanged?.();
    setLocalDevMenuOpen(menu, toggle, panel, false);
  });

  [exportBtn, importBtn, resetLocalBtn].forEach(styleLocalDevActionButton);
  panel.append(exportBtn, importBtn, resetLocalBtn);
  menu.append(toggle, panel);
  styleLocalDevMenu(menu, toggle, panel);
  setLocalDevMenuOpen(menu, toggle, panel, false);

  toggle.addEventListener("click", event => {
    event.stopPropagation();
    setLocalDevMenuOpen(menu, toggle, panel, menu.dataset.open !== "true");
  });
  document.addEventListener("click", event => {
    if (!menu.contains(event.target)) setLocalDevMenuOpen(menu, toggle, panel, false);
  });
  return menu;
}

function setupSaveQuotaControls(options = {}) {
  const parent = topbarRight || saveStatusEl?.parentElement;
  if (!parent || saveModeBtn) return;

  removeLegacySaveStatus();

  saveModeBtn = document.createElement("button");
  saveModeBtn.type = "button";
  saveModeBtn.className = "secondary-btn save-mode-toggle";
  saveModeBtn.addEventListener("click", async () => {
    const dirty = getDirtyDomains();
    if (dirty.length || lastSaveStatus === "error") {
      lastSaveStatus = "saving";
      updateSaveControlButtons();
      try {
        await savePendingNow();
      } finally {
        updateSaveControlButtons();
      }
      return;
    }
    const next = !isAutoSaveEnabled();
    setAutoSaveEnabled(next);
    lastSaveStatus = "mode";
    updateSaveControlButtons();
  });
  insertBeforeAuth(saveModeBtn);

  const healthBtn = makeDevToolButton(
    "앱 점검",
    "현재 앱 상태, 도메인 로드, 시간표 참조, 주요 모듈 접근성을 점검합니다.",
    () => openAppHealthCheckDialog()
  );
  insertBeforeAuth(healthBtn);

  if (LOCAL_DEV_MODE) {
    insertBeforeAuth(setupLocalDevMenu(options));
  } else {
    const usageBtn = makeDevToolButton(
      "사용량",
      "이 브라우저에서 발생한 Firestore 읽기/쓰기/삭제 추정치를 확인합니다.",
      () => openFirestoreUsageDialog()
    );
    const cleanupBtn = makeDevToolButton(
      "DB 정리",
      "중복 시간표 카드와 교실 홈룸 데이터를 미리보기 후 정리합니다.",
      () => openDataCleanupDialog()
    );
    const diagBtn = makeDevToolButton(
      "Firestore 진단",
      "현재 Firestore 저장 데이터를 JSON으로 내보냅니다. 읽기 quota를 사용합니다.",
      async () => {
        if (!canEdit()) {
          alert("온라인 모드에서 로그인 후 실행할 수 있습니다.");
          return;
        }
        if (!confirm("Firestore 저장 데이터를 진단용 JSON으로 내보낼까요?\n읽기 quota가 일부 사용됩니다.")) return;
        const prevText = diagBtn.textContent;
        diagBtn.disabled = true;
        diagBtn.textContent = "진단 내보내는 중…";
        try {
          const snapshot = await exportFirestoreDiagnosticSnapshot();
          downloadJsonFile(`his-firestore-diagnostic-${new Date().toISOString().slice(0,10)}.json`, snapshot);
        } catch (e) {
          console.error(e);
          alert("Firestore 진단 내보내기에 실패했습니다: " + (e?.message || e));
        } finally {
          diagBtn.disabled = false;
          diagBtn.textContent = prevText;
        }
      }
    );
    insertBeforeAuth(usageBtn);
    insertBeforeAuth(cleanupBtn);
    insertBeforeAuth(diagBtn);
  }

  updateSaveControlButtons();
}

export function setupSaveStatusUi(options = {}) {
  if (initialized) return;
  initialized = true;

  removeLegacySaveStatus();
  setupSaveQuotaControls(options);

  setOnSaveStatus((status, detail) => {
    clearTimeout(saveStatusTimer);
    removeLegacySaveStatus();

    if (status === "saving" || status === "dirty" || status === "saved" || status === "skipped" || status === "mode") {
      lastSaveStatus = status;
      updateSaveControlButtons();
      if (status === "saved" || status === "skipped") {
        saveStatusTimer = setTimeout(() => {
          lastSaveStatus = "mode";
          removeLegacySaveStatus();
          updateSaveControlButtons();
        }, status === "saved" ? 1800 : 1200);
      }
      return;
    }

    lastSaveStatus = "error";
    updateSaveControlButtons();
    console.warn("Save status error", detail);
  });
}
