// ================================================================
// cp-sat-webapp-import.js · HIS current timetable webapp CP-SAT API bridge
// r170: 현재 웹앱 연결 + solver 전송 JSON에서 학생 객체/시간표 학생필드 제거 + 결과 적용 시 교실 배정 보존.
// ================================================================

const CP_SAT_API_UI_ID = "ttCpSatApiOverlay";
const CP_SAT_API_BUTTON_ID = "ttCpSatApiBtn";
const CP_SAT_API_STYLE_ID = "ttCpSatApiStyle";
const API_URL_KEY = "his_cp_sat_api_base_v1";
const API_DEFAULT = "http://127.0.0.1:7860";

const asArray = v => Array.isArray(v) ? v : [];
const cleanLocal = v => String(v ?? "").trim();
const deepClone = v => JSON.parse(JSON.stringify(v ?? null));
const nowIso = () => { try { return new Date().toISOString(); } catch (_) { return String(Date.now()); } };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const unique = list => [...new Set(asArray(list).map(cleanLocal).filter(Boolean))];

function normalizeApiBase(v) {
  const s = cleanLocal(v || API_DEFAULT).replace(/\/+$/, "");
  return s || API_DEFAULT;
}
function escapeDefault(v) {
  return String(v ?? "").replace(/[&<>'"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[c]));
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
async function postJson(url, body, timeoutMs = 15000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
    if (!res.ok) {
      const msg = data?.detail || data?.message || data?.raw || `${res.status} ${res.statusText}`;
      throw new Error(String(msg));
    }
    return data;
  } catch (err) {
    if (err?.name === "AbortError") throw new Error("요청 시간이 초과되었습니다. API 서버가 실행 중인지 확인하세요.");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
async function getJson(url, timeoutMs = 10000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: "no-store" });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
    if (!res.ok) {
      const msg = data?.detail || data?.message || data?.raw || `${res.status} ${res.statusText}`;
      throw new Error(String(msg));
    }
    return data;
  } catch (err) {
    if (err?.name === "AbortError") throw new Error("요청 시간이 초과되었습니다. API 서버가 실행 중인지 확인하세요.");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function stripTeacherPrivateFields(t) {
  if (!t || typeof t !== "object") return t;
  const keep = { ...t };
  ["email", "phone", "mobile", "address", "memo", "note", "extra"].forEach(k => { if (k in keep) keep[k] = ""; });
  return keep;
}
function stripSolverOnlyState(state) {
  const copy = deepClone(state);
  const payload = copy?.data || copy?.normalized || copy;

  // r170 원칙: 시간표/solver 전송 JSON에는 학급 학생 객체를 싣지 않습니다.
  // 학생 충돌 계산은 rosters.rosters[].studentId만 사용합니다.
  asArray(payload?.classes?.classes).forEach(cls => {
    if (cls && typeof cls === "object") delete cls.students;
  });

  const tt = payload?.timetable || {};
  asArray(tt.ttcards || tt.ttCards || tt.cards).forEach(card => {
    if (card && typeof card === "object") delete card.studentKeys;
  });
  asArray(tt.entries).forEach(entry => {
    if (entry && typeof entry === "object") delete entry.audienceStudentKeys;
  });
  asArray(tt.savedSchedules).forEach(sched => {
    asArray(sched?.entries).forEach(entry => {
      if (entry && typeof entry === "object") delete entry.audienceStudentKeys;
    });
  });

  const teachers = asArray(payload?.teachers?.teachers);
  for (let i = 0; i < teachers.length; i += 1) teachers[i] = stripTeacherPrivateFields(teachers[i]);
  if (copy.note) copy.note = "solver-only payload - class students removed";
  return copy;
}
function privacyReport(state) {
  const payload = state?.data || state?.normalized || state || {};
  const tt = payload?.timetable || {};
  const classes = asArray(payload?.classes?.classes);
  const cards = asArray(tt.ttcards || tt.ttCards || tt.cards);
  const entries = asArray(tt.entries);
  return {
    classesWithStudents: classes.filter(c => asArray(c?.students).length).length,
    studentObjects: classes.reduce((sum, c) => sum + asArray(c?.students).length, 0),
    ttcardsWithStudentKeys: cards.filter(c => asArray(c?.studentKeys).length).length,
    entriesWithAudienceStudentKeys: entries.filter(e => asArray(e?.audienceStudentKeys).length).length,
  };
}
function makeSolverState(appState) {
  const data = {
    curriculum: appState?.curriculum || {},
    templates: appState?.templates || {},
    classes: appState?.classes || {},
    teachers: appState?.teachers || {},
    rosters: appState?.rosters || {},
    rooms: appState?.rooms || {},
    timetable: appState?.timetable || {},
  };
  const wrapped = {
    version: 1,
    mode: "his-webapp-live-state-for-cp-sat",
    exportedAt: nowIso(),
    source: "HIS webapp r170 CP-SAT API bridge",
    data: deepClone(data),
  };
  return stripSolverOnlyState(wrapped);
}
function payloadFromWrappedState(state) { return state?.data || state?.normalized || state || {}; }
function countSolverState(state) {
  const payload = payloadFromWrappedState(state);
  const tt = payload?.timetable || {};
  const cards = asArray(tt?.ttcards).length ? asArray(tt.ttcards) : asArray(tt?.ttCards).length ? asArray(tt.ttCards) : asArray(tt?.cards);
  const groups = asArray(tt?.ttcardGroups).length ? asArray(tt.ttcardGroups) : asArray(tt?.ttCardGroups);
  return {
    cards: cards.length,
    groups: groups.length,
    entries: asArray(tt?.entries).length,
    classes: asArray(payload?.classes?.classes).length,
    teachers: asArray(payload?.teachers?.teachers).length,
    rooms: asArray(payload?.rooms?.rooms).length,
  };
}
function isSolverStateEmpty(state) {
  const c = countSolverState(state);
  return c.cards <= 0 || c.classes <= 0;
}
function emptyStateMessage(state) {
  const c = countSolverState(state);
  return `현재 웹앱 데이터가 비어 있습니다. 카드 ${c.cards}개, 학급 ${c.classes}개, entries ${c.entries}개입니다. Firestore/로컬 데이터를 먼저 로드해야 합니다.`;
}
function entriesSummary(entries = []) {
  const list = asArray(entries);
  const slotSet = new Set();
  list.forEach(e => {
    const day = Number(e?.day);
    const period = Number(e?.period);
    if (!Number.isInteger(day) || !Number.isInteger(period)) return;
    const classes = asArray(e?.audienceClassKeys).length ? asArray(e.audienceClassKeys)
      : asArray(e?.classKeys).length ? asArray(e.classKeys)
      : asArray(e?.gradeKeys).length ? asArray(e.gradeKeys)
      : e?.gradeKey ? [e.gradeKey] : [];
    classes.forEach(k => slotSet.add(`${String(k)}@${day}:${period}`));
  });
  return { entryCount: list.length, classSlotCount: slotSet.size };
}
function sanitizeRoomAssignments(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw)
    .map(([cardId, roomId]) => [cleanLocal(cardId), cleanLocal(roomId)])
    .filter(([cardId, roomId]) => cardId && roomId));
}
function isGroupedSolvedEntry(entry = {}) {
  const ids = unique([...(entry.ttcardIds || []), entry.ttcardId]);
  return !!entry.groupId || ids.length > 1;
}

function ensureStyle() {
  if (document.getElementById(CP_SAT_API_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = CP_SAT_API_STYLE_ID;
  style.textContent = `
    .tt-cpsat-api-btn{background:#16a34a!important;border-color:#16a34a!important;color:#fff!important}.tt-cpsat-api-btn:hover{background:#15803d!important}
    .tt-cpsat-api-overlay{position:fixed;inset:0;background:rgba(15,23,42,.48);z-index:99999;display:flex;align-items:center;justify-content:center;padding:18px}
    .tt-cpsat-api-modal{width:min(920px,96vw);max-height:92vh;overflow:auto;background:#fff;border-radius:14px;box-shadow:0 22px 70px rgba(0,0,0,.34);border:1px solid #cbd5e1;color:#0f172a}
    .tt-cpsat-api-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:16px 18px;border-bottom:1px solid #e2e8f0;background:#f8fafc}.tt-cpsat-api-head h3{margin:0 0 4px;font-size:18px}.tt-cpsat-api-head p{margin:0;color:#475569;font-size:13px}
    .tt-cpsat-api-body{padding:16px 18px}.tt-cpsat-api-grid{display:grid;grid-template-columns:1fr 120px 100px;gap:8px;align-items:end}@media(max-width:720px){.tt-cpsat-api-grid{grid-template-columns:1fr}}
    .tt-cpsat-api-field label{display:block;font-size:12px;font-weight:800;color:#475569;margin-bottom:4px}.tt-cpsat-api-field input{width:100%;height:32px;border:1px solid #cbd5e1;border-radius:8px;padding:4px 8px;font-size:13px}.tt-cpsat-api-field input[type=number]{text-align:center}
    .tt-cpsat-api-box{border:1px solid #cbd5e1;border-radius:10px;padding:12px;margin:10px 0;background:#fff}.tt-cpsat-api-box.ok{border-color:#22c55e;background:#f0fdf4}.tt-cpsat-api-box.warn{border-color:#f59e0b;background:#fffbeb}.tt-cpsat-api-box.bad{border-color:#ef4444;background:#fef2f2}.tt-cpsat-api-box.info{border-color:#38bdf8;background:#f0f9ff}
    .tt-cpsat-api-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.tt-cpsat-api-actions button,.tt-cpsat-api-close{padding:7px 11px;border:1px solid #94a3b8;border-radius:8px;background:#fff;cursor:pointer;font-weight:800}.tt-cpsat-api-actions button.primary{background:#2563eb;color:#fff;border-color:#2563eb}.tt-cpsat-api-actions button.good{background:#059669;color:#fff;border-color:#059669}.tt-cpsat-api-actions button:disabled{opacity:.45;cursor:not-allowed}
    .tt-cpsat-api-table{border-collapse:collapse;width:100%;font-size:12px}.tt-cpsat-api-table th,.tt-cpsat-api-table td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}.tt-cpsat-api-table th{width:210px;background:#f1f5f9}.tt-cpsat-api-pre{white-space:pre-wrap;background:#0f172a;color:#e2e8f0;padding:10px;border-radius:8px;max-height:210px;overflow:auto;font-size:12px}
    .tt-cpsat-api-progress{height:10px;background:#e2e8f0;border-radius:999px;overflow:hidden;margin-top:8px}.tt-cpsat-api-progress span{display:block;height:100%;width:0%;background:#2563eb;transition:width .25s}
    .tt-cpsat-api-checkline{display:flex;gap:8px;align-items:center;margin-top:8px;color:#334155;font-size:12px}.tt-cpsat-api-checkline input{width:auto;height:auto}
  `;
  document.head.appendChild(style);
}
function tableRows(rows, esc) {
  return `<table class="tt-cpsat-api-table"><tbody>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table>`;
}

export function setupCpSatWebappImport(ctx = {}) {
  const {
    appState,
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
    clean = cleanLocal,
    escapeHtml = escapeDefault,
  } = ctx;

  ensureStyle();
  installCpSatButton();

  function findExistingCpSatButton() {
    const byId = document.getElementById(CP_SAT_API_BUTTON_ID)
      || document.getElementById("ttCpSatApplyBtn")
      || document.getElementById("ttCpSatBtn")
      || document.getElementById("ttCpsatBtn");
    if (byId) return byId;
    return [...document.querySelectorAll("button")].find(b => /CP\s*-\s*SAT|CPSAT/i.test(String(b.textContent || b.id || b.className || ""))) || null;
  }

  function installCpSatButton() {
    let btn = findExistingCpSatButton();
    if (btn) {
      // 기존 버튼에 구버전 이벤트가 붙어 있을 수 있으므로 복제해서 구버전 핸들러를 제거합니다.
      const fresh = btn.cloneNode(true);
      fresh.id = CP_SAT_API_BUTTON_ID;
      fresh.type = "button";
      fresh.classList.add("tt-cpsat-api-btn");
      fresh.textContent = "☘ CP-SAT 적용";
      fresh.title = "현재 시간표 데이터를 로컬/클라우드 CP-SAT API로 보내 자동배치합니다.";
      btn.replaceWith(fresh);
      btn = fresh;
    } else {
      btn = document.createElement("button");
      btn.id = CP_SAT_API_BUTTON_ID;
      btn.type = "button";
      btn.className = "tt-cpsat-api-btn";
      btn.textContent = "☘ CP-SAT 적용";
      btn.title = "현재 시간표 데이터를 로컬/클라우드 CP-SAT API로 보내 자동배치합니다.";
      const anchor = document.getElementById("ttAutoAssignBtn") || document.getElementById("ttScheduleVersionsBtn") || document.getElementById("ttSaveBtn");
      if (anchor) anchor.insertAdjacentElement("afterend", btn);
      else document.querySelector(".tt-topbar-right")?.appendChild(btn);
    }
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openOverlay();
    });
  }

  function normalizeSolvedEntry(rawEntry) {
    const raw = deepClone(rawEntry || {});
    const normalized = normalizeTimetableEntry ? normalizeTimetableEntry(raw) : raw;

    // r170 핵심: 현재 운영 웹앱의 state.js가 오래된 경우 normalizeTimetableEntry가
    // CP-SAT 결과의 roomAssignmentsByTtCardId/roomIds를 버릴 수 있습니다.
    // 그래서 사용자에게 필요한 배치 필드는 normalizer 뒤에 다시 강제 주입합니다.
    const preservedAssignments = sanitizeRoomAssignments(raw.roomAssignmentsByTtCardId);
    normalized.roomAssignmentsByTtCardId = preservedAssignments;

    for (const key of ["ttcardId", "templateId", "gradeKey", "groupId", "unitId", "groupName", "teacherName", "roomRule"]) {
      if ((normalized[key] == null || normalized[key] === "") && raw[key] != null) normalized[key] = raw[key];
    }
    for (const key of ["ttcardIds", "templateIds", "gradeKeys", "audienceClassKeys"]) {
      if (Array.isArray(raw[key]) && raw[key].length) normalized[key] = unique(raw[key]);
    }

    const assignmentRooms = unique(Object.values(preservedAssignments));
    const rawRoomIds = Array.isArray(raw.roomIds) ? unique(raw.roomIds) : [];
    normalized.roomIds = unique([...rawRoomIds, ...assignmentRooms]);

    if (isGroupedSolvedEntry(normalized)) {
      // 그룹카드는 대표 roomId 1개로 처리하지 않고 구성 과목별 roomAssignments를 신뢰합니다.
      normalized.roomId = null;
      normalized.roomPinned = false;
    } else {
      normalized.roomId = clean(raw.roomId || normalized.roomId || assignmentRooms[0] || "") || null;
      normalized.roomPinned = !!(raw.roomPinned ?? normalized.roomPinned);
    }
    normalized.pinned = !!(raw.pinned ?? normalized.pinned);
    delete normalized.audienceStudentKeys;
    delete normalized.studentKeys;
    return normalized;
  }

  function normalizeEntryList(list) {
    return asArray(list).map(normalizeSolvedEntry).filter(e => e && typeof e === "object" && (e.templateId || asArray(e.templateIds).length));
  }
  function makeBackupVersion(name = "CP-SAT API 적용 전 백업") {
    const domain = ttDomain?.();
    if (!domain) return null;
    const backup = {
      id: uid ? uid("ttv") : `ttv-cpsat-${Date.now()}`,
      name: clean(name),
      note: "CP-SAT API 적용 직전 자동 백업",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      periodCount: ttConfig?.().periodCount || 7,
      entryCount: asArray(entries?.()).length,
      entries: deepClone(asArray(entries?.())),
    };
    domain.savedSchedules = [backup, ...asArray(domain.savedSchedules)].slice(0, 30);
    return backup;
  }
  async function applySolvedEntries(rawEntries, apiResult) {
    if (!canEdit?.()) { alert("편집 권한이 없습니다. 로그인/권한을 확인하세요."); return false; }
    const domain = ttDomain?.();
    if (!domain) { alert("시간표 데이터가 아직 로드되지 않았습니다."); return false; }
    const nextEntries = normalizeEntryList(rawEntries);
    if (!nextEntries.length) { alert("적용할 entries가 없습니다."); return false; }

    const assignmentCount = nextEntries.filter(e => e.roomAssignmentsByTtCardId && Object.keys(e.roomAssignmentsByTtCardId).length).length;
    if (assignmentCount <= 0) {
      const proceed = confirm("CP-SAT 결과에 과목별 교실 배정이 보존되지 않았습니다. 그래도 적용할까요?\n\n이 경우 웹앱에서 교실 충돌/교실 미배정이 많이 표시될 수 있습니다.");
      if (!proceed) return false;
    }
    const validation = apiResult?.validation || {};
    if (validation.ok === false) {
      const proceed = confirm(`API 검증이 정상 상태가 아닙니다. 그래도 적용할까요?\n\n${validation.summary || "검증 필요"}`);
      if (!proceed) return false;
    }

    const summary = entriesSummary(nextEntries);
    const backup = makeBackupVersion(`CP-SAT API 적용 전 백업 ${new Date().toLocaleString("ko-KR")}`);
    captureTimetableUndo?.("CP-SAT API 결과 적용");

    domain.entries = nextEntries;
    domain.autoAssignMeta = {
      ...(domain.autoAssignMeta || {}),
      ok: validation.ok !== false,
      source: "cp-sat-api-r170",
      metricSource: "currentEntriesAfterCpSatApiNoStudentFields",
      validationSummary: validation.summary || apiResult?.status || "CP-SAT API 결과 적용",
      importedAt: nowIso(),
      generatedAt: apiResult?.meta?.apiFinishedAt || nowIso(),
      importedEntryCount: nextEntries.length,
      placedEntryCount: nextEntries.length,
      placedBlockCount: nextEntries.length,
      importedClassSlotCount: summary.classSlotCount,
      importedRoomAssignmentEntryCount: assignmentCount,
      apiElapsedSeconds: apiResult?.elapsedSeconds ?? null,
      apiStatus: apiResult?.status || "",
      apiVersion: apiResult?.version || "",
      backupVersionId: backup?.id || null,
    };

    // 저장 과정에서 구버전 normalizer가 필드를 정리해도 화면에는 보존된 결과가 남도록 저장 후 1회 재주입합니다.
    try { await saveNow?.("timetable", { force: true, throwOnError: true }); } catch (err) { console.warn("CP-SAT 저장 경고", err); }
    domain.entries = nextEntries;
    recomputeConflicts?.();
    renderAll?.();
    setTimeout(() => { try { recomputeConflicts?.(); renderAll?.(); } catch (_) {} }, 0);

    alert(`CP-SAT API 결과 적용 완료\nentries ${nextEntries.length}개\n학급칸 ${summary.classSlotCount}개\n교실 배정 보존 ${assignmentCount}개 entry\n백업도 배치 보관에 저장했습니다.`);
    return true;
  }

  function openOverlay() {
    document.getElementById(CP_SAT_API_UI_ID)?.remove();
    let latestResult = null;
    let latestState = null;
    let running = false;

    const overlay = document.createElement("div");
    overlay.id = CP_SAT_API_UI_ID;
    overlay.className = "tt-cpsat-api-overlay";
    overlay.innerHTML = `
      <div class="tt-cpsat-api-modal" role="dialog" aria-modal="true" aria-labelledby="ttCpSatApiTitle">
        <div class="tt-cpsat-api-head">
          <div>
            <h3 id="ttCpSatApiTitle">CP-SAT 적용</h3>
            <p><b>START_API_LOCAL.bat</b>로 API 서버를 켠 뒤, 현재 열린 시간표 데이터를 그대로 전송합니다. 기본 주소는 <code>http://127.0.0.1:7860</code>입니다.</p>
          </div>
          <button type="button" class="tt-cpsat-api-close" data-action="close">×</button>
        </div>
        <div class="tt-cpsat-api-body">
          <div class="tt-cpsat-api-grid">
            <div class="tt-cpsat-api-field"><label>API 주소</label><input id="ttCpSatApiBase" value="${escapeHtml(localStorage.getItem(API_URL_KEY) || API_DEFAULT)}"></div>
            <div class="tt-cpsat-api-field"><label>제한 시간(초)</label><input id="ttCpSatApiTime" type="number" min="1" max="300" value="30"></div>
            <div class="tt-cpsat-api-field"><label>Workers</label><input id="ttCpSatApiWorkers" type="number" min="1" max="32" value="4"></div>
          </div>
          <div class="tt-cpsat-api-checkline">🔒 학생 객체는 전송하지 않습니다. 시간표 카드/배치 결과의 학생 필드도 제거하고, 학생 충돌은 과목카드 roster의 studentId만 사용합니다.</div>
          <div class="tt-cpsat-api-actions">
            <button type="button" data-action="health">1. 서버 확인</button>
            <button type="button" data-action="analyze">2. 데이터 점검</button>
            <button type="button" class="primary" data-action="solve">3. CP-SAT 실행</button>
            <button type="button" class="good" data-action="apply" disabled>4. 결과 적용</button>
            <button type="button" data-action="download-payload">전송 JSON 저장</button>
            <button type="button" data-action="download-result" disabled>결과 JSON 저장</button>
          </div>
          <div id="ttCpSatApiStatus" class="tt-cpsat-api-box warn">대기 중입니다. 서버 확인부터 눌러 주세요.</div>
          <div class="tt-cpsat-api-progress"><span id="ttCpSatApiProgress"></span></div>
          <div id="ttCpSatApiSummary" class="tt-cpsat-api-box info">아직 결과가 없습니다.</div>
          <pre id="ttCpSatApiDetails" class="tt-cpsat-api-pre"></pre>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const $ = sel => overlay.querySelector(sel);
    const statusEl = $("#ttCpSatApiStatus");
    const summaryEl = $("#ttCpSatApiSummary");
    const detailsEl = $("#ttCpSatApiDetails");
    const progressEl = $("#ttCpSatApiProgress");
    const applyBtn = $('[data-action="apply"]');
    const resultBtn = $('[data-action="download-result"]');

    function apiBase() {
      const base = normalizeApiBase($("#ttCpSatApiBase")?.value || API_DEFAULT);
      try { localStorage.setItem(API_URL_KEY, base); } catch (_) {}
      return base;
    }
    function options() {
      return {
        timeLimitSeconds: Math.max(1, Math.min(300, parseInt($("#ttCpSatApiTime")?.value || "30", 10) || 30)),
        workers: Math.max(1, Math.min(32, parseInt($("#ttCpSatApiWorkers")?.value || "4", 10) || 4)),
        preferCpSat: true,
        returnFullState: false,
      };
    }
    function solverState() {
      latestState = makeSolverState(appState);
      return latestState;
    }
    function setStatus(cls, html, progress = null) {
      statusEl.className = `tt-cpsat-api-box ${cls}`;
      statusEl.innerHTML = html;
      if (progress !== null) progressEl.style.width = `${Math.max(0, Math.min(100, Number(progress) || 0))}%`;
    }
    function setBusy(isBusy) {
      running = isBusy;
      overlay.querySelectorAll("button").forEach(btn => {
        if (btn.dataset.action === "close") return;
        if (btn.dataset.action === "apply") btn.disabled = isBusy || !latestResult?.entries?.length;
        else if (btn.dataset.action === "download-result") btn.disabled = isBusy || !latestResult;
        else btn.disabled = isBusy;
      });
    }
    function renderApiSummary(data, kind = "result") {
      const validation = data?.validation || {};
      const counts = data?.counts || {};
      const assignCount = asArray(data?.entries).filter(e => e?.roomAssignmentsByTtCardId && Object.keys(e.roomAssignmentsByTtCardId).length).length;
      const privacy = data?.privacy?.solverPayload || privacyReport(latestState);
      const rowData = [
        ["상태", data?.status || data?.state || (data?.ok ? "OK" : "확인 필요")],
        ["검증", validation.summary || (validation.ok === true ? "정상" : "-")],
        ["카드", counts.cards ?? "-"],
        ["그룹카드", counts.groups ?? "-"],
        ["entries", counts.resultEntries ?? counts.entries ?? asArray(data?.entries).length ?? "-"],
        ["occurrences", counts.occurrences ?? "-"],
        ["교실배정 보존", assignCount || "-"],
        ["학생 객체 전송", `${privacy?.studentObjects ?? 0}명 / 학급학생목록 ${privacy?.classesWithStudents ?? 0}개`],
        ["시간표 학생필드", `카드 ${privacy?.ttcardsWithStudentKeys ?? 0}개 / entries ${privacy?.entriesWithAudienceStudentKeys ?? 0}개`],
        ["소요 시간", data?.elapsedSeconds != null ? `${data.elapsedSeconds}초` : "-"],
      ];
      summaryEl.className = `tt-cpsat-api-box ${validation.ok === false || data?.ok === false ? "warn" : "ok"}`;
      summaryEl.innerHTML = tableRows(rowData, escapeHtml);
      detailsEl.textContent = JSON.stringify({ kind, data }, null, 2);
    }

    overlay.addEventListener("click", ev => { if (ev.target === overlay && !running) overlay.remove(); });
    $('[data-action="close"]')?.addEventListener("click", () => {
      if (running && !confirm("CP-SAT 실행 중입니다. 창을 닫을까요? 실행은 서버에서 계속될 수 있습니다.")) return;
      overlay.remove();
    });
    $('[data-action="health"]')?.addEventListener("click", async () => {
      try {
        setBusy(true); setStatus("warn", "서버 확인 중...", 10);
        const data = await getJson(`${apiBase()}/health`, 10000);
        setStatus("ok", `<b>서버 정상</b> · OR-Tools ${escapeHtml(data?.data?.ortools || data?.ortools || "installed")}`, 100);
        renderApiSummary(data?.data || data, "health");
      } catch (err) {
        setStatus("bad", `<b>서버 연결 실패</b><br>${escapeHtml(err?.message || err)}<br><br>START_API_LOCAL.bat가 실행 중인지 확인하세요.`, 0);
      } finally { setBusy(false); }
    });
    $('[data-action="analyze"]')?.addEventListener("click", async () => {
      try {
        setBusy(true); setStatus("warn", "현재 웹앱 데이터를 API로 점검 중...", 20);
        const state = solverState();
        if (isSolverStateEmpty(state)) {
          setStatus("bad", `<b>데이터가 비어 있습니다.</b><br>${escapeHtml(emptyStateMessage(state))}`, 0);
          renderApiSummary({ ok: false, counts: countSolverState(state), validation: { ok: false, summary: "웹앱 데이터 없음" } }, "empty-state");
          return;
        }
        const data = await postJson(`${apiBase()}/analyze`, { state }, 30000);
        const body = data?.data || data;
        setStatus(body?.validation?.ok === false ? "warn" : "ok", `<b>데이터 점검 완료</b><br>${escapeHtml(body?.validation?.summary || "점검 완료")}`, 100);
        renderApiSummary(body, "analyze");
      } catch (err) {
        setStatus("bad", `<b>데이터 점검 실패</b><br>${escapeHtml(err?.message || err)}`, 0);
      } finally { setBusy(false); }
    });
    $('[data-action="solve"]')?.addEventListener("click", async () => {
      try {
        latestResult = null;
        setBusy(true);
        const opt = options();
        const state = solverState();
        if (isSolverStateEmpty(state)) {
          setStatus("bad", `<b>CP-SAT를 실행할 데이터가 없습니다.</b><br>${escapeHtml(emptyStateMessage(state))}`, 0);
          renderApiSummary({ ok: false, counts: countSolverState(state), validation: { ok: false, summary: "웹앱 데이터 없음" } }, "empty-state");
          return;
        }
        setStatus("warn", `CP-SAT 작업 요청 중... 제한 ${opt.timeLimitSeconds}초`, 10);
        const start = await postJson(`${apiBase()}/solve/start`, { state, ...opt }, 30000);
        const jobId = start?.jobId;
        if (!jobId) throw new Error("jobId가 반환되지 않았습니다.");
        let tick = 0;
        while (true) {
          await sleep(1000);
          tick += 1;
          const p = Math.min(92, 15 + Math.round((tick / Math.max(1, opt.timeLimitSeconds)) * 75));
          const job = await getJson(`${apiBase()}/solve/status/${encodeURIComponent(jobId)}`, 15000);
          setStatus("warn", `<b>실행 중</b> · ${escapeHtml(job.message || job.state || "running")}<br>jobId: ${escapeHtml(jobId)}`, p);
          detailsEl.textContent = JSON.stringify({ jobId, state: job.state, message: job.message }, null, 2);
          if (job.state === "done") {
            latestResult = job.result;
            setStatus(latestResult?.validation?.ok === false ? "warn" : "ok", `<b>CP-SAT 완료</b><br>${escapeHtml(latestResult?.validation?.summary || latestResult?.status || "완료")}`, 100);
            renderApiSummary(latestResult, "solve");
            applyBtn.disabled = !asArray(latestResult?.entries).length;
            resultBtn.disabled = false;
            break;
          }
          if (["failed", "error"].includes(String(job.state))) throw new Error(job.message || "CP-SAT 실행 실패");
        }
      } catch (err) {
        setStatus("bad", `<b>CP-SAT 실행 실패</b><br>${escapeHtml(err?.message || err)}`, 0);
      } finally { setBusy(false); }
    });
    applyBtn?.addEventListener("click", async () => {
      if (!latestResult?.entries?.length) { alert("적용할 결과가 없습니다."); return; }
      const assignCount = asArray(latestResult.entries).filter(e => e?.roomAssignmentsByTtCardId && Object.keys(e.roomAssignmentsByTtCardId).length).length;
      const msg = `CP-SAT API 결과를 현재 시간표에 적용할까요?\n\nentries: ${latestResult.entries.length}\n교실 배정 포함 entry: ${assignCount}\n검증: ${latestResult.validation?.summary || "-"}\n\n현재 시간표는 배치 보관에 자동 백업됩니다.`;
      if (!confirm(msg)) return;
      try { if (await applySolvedEntries(latestResult.entries, latestResult)) overlay.remove(); }
      catch (err) { alert(`적용 실패: ${err?.message || err}`); }
    });
    $('[data-action="download-payload"]')?.addEventListener("click", () => downloadJson(`his_solver_payload_${Date.now()}.json`, solverState()));
    resultBtn?.addEventListener("click", () => {
      if (!latestResult) { alert("저장할 결과가 없습니다."); return; }
      downloadJson(`his_cp_sat_api_result_${Date.now()}.json`, latestResult);
    });
  }

  window.HisCpSatWebappImport = {
    makeSolverState: () => makeSolverState(appState),
    privacyReport: () => privacyReport(makeSolverState(appState)),
    entriesSummary,
  };
}
