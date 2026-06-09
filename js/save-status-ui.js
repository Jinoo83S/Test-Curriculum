// ================================================================
// save-status-ui.js · Save indicator + quota/local-dev controls
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
} from "./state.js";
import { openDataCleanupDialog } from "./data-cleanup.js";
import { openFirestoreUsageDialog } from "./firestore-usage.js";
import { openAppHealthCheckDialog } from "./app-health-check.js";

const saveStatusEl = document.getElementById("saveStatusEl");
let saveStatusTimer = null;
let saveModeBtn = null;
let initialized = false;
let lastSaveStatus = "mode";

function hideLegacySaveStatus() {
  if (!saveStatusEl) return;
  saveStatusEl.textContent = "";
  saveStatusEl.className = "save-status save-status-inline-hidden";
  saveStatusEl.style.display = "none";
  saveStatusEl.style.width = "0";
  saveStatusEl.style.minWidth = "0";
  saveStatusEl.style.maxWidth = "0";
  saveStatusEl.style.padding = "0";
  saveStatusEl.style.margin = "0";
  saveStatusEl.style.overflow = "hidden";
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

function applyTopButtonBaseStyle(btn) {
  if (!btn) return;
  btn.style.padding = "6px 11px";
  btn.style.borderRadius = "999px";
  btn.style.fontWeight = "800";
  btn.style.whiteSpace = "nowrap";
}

function updateSaveControlButtons() {
  const autoSave = isAutoSaveEnabled();
  const dirty = getDirtyDomains();
  if (!saveModeBtn) return;

  hideLegacySaveStatus();

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
  applyTopButtonBaseStyle(saveModeBtn);

  if (lastSaveStatus === "error") {
    saveModeBtn.style.background = "#fee2e2";
    saveModeBtn.style.color = "#991b1b";
    saveModeBtn.style.border = "1px solid #fecaca";
  } else if (dirty.length) {
    saveModeBtn.style.background = "#fef3c7";
    saveModeBtn.style.color = "#92400e";
    saveModeBtn.style.border = "1px solid #f59e0b";
  } else if (autoSave) {
    saveModeBtn.style.background = "#dcfce7";
    saveModeBtn.style.color = "#166534";
    saveModeBtn.style.border = "1px solid #86efac";
  } else {
    saveModeBtn.style.background = "#f3f4f6";
    saveModeBtn.style.color = "#374151";
    saveModeBtn.style.border = "1px solid #d1d5db";
  }
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

function insertAfterSaveStatus(el) {
  if (saveStatusEl) saveStatusEl.insertAdjacentElement("afterend", el);
  else document.querySelector(".topbar-right")?.prepend(el);
}

function styleLocalDevMenu(devMenu, summary, panel) {
  devMenu.style.position = "relative";
  devMenu.style.display = "inline-flex";
  devMenu.style.alignItems = "center";
  devMenu.style.zIndex = "1000";

  summary.style.listStyle = "none";
  summary.style.cursor = "pointer";
  summary.style.display = "inline-flex";
  summary.style.alignItems = "center";
  summary.style.gap = "4px";
  summary.style.padding = "6px 12px";
  summary.style.borderRadius = "999px";
  summary.style.border = "1px solid #fef3c7";
  summary.style.background = "rgba(255,255,255,0.16)";
  summary.style.color = "#fef3c7";
  summary.style.fontWeight = "800";
  summary.style.fontSize = "12px";
  summary.style.whiteSpace = "nowrap";

  panel.style.position = "absolute";
  panel.style.top = "calc(100% + 8px)";
  panel.style.right = "0";
  panel.style.minWidth = "180px";
  panel.style.display = "grid";
  panel.style.gap = "8px";
  panel.style.padding = "10px";
  panel.style.borderRadius = "10px";
  panel.style.border = "1px solid #dbe2ef";
  panel.style.background = "#ffffff";
  panel.style.color = "#1f2937";
  panel.style.boxShadow = "0 10px 25px rgba(15,23,42,0.18)";
  panel.style.zIndex = "9999";
}

function styleLocalDevActionButton(btn) {
  btn.style.display = "block";
  btn.style.width = "100%";
  btn.style.padding = "8px 10px";
  btn.style.borderRadius = "8px";
  btn.style.background = "#eef4ff";
  btn.style.color = "#1e3a5f";
  btn.style.border = "1px solid #c7d2e8";
  btn.style.textAlign = "left";
  btn.style.fontWeight = "800";
  btn.style.fontSize = "12px";
}

function setupSaveQuotaControls({ onLocalDataChanged } = {}) {
  const parent = saveStatusEl?.parentElement || document.querySelector(".topbar-right");
  if (!parent || saveModeBtn) return;

  hideLegacySaveStatus();

  if (LOCAL_DEV_MODE) {
    const devMenu = document.createElement("details");
    devMenu.className = "local-dev-menu";
    devMenu.title = "Firebase를 읽거나 쓰지 않고 localStorage만 사용합니다.";

    const summary = document.createElement("summary");
    summary.textContent = "LOCAL DEV ▾";
    devMenu.appendChild(summary);

    const panel = document.createElement("div");
    panel.className = "local-dev-menu-panel";

    const exportBtn = document.createElement("button");
    exportBtn.type = "button";
    exportBtn.className = "secondary-btn local-dev-action";
    exportBtn.textContent = "로컬 내보내기";
    exportBtn.addEventListener("click", () => {
      downloadJsonFile(`his-local-dev-${new Date().toISOString().slice(0,10)}.json`, exportLocalSnapshot());
      devMenu.open = false;
    });

    const importBtn = document.createElement("button");
    importBtn.type = "button";
    importBtn.className = "secondary-btn local-dev-action";
    importBtn.textContent = "로컬 가져오기";
    importBtn.addEventListener("click", async () => {
      try {
        const json = await pickJsonFile();
        if (!json) return;
        importLocalSnapshot(json);
        onLocalDataChanged?.();
        devMenu.open = false;
        alert("로컬 데이터를 가져왔습니다.");
      } catch (e) {
        console.error(e);
        alert("JSON 가져오기에 실패했습니다: " + (e?.message || e));
      }
    });

    const resetLocalBtn = document.createElement("button");
    resetLocalBtn.type = "button";
    resetLocalBtn.className = "secondary-btn local-dev-action";
    resetLocalBtn.textContent = "로컬 초기화";
    resetLocalBtn.addEventListener("click", () => {
      if (!confirm("브라우저에 저장된 로컬 개발 데이터를 초기화할까요? Firebase 데이터에는 영향이 없습니다.")) return;
      resetLocalSnapshot();
      onLocalDataChanged?.();
      devMenu.open = false;
    });

    [exportBtn, importBtn, resetLocalBtn].forEach(styleLocalDevActionButton);
    panel.append(exportBtn, importBtn, resetLocalBtn);
    devMenu.appendChild(panel);
    styleLocalDevMenu(devMenu, summary, panel);
    insertAfterSaveStatus(devMenu);

    const healthBtn = document.createElement("button");
    healthBtn.type = "button";
    healthBtn.className = "secondary-btn app-health-check-btn dev-tool-control";
    healthBtn.style.padding = "6px 10px";
    healthBtn.textContent = "앱 점검";
    healthBtn.title = "현재 앱 상태, 도메인 로드, 시간표 참조, 주요 모듈 접근성을 점검합니다.";
    healthBtn.addEventListener("click", () => openAppHealthCheckDialog());
    insertAfterSaveStatus(healthBtn);
  } else {
    const diagBtn = document.createElement("button");
    diagBtn.type = "button";
    diagBtn.className = "secondary-btn firestore-diagnostic-btn dev-tool-control";
    diagBtn.style.padding = "6px 10px";
    diagBtn.textContent = "Firestore 진단";
    diagBtn.title = "현재 Firestore 저장 데이터를 JSON으로 내보냅니다. 읽기 quota를 사용합니다.";
    diagBtn.addEventListener("click", async () => {
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
    });

    const cleanupBtn = document.createElement("button");
    cleanupBtn.type = "button";
    cleanupBtn.className = "secondary-btn data-cleanup-btn dev-tool-control";
    cleanupBtn.style.padding = "6px 10px";
    cleanupBtn.textContent = "DB 정리";
    cleanupBtn.title = "중복 시간표 카드와 교실 홈룸 데이터를 미리보기 후 정리합니다.";
    cleanupBtn.addEventListener("click", () => openDataCleanupDialog());

    const usageBtn = document.createElement("button");
    usageBtn.type = "button";
    usageBtn.className = "secondary-btn firestore-usage-btn dev-tool-control";
    usageBtn.style.padding = "6px 10px";
    usageBtn.textContent = "사용량";
    usageBtn.title = "이 브라우저에서 발생한 Firestore 읽기/쓰기/삭제 추정치를 확인합니다.";
    usageBtn.addEventListener("click", () => openFirestoreUsageDialog());

    const healthBtn = document.createElement("button");
    healthBtn.type = "button";
    healthBtn.className = "secondary-btn app-health-check-btn dev-tool-control";
    healthBtn.style.padding = "6px 10px";
    healthBtn.textContent = "앱 점검";
    healthBtn.title = "현재 앱 상태, 도메인 로드, 시간표 참조, 주요 모듈 접근성을 점검합니다.";
    healthBtn.addEventListener("click", () => openAppHealthCheckDialog());

    insertAfterSaveStatus(cleanupBtn);
    insertAfterSaveStatus(usageBtn);
    insertAfterSaveStatus(healthBtn);
    insertAfterSaveStatus(diagBtn);
  }

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

  insertAfterSaveStatus(saveModeBtn);
  updateSaveControlButtons();
}

export function setupSaveStatusUi(options = {}) {
  if (initialized) return;
  initialized = true;

  hideLegacySaveStatus();
  setupSaveQuotaControls(options);

  setOnSaveStatus((status, detail) => {
    clearTimeout(saveStatusTimer);
    hideLegacySaveStatus();

    if (status === "saving" || status === "dirty" || status === "saved" || status === "skipped" || status === "mode") {
      lastSaveStatus = status;
      updateSaveControlButtons();
      if (status === "saved" || status === "skipped") {
        saveStatusTimer = setTimeout(() => {
          lastSaveStatus = "mode";
          hideLegacySaveStatus();
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
