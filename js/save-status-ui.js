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

function updateSaveControlButtons() {
  const autoSave = isAutoSaveEnabled();
  const dirty = getDirtyDomains();
  if (!saveModeBtn) return;

  if (autoSave) {
    saveModeBtn.textContent = dirty.length ? `자동저장 중(${dirty.length})` : "자동저장 ON";
    saveModeBtn.title = dirty.length
      ? "변경사항이 자동저장 대기 중입니다. 클릭하면 즉시 저장합니다."
      : "현재 자동저장 중입니다. 클릭하면 자동저장을 끕니다.";
    saveModeBtn.disabled = false;
  } else {
    saveModeBtn.textContent = dirty.length ? `수동 저장(${dirty.length})` : "자동저장 OFF";
    saveModeBtn.title = dirty.length
      ? "자동저장이 꺼져 있습니다. 클릭하면 변경사항을 수동 저장합니다."
      : "자동저장이 꺼져 있습니다. 클릭하면 자동저장을 다시 켭니다.";
    saveModeBtn.disabled = false;
  }

  saveModeBtn.classList.toggle("save-mode-on", autoSave);
  saveModeBtn.classList.toggle("save-mode-off", !autoSave);
  saveModeBtn.classList.toggle("manual-save-pending", dirty.length > 0);
  saveModeBtn.setAttribute("aria-pressed", autoSave ? "true" : "false");
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
  saveStatusEl?.insertAdjacentElement("afterend", el);
}

function setupSaveQuotaControls({ onLocalDataChanged } = {}) {
  const parent = saveStatusEl?.parentElement;
  if (!parent || saveModeBtn) return;

  if (LOCAL_DEV_MODE) {
    const devMenu = document.createElement("details");
    devMenu.className = "local-dev-menu";
    devMenu.title = "Firebase를 읽거나 쓰지 않고 localStorage만 사용합니다.";

    const summary = document.createElement("summary");
    summary.textContent = "LOCAL DEV";
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

    panel.append(exportBtn, importBtn, resetLocalBtn);
    devMenu.appendChild(panel);
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
    if (dirty.length) {
      await savePendingNow();
      updateSaveControlButtons();
      return;
    }
    const next = !isAutoSaveEnabled();
    setAutoSaveEnabled(next);
    updateSaveControlButtons();
  });

  insertAfterSaveStatus(saveModeBtn);
  updateSaveControlButtons();
}

export function setupSaveStatusUi(options = {}) {
  if (initialized) return;
  initialized = true;

  setupSaveQuotaControls(options);

  setOnSaveStatus((status, detail) => {
    if (!saveStatusEl) return;
    clearTimeout(saveStatusTimer);
    updateSaveControlButtons();

    if (status === "saving") {
      saveStatusEl.textContent = "💾 저장 대기 중…";
      saveStatusEl.className = "save-status saving";
    } else if (status === "dirty") {
      const count = detail?.dirtyDomains?.length || getDirtyDomains().length;
      saveStatusEl.textContent = `✍️ 변경사항 ${count}개 저장 대기`;
      saveStatusEl.className = "save-status saving";
    } else if (status === "saved") {
      saveStatusEl.textContent = "✅ 저장됨";
      saveStatusEl.className = "save-status saved";
      saveStatusTimer = setTimeout(() => {
        saveStatusEl.textContent = "";
        saveStatusEl.className = "save-status";
        updateSaveControlButtons();
      }, 2500);
    } else if (status === "skipped") {
      saveStatusEl.textContent = "✅ 변경 없음";
      saveStatusEl.className = "save-status saved";
      saveStatusTimer = setTimeout(() => {
        saveStatusEl.textContent = "";
        saveStatusEl.className = "save-status";
        updateSaveControlButtons();
      }, 1500);
    } else if (status === "mode") {
      saveStatusEl.textContent = "";
      saveStatusEl.className = "save-status";
    } else {
      saveStatusEl.textContent = "⚠️ 저장 실패 (네트워크 또는 권한 확인)";
      saveStatusEl.className = "save-status error";
    }
  });
}
