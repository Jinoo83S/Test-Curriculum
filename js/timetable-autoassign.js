// ================================================================
// timetable-autoassign.js · Auto Assignment Engine
// ================================================================
// This module keeps the auto-placement algorithm separate from the
// timetable page renderer. Dependencies are injected from timetable.js
// so the engine can still use the current app state, UI callbacks, and
// shared occupancy logic without creating circular imports.

import { isExperimentalResidualRepairEnabled, stripStaleResidualPuzzleReport } from "./timetable-validator.js?v=2026-07-15-room-availability-separation-r355";
import { buildTimetablePreflightDiagnostics, formatTimetablePreflightSummary } from "./timetable-preflight-diagnostics.js?v=2026-07-16-cpsat-result-truth-r367";

globalThis.HIS_AUTOASSIGN_BUILD = "2026-07-16-cpsat-result-truth-r367";

export function createAutoAssignAll(deps) {
  const {
    GRADE_KEYS, canEdit, appState, scheduleSave, saveNow, normalizeTimetableEntry,
    uid, sectionLabel, gradeDisplay, splitTeacherNames,
    getTemplateById, getTemplateCardTitle, getTtCardById,
    describeTtCard, makePlacementFromGroupItem, getSubjectsForGrade, getCreditsForTtCard,
    getTeachersForTtCard,
    entries, ttDomain, ttConfig, constraints,
    buildSchedulableItems, getEffectiveAssignedRoomId, applyDefaultRoomToEntryData,
    audienceForPlacement, audiencesConflict, ttCardIdsFromPlacement, protectedSlotConflict,
    shuffle, captureTimetableUndo, addTimetableLog, setLastAutoAssignReport,
    getConflictCounts, recomputeConflicts, renderAll, $,
    preflightTimetableData = null
  } = deps;

  const ttGroups = () => appState.timetable?.ttcardGroups || [];
  const cleanStr = value => String(value ?? "").trim();
  const normalizeRoomRuleForAuto = rule => {
    const r = cleanStr(rule);
    if (!r || r === "auto") return "teacher";
    return ["teacher", "fixed", "homeroom", "autoRoom", "none"].includes(r) ? r : "teacher";
  };
  const uniqueRoomIds = list => [...new Set((list || []).map(cleanStr).filter(Boolean))];
  // r138: 기본은 교사 교실/지정교실이 있는 카드만 배치합니다.
  // 사용자가 옵션을 켤 때만 빈 교실 자동 배정을 허용합니다.
  let currentAllowAutoRoomAssignment = false;
  // r366: the exact candidate scan performed by the preflight is reused by
  // the immediately following solver run, so the diagnostic does not duplicate
  // the most expensive ordering pass.
  let precheckCandidateCache = null;

  function getTeacherAssignedRoomIdForAuto(teacherName = "") {
    const teacher = cleanStr(teacherName);
    if (!teacher) return "";
    const fromConstraints = cleanStr(getEffectiveAssignedRoomId(teacher) || "");
    if (fromConstraints) return fromConstraints;
    const matches = (appState.rooms?.rooms || [])
      .filter(room => cleanStr(room.teacherName) === teacher && room.id)
      .map(room => room.id);
    const unique = uniqueRoomIds(matches);
    return unique.length === 1 ? unique[0] : "";
  }

  function placementHasTeacherAssignedRoomForAuto(item = {}) {
    return teacherNamesForPlacement(item).some(name => !!getTeacherAssignedRoomIdForAuto(name));
  }

  function blockHasTeacherAssignedRoomForAuto(block = {}) {
    return (block.items || []).some(item => placementHasTeacherAssignedRoomForAuto(item));
  }

  function uniqueTeacherRoomIdForNamesAuto(names = []) {
    const roomIds = uniqueRoomIds((names || []).map(name => getTeacherAssignedRoomIdForAuto(name)));
    return roomIds.length === 1 ? roomIds[0] : "";
  }

  function cardTeacherNamesForAuto(card = {}, fallback = {}) {
    const fromCard = getTeachersForTtCard(card).filter(Boolean);
    if (fromCard.length) return fromCard;
    if (Array.isArray(card?.teachers) && card.teachers.length) return card.teachers.map(cleanStr).filter(Boolean);
    if (card?.teacherName) return splitTeacherNames(card.teacherName).filter(Boolean);
    if (Array.isArray(fallback?.teacherNames) && fallback.teacherNames.length) return fallback.teacherNames.map(cleanStr).filter(Boolean);
    return splitTeacherNames(fallback.teacherName || "").filter(Boolean);
  }


  function normalizeAutoClassKey(value = "", fallbackGradeKey = "") {
    const raw = cleanStr(value).replace(/\s+/g, "").replace(/학년/g, "").toUpperCase();
    if (!raw) return "";
    if (raw.includes(":")) {
      const [g, sec] = raw.split(":");
      const n = Number(String(g || "").replace(/[^0-9]/g, ""));
      return n && sec ? `${n}:${sec}` : "";
    }
    const m = raw.match(/^(\d{1,2})(.+)$/);
    if (m) return `${Number(m[1])}:${m[2]}`;
    const fg = Number(String(fallbackGradeKey || "").replace(/[^0-9]/g, ""));
    return fg && raw ? `${fg}:${raw}` : "";
  }

  function classIdForAutoClassKey(classKey = "") {
    const [gradeNo, rawSection] = cleanStr(classKey).split(":");
    const grade = `${Number(gradeNo)}학년`;
    const section = cleanStr(rawSection).toUpperCase();
    const cls = (appState.classes?.classes || []).find(c => cleanStr(c.grade) === grade && cleanStr(c.name).toUpperCase() === section);
    return cls?.id || "";
  }

  function homeroomRoomIdForAutoClassKey(classKey = "") {
    const classId = classIdForAutoClassKey(classKey);
    if (!classId) return "";
    return (appState.rooms?.rooms || []).find(r => r.homeRoomClassId === classId)?.id || "";
  }

  function classKeysForAutoRoomSource(card = {}, fallback = {}) {
    const direct = [
      ...(Array.isArray(card?.classKeys) ? card.classKeys : []),
      ...(Array.isArray(card?.audienceClassKeys) ? card.audienceClassKeys : []),
      ...(Array.isArray(fallback?.audienceClassKeys) ? fallback.audienceClassKeys : []),
      ...(Array.isArray(fallback?.classKeys) ? fallback.classKeys : []),
    ].map(v => normalizeAutoClassKey(v, card?.gradeKey || fallback?.gradeKey)).filter(Boolean);
    if (direct.length) return [...new Set(direct)];
    const labels = [
      ...(Array.isArray(card?.classLabels) ? card.classLabels : []),
      ...(Array.isArray(fallback?.classLabels) ? fallback.classLabels : []),
    ].map(v => normalizeAutoClassKey(v, card?.gradeKey || fallback?.gradeKey)).filter(Boolean);
    if (labels.length) return [...new Set(labels)];
    const gradeNum = Number(String(card?.gradeKey || fallback?.gradeKey || "").replace(/[^0-9]/g, ""));
    const sec = Number.isInteger(card?.sectionIdx) ? String.fromCharCode(65 + card.sectionIdx) : Number.isInteger(fallback?.sectionIdx) ? String.fromCharCode(65 + fallback.sectionIdx) : "";
    return gradeNum && sec ? [`${gradeNum}:${sec}`] : [];
  }

  function homeroomRoomIdForAutoSource(card = {}, fallback = {}) {
    const roomIds = uniqueRoomIds(classKeysForAutoRoomSource(card, fallback).map(homeroomRoomIdForAutoClassKey));
    return roomIds.length === 1 ? roomIds[0] : "";
  }

  function configuredRoomIdsForCardDuringAuto(card = {}, fallback = {}) {
    const rule = normalizeRoomRuleForAuto(card?.roomRule || fallback?.roomRule || "teacher");
    if (rule === "none") return [];
    const requiredCount = Math.max(
      1,
      Number(card?.requiredRoomCount || card?.multiRoomCount || card?.solverRequiredRoomCount || 1) || 1,
      Number(fallback?.requiredRoomCount || fallback?.multiRoomCount || fallback?.solverRequiredRoomCount || 1) || 1
    );
    const fixedLike = uniqueRoomIds([
      card?.fixedRoomId,
      ...(Array.isArray(card?.fixedRoomIds) ? card.fixedRoomIds : []),
      ...(Array.isArray(card?.manualRoomIds) ? card.manualRoomIds : []),
      ...(Array.isArray(card?.requiredRoomIds) ? card.requiredRoomIds : []),
      ...(Array.isArray(card?.solverFixedRoomIds) ? card.solverFixedRoomIds : []),
      fallback?.fixedRoomId,
      ...(Array.isArray(fallback?.fixedRoomIds) ? fallback.fixedRoomIds : []),
      ...(Array.isArray(fallback?.manualRoomIds) ? fallback.manualRoomIds : []),
      ...(Array.isArray(fallback?.requiredRoomIds) ? fallback.requiredRoomIds : []),
      ...(Array.isArray(fallback?.solverFixedRoomIds) ? fallback.solverFixedRoomIds : []),
    ]);
    if (fixedLike.length) return fixedLike;
    if (rule === "fixed" || requiredCount > 1) {
      const explicit = uniqueRoomIds([
        ...(Array.isArray(card?.roomIds) ? card.roomIds : []),
        ...(Array.isArray(fallback?.roomIds) ? fallback.roomIds : []),
        fallback?.roomId,
      ]);
      if (explicit.length) return explicit;
    }
    if (rule === "homeroom") {
      const homeroom = homeroomRoomIdForAutoSource(card || {}, fallback || {});
      return homeroom ? [homeroom] : [];
    }
    if (rule === "autoRoom") return [];
    const teacherRoom = uniqueTeacherRoomIdForNamesAuto(cardTeacherNamesForAuto(card || {}, fallback));
    return teacherRoom ? [teacherRoom] : [];
  }

  function fixedRoomForCardDuringAuto(card = {}, fallback = {}) {
    return configuredRoomIdsForCardDuringAuto(card, fallback)[0] || "";
  }

  function fixedRoomForAutoData(data = {}) {
    const ids = ttCardIdsFromPlacement(data);
    if (ids.length === 1) return fixedRoomForCardDuringAuto(getTtCardById(ids[0]), data);
    return fixedRoomForCardDuringAuto({}, data);
  }

  function isManualRoomOverrideForCardAuto(entry = {}, card = {}, explicitRoomId = "") {
    const roomId = cleanStr(explicitRoomId);
    if (!roomId) return false;
    const entryRule = normalizeRoomRuleForAuto(entry.roomRule || "teacher");
    // r210: teacher 규칙 entry의 roomPinned 잔존값을 수동 지정으로 오판하지 않습니다.
    if (entry.roomPinned === true && entryRule === "fixed") return true;
    if (entryRule === "fixed" && cleanStr(entry.roomId || entry.fixedRoomId) === roomId) return true;
    const cardRule = normalizeRoomRuleForAuto(card?.roomRule || "teacher");
    if (cardRule === "fixed" && cleanStr(card?.fixedRoomId) === roomId) return true;
    return false;
  }

  function autoItemHasFixedRoomForAuto(item = {}) {
    if ((ttCardIdsFromPlacement(item) || []).some(id => fixedRoomForCardDuringAuto(getTtCardById(id), item))) return true;
    return !!fixedRoomForAutoData(item);
  }

  function blockHasFixedRoomForAuto(block = {}) {
    return (block.items || []).some(item => autoItemHasFixedRoomForAuto(item));
  }

  function normalizeSchedulePositiveIntAuto(value, fallback = 1, { min = 1, max = 7 } = {}) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }
  function durationForAutoObject(obj = {}) {
    return normalizeSchedulePositiveIntAuto(
      obj.durationPeriods ?? obj.continuousPeriods ?? obj.consecutivePeriods ?? obj.solverDurationPeriods ?? 1,
      1,
      { min: 1, max: 7 }
    );
  }
  function requiredRoomCountForAutoObject(obj = {}) {
    return normalizeSchedulePositiveIntAuto(
      obj.requiredRoomCount ?? obj.multiRoomCount ?? obj.solverRequiredRoomCount ?? 1,
      1,
      { min: 1, max: 12 }
    );
  }
  function blockDurationPeriods(block = {}) {
    return Math.max(1, durationForAutoObject(block), ...(block.items || []).map(durationForAutoObject), ...(block.activeItems || []).map(durationForAutoObject));
  }
  function itemRequiredRoomCount(item = {}) {
    const cardCounts = ttCardIdsFromPlacement(item)
      .map(id => getTtCardById(id))
      .filter(Boolean)
      .map(requiredRoomCountForAutoObject);
    return Math.max(1, requiredRoomCountForAutoObject(item), ...cardCounts);
  }
  function blockRequiredRoomCount(block = {}) {
    const groupCount = requiredRoomCountForAutoObject(block.group || {});
    return Math.max(1, groupCount, ...(block.items || []).map(itemRequiredRoomCount), ...(block.activeItems || []).map(itemRequiredRoomCount));
  }
  function blockSlotSequence(block = {}, slot = {}) {
    const periodCount = Math.max(1, parseInt(ttConfig()?.periodCount, 10) || 7);
    const duration = blockDurationPeriods(block);
    const startPeriod = Number(slot.period);
    const day = Number(slot.day);
    if (!Number.isInteger(day) || !Number.isInteger(startPeriod)) return [];
    if (startPeriod < 0 || startPeriod + duration > periodCount) return [];
    return Array.from({ length: duration }, (_, offset) => ({ day, period: startPeriod + offset, spanIndex: offset }));
  }

  function blockClassCardSize(block = {}) {
    const classCount = freshBlockAudienceKeys(block).length;
    const cardCount = freshBlockCardIds(block).length;
    const teacherCount = freshBlockTeacherNames(block).length;
    return classCount * 1000 + cardCount * 100 + teacherCount * 10;
  }


  function experimentalResidualRepairEnabled(localOptions = {}) {
    return isExperimentalResidualRepairEnabled({
      ...localOptions,
      engineProfile: localOptions.engineProfile || localOptions?.checkOptions?.engineProfile
    });
  }

  function watchAutoSave(promise, ms = 25000, label = "시간표 저장") {
    let timer = null;
    let settled = false;
    const savePromise = Promise.resolve(promise)
      .then(ok => {
        settled = true;
        return { ok: ok !== false, pending: false };
      })
      .catch(error => {
        settled = true;
        return { ok: false, pending: false, error };
      });
    const timeoutPromise = new Promise(resolve => {
      timer = setTimeout(() => {
        if (!settled) resolve({ ok: true, pending: true, delayedSeconds: Math.round(ms / 1000) });
      }, ms);
    });
    return Promise.race([savePromise, timeoutPromise]).finally(() => { if (timer) clearTimeout(timer); });
  }

  async function persistTimetableNow() {
    if (typeof saveNow === "function") {
      // r83: 자동배치 결과 저장이 느려도 프로그램 오류로 처리하지 않습니다.
      // force 저장은 변경 없는 시간표 카드까지 다시 쓰게 되어 237개 카드 + 500개 이상 entry를 모두 저장할 수 있습니다.
      // 자동배치에서는 변경된 entry/meta만 저장하고, 25초를 넘기면 백그라운드 저장으로 넘깁니다.
      const savePromise = Promise.resolve(saveNow("timetable", { force: false, throwOnError: true }));
      const watched = await watchAutoSave(savePromise, 25000, "시간표 저장");
      if (watched?.pending) {
        addTimetableLog?.(
          "warn",
          "시간표 저장 지연",
          "자동배치 결과 계산은 완료되었고 화면에 표시했습니다. Firestore 저장은 백그라운드에서 계속 진행합니다. 잠시 후 저장 상태가 완료로 바뀌는지 확인해 주세요."
        );
        savePromise
          .then(ok => {
            if (ok !== false) addTimetableLog?.("auto", "시간표 저장 완료", "지연되었던 자동배치 결과 저장이 백그라운드에서 완료되었습니다.");
            else addTimetableLog?.("warn", "시간표 저장 확인 필요", "백그라운드 저장 결과가 실패로 반환되었습니다. 저장 버튼을 한 번 더 눌러 주세요.");
          })
          .catch(error => {
            console.error("Delayed timetable save failed:", error);
            addTimetableLog?.("error", "시간표 저장 실패", error?.message || String(error || "저장 실패"));
          });
        return true;
      }
      if (!watched?.ok) {
        const message = watched?.error?.message || "시간표 저장에 실패했습니다. 저장 버튼을 한 번 더 눌러 주세요.";
        console.error("Timetable save failed:", watched?.error || message);
        addTimetableLog?.("error", "시간표 저장 실패", message);
        return false;
      }
      return true;
    }
    scheduleSave("timetable", { immediate: true, saveOptions: { force: false } });
    return true;
  }

  // 자동배치 전/후 배치를 자동으로 보관해 비교와 복구가 쉽도록 합니다.
  // 커리큘럼/카드/교사조건은 저장하지 않고, 배치 entries만 savedSchedules에 넣습니다.
  function formatAutoSnapshotTime(date = new Date()) {
    const pad = n => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function normalizeSnapshotEntries(list = []) {
    return (list || []).map(entry => {
      const cloned = cloneAutoAssignData(entry || {});
      return typeof normalizeTimetableEntry === "function"
        ? normalizeTimetableEntry(cloned)
        : cloned;
    }).filter(entry => entry && (entry.templateId || entry.ttcardId || (entry.ttcardIds || []).length));
  }

  function normalizeDiagnosticSuggestion(suggestion) {
    if (suggestion == null) return null;
    if (typeof suggestion !== "object") {
      const text = String(suggestion || "").trim();
      if (!text || text === "[object Object]") return null;
      return { title: text, detail: "", summary: text, availableAfter: 0, priority: 9 };
    }
    const title = String(suggestion.title || suggestion.summary || "제안").trim();
    const detail = String(suggestion.detail || "").trim();
    const availableAfter = Number(suggestion.availableAfter || 0) || 0;
    const summary = String(suggestion.summary || `${title}${detail ? `: ${detail}` : ""}${availableAfter ? ` · 완화 시 ${availableAfter}칸 가능` : ""}`).trim();
    return {
      title: title || "제안",
      detail,
      summary,
      availableAfter,
      priority: Number(suggestion.priority || 9) || 9,
      gain: Number(suggestion.gain || 0) || 0
    };
  }

  function formatDiagnosticSuggestion(suggestion) {
    const normalized = normalizeDiagnosticSuggestion(suggestion);
    return normalized ? normalized.summary : "";
  }


  function normalizeAutoActiveGrades(value = []) {
    if (Array.isArray(value)) return value.map(v => String(v || "").trim()).filter(Boolean);
    if (value instanceof Set) return Array.from(value).map(v => String(v || "").trim()).filter(Boolean);
    if (typeof value === "string") {
      return value.split(/[,/|·]+/).map(v => v.trim()).filter(Boolean);
    }
    if (value && typeof value === "object") {
      if (Array.isArray(value.activeGrades)) return normalizeAutoActiveGrades(value.activeGrades);
      if (Array.isArray(value.selectedGrades)) return normalizeAutoActiveGrades(value.selectedGrades);
      return Object.values(value).map(v => String(v || "").trim()).filter(Boolean);
    }
    return [];
  }

  function formatAutoActiveGrades(value = []) {
    return normalizeAutoActiveGrades(value)
      .map(g => typeof gradeDisplay === "function" ? gradeDisplay(g) : g)
      .filter(Boolean)
      .join(", ");
  }

  function autoAssignModeLabel(mode = "balanced") {
    const value = String(mode || "balanced");
    if (value === "fast") return "빠른 점검";
    if (value === "deep") return "정교한 배치";
    return "균형 배치";
  }

  function autoAssignResultKind({ runMode = "balanced", incomplete = false, runtimeError = false, cancelled = false } = {}) {
    const modeLabel = autoAssignModeLabel(runMode);
    if (runtimeError) {
      return {
        status: "program-error",
        title: "자동배치 프로그램 오류",
        subtitle: "계산 또는 저장 중 예외가 발생했습니다. 마지막 후보가 있으면 화면에 표시합니다.",
        step: "프로그램 오류",
        logType: "error",
        logTitle: "자동배치 프로그램 오류"
      };
    }
    if (cancelled) {
      return {
        status: "cancelled",
        title: "자동배치 취소됨",
        subtitle: "사용자가 중단했습니다. 마지막 후보가 있으면 화면에 표시합니다.",
        step: "취소",
        logType: "warn",
        logTitle: "자동배치 취소"
      };
    }
    if (incomplete) {
      return {
        status: "incomplete",
        title: `${modeLabel} 결과 표시 · 확인 필요`,
        subtitle: runMode === "fast"
          ? "프로그램 오류는 없지만 빠른 점검 특성상 미배치/충돌/시수 확인 항목이 남을 수 있습니다."
          : "프로그램 오류는 없고, 배치 결과 중 미배치/충돌/시수 확인 항목이 남아 있습니다.",
        step: "배치 미완성",
        logType: "warn",
        logTitle: `${modeLabel} 배치 미완성`
      };
    }
    return {
      status: "complete",
      title: `${modeLabel} 완료`,
      subtitle: runMode === "fast"
        ? "빠른 점검에서 프로그램 오류 없이 배치와 검증을 통과했습니다."
        : "자동배치가 완료되었고 검증을 통과했습니다.",
      step: "완료",
      logType: "auto",
      logTitle: `${modeLabel} 완료`
    };
  }


  function compactAutoAssignSnapshotMeta(meta = {}) {
    const clone = value => {
      if (!value || typeof value !== "object") return null;
      try { return JSON.parse(JSON.stringify(value)); } catch (_) { return null; }
    };
    const compactResidualPuzzle = report => {
      if (!report || typeof report !== "object") return null;
      const rows = Array.isArray(report.rows) ? report.rows.slice(0, 12).map(row => ({
        name: String(row?.name || ""),
        classLabels: String(row?.classLabels || ""),
        teachers: Array.isArray(row?.teachers) ? row.teachers.slice(0, 6).map(x => String(x || "")) : [],
        requiredCredits: Number(row?.requiredCredits || 0) || 0,
        placedSlots: Number(row?.placedSlots || 0) || 0,
        missingSlots: Number(row?.missingSlots || 0) || 0,
        directSlotCount: Number(row?.directSlotCount || 0) || 0,
        directSlots: Array.isArray(row?.directSlots) ? row.directSlots.slice(0, 8).map(x => String(x || "")) : [],
        oneMoveSlotCount: Number(row?.oneMoveSlotCount || 0) || 0,
        executableOneMoveSlotCount: Number(row?.executableOneMoveSlotCount || 0) || 0,
        oneMoveSlots: Array.isArray(row?.oneMoveSlots) ? row.oneMoveSlots.slice(0, 6).map(slot => ({
          slot: String(slot?.slot || ""),
          reasonCodes: Array.isArray(slot?.reasonCodes) ? slot.reasonCodes.slice(0, 6).map(x => String(x || "")) : [],
          movableBlockCount: Number(slot?.movableBlockCount || 0) || 0,
          blockedBlockCount: Number(slot?.blockedBlockCount || 0) || 0,
          executable: slot?.executable === true,
          blockers: Array.isArray(slot?.blockers) ? slot.blockers.slice(0, 4).map(block => ({
            key: String(block?.key || ""),
            names: Array.isArray(block?.names) ? block.names.slice(0, 4).map(x => String(x || "")) : [],
            teachers: Array.isArray(block?.teachers) ? block.teachers.slice(0, 4).map(x => String(x || "")) : [],
            classes: Array.isArray(block?.classes) ? block.classes.slice(0, 6).map(x => String(x || "")) : [],
            movable: block?.movable === true,
            moveCandidateCount: Number(block?.moveCandidateCount || 0) || 0,
            moveCandidates: Array.isArray(block?.moveCandidates) ? block.moveCandidates.slice(0, 5).map(x => String(x || "")) : []
          })) : []
        })) : [],
        executableOneMoveSlots: Array.isArray(row?.executableOneMoveSlots) ? row.executableOneMoveSlots.slice(0, 6).map(slot => ({
          slot: String(slot?.slot || ""),
          reasonCodes: Array.isArray(slot?.reasonCodes) ? slot.reasonCodes.slice(0, 6).map(x => String(x || "")) : [],
          movableBlockCount: Number(slot?.movableBlockCount || 0) || 0,
          blockedBlockCount: Number(slot?.blockedBlockCount || 0) || 0,
          executable: slot?.executable === true,
          blockers: Array.isArray(slot?.blockers) ? slot.blockers.slice(0, 4).map(block => ({
            key: String(block?.key || ""),
            names: Array.isArray(block?.names) ? block.names.slice(0, 4).map(x => String(x || "")) : [],
            teachers: Array.isArray(block?.teachers) ? block.teachers.slice(0, 4).map(x => String(x || "")) : [],
            classes: Array.isArray(block?.classes) ? block.classes.slice(0, 6).map(x => String(x || "")) : [],
            movable: block?.movable === true,
            moveCandidateCount: Number(block?.moveCandidateCount || 0) || 0,
            moveCandidates: Array.isArray(block?.moveCandidates) ? block.moveCandidates.slice(0, 5).map(x => String(x || "")) : []
          })) : []
        })) : [],
        summary: String(row?.summary || "")
      })) : [];
      return {
        schemaVersion: String(report.schemaVersion || "2026-06-11-residual-puzzle-report-r37"),
        generatedAt: String(report.generatedAt || ""),
        targetCount: Number(report.targetCount || rows.length) || rows.length,
        summary: String(report.summary || ""),
        rows
      };
    };
    const hasFinalMetrics = !!(meta.finalMetrics && typeof meta.finalMetrics === "object");
    const metricCompleteness = String(meta.metricCompleteness || (hasFinalMetrics ? "complete" : "") || "");
    const final = meta.finalMetrics || {};
    const summaryText = String(meta.validationSummary || final.validationSummary || meta.qualityBaselineValidationSummary || "");
    const summaryCount = regex => Number((summaryText.match(regex) || [0, ""])[1]) || 0;
    const summaryClassIssues = summaryCount(/학급\s*시수\s*(\d+)개/);
    const summaryCardIssues = summaryCount(/카드\s*시수\s*(\d+)개/);
    const summaryGroupIssues = summaryCount(/그룹\/개별\s*(\d+)개/);
    const summaryFailedIssues = summaryCount(/미배치\s*(\d+)개/);
    // r41: 오래된 best/saved 보관본은 validationSummary는 살아 있는데
    // 압축 수치가 0으로 남아 있었습니다. finalMetrics가 없고 complete 메타도 없으면
    // 0값보다 summary 문장을 우선합니다.
    const metricNumber = (direct, finalValue, fallback = 0) => {
      const f = Number(finalValue);
      if (Number.isFinite(f)) return f;
      const d = Number(direct);
      const fb = Number(fallback);
      if (Number.isFinite(d)) {
        if (d === 0 && Number.isFinite(fb) && fb > 0 && !hasFinalMetrics && metricCompleteness !== "complete") return fb;
        return d;
      }
      return Number.isFinite(fb) ? fb : 0;
    };
    return {
      validationSummary: summaryText,
      ok: meta.ok === true,
      resultStatus: String(meta.resultStatus || ""),
      resultStatusLabel: String(meta.resultStatusLabel || ""),
      placementIncomplete: meta.placementIncomplete === true,
      programError: meta.programError === true,
      activeGrades: normalizeAutoActiveGrades(meta.activeGrades),
      modeText: String(meta.modeText || ""),
      options: clone(meta.options),
      autoSourceSignature: compactAutoSourceSignature(meta.autoSourceSignature || meta.sourceSignature || ""),
      autoSourceSummary: String(meta.autoSourceSummary || ""),
      classIssueCount: metricNumber(meta.classIssueCount ?? meta.classSlotIssueCount, final.classSlotIssueCount, summaryClassIssues),
      classSlotIssueCount: metricNumber(meta.classSlotIssueCount ?? meta.classIssueCount, final.classSlotIssueCount, summaryClassIssues),
      classShortCount: metricNumber(meta.classShortCount, final.classShortCount),
      classOverCount: metricNumber(meta.classOverCount, final.classOverCount),
      cardCoverageIssueCount: metricNumber(meta.cardCoverageIssueCount, final.cardCoverageIssueCount, summaryCardIssues),
      groupCoverageIssueCount: metricNumber(meta.groupCoverageIssueCount, final.groupCoverageIssueCount, summaryGroupIssues),
      failedUnitCount: metricNumber(meta.failedUnitCount ?? meta.failedCount, final.failedCount, summaryFailedIssues),
      failedCount: metricNumber(meta.failedCount ?? meta.failedUnitCount, final.failedCount, summaryFailedIssues),
      cardShortageSlots: metricNumber(meta.cardShortageSlots, final.cardShortageSlots, summaryCardIssues),
      classTotal: metricNumber(meta.classTotal, final.classTotal),
      classTargetTotal: metricNumber(meta.classTargetTotal, final.classTargetTotal),
      classTargetGap: metricNumber(meta.classTargetGap, final.classTargetGap),
      restrictedTeacherIssueCount: metricNumber(meta.restrictedTeacherIssueCount, final.restrictedTeacherIssueCount),
      missingRoomCount: metricNumber(meta.missingRoomCount, final.missingRoomCount),
      protectedIntrusionCount: metricNumber(meta.protectedIntrusionCount, final.protectedIntrusionCount),
      acceptedMetrics: clone(meta.acceptedMetrics),
      finalMetrics: clone(meta.finalMetrics),
      baselineMetrics: clone(meta.baselineMetrics),
      qualityGate: clone(meta.qualityGate),
      // r50: export는 timetable 도메인의 임의 top-level 필드를 보존하지 않을 수 있습니다.
      // 그래서 후보/오류 계측은 반드시 autoAssignMeta 내부에도 압축해 함께 남깁니다.
      autoAssignCandidate: clone(meta.autoAssignCandidate || meta.lastAutoAssignCandidate || meta.candidateTelemetry),
      lastAutoAssignCandidate: clone(meta.lastAutoAssignCandidate || meta.autoAssignCandidate || meta.candidateTelemetry),
      autoAssignCandidateLog: Array.isArray(meta.autoAssignCandidateLog)
        ? meta.autoAssignCandidateLog.slice(0, 12).map(clone).filter(Boolean)
        : [],
      lastAutoAssignError: clone(meta.lastAutoAssignError || meta.autoAssignError),
      autoAssignError: clone(meta.autoAssignError || meta.lastAutoAssignError),
      telemetryStatus: String(meta.telemetryStatus || ""),
      engine: String(meta.engine || ""),
      appVersion: String(meta.appVersion || globalThis.HIS_APP_VERSION || ""),
      autoAssignBuild: String(meta.autoAssignBuild || globalThis.HIS_AUTOASSIGN_BUILD || ""),
      engineProfileLabel: String(meta.engineProfileLabel || ""),
      durationMs: Number(meta.durationMs || 0) || 0,
      placedBlockCount: Number(meta.placedBlockCount || 0) || 0,
      failedOccurrenceCount: Number(meta.failedOccurrenceCount || 0) || 0,
      metricSource: String(meta.metricSource || (hasFinalMetrics ? "finalMetrics" : "")),
      metricCompleteness,
      qualityBaselineSource: String(meta.qualityBaselineSource || ""),
      qualityBaselineSnapshotName: String(meta.qualityBaselineSnapshotName || ""),
      qualityBaselineValidationSummary: String(meta.qualityBaselineValidationSummary || ""),
      failedDiagnostics: Array.isArray(meta.failedDiagnostics) ? meta.failedDiagnostics.slice(0, 8).map(d => {
        const missing = Number(d?.missing ?? d?.missingSlots ?? d?.shortage ?? d?.missingCount ?? 0) || 0;
        const candidateCount = Number(d?.candidateCount ?? d?.validSlots ?? d?.availableCount ?? 0) || 0;
        const reasonSummary = Array.isArray(d?.reasonSummary)
          ? d.reasonSummary.slice(0, 4)
          : (Array.isArray(d?.topReasons)
            ? d.topReasons.slice(0, 4).map(r => `${r?.label || r?.code || "원인"} ${Number(r?.count || 0)}칸`).filter(Boolean)
            : []);
        return {
          key: String(d?.key || d?.id || d?.ttcardId || ""),
          name: String(d?.name || d?.title || ""),
          summary: String(d?.summary || ""),
          requiredCredits: Number(d?.requiredCredits ?? d?.required ?? 0) || 0,
          placedSlots: Number(d?.placedSlots ?? d?.placed ?? 0) || 0,
          missing,
          candidateCount,
          reasonSummary,
          suggestions: Array.isArray(d?.suggestions) ? d.suggestions.slice(0, 3).map(formatDiagnosticSuggestion).filter(Boolean) : []
        };
      }) : [],
      residualPuzzleReport: compactResidualPuzzle(stripStaleResidualPuzzleReport(meta.residualPuzzleReport)),
      validatorVersion: String(meta.validatorVersion || "2026-07-15-room-availability-separation-r355"),
      experimentalResidualRepairEnabled: meta.experimentalResidualRepairEnabled === true,
      experimentalResidualRepairSkipped: meta.experimentalResidualRepairSkipped === true,
      experimentalResidualRepairSkipReason: String(meta.experimentalResidualRepairSkipReason || "")
    };
  }

  function extractAutoAssignMetricEvidence(version = {}) {
    const meta = version?.autoAssignMeta || {};
    const text = [version?.note, meta.validationSummary, meta.qualityBaselineValidationSummary].map(v => String(v || "")).join(" / ");
    const n = value => Number.isFinite(Number(value)) ? Number(value) : 0;
    const pick = (...values) => {
      for (const value of values) {
        if (Number.isFinite(Number(value))) return Number(value);
      }
      return 0;
    };
    const matchNum = regex => Number((text.match(regex) || [0, ""])[1]) || 0;
    const hasMetaObject = !!(meta && typeof meta === "object" && Object.keys(meta).length);
    const hasFinalMetrics = !!(meta.finalMetrics && typeof meta.finalMetrics === "object");
    const metricCompleteness = String(meta.metricCompleteness || "").trim();
    const validationSummary = String(meta.validationSummary || "").trim();
    const hasCardTextEvidence = /카드\s*시수\s*\d+개/.test(text);
    const hasGroupTextEvidence = /그룹\/개별\s*\d+개/.test(text);
    const hasFailedTextEvidence = /미배치\s*\d+개/.test(text);
    const hasClassTextEvidence = /학급\s*시수\s*\d+개/.test(text) || /검증\s*통과/.test(text);
    // r33: state.js가 예전 자동배치 보관본을 압축하면서 없는 metric 필드를 0으로 채운 경우가 있습니다.
    // 그런 0값 필드는 증거가 아닙니다. finalMetrics, metricCompleteness=complete, 또는 note/summary의 명시 문장만 현대 메타로 인정합니다.
    const modernMetricEvidence = hasFinalMetrics || metricCompleteness === "complete" || (!!validationSummary && hasCardTextEvidence && hasGroupTextEvidence && hasClassTextEvidence);
    const hasCardEvidence = modernMetricEvidence && (hasFinalMetrics
      || metricCompleteness === "complete"
      || Object.prototype.hasOwnProperty.call(meta, "cardCoverageIssueCount")
      || Object.prototype.hasOwnProperty.call(meta, "cardShortageSlots")
      || hasCardTextEvidence);
    const hasGroupEvidence = modernMetricEvidence && (hasFinalMetrics
      || metricCompleteness === "complete"
      || Object.prototype.hasOwnProperty.call(meta, "groupCoverageIssueCount")
      || hasGroupTextEvidence);
    const hasFailedEvidence = modernMetricEvidence && (hasFinalMetrics
      || metricCompleteness === "complete"
      || Object.prototype.hasOwnProperty.call(meta, "failedCount")
      || Object.prototype.hasOwnProperty.call(meta, "failedUnitCount")
      || hasFailedTextEvidence);
    const hasClassEvidence = modernMetricEvidence && (hasFinalMetrics
      || metricCompleteness === "complete"
      || Object.prototype.hasOwnProperty.call(meta, "classSlotIssueCount")
      || Object.prototype.hasOwnProperty.call(meta, "classIssueCount")
      || hasClassTextEvidence);

    const cardCoverageIssueCount = pick(meta.finalMetrics?.cardCoverageIssueCount, meta.cardCoverageIssueCount, matchNum(/카드\s*시수\s*(\d+)개/));
    const groupCoverageIssueCount = pick(meta.finalMetrics?.groupCoverageIssueCount, meta.groupCoverageIssueCount, matchNum(/그룹\/개별\s*(\d+)개/));
    const classSlotIssueCount = pick(meta.finalMetrics?.classSlotIssueCount, meta.classSlotIssueCount, meta.classIssueCount, matchNum(/학급\s*시수\s*(\d+)개/));
    const failedCount = pick(meta.finalMetrics?.failedCount, meta.failedCount, meta.failedUnitCount, matchNum(/미배치\s*(\d+)개/));
    const cardShortageSlots = pick(meta.finalMetrics?.cardShortageSlots, meta.cardShortageSlots, cardCoverageIssueCount ? cardCoverageIssueCount : 0);
    const restrictedTeacherIssueCount = pick(meta.finalMetrics?.restrictedTeacherIssueCount, meta.restrictedTeacherIssueCount);
    const missingRoomCount = pick(meta.finalMetrics?.missingRoomCount, meta.missingRoomCount);
    const protectedIntrusionCount = pick(meta.finalMetrics?.protectedIntrusionCount, meta.protectedIntrusionCount);
    const complete = !!(hasMetaObject && modernMetricEvidence && hasClassEvidence && hasCardEvidence && hasGroupEvidence && hasFailedEvidence);
    const legacyPartial = !complete && /자동배치/.test(String(version?.name || ""));
    return {
      complete,
      legacyPartial,
      hasFinalMetrics,
      metricCompleteness,
      validationSummary,
      modernMetricEvidence,
      hasClassEvidence,
      hasCardEvidence,
      hasGroupEvidence,
      hasFailedEvidence,
      classSlotIssueCount,
      cardCoverageIssueCount,
      groupCoverageIssueCount,
      failedCount,
      cardShortageSlots,
      restrictedTeacherIssueCount,
      missingRoomCount,
      protectedIntrusionCount,
      qualityScore: Number.isFinite(Number(meta.finalMetrics?.qualityScore)) ? Number(meta.finalMetrics.qualityScore) : Infinity
    };
  }

  function hasCompleteAutoAssignMetricEvidence(version = {}) {
    return extractAutoAssignMetricEvidence(version).complete;
  }

  function snapshotQualityScoreForPrune(v = {}) {
    const evidence = extractAutoAssignMetricEvidence(v);
    const n = x => Number.isFinite(Number(x)) ? Number(x) : 0;
    const incompletePenalty = evidence.complete ? 0 : 900000000;
    return incompletePenalty
      + evidence.cardShortageSlots * 100000
      + evidence.cardCoverageIssueCount * 30000
      + evidence.groupCoverageIssueCount * 12000
      + evidence.classSlotIssueCount * 4000
      + evidence.failedCount * 1000
      + evidence.restrictedTeacherIssueCount * 250
      + evidence.missingRoomCount * 500
      + evidence.protectedIntrusionCount * 500
      - n(v.entryCount) / 1000;
  }

  function compactBestAutoAssignSnapshot(version = {}) {
    if (!version || !Array.isArray(version.entries) || !version.entries.length) return null;
    return {
      id: version.id || uid("ttv_auto_best"),
      name: version.name || "자동배치 최고 결과",
      note: version.note || "자동배치 최고 품질 보관본입니다.",
      createdAt: version.createdAt || new Date().toISOString(),
      updatedAt: version.updatedAt || new Date().toISOString(),
      periodCount: Math.max(1, Number(version.periodCount || ttConfig()?.periodCount || 7)),
      entryCount: Number(version.entryCount || version.entries.length || 0),
      autoSnapshot: true,
      snapshotKind: "result",
      source: "autoassign-best",
      autoSourceSignature: compactAutoSourceSignature(version.autoSourceSignature || version.autoAssignMeta?.autoSourceSignature || ""),
      autoSourceSummary: version.autoSourceSummary || version.autoAssignMeta?.autoSourceSummary || "",
      autoAssignMeta: compactAutoAssignSnapshotMeta(version.autoAssignMeta || {}),
      entries: normalizeSnapshotEntries(version.entries || [])
    };
  }

  function bestSnapshotQualityScore(version = {}) {
    if (!version || !Array.isArray(version.entries) || !version.entries.length) return Infinity;
    return snapshotQualityScoreForPrune(version);
  }

  function stableAutoSourceStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableAutoSourceStringify).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableAutoSourceStringify(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value ?? null);
  }

  function autoSourceTinyHash(text = "") {
    // FNV-1a 32bit, deterministic and synchronous.
    let hash = 2166136261;
    const str = String(text || "");
    for (let i = 0; i < str.length; i += 1) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function compactAutoSourceSignature(value = "") {
    const text = String(value || "");
    if (!text) return "";
    if (text.startsWith("sig:")) return text;
    return `sig:${text.length}:${autoSourceTinyHash(text)}`;
  }

  function isManualAutoAssignExcludedCard(card = {}) {
    const id = String(card?.id || "");
    const tpl = String(card?.templateId || "");
    const isManual = card?.isManual === true || id.startsWith("ttc_manual") || tpl.startsWith("manual_");
    if (!isManual) return false;
    return card.autoAssignExcluded === true || card.manualAutoAssign === false || String(card.manualCardStatus || "").trim() === "stored";
  }

  function buildCurrentAutoSourceSignature() {
    const cardIdsInGroups = new Set();
    const groups = (ttGroups() || []).map(group => {
      const units = (group.units || []).map(unit => {
        const ttcardIds = (unit.ttcardIds || []).map(id => String(id || "")).filter(Boolean).sort();
        ttcardIds.forEach(id => cardIdsInGroups.add(id));
        return {
          id: String(unit.id || ""),
          name: String(unit.name || ""),
          ttcardIds,
          templateIds: (unit.templateIds || []).map(id => String(id || "")).filter(Boolean).sort()
        };
      }).sort((a, b) => stableAutoSourceStringify(a).localeCompare(stableAutoSourceStringify(b)));
      (group.poolCardIds || []).forEach(id => cardIdsInGroups.add(String(id || "")));
      (group.excludedCardIds || []).forEach(id => cardIdsInGroups.add(String(id || "")));
      return {
        id: String(group.id || ""),
        name: String(group.name || group.groupName || ""),
        groupType: String(group.groupType || ""),
        isConcurrent: group.isConcurrent === true,
        isCrossGrade: group.isCrossGrade === true,
        units,
        poolCardIds: (group.poolCardIds || []).map(id => String(id || "")).filter(Boolean).sort(),
        excludedCardIds: (group.excludedCardIds || []).map(id => String(id || "")).filter(Boolean).sort(),
        linkedGroupId: String(group.linkedGroupId || "")
      };
    }).sort((a, b) => String(a.id || a.name).localeCompare(String(b.id || b.name)));

    const cards = (ttDomain()?.ttcards || []).map(card => ({
      id: String(card.id || ""),
      templateId: String(card.templateId || ""),
      gradeKey: String(card.gradeKey || ""),
      sectionIdx: Number(card.sectionIdx ?? 0),
      credits: Math.max(0, Number(card.credits ?? getCreditsForTtCard?.(card) ?? 0)),
      classKeys: (card.classKeys || []).map(x => String(x || "")).filter(Boolean).sort(),
      studentKeys: (card.studentKeys || []).map(x => String(x || "")).filter(Boolean).sort(),
      teachers: getTeachersForTtCard(card).map(x => String(x || "")).filter(Boolean).sort(),
      isWholeGrade: card.isWholeGrade === true,
      isManual: card.isManual === true || String(card.id || "").startsWith("ttc_manual"),
      manualCardStatus: String(card.manualCardStatus || ""),
      manualAutoAssign: card.manualAutoAssign !== false,
      autoAssignExcluded: card.autoAssignExcluded === true || isManualAutoAssignExcludedCard(card),
      groupIds: [...new Set((ttGroups() || [])
        .filter(group => {
          const ids = [
            ...(group.poolCardIds || []),
            ...(group.excludedCardIds || []),
            ...(group.units || []).flatMap(unit => unit.ttcardIds || [])
          ].map(id => String(id || ""));
          return ids.includes(String(card.id || ""));
        })
        .map(group => String(group.id || ""))
        .filter(Boolean))].sort()
    })).sort((a, b) => String(a.id).localeCompare(String(b.id)));

    return compactAutoSourceSignature(stableAutoSourceStringify({
      schema: "auto-source-signature-r54",
      periodCount: Math.max(1, Number(ttConfig()?.periodCount || 7)),
      cardCount: cards.length,
      groupCount: groups.length,
      cards,
      groups
    }));
  }

  function currentAutoSourceSummary() {
    const cards = ttDomain()?.ttcards || [];
    const cardCount = cards.length;
    const groupCount = (ttGroups() || []).length;
    const manualCards = cards.filter(card => card?.isManual === true || String(card?.id || "").startsWith("ttc_manual"));
    const manualCount = manualCards.length;
    const manualExcluded = manualCards.filter(isManualAutoAssignExcludedCard).length;
    return `카드 ${cardCount}개 · 그룹 ${groupCount}개${manualCount ? ` · 수동카드 ${manualCount}개(제외 ${manualExcluded}개)` : ""}`;
  }

  function autoSourceSignatureForSnapshot(version = {}) {
    return compactAutoSourceSignature(version?.autoSourceSignature || version?.autoAssignMeta?.autoSourceSignature || version?.autoAssignMeta?.sourceSignature || "");
  }

  function snapshotMatchesCurrentAutoSource(version = {}) {
    if (!version || !Array.isArray(version.entries) || !version.entries.length) return false;
    const snapshotSignature = autoSourceSignatureForSnapshot(version);
    if (!snapshotSignature) return false;
    return snapshotSignature === buildCurrentAutoSourceSignature();
  }

  function updateBestAutoAssignSnapshot(domain, version = {}) {
    if (!domain || !version || !Array.isArray(version.entries) || !version.entries.length) return null;
    if (!hasCompleteAutoAssignMetricEvidence(version)) return compactBestAutoAssignSnapshot(domain.bestAutoAssignSnapshot || null);
    const candidate = compactBestAutoAssignSnapshot(version);
    if (!candidate) return null;
    const currentRaw = domain.bestAutoAssignSnapshot || null;
    const current = (hasCompleteAutoAssignMetricEvidence(currentRaw) && snapshotMatchesCurrentAutoSource(currentRaw)) ? compactBestAutoAssignSnapshot(currentRaw) : null;
    if (!current || bestSnapshotQualityScore(candidate) < bestSnapshotQualityScore(current)) {
      candidate.name = candidate.name || "자동배치 최고 결과";
      candidate.bestSnapshot = true;
      candidate.source = "autoassign-best";
      domain.bestAutoAssignSnapshot = candidate;
      return candidate;
    }
    domain.bestAutoAssignSnapshot = current;
    return current;
  }

  function ensureBestAutoAssignSnapshot(domain) {
    if (!domain) return null;
    const savedBest = Array.isArray(domain.savedSchedules)
      ? domain.savedSchedules
          .filter(v => v && Array.isArray(v.entries) && v.entries.length)
          .filter(v => String(v.snapshotKind || "") === "result" || String(v.name || "").includes("자동배치 결과"))
          .filter(hasCompleteAutoAssignMetricEvidence)
          .filter(snapshotMatchesCurrentAutoSource)
          .sort((a, b) => bestSnapshotQualityScore(a) - bestSnapshotQualityScore(b))[0]
      : null;
    if (savedBest) updateBestAutoAssignSnapshot(domain, savedBest);
    if (domain.bestAutoAssignSnapshot
      && hasCompleteAutoAssignMetricEvidence(domain.bestAutoAssignSnapshot)
      && snapshotMatchesCurrentAutoSource(domain.bestAutoAssignSnapshot)
      && Array.isArray(domain.bestAutoAssignSnapshot.entries)
      && domain.bestAutoAssignSnapshot.entries.length) {
      domain.bestAutoAssignSnapshot = compactBestAutoAssignSnapshot(domain.bestAutoAssignSnapshot);
      return domain.bestAutoAssignSnapshot;
    }
    return null;
  }

  function pruneAutoAssignSnapshots(domain) {
    if (!domain || !Array.isArray(domain.savedSchedules)) return;
    const bestSnapshot = ensureBestAutoAssignSnapshot(domain);
    const all = domain.savedSchedules.filter(v => v && Array.isArray(v.entries) && v.entries.length);
    const isAuto = v => v.autoSnapshot === true || String(v.source || "") === "autoassign" || String(v.source || "") === "autoassign-best" || String(v.name || "").startsWith("자동배치 ");
    const isBefore = v => String(v.snapshotKind || "") === "before" || String(v.name || "").startsWith("자동배치 전");
    const time = v => Date.parse(v.updatedAt || v.createdAt || 0) || 0;
    const byId = new Map();
    const add = v => { if (v && !byId.has(v.id)) byId.set(v.id, { ...v, autoAssignMeta: compactAutoAssignSnapshotMeta(v.autoAssignMeta || {}) }); };
    const auto = all.filter(isAuto);
    const after = auto.filter(v => !isBefore(v));
    const before = auto.filter(isBefore);
    const manual = all.filter(v => !isAuto(v));
    if (bestSnapshot) add(bestSnapshot);
    after.slice().filter(hasCompleteAutoAssignMetricEvidence).sort((a,b) => snapshotQualityScoreForPrune(a) - snapshotQualityScoreForPrune(b)).slice(0, 1).forEach(add);
    after.slice().sort((a,b) => time(b) - time(a)).slice(0, 4).forEach(add);
    before.slice().sort((a,b) => time(b) - time(a)).slice(0, 1).forEach(add);
    manual.slice().sort((a,b) => time(b) - time(a)).slice(0, 2).forEach(add);
    domain.savedSchedules = [...byId.values()].sort((a,b) => time(b) - time(a)).slice(0, 6);
  }


  function autoEntrySignature(entry = {}) {
    const classKeys = Array.isArray(entry.audienceClassKeys) && entry.audienceClassKeys.length
      ? entry.audienceClassKeys
      : (Array.isArray(entry.classKeys) ? entry.classKeys : []);
    const cardIds = Array.isArray(entry.ttcardIds) && entry.ttcardIds.length
      ? entry.ttcardIds
      : [entry.ttcardId || entry.templateId || ""].filter(Boolean);
    return [
      String(entry.id || ""),
      String(entry.day || ""),
      String(entry.period || ""),
      String(entry.groupId || ""),
      cardIds.slice().map(x => String(x || "")).sort().join("+"),
      classKeys.slice().map(x => String(x || "")).sort().join("+"),
      String(entry.teacherName || entry.teacher || ""),
      String(entry.roomId || "")
    ].join("|");
  }

  function sameAutoEntrySet(a = [], b = []) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    const aa = a.map(autoEntrySignature).sort();
    const bb = b.map(autoEntrySignature).sort();
    for (let i = 0; i < aa.length; i += 1) if (aa[i] !== bb[i]) return false;
    return true;
  }

  function attachCanonicalMetaToMatchingSnapshots(domain, canonicalMeta = {}, canonicalEntries = []) {
    if (!domain || !canonicalMeta || typeof canonicalMeta !== "object" || !Array.isArray(canonicalEntries) || !canonicalEntries.length) return;
    const compact = compactAutoAssignSnapshotMeta({
      ...canonicalMeta,
      schemaVersion: canonicalMeta.schemaVersion || "2026-07-15-room-availability-separation-r355",
      metricCompleteness: canonicalMeta.metricCompleteness || "complete",
      metricSource: canonicalMeta.metricSource || "canonicalEvaluation"
    });
    const apply = snapshot => {
      if (!snapshot || !Array.isArray(snapshot.entries) || !snapshot.entries.length) return false;
      if (!sameAutoEntrySet(snapshot.entries, canonicalEntries)) return false;
      snapshot.autoAssignMeta = compact;
      snapshot.entryCount = snapshot.entries.length;
      snapshot.updatedAt = new Date().toISOString();
      snapshot.note = [
        "자동 생성된 배치 보관본입니다.",
        formatAutoActiveGrades(canonicalMeta.activeGrades) ? `대상: ${formatAutoActiveGrades(canonicalMeta.activeGrades)}` : "",
        canonicalMeta.placementModeLabel || canonicalMeta.modeText ? `방식: ${canonicalMeta.placementModeLabel || canonicalMeta.modeText}` : "",
        compact.validationSummary ? `검증: ${compact.validationSummary}` : ""
      ].filter(Boolean).join(" / ");
      return true;
    };
    if (domain.bestAutoAssignSnapshot) apply(domain.bestAutoAssignSnapshot);
    if (Array.isArray(domain.savedSchedules)) {
      domain.savedSchedules.forEach(snapshot => apply(snapshot));
    }
  }

  function saveAutoAssignScheduleSnapshot(kind, sourceEntries = [], meta = {}) {
    const snapshotEntries = normalizeSnapshotEntries(sourceEntries);
    if (!snapshotEntries.length) return null;

    const domain = ttDomain();
    if (!Array.isArray(domain.savedSchedules)) domain.savedSchedules = [];

    const now = new Date();
    const modeLabel = meta.modeText || (meta.options?.placementMode === "keep" ? "현재 배치 유지" : "초기화 후 배치");
    const grades = formatAutoActiveGrades(meta.activeGrades);
    const label = kind === "before" ? "자동배치 전" : "자동배치 결과";
    const version = {
      id: uid(`ttv_auto_${kind}`),
      name: `${label} ${formatAutoSnapshotTime(now)}`,
      note: [
        "자동 생성된 배치 보관본입니다.",
        grades ? `대상: ${grades}` : "",
        modeLabel ? `방식: ${modeLabel}` : "",
        meta.validationSummary ? `검증: ${meta.validationSummary}` : ""
      ].filter(Boolean).join(" / "),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      periodCount: Math.max(1, Number(ttConfig()?.periodCount || 7)),
      entryCount: snapshotEntries.length,
      autoSnapshot: true,
      snapshotKind: kind,
      source: "autoassign",
      autoSourceSignature: buildCurrentAutoSourceSignature(),
      autoSourceSummary: currentAutoSourceSummary(),
      autoAssignMeta: compactAutoAssignSnapshotMeta({
        ...(meta || {}),
        autoSourceSignature: buildCurrentAutoSourceSignature(),
        autoSourceSummary: currentAutoSourceSummary()
      }),
      cardGenerationMeta: appState.timetable?.cardGenerationMeta ? cloneAutoAssignData(appState.timetable.cardGenerationMeta) : null,
      entries: snapshotEntries,
    };

    // 저장 실패 방지: 자동배치 보관본은 entries가 커서 Firestore 문서/localStorage 한도를 쉽게 넘습니다.
    // r31: 자동배치 결과 중 최고 품질 보관본은 savedSchedules 정리와 별개로 별도 보존합니다.
    if (kind === "result") updateBestAutoAssignSnapshot(domain, version);
    domain.savedSchedules = [version, ...(domain.savedSchedules || [])];
    pruneAutoAssignSnapshots(domain);
    return domain.savedSchedules.find(v => v.id === version.id) || version;
  }

  // ── Restricted-teacher helpers ─────────────────────────────────
  // 시간강사/육아단축/제한근무 교사는 자동배치에서 고정 수업 다음 우선순위로 다룹니다.
  const RESTRICTED_WORK_TYPES = new Set(["parttime", "childcare", "restricted", "other"]);
  const normalizeWorkType = value => RESTRICTED_WORK_TYPES.has(String(value || "")) ? String(value || "") : (String(value || "") === "fulltime" ? "fulltime" : "fulltime");
  const isRestrictedTeacher = teacher => {
    const name = String(teacher || "").trim();
    if (!name) return false;
    const c = constraints()?.[name];
    if (!c) return false;
    return c.isRestrictedWork === true || RESTRICTED_WORK_TYPES.has(normalizeWorkType(c.workType));
  };
  const normalizeTeacherNameList = value => {
    const raw = Array.isArray(value) ? value : [value];
    return [...new Set(raw.flatMap(v => splitTeacherNames(v || "")).map(t => String(t || "").trim()).filter(Boolean))];
  };

  const getTeacherNamesFromCards = cards => [...new Set((cards || []).flatMap(card => [
    ...(Array.isArray(card?.teachers) ? card.teachers.flatMap(t => splitTeacherNames(t)) : []),
    ...splitTeacherNames(card?.teacherName || "")
  ]).map(t => String(t || "").trim()).filter(Boolean))];

  const TEACHER_ROLE_HARD_KEYS = [
    "hardTeachers", "hardTeacherNames", "primaryTeachers", "primaryTeacherNames",
    "requiredTeachers", "requiredTeacherNames", "exclusiveTeachers", "exclusiveTeacherNames",
    "collisionTeachers", "collisionTeacherNames"
  ];
  const TEACHER_ROLE_NON_EXCLUSIVE_KEYS = [
    "nonExclusiveTeachers", "nonExclusiveTeacherNames", "supportTeachers", "supportTeacherNames",
    "coTeachers", "coTeacherNames", "assistantTeachers", "assistantTeacherNames",
    "displayOnlyTeachers", "displayOnlyTeacherNames"
  ];

  const teacherRoleOverrideSources = () => [
    ttDomain()?.teacherRoleOverrides,
    ttDomain()?.teacherRoles,
    globalThis.HIS_TEACHER_ROLE_OVERRIDES,
    { nonExclusiveTeachers: globalThis.HIS_NON_EXCLUSIVE_TEACHERS, hardTeachers: globalThis.HIS_HARD_TEACHERS }
  ].filter(src => src && typeof src === "object");

  function teacherRoleLookupKeys(x = {}) {
    const keys = new Set();
    [x.id, x.ttcardId, x.templateId, x.compoundParentTemplateId, x.subject, x.name, x.title, x.nameKo, x.nameEn, x.teacherName].forEach(v => {
      const s = String(v || "").trim();
      if (s) keys.add(s);
    });
    ttCardIdsFromPlacement(x).forEach(id => {
      const card = getTtCardById(id);
      [id, card?.id, card?.templateId, card?.subject, card?.name, card?.title, card?.nameKo, card?.nameEn].forEach(v => {
        const s = String(v || "").trim();
        if (s) keys.add(s);
      });
    });
    return [...keys];
  }

  function teacherRoleOverrideList(x = {}, mode = "hard") {
    const keys = teacherRoleLookupKeys(x);
    const directKeys = mode === "hard" ? TEACHER_ROLE_HARD_KEYS : TEACHER_ROLE_NON_EXCLUSIVE_KEYS;
    const bucketKeys = mode === "hard" ? ["hardTeachers", "primaryTeachers", "requiredTeachers", "exclusiveTeachers"] : ["nonExclusiveTeachers", "supportTeachers", "coTeachers", "displayOnlyTeachers"];
    const names = [];
    const collect = value => names.push(...normalizeTeacherNameList(value));
    for (const src of teacherRoleOverrideSources()) {
      directKeys.forEach(k => collect(src?.[k]));
      for (const bucketKey of bucketKeys) {
        const bucket = src?.[bucketKey];
        if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) continue;
        keys.forEach(k => collect(bucket[k]));
      }
      keys.forEach(k => {
        const item = src?.[k];
        if (!item || typeof item !== "object") return;
        directKeys.forEach(dk => collect(item[dk]));
      });
    }
    return [...new Set(names.map(t => String(t || "").trim()).filter(Boolean))];
  }

  function allTeacherNamesForPlacement(x = {}) {
    const cardIds = ttCardIdsFromPlacement(x);
    const cards = Array.isArray(x?.ttcards) && x.ttcards.length ? x.ttcards : cardIds.map(id => getTtCardById(id)).filter(Boolean);
    const names = [
      ...(Array.isArray(x?.teachers) ? x.teachers.flatMap(t => splitTeacherNames(t)) : []),
      ...splitTeacherNames(x?.teacherName || ""),
      ...getTeacherNamesFromCards(cards)
    ];
    return [...new Set(names.map(t => String(t || "").trim()).filter(Boolean))];
  }

  function hardTeacherNamesForPlacement(x = {}) {
    // r47: 다중교사 카드의 표시용 교사와 실제 시간 점유 교사를 분리할 수 있게 합니다.
    // 기존 데이터는 그대로 두면 지금처럼 모든 교사를 hard 제약으로 봅니다(완전 하위호환).
    // 단, 카드/템플릿/전역 override에 primaryTeachers 또는 nonExclusiveTeachers가 있으면
    // 자동배정·충돌검사는 hard 교사만 사용합니다.
    const all = allTeacherNamesForPlacement(x);
    const explicitHard = teacherRoleOverrideList(x, "hard");
    if (explicitHard.length) return explicitHard.filter(t => all.includes(t) || !all.length);
    const soft = new Set(teacherRoleOverrideList(x, "nonExclusive"));
    if (!soft.size) return all;
    const hard = all.filter(t => !soft.has(t));
    // r49: 전원이 공동교사(soft)로 빠지면 그 카드는 시간충돌 보호를 잃습니다.
    // 단독 수업이 무방비로 이중배정되는 것을 막기 위해, hard가 0명이면 전원 hard로 폴백합니다.
    return hard.length ? hard : all;
  }

  const getTeachersForAutoItem = item => hardTeacherNamesForPlacement(item);
  const getRestrictedTeachersForAutoItem = item => getTeachersForAutoItem(item).filter(isRestrictedTeacher);

  function autoItemGradeNumbers(item = {}) {
    const nums = new Set();
    const add = value => {
      const m = String(value || "").match(/(\d{1,2})/);
      if (m) nums.add(Number(m[1]));
    };
    add(item.gradeKey);
    (item.gradeKeys || []).forEach(add);
    (item.ttcards || []).forEach(card => {
      add(card?.gradeKey);
      (card?.gradeKeys || []).forEach(add);
      (card?.classKeys || card?.audienceClassKeys || []).forEach(add);
      (card?.classLabels || []).forEach(add);
    });
    ttCardIdsFromPlacement(item).forEach(id => {
      const card = getTtCardById(id);
      if (!card) return;
      add(card.gradeKey);
      (card.gradeKeys || []).forEach(add);
      (card.classKeys || card.audienceClassKeys || []).forEach(add);
      (card.classLabels || []).forEach(add);
    });
    (item.classKeys || item.audienceClassKeys || []).forEach(add);
    (item.classLabels || []).forEach(add);
    return [...nums].sort((a, b) => a - b);
  }

  function autoItemBottleneckText(item = {}) {
    const parts = [
      getAutoItemName(item),
      item.subject, item.name, item.title, item.nameKo, item.nameEn,
      item.group, item.groupName, item.track, item.label,
      item.templateId ? getTemplateCardTitle(getTemplateById(item.templateId)) : ""
    ];
    (item.ttcards || []).forEach(card => parts.push(
      card?.subject, card?.name, card?.title, card?.nameKo, card?.nameEn,
      card?.group, card?.groupName, card?.track, card ? describeTtCard(card).title : ""
    ));
    ttCardIdsFromPlacement(item).forEach(id => {
      const card = getTtCardById(id);
      if (card) parts.push(card.subject, card.name, card.title, card.nameKo, card.nameEn, card.group, card.groupName, card.track, describeTtCard(card).title);
    });
    return parts.map(v => String(v || "")).filter(Boolean).join(" ");
  }

  function getBottleneckAutoItemRank(item = {}) {
    const text = autoItemBottleneckText(item);
    const textLower = text.toLowerCase();
    const classCount = new Set(classKeysForCapacity(item)).size;
    const teacherCount = new Set(getTeachersForAutoItem(item)).size;
    const grades = autoItemGradeNumbers(item);
    const maxGrade = grades.length ? Math.max(...grades) : 0;

    // 큰 동시수업과 희소카드는 후보가 소진되기 전에 먼저 배치합니다.
    // 외부 시간표 데이터에 의존하지 않고 내부 제약도와 후보 수를 기준으로 보호합니다.
    if (classCount >= 3 && /(11\s*체육|체육|sports|physical\s*education|\bpe\b)/i.test(text)) return 0;
    if (classCount >= 3 && /(섬김|리더십|leadership|servant|transformational)/i.test(text)) return 1;
    if (classCount >= 3 && /(채플|chapel|자율|동아리|club|ca\b|sa\b)/i.test(text)) return 2;
    if (classCount >= 3 && /(국어|한국어|korean)/i.test(text)) return 3;
    if (classCount >= 3 && /(영어|english)/i.test(text)) return 4;
    if (classCount >= 3 && /(수학|math|algebra|calculus|geometry|statistics)/i.test(text)) return 5;
    if (classCount >= 3) return 6;

    // 12학년 영어처럼 단일반 카드라도 특정 교사·학년의 시수가 촘촘한 카드는 후순위로 밀리면 마지막 1시수가 남습니다.
    if (maxGrade >= 12 && /(영어\s*독해|english\s*12|english)/i.test(textLower)) return 20;
    if (maxGrade >= 11 && /(체육|sports|physical\s*education|\bpe\b|리더십|leadership)/i.test(textLower)) return 21;
    if (teacherCount >= 2 && classCount >= 2) return 30;
    return 99;
  }

  function getBottleneckAutoItemPriority(item = {}) {
    const rank = getBottleneckAutoItemRank(item);
    if (rank >= 99) return 0;
    const classCount = new Set(classKeysForCapacity(item)).size;
    const teacherCount = new Set(getTeachersForAutoItem(item)).size;
    const difficulty = getAutoItemDifficulty(item);
    return 60000 - rank * 1800 + classCount * 650 + teacherCount * 420 + difficulty;
  }

  function excludedGroupsForAutoItem(item = {}) {
    const cardIds = ttCardIdsFromPlacement(item).filter(Boolean);
    if (!cardIds.length) return [];
    const idSet = new Set(cardIds);
    return ttGroups().filter(group => (group?.excludedCardIds || []).some(cardId => idSet.has(cardId)));
  }

  function excludedCardPriorityForAutoItem(item = {}) {
    const groups = excludedGroupsForAutoItem(item);
    if (!groups.length) return 0;
    const itemText = normalizeSubjectTextForScoring(item);
    let score = 9000 + getAutoItemDifficulty(item) * 10;
    groups.forEach(group => {
      const text = [group.name, group.label, group.groupName, itemText].filter(Boolean).join(" ");
      if (/HS\s*국어|고등\s*국어/i.test(text)) score += 26000;
      else if (/MS\s*국어|중등\s*국어/i.test(text)) score += 23000;
      else if (/국어|한국어|Korean/i.test(text)) score += 20000;
      else if (/영어|English/i.test(text)) score += 16000;
      else if (/수학|Math|Algebra|Calculus|Geometry|Statistics/i.test(text)) score += 14000;
      else if (/사회|History|Social/i.test(text)) score += 12000;
      if (/선택/.test(text)) score += 7000;
      if (group.isConcurrent || group.groupType === "concurrent") score += 5000;
    });
    return score;
  }

  const annotateRestrictedAutoItem = item => {
    const restrictedTeachers = getRestrictedTeachersForAutoItem(item);
    const excludedGroups = excludedGroupsForAutoItem(item);
    const excludedGroupPriority = excludedCardPriorityForAutoItem(item);
    const bottleneckRank = getBottleneckAutoItemRank(item);
    const bottleneckPriority = getBottleneckAutoItemPriority(item);
    const hasBottleneckPriority = bottleneckRank < 99;
    return {
      ...item,
      hasRestrictedTeacher: restrictedTeachers.length > 0,
      restrictedTeachers,
      excludedGroupIds: excludedGroups.map(group => group.id).filter(Boolean),
      excludedGroupNames: excludedGroups.map(group => group.name || group.groupName || group.label || group.id).filter(Boolean),
      isExcludedGroupFollowup: excludedGroupPriority > 0,
      excludedGroupPriority,
      hasBottleneckPriority,
      bottleneckRank,
      bottleneckPriority,
      // 0은 큰 동시수업/전체학급 병목, 1은 그룹 후속 필수카드/제약근무/단일반 희소카드, 2는 일반 대상입니다.
      priorityTier: hasBottleneckPriority && bottleneckRank <= 10
        ? 0
        : (excludedGroupPriority > 0 || restrictedTeachers.length > 0 || bottleneckPriority > 0 ? 1 : 2)
    };
  };

  function groupBlockPriorityText(block = {}) {
    const group = block?.group || {};
    const cards = (block?.unitItems || []).flatMap(u => u.ttcards || []).filter(Boolean);
    return [
      group.name, group.label, group.groupName,
      ...cards.map(c => [c.subject, c.label, c.groupName, c.track, c.group, c.nameKo, c.nameEn].filter(Boolean).join(" "))
    ].filter(Boolean).join(" ");
  }

  function getStructuralGroupRank(block = {}) {
    const group = block?.group || {};
    const isConcurrent = group.isConcurrent || group.groupType === "concurrent";
    if (!isConcurrent) return 99;
    const text = groupBlockPriorityText(block);
    const cards = (block?.unitItems || []).flatMap(u => u.ttcards || []).filter(Boolean);
    const classCount = new Set(cards.flatMap(c => c.classKeys || c.audienceClassKeys || []).filter(Boolean)).size;
    const teacherCount = new Set(getTeacherNamesFromCards(cards)).size;

    // 실제 HIS 시간표에서 먼저 자리를 잡아야 하는 뼈대 그룹입니다.
    // 선택묶음보다 전체학급·대형 동시수업을 늦게 배치하면 후보가 급격히 줄어듭니다.
    // 외부 결과를 복사하지 않고 병목 그룹 우선순위만 내부 규칙으로 계산합니다.
    if (/HS\s*국어|고등\s*국어/i.test(text)) return 0;
    if (classCount >= 3 && /(11\s*체육|체육|sports|physical\s*education|\bpe\b)/i.test(text)) return 1;
    if (classCount >= 3 && /(섬김|리더십|leadership|servant|transformational)/i.test(text)) return 2;
    if (/MS\s*국어|중등\s*국어/i.test(text)) return 3;
    if (/국어|한국어|Korean/i.test(text) && classCount >= 3) return 4;
    if (/채플|CA|SA|자율|동아리|Chapel|Club/i.test(text)) return 5;
    if (classCount >= 3 && /(영어|English)/i.test(text)) return 6;
    if (/선택/.test(text) && classCount >= 2) return 7;
    if (cards.length >= 4 || classCount >= 4 || teacherCount >= 4) return 8;
    return 99;
  }

  const annotateRestrictedGroupBlock = block => {
    const unitItems = (block?.unitItems || []).map(annotateRestrictedAutoItem);
    const normalized = { ...block, unitItems };
    const restrictedTeachers = [...new Set(unitItems.flatMap(u => u.restrictedTeachers || []))];
    const structuralRank = getStructuralGroupRank(normalized);
    const hasStructuralPriority = structuralRank < 99;
    return {
      ...normalized,
      hasRestrictedTeacher: restrictedTeachers.length > 0,
      restrictedTeachers,
      hasStructuralPriority,
      structuralRank,
      priorityTier: hasStructuralPriority ? 0 : (restrictedTeachers.length > 0 ? 1 : 2)
    };
  };
  const comparePriority = (a, b) => (Number(a?.priorityTier ?? 2) - Number(b?.priorityTier ?? 2));
  const describeRestrictedTeachers = names => {
    const list = [...new Set((names || []).filter(Boolean))];
    return list.length ? `제약교사: ${list.join(", ")}` : "";
  };

  // ── Auto-assign scoring preferences ────────────────────────────
  // 자동배치 품질 기준은 학교 운영 상황에 따라 달라지므로, 옵션 팝업에서
  // 필요한 항목만 중요도를 조절할 수 있도록 숫자 가중치로 통일합니다.
  const DEFAULT_SCORE_WEIGHTS = Object.freeze({
    classFill: 3,           // 학급별 월~금 전체 시수 채우기
    teacherGap: 2,          // 교사 공강 최소화
    sameSubjectDay: 2,      // 같은 과목 하루 반복 회피
    teacherConsecutive: 2   // 교사 연속수업 부담
  });

  const SCORE_PRESETS = Object.freeze({
    balanced:        { classFill:3, teacherGap:2, sameSubjectDay:2, teacherConsecutive:2 },
    teacherFriendly: { classFill:3, teacherGap:3, sameSubjectDay:1, teacherConsecutive:3 },
    studentFriendly: { classFill:3, teacherGap:1, sameSubjectDay:3, teacherConsecutive:1 }
  });

  function clampWeight(value, fallback = 1) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(3, Math.round(n)));
  }

  function normalizeScoreWeights(weights = {}) {
    const src = { ...DEFAULT_SCORE_WEIGHTS, ...(weights || {}) };
    return {
      classFill: clampWeight(src.classFill, DEFAULT_SCORE_WEIGHTS.classFill),
      teacherGap: clampWeight(src.teacherGap, DEFAULT_SCORE_WEIGHTS.teacherGap),
      sameSubjectDay: clampWeight(src.sameSubjectDay, DEFAULT_SCORE_WEIGHTS.sameSubjectDay),
      teacherConsecutive: clampWeight(src.teacherConsecutive, DEFAULT_SCORE_WEIGHTS.teacherConsecutive),
    };
  }

  function scoreOptionsFromAssignOptions(options = {}) {
    return normalizeScoreWeights(options.scoringWeights || options.scoreWeights || DEFAULT_SCORE_WEIGHTS);
  }

  function describeScoreWeights(weights = {}) {
    const w = normalizeScoreWeights(weights);
    const label = n => ["끔", "낮음", "보통", "높음"][clampWeight(n, 0)] || "보통";
    return `학급공강 ${label(w.classFill)} · 교사공강 ${label(w.teacherGap)} · 과목몰림 ${label(w.sameSubjectDay)} · 교사연속 ${label(w.teacherConsecutive)}`;
  }


  function cloneAutoAssignData(value) {
    try { return structuredClone(value); }
    catch (_) {
      try { return JSON.parse(JSON.stringify(value ?? null)); }
      catch (e) { return Array.isArray(value) ? [...value] : value; }
    }
  }

  const safeAutoHtml = value => String(value ?? "").replace(/[<>&"]/g, ch => ({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[ch]));


  // ── Teacher constraint load helpers ─────────────────────────────
  // 자동배치 후보 시간 계산에서는 교사 시수를 "entry 수"가 아니라
  // "요일·교시 슬롯 수"로 계산해야 합니다. 같은 동시배정 unit 안에서
  // 여러 entry가 만들어져도 교사는 같은 시간 1시수만 담당한 것으로 봅니다.
  const teacherEntryHasTeacher = (entry, teacher) => {
    const name = String(teacher || "").trim();
    if (!name || !entry) return false;
    const names = [
      ...splitTeacherNames(entry.teacherName || ""),
      ...(Array.isArray(entry.teachers) ? entry.teachers.flatMap(t => splitTeacherNames(t)) : [])
    ].map(t => String(t || "").trim()).filter(Boolean);
    return names.includes(name);
  };

  const teacherSlotKey = (day, period) => `${day}:${period}`;

  function getTeacherSlotSet(teacher, existing = [], dayFilter = null) {
    const slots = new Set();
    (existing || []).forEach(e => {
      if (!teacherEntryHasTeacher(e, teacher)) return;
      if (dayFilter != null && e.day !== dayFilter) return;
      if (!Number.isInteger(e.day) || !Number.isInteger(e.period)) return;
      slots.add(teacherSlotKey(e.day, e.period));
    });
    return slots;
  }

  function getTeacherWeekLoad(teacher, existing = []) {
    return getTeacherSlotSet(teacher, existing).size;
  }

  function getTeacherDayLoad(teacher, existing = [], day) {
    return getTeacherSlotSet(teacher, existing, day).size;
  }

  function getTeacherDayPeriods(teacher, existing = [], day) {
    return [...getTeacherSlotSet(teacher, existing, day)]
      .map(key => Number(String(key).split(":")[1]))
      .filter(n => Number.isInteger(n))
      .sort((a, b) => a - b);
  }

  function maxConsecutiveAfterAdding(teacher, existing = [], day, period) {
    const periods = getTeacherDayPeriods(teacher, existing, day);
    if (!periods.includes(period)) periods.push(period);
    periods.sort((a, b) => a - b);
    let maxC = periods.length ? 1 : 0;
    let cur = periods.length ? 1 : 0;
    for (let i = 1; i < periods.length; i++) {
      cur = periods[i] === periods[i - 1] + 1 ? cur + 1 : 1;
      maxC = Math.max(maxC, cur);
    }
    return maxC;
  }

  function teacherGapCountAfterAdding(teacher, existing = [], day, period) {
    const periods = getTeacherDayPeriods(teacher, existing, day);
    if (!periods.includes(period)) periods.push(period);
    const unique = [...new Set(periods)].sort((a, b) => a - b);
    if (unique.length <= 1) return 0;
    const span = unique[unique.length - 1] - unique[0] + 1;
    return Math.max(0, span - unique.length);
  }

  function getTeacherLimitState(teacher, slot, existing = []) {
    const c = constraints()?.[teacher] || {};
    const maxPerDay = Number(c.maxPerDay) || 0;
    const maxConsecutive = Number(c.maxConsecutive) || 0;
    const maxPerWeek = Number(c.maxPerWeek) || 0;
    const dayLoad = getTeacherDayLoad(teacher, existing, slot.day);
    const weekLoad = getTeacherWeekLoad(teacher, existing);
    const nextConsecutive = maxConsecutiveAfterAdding(teacher, existing, slot.day, slot.period);
    return {
      constraint: c,
      maxPerDay,
      maxConsecutive,
      maxPerWeek,
      dayLoad,
      weekLoad,
      nextConsecutive,
      wouldExceedDay: maxPerDay > 0 && dayLoad >= maxPerDay,
      wouldExceedWeek: maxPerWeek > 0 && weekLoad >= maxPerWeek,
      wouldExceedConsecutive: maxConsecutive > 0 && nextConsecutive > maxConsecutive,
    };
  }


  function isTeacherUnavailable(teacher, day, period) {
    const name = String(teacher || "").trim();
    if (!name) return false;
    const c = constraints()?.[name] || {};
    const slots = Array.isArray(c.unavailableSlots) ? c.unavailableSlots : [];
    const d = Number(day);
    const p = Number(period);
    return slots.some(slot => Number(slot?.day) === d && Number(slot?.period) === p);
  }

  function teacherLimitPenalty(teacher, slot, existing = []) {
    const s = getTeacherLimitState(teacher, slot, existing);
    let penalty = 0;
    if (s.maxPerWeek > 0) penalty += (s.weekLoad / s.maxPerWeek) * 30;
    if (s.maxPerDay > 0) penalty += (s.dayLoad / s.maxPerDay) * 25;
    if (s.maxConsecutive > 0) penalty += Math.max(0, s.nextConsecutive - 1) * 12;
    return penalty;
  }

  const groupContainsCardId = (group, cardId, { includeExcluded = false } = {}) => {
    if (!group || !cardId) return false;
    if (!includeExcluded && (group.excludedCardIds || []).includes(cardId)) return false;
    if ((group.poolCardIds || []).includes(cardId)) return true;
    return (group.units || []).some(unit => (unit.ttcardIds || []).includes(cardId));
  };

  function groupIdsForCardId(cardId, options = {}) {
    if (!cardId) return [];
    return ttGroups()
      .filter(g => groupContainsCardId(g, cardId, options))
      .map(g => g.id);
  }

  function groupIdsForPlacement(x) {
    const ids = new Set();
    if (x?.groupId) ids.add(x.groupId);
    ttCardIdsFromPlacement(x).forEach(cardId => {
      groupIdsForCardId(cardId).forEach(groupId => ids.add(groupId));
    });

    // Legacy fallback only: older entries may not have ttcardId/ttcardIds.
    // Do not use this for normal current entries because templateId can be reused
    // across grades/cards and would make excluded cards look grouped again.
    if (!ids.size && x?.templateId) {
      (appState.timetable?.ttcards || [])
        .filter(c => c.templateId === x.templateId && (!x.gradeKey || c.gradeKey === x.gradeKey) && ((x.sectionIdx ?? null) == null || (c.sectionIdx ?? 0) === (x.sectionIdx ?? 0)))
        .forEach(c => groupIdsForCardId(c.id).forEach(groupId => ids.add(groupId)));
    }
    return [...ids];
  }

  function sameActiveGroup(a, b) {
    const aIds = new Set(groupIdsForPlacement(a));
    if (!aIds.size) return false;
    return groupIdsForPlacement(b).some(id => aIds.has(id));
  }

  function compoundRefForCard(card) {
    if (!card || !card.compoundParentTemplateId || !card.compoundPartId) return null;
    const grade = card.gradeKey || "";
    const section = (card.sectionIdx ?? 0);
    return {
      key: `${grade}::${section}::${card.compoundParentTemplateId}`,
      partId: card.compoundPartId,
      cardId: card.id
    };
  }

  function compoundRefsForPlacement(x = {}) {
    const refs = [];
    ttCardIdsFromPlacement(x).forEach(cardId => {
      const ref = compoundRefForCard(getTtCardById(cardId));
      if (ref) refs.push(ref);
    });
    if (!refs.length && x.compoundParentTemplateId && x.compoundPartId) {
      refs.push({
        key: `${x.gradeKey || ""}::${x.sectionIdx ?? 0}::${x.compoundParentTemplateId}`,
        partId: x.compoundPartId,
        cardId: x.ttcardId || ""
      });
    }
    return refs;
  }

  function hasInternalCompoundSiblingConflict(x = {}) {
    const seen = new Map();
    for (const ref of compoundRefsForPlacement(x)) {
      if (!ref?.key) continue;
      const prev = seen.get(ref.key);
      if (prev && (prev.partId !== ref.partId || prev.cardId !== ref.cardId)) return true;
      seen.set(ref.key, ref);
    }
    return false;
  }

  function hasCompoundSiblingConflict(a = {}, b = {}) {
    const refsA = compoundRefsForPlacement(a);
    const refsB = compoundRefsForPlacement(b);
    if (!refsA.length || !refsB.length) return false;
    return refsA.some(ra => refsB.some(rb =>
      ra.key && rb.key && ra.key === rb.key && (ra.partId !== rb.partId || ra.cardId !== rb.cardId)
    ));
  }

  /** Check if a placement item/entry belongs to a concurrent group */
  function isConcurrentItem(x) {
    return groupIdsForPlacement(x).some(groupId => {
      const grp = ttGroups().find(g => g.id === groupId);
      return grp && (grp.groupType === "concurrent" || !!grp.isConcurrent);
    });
  }

  function sameUnitPlacement(a = {}, b = {}) {
    return !!(a.unitId && b.unitId && a.unitId === b.unitId);
  }

  function roomAssignmentsForPlacementAuto(entry = {}) {
    const explicit = entry.roomAssignmentsByTtCardId && typeof entry.roomAssignmentsByTtCardId === "object"
      ? entry.roomAssignmentsByTtCardId
      : {};
    const out = {};
    ttCardIdsFromPlacement(entry).forEach(id => {
      const card = getTtCardById(id);
      if (!cardNeedsRoomForAuto(card || {}, entry)) return;

      const explicitRoom = cleanStr(explicit[id]);
      if (isManualRoomOverrideForCardAuto(entry, card || {}, explicitRoom)) {
        out[id] = explicitRoom;
        return;
      }

      // r210: roomRule=teacher 카드의 과거 자동배치 roomAssignments는
      // 교사 고정교실을 덮어쓰면 안 됩니다. 단, 사용자가 지정교실 고정으로
      // 바꾼 카드/entry는 위의 manual override에서 먼저 보존합니다.
      const fixedRoom = fixedRoomForCardDuringAuto(card || {}, entry);
      if (fixedRoom) { out[id] = fixedRoom; return; }

      // 교사 지정교실이 없는 카드만 기존 explicit 값을 보조 교실로 인정합니다.
      if (explicitRoom) out[id] = explicitRoom;
    });
    return out;
  }

  function shouldUseEntryRoomIdFallbackAuto(entry = {}, assigned = []) {
    const roomId = cleanStr(entry.roomId || "");
    if (!roomId) return false;
    const cardIds = ttCardIdsFromPlacement(entry);
    if (entry.groupId || cardIds.length > 1) return false;
    if (!cardIds.length) return true;
    if (!assigned.length) return true;
    const entryRule = normalizeRoomRuleForAuto(entry.roomRule || "teacher");
    return entryRule === "fixed" && cleanStr(entry.roomId || entry.fixedRoomId) === roomId;
  }

  function roomIdsForPlacement(entry = {}) {
    const assigned = Object.values(roomAssignmentsForPlacementAuto(entry)).map(cleanStr).filter(Boolean);
    const explicitRoomIds = Array.isArray(entry.roomIds) ? entry.roomIds.map(cleanStr).filter(Boolean) : [];
    const ids = [...assigned, ...explicitRoomIds];
    // r210: 카드별 교실 계산값이 있으면 stale entry.roomId를 후보/충돌 계산에 섞지 않습니다.
    if (shouldUseEntryRoomIdFallbackAuto(entry, assigned)) ids.push(entry.roomId);
    return uniqueRoomIds(ids);
  }

  function roomConflictsInSlot(candidate = {}, slot = {}, placed = []) {
    const roomIds = roomIdsForPlacement(candidate);
    if (!roomIds.length) return false;
    const slotEntries = [...entries(), ...placed].filter(e => e.day === slot.day && e.period === slot.period);
    return slotEntries.some(e => !sameUnitPlacement(candidate, e) && roomIdsForPlacement(e).some(roomId => roomIds.includes(roomId)));
  }


  function roomsOverlapForPlacement(a = {}, b = {}) {
    const aRooms = roomIdsForPlacement(a);
    if (!aRooms.length) return false;
    const bRooms = new Set(roomIdsForPlacement(b));
    return aRooms.some(roomId => bRooms.has(roomId)) && !sameUnitPlacement(a, b);
  }

  function entryHasMissingRoomForAuto(entry = {}) {
    const cardIds = ttCardIdsFromPlacement(entry);
    const assignments = roomAssignmentsForPlacementAuto(entry);
    const requiredRooms = itemRequiredRoomCount(entry);
    if (cardIds.length && (entry.groupId || cardIds.length > 1)) {
      const missingCardRoom = cardIds.some(id => {
        const card = getTtCardById(id);
        if (!cardNeedsRoomForAuto(card || {}, entry)) return false;
        return !cleanStr(assignments[id]);
      });
      if (missingCardRoom) return true;
      return roomIdsForPlacement(entry).length < requiredRooms;
    }
    return normalizeRoomRuleForAuto(entry.roomRule || "teacher") !== "none" && roomIdsForPlacement(entry).length < requiredRooms;
  }

  function getRoomByIdLocal(roomId) {
    if (!roomId) return null;
    return (appState.rooms?.rooms || []).find(r => r.id === roomId) || null;
  }

  function isRoomUnavailable(roomId, day, period) {
    const room = getRoomByIdLocal(roomId);
    const slots = Array.isArray(room?.unavailableSlots) ? room.unavailableSlots : [];
    const d = Number(day);
    const p = Number(period);
    return slots.some(slot => Number(slot?.day) === d && Number(slot?.period) === p);
  }

  function roomUnavailableInSlot(candidate = {}, slot = {}) {
    return roomIdsForPlacement(candidate).some(roomId => isRoomUnavailable(roomId, slot.day, slot.period));
  }


  // ── Fixed/protected slot helpers ───────────────────────────────
  // 자동배치에서는 entries()에 남겨 둔 항목이 곧 보호 대상입니다.
  // 고정 수업·현재 배치 유지 모드·선택 학년 밖 수업·수동 카드가 여기에 들어갑니다.
  // 일반 충돌 검사보다 앞에서 보호 슬롯을 강하게 제외해야, 채플/자율/동아리처럼
  // 학생명단이 비어 있거나 교사가 없는 수업도 다른 수업 후보 시간으로 잡히지 않습니다.
  function protectedEntriesInSlot(day, period) {
    return entries().filter(e => e && e.day === day && e.period === period);
  }

  function setOverlaps(a = new Set(), b = new Set()) {
    for (const v of a || []) if ((b || new Set()).has(v)) return true;
    return false;
  }

  function teacherNamesForPlacement(x = {}) {
    return hardTeacherNamesForPlacement(x);
  }

  function slotLabelForProtected(day, period) {
    return formatSlotLabel({ day, period });
  }

  function strongProtectedSlotConflict(candidate = {}, slot = {}, placed = []) {
    if (!Number.isInteger(slot.day) || !Number.isInteger(slot.period)) return null;
    const fixedEntries = protectedEntriesInSlot(slot.day, slot.period);
    if (!fixedEntries.length) return null;

    const candidateWithSlot = { ...candidate, ...slot };
    const candidateAudience = audienceForPlacement(candidateWithSlot);
    const candidateTeachers = teacherNamesForPlacement(candidateWithSlot);
    const candidateTeacherSet = new Set(candidateTeachers);
    const candidateRoomData = applyAutoRoomToEntryData(candidateWithSlot, slot, placed);

    const protectedBlock = protectedSlotConflict?.(candidateWithSlot, slot.day, slot.period, { placed });
    if (protectedBlock?.entry) {
      return {
        code: "protectedWholeGrade",
        label: "고정 전체수업 시간",
        detail: `${slotLabelForProtected(slot.day, slot.period)} · ${getAutoItemName(protectedBlock.entry)}`,
        entry: protectedBlock.entry
      };
    }

    for (const fixed of fixedEntries) {
      if (!fixed || (candidateWithSlot.id && fixed.id === candidateWithSlot.id)) continue;
      if (sameUnitPlacement(candidateWithSlot, fixed)) continue;

      const fixedAudience = audienceForPlacement(fixed);
      if (audiencesConflict(candidateAudience, fixedAudience)) {
        return {
          code: "protectedAudience",
          label: "고정 수업 학급 충돌",
          detail: `${slotLabelForProtected(slot.day, slot.period)} · ${getAutoItemName(fixed)}`,
          entry: fixed
        };
      }

      const fixedTeachers = teacherNamesForPlacement(fixed);
      if (candidateTeacherSet.size && fixedTeachers.some(t => candidateTeacherSet.has(t))) {
        return {
          code: "protectedTeacher",
          label: "고정 수업 교사 충돌",
          detail: `${slotLabelForProtected(slot.day, slot.period)} · ${fixedTeachers.filter(t => candidateTeacherSet.has(t)).join(", ")}`,
          entry: fixed
        };
      }

      const fixedRoomIds = new Set(roomIdsForPlacement(fixed));
      const candidateRoomIds = roomIdsForPlacement(candidateRoomData);
      const overlapRoomId = candidateRoomIds.find(id => fixedRoomIds.has(id));
      if (overlapRoomId) {
        const roomName = (appState.rooms?.rooms || []).find(r => r.id === overlapRoomId)?.name || overlapRoomId;
        return {
          code: "protectedRoom",
          label: "고정 수업 교실 충돌",
          detail: `${slotLabelForProtected(slot.day, slot.period)} · ${roomName}`,
          entry: fixed
        };
      }
    }
    return null;
  }

  function protectedSlotSummary(protectedEntries = []) {
    const slots = new Set();
    let pinned = 0;
    let manual = 0;
    (protectedEntries || []).forEach(e => {
      if (Number.isInteger(e.day) && Number.isInteger(e.period)) slots.add(`${e.day}:${e.period}`);
      if (e.pinned) pinned += 1;
      if (entryUsesManualCard(e)) manual += 1;
    });
    return { slots: slots.size, pinned, manual, total: protectedEntries.length };
  }



  // ── Auto-assign verification report helpers ────────────────────
  // 자동배치 전/후 검증은 "카드 개수"가 아니라 실제 시간표의 학급별 점유 슬롯을 기준으로 봅니다.
  function normalizeGradeNumber(value = "") {
    const m = String(value || "").match(/\d{1,2}/);
    return m ? String(Number(m[0])) : "";
  }

  function normalizeClassSection(value = "", fallbackIdx = 0) {
    const raw = String(value || "").trim();
    if (raw) return raw.replace(/\s+/g, "").replace(/학년/g, "").replace(/^\d{1,2}/, "").toUpperCase();
    return sectionLabel(fallbackIdx);
  }

  function makeClassKeyForReport(gradeKey, section, sectionIdx = 0) {
    const grade = normalizeGradeNumber(gradeKey);
    const sec = normalizeClassSection(section, sectionIdx);
    return grade && sec ? `${grade}:${sec}` : "";
  }

  function formatClassKeyForReport(key = "") {
    const [grade, section] = String(key || "").split(":");
    return grade && section ? `${grade}${section}` : (key || "?");
  }

  function getReportClassRows(scopeGrades = []) {
    const scope = new Set(normalizeAutoActiveGrades(scopeGrades));
    return (appState.classes?.classes || [])
      .map((cls, idx) => {
        const gradeKey = cls.grade || cls.gradeKey || "";
        const section = cls.name || cls.section || sectionLabel(cls.sectionIdx ?? idx);
        const key = makeClassKeyForReport(gradeKey, section, cls.sectionIdx ?? idx);
        return { key, label: formatClassKeyForReport(key), gradeKey, section };
      })
      .filter(row => row.key && (!scope.size || scope.has(row.gradeKey)))
      .sort((a, b) => {
        const ga = Number(normalizeGradeNumber(a.gradeKey)) || 0;
        const gb = Number(normalizeGradeNumber(b.gradeKey)) || 0;
        if (ga !== gb) return ga - gb;
        return String(a.section || "").localeCompare(String(b.section || ""), "ko", { numeric: true });
      });
  }

  function classKeysFromAudienceForReport(entry = {}) {
    const audience = audienceForPlacement(entry);
    return [...(audience?.classKeys || new Set())]
      .map(k => {
        const raw = String(k || "").trim();
        if (!raw) return "";
        if (raw.includes(":")) {
          const [g, s] = raw.split(":");
          return makeClassKeyForReport(g, s);
        }
        const m = raw.replace(/\s+/g, "").replace(/학년/g, "").match(/^(\d{1,2})(.+)$/);
        return m ? makeClassKeyForReport(m[1], m[2]) : raw;
      })
      .filter(Boolean);
  }

  function buildClassSlotValidation(allEntries = [], scopeGrades = []) {
    const targetPerClass = Math.max(0, (parseInt(ttConfig().periodCount, 10) || 7) * 5);
    const classRows = getReportClassRows(scopeGrades);
    const slotMap = new Map(classRows.map(row => [row.key, new Set()]));
    const contributionMap = new Map(classRows.map(row => [row.key, []]));

    (allEntries || []).forEach(entry => {
      if (!Number.isInteger(entry?.day) || !Number.isInteger(entry?.period)) return;
      const slotKey = `${entry.day}:${entry.period}`;
      classKeysFromAudienceForReport(entry).forEach(key => {
        if (!slotMap.has(key)) return;
        const slots = slotMap.get(key);
        const before = slots.size;
        slots.add(slotKey);
        if (slots.size !== before) {
          const list = contributionMap.get(key) || [];
          if (list.length < 8) list.push(`${formatSlotLabel(entry)} · ${getAutoItemName(entry)}`);
          contributionMap.set(key, list);
        }
      });
    });

    const rows = classRows.map(row => {
      const count = slotMap.get(row.key)?.size || 0;
      const diff = count - targetPerClass;
      return {
        ...row,
        count,
        target: targetPerClass,
        diff,
        status: diff === 0 ? "ok" : (diff < 0 ? "short" : "over"),
        samples: contributionMap.get(row.key) || []
      };
    });
    const issues = rows.filter(row => row.diff !== 0);
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    const targetTotal = rows.length * targetPerClass;
    return {
      targetPerClass,
      targetTotal,
      total,
      diff: total - targetTotal,
      ok: issues.length === 0,
      issueCount: issues.length,
      rows,
      issues,
      summary: issues.length
        ? `${rows.length}개 학급 중 ${issues.length}개 학급 시수 불일치 · 현재 ${total}/${targetTotal}시수`
        : `${rows.length}개 학급 모두 ${targetPerClass}시수 충족 · 현재 ${total}/${targetTotal}시수`
    };
  }



  function classLabelsForCardCoverage(card = {}) {
    const labels = (card.classLabels || []).map(v => String(v || "").trim()).filter(Boolean);
    if (labels.length) return labels;
    const keys = (card.classKeys || []).map(normalizeClassKeyForReportKey).filter(Boolean);
    if (keys.length) return keys.map(formatClassKeyForReport);
    if (card.gradeKey) return [`${gradeDisplay(card.gradeKey)}${sectionLabel(card.sectionIdx ?? 0)}`];
    return [];
  }

  function cardTitleForCoverage(card = {}) {
    try { return describeTtCard(card).title || card.subject || card.label || card.id || "카드"; }
    catch (_) { return card.subject || card.label || card.id || "카드"; }
  }

  function getActiveTtCardsForValidation(scopeGrades = []) {
    const scope = new Set(normalizeAutoActiveGrades(scopeGrades));
    return (ttDomain().ttcards || [])
      .filter(card => card && card.id)
      .filter(card => !isManualAutoAssignExcludedCard(card))
      .filter(card => !scope.size || scope.has(card.gradeKey) || (card.gradeKeys || []).some(g => scope.has(g)))
      .filter(card => Math.max(0, Number(card.credits ?? getCreditsForTtCard?.(card) ?? 0)) > 0);
  }

  function buildCardCoverageValidation(allEntries = [], scopeGrades = []) {
    const cards = getActiveTtCardsForValidation(scopeGrades);
    const cardMap = new Map(cards.map(card => [card.id, card]));
    const placedSlotsByCard = new Map(cards.map(card => [card.id, new Set()]));
    const samplesByCard = new Map(cards.map(card => [card.id, []]));

    (allEntries || []).forEach(entry => {
      if (!Number.isInteger(entry?.day) || !Number.isInteger(entry?.period)) return;
      const slotKey = `${entry.day}:${entry.period}`;
      const ids = ttCardIdsFromPlacement(entry).filter(id => cardMap.has(id));
      ids.forEach(id => {
        const slots = placedSlotsByCard.get(id);
        const before = slots.size;
        slots.add(slotKey);
        if (slots.size !== before) {
          const list = samplesByCard.get(id) || [];
          if (list.length < 5) list.push(`${formatSlotLabel(entry)} · ${getAutoItemName(entry)}`);
          samplesByCard.set(id, list);
        }
      });
    });

    const rows = cards.map(card => {
      const target = Math.max(0, Number(card.credits ?? getCreditsForTtCard?.(card) ?? 0));
      const count = placedSlotsByCard.get(card.id)?.size || 0;
      const diff = count - target;
      return {
        id: card.id,
        title: cardTitleForCoverage(card),
        gradeKey: card.gradeKey || "",
        classLabels: classLabelsForCardCoverage(card),
        teacherName: card.teacherName || (card.teachers || []).join(", "),
        groupIds: groupIdsForCardId(card.id),
        category: card.category || "",
        track: card.track || "",
        group: card.group || "",
        target,
        count,
        diff,
        status: diff === 0 ? "ok" : (diff < 0 ? "short" : "over"),
        samples: samplesByCard.get(card.id) || []
      };
    });
    const issues = rows.filter(row => row.diff !== 0);
    const shortRows = issues.filter(row => row.diff < 0).sort((a, b) => a.count - b.count || a.title.localeCompare(b.title, "ko"));
    const overRows = issues.filter(row => row.diff > 0).sort((a, b) => b.diff - a.diff || a.title.localeCompare(b.title, "ko"));
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    const targetTotal = rows.reduce((sum, row) => sum + row.target, 0);
    return {
      targetTotal,
      total,
      diff: total - targetTotal,
      ok: issues.length === 0,
      issueCount: issues.length,
      shortCount: shortRows.length,
      overCount: overRows.length,
      rows,
      issues,
      shortRows,
      overRows,
      summary: issues.length
        ? `카드 시수 불일치 ${issues.length}개 · 부족 ${shortRows.length}개 · 초과 ${overRows.length}개 · 현재 ${total}/${targetTotal}시수`
        : `카드 ${rows.length}개 모두 입력 시수와 배치 시수 일치 · 현재 ${total}/${targetTotal}시수`
    };
  }

  function failedNamesFromCardCoverage(cardCoverage = {}) {
    const rows = Array.isArray(cardCoverage.shortRows) ? cardCoverage.shortRows : [];
    const names = [];
    const seen = new Set();
    rows.forEach(row => {
      const title = String(row?.title || row?.name || row?.id || "카드").trim();
      const cls = Array.isArray(row?.classLabels) ? row.classLabels.map(x => String(x || "").trim()).filter(Boolean).join(", ") : "";
      const missing = Math.max(0, -Number(row?.diff || 0));
      const name = `${title}${cls ? ` ${cls}` : ""}${missing > 1 ? ` ${missing}시수` : ""}`.trim();
      if (!name || seen.has(name)) return;
      seen.add(name);
      names.push(name);
    });
    return names;
  }

  function summarizeGroupCoverageValidation(cardCoverage = {}) {
    const issueRows = Array.isArray(cardCoverage.issues) ? cardCoverage.issues : [];
    const map = new Map();
    const add = (key, name, row) => {
      if (!key) return;
      if (!map.has(key)) map.set(key, { id: key, name, issueCount: 0, shortCount: 0, overCount: 0, samples: [] });
      const dest = map.get(key);
      dest.issueCount += 1;
      if (row.diff < 0) dest.shortCount += 1;
      if (row.diff > 0) dest.overCount += 1;
      if (dest.samples.length < 6) {
        const cls = (row.classLabels || []).join(", ");
        dest.samples.push(`${row.title}${cls ? ` ${cls}` : ""}: ${row.count}/${row.target}`);
      }
    };

    issueRows.forEach(row => {
      const ids = row.groupIds || [];
      if (!ids.length) {
        add(`standalone:${row.gradeKey || ""}:${row.id}`, "개별 카드", row);
        return;
      }
      ids.forEach(groupId => {
        const group = ttGroups().find(g => g.id === groupId);
        add(groupId, group?.name || group?.groupName || groupId, row);
      });
    });
    const rows = [...map.values()].sort((a, b) => b.issueCount - a.issueCount || String(a.name).localeCompare(String(b.name), "ko"));
    return {
      ok: rows.length === 0,
      issueCount: rows.length,
      rows,
      summary: rows.length ? `그룹/개별 묶음 ${rows.length}개에서 카드 시수 불일치` : "그룹/개별 카드 시수 불일치 없음"
    };
  }

  function normalizeClassKeyForReportKey(rawValue = "") {
    const raw = String(rawValue || "").trim();
    if (!raw) return "";
    if (raw.includes(":")) {
      const [g, s] = raw.split(":");
      return makeClassKeyForReport(g, s);
    }
    const m = raw.replace(/\s+/g, "").replace(/학년/g, "").match(/^(\d{1,2})(.+)$/);
    return m ? makeClassKeyForReport(m[1], m[2]) : raw;
  }

  function classKeysForCapacity(x = {}) {
    const audience = audienceForPlacement(x);
    return [...(audience?.classKeys || new Set())]
      .map(normalizeClassKeyForReportKey)
      .filter(Boolean);
  }

  function buildClassSlotStatsForEntries(allEntries = [], scopeGrades = []) {
    const rows = getReportClassRows(scopeGrades);
    const rowKeys = new Set(rows.map(row => row.key));
    const stats = new Map(rows.map(row => [row.key, { ...row, slots: new Set(), dayPeriods: new Map(), samples: [] }]));
    (allEntries || []).forEach(entry => {
      if (!Number.isInteger(entry?.day) || !Number.isInteger(entry?.period)) return;
      const slotKey = `${entry.day}:${entry.period}`;
      classKeysForCapacity(entry).forEach(cls => {
        if (!rowKeys.has(cls)) return;
        const stat = stats.get(cls);
        const before = stat.slots.size;
        stat.slots.add(slotKey);
        if (!stat.dayPeriods.has(entry.day)) stat.dayPeriods.set(entry.day, new Set());
        stat.dayPeriods.get(entry.day).add(entry.period);
        if (stat.slots.size !== before && stat.samples.length < 6) stat.samples.push(`${formatSlotLabel(entry)} · ${getAutoItemName(entry)}`);
      });
    });
    return stats;
  }

  function classDayLoadFromStats(stats, classKey, day) {
    return stats.get(classKey)?.dayPeriods?.get(day)?.size || 0;
  }

  function classSlotCountFromStats(stats, classKey) {
    return stats.get(classKey)?.slots?.size || 0;
  }

  function buildClassCapacityPrecheck(standalone = [], groupBlocks = [], protectedEntries = [], scopeGrades = []) {
    const targetPerClass = Math.max(0, (parseInt(ttConfig().periodCount, 10) || 7) * 5);
    const rows = getReportClassRows(scopeGrades);
    const rowKeys = new Set(rows.map(row => row.key));
    const map = new Map(rows.map(row => [row.key, {
      ...row,
      target: targetPerClass,
      protectedSlots: new Set(),
      // 보호 배치 중 자동배치 원본 카드/그룹에 포함되지 않는 외부 보호 슬롯만 별도 가산합니다.
      // 채플/CA/SA처럼 이미 35시수 안에 들어 있는 보호 수업은 autoSlots와 중복 가산하지 않습니다.
      externalProtectedSlots: new Set(),
      autoSlots: 0,
      samples: []
    }]));

    const autoSourceKeysByClass = new Map(rows.map(row => [row.key, new Set()]));

    const sourceKeysForCapacity = (source = {}) => {
      const keys = new Set();
      ttCardIdsFromPlacement(source).forEach(id => { if (id) keys.add(`card:${id}`); });
      const templateIds = [source.templateId, ...(source.templateIds || [])].filter(Boolean);
      const gradeKeys = [source.gradeKey, ...(source.gradeKeys || [])].filter(Boolean);
      const sectionIdx = source.sectionIdx ?? 0;
      templateIds.forEach(tpl => {
        if (gradeKeys.length) gradeKeys.forEach(grade => keys.add(`tpl:${tpl}:${grade}:${sectionIdx}`));
        else keys.add(`tpl:${tpl}`);
      });
      (source.ttcards || []).forEach(card => {
        if (card?.id) keys.add(`card:${card.id}`);
        if (card?.templateId) keys.add(`tpl:${card.templateId}:${card.gradeKey || ""}:${card.sectionIdx ?? 0}`);
      });
      return [...keys];
    };

    const addAuto = (keys = [], count = 1, sample = "", sources = []) => {
      const normalized = [...new Set((keys || []).map(normalizeClassKeyForReportKey).filter(key => rowKeys.has(key)))];
      const sourceList = Array.isArray(sources) ? sources : [sources];
      const sourceKeys = new Set(sourceList.flatMap(sourceKeysForCapacity));
      normalized.forEach(key => {
        const row = map.get(key);
        row.autoSlots += Math.max(0, Number(count) || 0);
        sourceKeys.forEach(srcKey => autoSourceKeysByClass.get(key)?.add(srcKey));
        if (sample && row.samples.length < 6) row.samples.push(sample);
      });
    };

    (standalone || []).forEach(item => addAuto(classKeysForCapacity(item), durationForAutoObject(item), getAutoItemName(item), item));

    (groupBlocks || []).forEach(block => {
      const group = block?.group || {};
      const unitItems = block?.unitItems || [];
      const isConcurrent = group.isConcurrent || group.groupType === "concurrent";
      const groupName = group.name || group.groupName || "그룹 수업";
      if (isConcurrent) {
        const maxCredits = Math.max(0, ...unitItems.map(u => Math.max(0, Number(u?.credits) || 0)));
        for (let occurrence = 0; occurrence < maxCredits; occurrence++) {
          const keys = new Set();
          const sources = [];
          unitItems
            .filter(u => occurrence < Math.max(0, Number(u?.credits) || 0))
            .map(u => getGroupItemForOccurrence(u, occurrence))
            .filter(u => (u?.ttcards || []).length)
            .forEach(u => {
              const placement = makePlacementFromGroupItem(group, u) || u;
              sources.push(placement, u);
              classKeysForCapacity(placement).forEach(key => keys.add(key));
            });
          addAuto([...keys], 1, groupName, sources);
        }
      } else {
        unitItems.forEach(unit => {
          const credits = Math.max(0, Number(unit?.credits) || 0);
          for (let occurrence = 0; occurrence < credits; occurrence++) {
            const occurrenceItem = getGroupItemForOccurrence(unit, occurrence);
            const placement = makePlacementFromGroupItem(group, occurrenceItem) || occurrenceItem || unit;
            addAuto(classKeysForCapacity(placement), 1, groupName, [placement, occurrenceItem, unit]);
          }
        });
      }
    });

    (protectedEntries || []).forEach(entry => {
      if (!Number.isInteger(entry?.day) || !Number.isInteger(entry?.period)) return;
      const slotKey = `${entry.day}:${entry.period}`;
      const entrySourceKeys = sourceKeysForCapacity(entry);
      classKeysForCapacity(entry).forEach(key => {
        if (!rowKeys.has(key)) return;
        const row = map.get(key);
        row.protectedSlots.add(slotKey);
        const knownAutoSources = autoSourceKeysByClass.get(key) || new Set();
        const coveredByAutoSource = entrySourceKeys.length
          ? entrySourceKeys.some(srcKey => knownAutoSources.has(srcKey))
          : row.autoSlots >= row.target;
        if (!coveredByAutoSource) row.externalProtectedSlots.add(slotKey);
        if (row.samples.length < 6) {
          const prefix = coveredByAutoSource ? "보호/원본중복" : "외부보호";
          row.samples.push(`${prefix} ${formatSlotLabel(entry)} · ${getAutoItemName(entry)}`);
        }
      });
    });

    const capacityRows = [...map.values()].map(row => {
      const protectedCount = row.protectedSlots.size;
      const protectedExternalCount = row.externalProtectedSlots.size;
      const protectedCoveredCount = Math.max(0, protectedCount - protectedExternalCount);
      const autoCount = row.autoSlots;
      // 핵심 수정: 보호 수업은 대부분 자동배치 원본 시수 안에 이미 포함되어 있으므로 중복으로 더하지 않습니다.
      // 원본 카드/그룹에 없는 외부 보호 슬롯만 자동 원본 시수에 추가합니다.
      const available = autoCount + protectedExternalCount;
      const diff = available - row.target;
      return {
        ...row,
        protectedCount,
        protectedCoveredCount,
        protectedExternalCount,
        autoCount,
        available,
        diff,
        status: diff === 0 ? "ok" : (diff < 0 ? "short" : "over"),
        samples: row.samples
      };
    });
    const shortRows = capacityRows.filter(row => row.diff < 0);
    const overRows = capacityRows.filter(row => row.diff > 0);
    const targetTotal = capacityRows.reduce((sum, row) => sum + row.target, 0);
    const availableTotal = capacityRows.reduce((sum, row) => sum + row.available, 0);
    const protectedCoveredTotal = capacityRows.reduce((sum, row) => sum + row.protectedCoveredCount, 0);
    const protectedExternalTotal = capacityRows.reduce((sum, row) => sum + row.protectedExternalCount, 0);
    return {
      targetPerClass,
      targetTotal,
      availableTotal,
      protectedCoveredTotal,
      protectedExternalTotal,
      ok: shortRows.length === 0 && overRows.length === 0,
      shortRows,
      overRows,
      rows: capacityRows,
      summary: shortRows.length || overRows.length
        ? `부족 ${shortRows.length}개 학급 · 초과 ${overRows.length}개 학급 · 가능 ${availableTotal}/${targetTotal}시수`
        : `${capacityRows.length}개 학급 모두 ${targetPerClass}시수 구성 가능 · 보호중복 ${protectedCoveredTotal}시수 제외${protectedExternalTotal ? ` · 외부보호 ${protectedExternalTotal}시수 포함` : ""}`
    };
  }

  function teacherUnavailableSetForReport(teacher) {
    const c = constraints()?.[teacher] || {};
    return new Set((Array.isArray(c.unavailableSlots) ? c.unavailableSlots : [])
      .map(slot => `${slot.day}:${slot.period}`));
  }

  function teacherSlotsForReport(teacher, allEntries = []) {
    const slots = new Set();
    const byDay = new Map();
    const unavailable = teacherUnavailableSetForReport(teacher);
    const unavailableHits = [];
    (allEntries || []).forEach(entry => {
      if (!Number.isInteger(entry?.day) || !Number.isInteger(entry?.period)) return;
      if (!teacherEntryHasTeacher(entry, teacher)) return;
      const key = `${entry.day}:${entry.period}`;
      slots.add(key);
      if (!byDay.has(entry.day)) byDay.set(entry.day, new Set());
      byDay.get(entry.day).add(entry.period);
      if (unavailable.has(key) && unavailableHits.length < 5) {
        unavailableHits.push(`${formatSlotLabel(entry)} · ${getAutoItemName(entry)}`);
      }
    });
    return { slots, byDay, unavailableHits };
  }

  function maxConsecutiveFromPeriods(periods = []) {
    const list = [...periods].map(Number).filter(Number.isInteger).sort((a, b) => a - b);
    let max = list.length ? 1 : 0;
    let cur = list.length ? 1 : 0;
    for (let i = 1; i < list.length; i++) {
      cur = list[i] === list[i - 1] + 1 ? cur + 1 : 1;
      max = Math.max(max, cur);
    }
    return max;
  }

  function buildRestrictedTeacherValidation(allEntries = []) {
    const teacherNames = Object.keys(constraints() || {}).filter(isRestrictedTeacher).sort((a, b) => a.localeCompare(b, "ko"));
    const rows = teacherNames.map(teacher => {
      const c = constraints()?.[teacher] || {};
      const { slots, byDay, unavailableHits } = teacherSlotsForReport(teacher, allEntries);
      const maxPerWeek = Number(c.maxPerWeek) || 0;
      const maxPerDay = Number(c.maxPerDay) || 0;
      const maxConsecutive = Number(c.maxConsecutive) || 0;
      const dayLoads = [...byDay.entries()].map(([day, set]) => ({ day, count: set.size, maxConsecutive: maxConsecutiveFromPeriods(set) }));
      const dayOver = maxPerDay > 0 ? dayLoads.filter(d => d.count > maxPerDay) : [];
      const consecutiveOver = maxConsecutive > 0 ? dayLoads.filter(d => d.maxConsecutive > maxConsecutive) : [];
      const weekOver = maxPerWeek > 0 && slots.size > maxPerWeek;
      const issueParts = [];
      if (unavailableHits.length) issueParts.push(`불가시간 ${unavailableHits.length}건`);
      if (weekOver) issueParts.push(`주 최대 ${slots.size}/${maxPerWeek}`);
      if (dayOver.length) issueParts.push(`하루 최대 초과 ${dayOver.length}일`);
      if (consecutiveOver.length) issueParts.push(`연속수업 초과 ${consecutiveOver.length}일`);
      return {
        teacher,
        workType: c.workType || "restricted",
        total: slots.size,
        maxPerWeek,
        maxPerDay,
        maxConsecutive,
        dayLoads,
        unavailableHits,
        issueParts,
        ok: issueParts.length === 0
      };
    });
    const issues = rows.filter(row => !row.ok);
    return {
      totalTeachers: rows.length,
      issueCount: issues.length,
      rows,
      issues,
      ok: issues.length === 0,
      summary: rows.length
        ? (issues.length ? `제약교사 ${rows.length}명 중 ${issues.length}명 조건 확인 필요` : `제약교사 ${rows.length}명 조건 충족`)
        : "등록된 제약교사가 없습니다."
    };
  }

  function buildProtectedIntrusionValidation(allEntries = [], protectedEntries = []) {
    const protectedIds = new Set((protectedEntries || []).map(e => e.id).filter(Boolean));
    if (!protectedIds.size) return { total: 0, samples: [], ok: true, summary: "보호 수업 없음" };
    const protectedBySlot = new Map();
    (protectedEntries || []).forEach(e => {
      if (!Number.isInteger(e?.day) || !Number.isInteger(e?.period)) return;
      const key = `${e.day}:${e.period}`;
      if (!protectedBySlot.has(key)) protectedBySlot.set(key, []);
      protectedBySlot.get(key).push(e);
    });
    const samples = [];
    (allEntries || []).forEach(entry => {
      if (!entry?.id || protectedIds.has(entry.id)) return;
      if (!Number.isInteger(entry.day) || !Number.isInteger(entry.period)) return;
      const fixedList = protectedBySlot.get(`${entry.day}:${entry.period}`) || [];
      if (!fixedList.length) return;
      const entryAudience = audienceForPlacement(entry);
      const entryTeachers = new Set(teacherNamesForPlacement(entry));
      const entryRoom = entry.roomId || "";
      for (const fixed of fixedList) {
        if (sameUnitPlacement(entry, fixed)) continue;
        const fixedAudience = audienceForPlacement(fixed);
        const fixedTeachers = teacherNamesForPlacement(fixed);
        const fixedRooms = new Set([fixed.roomId, ...(fixed.roomIds || [])].filter(Boolean));
        const hitAudience = audiencesConflict(entryAudience, fixedAudience);
        const hitTeacher = fixedTeachers.some(t => entryTeachers.has(t));
        const hitRoom = entryRoom && fixedRooms.has(entryRoom);
        if (hitAudience || hitTeacher || hitRoom) {
          if (samples.length < 8) samples.push(`${formatSlotLabel(entry)} · ${getAutoItemName(entry)} ↔ ${getAutoItemName(fixed)}`);
          break;
        }
      }
    });
    return {
      total: samples.length,
      samples,
      ok: samples.length === 0,
      summary: samples.length ? `고정/보호 수업 침범 후보 ${samples.length}건` : "고정/보호 수업 침범 없음"
    };
  }

  function classSlotIssueCountForCandidate(movableEntries = [], scopeGrades = []) {
    const report = buildClassSlotValidation([...entries(), ...(movableEntries || [])], scopeGrades || []);
    const shortCount = (report.issues || []).filter(row => row.diff < 0).length;
    const overCount = (report.issues || []).filter(row => row.diff > 0).length;
    return {
      issueCount: report.issueCount || 0,
      shortCount,
      overCount,
      totalDiff: report.diff || 0,
      total: report.total || 0,
      targetTotal: report.targetTotal || 0,
    };
  }

  function cardCoverageIssueCountForCandidate(movableEntries = [], scopeGrades = []) {
    const report = buildCardCoverageValidation([...entries(), ...(movableEntries || [])], scopeGrades || []);
    const shortageSlots = (report.shortRows || []).reduce((sum, row) => sum + Math.max(0, -Number(row.diff || 0)), 0);
    const overageSlots = (report.overRows || []).reduce((sum, row) => sum + Math.max(0, Number(row.diff || 0)), 0);
    return {
      issueCount: report.issueCount || 0,
      shortCount: report.shortCount || 0,
      overCount: report.overCount || 0,
      shortageSlots,
      overageSlots,
      totalDiff: report.diff || 0,
      total: report.total || 0,
      targetTotal: report.targetTotal || 0,
    };
  }

  function buildScheduleVerificationReport(allEntries = [], options = {}) {
    const scopeGrades = options.scopeGrades || [];
    const classSlots = buildClassSlotValidation(allEntries, scopeGrades);
    const cardCoverage = buildCardCoverageValidation(allEntries, scopeGrades);
    const groupCoverage = summarizeGroupCoverageValidation(cardCoverage);
    const restrictedTeachers = buildRestrictedTeacherValidation(allEntries);
    const protectedIntrusions = buildProtectedIntrusionValidation(allEntries, options.protectedEntries || []);
    const providedFailedNames = Array.isArray(options.failedNames) ? options.failedNames.map(x => String(x || "").trim()).filter(Boolean) : [];
    const derivedFailedNames = options.deriveFailedFromCardShortage ? failedNamesFromCardCoverage(cardCoverage) : [];
    const finalFailedNames = providedFailedNames.length ? providedFailedNames : derivedFailedNames;
    const failedCount = finalFailedNames.length;
    const missingRooms = (allEntries || []).filter(entryHasMissingRoomForAuto);
    const ok = classSlots.ok && cardCoverage.ok && restrictedTeachers.ok && protectedIntrusions.ok && failedCount === 0 && missingRooms.length === 0;
    const issueParts = [];
    if (!classSlots.ok) issueParts.push(`학급 시수 ${classSlots.issueCount}개`);
    if (!cardCoverage.ok) issueParts.push(`카드 시수 ${cardCoverage.issueCount}개`);
    if (!groupCoverage.ok) issueParts.push(`그룹/개별 ${groupCoverage.issueCount}개`);
    if (!restrictedTeachers.ok) issueParts.push(`제약교사 ${restrictedTeachers.issueCount}명`);
    if (!protectedIntrusions.ok) issueParts.push(`고정침범 ${protectedIntrusions.total}건`);
    if (missingRooms.length) issueParts.push(`교실미배정 ${missingRooms.length}개`);
    if (failedCount) issueParts.push(`미배치 ${failedCount}개`);
    return {
      ts: Date.now(),
      ok,
      summary: ok ? "검증 통과" : `검증 필요: ${issueParts.join(" · ")}`,
      classSlots,
      cardCoverage,
      groupCoverage,
      restrictedTeachers,
      protectedIntrusions,
      missingRoomCount: missingRooms.length,
      missingRoomNames: [...new Set(missingRooms.map(e => getAutoItemName(e)))].slice(0, 20),
      failedCount,
      failedNames: finalFailedNames,
      failedDiagnostics: options.failedDiagnostics || []
    };
  }


  function summarizeAutoAssignOutcome({ placedEntries = [], failedItems = [], forcedEntries = [], protectedEntries = [], missingRoomEntries = [] } = {}) {
    const normalize = value => String(value ?? "").trim();
    const placedCardIds = new Set();
    const placedBlocks = new Map();
    const groupBlocks = new Map();
    const standaloneBlocks = new Map();
    const forcedIds = new Set((forcedEntries || []).map(e => e?.id).filter(Boolean));

    const blockKeyForEntry = entry => {
      if (!entry) return "";
      if (entry.groupId) return `group:${entry.groupId}:${entry.day}:${entry.period}`;
      const ids = ttCardIdsFromPlacement(entry).filter(Boolean).sort().join(",");
      if (ids) return `cards:${ids}:${entry.day}:${entry.period}`;
      const tpl = (entry.templateIds || [entry.templateId]).filter(Boolean).sort().join(",");
      return `entry:${tpl || entry.id || getAutoItemName(entry)}:${entry.day}:${entry.period}`;
    };

    const labelForEntry = entry => {
      if (!entry) return "-";
      if (entry.groupId) {
        const groupName = ttGroups().find(g => g.id === entry.groupId)?.name || entry.groupName || entry.label || "그룹 수업";
        return groupName;
      }
      return getAutoItemName(entry);
    };

    (placedEntries || []).forEach(entry => {
      ttCardIdsFromPlacement(entry).forEach(id => id && placedCardIds.add(id));
      const key = blockKeyForEntry(entry);
      if (!key) return;
      if (!placedBlocks.has(key)) {
        const block = {
          key,
          name: labelForEntry(entry),
          groupId: entry.groupId || "",
          day: entry.day,
          period: entry.period,
          entries: 0,
          cardIds: new Set(),
          forced: false,
          missingRoom: false
        };
        placedBlocks.set(key, block);
        if (entry.groupId) groupBlocks.set(key, block);
        else standaloneBlocks.set(key, block);
      }
      const block = placedBlocks.get(key);
      block.entries += 1;
      block.forced = block.forced || forcedIds.has(entry.id);
      block.missingRoom = block.missingRoom || entryHasMissingRoomForAuto(entry);
      ttCardIdsFromPlacement(entry).forEach(id => id && block.cardIds.add(id));
    });

    const failedUnitMap = new Map();
    (failedItems || []).forEach(fail => {
      const item = fail?.item || {};
      const ids = ttCardIdsFromPlacement(item).filter(Boolean).sort();
      const key = fail?.groupId
        ? `group:${fail.groupId}:${normalize(fail.name || getAutoItemName(item))}`
        : (ids.length ? `cards:${ids.join(",")}` : `name:${normalize(fail?.name || getAutoItemName(item))}`);
      if (!failedUnitMap.has(key)) {
        failedUnitMap.set(key, {
          key,
          name: fail?.name || getAutoItemName(item),
          groupId: fail?.groupId || item.groupId || "",
          occurrences: 0,
          cardIds: new Set(),
          teachers: new Set(),
          restrictedTeachers: new Set()
        });
      }
      const row = failedUnitMap.get(key);
      row.occurrences += 1;
      ids.forEach(id => row.cardIds.add(id));
      getTeachersForAutoItem(item).forEach(t => row.teachers.add(t));
      (item.restrictedTeachers || getRestrictedTeachersForAutoItem(item)).forEach(t => row.restrictedTeachers.add(t));
    });

    const failedUnits = [...failedUnitMap.values()].map(row => ({
      ...row,
      cardIds: [...row.cardIds],
      teachers: [...row.teachers],
      restrictedTeachers: [...row.restrictedTeachers]
    })).sort((a, b) => b.occurrences - a.occurrences || String(a.name).localeCompare(String(b.name), "ko"));

    const missingRoomBlockCount = [...placedBlocks.values()].filter(b => b.missingRoom).length;
    const forcedBlockCount = [...placedBlocks.values()].filter(b => b.forced).length;
    const protectedBlockKeys = new Set((protectedEntries || []).map(blockKeyForEntry).filter(Boolean));

    return {
      placedEntryCount: placedEntries.length,
      placedBlockCount: placedBlocks.size,
      placedCardCount: placedCardIds.size,
      placedGroupBlockCount: groupBlocks.size,
      placedStandaloneBlockCount: standaloneBlocks.size,
      protectedEntryCount: protectedEntries.length,
      protectedBlockCount: protectedBlockKeys.size,
      forcedEntryCount: forcedEntries.length,
      forcedBlockCount,
      missingRoomEntryCount: missingRoomEntries.length,
      missingRoomBlockCount,
      failedOccurrenceCount: failedItems.length,
      failedUnitCount: failedUnits.length,
      failedUnits,
      topFailedUnits: failedUnits.slice(0, 12).map(row => ({
        name: row.name,
        occurrences: row.occurrences,
        cardCount: row.cardIds.length,
        teachers: row.teachers,
        restrictedTeachers: row.restrictedTeachers
      }))
    };
  }

  function buildAutoAssignOutcomeHtml(outcome = {}) {
    const failedUnits = Array.isArray(outcome.topFailedUnits) ? outcome.topFailedUnits : [];
    const failedHtml = failedUnits.length
      ? `<ul class="tt-auto-outcome-list">${failedUnits.map(row => {
          const teacherText = row.teachers?.length ? ` · ${escapeReportHtml(row.teachers.join(", "))}` : "";
          const restricted = row.restrictedTeachers?.length ? ` <span class="tt-auto-outcome-badge warn">제약교사</span>` : "";
          return `<li><b>${escapeReportHtml(row.name)}</b><span>${Number(row.occurrences || 0)}회차 · 카드 ${Number(row.cardCount || 0)}개${teacherText}</span>${restricted}</li>`;
        }).join("")}</ul>`
      : `<div class="tt-auto-compare-ok">미배치 수업 유닛이 없습니다.</div>`;

    return `<div class="tt-auto-progress-failed tt-auto-outcome-box">`
      + `<b>자동배치 결과 분석</b>`
      + `<div class="tt-auto-outcome-grid">`
      + `<span><em>신규 배치</em><strong>${Number(outcome.placedEntryCount || 0)}</strong><small>entry</small></span>`
      + `<span><em>수업 블록</em><strong>${Number(outcome.placedBlockCount || 0)}</strong><small>unit</small></span>`
      + `<span><em>그룹 블록</em><strong>${Number(outcome.placedGroupBlockCount || 0)}</strong><small>unit</small></span>`
      + `<span><em>일반 블록</em><strong>${Number(outcome.placedStandaloneBlockCount || 0)}</strong><small>unit</small></span>`
      + `<span><em>배치 카드</em><strong>${Number(outcome.placedCardCount || 0)}</strong><small>card</small></span>`
      + `<span class="${outcome.failedUnitCount ? "warn" : "ok"}"><em>미배치 유닛</em><strong>${Number(outcome.failedUnitCount || 0)}</strong><small>${Number(outcome.failedOccurrenceCount || 0)}회차</small></span>`
      + `</div>`
      + `<div class="tt-auto-outcome-note">카드 수가 아니라 같은 시간에 함께 움직이는 <b>수업 블록/유닛</b> 기준으로 자동배치 결과를 해석합니다.</div>`
      + (outcome.forcedEntryCount ? `<div class="tt-auto-outcome-note warn">보정 배치 ${Number(outcome.forcedEntryCount || 0)}개 entry / ${Number(outcome.forcedBlockCount || 0)}개 블록이 있습니다. 충돌 표시를 확인해 주세요.</div>` : "")
      + (outcome.missingRoomEntryCount ? `<div class="tt-auto-outcome-note warn">교실 미배정 ${Number(outcome.missingRoomEntryCount || 0)}개 entry / ${Number(outcome.missingRoomBlockCount || 0)}개 블록이 있습니다.</div>` : "")
      + `<div class="tt-auto-outcome-failed"><b>남은 수업 유닛</b>${failedHtml}</div>`
      + `</div>`;
  }

  function escapeReportHtml(value = "") {
    return String(value ?? "").replace(/[<>&"']/g, ch => ({
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "\"": "&quot;",
      "'": "&#39;"
    }[ch] || ch));
  }

  function makeDeltaText(before, after, suffix = "") {
    const b = Number(before) || 0;
    const a = Number(after) || 0;
    const d = a - b;
    if (d === 0) return `<span class="tt-auto-compare-same">변화 없음</span>`;
    const sign = d > 0 ? "+" : "";
    const cls = d > 0 ? "tt-auto-compare-up" : "tt-auto-compare-down";
    return `<span class="${cls}">${sign}${d}${suffix}</span>`;
  }

  function compareMetricRow(label, before, after, suffix = "") {
    return `<tr>`
      + `<th>${escapeReportHtml(label)}</th>`
      + `<td>${escapeReportHtml(before)}${suffix}</td>`
      + `<td>${escapeReportHtml(after)}${suffix}</td>`
      + `<td>${makeDeltaText(before, after, suffix)}</td>`
      + `</tr>`;
  }

  function buildAutoAssignComparisonHtml(preReport = {}, postReport = {}) {
    // 11단계에서 결과 비교표 호출부가 먼저 들어가고, 함수 정의가 누락되어
    // ReferenceError가 발생했습니다. 비교표는 UI 보조 기능이므로 항상 안전하게
    // HTML을 반환하도록 방어적으로 작성합니다.
    try {
      const preClass = preReport.classSlots || {};
      const postClass = postReport.classSlots || {};
      const preRestricted = preReport.restrictedTeachers || {};
      const postRestricted = postReport.restrictedTeachers || {};
      const preProtected = preReport.protectedIntrusions || {};
      const postProtected = postReport.protectedIntrusions || {};
      const rows = [
        compareMetricRow("학급 시수 합계", preClass.total ?? 0, postClass.total ?? 0, "시수"),
        compareMetricRow("시수 불일치 학급", preClass.issueCount ?? 0, postClass.issueCount ?? 0, "개"),
        compareMetricRow("제약교사 위반", preRestricted.issueCount ?? 0, postRestricted.issueCount ?? 0, "명"),
        compareMetricRow("고정/보호 침범", preProtected.total ?? 0, postProtected.total ?? 0, "건"),
        compareMetricRow("교실 미배정", preReport.missingRoomCount ?? 0, postReport.missingRoomCount ?? 0, "개"),
        compareMetricRow("미배치 카드", preReport.failedCount ?? 0, postReport.failedCount ?? 0, "개")
      ].join("");

      const classIssues = (postClass.issues || []).slice(0, 8);
      const issueList = classIssues.length
        ? `<ul>${classIssues.map(row => `<li>${escapeReportHtml(formatClassKeyForReport(row.key))}: ${escapeReportHtml(row.count)}/${escapeReportHtml(row.target)}시수 (${row.diff < 0 ? `${Math.abs(row.diff)} 부족` : `${row.diff} 초과`})</li>`).join("")}${(postClass.issues || []).length > 8 ? `<li>외 ${(postClass.issues || []).length - 8}개 학급</li>` : ""}</ul>`
        : `<div class="tt-auto-compare-ok">학급별 기준 시수를 모두 충족했습니다.</div>`;

      return `<div class="tt-auto-progress-failed tt-auto-compare-box">`
        + `<b>자동배치 전/후 비교</b>`
        + `<table class="tt-auto-compare-table"><thead><tr><th>항목</th><th>이전</th><th>이후</th><th>변화</th></tr></thead><tbody>${rows}</tbody></table>`
        + `<div class="tt-auto-compare-summary"><b>이후 상태</b>: ${escapeReportHtml(postReport.summary || "-")}</div>`
        + issueList
        + `</div>`;
    } catch (err) {
      console.warn("Failed to build auto assign comparison html:", err);
      return `<div class="tt-auto-progress-failed"><b>자동배치 전/후 비교</b><br>비교표 생성 중 오류가 있었지만 자동배치 결과는 반영되었습니다.</div>`;
    }
  }


  function getRoomCapacity(room = {}) {
    const n = Number(room.capacity);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function getAudienceSizeForRoom(data = {}) {
    // 학생 개인 key는 시간표 배치 단계에서 사용하지 않습니다.
    // 교실 후보 정렬에서도 학생 수 기반 보정보다 교사 교실 고정 규칙을 먼저 적용합니다.
    return 0;
  }

  function isSpecialPurposeRoomForAuto(room = {}) {
    const type = cleanStr(room?.type || "일반");
    return !!type && type !== "일반";
  }

  function isAutoAssignableGeneralRoom(room = {}) {
    // r209: 교사 이름이 붙은 일반 교실도 그 시간에 비어 있으면 다른 교사가 사용할 수 있습니다.
    // 다만 음악실/과학실/체육관 등 특수 교실은 자동 보조 교실 후보에서 제외하고,
    // 지정교실/홈룸/교사 고정교실로 명시된 경우에만 사용합니다.
    return !!room?.id && !isSpecialPurposeRoomForAuto(room);
  }

  function sortRoomCandidatesFor(data = {}) {
    const size = getAudienceSizeForRoom(data);
    return [...(appState.rooms?.rooms || [])]
      .filter(isAutoAssignableGeneralRoom)
      .filter(room => room?.id)
      .map((room, idx) => ({ room, idx }))
      .sort((a, b) => {
        const ag = a.room.type === "일반" ? 0 : 1;
        const bg = b.room.type === "일반" ? 0 : 1;
        if (ag !== bg) return ag - bg;
        const ac = getRoomCapacity(a.room);
        const bc = getRoomCapacity(b.room);
        const aFit = !size || !ac || ac >= size ? 0 : 1;
        const bFit = !size || !bc || bc >= size ? 0 : 1;
        if (aFit !== bFit) return aFit - bFit;
        if (ac !== bc) return ac - bc;
        return String(a.room.name || "").localeCompare(String(b.room.name || ""), "ko", { numeric: true }) || a.idx - b.idx;
      })
      .map(x => x.room);
  }

  function cardNeedsRoomForAuto(card = {}, entryData = {}) {
    const rule = normalizeRoomRuleForAuto(card.roomRule || entryData.roomRule || "teacher");
    return rule !== "none";
  }

  function cardTeacherName(card = {}) {
    return [...new Set(getTeachersForTtCard(card).filter(Boolean))].join(",");
  }

  function roomAvailableForGroupPart(roomId, slot = {}, taken = new Set()) {
    const id = cleanStr(roomId);
    return !!id && !taken.has(id) && !isRoomUnavailable(id, slot.day, slot.period);
  }

  function allowAutoRoomAssignment(options = {}) {
    return options?.allowAutoRoomAssignment === true || currentAllowAutoRoomAssignment === true;
  }

  function roomBusyForCandidate(roomId, candidate = {}, slot = {}, placed = []) {
    const id = cleanStr(roomId);
    if (!id) return true;
    return [...entries(), ...placed].some(e => {
      if (!(Number(e?.day) === Number(slot.day) && Number(e?.period) === Number(slot.period))) return false;
      if (sameUnitPlacement(candidate, e)) return false;
      return roomIdsForPlacement(e).includes(id);
    });
  }

  function chooseAutoRoomIdForPlacement(candidate = {}, slot = {}, placed = [], taken = new Set()) {
    const rooms = sortRoomCandidatesFor(candidate);
    const pool = typeof shuffle === "function" ? shuffle([...rooms]) : [...rooms];
    for (const room of pool) {
      const id = cleanStr(room?.id);
      if (!id) continue;
      if (taken?.has?.(id)) continue;
      if (isRoomUnavailable(id, slot.day, slot.period)) continue;
      if (roomBusyForCandidate(id, candidate, slot, placed)) continue;
      return id;
    }
    return "";
  }

  function assignRoomsForGroupedEntry(entryData = {}, slot = entryData, placed = [], options = {}) {
    const ids = ttCardIdsFromPlacement(entryData);
    if (ids.length <= 1 && !entryData.groupId) return entryData;

    const assignments = { ...(entryData.roomAssignmentsByTtCardId || {}) };
    const configuredExtraRooms = [];
    ids.forEach(id => {
      const card = getTtCardById(id);
      if (!card || !cardNeedsRoomForAuto(card, entryData)) { delete assignments[id]; return; }

      const rule = normalizeRoomRuleForAuto(card.roomRule || entryData.roomRule || "teacher");
      const configuredRooms = configuredRoomIdsForCardDuringAuto(card, entryData);
      if (configuredRooms.length) {
        assignments[id] = configuredRooms[0];
        configuredExtraRooms.push(...configuredRooms.slice(1));
        return;
      }
      if (rule === "autoRoom" || allowAutoRoomAssignment(options)) {
        const taken = new Set([...Object.values(assignments), ...configuredExtraRooms].map(cleanStr).filter(Boolean));
        const autoRoomId = chooseAutoRoomIdForPlacement({ ...entryData, ttcardId: id, ttcardIds: [id] }, slot, placed, taken);
        if (autoRoomId) { assignments[id] = autoRoomId; return; }
      }
      delete assignments[id];
    });

    const requiredRooms = Math.max(1, itemRequiredRoomCount(entryData));
    const taken = new Set([...Object.values(assignments), ...configuredExtraRooms].map(cleanStr).filter(Boolean));
    const extraRooms = [...new Set(configuredExtraRooms.map(cleanStr).filter(Boolean))];
    while (taken.size < requiredRooms) {
      const autoRoomId = chooseAutoRoomIdForPlacement(entryData, slot, placed, taken);
      if (!autoRoomId) break;
      taken.add(autoRoomId);
      extraRooms.push(autoRoomId);
    }

    entryData.roomAssignmentsByTtCardId = assignments;
    entryData.roomIds = uniqueRoomIds([...Object.values(assignments), ...extraRooms]);
    entryData.requiredRoomCount = requiredRooms;
    entryData.roomRule = entryData.roomRule || "teacher";
    entryData.roomId = null;
    entryData.roomPinned = false;
    // r219: 필요교실수가 설정된 그룹수업은 카드별 교실 외에도 같은 시간에 빈 교실을 추가 확보합니다.
    return entryData;
  }

  function applyAutoRoomToEntryData(data = {}, slot = data, placed = [], options = {}) {
    const entryData = { ...data };
    const cardIds = ttCardIdsFromPlacement(entryData);
    if (entryData.groupId || cardIds.length > 1) return assignRoomsForGroupedEntry(entryData, slot, placed, options);

    const rule = normalizeRoomRuleForAuto(entryData.roomRule || "teacher");
    if (rule === "none") return { ...entryData, roomId: null };

    const singleCard = cardIds.length === 1 ? getTtCardById(cardIds[0]) : null;
    const configuredRoomIds = singleCard ? configuredRoomIdsForCardDuringAuto(singleCard, entryData) : [];
    if (configuredRoomIds.length) {
      entryData.roomId = configuredRoomIds[0];
      entryData.roomIds = uniqueRoomIds(configuredRoomIds);
      entryData.requiredRoomCount = Math.max(itemRequiredRoomCount(entryData), configuredRoomIds.length);
      entryData.multiRoomCount = entryData.requiredRoomCount;
      entryData.roomAssignmentsByTtCardId = cardIds.length === 1 ? { ...(entryData.roomAssignmentsByTtCardId || {}), [cardIds[0]]: configuredRoomIds[0] } : entryData.roomAssignmentsByTtCardId;
      entryData.roomRule = entryData.roomRule || "teacher";
      return entryData;
    }

    const fixedRoomId = fixedRoomForAutoData(entryData);
    if (fixedRoomId) {
      entryData.roomId = fixedRoomId;
      entryData.roomIds = uniqueRoomIds([fixedRoomId]);
      entryData.roomRule = entryData.roomRule || "teacher";
      return entryData;
    }

    if (rule === "autoRoom" || allowAutoRoomAssignment(options) || itemRequiredRoomCount(entryData) > 1) {
      const autoRoomId = chooseAutoRoomIdForPlacement(entryData, slot, placed);
      if (autoRoomId) {
        entryData.roomId = autoRoomId;
        entryData.roomIds = uniqueRoomIds([autoRoomId]);
        entryData.roomRule = entryData.roomRule || "teacher";
        entryData.roomPinned = false;
        entryData.autoRoomAssigned = true;
        return entryData;
      }
    }

    // r115: 교사 교실/지정교실이 없으면 기본값에서는 배치하지 않습니다.
    // 단, 기존 보호 배치의 화면 표시는 방 미배정 상태로 남깁니다.
    entryData.roomId = null;
    entryData.roomPinned = false;
    return entryData;
  }

  function hydrateAutoRoomsForEntries(list = []) {
    const hydrated = [];
    for (const raw of list || []) {
      const base = normalizeTimetableEntry({ ...raw });
      const next = applyAutoRoomToEntryData(base, base, hydrated);
      if (next && !next.roomPinned) {
        if (next.groupId || ttCardIdsFromPlacement(next).length > 1) {
          next.roomRule = next.roomRule || "teacher";
        } else {
          next.roomRule = next.roomRule || "teacher";
        }
      }
      hydrated.push(normalizeTimetableEntry(next || base));
    }
    return hydrated;
  }


  function addReason(reasonMap, code, label, detail = "") {
    if (!reasonMap.has(code)) reasonMap.set(code, { code, label, count: 0, samples: [] });
    const item = reasonMap.get(code);
    item.count += 1;
    if (detail && item.samples.length < 3 && !item.samples.includes(detail)) item.samples.push(detail);
  }

  function formatSlotLabel(slot = {}) {
    const dayLabels = ["월", "화", "수", "목", "금"];
    const periodLabel = ttConfig().periodLabels?.[slot.period] || `${Number(slot.period || 0) + 1}교시`;
    return `${dayLabels[slot.day] ?? "?"} ${periodLabel}`;
  }

  function analyzePlacementSlot(item, slot, placed, options = {}) {
    const { respectSoftLimits = true, respectUnavailable = true, respectAssignedRoom = true } = options;
    const existing = [...entries(), ...placed];
    const slotEnts = existing.filter(e => e.day === slot.day && e.period === slot.period);
    const teachers = getTeachersForAutoItem(item);
    const reasons = new Map();

    const strongProtected = strongProtectedSlotConflict(item, slot, placed);
    if (strongProtected) {
      addReason(reasons, strongProtected.code || "protectedSlot", strongProtected.label || "고정/보호 수업 시간", strongProtected.detail || `${formatSlotLabel(slot)} 보호 슬롯`);
    }

    const exclusion = slotEnts.find(e => hasAutoGroupExclusionSlotConflict(item, e));
    if (exclusion) {
      addReason(reasons, "groupExclusion", "그룹 제외 카드와 같은 시간", `${formatSlotLabel(slot)} · ${getAutoItemName(exclusion)}`);
    }

    if (hasInternalCompoundSiblingConflict(item)) {
      addReason(reasons, "compoundInternal", "복합과목 구성 충돌", "같은 복합과목의 다른 파트가 한 배치 안에 섞임");
    }
    const compoundOther = slotEnts.find(e => hasCompoundSiblingConflict(item, e));
    if (compoundOther) {
      addReason(reasons, "compoundSibling", "복합과목 파트 시간 중복", `${formatSlotLabel(slot)} · ${getAutoItemName(compoundOther)}`);
    }

    const itemCardIds = new Set(ttCardIdsFromPlacement(item));
    const duplicate = itemCardIds.size
      ? slotEnts.find(e => ttCardIdsFromPlacement(e).some(id => itemCardIds.has(id)))
      : slotEnts.find(e => e.templateId === item.templateId && e.gradeKey === item.gradeKey && (e.sectionIdx ?? 0) === (item.sectionIdx ?? 0));
    if (duplicate) {
      addReason(reasons, "duplicate", "동일 카드 중복", `${formatSlotLabel(slot)}에 이미 같은 카드 배치`);
    }

    const dayDuplicate = itemCardIds.size
      ? [...entries(), ...placed].find(e => e.day === slot.day && ttCardIdsFromPlacement(e).some(id => itemCardIds.has(id)))
      : [...entries(), ...placed].find(e => e.day === slot.day && e.templateId === item.templateId && e.gradeKey === item.gradeKey && (e.sectionIdx ?? 0) === (item.sectionIdx ?? 0));
    if (dayDuplicate) {
      addReason(reasons, "sameDayDuplicate", "동일 수업 하루 2회", `${formatSlotLabel(slot)} · 같은 수업은 하루에 한 번만 배치`);
    }

    for (const e of slotEnts) {
      const et = teacherNamesForPlacement(e);
      const overlapTeacher = teachers.find(t => et.includes(t));
      if (overlapTeacher && !(item.unitId && e.unitId && item.unitId === e.unitId)) {
        addReason(reasons, "teacherConflict", "교사 시간 충돌", `${formatSlotLabel(slot)} · ${overlapTeacher} / ${getAutoItemName(e)}`);
      }
    }

    const itemAudience = audienceForPlacement(item);
    for (const e of slotEnts) {
      if (item.unitId && e.unitId && item.unitId === e.unitId) continue;
      const sameGrp = sameActiveGroup(item, e);
      const conc = sameGrp && isConcurrentItem(item) && isConcurrentItem(e);
      // 같은 동시배정 그룹은 사전작업에서 한 수업묶음으로 확정한 병렬 수업입니다.
      // 학생 개인 단위 비교는 여기서 하지 않고, 같은 그룹이 아닌 경우에만 학급 중복을 막습니다.
      if (conc) continue;
      const eAudience = audienceForPlacement(e);
      const conflict = audiencesConflict(itemAudience, eAudience);
      if (conflict) addReason(reasons, "studentConflict", "학급 시간 충돌", `${formatSlotLabel(slot)} · ${getAutoItemName(e)}`);
    }

    for (const teacher of teachers) {
      const c = constraints()?.[teacher] || {};
      const restrictedTeacher = isRestrictedTeacher(teacher);
      const enforceLimits = respectSoftLimits || restrictedTeacher;

      if ((respectUnavailable || restrictedTeacher) && c?.unavailableSlots?.some(s => s.day === slot.day && s.period === slot.period)) {
        addReason(reasons, "teacherUnavailable", "교사 불가시간", `${formatSlotLabel(slot)} · ${teacher}`);
      }

      const limit = getTeacherLimitState(teacher, slot, existing);
      if (enforceLimits && limit.wouldExceedWeek) {
        addReason(reasons, "teacherWeekLimit", "교사 주 최대 시수 초과", `${teacher} · 주 ${limit.weekLoad}/${limit.maxPerWeek}시수 사용 중`);
      }
      if (enforceLimits && limit.wouldExceedDay) {
        addReason(reasons, "teacherDayLimit", "교사 하루 최대 시수 초과", `${formatSlotLabel(slot)} · ${teacher} · 당일 ${limit.dayLoad}/${limit.maxPerDay}시수`);
      }
      if (enforceLimits && limit.wouldExceedConsecutive) {
        addReason(reasons, "teacherConsecutive", "교사 연속수업 제한", `${formatSlotLabel(slot)} · ${teacher} · 연속 ${limit.nextConsecutive}시수`);
      }
    }

    const candidateRoomData = applyAutoRoomToEntryData({ ...item, ...slot }, slot, placed, options);
    if (respectAssignedRoom && entryHasMissingRoomForAuto(candidateRoomData)) {
      addReason(reasons, "roomMissing", "교실 설정 없음", `${formatSlotLabel(slot)} · 교사 교실/지정교실 없음`);
    }
    if (respectAssignedRoom && roomUnavailableInSlot(candidateRoomData, slot)) {
      const roomName = getRoomByIdLocal(candidateRoomData.roomId)?.name || candidateRoomData.roomId || "교실";
      addReason(reasons, "roomUnavailable", "교실 불가시간", `${formatSlotLabel(slot)} · ${roomName}`);
    }
    if (respectAssignedRoom && roomConflictsInSlot(candidateRoomData, slot, placed)) {
      const roomName = (appState.rooms?.rooms || []).find(r => r.id === candidateRoomData.roomId)?.name || candidateRoomData.roomId || "교실";
      addReason(reasons, "roomConflict", "교실 시간 충돌", `${formatSlotLabel(slot)} · ${roomName}`);
    }

    // r209: 교사 고정교실은 해당 교사의 기본 수업 교실일 뿐,
    // 교사가 수업이 없는 시간까지 예약된 전용실로 보지 않습니다.
    // 따라서 별도 teacherRoomBusy 가상 충돌은 만들지 않고,
    // 같은 시간 같은 교실을 실제로 쓰는 경우만 roomConflict로 처리합니다.

    return { valid: reasons.size === 0, reasons: [...reasons.values()] };
  }

  function reasonCodesFromResult(result) {
    return new Set((result?.reasons || []).map(r => r.code || r.label).filter(Boolean));
  }

  function countSlotsIfIgnoringReasons(item, baseSlots = [], placed = [], options = {}, ignoredCodes = []) {
    const ignore = new Set(ignoredCodes || []);
    let count = 0;
    for (const slot of baseSlots) {
      const result = analyzePlacementSlot(item, slot, placed, options);
      if (result.valid) {
        count += 1;
        continue;
      }
      const codes = reasonCodesFromResult(result);
      if (codes.size && [...codes].every(code => ignore.has(code))) count += 1;
    }
    return count;
  }

  function buildRelaxationSuggestions(diag = {}, item, baseSlots = [], placed = [], options = {}) {
    if (!item) return [];
    const topReasonCodes = new Set((diag.topReasons || []).map(r => r.code || r.label).filter(Boolean));
    const teacherNames = getTeachersForAutoItem(item);
    const restrictedTeachers = getRestrictedTeachersForAutoItem(item);
    const teacherText = restrictedTeachers.length ? restrictedTeachers.join(', ') : teacherNames.join(', ');
    const currentValid = Number(diag.validSlots || 0);

    const candidates = [
      {
        codes: ['teacherUnavailable'],
        title: '교사 불가시간 일부 조정',
        detail: `${teacherText || '담당 교사'}의 불가시간 중 실제로 열 수 있는 1~2칸을 가능 시간으로 바꾸면 배치 여지가 생길 수 있습니다.`,
        priority: 1
      },
      {
        codes: ['teacherWeekLimit'],
        title: '교사 주 최대시수 상향',
        detail: `${teacherText || '담당 교사'}의 주 최대시수를 1~2시수 높이거나 해당 수업을 다른 교사에게 분산하는 방안입니다.`,
        priority: 1
      },
      {
        codes: ['teacherDayLimit'],
        title: '교사 하루 최대시수 완화',
        detail: `${teacherText || '담당 교사'}의 특정 요일 하루 최대시수를 1시수 늘리거나 다른 요일로 고정 수업을 이동해 보세요.`,
        priority: 1
      },
      {
        codes: ['teacherConsecutive'],
        title: '교사 연속수업 제한 완화',
        detail: `${teacherText || '담당 교사'}의 최대 연속수업 제한을 1교시 완화하거나 앞뒤 수업 중 하나를 다른 시간으로 이동하는 방안입니다.`,
        priority: 1
      },
      {
        codes: ['roomConflict'],
        title: '교실 조건 완화',
        detail: '같은 시간에 실제로 같은 교실을 쓰는 수업을 이동하거나, 대체 일반교실을 지정하면 배치 가능한 시간이 늘어날 수 있습니다.',
        priority: 2
      },
      {
        codes: ['protectedSlot'],
        title: '고정/보호 수업 일부 해제',
        detail: '해당 학급·교사·교실을 막고 있는 고정 수업 1개를 이동하거나 잠금 해제 후 다시 자동배치해 보세요.',
        priority: 3
      },
      {
        codes: ['studentConflict'],
        title: '학급 충돌 수업 이동',
        detail: '같은 반이 이미 점유한 시간 때문에 막힌 경우입니다. 해당 시간대의 기존 수업을 먼저 이동하면 해결될 수 있습니다.',
        priority: 3
      },
      {
        codes: ['groupExclusion'],
        title: '그룹 제외 카드 설정 확인',
        detail: '자동 그룹에서 제외된 카드가 같은 시간에 배치되며 충돌합니다. 그룹 포함/제외 설정을 다시 확인해 주세요.',
        priority: 2
      },
      {
        codes: ['compoundSibling', 'compoundInternal'],
        title: '복합과목 파트 배치 방식 조정',
        detail: '복합과목의 파트가 같은 시간에 겹치지 않도록 파트별 고정 시간을 나누거나 수동 배치 후 고정해 주세요.',
        priority: 2
      },
      {
        codes: ['duplicate'],
        title: '중복 카드 정리',
        detail: '같은 카드가 이미 같은 시간에 배치되어 있습니다. 카드 데이터 갱신 또는 중복 배치 삭제 후 다시 시도해 주세요.',
        priority: 1
      },
      {
        codes: ['teacherUnavailable', 'teacherWeekLimit', 'teacherDayLimit', 'teacherConsecutive'],
        title: '교사 제약 조건 전체 재검토',
        detail: `${teacherText || '담당 교사'}의 가능시간·주 최대·하루 최대·연속수업 제한을 함께 조정해야 할 가능성이 큽니다.`,
        priority: 4
      },
      {
        codes: ['protectedSlot', 'studentConflict'],
        title: '고정 수업과 학급 충돌 함께 조정',
        detail: '고정된 채플·자율·동아리 또는 기존 수업이 학급 슬롯을 막고 있습니다. 고정 수업 1개를 옮긴 뒤 미배치만 자동배치해 보세요.',
        priority: 5
      }
    ];

    const suggestions = [];
    for (const cand of candidates) {
      if (!cand.codes.some(code => topReasonCodes.has(code))) continue;
      const availableAfter = countSlotsIfIgnoringReasons(item, baseSlots, placed, options, cand.codes);
      if (availableAfter <= currentValid) continue;
      suggestions.push({
        ...cand,
        availableAfter,
        gain: availableAfter - currentValid,
        summary: `${cand.title}: ${availableAfter}칸 가능`
      });
    }

    if (!suggestions.length && currentValid > 0) {
      suggestions.push({
        codes: ['searchOrder'],
        title: '배치 강도 상향',
        detail: '가능한 후보 시간이 남아 있습니다. 자동배치 옵션에서 정교한 배치 또는 현재 배치 유지 + 미배치만 배치를 다시 실행해 보세요.',
        availableAfter: currentValid,
        gain: 0,
        priority: 9,
        summary: `배치 강도 상향: 후보 ${currentValid}칸`
      });
    }

    if (!suggestions.length) {
      suggestions.push({
        codes: ['manualReview'],
        title: '수동 고정 후 재시도',
        detail: '단일 조건 완화만으로는 후보 시간이 열리지 않습니다. 관련 교사/학급의 수업 1~2개를 수동 이동·고정한 뒤 미배치만 자동배치해 주세요.',
        availableAfter: 0,
        gain: 0,
        priority: 10,
        summary: '수동 고정 후 재시도'
      });
    }

    return suggestions
      .sort((a, b) => a.priority - b.priority || b.gain - a.gain || b.availableAfter - a.availableAfter)
      .slice(0, 3);
  }


  function targetCreditsForAutoItem(item = {}) {
    const ids = ttCardIdsFromPlacement(item).filter(Boolean);
    const credits = ids.map(id => Math.max(0, Number(getTtCardById(id)?.credits ?? 0))).filter(n => n > 0);
    if (credits.length) return Math.max(...credits);
    return Math.max(1, Number(item.credits || 1));
  }

  function placedSlotCountForAutoItem(item = {}, placed = []) {
    const ids = new Set(ttCardIdsFromPlacement(item).filter(Boolean));
    const slots = new Set();
    [...entries(), ...(placed || [])].forEach(entry => {
      if (!Number.isInteger(entry?.day) || !Number.isInteger(entry?.period)) return;
      const entryIds = ttCardIdsFromPlacement(entry);
      const matchById = ids.size && entryIds.some(id => ids.has(id));
      const matchByShape = !ids.size && entryMatchesAutoItem(entry, item);
      if (matchById || matchByShape) slots.add(`${entry.day}:${entry.period}`);
    });
    return slots.size;
  }

  function classLabelSummaryForAutoItem(item = {}) {
    const labels = classKeysForCapacity(item).map(formatClassKeyForReport);
    return [...new Set(labels)].slice(0, 8).join(", ");
  }

  function summarizeFailedPlacement(failedItem, baseSlots = [], placed = [], options = {}) {
    const item = failedItem?.item;
    const name = failedItem?.name || getAutoItemName(item);
    if (!item) {
      return { name, validSlots: 0, totalSlots: baseSlots.length, topReasons: [{ label: "카드 정보 없음", count: 1, samples: [] }], summary: "배치 대상 카드 정보를 찾지 못했습니다." };
    }
    const reasonMap = new Map();
    let validSlots = 0;
    for (const slot of baseSlots) {
      const result = analyzePlacementSlot(item, slot, placed, options);
      if (result.valid) validSlots += 1;
      result.reasons.forEach(r => {
        if (!reasonMap.has(r.code)) reasonMap.set(r.code, { code: r.code, label: r.label, count: 0, samples: [] });
        const dest = reasonMap.get(r.code);
        dest.count += r.count;
        (r.samples || []).forEach(sample => {
          if (sample && dest.samples.length < 3 && !dest.samples.includes(sample)) dest.samples.push(sample);
        });
      });
    }
    const topReasons = [...reasonMap.values()].sort((a, b) => b.count - a.count).slice(0, 5);
    const teachers = getTeachersForAutoItem(item);
    const restrictedTeachers = getRestrictedTeachersForAutoItem(item);
    const reasonText = topReasons.length
      ? topReasons.slice(0, 3).map(r => `${r.label} ${r.count}칸`).join(" · ")
      : (validSlots ? "후보 시간은 있으나 보정 단계에서 다른 카드와 충돌" : "후보 시간 없음");
    const requiredCredits = targetCreditsForAutoItem(item);
    const placedSlots = placedSlotCountForAutoItem(item, placed);
    const missingSlots = Math.max(0, requiredCredits - placedSlots);
    const diag = {
      name,
      groupName: failedItem?.groupId ? (ttGroups().find(g => g.id === failedItem.groupId)?.name || "") : "",
      teachers,
      restrictedTeachers,
      classLabels: classLabelSummaryForAutoItem(item),
      requiredCredits,
      placedSlots,
      missingSlots,
      validSlots,
      totalSlots: baseSlots.length,
      topReasons,
      summary: `시수 ${placedSlots}/${requiredCredits}${missingSlots ? ` (${missingSlots} 부족)` : ""} · 가능 ${validSlots}/${baseSlots.length}칸 · ${reasonText}`
    };
    diag.suggestions = buildRelaxationSuggestions(diag, item, baseSlots, placed, options);
    diag.suggestionSummary = (diag.suggestions || []).map(s => s.summary || s.title).join(' / ');
    return diag;
  }

  function buildFailureDiagnostics(failedItems = [], baseSlots = [], placed = [], options = {}) {
    const byName = new Map();
    (failedItems || []).forEach(failedItem => {
      const diag = summarizeFailedPlacement(failedItem, baseSlots, placed, options);
      const key = diag.name || "미확인 카드";
      if (!byName.has(key)) {
        byName.set(key, { ...diag, occurrences: 0 });
      }
      const acc = byName.get(key);
      acc.occurrences += 1;
      acc.requiredCredits = Math.max(Number(acc.requiredCredits || 0), Number(diag.requiredCredits || 0));
      acc.placedSlots = Math.max(Number(acc.placedSlots || 0), Number(diag.placedSlots || 0));
      acc.missingSlots = Math.max(0, Number(acc.requiredCredits || 0) - Number(acc.placedSlots || 0));
      if (!acc.classLabels && diag.classLabels) acc.classLabels = diag.classLabels;
      // 여러 회차가 같은 이름으로 실패하면 가능한 시간은 가장 보수적으로 낮은 값을 표시합니다.
      acc.validSlots = Math.min(acc.validSlots, diag.validSlots);
      const mergedReasons = new Map((acc.topReasons || []).map(r => [r.code || r.label, { ...r, samples: [...(r.samples || [])] }]));
      (diag.topReasons || []).forEach(r => {
        const k = r.code || r.label;
        if (!mergedReasons.has(k)) mergedReasons.set(k, { ...r, samples: [...(r.samples || [])] });
        else {
          const cur = mergedReasons.get(k);
          cur.count += r.count;
          (r.samples || []).forEach(sample => {
            if (sample && cur.samples.length < 3 && !cur.samples.includes(sample)) cur.samples.push(sample);
          });
        }
      });
      acc.topReasons = [...mergedReasons.values()].sort((a, b) => b.count - a.count).slice(0, 5);
      acc.summary = `시수 ${Number(acc.placedSlots || 0)}/${Number(acc.requiredCredits || 0)}${Number(acc.missingSlots || 0) ? ` (${Number(acc.missingSlots || 0)} 부족)` : ""} · 가능 ${acc.validSlots}/${acc.totalSlots}칸 · ${acc.topReasons.slice(0, 3).map(r => `${r.label} ${r.count}칸`).join(" · ") || "후보 시간 없음"}`;
      const mergedSuggestions = new Map((acc.suggestions || []).map(s => [s.title, s]));
      (diag.suggestions || []).forEach(sug => {
        if (!mergedSuggestions.has(sug.title)) mergedSuggestions.set(sug.title, sug);
        else {
          const cur = mergedSuggestions.get(sug.title);
          cur.availableAfter = Math.max(Number(cur.availableAfter || 0), Number(sug.availableAfter || 0));
          cur.gain = Math.max(Number(cur.gain || 0), Number(sug.gain || 0));
          cur.summary = `${cur.title}: ${cur.availableAfter}칸 가능`;
        }
      });
      acc.suggestions = [...mergedSuggestions.values()]
        .sort((a, b) => Number(a.priority || 9) - Number(b.priority || 9) || Number(b.gain || 0) - Number(a.gain || 0) || Number(b.availableAfter || 0) - Number(a.availableAfter || 0))
        .slice(0, 3);
      acc.suggestionSummary = (acc.suggestions || []).map(s => s.summary || s.title).join(' / ');
    });
    return [...byName.values()].sort((a, b) => a.validSlots - b.validSlots || b.occurrences - a.occurrences || String(a.name).localeCompare(String(b.name), "ko"));
  }



  function summarizeBlockForResidualReport(block = {}, targetSlot = {}, current = [], orderedSlots = [], options = {}) {
    const entriesList = Array.isArray(block.entries) ? block.entries : [];
    const names = [...new Set(entriesList.map(e => getAutoItemName(e)).filter(Boolean))];
    const teachers = [...new Set(entriesList.flatMap(e => splitTeacherNames(e.teacherName || "")).filter(Boolean))];
    const classes = [...new Set(entriesList.flatMap(e => entryClassKeysForScoring(e).map(formatClassKeyForReport)).filter(Boolean))];
    const blockIds = new Set(entriesList.map(e => e.id).filter(Boolean));
    const withoutBlock = current.filter(e => !blockIds.has(e.id));
    const moveCandidates = [];
    for (const slot of orderedSlots) {
      if (slot.day === targetSlot.day && slot.period === targetSlot.period) continue;
      const moved = makeMovedBlockEntries(block, slot, withoutBlock, {
        ...options,
        runAttempts: "deep",
        engineProfile: autoEngineProfileForMode("deep"),
        respectUnavailable: true,
        respectAssignedRoom: true,
        // r35 diagnostic: hard conflict는 유지하고, 하루/연속 같은 soft limit만 별도 판단할 수 있게 합니다.
        respectSoftLimits: options.respectSoftLimits !== false
      });
      if (moved) {
        moveCandidates.push(formatSlotLabel(slot));
        if (moveCandidates.length >= 5) break;
      }
    }
    return {
      key: String(block.key || ""),
      names: names.slice(0, 4),
      teachers: teachers.slice(0, 4),
      classes: classes.slice(0, 6),
      movable: moveCandidates.length > 0,
      moveCandidateCount: moveCandidates.length,
      moveCandidates
    };
  }

  function buildResidualPuzzleReport(failedItems = [], baseSlots = [], placed = [], options = {}) {
    const orderedSlots = [...baseSlots].sort((a, b) => a.day - b.day || a.period - b.period);
    const reportRows = [];
    const sourceItems = Array.isArray(failedItems) ? failedItems : [];
    const byItemKey = new Map();
    for (const failedItem of sourceItems) {
      const item = failedItem?.item;
      if (!item) continue;
      const key = String(item.id || failedItem.key || failedItem.name || getAutoItemName(item) || "");
      if (!key) continue;
      if (!byItemKey.has(key)) byItemKey.set(key, failedItem);
    }

    for (const failedItem of [...byItemKey.values()].slice(0, 20)) {
      const item = failedItem?.item;
      if (!item) continue;
      const name = failedItem.name || getAutoItemName(item);
      const classLabels = classLabelSummaryForAutoItem(item);
      const teachers = getTeachersForAutoItem(item);
      const requiredCredits = targetCreditsForAutoItem(item);
      const placedSlots = placedSlotCountForAutoItem(item, placed);
      const missingSlots = Math.max(0, requiredCredits - placedSlots);
      const directSlots = [];
      const reviewOneMoveSlots = [];
      const executableOneMoveSlots = [];
      const hardBlockedSlots = [];
      for (const slot of orderedSlots) {
        const analyzed = analyzePlacementSlot(item, slot, placed, options);
        if (analyzed.valid) {
          directSlots.push(formatSlotLabel(slot));
          continue;
        }
        const codes = new Set((analyzed.reasons || []).map(r => r.code));
        const blockers = getBlockingBlocksForSlot(item, slot, placed);
        const unmovableHard = [...codes].some(code => ["protectedSlot", "teacherUnavailable", "roomUnavailable", "duplicate", "groupExclusion", "compoundInternal", "compoundSibling"].includes(code));
        if (blockers.length && !unmovableHard) {
          const blockerReports = blockers.slice(0, 6).map(block => summarizeBlockForResidualReport(block, slot, placed, orderedSlots, options));
          const movableCount = blockerReports.filter(b => b.movable).length;
          const executable = blockerReports.length > 0 && movableCount === blockerReports.length;
          const row = {
            slot: formatSlotLabel(slot),
            reasonCodes: [...codes].filter(Boolean).slice(0, 6),
            blockers: blockerReports.slice(0, 4),
            movableBlockCount: movableCount,
            blockedBlockCount: blockerReports.length,
            executable
          };
          reviewOneMoveSlots.push(row);
          if (executable) executableOneMoveSlots.push(row);
        } else {
          hardBlockedSlots.push({
            slot: formatSlotLabel(slot),
            reasons: (analyzed.reasons || []).slice(0, 3).map(r => `${r.label}${r.samples?.[0] ? `: ${r.samples[0]}` : ""}`)
          });
        }
      }
      reportRows.push({
        name,
        classLabels,
        teachers,
        requiredCredits,
        placedSlots,
        missingSlots,
        directSlotCount: directSlots.length,
        directSlots: directSlots.slice(0, 8),
        oneMoveSlotCount: reviewOneMoveSlots.length,
        oneMoveSlots: reviewOneMoveSlots.slice(0, 6),
        executableOneMoveSlotCount: executableOneMoveSlots.length,
        executableOneMoveSlots: executableOneMoveSlots.slice(0, 6),
        hardBlockedSample: hardBlockedSlots.slice(0, 4),
        summary: directSlots.length
          ? `직접 배치 가능 ${directSlots.length}칸`
          : (executableOneMoveSlots.length ? `실행 가능한 1단계 이동 ${executableOneMoveSlots.length}칸` : `실행 가능한 직접/1단계 이동 없음 · 검토 후보 ${reviewOneMoveSlots.length}칸`)
      });
    }
    return {
      schemaVersion: "2026-06-12-residual-puzzle-report-r42",
      generatedAt: new Date().toISOString(),
      targetCount: reportRows.length,
      rows: reportRows,
      summary: reportRows.length
        ? reportRows.map(r => `${r.name}: ${r.summary}`).join(" / ").slice(0, 1200)
        : "잔여 미배치/카드 부족 없음"
    };
  }

  function residualPuzzleReportToHtml(report = null, limit = 5) {
    if (!report || !Array.isArray(report.rows) || !report.rows.length) return "";
    const esc = str => String(str ?? "").replace(/[<>&]/g, ch => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[ch]));
    const rows = report.rows.slice(0, limit).map(row => {
      const firstMove = (row.executableOneMoveSlots || [])[0] || null;
      const blocker = firstMove?.blockers?.find(b => b.movable) || firstMove?.blockers?.[0];
      const blockerText = blocker
        ? ` · 이동: ${esc((blocker.names || []).join(", "))}${blocker.moveCandidates?.length ? ` → ${esc(blocker.moveCandidates.join(", "))}` : ""}`
        : "";
      const direct = row.directSlots?.length ? ` · 직접후보 ${esc(row.directSlots.join(", "))}` : "";
      const move = firstMove ? ` · 실행가능 1단계 ${esc(firstMove.slot)}${blockerText}` : ` · 실행가능 1단계 없음${Number(row.oneMoveSlotCount || 0) ? ` (검토 ${Number(row.oneMoveSlotCount || 0)}칸)` : ""}`;
      return `<li><b>${esc(row.name)}</b>${row.classLabels ? ` (${esc(row.classLabels)})` : ""}: ${esc(row.placedSlots)}/${esc(row.requiredCredits)}${row.missingSlots ? ` · ${esc(row.missingSlots)} 부족` : ""}${direct}${move}</li>`;
    }).join("");
    return `<div class="tt-auto-progress-failed"><b>r42 잔여 퍼즐 진단</b><ul>${rows}${report.rows.length > limit ? `<li>외 ${report.rows.length - limit}개</li>` : ""}</ul></div>`;
  }

  function diagnosticsToHtml(diagnostics = [], limit = 8) {
    if (!diagnostics.length) return "";
    const esc = s => String(s ?? "").replace(/[<>&]/g, ch => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[ch]));
    return `<div class="tt-auto-progress-failed"><b>미배치 원인 후보와 완화 제안</b><ul>${diagnostics.slice(0, limit).map(d => {
      const reason = d.topReasons?.[0];
      const sample = reason?.samples?.[0] ? ` · 예: ${reason.samples[0]}` : "";
      const teacher = d.restrictedTeachers?.length ? ` · 제약교사: ${d.restrictedTeachers.join(", ")}` : (d.teachers?.length ? ` · 교사: ${d.teachers.join(", ")}` : "");
      const cls = d.classLabels ? ` · 대상: ${d.classLabels}` : "";
      const suggestionHtml = Array.isArray(d.suggestions) && d.suggestions.length
        ? `<div class="tt-auto-relax-suggestions"><b>풀어볼 조건</b><ol>${d.suggestions.slice(0, 3).map(s => {
            const normalized = normalizeDiagnosticSuggestion(s);
            if (!normalized) return "";
            return `<li><span>${esc(normalized.title)}</span><em>${esc(normalized.detail)}${Number(normalized.availableAfter || 0) ? ` · 완화 시 ${Number(normalized.availableAfter || 0)}칸 가능` : ""}</em></li>`;
          }).filter(Boolean).join("")}</ol></div>`
        : "";
      return `<li>${esc(d.name)}${d.occurrences > 1 ? ` ×${d.occurrences}` : ""} — ${esc(d.summary)}${esc(cls)}${esc(teacher)}${esc(sample)}${suggestionHtml}</li>`;
    }).join("")}${diagnostics.length > limit ? `<li>외 ${diagnostics.length - limit}개</li>` : ""}</ul></div>`;
  }

  function isAllowedAutoPlacementSource(item = {}) {
    const activeCardIds = new Set((ttDomain()?.ttcards || []).map(card => String(card?.id || "")).filter(Boolean));
    if (!activeCardIds.size) return true;
    const ids = ttCardIdsFromPlacement(item).map(id => String(id || "")).filter(Boolean);
    if (!ids.length) return false;
    if (ids.some(id => !activeCardIds.has(id))) return false;
    if (item.groupId) {
      const group = (ttGroups() || []).find(g => String(g?.id || "") === String(item.groupId || ""));
      if (!group) return false;
      const groupIds = new Set([
        ...(group.poolCardIds || []),
        ...(group.excludedCardIds || []),
        ...(group.units || []).flatMap(unit => unit.ttcardIds || [])
      ].map(id => String(id || "")).filter(Boolean));
      if (groupIds.size && ids.some(id => !groupIds.has(id))) return false;
    }
    return true;
  }

  function checkPlacementValid(item, slot, placed, options = {}) {
    if (!isAllowedAutoPlacementSource(item)) return false;
    const { respectSoftLimits = true, respectUnavailable = true, respectAssignedRoom = true } = options;
    const existing = [...entries(), ...placed];
    const slotEnts = existing.filter(e => e.day === slot.day && e.period === slot.period);
    const teachers  = getTeachersForAutoItem(item);

    // 0. Pinned/fixed/protected entries protect their slot first.
    // entries() contains protected entries during auto assignment.
    // This stronger check blocks not only whole-grade activities but also manually fixed
    // class/teacher/room slots before we spend time scoring candidates.
    if (strongProtectedSlotConflict(item, slot, placed)) return false;

    // 0-1. If a card was explicitly removed from an auto group, do not let the
    // auto-assigner place it in that group's same-time slot by coincidence.
    if (slotEnts.some(e => hasAutoGroupExclusionSlotConflict(item, e))) return false;

    // 0-2. 복합 과목 구성 카드(예: 미적분(2)/심화물리(2))는
    // 같은 대표 과목의 서로 다른 구성끼리 같은 시간에 들어가면 안 됩니다.
    if (hasInternalCompoundSiblingConflict(item)) return false;
    if (slotEnts.some(e => hasCompoundSiblingConflict(item, e))) return false;

    // 1. Teacher conflict. Same concurrent group can share the time,
    //    but it cannot make one teacher teach two different entries.
    for (const e of slotEnts) {
      const et = teacherNamesForPlacement(e);
      if (teachers.some(t => et.includes(t))) {
        if (item.unitId && e.unitId && item.unitId === e.unitId) continue;
        // 같은 동시배정 그룹 내부의 반복 교사는 하나의 통합 블록으로 봅니다.
        // 예: HS국어의 한국어 계열처럼 같은 교사가 여러 학급/분반 카드에 반복될 수 있습니다.
        const sameGrp = sameActiveGroup(item, e);
        const conc = sameGrp && isConcurrentItem(item) && isConcurrentItem(e);
        if (conc && options.allowSameGroupTeacherOverlap !== false) continue;
        return false;
      }
    }

    // 2. Exact duplicate: same timetable card already exists in the slot.
    const itemCardIds = new Set(ttCardIdsFromPlacement(item));
    if (itemCardIds.size && slotEnts.some(e => ttCardIdsFromPlacement(e).some(id => itemCardIds.has(id)))) return false;
    if (!itemCardIds.size && slotEnts.some(e => e.templateId === item.templateId && e.gradeKey === item.gradeKey && e.sectionIdx === item.sectionIdx)) return false;

    // 3. Class conflict.
    // 학생 개인 단위는 사전작업/그룹묶음에서 처리합니다.
    // 자동배치에서는 같은 동시배정 그룹이 아닌 한, 같은 학급이 같은 시간에 두 과목을 갖지 않도록 막습니다.
    const itemAudience = audienceForPlacement(item);
    for (const e of slotEnts) {
      // Same unit → co-located intentionally
      if (item.unitId && e.unitId && item.unitId === e.unitId) continue;

      const sameGrp = sameActiveGroup(item, e);
      const conc = sameGrp && isConcurrentItem(item) && isConcurrentItem(e);
      if (conc) continue;

      const eAudience = audienceForPlacement(e);
      const conflict = audiencesConflict(itemAudience, eAudience);
      if (conflict) return false;
    }

    // 4. Teacher unavailable / max per week / max per day / max consecutive
    // 시간강사·육아단축 등 제약근무 교사는 완화 단계에서도 이 조건들을 절대 조건으로 봅니다.
    for (const teacher of teachers) {
      const c = constraints()?.[teacher] || {};
      const restrictedTeacher = isRestrictedTeacher(teacher);
      const enforceLimits = respectSoftLimits || restrictedTeacher;

      if ((respectUnavailable || restrictedTeacher) && c?.unavailableSlots?.some(s => s.day === slot.day && s.period === slot.period)) return false;

      const limit = getTeacherLimitState(teacher, slot, existing);
      if (enforceLimits && limit.wouldExceedWeek) return false;
      if (enforceLimits && limit.wouldExceedDay) return false;
      if (enforceLimits && limit.wouldExceedConsecutive) return false;
    }
    // 6. Room conflict: 실제로 배정될 교실 기준으로 검사합니다.
    // 같은 시간대의 다른 과목은 각각 다른 교실을 가져야 합니다.
    // 자동 추천 교실이 이미 사용 중이면 빈 일반교실을 보조 추천합니다.
    const candidateRoomData = applyAutoRoomToEntryData({ ...item, ...slot }, slot, placed, options);
    if (respectAssignedRoom && entryHasMissingRoomForAuto(candidateRoomData)) return false;
    if (respectAssignedRoom && roomUnavailableInSlot(candidateRoomData, slot)) return false;
    if (respectAssignedRoom && roomConflictsInSlot(candidateRoomData, slot, placed)) return false;

    // r209: 교사 고정교실을 별도 예약 리소스로 보지 않습니다.
    // 실제 같은 시간 같은 교실 점유는 위 roomConflictsInSlot에서만 판정합니다.
    return true;
  }
  function autoItemKey(item) {
    if (item.ttcardId) return `ttc:${item.ttcardId}`;
    const ids = ttCardIdsFromPlacement(item).filter(Boolean);
    if (ids.length) return `ttcs:${ids.slice().sort().join("+")}`;
    return `tpl:${item.templateId || ""}:${item.gradeKey || ""}:${item.sectionIdx ?? 0}`;
  }

  function entryMatchesAutoItem(entry, item) {
    if (item.ttcardId) {
      return entry.ttcardId === item.ttcardId || (entry.ttcardIds || []).includes(item.ttcardId);
    }
    const templateMatch = entry.templateId === item.templateId || (entry.templateIds || []).includes(item.templateId);
    const gradeMatch = entry.gradeKey === item.gradeKey || (entry.gradeKeys || []).includes(item.gradeKey);
    const sectionMatch = (entry.sectionIdx ?? 0) === (item.sectionIdx ?? 0);
    return templateMatch && gradeMatch && sectionMatch;
  }

  function getAutoItemName(item) {
    if (item.ttcardId) {
      const card = getTtCardById(item.ttcardId);
      if (card) return describeTtCard(card).title;
    }
    const base = getTemplateCardTitle(getTemplateById(item.templateId)) || "?";
    return item.gradeKey ? `${base} ${gradeDisplay(item.gradeKey)}${sectionLabel(item.sectionIdx ?? 0)}` : base;
  }

  function normalizeSubjectTextForScoring(x = {}) {
    const parts = [
      x.subject, x.name, x.title, x.nameKo, x.nameEn, x.groupName,
      x.templateId ? getTemplateCardTitle(getTemplateById(x.templateId)) : ""
    ];
    ttCardIdsFromPlacement(x).forEach(id => {
      const card = getTtCardById(id);
      if (card) parts.push(card.subject, card.name, card.title, card.nameKo, card.nameEn, describeTtCard(card).title);
    });
    return parts.map(v => String(v || "")).join(" ").toLowerCase();
  }

  function isMajorSubjectForScoring(x = {}) {
    const text = normalizeSubjectTextForScoring(x);
    return /국어|한국어|korean|영어|english|수학|math|algebra|calculus|geometry|statistics|과학|science|physics|chemistry|biology|사회|history|social/.test(text);
  }

  function getAutoItemDifficulty(item) {
    const audience = audienceForPlacement(item);
    const teacherCount = hardTeacherNamesForPlacement(item).length;
    return teacherCount * 20 + audience.classKeys.size * 8;
  }

  // 슬롯 점수 동점 시 결정적(deterministic) 미세 가산값입니다.
  // 기존에는 Math.random()을 더해 실행마다 결과가 달라지고(미배치 수가 들쭉날쭉),
  // forward-check가 같은 상태를 반복 평가할 수 없었습니다.
  // (slot.day, slot.period) 기반의 아주 작은 안정값으로 대체해 재현성을 확보합니다.
  // 멀티 시도(attempt>0)의 탐색 다양성은 selectCandidateWithExploration의
  // slotRandomness가 그대로 담당하므로 탐색력은 유지됩니다.
  function slotTieBreak(slot = {}) {
    const d = Number(slot.day) || 0;
    const p = Number(slot.period) || 0;
    return (((d * 7 + p) % 37) * 0.0001);
  }

  function scoreAutoSlot(item, slot, placed, checkOptions = {}) {
    const existing = [...entries(), ...placed];
    const weights = normalizeScoreWeights(checkOptions.scoringWeights);
    const slotEnts = existing.filter(e => e.day === slot.day && e.period === slot.period);
    const exclusionPenalty = slotEnts.some(e => hasAutoGroupExclusionSlotConflict(item, e)) ? 100000 : 0;
    const teachers = getTeachersForAutoItem(item);
    const dayEnts = existing.filter(e => e.day === slot.day);
    const teacherLoad = teachers.reduce((sum, t) => sum + getTeacherDayLoad(t, existing, slot.day), 0);
    const teacherLimitLoad = teachers.reduce((sum, t) => sum + teacherLimitPenalty(t, slot, existing), 0);
    const audience = audienceForPlacement(item);
    const classKeys = classKeysForCapacity(item);
    const classLoad = dayEnts.reduce((sum, e) => sum + (audiencesConflict(audience, audienceForPlacement(e)) ? 1 : 0), 0);
    const samePeriodLoad = existing.filter(e => e.period === slot.period).length;
    const classStats = buildClassSlotStatsForEntries(existing);
    const targetPerClass = Math.max(0, (parseInt(ttConfig().periodCount, 10) || 7) * 5);

    let preferencePenalty = 0;

    const itemSubject = entrySubjectKeyForScoring(item);
    for (const cls of classKeys) {
      const sameSubjectToday = dayEnts.some(e =>
        entryClassKeysForScoring(e).map(normalizeClassKeyForReportKey).includes(cls) && entrySubjectKeyForScoring(e) === itemSubject
      );
      if (sameSubjectToday) preferencePenalty += 26 * weights.sameSubjectDay;

      // 학급 공강 제거가 최우선입니다. 아직 전체 35시수에 덜 찬 학급과
      // 해당 요일 수업이 적은 학급의 빈칸을 먼저 채우도록 강한 보상을 줍니다.
      const filled = classSlotCountFromStats(classStats, cls);
      const shortage = Math.max(0, targetPerClass - filled);
      const dayLoad = classDayLoadFromStats(classStats, cls, slot.day);
      preferencePenalty -= shortage * 10 * weights.classFill;
      preferencePenalty += dayLoad * 9 * weights.classFill;
      if (slot.period <= 2) preferencePenalty -= 1.5 * weights.classFill;
    }

    for (const teacher of teachers) {
      const gaps = teacherGapCountAfterAdding(teacher, existing, slot.day, slot.period);
      preferencePenalty += gaps * 4 * weights.teacherGap;
      const nextMax = maxConsecutiveAfterAdding(teacher, existing, slot.day, slot.period);
      if (nextMax >= 4) preferencePenalty += (nextMax - 3) * 12 * weights.teacherConsecutive;
    }

    return exclusionPenalty + slotEnts.length * 100 + teacherLoad * 8 + teacherLimitLoad + classLoad * 10 + preferencePenalty + samePeriodLoad * 0.15 + slotTieBreak(slot);
  }

  function scoreAutoSlotLight(item, slot, placed, checkOptions = {}) {
    // 빠른/균형 배치용 경량 점수입니다.
    // checkPlacementValid가 핵심 충돌을 이미 막으므로, 여기서는 전체 학급 통계 재계산 없이
    // 같은 시간 밀집도·교사 일일 부하·학급 당일 부하만 가볍게 봅니다.
    const existing = [...entries(), ...placed];
    const weights = normalizeScoreWeights(checkOptions.scoringWeights);
    const slotEnts = existing.filter(e => e.day === slot.day && e.period === slot.period);
    const dayEnts = existing.filter(e => e.day === slot.day);
    const teachers = getTeachersForAutoItem(item);
    const audience = audienceForPlacement(item);
    let score = slotEnts.length * 110 + existing.filter(e => e.period === slot.period).length * 0.12;

    const classLoad = dayEnts.reduce((sum, e) => sum + (audiencesConflict(audience, audienceForPlacement(e)) ? 1 : 0), 0);
    score += classLoad * 8 * Math.max(1, weights.classFill || 1);

    for (const teacher of teachers) {
      score += getTeacherDayLoad(teacher, existing, slot.day) * 5 * Math.max(1, weights.teacherGap || 1);
      score += teacherLimitPenalty(teacher, slot, existing);
    }

    // 오전 앞쪽만 과도하게 몰리지 않도록 약한 균형만 둡니다.
    score += slot.period * 0.18 + slot.day * 0.05;
    return score + slotTieBreak(slot);
  }

  function orderedFastSlots(baseSlots = []) {
    // 35칸 전체 점수 계산을 피하고, 같은 교시를 요일별로 먼저 훑어
    // 학급 주간 빈칸을 빠르게 채웁니다.
    return [...baseSlots].sort((a, b) => (a.period - b.period) || (a.day - b.day));
  }

  function selectCandidateWithExploration(candidates = [], checkOptions = {}) {
    // r48: r47에서 후보 배열에 undefined/비정상 score가 섞이면 sort 중
    // "Cannot read properties of undefined (reading 'score')"로 전체 자동배정이 중단될 수 있었습니다.
    // 후보 선택기는 절대 런을 죽이면 안 되므로, 유효 후보만 남기고 나머지는 버립니다.
    const valid = (Array.isArray(candidates) ? candidates : [])
      .filter(c => c && c.slot && Number.isFinite(Number(c.score)))
      .map(c => ({ ...c, score: Number(c.score) }));
    if (!valid.length) return null;

    const sorted = [...valid].sort((a, b) => Number(a.score) - Number(b.score));
    const randomness = Math.max(0, Number(checkOptions.slotRandomness || 0));
    const topCandidateCount = Math.max(1, Math.min(12, Number(checkOptions.topCandidateCount || 1)));
    if (!randomness || topCandidateCount <= 1) return sorted[0] || null;

    const bestScore = Number(sorted[0]?.score);
    if (!Number.isFinite(bestScore)) return sorted[0] || null;
    const tolerance = Math.max(4, randomness * 14);
    const pool = sorted
      .filter(c => c && Number(c.score) <= bestScore + tolerance)
      .slice(0, topCandidateCount);
    if (pool.length <= 1) return sorted[0] || null;

    // 좋은 후보를 더 자주 고르되, 같은 점수대의 다른 후보도 일부 시도합니다.
    const index = Math.min(pool.length - 1, Math.floor(Math.pow(Math.random(), 1.8) * pool.length));
    return pool[index] || pool[0] || sorted[0] || null;
  }

  function findBestAutoSlot(item, baseSlots, placed, checkOptions = {}) {
    const profile = checkOptions.engineProfile || autoEngineProfileForMode(checkOptions.runAttempts);

    if (profile.slotScoring === "first") {
      for (const slot of orderedFastSlots(baseSlots)) {
        if (checkPlacementValid(item, slot, placed, checkOptions)) return slot;
      }
      return null;
    }

    const scoreFn = profile.slotScoring === "light" ? scoreAutoSlotLight : scoreAutoSlot;
    const candidates = [];
    for (const slot of shuffle([...baseSlots])) {
      if (checkPlacementValid(item, slot, placed, checkOptions)) {
        const score = scoreFn(item, slot, placed, checkOptions);
        if (Number.isFinite(Number(score))) candidates.push({ slot, score: Number(score) });
      }
    }

    // ── Forward-checking 데드엔드 회피 ──────────────────────────────────────
    // 그리디 구성은 한 번 꽂으면 되돌리지 않으므로, 초반 카드가 다른 카드의
    // 마지막 공통 빈칸을 점유하면 후속 카드가 영구 미배치가 됩니다.
    // checkOptions.forwardCheck(slot)가 주어지면, 점수 상위 후보 중
    // "다른 미배치 카드를 후보 0칸으로 만들지 않는" 슬롯을 우선 선택합니다.
    // 전부 데드엔드를 유발하면(피할 수 없으면) 기존 점수 우선 로직으로 되돌립니다.
    if (typeof checkOptions.forwardCheck === "function" && candidates.length > 1) {
      const sorted = [...candidates]
        .filter(c => c && c.slot && Number.isFinite(Number(c.score)))
        .sort((a, b) => Number(a.score) - Number(b.score));
      // 점수 순으로 budget개까지 검사해, 안전한(데드엔드 미유발) 후보를 모읍니다.
      // r48: 후보 수가 2~5개일 때도 budget을 6으로 키워 sorted[i]가 undefined가 되던 결함을 차단합니다.
      const requestedBudget = Math.max(6, Number(checkOptions.forwardCheckBudget) || 16);
      const budget = Math.min(sorted.length, requestedBudget);
      const safe = [];
      for (let i = 0; i < budget; i++) {
        const c = sorted[i];
        if (!c || !c.slot) continue;
        let ok = true;
        try { ok = checkOptions.forwardCheck(c.slot) !== false; } catch { ok = true; }
        if (ok) safe.push(c);
      }
      if (safe.length) return selectCandidateWithExploration(safe, checkOptions)?.slot || null;
    }

    return selectCandidateWithExploration(candidates, checkOptions)?.slot || null;
  }

  function makeAutoEntry(item, slot, placed = [], options = {}) {
    if (!item || !slot || !isAllowedAutoPlacementSource(item)) return null;
    const roomed = applyAutoRoomToEntryData({ ...item, ...slot }, slot, placed, options);
    if (entryHasMissingRoomForAuto(roomed)) return null;
    return normalizeTimetableEntry({
      id: uid("ent"),
      ...roomed
    });
  }

  function exactDuplicateInSlot(item, slot, placed = []) {
    const itemCardIds = new Set(ttCardIdsFromPlacement(item));
    const slotEnts = [...entries(), ...placed].filter(e => e.day === slot.day && e.period === slot.period);
    if (itemCardIds.size) {
      return slotEnts.some(e => ttCardIdsFromPlacement(e).some(id => itemCardIds.has(id)));
    }
    return slotEnts.some(e =>
      e.templateId === item.templateId &&
      e.gradeKey === item.gradeKey &&
      (e.sectionIdx ?? 0) === (item.sectionIdx ?? 0)
    );
  }

  function exactDuplicateInDay(item, slot, placed = []) {
    const itemCardIds = new Set(ttCardIdsFromPlacement(item));
    const dayEnts = [...entries(), ...placed].filter(e => e.day === slot.day);
    if (itemCardIds.size) {
      return dayEnts.some(e => ttCardIdsFromPlacement(e).some(id => itemCardIds.has(id)));
    }
    return dayEnts.some(e =>
      e.templateId === item.templateId &&
      e.gradeKey === item.gradeKey &&
      (e.sectionIdx ?? 0) === (item.sectionIdx ?? 0)
    );
  }

  function forcedSlotScore(item, slot, placed = [], options = {}) {
    // 마지막 보정 단계용 점수입니다.
    // 원칙적으로 충돌 없는 슬롯을 찾고, 불가피할 때만 최소 충돌 슬롯에 배치합니다.
    // 단, 고정/보호 슬롯 침범과 동일 카드 동일 시간 중복은 끝까지 막습니다.
    if (strongProtectedSlotConflict(item, slot, placed)) return Infinity;
    if (exactDuplicateInSlot(item, slot, placed)) return Infinity;
    if (exactDuplicateInDay(item, slot, placed)) return Infinity;

    const existing = [...entries(), ...placed];
    const slotEnts = existing.filter(e => e.day === slot.day && e.period === slot.period);
    if (slotEnts.some(e => hasAutoGroupExclusionSlotConflict(item, e))) return Infinity;
    if (hasInternalCompoundSiblingConflict(item)) return Infinity;
    if (slotEnts.some(e => hasCompoundSiblingConflict(item, e))) return Infinity;
    const dayEnts = existing.filter(e => e.day === slot.day);
    const teachers = hardTeacherNamesForPlacement(item);
    const itemAudience = audienceForPlacement(item);

    // 마지막 보정 단계에서도 교실 중복은 허용하지 않습니다.
    const candidateRoomData = applyAutoRoomToEntryData({ ...item, ...slot }, slot, placed, options);
    if (entryHasMissingRoomForAuto(candidateRoomData)) return Infinity;
    if (roomUnavailableInSlot(candidateRoomData, slot)) return Infinity;
    if (roomConflictsInSlot(candidateRoomData, slot, placed)) return Infinity;

    const weights = normalizeScoreWeights(options.scoringWeights);
    let score = slotEnts.length * 10 + existing.filter(e => e.period === slot.period).length * 0.25;

    for (const e of slotEnts) {
      const sameUnit = item.unitId && e.unitId && item.unitId === e.unitId;
      if (sameUnit) continue;

      const sameGrp = sameActiveGroup(item, e);
      const conc = sameGrp && isConcurrentItem(item) && isConcurrentItem(e);

      const et = teacherNamesForPlacement(e);
      if (teachers.some(t => et.includes(t))) {
        const sameGrpForTeacher = sameActiveGroup(item, e);
        const concForTeacher = sameGrpForTeacher && isConcurrentItem(item) && isConcurrentItem(e);
        if (!concForTeacher || options.allowSameGroupTeacherOverlap === false) return Infinity;
      }

      const eAudience = audienceForPlacement(e);
      const conflict = audiencesConflict(itemAudience, eAudience);
      // 보정 배치에서도 같은 학급 중복은 만들지 않습니다.
      // 단, 같은 동시배정 그룹은 사전작업에서 병렬 수업으로 확정된 묶음이므로 허용합니다.
      if (conflict && !conc) return Infinity;
      if (e.roomId) {
        const assignedRooms = teachers.map(getEffectiveAssignedRoomId).filter(Boolean);
        if (assignedRooms.includes(e.roomId)) score += 250;
      }
    }

    for (const teacher of teachers) {
      const c = constraints()?.[teacher] || {};
      const restrictedTeacher = isRestrictedTeacher(teacher);
      // 최종 보정 단계에서도 제약근무 교사의 불가시간·주/일/연속 제한은 침범하지 않습니다.
      if (c?.unavailableSlots?.some(s => s.day === slot.day && s.period === slot.period)) {
        if (restrictedTeacher) return Infinity;
        score += 500;
      }

      const limit = getTeacherLimitState(teacher, slot, existing);
      if (limit.wouldExceedWeek) {
        if (restrictedTeacher) return Infinity;
        score += 220 + (limit.weekLoad - limit.maxPerWeek + 1) * 45;
      }
      if (limit.wouldExceedDay) {
        if (restrictedTeacher) return Infinity;
        score += 150 + (limit.dayLoad - limit.maxPerDay + 1) * 30;
      }
      if (limit.wouldExceedConsecutive) {
        if (restrictedTeacher) return Infinity;
        score += 120 + (limit.nextConsecutive - limit.maxConsecutive) * 30;
      }

    }

    const classFillWeights = normalizeScoreWeights(options.scoringWeights);
    const classStats = buildClassSlotStatsForEntries(existing);
    const targetPerClass = Math.max(0, (parseInt(ttConfig().periodCount, 10) || 7) * 5);
    for (const cls of classKeysForCapacity(item)) {
      const filled = classSlotCountFromStats(classStats, cls);
      const shortage = Math.max(0, targetPerClass - filled);
      const dayLoad = classDayLoadFromStats(classStats, cls, slot.day);
      // 보정 배치에서도 학급 공강을 채우는 슬롯을 강하게 우선합니다.
      score -= shortage * 18 * classFillWeights.classFill;
      score += dayLoad * 10 * classFillWeights.classFill;
      if (filled >= targetPerClass) score += 650 * classFillWeights.classFill;
    }

    return score + slotTieBreak(slot);
  }

  function findLeastBadSlot(item, baseSlots, placed = [], options = {}) {
    const candidates = [];
    for (const slot of shuffle([...baseSlots])) {
      const score = forcedSlotScore(item, slot, placed, options);
      if (Number.isFinite(score)) candidates.push({ slot, score });
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates[0]?.slot || null;
  }

  // ── Post-placement improvement helpers ─────────────────────────
  // 자동배치가 일단 성공한 뒤, 충돌을 만들지 않는 범위에서
  // 같은 과목 같은 날 반복, 교사 공강/연속수업 부담을 줄입니다.
  function entryClassKeysForScoring(entry = {}) {
    const audience = audienceForPlacement(entry);
    const keys = new Set([...(audience?.classKeys || [])]);
    if (!keys.size) {
      (entry.classIds || []).forEach(id => id && keys.add(id));
      (entry.targetClassIds || []).forEach(id => id && keys.add(id));
      if (entry.classId) keys.add(entry.classId);
      if (entry.gradeKey && Number.isInteger(entry.sectionIdx)) keys.add(`${entry.gradeKey}:${entry.sectionIdx}`);
    }
    return [...keys].filter(Boolean);
  }

  function entrySubjectKeyForScoring(entry = {}) {
    const ids = ttCardIdsFromPlacement(entry);
    if (ids.length) return ids.map(id => {
      const card = getTtCardById(id);
      return card?.templateId || card?.subject || id;
    }).join("+");
    return [entry.templateId || "", entry.compoundParentTemplateId || "", entry.subject || entry.name || entry.title || ""].filter(Boolean).join(":") || getAutoItemName(entry);
  }

  function getTeacherNamesForScoring(entry = {}) {
    // r47: 점수/후처리도 hard 교사 기준으로 맞춥니다.
    return hardTeacherNamesForPlacement(entry);
  }

  function maxConsecutiveFromPeriods(periods = []) {
    const arr = [...new Set(periods)].sort((a, b) => a - b);
    let best = arr.length ? 1 : 0;
    let cur = arr.length ? 1 : 0;
    for (let i = 1; i < arr.length; i++) {
      cur = arr[i] === arr[i - 1] + 1 ? cur + 1 : 1;
      best = Math.max(best, cur);
    }
    return best;
  }

  function scoreScheduleQuality(movable = [], options = {}) {
    // r48: 복구/후처리 중 null entry가 섞여도 품질점수 계산이 런을 중단하지 않게 방어합니다.
    const all = [...entries(), ...(movable || [])].filter(Boolean);
    const weights = scoreOptionsFromAssignOptions(options);
    let score = 0;

    const classDaySubject = new Map();
    const teacherDayPeriods = new Map();

    all.forEach(entry => {
      if (!Number.isInteger(entry.day) || !Number.isInteger(entry.period)) return;
      const period = entry.period;
      const classKeys = entryClassKeysForScoring(entry);
      const subjectKey = entrySubjectKeyForScoring(entry);

      classKeys.forEach(cls => {
        const dayKey = `${cls}:${entry.day}`;
        const subjectDayKey = `${cls}:${entry.day}:${subjectKey}`;
        classDaySubject.set(subjectDayKey, (classDaySubject.get(subjectDayKey) || 0) + 1);

      });

      getTeacherNamesForScoring(entry).forEach(teacher => {
        const key = `${teacher}:${entry.day}`;
        if (!teacherDayPeriods.has(key)) teacherDayPeriods.set(key, []);
        teacherDayPeriods.get(key).push(period);
      });
    });

    classDaySubject.forEach(count => {
      if (count > 1) score += (count - 1) * 28 * weights.sameSubjectDay;
    });

    teacherDayPeriods.forEach((periods, key) => {
      const unique = [...new Set(periods)].sort((a, b) => a - b);
      if (!unique.length) return;
      const span = unique[unique.length - 1] - unique[0] + 1;
      const gaps = Math.max(0, span - unique.length);
      const maxC = maxConsecutiveFromPeriods(unique);
      const teacher = String(key).split(":")[0];
      const c = constraints()?.[teacher] || {};
      const limitC = Number(c.maxConsecutive) || 0;

      score += gaps * 5 * weights.teacherGap;
      if (unique.length >= 6) score += (unique.length - 5) * 8 * weights.teacherGap;
      if (limitC > 0 && maxC > limitC) score += (maxC - limitC) * 40 * weights.teacherConsecutive;
      else if (maxC >= 4) score += (maxC - 3) * 14 * weights.teacherConsecutive;
    });

    const classStats = buildClassSlotStatsForEntries(all);
    const targetPerClass = Math.max(0, (parseInt(ttConfig().periodCount, 10) || 7) * 5);
    getReportClassRows().forEach(row => {
      const stat = classStats.get(row.key);
      const filled = stat?.slots?.size || 0;
      const diff = filled - targetPerClass;
      if (diff < 0) score += Math.pow(Math.abs(diff), 2) * 90 * weights.classFill;
      if (diff > 0) score += Math.pow(diff, 2) * 140 * weights.classFill;
      for (let day = 0; day < 5; day++) {
        const dayCount = stat?.dayPeriods?.get(day)?.size || 0;
        const dayShortage = Math.max(0, (parseInt(ttConfig().periodCount, 10) || 7) - dayCount);
        score += Math.pow(dayShortage, 2) * 7 * weights.classFill;
      }
    });

    return score;
  }

  function getMovableBlocks(placed = []) {
    const map = new Map();
    (placed || []).forEach((entry, index) => {
      if (!entry) return;
      const key = entry.groupId
        ? `group:${entry.groupId}:${entry.day}:${entry.period}`
        : (entry.unitId ? `unit:${entry.unitId}:${entry.day}:${entry.period}` : `entry:${entry.id || index}`);
      if (!map.has(key)) map.set(key, { key, entries: [], indexes: [] });
      map.get(key).entries.push(entry);
      map.get(key).indexes.push(index);
    });
    return [...map.values()].filter(block => block.entries.length && Number.isInteger(block.entries[0].day) && Number.isInteger(block.entries[0].period));
  }

  function makeMovedBlockEntries(block, slot, placedWithoutBlock = [], moveOptions = {}) {
    const moved = [];
    const checkOptions = {
      respectSoftLimits: moveOptions.respectSoftLimits !== false,
      respectUnavailable: moveOptions.respectUnavailable !== false,
      respectAssignedRoom: moveOptions.respectAssignedRoom !== false,
      allowAutoRoomAssignment: moveOptions.allowAutoRoomAssignment === true
    };
    for (const original of block.entries) {
      const candidateData = { ...original, day: slot.day, period: slot.period };
      if (!checkPlacementValid(candidateData, slot, [...placedWithoutBlock, ...moved], checkOptions)) return null;
      const normalized = normalizeTimetableEntry({
        ...original,
        ...applyAutoRoomToEntryData(candidateData, slot, [...placedWithoutBlock, ...moved], checkOptions),
        id: original.id
      });
      moved.push(normalized);
    }
    return moved;
  }

  function blockKeyForEntry(entry, index = 0) {
    return entry.groupId
      ? `group:${entry.groupId}:${entry.day}:${entry.period}`
      : (entry.unitId ? `unit:${entry.unitId}:${entry.day}:${entry.period}` : `entry:${entry.id || index}`);
  }

  function getBlockingBlocksForSlot(item, slot, placed = []) {
    const slotEnts = placed.filter(e => e.day === slot.day && e.period === slot.period);
    if (!slotEnts.length) return [];
    // r41f: item.teacherName만 보지 말고 ttcardIds/teachers 배열까지 포함한
    // 실제 교사 집합으로 차단 블록을 찾습니다.
    const teachers = new Set(teacherNamesForPlacement(item));
    const itemAudience = audienceForPlacement(item);
    const candidateRoomData = applyAutoRoomToEntryData({ ...item, ...slot }, slot, placed);
    const blockedKeys = new Set();

    slotEnts.forEach((e, index) => {
      if (sameUnitPlacement(item, e)) return;
      const sameGrp = sameActiveGroup(item, e);
      const conc = sameGrp && isConcurrentItem(item) && isConcurrentItem(e);
      if (conc) return;

      const eTeachers = teacherNamesForPlacement(e);
      const teacherHit = eTeachers.some(t => teachers.has(t));
      const classHit = audiencesConflict(itemAudience, audienceForPlacement(e));
      const candidateRoomSet = new Set(roomIdsForPlacement(candidateRoomData));
      const roomHit = roomIdsForPlacement(e).some(roomId => candidateRoomSet.has(roomId));
      if (teacherHit || classHit || roomHit) blockedKeys.add(blockKeyForEntry(e, index));
    });

    if (!blockedKeys.size) return [];
    return getMovableBlocks(placed).filter(block => blockedKeys.has(block.key));
  }

  function uniqueMovableBlocks(blocks = []) {
    const seen = new Set();
    const list = [];
    (blocks || []).forEach(block => {
      if (!block?.key || seen.has(block.key)) return;
      seen.add(block.key);
      list.push(block);
    });
    return list;
  }

  function tryEvacuateBlockingBlocksForSlot(item, targetSlot, blockers = [], current = [], orderedSlots = [], options = {}, limits = {}) {
    const maxBlocks = Math.max(1, Number(limits.maxBlocks || 2));
    const activeBlockers = uniqueMovableBlocks(blockers).slice(0, maxBlocks + 1);
    // 차단 블록이 너무 많으면 탐색 폭이 폭발하므로 기존 안전 보정 단계로 넘깁니다.
    if (!activeBlockers.length || activeBlockers.length > maxBlocks) return null;

    const blockedIds = new Set(activeBlockers.flatMap(block => (block.entries || []).map(e => e.id).filter(Boolean)));
    const baseWithoutBlockers = current.filter(e => !blockedIds.has(e.id));
    const maxMoveSlotsPerBlock = Math.max(1, Number(limits.maxMoveSlotsPerBlock || 12));
    const moveSlots = shuffle([...orderedSlots])
      .filter(slot => !(slot.day === targetSlot.day && slot.period === targetSlot.period))
      .slice(0, maxMoveSlotsPerBlock);

    let attempts = 0;
    let best = null;
    let bestScore = Infinity;
    // r41d: 이 함수는 재귀+동기 탐색이라 한 번 폭발하면 82% 복구 단계에서
    // 브라우저가 응답 없음으로 보입니다. 호출 1회당 시도/시간 예산을 강제해
    // 답이 없는 슬롯은 빨리 포기하고 다음 복구 전략으로 넘깁니다.
    const maxAttempts = Math.max(80, Number(limits.maxAttempts || 1200));
    const maxMillis = Math.max(60, Number(limits.maxMillis || 220));
    const startedAt = Date.now();
    const budgetExceeded = () => attempts >= maxAttempts || (Date.now() - startedAt) >= maxMillis;

    const search = (idx, movedEntries) => {
      if (budgetExceeded()) return;
      if (idx >= activeBlockers.length) {
        const candidateBase = [...baseWithoutBlockers, ...movedEntries];
        if (!checkPlacementValid(item, targetSlot, candidateBase, options)) return;
        const entry = makeAutoEntry(item, targetSlot, candidateBase);
        if (!entry) return;
        const candidate = [...candidateBase, entry];
        const score = scoreScheduleQuality(candidate, options);
        if (score < bestScore) {
          bestScore = score;
          best = {
            entries: candidate,
            movedBlockKeys: activeBlockers.map(block => block.key),
            insertedEntry: entry,
            score
          };
        }
        return;
      }

      const block = activeBlockers[idx];
      for (const moveSlot of moveSlots) {
        if (budgetExceeded()) break;
        attempts++;
        const placedSoFar = [...baseWithoutBlockers, ...movedEntries];
        const moved = makeMovedBlockEntries(block, moveSlot, placedSoFar, options);
        if (!moved) continue;
        search(idx + 1, [...movedEntries, ...moved]);
        // 균형/빠른 모드에서는 첫 안전 해답을 찾으면 더 깊은 불필요 탐색을 줄입니다.
        if (best && options.runAttempts !== "deep") break;
      }
    };

    search(0, []);
    const timedOut = budgetExceeded() && !best;
    return best ? { ...best, attempts, timedOut: false } : { attempts, timedOut };
  }

  function isRepairBlockMovable(block = {}) {
    const entries = block?.entries || [];
    if (!entries.length) return false;
    return entries.every(e => e && !e.pinned && !e.protected && !e.manualPinned && !e.fixed && !e.locked && !e.isProtected);
  }

  function repairSlotKey(slot = {}) {
    return `${Number(slot.day)}:${Number(slot.period)}`;
  }

  function repairBlockOriginalSlotKey(block = {}) {
    const first = block?.entries?.[0] || {};
    return repairSlotKey(first);
  }

  function removeRepairBlockFromEntries(list = [], block = {}) {
    const ids = new Set((block.entries || []).map(e => e.id).filter(Boolean));
    return (list || []).filter(e => !ids.has(e.id));
  }

  function getBlockingBlocksForMovedBlock(block = {}, slot = {}, placed = []) {
    const keys = new Set();
    (block.entries || []).forEach((entry, index) => {
      const probe = { ...entry, day: Number(slot.day), period: Number(slot.period) };
      getBlockingBlocksForSlot(probe, slot, placed).forEach(b => {
        if (b?.key && b.key !== block.key) keys.add(b.key);
      });
    });
    if (!keys.size) return [];
    return getMovableBlocks(placed).filter(b => keys.has(b.key));
  }

  function rankRepairMoveSlotsForBlock(block = {}, state = [], orderedSlots = [], options = {}, limits = {}) {
    const maxBranchSlots = Math.max(4, Number(limits.maxBranchSlots || 16));
    const originalKey = repairBlockOriginalSlotKey(block);
    const withoutBlock = removeRepairBlockFromEntries(state, block);
    const scored = [];
    for (const slot of orderedSlots || []) {
      const key = repairSlotKey(slot);
      if (key === originalKey) continue;
      const moved = makeMovedBlockEntries(block, slot, withoutBlock, options);
      if (moved) {
        scored.push({ slot, score: 0 });
        continue;
      }
      const blockers = uniqueMovableBlocks(getBlockingBlocksForMovedBlock(block, slot, withoutBlock));
      if (!blockers.length) {
        scored.push({ slot, score: 9999 });
        continue;
      }
      const unmovable = blockers.some(b => !isRepairBlockMovable(b));
      const blockEntryCount = blockers.reduce((sum, b) => sum + (b.entries?.length || 0), 0);
      scored.push({ slot, score: (unmovable ? 5000 : 100) + blockers.length * 12 + blockEntryCount });
    }
    return scored
      .sort((a, b) => a.score - b.score || Number(a.slot.period) - Number(b.slot.period) || Number(a.slot.day) - Number(b.slot.day))
      .slice(0, maxBranchSlots)
      .map(row => row.slot);
  }

  function tryEjectionChainForSlot(item, targetSlot, blockers = [], current = [], orderedSlots = [], options = {}, limits = {}) {
    // r39: 브라우저 응답없음 방지를 위해 시간 예산을 둔 제한 깊이 ejection-chain을 수행합니다.
    // 목표 슬롯을 막는 블록을 다른 슬롯으로 밀어내고, 그 슬롯을 다시 막는 블록도 재귀적으로 밀어냅니다.
    const maxDepth = Math.max(1, Number(limits.maxDepth || 4));
    const maxAttempts = Math.max(100, Number(limits.maxAttempts || 20000));
    const maxBlockersPerNode = Math.max(1, Number(limits.maxBlockersPerNode || 4));
    const maxRootBlockers = Math.max(1, Number(limits.maxRootBlockers || 5));
    const maxMillis = Math.max(80, Number(limits.maxMillis || 450));
    const startedAt = Date.now();
    const slotList = [...(orderedSlots || [])];
    let attempts = 0;
    let best = null;
    let bestScore = Infinity;

    const timeExceeded = () => Date.now() - startedAt >= maxMillis;
    const budgetExceeded = () => attempts >= maxAttempts || timeExceeded();

    const rootBlockers = uniqueMovableBlocks(blockers.length ? blockers : getBlockingBlocksForSlot(item, targetSlot, current))
      .filter(isRepairBlockMovable)
      .slice(0, maxRootBlockers);
    if (!rootBlockers.length) return { attempts: 0 };

    const logMove = (block, toSlot) => ({
      blockKey: block.key,
      title: getAutoItemName(block.entries?.[0] || {}),
      from: repairBlockOriginalSlotKey(block),
      to: repairSlotKey(toSlot),
      movedCount: block.entries?.length || 0
    });

    const tryPlaceFinalItem = (state, chain) => {
      if (budgetExceeded()) return;
      attempts++;
      if (!checkPlacementValid(item, targetSlot, state, options)) return;
      const entry = makeAutoEntry(item, targetSlot, state);
      if (!entry) return;
      const candidate = [...state, entry];
      const score = scoreScheduleQuality(candidate, options);
      if (score < bestScore) {
        bestScore = score;
        best = {
          entries: candidate,
          insertedEntry: entry,
          movedBlockKeys: chain.map(c => c.blockKey),
          chain,
          score,
          attempts
        };
      }
    };

    const visitedState = new Set();
    const moveBlockToSlot = (state, block, slot, depthLeft, chain, visited) => {
      if (budgetExceeded()) return null;
      if (!isRepairBlockMovable(block)) return null;
      const visitKey = `${block.key}->${repairSlotKey(slot)}:${depthLeft}`;
      if (visited.has(visitKey)) return null;
      const nextVisited = new Set(visited);
      nextVisited.add(visitKey);
      attempts++;
      if (timeExceeded()) return null;

      const base = removeRepairBlockFromEntries(state, block);
      const directMoved = makeMovedBlockEntries(block, slot, base, options);
      if (directMoved) {
        return { state: [...base, ...directMoved], chain: [...chain, logMove(block, slot)] };
      }
      if (depthLeft <= 0) return null;

      let nodeBlockers = uniqueMovableBlocks(getBlockingBlocksForMovedBlock(block, slot, base));
      if (!nodeBlockers.length) return null;
      if (nodeBlockers.some(b => !isRepairBlockMovable(b))) return null;
      nodeBlockers = nodeBlockers.slice(0, maxBlockersPerNode);
      if (!nodeBlockers.length) return null;

      const clearBlockers = (clearState, idx, clearChain, clearVisited) => {
        if (budgetExceeded()) return null;
        if (idx >= nodeBlockers.length) {
          const movedAfterClear = makeMovedBlockEntries(block, slot, clearState, options);
          if (!movedAfterClear) return null;
          return { state: [...clearState, ...movedAfterClear], chain: [...clearChain, logMove(block, slot)] };
        }
        const blocker = nodeBlockers[idx];
        if (!isRepairBlockMovable(blocker)) return null;
        const candidateSlots = rankRepairMoveSlotsForBlock(blocker, clearState, slotList, options, limits)
          .filter(s => repairSlotKey(s) !== repairSlotKey(slot));
        for (const altSlot of candidateSlots) {
          const moved = moveBlockToSlot(clearState, blocker, altSlot, depthLeft - 1, clearChain, clearVisited);
          if (!moved?.state) continue;
          const rest = clearBlockers(moved.state, idx + 1, moved.chain, clearVisited);
          if (rest?.state) return rest;
        }
        return null;
      };

      return clearBlockers(base, 0, chain, nextVisited);
    };

    const clearRootBlockers = (state, idx, chain, visited, depthLeft) => {
      if (budgetExceeded()) return;
      if (idx >= rootBlockers.length) {
        tryPlaceFinalItem(state, chain);
        return;
      }
      const blocker = rootBlockers[idx];
      if (!isRepairBlockMovable(blocker)) return;
      const candidateSlots = rankRepairMoveSlotsForBlock(blocker, state, slotList, options, limits)
        .filter(s => repairSlotKey(s) !== repairSlotKey(targetSlot));
      for (const altSlot of candidateSlots) {
        if (budgetExceeded()) break;
        const chainKey = `${idx}:${blocker.key}:${repairSlotKey(altSlot)}:${depthLeft}`;
        if (visitedState.has(chainKey)) continue;
        visitedState.add(chainKey);
        const moved = moveBlockToSlot(state, blocker, altSlot, depthLeft, chain, visited);
        if (!moved?.state) continue;
        clearRootBlockers(moved.state, idx + 1, moved.chain, visited, depthLeft);
        if (best && options.runAttempts !== "deep") break;
      }
    };

    clearRootBlockers([...current], 0, [], new Set(), maxDepth);
    return best ? { ...best, attempts } : { attempts };
  }

  // ── r40: min-conflicts 잔여 탈출 스테이지 ────────────────────────────
  // ejection-chain이 시간/깊이 예산 안에서 못 푸는 잔여 카드(특히 학년 전체
  // 동시활동이 교사 단일 가용성을 막는 케이스)를 위해, "충돌을 허용한 채 일단
  // 배치한 뒤 min-conflicts 국소탐색으로 충돌을 0으로 떨어뜨리는" 마지막 단계입니다.
  // 핵심 안전장치는 호출부의 품질 게이트입니다. 이 함수는 후보만 만들고,
  // 공식 validator 기준으로 더 나빠지면 호출부가 폐기하므로 기존 배치를 악화시킬 수 없습니다.

  // 같은 슬롯에 있는 두 엔트리가 하드 충돌(교사/학급/교실)인지 검사합니다.
  // checkPlacementValid의 충돌 의미를 슬롯이 동일하다는 가정 위에서 재사용합니다.
  function entriesHardConflictSameSlot(a = {}, b = {}) {
    if (a === b) return false;
    if (a.unitId && b.unitId && a.unitId === b.unitId) return false;
    const sameGrp = sameActiveGroup(a, b);
    const conc = sameGrp && isConcurrentItem(a) && isConcurrentItem(b);
    if (conc) return false;
    if (hasCompoundSiblingConflict(a, b)) return true;
    const at = teacherNamesForPlacement(a);
    const bt = teacherNamesForPlacement(b);
    if (at.some(t => bt.includes(t))) return true;
    if (audiencesConflict(audienceForPlacement(a), audienceForPlacement(b))) return true;
    if (roomsOverlapForPlacement(a, b)) return true;
    return false;
  }

  // 슬롯 버킷 기반 하드 충돌 쌍 개수. protectedBackdrop(고정/보호)도 함께 셉니다.
  function countStateConflicts(workingEntries = [], protectedBackdrop = []) {
    const buckets = new Map();
    const push = e => {
      if (!Number.isInteger(e.day) || !Number.isInteger(e.period)) return;
      const k = `${e.day}:${e.period}`;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(e);
    };
    (protectedBackdrop || []).forEach(push);
    (workingEntries || []).forEach(push);
    let total = 0;
    for (const list of buckets.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (entriesHardConflictSameSlot(list[i], list[j])) total++;
        }
      }
    }
    return total;
  }

  // 한 블록(동시그룹/단위/단일 엔트리)을 slot으로 강제 이동시킵니다(충돌 허용).
  // makeMovedBlockEntries와 달리 유효성 검사를 하지 않고 day/period/room만 재계산합니다.
  function relocateBlockEntriesForced(block = {}, slot = {}, base = []) {
    const out = [];
    for (const original of block.entries || []) {
      const candidateData = { ...original, day: Number(slot.day), period: Number(slot.period) };
      const roomed = applyAutoRoomToEntryData(candidateData, slot, [...base, ...out]);
      out.push(normalizeTimetableEntry({ ...original, ...roomed, id: original.id, day: Number(slot.day), period: Number(slot.period) }));
    }
    return out;
  }

  // block을 base(자기 자신 제외) 위에 놓았을 때 발생하는 하드 충돌 수.
  function blockConflictAtSlot(block, slot, base, protectedBackdrop) {
    const moved = relocateBlockEntriesForced(block, slot, base);
    // 보호 슬롯 침범은 절대 금지 → 매우 큰 페널티로 사실상 배제.
    for (const m of moved) {
      if (strongProtectedSlotConflict(m, slot, base)) return 1e6;
    }
    const slotPeers = [...base, ...protectedBackdrop].filter(e => e.day === slot.day && e.period === slot.period);
    let conflicts = 0;
    for (const m of moved) {
      for (const peer of slotPeers) {
        if (entriesHardConflictSameSlot(m, peer)) conflicts++;
      }
    }
    return conflicts;
  }

  async function tryMinConflictsResidualEscape(failedItems = [], baseSlots = [], placed = [], options = {}, progressUpdater = null, limits = {}) {
    const targets = (failedItems || []).filter(f => f?.item);
    if (!targets.length) return null;

    const protectedBackdrop = [...entries()];
    const orderedSlots = [...baseSlots];
    const maxMillis = Math.max(300, Number(limits.maxMillis || 1500));
    const maxIters = Math.max(200, Number(limits.maxIters || 6000));
    const startedAt = Date.now();
    const timeLeft = () => Date.now() - startedAt < maxMillis;

    let working = cloneAutoAssignData(placed) || [];
    const seededIds = new Set();

    const slotClassHitCount = (item, slot, list = []) => {
      const classKeys = classKeysForCapacity(item).map(normalizeClassKeyForReportKey).filter(Boolean);
      if (!classKeys.length) return 0;
      const all = [...protectedBackdrop, ...(list || [])];
      let hits = 0;
      for (const cls of classKeys) {
        if (all.some(e => e.day === slot.day && e.period === slot.period && classKeysForCapacity(e).map(normalizeClassKeyForReportKey).includes(cls))) hits++;
      }
      return hits;
    };

    const scoreSeedSlot = (item, pseudoBlock, slot, list = []) => {
      const hard = blockConflictAtSlot(pseudoBlock, slot, list, protectedBackdrop);
      const classHits = slotClassHitCount(item, slot, list);
      const teachers = teacherNamesForPlacement(item);
      const teacherBusy = teachers.reduce((n, teacher) => n + ([...protectedBackdrop, ...(list || [])].some(e => e.day === slot.day && e.period === slot.period && teacherNamesForPlacement(e).includes(teacher)) ? 1 : 0), 0);
      // 핵심: 마지막 2%는 "아무 슬롯"이 아니라 해당 반의 비어 있는 35칸 구멍에 먼저 시드해야 합니다.
      // hard conflict를 최우선으로 두되, 같은 반이 이미 찬 칸은 큰 패널티를 주어 학급 35칸 완성을 우선합니다.
      return hard * 10000 + classHits * 1400 + teacherBusy * 300 + Number(slot.period || 0) * 3 + Number(slot.day || 0);
    };

    // 1) 잔여 카드를 충돌 최소 슬롯에 강제 시드(충돌 허용).
    // r42: 시드 위치를 무작위 최소충돌이 아니라 "부족 학급의 빈칸 우선"으로 잡습니다.
    for (const failedItem of targets) {
      const item = failedItem.item;
      const seedEntry = makeAutoEntry(item, orderedSlots[0], working);
      if (!seedEntry) continue;
      const pseudoBlock = { key: `seed:${seededIds.size}`, entries: [seedEntry] };
      let bestSlot = null, bestScore = Infinity;
      for (const slot of shuffle([...orderedSlots])) {
        const score = scoreSeedSlot(item, pseudoBlock, slot, working);
        if (score < bestScore) {
          bestScore = score;
          bestSlot = slot;
          if (score === 0) break;
        }
      }
      if (!bestSlot || bestScore >= 1e10) continue;
      const seeded = relocateBlockEntriesForced(pseudoBlock, bestSlot, working);
      seeded.forEach(e => { e.autoMinConflictSeed = true; seededIds.add(e.id); });
      working.push(...seeded);
    }
    if (!seededIds.size) return null;

    // 2) min-conflicts 국소탐색: 충돌 블록을 최소 충돌 슬롯으로 이동. 가끔 무작위 이동으로 탈출.
    let iters = 0;
    let conflicts = countStateConflicts(working, protectedBackdrop);
    let progressTick = 0;
    while (conflicts > 0 && iters < maxIters && timeLeft()) {
      iters++;
      const blocks = getMovableBlocks(working).filter(isRepairBlockMovable);
      // 현재 충돌에 가담 중인 블록만 후보로.
      const conflicted = blocks.filter(b => {
        const base = removeRepairBlockFromEntries(working, b);
        const slot = { day: b.entries[0].day, period: b.entries[0].period };
        return blockConflictAtSlot(b, slot, base, protectedBackdrop) > 0;
      });
      if (!conflicted.length) break;
      const pick = conflicted[Math.floor(Math.random() * conflicted.length)];
      const base = removeRepairBlockFromEntries(working, pick);
      const curSlot = { day: pick.entries[0].day, period: pick.entries[0].period };
      let target = curSlot;
      let targetC = blockConflictAtSlot(pick, curSlot, base, protectedBackdrop);
      const classPenaltyForBlock = (slot) => (pick.entries || []).reduce((sum, entry) => sum + slotClassHitCount(entry, slot, base) * 250, 0);
      let targetScore = targetC * 10000 + classPenaltyForBlock(curSlot);
      const explore = Math.random() < 0.15; // 15% 무작위 이동으로 국소최솟값 탈출
      for (const slot of shuffle([...orderedSlots])) {
        const c = blockConflictAtSlot(pick, slot, base, protectedBackdrop);
        const score = c * 10000 + classPenaltyForBlock(slot) + Number(slot.period || 0) * 3 + Number(slot.day || 0);
        if (explore) { if (c < 1e6) { target = slot; targetC = c; targetScore = score; break; } }
        else if (score < targetScore) { target = slot; targetC = c; targetScore = score; if (score === 0) break; }
      }
      const moved = relocateBlockEntriesForced(pick, target, base);
      working = [...base, ...moved];
      conflicts = countStateConflicts(working, protectedBackdrop);

      if (progressUpdater && (++progressTick % 40 === 0)) {
        await progressUpdater({
          percent: 90,
          step: 'r40 min-conflicts 잔여 탈출',
          detail: `잔여 ${targets.length}시수 충돌 해소 중 · 남은 충돌 ${conflicts}건 (반복 ${iters})`,
          placed: protectedBackdrop.length + working.length,
          failed: targets.length,
          currentCard: 'min-conflicts 탈출',
          log: `min-conflicts iter ${iters} conflicts ${conflicts}`
        });
      }
    }

    if (conflicts > 0) return null; // 충돌을 다 못 없애면 폐기(호출부 변화 없음).

    // 3) 시드가 모두 살아있는지 확인.
    const survivingSeeds = working.filter(e => seededIds.has(e.id)).length;
    if (survivingSeeds < seededIds.size) return null;

    const placedOut = working.map(e => { const c = { ...e }; delete c.autoMinConflictSeed; return c; });
    // failed 재계산은 호출부(autoAssignAll 스코프의 makeCoverageShortageFailures)에서 수행합니다.
    return { placed: placedOut, repairedCount: seededIds.size, iters };
  }

  function orderRepairTargetSlotsForItem(item = {}, orderedSlots = [], placed = []) {
    const classKeys = [...classKeysForCapacity(item)].map(normalizeClassKeyForReportKey).filter(Boolean);
    if (!classKeys.length) return [...orderedSlots];
    const existing = [...entries(), ...(placed || [])];
    const byClass = new Map();
    classKeys.forEach(cls => byClass.set(cls, new Set()));
    existing.forEach(entry => {
      if (!Number.isInteger(entry.day) || !Number.isInteger(entry.period)) return;
      const slotKey = `${entry.day}:${entry.period}`;
      const eKeys = entryClassKeysForScoring(entry).map(normalizeClassKeyForReportKey).filter(Boolean);
      classKeys.forEach(cls => {
        if (eKeys.includes(cls)) byClass.get(cls)?.add(slotKey);
      });
    });
    const target = Math.max(0, (parseInt(ttConfig().periodCount, 10) || 7) * 5);
    const classShortage = classKeys.reduce((sum, cls) => sum + Math.max(0, target - (byClass.get(cls)?.size || 0)), 0);
    return [...orderedSlots].sort((a, b) => {
      const ak = `${a.day}:${a.period}`;
      const bk = `${b.day}:${b.period}`;
      const aHits = classKeys.reduce((n, cls) => n + (byClass.get(cls)?.has(ak) ? 1 : 0), 0);
      const bHits = classKeys.reduce((n, cls) => n + (byClass.get(cls)?.has(bk) ? 1 : 0), 0);
      // 부족 학급의 완전 빈칸을 가장 먼저 봅니다. 교사가 막혀 있으면 그 교사 수업 1개를 옮기는 복구가 여기서 작동합니다.
      if (aHits !== bHits) return aHits - bHits;
      // 부족이 클수록 오전/앞 교시부터 빠르게 채워 안정적인 35칸을 만듭니다.
      if (classShortage > 0 && a.period !== b.period) return a.period - b.period;
      if (a.day !== b.day) return a.day - b.day;
      return a.period - b.period;
    });
  }

  async function repairFailedItemsBySingleMove(failedItems = [], baseSlots = [], placed = [], options = {}, progressUpdater = null) {
    const current = [...placed];
    const remaining = [];
    const repaired = [];
    const orderedSlots = [...baseSlots].sort((a, b) => a.period - b.period || a.day - b.day);
    // r30: 최종 목표는 모든 카드 시수 충족입니다. 남은 5~10시수 구간에서는
    // 초기 배치보다 복구 탐색 깊이가 더 중요하므로, 정교한 배치에서 1~다중 이동 탐색폭을 넓힙니다.
    const maxFailedToTry = options.runAttempts === 'deep' ? 360 : (options.runAttempts === 'fast' ? 48 : 120);
    const maxBlockersPerSlot = options.runAttempts === 'deep' ? 36 : 12;
    const maxMoveSlotsPerBlock = options.runAttempts === 'deep' ? orderedSlots.length : Math.min(36, orderedSlots.length);
    const maxEvacuateBlocks = options.runAttempts === 'deep' ? 7 : 4;
    const maxMultiMoveSlotsPerBlock = options.runAttempts === 'deep' ? orderedSlots.length : Math.min(28, orderedSlots.length);
    const maxRepairAttempts = options.runAttempts === 'deep' ? 90000 : (options.runAttempts === 'fast' ? 2400 : 9000);
    const maxChainCalls = options.runAttempts === 'deep' ? 28 : (options.runAttempts === 'fast' ? 8 : 14);
    const maxChainTargetSlots = options.runAttempts === 'deep' ? 14 : (options.runAttempts === 'fast' ? 5 : 8);
    const maxChainAttemptsPerCall = options.runAttempts === 'deep' ? 2500 : (options.runAttempts === 'fast' ? 450 : 900);
    const maxChainMillisPerCall = options.runAttempts === 'deep' ? 650 : (options.runAttempts === 'fast' ? 180 : 320);
    // r84: 잔여 복구 기능을 세분화합니다.
    // 균형 배치에서는 가벼운 2-cycle 복구만 허용하고, 브라우저를 오래 잡아먹는
    // ejection-chain은 정교한 배치에서만 실행되도록 분리합니다.
    const allowEjectionChainRepair = experimentalResidualRepairEnabled({ ...options, engineProfile: options.engineProfile })
      && options?.engineProfile?.enableEjectionChainRepair === true;
    let attempts = 0;
    let chainCalls = 0;
    let lastRepairYieldAt = Date.now();
    let lastRepairYieldAttempts = 0;
    const maybeYieldRepairProgress = async (failedItem = {}, phase = '미배치 복구 탐색', force = false) => {
      if (!progressUpdater) return;
      const now = Date.now();
      const attemptDelta = attempts - lastRepairYieldAttempts;
      if (!force && attemptDelta < 120 && (now - lastRepairYieldAt) < 450) return;
      lastRepairYieldAt = now;
      lastRepairYieldAttempts = attempts;
      await progressUpdater({
        percent: 83,
        step: phase,
        detail: `기존 수업 이동/교환으로 미배치 수업을 넣을 수 있는지 확인 중입니다. 시도 ${attempts.toLocaleString('ko-KR')}회 · 복구 ${repaired.length}건`,
        placed: current.length,
        failed: Math.max(0, failedItems.length - repaired.length),
        currentCard: failedItem.name || getAutoItemName(failedItem.item || failedItem) || '-'
      });
    };

    for (let idx = 0; idx < failedItems.length; idx++) {
      const failedItem = failedItems[idx];
      const item = failedItem?.item;
      if (!item || idx >= maxFailedToTry) {
        remaining.push(failedItem);
        continue;
      }

      let done = false;

      // 이전 복구로 새 빈칸이 생긴 경우 바로 배치합니다.
      const directSlot = findBestAutoSlot(item, orderedSlots, current, options);
      if (directSlot) {
        const entry = makeAutoEntry(item, directSlot, current);
        if (entry) {
          current.push(entry);
          repaired.push({ ...failedItem, repairMode: 'direct-after-repair' });
          done = true;
        }
      }

      const targetSlots = orderRepairTargetSlotsForItem(item, orderedSlots, current);
      for (let targetSlotIndex = 0; targetSlotIndex < targetSlots.length; targetSlotIndex++) {
        const targetSlot = targetSlots[targetSlotIndex];
        if (done) break;
        const blockers = getBlockingBlocksForSlot(item, targetSlot, current).slice(0, maxBlockersPerSlot);
        if (!blockers.length) continue;

        for (const block of blockers) {
          if (done) break;
          if (attempts >= maxRepairAttempts) break;
          const blockIds = new Set(block.entries.map(e => e.id));
          const withoutBlock = current.filter(e => !blockIds.has(e.id));
          const moveSlots = shuffle([...orderedSlots]).slice(0, maxMoveSlotsPerBlock);

          for (const moveSlot of moveSlots) {
            attempts++;
            if (attempts % 120 === 0) await maybeYieldRepairProgress(failedItem);
            if (attempts >= maxRepairAttempts) break;
            if (moveSlot.day === targetSlot.day && moveSlot.period === targetSlot.period) continue;
            const moved = makeMovedBlockEntries(block, moveSlot, withoutBlock, options);
            if (!moved) continue;
            const baseWithMoved = [...withoutBlock, ...moved];
            if (!checkPlacementValid(item, targetSlot, baseWithMoved, options)) continue;
            const entry = makeAutoEntry(item, targetSlot, baseWithMoved);
            if (!entry) continue;
            current.length = 0;
            current.push(...baseWithMoved, entry);
            repaired.push({ ...failedItem, repairMode: 'single-move', movedBlock: block.key });
            done = true;
            break;
          }
        }

        // 한 칸에 여러 수업 블록이 걸려 막힌 경우, 차단 블록 2~3개를 동시에 다른 칸으로 이동한 뒤
        // 미배치 수업을 넣는 다중 이동 복구를 시도합니다. 기존 single-move로는 해결되지 않는
        // 학급+교사+교실 복합 차단을 줄이기 위한 단계입니다.
        if (!done && blockers.length > 1 && blockers.length <= maxEvacuateBlocks && attempts < maxRepairAttempts) {
          const multi = tryEvacuateBlockingBlocksForSlot(item, targetSlot, blockers, current, orderedSlots, options, {
            maxBlocks: maxEvacuateBlocks,
            maxMoveSlotsPerBlock: maxMultiMoveSlotsPerBlock,
            maxAttempts: Math.max(80, Math.min(options.runAttempts === 'deep' ? 3500 : 900, maxRepairAttempts - attempts)),
            maxMillis: options.runAttempts === 'deep' ? 520 : (options.runAttempts === 'fast' ? 120 : 220)
          });
          attempts += Number(multi?.attempts || 0);
          if (multi?.timedOut) await maybeYieldRepairProgress(failedItem, '다중 이동 후보 시간 제한', true);
          if (multi?.entries?.length) {
            current.length = 0;
            current.push(...multi.entries);
            repaired.push({ ...failedItem, repairMode: 'multi-move', movedBlocks: multi.movedBlockKeys || [] });
            done = true;
          }
        }

        if (!done && allowEjectionChainRepair && blockers.length && attempts < maxRepairAttempts && chainCalls < maxChainCalls && targetSlotIndex < maxChainTargetSlots) {
          chainCalls++;
          const chainOptions = {
            ...options,
            runAttempts: 'deep',
            engineProfile: autoEngineProfileForMode('deep'),
            respectSoftLimits: false,
            respectUnavailable: options.respectUnavailable !== false,
            respectAssignedRoom: options.respectAssignedRoom !== false
          };
          const chain = tryEjectionChainForSlot(item, targetSlot, blockers, current, orderedSlots, chainOptions, {
            maxDepth: options.runAttempts === 'deep' ? 5 : 3,
            maxBranchSlots: options.runAttempts === 'deep' ? 12 : 7,
            maxBlockersPerNode: options.runAttempts === 'deep' ? 3 : 2,
            maxRootBlockers: options.runAttempts === 'deep' ? Math.min(4, maxEvacuateBlocks + 1) : Math.min(3, maxEvacuateBlocks + 1),
            maxAttempts: Math.max(80, Math.min(maxChainAttemptsPerCall, maxRepairAttempts - attempts)),
            maxMillis: maxChainMillisPerCall
          });
          attempts += Number(chain?.attempts || 0);
          if (progressUpdater) {
            await progressUpdater({
              percent: 82,
              step: 'r39 시간제한 연쇄 이동 탐색',
              detail: `연쇄 이동 후보 ${chainCalls}/${maxChainCalls}회 확인 중입니다. 페이지 응답성을 위해 짧게 나누어 탐색합니다.`,
              placed: current.length,
              failed: Math.max(0, failedItems.length - repaired.length),
              currentCard: failedItem.name || getAutoItemName(item),
              log: `chain attempts ${Number(chain?.attempts || 0)}`
            });
          }
          if (chain?.entries?.length) {
            current.length = 0;
            current.push(...chain.entries);
            repaired.push({
              ...failedItem,
              repairMode: 'ejection-chain',
              movedBlocks: chain.movedBlockKeys || [],
              chainDepth: chain.chain?.length || 0,
              chain: chain.chain || []
            });
            done = true;
            if (progressUpdater) {
              await progressUpdater({
                percent: 84,
                step: 'r39 시간제한 연쇄 이동 복구',
                detail: `${failedItem.name || getAutoItemName(item)}: ${chain.chain?.length || 0}단계 연쇄 이동으로 ${['월','화','수','목','금'][Number(targetSlot.day)] || '?'}${Number(targetSlot.period) + 1} 배치`,
                placed: current.length,
                failed: Math.max(0, failedItems.length - repaired.length),
                currentCard: failedItem.name || getAutoItemName(item),
                log: `ejection-chain ${chain.chain?.length || 0} moves`
              });
            }
          }
        }

        await maybeYieldRepairProgress(failedItem);
      }

      if (!done) remaining.push(failedItem);
    }

    // 시도 한도를 넘겨 건너뛴 항목이 있다면 그대로 남깁니다.
    if (failedItems.length > maxFailedToTry) {
      // 이미 loop에서 remaining에 넣습니다. 중복 방지를 위해 추가 작업 없음.
    }

    return { placed: current, repaired, remaining, attempts };
  }

  async function improveAutoPlacement(placed = [], baseSlots = [], options = {}, progressUpdater = null) {
    const current = [...placed];
    const profile = options.engineProfile || autoEngineProfileForMode(options.runAttempts);
    const limit = Math.max(0, Number(profile.postProcessLimit) || 0);
    const maxPasses = Math.max(0, Number(profile.postProcessPasses) || 0);
    let attempts = 0;
    let improved = 0;
    let bestScore = scoreScheduleQuality(current, options);
    if (limit <= 0 || maxPasses <= 0) {
      return { placed: current, improvedCount: 0, attempts: 0, qualityScore: Math.round(bestScore * 10) / 10 };
    }

    const orderedSlots = [...baseSlots].sort((a, b) => {
      if (a.period !== b.period) return a.period - b.period;
      return a.day - b.day;
    });

    for (let pass = 0; pass < maxPasses && attempts < limit; pass++) {
      let passImproved = false;
      const blocks = shuffle(getMovableBlocks(current));
      for (const block of blocks) {
        if (attempts >= limit) break;
        const origin = block.entries[0];
        const originSlotKey = `${origin.day}:${origin.period}`;
        const currentIds = new Set(block.entries.map(e => e.id));
        const baseWithout = current.filter(e => !currentIds.has(e.id));

        for (const slot of orderedSlots) {
          if (attempts >= limit) break;
          if (`${slot.day}:${slot.period}` === originSlotKey) continue;
          attempts++;

          const moved = makeMovedBlockEntries(block, slot, baseWithout);
          if (!moved) continue;
          const candidate = [...baseWithout, ...moved];
          const candScore = scoreScheduleQuality(candidate, options);
          if (candScore + 0.01 < bestScore) {
            current.length = 0;
            current.push(...candidate);
            bestScore = candScore;
            improved++;
            passImproved = true;
            break;
          }
        }
        if (progressUpdater && attempts % 35 === 0) {
          await progressUpdater({
            percent: 92,
            step: "자동배치 후처리",
            detail: `설정한 점수 기준으로 후보를 검토하고 있습니다. 개선 ${improved}건`,
            placed: current.length,
            best: current.length,
            failed: 0,
            currentCard: "후처리"
          }, false);
        }
      }
      if (!passImproved) break;
    }

    return { placed: current, improvedCount: improved, attempts, qualityScore: Math.round(bestScore * 10) / 10 };
  }

  function makeFailedPlacement(name, item, meta = {}) {
    return { name: name || getAutoItemName(item), item, ...meta };
  }

  function getGroupAutoCardIds(group, unitItems = []) {
    const excluded = new Set(group?.excludedCardIds || []);
    return new Set([
      ...(group?.poolCardIds || []),
      ...((group?.units || []).flatMap(u => u.ttcardIds || [])),
      ...(unitItems || []).flatMap(u => (u.ttcards || []).map(c => c.id)),
    ].filter(id => id && !excluded.has(id)));
  }

  function getExcludedGroupIdsForCard(cardId) {
    if (!cardId) return [];
    return ttGroups()
      .filter(group => (group.excludedCardIds || []).includes(cardId))
      .map(group => group.id);
  }

  function hasAutoGroupExclusionSlotConflict(item, existingEntry) {
    if (!item || !existingEntry) return false;

    const itemCardIds = ttCardIdsFromPlacement(item).filter(Boolean);
    const entryCardIds = ttCardIdsFromPlacement(existingEntry).filter(Boolean);

    // Case A. We are placing an auto group. A card explicitly removed from this
    // group must not be placed in the same slot by coincidence.
    if (item.groupId && entryCardIds.some(cardId => getExcludedGroupIdsForCard(cardId).includes(item.groupId))) {
      return true;
    }

    // Case B. We are placing a standalone card. If that card was explicitly
    // excluded from an auto group, it must stay away from that group's slots.
    if (existingEntry.groupId && itemCardIds.some(cardId => getExcludedGroupIdsForCard(cardId).includes(existingEntry.groupId))) {
      return true;
    }

    return false;
  }

  function countPinnedGroupSlots(group, unitItems, pinnedEntries) {
    const cardIds = getGroupAutoCardIds(group, unitItems);
    const slots = new Set();
    pinnedEntries.forEach(e => {
      const cardMatch = (e.ttcardId && cardIds.has(e.ttcardId)) || (e.ttcardIds || []).some(id => cardIds.has(id));
      const unitMatch = (unitItems || []).some(u => u.unit?.id && e.unitId === u.unit.id);
      if (e.groupId === group.id || cardMatch || unitMatch) slots.add(`${e.day}:${e.period}`);
    });
    return slots.size;
  }

  function getCompoundKeyForCard(card) {
    const ref = compoundRefForCard(card);
    return ref?.key || "";
  }

  function getCardsForGroupOccurrence(cards = [], occurrenceIndex = 0) {
    const normalCards = [];
    const compoundBuckets = new Map();

    (cards || []).filter(Boolean).forEach(card => {
      const key = getCompoundKeyForCard(card);
      if (!key) {
        if (occurrenceIndex < Math.max(0, Number(getCreditsForTtCard(card)) || 0)) normalCards.push(card);
        return;
      }
      if (!compoundBuckets.has(key)) compoundBuckets.set(key, []);
      compoundBuckets.get(key).push(card);
    });

    const selectedCompoundCards = [];
    compoundBuckets.forEach(bucket => {
      const ordered = [...bucket].sort((a, b) => {
        const ai = Number.isInteger(a.compoundPartIndex) ? a.compoundPartIndex : 999;
        const bi = Number.isInteger(b.compoundPartIndex) ? b.compoundPartIndex : 999;
        if (ai !== bi) return ai - bi;
        return String(a.subject || a.id || "").localeCompare(String(b.subject || b.id || ""), "ko", { numeric: true });
      });
      const ranges = ordered.map(card => ({ card, credits: Math.max(0, Number(getCreditsForTtCard(card)) || 0) }))
        .filter(x => x.credits > 0);
      const total = ranges.reduce((sum, x) => sum + x.credits, 0);
      if (!total) return;
      let cursor = occurrenceIndex % total;
      for (const item of ranges) {
        if (cursor < item.credits) {
          selectedCompoundCards.push(item.card);
          return;
        }
        cursor -= item.credits;
      }
    });

    return [...normalCards, ...selectedCompoundCards];
  }

  function getGroupItemForOccurrence(groupItem = {}, occurrenceIndex = 0) {
    const filteredCards = getCardsForGroupOccurrence(groupItem.ttcards || [], occurrenceIndex);
    return { ...groupItem, ttcards: filteredCards };
  }

  function getGroupRoomBatches(group, cards = []) {
    const validCards = (cards || []).filter(Boolean);
    if (validCards.length <= 1) return validCards.length ? [validCards] : [];

    const units = group?.units || [];
    const usedCardIds = new Set();
    const batches = [];

    units.forEach(unit => {
      const ids = new Set(unit.ttcardIds || []);
      const unitCards = validCards.filter(card => ids.has(card.id));
      if (!unitCards.length) return;
      unitCards.forEach(card => usedCardIds.add(card.id));
      // 같은 수업 묶음(unit)은 하나의 배치로 유지합니다.
      batches.push(unitCards);
    });

    validCards.forEach(card => {
      if (usedCardIds.has(card.id)) return;
      // 같은 수업 묶음이 아닌 병렬 과목은 카드별로 분리합니다.
      batches.push([card]);
    });

    return batches;
  }

  function collectActiveGroupCards(activeItems = []) {
    const seenCardIds = new Set();
    const activeCards = [];
    (activeItems || []).filter(Boolean).forEach(item => {
      (item.ttcards || []).forEach(card => {
        if (!card?.id || seenCardIds.has(card.id)) return;
        seenCardIds.add(card.id);
        activeCards.push(card);
      });
    });
    return activeCards;
  }

  function makeSingleGroupPlacementItem(group, activeItems = []) {
    const activeList = (activeItems || []).filter(Boolean);
    const activeCards = collectActiveGroupCards(activeList);
    if (!group || !activeCards.length) return null;

    const groupName = group.name || group.groupName || group.label || "그룹 카드";
    const cardIds = activeCards.map(card => card.id).filter(Boolean);
    const templateIds = [...new Set(activeCards.map(card => card.templateId).filter(Boolean))];
    const gradeKeys = [...new Set(activeCards.flatMap(card => [card.gradeKey, ...(card.gradeKeys || [])]).filter(Boolean))];
    const teachers = [...new Set(activeCards.flatMap(card => getTeachersForTtCard(card)).filter(Boolean))];
    const sourceItem = activeList[0] || {};

    const fromDataModule = makePlacementFromGroupItem(group, {
      ...sourceItem,
      unit: null,
      ttcards: activeCards
    });

    const item = fromDataModule || {
      kind: "group",
      groupId: group.id || null,
      groupName,
      subject: groupName,
      label: groupName,
      ttcards: activeCards,
      ttcardIds: cardIds,
      templateIds,
      gradeKeys,
      teacherName: teachers.join(",")
    };

    return annotateRestrictedAutoItem({
      ...item,
      kind: "group",
      groupId: group.id || item.groupId || null,
      groupName,
      subject: item.subject || groupName,
      label: item.label || groupName,
      ttcards: activeCards,
      ttcardIds: cardIds,
      templateIds: item.templateIds || templateIds,
      gradeKeys: item.gradeKeys || gradeKeys,
      teacherName: item.teacherName || teachers.join(","),
      autoGroupAsSingleCard: true,
      autoGroupSourceCardCount: cardIds.length
    });
  }

  function placeAutoGroupSlot(group, activeItems, slot, placed, checkOptions = {}) {
    // r97: 그룹카드는 내부 카드를 과목별 entry로 쪼개지 않고,
    // 하나의 큰 카드로 저장합니다. 예: 7체육은 7A/7B 칸을 동시에 차지하는 entry 1개입니다.
    const item = makeSingleGroupPlacementItem(group, activeItems);
    if (!item) return false;
    if (!checkPlacementValid(item, slot, placed, checkOptions)) return false;
    const entry = makeAutoEntry(item, slot, placed);
    if (!entry) return false;
    placed.push(normalizeTimetableEntry({
      ...entry,
      autoGroupAsSingleCard: true
    }));
    return true;
  }

  const waitForBrowser = () => new Promise(resolve => setTimeout(resolve, 0));

  // r96: Chrome "응답 없는 페이지" 방지용 검색 예산입니다.
  // 한 block의 재귀 displacement가 브라우저 메인 스레드를 오래 붙잡지 않게 합니다.
  function freshMakeSearchBudget(ms = 220, maxAttempts = 1400) {
    const now = Date.now();
    return {
      deadline: now + Math.max(60, Number(ms) || 220),
      attempts: 0,
      maxAttempts: Math.max(80, Number(maxAttempts) || 1400),
      timedOut: false
    };
  }

  function freshBudgetTick(budget, step = 1) {
    if (!budget) return true;
    budget.attempts += Math.max(1, Number(step) || 1);
    if (budget.attempts > budget.maxAttempts || Date.now() > budget.deadline) {
      budget.timedOut = true;
      return false;
    }
    return true;
  }

  function freshBudgetForPhase(mode = "balanced", phase = "strict") {
    const m = String(mode || "balanced");
    if (phase === "repair") {
      if (m === "deep") return freshMakeSearchBudget(420, 2400);
      if (m === "fast") return freshMakeSearchBudget(160, 900);
      return freshMakeSearchBudget(260, 1500);
    }
    if (phase === "relaxed") {
      if (m === "deep") return freshMakeSearchBudget(520, 2800);
      if (m === "fast") return freshMakeSearchBudget(160, 900);
      return freshMakeSearchBudget(300, 1700);
    }
    if (m === "deep") return freshMakeSearchBudget(360, 2200);
    if (m === "fast") return freshMakeSearchBudget(120, 700);
    return freshMakeSearchBudget(220, 1300);
  }

  let autoAssignRunning = false;
  function createAutoAssignProgressDialog(totalTarget = 0, onCancel = null) {
    const old = document.getElementById("ttAutoAssignProgressOverlay");
    if (old) old.remove();

    let cancelled = false;
    const overlay = document.createElement("div");
    overlay.id = "ttAutoAssignProgressOverlay";
    overlay.className = "tt-auto-progress-overlay";
    // Inline fallback: GitHub Pages/cache 문제로 CSS가 늦게 적용되어도 반드시 팝업 중앙에 뜨게 합니다.
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.56);backdrop-filter:blur(3px);padding:24px;box-sizing:border-box;";
    overlay.innerHTML = `
      <div class="tt-auto-progress-card" role="dialog" aria-modal="true" aria-live="polite" tabindex="-1">
        <div class="tt-auto-progress-head">
          <div>
            <div class="tt-auto-progress-title">자동배치 진행 중</div>
            <div class="tt-auto-progress-subtitle">조건을 비교하며 시간표를 구성하고 있습니다.</div>
          </div>
          <span class="tt-auto-progress-badge">RUNNING</span>
        </div>
        <div class="tt-auto-progress-step">준비 중...</div>
        <div class="tt-auto-progress-detail">자동배치 데이터를 준비하고 있습니다.</div>
        <div class="tt-auto-progress-bar-wrap"><div class="tt-auto-progress-bar"></div></div>
        <div class="tt-auto-progress-percent">0%</div>
        <div class="tt-auto-progress-stats">
          <span>전체 <b data-k="total">${totalTarget}</b></span>
          <span>현재 배치 <b data-k="placed">0</b></span>
          <span>최선 배치 <b data-k="best">0</b></span>
          <span>미배치 후보 <b data-k="failed">0</b></span>
        </div>
        <div class="tt-auto-progress-current">현재 카드: -</div>
        <div class="tt-auto-progress-log"></div>
        <div class="tt-auto-progress-actions">
          <button type="button" class="tt-auto-progress-cancel">취소</button>
          <button type="button" class="tt-auto-progress-close" disabled>닫기</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.body.classList.add("tt-auto-progress-open");

    const stepEl = overlay.querySelector(".tt-auto-progress-step");
    const detailEl = overlay.querySelector(".tt-auto-progress-detail");
    const barEl = overlay.querySelector(".tt-auto-progress-bar");
    const percentEl = overlay.querySelector(".tt-auto-progress-percent");
    const badgeEl = overlay.querySelector(".tt-auto-progress-badge");
    const titleEl = overlay.querySelector(".tt-auto-progress-title");
    const subtitleEl = overlay.querySelector(".tt-auto-progress-subtitle");
    const currentEl = overlay.querySelector(".tt-auto-progress-current");
    const closeBtn = overlay.querySelector(".tt-auto-progress-close");
    const cancelBtn = overlay.querySelector(".tt-auto-progress-cancel");
    const logEl = overlay.querySelector(".tt-auto-progress-log");
    const cardEl = overlay.querySelector(".tt-auto-progress-card");
    const actionsEl = overlay.querySelector(".tt-auto-progress-actions");

    // Strong inline styling: the dialog must stay readable even if an older
    // cached style.css is still being served by GitHub Pages.
    if (cardEl) {
      cardEl.style.cssText = "width:min(560px,calc(100vw - 32px));max-height:min(720px,calc(100vh - 40px));overflow:auto;background:#fff;border:1px solid #dbe4f0;border-radius:22px;box-shadow:0 32px 100px rgba(15,23,42,.38);padding:0;outline:none;color:#172033;font-family:inherit;";
      const head = overlay.querySelector(".tt-auto-progress-head");
      if (head) head.style.cssText = "display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:22px 24px 16px;border-bottom:1px solid #eef2f7;background:linear-gradient(135deg,#f8fbff,#eef6ff);";
      const bodyEls = [".tt-auto-progress-step",".tt-auto-progress-detail",".tt-auto-progress-bar-wrap",".tt-auto-progress-percent",".tt-auto-progress-stats",".tt-auto-progress-current",".tt-auto-progress-log",".tt-auto-progress-actions"];
      bodyEls.forEach(sel => { const el = overlay.querySelector(sel); if (el) el.classList.add("tt-auto-progress-body-item"); });
      const step = overlay.querySelector(".tt-auto-progress-step");
      if (step) step.style.cssText = "margin:18px 24px 6px;font-size:15px;font-weight:900;color:#173b68;";
      const detail = overlay.querySelector(".tt-auto-progress-detail");
      if (detail) detail.style.cssText = "margin:0 24px 14px;min-height:28px;font-size:13px;line-height:1.55;color:#475569;";
      const barWrap = overlay.querySelector(".tt-auto-progress-bar-wrap");
      if (barWrap) barWrap.style.cssText = "margin:0 24px;height:12px;border-radius:999px;overflow:hidden;background:#e5eaf2;border:1px solid #d9e2ec;";
      if (barEl) barEl.style.cssText = "width:0%;height:100%;border-radius:inherit;background:linear-gradient(90deg,#2563eb,#7c3aed);transition:width .16s ease;";
      if (percentEl) percentEl.style.cssText = "margin:6px 24px 0;text-align:right;font-size:12px;font-weight:900;color:#334155;";
      const stats = overlay.querySelector(".tt-auto-progress-stats");
      if (stats) stats.style.cssText = "display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:14px 24px 0;";
      overlay.querySelectorAll(".tt-auto-progress-stats span").forEach(el => el.style.cssText = "background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:8px 9px;font-size:12px;color:#64748b;");
      overlay.querySelectorAll(".tt-auto-progress-stats b").forEach(el => el.style.cssText = "display:block;margin-top:2px;color:#0f172a;font-size:15px;");
      if (currentEl) currentEl.style.cssText = "margin:12px 24px 0;padding:9px 11px;border-radius:12px;background:#eff6ff;color:#1e40af;font-size:13px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      if (logEl) logEl.style.cssText = "margin:12px 24px 0;padding:10px 12px;border-radius:12px;background:#f8fafc;border:1px dashed #cbd5e1;font-size:12px;line-height:1.55;color:#64748b;max-height:110px;overflow:auto;";
      if (actionsEl) actionsEl.style.cssText = "display:flex;justify-content:flex-end;gap:8px;margin:16px 24px 22px;";
      if (cancelBtn) cancelBtn.style.cssText = "border:0;border-radius:10px;color:#fff;font-weight:900;padding:9px 16px;cursor:pointer;background:#dc2626;";
      if (closeBtn) closeBtn.style.cssText = "border:0;border-radius:10px;color:#fff;font-weight:900;padding:9px 16px;cursor:pointer;background:#173b68;";
    }

    const stat = (key, value) => {
      const el = overlay.querySelector(`[data-k="${key}"]`);
      if (el && value !== undefined && value !== null) el.textContent = String(value);
    };
    const logs = [];
    const esc = v => String(v ?? "").replace(/[<>&]/g, ch => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[ch]));
    const setPercent = (value) => {
      const pct = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
      barEl.style.width = `${pct}%`;
      percentEl.textContent = `${pct}%`;
    };
    const removeOverlay = () => {
      overlay.remove();
      document.body.classList.remove("tt-auto-progress-open");
    };
    closeBtn.addEventListener("click", removeOverlay);
    cancelBtn.addEventListener("click", () => {
      if (cancelled) return;
      cancelled = true;
      cancelBtn.disabled = true;
      cancelBtn.textContent = "취소 요청됨";
      badgeEl.textContent = "CANCEL";
      stepEl.textContent = "취소 요청";
      detailEl.textContent = "현재 계산 단계를 정리한 뒤 자동배치를 중단합니다.";
      if (typeof onCancel === "function") onCancel();
    });
    overlay.addEventListener("keydown", e => {
      if (e.key === "Escape" && !closeBtn.disabled) removeOverlay();
    });
    setTimeout(() => cardEl?.focus(), 0);

    return {
      isCancelled() { return cancelled; },
      async update(data = {}) {
        if (data.title) titleEl.textContent = data.title;
        if (data.subtitle) subtitleEl.textContent = data.subtitle;
        if (data.step) stepEl.textContent = data.step;
        if (data.detail) detailEl.textContent = data.detail;
        if (data.currentCard !== undefined) currentEl.textContent = `현재 카드: ${data.currentCard || "-"}`;
        if (data.percent !== undefined) setPercent(data.percent);
        stat("total", data.total);
        stat("placed", data.placed);
        stat("best", data.best);
        stat("failed", data.failed);
        if (data.log) {
          logs.unshift(data.log);
          while (logs.length > 6) logs.pop();
          logEl.innerHTML = logs.map(line => `<div>• ${esc(line)}</div>`).join("");
        }
        await waitForBrowser();
      },
      async complete(data = {}) {
        overlay.classList.add(data.partial ? "is-partial" : "is-complete");
        cancelBtn.disabled = true;
        cancelBtn.style.display = "none";
        badgeEl.textContent = data.partial ? "PARTIAL" : "DONE";
        titleEl.textContent = data.title || (data.partial ? "자동배치 부분 완료" : "자동배치 완료");
        subtitleEl.textContent = data.subtitle || "결과를 확인해 주세요.";
        stepEl.textContent = data.step || "완료";
        detailEl.innerHTML = data.detailHtml || esc(data.detail || "자동배치가 완료되었습니다.");
        setPercent(100);
        if (data.placed !== undefined) stat("placed", data.placed);
        if (data.best !== undefined) stat("best", data.best);
        if (data.failed !== undefined) stat("failed", data.failed);
        if (data.currentCard !== undefined) currentEl.textContent = `현재 카드: ${data.currentCard || "-"}`;
        actionsEl?.querySelectorAll?.('[data-auto-extra-action="1"]')?.forEach(btn => btn.remove());
        const extraActions = Array.isArray(data.actions) ? data.actions : [];
        extraActions.forEach(action => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.dataset.autoExtraAction = "1";
          btn.className = `tt-auto-progress-extra-action ${action.className || ""}`.trim();
          btn.textContent = action.label || "실행";
          btn.style.cssText = action.danger
            ? "border:0;border-radius:10px;color:#fff;font-weight:900;padding:9px 16px;cursor:pointer;background:#b91c1c;"
            : "border:0;border-radius:10px;color:#fff;font-weight:900;padding:9px 16px;cursor:pointer;background:#2563eb;";
          btn.addEventListener("click", async () => {
            try {
              if (typeof action.onClick === "function") await action.onClick({ overlay, button: btn, close: removeOverlay });
            } catch (e) {
              console.error("Auto assign action failed:", e);
              alert(e?.message || String(e));
            }
          });
          actionsEl?.insertBefore(btn, closeBtn);
        });
        closeBtn.textContent = data.closeLabel || "닫기";
        closeBtn.disabled = false;
        (extraActions[0] ? actionsEl?.querySelector('[data-auto-extra-action="1"]') : closeBtn)?.focus?.();
        await waitForBrowser();
      },
      async cancel(message = "사용자 요청으로 자동배치를 취소했습니다.") {
        overlay.classList.add("is-cancelled");
        cancelBtn.disabled = true;
        cancelBtn.style.display = "none";
        badgeEl.textContent = "CANCELLED";
        titleEl.textContent = "자동배치 취소됨";
        subtitleEl.textContent = "중단 시점의 마지막 후보가 있으면 화면에 유지합니다.";
        stepEl.textContent = "취소 완료";
        detailEl.textContent = message;
        closeBtn.disabled = false;
        closeBtn.focus();
        await waitForBrowser();
      },
      async error(message) {
        overlay.classList.add("is-error");
        cancelBtn.disabled = true;
        cancelBtn.style.display = "none";
        badgeEl.textContent = "ERROR";
        titleEl.textContent = "자동배치 프로그램 오류";
        subtitleEl.textContent = "계산 또는 저장 중 예외가 발생했습니다.";
        stepEl.textContent = "프로그램 오류";
        detailEl.textContent = message || "자동배치 중 오류가 발생했습니다.";
        closeBtn.disabled = false;
        await waitForBrowser();
      },
      close() { removeOverlay(); }
    };
  }


  function setAutoAssignBusy(isBusy) {
    const btn = $("ttAutoAssignBtn");
    if (!btn) return;
    btn.disabled = isBusy;
    btn.textContent = isBusy ? "⏳ 자동 배치 중..." : "🎲 자동 배치";
  }

  function getActiveGradesFromScheduleItems(standalone = [], groupBlocks = []) {
    const gradeSet = new Set();
    const addGrade = (g) => {
      if (g && GRADE_KEYS.includes(g)) gradeSet.add(g);
    };

    standalone.forEach(item => {
      addGrade(item.gradeKey);
      (item.gradeKeys || []).forEach(addGrade);
    });

    groupBlocks.forEach(({ unitItems }) => {
      (unitItems || []).forEach(unitItem => {
        (unitItem.gradeKeys || []).forEach(addGrade);
        (unitItem.ttcards || []).forEach(card => {
          addGrade(card.gradeKey);
          (card.gradeKeys || []).forEach(addGrade);
        });
      });
    });

    return GRADE_KEYS.filter(g => gradeSet.has(g));
  }


  // ── Auto assignment option UI/helpers ──────────────────────────
  const AUTO_ASSIGN_DEFAULT_OPTIONS = {
    placementMode: "reset",   // reset | keep
    selectedGrades: [],
    keepPinned: true,
    keepManual: true,
    allowAutoRoomAssignment: false,
    runAttempts: "balanced",    // fast | balanced | deep
    scoringProfile: "balanced",
    scoringWeights: { ...DEFAULT_SCORE_WEIGHTS }
  };

  function gradeSetFromList(list = []) {
    const normalized = normalizeAutoActiveGrades(list);
    const set = new Set(normalized.filter(g => GRADE_KEYS.includes(g)));
    return set.size ? set : new Set(GRADE_KEYS);
  }

  function gradesForAutoItem(item = {}) {
    const set = new Set();
    const add = g => { if (g && GRADE_KEYS.includes(g)) set.add(g); };
    add(item.gradeKey);
    (item.gradeKeys || []).forEach(add);
    (item.ttcards || []).forEach(card => {
      add(card?.gradeKey);
      (card?.gradeKeys || []).forEach(add);
    });
    (item.ttcardIds || []).forEach(id => {
      const card = getTtCardById(id);
      add(card?.gradeKey);
      (card?.gradeKeys || []).forEach(add);
    });
    if (item.ttcardId) {
      const card = getTtCardById(item.ttcardId);
      add(card?.gradeKey);
      (card?.gradeKeys || []).forEach(add);
    }
    return set;
  }

  function gradesForGroupBlock(block = {}) {
    const set = new Set();
    (block.unitItems || []).forEach(item => gradesForAutoItem(item).forEach(g => set.add(g)));
    return set;
  }

  function intersectsGradeSet(itemGrades, selectedSet) {
    if (!selectedSet || selectedSet.size >= GRADE_KEYS.length) return true;
    for (const g of itemGrades || []) if (selectedSet.has(g)) return true;
    return false;
  }

  function filterAutoTargetsByGrades(standalone = [], groupBlocks = [], selectedGrades = []) {
    const selectedSet = gradeSetFromList(selectedGrades);
    if (selectedSet.size >= GRADE_KEYS.length) return { standalone, groupBlocks };
    return {
      standalone: standalone.filter(item => intersectsGradeSet(gradesForAutoItem(item), selectedSet)),
      // 그룹은 쪼개지 않고 그룹 단위로 유지합니다. 선택 학년이 하나라도 포함되면 전체 그룹을 함께 배치합니다.
      groupBlocks: groupBlocks.filter(block => intersectsGradeSet(gradesForGroupBlock(block), selectedSet))
    };
  }

  function entryGradeSet(entry = {}) {
    const set = new Set();
    const add = g => { if (g && GRADE_KEYS.includes(g)) set.add(g); };
    add(entry.gradeKey);
    (entry.gradeKeys || []).forEach(add);
    ttCardIdsFromPlacement(entry).forEach(id => {
      const card = getTtCardById(id);
      add(card?.gradeKey);
      (card?.gradeKeys || []).forEach(add);
    });
    return set;
  }

  function entryTouchesSelectedGrades(entry, selectedGrades = []) {
    const selectedSet = gradeSetFromList(selectedGrades);
    if (selectedSet.size >= GRADE_KEYS.length) return true;
    return intersectsGradeSet(entryGradeSet(entry), selectedSet);
  }

  function entryUsesManualCard(entry = {}) {
    if (entry.isManual) return true;
    return ttCardIdsFromPlacement(entry).some(id => getTtCardById(id)?.isManual);
  }

  function computeProtectedEntries(existingEntries = [], options = {}) {
    const selectedGrades = options.selectedGrades?.length ? options.selectedGrades : GRADE_KEYS;
    if (options.placementMode === "keep") return [...existingEntries];

    return (existingEntries || []).filter(entry => {
      const touches = entryTouchesSelectedGrades(entry, selectedGrades);
      if (!touches) return true;
      if (options.keepPinned !== false && entry.pinned) return true;
      if (options.keepManual !== false && entryUsesManualCard(entry)) return true;
      return false;
    });
  }

  function normalizeRunAttemptMode(mode) {
    const value = String(mode || "balanced");
    if (value === "fast" || value === "deep") return value;
    return "balanced";
  }

  function autoEngineProfileForMode(mode) {
    const value = normalizeRunAttemptMode(mode);
    if (value === "fast") {
      return {
        mode: "fast",
        label: "빠른 경량 엔진",
        useCandidateCountSort: false,
        useLiveMrv: false,
        slotScoring: "first",
        enableSwapRepair: false,
        enableFinalRepair: false,
        finalRepairLimit: 0,
        postProcessLimit: 0,
        postProcessPasses: 0,
        qualityClassCheck: false,
        enableExperimentalResidualRepair: false,
        enableResidualTwoCycleRepair: false,
        enableEjectionChainRepair: false,
        enableMinConflictsRepair: false,
        enableForceResidualRepair: false
      };
    }
    if (value === "deep") {
      return {
        mode: "deep",
        label: "정교한 안정 엔진",
        // r79: 병목 수업을 뒤로 미루지 않도록 후보 수 기반 정렬/MRV를 다시 켭니다.
        // 전체 전수탐색이 아니라 초기 후보 수와 현재 후보 수만 사용하므로 품질을 높이면서도 브라우저 응답성을 유지합니다.
        useCandidateCountSort: true,
        useLiveMrv: true,
        slotScoring: "light",
        enableSwapRepair: true,
        enableFinalRepair: true,
        finalRepairLimit: Infinity,
        postProcessLimit: 180,
        postProcessPasses: 2,
        qualityClassCheck: true,
        enableExperimentalResidualRepair: true,
        enableResidualTwoCycleRepair: true,
        enableEjectionChainRepair: true,
        enableMinConflictsRepair: true,
        enableForceResidualRepair: true
      };
    }
    return {
      mode: "balanced",
      label: "균형 병목 우선 엔진",
      // r80: r79의 병목 우선순위는 유지하되, 균형 모드에서는 매 배치마다
      // 전체 후보를 다시 세는 live MRV를 끕니다. 시작 시 후보 수 기반 정렬은 유지해
      // 11체육/리더십/12영어 같은 희소 카드를 먼저 보호합니다.
      useCandidateCountSort: true,
      useLiveMrv: false,
      candidateProbeSampleLimit: 2,
      slotScoring: "light",
      enableSwapRepair: true,
      enableFinalRepair: true,
      finalRepairLimit: 32,
      postProcessLimit: 35,
      postProcessPasses: 1,
      qualityClassCheck: true,
      // r84: 균형 배치에서도 마지막 잔여 5~10시수는 단순 정렬만으로는 풀리지 않습니다.
      // 다만 r79처럼 무거운 연쇄탐색을 다시 켜지는 않고, 안전한 2-cycle 스왑 복구만 켭니다.
      // ejection-chain / min-conflicts / 강제보정은 여전히 정교한 배치 전용입니다.
      enableExperimentalResidualRepair: true,
      enableResidualTwoCycleRepair: true,
      enableEjectionChainRepair: false,
      enableMinConflictsRepair: false,
      enableForceResidualRepair: false
    };
  }

  function attemptsForMode(mode) {
    const value = normalizeRunAttemptMode(mode);
    // r19: 빠른/균형 모드는 운영 중 바로 테스트할 수 있도록 초기 후보 수를 크게 줄입니다.
    // 정교한 배치에서만 기존의 넓은 탐색을 유지합니다.
    if (value === "fast") return [1, 1, 0];
    // r23: 60+40+18회는 브라우저 단일 스레드에서 실제 운영 데이터 기준으로 과합니다.
    // 정교한 모드는 1차 후보를 19회로 제한하고, 남은 품질은 복구/후처리에서 보정합니다.
    if (value === "deep") return [14, 8, 4];
    // r80: 균형 배치는 r79의 병목 선배치 전략은 유지하되 초기 후보 반복 수를 줄입니다.
    // 정교한 배치가 깊은 탐색을 맡고, 균형은 운영 중 테스트 가능한 속도를 우선합니다.
    return [4, 3, 1];
  }

  function explorationOptionsForAttempt(mode, attempt = 0, stageIndex = 0) {
    const value = normalizeRunAttemptMode(mode);
    if (value === "fast") return { slotRandomness: 0, topCandidateCount: 1 };
    if (value === "balanced") {
      if (attempt === 0) return { slotRandomness: 0, topCandidateCount: 1 };
      return { slotRandomness: Math.min(2, 1 + stageIndex), topCandidateCount: 2 };
    }
    const base = 6;
    const warmup = attempt === 0 ? 0 : 1;
    const jitter = (attempt % Math.max(2, base)) + stageIndex;
    const slotRandomness = warmup ? Math.min(7, 1 + jitter) : 0;
    const topCandidateCount = warmup ? Math.min(10, 2 + base + (attempt % 3)) : 1;
    return { slotRandomness, topCandidateCount };
  }

  function compareAutoRunResults(a = {}, b = {}) {
    // 반환값이 음수이면 a가 더 좋습니다.
    // r27: 단순 미배치 개수보다 최종 검증 품질을 먼저 봅니다.
    // 자동배치가 특정 미배치 카드를 해결하면서 다른 카드/학급 시수를 무너뜨리면
    // 결과적으로 더 나쁜 시간표이므로 저장 대상에서 제외해야 합니다.
    const aCardShortage = Number(a.cardShortageSlots ?? 999999);
    const bCardShortage = Number(b.cardShortageSlots ?? 999999);
    if (aCardShortage !== bCardShortage) return aCardShortage - bCardShortage;

    const aCardIssues = Number(a.cardCoverageIssueCount ?? 999999);
    const bCardIssues = Number(b.cardCoverageIssueCount ?? 999999);
    if (aCardIssues !== bCardIssues) return aCardIssues - bCardIssues;

    const aGroupIssues = Number(a.groupCoverageIssueCount ?? 999999);
    const bGroupIssues = Number(b.groupCoverageIssueCount ?? 999999);
    if (aGroupIssues !== bGroupIssues) return aGroupIssues - bGroupIssues;

    const aClassGap = Number(a.classTargetGap ?? (Number.isFinite(Number(a.classTargetTotal)) && Number.isFinite(Number(a.classTotal)) ? Math.abs(Number(a.classTargetTotal) - Number(a.classTotal)) : 999999));
    const bClassGap = Number(b.classTargetGap ?? (Number.isFinite(Number(b.classTargetTotal)) && Number.isFinite(Number(b.classTotal)) ? Math.abs(Number(b.classTargetTotal) - Number(b.classTotal)) : 999999));
    if (aClassGap !== bClassGap) return aClassGap - bClassGap;

    const aClassIssues = Number(a.classSlotIssueCount ?? 999999);
    const bClassIssues = Number(b.classSlotIssueCount ?? 999999);
    if (aClassIssues !== bClassIssues) return aClassIssues - bClassIssues;

    const aShort = Number(a.classShortCount ?? 999999);
    const bShort = Number(b.classShortCount ?? 999999);
    if (aShort !== bShort) return aShort - bShort;

    const aFailed = Number(a.failedCount ?? 999999);
    const bFailed = Number(b.failedCount ?? 999999);
    if (aFailed !== bFailed) return aFailed - bFailed;

    const aOver = Number(a.classOverCount ?? 999999);
    const bOver = Number(b.classOverCount ?? 999999);
    if (aOver !== bOver) return aOver - bOver;

    const aRestricted = Number(a.restrictedTeacherIssueCount ?? 999999);
    const bRestricted = Number(b.restrictedTeacherIssueCount ?? 999999);
    if (aRestricted !== bRestricted) return aRestricted - bRestricted;

    const aMissingRoom = Number(a.missingRoomCount ?? 999999);
    const bMissingRoom = Number(b.missingRoomCount ?? 999999);
    if (aMissingRoom !== bMissingRoom) return aMissingRoom - bMissingRoom;

    const aIntrusion = Number(a.protectedIntrusionCount ?? 999999);
    const bIntrusion = Number(b.protectedIntrusionCount ?? 999999);
    if (aIntrusion !== bIntrusion) return aIntrusion - bIntrusion;

    const aForced = Number(a.forcedCount ?? 0);
    const bForced = Number(b.forcedCount ?? 0);
    if (aForced !== bForced) return aForced - bForced;

    const aQuality = Number(a.qualityScore ?? Infinity);
    const bQuality = Number(b.qualityScore ?? Infinity);
    if (aQuality !== bQuality) return aQuality - bQuality;

    const aPlaced = Number(a.placedCount ?? 0);
    const bPlaced = Number(b.placedCount ?? 0);
    if (aPlaced !== bPlaced) return bPlaced - aPlaced;

    return 0;
  }

  function buildAutoRunMetricsFromValidation(report = {}, context = {}) {
    const card = report.cardCoverage || {};
    const cls = report.classSlots || {};
    const group = report.groupCoverage || {};
    const classIssues = cls.issues || [];
    const cardShortageSlots = (card.shortRows || []).reduce((sum, row) => sum + Math.max(0, -Number(row.diff || 0)), 0);
    const cardOverageSlots = (card.overRows || []).reduce((sum, row) => sum + Math.max(0, Number(row.diff || 0)), 0);
    const classTotal = Number(cls.total || 0);
    const classTargetTotal = Number(cls.targetTotal || 0);
    const classTargetGap = classTargetTotal > 0 ? Math.abs(classTargetTotal - classTotal) : 999999;
    return {
      label: context.label || '',
      validationSummary: report.summary || '',
      validationOk: !!report.ok,
      placedCount: Number(context.placedCount || 0),
      failedCount: Number(context.failedCount || 0),
      forcedCount: Number(context.forcedCount || 0),
      qualityScore: Number.isFinite(Number(context.qualityScore)) ? Number(context.qualityScore) : Infinity,
      cardCoverageIssueCount: Number(card.issueCount || 0),
      cardShortCount: Number(card.shortCount || 0),
      cardOverCount: Number(card.overCount || 0),
      cardShortageSlots,
      cardOverageSlots,
      groupCoverageIssueCount: Number(group.issueCount || 0),
      restrictedTeacherIssueCount: Number(report.restrictedTeachers?.issueCount || 0),
      protectedIntrusionCount: Number(report.protectedIntrusions?.total || 0),
      missingRoomCount: Number(report.missingRoomCount || 0),
      classSlotIssueCount: Number(cls.issueCount || 0),
      classShortCount: classIssues.filter(row => Number(row.diff || 0) < 0).length,
      classOverCount: classIssues.filter(row => Number(row.diff || 0) > 0).length,
      classTotal,
      classTargetTotal,
      classTargetGap
    };
  }

  function allowedClassTargetGap(metrics = {}) {
    const target = Number(metrics.classTargetTotal || 0);
    // 15개 반 × 35시수 = 525 기준에서는 12시수까지를 임시 최고 후보 허용 범위로 둡니다.
    // 471/525처럼 구조적으로 무너진 과거 보관본은 여기서 제외됩니다.
    return Math.max(8, Math.ceil(target * 0.025));
  }

  function isStructurallyUsableAutoMetrics(metrics = {}) {
    const target = Number(metrics.classTargetTotal || 0);
    const total = Number(metrics.classTotal || 0);
    if (!target || !Number.isFinite(target) || !Number.isFinite(total)) return false;
    const gap = Math.abs(target - total);
    return gap <= allowedClassTargetGap(metrics);
  }

  function buildAutoRunMetricsForEntries(allEntries = [], scopeGrades = [], failedItems = [], context = {}) {
    const failedNames = [...new Set((failedItems || []).map(f => f?.name).filter(Boolean))];
    const report = buildScheduleVerificationReport(allEntries, {
      scopeGrades,
      protectedEntries: context.protectedEntries || [],
      failedNames,
      deriveFailedFromCardShortage: context.deriveFailedFromCardShortage === true
    });
    const finalFailedNames = Array.isArray(report.failedNames) ? report.failedNames : failedNames;
    return {
      report,
      metrics: buildAutoRunMetricsFromValidation(report, {
        label: context.label || '',
        placedCount: context.placedCount,
        failedCount: finalFailedNames.length,
        forcedCount: context.forcedCount,
        qualityScore: context.qualityScore
      }),
      failedNames: finalFailedNames
    };
  }

  function formatAutoRunMetricSummary(metrics = {}) {
    return [
      `카드부족 ${Number(metrics.cardShortageSlots || 0)}시수`,
      `카드문제 ${Number(metrics.cardCoverageIssueCount || 0)}개`,
      `그룹문제 ${Number(metrics.groupCoverageIssueCount || 0)}개`,
      `학급문제 ${Number(metrics.classSlotIssueCount || 0)}개`,
      Number(metrics.classTargetTotal || 0) ? `학급합계 ${Number(metrics.classTotal || 0)}/${Number(metrics.classTargetTotal || 0)}` : '',
      `미배치 ${Number(metrics.failedCount || 0)}개`,
      Number(metrics.restrictedTeacherIssueCount || 0) ? `제약교사 ${Number(metrics.restrictedTeacherIssueCount || 0)}명` : '',
      Number(metrics.missingRoomCount || 0) ? `교실미배정 ${Number(metrics.missingRoomCount || 0)}개` : '',
      Number(metrics.protectedIntrusionCount || 0) ? `고정침범 ${Number(metrics.protectedIntrusionCount || 0)}건` : ''
    ].filter(Boolean).join(' · ');
  }


  function findBestSavedAutoAssignReference(activeGrades = [], currentReference = null) {
    const candidates = [];
    if (currentReference?.metrics) candidates.push(currentReference);

    const domain = ttDomain();
    const bestSnapshot = ensureBestAutoAssignSnapshot(domain);
    const schedules = [
      ...(bestSnapshot ? [{ ...bestSnapshot, source: "autoassign-best", bestSnapshot: true }] : []),
      ...(Array.isArray(domain?.savedSchedules) ? domain.savedSchedules : [])
    ];
    schedules.forEach((version, index) => {
      if (!version || !Array.isArray(version.entries) || !version.entries.length) return;
      const isAutoResult = version.snapshotKind === "result"
        || version.bestSnapshot === true
        || String(version.source || "") === "autoassign-best"
        || (version.autoSnapshot === true && String(version.name || "").includes("자동배치 결과"))
        || (version.source === "autoassign" && String(version.name || "").includes("자동배치 결과"));
      if (!isAutoResult) return;
      if (!hasCompleteAutoAssignMetricEvidence(version)) {
        addTimetableLog?.("warn", "자동배치 보관본 제외", `${version.name || "이름 없는 보관본"}: 카드/그룹 검증 메타가 없어 최고 결과 후보에서 제외했습니다.`);
        return;
      }
      if (!snapshotMatchesCurrentAutoSource(version)) {
        addTimetableLog?.("warn", "자동배치 보관본 제외", `${version.name || "이름 없는 보관본"}: 현재 시간표 카드/그룹 구성과 달라 이번 자동배치 기준에서 제외했습니다.`);
        return;
      }
      const snapshotEntries = normalizeSnapshotEntries(version.entries || []);
      if (!snapshotEntries.length) return;
      const meta = version.autoAssignMeta || {};
      const failedNames = Array.isArray(meta.failedNames) ? meta.failedNames : [];
      const validation = buildScheduleVerificationReport(snapshotEntries, {
        scopeGrades: activeGrades,
        failedNames,
        deriveFailedFromCardShortage: true,
        failedDiagnostics: Array.isArray(meta.failedDiagnostics) ? meta.failedDiagnostics : []
      });
      const validationFailedNames = Array.isArray(validation.failedNames) ? validation.failedNames : failedNames;
      const metrics = buildAutoRunMetricsFromValidation(validation, {
        label: version.name || `저장된 자동배치 ${index + 1}`,
        placedCount: Number(version.entryCount || snapshotEntries.length),
        failedCount: validationFailedNames.length || Number(meta.failedCount || meta.finalMetrics?.failedCount || 0),
        forcedCount: Number(meta.forcedCount || meta.finalMetrics?.forcedCount || 0),
        qualityScore: Number.isFinite(Number(meta.finalMetrics?.qualityScore))
          ? Number(meta.finalMetrics.qualityScore)
          : (Number.isFinite(Number(meta.postProcessQualityScore)) ? Number(meta.postProcessQualityScore) : Infinity)
      });
      if (!isStructurallyUsableAutoMetrics(metrics)) {
        addTimetableLog?.("warn", "자동배치 보관본 제외", `${version.name || "이름 없는 보관본"}: 학급 합계 ${metrics.classTotal}/${metrics.classTargetTotal}로 목표와 차이가 커 최고 결과 후보에서 제외했습니다.`);
        return;
      }
      candidates.push({
        source: (version.bestSnapshot === true || String(version.source || "") === "autoassign-best") ? "bestSnapshot" : "savedSchedule",
        name: version.bestSnapshot === true ? `최고 보관본 · ${version.name || "자동배치 결과"}` : (version.name || "저장된 자동배치 결과"),
        scheduleId: version.id || "",
        scheduleIndex: index,
        createdAt: version.createdAt || "",
        updatedAt: version.updatedAt || "",
        entries: snapshotEntries,
        validation,
        metrics,
        failedNames: validationFailedNames,
        note: version.note || ""
      });
    });

    let best = null;
    candidates.forEach(candidate => {
      if (!candidate?.metrics) return;
      if (!best || compareAutoRunResults(candidate.metrics, best.metrics) < 0) best = candidate;
    });
    return best || currentReference;
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[<>&"]/g, ch => ({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[ch]));
  }

  function openAutoAssignOptionsDialog(activeGrades = [], defaultOptions = {}) {
    const grades = activeGrades.length ? activeGrades : GRADE_KEYS;
    const defaults = { ...AUTO_ASSIGN_DEFAULT_OPTIONS, ...defaultOptions };
    if (!SCORE_PRESETS[defaults.scoringProfile] && defaults.scoringProfile !== "custom") defaults.scoringProfile = "balanced";
    const defaultWeights = normalizeScoreWeights(defaults.scoringWeights || SCORE_PRESETS[defaults.scoringProfile] || DEFAULT_SCORE_WEIGHTS);
    const weightLabel = v => ["끔", "낮음", "보통", "높음"][clampWeight(v, 0)] || "보통";
    return new Promise(resolve => {
      const old = document.getElementById("ttAutoAssignOptionsOverlay");
      old?.remove();
      const overlay = document.createElement("div");
      overlay.id = "ttAutoAssignOptionsOverlay";
      overlay.className = "tt-auto-options-overlay";
      overlay.innerHTML = `
        <div class="tt-auto-options-modal" role="dialog" aria-modal="true" aria-labelledby="ttAutoAssignOptionsTitle">
          <div class="tt-auto-options-head">
            <div>
              <p class="tt-auto-options-kicker">자동 배치 옵션</p>
              <h3 id="ttAutoAssignOptionsTitle">배치 범위와 보호 대상을 선택하세요</h3>
            </div>
            <button type="button" class="tt-auto-options-close" aria-label="닫기">×</button>
          </div>
          <div class="tt-auto-options-body">
            <section class="tt-auto-option-section">
              <h4>배치 방식</h4>
              <label class="tt-auto-radio-card">
                <input type="radio" name="ttAutoPlacementMode" value="reset" ${defaults.placementMode !== "keep" ? "checked" : ""}>
                <span><b>선택 범위 초기화 후 자동 배치</b><em>선택한 학년에 걸린 기존 배치를 지우고 다시 배치합니다.</em></span>
              </label>
              <label class="tt-auto-radio-card">
                <input type="radio" name="ttAutoPlacementMode" value="keep" ${defaults.placementMode === "keep" ? "checked" : ""}>
                <span><b>현재 배치 유지 + 미배치만 자동 배치</b><em>현재 시간표를 보호하고 부족한 카드만 추가로 찾습니다.</em></span>
              </label>
            </section>
            <section class="tt-auto-option-section">
              <div class="tt-auto-option-title-row">
                <h4>대상 학년</h4>
                <div class="tt-auto-option-mini-actions">
                  <button type="button" data-action="all-grades">전체</button>
                  <button type="button" data-action="clear-grades">해제</button>
                </div>
              </div>
              <div class="tt-auto-grade-grid">
                ${grades.map(g => `<label class="tt-auto-grade-chip"><input type="checkbox" value="${escapeHtml(g)}" ${(!defaults.selectedGrades?.length || defaults.selectedGrades.includes(g)) ? "checked" : ""}><span>${escapeHtml(gradeDisplay(g))}</span></label>`).join("")}
              </div>
              <p class="tt-auto-option-help">여러 학년에 걸친 그룹 수업은 선택 학년이 포함되면 그룹 전체가 함께 배치됩니다.</p>
            </section>
            <section class="tt-auto-option-section">
              <h4>보호 옵션</h4>
              <label class="tt-auto-check-line"><input type="checkbox" id="ttAutoKeepPinned" ${defaults.keepPinned !== false ? "checked" : ""}> <span>잠금/고정 카드 유지</span></label>
              <label class="tt-auto-check-line"><input type="checkbox" id="ttAutoKeepManual" ${defaults.keepManual !== false ? "checked" : ""}> <span>수동 생성 카드의 현재 배치 유지</span></label>
              <p class="tt-auto-option-help">현재 배치 유지 모드에서는 모든 기존 배치가 보호되므로 위 보호 옵션은 자동으로 적용됩니다.</p>
            </section>
            <section class="tt-auto-option-section">
              <h4>교실 설정</h4>
              <label class="tt-auto-check-line"><input type="checkbox" id="ttAutoAllowRandomRooms" ${defaults.allowAutoRoomAssignment === true ? "checked" : ""}> <span>교실 미설정 카드도 빈 교실 자동 배정</span></label>
              <p class="tt-auto-option-help">기본값은 교사 교실 또는 지정교실이 있는 카드만 배치합니다. 이 옵션을 켜면 교실이 없는 카드도 빈 교실을 자동으로 골라 배치합니다.</p>
            </section>
            <section class="tt-auto-option-section">
              <h4>배치 강도</h4>
              <select id="ttAutoRunAttempts" class="tt-auto-select">
                <option value="fast" ${defaults.runAttempts === "fast" ? "selected" : ""}>빠른 점검</option>
                <option value="balanced" ${defaults.runAttempts !== "fast" && defaults.runAttempts !== "deep" ? "selected" : ""}>균형 배치</option>
                <option value="deep" ${defaults.runAttempts === "deep" ? "selected" : ""}>정교한 배치</option>
              </select>
              <p class="tt-auto-option-help">빠른 점검은 프로그램 오류 확인용이며 결과 보관본을 만들지 않습니다. 실제 기본 실행은 균형 배치입니다. 정교한 배치는 균형 배치 후 충돌·미배치가 많을 때만 사용하세요.</p>
            </section>
            <section class="tt-auto-option-section tt-auto-score-section">
              <div class="tt-auto-option-title-row">
                <h4>점수 기준</h4>
                <select id="ttAutoScorePreset" class="tt-auto-select tt-auto-score-preset">
                  <option value="balanced" ${defaults.scoringProfile === "balanced" ? "selected" : ""}>균형</option>
                  <option value="teacherFriendly" ${defaults.scoringProfile === "teacherFriendly" ? "selected" : ""}>교사 부담 최소화</option>
                  <option value="studentFriendly" ${defaults.scoringProfile === "studentFriendly" ? "selected" : ""}>학생 몰림 최소화</option>
                  <option value="custom" ${defaults.scoringProfile === "custom" ? "selected" : ""}>직접 설정</option>
                </select>
              </div>
              <div class="tt-auto-weight-grid">
                ${[
                  ["classFill", "학급 공강 제거", "각 학급의 월~금 1~7교시를 먼저 채우도록 배치합니다."],
                  ["teacherGap", "교사 공강 최소화", "교사의 하루 수업 간 빈 시간을 줄입니다."],
                  ["sameSubjectDay", "같은 과목 몰림 회피", "한 반에 같은 과목이 하루에 반복되는 것을 줄입니다."],
                  ["teacherConsecutive", "교사 연속수업 완화", "교사의 긴 연속수업을 줄입니다."],
                ].map(([key, label, help]) => `
                  <label class="tt-auto-weight-row" data-weight-key="${key}">
                    <span><b>${label}</b><em>${help}</em></span>
                    <input type="range" min="0" max="3" step="1" value="${defaultWeights[key]}" data-weight="${key}">
                    <strong data-weight-label="${key}">${weightLabel(defaultWeights[key])}</strong>
                  </label>`).join("")}
              </div>
              <p class="tt-auto-option-help">점수 기준은 절대 조건이 아니라 자동배치가 여러 후보 중 더 나은 시간을 고르는 기준입니다.</p>
            </section>
          </div>
          <div class="tt-auto-options-foot">
            <button type="button" class="tt-auto-options-cancel">취소</button>
            <button type="button" class="tt-auto-options-start">자동 배치 시작</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      const close = (value) => { overlay.remove(); resolve(value); };
      overlay.querySelector(".tt-auto-options-close")?.addEventListener("click", () => close(null));
      overlay.querySelector(".tt-auto-options-cancel")?.addEventListener("click", () => close(null));
      overlay.addEventListener("click", e => { if (e.target === overlay) close(null); });
      overlay.querySelector('[data-action="all-grades"]')?.addEventListener("click", () => {
        overlay.querySelectorAll('.tt-auto-grade-chip input[type="checkbox"]').forEach(cb => { cb.checked = true; });
      });
      overlay.querySelector('[data-action="clear-grades"]')?.addEventListener("click", () => {
        overlay.querySelectorAll('.tt-auto-grade-chip input[type="checkbox"]').forEach(cb => { cb.checked = false; });
      });

      const setWeightInputs = (weights, profile = "custom") => {
        const normalized = normalizeScoreWeights(weights);
        Object.entries(normalized).forEach(([key, value]) => {
          const input = overlay.querySelector(`[data-weight="${key}"]`);
          const label = overlay.querySelector(`[data-weight-label="${key}"]`);
          if (input) input.value = String(value);
          if (label) label.textContent = weightLabel(value);
        });
        const preset = overlay.querySelector("#ttAutoScorePreset");
        if (preset) preset.value = profile;
      };

      overlay.querySelector("#ttAutoScorePreset")?.addEventListener("change", e => {
        const profile = e.target.value || "balanced";
        if (profile !== "custom" && SCORE_PRESETS[profile]) setWeightInputs(SCORE_PRESETS[profile], profile);
      });
      overlay.querySelectorAll('[data-weight]').forEach(input => {
        input.addEventListener("input", () => {
          const key = input.dataset.weight;
          const label = overlay.querySelector(`[data-weight-label="${key}"]`);
          if (label) label.textContent = weightLabel(input.value);
          const preset = overlay.querySelector("#ttAutoScorePreset");
          if (preset) preset.value = "custom";
        });
      });

      overlay.querySelector('.tt-auto-options-start')?.addEventListener("click", () => {
        const selectedGrades = [...overlay.querySelectorAll('.tt-auto-grade-chip input[type="checkbox"]:checked')].map(cb => cb.value);
        if (!selectedGrades.length) {
          alert("자동 배치할 학년을 하나 이상 선택해 주세요.");
          return;
        }
        const placementMode = overlay.querySelector('input[name="ttAutoPlacementMode"]:checked')?.value || "reset";
        const scoringWeights = normalizeScoreWeights(Object.fromEntries(
          [...overlay.querySelectorAll('[data-weight]')].map(input => [input.dataset.weight, input.value])
        ));
        close({
          placementMode,
          selectedGrades,
          keepPinned: overlay.querySelector("#ttAutoKeepPinned")?.checked !== false,
          keepManual: overlay.querySelector("#ttAutoKeepManual")?.checked !== false,
          allowAutoRoomAssignment: overlay.querySelector("#ttAutoAllowRandomRooms")?.checked === true,
          runAttempts: overlay.querySelector("#ttAutoRunAttempts")?.value || "balanced",
          scoringProfile: overlay.querySelector("#ttAutoScorePreset")?.value || "balanced",
          scoringWeights
        });
      });
    });
  }



  // ── Auto-assign precheck report ────────────────────────────────
  // 자동배치 전 데이터 상태를 먼저 보여 줍니다. 자동배치 실패 대부분은
  // 알고리즘보다 카드/그룹/보호 슬롯/제약교사 데이터에서 시작되므로,
  // 실행 전에 점검 결과를 확인할 수 있게 합니다.
  function addPrecheckItem(report, section, status, title, detail = "", meta = {}) {
    report.items.push({ section, status, title, detail, meta });
    report.counts[status] = (report.counts[status] || 0) + 1;
  }

  function statusRankForPrecheck(status) {
    return status === "error" ? 3 : status === "warn" ? 2 : status === "ok" ? 1 : 0;
  }

  function precheckEsc(value = "") {
    return String(value ?? "").replace(/[<>&"']/g, ch => ({
      "<":"&lt;", ">":"&gt;", "&":"&amp;", '"':"&quot;", "'":"&#39;"
    }[ch] || ch));
  }

  function countPrecheckBy(items = [], keyFn = () => "") {
    const map = new Map();
    (items || []).forEach(item => {
      const key = keyFn(item);
      if (!key) return;
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }

  function collectCardIdsFromGroupForPrecheck(group = {}) {
    const ids = [];
    ids.push(...(group.poolCardIds || []));
    ids.push(...(group.excludedCardIds || []));
    ids.push(...(group.cardIds || []));
    (group.units || []).forEach(unit => {
      ids.push(...(unit.ttcardIds || []));
      ids.push(...(unit.cardIds || []));
      ids.push(...(unit.poolCardIds || []));
    });
    return [...new Set(ids.filter(Boolean))];
  }

  function cardTextForPrecheck(card = {}) {
    const tpl = card.templateId ? getTemplateById(card.templateId) : null;
    return [
      card.subject, card.name, card.title, card.nameKo, card.nameEn,
      card.groupName, card.track, card.category,
      tpl?.nameKo, tpl?.nameEn, tpl?.sem1NameKo, tpl?.sem1NameEn
    ].map(v => String(v || "")).join(" ");
  }

  function isWholeGradeLikeCard(card = {}) {
    const text = cardTextForPrecheck(card);
    const category = String(card.category || "").trim();
    if (card.isWholeGrade || card.wholeGrade || card.isGradeWide) return true;
    if (category === "창체") return true;
    // 과목명에 "종교"가 들어간 일반 교과나 선택과목은 전체학년 카드가 아닙니다.
    // 전체학년/창체 경고는 실제 공동 활동 계열만 대상으로 좁혀 오탐을 줄입니다.
    return /(자율활동|동아리활동|채플|진로와\s*소명|성품과\s*공동체|선교적\s*생활|섬김의\s*리더십|변혁적\s*리더십|중학교\s*특성화|Self[-\s]*regulated|Club\s*Activity|Chapel|Vision|Vocation|Leadership|Missional)/i.test(text);
  }

  function compoundPartKeyForPrecheck(card = {}) {
    if (!card?.compoundParentTemplateId) return "";
    return [
      "compound",
      card.compoundParentTemplateId || card.templateId || "",
      card.compoundPartId || card.id || "",
    ].join(":");
  }

  function cardAudienceKeyForPrecheck(card = {}) {
    const classKeys = [...new Set((card.classKeys || []).map(v => String(v || "").trim()).filter(Boolean))].sort();
    if (classKeys.length) return classKeys.join(",");
    const classLabels = [...new Set((card.classLabels || []).map(v => String(v || "").trim()).filter(Boolean))].sort();
    if (classLabels.length) return classLabels.join(",");
    return String(card.sectionIdx ?? card.sectionIndex ?? "");
  }

  function cardAudienceOverlapsForPrecheck(a = {}, b = {}) {
    const aKeys = new Set((a.classKeys || []).map(v => String(v || "").trim()).filter(Boolean));
    const bKeys = new Set((b.classKeys || []).map(v => String(v || "").trim()).filter(Boolean));
    if (aKeys.size && bKeys.size) {
      for (const key of aKeys) if (bKeys.has(key)) return true;
      return false;
    }
    return (a.sectionIdx ?? a.sectionIndex ?? 0) === (b.sectionIdx ?? b.sectionIndex ?? 0);
  }

  function cardKeyForPrecheck(card = {}) {
    return [
      card.gradeKey || "",
      card.templateId || "",
      compoundPartKeyForPrecheck(card),
      card.sectionIdx ?? card.sectionIndex ?? "",
      cardAudienceKeyForPrecheck(card),
    ].join("::");
  }

  function gradeTemplateKeyForPrecheck(card = {}) {
    return [card.gradeKey || "", card.templateId || "", compoundPartKeyForPrecheck(card)].join("::");
  }

  function getPlacedCardIdsForPrecheck(existingEntries = []) {
    const set = new Set();
    (existingEntries || []).forEach(entry => {
      ttCardIdsFromPlacement(entry).forEach(id => { if (id) set.add(id); });
    });
    return set;
  }

  function summarizeAutoTargetsForPrecheck(standalone = [], groupBlocks = []) {
    const standaloneSlots = (standalone || []).reduce((sum, item) => sum + durationForAutoObject(item), 0);
    const groupSlots = groupBlocks.reduce((sum, { group, unitItems }) => {
      const credits = (unitItems || []).map(u => Math.max(0, Number(u?.credits) || 0));
      const isConcurrent = group?.isConcurrent || group?.groupType === "concurrent";
      return sum + (isConcurrent ? Math.max(0, ...credits) : credits.reduce((a, b) => a + b, 0));
    }, 0);
    return { standaloneSlots, groupSlots, totalSlots: standaloneSlots + groupSlots };
  }

  function buildRestrictedTeacherTargetsForPrecheck(standalone = [], groupBlocks = []) {
    const map = new Map();
    const add = (teacher, count, sample) => {
      if (!teacher || !isRestrictedTeacher(teacher)) return;
      const amount = Math.max(0, Number(count) || 0);
      if (!amount) return;
      if (!map.has(teacher)) map.set(teacher, { teacher, target: 0, samples: [] });
      const row = map.get(teacher);
      row.target += amount;
      if (sample && row.samples.length < 5 && !row.samples.includes(sample)) row.samples.push(sample);
    };

    standalone.forEach(item => {
      const name = getAutoItemName(item);
      getTeachersForAutoItem(item).forEach(t => add(t, 1, name));
    });

    // r65: 제약교사 사전점검은 "그룹 전체 교사 × 그룹 시수"로 계산하면 안 됩니다.
    // 특히 미적분(2)+심화물리(2)처럼 compound option이 들어간 동시배정 그룹은
    // 1~2회차에는 미적분 교사, 3~4회차에는 심화물리 교사만 실제 점유합니다.
    // 자동배치 본체와 동일하게 회차별 active card를 만든 뒤 그 회차의 hard teacher만 1시수로 더합니다.
    groupBlocks.forEach(block => {
      const { group, unitItems } = block || {};
      const sample = group?.name || group?.groupName || "그룹 수업";
      const normalizedUnits = unitItems || [];
      const isConcurrent = group?.isConcurrent || group?.groupType === "concurrent";

      if (isConcurrent) {
        const maxCredits = Math.max(0, ...normalizedUnits.map(u => Math.max(0, Number(u?.credits) || 0)));
        for (let occurrence = 0; occurrence < maxCredits; occurrence++) {
          const activeCards = normalizedUnits
            .filter(u => occurrence < Math.max(0, Number(u?.credits) || 0))
            .map(u => getGroupItemForOccurrence(u, occurrence))
            .flatMap(u => u?.ttcards || [])
            .filter(Boolean);
          if (!activeCards.length) continue;
          const probeItem = makePlacementFromGroupItem(group, { ttcards: activeCards }) || { ttcards: activeCards };
          getTeachersForAutoItem(probeItem).forEach(t => add(t, 1, sample));
        }
        return;
      }

      normalizedUnits.forEach(unit => {
        const credits = Math.max(0, Number(unit?.credits) || 0);
        for (let occurrence = 0; occurrence < credits; occurrence++) {
          const occurrenceItem = getGroupItemForOccurrence(unit, occurrence);
          const placement = makePlacementFromGroupItem(group, occurrenceItem) || occurrenceItem || unit;
          getTeachersForAutoItem(placement).forEach(t => add(t, 1, sample));
        }
      });
    });

    return [...map.values()];
  }

  function countAvailableSlotsForRestrictedTeacher(teacher, protectedEntries = []) {
    const periodCount = Math.max(1, Number(ttConfig()?.periodCount || 7));
    let available = 0;
    const c = constraints()?.[teacher] || {};
    for (let day = 0; day < 5; day++) {
      for (let period = 0; period < periodCount; period++) {
        if (isTeacherUnavailable(teacher, day, period)) continue;
        const state = getTeacherLimitState(teacher, { day, period }, protectedEntries);
        if (state.maxPerWeek > 0 && state.weekLoad >= state.maxPerWeek) continue;
        if (state.maxPerDay > 0 && state.dayLoad >= state.maxPerDay) continue;
        if (state.maxConsecutive > 0 && state.nextConsecutive > state.maxConsecutive) continue;
        // 이 함수는 교사 개인의 가능 시간만 계산합니다. 학급/교실 충돌은 실제 자동배치에서 재검사합니다.
        available += 1;
      }
    }
    return { available, constraint: c };
  }

  function getActiveCardsForGrades(cards = [], activeGrades = []) {
    const set = new Set(normalizeAutoActiveGrades(activeGrades));
    if (!set.size) return cards;
    return (cards || []).filter(card => set.has(card.gradeKey) || (card.gradeKeys || []).some(g => set.has(g)));
  }

  function precheckClock() {
    return globalThis.performance?.now?.() ?? Date.now();
  }

  function autoPrecheckFingerprint(standalone = [], groupBlocks = [], protectedEntries = [], options = {}) {
    const cards = (ttDomain().ttcards || []).map(card => [
      card.id, card.teacherId, card.teacherIds, card.teacherName, card.teachers,
      card.classKeys, card.classLabels, card.roomRule, card.roomId, card.fixedRoomId,
      card.manualRoomIds, card.requiredRoomCount, card.credits, card.allowedSlots, card.unavailableSlots,
    ]);
    const groups = (ttGroups() || []).map(group => [
      group.id, group.groupType, group.isConcurrent, group.poolCardIds, group.excludedCardIds,
      group.units, group.allowedSlots, group.unavailableSlots, group.durationPeriods,
    ]);
    const protectedShape = (protectedEntries || []).map(entry => [
      entry.id, entry.day, entry.period, entry.ttcardId, entry.ttcardIds,
      entry.teacherId, entry.teacherIds, entry.teacherName, entry.audienceClassKeys,
      entry.roomId, entry.roomIds, entry.roomAssignmentsByTtCardId,
    ]);
    const raw = JSON.stringify({
      periodCount: ttConfig()?.periodCount || 7,
      selectedGrades: normalizeAutoActiveGrades(options.selectedGrades || []),
      allowAutoRoomAssignment: options.allowAutoRoomAssignment === true,
      runAttempts: options.runAttempts || "balanced",
      standalone: (standalone || []).map(item => [autoItemKey(item), item.credits, item.durationPeriods]),
      groupBlocks: (groupBlocks || []).map(block => [block?.group?.id, (block?.unitItems || []).map(item => [item?.id, item?.credits])]),
      cards,
      groups,
      protectedShape,
      teacherConstraints: constraints() || {},
      rooms: (appState.rooms?.rooms || []).map(room => [room.id, room.teacherName, room.homeRoomClassId, room.unavailableSlots]),
    });
    return `${raw.length}:${freshStableHash(raw)}`;
  }

  function buildExactSolverCandidatePrecheck(standalone = [], groupBlocks = [], protectedEntries = [], options = {}) {
    const started = precheckClock();
    const baseSlots = freshBaseSlots();
    const strictOptions = {
      ...options,
      respectSoftLimits: true,
      respectUnavailable: true,
      respectAssignedRoom: true,
      engineProfile: autoEngineProfileForMode(options.runAttempts),
    };
    const { kept: blocks, skipped } = freshBuildBlocks(standalone, groupBlocks, protectedEntries);
    const previousEntries = ttDomain().entries;
    const previousAllowAutoRoomAssignment = currentAllowAutoRoomAssignment;
    const rows = [];
    try {
      // Use the exact state that the solver will use after initialization.
      ttDomain().entries = [...protectedEntries];
      currentAllowAutoRoomAssignment = options.allowAutoRoomAssignment === true;
      for (const block of blocks) {
        const candidateCount = freshDirectCandidateCount(block, baseSlots, [], strictOptions);
        const roomRelaxedCandidateCount = candidateCount > 0
          ? candidateCount
          : freshDirectCandidateCount(block, baseSlots, [], { ...strictOptions, respectAssignedRoom: false });
        const cardIds = freshBlockCardIds(block);
        const cards = cardIds.map(id => getTtCardById(id)).filter(Boolean);
        const requiredRoomCount = Math.max(0, Number(blockRequiredRoomCount(block)) || 0);
        const fixedRoomIds = cards.flatMap(card => configuredRoomIdsForCardDuringAuto(card, {})).map(cleanStr).filter(Boolean);
        const uniqueFixedRoomIds = [...new Set(fixedRoomIds)];
        const duplicateFixedRooms = fixedRoomIds.length > uniqueFixedRoomIds.length;
        const structuralCandidateValues = cardIds.map(id => Number(options?.structuralCandidateByCardId?.get?.(id) ?? 0)).filter(Number.isFinite);
        const structuralCandidateCount = structuralCandidateValues.length ? Math.min(...structuralCandidateValues) : 0;
        const componentTeacherCards = cards.filter(card => cardTeacherNamesForAuto(card).length).length;
        const teacherCount = freshBlockTeacherNames(block).length;
        rows.push({
          key: block.key,
          name: freshBlockName(block),
          kind: block.kind,
          candidateCount,
          roomRelaxedCandidateCount,
          structuralCandidateCount,
          candidateStatus: candidateCount > 0 ? "exact" : roomRelaxedCandidateCount > 0 ? "room-policy-excluded" : structuralCandidateCount > 0 ? "diagnostic-mismatch" : "blocked",
          cardIds,
          classCount: freshBlockAudienceKeys(block).length,
          teacherCount,
          componentTeacherCards,
          requiredRoomCount,
          fixedRoomCount: uniqueFixedRoomIds.length,
          configuredRoomCount: uniqueFixedRoomIds.length,
          duplicateFixedRooms,
          durationPeriods: blockDurationPeriods(block),
        });
      }
    } finally {
      ttDomain().entries = previousEntries;
      currentAllowAutoRoomAssignment = previousAllowAutoRoomAssignment;
    }
    const fingerprint = autoPrecheckFingerprint(standalone, groupBlocks, protectedEntries, options);
    precheckCandidateCache = {
      fingerprint,
      createdAt: Date.now(),
      counts: new Map(rows.map(row => [row.key, row.candidateCount])),
    };
    return {
      rows,
      skippedCount: skipped.length,
      blockCount: blocks.length,
      baseSlotCount: baseSlots.length,
      elapsedMs: Math.max(0, precheckClock() - started),
      reusedBySolver: true,
      fingerprint,
    };
  }

  function consumeExactSolverCandidateCache(standalone = [], groupBlocks = [], protectedEntries = [], options = {}) {
    const fingerprint = autoPrecheckFingerprint(standalone, groupBlocks, protectedEntries, options);
    const cache = precheckCandidateCache;
    precheckCandidateCache = null;
    if (!cache || cache.fingerprint !== fingerprint) return null;
    if (Date.now() - Number(cache.createdAt || 0) > 120000) return null;
    return cache.counts instanceof Map ? cache.counts : null;
  }

  function buildAutoAssignPrecheckReport(context = {}) {
    const precheckStarted = precheckClock();
    let {
      standalone = [],
      groupBlocks = [],
      activeGrades = [],
      options = {},
      protectedEntries = [],
      availableGrades = [],
    } = context;
    activeGrades = normalizeAutoActiveGrades(activeGrades);
    availableGrades = normalizeAutoActiveGrades(availableGrades);
    const report = {
      version: 2,
      mode: "his-autoassign-precheck-r367",
      createdAt: new Date().toISOString(),
      scopeGrades: activeGrades,
      counts: { ok: 0, warn: 0, error: 0, info: 0 },
      blockingCount: 0,
      items: []
    };

    const cards = ttDomain().ttcards || [];
    const groups = ttGroups();
    const existingEntries = entries();
    const manualCards = cards.filter(card => card?.isManual === true || String(card?.id || "").startsWith("ttc_manual"));
    const manualExcluded = manualCards.filter(isManualAutoAssignExcludedCard).length;
    const targetCards = cards.filter(card => !isManualAutoAssignExcludedCard(card));
    const activeCards = getActiveCardsForGrades(targetCards, activeGrades.length ? activeGrades : availableGrades);
    const cardIds = new Set(cards.map(c => c.id).filter(Boolean));
    const placedCardIds = getPlacedCardIdsForPrecheck(existingEntries);
    const targetSummary = summarizeAutoTargetsForPrecheck(standalone, groupBlocks);
    const protectedSummary = protectedSlotSummary(protectedEntries);

    const structuralPreflight = buildTimetablePreflightDiagnostics({
      ...appState,
      timetable: { ...(ttDomain() || {}), teacherConstraints: constraints() || {} },
    }, {
      scopeGrades: activeGrades.length ? activeGrades : availableGrades,
      protectedEntries,
      periodCount: Number(ttConfig()?.periodCount || 7),
      allowAutoRoomAssignment: options?.allowAutoRoomAssignment === true,
    });
    report.structuralPreflight = structuralPreflight;
    report.blockingCount += Number(structuralPreflight.blockingCount || 0);
    const sectionForStructuralIssue = issue => {
      const code = String(issue?.code || "");
      if (/^(teacher|room|class|card)-(?:id|name|teacher|class|room|fixed)/.test(code) || code === "identity-ok") return "데이터 식별자";
      if (code.startsWith("group-")) return "묶음수업";
      if (code.startsWith("protected-")) return "고정 배치 충돌";
      if (/candidate|day-shortage|zero-candidate/.test(code)) return "배치 가능시간";
      return "데이터 사전진단";
    };
    (structuralPreflight.issues || []).forEach(issue => {
      const status = issue.level === "error" ? "error" : issue.level === "warn" ? "warn" : "info";
      addPrecheckItem(report, sectionForStructuralIssue(issue), status, issue.title || issue.code || "사전진단", issue.detail || "", {
        code: issue.code,
        blocking: issue.blocking === true,
      });
    });

    const structuralCandidateByCardId = new Map((structuralPreflight.cardCandidates || []).map(row => [row.cardId, Number(row.candidateCount || 0)]));
    const exactCandidatePrecheck = buildExactSolverCandidatePrecheck(standalone, groupBlocks, protectedEntries, { ...options, structuralCandidateByCardId });
    report.exactCandidatePrecheck = exactCandidatePrecheck;
    const zeroCandidateBlocks = exactCandidatePrecheck.rows.filter(row => row.candidateStatus === "blocked");
    const roomPolicyExcludedBlocks = exactCandidatePrecheck.rows.filter(row => row.candidateStatus === "room-policy-excluded");
    const diagnosticMismatchBlocks = exactCandidatePrecheck.rows.filter(row => row.candidateStatus === "diagnostic-mismatch");
    const tightCandidateBlocks = exactCandidatePrecheck.rows.filter(row => row.candidateCount > 0 && row.candidateCount <= 2);
    const duplicateRoomBlocks = exactCandidatePrecheck.rows.filter(row => row.requiredRoomCount > 1 && row.duplicateFixedRooms && row.configuredRoomCount < row.requiredRoomCount);
    const roomCountBlocks = exactCandidatePrecheck.rows.filter(row => row.requiredRoomCount > row.configuredRoomCount && options?.allowAutoRoomAssignment !== true && row.roomRelaxedCandidateCount > 0);
    const teacherCountBlocks = exactCandidatePrecheck.rows.filter(row => row.kind !== "standalone" && row.componentTeacherCards > 1 && row.teacherCount < row.componentTeacherCards);
    if (zeroCandidateBlocks.length) {
      report.blockingCount += zeroCandidateBlocks.length;
      addPrecheckItem(report, "배치 가능시간", "error", "확정 배치 불가 후보 0칸", `${zeroCandidateBlocks.length}개 block · ${zeroCandidateBlocks.slice(0, 8).map(row => `${row.name}: 0칸`).join(" / ")}${zeroCandidateBlocks.length > 8 ? " …" : ""}`, { blocking: true, samples: zeroCandidateBlocks.slice(0, 20) });
    }
    if (roomPolicyExcludedBlocks.length) {
      addPrecheckItem(report, "배치 가능시간", "warn", "내장 자동배치 교실 정책으로 제외", `${roomPolicyExcludedBlocks.length}개 block은 시간 후보가 있지만 현재 '빈 교실 자동 배정' 옵션이 꺼져 있어 내장 자동배치 후보에서 제외됩니다. CP-SAT의 성공 여부와는 별개입니다. · ${roomPolicyExcludedBlocks.slice(0, 8).map(row => `${row.name}: 시간후보 ${row.roomRelaxedCandidateCount}칸`).join(" / ")}${roomPolicyExcludedBlocks.length > 8 ? " …" : ""}`, { samples: roomPolicyExcludedBlocks.slice(0, 20) });
    }
    if (diagnosticMismatchBlocks.length) {
      addPrecheckItem(report, "배치 가능시간", "warn", "후보 계산기 판정 불일치", `${diagnosticMismatchBlocks.length}개 block은 기본 후보가 있으나 내장 엄격 후보 계산에서는 0칸입니다. 실행을 차단하지 않고 최종 결과 검증으로 판정합니다. · ${diagnosticMismatchBlocks.slice(0, 8).map(row => row.name).join(" / ")}${diagnosticMismatchBlocks.length > 8 ? " …" : ""}`, { samples: diagnosticMismatchBlocks.slice(0, 20), diagnosticMismatch: true });
    }
    if (!zeroCandidateBlocks.length && !roomPolicyExcludedBlocks.length && !diagnosticMismatchBlocks.length) {
      addPrecheckItem(report, "배치 가능시간", "ok", "실제 자동배치 후보", `${exactCandidatePrecheck.blockCount}개 block 모두 최소 1칸 이상의 엄격 후보가 있습니다.`);
    }
    if (tightCandidateBlocks.length) addPrecheckItem(report, "배치 가능시간", "warn", "후보가 1~2칸뿐인 수업", `${tightCandidateBlocks.length}개 block · ${tightCandidateBlocks.slice(0, 8).map(row => `${row.name}: ${row.candidateCount}칸`).join(" / ")}${tightCandidateBlocks.length > 8 ? " …" : ""}`);
    if (duplicateRoomBlocks.length) addPrecheckItem(report, "묶음수업", "error", "동시수업 고정교실 중복", `${duplicateRoomBlocks.length}개 block에서 필요한 교실 수보다 고정교실이 중복됩니다. · ${duplicateRoomBlocks.slice(0, 8).map(row => row.name).join(" / ")}`);
    if (roomCountBlocks.length) addPrecheckItem(report, "묶음수업", "warn", "동시수업 교실 수 부족 가능성", `${roomCountBlocks.length}개 block · ${roomCountBlocks.slice(0, 8).map(row => `${row.name}: 필요 ${row.requiredRoomCount} / 설정·교사교실 ${row.configuredRoomCount}`).join(" / ")}${roomCountBlocks.length > 8 ? " …" : ""}`);
    if (teacherCountBlocks.length) addPrecheckItem(report, "묶음수업", "info", "동시수업 공유 교사 구조", `${teacherCountBlocks.length}개 block에서 같은 교사가 여러 구성 카드에 연결되어 있습니다. 엔진은 동일 그룹 안에서 이를 하나의 통합 수업으로 처리합니다. · ${teacherCountBlocks.slice(0, 8).map(row => `${row.name}: 카드 ${row.componentTeacherCards} / 교사 ${row.teacherCount}`).join(" / ")}`);

    addPrecheckItem(report, "대상 요약", targetCards.length ? "ok" : "error", "시간표 카드", `${targetCards.length}개 대상 / 전체 ${cards.length}개${manualCards.length ? ` · 수동카드 ${manualCards.length}개(제외 ${manualExcluded}개)` : ""} · 선택 학년: ${(activeGrades.length ? activeGrades : availableGrades).map(gradeDisplay).join(", ") || "없음"}`);
    addPrecheckItem(report, "대상 요약", targetSummary.totalSlots ? "ok" : "error", "자동배치 대상", `개별 ${targetSummary.standaloneSlots}시수 · 그룹 ${targetSummary.groupSlots}시수 · 합계 ${targetSummary.totalSlots}시수`);
    addPrecheckItem(report, "보호 슬롯", protectedSummary.total ? "info" : "ok", "기존 보호 배치", `엔트리 ${protectedSummary.total}개 · 슬롯 ${protectedSummary.slots}칸 · 고정 ${protectedSummary.pinned}개 · 수동 ${protectedSummary.manual}개`);

    const capacity = buildClassCapacityPrecheck(standalone, groupBlocks, protectedEntries, activeGrades.length ? activeGrades : availableGrades);
    report.classCapacity = capacity;
    const shortText = capacity.shortRows.slice(0, 8).map(row => `${row.label}: ${row.available}/${row.target} (${Math.abs(row.diff)} 부족)`).join(" / ");
    const overText = capacity.overRows.slice(0, 8).map(row => `${row.label}: ${row.available}/${row.target} (${row.diff} 초과)`).join(" / ");
    const capacityDetail = capacity.shortRows.length
      ? `${capacity.summary} · ${shortText}${capacity.shortRows.length > 8 ? " …" : ""}`
      : capacity.overRows.length
        ? `${capacity.summary} · ${overText}${capacity.overRows.length > 8 ? " …" : ""}`
        : capacity.summary;
    addPrecheckItem(report, "학급 시수 가능성", capacity.shortRows.length ? "error" : (capacity.overRows.length ? "warn" : "ok"), "월~금 전체 시수 구성 가능 여부", capacityDetail);
    // r42: 선생님이 지적한 핵심 검산입니다. 자동배정 엔진 문제가 맞는지,
    // 아니면 카드/그룹 구조가 35칸을 애초에 만족하지 못하는지 먼저 분리합니다.
    const exact35Rows = (capacity.rows || []).filter(row => Number(row.available) === Number(row.target));
    const matrixSamples = (capacity.rows || [])
      .filter(row => Number(row.available) !== Number(row.target))
      .slice(0, 8)
      .map(row => `${row.label}: ${row.available}/${row.target}`)
      .join(" / ");
    addPrecheckItem(
      report,
      "35칸 구조 검산",
      capacity.ok ? "ok" : "error",
      "7~12학년 모든 반 35칸 카드 구성",
      capacity.ok
        ? `${exact35Rows.length}/${capacity.rows.length}개 반이 카드/그룹 정규화 기준 ${capacity.targetPerClass}칸으로 맞습니다. 자동배정 실패가 나면 카드 수량보다 배치 solver/제약 충돌 문제로 봐야 합니다.`
        : `${exact35Rows.length}/${capacity.rows.length}개 반만 ${capacity.targetPerClass}칸입니다. ${matrixSamples}${(capacity.rows || []).length > 8 ? " …" : ""}`
    );

    const missingGroupRefs = [];
    const emptyGroups = [];
    groups.forEach(group => {
      const refs = collectCardIdsFromGroupForPrecheck(group);
      if (!refs.length) emptyGroups.push(group.name || group.groupName || group.id || "이름 없는 그룹");
      refs.forEach(id => { if (!cardIds.has(id)) missingGroupRefs.push(`${group.name || group.groupName || group.id} → ${id}`); });
    });
    addPrecheckItem(report, "그룹 점검", missingGroupRefs.length ? "error" : "ok", "그룹 카드 참조", missingGroupRefs.length ? `${missingGroupRefs.length}개 깨짐: ${missingGroupRefs.slice(0, 8).join(", ")}${missingGroupRefs.length > 8 ? " …" : ""}` : "정상");
    addPrecheckItem(report, "그룹 점검", emptyGroups.length ? "warn" : "ok", "빈 그룹", emptyGroups.length ? `${emptyGroups.length}개: ${emptyGroups.slice(0, 8).join(", ")}${emptyGroups.length > 8 ? " …" : ""}` : "없음");

    const duplicateIds = [...countPrecheckBy(cards, c => c.id).entries()].filter(([, n]) => n > 1);
    const duplicateExactKeys = [...countPrecheckBy(activeCards, cardKeyForPrecheck).entries()].filter(([key, n]) => key && !key.endsWith("::") && n > 1);
    addPrecheckItem(report, "카드 중복", duplicateIds.length ? "error" : "ok", "중복 카드 ID", duplicateIds.length ? `${duplicateIds.length}개 ID가 중복됩니다.` : "없음");
    addPrecheckItem(report, "카드 중복", duplicateExactKeys.length ? "warn" : "ok", "같은 학년/템플릿/섹션 중복", duplicateExactKeys.length ? `${duplicateExactKeys.length}종 발견 · 카드 갱신/DB 정리 확인 필요` : "없음");

    const wholeDuplicates = [...countPrecheckBy(activeCards.filter(isWholeGradeLikeCard), gradeTemplateKeyForPrecheck).entries()]
      .filter(([key, n]) => key && !key.endsWith("::") && n > 1);
    addPrecheckItem(report, "전체학년 카드", wholeDuplicates.length ? "warn" : "ok", "전체학년/창체 중복 생성", wholeDuplicates.length ? `${wholeDuplicates.length}종 발견 · 자율활동/동아리/채플이 중복 배치될 수 있습니다.` : "중복 없음");

    const groupRefSet = new Set(groups.flatMap(collectCardIdsFromGroupForPrecheck));
    const siblingIssues = [];
    groups.forEach(group => {
      const refs = collectCardIdsFromGroupForPrecheck(group);
      refs.forEach(id => {
        const card = cards.find(c => c.id === id);
        if (!card) return;
        const siblings = cards.filter(c =>
          c.id !== id &&
          c.gradeKey === card.gradeKey &&
          c.templateId === card.templateId &&
          !groupRefSet.has(c.id) &&
          !compoundPartKeyForPrecheck(c) &&
          cardAudienceOverlapsForPrecheck(card, c)
        );
        if (siblings.length) siblingIssues.push(`${group.name || group.groupName || group.id}: ${card.gradeKey || "?"} ${describeTtCard(card).title} 외 ${siblings.length}개`);
      });
    });
    addPrecheckItem(report, "그룹 점검", siblingIssues.length ? "warn" : "ok", "그룹 대표카드와 중복 카드 불일치", siblingIssues.length ? `${siblingIssues.length}건 · ${siblingIssues.slice(0, 6).join(" / ")}${siblingIssues.length > 6 ? " …" : ""}` : "없음");

    const activeManualCards = activeCards.filter(c => c.isManual || String(c.id || "").startsWith("ttc_manual"));
    const placedManualCards = activeManualCards.filter(c => placedCardIds.has(c.id));
    addPrecheckItem(report, "수동 카드", activeManualCards.length ? "info" : "ok", "수동 카드 보존", activeManualCards.length ? `수동 카드 ${activeManualCards.length}개 · 현재 배치 ${placedManualCards.length}개 · 보호 ${options.keepManual !== false ? "ON" : "OFF"}` : "수동 카드 없음");
    if (activeManualCards.length && options.keepManual === false) {
      addPrecheckItem(report, "수동 카드", "warn", "수동 카드 보호 꺼짐", "자동배치 초기화 범위에 배치된 수동 카드가 포함될 수 있습니다.");
    }

    const fixedRoomNoRoom = activeCards.filter(card => String(card.roomRule || "").trim() === "fixed" && !card.roomId && !card.fixedRoomId);
    const anyNoRoom = activeCards.filter(card => normalizeRoomRuleForAuto(card.roomRule || "teacher") !== "none" && !fixedRoomForCardDuringAuto(card, {}));
    addPrecheckItem(report, "교실 점검", fixedRoomNoRoom.length ? "error" : "ok", "지정교실 고정 규칙 미지정", fixedRoomNoRoom.length ? `${fixedRoomNoRoom.length}개 카드가 지정교실 고정 규칙이지만 교실이 없습니다.` : "없음");
    addPrecheckItem(report, "교실 점검", anyNoRoom.length ? (options?.allowAutoRoomAssignment ? "info" : "warn") : "ok", "교실 설정 없는 카드", anyNoRoom.length ? (options?.allowAutoRoomAssignment ? `${anyNoRoom.length}개 카드는 옵션에 따라 빈 교실을 자동 배정합니다.` : `${anyNoRoom.length}개 카드는 교사 교실/지정교실이 없어 자동배치 대상에서 제외됩니다.`) : "모든 카드에 교사 교실/지정교실 또는 제외 규칙 있음");

    const restrictedTargets = buildRestrictedTeacherTargetsForPrecheck(standalone, groupBlocks);
    if (!restrictedTargets.length) {
      addPrecheckItem(report, "제약교사", "ok", "제약근무 교사 수업", "선택 범위에 제약근무 교사 수업이 없습니다.");
    } else {
      const shortageRows = [];
      restrictedTargets.forEach(row => {
        const slotInfo = countAvailableSlotsForRestrictedTeacher(row.teacher, protectedEntries);
        if (slotInfo.available < row.target) shortageRows.push(`${row.teacher}: 필요 ${row.target} / 가능 ${slotInfo.available}`);
      });
      addPrecheckItem(report, "제약교사", shortageRows.length ? "warn" : "ok", "제약교사 가능시간", shortageRows.length ? `${shortageRows.length}명 부족 가능성 · ${shortageRows.slice(0, 8).join(" / ")}${shortageRows.length > 8 ? " …" : ""}` : `${restrictedTargets.length}명 확인 · 개인 가능시간은 충분해 보입니다.`);
    }

    const invalidSlots = existingEntries.filter(e => !Number.isInteger(e.day) || e.day < 0 || e.day > 4 || !Number.isInteger(e.period) || e.period < 0 || e.period >= Number(ttConfig()?.periodCount || 7));
    addPrecheckItem(report, "기존 배치", invalidSlots.length ? "error" : "ok", "요일/교시 범위", invalidSlots.length ? `${invalidSlots.length}개 엔트리가 현재 교시 범위를 벗어납니다.` : "정상");

    const postTargetClassHint = buildScheduleVerificationReport(existingEntries, { scopeGrades: activeGrades, protectedEntries });
    const classIssues = postTargetClassHint.classSlots?.issues || [];
    addPrecheckItem(report, "현재 배치 참고", "info", "현재 학급별 점유", classIssues.length ? `${classIssues.length}개 학급이 현재 기준시수와 다릅니다. 자동배치 전 상태이므로 참고용입니다.` : "현재 배치 기준으로 모든 학급이 기준시수와 일치합니다.");

    report.performance = {
      structuralMs: Number(structuralPreflight.performance?.totalMs || 0),
      exactCandidateMs: Number(exactCandidatePrecheck.elapsedMs || 0),
      totalMs: Math.max(0, precheckClock() - precheckStarted),
      candidateScanReusedBySolver: exactCandidatePrecheck.reusedBySolver === true,
      blockCount: exactCandidatePrecheck.blockCount,
      weeklySlotCount: exactCandidatePrecheck.baseSlotCount,
    };
    addPrecheckItem(
      report,
      "성능",
      "info",
      "사전진단 실행시간",
      `${report.performance.totalMs < 1 ? "<1" : report.performance.totalMs.toFixed(report.performance.totalMs < 10 ? 1 : 0)}ms · 구조 ${report.performance.structuralMs.toFixed(report.performance.structuralMs < 10 ? 1 : 0)}ms · 실제 후보 ${report.performance.exactCandidateMs.toFixed(report.performance.exactCandidateMs < 10 ? 1 : 0)}ms · 후보 계산은 다음 자동배치에서 재사용`,
      { performance: report.performance }
    );
    report.overall = report.blockingCount > 0 || report.counts.error ? "error" : report.counts.warn ? "warn" : "ok";
    return report;
  }

  function buildAutoAssignPrecheckHtml(report = {}, { allowProceed = true } = {}) {
    const bySection = new Map();
    (report.items || []).forEach(item => {
      if (!bySection.has(item.section)) bySection.set(item.section, []);
      bySection.get(item.section).push(item);
    });
    const statusText = { ok: "정상", warn: "주의", error: "오류", info: "정보" };
    const overall = report.overall || (report.counts?.error ? "error" : report.counts?.warn ? "warn" : "ok");
    const sections = [...bySection.entries()].map(([section, items]) => {
      const maxStatus = items.reduce((acc, item) => statusRankForPrecheck(item.status) > statusRankForPrecheck(acc) ? item.status : acc, "info");
      return `<section class="tt-precheck-section"><h3><span class="tt-precheck-dot ${maxStatus}"></span>${precheckEsc(section)}</h3>${items.map(item => `
        <div class="tt-precheck-item ${item.status}">
          <div class="tt-precheck-item-head"><span class="tt-precheck-badge ${item.status}">${statusText[item.status] || item.status}</span><b>${precheckEsc(item.title)}</b></div>
          ${item.detail ? `<div class="tt-precheck-detail">${precheckEsc(item.detail)}</div>` : ""}
        </div>`).join("")}</section>`;
    }).join("");

    return `
      <style>
        .tt-precheck-overlay{position:fixed;inset:0;z-index:2147483646;background:rgba(15,23,42,.5);display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;}
        .tt-precheck-dialog{width:min(980px,calc(100vw - 32px));max-height:calc(100vh - 48px);background:#fff;border-radius:18px;box-shadow:0 28px 90px rgba(15,23,42,.34);overflow:hidden;display:flex;flex-direction:column;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
        .tt-precheck-header{padding:18px 22px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;gap:16px;align-items:flex-start;background:linear-gradient(135deg,#f8fafc,#eef6ff);}
        .tt-precheck-header h2{margin:0;font-size:20px;color:#0f172a}.tt-precheck-header p{margin:6px 0 0;color:#64748b;font-size:13px;line-height:1.45}
        .tt-precheck-summary{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;padding:16px 22px 0;}
        .tt-precheck-card{border:1px solid #e2e8f0;border-radius:14px;padding:12px;background:#fff}.tt-precheck-card strong{display:block;font-size:22px;line-height:1;color:#0f172a}.tt-precheck-card span{display:block;margin-top:6px;color:#64748b;font-size:12px;font-weight:800}.tt-precheck-card.overall.ok{background:#f0fdf4;border-color:#bbf7d0}.tt-precheck-card.overall.warn{background:#fffbeb;border-color:#fde68a}.tt-precheck-card.overall.error{background:#fef2f2;border-color:#fecaca}
        .tt-precheck-body{overflow:auto;padding:4px 22px 22px}.tt-precheck-section{border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;margin-top:12px;background:#fff}.tt-precheck-section h3{margin:0;padding:12px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-size:14px;color:#0f172a;display:flex;gap:8px;align-items:center}.tt-precheck-dot{width:10px;height:10px;border-radius:999px;background:#64748b}.tt-precheck-dot.ok{background:#16a34a}.tt-precheck-dot.warn{background:#f59e0b}.tt-precheck-dot.error{background:#dc2626}.tt-precheck-dot.info{background:#64748b}
        .tt-precheck-item{padding:11px 14px;border-bottom:1px solid #f1f5f9}.tt-precheck-item:last-child{border-bottom:0}.tt-precheck-item-head{display:flex;gap:8px;align-items:center;font-size:13px;color:#0f172a}.tt-precheck-badge{font-size:11px;border-radius:999px;padding:3px 7px;color:white;background:#64748b;min-width:36px;text-align:center}.tt-precheck-badge.ok{background:#16a34a}.tt-precheck-badge.warn{background:#f59e0b}.tt-precheck-badge.error{background:#dc2626}.tt-precheck-badge.info{background:#64748b}.tt-precheck-detail{margin-top:5px;color:#475569;font-size:12px;line-height:1.45;white-space:pre-wrap;word-break:break-word;}
        .tt-precheck-actions{display:flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap}.tt-precheck-btn{border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:10px;padding:8px 12px;font-weight:800;cursor:pointer}.tt-precheck-btn.primary{background:#2563eb;border-color:#2563eb;color:#fff}.tt-precheck-btn.danger{background:#dc2626;border-color:#dc2626;color:#fff}
        @media(max-width:780px){.tt-precheck-header{flex-direction:column}.tt-precheck-actions{justify-content:flex-start}.tt-precheck-summary{grid-template-columns:repeat(2,minmax(0,1fr));}}
      </style>
      <div class="tt-precheck-dialog" role="dialog" aria-modal="true" aria-label="자동배치 사전 점검">
        <div class="tt-precheck-header"><div><h2>🩺 자동배치 사전 점검</h2><p>${precheckEsc(new Date(report.createdAt).toLocaleString())} 기준 · ${report.blockingCount ? `실행 차단 항목 ${report.blockingCount}개를 먼저 수정하세요.` : overall === "ok" ? "자동배치를 시작해도 좋은 상태입니다." : overall === "warn" ? "주의 항목을 확인한 뒤 진행하세요." : "오류 항목을 먼저 수정하는 것이 안전합니다."}</p></div><div class="tt-precheck-actions"><button type="button" class="tt-precheck-btn" data-precheck-export>JSON 내보내기</button><button type="button" class="tt-precheck-btn" data-precheck-close>닫기</button>${allowProceed ? `<button type="button" class="tt-precheck-btn ${overall === "error" ? "danger" : "primary"}" data-precheck-proceed>${overall === "ok" ? "자동배치 시작" : "확인 후 계속"}</button>` : ""}</div></div>
        <div class="tt-precheck-summary"><div class="tt-precheck-card overall ${overall}"><strong>${overall === "ok" ? "OK" : overall === "warn" ? "주의" : "오류"}</strong><span>종합 상태</span></div><div class="tt-precheck-card"><strong>${report.blockingCount || 0}</strong><span>실행 차단</span></div><div class="tt-precheck-card"><strong>${report.counts?.error || 0}</strong><span>오류</span></div><div class="tt-precheck-card"><strong>${report.counts?.warn || 0}</strong><span>주의</span></div><div class="tt-precheck-card"><strong>${report.counts?.ok || 0}</strong><span>정상</span></div><div class="tt-precheck-card"><strong>${Number(report.performance?.totalMs || 0) < 1 ? "<1" : Number(report.performance?.totalMs || 0).toFixed(0)}ms</strong><span>진단 시간</span></div></div>
        <div class="tt-precheck-body">${sections}</div>
      </div>`;
  }

  function downloadPrecheckJson(report) {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `his-autoassign-precheck-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function openAutoAssignPrecheckDialog(report, { allowProceed = true } = {}) {
    return new Promise(resolve => {
      const old = document.querySelector(".tt-precheck-overlay");
      if (old) old.remove();
      const overlay = document.createElement("div");
      overlay.className = "tt-precheck-overlay";
      overlay.innerHTML = buildAutoAssignPrecheckHtml(report, { allowProceed });
      document.body.appendChild(overlay);
      const close = value => { overlay.remove(); resolve(value); };
      overlay.querySelector("[data-precheck-close]")?.addEventListener("click", () => close(false));
      overlay.querySelector("[data-precheck-proceed]")?.addEventListener("click", () => close(true));
      overlay.querySelector("[data-precheck-export]")?.addEventListener("click", () => downloadPrecheckJson(report));
      overlay.addEventListener("click", ev => { if (ev.target === overlay) close(false); });
    });
  }

  async function openAutoAssignPrecheckOnly() {
    const rawItems = buildSchedulableItems();
    let standalone = (rawItems.standalone || []).map(annotateRestrictedAutoItem);
    let groupBlocks = (rawItems.groupBlocks || []).map(annotateRestrictedGroupBlock);
    const availableGrades = getActiveGradesFromScheduleItems(standalone, groupBlocks);
    if (!availableGrades.length || (!standalone.length && !groupBlocks.length)) {
      alert("시간표 사전작업에서 생성된 과목 카드가 없습니다.");
      return;
    }
    const options = { ...AUTO_ASSIGN_DEFAULT_OPTIONS, selectedGrades: normalizeAutoActiveGrades(availableGrades) };
    ({ standalone, groupBlocks } = filterAutoTargetsByGrades(standalone, groupBlocks, options.selectedGrades));
    const protectedEntries = hydrateAutoRoomsForEntries(computeProtectedEntries(entries(), options));
    const activeGrades = getActiveGradesFromScheduleItems(standalone, groupBlocks);
    const report = buildAutoAssignPrecheckReport({ standalone, groupBlocks, activeGrades, availableGrades, options, protectedEntries });
    await openAutoAssignPrecheckDialog(report, { allowProceed: false });
  }

  // ── r86 fresh auto-placement engine ─────────────────────────────
  // 기존 자동배치의 “한 번 꽂고 막히면 진단” 흐름을 대체하는 새 코어입니다.
  // 원칙: 같은 시간에 함께 움직여야 하는 수업은 block으로 묶고,
  // 직접 배치가 막히면 blocker block을 실제로 빼서 다른 슬롯으로 재삽입합니다.
  function freshBlockCardIds(block = {}) {
    return [...new Set((block.items || [])
      .flatMap(item => ttCardIdsFromPlacement(item) || [])
      .filter(Boolean))];
  }

  function freshBlockTeacherNames(block = {}) {
    return [...new Set((block.items || []).flatMap(item => hardTeacherNamesForPlacement(item)).filter(Boolean))];
  }

  function freshBlockAudienceKeys(block = {}) {
    const out = new Set();
    (block.items || []).forEach(item => {
      const aud = audienceForPlacement(item);
      (aud?.classKeys || new Set()).forEach(k => out.add(k));
    });
    return [...out].filter(Boolean);
  }

  function freshBlockName(block = {}) {
    return block.name || getAutoItemName(block.primaryItem || block.items?.[0] || {}) || block.key || "수업";
  }

  function freshStableHash(value = "") {
    const s = String(value || "");
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function freshSlotSortValue(slot = {}, salt = "") {
    // 월1→금7 고정 정렬에 작은 deterministic salt를 섞어, 재현성은 유지하면서
    // 같은 점수 후보가 한 슬롯에 몰리는 현상을 줄입니다.
    const base = (Number(slot.period) || 0) * 10 + (Number(slot.day) || 0);
    const jitter = freshStableHash(`${salt}:${slot.day}:${slot.period}`) % 997;
    return base * 1000 + jitter / 997;
  }

  function freshBaseSlots() {
    const periodCount = Math.max(1, parseInt(ttConfig()?.periodCount, 10) || 7);
    const days = [0, 1, 2, 3, 4];
    const slots = [];
    days.forEach(day => {
      for (let period = 0; period < periodCount; period++) slots.push({ day, period });
    });
    return slots;
  }

  function freshBuildGroupPlacementItems(group, activeItems = []) {
    // r97: 그룹카드 자체가 하나의 배치 카드입니다.
    // 내부 카드들은 같은 칸을 차지하는 구성요소일 뿐, 자동배치에서는 분리 entry로 만들지 않습니다.
    const item = makeSingleGroupPlacementItem(group, activeItems);
    return item ? [item] : [];
  }

  function freshMakeStandaloneBlock(item = {}, index = 0) {
    const annotated = annotateRestrictedAutoItem(item);
    const cardIds = ttCardIdsFromPlacement(annotated).filter(Boolean);
    const name = getAutoItemName(annotated);
    return {
      key: `fresh:S:${autoItemKey(annotated)}:${index}`,
      kind: "standalone",
      name,
      primaryItem: annotated,
      items: [annotated],
      cardIds,
      occurrence: index + 1,
      groupId: null
    };
  }

  function freshMakeGroupBlocks(groupBlock = {}, blockIndex = 0) {
    const { group, unitItems = [] } = groupBlock || {};
    if (!group || !unitItems.length) return [];
    const isConcurrent = group?.isConcurrent || group?.groupType === "concurrent";
    const credits = unitItems.map(u => Math.max(0, Number(u?.credits) || 0));
    const duration = Math.max(1, durationForAutoObject(group), ...(unitItems || []).map(durationForAutoObject));
    const requiredRoomCount = Math.max(1, requiredRoomCountForAutoObject(group), ...(unitItems || []).map(requiredRoomCountForAutoObject));
    const blocks = [];
    if (isConcurrent) {
      const maxCredits = Math.max(0, ...credits);
      const occurrenceCount = Math.max(0, Math.ceil(maxCredits / duration));
      for (let occ = 0; occ < occurrenceCount; occ++) {
        const sourceOccurrence = occ * duration;
        const activeItems = unitItems
          .map(u => getGroupItemForOccurrence(u, sourceOccurrence))
          .filter(u => (u.ttcards || []).length);
        const items = freshBuildGroupPlacementItems(group, activeItems);
        if (!items.length) continue;
        const cardIds = [...new Set(items.flatMap(item => ttCardIdsFromPlacement(item)).filter(Boolean))];
        const name = `${group.name || "동시수업 그룹"} ${occ + 1}`;
        blocks.push({
          key: `fresh:G:${group.id || blockIndex}:${occ}`,
          kind: "group",
          name,
          group,
          groupId: group.id || null,
          occurrence: occ + 1,
          primaryItem: items[0],
          items: items.map(item => ({ ...item, durationPeriods: duration, continuousPeriods: duration, requiredRoomCount, multiRoomCount: requiredRoomCount })),
          activeItems,
          cardIds,
          durationPeriods: duration,
          continuousPeriods: duration,
          requiredRoomCount,
          multiRoomCount: requiredRoomCount
        });
      }
      return blocks;
    }

    // 비동시 그룹은 unit별·회차별로 독립 block으로 처리합니다.
    unitItems.forEach((unitItem, unitIdx) => {
      const count = Math.max(0, Number(unitItem?.credits) || 0);
      const unitDuration = Math.max(1, durationForAutoObject(group), durationForAutoObject(unitItem));
      const unitRoomCount = Math.max(1, requiredRoomCountForAutoObject(group), requiredRoomCountForAutoObject(unitItem));
      const occurrenceCount = Math.max(0, Math.ceil(count / unitDuration));
      for (let occ = 0; occ < occurrenceCount; occ++) {
        const active = getGroupItemForOccurrence(unitItem, occ * unitDuration);
        const items = freshBuildGroupPlacementItems(group, [active]);
        if (!items.length) continue;
        blocks.push({
          key: `fresh:G:${group.id || blockIndex}:${unitIdx}:${occ}`,
          kind: "group-unit",
          name: `${group.name || unitItem.name || "그룹 수업"} ${occ + 1}`,
          group,
          groupId: group.id || null,
          occurrence: occ + 1,
          primaryItem: items[0],
          items: items.map(item => ({ ...item, durationPeriods: unitDuration, continuousPeriods: unitDuration, requiredRoomCount: unitRoomCount, multiRoomCount: unitRoomCount })),
          activeItems: [active],
          cardIds: [...new Set(items.flatMap(item => ttCardIdsFromPlacement(item)).filter(Boolean))],
          durationPeriods: unitDuration,
          continuousPeriods: unitDuration,
          requiredRoomCount: unitRoomCount,
          multiRoomCount: unitRoomCount
        });
      }
    });
    return blocks;
  }

  function freshProtectedCardCoverage(protectedEntries = []) {
    const slotSets = new Map();
    (protectedEntries || []).forEach(entry => {
      const slot = `${entry.day}:${entry.period}`;
      ttCardIdsFromPlacement(entry).forEach(id => {
        if (!id) return;
        if (!slotSets.has(id)) slotSets.set(id, new Set());
        slotSets.get(id).add(slot);
      });
    });
    const counts = new Map();
    slotSets.forEach((set, id) => counts.set(id, set.size));
    return counts;
  }

  function freshRemoveCoveredBlocks(blocks = [], protectedEntries = []) {
    const coverage = freshProtectedCardCoverage(protectedEntries);
    const kept = [];
    const skipped = [];
    for (const block of blocks) {
      const ids = freshBlockCardIds(block);
      if (ids.length && ids.every(id => (coverage.get(id) || 0) > 0)) {
        ids.forEach(id => coverage.set(id, Math.max(0, (coverage.get(id) || 0) - 1)));
        skipped.push(block);
      } else {
        kept.push(block);
      }
    }
    return { kept, skipped };
  }

  function freshBuildBlocks(standalone = [], groupBlocks = [], protectedEntries = []) {
    const blocks = [];
    standalone.forEach((item, index) => blocks.push(freshMakeStandaloneBlock(item, index)));
    groupBlocks.forEach((block, index) => blocks.push(...freshMakeGroupBlocks(block, index)));
    const filtered = blocks.filter(block => block.items?.length && isAllowedAutoPlacementSource(block.primaryItem || block.items[0] || {}));
    return freshRemoveCoveredBlocks(filtered, protectedEntries);
  }

  function freshMakeBlockEntries(block = {}, slot = {}, placed = [], checkOptions = {}) {
    const pending = [];
    const slots = blockSlotSequence(block, slot);
    if (!slots.length) return null;
    const duration = blockDurationPeriods(block);
    const requiredRoomCount = blockRequiredRoomCount(block);
    for (const blockSlot of slots) {
      for (const rawItem of block.items || []) {
        const item = annotateRestrictedAutoItem({
          ...rawItem,
          durationPeriods: duration,
          continuousPeriods: duration,
          requiredRoomCount,
          multiRoomCount: requiredRoomCount
        });
        if (!checkPlacementValid(item, blockSlot, [...placed, ...pending], checkOptions)) return null;
        const entry = makeAutoEntry(item, blockSlot, [...placed, ...pending]);
        if (!entry) return null;
        pending.push(normalizeTimetableEntry({
          ...entry,
          autoBlockKey: block.key,
          autoEngine: "fresh-csp-r343",
          autoGroupBlock: block.kind !== "standalone",
          autoOccurrence: block.occurrence || 1,
          durationPeriods: duration,
          continuousPeriods: duration,
          requiredRoomCount,
          multiRoomCount: requiredRoomCount,
          autoBlockSpanIndex: blockSlot.spanIndex || 0,
          autoBlockSpanTotal: duration
        }));
      }
    }
    return pending.length ? pending : null;
  }

  function freshDirectCandidateCount(block, baseSlots, placed, checkOptions = {}) {
    let count = 0;
    for (const slot of baseSlots) {
      if (freshMakeBlockEntries(block, slot, placed, checkOptions)) count += 1;
    }
    return count;
  }

  function freshBlockDifficulty(block, initialCandidateCount = 99) {
    const teacherCount = freshBlockTeacherNames(block).length;
    const classCount = freshBlockAudienceKeys(block).length;
    const cardCount = freshBlockCardIds(block).length;
    const restrictedCount = (block.items || []).filter(item => getRestrictedTeachersForAutoItem(item).length).length;
    const bigGroupBonus = block.kind === "standalone" ? 0 : 1200 + classCount * 120 + cardCount * 80;
    const fixedRoomBonus = blockHasFixedRoomForAuto(block) ? 650 : 0;
    const bottleneckBonus = getBottleneckAutoItemPriority(block.primaryItem || {}) * -1;
    return (1000 - Math.min(999, initialCandidateCount) * 12)
      + bigGroupBonus
      + fixedRoomBonus
      + teacherCount * 55
      + classCount * 45
      + cardCount * 25
      + restrictedCount * 120
      + bottleneckBonus;
  }

  function freshBlockPlacementTier(block = {}) {
    const isGroup = block.kind !== "standalone";
    const isBigGroup = isGroup && (freshBlockCardIds(block).length >= 2 || freshBlockAudienceKeys(block).length >= 2);
    if (isBigGroup) return 0;
    if (blockHasFixedRoomForAuto(block)) return 1;
    return 2;
  }

  function freshOrderBlocks(blocks = [], baseSlots = [], checkOptions = {}, cachedCandidateCounts = null) {
    return blocks.map((block, idx) => {
      const candidateCount = cachedCandidateCounts instanceof Map && cachedCandidateCounts.has(block.key)
        ? Number(cachedCandidateCounts.get(block.key) || 0)
        : freshDirectCandidateCount(block, baseSlots, [], checkOptions);
      const tier = freshBlockPlacementTier(block);
      const sizeScore = blockClassCardSize(block);
      return { block, idx, tier, sizeScore, candidateCount, difficulty: freshBlockDifficulty(block, candidateCount) };
    }).sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.tier === 0 && b.sizeScore !== a.sizeScore) return b.sizeScore - a.sizeScore;
      if (a.tier === 1 && b.sizeScore !== a.sizeScore) return b.sizeScore - a.sizeScore;
      if (a.candidateCount !== b.candidateCount) return a.candidateCount - b.candidateCount;
      if (b.difficulty !== a.difficulty) return b.difficulty - a.difficulty;
      return String(freshBlockName(a.block)).localeCompare(String(freshBlockName(b.block)), "ko", { numeric: true }) || a.idx - b.idx;
    }).map(x => ({
      ...x.block,
      initialCandidateCount: x.candidateCount,
      freshDifficulty: x.difficulty,
      freshPlacementTier: x.tier,
      freshSizeScore: x.sizeScore
    }));
  }

  function freshSlotScore(block = {}, slot = {}, placed = [], checkOptions = {}) {
    let score = freshSlotSortValue(slot, block.key);
    const items = block.items || [];
    for (const item of items) {
      try { score += scoreAutoSlotLight(item, slot, placed, checkOptions); }
      catch (_) { score += 1000; }
    }
    // 학급이 이미 꽉 찬 요일보다 비어 있는 요일을 선호합니다.
    const existing = [...entries(), ...(placed || [])];
    const classStats = buildClassSlotStatsForEntries(existing);
    for (const cls of freshBlockAudienceKeys(block)) {
      score += classDayLoadFromStats(classStats, cls, slot.day) * 18;
    }
    return Number.isFinite(score) ? score : 999999;
  }

  function freshOrderSlots(block, baseSlots, placed, checkOptions = {}, { forDisplacement = false, lockKeys = new Set() } = {}) {
    const rows = baseSlots.map(slot => {
      const direct = freshMakeBlockEntries(block, slot, placed, checkOptions);
      const blockers = direct ? [] : (forDisplacement ? freshInferBlockers(block, slot, placed, lockKeys, checkOptions) : []);
      return {
        slot,
        direct: !!direct,
        blockers,
        score: freshSlotScore(block, slot, placed, checkOptions) + blockers.length * 850 + (direct ? 0 : 120)
      };
    });
    rows.sort((a, b) => {
      if (a.direct !== b.direct) return a.direct ? -1 : 1;
      if (a.blockers.length !== b.blockers.length) return a.blockers.length - b.blockers.length;
      return a.score - b.score;
    });
    return rows;
  }

  function freshEntryTeacherSet(entry = {}) {
    return new Set(teacherNamesForPlacement(entry));
  }

  function freshItemTeacherSet(item = {}) {
    return new Set(hardTeacherNamesForPlacement(item));
  }

  function freshSameConcurrentGroup(item = {}, entry = {}) {
    return sameActiveGroup(item, entry) && isConcurrentItem(item) && isConcurrentItem(entry);
  }

  function freshItemConflictsWithEntry(item = {}, entry = {}, slot = {}, placed = []) {
    if (!entry || entry.day !== slot.day || entry.period !== slot.period) return false;
    if (hasAutoGroupExclusionSlotConflict(item, entry)) return true;
    if (hasInternalCompoundSiblingConflict(item) || hasCompoundSiblingConflict(item, entry)) return true;

    const itemTeachers = freshItemTeacherSet(item);
    const entryTeachers = freshEntryTeacherSet(entry);
    for (const t of itemTeachers) {
      if (entryTeachers.has(t) && !freshSameConcurrentGroup(item, entry)) return true;
    }

    const itemAudience = audienceForPlacement(item);
    const entryAudience = audienceForPlacement(entry);
    if (audiencesConflict(itemAudience, entryAudience) && !freshSameConcurrentGroup(item, entry)) return true;

    const roomed = applyAutoRoomToEntryData({ ...item, ...slot }, slot, placed || []);
    if (roomsOverlapForPlacement(roomed, entry)) return true;
    return false;
  }

  function freshInferBlockers(block = {}, slot = {}, placed = [], lockKeys = new Set(), checkOptions = {}) {
    const slots = blockSlotSequence(block, slot);
    if (!slots.length) return [];
    const slotKeySet = new Set(slots.map(s => `${s.day}:${s.period}`));
    const sameSlot = (placed || []).filter(e => slotKeySet.has(`${e.day}:${e.period}`) && e.autoBlockKey && !lockKeys.has(e.autoBlockKey));
    const blockers = new Set();
    for (const item of block.items || []) {
      for (const entry of sameSlot) {
        const entrySlot = { day: entry.day, period: entry.period };
        if (freshItemConflictsWithEntry(item, entry, entrySlot, placed)) blockers.add(entry.autoBlockKey);
      }
    }

    if (blockers.size) return [...blockers];

    // 불가 원인이 복합적인 경우에는 같은 슬롯 block을 하나씩 제거해 실제로 열리는 blocker만 찾습니다.
    const sameSlotKeys = [...new Set(sameSlot.map(e => e.autoBlockKey).filter(Boolean))];
    for (const key of sameSlotKeys) {
      const reduced = placed.filter(e => e.autoBlockKey !== key);
      if (freshMakeBlockEntries(block, slot, reduced, checkOptions)) return [key];
    }
    if (sameSlotKeys.length <= 5) {
      const reduced = placed.filter(e => !sameSlotKeys.includes(e.autoBlockKey));
      if (freshMakeBlockEntries(block, slot, reduced, checkOptions)) return sameSlotKeys;
    }
    return [];
  }

  function freshRemoveBlockEntries(placed = [], blockKey = "") {
    const removed = [];
    for (let i = placed.length - 1; i >= 0; i--) {
      if (placed[i]?.autoBlockKey === blockKey) removed.push(...placed.splice(i, 1));
    }
    return removed.reverse();
  }

  function freshRestorePlaced(placed = [], snapshot = []) {
    placed.splice(0, placed.length, ...snapshot.map(e => ({ ...e })));
  }

  function freshPushEntries(placed = [], entriesToPush = []) {
    entriesToPush.forEach(e => placed.push(e));
  }

  function freshTryDirectPlace(block, placed, baseSlots, checkOptions = {}, budget = null) {
    for (const row of freshOrderSlots(block, baseSlots, placed, checkOptions)) {
      if (!freshBudgetTick(budget)) return { ok: false, timedOut: true };
      const entriesToPush = freshMakeBlockEntries(block, row.slot, placed, checkOptions);
      if (!entriesToPush) continue;
      freshPushEntries(placed, entriesToPush);
      return { ok: true, slot: row.slot, displaced: 0 };
    }
    return { ok: false, timedOut: !!budget?.timedOut };
  }

  function freshPlaceWithDisplacement(block, placed, baseSlots, blockByKey, checkOptions = {}, limits = {}, depth = 0, lockKeys = new Set(), budget = null) {
    if (!freshBudgetTick(budget)) return { ok: false, timedOut: true };
    const direct = freshTryDirectPlace(block, placed, baseSlots, checkOptions, budget);
    if (direct.ok) return direct;
    if (direct.timedOut || depth <= 0) return { ok: false, timedOut: !!direct.timedOut || !!budget?.timedOut };

    const maxBlockers = Math.max(1, Number(limits.maxBlockersPerMove || 4));
    const candidateBudget = Math.max(4, Number(limits.displacementSlotBudget || 18));
    const rows = freshOrderSlots(block, baseSlots, placed, checkOptions, { forDisplacement: true, lockKeys })
      .filter(row => row.blockers.length && row.blockers.length <= maxBlockers)
      .slice(0, candidateBudget);

    for (const row of rows) {
      if (!freshBudgetTick(budget, 2)) return { ok: false, timedOut: true };
      const snapshot = placed.map(e => ({ ...e }));
      const blockerKeys = [...new Set(row.blockers)].sort((a, b) => {
        const ba = blockByKey.get(a);
        const bb = blockByKey.get(b);
        return (Number(bb?.freshDifficulty || 0) - Number(ba?.freshDifficulty || 0));
      });
      blockerKeys.forEach(key => freshRemoveBlockEntries(placed, key));
      const entriesToPush = freshMakeBlockEntries(block, row.slot, placed, checkOptions);
      if (!entriesToPush) {
        freshRestorePlaced(placed, snapshot);
        continue;
      }
      freshPushEntries(placed, entriesToPush);

      let ok = true;
      let displaced = blockerKeys.length;
      const nextLocks = new Set([...lockKeys, block.key]);
      for (const key of blockerKeys) {
        const blocker = blockByKey.get(key);
        if (!blocker) continue;
        const moved = freshPlaceWithDisplacement(blocker, placed, baseSlots, blockByKey, checkOptions, limits, depth - 1, nextLocks, budget);
        if (!moved.ok) { ok = false; if (moved.timedOut && budget) budget.timedOut = true; break; }
        displaced += Number(moved.displaced || 0);
      }
      if (ok) return { ok: true, slot: row.slot, displaced };
      freshRestorePlaced(placed, snapshot);
      if (budget?.timedOut) return { ok: false, timedOut: true };
    }
    return { ok: false, timedOut: !!budget?.timedOut };
  }

  function freshCoverageFailureItemsFromValidation(validation = {}, blockByCardId = new Map()) {
    const failures = [];
    (validation.cardCoverage?.shortRows || []).forEach(row => {
      const shortage = Math.max(0, -Number(row.diff || 0));
      const blockList = Array.isArray(blockByCardId.get(row.id)) ? blockByCardId.get(row.id) : [blockByCardId.get(row.id)].filter(Boolean);
      const block = blockList[0];
      const item = block?.primaryItem;
      for (let i = 0; i < shortage; i++) {
        if (item) failures.push(makeFailedPlacement(`${row.title}${row.classLabels?.length ? ` ${row.classLabels.join(", ")}` : ""}`, item, {
          source: "freshCoverageShortage",
          ttcardId: row.id,
          occurrence: (row.count || 0) + i + 1,
          required: row.target
        }));
      }
    });
    return failures;
  }

  function freshAddBlockToCardIndex(index, cardId, block) {
    if (!cardId || !block) return;
    if (!index.has(cardId)) index.set(cardId, []);
    index.get(cardId).push(block);
  }

  function freshSortCardBlockIndex(index = new Map()) {
    index.forEach(list => {
      list.sort((a, b) => {
        const ao = Number(a?.occurrence || 0);
        const bo = Number(b?.occurrence || 0);
        if (ao !== bo) return ao - bo;
        return String(a?.key || "").localeCompare(String(b?.key || ""), "ko", { numeric: true });
      });
    });
    return index;
  }

  function freshPlacedBlockKeys(placed = []) {
    return new Set((placed || []).map(e => e?.autoBlockKey).filter(Boolean));
  }

  function freshPlacementItemFromCardId(cardId = "") {
    const card = getTtCardById(cardId);
    if (!card) return null;
    const teacher = getTeachersForTtCard(card).filter(Boolean).join(",");
    const groupId = groupIdsForCardId(card.id)[0] || null;
    return annotateRestrictedAutoItem({
      kind: "coverage-single",
      ttcardId: card.id,
      ttcardIds: [card.id],
      templateId: card.templateId,
      templateIds: [card.templateId].filter(Boolean),
      sectionIdx: card.sectionIdx ?? 0,
      gradeKey: card.gradeKey,
      gradeKeys: [card.gradeKey].filter(Boolean),
      teacherName: teacher,
      groupId
    });
  }

  function freshTryOneMoveCoverageCard(cardId, placed = [], baseSlots = [], options = {}, budget = null) {
    const item = freshPlacementItemFromCardId(cardId);
    if (!item) return null;
    const probeKey = `fresh:ONEMOVE:${cardId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const checkOptions = {
      ...options,
      respectSoftLimits: false,
      respectUnavailable: true,
      respectAssignedRoom: true
    };
    const targetSlots = orderRepairTargetSlotsForItem(item, baseSlots, placed);
    const moveSlots = [...baseSlots].sort((a, b) => {
      if (a.period !== b.period) return a.period - b.period;
      return a.day - b.day;
    });
    let attempts = 0;

    for (const targetSlot of targetSlots) {
      if (!freshBudgetTick(budget, 2)) return null;
      attempts += 1;
      if (checkPlacementValid(item, targetSlot, placed, checkOptions)) {
        const entry = makeAutoEntry(item, targetSlot, placed);
        if (!entry) continue;
        const fixed = normalizeTimetableEntry({
          ...entry,
          autoBlockKey: probeKey,
          autoEngine: "fresh-csp-r123-coverage-onemove-direct",
          autoCoverageRepair: true
        });
        placed.push(fixed);
        return { mode: "coverage-onemove-direct", entries: [fixed], blockKey: probeKey, attempts };
      }

      const blockers = uniqueMovableBlocks(getBlockingBlocksForSlot(item, targetSlot, placed))
        .filter(isRepairBlockMovable)
        .slice(0, 4);
      if (!blockers.length) continue;

      for (const block of blockers) {
        if (!freshBudgetTick(budget, 4)) return null;
        const blockIds = new Set((block.entries || []).map(e => e.id).filter(Boolean));
        const withoutBlock = placed.filter(e => !blockIds.has(e.id));
        for (const moveSlot of moveSlots) {
          if (!freshBudgetTick(budget)) return null;
          attempts += 1;
          if (moveSlot.day === targetSlot.day && moveSlot.period === targetSlot.period) continue;
          const moved = makeMovedBlockEntries(block, moveSlot, withoutBlock, checkOptions);
          if (!moved) continue;
          const baseWithMoved = [...withoutBlock, ...moved];
          if (!checkPlacementValid(item, targetSlot, baseWithMoved, checkOptions)) continue;
          const entry = makeAutoEntry(item, targetSlot, baseWithMoved);
          if (!entry) continue;
          const fixed = normalizeTimetableEntry({
            ...entry,
            autoBlockKey: probeKey,
            autoEngine: "fresh-csp-r123-coverage-onemove",
            autoCoverageRepair: true
          });
          placed.splice(0, placed.length, ...baseWithMoved, fixed);
          return {
            mode: "coverage-onemove",
            entries: [fixed],
            movedEntries: moved,
            movedBlockKey: block.key,
            blockKey: probeKey,
            attempts
          };
        }
      }
    }
    return null;
  }

  function freshTryPlaceSingleCoverageCard(cardId, placed = [], baseSlots = [], options = {}) {
    const item = freshPlacementItemFromCardId(cardId);
    if (!item) return null;

    // 먼저 정상 검증을 통과하는 직접 슬롯을 찾습니다.
    const probeBlock = {
      key: `fresh:CARD:${cardId}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      kind: "coverage-single",
      name: getAutoItemName(item),
      primaryItem: item,
      items: [item],
      occurrence: 1
    };
    const direct = freshTryDirectPlace(probeBlock, placed, baseSlots, {
      ...options,
      respectSoftLimits: false,
      respectUnavailable: true,
      respectAssignedRoom: true
    });
    if (direct.ok) {
      const added = placed.filter(e => e?.autoBlockKey === probeBlock.key);
      added.forEach(e => { e.autoEngine = "fresh-csp-r123-coverage-direct"; });
      return { mode: "coverage-direct", entries: added, blockKey: probeBlock.key };
    }

    // 그래도 막히면 기존 forcedSlotScore의 “최소 충돌 없는 슬롯”을 사용합니다.
    // 이 함수는 보호 슬롯, 동일 카드 중복, 교실 중복, 학급 중복은 끝까지 금지합니다.
    const slot = findLeastBadSlot(item, baseSlots, placed, options);
    if (!slot) return null;
    const entry = makeAutoEntry(item, slot, placed);
    if (!entry) return null;
    const fixed = normalizeTimetableEntry({
      ...entry,
      autoBlockKey: probeBlock.key,
      autoEngine: "fresh-csp-r123-coverage-fill",
      autoCoverageRepair: true,
      forced: true
    });
    placed.push(fixed);
    return { mode: "coverage-fill", entries: [fixed], blockKey: probeBlock.key, forced: true };
  }

  async function freshRepairCoverageShortages(validation = {}, context = {}) {
    const {
      placed = [], baseSlots = [], blockByCardId = new Map(), blockByKey = new Map(),
      options = {}, limits = {}, updateProgress = null
    } = context;
    const rows = [...(validation.cardCoverage?.shortRows || [])]
      .map(row => ({ ...row, shortage: Math.max(0, -Number(row.diff || 0)) }))
      .filter(row => row.id && row.shortage > 0)
      .sort((a, b) => {
        if (b.shortage !== a.shortage) return b.shortage - a.shortage;
        const ac = (blockByCardId.get(a.id) || []).length;
        const bc = (blockByCardId.get(b.id) || []).length;
        if (ac !== bc) return bc - ac;
        return String(a.title || a.id).localeCompare(String(b.title || b.id), "ko", { numeric: true });
      });

    const repairedBlocks = [];
    const forcedEntries = [];
    const repairedRows = [];
    let attempts = 0;
    const placedKeys = freshPlacedBlockKeys(placed);

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let i = 0; i < row.shortage; i++) {
        let done = false;
        const candidates = [...(blockByCardId.get(row.id) || [])]
          .filter(block => block?.key && !placedKeys.has(block.key));

        for (const block of candidates) {
          attempts += 1;
          const repairBudget = freshBudgetForPhase(options.runAttempts || "balanced", "repair");
          const result = freshPlaceWithDisplacement(block, placed, baseSlots, blockByKey, {
            ...options,
            respectSoftLimits: false,
            respectUnavailable: true,
            respectAssignedRoom: true
          }, {
            ...limits,
            maxBlockersPerMove: Math.max(Number(limits.maxBlockersPerMove || 0), 5),
            displacementSlotBudget: Math.min(baseSlots.length, Math.max(Number(limits.displacementSlotBudget || 0), 18))
          }, Math.min(Math.max(Number(limits.relaxedDepth || limits.depth || 0), 4), 6), new Set(), repairBudget);
          if (!result.ok) continue;
          placedKeys.add(block.key);
          repairedBlocks.push({ blockKey: block.key, cardId: row.id, mode: "coverage-block", displaced: result.displaced || 0 });
          repairedRows.push(row.id);
          done = true;
          break;
        }

        if (!done) {
          attempts += 1;
          const oneMoveBudget = freshBudgetForPhase(options.runAttempts || "balanced", "repair");
          const oneMove = freshTryOneMoveCoverageCard(row.id, placed, baseSlots, {
            ...options,
            respectSoftLimits: false,
            respectUnavailable: true,
            respectAssignedRoom: true
          }, oneMoveBudget);
          attempts += Number(oneMove?.attempts || 0);
          if (oneMove) {
            repairedBlocks.push({
              blockKey: oneMove.blockKey,
              cardId: row.id,
              mode: oneMove.mode || "coverage-onemove",
              movedBlockKey: oneMove.movedBlockKey || ""
            });
            repairedRows.push(row.id);
            done = true;
          }
        }

        if (!done) {
          attempts += 1;
          const single = freshTryPlaceSingleCoverageCard(row.id, placed, baseSlots, options);
          if (single) {
            if (single.forced) forcedEntries.push(...(single.entries || []));
            repairedRows.push(row.id);
            done = true;
          }
        }
      }

      if (updateProgress && (r % 4 === 0 || r === rows.length - 1)) {
        await updateProgress({
          percent: 86 + Math.round((r + 1) / Math.max(1, rows.length) * 8),
          step: "카드 시수 잔여 복구",
          detail: `검증에서 부족한 카드 시수를 block/1단계 이동으로 재삽입 중입니다. ${r + 1}/${rows.length}`,
          placed: placed.length,
          best: placed.length,
          failed: Math.max(0, rows.length - r - 1),
          currentCard: row.title || row.id
        }, true);
      }
    }

    return {
      attemptedRows: rows.length,
      attempts,
      repairedBlocks,
      repairedRows,
      forcedEntries,
      repairedCount: repairedRows.length
    };
  }

  async function runFreshAutoPlacementEngine(context = {}) {
    const {
      standalone = [], groupBlocks = [], protectedEntries = [], activeGrades = [], options = {}, updateProgress = null
    } = context;
    const baseSlots = freshBaseSlots();
    const strictOptions = {
      ...options,
      respectSoftLimits: true,
      respectUnavailable: true,
      respectAssignedRoom: true,
      engineProfile: autoEngineProfileForMode(options.runAttempts)
    };
    const relaxedOptions = {
      ...strictOptions,
      respectSoftLimits: false
    };
    const { kept: rawBlocks, skipped } = freshBuildBlocks(standalone, groupBlocks, protectedEntries);
    const cachedCandidateCounts = consumeExactSolverCandidateCache(standalone, groupBlocks, protectedEntries, options);
    const orderedBlocks = freshOrderBlocks(rawBlocks, baseSlots, strictOptions, cachedCandidateCounts);
    const blockByKey = new Map(orderedBlocks.map(block => [block.key, block]));
    const blockByCardId = new Map();
    orderedBlocks.forEach(block => freshBlockCardIds(block).forEach(id => freshAddBlockToCardIndex(blockByCardId, id, block)));
    freshSortCardBlockIndex(blockByCardId);

    const mode = String(options.runAttempts || "balanced");
    const limits = mode === "fast"
      ? { depth: 2, relaxedDepth: 2, maxBlockersPerMove: 3, displacementSlotBudget: 10 }
      : mode === "deep"
        ? { depth: 5, relaxedDepth: 6, maxBlockersPerMove: 7, displacementSlotBudget: 35 }
        : { depth: 4, relaxedDepth: 5, maxBlockersPerMove: 5, displacementSlotBudget: 24 };

    const placed = [];
    const failedBlocks = [];
    let displacedMoves = 0;
    let directPlaced = 0;
    let swapPlaced = 0;
    let searchTimedOut = 0;
    let lastYield = 0;
    const total = orderedBlocks.length;

    for (let i = 0; i < orderedBlocks.length; i++) {
      const block = orderedBlocks[i];
      const blockBudget = freshBudgetForPhase(mode, "strict");
      const result = freshPlaceWithDisplacement(block, placed, baseSlots, blockByKey, strictOptions, limits, limits.depth, new Set(), blockBudget);
      if (result.ok) {
        if (result.displaced) { swapPlaced += 1; displacedMoves += result.displaced; }
        else directPlaced += 1;
      } else {
        if (result.timedOut || blockBudget.timedOut) searchTimedOut += 1;
        failedBlocks.push(block);
      }
      if (updateProgress && (Date.now() - lastYield > 120 || i === orderedBlocks.length - 1)) {
        lastYield = Date.now();
        await updateProgress({
          percent: 8 + Math.round((i + 1) / Math.max(1, total) * 58),
          step: "새 자동배치 엔진",
          detail: `제약이 강한 수업부터 배치 중입니다. block ${i + 1}/${total}`,
          placed: protectedEntries.length + placed.length,
          best: protectedEntries.length + placed.length,
          failed: failedBlocks.length,
          currentCard: freshBlockName(block)
        });
      }
    }

    // 첫 패스 실패분은 소프트 제한을 완화하고 더 깊은 displacement로 재삽입합니다.
    const stillFailed = [];
    for (let i = 0; i < failedBlocks.length; i++) {
      const block = failedBlocks[i];
      const blockBudget = freshBudgetForPhase(mode, "relaxed");
      const result = freshPlaceWithDisplacement(block, placed, baseSlots, blockByKey, relaxedOptions, limits, limits.relaxedDepth, new Set(), blockBudget);
      if (result.ok) {
        swapPlaced += 1;
        displacedMoves += Math.max(1, Number(result.displaced || 0));
      } else {
        if (result.timedOut || blockBudget.timedOut) searchTimedOut += 1;
        stillFailed.push(block);
      }
      if (updateProgress && (i % 3 === 0 || i === failedBlocks.length - 1)) {
        await updateProgress({
          percent: 68 + Math.round((i + 1) / Math.max(1, failedBlocks.length || 1) * 18),
          step: "전역 교환 복구",
          detail: `미배치 block을 다른 block과 교환하며 복구 중입니다. ${i + 1}/${failedBlocks.length}`,
          placed: protectedEntries.length + placed.length,
          best: protectedEntries.length + placed.length,
          failed: stillFailed.length + Math.max(0, failedBlocks.length - i - 1),
          currentCard: freshBlockName(block)
        }, true);
      }
    }

    const failedItems = stillFailed.map(block => makeFailedPlacement(freshBlockName(block), block.primaryItem || block.items?.[0], {
      source: "freshEngineUnplacedBlock",
      blockKey: block.key,
      occurrence: block.occurrence || 1,
      groupId: block.groupId || ""
    })).filter(f => f.item);

    let validation = buildScheduleVerificationReport([...protectedEntries, ...placed], {
      scopeGrades: activeGrades,
      protectedEntries,
      failedNames: [...new Set(failedItems.map(f => f.name))],
      deriveFailedFromCardShortage: true
    });

    // r87: block 탐색 실패 후에도 검증기가 정확히 알려 주는 “카드 시수 부족”을
    // 다시 입력으로 삼아 재삽입합니다. r86은 여기서 보고만 하고 끝나서 MS국어/한국어처럼
    // 큰 동시수업 block이 통째로 누락되었습니다.
    const coverageRepair = await freshRepairCoverageShortages(validation, {
      placed,
      baseSlots,
      blockByCardId,
      blockByKey,
      options: relaxedOptions,
      limits,
      updateProgress
    });
    if (coverageRepair.repairedCount > 0) {
      validation = buildScheduleVerificationReport([...protectedEntries, ...placed], {
        scopeGrades: activeGrades,
        protectedEntries,
        failedNames: [...new Set(failedItems.map(f => f.name))],
        deriveFailedFromCardShortage: true
      });
    }

    const coverageFailures = freshCoverageFailureItemsFromValidation(validation, blockByCardId);
    const mergedFailed = coverageFailures.length ? coverageFailures : failedItems;

    return {
      placed,
      failedBlocks: stillFailed,
      failedItems: mergedFailed,
      rawFailedItems: failedItems,
      validation,
      baseSlots,
      skippedProtectedBlocks: skipped.length,
      coverageRepair,
      forcedEntries: coverageRepair.forcedEntries || [],
      stats: {
        engine: "fresh-csp-groupcard-r123",
        totalBlocks: orderedBlocks.length,
        directPlaced,
        swapPlaced,
        displacedMoves,
        searchTimedOut,
        skippedProtectedBlocks: skipped.length,
        failedBlockCount: stillFailed.length,
        coverageRepairCount: coverageRepair.repairedCount || 0,
        coverageRepairAttempts: coverageRepair.attempts || 0,
        coverageForcedCount: (coverageRepair.forcedEntries || []).length,
        baseSlotCount: baseSlots.length,
        precheckCandidateCacheReused: cachedCandidateCounts instanceof Map
      }
    };
  }

  async function autoAssignAll() {
    if (!canEdit()) return;
    if (autoAssignRunning) { alert("자동 배치가 이미 진행 중입니다."); return; }
    if (typeof preflightTimetableData === "function") {
      await preflightTimetableData();
    }

    const rawItems = buildSchedulableItems();
    let standalone = (rawItems.standalone || []).map(annotateRestrictedAutoItem);
    let groupBlocks = (rawItems.groupBlocks || []).map(annotateRestrictedGroupBlock);
    const availableGrades = getActiveGradesFromScheduleItems(standalone, groupBlocks);

    if (!availableGrades.length || (!standalone.length && !groupBlocks.length)) {
      alert("시간표 사전작업에서 생성된 과목 카드가 없습니다.\n먼저 시간표 사전작업에서 카드를 생성하거나, 로컬 모드 전환 시 온라인 데이터를 복사해 주세요.");
      return;
    }

    const options = await openAutoAssignOptionsDialog(availableGrades, AUTO_ASSIGN_DEFAULT_OPTIONS);
    if (!options) return;
    options.selectedGrades = normalizeAutoActiveGrades(options.selectedGrades);
    options.runAttempts = normalizeRunAttemptMode(options.runAttempts);
    options.scoringWeights = scoreOptionsFromAssignOptions(options);
    currentAllowAutoRoomAssignment = options.allowAutoRoomAssignment === true;
    const runMode = options.runAttempts;
    const isFastCheckRun = runMode === "fast";

    ({ standalone, groupBlocks } = filterAutoTargetsByGrades(standalone, groupBlocks, options.selectedGrades));
    const activeGrades = getActiveGradesFromScheduleItems(standalone, groupBlocks);
    const protectedEntries = computeProtectedEntries(entries(), options);
    const protectedSummary = protectedSlotSummary(protectedEntries);
    const willClearCount = Math.max(0, entries().length - protectedEntries.length);
    const groupTargetSlots = groupBlocks.reduce((sum, { group, unitItems }) => {
      const credits = (unitItems || []).map(u => Math.max(0, Number(u?.credits) || 0));
      const isConcurrent = group?.isConcurrent || group?.groupType === "concurrent";
      return sum + (isConcurrent ? Math.max(0, ...credits) : credits.reduce((a, b) => a + b, 0));
    }, 0);
    const autoTargetSlots = standalone.length + groupTargetSlots;

    if (!autoTargetSlots || !activeGrades.length) {
      alert("선택한 학년에 자동 배치할 과목 카드가 없습니다.");
      return;
    }

    const precheckReport = buildAutoAssignPrecheckReport({
      standalone,
      groupBlocks,
      activeGrades,
      availableGrades,
      options,
      protectedEntries
    });
    const precheckCounts = precheckReport.counts || {};
    const precheckHasIssues = (precheckCounts.error || 0) || (precheckCounts.warn || 0);
    const precheckMs = Number(precheckReport.performance?.totalMs || 0);
    addTimetableLog(
      precheckReport.blockingCount ? "error" : precheckHasIssues ? "warn" : "auto",
      "자동배치 사전 점검",
      `실행차단 ${precheckReport.blockingCount || 0}개 · 오류 ${precheckCounts.error || 0}개 · 주의 ${precheckCounts.warn || 0}개 · 진단 ${precheckMs < 1 ? "<1" : precheckMs.toFixed(0)}ms · 후보 계산은 solver에서 재사용`
    );
    if ((precheckReport.blockingCount || 0) > 0) {
      await openAutoAssignPrecheckDialog(precheckReport, { allowProceed: false });
      return;
    }
    if (!isFastCheckRun && precheckHasIssues) {
      const proceedAfterReview = await openAutoAssignPrecheckDialog(precheckReport, { allowProceed: true });
      if (!proceedAfterReview) return;
    }

    const modeText = options.placementMode === "keep" ? "현재 배치 유지 + 미배치만 배치" : "선택 범위 초기화 후 배치";
    const confirmText = [
      "새 자동배치 엔진으로 전체 배치를 시작합니다.",
      `대상: ${formatAutoActiveGrades(activeGrades)}`,
      `방식: ${modeText}`,
      options.placementMode === "reset" ? `초기화 대상 배치: ${willClearCount}개` : `보호되는 기존 배치: ${protectedEntries.length}개`,
      `고정/보호 슬롯: ${protectedSummary.slots}칸`,
      `탐색 모드: ${autoAssignModeLabel(runMode)}`,
      `점수 기준: ${describeScoreWeights(options.scoringWeights)}`,
      `교실 방식: ${options.allowAutoRoomAssignment ? "교실 없는 카드도 빈 교실 자동 배정" : "교사 교실/지정교실 없으면 배치하지 않음"}`,
      "",
      "기존 그리디 엔진 대신 block-CSP + 전역 교환 복구 엔진을 사용합니다.",
      "계속할까요?"
    ].join("\n");
    if (!confirm(confirmText)) return;

    autoAssignRunning = true;
    setAutoAssignBusy(true);
    await waitForBrowser();

    const autoStartedAt = Date.now();
    const rollbackEntriesSnapshot = cloneAutoAssignData(entries());
    const beforeAutoSnapshot = isFastCheckRun ? null : saveAutoAssignScheduleSnapshot("before", rollbackEntriesSnapshot, { activeGrades, modeText, options });
    let autoAssignPhase = "초기화";
    let autoAssignCancelled = false;
    const progress = createAutoAssignProgressDialog(autoTargetSlots, () => { autoAssignCancelled = true; });
    const updateProgress = async (data = {}, force = false) => {
      if (autoAssignCancelled || progress?.isCancelled?.()) throw new Error("__AUTO_ASSIGN_CANCELLED__");
      await progress.update({ total: autoTargetSlots, ...data });
      return true;
    };

    try {
      await updateProgress({
        percent: 2,
        step: "초기화",
        detail: "기존 배치와 보호 수업을 분리하고 새 엔진 입력 block을 구성합니다.",
        placed: 0,
        best: 0,
        failed: 0,
        currentCard: "-",
        log: `대상 학년: ${formatAutoActiveGrades(activeGrades)} · 엔진: fresh-csp-groupcard-r123`
      }, true);

      captureTimetableUndo("자동 배정");
      addTimetableLog("auto", "새 자동배치 엔진 시작", `대상 학년: ${formatAutoActiveGrades(activeGrades)} · ${modeText}`);
      const preValidation = buildScheduleVerificationReport(entries(), { scopeGrades: activeGrades });

      ttDomain().entries = [...protectedEntries];
      autoAssignPhase = "새 엔진 배치";
      await updateProgress({
        percent: 6,
        step: options.placementMode === "keep" ? "기존 배치 유지" : "보호 수업 유지",
        detail: options.placementMode === "keep"
          ? `기존 배치 ${protectedEntries.length}개를 보호하고 부족한 block만 추가합니다.`
          : `보호된 배치 ${protectedEntries.length}개를 유지하고 ${willClearCount}개 배치를 초기화했습니다.`,
        placed: protectedEntries.length,
        best: protectedEntries.length,
        failed: 0
      }, true);

      const engineResult = await runFreshAutoPlacementEngine({
        standalone,
        groupBlocks,
        protectedEntries,
        activeGrades,
        options,
        updateProgress
      });
      const placed = cloneAutoAssignData(engineResult.placed || []) || [];
      const forcedEntries = cloneAutoAssignData(engineResult.forcedEntries || []) || [];
      const failedItems = [...(engineResult.failedItems || [])];
      const failedNames = [...new Set(failedItems.map(f => f.name).filter(Boolean))];
      const allFinalEntries = hydrateAutoRoomsForEntries(normalizeSnapshotEntries([...protectedEntries, ...placed]));

      autoAssignPhase = "검증/확정";
      ttDomain().entries = allFinalEntries;
      recomputeConflicts();
      const conflictSummary = getConflictCounts();
      const finalValidation = buildScheduleVerificationReport(allFinalEntries, {
        scopeGrades: activeGrades,
        protectedEntries,
        failedNames,
        deriveFailedFromCardShortage: true
      });
      const finalMetrics = buildAutoRunMetricsFromValidation(finalValidation, {
        label: "새 엔진 최종 결과",
        placedCount: placed.length,
        failedCount: finalValidation.failedCount || failedNames.length,
        forcedCount: forcedEntries.length,
        qualityScore: scoreScheduleQuality(placed, options)
      });

      const missingRoomEntries = allFinalEntries.filter(entryHasMissingRoomForAuto);
      const missingRoomNames = missingRoomEntries.map(e => getAutoItemName(e));
      const failedDiagnostics = buildFailureDiagnostics(failedItems, engineResult.baseSlots || freshBaseSlots(), placed, {
        ...options,
        respectSoftLimits: false,
        respectUnavailable: true,
        respectAssignedRoom: true
      });
      const residualPuzzleReport = buildResidualPuzzleReport(failedItems, engineResult.baseSlots || freshBaseSlots(), placed, {
        ...options,
        respectSoftLimits: false,
        respectUnavailable: true,
        respectAssignedRoom: true
      });
      const outcomeAnalysis = summarizeAutoAssignOutcome({
        placedEntries: placed,
        failedItems,
        forcedEntries,
        protectedEntries,
        missingRoomEntries
      });
      const autoAssignIncomplete = !finalValidation.ok || failedNames.length > 0 || (finalValidation.cardCoverage?.shortCount || 0) > 0 || (finalValidation.classSlots?.issueCount || 0) > 0;
      const resultKind = autoAssignResultKind({ runMode, incomplete: autoAssignIncomplete });

      const report = {
        ts: Date.now(),
        activeGrades: activeGrades.slice(),
        selectedGrades: activeGrades.slice(),
        runAttempts: options.runAttempts,
        fastCheckRun: isFastCheckRun,
        placementMode: options.placementMode,
        placementModeLabel: modeText,
        totalTarget: autoTargetSlots,
        protectedCount: protectedEntries.length,
        protectedSlotCount: protectedSummary.slots,
        clearedCount: willClearCount,
        keepPinned: options.keepPinned !== false,
        keepManual: options.keepManual !== false,
        scoringProfile: options.scoringProfile || "balanced",
        scoringWeights: options.scoringWeights,
        scoringSummary: describeScoreWeights(options.scoringWeights),
                engineStats: engineResult.stats,
        placedCount: placed.length,
        forcedCount: forcedEntries.length,
        ok: !autoAssignIncomplete,
        resultStatus: resultKind.status,
        resultStatusLabel: resultKind.title,
        placementIncomplete: autoAssignIncomplete,
        programError: false,
        failedCount: failedNames.length,
        failedNames,
        failedDiagnostics,
        failedReasonSummary: failedDiagnostics.slice(0, 8).map(d => `${d.name}: ${d.summary}${d.suggestionSummary ? ` / 제안: ${d.suggestionSummary}` : ""}`),
        residualPuzzleReport,
        outcomeAnalysis,
        placedBlockCount: outcomeAnalysis.placedBlockCount,
        placedGroupBlockCount: outcomeAnalysis.placedGroupBlockCount,
        placedStandaloneBlockCount: outcomeAnalysis.placedStandaloneBlockCount,
        placedCardCount: outcomeAnalysis.placedCardCount,
        failedUnitCount: outcomeAnalysis.failedUnitCount,
        failedOccurrenceCount: outcomeAnalysis.failedOccurrenceCount,
        topFailedUnits: outcomeAnalysis.topFailedUnits,
        durationMs: Date.now() - autoStartedAt,
        conflictTotal: conflictSummary.totalAffected,
        conflictCounts: conflictSummary.counts,
        preValidation,
        postValidation: finalValidation,
        comparisonSummary: `${preValidation.summary || "이전 상태"} → ${finalValidation.summary || "결과 상태"}`,
        validationSummary: finalValidation.summary,
        validationOk: finalValidation.ok,
        metricSource: "postValidation",
        metricCompleteness: "complete",
        classSlotIssueCount: finalValidation.classSlots?.issueCount || 0,
        cardCoverageIssueCount: finalValidation.cardCoverage?.issueCount || 0,
        cardShortCount: finalValidation.cardCoverage?.shortCount || 0,
        cardOverCount: finalValidation.cardCoverage?.overCount || 0,
        cardShortageSlots: (finalValidation.cardCoverage?.shortRows || []).reduce((sum, row) => sum + Math.max(0, -Number(row.diff || 0)), 0),
        restrictedTeacherIssueCount: finalValidation.restrictedTeachers?.issueCount || 0,
        protectedIntrusionCount: finalValidation.protectedIntrusions?.total || 0,
        missingRoomCount: missingRoomEntries.length,
        missingRoomNames,
        beforeSnapshotName: beforeAutoSnapshot?.name || "",
        afterSnapshotName: "",
        finalMetrics,
        autoSourceSignature: buildCurrentAutoSourceSignature(),
        autoSourceSummary: currentAutoSourceSummary(),
        telemetryStatus: "fresh-csp-groupcard-r123",
        engine: "fresh-csp-groupcard-r123",
        appVersion: String(globalThis.HIS_APP_VERSION || ""),
        autoAssignBuild: String(globalThis.HIS_AUTOASSIGN_BUILD || ""),
        engineProfileLabel: "새 엔진: 그룹큰카드 우선 + 기본 교사교실 + 자동교실 옵션 r123",
        qualityGate: {
          worseThanBaseline: false,
          autoRollbackDisabled: true,
          reason: "새 엔진은 기준 보관본 품질게이트로 결과를 폐기하지 않고, 계산 결과와 검증 리포트를 그대로 표시합니다."
        },
        validatorVersion: "2026-07-15-room-availability-separation-r355"
      };

      let afterAutoSnapshot = null;
      if (!isFastCheckRun) {
        afterAutoSnapshot = saveAutoAssignScheduleSnapshot("result", entries(), report);
        report.afterSnapshotName = afterAutoSnapshot?.name || "";
      }
      if (appState.timetable) appState.timetable.autoAssignMeta = compactAutoAssignSnapshotMeta(report);
      attachCanonicalMetaToMatchingSnapshots(ttDomain(), report, entries());
      if (afterAutoSnapshot) {
        afterAutoSnapshot.autoAssignMeta = compactAutoAssignSnapshotMeta(report);
        afterAutoSnapshot.note = [
          "새 자동배치 엔진으로 생성된 배치 보관본입니다.",
          normalizeAutoActiveGrades(activeGrades).length ? `대상: ${formatAutoActiveGrades(activeGrades)}` : "",
          modeText ? `방식: ${modeText}` : "",
          report.validationSummary ? `검증: ${report.validationSummary}` : ""
        ].filter(Boolean).join(" / ");
        updateBestAutoAssignSnapshot(ttDomain(), afterAutoSnapshot);
        pruneAutoAssignSnapshots(ttDomain());
      }

      if (!isFastCheckRun) await persistTimetableNow();
      else addTimetableLog("auto", "빠른 점검 저장 생략", "빠른 점검 결과는 현재 화면과 메모리에만 반영하고 Firestore 저장은 생략했습니다.");
      setLastAutoAssignReport(report);
      renderAll();

      addTimetableLog(
        resultKind.logType,
        resultKind.logTitle,
        `새 엔진 완료 · block ${engineResult.stats.totalBlocks}개 중 실패 ${engineResult.stats.failedBlockCount}개 · 직접 ${engineResult.stats.directPlaced}개 · 교환복구 ${engineResult.stats.swapPlaced}개 · 잔여시수복구 ${engineResult.stats.coverageRepairCount || 0}건 · 이동 ${engineResult.stats.displacedMoves}회 · 미배치 ${failedNames.length}개 · 충돌 ${conflictSummary.totalAffected}건`
      );
      addTimetableLog(
        outcomeAnalysis.failedUnitCount ? "warn" : "auto",
        "자동배치 결과 분석",
        `수업 블록 ${outcomeAnalysis.placedBlockCount}개(그룹 ${outcomeAnalysis.placedGroupBlockCount}, 일반 ${outcomeAnalysis.placedStandaloneBlockCount}) · 배치 카드 ${outcomeAnalysis.placedCardCount}개 · 미배치 유닛 ${outcomeAnalysis.failedUnitCount}개 / ${outcomeAnalysis.failedOccurrenceCount}회차`
      );

      const detailLines = [
        `<b>엔진</b> 새 block-CSP + 전역 교환/잔여시수 복구 r87`,
        `<b>배치 block</b> ${engineResult.stats.totalBlocks - engineResult.stats.failedBlockCount}/${engineResult.stats.totalBlocks}`,
        `<b>직접 배치</b> ${engineResult.stats.directPlaced}개`,
        `<b>교환/이동 복구</b> ${engineResult.stats.swapPlaced}개 block · 이동 ${engineResult.stats.displacedMoves}회`,
        `<b>잔여시수 복구</b> ${engineResult.stats.coverageRepairCount || 0}건 · 보정 ${engineResult.stats.coverageForcedCount || 0}건`,
        `<b>보호된 기존 block</b> ${engineResult.stats.skippedProtectedBlocks}개`,
        `<b>신규 entry</b> ${placed.length}개`,
        `<b>미배치</b> ${failedNames.length}개`,
        `<b>교실 미배정</b> ${missingRoomEntries.length}개`,
        `<b>충돌 표시 대상</b> ${conflictSummary.totalAffected}건`,
        `<b>결과 판정</b> ${resultKind.status === "complete" ? "완료" : "배치 미완성 · 프로그램 오류 아님"}`,
        `<b>검증 결과</b> ${finalValidation.ok ? "통과" : finalValidation.summary}`,
        `<b>학급 시수</b> ${finalValidation.classSlots?.total ?? "-"}/${finalValidation.classSlots?.targetTotal ?? "-"}시수`,
        `<b>카드 시수 부족</b> ${report.cardShortageSlots}시수`,
        `<b>배치 방식</b> ${modeText}`,
        isFastCheckRun ? `<b>자동 보관</b> 빠른 점검 모드로 보관본 저장 생략` : `<b>자동 보관</b> 전: ${safeAutoHtml(beforeAutoSnapshot?.name || "-")} / 결과: ${safeAutoHtml(afterAutoSnapshot?.name || "-")}`,
        `<b>소요 시간</b> ${Math.round((Date.now() - autoStartedAt) / 1000)}초`,
        buildAutoAssignComparisonHtml(preValidation, finalValidation),
        buildAutoAssignOutcomeHtml(outcomeAnalysis)
      ];
      if (failedNames.length) {
        const failedList = failedNames.slice(0, 12)
          .map(name => `<li>${String(name).replace(/[<>&]/g, ch => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[ch]))}</li>`)
          .join("");
        const moreFailed = failedNames.length > 12 ? `<li>외 ${failedNames.length - 12}개</li>` : "";
        detailLines.push(`<div class="tt-auto-progress-failed"><b>남은 카드</b><ul>${failedList}${moreFailed}</ul></div>`);
        detailLines.push(diagnosticsToHtml(failedDiagnostics, 8));
      }
      detailLines.push(residualPuzzleReportToHtml(residualPuzzleReport, 6));
      if (missingRoomEntries.length) {
        const missingList = missingRoomNames.slice(0, 12)
          .map(name => `<li>${String(name).replace(/[<>&]/g, ch => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[ch]))}</li>`)
          .join("");
        const moreMissing = missingRoomNames.length > 12 ? `<li>외 ${missingRoomNames.length - 12}개</li>` : "";
        detailLines.push(`<div class="tt-auto-progress-failed"><b>교실 미배정</b><ul>${missingList}${moreMissing}</ul></div>`);
      }
      detailLines.push("자세한 결과는 하단 <b>로그</b> 탭에서 확인할 수 있습니다.");

      await progress.complete({
        partial: autoAssignIncomplete,
        title: resultKind.title,
        subtitle: resultKind.subtitle,
        step: resultKind.step,
        detailHtml: detailLines.filter(Boolean).map(line => `<div>${line}</div>`).join(""),
        placed: placed.length,
        best: placed.length,
        failed: failedNames.length,
        currentCard: "-",
        closeLabel: "결과 확인",
        actions: []
      });
    } catch (err) {
      const isCancel = err?.message === "__AUTO_ASSIGN_CANCELLED__";
      try { recomputeConflicts(); } catch (_) {}
      try { renderAll(); } catch (_) {}
      if (isCancel) {
        addTimetableLog("auto", "자동 배치 취소", "사용자 요청으로 새 자동배치를 중단했습니다. 현재 화면 상태를 유지합니다.");
        if (progress) await progress.cancel("자동배치를 중단했습니다. 현재 화면 상태를 유지합니다.");
      } else {
        console.error("Fresh auto assign failed:", err);
        const errorRecord = {
          ts: Date.now(),
          generatedAt: new Date().toISOString(),
          phase: String(autoAssignPhase || ""),
          message: err?.message || String(err),
          stackHead: String(err?.stack || "").split("\n").slice(0, 6).join("\n"),
          engine: "fresh-csp-groupcard-r123",
          appVersion: String(globalThis.HIS_APP_VERSION || "")
        };
        try {
          const domain = ttDomain?.();
          if (domain) domain.lastAutoAssignError = errorRecord;
          if (appState.timetable) {
            appState.timetable.lastAutoAssignError = errorRecord;
            appState.timetable.autoAssignMeta = compactAutoAssignSnapshotMeta({
              ...(appState.timetable.autoAssignMeta || {}),
              lastAutoAssignError: errorRecord,
              resultStatus: "program-error",
              resultStatusLabel: "자동배치 프로그램 오류",
              programError: true,
              engine: "fresh-csp-groupcard-r123"
            });
          }
        } catch (_) {}
        addTimetableLog("error", "새 자동배치 프로그램 오류", `${err?.message || String(err)} · 단계: ${autoAssignPhase || "?"}`);
        if (progress) await progress.error(`새 자동배치 엔진 오류가 발생했습니다. (${err?.message || String(err)}) 하단 [로그] 탭과 콘솔을 확인해 주세요.`);
        else alert("새 자동배치 엔진 오류가 발생했습니다. 로그를 확인해 주세요.");
      }
    } finally {
      currentAllowAutoRoomAssignment = false;
      autoAssignRunning = false;
      setAutoAssignBusy(false);
    }
  }


  autoAssignAll.openPrecheck = openAutoAssignPrecheckOnly;
  // r377: CP-SAT 결과도 일반 자동배치와 동일한 카드/그룹 source signature를 사용해야
  // 새로고침 후 bestAutoAssignSnapshot이 현재 데이터와 같은 결과로 인정됩니다.
  autoAssignAll.getCurrentSourceSignature = buildCurrentAutoSourceSignature;
  return autoAssignAll;
}
