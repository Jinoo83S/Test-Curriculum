import { buildSolverConstraintSummary } from "./timetable-constraint-model.js?v=2026-07-15-room-availability-separation-r355";
import { buildTimetablePreflightDiagnostics, formatTimetablePreflightSummary, blockingTimetablePreflightIssues } from "./timetable-preflight-diagnostics.js?v=2026-07-16-cpsat-preflight-r366";
// ================================================================
// cp-sat-webapp-import.js · HIS current timetable webapp CP-SAT API bridge
// r204: CP-SAT 적용 후 현재 entries 재검증 및 autoAssignMeta 동기화.
// ================================================================

import { migrateLegacyRoomAvailability } from "./room-availability.js?v=2026-07-15-room-availability-separation-r355";

const CP_SAT_API_UI_ID = "ttCpSatApiOverlay";
const CP_SAT_API_BUTTON_ID = "ttCpSatApiBtn";
const CP_SAT_API_STYLE_ID = "ttCpSatApiStyle";
const API_URL_KEY = "his_cp_sat_api_base_v1";
const API_DEFAULT = "http://127.0.0.1:7860";
const LOCAL_SERVER_RELEASE_URL = "https://github.com/jinoo83s/Test-Curriculum/releases/download/r343/HIS_CP_SAT_Local_Server_r343.zip";
const CP_SAT_WEBAPP_SOURCE = "cp-sat-webapp-r343";
const CP_SAT_BRIDGE_SOURCE = "HIS webapp r366 CP-SAT API bridge";

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

  // r181 원칙: 시간표/solver 전송 JSON에는 학급 학생 객체를 싣지 않습니다.
  // 학생 충돌 계산은 rosters.rosters[].studentId만 사용합니다.
  asArray(payload?.classes?.classes).forEach(cls => {
    if (!cls || typeof cls !== "object") return;
    const students = asArray(cls.students);
    if (students.length && !Number(cls.studentCount)) cls.studentCount = students.length;
    delete cls.students;
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

function normalizeRoomRuleForPayload(rule = "teacher") {
  const r = cleanLocal(rule);
  if (!r || r === "auto") return "teacher";
  return ["teacher", "fixed", "homeroom", "autoRoom", "none"].includes(r) ? r : "teacher";
}

function isManualCardForPayload(card = {}) {
  return card?.isManual === true || String(card?.id || "").startsWith("ttc_manual") || String(card?.templateId || "").startsWith("manual_");
}
function isManualCardExcludedForPayload(card = {}) {
  if (!isManualCardForPayload(card)) return false;
  return card.autoAssignExcluded === true || card.manualAutoAssign === false || cleanLocal(card.manualCardStatus) === "stored";
}
function applyManualCardExclusionToPayloadTimetable(tt = {}) {
  const cards = asArray(tt.ttcards || tt.ttCards || tt.cards);
  const excludedIds = new Set(cards.filter(isManualCardExcludedForPayload).map(card => cleanLocal(card.id)).filter(Boolean));
  if (!excludedIds.size) return tt;
  const keepCard = card => !excludedIds.has(cleanLocal(card?.id));
  if (Array.isArray(tt.ttcards)) tt.ttcards = tt.ttcards.filter(keepCard);
  if (Array.isArray(tt.ttCards)) tt.ttCards = tt.ttCards.filter(keepCard);
  if (Array.isArray(tt.cards)) tt.cards = tt.cards.filter(keepCard);
  asArray(tt.ttcardGroups || tt.ttCardGroups).forEach(group => {
    if (!group || typeof group !== "object") return;
    if (Array.isArray(group.poolCardIds)) group.poolCardIds = group.poolCardIds.filter(id => !excludedIds.has(cleanLocal(id)));
    if (Array.isArray(group.excludedCardIds)) group.excludedCardIds = group.excludedCardIds.filter(id => !excludedIds.has(cleanLocal(id)));
    asArray(group.units).forEach(unit => {
      if (unit && Array.isArray(unit.ttcardIds)) unit.ttcardIds = unit.ttcardIds.filter(id => !excludedIds.has(cleanLocal(id)));
    });
  });
  if (!tt.autoAssignMeta || typeof tt.autoAssignMeta !== "object") tt.autoAssignMeta = {};
  tt.autoAssignMeta.manualCardExcludedIds = [...excludedIds];
  tt.autoAssignMeta.manualCardExclusionMode = "manual-card-vault-v1";
  return tt;
}
function cardIdsFromEntryForPayload(entry = {}) {
  return unique([...(entry.ttcardIds || []), entry.ttcardId]);
}
function classKeyForPayload(raw = "", fallbackGradeKey = "") {
  const s = cleanLocal(raw).replace(/학년/g, "").replace(/\s+/g, "").toUpperCase();
  if (!s) return "";
  if (s.includes(":")) {
    const [g, sec] = s.split(":");
    const n = Number(String(g || "").replace(/[^0-9]/g, ""));
    return n && sec ? `${n}:${sec}` : "";
  }
  const m = s.match(/^(\d{1,2})(.+)$/);
  if (m) return `${Number(m[1])}:${m[2]}`;
  const fg = Number(String(fallbackGradeKey || "").replace(/[^0-9]/g, ""));
  return fg && s ? `${fg}:${s}` : "";
}
function homeRoomIdForCardPayload(card = {}, entry = {}, classes = [], rooms = []) {
  const keys = unique([
    ...(card.classKeys || []),
    ...(entry.audienceClassKeys || []),
    ...(card.classLabels || []),
  ].map(v => classKeyForPayload(v, card.gradeKey || entry.gradeKey)));
  const roomIds = keys.map(key => {
    const [gradeNo, section] = String(key || "").split(":");
    const cls = classes.find(c => cleanLocal(c?.grade) === `${Number(gradeNo)}학년` && cleanLocal(c?.name).toUpperCase() === cleanLocal(section).toUpperCase());
    if (!cls) return "";
    return rooms.find(r => cleanLocal(r?.homeRoomClassId) === cleanLocal(cls.id))?.id || "";
  }).filter(Boolean);
  const uniqueRooms = unique(roomIds);
  return uniqueRooms.length === 1 ? uniqueRooms[0] : "";
}
function splitTeacherNamesForPayload(value = "") {
  return unique(String(value || "").split(/[,，·/]+/).map(cleanLocal).filter(Boolean));
}
function teacherRosterSetForPayload(dataOrState = {}) {
  const payload = payloadFromWrappedState(dataOrState);
  return new Set(asArray(payload?.teachers?.teachers || dataOrState?.teachers?.teachers)
    .map(t => cleanLocal(t?.name || t))
    .filter(Boolean));
}
function normalizeTeacherNameForPayload(name = "", roster = new Set()) {
  const raw = cleanLocal(name);
  if (!raw) return "";
  if (/^(without\s*teacher|no\s*teacher|none|교사\s*없음|미지정)$/i.test(raw)) return "";
  if (roster.has(raw)) return raw;
  if (raw === "진로" && roster.has("진로교사")) return "진로교사";
  const suffixed = `${raw}교사`;
  if (roster.has(suffixed)) return suffixed;
  return raw;
}
function normalizeTeacherListForPayload(values = [], roster = new Set()) {
  return unique((values || [])
    .flatMap(v => splitTeacherNamesForPayload(v || ""))
    .map(v => normalizeTeacherNameForPayload(v, roster))
    .filter(Boolean));
}
function teacherNamesForCardPayload(card = {}, entry = {}, roster = new Set()) {
  return normalizeTeacherListForPayload([
    ...(Array.isArray(card.teachers) ? card.teachers : []),
    card.teacherName,
    entry.teacherName
  ], roster);
}
function canonicalTeacherIdsForEntryPayload(entry = {}, cardById = new Map()) {
  const cardIds = cardIdsFromEntryForPayload(entry);
  const fromCards = unique(cardIds.flatMap(id => {
    const card = cardById.get(id);
    return Array.isArray(card?.teacherIds) ? card.teacherIds.map(cleanLocal).filter(Boolean) : [];
  }));
  if (fromCards.length) return fromCards;
  return unique(Array.isArray(entry.teacherIds) ? entry.teacherIds.map(cleanLocal).filter(Boolean) : []);
}

function canonicalTeacherNamesForEntryPayload(entry = {}, cardById = new Map(), roster = new Set()) {
  const ids = cardIdsFromEntryForPayload(entry);
  const fromCards = ids.flatMap(id => {
    const card = cardById.get(id);
    return card ? teacherNamesForCardPayload(card, {}, roster) : [];
  });
  if (fromCards.length) return normalizeTeacherListForPayload(fromCards, roster);
  return normalizeTeacherListForPayload([entry.teacherName], roster);
}
function normalizeTeacherConstraintKeysForPayload(tt = {}, roster = new Set()) {
  const tc = tt.teacherConstraints;
  if (!tc || typeof tc !== "object" || !roster.size) return;
  Object.keys(tc).forEach(key => {
    if (String(key).startsWith("__class_unavailable__:")) return;
    const names = normalizeTeacherListForPayload([key], roster);
    if (names.length === 1 && roster.has(names[0])) {
      const nextKey = names[0];
      if (nextKey !== key) {
        tc[nextKey] = { ...(tc[key] || {}), ...(tc[nextKey] || {}) };
        delete tc[key];
      }
      return;
    }
    if (!roster.has(key)) delete tc[key];
  });
}
function normalizeTeacherReferencesForPayload(data = {}) {
  const tt = data?.timetable || {};
  const roster = teacherRosterSetForPayload(data);
  if (!roster.size) return data;
  normalizeTeacherConstraintKeysForPayload(tt, roster);
  const cards = asArray(tt.ttcards || tt.ttCards || tt.cards);
  const cardById = new Map(cards.map(c => [cleanLocal(c?.id), c]).filter(([id]) => id));
  cards.forEach(card => {
    const names = normalizeTeacherListForPayload([
      ...(Array.isArray(card?.teachers) ? card.teachers : []),
      card?.teacherName
    ], roster);
    if (names.length) {
      card.teachers = names;
      card.teacherName = names.join(",");
    }
  });
  asArray(tt.entries).forEach(entry => {
    const ids = canonicalTeacherIdsForEntryPayload(entry, cardById);
    const names = canonicalTeacherNamesForEntryPayload(entry, cardById, roster);
    entry.teacherIds = ids;
    entry.teacherName = names.join(", ");
    if (names.length) entry.teacherNames = names;
    else delete entry.teacherNames;
  });
  return data;
}
function validRoomIdForPayload(roomId = "", rooms = []) {
  const id = cleanLocal(roomId);
  return !!id && asArray(rooms).some(r => cleanLocal(r?.id) === id);
}
function teacherRoomIdForPayload(teacherName = "", teacherConstraints = {}, rooms = []) {
  const name = cleanLocal(teacherName);
  if (!name) return "";
  const cfg = teacherConstraints && typeof teacherConstraints === "object" ? teacherConstraints[name] : null;
  // r219: 교사-홈룸(homeRoomId)은 CP-SAT 교사 본인교실로 사용하지 않습니다.
  // 본인교실은 assignedRoomId 또는 rooms[].teacherName만 기준으로 확정합니다.
  const configured = cleanLocal(cfg?.assignedRoomId || "");
  if (validRoomIdForPayload(configured, rooms)) return configured;
  const matches = rooms.filter(r => cleanLocal(r?.teacherName) === name && cleanLocal(r?.id)).map(r => cleanLocal(r.id));
  const uniqueRooms = unique(matches);
  return uniqueRooms.length === 1 ? uniqueRooms[0] : "";
}
function teacherRoomIdForCardPayload(card = {}, entry = {}, teacherConstraints = {}, rooms = [], roster = new Set()) {
  const roomIds = unique(teacherNamesForCardPayload(card, entry, roster).map(name => teacherRoomIdForPayload(name, teacherConstraints, rooms)).filter(Boolean));
  return roomIds.length === 1 ? roomIds[0] : "";
}
function cardFixedRoomPreflightPayload(card = {}, entry = {}, ctx = {}) {
  const rule = normalizeRoomRuleForPayload(card?.roomRule || entry?.roomRule || "teacher");
  if (rule === "none" || rule === "autoRoom") return { roomId: "", source: "unfixed" };
  const rooms = ctx.rooms || [];
  const explicit = cleanLocal(card?.fixedRoomId || (rule === "fixed" ? (card?.roomId || entry?.roomId) : ""));
  if (explicit) {
    return validRoomIdForPayload(explicit, rooms)
      ? { roomId: explicit, source: "specified" }
      : { roomId: "", source: "invalidSpecified", requestedRoomId: explicit };
  }
  if (rule === "homeroom") {
    const rid = homeRoomIdForCardPayload(card, entry, ctx.classes || [], rooms);
    return rid ? { roomId: rid, source: "classHomeroom" } : { roomId: "", source: "unresolvedClassHomeroom" };
  }
  if (rule === "teacher") {
    const teachers = teacherNamesForCardPayload(card, entry, ctx.roster || new Set());
    const rid = teacherRoomIdForCardPayload(card, entry, ctx.teacherConstraints || {}, rooms, ctx.roster || new Set());
    if (rid) return { roomId: rid, source: "teacherOwnRoom" };
    return { roomId: "", source: teachers.length > 1 ? "unresolvedMultiTeacherRoom" : "unresolvedTeacherOwnRoom" };
  }
  return { roomId: "", source: "unfixed" };
}
function stripTeacherHomeRoomFromSolverPayload(tt = {}) {
  const tc = tt.teacherConstraints;
  if (!tc || typeof tc !== "object") return 0;
  let changed = 0;
  Object.entries(tc).forEach(([key, cfg]) => {
    if (!cfg || typeof cfg !== "object") return;
    if (String(key).startsWith("__class_unavailable__:")) return;
    if ("homeRoomId" in cfg) { delete cfg.homeRoomId; changed += 1; }
    if ("useHomeRoom" in cfg) { delete cfg.useHomeRoom; changed += 1; }
  });
  return changed;
}
function applyFixedRoomPreflightForSolverPayload(data = {}) {
  const tt = data?.timetable || {};
  const cards = asArray(tt.ttcards || tt.ttCards || tt.cards);
  const rooms = asArray(data?.rooms?.rooms);
  const classes = asArray(data?.classes?.classes);
  const roster = teacherRosterSetForPayload(data);
  const teacherConstraints = tt.teacherConstraints && typeof tt.teacherConstraints === "object" ? tt.teacherConstraints : {};
  const meta = {
    version: "r343",
    generatedAt: nowIso(),
    rule: "specified/manualMultiRooms/classHomeroom/teacherOwnRoom fixed before CP-SAT; teacher homeRoomId ignored",
    totalCards: cards.length,
    fixedCards: 0,
    bySource: {},
    unresolvedCards: [],
    strippedTeacherHomeRoomFields: stripTeacherHomeRoomFromSolverPayload(tt),
  };
  const ctx = { rooms, classes, roster, teacherConstraints };
  cards.forEach(card => {
    if (!card || typeof card !== "object") return;
    const resolved = cardFixedRoomPreflightPayload(card, {}, ctx);
    meta.bySource[resolved.source || "unknown"] = (meta.bySource[resolved.source || "unknown"] || 0) + 1;
    if (resolved.roomId) {
      card.fixedRoomId = resolved.roomId;
      card.solverFixedRoomId = resolved.roomId;
      card.solverFixedRoomSource = resolved.source;
      card.solverFixedRoomGenerated = resolved.source !== "specified";
      meta.fixedCards += 1;
    } else if (String(resolved.source || "").startsWith("unresolved") || resolved.source === "invalidSpecified") {
      meta.unresolvedCards.push({
        id: cleanLocal(card.id),
        subject: cleanLocal(card.subject || card.label || card.nameKo || card.name),
        teacherName: cleanLocal(card.teacherName),
        roomRule: normalizeRoomRuleForPayload(card.roomRule || "teacher"),
        reason: resolved.source,
        requestedRoomId: resolved.requestedRoomId || ""
      });
    }
  });
  if (!tt.autoAssignMeta || typeof tt.autoAssignMeta !== "object") tt.autoAssignMeta = {};
  tt.autoAssignMeta.cpSatFixedRoomPreflight = {
    ...meta,
    unresolvedCards: meta.unresolvedCards.slice(0, 50),
    unresolvedCount: meta.unresolvedCards.length,
  };
  return data;
}

function normalizeSchedulePositiveIntForPayload(value, fallback = 1, { min = 1, max = 7 } = {}) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
function durationPeriodsForPayload(obj = {}) {
  return normalizeSchedulePositiveIntForPayload(
    obj.durationPeriods ?? obj.continuousPeriods ?? obj.consecutivePeriods ?? obj.solverDurationPeriods ?? 1,
    1,
    { min: 1, max: 7 }
  );
}
function requiredRoomCountForPayload(obj = {}) {
  return normalizeSchedulePositiveIntForPayload(
    obj.requiredRoomCount ?? obj.multiRoomCount ?? obj.solverRequiredRoomCount ?? 1,
    1,
    { min: 1, max: 12 }
  );
}
function normalizeRoomIdListForPayload(value = [], rooms = []) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[\s,，;；]+/);
  const roomList = asArray(rooms);
  const byId = new Map(roomList.map(r => [cleanLocal(r?.id), cleanLocal(r?.id)]).filter(([id]) => id));
  const byName = new Map(roomList.map(r => [cleanLocal(r?.name).toLocaleLowerCase("ko"), cleanLocal(r?.id)]).filter(([name, id]) => name && id));
  const ids = [];
  raw.map(cleanLocal).filter(Boolean).forEach(token => {
    const id = byId.get(token) || byName.get(token.toLocaleLowerCase("ko")) || "";
    if (id && !ids.includes(id)) ids.push(id);
  });
  return ids;
}
function scheduleConditionRoomIdsForPayload(row = {}, rooms = []) {
  const candidates = [row.manualRoomIds, row.fixedRoomIds, row.solverFixedRoomIds, row.requiredRoomIds, row.roomIds, row.manualRooms, row.fixedRooms, row.roomNames];
  for (const value of candidates) {
    const ids = normalizeRoomIdListForPayload(value || [], rooms);
    if (ids.length) return ids;
  }
  return [];
}
function normalizeScheduleConditionRowForPayload(row = {}, rooms = []) {
  if (!row || typeof row !== "object") return {};
  const roomIds = scheduleConditionRoomIdsForPayload(row, rooms);
  const duration = durationPeriodsForPayload(row);
  const roomCount = Math.max(requiredRoomCountForPayload(row), roomIds.length || 1);
  if (duration <= 1 && roomCount <= 1 && !roomIds.length) return {};
  return {
    durationPeriods: duration,
    continuousPeriods: duration,
    solverDurationPeriods: duration,
    requiredRoomCount: roomCount,
    multiRoomCount: roomCount,
    solverRequiredRoomCount: roomCount,
    manualRoomIds: roomIds,
    fixedRoomIds: roomIds,
    solverFixedRoomIds: roomIds,
    requiredRoomIds: roomIds,
    roomIds,
    updatedAt: cleanLocal(row.updatedAt || row.scheduleConditionEditedAt || "")
  };
}
function storedScheduleConditionForPayload(tt = {}, kind = "card", id = "", rooms = []) {
  const key = cleanLocal(id);
  if (!key) return {};
  const sources = [tt.scheduleConditions, tt.autoAssignMeta?.scheduleConditions].filter(src => src && typeof src === "object");
  let out = {};
  sources.forEach(store => {
    const bucket = kind === "group" ? store.groups : store.cards;
    const row = normalizeScheduleConditionRowForPayload(bucket?.[key], rooms);
    if (!row || !Object.keys(row).length) return;
    if (!out.updatedAt || cleanLocal(row.updatedAt) >= cleanLocal(out.updatedAt)) out = row;
  });
  return out;
}
function mergeScheduleConditionForPayload(tt = {}, obj = {}, kind = "card", rooms = []) {
  const row = storedScheduleConditionForPayload(tt, kind, obj?.id, rooms);
  if (!row || !Object.keys(row).length) return obj;
  obj.durationPeriods = durationPeriodsForPayload(row);
  obj.continuousPeriods = obj.durationPeriods;
  obj.solverDurationPeriods = obj.durationPeriods;
  obj.requiredRoomCount = Math.max(requiredRoomCountForPayload(row), scheduleConditionRoomIdsForPayload(row, rooms).length || 1);
  obj.multiRoomCount = obj.requiredRoomCount;
  obj.solverRequiredRoomCount = obj.requiredRoomCount;
  const manualRoomIds = scheduleConditionRoomIdsForPayload(row, rooms);
  if (manualRoomIds.length) {
    obj.manualRoomIds = manualRoomIds;
    obj.fixedRoomIds = manualRoomIds;
    obj.solverFixedRoomIds = manualRoomIds;
    obj.requiredRoomIds = manualRoomIds;
    obj.roomIds = unique([...(obj.roomIds || []), ...manualRoomIds]);
    if (kind === "card") {
      obj.roomRule = "fixed";
      obj.fixedRoomId = manualRoomIds[0];
    }
  }
  return obj;
}
function applyScheduleConditionPreflightForSolverPayload(data = {}) {
  const tt = data?.timetable || {};
  const cards = asArray(tt.ttcards || tt.ttCards || tt.cards);
  const groups = asArray(tt.ttcardGroups || tt.ttCardGroups);
  const cardById = new Map(cards.map(card => [cleanLocal(card?.id), card]).filter(([id]) => id));
  const roomsList = asArray(data?.rooms?.rooms);
  const meta = {
    version: "r343",
    generatedAt: nowIso(),
    rule: "durationPeriods/requiredRoomCount/manualRoomIds are normalized before CP-SAT payload.",
    cardDurationCount: 0,
    cardRoomCount: 0,
    groupDurationCount: 0,
    groupRoomCount: 0,
    groupSamples: [],
    cardSamples: []
  };
  const applyObj = (obj = {}, kind = "card", sampleTitle = "") => {
    const duration = durationPeriodsForPayload(obj);
    const rooms = requiredRoomCountForPayload(obj);
    obj.durationPeriods = duration;
    obj.continuousPeriods = duration;
    obj.solverDurationPeriods = duration;
    obj.requiredRoomCount = rooms;
    obj.multiRoomCount = rooms;
    obj.solverRequiredRoomCount = rooms;
    if (duration > 1) meta[kind === "group" ? "groupDurationCount" : "cardDurationCount"] += 1;
    if (rooms > 1) meta[kind === "group" ? "groupRoomCount" : "cardRoomCount"] += 1;
    if ((duration > 1 || rooms > 1) && sampleTitle) {
      const bucket = kind === "group" ? meta.groupSamples : meta.cardSamples;
      if (bucket.length < 20) bucket.push({ title: sampleTitle, durationPeriods: duration, requiredRoomCount: rooms });
    }
    return { duration, rooms };
  };
  cards.forEach(card => {
    mergeScheduleConditionForPayload(tt, card, "card", roomsList);
    applyObj(card, "card", cleanLocal(card?.subject || card?.label || card?.nameKo || card?.name || card?.id));
  });
  groups.forEach(group => {
    mergeScheduleConditionForPayload(tt, group, "group", roomsList);
    const groupCardIds = unique([...(group?.poolCardIds || []), ...(group?.excludedCardIds || []), ...(group?.units || []).flatMap(unit => unit?.ttcardIds || [])]);
    const groupCards = groupCardIds.map(id => cardById.get(cleanLocal(id))).filter(Boolean);
    const ownDuration = durationPeriodsForPayload(group);
    const ownRooms = requiredRoomCountForPayload(group);
    const manualRoomIds = unique([
      ...scheduleConditionRoomIdsForPayload(group, roomsList),
      ...groupCards.flatMap(card => scheduleConditionRoomIdsForPayload(card, roomsList))
    ]);
    const duration = Math.max(ownDuration, 1, ...groupCards.map(durationPeriodsForPayload));
    const rooms = Math.max(ownRooms, manualRoomIds.length || 1, ...groupCards.map(requiredRoomCountForPayload));
    group.durationPeriods = duration;
    group.continuousPeriods = duration;
    group.solverDurationPeriods = duration;
    group.requiredRoomCount = rooms;
    group.multiRoomCount = rooms;
    group.solverRequiredRoomCount = rooms;
    if (manualRoomIds.length) {
      group.manualRoomIds = manualRoomIds;
      group.fixedRoomIds = manualRoomIds;
      group.solverFixedRoomIds = manualRoomIds;
      group.requiredRoomIds = manualRoomIds;
      group.roomIds = unique([...(group.roomIds || []), ...manualRoomIds]);
    }
    if (duration > 1) meta.groupDurationCount += 1;
    if (rooms > 1) meta.groupRoomCount += 1;
    if ((duration > 1 || rooms > 1) && meta.groupSamples.length < 20) meta.groupSamples.push({ title: cleanLocal(group?.name || group?.id || "group"), durationPeriods: duration, requiredRoomCount: rooms });
  });
  if (!tt.autoAssignMeta || typeof tt.autoAssignMeta !== "object") tt.autoAssignMeta = {};
  tt.autoAssignMeta.cpSatScheduleConditionPreflight = meta;
  return data;
}
function isSolverSeedEntryForPayload(entry = {}, totalEntries = 0) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.pinned || entry.isPinned || entry.fixed || entry.locked) return true;
  // 시간표 초기화 직후 사용자가 수동으로 몇 개만 둔 경우는 기존 서버 정책과 맞춰 seed로 보존합니다.
  if (totalEntries > 0 && totalEntries <= 10) return true;
  return false;
}
function filterSolverSeedEntriesForPayload(entries = [], tt = {}) {
  const list = asArray(entries);
  const kept = list.filter(e => isSolverSeedEntryForPayload(e, list.length));
  if (!tt.autoAssignMeta || typeof tt.autoAssignMeta !== "object") tt.autoAssignMeta = {};
  tt.autoAssignMeta.cpSatEntrySeedPreflight = {
    version: "r343",
    originalEntryCount: list.length,
    keptSeedEntryCount: kept.length,
    droppedGeneratedEntryCount: Math.max(0, list.length - kept.length),
    rule: "Only explicit pinned/fixed/locked entries are sent as CP-SAT time seeds; ordinary previous auto-placement entries are dropped."
  };
  return kept;
}
function isManualEntryRoomOverrideForPayload(entry = {}, explicitRoomId = "") {
  const roomId = cleanLocal(explicitRoomId);
  if (!roomId) return false;
  const rule = normalizeRoomRuleForPayload(entry.roomRule || "teacher");
  // r211: roomPinned=true는 과거 자동보정/CP-SAT 적용 과정에서도 남을 수 있으므로
  // fixed 규칙일 때만 수동 지정교실로 인정합니다. teacher 규칙의 stale room은 보정 대상입니다.
  if (entry.roomPinned === true && rule === "fixed") return true;
  if (rule === "fixed" && cleanLocal(entry.roomId || entry.fixedRoomId) === roomId) return true;
  return false;
}
function normalizeEntryRoomsFromCardRulesForPayload(data = {}) {
  normalizeTeacherReferencesForPayload(data);
  applyScheduleConditionPreflightForSolverPayload(data);
  applyFixedRoomPreflightForSolverPayload(data);
  const tt = data?.timetable || {};
  const roster = teacherRosterSetForPayload(data);
  const cards = asArray(tt.ttcards || tt.ttCards || tt.cards);
  const entries = asArray(tt.entries);
  const classes = asArray(data?.classes?.classes);
  const rooms = asArray(data?.rooms?.rooms);
  const cardById = new Map(cards.map(c => [cleanLocal(c?.id), c]).filter(([id]) => id));
  const teacherConstraints = tt.teacherConstraints && typeof tt.teacherConstraints === "object" ? tt.teacherConstraints : {};

  entries.forEach(entry => {
    const ids = cardIdsFromEntryForPayload(entry);
    if (!ids.length) return;
    const assignments = { ...(entry.roomAssignmentsByTtCardId && typeof entry.roomAssignmentsByTtCardId === "object" ? entry.roomAssignmentsByTtCardId : {}) };
    let touched = false;
    ids.forEach(id => {
      const card = cardById.get(id);
      if (!card) return;
      const rule = normalizeRoomRuleForPayload(card.roomRule);
      if (rule === "none") {
        if (assignments[id]) { delete assignments[id]; touched = true; }
        return;
      }
      let expected = "";
      if (rule === "fixed") expected = cleanLocal(card.fixedRoomId);
      else if (rule === "homeroom") expected = homeRoomIdForCardPayload(card, entry, classes, rooms);
      else if (rule === "teacher") expected = teacherRoomIdForCardPayload(card, entry, teacherConstraints, rooms, roster);

      const current = cleanLocal(assignments[id]);
      if (expected && !isManualEntryRoomOverrideForPayload(entry, current) && current !== expected) {
        assignments[id] = expected;
        touched = true;
      }
    });
    if (!touched) return;
    entry.roomAssignmentsByTtCardId = Object.fromEntries(Object.entries(assignments).filter(([, v]) => cleanLocal(v)));
    const roomIds = unique(Object.values(entry.roomAssignmentsByTtCardId));
    const rules = ids.map(id => normalizeRoomRuleForPayload(cardById.get(id)?.roomRule));
    const allFixedRules = rules.length > 0 && rules.every(r => r === "fixed");
    const entryRule = normalizeRoomRuleForPayload(entry.roomRule || "teacher");
    if (entry.groupId || ids.length > 1) {
      entry.roomId = null;
      entry.roomPinned = false;
    } else if (roomIds.length === 1) {
      entry.roomId = roomIds[0];
      // r211: 교사교실/홈룸 보정값을 수동 고정(roomPinned)으로 승격하지 않습니다.
      entry.roomPinned = allFixedRules || entryRule === "fixed";
    } else if (roomIds.length > 1) {
      entry.roomId = null;
      entry.roomPinned = false;
    }
    entry.roomIds = unique([...(entry.roomIds || []), ...roomIds]);
  });
  return data;
}
function makeSolverState(appState, live = {}) {
  // r182: CP-SAT에는 화면에 실제로 렌더링 중인 현재 entries()를 전송해야 합니다.
  // appState.timetable.entries가 저장/동기화 지연으로 4개처럼 오래된 값을 가질 수 있어서,
  // ttDomain() + entries()를 우선 사용해 visible timetable과 solver payload를 일치시킵니다.
  const liveTimetable = applyManualCardExclusionToPayloadTimetable(deepClone(live.timetable || appState?.timetable || {}));
  if (Array.isArray(live.entries)) {
    // r219: 이전 자동배치 결과 entry는 CP-SAT 입력(seed)으로 보내지 않습니다.
    // 명시적으로 고정/잠금된 시간표 seed만 보내고, 일반 배치는 cards/groups에서 새로 생성합니다.
    liveTimetable.entries = filterSolverSeedEntriesForPayload(deepClone(live.entries), liveTimetable);
  }
  const data = normalizeEntryRoomsFromCardRulesForPayload({
    curriculum: appState?.curriculum || {},
    templates: appState?.templates || {},
    classes: appState?.classes || {},
    teachers: appState?.teachers || {},
    rosters: appState?.rosters || {},
    rooms: deepClone(appState?.rooms || {}),
    timetable: liveTimetable,
  });
  // 서버 전송본에서도 구버전 의사 교사 키를 교실 도메인으로 이관해
  // 교사 조건과 교실 불가시간이 섞이지 않도록 보장합니다.
  migrateLegacyRoomAvailability(data.rooms, data.timetable);
  data.constraintDetection = buildSolverConstraintSummary(data);
  const wrapped = {
    version: 1,
    mode: "his-webapp-live-state-for-cp-sat",
    exportedAt: nowIso(),
    source: CP_SAT_BRIDGE_SOURCE,
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
function validationCounts(apiResult = {}) {
  return apiResult?.validation?.counts || {};
}
function hardValidationBlock(apiResult = {}) {
  const vc = validationCounts(apiResult);
  const hardKeys = [
    "overageCount",
    "teacherConflictCount",
    "studentConflictCount",
    "roomConflictCount",
    "classConflictCount",
    "timeViolationCount",
  ];
  const hit = hardKeys.map(k => Number(vc[k] || 0)).reduce((a, b) => a + b, 0);
  if (hit > 0) {
    return {
      block: true,
      reason: `초과/충돌/시간조건 위반 ${hit}건이 있어 자동 적용을 막았습니다.`,
    };
  }
  return { block: false, reason: "" };
}
function softValidationSummary(apiResult = {}) {
  const vc = validationCounts(apiResult);
  const parts = [];
  const shortage = Number(vc.shortageCount || 0);
  const capacity = Number(vc.capacityWarningCount || 0);
  if (shortage > 0) parts.push(`미배치 ${shortage}개`);
  if (capacity > 0) parts.push(`수용인원 확인 ${capacity}건`);
  return parts.join(" · ");
}
function issueLines(apiResult = {}, limit = 8) {
  const lines = [];
  const details = asArray(apiResult?.validation?.details);
  details.forEach(item => {
    const type = item?.type || "";
    const value = item?.value;
    if (type === "shortages" && Array.isArray(value)) {
      const [cardId, need, got] = value;
      lines.push(`미배치: ${cardId} · 필요 ${need}, 배치 ${got}`);
    } else if ((type === "capacityViolations" || type === "capacityWarnings") && Array.isArray(value)) {
      const [cardId, roomId, students, capacity] = value;
      lines.push(`수용인원 확인: ${cardId} · ${students}/${capacity} · ${roomId}`);
    } else if (type || value != null) {
      lines.push(`${type || "확인"}: ${Array.isArray(value) ? value.join(" / ") : JSON.stringify(value)}`);
    }
  });
  asArray(apiResult?.meta?.log || apiResult?.log).forEach(line => {
    const text = cleanLocal(line);
    if (text && !lines.includes(text)) lines.push(text);
  });
  return lines.slice(0, limit);
}
function issueText(apiResult = {}, limit = 8) {
  const lines = issueLines(apiResult, limit);
  return lines.length ? lines.map(x => `- ${x}`).join("\n") : "- 상세 원인 없음";
}
function solverEngineLabel(apiResult = {}) {
  return cleanLocal(
    apiResult?.meta?.engine ||
    apiResult?.engine ||
    apiResult?.status ||
    apiResult?.state ||
    ""
  );
}
function engineApplyBlock(apiResult = {}) {
  if (apiResult?.applyAllowed === false || apiResult?.meta?.applyAllowed === false) {
    return {
      block: true,
      reason: cleanLocal(apiResult?.applyBlockReason || apiResult?.meta?.applyBlockReason) || "서버가 이 결과의 적용을 차단했습니다.",
    };
  }
  const engine = solverEngineLabel(apiResult);
  const status = cleanLocal(apiResult?.status || "");
  const isCpSat = /OR-Tools\s*CP-SAT/i.test(engine) || /^CP-SAT-/i.test(status);
  if (!isCpSat) {
    return {
      block: true,
      reason: `운영 적용은 OR-Tools CP-SAT 결과만 허용합니다. 현재 엔진: ${engine || "확인 불가"}`,
    };
  }
  return { block: false, reason: "" };
}
function applyPolicy(apiResult = {}, normalizedEntries = [], currentEntryCount = 0) {
  const engine = engineApplyBlock(apiResult);
  if (engine.block) return { canApply: false, level: "bad", reason: engine.reason, soft: false };
  const severe = severeCoverageFailure(apiResult, normalizedEntries, currentEntryCount);
  if (severe.block) return { canApply: false, level: "bad", reason: severe.reason, soft: false };
  const hard = hardValidationBlock(apiResult);
  if (hard.block) return { canApply: false, level: "bad", reason: hard.reason, soft: false };
  const validation = apiResult?.validation || {};
  if (validation.ok !== true) {
    return {
      canApply: false,
      level: "bad",
      reason: softValidationSummary(apiResult) || validation.summary || "검증을 통과하지 못한 결과입니다.",
      soft: false,
    };
  }
  if (!asArray(normalizedEntries).length) {
    return { canApply: false, level: "bad", reason: "적용할 entries가 없습니다.", soft: false };
  }
  return { canApply: true, level: "ok", reason: "OR-Tools CP-SAT 검증 완료", soft: false };
}
function solvePhaseLabel(apiResult = {}) {
  const phase = cleanLocal(apiResult?.phase || apiResult?.meta?.phase || "");
  const status = cleanLocal(apiResult?.status || apiResult?.state || "");
  if (phase === "solving") return "CP-SAT 실행 중";
  if (phase === "solved" && apiResult?.validation?.ok === false) return "CP-SAT 부분 배치 완료";
  if (phase === "solved") return "CP-SAT 완료";
  if (phase === "solve_failed" || /FAILED|ERROR|INVALID|UNKNOWN/.test(status)) return "CP-SAT 결과 없음";
  return status || "확인 필요";
}
function severeCoverageFailure(apiResult = {}, normalizedEntries = [], currentEntryCount = 0) {
  const counts = apiResult?.counts || {};
  const vc = validationCounts(apiResult);
  const cardCount = Number(counts.cards || 0);
  const shortageCount = Number(vc.shortageCount || 0);
  const resultEntryCount = asArray(normalizedEntries).length || Number(counts.resultEntries || 0);
  const currentCount = Number(currentEntryCount || 0);

  if (cardCount > 0 && shortageCount >= cardCount) {
    return {
      block: true,
      reason: `카드 ${cardCount}개 중 ${shortageCount}개가 부족합니다. 결과가 사실상 빈 배치입니다.`,
    };
  }
  if (cardCount > 0 && shortageCount >= Math.max(20, Math.ceil(cardCount * 0.25))) {
    return {
      block: true,
      reason: `카드 부족 ${shortageCount}개가 감지되었습니다. 현재 시간표를 덮어쓰면 배치가 대량 삭제될 수 있습니다.`,
    };
  }
  if (currentCount >= 50 && resultEntryCount > 0 && resultEntryCount < Math.ceil(currentCount * 0.5)) {
    return {
      block: true,
      reason: `현재 entries ${currentCount}개보다 결과 entries ${resultEntryCount}개가 지나치게 적습니다.`,
    };
  }
  return { block: false, reason: "" };
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


const STALE_AUTO_ASSIGN_META_KEYS = [
  "validationSummary", "ok", "validatorOk", "validationOk",
  "conflictSummary", "conflictStatus", "legacyValidationSummary",
  "failedDiagnostics", "failedCount", "failedUnitCount", "failedOccurrenceCount",
  "classIssueCount", "cardCoverageIssueCount", "groupCoverageIssueCount",
  "actualEntryCount", "currentEntryCount", "placedEntryCount", "currentClassSlotCount",
  "currentValidationAt", "currentValidationOk", "currentValidationSummary", "currentValidationCounts",
  "currentValidationDetails", "currentValidationStatus", "currentValidationIssueText"
];
function dropStaleAutoAssignMetaFields(meta = {}) {
  const next = { ...(meta && typeof meta === "object" ? meta : {}) };
  STALE_AUTO_ASSIGN_META_KEYS.forEach(key => { if (Object.prototype.hasOwnProperty.call(next, key)) delete next[key]; });
  return next;
}
function validationHardIssueCount(counts = {}) {
  return [
    "overageCount", "teacherConflictCount", "studentConflictCount",
    "roomConflictCount", "classConflictCount", "timeViolationCount"
  ].map(k => Number(counts[k] || 0)).reduce((a, b) => a + b, 0);
}
function buildCurrentValidationMeta(previousMeta = {}, validationBody = {}, entryList = [], sourceNote = "") {
  const base = dropStaleAutoAssignMetaFields(previousMeta);
  const validation = validationBody?.validation || {};
  const counts = validationCounts(validationBody);
  const summary = entriesSummary(entryList);
  const entryCount = asArray(entryList).length;
  const shortage = Number(counts.shortageCount || 0);
  const overage = Number(counts.overageCount || 0);
  const hard = validationHardIssueCount(counts);
  const ok = validation.ok !== false;
  const summaryText = validation.summary || (ok ? "현재 시간표 검증 정상" : "현재 시간표 검증 필요");
  const details = asArray(validation.details).slice(0, 50);
  return {
    ...base,
    source: CP_SAT_WEBAPP_SOURCE,
    metricSource: "currentEntriesRevalidatedAfterCpSatApi",
    metaSyncSource: sourceNote || "current-entries-revalidate",
    cpSatApplied: true,
    strictValidationRequired: true,
    strictValidationMode: "runtime-recomputed-teacher-room-class-card",
    strictValidationNotice: "정상 여부는 저장된 과거 메타가 아니라 현재 entries를 재검증한 결과를 기준으로 표시합니다.",
    currentValidationAt: nowIso(),
    currentValidationStatus: validationBody?.status || validationBody?.state || "VALIDATE-CURRENT-ENTRIES",
    currentValidationOk: ok,
    currentValidationSummary: summaryText,
    currentValidationCounts: deepClone(counts),
    currentValidationDetails: deepClone(details),
    currentValidationIssueText: issueText(validationBody, 20),
    validationSummary: summaryText,
    ok,
    validatorOk: ok,
    validationOk: ok,
    cpSatServerValidationOk: ok,
    cpSatServerValidationSummary: summaryText,
    cpSatIssueText: issueText(validationBody, 20),
    actualEntryCount: entryCount,
    currentEntryCount: entryCount,
    placedEntryCount: entryCount,
    importedEntryCount: entryCount,
    currentClassSlotCount: summary.classSlotCount,
    importedClassSlotCount: summary.classSlotCount,
    currentEntrySummary: deepClone(summary),
    apiValidationCounts: deepClone(counts),
    apiCounts: deepClone(validationBody?.counts || {}),
    failedDiagnostics: deepClone(details),
    failedCount: shortage + overage + hard,
    failedUnitCount: shortage + overage,
    failedOccurrenceCount: shortage + overage,
    classIssueCount: Number(counts.classConflictCount || 0),
    cardCoverageIssueCount: shortage + overage,
    groupCoverageIssueCount: 0,
  };
}

function assignArrayInPlace(target, source) {
  const cloned = deepClone(asArray(source));
  if (Array.isArray(target)) {
    target.splice(0, target.length, ...cloned);
    return target;
  }
  return cloned;
}

function syncCpSatTimetableState(domain, appStateRef, nextEntries, nextMeta, backup = null) {
  if (!domain) return;
  domain.entries = assignArrayInPlace(domain.entries, nextEntries);
  domain.autoAssignMeta = deepClone(nextMeta);
  if (backup && Array.isArray(domain.savedSchedules) && !domain.savedSchedules.some(s => cleanLocal(s?.id) === cleanLocal(backup.id))) {
    domain.savedSchedules = [backup, ...domain.savedSchedules].slice(0, 30);
  }
  if (appStateRef?.timetable && appStateRef.timetable !== domain) {
    appStateRef.timetable.entries = assignArrayInPlace(appStateRef.timetable.entries, nextEntries);
    appStateRef.timetable.autoAssignMeta = deepClone(nextMeta);
    if (backup && Array.isArray(domain.savedSchedules)) appStateRef.timetable.savedSchedules = deepClone(domain.savedSchedules);
  }
}

function cpSatSaveVerification(domain, expectedCount, expectedSource = CP_SAT_WEBAPP_SOURCE) {
  const actual = asArray(domain?.entries).length;
  const source = cleanLocal(domain?.autoAssignMeta?.source);
  const imported = Number(domain?.autoAssignMeta?.importedEntryCount || 0);
  if (actual !== expectedCount) {
    throw new Error(`CP-SAT 저장 확인 실패: 화면 entries ${actual}개 / 예상 ${expectedCount}개`);
  }
  if (source !== expectedSource || imported !== expectedCount) {
    throw new Error(`CP-SAT 메타 저장 확인 실패: source=${source || "없음"}, imported=${imported || 0}`);
  }
}

async function persistCpSatTimetable({ domain, appStateRef, nextEntries, nextMeta, backup, saveNow, recomputeConflicts, renderAll }) {
  syncCpSatTimetableState(domain, appStateRef, nextEntries, nextMeta, backup);
  recomputeConflicts?.();
  renderAll?.();

  if (typeof saveNow !== "function") {
    throw new Error("저장 함수가 연결되지 않았습니다. CP-SAT 결과를 화면에 넣었지만 저장을 확정할 수 없습니다.");
  }

  // 1차 저장 후에도 구버전 normalizer/비동기 동기화가 entries 또는 meta를 건드릴 수 있어
  // 동일 상태를 다시 주입하고 2차 저장으로 확정합니다.
  await saveNow("timetable", { force: true, throwOnError: true });
  syncCpSatTimetableState(domain, appStateRef, nextEntries, nextMeta, backup);
  recomputeConflicts?.();
  renderAll?.();
  await saveNow("timetable", { force: true, throwOnError: true });
  syncCpSatTimetableState(domain, appStateRef, nextEntries, nextMeta, backup);
  cpSatSaveVerification(domain, asArray(nextEntries).length);
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
    .tt-cpsat-api-download-note{margin-top:10px;padding:10px 12px;border:1px dashed #94a3b8;border-radius:10px;background:#f8fafc;color:#334155;font-size:12px;line-height:1.55}.tt-cpsat-api-download-note code{font-weight:800;color:#0f172a}
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
    suspendAutoSave = null,
    resumeAutoSave = null,
    isAutoSaveSuspended = null,
    prepareSolverState = null,
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

  function canonicalTeacherNameForSolvedEntry(entry = {}) {
    const tt = ttDomain?.() || appState?.timetable || {};
    const roster = teacherRosterSetForPayload(appState || {});
    const cards = asArray(tt.ttcards || tt.ttCards || tt.cards);
    const cardById = new Map(cards.map(c => [cleanLocal(c?.id), c]).filter(([id]) => id));
    return canonicalTeacherNamesForEntryPayload(entry, cardById, roster).join(", ");
  }

  function normalizeSolvedEntry(rawEntry) {
    const raw = deepClone(rawEntry || {});
    const normalized = normalizeTimetableEntry ? normalizeTimetableEntry(raw) : raw;

    // r181 핵심: 현재 운영 웹앱의 state.js가 오래된 경우 normalizeTimetableEntry가
    // CP-SAT 결과의 roomAssignmentsByTtCardId/roomIds를 버릴 수 있습니다.
    // 그래서 사용자에게 필요한 배치 필드는 normalizer 뒤에 다시 강제 주입합니다.
    const preservedAssignments = sanitizeRoomAssignments(raw.roomAssignmentsByTtCardId);
    normalized.roomAssignmentsByTtCardId = preservedAssignments;

    for (const key of ["ttcardId", "templateId", "gradeKey", "groupId", "unitId", "groupName", "teacherName", "roomRule"]) {
      if ((normalized[key] == null || normalized[key] === "") && raw[key] != null) normalized[key] = raw[key];
    }
    for (const key of ["ttcardIds", "templateIds", "gradeKeys", "audienceClassKeys", "teacherIds", "teacherNames"]) {
      if (Array.isArray(raw[key]) && raw[key].length) normalized[key] = unique(raw[key]);
    }

    const tt = ttDomain?.() || appState?.timetable || {};
    const cards = asArray(tt.ttcards || tt.ttCards || tt.cards);
    const cardById = new Map(cards.map(c => [cleanLocal(c?.id), c]).filter(([id]) => id));
    normalized.teacherIds = canonicalTeacherIdsForEntryPayload(normalized, cardById);
    const canonicalTeacherName = canonicalTeacherNameForSolvedEntry(normalized);
    if (canonicalTeacherName) {
      normalized.teacherName = canonicalTeacherName;
      normalized.teacherNames = splitTeacherNamesForPayload(canonicalTeacherName);
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
  function resultApplyPolicy(apiResult = {}) {
    const normalized = normalizeEntryList(apiResult?.entries || []);
    if (!normalized.length) return { canApply: false, level: "bad", reason: "적용할 entries가 없습니다." };
    return applyPolicy(apiResult, normalized, asArray(entries?.()).length);
  }
  function resultMayBeApplied(apiResult = {}) {
    return !!resultApplyPolicy(apiResult).canApply;
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

  function buildSolverStateForEntries(entryList = null) {
    const domain = ttDomain?.() || appState?.timetable || {};
    const timetable = deepClone(domain || {});
    const useEntries = entryList == null ? asArray(entries?.()) : asArray(entryList);
    timetable.entries = deepClone(useEntries);
    return makeSolverState(appState, { timetable, entries: useEntries });
  }

  async function validateCurrentEntriesViaApi(base, entryList = null, timeoutMs = 45000) {
    const state = buildSolverStateForEntries(entryList);
    const data = await postJson(`${normalizeApiBase(base)}/validate`, { state }, timeoutMs);
    const body = data?.data || data;
    return {
      ...body,
      counts: body?.counts || countSolverState(state),
      privacy: body?.privacy || { solverPayload: privacyReport(state) },
    };
  }

  async function refreshCurrentValidationMeta(base, reason = "manual-current-entries") {
    if (!canEdit?.()) { alert("편집 권한이 없습니다. 로그인/권한을 확인하세요."); return false; }
    const domain = ttDomain?.();
    if (!domain) { alert("시간표 데이터가 아직 로드되지 않았습니다."); return false; }
    if (typeof saveNow !== "function") { alert("저장 함수가 연결되지 않았습니다. 현재검증 메타를 저장할 수 없습니다."); return false; }
    const currentEntries = deepClone(asArray(entries?.()));
    const validationBody = await validateCurrentEntriesViaApi(base, currentEntries);
    const nextMeta = buildCurrentValidationMeta(domain.autoAssignMeta || {}, validationBody, currentEntries, reason);
    syncCpSatTimetableState(domain, appState, currentEntries, nextMeta, null);
    recomputeConflicts?.();
    renderAll?.();
    await saveNow("timetable", { force: true, throwOnError: true });
    syncCpSatTimetableState(domain, appState, currentEntries, nextMeta, null);
    cpSatSaveVerification(domain, currentEntries.length);
    return { meta: nextMeta, validation: validationBody };
  }

  async function applySolvedEntries(rawEntries, apiResult, validateBase = "") {
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
    const severe = severeCoverageFailure(apiResult, nextEntries, asArray(entries?.()).length);
    if (severe.block) {
      alert(`이 CP-SAT 결과는 적용하지 않습니다.\n\n${severe.reason}\n\n${validation.summary || "검증 필요"}\n\n기존 시간표 보호를 위해 결과 적용을 차단했습니다. [결과 JSON 저장]으로 진단 파일만 저장하세요.`);
      return false;
    }
    const policy = applyPolicy(apiResult, nextEntries, asArray(entries?.()).length);
    if (!policy.canApply) {
      alert(`이 CP-SAT 결과는 적용하지 않습니다.\n\n${policy.reason}\n\n${validation.summary || "검증 필요"}\n\n${issueText(apiResult)}\n\n[결과 JSON 저장]으로 진단 파일만 보관하세요.`);
      return false;
    }

    const applySuspendToken = typeof suspendAutoSave === "function" ? suspendAutoSave("cp-sat-apply") : null;
    const summary = entriesSummary(nextEntries);
    const backup = makeBackupVersion(`CP-SAT API 적용 전 백업 ${new Date().toLocaleString("ko-KR")}`);
    captureTimetableUndo?.("CP-SAT API 결과 적용");

    const previousMeta = dropStaleAutoAssignMetaFields(domain.autoAssignMeta || {});

    let nextMeta = {
      ...previousMeta,
      source: CP_SAT_WEBAPP_SOURCE,
      metricSource: "currentEntriesAfterCpSatApiNoStudentFields",
      cpSatApplied: true,
      cpSatApplyStatus: apiResult?.status || "CP-SAT API 결과 적용",
      cpSatServerValidationOk: validation.ok !== false,
      cpSatServerValidationSummary: validation.summary || "",
      cpSatIssueText: issueText(apiResult, 20),
      strictValidationRequired: true,
      strictValidationMode: "runtime-recomputed-teacher-room-class",
      strictValidationNotice: "정상 여부는 저장된 CP-SAT 메타가 아니라 현재 화면의 실시간 교사/교실/학급 충돌 검토 결과만 기준으로 판단합니다.",
      importedAt: nowIso(),
      generatedAt: apiResult?.meta?.apiFinishedAt || nowIso(),
      importedEntryCount: nextEntries.length,
      importedClassSlotCount: summary.classSlotCount,
      importedRoomAssignmentEntryCount: assignmentCount,
      apiElapsedSeconds: apiResult?.elapsedSeconds ?? null,
      apiStatus: apiResult?.status || "",
      apiVersion: apiResult?.version || "",
      apiCounts: deepClone(apiResult?.counts || {}),
      apiValidationCounts: deepClone(validationCounts(apiResult)),
      backupVersionId: backup?.id || null,
    };

    let currentValidationBody = null;
    if (validateBase) {
      try {
        currentValidationBody = await validateCurrentEntriesViaApi(validateBase, nextEntries, 45000);
        nextMeta = {
          ...buildCurrentValidationMeta(nextMeta, currentValidationBody, nextEntries, "apply-after-cp-sat"),
          cpSatApplyStatus: apiResult?.status || "CP-SAT API 결과 적용",
          rawCpSatServerValidationSummary: validation.summary || "",
          rawCpSatServerValidationCounts: deepClone(validationCounts(apiResult)),
          rawCpSatIssueText: issueText(apiResult, 20),
          importedRoomAssignmentEntryCount: assignmentCount,
          apiElapsedSeconds: apiResult?.elapsedSeconds ?? null,
          apiStatus: apiResult?.status || "",
          apiVersion: apiResult?.version || "",
          apiCounts: deepClone(apiResult?.counts || currentValidationBody?.counts || {}),
          backupVersionId: backup?.id || null,
        };
      } catch (err) {
        console.warn("CP-SAT 적용 후 현재검증 실패", err);
        nextMeta = {
          ...nextMeta,
          currentValidationAt: nowIso(),
          currentValidationOk: false,
          currentValidationSummary: `현재 entries 재검증 실패: ${err?.message || err}`,
          validationSummary: validation.summary || `현재 entries 재검증 실패: ${err?.message || err}`,
          metaSyncSource: "apply-after-cp-sat-validate-failed",
        };
      }
    }

    domain.bestAutoAssignSnapshot = {
      id: uid ? uid("cpsat") : `cpsat-${Date.now()}`,
      name: "CP-SAT 적용 결과",
      source: CP_SAT_WEBAPP_SOURCE,
      createdAt: nowIso(),
      entryCount: nextEntries.length,
      classSlotCount: summary.classSlotCount,
      validationSummary: nextMeta.currentValidationSummary || validation.summary || "",
      entries: deepClone(nextEntries),
      meta: deepClone(nextMeta),
    };

    try {
      await persistCpSatTimetable({
        domain,
        appStateRef: appState,
        nextEntries,
        nextMeta,
        backup,
        saveNow,
        recomputeConflicts,
        renderAll,
      });
    } catch (err) {
      console.error("CP-SAT 저장 실패", err);
      recomputeConflicts?.();
      renderAll?.();
      alert(`CP-SAT 결과를 화면에는 반영했지만 저장 확인에 실패했습니다.\n\n${err?.message || err}\n\n페이지를 새로고침하지 말고 [저장]을 먼저 누른 뒤 진단 파일을 다시 확인하세요.`);
      if (applySuspendToken && typeof resumeAutoSave === "function") resumeAutoSave(applySuspendToken, { flush: false });
      return false;
    }

    if (applySuspendToken && typeof resumeAutoSave === "function") resumeAutoSave(applySuspendToken, { flush: false });
    setTimeout(() => { try { recomputeConflicts?.(); renderAll?.(); } catch (_) {} }, 0);

    alert(`CP-SAT API 결과 적용 및 저장 완료\nentries ${nextEntries.length}개\n학급칸 ${summary.classSlotCount}개\n교실 배정 보존 ${assignmentCount}개 entry\n현재검증: ${nextMeta.currentValidationSummary || nextMeta.validationSummary || "-"}\n메타 source: cp-sat-webapp-r343\n백업도 배치 보관에 저장했습니다.`);
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
            <p>CP-SAT 로컬 서버를 실행한 뒤 현재 열린 시간표 데이터를 전송합니다. 기본 주소는 <code>http://127.0.0.1:7860</code>입니다.</p>
          </div>
          <button type="button" class="tt-cpsat-api-close" data-action="close">×</button>
        </div>
        <div class="tt-cpsat-api-body">
          <div class="tt-cpsat-api-grid">
            <div class="tt-cpsat-api-field"><label>API 주소</label><input id="ttCpSatApiBase" value="${escapeHtml(localStorage.getItem(API_URL_KEY) || API_DEFAULT)}"></div>
            <div class="tt-cpsat-api-field"><label>제한 시간(초)</label><input id="ttCpSatApiTime" type="number" min="1" max="300" value="120"></div>
            <div class="tt-cpsat-api-field"><label>Workers</label><input id="ttCpSatApiWorkers" type="number" min="1" max="32" value="4"></div>
          </div>
          <div class="tt-cpsat-api-checkline">🔒 학생 객체는 전송하지 않습니다. 시간표 카드/배치 결과의 학생 필드도 제거하고, 학생 충돌은 과목카드 roster의 studentId만 사용합니다.</div>
          <div class="tt-cpsat-api-download-note">로컬 서버가 아직 없으면 <b>로컬 서버 다운로드</b>를 눌러 받은 뒤 압축을 풀고 <code>START_CP_SAT_LOCAL_SERVER.bat</code>를 실행하세요. 웹페이지가 자동 실행할 수는 없고, 실행은 Windows에서 직접 해야 합니다.</div>
          <div class="tt-cpsat-api-actions">
            <button type="button" data-action="download-local-server">로컬 서버 다운로드</button>
            <button type="button" data-action="health">1. 서버 확인</button>
            <button type="button" data-action="analyze">2. 데이터 점검</button>
            <button type="button" class="primary" data-action="solve">3. CP-SAT 실행</button>
            <button type="button" class="good" data-action="apply" disabled>4. 결과 적용</button>
            <button type="button" data-action="download-payload">전송 JSON 저장</button>
            <button type="button" data-action="download-result" disabled>결과 JSON 저장</button>
            <button type="button" data-action="refresh-current-meta">현재검증 메타갱신</button>
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
        timeLimitSeconds: Math.max(1, Math.min(300, parseInt($("#ttCpSatApiTime")?.value || "120", 10) || 120)),
        workers: Math.max(1, Math.min(32, parseInt($("#ttCpSatApiWorkers")?.value || "4", 10) || 4)),
        preferCpSat: true,
        returnFullState: false,
      };
    }
    async function solverState() {
      if (typeof prepareSolverState === "function") await prepareSolverState();
      latestState = makeSolverState(appState, {
        timetable: ttDomain?.() || appState?.timetable || {},
        entries: asArray(entries?.()),
      });
      return latestState;
    }
    function localSolverPreflight() {
      const currentEntries = asArray(entries?.());
      const seedEntries = currentEntries.filter(entry => isSolverSeedEntryForPayload(entry, currentEntries.length));
      const currentTimetable = ttDomain?.() || appState?.timetable || {};
      const scopeGrades = unique(asArray(currentTimetable.ttcards || currentTimetable.ttCards || currentTimetable.cards).map(card => card?.gradeKey));
      return buildTimetablePreflightDiagnostics({
        ...appState,
        timetable: { ...currentTimetable, entries: currentEntries },
      }, {
        scopeGrades,
        protectedEntries: seedEntries,
        periodCount: Number(ttConfig?.()?.periodCount || currentTimetable?.config?.periodCount || 7),
        allowAutoRoomAssignment: true,
      });
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
        if (btn.dataset.action === "apply") btn.disabled = isBusy || !resultMayBeApplied(latestResult);
        else if (btn.dataset.action === "download-result") btn.disabled = isBusy || !latestResult;
        else btn.disabled = isBusy;
      });
    }
    function renderApiSummary(data, kind = "result") {
      const validation = data?.validation || {};
      const counts = data?.counts || {};
      const assignCount = asArray(data?.entries).filter(e => e?.roomAssignmentsByTtCardId && Object.keys(e.roomAssignmentsByTtCardId).length).length;
      const privacy = data?.privacy?.solverPayload || privacyReport(latestState);
      const policy = applyPolicy(data || {}, normalizeEntryList(data?.entries || []), asArray(entries?.()).length);
      const issuePreview = issueLines(data, 5).join(" / ");
      const clientPreflight = data?.clientPreflight || null;
      const rowData = [
        ["상태", data?.status || data?.state || (data?.ok ? "OK" : "확인 필요")],
        ["브라우저 사전진단", clientPreflight ? formatTimetablePreflightSummary(clientPreflight) : "-"],
        ["검증", validation.summary || (validation.ok === true ? "정상" : "-")],
        ["적용판정", policy.canApply ? `적용 가능 · ${policy.reason}` : `적용 차단 · ${policy.reason}`],
        ["원인요약", issuePreview || "-"],
        ["카드", counts.cards ?? "-"],
        ["그룹카드", counts.groups ?? "-"],
        ["entries", counts.resultEntries ?? counts.entries ?? asArray(data?.entries).length ?? "-"],
        ["occurrences", counts.occurrences ?? "-"],
        ["교실배정 보존", assignCount || "-"],
        ["학생 객체 전송", `${privacy?.studentObjects ?? 0}명 / 학급학생목록 ${privacy?.classesWithStudents ?? 0}개`],
        ["시간표 학생필드", `카드 ${privacy?.ttcardsWithStudentKeys ?? 0}개 / entries ${privacy?.entriesWithAudienceStudentKeys ?? 0}개`],
        ["소요 시간", data?.elapsedSeconds != null ? `${data.elapsedSeconds}초` : "-"],
      ];
      summaryEl.className = `tt-cpsat-api-box ${policy.level || (validation.ok === false || data?.ok === false ? "warn" : "ok")}`;
      summaryEl.innerHTML = tableRows(rowData, escapeHtml);
      detailsEl.textContent = JSON.stringify({ kind, data }, null, 2);
    }

    overlay.addEventListener("click", ev => { if (ev.target === overlay && !running) overlay.remove(); });
    $('[data-action="close"]')?.addEventListener("click", () => {
      if (running && !confirm("CP-SAT 실행 중입니다. 창을 닫을까요? 실행은 서버에서 계속될 수 있습니다.")) return;
      overlay.remove();
    });
    $('[data-action="download-local-server"]')?.addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = LOCAL_SERVER_RELEASE_URL;
      a.target = "_blank";
      a.rel = "noopener";
      a.download = "HIS_CP_SAT_Local_Server_r343.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setStatus("info", `<b>다운로드를 시작했습니다.</b><br>GitHub Release에서 파일을 받은 뒤 압축을 풀고 <code>START_CP_SAT_LOCAL_SERVER.bat</code>를 실행하세요.<br><br>주소가 열리지 않으면 GitHub Release r343에 <code>HIS_CP_SAT_Local_Server_r343.zip</code> 파일이 아직 업로드되지 않은 상태입니다.`, 0);
    });


    $('[data-action="refresh-current-meta"]')?.addEventListener("click", async () => {
      try {
        setBusy(true); setStatus("warn", "현재 시간표 entries를 재검증하고 autoAssignMeta를 갱신 중...", 20);
        const result = await refreshCurrentValidationMeta(apiBase(), "manual-current-validation-refresh");
        const body = result?.validation || {};
        setStatus(body?.validation?.ok === false ? "warn" : "ok", `<b>현재검증 메타 갱신 완료</b><br>${escapeHtml(body?.validation?.summary || "현재검증 완료")}<br><span style="font-size:11px;color:#64748b">현재 entries ${asArray(entries?.()).length}개 기준으로 autoAssignMeta를 저장했습니다.</span>`, 100);
        renderApiSummary(body, "refresh-current-meta");
      } catch (err) {
        setStatus("bad", `<b>현재검증 메타 갱신 실패</b><br>${escapeHtml(err?.message || err)}<br><br>r343 로컬 서버가 실행 중인지 확인하세요.`, 0);
      } finally { setBusy(false); }
    });

    $('[data-action="health"]')?.addEventListener("click", async () => {
      try {
        setBusy(true); setStatus("warn", "서버 확인 중...", 10);
        const data = await getJson(`${apiBase()}/health`, 10000);
        const body = data?.data || data;
        const ortools = cleanLocal(body?.ortools || "not-installed");
        const ready = body?.solverReady === true || (ortools && ortools !== "not-installed");
        if (!ready) {
          setStatus("bad", `<b>서버는 실행 중이지만 OR-Tools가 없습니다.</b><br>GREEDY 진단 결과는 시간표에 적용할 수 없습니다. requirements.txt 설치를 완료한 뒤 다시 확인하세요.`, 0);
        } else {
          setStatus("ok", `<b>서버 정상</b> · OR-Tools ${escapeHtml(ortools)}`, 100);
        }
        renderApiSummary(body, "health");
      } catch (err) {
        setStatus("bad", `<b>서버 연결 실패</b><br>${escapeHtml(err?.message || err)}<br><br>START_CP_SAT_LOCAL_SERVER.bat가 실행 중인지 확인하세요.<br>로컬 서버가 없으면 [로컬 서버 다운로드] 버튼으로 받은 뒤 압축 해제 후 실행하세요.`, 0);
      } finally { setBusy(false); }
    });
    $('[data-action="analyze"]')?.addEventListener("click", async () => {
      try {
        setBusy(true); setStatus("warn", "현재 웹앱 데이터를 API로 점검 중...", 20);
        const state = await solverState();
        if (isSolverStateEmpty(state)) {
          setStatus("bad", `<b>데이터가 비어 있습니다.</b><br>${escapeHtml(emptyStateMessage(state))}`, 0);
          renderApiSummary({ ok: false, counts: countSolverState(state), validation: { ok: false, summary: "웹앱 데이터 없음" } }, "empty-state");
          return;
        }
        const clientPreflight = localSolverPreflight();
        if ((clientPreflight.blockingCount || 0) > 0) {
          const blockers = blockingTimetablePreflightIssues(clientPreflight).slice(0, 6);
          setStatus("bad", `<b>브라우저 사전진단에서 실행 차단</b><br>${escapeHtml(formatTimetablePreflightSummary(clientPreflight))}<br>${escapeHtml(blockers.map(issue => `${issue.title}: ${issue.detail}`).join(" / "))}`, 0);
          summaryEl.className = "tt-cpsat-api-box bad";
          summaryEl.innerHTML = tableRows([
            ["상태", "CP-SAT 전송 차단"],
            ["브라우저 사전진단", formatTimetablePreflightSummary(clientPreflight)],
            ["점검 복잡도", clientPreflight.performance?.complexity || "O(records + cards×slots)"],
            ["조치", "차단 항목을 수정한 뒤 다시 점검하세요."],
          ], escapeHtml);
          detailsEl.textContent = JSON.stringify({ kind: "client-preflight-blocked", clientPreflight }, null, 2);
          return;
        }
        setStatus(clientPreflight.counts?.warn ? "warn" : "info", `<b>브라우저 사전진단 완료</b><br>${escapeHtml(formatTimetablePreflightSummary(clientPreflight))}<br>서버 상세 점검을 계속합니다.`, 28);

        let analyzeError = null;
        try {
          const data = await postJson(`${apiBase()}/analyze`, { state }, 30000);
          const body = { ...(data?.data || data), clientPreflight };
          setStatus(body?.validation?.ok === false ? "warn" : "ok", `<b>데이터 점검 완료</b><br>${escapeHtml(body?.validation?.summary || "점검 완료")}<br><span style="font-size:11px;color:#64748b">브라우저 사전진단 ${escapeHtml(formatTimetablePreflightSummary(clientPreflight))} · 이 검증은 현재 시간표 entries 기준입니다.</span>`, 100);
          renderApiSummary(body, "analyze");
          return;
        } catch (err) {
          analyzeError = err;
        }

        // 일부 Windows/브라우저 조합에서 /analyze POST만 Failed to fetch로 끊기는 경우가 있어
        // 같은 payload를 /validate로 다시 보내고, 그래도 실패하면 서버 health + 로컬 payload 점검 결과를 보여줍니다.
        try {
          setStatus("warn", "기본 점검 경로가 실패하여 대체 검증(/validate)을 시도합니다...", 45);
          const data = await postJson(`${apiBase()}/validate`, { state }, 30000);
          const body = data?.data || data;
          const privacy = privacyReport(state);
          const merged = {
            ...body,
            clientPreflight,
            status: body?.status || "VALIDATE-FALLBACK",
            counts: body?.counts || countSolverState(state),
            privacy: body?.privacy || { solverPayload: privacy },
          };
          setStatus(merged?.validation?.ok === false ? "warn" : "ok", `<b>데이터 점검 완료</b> <span style="font-size:11px;color:#64748b">(/validate 대체 경로)</span><br>${escapeHtml(merged?.validation?.summary || "점검 완료")}<br><span style="font-size:11px;color:#64748b">현재 entries 검증 결과입니다. 자동배치 실행 결과가 아닙니다.</span>`, 100);
          renderApiSummary(merged, "validate-fallback");
          return;
        } catch (validateErr) {
          try {
            const health = await getJson(`${apiBase()}/health`, 10000);
            const counts = countSolverState(state);
            const privacy = privacyReport(state);
            const fallback = {
              ok: true,
              status: "LOCAL-PAYLOAD-OK",
              version: health?.version || health?.data?.version || "local-server",
              counts,
              privacy: { solverPayload: privacy },
              validation: {
                ok: true,
                summary: "서버는 정상입니다. 상세 점검 endpoint는 실패했지만 전송 JSON은 생성되었습니다. CP-SAT 실행은 가능합니다.",
                details: [
                  `analyze 실패: ${analyzeError?.message || analyzeError}`,
                  `validate 실패: ${validateErr?.message || validateErr}`,
                ],
              },
            };
            setStatus("warn", `<b>간이 데이터 점검 완료</b><br>서버는 정상이나 상세 점검 endpoint가 브라우저에서 실패했습니다. CP-SAT 실행이 된다면 자동배치는 계속 진행할 수 있습니다.<br><span style="font-size:11px;color:#64748b">analyze: ${escapeHtml(analyzeError?.message || analyzeError)} / validate: ${escapeHtml(validateErr?.message || validateErr)}</span>`, 100);
            renderApiSummary(fallback, "local-fallback-after-fetch-failure");
            return;
          } catch (_) {
            throw analyzeError || validateErr;
          }
        }
      } catch (err) {
        setStatus("bad", `<b>데이터 점검 실패</b><br>${escapeHtml(err?.message || err)}<br><br>먼저 [1. 서버 확인]을 눌러 로컬 서버가 살아 있는지 확인하세요. 서버 확인은 정상인데 이 메시지가 계속 뜨면 CP-SAT 실행 버튼은 그대로 사용할 수 있습니다.`, 0);
      } finally { setBusy(false); }
    });
    $('[data-action="solve"]')?.addEventListener("click", async () => {
      const solveSuspendToken = typeof suspendAutoSave === "function" ? suspendAutoSave("cp-sat-running") : null;
      try {
        latestResult = null;
        setBusy(true);
        const opt = options();
        const state = await solverState();
        if (isSolverStateEmpty(state)) {
          setStatus("bad", `<b>CP-SAT를 실행할 데이터가 없습니다.</b><br>${escapeHtml(emptyStateMessage(state))}`, 0);
          renderApiSummary({ ok: false, counts: countSolverState(state), validation: { ok: false, summary: "웹앱 데이터 없음" } }, "empty-state");
          return;
        }
        const clientPreflight = localSolverPreflight();
        if ((clientPreflight.blockingCount || 0) > 0) {
          const blockers = blockingTimetablePreflightIssues(clientPreflight).slice(0, 8);
          setStatus("bad", `<b>CP-SAT 실행 전 사전진단에서 차단되었습니다.</b><br>${escapeHtml(formatTimetablePreflightSummary(clientPreflight))}<br>${escapeHtml(blockers.map(issue => `${issue.title}: ${issue.detail}`).join(" / "))}`, 0);
          summaryEl.className = "tt-cpsat-api-box bad";
          summaryEl.innerHTML = tableRows([
            ["상태", "CP-SAT 실행 차단"],
            ["브라우저 사전진단", formatTimetablePreflightSummary(clientPreflight)],
            ["진단 시간", `${Number(clientPreflight.performance?.totalMs || 0).toFixed(1)}ms`],
            ["조치", "교사·교실·학급 ID, 가능시간, 고정배치 충돌을 수정하세요."],
          ], escapeHtml);
          detailsEl.textContent = JSON.stringify({ kind: "client-preflight-blocked", clientPreflight }, null, 2);
          return;
        }
        setStatus("warn", `<b>CP-SAT 실행 요청 중</b><br>브라우저 사전진단 ${escapeHtml(formatTimetablePreflightSummary(clientPreflight))} · 제한 ${opt.timeLimitSeconds}초`, 10);
        const start = await postJson(`${apiBase()}/solve/start`, { state, ...opt }, 30000);
        const jobId = start?.jobId;
        if (!jobId) throw new Error("jobId가 반환되지 않았습니다.");
        setStatus("warn", `<b>CP-SAT 작업 시작됨</b><br>jobId: ${escapeHtml(jobId)}<br>서버가 새 배치를 계산 중입니다.`, 14);
        let tick = 0;
        while (true) {
          await sleep(1000);
          tick += 1;
          const p = Math.min(92, 15 + Math.round((tick / Math.max(1, opt.timeLimitSeconds)) * 75));
          const job = await getJson(`${apiBase()}/solve/status/${encodeURIComponent(jobId)}`, 15000);
          setStatus("warn", `<b>${escapeHtml(solvePhaseLabel(job))}</b> · ${escapeHtml(job.message || job.state || "running")}<br>jobId: ${escapeHtml(jobId)}`, p);
          detailsEl.textContent = JSON.stringify({ jobId, state: job.state, phase: job.phase, message: job.message }, null, 2);
          if (job.state === "done") {
            latestResult = { ...(job.result || {}), clientPreflight };
            const policy = resultApplyPolicy(latestResult);
            const issues = issueLines(latestResult, 4);
            const issueHtml = issues.length ? `<br><span style="font-size:11px;color:#64748b">${escapeHtml(issues.join(" / "))}</span>` : "";
            const applyHtml = policy.canApply
              ? `<br><b>적용 가능:</b> ${escapeHtml(policy.reason)}`
              : `<br><b>적용 차단:</b> ${escapeHtml(policy.reason)} 결과 JSON은 저장할 수 있습니다.`;
            setStatus(policy.level || "ok", `<b>${escapeHtml(solvePhaseLabel(latestResult))}</b><br>${escapeHtml(latestResult?.validation?.summary || latestResult?.status || "완료")}${applyHtml}${issueHtml}`, 100);
            renderApiSummary(latestResult, "solve");
            applyBtn.textContent = "4. 결과 적용";
            applyBtn.disabled = !policy.canApply;
            resultBtn.disabled = false;
            break;
          }
          if (["failed", "error"].includes(String(job.state))) {
            if (job.result && asArray(job.result.entries).length) {
              latestResult = { ...(job.result || {}), clientPreflight };
              const policy = resultApplyPolicy(latestResult);
              setStatus(policy.level || "warn", `<b>CP-SAT 부분 배치 완료</b><br>${escapeHtml(latestResult?.validation?.summary || job.message || "검증 필요")}<br>${policy.canApply ? `<b>적용 가능:</b> ${escapeHtml(policy.reason)}` : `<b>적용 차단:</b> ${escapeHtml(policy.reason)}`}<br><span style="font-size:11px;color:#64748b">${escapeHtml(issueLines(latestResult, 4).join(" / "))}</span>`, 100);
              renderApiSummary(latestResult, "solve-failed-with-result");
              applyBtn.textContent = "4. 결과 적용";
              applyBtn.disabled = !policy.canApply;
              resultBtn.disabled = false;
              break;
            }
            throw new Error(job.message ? `${job.message} (서버가 적용 가능한 entries를 반환하지 않았습니다.)` : "CP-SAT 실행 실패: 서버가 적용 가능한 entries를 반환하지 않았습니다.");
          }
        }
      } catch (err) {
        setStatus("bad", `<b>CP-SAT 실행 실패</b><br>${escapeHtml(err?.message || err)}`, 0);
      } finally {
        if (solveSuspendToken && typeof resumeAutoSave === "function") resumeAutoSave(solveSuspendToken, { flush: false });
        setBusy(false);
      }
    });
    applyBtn?.addEventListener("click", async () => {
      if (!latestResult?.entries?.length) { alert("적용할 결과가 없습니다."); return; }
      const policy = resultApplyPolicy(latestResult);
      if (!policy.canApply) {
        alert(`이 결과는 적용할 수 없습니다.\n\n${policy.reason}\n\n${issueText(latestResult)}`);
        return;
      }
      const assignCount = asArray(latestResult.entries).filter(e => e?.roomAssignmentsByTtCardId && Object.keys(e.roomAssignmentsByTtCardId).length).length;
      const prefix = "검증을 통과한 CP-SAT 결과를 현재 시간표에 적용할까요?";
      const warning = "";
      const msg = `${prefix}\n\nentries: ${latestResult.entries.length}\n교실 배정 포함 entry: ${assignCount}\n검증: ${latestResult.validation?.summary || "-"}${warning}\n현재 시간표는 배치 보관에 자동 백업됩니다.`;
      if (!confirm(msg)) return;
      try { if (await applySolvedEntries(latestResult.entries, latestResult, apiBase())) overlay.remove(); }
      catch (err) { alert(`적용 실패: ${err?.message || err}`); }
    });
    $('[data-action="download-payload"]')?.addEventListener("click", async () => downloadJson(`his_solver_payload_${Date.now()}.json`, await solverState()));
    resultBtn?.addEventListener("click", () => {
      if (!latestResult) { alert("저장할 결과가 없습니다."); return; }
      downloadJson(`his_cp_sat_api_result_${Date.now()}.json`, latestResult);
    });
  }

  window.HisCpSatWebappImport = {
    makeSolverState: () => makeSolverState(appState, {
      timetable: ttDomain?.() || appState?.timetable || {},
      entries: asArray(entries?.()),
    }),
    privacyReport: () => privacyReport(makeSolverState(appState, {
      timetable: ttDomain?.() || appState?.timetable || {},
      entries: asArray(entries?.()),
    })),
    refreshCurrentValidationMeta: (base = localStorage.getItem(API_URL_KEY) || API_DEFAULT) => refreshCurrentValidationMeta(base, "console-current-validation-refresh"),
    entriesSummary,
  };
}
