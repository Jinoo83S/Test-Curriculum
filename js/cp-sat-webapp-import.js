// ================================================================
// cp-sat-webapp-import.js · CP-SAT import/apply/rollback UI
// r132: reads cp_sat_webapp_import.json and safely replaces timetable.entries
// ================================================================

const CP_SAT_IMPORT_UI_ID = "ttCpSatImportOverlay";
const CP_SAT_IMPORT_BUTTON_ID = "ttCpSatImportBtn";
const CP_SAT_IMPORT_STYLE_ID = "ttCpSatImportStyle";

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function deepClone(v) {
  return JSON.parse(JSON.stringify(v ?? null));
}

function safeNowIso() {
  try { return new Date().toISOString(); } catch (_) { return String(Date.now()); }
}

function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error("파일이 선택되지 않았습니다.")); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try { resolve(JSON.parse(String(reader.result || "{}"))); }
      catch (e) { reject(new Error(`JSON 파일을 읽을 수 없습니다: ${e?.message || e}`)); }
    };
    reader.onerror = () => reject(new Error("파일 읽기 중 오류가 발생했습니다."));
    reader.readAsText(file, "utf-8");
  });
}

function extractEntriesFromPackage(pkg = {}, mode = "apply") {
  const root = pkg || {};
  if (mode === "rollback") {
    return firstArray(
      root.rollbackEntries,
      root.rollback?.entries,
      root.rollbackPatch?.entries,
      root.restoreEntries,
      root.originalEntries,
      root.payload?.rollbackEntries,
      root.payload?.rollback?.entries,
      root.data?.rollbackEntries,
      root.data?.rollback?.entries
    );
  }
  return firstArray(
    root.entries,
    root.importEntries,
    root.proposedEntries,
    root.proposedReplacement?.entries,
    root.entriesPatch?.entries,
    root.patch?.entries,
    root.payload?.entries,
    root.payload?.proposedEntries,
    root.payload?.proposedReplacement?.entries,
    root.data?.entries,
    root.data?.proposedEntries,
    root.normalized?.timetable?.entries,
    root.timetable?.entries
  );
}

function firstArray(...items) {
  for (const item of items) if (Array.isArray(item)) return item;
  return [];
}

function entryClassKeys(entry = {}) {
  const direct = asArray(entry.classKeys).map(String).filter(Boolean);
  if (direct.length) return direct;
  const gradeKeys = asArray(entry.gradeKeys).map(String).filter(Boolean);
  if (gradeKeys.length) return gradeKeys;
  const g = String(entry.gradeKey || entry.grade || "").trim();
  if (!g) return [];
  const sectionIdx = Number.isInteger(entry.sectionIdx) ? entry.sectionIdx : parseInt(entry.sectionIdx, 10);
  if (Number.isInteger(sectionIdx) && sectionIdx >= 0) {
    const gradeNum = (g.match(/\d+/) || [g])[0];
    const section = String.fromCharCode(65 + sectionIdx);
    return [`${gradeNum}:${section}`];
  }
  return [g];
}

function entryRoomIds(entry = {}) {
  const out = [];
  if (entry.roomId) out.push(String(entry.roomId));
  asArray(entry.roomIds).forEach(id => id && out.push(String(id)));
  const byCard = entry.componentRoomIdsByTtCardId || entry.roomIdsByTtCardId || entry.roomAssignmentsByTtCardId || {};
  Object.values(byCard || {}).forEach(v => {
    if (Array.isArray(v)) v.forEach(id => id && out.push(String(id)));
    else if (v) out.push(String(v));
  });
  return [...new Set(out)];
}

function entryTeacherNames(entry = {}) {
  const out = [];
  asArray(entry.teacherNames).forEach(v => v && out.push(String(v).trim()));
  String(entry.teacherName || "").split(/[,/·，]+/).forEach(v => {
    const s = v.trim();
    if (s) out.push(s);
  });
  return [...new Set(out.filter(Boolean))];
}

function validateEntries(list = [], { targetClassSlots = 525 } = {}) {
  const entries = asArray(list).filter(e => e && typeof e === "object");
  const missingTime = [];
  const classSlotSet = new Set();
  const teacherSlotMap = new Map();
  const roomSlotMap = new Map();

  entries.forEach((entry, index) => {
    const day = Number(entry.day);
    const period = Number(entry.period);
    if (!Number.isInteger(day) || !Number.isInteger(period)) {
      missingTime.push({ index, id: entry.id || "", title: entry.title || entry.name || entry.groupName || "" });
      return;
    }
    const slotKey = `${day}:${period}`;
    entryClassKeys(entry).forEach(k => classSlotSet.add(`${k}@${slotKey}`));
    entryTeacherNames(entry).forEach(name => {
      const key = `${name}@${slotKey}`;
      if (!teacherSlotMap.has(key)) teacherSlotMap.set(key, []);
      teacherSlotMap.get(key).push(entry.id || `${index}`);
    });
    entryRoomIds(entry).forEach(roomId => {
      const key = `${roomId}@${slotKey}`;
      if (!roomSlotMap.has(key)) roomSlotMap.set(key, []);
      roomSlotMap.get(key).push(entry.id || `${index}`);
    });
  });

  const teacherConflictCount = [...teacherSlotMap.values()].filter(v => v.length > 1).length;
  const roomConflictCount = [...roomSlotMap.values()].filter(v => v.length > 1).length;
  const classSlotCount = classSlotSet.size;
  const classSlotGap = Math.max(0, Number(targetClassSlots || 0) - classSlotCount);

  return {
    entryCount: entries.length,
    classSlotCount,
    targetClassSlots,
    classSlotGap,
    missingTimeCount: missingTime.length,
    teacherConflictCount,
    roomConflictCount,
    ok: entries.length > 0 && missingTime.length === 0 && classSlotGap === 0,
    warnings: [
      ...(teacherConflictCount ? [`교사 시간 중복 가능성 ${teacherConflictCount}건`] : []),
      ...(roomConflictCount ? [`교실 시간 중복 가능성 ${roomConflictCount}건`] : []),
    ],
    missingTimeSample: missingTime.slice(0, 10),
  };
}

function summarizePackage(pkg = {}, normalizeTimetableEntry) {
  const entriesRaw = extractEntriesFromPackage(pkg, "apply");
  const rollbackRaw = extractEntriesFromPackage(pkg, "rollback");
  const entries = entriesRaw.map(e => normalizeTimetableEntry ? normalizeTimetableEntry(e) : e).filter(Boolean);
  const rollbackEntries = rollbackRaw.map(e => normalizeTimetableEntry ? normalizeTimetableEntry(e) : e).filter(Boolean);
  const target = Number(pkg?.targetClassSlots || pkg?.validation?.targetClassSlots || pkg?.manifest?.targetClassSlots || 525) || 525;
  const validation = validateEntries(entries, { targetClassSlots: target });
  return {
    importType: pkg.importType || pkg.type || pkg.mode || "cp-sat-webapp-import",
    targetPath: pkg.targetPath || "normalized.timetable.entries",
    entryCount: entries.length,
    rollbackEntryCount: rollbackEntries.length,
    canRollback: rollbackEntries.length > 0,
    safetyOk: pkg.safetyOk !== false && pkg.okToManualImport !== false && pkg.okToApply !== false,
    validation,
    okToApply: validation.ok && entries.length > 0 && pkg.safetyOk !== false && pkg.okToManualImport !== false && pkg.okToApply !== false,
  };
}

function classSlotSignature(list = []) {
  const set = new Set();
  asArray(list).forEach(entry => {
    if (!entry) return;
    const day = Number(entry.day);
    const period = Number(entry.period);
    if (!Number.isInteger(day) || !Number.isInteger(period)) return;
    entryClassKeys(entry).forEach(k => set.add(`${k}@${day}:${period}`));
  });
  return set;
}

function compareCurrentToIncoming(current = [], incoming = []) {
  const cur = classSlotSignature(current);
  const inc = classSlotSignature(incoming);
  let unchanged = 0;
  inc.forEach(k => { if (cur.has(k)) unchanged += 1; });
  return {
    currentClassSlots: cur.size,
    incomingClassSlots: inc.size,
    unchangedClassSlots: unchanged,
    changedClassSlots: Math.max(0, inc.size - unchanged),
    emptyToFilledClassSlots: [...inc].filter(k => !cur.has(k)).length,
    filledToEmptyClassSlots: [...cur].filter(k => !inc.has(k)).length,
  };
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
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function ensureStyle() {
  if (document.getElementById(CP_SAT_IMPORT_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = CP_SAT_IMPORT_STYLE_ID;
  style.textContent = `
    .tt-cpsat-btn{background:#15803d!important;border-color:#15803d!important}.tt-cpsat-btn:hover{background:#166534!important}
    .tt-cpsat-overlay{position:fixed;inset:0;background:rgba(15,23,42,.42);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px}
    .tt-cpsat-modal{width:min(860px,96vw);max-height:92vh;overflow:auto;background:#fff;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.35);border:1px solid #cbd5e1;color:#0f172a}
    .tt-cpsat-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:16px 18px;border-bottom:1px solid #e2e8f0;background:#f8fafc}.tt-cpsat-head h3{margin:0 0 4px;font-size:18px}.tt-cpsat-head p{margin:0;color:#475569;font-size:13px}
    .tt-cpsat-body{padding:16px 18px}.tt-cpsat-box{border:1px solid #cbd5e1;border-radius:10px;padding:12px;margin:10px 0;background:#fff}.tt-cpsat-box.ok{border-color:#22c55e;background:#f0fdf4}.tt-cpsat-box.warn{border-color:#f59e0b;background:#fffbeb}.tt-cpsat-box.bad{border-color:#ef4444;background:#fef2f2}
    .tt-cpsat-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.tt-cpsat-actions button,.tt-cpsat-close{padding:7px 11px;border:1px solid #94a3b8;border-radius:8px;background:#fff;cursor:pointer;font-weight:700}.tt-cpsat-actions button.primary{background:#2563eb;color:#fff;border-color:#2563eb}.tt-cpsat-actions button.danger{background:#dc2626;color:#fff;border-color:#dc2626}.tt-cpsat-actions button:disabled{opacity:.45;cursor:not-allowed}
    .tt-cpsat-table{border-collapse:collapse;width:100%;font-size:12px}.tt-cpsat-table th,.tt-cpsat-table td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}.tt-cpsat-table th{width:220px;background:#f1f5f9}.tt-cpsat-pre{white-space:pre-wrap;background:#0f172a;color:#e2e8f0;padding:10px;border-radius:8px;max-height:220px;overflow:auto;font-size:12px}
  `;
  document.head.appendChild(style);
}

function row(label, value, escapeHtml) {
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
}

export function setupCpSatWebappImport(ctx = {}) {
  const {
    ttDomain,
    entries,
    ttConfig,
    canEdit,
    saveNow,
    normalizeTimetableEntry,
    captureTimetableUndo,
    recomputeConflicts,
    renderAll,
    uid,
    clean,
    escapeHtml = (v) => String(v ?? "").replace(/[&<>]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;" }[c])),
  } = ctx;

  ensureStyle();
  if (!document.getElementById(CP_SAT_IMPORT_BUTTON_ID)) {
    const btn = document.createElement("button");
    btn.id = CP_SAT_IMPORT_BUTTON_ID;
    btn.type = "button";
    btn.className = "tt-cpsat-btn";
    btn.textContent = "🧩 CP-SAT 적용";
    const anchor = document.getElementById("ttScheduleVersionsBtn") || document.getElementById("ttAutoAssignBtn") || document.getElementById("ttSaveBtn");
    anchor?.insertAdjacentElement("afterend", btn);
    btn.addEventListener("click", () => openOverlay());
  }

  function normalizeEntryList(list) {
    return asArray(list).map(e => normalizeTimetableEntry ? normalizeTimetableEntry(e) : e).filter(e => e && typeof e === "object");
  }

  function makeBackupVersion(name = "CP-SAT 적용 전 백업") {
    const domain = ttDomain?.();
    if (!domain) return null;
    const backup = {
      id: uid ? uid("ttv") : `ttv-${Date.now()}`,
      name: clean ? clean(name) : name,
      note: "CP-SAT import 적용 직전 자동 백업",
      createdAt: safeNowIso(),
      updatedAt: safeNowIso(),
      periodCount: ttConfig?.().periodCount || 7,
      entryCount: asArray(entries?.()).length,
      entries: deepClone(asArray(entries?.())),
    };
    domain.savedSchedules = [backup, ...asArray(domain.savedSchedules)].slice(0, 30);
    return backup;
  }

  async function applyEntries(nextEntries, label) {
    if (!canEdit?.()) { alert("편집 권한이 없습니다. 로그인/권한을 확인하세요."); return false; }
    const domain = ttDomain?.();
    if (!domain) { alert("시간표 데이터가 아직 로드되지 않았습니다."); return false; }
    const normalized = normalizeEntryList(nextEntries);
    const summary = validateEntries(normalized);
    if (!summary.ok) {
      const proceed = confirm(`검증 경고가 있습니다. 그래도 적용할까요?\n\nentries: ${summary.entryCount}\n학급칸: ${summary.classSlotCount}/${summary.targetClassSlots}\n미시간: ${summary.missingTimeCount}\n교사중복: ${summary.teacherConflictCount}\n교실중복: ${summary.roomConflictCount}`);
      if (!proceed) return false;
    }
    const backup = makeBackupVersion(`${label} 전 백업 ${new Date().toLocaleString("ko-KR")}`);
    captureTimetableUndo?.(label);
    domain.entries = normalized;
    domain.autoAssignMeta = {
      ...(domain.autoAssignMeta || {}),
      source: "cp-sat-webapp-import-r132",
      importedAt: safeNowIso(),
      importedEntryCount: normalized.length,
      importedClassSlotCount: summary.classSlotCount,
      backupVersionId: backup?.id || null,
    };
    await saveNow?.("timetable", { force: true, throwOnError: true });
    recomputeConflicts?.();
    renderAll?.();
    alert(`${label} 완료\nentries ${normalized.length}개 / 학급칸 ${summary.classSlotCount}/${summary.targetClassSlots}\n백업도 배치 보관에 저장했습니다.`);
    return true;
  }

  function openOverlay() {
    document.getElementById(CP_SAT_IMPORT_UI_ID)?.remove();
    let importPackage = null;
    let currentSummary = null;
    let applyEntriesList = [];
    let rollbackEntriesList = [];

    const overlay = document.createElement("div");
    overlay.id = CP_SAT_IMPORT_UI_ID;
    overlay.className = "tt-cpsat-overlay";
    overlay.innerHTML = `
      <div class="tt-cpsat-modal" role="dialog" aria-modal="true" aria-labelledby="ttCpSatTitle">
        <div class="tt-cpsat-head">
          <div>
            <h3 id="ttCpSatTitle">CP-SAT 결과 적용</h3>
            <p><b>cp_sat_webapp_import.json</b>을 선택해 검증한 뒤, 현재 시간표 entries만 교체합니다. 카드/교사조건/교실정보는 그대로 둡니다.</p>
          </div>
          <button type="button" class="tt-cpsat-close" data-action="close">×</button>
        </div>
        <div class="tt-cpsat-body">
          <div class="tt-cpsat-box warn">
            <b>사용 순서</b><br>
            1) 로컬 테스트 메뉴 24번에서 만든 <code>cp_sat_webapp_import.json</code> 선택<br>
            2) 검증 결과 확인<br>
            3) <b>적용</b> 클릭 → Firestore 저장<br>
            4) 문제가 있으면 같은 파일로 <b>롤백</b> 클릭
          </div>
          <div class="tt-cpsat-box">
            <input id="ttCpSatFile" type="file" accept=".json,application/json">
            <div class="tt-cpsat-actions">
              <button type="button" data-action="validate">다시 검증</button>
              <button type="button" class="primary" data-action="apply" disabled>CP-SAT 결과 적용</button>
              <button type="button" class="danger" data-action="rollback" disabled>롤백 적용</button>
              <button type="button" data-action="download-current">현재 entries 백업 다운로드</button>
            </div>
          </div>
          <div id="ttCpSatStatus" class="tt-cpsat-box warn">파일을 선택하세요.</div>
          <div id="ttCpSatSummary" class="tt-cpsat-box"></div>
          <pre id="ttCpSatDetails" class="tt-cpsat-pre"></pre>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const $ = sel => overlay.querySelector(sel);
    const applyBtn = $('[data-action="apply"]');
    const rollbackBtn = $('[data-action="rollback"]');

    function renderSummary() {
      if (!importPackage) return;
      currentSummary = summarizePackage(importPackage, normalizeTimetableEntry);
      applyEntriesList = normalizeEntryList(extractEntriesFromPackage(importPackage, "apply"));
      rollbackEntriesList = normalizeEntryList(extractEntriesFromPackage(importPackage, "rollback"));
      const comparison = compareCurrentToIncoming(entries?.() || [], applyEntriesList);
      const ok = !!currentSummary.okToApply;
      $("#ttCpSatStatus").className = `tt-cpsat-box ${ok ? "ok" : "warn"}`;
      $("#ttCpSatStatus").innerHTML = ok
        ? "<b>적용 가능</b> — 525/525 학급칸 기준 검증을 통과했습니다."
        : "<b>확인 필요</b> — 상세 검증 값을 확인하세요.";
      $("#ttCpSatSummary").innerHTML = `<table class="tt-cpsat-table">
        ${row("entries", currentSummary.entryCount, escapeHtml)}
        ${row("rollback entries", currentSummary.rollbackEntryCount, escapeHtml)}
        ${row("학급칸", `${currentSummary.validation.classSlotCount} / ${currentSummary.validation.targetClassSlots}`, escapeHtml)}
        ${row("classSlotGap", currentSummary.validation.classSlotGap, escapeHtml)}
        ${row("missingTime", currentSummary.validation.missingTimeCount, escapeHtml)}
        ${row("교사 중복 가능성", currentSummary.validation.teacherConflictCount, escapeHtml)}
        ${row("교실 중복 가능성", currentSummary.validation.roomConflictCount, escapeHtml)}
        ${row("현재→새 결과 변경칸", comparison.changedClassSlots, escapeHtml)}
        ${row("새로 채워지는 칸", comparison.emptyToFilledClassSlots, escapeHtml)}
        ${row("비워지는 칸", comparison.filledToEmptyClassSlots, escapeHtml)}
      </table>`;
      $("#ttCpSatDetails").textContent = JSON.stringify({ summary: currentSummary, comparison }, null, 2);
      applyBtn.disabled = !currentSummary.okToApply;
      rollbackBtn.disabled = !currentSummary.canRollback;
    }

    overlay.addEventListener("click", ev => { if (ev.target === overlay) overlay.remove(); });
    $('[data-action="close"]')?.addEventListener("click", () => overlay.remove());
    $("#ttCpSatFile")?.addEventListener("change", async ev => {
      try { importPackage = await readJsonFile(ev.target.files?.[0]); renderSummary(); }
      catch (e) { alert(e?.message || e); }
    });
    $('[data-action="validate"]')?.addEventListener("click", renderSummary);
    applyBtn?.addEventListener("click", async () => {
      if (!importPackage) { alert("파일을 먼저 선택하세요."); return; }
      const msg = `CP-SAT 결과를 현재 시간표에 적용할까요?\n\nentries: ${currentSummary?.entryCount || 0}\n학급칸: ${currentSummary?.validation?.classSlotCount || 0}/${currentSummary?.validation?.targetClassSlots || 525}\n\n현재 entries는 배치 보관에 자동 백업됩니다.`;
      if (!confirm(msg)) return;
      try { if (await applyEntries(applyEntriesList, "CP-SAT 결과 적용")) overlay.remove(); }
      catch (e) { alert(`적용 실패: ${e?.message || e}`); }
    });
    rollbackBtn?.addEventListener("click", async () => {
      if (!importPackage) { alert("파일을 먼저 선택하세요."); return; }
      if (!rollbackEntriesList.length) { alert("롤백 entries가 없습니다."); return; }
      if (!confirm("롤백 entries를 적용할까요? 현재 시간표는 배치 보관에 자동 백업됩니다.")) return;
      try { if (await applyEntries(rollbackEntriesList, "CP-SAT 롤백 적용")) overlay.remove(); }
      catch (e) { alert(`롤백 실패: ${e?.message || e}`); }
    });
    $('[data-action="download-current"]')?.addEventListener("click", () => {
      downloadJson(`his_timetable_entries_backup_${Date.now()}.json`, {
        mode: "his-timetable-current-entries-backup",
        exportedAt: safeNowIso(),
        entries: deepClone(entries?.() || []),
      });
    });
  }

  window.HisCpSatWebappImport = {
    readJsonFile,
    extractEntriesFromPackage,
    summarizePackage: (pkg) => summarizePackage(pkg, normalizeTimetableEntry),
    validateEntries,
    compareCurrentToIncoming: (incoming) => compareCurrentToIncoming(entries?.() || [], incoming),
  };
}
