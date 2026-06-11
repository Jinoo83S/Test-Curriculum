// ================================================================
// timetable-autoassign.js · Auto Assignment Engine
// ================================================================
// This module keeps the auto-placement algorithm separate from the
// timetable page renderer. Dependencies are injected from timetable.js
// so the engine can still use the current app state, UI callbacks, and
// shared occupancy logic without creating circular imports.

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
    getConflictCounts, recomputeConflicts, renderAll, $
  } = deps;

  const ttGroups = () => appState.timetable?.ttcardGroups || [];

  function withAutoSaveTimeout(promise, ms = 25000, label = "시간표 저장") {
    let timer = null;
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}이 ${Math.round(ms / 1000)}초 이상 지연되어 중단했습니다. 네트워크/저장공간을 확인해 주세요.`)), ms);
      })
    ]).finally(() => { if (timer) clearTimeout(timer); });
  }

  async function persistTimetableNow() {
    if (typeof saveNow === "function") {
      const ok = await withAutoSaveTimeout(saveNow("timetable", { force: true, throwOnError: true }), 25000, "시간표 저장");
      if (!ok) throw new Error("시간표 저장에 실패했습니다. 오래된 자동배치 보관본이 너무 많거나 저장공간/네트워크 문제가 있을 수 있습니다.");
      return true;
    }
    scheduleSave("timetable", { immediate: true, saveOptions: { force: true } });
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
    // r34: r31~r33 저장 압축 과정에서 top-level 수치가 0으로 남고 finalMetrics에만
    // 실제 수치가 보존되는 경우가 있었습니다. 0은 '증거 없음'일 수 있으므로 finalMetrics를 우선합니다.
    const metricNumber = (direct, final, fallback = 0) => {
      const f = Number(final);
      if (Number.isFinite(f)) return f;
      const d = Number(direct);
      if (Number.isFinite(d)) return d;
      return fallback;
    };
    const final = meta.finalMetrics || {};
    return {
      validationSummary: String(meta.validationSummary || final.validationSummary || ""),
      activeGrades: Array.isArray(meta.activeGrades) ? meta.activeGrades.slice() : [],
      modeText: String(meta.modeText || ""),
      options: clone(meta.options),
      classIssueCount: metricNumber(meta.classIssueCount ?? meta.classSlotIssueCount, final.classSlotIssueCount),
      classSlotIssueCount: metricNumber(meta.classSlotIssueCount ?? meta.classIssueCount, final.classSlotIssueCount),
      classShortCount: metricNumber(meta.classShortCount, final.classShortCount),
      classOverCount: metricNumber(meta.classOverCount, final.classOverCount),
      cardCoverageIssueCount: metricNumber(meta.cardCoverageIssueCount, final.cardCoverageIssueCount),
      groupCoverageIssueCount: metricNumber(meta.groupCoverageIssueCount, final.groupCoverageIssueCount),
      failedUnitCount: metricNumber(meta.failedUnitCount ?? meta.failedCount, final.failedCount),
      failedCount: metricNumber(meta.failedCount ?? meta.failedUnitCount, final.failedCount),
      cardShortageSlots: metricNumber(meta.cardShortageSlots, final.cardShortageSlots),
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
      metricSource: String(meta.metricSource || (hasFinalMetrics ? "finalMetrics" : "")),
      metricCompleteness,
      qualityBaselineSource: String(meta.qualityBaselineSource || ""),
      qualityBaselineSnapshotName: String(meta.qualityBaselineSnapshotName || ""),
      qualityBaselineValidationSummary: String(meta.qualityBaselineValidationSummary || ""),
      failedDiagnostics: Array.isArray(meta.failedDiagnostics) ? meta.failedDiagnostics.slice(0, 8).map(d => ({
        key: String(d?.key || d?.id || ""),
        name: String(d?.name || d?.title || ""),
        missing: Number(d?.missing || d?.shortage || d?.missingCount || 0) || 0,
        candidateCount: Number(d?.candidateCount || d?.availableCount || 0) || 0,
        reasonSummary: Array.isArray(d?.reasonSummary) ? d.reasonSummary.slice(0, 4) : [],
        suggestions: Array.isArray(d?.suggestions) ? d.suggestions.slice(0, 3).map(formatDiagnosticSuggestion).filter(Boolean) : []
      })) : [],
      residualPuzzleReport: compactResidualPuzzle(meta.residualPuzzleReport)
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
      autoAssignMeta: compactAutoAssignSnapshotMeta(version.autoAssignMeta || {}),
      entries: normalizeSnapshotEntries(version.entries || [])
    };
  }

  function bestSnapshotQualityScore(version = {}) {
    if (!version || !Array.isArray(version.entries) || !version.entries.length) return Infinity;
    return snapshotQualityScoreForPrune(version);
  }

  function updateBestAutoAssignSnapshot(domain, version = {}) {
    if (!domain || !version || !Array.isArray(version.entries) || !version.entries.length) return null;
    if (!hasCompleteAutoAssignMetricEvidence(version)) return compactBestAutoAssignSnapshot(domain.bestAutoAssignSnapshot || null);
    const candidate = compactBestAutoAssignSnapshot(version);
    if (!candidate) return null;
    const currentRaw = domain.bestAutoAssignSnapshot || null;
    const current = hasCompleteAutoAssignMetricEvidence(currentRaw) ? compactBestAutoAssignSnapshot(currentRaw) : null;
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
    if (domain.bestAutoAssignSnapshot && !hasCompleteAutoAssignMetricEvidence(domain.bestAutoAssignSnapshot)) {
      domain.bestAutoAssignSnapshot = null;
    }
    const savedBest = Array.isArray(domain.savedSchedules)
      ? domain.savedSchedules
          .filter(v => v && Array.isArray(v.entries) && v.entries.length)
          .filter(v => String(v.snapshotKind || "") === "result" || String(v.name || "").includes("자동배치 결과"))
          .filter(hasCompleteAutoAssignMetricEvidence)
          .sort((a, b) => bestSnapshotQualityScore(a) - bestSnapshotQualityScore(b))[0]
      : null;
    if (savedBest) updateBestAutoAssignSnapshot(domain, savedBest);
    if (domain.bestAutoAssignSnapshot && hasCompleteAutoAssignMetricEvidence(domain.bestAutoAssignSnapshot) && Array.isArray(domain.bestAutoAssignSnapshot.entries) && domain.bestAutoAssignSnapshot.entries.length) {
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

  function saveAutoAssignScheduleSnapshot(kind, sourceEntries = [], meta = {}) {
    const snapshotEntries = normalizeSnapshotEntries(sourceEntries);
    if (!snapshotEntries.length) return null;

    const domain = ttDomain();
    if (!Array.isArray(domain.savedSchedules)) domain.savedSchedules = [];

    const now = new Date();
    const modeLabel = meta.modeText || (meta.options?.placementMode === "keep" ? "현재 배치 유지" : "초기화 후 배치");
    const grades = (meta.activeGrades || []).map(g => typeof gradeDisplay === "function" ? gradeDisplay(g) : g).filter(Boolean).join(", ");
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
      autoAssignMeta: compactAutoAssignSnapshotMeta(meta || {}),
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
  const getTeacherNamesFromCards = cards => [...new Set((cards || []).flatMap(card => [
    ...(Array.isArray(card?.teachers) ? card.teachers : []),
    ...splitTeacherNames(card?.teacherName || "")
  ]).map(t => String(t || "").trim()).filter(Boolean))];
  const getTeachersForAutoItem = item => {
    const names = [
      ...(Array.isArray(item?.teachers) ? item.teachers : []),
      ...splitTeacherNames(item?.teacherName || item?.teachers || ""),
      ...getTeacherNamesFromCards(item?.ttcards || [])
    ];
    return [...new Set(names.map(t => String(t || "").trim()).filter(Boolean))];
  };
  const getRestrictedTeachersForAutoItem = item => getTeachersForAutoItem(item).filter(isRestrictedTeacher);

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
    return {
      ...item,
      hasRestrictedTeacher: restrictedTeachers.length > 0,
      restrictedTeachers,
      excludedGroupIds: excludedGroups.map(group => group.id).filter(Boolean),
      excludedGroupNames: excludedGroups.map(group => group.name || group.groupName || group.label || group.id).filter(Boolean),
      isExcludedGroupFollowup: excludedGroupPriority > 0,
      excludedGroupPriority,
      // 0은 핵심 동시배정 그룹, 1은 그룹 후속 필수카드/제약근무 교사, 2는 일반 자동배치 대상입니다.
      priorityTier: excludedGroupPriority > 0 ? 1 : (restrictedTeachers.length > 0 ? 1 : 2)
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
    // 특히 HS국어는 10A/11A/12A와 여러 교사가 얽혀 있어, 제약교사 일반카드보다 뒤로 밀리면 거의 항상 실패합니다.
    if (/HS\s*국어|고등\s*국어/i.test(text)) return 0;
    if (/MS\s*국어|중등\s*국어/i.test(text)) return 1;
    if (/국어|한국어|Korean/i.test(text) && classCount >= 3) return 2;
    if (/선택/.test(text) && classCount >= 2) return 3;
    if (/채플|CA|SA|자율|동아리|Chapel|Club/i.test(text)) return 4;
    if (cards.length >= 4 || classCount >= 4 || teacherCount >= 4) return 5;
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
      ...(Array.isArray(entry.teachers) ? entry.teachers : [])
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

  function roomConflictsInSlot(candidate = {}, slot = {}, placed = []) {
    const roomId = candidate.roomId;
    if (!roomId) return false;
    const slotEntries = [...entries(), ...placed].filter(e => e.day === slot.day && e.period === slot.period);
    return slotEntries.some(e => e.roomId === roomId && !sameUnitPlacement(candidate, e));
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
    const roomId = candidate.roomId;
    if (!roomId) return false;
    return isRoomUnavailable(roomId, slot.day, slot.period);
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
    return [...new Set([
      ...splitTeacherNames(x.teacherName || ""),
      ...(Array.isArray(x.teachers) ? x.teachers : []),
      ...getTeacherNamesFromCards((ttCardIdsFromPlacement(x) || []).map(id => getTtCardById(id)).filter(Boolean))
    ].map(t => String(t || "").trim()).filter(Boolean))];
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

      const fixedRoomIds = new Set([fixed.roomId, ...(fixed.roomIds || [])].filter(Boolean));
      if (candidateRoomData.roomId && fixedRoomIds.has(candidateRoomData.roomId)) {
        const roomName = (appState.rooms?.rooms || []).find(r => r.id === candidateRoomData.roomId)?.name || candidateRoomData.roomId;
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
    const scope = new Set((scopeGrades || []).map(g => String(g || "").trim()).filter(Boolean));
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
    const scope = new Set((scopeGrades || []).map(g => String(g || "").trim()).filter(Boolean));
    return (ttDomain().ttcards || [])
      .filter(card => card && card.id)
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

    (standalone || []).forEach(item => addAuto(classKeysForCapacity(item), 1, getAutoItemName(item), item));

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
    const failedCount = Array.isArray(options.failedNames) ? options.failedNames.length : 0;
    const missingRooms = (allEntries || []).filter(e => !e.roomId && String(e.roomRule || "auto").trim() !== "none");
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
      failedNames: options.failedNames || [],
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
      block.missingRoom = block.missingRoom || (!entry.roomId && String(entry.roomRule || "auto").trim() !== "none");
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
    // 교실 후보 정렬에서도 학생 수 기반 보정보다 교사 담당교실/홈룸/고정교실 규칙을 우선합니다.
    return 0;
  }

  function sortRoomCandidatesFor(data = {}) {
    const size = getAudienceSizeForRoom(data);
    return [...(appState.rooms?.rooms || [])]
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

  function applyAutoRoomToEntryData(data = {}, slot = data, placed = []) {
    const entryData = applyDefaultRoomToEntryData({ ...data });
    const rule = String(entryData.roomRule || "auto").trim();

    if (rule === "none") return { ...entryData, roomId: null };

    // 고정 교실은 사용자가 지정한 값 그대로 유지합니다.
    if (entryData.roomPinned || rule === "fixed") return entryData;

    // 기본 추천 교실이 있고 해당 시간에 비어 있으며 사용 가능 시간이면 그대로 사용합니다.
    if (entryData.roomId && !roomUnavailableInSlot(entryData, slot) && !roomConflictsInSlot(entryData, slot, placed)) return entryData;

    // 기본 추천 교실이 없거나 이미 사용 중이면, 해당 시간에 비어 있는 교실을 자동 보조 배정합니다.
    for (const room of sortRoomCandidatesFor(entryData)) {
      if (!room.id || room.id === entryData.roomId) continue;
      const test = { ...entryData, roomId: room.id };
      if (!roomUnavailableInSlot(test, slot) && !roomConflictsInSlot(test, slot, placed)) return test;
    }
    return entryData;
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

    for (const e of slotEnts) {
      const et = splitTeacherNames(e.teacherName || "").filter(Boolean);
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

    const candidateRoomData = applyAutoRoomToEntryData({ ...item, ...slot }, slot, placed);
    if (respectAssignedRoom && roomUnavailableInSlot(candidateRoomData, slot)) {
      const roomName = getRoomByIdLocal(candidateRoomData.roomId)?.name || candidateRoomData.roomId || "교실";
      addReason(reasons, "roomUnavailable", "교실 불가시간", `${formatSlotLabel(slot)} · ${roomName}`);
    }
    if (respectAssignedRoom && roomConflictsInSlot(candidateRoomData, slot, placed)) {
      const roomName = (appState.rooms?.rooms || []).find(r => r.id === candidateRoomData.roomId)?.name || candidateRoomData.roomId || "교실";
      addReason(reasons, "roomConflict", "교실 시간 충돌", `${formatSlotLabel(slot)} · ${roomName}`);
    }

    for (const teacher of teachers) {
      const roomId = getEffectiveAssignedRoomId(teacher);
      if (respectAssignedRoom && roomId) {
        const roomBusy = existing.some(e => e.day === slot.day && e.period === slot.period && e.roomId === roomId && !sameUnitPlacement(item, e));
        if (roomBusy && candidateRoomData.roomId === roomId) {
          const roomName = (appState.rooms?.rooms || []).find(r => r.id === roomId)?.name || roomId;
          addReason(reasons, "teacherRoomBusy", "교사 담당교실 사용 중", `${formatSlotLabel(slot)} · ${teacher} / ${roomName}`);
        }
      }
    }

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
        codes: ['roomConflict', 'teacherRoomBusy'],
        title: '교실 조건 완화',
        detail: '고정 교실을 해제하거나 대체 교실을 추가하면 배치 가능한 시간이 늘어날 수 있습니다.',
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
      schemaVersion: "2026-06-11-residual-puzzle-report-r37",
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
    return `<div class="tt-auto-progress-failed"><b>r36 잔여 퍼즐 진단</b><ul>${rows}${report.rows.length > limit ? `<li>외 ${report.rows.length - limit}개</li>` : ""}</ul></div>`;
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

  function checkPlacementValid(item, slot, placed, options = {}) {
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
      const et = splitTeacherNames(e.teacherName).filter(Boolean);
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
    const candidateRoomData = applyAutoRoomToEntryData({ ...item, ...slot }, slot, placed);
    if (respectAssignedRoom && roomUnavailableInSlot(candidateRoomData, slot)) return false;
    if (respectAssignedRoom && roomConflictsInSlot(candidateRoomData, slot, placed)) return false;

    // 7. 교사 담당교실 기준 추가 방어 검사입니다.
    for (const teacher of teachers) {
      const roomId = getEffectiveAssignedRoomId(teacher);
      if (respectAssignedRoom && roomId) {
        const roomBusy = existing.some(e => {
          if (!(e.day===slot.day && e.period===slot.period && e.roomId===roomId)) return false;
          return !sameUnitPlacement(item, e);
        });
        if (roomBusy && candidateRoomData.roomId === roomId) return false;
      }
    }
    return true;
  }
  function autoItemKey(item) {
    if (item.ttcardId) return `ttc:${item.ttcardId}`;
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
    const teacherCount = splitTeacherNames(item.teacherName).filter(Boolean).length;
    return teacherCount * 20 + audience.classKeys.size * 8;
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

    return exclusionPenalty + slotEnts.length * 100 + teacherLoad * 8 + teacherLimitLoad + classLoad * 10 + preferencePenalty + samePeriodLoad * 0.15 + Math.random();
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
    return score + Math.random();
  }

  function orderedFastSlots(baseSlots = []) {
    // 35칸 전체 점수 계산을 피하고, 같은 교시를 요일별로 먼저 훑어
    // 학급 주간 빈칸을 빠르게 채웁니다.
    return [...baseSlots].sort((a, b) => (a.period - b.period) || (a.day - b.day));
  }

  function selectCandidateWithExploration(candidates = [], checkOptions = {}) {
    if (!candidates.length) return null;
    const sorted = [...candidates].sort((a, b) => a.score - b.score);
    const randomness = Math.max(0, Number(checkOptions.slotRandomness || 0));
    const topCandidateCount = Math.max(1, Math.min(12, Number(checkOptions.topCandidateCount || 1)));
    if (!randomness || topCandidateCount <= 1) return sorted[0];

    const bestScore = sorted[0].score;
    const tolerance = Math.max(4, randomness * 14);
    const pool = sorted
      .filter(c => c.score <= bestScore + tolerance)
      .slice(0, topCandidateCount);
    if (pool.length <= 1) return sorted[0];

    // 좋은 후보를 더 자주 고르되, 같은 점수대의 다른 후보도 일부 시도합니다.
    const index = Math.min(pool.length - 1, Math.floor(Math.pow(Math.random(), 1.8) * pool.length));
    return pool[index] || pool[0];
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
        candidates.push({ slot, score: scoreFn(item, slot, placed, checkOptions) });
      }
    }
    return selectCandidateWithExploration(candidates, checkOptions)?.slot || null;
  }

  function makeAutoEntry(item, slot, placed = []) {
    if (!item || !slot) return null;
    return normalizeTimetableEntry({
      id: uid("ent"),
      ...applyAutoRoomToEntryData({ ...item, ...slot }, slot, placed)
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

  function forcedSlotScore(item, slot, placed = [], options = {}) {
    // 마지막 보정 단계용 점수입니다.
    // 원칙적으로 충돌 없는 슬롯을 찾고, 불가피할 때만 최소 충돌 슬롯에 배치합니다.
    // 단, 고정/보호 슬롯 침범과 동일 카드 동일 시간 중복은 끝까지 막습니다.
    if (strongProtectedSlotConflict(item, slot, placed)) return Infinity;
    if (exactDuplicateInSlot(item, slot, placed)) return Infinity;

    const existing = [...entries(), ...placed];
    const slotEnts = existing.filter(e => e.day === slot.day && e.period === slot.period);
    if (slotEnts.some(e => hasAutoGroupExclusionSlotConflict(item, e))) return Infinity;
    if (hasInternalCompoundSiblingConflict(item)) return Infinity;
    if (slotEnts.some(e => hasCompoundSiblingConflict(item, e))) return Infinity;
    const dayEnts = existing.filter(e => e.day === slot.day);
    const teachers = splitTeacherNames(item.teacherName).filter(Boolean);
    const itemAudience = audienceForPlacement(item);

    // 마지막 보정 단계에서도 교실 중복은 허용하지 않습니다.
    const candidateRoomData = applyAutoRoomToEntryData({ ...item, ...slot }, slot, placed);
    if (roomUnavailableInSlot(candidateRoomData, slot)) return Infinity;
    if (roomConflictsInSlot(candidateRoomData, slot, placed)) return Infinity;

    const weights = normalizeScoreWeights(options.scoringWeights);
    let score = slotEnts.length * 10 + existing.filter(e => e.period === slot.period).length * 0.25;

    for (const e of slotEnts) {
      const sameUnit = item.unitId && e.unitId && item.unitId === e.unitId;
      if (sameUnit) continue;

      const sameGrp = sameActiveGroup(item, e);
      const conc = sameGrp && isConcurrentItem(item) && isConcurrentItem(e);

      const et = splitTeacherNames(e.teacherName).filter(Boolean);
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

      const roomId = getEffectiveAssignedRoomId(teacher);
      if (roomId) {
        const roomBusy = slotEnts.some(e => {
          if (e.roomId !== roomId) return false;
          return !sameUnitPlacement(item, e);
        });
        if (roomBusy && candidateRoomData.roomId === roomId) return Infinity;
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

    return score + Math.random();
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
    return [...new Set([
      ...splitTeacherNames(entry.teacherName || ""),
      ...(Array.isArray(entry.teachers) ? entry.teachers : [])
    ].map(t => String(t || "").trim()).filter(Boolean))];
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
    const all = [...entries(), ...(movable || [])];
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
      respectAssignedRoom: moveOptions.respectAssignedRoom !== false
    };
    for (const original of block.entries) {
      const candidateData = { ...original, day: slot.day, period: slot.period };
      if (!checkPlacementValid(candidateData, slot, [...placedWithoutBlock, ...moved], checkOptions)) return null;
      const normalized = normalizeTimetableEntry({
        ...original,
        ...applyAutoRoomToEntryData(candidateData, slot, [...placedWithoutBlock, ...moved]),
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
    const teachers = new Set(splitTeacherNames(item.teacherName || '').filter(Boolean));
    const itemAudience = audienceForPlacement(item);
    const candidateRoomData = applyAutoRoomToEntryData({ ...item, ...slot }, slot, placed);
    const blockedKeys = new Set();

    slotEnts.forEach((e, index) => {
      if (sameUnitPlacement(item, e)) return;
      const sameGrp = sameActiveGroup(item, e);
      const conc = sameGrp && isConcurrentItem(item) && isConcurrentItem(e);
      if (conc) return;

      const eTeachers = splitTeacherNames(e.teacherName || '').filter(Boolean);
      const teacherHit = eTeachers.some(t => teachers.has(t));
      const classHit = audiencesConflict(itemAudience, audienceForPlacement(e));
      const roomHit = !!(candidateRoomData.roomId && e.roomId && candidateRoomData.roomId === e.roomId);
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

    const search = (idx, movedEntries) => {
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
    return best ? { ...best, attempts } : { attempts };
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
    const maxRepairAttempts = options.runAttempts === 'deep' ? 240000 : (options.runAttempts === 'fast' ? 3600 : 18000);
    let attempts = 0;

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
      for (const targetSlot of targetSlots) {
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
            maxMoveSlotsPerBlock: maxMultiMoveSlotsPerBlock
          });
          attempts += Number(multi?.attempts || 0);
          if (multi?.entries?.length) {
            current.length = 0;
            current.push(...multi.entries);
            repaired.push({ ...failedItem, repairMode: 'multi-move', movedBlocks: multi.movedBlockKeys || [] });
            done = true;
          }
        }

        if (progressUpdater && attempts && attempts % 60 === 0) {
          await progressUpdater({
            percent: 83,
            step: '미배치 복구 탐색',
            detail: `기존 수업 1개 이동으로 미배치 수업을 넣을 수 있는지 확인 중입니다. 복구 ${repaired.length}건`,
            placed: current.length,
            failed: Math.max(0, failedItems.length - repaired.length),
            currentCard: failedItem.name || getAutoItemName(item)
          });
        }
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

  function placeAutoGroupSlot(group, activeItems, slot, placed, checkOptions = {}) {
    // 한 그룹 안에 pool 카드와 unit 카드가 함께 있을 수 있습니다.
    // 기존 로직은 activeItems[0]만 저장해, 여러 unitItems 구조가 들어오면 같은 회차의 일부 카드가 누락될 수 있었습니다.
    // 현재 회차에 활성화된 모든 카드를 합친 뒤, 같은 수업 묶음(unit)은 하나로 유지하고
    // 나머지 병렬 과목은 과목별 entry로 분리해 각각 담당교실/홈룸을 배정합니다.
    const activeList = (activeItems || []).filter(Boolean);
    if (!activeList.length) return false;

    const seenCardIds = new Set();
    const activeCards = [];
    activeList.forEach(item => {
      (item.ttcards || []).forEach(card => {
        if (!card?.id || seenCardIds.has(card.id)) return;
        seenCardIds.add(card.id);
        activeCards.push(card);
      });
    });
    if (!activeCards.length) return false;

    const batches = getGroupRoomBatches(group, activeCards);
    const pending = [];
    for (const cards of batches.length ? batches : [activeCards]) {
      const batchIds = new Set((cards || []).map(c => c.id).filter(Boolean));
      const unit = (group?.units || []).find(u => {
        const ids = new Set(u.ttcardIds || []);
        return batchIds.size && [...batchIds].every(id => ids.has(id));
      }) || null;
      const sourceItem = activeList.find(item => (item.ttcards || []).some(c => batchIds.has(c.id))) || activeList[0];
      const item = makePlacementFromGroupItem(group, { ...sourceItem, unit, ttcards: cards });
      if (!item) continue;
      const checkedItem = annotateRestrictedAutoItem(item);
      // probe 검사를 통과했더라도 실제 저장 entry가 과목별로 분리되면서
      // 고정 수업/교실/교사 충돌이 생길 수 있으므로, 저장 직전에 한 번 더 검사합니다.
      if (!checkPlacementValid(checkedItem, slot, [...placed, ...pending], checkOptions)) return false;
      pending.push(normalizeTimetableEntry({
        id: uid("ent"),
        ...applyAutoRoomToEntryData({ ...checkedItem, ...slot }, slot, [...placed, ...pending])
      }));
    }
    if (!pending.length) return false;
    placed.push(...pending);
    return true;
  }

  const waitForBrowser = () => new Promise(resolve => setTimeout(resolve, 0));
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
      const actions = overlay.querySelector(".tt-auto-progress-actions");
      if (actions) actions.style.cssText = "display:flex;justify-content:flex-end;gap:8px;margin:16px 24px 22px;";
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
        actions?.querySelectorAll?.('[data-auto-extra-action="1"]')?.forEach(btn => btn.remove());
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
          actions?.insertBefore(btn, closeBtn);
        });
        closeBtn.textContent = data.closeLabel || "닫기";
        closeBtn.disabled = false;
        (extraActions[0] ? actions?.querySelector('[data-auto-extra-action="1"]') : closeBtn)?.focus?.();
        await waitForBrowser();
      },
      async cancel(message = "사용자 요청으로 자동배치를 취소했습니다.") {
        overlay.classList.add("is-cancelled");
        cancelBtn.disabled = true;
        cancelBtn.style.display = "none";
        badgeEl.textContent = "CANCELLED";
        titleEl.textContent = "자동배치 취소됨";
        subtitleEl.textContent = "시간표에는 변경 사항을 반영하지 않았습니다.";
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
        titleEl.textContent = "자동배치 오류";
        subtitleEl.textContent = "진행 중 오류가 발생했습니다.";
        stepEl.textContent = "오류";
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
    runAttempts: "balanced",    // fast | balanced | deep
    scoringProfile: "balanced",
    scoringWeights: { ...DEFAULT_SCORE_WEIGHTS }
  };

  function gradeSetFromList(list = []) {
    const set = new Set((list || []).filter(g => GRADE_KEYS.includes(g)));
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
        qualityClassCheck: false
      };
    }
    if (value === "deep") {
      return {
        mode: "deep",
        label: "정교한 안정 엔진",
        // r23: 브라우저 프리징의 원인이 된 전수 MRV/전체 통계 점수 계산은 초기 배치에서 끕니다.
        // 핵심 그룹 우선순위 + 여러 초기 후보 + 복구 단계로 품질을 확보하고, UI 응답성을 우선 보장합니다.
        useCandidateCountSort: false,
        useLiveMrv: false,
        slotScoring: "light",
        enableSwapRepair: true,
        enableFinalRepair: true,
        finalRepairLimit: Infinity,
        postProcessLimit: 180,
        postProcessPasses: 2,
        qualityClassCheck: true
      };
    }
    return {
      mode: "balanced",
      label: "균형 경량 엔진",
      useCandidateCountSort: false,
      useLiveMrv: false,
      slotScoring: "light",
      enableSwapRepair: true,
      enableFinalRepair: true,
      finalRepairLimit: 24,
      postProcessLimit: 40,
      postProcessPasses: 1,
      qualityClassCheck: true
    };
  }

  function attemptsForMode(mode) {
    const value = normalizeRunAttemptMode(mode);
    // r19: 빠른/균형 모드는 운영 중 바로 테스트할 수 있도록 초기 후보 수를 크게 줄입니다.
    // 정교한 배치에서만 기존의 넓은 탐색을 유지합니다.
    if (value === "fast") return [1, 1, 0];
    // r23: 60+40+18회는 브라우저 단일 스레드에서 실제 운영 데이터 기준으로 과합니다.
    // 정교한 모드는 1차 후보를 19회로 제한하고, 남은 품질은 복구/후처리에서 보정합니다.
    if (value === "deep") return [10, 6, 3];
    return [3, 2, 1];
  }

  function explorationOptionsForAttempt(mode, attempt = 0, stageIndex = 0) {
    const value = normalizeRunAttemptMode(mode);
    if (value === "fast") return { slotRandomness: 0, topCandidateCount: 1 };
    if (value === "balanced") {
      if (attempt === 0) return { slotRandomness: 0, topCandidateCount: 1 };
      return { slotRandomness: Math.min(3, 1 + stageIndex), topCandidateCount: 3 };
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
      failedNames
    });
    return {
      report,
      metrics: buildAutoRunMetricsFromValidation(report, {
        label: context.label || '',
        placedCount: context.placedCount,
        failedCount: failedNames.length,
        forcedCount: context.forcedCount,
        qualityScore: context.qualityScore
      }),
      failedNames
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
      const snapshotEntries = normalizeSnapshotEntries(version.entries || []);
      if (!snapshotEntries.length) return;
      const meta = version.autoAssignMeta || {};
      const failedNames = Array.isArray(meta.failedNames) ? meta.failedNames : [];
      const validation = buildScheduleVerificationReport(snapshotEntries, {
        scopeGrades: activeGrades,
        failedNames,
        failedDiagnostics: Array.isArray(meta.failedDiagnostics) ? meta.failedDiagnostics : []
      });
      const metrics = buildAutoRunMetricsFromValidation(validation, {
        label: version.name || `저장된 자동배치 ${index + 1}`,
        placedCount: Number(version.entryCount || snapshotEntries.length),
        failedCount: failedNames.length || Number(meta.failedCount || meta.finalMetrics?.failedCount || 0),
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
              <h4>배치 강도</h4>
              <select id="ttAutoRunAttempts" class="tt-auto-select">
                <option value="fast" ${defaults.runAttempts === "fast" ? "selected" : ""}>빠른 배치</option>
                <option value="balanced" ${defaults.runAttempts !== "fast" && defaults.runAttempts !== "deep" ? "selected" : ""}>균형 배치</option>
                <option value="deep" ${defaults.runAttempts === "deep" ? "selected" : ""}>정교한 배치</option>
              </select>
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
    const groupSlots = groupBlocks.reduce((sum, { group, unitItems }) => {
      const credits = (unitItems || []).map(u => Math.max(0, Number(u?.credits) || 0));
      const isConcurrent = group?.isConcurrent || group?.groupType === "concurrent";
      return sum + (isConcurrent ? Math.max(0, ...credits) : credits.reduce((a, b) => a + b, 0));
    }, 0);
    return { standaloneSlots: standalone.length, groupSlots, totalSlots: standalone.length + groupSlots };
  }

  function buildRestrictedTeacherTargetsForPrecheck(standalone = [], groupBlocks = []) {
    const map = new Map();
    const add = (teacher, count, sample) => {
      if (!teacher || !isRestrictedTeacher(teacher)) return;
      if (!map.has(teacher)) map.set(teacher, { teacher, target: 0, samples: [] });
      const row = map.get(teacher);
      row.target += count;
      if (sample && row.samples.length < 5) row.samples.push(sample);
    };

    standalone.forEach(item => {
      const name = getAutoItemName(item);
      getTeachersForAutoItem(item).forEach(t => add(t, 1, name));
    });

    groupBlocks.forEach(block => {
      const { group, unitItems } = block || {};
      const credits = (unitItems || []).map(u => Math.max(0, Number(u?.credits) || 0));
      const isConcurrent = group?.isConcurrent || group?.groupType === "concurrent";
      const groupSlotCount = Math.max(1, isConcurrent ? Math.max(0, ...credits) : credits.reduce((a, b) => a + b, 0));
      const sample = group?.name || group?.groupName || "그룹 수업";
      getTeachersForAutoItem(block).forEach(t => add(t, groupSlotCount, sample));
      (unitItems || []).forEach(unit => getTeachersForAutoItem(unit).forEach(t => add(t, Math.max(1, Number(unit?.credits) || 1), sample)));
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
    const set = new Set((activeGrades || []).filter(Boolean));
    if (!set.size) return cards;
    return (cards || []).filter(card => set.has(card.gradeKey) || (card.gradeKeys || []).some(g => set.has(g)));
  }

  function buildAutoAssignPrecheckReport(context = {}) {
    const {
      standalone = [],
      groupBlocks = [],
      activeGrades = [],
      options = {},
      protectedEntries = [],
      availableGrades = [],
    } = context;
    const report = {
      version: 1,
      mode: "his-autoassign-precheck",
      createdAt: new Date().toISOString(),
      scopeGrades: activeGrades,
      counts: { ok: 0, warn: 0, error: 0, info: 0 },
      items: []
    };

    const cards = ttDomain().ttcards || [];
    const groups = ttGroups();
    const existingEntries = entries();
    const activeCards = getActiveCardsForGrades(cards, activeGrades.length ? activeGrades : availableGrades);
    const cardIds = new Set(cards.map(c => c.id).filter(Boolean));
    const placedCardIds = getPlacedCardIdsForPrecheck(existingEntries);
    const targetSummary = summarizeAutoTargetsForPrecheck(standalone, groupBlocks);
    const protectedSummary = protectedSlotSummary(protectedEntries);

    addPrecheckItem(report, "대상 요약", cards.length ? "ok" : "error", "시간표 카드", `${cards.length}개 · 선택 학년: ${(activeGrades.length ? activeGrades : availableGrades).map(gradeDisplay).join(", ") || "없음"}`);
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

    const manualCards = activeCards.filter(c => c.isManual || String(c.id || "").startsWith("ttc_manual"));
    const placedManualCards = manualCards.filter(c => placedCardIds.has(c.id));
    addPrecheckItem(report, "수동 카드", manualCards.length ? "info" : "ok", "수동 카드 보존", manualCards.length ? `수동 카드 ${manualCards.length}개 · 현재 배치 ${placedManualCards.length}개 · 보호 ${options.keepManual !== false ? "ON" : "OFF"}` : "수동 카드 없음");
    if (manualCards.length && options.keepManual === false) {
      addPrecheckItem(report, "수동 카드", "warn", "수동 카드 보호 꺼짐", "자동배치 초기화 범위에 배치된 수동 카드가 포함될 수 있습니다.");
    }

    const fixedRoomNoRoom = activeCards.filter(card => String(card.roomRule || "").trim() === "fixed" && !card.roomId && !card.fixedRoomId);
    const anyNoRoom = activeCards.filter(card => String(card.roomRule || "auto").trim() !== "none" && !card.roomId && !card.fixedRoomId);
    addPrecheckItem(report, "교실 점검", fixedRoomNoRoom.length ? "error" : "ok", "고정 교실 규칙 미지정", fixedRoomNoRoom.length ? `${fixedRoomNoRoom.length}개 카드가 고정 교실 규칙이지만 교실이 없습니다.` : "없음");
    addPrecheckItem(report, "교실 점검", anyNoRoom.length ? "info" : "ok", "교실 자동 배정 대상", anyNoRoom.length ? `${anyNoRoom.length}개 카드는 담당교실/홈룸/일반교실 자동 배정 대상입니다.` : "모든 카드에 교실 또는 제외 규칙 있음");

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

    report.overall = report.counts.error ? "error" : report.counts.warn ? "warn" : "ok";
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
        .tt-precheck-summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;padding:16px 22px 0;}
        .tt-precheck-card{border:1px solid #e2e8f0;border-radius:14px;padding:12px;background:#fff}.tt-precheck-card strong{display:block;font-size:22px;line-height:1;color:#0f172a}.tt-precheck-card span{display:block;margin-top:6px;color:#64748b;font-size:12px;font-weight:800}.tt-precheck-card.overall.ok{background:#f0fdf4;border-color:#bbf7d0}.tt-precheck-card.overall.warn{background:#fffbeb;border-color:#fde68a}.tt-precheck-card.overall.error{background:#fef2f2;border-color:#fecaca}
        .tt-precheck-body{overflow:auto;padding:4px 22px 22px}.tt-precheck-section{border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;margin-top:12px;background:#fff}.tt-precheck-section h3{margin:0;padding:12px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-size:14px;color:#0f172a;display:flex;gap:8px;align-items:center}.tt-precheck-dot{width:10px;height:10px;border-radius:999px;background:#64748b}.tt-precheck-dot.ok{background:#16a34a}.tt-precheck-dot.warn{background:#f59e0b}.tt-precheck-dot.error{background:#dc2626}.tt-precheck-dot.info{background:#64748b}
        .tt-precheck-item{padding:11px 14px;border-bottom:1px solid #f1f5f9}.tt-precheck-item:last-child{border-bottom:0}.tt-precheck-item-head{display:flex;gap:8px;align-items:center;font-size:13px;color:#0f172a}.tt-precheck-badge{font-size:11px;border-radius:999px;padding:3px 7px;color:white;background:#64748b;min-width:36px;text-align:center}.tt-precheck-badge.ok{background:#16a34a}.tt-precheck-badge.warn{background:#f59e0b}.tt-precheck-badge.error{background:#dc2626}.tt-precheck-badge.info{background:#64748b}.tt-precheck-detail{margin-top:5px;color:#475569;font-size:12px;line-height:1.45;white-space:pre-wrap;word-break:break-word;}
        .tt-precheck-actions{display:flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap}.tt-precheck-btn{border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:10px;padding:8px 12px;font-weight:800;cursor:pointer}.tt-precheck-btn.primary{background:#2563eb;border-color:#2563eb;color:#fff}.tt-precheck-btn.danger{background:#dc2626;border-color:#dc2626;color:#fff}
        @media(max-width:780px){.tt-precheck-header{flex-direction:column}.tt-precheck-actions{justify-content:flex-start}.tt-precheck-summary{grid-template-columns:repeat(2,minmax(0,1fr));}}
      </style>
      <div class="tt-precheck-dialog" role="dialog" aria-modal="true" aria-label="자동배치 사전 점검">
        <div class="tt-precheck-header"><div><h2>🩺 자동배치 사전 점검</h2><p>${precheckEsc(new Date(report.createdAt).toLocaleString())} 기준 · ${overall === "ok" ? "자동배치를 시작해도 좋은 상태입니다." : overall === "warn" ? "주의 항목을 확인한 뒤 진행하세요." : "오류 항목을 먼저 수정하는 것이 안전합니다."}</p></div><div class="tt-precheck-actions"><button type="button" class="tt-precheck-btn" data-precheck-export>JSON 내보내기</button><button type="button" class="tt-precheck-btn" data-precheck-close>닫기</button>${allowProceed ? `<button type="button" class="tt-precheck-btn ${overall === "error" ? "danger" : "primary"}" data-precheck-proceed>${overall === "ok" ? "자동배치 시작" : "확인 후 계속"}</button>` : ""}</div></div>
        <div class="tt-precheck-summary"><div class="tt-precheck-card overall ${overall}"><strong>${overall === "ok" ? "OK" : overall === "warn" ? "주의" : "오류"}</strong><span>종합 상태</span></div><div class="tt-precheck-card"><strong>${report.counts?.error || 0}</strong><span>오류</span></div><div class="tt-precheck-card"><strong>${report.counts?.warn || 0}</strong><span>주의</span></div><div class="tt-precheck-card"><strong>${report.counts?.ok || 0}</strong><span>정상</span></div><div class="tt-precheck-card"><strong>${report.counts?.info || 0}</strong><span>정보</span></div></div>
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
    const options = { ...AUTO_ASSIGN_DEFAULT_OPTIONS, selectedGrades: availableGrades };
    ({ standalone, groupBlocks } = filterAutoTargetsByGrades(standalone, groupBlocks, options.selectedGrades));
    const protectedEntries = computeProtectedEntries(entries(), options);
    const activeGrades = getActiveGradesFromScheduleItems(standalone, groupBlocks);
    const report = buildAutoAssignPrecheckReport({ standalone, groupBlocks, activeGrades, availableGrades, options, protectedEntries });
    await openAutoAssignPrecheckDialog(report, { allowProceed: false });
  }

  async function autoAssignAll() {
    if (!canEdit()) return;
    if (autoAssignRunning) { alert("자동 배치가 이미 진행 중입니다."); return; }

    // 커리큘럼/템플릿 실시간 의존성을 끊었기 때문에, 자동배치 대상도
    // appState.curriculum.gradeBoards가 아니라 시간표 사전작업에서 생성된
    // timetable.ttcards / timetable.ttcardGroups 스냅샷 기준으로 판단합니다.
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
    options.scoringWeights = scoreOptionsFromAssignOptions(options);

    ({ standalone, groupBlocks } = filterAutoTargetsByGrades(standalone, groupBlocks, options.selectedGrades));
    const activeGrades = getActiveGradesFromScheduleItems(standalone, groupBlocks);
    const protectedEntries = computeProtectedEntries(entries(), options);
    const protectedSummary = protectedSlotSummary(protectedEntries);
    const willClearCount = Math.max(0, entries().length - protectedEntries.length);
    const restrictedStandaloneCount = standalone.filter(item => item.hasRestrictedTeacher).length;
    const restrictedGroupCount = groupBlocks.filter(block => block.hasRestrictedTeacher).length;
    const restrictedTeacherNames = [...new Set([
      ...standalone.flatMap(item => item.restrictedTeachers || []),
      ...groupBlocks.flatMap(block => block.restrictedTeachers || [])
    ])];
    const groupTargetSlots = groupBlocks.reduce((sum, { group, unitItems }) => {
      const credits = (unitItems || []).map(u => Math.max(0, Number(u?.credits) || 0));
      const isConcurrent = group?.isConcurrent || group?.groupType === "concurrent";
      return sum + (isConcurrent ? Math.max(0, ...credits) : credits.reduce((a, b) => a + b, 0));
    }, 0);
    const autoTargetSlots = standalone.length + groupTargetSlots;
    const autoItemCount = autoTargetSlots;

    if (!autoItemCount || !activeGrades.length) {
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
    const precheckProceed = await openAutoAssignPrecheckDialog(precheckReport, { allowProceed: true });
    if (!precheckProceed) return;

    const modeText = options.placementMode === "keep" ? "현재 배치 유지 + 미배치만 배치" : "선택 범위 초기화 후 배치";
    const confirmText = [
      `자동 배치를 시작합니다.`,
      `대상: ${activeGrades.map(gradeDisplay).join(", ")}`,
      `방식: ${modeText}`,
      options.placementMode === "reset" ? `초기화 대상 배치: ${willClearCount}개` : `보호되는 기존 배치: ${protectedEntries.length}개`,
      `고정/보호 슬롯: ${protectedSummary.slots}칸`,
      `잠금 카드 유지: ${options.keepPinned !== false ? "예" : "아니오"}`,
      `수동 카드 유지: ${options.keepManual !== false ? "예" : "아니오"}`,
      `점수 기준: ${describeScoreWeights(options.scoringWeights)}`,
      "",
      "계속할까요?"
    ].join("\n");
    if (!confirm(confirmText)) return;

    autoAssignRunning = true;
    setAutoAssignBusy(true);
    await waitForBrowser();

    const autoStartedAt = Date.now();
    const rollbackEntriesSnapshot = cloneAutoAssignData(entries());
    const beforeAutoSnapshot = saveAutoAssignScheduleSnapshot("before", rollbackEntriesSnapshot, { activeGrades, modeText, options });
    if (beforeAutoSnapshot) {
      addTimetableLog("auto", "자동배치 전 배치 보관", `${beforeAutoSnapshot.name}으로 현재 배치를 저장했습니다.`);
      await persistTimetableNow();
    }
    let rollbackConsumed = false;
    let autoAssignCancelled = false;
    const progress = createAutoAssignProgressDialog(autoTargetSlots, () => { autoAssignCancelled = true; });
    let lastProgressAt = 0;
    const updateProgress = async (data = {}, force = false) => {
      const now = Date.now();
      if (autoAssignCancelled || progress?.isCancelled?.()) throw new Error("__AUTO_ASSIGN_CANCELLED__");
      if (!force && now - lastProgressAt < 120) return false;
      lastProgressAt = now;
      await progress.update({ total: autoTargetSlots, ...data });
      return true;
    };

    try {
    await updateProgress({
      percent: 2,
      step: "초기화",
      detail: "기존 배치와 고정 수업을 확인하고 있습니다.",
      currentCard: "-",
      placed: 0,
      best: 0,
      failed: 0,
      log: `대상 학년: ${activeGrades.map(gradeDisplay).join(", ")}`
    }, true);
    captureTimetableUndo("자동 배정");
    addTimetableLog("auto", "자동 배치 시작", `대상 학년: ${activeGrades.map(gradeDisplay).join(", ")}`);
    const preValidation = buildScheduleVerificationReport(entries(), { scopeGrades: activeGrades });
    const baselineAutoRunMetrics = buildAutoRunMetricsFromValidation(preValidation, {
      label: '자동배치 전',
      placedCount: rollbackEntriesSnapshot.length,
      failedCount: 0,
      forcedCount: 0,
      qualityScore: Infinity
    });
    const currentQualityReference = {
      source: "current",
      name: "자동배치 전 현재 시간표",
      entries: cloneAutoAssignData(rollbackEntriesSnapshot) || [],
      validation: preValidation,
      metrics: baselineAutoRunMetrics
    };
    const qualityBaselineReference = findBestSavedAutoAssignReference(activeGrades, currentQualityReference) || currentQualityReference;
    const qualityBaselineMetrics = qualityBaselineReference.metrics || baselineAutoRunMetrics;
    const qualityBaselineValidation = qualityBaselineReference.validation || preValidation;
    if ((qualityBaselineReference.source === "savedSchedule" || qualityBaselineReference.source === "bestSnapshot")) {
      addTimetableLog(
        "auto",
        "자동배치 품질 기준",
        `이전 최고 자동배치 보관본 '${qualityBaselineReference.name}'을 품질 기준으로 사용합니다. ${formatAutoRunMetricSummary(qualityBaselineMetrics)}`
      );
    }

    // Preserve entries according to the selected auto-assign options.
    // - reset: selected range is cleared, but locked/manual/out-of-range entries can be protected.
    // - keep: all current entries stay as protected entries and only missing cards are added.
    const pinnedEntries = [...protectedEntries];
    ttDomain().entries = [...protectedEntries];
    await updateProgress({
      percent: 6,
      step: options.placementMode === "keep" ? "기존 배치 유지" : "보호 수업 유지",
      detail: options.placementMode === "keep"
        ? `기존 배치 ${protectedEntries.length}개를 유지하고 미배치 대상만 준비합니다. 보호 슬롯 ${protectedSummary.slots}칸을 후보에서 제외합니다.`
        : `보호된 배치 ${protectedEntries.length}개를 유지하고 ${willClearCount}개 배치를 초기화했습니다. 보호 슬롯 ${protectedSummary.slots}칸을 후보에서 제외합니다.`,
      placed: 0,
      best: 0,
      failed: 0
    }, true);
    const pc = ttConfig().periodCount;
    const baseSlots = [];
    for (let day = 0; day < 5; day++) {
      for (let period = 0; period < pc; period++) baseSlots.push({ day, period });
    }

    const attemptPlan = attemptsForMode(options.runAttempts);
    const engineProfile = autoEngineProfileForMode(options.runAttempts);

    await updateProgress({
      percent: 10,
      step: "배치 대상 분석",
      detail: `일반 카드 ${standalone.length}개, 그룹 ${groupBlocks.length}개를 분석했습니다. ${engineProfile.label}으로 초기 배치 후보를 만듭니다. 제약근무 교사 대상: 일반 ${restrictedStandaloneCount}개, 그룹 ${restrictedGroupCount}개.`,
      log: restrictedTeacherNames.length
        ? `고정/보호 슬롯 ${protectedSummary.slots}칸 제외 · 고정 수업 다음 우선 배치: ${restrictedTeacherNames.join(", ")} · ${describeScoreWeights(options.scoringWeights)}`
        : `고정/보호 슬롯 ${protectedSummary.slots}칸 제외 · 그룹 수업은 동시배정 단위로 계산합니다. · ${describeScoreWeights(options.scoringWeights)}`
    }, true);

    const requiredByKey = new Map();
    const itemByKey = new Map();
    standalone.forEach(item => {
      const key = autoItemKey(item);
      requiredByKey.set(key, (requiredByKey.get(key) || 0) + 1);
      if (!itemByKey.has(key)) itemByKey.set(key, item);
    });

    const pinnedByKey = new Map();
    itemByKey.forEach((item, key) => {
      pinnedByKey.set(key, pinnedEntries.filter(e => entryMatchesAutoItem(e, item)).length);
    });

    const stages = [
      { name:"strict", label:"교사 제약 포함", attempts:attemptPlan[0], options:{ respectSoftLimits:true,  respectUnavailable:true,  respectAssignedRoom:true,  scoringWeights: options.scoringWeights } },
      { name:"relaxedSoft", label:"교사 일일/연속 제한 완화", attempts:attemptPlan[1], options:{ respectSoftLimits:false, respectUnavailable:true,  respectAssignedRoom:true,  scoringWeights: options.scoringWeights } },
      { name:"relaxedUnavailable", label:"불가시간 완화 · 교실 유지", attempts:attemptPlan[2], options:{ respectSoftLimits:false, respectUnavailable:false, respectAssignedRoom:true,  scoringWeights: options.scoringWeights } },
    ];

    let bestPlaced = [], bestFailed = [], bestScore = -1, bestStage = stages[0];
    let bestQualityScore = Infinity;
    let bestAttemptInfo = { stageLabel: stages[0]?.label || "", attempt: 0, totalAttempts: 0, exploration: "기본" };
    let exploredInitialRuns = 0;
    let autoOps = 0;
    const yieldAutoAssign = async (data = null, force = false) => {
      if (autoAssignCancelled || progress?.isCancelled?.()) throw new Error("__AUTO_ASSIGN_CANCELLED__");
      autoOps++;
      if (data) {
        const updated = await updateProgress(data, force);
        // 진행률 갱신이 120ms 쓰로틀에 걸려도 일정 간격으로 이벤트 루프를 양보합니다.
        // 이것이 없으면 정교한 배치에서 계산은 진행 중인데 브라우저가 멈춘 것처럼 보입니다.
        if (!updated && autoOps % 10 === 0) await waitForBrowser();
      } else if (autoOps % 10 === 0) await waitForBrowser();
      if (autoAssignCancelled || progress?.isCancelled?.()) throw new Error("__AUTO_ASSIGN_CANCELLED__");
    };

    for (let stageIndex = 0; stageIndex < stages.length; stageIndex++) {
      const stage = stages[stageIndex];
      for (let attempt = 0; attempt < stage.attempts; attempt++) {
        const stagePercent = 12 + Math.min(68, ((stageIndex / stages.length) * 68) + ((attempt / Math.max(1, stage.attempts)) * (68 / stages.length)));
        await updateProgress({
          percent: stagePercent,
          step: `자동배치 탐색 · ${stage.label}`,
          detail: `초기배치 후보 ${attempt + 1} / ${stage.attempts} · ${engineProfile.label} · 현재까지 최선 ${Math.max(0, bestScore)}개 배치`,
          placed: 0,
          best: Math.max(0, bestScore),
          failed: bestFailed.length,
          currentCard: "-",
          log: attempt === 0 ? `${stage.label} 단계 시작` : null
        }, true);
        const placed = [], failed = [];
        exploredInitialRuns++;
        const exploration = explorationOptionsForAttempt(options.runAttempts, attempt, stageIndex);
        const stageAttemptOptions = {
          ...stage.options,
          ...exploration,
          runAttempts: options.runAttempts,
          engineProfileLabel: engineProfile.label,
          engineProfile,
          useCandidateCountSort: engineProfile.useCandidateCountSort,
          useLiveMrv: engineProfile.useLiveMrv,
          attemptIndex: attempt,
          stageIndex
        };

        // ── Sort schedulable units by priority ───────────────────────
        // 1) 고정 수업은 위에서 이미 pinnedEntries로 보호
        // 2) 제약근무 교사 포함 수업은 일반 그룹/일반 카드보다 먼저 배치
        // 3) 같은 우선순위 안에서는 "후보 시간이 적은 수업"을 먼저 배치합니다.
        const candidateCountCache = new Map();
        const candidateCountForItem = (item) => {
          if (!item) return 9999;
          if (!stageAttemptOptions.useCandidateCountSort) return 9999;
          const key = `${autoItemKey(item)}::${stage.name}`;
          if (candidateCountCache.has(key)) return candidateCountCache.get(key);
          let count = 0;
          for (const slot of baseSlots) {
            if (checkPlacementValid(item, slot, placed, stageAttemptOptions)) count += 1;
          }
          candidateCountCache.set(key, count);
          return count;
        };
        const candidateCountForGroupBlock = (block) => {
          const group = block?.group;
          const unitItems = block?.unitItems || [];
          if (!group || !unitItems.length) return 9999;
          if (!stageAttemptOptions.useCandidateCountSort) return 9999;
          const cacheKey = `group:${group.id || group.name || "?"}::${stage.name}`;
          if (candidateCountCache.has(cacheKey)) return candidateCountCache.get(cacheKey);
          let minCount = 9999;
          const maxCredits = Math.max(0, ...unitItems.map(u => Math.max(0, Number(u.credits) || 0)));
          const samples = Math.max(1, Math.min(maxCredits || 1, 5));
          for (let occurrence = 0; occurrence < samples; occurrence++) {
            const activeItems = unitItems
              .filter(u => occurrence < (Number(u.credits) || 0))
              .map(u => getGroupItemForOccurrence(u, occurrence))
              .filter(u => (u.ttcards || []).length);
            if (!activeItems.length) continue;
            const probeCards = activeItems.flatMap(u => u.ttcards || []);
            const probeItem = makePlacementFromGroupItem(group, { ttcards: probeCards });
            const probe = probeItem ? annotateRestrictedAutoItem(probeItem) : null;
            if (!probe) continue;
            minCount = Math.min(minCount, candidateCountForItem(probe));
          }
          candidateCountCache.set(cacheKey, minCount);
          return minCount;
        };

        const groupBlockSpecialPriority = block => {
          const group = block?.group || {};
          const cards = (block?.unitItems || []).flatMap(u => u.ttcards || []).filter(Boolean);
          const teachers = new Set(getTeacherNamesFromCards(cards).filter(Boolean));
          const classKeys = new Set(cards.flatMap(card => card.classKeys || []).filter(Boolean));
          const nameText = [group.name, group.label, group.groupName, ...cards.map(c => [c.group, c.groupName, c.track, c.subject, c.label].filter(Boolean).join(' '))]
            .filter(Boolean).join(' ');
          let bonus = 0;
          const structuralRank = getStructuralGroupRank(block);
          if (structuralRank < 99) bonus += 25000 - structuralRank * 1800;
          if (/HS\s*국어|고등\s*국어/i.test(nameText)) bonus += 18000;
          if (/MS\s*국어|중등\s*국어/i.test(nameText)) bonus += 12000;
          if (group.isConcurrent || group.groupType === "concurrent") bonus += 8000;
          if (/선택/.test(nameText)) bonus += 6200;
          if (/채플|자율|동아리|CA|SA|Chapel|Club/i.test(nameText)) bonus += 5200;
          if (/국어|한국어|영어|Korean|English/i.test(nameText)) bonus += 4200;
          // 여러 반·여러 교사·여러 카드가 동시에 움직이는 그룹은 뒤로 밀리면 거의 배치가 불가능해집니다.
          bonus += classKeys.size * 220 + teachers.size * 320 + cards.length * 60;
          return bonus;
        };

        const groupBlockComplexity = block => {
          const cards = (block?.unitItems || []).flatMap(u => u.ttcards || []).filter(Boolean);
          const teachers = new Set(getTeacherNamesFromCards(cards).filter(Boolean));
          const classKeys = new Set(cards.flatMap(card => card.classKeys || []).filter(Boolean));
          const maxCredits = Math.max(0, ...(block?.unitItems || []).map(u => Math.max(0, Number(u.credits) || 0)));
          // 여러 학년·반·교사가 동시에 움직이는 그룹을 먼저 배치해야 후반부 카드 부족/미배치가 줄어듭니다.
          return groupBlockSpecialPriority(block) + teachers.size * 100 + classKeys.size * 12 + cards.length * 5 + maxCredits;
        };

        const orderedGroups = shuffle([...groupBlocks]).sort((a, b) => {
          const ac = Math.max(0, ...a.unitItems.map(u => Math.max(0, Number(u.credits) || 0)));
          const bc = Math.max(0, ...b.unitItems.map(u => Math.max(0, Number(u.credits) || 0)));
          const ap = comparePriority(a, b);
          if (ap !== 0) return ap;
          const art = (b.restrictedTeachers || []).length - (a.restrictedTeachers || []).length;
          if (art !== 0) return art;
          const special = groupBlockSpecialPriority(b) - groupBlockSpecialPriority(a);
          if (special !== 0) return special;
          const acand = candidateCountForGroupBlock(a);
          const bcand = candidateCountForGroupBlock(b);
          if (acand !== bcand) return acand - bcand;
          const complexity = groupBlockComplexity(b) - groupBlockComplexity(a);
          if (complexity !== 0) return complexity;
          return bc - ac;
        });

        const orderedKeys = shuffle([...requiredByKey.keys()]).sort((a, b) => {
          const ia = itemByKey.get(a);
          const ib = itemByKey.get(b);
          const ap = comparePriority(ia, ib);
          if (ap !== 0) return ap;
          const excludedPriority = Number(ib?.excludedGroupPriority || 0) - Number(ia?.excludedGroupPriority || 0);
          if (excludedPriority !== 0) return excludedPriority;
          const art = (ib?.restrictedTeachers || []).length - (ia?.restrictedTeachers || []).length;
          if (art !== 0) return art;
          const acand = candidateCountForItem(ia);
          const bcand = candidateCountForItem(ib);
          if (acand !== bcand) return acand - bcand;
          return getAutoItemDifficulty(ib) - getAutoItemDifficulty(ia);
        });
        const structuralGroupBlocks = orderedGroups.filter(block => block.hasStructuralPriority || block.priorityTier === 0);
        const restrictedGroupBlocks = orderedGroups.filter(block => !(block.hasStructuralPriority || block.priorityTier === 0) && block.hasRestrictedTeacher);
        const normalGroupBlocks = orderedGroups.filter(block => !(block.hasStructuralPriority || block.priorityTier === 0) && !block.hasRestrictedTeacher);
        const excludedFollowupKeys = orderedKeys.filter(key => itemByKey.get(key)?.isExcludedGroupFollowup);
        const excludedFollowupKeySet = new Set(excludedFollowupKeys);
        const restrictedKeys = orderedKeys.filter(key => !excludedFollowupKeySet.has(key) && itemByKey.get(key)?.hasRestrictedTeacher);
        const normalKeys = orderedKeys.filter(key => !excludedFollowupKeySet.has(key) && !itemByKey.get(key)?.hasRestrictedTeacher);
        const placedByKey = new Map();

        const placeGroups = async (blocks, phaseLabel) => {
          // ── Place concurrent groups first: one independent occurrence per 시수 ──
          for (const { group, unitItems, restrictedTeachers = [] } of blocks) {
            if (!(group.isConcurrent || group.groupType === "concurrent")) continue;
            const maxCredits = Math.max(0, ...(unitItems || []).map(u => Math.max(0, Number(u.credits) || 0)));
            const alreadyPinned = countPinnedGroupSlots(group, unitItems, pinnedEntries);
            const needSlots = Math.max(0, maxCredits - alreadyPinned);

            for (let slot_i = 0; slot_i < needSlots; slot_i++) {
              await yieldAutoAssign({
                percent: stagePercent,
                step: `${phaseLabel} · ${stage.label}`,
                detail: `${group.name || "그룹"} ${slot_i + 1} / ${needSlots}회차를 배치하고 있습니다.${restrictedTeachers.length ? ` (${describeRestrictedTeachers(restrictedTeachers)})` : ""}`,
                placed: placed.length,
                best: Math.max(0, bestScore),
                failed: failed.length,
                currentCard: group.name || "그룹 수업"
              });
              const activeItems = unitItems
                .filter(u => slot_i < u.credits)
                .map(u => getGroupItemForOccurrence(u, slot_i))
                .filter(u => (u.ttcards || []).length);
              if (!activeItems.length) continue;
              // 동시배정 그룹은 한 회차에 여러 과목/교사가 함께 움직일 수 있으므로,
              // 첫 카드만으로 후보 시간을 검사하면 제약교사 조건을 놓칠 수 있습니다.
              // 해당 회차의 모든 활성 카드를 합친 probe로 교사·학생·교실 제약을 함께 검사합니다.
              const probeCards = activeItems.flatMap(u => u.ttcards || []);
              const probeItem = makePlacementFromGroupItem(group, { ttcards: probeCards });
              const probe = probeItem ? annotateRestrictedAutoItem(probeItem) : null;
              const foundSlot = probe ? findBestAutoSlot(probe, baseSlots, placed, stageAttemptOptions) : null;
              if (foundSlot && placeAutoGroupSlot(group, activeItems, foundSlot, placed, stageAttemptOptions)) {
                continue;
              }
              activeItems.forEach(groupItem => {
                const item = makePlacementFromGroupItem(group, groupItem);
                failed.push(makeFailedPlacement(`${group.name} - ${groupItem.name || "그룹 카드"}`, item ? annotateRestrictedAutoItem(item) : item, { groupId: group.id }));
              });
            }
          }

          // ── Place non-concurrent groups independently (legacy safety) ─────────
          for (const { group, unitItems, restrictedTeachers = [] } of blocks) {
            if (group.isConcurrent || group.groupType === "concurrent") continue;
            for (const groupItem of unitItems) {
              const pinnedSlots = countPinnedGroupSlots(group, [groupItem], pinnedEntries);
              const needSlots = Math.max(0, groupItem.credits - pinnedSlots);
              for (let i = 0; i < needSlots; i++) {
                await yieldAutoAssign({
                  percent: stagePercent,
                  step: `${phaseLabel} · ${stage.label}`,
                  detail: `${group.name || "그룹"} - ${groupItem.name || "그룹 카드"} 배치 중${restrictedTeachers.length ? ` (${describeRestrictedTeachers(restrictedTeachers)})` : ""}`,
                  placed: placed.length,
                  best: Math.max(0, bestScore),
                  failed: failed.length,
                  currentCard: `${group.name || "그룹"} - ${groupItem.name || "그룹 카드"}`
                });
                const occurrenceGroupItem = getGroupItemForOccurrence(groupItem, i);
                if (!(occurrenceGroupItem.ttcards || []).length) continue;
                const item = makePlacementFromGroupItem(group, occurrenceGroupItem);
                const checkedItem = item ? annotateRestrictedAutoItem(item) : null;
                const slot = checkedItem ? findBestAutoSlot(checkedItem, baseSlots, placed, stageAttemptOptions) : null;
                if (slot) {
                  const entry = makeAutoEntry(checkedItem, slot, placed);
                  if (entry) placed.push(entry);
                } else {
                  failed.push(makeFailedPlacement(`${group.name} - ${groupItem.name || "그룹 카드"}`, checkedItem, { groupId: group.id }));
                }
              }
            }
          }
        };

        const placeStandaloneKeys = async (keys, phaseLabel) => {
          const pendingKeys = new Set(keys || []);
          const liveCandidateCountForItem = (item) => {
            if (!item || !stageAttemptOptions.useLiveMrv) return null;
            let count = 0;
            for (const slot of baseSlots) if (checkPlacementValid(item, slot, placed, stageAttemptOptions)) count += 1;
            return count;
          };

          const pickNextKey = () => {
            const arr = [...pendingKeys];
            if (!stageAttemptOptions.useLiveMrv) return arr[0];
            return arr.sort((a, b) => {
              const ia = itemByKey.get(a);
              const ib = itemByKey.get(b);
              const acand = liveCandidateCountForItem(ia) ?? 9999;
              const bcand = liveCandidateCountForItem(ib) ?? 9999;
              if (acand !== bcand) return acand - bcand;
              const ap = comparePriority(ia, ib);
              if (ap !== 0) return ap;
              const art = (ib?.restrictedTeachers || []).length - (ia?.restrictedTeachers || []).length;
              if (art !== 0) return art;
              return getAutoItemDifficulty(ib) - getAutoItemDifficulty(ia);
            })[0];
          };

          while (pendingKeys.size) {
            const key = pickNextKey();
            if (!key) break;
            pendingKeys.delete(key);

            const item = itemByKey.get(key);
            const required = requiredByKey.get(key) || 0;
            const pinned = pinnedByKey.get(key) || 0;
            while (pinned + (placedByKey.get(key) || 0) < required) {
              const candidateCount = liveCandidateCountForItem(item);
              const candidateText = Number.isInteger(candidateCount) ? ` 후보 ${candidateCount}칸` : "";
              await yieldAutoAssign({
                percent: stagePercent,
                step: `${phaseLabel} · ${stage.label}`,
                detail: `${getAutoItemName(item)} 배치 위치를 찾고 있습니다.${candidateText}${item?.hasRestrictedTeacher ? ` (${describeRestrictedTeachers(item.restrictedTeachers)})` : ""}`,
                placed: placed.length,
                best: Math.max(0, bestScore),
                failed: failed.length,
                currentCard: getAutoItemName(item)
              });
              const slot = findBestAutoSlot(item, baseSlots, placed, stageAttemptOptions);
              if (!slot) {
                // 같은 카드가 2시수 이상 필요한데 첫 미배치 시점에서 1개만 failed에 넣고
                // break하면, 마지막 보정 단계가 1시수만 복구하고 나머지는 계속 하단에 남습니다.
                // 현재 남은 필요 시수만큼 failed를 기록해 final repair가 전부 처리하게 합니다.
                const already = pinned + (placedByKey.get(key) || 0);
                const remaining = Math.max(1, required - already);
                for (let miss = 0; miss < remaining; miss++) {
                  failed.push(makeFailedPlacement(getAutoItemName(item), item, { occurrence: already + miss + 1, required }));
                }
                break;
              }
              const entry = makeAutoEntry(item, slot, placed);
              if (entry) placed.push(entry);
              placedByKey.set(key, (placedByKey.get(key) || 0) + 1);
            }
          }
        };

        // 고정 수업 다음: 큰 동시배정 그룹을 먼저 배치합니다.
        // 제약교사 일반카드가 10A/11A/12A의 희소 슬롯을 먼저 점유하면 HS국어 같은 그룹은 나중에 복구가 거의 불가능합니다.
        await placeGroups(structuralGroupBlocks, "핵심 동시배정 그룹 선배치");
        await placeStandaloneKeys(excludedFollowupKeys, "그룹 후속 필수카드 선배치");
        await placeGroups(restrictedGroupBlocks, "제약교사 그룹 우선 배치");
        await placeStandaloneKeys(restrictedKeys, "제약교사 일반 카드 우선 배치");
        await placeGroups(normalGroupBlocks, "그룹 수업 배치");
        await placeStandaloneKeys(normalKeys, "일반 카드 배치");

        const qualityScore = Math.round(scoreScheduleQuality(placed, { ...options, scoringWeights: stageAttemptOptions.scoringWeights }) * 10) / 10;
        const currentClassSlots = classSlotIssueCountForCandidate(placed, activeGrades);
        const currentCardSlots = cardCoverageIssueCountForCandidate(placed, activeGrades);
        const bestClassSlots = bestScore < 0
          ? { issueCount: 999999, shortCount: 999999, overCount: 999999 }
          : classSlotIssueCountForCandidate(bestPlaced, activeGrades);
        const bestCardSlots = bestScore < 0
          ? { issueCount: 999999, shortCount: 999999, overCount: 999999, shortageSlots: 999999, overageSlots: 999999 }
          : cardCoverageIssueCountForCandidate(bestPlaced, activeGrades);
        const currentRun = {
          placedCount: placed.length,
          failedCount: failed.length,
          qualityScore,
          forcedCount: 0,
          cardCoverageIssueCount: currentCardSlots.issueCount,
          cardShortCount: currentCardSlots.shortCount,
          cardOverCount: currentCardSlots.overCount,
          cardShortageSlots: currentCardSlots.shortageSlots,
          cardOverageSlots: currentCardSlots.overageSlots,
          classSlotIssueCount: currentClassSlots.issueCount,
          classShortCount: currentClassSlots.shortCount,
          classOverCount: currentClassSlots.overCount
        };
        const bestRun = {
          placedCount: bestPlaced.length,
          failedCount: bestFailed.length,
          qualityScore: bestQualityScore,
          forcedCount: 0,
          cardCoverageIssueCount: bestCardSlots.issueCount,
          cardShortCount: bestCardSlots.shortCount,
          cardOverCount: bestCardSlots.overCount,
          cardShortageSlots: bestCardSlots.shortageSlots,
          cardOverageSlots: bestCardSlots.overageSlots,
          classSlotIssueCount: bestClassSlots.issueCount,
          classShortCount: bestClassSlots.shortCount,
          classOverCount: bestClassSlots.overCount
        };
        if (bestScore < 0 || compareAutoRunResults(currentRun, bestRun) < 0) {
          bestScore  = placed.length;
          bestPlaced = placed;
          bestFailed = failed;
          bestStage  = { ...stage, options: stageAttemptOptions };
          bestQualityScore = qualityScore;
          bestAttemptInfo = {
            stageLabel: stage.label,
            attempt: attempt + 1,
            totalAttempts: stage.attempts,
            exploration: `${engineProfile.label} · ${stageAttemptOptions.slotRandomness ? `상위 ${stageAttemptOptions.topCandidateCount}개 후보 탐색` : "기본 후보 우선"}`,
            qualityScore
          };
          await updateProgress({
            percent: stagePercent,
            step: `최선 초기배치 갱신 · ${stage.label}`,
            detail: `현재 최선: ${bestPlaced.length}개 배치, 미배치 후보 ${bestFailed.length}개, 카드시수 부족 ${currentCardSlots.shortageSlots}시수, 학급시수 문제 ${currentClassSlots.issueCount}개, 품질점수 ${qualityScore}`,
            placed: placed.length,
            best: bestPlaced.length,
            failed: bestFailed.length,
            log: `최선 초기배치 갱신: ${bestPlaced.length}개 배치 · 미배치 ${bestFailed.length}개 · 카드시수 부족 ${currentCardSlots.shortageSlots}시수 · 학급시수 문제 ${currentClassSlots.issueCount}개 · 품질 ${qualityScore}`
          }, true);
        }
        // 완전 배치 후보가 나와도 같은 단계의 남은 초기 후보를 계속 비교해 품질이 더 좋은 배치를 찾습니다.
        // 단, 빠른 배치는 최소 3회 이후 완전 배치가 나오면 시간을 절약합니다.
        if (!failed.length && String(options.runAttempts || "balanced") === "fast" && attempt >= 2) break;
      }
      if (!bestFailed.length) break;
    }

    const appendCardShortageFailures = () => {
      const coverage = buildCardCoverageValidation([...protectedEntries, ...bestPlaced], activeGrades);
      const failedByKey = new Map();
      bestFailed.forEach(failedItem => {
        if (!failedItem?.item) return;
        const key = autoItemKey(failedItem.item);
        failedByKey.set(key, (failedByKey.get(key) || 0) + 1);
      });
      let added = 0;
      (coverage.shortRows || []).forEach(row => {
        const key = `ttc:${row.id}`;
        const item = itemByKey.get(key);
        if (!item) return;
        const shortage = Math.max(0, -Number(row.diff || 0));
        const already = failedByKey.get(key) || 0;
        const need = Math.max(0, shortage - already);
        for (let i = 0; i < need; i++) {
          bestFailed.push(makeFailedPlacement(`${row.title}${row.classLabels?.length ? ` ${row.classLabels.join(", ")}` : ""}`, item, {
            source: "cardCoverageShortage",
            ttcardId: row.id,
            occurrence: (row.count || 0) + i + 1,
            required: row.target
          }));
          added += 1;
        }
      });
      return added;
    };

    const addedCoverageFailures = appendCardShortageFailures();
    if (addedCoverageFailures) {
      await updateProgress({
        percent: 81,
        step: "카드 시수 부족 보정 대상 추가",
        detail: `초기 탐색 후 카드별 부족 ${addedCoverageFailures}시수를 미배치 복구 대상으로 승격했습니다.`,
        placed: bestPlaced.length,
        best: bestPlaced.length,
        failed: bestFailed.length,
        currentCard: "카드 시수 보정",
        log: `카드 시수 부족 ${addedCoverageFailures}시수 복구 대상 추가`
      }, true);
    }

    let acceptedPlaced = cloneAutoAssignData(bestPlaced) || [];
    let acceptedFailed = [...bestFailed];
    let acceptedForced = [];
    let acceptedLabel = "초기 최선 배치";
    let acceptedMetrics = buildAutoRunMetricsForEntries([...protectedEntries, ...acceptedPlaced], activeGrades, acceptedFailed, {
      protectedEntries,
      placedCount: acceptedPlaced.length,
      forcedCount: 0,
      qualityScore: bestQualityScore,
      label: acceptedLabel
    }).metrics;
    const considerAutoCandidate = (label, placed, failed, forced = [], qualityScore = Infinity) => {
      const result = buildAutoRunMetricsForEntries([...protectedEntries, ...(placed || [])], activeGrades, failed || [], {
        protectedEntries,
        placedCount: (placed || []).length,
        forcedCount: (forced || []).length,
        qualityScore,
        label
      });
      if (compareAutoRunResults(result.metrics, acceptedMetrics) < 0) {
        acceptedPlaced = cloneAutoAssignData(placed || []) || [];
        acceptedFailed = [...(failed || [])];
        acceptedForced = [...(forced || [])];
        acceptedLabel = label;
        acceptedMetrics = result.metrics;
      }
      return result.metrics;
    };

    const makeCoverageShortageFailures = (placed, seedFailed = []) => {
      const coverage = buildCardCoverageValidation([...protectedEntries, ...(placed || [])], activeGrades);
      const failedByKey = new Map();
      (seedFailed || []).forEach(failedItem => {
        if (!failedItem?.item) return;
        const key = autoItemKey(failedItem.item);
        failedByKey.set(key, (failedByKey.get(key) || 0) + 1);
      });
      const priorityForRow = row => {
        const title = `${row.title || ""} ${(row.classLabels || []).join(" ")}`;
        const groupNames = (row.groupIds || []).map(id => ttGroups().find(g => g.id === id)?.name || "").join(" ");
        const text = `${title} ${groupNames} ${row.group || ""} ${row.track || ""}`;
        let score = 0;
        if (/언어와\s*매체|공통영어1|변혁적\s*리더십|스토리텔링과\s*공연기획/i.test(text)) score -= 90;
        if (/문학|국어|한국어|영어|수학|사회|과학|화학|성경|종교/i.test(text)) score -= 20;
        if (/12영어|HS국어|MS국어|선택|사회|수학|영어/.test(text)) score -= 12;
        score -= Math.max(0, -Number(row.diff || 0)) * 8;
        return score;
      };
      const rows = [...(coverage.shortRows || [])].sort((a, b) => priorityForRow(a) - priorityForRow(b) || String(a.title).localeCompare(String(b.title), "ko"));
      const result = [];
      rows.forEach(row => {
        const key = `ttc:${row.id}`;
        const item = itemByKey.get(key);
        if (!item) return;
        const shortage = Math.max(0, -Number(row.diff || 0));
        const already = failedByKey.get(key) || 0;
        const need = Math.max(0, shortage - already);
        for (let i = 0; i < need; i++) {
          result.push(makeFailedPlacement(`${row.title}${row.classLabels?.length ? ` ${row.classLabels.join(", ")}` : ""}`, item, {
            source: "iterativeCardCoverageRepair",
            ttcardId: row.id,
            occurrence: (row.count || 0) + i + 1,
            required: row.target
          }));
        }
      });
      return { coverage, failures: result };
    };


    const repairResidualByTwoCycleSwap = async (placed, failed, forced, labelPrefix = "r37 2단계 스왑복구") => {
      // r37: 진단만 반복하지 않고, 실제로 한 칸을 비우는 2-cycle swap을 수행합니다.
      // 방식: (A) 부족 카드가 들어갈 목표 슬롯 S를 잡고,
      //      (B) 그 슬롯을 막는 비고정/비그룹 수업 B를 찾고,
      //      (C) 같은 학급의 다른 수업 G와 B를 서로 교환한 뒤,
      //      (D) 부족 카드를 S에 추가합니다.
      // 이 방식은 현재 r36에서 막혀 있는 공통영어1 10A 같은 "교사 충돌 + 학급 만석" 케이스를 실제로 뚫습니다.
      let currentPlaced = cloneAutoAssignData(placed || []) || [];
      let currentFailed = [...(failed || [])];
      let currentForced = [...(forced || [])];
      const repaired = [];
      const moveLogs = [];

      const itemTeachers = item => getTeachersForAutoItem(item).filter(Boolean);
      const itemClassKeys = item => {
        const aud = audienceForPlacement(item);
        return [...(aud?.classKeys || new Set())].filter(Boolean);
      };
      const entrySlot = e => ({ day: Number(e.day), period: Number(e.period) });
      const sameSlot = (a, b) => Number(a?.day) === Number(b?.day) && Number(a?.period) === Number(b?.period);
      const slotText = slot => `${["월","화","수","목","금"][Number(slot.day)] || "?"}${Number(slot.period) + 1}`;
      const isMovableEntry = e => e && !e.pinned && !e.protected && !e.manualPinned && !e.fixed && !e.locked && !e.groupId;
      const hasDuplicateCardAtSlot = (item, slot, list) => {
        const ids = new Set(ttCardIdsFromPlacement(item));
        if (!ids.size) return false;
        return list.some(e => sameSlot(e, slot) && ttCardIdsFromPlacement(e).some(id => ids.has(id)));
      };
      const conflictsItemEntry = (item, entry) => {
        if (!item || !entry) return false;
        if (item.unitId && entry.unitId && item.unitId === entry.unitId) return false;
        const sameGrp = sameActiveGroup(item, entry);
        const conc = sameGrp && isConcurrentItem(item) && isConcurrentItem(entry);
        const its = itemTeachers(item);
        const ets = splitTeacherNames(entry.teacherName).filter(Boolean);
        if (its.some(t => ets.includes(t)) && !conc) return true;
        const ia = audienceForPlacement(item);
        const ea = audienceForPlacement(entry);
        if (audiencesConflict(ia, ea) && !conc) return true;
        return false;
      };
      const movedEntry = (entry, slot, placedBase) => {
        const raw = {
          ...entry,
          day: Number(slot.day),
          period: Number(slot.period)
        };
        const roomed = applyAutoRoomToEntryData(raw, slot, placedBase || []);
        return normalizeTimetableEntry({
          ...entry,
          ...roomed,
          id: entry.id,
          day: Number(slot.day),
          period: Number(slot.period)
        });
      };
      const validEntryAt = (entry, slot, placedBase, checkOptions) => {
        const probe = movedEntry(entry, slot, placedBase);
        return !!probe && checkPlacementValid(probe, slot, placedBase, checkOptions);
      };
      const countPlacedForItem = (item, list) => {
        const ids = new Set(ttCardIdsFromPlacement(item));
        if (!ids.size) return 0;
        return list.reduce((sum, e) => sum + (ttCardIdsFromPlacement(e).some(id => ids.has(id)) ? 1 : 0), 0);
      };

      const checkOptions = {
        ...(bestStage?.options || options),
        runAttempts: "deep",
        engineProfile: autoEngineProfileForMode("deep"),
        respectSoftLimits: false,
        respectUnavailable: true,
        respectAssignedRoom: true
      };

      for (let pass = 0; pass < 4; pass++) {
        const coverageInfo = makeCoverageShortageFailures(currentPlaced, currentFailed);
        const failures = coverageInfo.failures || [];
        if (!failures.length) break;
        let changed = false;

        for (const failedItem of failures) {
          const item = failedItem?.item;
          if (!item) continue;
          const beforeCount = countPlacedForItem(item, currentPlaced);
          const targetClasses = itemClassKeys(item);
          const preferredSlots = baseSlots
            .filter(slot => targetClasses.length && targetClasses.every(ck => {
              return !currentPlaced.some(e => sameSlot(e, slot) && itemClassKeys(e).includes(ck));
            }))
            .concat(baseSlots)
            .filter((slot, idx, arr) => arr.findIndex(s => sameSlot(s, slot)) === idx);

          let accepted = null;

          for (const targetSlot of preferredSlots) {
            if (checkPlacementValid(item, targetSlot, currentPlaced, checkOptions)) {
              const entry = makeAutoEntry(item, targetSlot, currentPlaced);
              if (entry) {
                accepted = {
                  placed: [...currentPlaced, entry],
                  log: `${failedItem.name || getAutoItemName(item)} 직접배치 → ${slotText(targetSlot)}`
                };
                break;
              }
            }

            const slotEnts = currentPlaced.filter(e => sameSlot(e, targetSlot));
            const blockers = slotEnts.filter(e => conflictsItemEntry(item, e) && isMovableEntry(e));
            if (!blockers.length) continue;

            for (const blocker of blockers) {
              const blockerClasses = itemClassKeys(blocker);
              if (blockerClasses.length !== 1) continue;
              const blockerClass = blockerClasses[0];

              const swapCandidates = currentPlaced.filter(e => {
                if (!isMovableEntry(e) || e.id === blocker.id) return false;
                if (sameSlot(e, targetSlot)) return false;
                const classes = itemClassKeys(e);
                return classes.length === 1 && classes[0] === blockerClass;
              });

              for (const swapper of swapCandidates) {
                const swapSlot = entrySlot(swapper);
                const base = currentPlaced.filter(e => e.id !== blocker.id && e.id !== swapper.id);
                if (hasDuplicateCardAtSlot(blocker, swapSlot, base)) continue;
                if (hasDuplicateCardAtSlot(swapper, targetSlot, base)) continue;

                const movedBlocker = movedEntry(blocker, swapSlot, base);
                if (!checkPlacementValid(movedBlocker, swapSlot, base, checkOptions)) continue;

                const baseWithBlocker = [...base, movedBlocker];
                const movedSwapper = movedEntry(swapper, targetSlot, baseWithBlocker);
                if (!checkPlacementValid(movedSwapper, targetSlot, baseWithBlocker, checkOptions)) continue;

                const baseWithSwap = [...baseWithBlocker, movedSwapper];
                if (!checkPlacementValid(item, targetSlot, baseWithSwap, checkOptions)) continue;

                const newEntry = makeAutoEntry(item, targetSlot, baseWithSwap);
                if (!newEntry) continue;

                const nextPlaced = [...baseWithSwap, newEntry];
                const afterCount = countPlacedForItem(item, nextPlaced);
                if (afterCount <= beforeCount) continue;

                accepted = {
                  placed: nextPlaced,
                  log: `${failedItem.name || getAutoItemName(item)} 2단계 스왑복구: ${getAutoItemName(blocker)} ${slotText(targetSlot)}→${slotText(swapSlot)}, ${getAutoItemName(swapper)} ${slotText(swapSlot)}→${slotText(targetSlot)}, 부족카드 ${slotText(targetSlot)} 추가`
                };
                break;
              }
              if (accepted) break;
            }
            if (accepted) break;
          }

          if (accepted) {
            currentPlaced = cloneAutoAssignData(accepted.placed) || accepted.placed;
            currentFailed = (makeCoverageShortageFailures(currentPlaced, currentFailed).failures || []);
            repaired.push(failedItem);
            moveLogs.push(accepted.log);
            changed = true;
            await updateProgress({
              percent: 87 + pass,
              step: labelPrefix,
              detail: accepted.log,
              placed: currentPlaced.length,
              best: currentPlaced.length,
              failed: currentFailed.length,
              currentCard: failedItem.name || getAutoItemName(item),
              log: accepted.log
            }, true);
            break;
          }
        }

        if (!changed) break;
      }

      const metrics = buildAutoRunMetricsForEntries([...protectedEntries, ...currentPlaced], activeGrades, currentFailed, {
        protectedEntries,
        placedCount: currentPlaced.length,
        forcedCount: currentForced.length,
        qualityScore: scoreScheduleQuality(currentPlaced, options),
        label: labelPrefix
      }).metrics;
      return { placed: currentPlaced, failed: currentFailed, forced: currentForced, repaired, repairedCount: repaired.length, moveLogs, metrics };
    };


    const repairCardCoverageShortagesIteratively = async (placed, failed, forced, labelPrefix = "카드시수 반복복구") => {
      let currentPlaced = cloneAutoAssignData(placed || []) || [];
      let currentFailed = [...(failed || [])];
      let currentForced = [...(forced || [])];
      let totalRepaired = 0;
      let totalAttempts = 0;
      let lastMetrics = buildAutoRunMetricsForEntries([...protectedEntries, ...currentPlaced], activeGrades, currentFailed, {
        protectedEntries,
        placedCount: currentPlaced.length,
        forcedCount: currentForced.length,
        qualityScore: scoreScheduleQuality(currentPlaced, options),
        label: `${labelPrefix} 전`
      }).metrics;

      // r30: 카드 부족 복구는 한 번의 이동으로 해결되지 않는 경우가 많습니다.
      // 개선되는 동안 최대 10차까지 반복합니다.
      for (let pass = 0; pass < 10; pass++) {
        const { coverage, failures: coverageFailures } = makeCoverageShortageFailures(currentPlaced, currentFailed);
        if (!coverageFailures.length) break;
        await updateProgress({
          percent: 86 + pass,
          step: `${labelPrefix} ${pass + 1}차`,
          detail: `카드 부족 ${coverage.shortCount || 0}개 · 부족시수 ${coverageFailures.length}시수를 이동복구 대상으로 다시 투입합니다.`,
          placed: currentPlaced.length,
          best: currentPlaced.length,
          failed: coverageFailures.length,
          currentCard: "카드시수 반복복구",
          log: `${labelPrefix}: 부족 ${coverageFailures.length}시수 재복구 시작`
        }, true);
        const repairBaseOptions = {
          ...(bestStage?.options || options),
          runAttempts: "deep",
          engineProfile: autoEngineProfileForMode("deep"),
          respectUnavailable: true,
          respectAssignedRoom: true
        };

        const twoCyclePack = await repairResidualByTwoCycleSwap(currentPlaced, [...currentFailed, ...coverageFailures], currentForced, `${labelPrefix} ${pass + 1}차 · 2단계스왑`);
        totalAttempts += Number(twoCyclePack?.repairedCount || 0);
        if (compareAutoRunResults(twoCyclePack.metrics, lastMetrics) < 0) {
          const repairedNow = Math.max(1, Number(twoCyclePack.repairedCount || 0));
          totalRepaired += repairedNow;
          currentPlaced = cloneAutoAssignData(twoCyclePack.placed) || [];
          currentFailed = [...(twoCyclePack.failed || [])];
          lastMetrics = twoCyclePack.metrics;
          await updateProgress({
            percent: 88 + pass,
            step: `${labelPrefix} 2단계 스왑개선`,
            detail: `실제 스왑복구로 ${repairedNow}건을 개선했습니다. 남은 카드 부족 ${currentFailed.length}개`,
            placed: currentPlaced.length,
            best: currentPlaced.length,
            failed: currentFailed.length,
            currentCard: "2단계 스왑복구",
            log: (twoCyclePack.moveLogs || []).join(" / ")
          }, true);
          if (!currentFailed.length) break;
          continue;
        }
        const tryRepairWithOptions = async (label, extraOptions = {}) => {
          const repair = await repairFailedItemsBySingleMove([...currentFailed, ...coverageFailures], baseSlots, currentPlaced, {
            ...repairBaseOptions,
            ...extraOptions
          }, updateProgress);
          const nextPlaced = repair.placed || currentPlaced;
          const nextCoverageInfo = makeCoverageShortageFailures(nextPlaced, repair.remaining || []);
          const nextFailed = nextCoverageInfo.failures;
          const nextMetrics = buildAutoRunMetricsForEntries([...protectedEntries, ...nextPlaced], activeGrades, nextFailed, {
            protectedEntries,
            placedCount: nextPlaced.length,
            forcedCount: currentForced.length,
            qualityScore: scoreScheduleQuality(nextPlaced, options),
            label
          }).metrics;
          return { repair, nextPlaced, nextFailed, nextMetrics };
        };

        let repairPack = await tryRepairWithOptions(`${labelPrefix} ${pass + 1}차`, { respectSoftLimits: true });
        totalAttempts += Number(repairPack.repair?.attempts || 0);
        // 엄격 복구가 개선되지 않으면, 교사 하루/연속 같은 소프트 제한만 완화해 한 번 더 탐색합니다.
        // 교사 불가시간·교실 불가시간·학급/교실/고정 충돌은 여전히 금지합니다.
        if (compareAutoRunResults(repairPack.nextMetrics, lastMetrics) >= 0) {
          const relaxedPack = await tryRepairWithOptions(`${labelPrefix} ${pass + 1}차 · 소프트완화`, { respectSoftLimits: false });
          totalAttempts += Number(relaxedPack.repair?.attempts || 0);
          if (compareAutoRunResults(relaxedPack.nextMetrics, repairPack.nextMetrics) < 0) repairPack = relaxedPack;
        }
        const repair = repairPack.repair;
        const nextPlaced = repairPack.nextPlaced;
        const nextFailed = repairPack.nextFailed;
        const nextMetrics = repairPack.nextMetrics;
        if (compareAutoRunResults(nextMetrics, lastMetrics) < 0) {
          const repairedNow = Math.max(0, (coverageFailures.length + currentFailed.length) - nextFailed.length);
          totalRepaired += repairedNow;
          currentPlaced = cloneAutoAssignData(nextPlaced) || [];
          currentFailed = [...nextFailed];
          lastMetrics = nextMetrics;
          await updateProgress({
            percent: 88 + pass,
            step: `${labelPrefix} 개선`,
            detail: `반복복구로 ${repairedNow}시수를 개선했습니다. 남은 카드 부족 ${currentFailed.length}개`,
            placed: currentPlaced.length,
            best: currentPlaced.length,
            failed: currentFailed.length,
            currentCard: "카드시수 반복복구",
            log: `${labelPrefix}: ${repairedNow}시수 개선, 남은 부족 ${currentFailed.length}`
          }, true);
          if (!currentFailed.length) break;
        } else {
          await updateProgress({
            percent: 88 + pass,
            step: `${labelPrefix} 보류`,
            detail: `반복복구 후보가 전체 검증 점수를 개선하지 못해 직전 상태를 유지합니다.`,
            placed: currentPlaced.length,
            best: currentPlaced.length,
            failed: currentFailed.length,
            currentCard: "카드시수 반복복구"
          }, true);
          break;
        }
      }
      return { placed: currentPlaced, failed: currentFailed, forced: currentForced, repairedCount: totalRepaired, attempts: totalAttempts, metrics: lastMetrics };
    };



    const forceResidualCardShortagesSafely = async (placed, failed, forced, labelPrefix = "잔여 카드 강제복구") => {
      // 마지막 잔여 카드만 대상으로 합니다. 기존 final repair보다 더 명시적으로
      // cardCoverage.shortRows를 다시 읽고, 안전 슬롯이 있는 경우 그 슬롯에 직접 삽입합니다.
      // strongProtected/동일카드/학급/교사/교실 hard conflict는 forcedSlotScore에서 계속 차단합니다.
      let currentPlaced = cloneAutoAssignData(placed || []) || [];
      let currentFailed = [...(failed || [])];
      let currentForced = [...(forced || [])];
      let totalForced = 0;
      for (let pass = 0; pass < 3; pass++) {
        const { coverage, failures } = makeCoverageShortageFailures(currentPlaced, currentFailed);
        if (!failures.length) break;
        let changed = 0;
        await updateProgress({
          percent: 92 + pass,
          step: `${labelPrefix} ${pass + 1}차`,
          detail: `남은 카드 부족 ${coverage.shortCount || 0}개 · ${failures.length}시수를 안전 슬롯에 직접 보정합니다.`,
          placed: currentPlaced.length,
          best: currentPlaced.length,
          failed: failures.length,
          currentCard: "잔여 카드 강제복구",
          log: `${labelPrefix}: ${failures.length}시수 직접 보정 시도`
        }, true);
        for (const failedItem of failures) {
          const item = failedItem?.item;
          if (!item) continue;
          const slot = findLeastBadSlot(item, baseSlots, currentPlaced, {
            ...(bestStage?.options || options),
            runAttempts: "deep",
            engineProfile: autoEngineProfileForMode("deep"),
            respectSoftLimits: false,
            respectUnavailable: true,
            respectAssignedRoom: true
          });
          const entry = slot ? makeAutoEntry(item, slot, currentPlaced) : null;
          if (!entry) continue;
          entry.autoForced = true;
          entry.autoRepairMode = "r30-card-completion";
          currentPlaced.push(entry);
          currentForced.push(failedItem);
          changed += 1;
          totalForced += 1;
          await yieldAutoAssign({
            percent: 93 + pass,
            step: `${labelPrefix} 중`,
            detail: `${failedItem.name || getAutoItemName(item)} 잔여 시수를 보정했습니다.`,
            placed: currentPlaced.length,
            best: currentPlaced.length,
            failed: Math.max(0, failures.length - changed),
            currentCard: failedItem.name || getAutoItemName(item)
          });
        }
        const next = makeCoverageShortageFailures(currentPlaced, []);
        currentFailed = next.failures;
        if (!changed) break;
      }
      const metrics = buildAutoRunMetricsForEntries([...protectedEntries, ...currentPlaced], activeGrades, currentFailed, {
        protectedEntries,
        placedCount: currentPlaced.length,
        forcedCount: currentForced.length,
        qualityScore: scoreScheduleQuality(currentPlaced, options),
        label: labelPrefix
      }).metrics;
      return { placed: currentPlaced, failed: currentFailed, forced: currentForced, forcedCount: totalForced, metrics };
    };

    // ── Repair pass ───────────────────────────────────────────────
    // Greedy 자동배치가 막힌 경우, 기존 자동배치 수업 1개를 다른 칸으로 옮겨
    // 미배치 수업을 넣을 수 있는지 먼저 탐색합니다.
    let swapRepaired = [];
    if (bestFailed.length && engineProfile.enableSwapRepair) {
      await updateProgress({
        percent: 82,
        step: "미배치 복구 탐색",
        detail: `미배치 후보 ${bestFailed.length}개를 기존 수업 이동/교환 방식으로 먼저 복구합니다.`,
        placed: bestPlaced.length,
        best: bestPlaced.length,
        failed: bestFailed.length,
        currentCard: "-",
        log: "Repair/Swap 1차 복구 단계 시작"
      }, true);
      const repair = await repairFailedItemsBySingleMove(bestFailed, baseSlots, bestPlaced, bestStage?.options || options, updateProgress);
      bestPlaced = repair.placed;
      bestFailed = repair.remaining;
      swapRepaired = repair.repaired || [];
      await updateProgress({
        percent: 84,
        step: "미배치 복구 완료",
        detail: `이동/교환으로 ${swapRepaired.length}개를 복구했습니다. 남은 후보 ${bestFailed.length}개`,
        placed: bestPlaced.length,
        best: bestPlaced.length,
        failed: bestFailed.length,
        currentCard: "-",
        log: `Repair/Swap 복구 ${swapRepaired.length}건`
      }, true);
    } else if (bestFailed.length) {
      await updateProgress({
        percent: 84,
        step: "미배치 복구 건너뜀",
        detail: `${engineProfile.label}에서는 속도를 위해 이동/교환 복구를 건너뜁니다. 남은 후보 ${bestFailed.length}개`,
        placed: bestPlaced.length,
        best: bestPlaced.length,
        failed: bestFailed.length,
        currentCard: "-",
        log: "빠른 배치: Repair/Swap 단계 생략"
      }, true);
    }

    // ── Final repair pass ─────────────────────────────────────────
    // 그래도 못 넣은 카드는 최소 충돌 보정 배치를 시도합니다.
    // 단, 보호 슬롯·동일 카드 중복·교사 중복·학급 중복·교실 중복은 만들지 않습니다.
    // 배치 가능한 안전 슬롯이 없으면 무리하게 겹쳐 넣지 않고 미배치로 남깁니다.
    await updateProgress({
      percent: 85,
      step: "미배치 보정 준비",
      detail: `남은 미배치 후보 ${bestFailed.length}개를 최소 충돌 위치에 보정 배치합니다.`,
      placed: bestPlaced.length,
      best: bestPlaced.length,
      failed: bestFailed.length,
      currentCard: "-",
      log: bestFailed.length ? "보정 배치 단계 시작" : "보정 배치 대상 없음"
    }, true);

    let forcedPlaced = [];
    const stillFailed = [];
    if (engineProfile.enableFinalRepair && bestFailed.length) {
      const limit = Number.isFinite(engineProfile.finalRepairLimit) ? engineProfile.finalRepairLimit : bestFailed.length;
      const repairTargets = bestFailed.slice(0, limit);
      const deferredTargets = bestFailed.slice(limit);
      for (const failedItem of repairTargets) {
        const item = failedItem.item;
        if (!item) {
          stillFailed.push(failedItem);
          continue;
        }
        const slot = findLeastBadSlot(item, baseSlots, bestPlaced, { ...options, runAttempts: options.runAttempts, engineProfile });
        const entry = slot ? makeAutoEntry(item, slot, bestPlaced) : null;
        if (entry) {
          entry.autoForced = true;
          bestPlaced.push(entry);
          forcedPlaced.push(failedItem);
        } else {
          stillFailed.push(failedItem);
        }
        await yieldAutoAssign({
          percent: 86 + Math.min(9, forcedPlaced.length + stillFailed.length),
          step: "미배치 보정 중",
          detail: `${failedItem.name || "카드"} 보정 배치 결과를 반영하고 있습니다.`,
          placed: bestPlaced.length,
          best: bestPlaced.length,
          failed: stillFailed.length + deferredTargets.length,
          currentCard: failedItem.name || "보정 대상"
        }, true);
      }
      stillFailed.push(...deferredTargets);
      if (deferredTargets.length) {
        await updateProgress({
          percent: 90,
          step: "미배치 보정 제한",
          detail: `${engineProfile.label}에서는 속도를 위해 보정 배치 ${repairTargets.length}개까지만 시도하고 ${deferredTargets.length}개는 미배치로 남깁니다.`,
          placed: bestPlaced.length,
          best: bestPlaced.length,
          failed: stillFailed.length,
          currentCard: "-"
        }, true);
      }
    } else {
      stillFailed.push(...bestFailed);
    }
    bestFailed = stillFailed;

    const iterativeCoverageRepair = await repairCardCoverageShortagesIteratively(bestPlaced, bestFailed, forcedPlaced, "최종 카드시수 반복복구");
    if (compareAutoRunResults(iterativeCoverageRepair.metrics, buildAutoRunMetricsForEntries([...protectedEntries, ...bestPlaced], activeGrades, bestFailed, {
      protectedEntries,
      placedCount: bestPlaced.length,
      forcedCount: forcedPlaced.length,
      qualityScore: scoreScheduleQuality(bestPlaced, options),
      label: "반복복구 전"
    }).metrics) < 0) {
      bestPlaced = iterativeCoverageRepair.placed;
      bestFailed = iterativeCoverageRepair.failed;
      forcedPlaced = iterativeCoverageRepair.forced;
      swapRepaired.push(...Array.from({ length: Math.max(0, Number(iterativeCoverageRepair.repairedCount || 0)) }, (_, i) => ({ name: `카드시수 반복복구 ${i + 1}` })));
      considerAutoCandidate("최종 카드시수 반복복구", bestPlaced, bestFailed, forcedPlaced, scoreScheduleQuality(bestPlaced, options));
    }

    const hardResidualRepair = await forceResidualCardShortagesSafely(bestPlaced, bestFailed, forcedPlaced, "r30 잔여 카드 완성복구");
    if (compareAutoRunResults(hardResidualRepair.metrics, buildAutoRunMetricsForEntries([...protectedEntries, ...bestPlaced], activeGrades, bestFailed, {
      protectedEntries,
      placedCount: bestPlaced.length,
      forcedCount: forcedPlaced.length,
      qualityScore: scoreScheduleQuality(bestPlaced, options),
      label: "r30 잔여복구 전"
    }).metrics) < 0) {
      bestPlaced = hardResidualRepair.placed;
      bestFailed = hardResidualRepair.failed;
      forcedPlaced = hardResidualRepair.forced;
      if (Number(hardResidualRepair.forcedCount || 0)) {
        swapRepaired.push(...Array.from({ length: Number(hardResidualRepair.forcedCount || 0) }, (_, i) => ({ name: `r30 잔여 카드 완성복구 ${i + 1}` })));
      }
      considerAutoCandidate("r30 잔여 카드 완성복구", bestPlaced, bestFailed, forcedPlaced, scoreScheduleQuality(bestPlaced, options));
    }

    await updateProgress({
      percent: 91,
      step: "자동배치 후처리",
      detail: `배치된 수업을 안전하게 재배치해 설정한 점수 기준을 개선합니다. (${describeScoreWeights(options.scoringWeights)})`,
      placed: bestPlaced.length,
      best: bestPlaced.length,
      failed: bestFailed.length,
      currentCard: "후처리",
      log: "자동배치 후처리 단계 시작"
    }, true);

    const beforePostProcessPlaced = cloneAutoAssignData(bestPlaced) || [];
    const beforePostProcessFailed = [...bestFailed];
    const beforePostProcessForced = [...forcedPlaced];
    const beforePostProcessMetrics = considerAutoCandidate("보정/복구 후", bestPlaced, bestFailed, forcedPlaced, scoreScheduleQuality(bestPlaced, options));
    let improvement = await improveAutoPlacement(bestPlaced, baseSlots, { ...options, engineProfile }, updateProgress);
    bestPlaced = improvement.placed;
    const afterPostProcessMetrics = buildAutoRunMetricsForEntries([...protectedEntries, ...bestPlaced], activeGrades, bestFailed, {
      protectedEntries,
      placedCount: bestPlaced.length,
      forcedCount: forcedPlaced.length,
      qualityScore: improvement.qualityScore,
      label: "후처리 결과"
    }).metrics;
    if (compareAutoRunResults(afterPostProcessMetrics, beforePostProcessMetrics) > 0) {
      bestPlaced = beforePostProcessPlaced;
      bestFailed = beforePostProcessFailed;
      forcedPlaced = beforePostProcessForced;
      improvement = { ...improvement, placed: bestPlaced, improvedCount: 0, revertedByQualityGate: true };
      await updateProgress({
        percent: 95,
        step: "후처리 결과 폐기",
        detail: `후처리 후 검증 점수가 나빠져 이전 복구 결과로 되돌렸습니다. (${formatAutoRunMetricSummary(beforePostProcessMetrics)})`,
        placed: bestPlaced.length,
        best: bestPlaced.length,
        failed: bestFailed.length,
        currentCard: "품질 게이트",
        log: `후처리 결과 폐기 · ${formatAutoRunMetricSummary(afterPostProcessMetrics)} → ${formatAutoRunMetricSummary(beforePostProcessMetrics)}`
      }, true);
    } else {
      considerAutoCandidate("후처리 결과", bestPlaced, bestFailed, forcedPlaced, improvement.qualityScore);
    }

    const finalCandidateMetrics = buildAutoRunMetricsForEntries([...protectedEntries, ...bestPlaced], activeGrades, bestFailed, {
      protectedEntries,
      placedCount: bestPlaced.length,
      forcedCount: forcedPlaced.length,
      qualityScore: improvement.qualityScore,
      label: "최종 후보"
    }).metrics;
    if (compareAutoRunResults(finalCandidateMetrics, acceptedMetrics) > 0) {
      bestPlaced = cloneAutoAssignData(acceptedPlaced) || [];
      bestFailed = [...acceptedFailed];
      forcedPlaced = [...acceptedForced];
      improvement = { ...improvement, placed: bestPlaced, improvedCount: 0, revertedToAccepted: acceptedLabel };
      await updateProgress({
        percent: 95,
        step: "최선 결과 복원",
        detail: `복구/후처리 과정에서 전체 검증 점수가 나빠져 ${acceptedLabel}로 복원했습니다. (${formatAutoRunMetricSummary(acceptedMetrics)})`,
        placed: bestPlaced.length,
        best: bestPlaced.length,
        failed: bestFailed.length,
        currentCard: "품질 게이트",
        log: `최선 결과 복원: ${formatAutoRunMetricSummary(finalCandidateMetrics)} → ${formatAutoRunMetricSummary(acceptedMetrics)}`
      }, true);
    }

    const residualCoverageInfoForDiagnostics = makeCoverageShortageFailures(bestPlaced, bestFailed);
    let residualFailedItemsForDiagnostics = residualCoverageInfoForDiagnostics.failures?.length
      ? residualCoverageInfoForDiagnostics.failures
      : bestFailed;
    let failedDiagnostics = buildFailureDiagnostics(residualFailedItemsForDiagnostics, baseSlots, bestPlaced, bestStage?.options || stages[0].options);
    let residualPuzzleReport = buildResidualPuzzleReport(residualFailedItemsForDiagnostics, baseSlots, bestPlaced, bestStage?.options || stages[0].options);

    await updateProgress({
      percent: 96,
      step: "결과 반영",
      detail: improvement.improvedCount
        ? `후처리 개선 ${improvement.improvedCount}건을 반영하고 충돌을 재계산합니다.`
        : "배치 결과를 시간표에 반영하고 충돌을 재계산합니다.",
      placed: bestPlaced.length,
      best: bestPlaced.length,
      failed: bestFailed.length,
      currentCard: "-"
    }, true);

    if (autoAssignCancelled || progress?.isCancelled?.()) throw new Error("__AUTO_ASSIGN_CANCELLED__");

    const names = [...new Set(bestFailed.map(f => f.name))];
    const finalEntriesForValidation = [...protectedEntries, ...bestPlaced];
    const postValidation = buildScheduleVerificationReport(finalEntriesForValidation, {
      scopeGrades: activeGrades,
      protectedEntries,
      failedNames: names,
      failedDiagnostics
    });
    let finalAutoRunMetrics = buildAutoRunMetricsFromValidation(postValidation, {
      label: "최종 결과",
      placedCount: bestPlaced.length,
      failedCount: names.length,
      forcedCount: forcedPlaced.length,
      qualityScore: improvement.qualityScore
    });

    // r28: 새 전체 배치가 이전 최고보다 나쁠 때도 바로 폐기하지 않고,
    // 이전 최고 보관본 자체를 기준으로 카드시수 반복복구를 한 번 더 시도합니다.
    // 목표는 이전 최고 상태를 출발점으로 삼아 남은 9~10개 미배치 단위를 실제로 줄이는 것입니다.
    let baselineRepairAdopted = false;
    if (compareAutoRunResults(finalAutoRunMetrics, qualityBaselineMetrics) > 0 && (qualityBaselineReference?.source === "savedSchedule" || qualityBaselineReference?.source === "bestSnapshot") && Array.isArray(qualityBaselineReference.entries)) {
      const baselineAll = normalizeSnapshotEntries(qualityBaselineReference.entries) || [];
      const protectedIds = new Set((protectedEntries || []).map(e => e.id).filter(Boolean));
      const baselineAutoPlaced = baselineAll.filter(e => !protectedIds.has(e.id));
      const baselineCoverageInfo = makeCoverageShortageFailures(baselineAutoPlaced, []);
      if (baselineCoverageInfo.failures.length) {
        await updateProgress({
          percent: 96,
          step: "이전 최고 결과 직접복구",
          detail: `새 결과가 기준보다 나빠, 이전 최고 보관본의 남은 카드 부족 ${baselineCoverageInfo.failures.length}시수를 직접 복구합니다.`,
          placed: baselineAutoPlaced.length,
          best: baselineAutoPlaced.length,
          failed: baselineCoverageInfo.failures.length,
          currentCard: "이전 최고 직접복구",
          log: "이전 최고 보관본 기준 반복복구 시작"
        }, true);
        const baselineRepair = await repairCardCoverageShortagesIteratively(baselineAutoPlaced, baselineCoverageInfo.failures, [], "이전최고 직접복구");
        const baselineRepairValidation = buildScheduleVerificationReport([...protectedEntries, ...baselineRepair.placed], {
          scopeGrades: activeGrades,
          protectedEntries,
          failedNames: [...new Set((baselineRepair.failed || []).map(f => f.name))],
          failedDiagnostics: buildFailureDiagnostics(baselineRepair.failed || [], baseSlots, baselineRepair.placed, bestStage?.options || options)
        });
        const baselineRepairMetrics = buildAutoRunMetricsFromValidation(baselineRepairValidation, {
          label: "이전 최고 직접복구 결과",
          placedCount: baselineRepair.placed.length,
          failedCount: [...new Set((baselineRepair.failed || []).map(f => f.name))].length,
          forcedCount: 0,
          qualityScore: scoreScheduleQuality(baselineRepair.placed, options)
        });
        if (compareAutoRunResults(baselineRepairMetrics, qualityBaselineMetrics) < 0 && compareAutoRunResults(baselineRepairMetrics, finalAutoRunMetrics) <= 0) {
          bestPlaced = baselineRepair.placed;
          bestFailed = baselineRepair.failed || [];
          forcedPlaced = baselineRepair.forced || [];
          names.length = 0;
          names.push(...new Set(bestFailed.map(f => f.name)));
          residualFailedItemsForDiagnostics = (makeCoverageShortageFailures(bestPlaced, bestFailed).failures || []).length
            ? makeCoverageShortageFailures(bestPlaced, bestFailed).failures
            : bestFailed;
          failedDiagnostics = buildFailureDiagnostics(residualFailedItemsForDiagnostics, baseSlots, bestPlaced, bestStage?.options || options);
          residualPuzzleReport = buildResidualPuzzleReport(residualFailedItemsForDiagnostics, baseSlots, bestPlaced, bestStage?.options || options);
          finalEntriesForValidation.length = 0;
          finalEntriesForValidation.push(...protectedEntries, ...bestPlaced);
          Object.assign(postValidation, baselineRepairValidation);
          finalAutoRunMetrics = baselineRepairMetrics;
          baselineRepairAdopted = true;
        }
      }
    }
    const rejectWorseThanBaseline = !baselineRepairAdopted && compareAutoRunResults(finalAutoRunMetrics, qualityBaselineMetrics) > 0;
    if (rejectWorseThanBaseline) {
      const restoreSource = (qualityBaselineReference?.source === "savedSchedule" || qualityBaselineReference?.source === "bestSnapshot") ? qualityBaselineReference.entries : rollbackEntriesSnapshot;
      ttDomain().entries = normalizeSnapshotEntries(restoreSource || rollbackEntriesSnapshot) || [];
      await persistTimetableNow();
      recomputeConflicts();
      renderAll();
      const restoredAllForDiagnostics = normalizeSnapshotEntries(restoreSource || rollbackEntriesSnapshot) || [];
      const restoredProtectedIdsForDiagnostics = new Set((protectedEntries || []).map(e => e.id).filter(Boolean));
      const restoredAutoPlacedForDiagnostics = restoredAllForDiagnostics.filter(e => !restoredProtectedIdsForDiagnostics.has(e.id));
      const restoredCoverageForDiagnostics = makeCoverageShortageFailures(restoredAutoPlacedForDiagnostics, []);
      const restoredFailedItemsForDiagnostics = restoredCoverageForDiagnostics.failures || [];
      const restoredFailedDiagnostics = buildFailureDiagnostics(restoredFailedItemsForDiagnostics, baseSlots, restoredAutoPlacedForDiagnostics, bestStage?.options || options);
      const restoredResidualPuzzleReport = buildResidualPuzzleReport(restoredFailedItemsForDiagnostics, baseSlots, restoredAutoPlacedForDiagnostics, bestStage?.options || options);
      const rejectReport = {
        ts: Date.now(),
        rejectedByQualityGate: true,
        reason: "새 자동배치 결과가 이전 최고 자동배치 결과보다 검증 점수가 나빠 반영하지 않았습니다.",
        rejectReason: "worse-than-complete-best-snapshot",
        activeGrades: activeGrades.map(gradeDisplay).join(", "),
        placementModeLabel: modeText,
        beforeValidation: preValidation,
        referenceValidation: qualityBaselineValidation,
        rejectedValidation: postValidation,
        validationSummary: qualityBaselineValidation.summary || "이전 최고 결과 유지",
        beforeMetrics: baselineAutoRunMetrics,
        currentBeforeMetrics: baselineAutoRunMetrics,
        referenceMetrics: qualityBaselineMetrics,
        rejectedMetrics: finalAutoRunMetrics,
        baselineMetrics: qualityBaselineMetrics,
        finalMetrics: qualityBaselineMetrics,
        classSlotIssueCount: Number(qualityBaselineMetrics.classSlotIssueCount || 0),
        classIssueCount: Number(qualityBaselineMetrics.classSlotIssueCount || 0),
        classShortCount: Number(qualityBaselineMetrics.classShortCount || 0),
        classOverCount: Number(qualityBaselineMetrics.classOverCount || 0),
        cardCoverageIssueCount: Number(qualityBaselineMetrics.cardCoverageIssueCount || 0),
        groupCoverageIssueCount: Number(qualityBaselineMetrics.groupCoverageIssueCount || 0),
        failedCount: Number(qualityBaselineMetrics.failedCount || 0),
        failedUnitCount: Number(qualityBaselineMetrics.failedCount || 0),
        cardShortageSlots: Number(qualityBaselineMetrics.cardShortageSlots || 0),
        restrictedTeacherIssueCount: Number(qualityBaselineMetrics.restrictedTeacherIssueCount || 0),
        protectedIntrusionCount: Number(qualityBaselineMetrics.protectedIntrusionCount || 0),
        missingRoomCount: Number(qualityBaselineMetrics.missingRoomCount || 0),
        metricSource: "qualityBaseline",
        metricCompleteness: "complete",
        qualityBaselineSource: qualityBaselineReference?.source || "current",
        qualityBaselineSnapshotName: qualityBaselineReference?.name || "자동배치 전 현재 시간표",
        qualityBaselineValidationSummary: qualityBaselineValidation.summary || "",
        restoredFromReference: qualityBaselineReference?.source === "savedSchedule" || qualityBaselineReference?.source === "bestSnapshot",
        comparisonSummary: `${qualityBaselineValidation.summary || "이전 최고 상태"} 유지 · 폐기 후보: ${postValidation.summary || "결과 상태"}`,
        failedDiagnostics: restoredFailedDiagnostics,
        failedReasonSummary: restoredFailedDiagnostics.slice(0, 8).map(d => `${d.name}: ${d.summary}${d.suggestionSummary ? ` / 제안: ${d.suggestionSummary}` : ""}`),
        residualPuzzleReport: restoredResidualPuzzleReport
      };
      if (appState.timetable) appState.timetable.autoAssignMeta = rejectReport;
      setLastAutoAssignReport(rejectReport);
      addTimetableLog(
        "warn",
        "자동배치 결과 폐기",
        `새 결과가 이전 최고 결과보다 나빠 반영하지 않았습니다. 기준: ${qualityBaselineReference?.name || "현재 시간표"} · ${formatAutoRunMetricSummary(qualityBaselineMetrics)} / 폐기: ${formatAutoRunMetricSummary(finalAutoRunMetrics)}`
      );
      await progress.complete({
        partial: true,
        title: "자동배치 결과 폐기",
        subtitle: (qualityBaselineReference?.source === "savedSchedule" || qualityBaselineReference?.source === "bestSnapshot") ? "이전 최고 자동배치 결과가 더 좋아 그 보관본으로 복원했습니다." : "기존 시간표가 더 좋아 새 자동배치 결과를 반영하지 않았습니다.",
        step: "결과 폐기",
        detailHtml: [
          `<div><b>품질 기준</b> ${safeAutoHtml(qualityBaselineReference?.name || "현재 시간표")}</div>`,
          `<div><b>기준 상태</b> ${safeAutoHtml(qualityBaselineValidation.summary || "검증 정보 없음")}</div>`,
          `<div><b>폐기된 결과</b> ${safeAutoHtml(postValidation.summary || "검증 정보 없음")}</div>`,
          `<div><b>기준 점수</b> ${safeAutoHtml(formatAutoRunMetricSummary(qualityBaselineMetrics))}</div>`,
          `<div><b>폐기 점수</b> ${safeAutoHtml(formatAutoRunMetricSummary(finalAutoRunMetrics))}</div>`,
          `<div>새 자동배치가 이전 최고 자동배치 결과보다 카드/학급/미배치 검증 점수가 나빠 저장하지 않았습니다.</div>`,
          residualPuzzleReportToHtml(restoredResidualPuzzleReport, 5)
        ].filter(Boolean).join(""),
        placed: 0,
        best: 0,
        failed: names.length,
        currentCard: "품질 게이트",
        closeLabel: "확인"
      });
      return;
    }

    bestPlaced.forEach(e => entries().push(e));
    let afterAutoSnapshot = null;
    // r34: 결과 보관본은 finalMetrics가 들어간 report 생성 후 저장합니다.
    // r33까지는 validationSummary만 가진 보관본이 먼저 저장되어 bestAutoAssignSnapshot의 수치가 0으로 압축될 수 있었습니다.
    recomputeConflicts();

    const missingRoomEntries = bestPlaced.filter(e => !e.roomId && String(e.roomRule || "auto").trim() !== "none");
    const missingRoomNames = [...new Set(missingRoomEntries.map(e => getAutoItemName(e)))];
    const outcomeAnalysis = summarizeAutoAssignOutcome({
      placedEntries: bestPlaced,
      failedItems: bestFailed,
      forcedEntries: forcedPlaced,
      protectedEntries,
      missingRoomEntries
    });
    const conflictSummary = getConflictCounts();
    const report = {
      ts: Date.now(),
      activeGrades: activeGrades.map(gradeDisplay).join(", "),
      stageName: bestStage.name,
      stageLabel: bestStage.label,
      totalTarget: autoTargetSlots,
      pinnedCount: pinnedEntries.filter(e => e.pinned).length,
      protectedCount: protectedEntries.length,
      protectedSlotCount: protectedSummary.slots,
      protectedManualCount: protectedSummary.manual,
      clearedCount: willClearCount,
      placementMode: options.placementMode,
      placementModeLabel: modeText,
      selectedGrades: activeGrades.map(gradeDisplay).join(", "),
      runAttempts: options.runAttempts,
      engineProfileLabel: engineProfile.label,
      keepPinned: options.keepPinned !== false,
      keepManual: options.keepManual !== false,
      placedCount: bestPlaced.length,
      forcedCount: forcedPlaced.length,
      postProcessImprovedCount: improvement.improvedCount,
      postProcessAttempts: improvement.attempts,
      postProcessQualityScore: improvement.qualityScore,
      scoringProfile: options.scoringProfile || "balanced",
      scoringWeights: options.scoringWeights,
      scoringSummary: describeScoreWeights(options.scoringWeights),
      initialRunCount: exploredInitialRuns,
      initialBestQualityScore: bestQualityScore,
      initialBestAttemptInfo: bestAttemptInfo,
      failedCount: names.length,
      failedNames: names,
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
      forcedNames: [...new Set(forcedPlaced.map(f => f.name))],
      durationMs: Date.now() - autoStartedAt,
      conflictTotal: conflictSummary.totalAffected,
      conflictCounts: conflictSummary.counts,
      preValidation,
      postValidation,
      comparisonSummary: `${preValidation.summary || "이전 상태"} → ${postValidation.summary || "결과 상태"}`,
      validationSummary: postValidation.summary,
      validationOk: postValidation.ok,
      metricSource: "postValidation",
      metricCompleteness: "complete",
      classSlotIssueCount: postValidation.classSlots?.issueCount || 0,
      cardCoverageIssueCount: postValidation.cardCoverage?.issueCount || 0,
      cardShortCount: postValidation.cardCoverage?.shortCount || 0,
      cardOverCount: postValidation.cardCoverage?.overCount || 0,
      cardShortageSlots: (postValidation.cardCoverage?.shortRows || []).reduce((sum, row) => sum + Math.max(0, -Number(row.diff || 0)), 0),
      restrictedTeacherIssueCount: postValidation.restrictedTeachers?.issueCount || 0,
      protectedIntrusionCount: postValidation.protectedIntrusions?.total || 0,
      missingRoomCount: missingRoomEntries.length,
      missingRoomNames,
      restrictedTeacherCount: restrictedTeacherNames.length,
      restrictedTeacherNames,
      restrictedStandaloneCount,
      restrictedGroupCount,
      beforeSnapshotName: beforeAutoSnapshot?.name || "",
      afterSnapshotName: afterAutoSnapshot?.name || "",
      selectedAcceptedLabel: acceptedLabel,
      acceptedMetrics,
      finalMetrics: finalAutoRunMetrics,
      baselineMetrics: qualityBaselineMetrics,
      currentBeforeMetrics: baselineAutoRunMetrics,
      qualityBaselineSource: qualityBaselineReference?.source || "current",
      qualityBaselineSnapshotName: qualityBaselineReference?.name || "자동배치 전 현재 시간표",
      qualityBaselineValidationSummary: qualityBaselineValidation.summary || "",
      qualityGate: {
        postProcessReverted: !!improvement.revertedByQualityGate,
        revertedToAccepted: improvement.revertedToAccepted || "",
        acceptedLabel
      }
    };
    report.metricSource = "postValidation";
    report.metricCompleteness = "complete";
    afterAutoSnapshot = saveAutoAssignScheduleSnapshot("result", entries(), report);
    report.afterSnapshotName = afterAutoSnapshot?.name || "";
    if (appState.timetable) appState.timetable.autoAssignMeta = compactAutoAssignSnapshotMeta(report);
    if (afterAutoSnapshot) {
      try {
        afterAutoSnapshot.autoAssignMeta = compactAutoAssignSnapshotMeta(report);
        afterAutoSnapshot.note = [
          "자동 생성된 배치 보관본입니다.",
          activeGrades.length ? `대상: ${activeGrades.map(gradeDisplay).join(", ")}` : "",
          modeText ? `방식: ${modeText}` : "",
          report.validationSummary ? `검증: ${report.validationSummary}` : ""
        ].filter(Boolean).join(" / ");
        updateBestAutoAssignSnapshot(ttDomain(), afterAutoSnapshot);
        pruneAutoAssignSnapshots(ttDomain());
      } catch (_) {
        afterAutoSnapshot.autoAssignMeta = compactAutoAssignSnapshotMeta(report);
      }
    }
    await persistTimetableNow();
    setLastAutoAssignReport(report);
    addTimetableLog(
      "auto",
      names.length ? "자동 배치 부분 완료" : "자동 배치 완료",
      `정상 배치 ${bestPlaced.length - forcedPlaced.length}개, 이동/교환 복구 ${swapRepaired.length}개, 보정 배치 ${forcedPlaced.length}개, 후처리 개선 ${improvement.improvedCount}건, 미배치 ${names.length}개, 교실 미배정 ${missingRoomEntries.length}개, 충돌 ${conflictSummary.totalAffected}건 · ${modeText} · 초기후보 ${exploredInitialRuns}회 · 탐색: ${bestStage.label}`
    );
    addTimetableLog(
      outcomeAnalysis.failedUnitCount ? "warn" : "auto",
      "자동배치 결과 분석",
      `수업 블록 ${outcomeAnalysis.placedBlockCount}개(그룹 ${outcomeAnalysis.placedGroupBlockCount}, 일반 ${outcomeAnalysis.placedStandaloneBlockCount}) · 배치 카드 ${outcomeAnalysis.placedCardCount}개 · 미배치 유닛 ${outcomeAnalysis.failedUnitCount}개 / ${outcomeAnalysis.failedOccurrenceCount}회차`
    );
    if (afterAutoSnapshot) {
      addTimetableLog("auto", "자동배치 결과 배치 보관", `${afterAutoSnapshot.name}으로 결과 배치를 저장했습니다. [배치 보관]에서 비교/복구할 수 있습니다.`);
    }
    if (missingRoomEntries.length) {
      addTimetableLog(
        "warn",
        "교실 미배정 수업 확인 필요",
        `${missingRoomNames.slice(0, 12).join(", ")}${missingRoomNames.length > 12 ? ` 외 ${missingRoomNames.length - 12}개` : ""}`
      );
    }
    renderAll();

    const detailLines = [
      `<b>정상 배치</b> ${bestPlaced.length - forcedPlaced.length}개`,
      `<b>이동/교환 복구</b> ${swapRepaired.length}개`,
      `<b>보정 배치</b> ${forcedPlaced.length}개`,
      `<b>후처리 개선</b> ${improvement.improvedCount}건`,
      `<b>미배치</b> ${names.length}개`,
      `<b>교실 미배정</b> ${missingRoomEntries.length}개`,
      `<b>충돌 표시 대상</b> ${conflictSummary.totalAffected}건`,
      `<b>검증 결과</b> ${postValidation.ok ? "통과" : postValidation.summary}`,
      `<b>학급 시수</b> ${postValidation.classSlots?.total ?? "-"}/${postValidation.classSlots?.targetTotal ?? "-"}시수`,
      `<b>배치 방식</b> ${modeText}`,
      beforeAutoSnapshot ? `<b>자동 보관</b> 전: ${safeAutoHtml(beforeAutoSnapshot.name)} / 결과: ${safeAutoHtml(afterAutoSnapshot?.name || "저장 실패")}` : null,
      `<b>탐색 방식</b> ${bestStage.label}`,
      `<b>초기배치 후보</b> ${exploredInitialRuns}회 중 ${bestAttemptInfo.stageLabel} ${bestAttemptInfo.attempt}/${bestAttemptInfo.totalAttempts} 선택 · ${bestAttemptInfo.exploration} · 품질 ${bestAttemptInfo.qualityScore ?? "-"}`,
      `<b>보호된 기존 배치</b> ${protectedEntries.length}개`,
      `<b>고정/보호 슬롯 제외</b> ${protectedSummary.slots}칸`,
      restrictedTeacherNames.length ? `<b>제약교사 우선 배치</b> ${restrictedTeacherNames.join(", ")} · 일반 ${restrictedStandaloneCount}개 / 그룹 ${restrictedGroupCount}개` : null,
      `<b>소요 시간</b> ${Math.round((Date.now() - autoStartedAt) / 1000)}초`
    ];
    detailLines.push(buildAutoAssignComparisonHtml(preValidation, postValidation));
    detailLines.push(buildAutoAssignOutcomeHtml(outcomeAnalysis));
    if (!postValidation.ok) {
      const issueRows = postValidation.classSlots?.issues || [];
      const classList = issueRows.slice(0, 10)
        .map(row => `<li>${formatClassKeyForReport(row.key)}: ${row.count}/${row.target}시수 (${row.diff < 0 ? Math.abs(row.diff) + " 부족" : row.diff + " 초과"})</li>`)
        .join("");
      const moreClass = issueRows.length > 10 ? `<li>외 ${issueRows.length - 10}개 학급</li>` : "";
      const restrictedList = (postValidation.restrictedTeachers?.issues || []).slice(0, 8)
        .map(row => `<li>${row.teacher}: ${row.issueParts.join(", ")}</li>`)
        .join("");
      const cardList = (postValidation.cardCoverage?.shortRows || []).slice(0, 10)
        .map(row => `<li>카드 부족 · ${String(row.title).replace(/[<>&]/g, ch => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[ch]))}${row.classLabels?.length ? ` ${String(row.classLabels.join(", ")).replace(/[<>&]/g, ch => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[ch]))}` : ""}: ${row.count}/${row.target}시수</li>`)
        .join("");
      const groupList = (postValidation.groupCoverage?.rows || []).slice(0, 8)
        .map(row => `<li>그룹/묶음 · ${String(row.name).replace(/[<>&]/g, ch => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[ch]))}: 문제 카드 ${row.issueCount}개${row.samples?.length ? ` (${String(row.samples.slice(0, 2).join(" / ")).replace(/[<>&]/g, ch => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[ch]))})` : ""}</li>`)
        .join("");
      const protectedList = (postValidation.protectedIntrusions?.samples || []).slice(0, 6)
        .map(text => `<li>${String(text).replace(/[<>&]/g, ch => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[ch]))}</li>`)
        .join("");
      detailLines.push(`<div class="tt-auto-progress-failed"><b>검증 리포트</b><ul>${classList}${moreClass}${cardList}${groupList}${restrictedList}${protectedList}</ul></div>`);
    }
    detailLines.push(residualPuzzleReportToHtml(residualPuzzleReport, 6));
    if (forcedPlaced.length) {
      detailLines.push(`⚠️ ${forcedPlaced.length}개는 미배치 방지를 위해 최소 충돌 위치에 보정 배치했습니다. 충돌 색상과 상세창을 확인해 주세요.`);
    }
    if (missingRoomEntries.length) {
      const missingList = missingRoomNames.slice(0, 12)
        .map(name => `<li>${String(name).replace(/[<>&]/g, ch => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[ch]))}</li>`)
        .join("");
      const moreMissing = missingRoomNames.length > 12 ? `<li>외 ${missingRoomNames.length - 12}개</li>` : "";
      detailLines.push(`<div class="tt-auto-progress-failed"><b>교실 미배정</b><ul>${missingList}${moreMissing}</ul></div>`);
    }
    if (names.length) {
      const failedList = names.slice(0, 12)
        .map(name => `<li>${String(name).replace(/[<>&]/g, ch => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[ch]))}</li>`)
        .join("");
      const moreFailed = names.length > 12 ? `<li>외 ${names.length - 12}개</li>` : "";
      detailLines.push(`<div class="tt-auto-progress-failed"><b>남은 카드</b><ul>${failedList}${moreFailed}</ul></div>`);
      detailLines.push(diagnosticsToHtml(failedDiagnostics, 8));
      detailLines.push(`남은 카드는 원인 후보와 함께 표시된 <b>풀어볼 조건</b>부터 조정해 주세요. 교사 제약, 고정 수업, 교실 조건 중 최소 변경으로 열리는 후보 시간을 우선 제안합니다.`);
    }
    detailLines.push(`자세한 결과는 하단 <b>로그</b> 탭에서 확인할 수 있습니다.`);

    await progress.complete({
      partial: !!names.length || !postValidation.ok,
      title: names.length || !postValidation.ok ? "자동배치 확인 필요" : "자동배치 완료",
      subtitle: names.length ? "일부 카드는 직접 확인이 필요합니다." : (!postValidation.ok ? "배치는 완료되었지만 검증 항목 확인이 필요합니다." : "모든 대상 슬롯을 배치했고 검증을 통과했습니다."),
      step: names.length || !postValidation.ok ? "확인 필요" : "완료",
      detailHtml: detailLines.filter(Boolean).map(line => `<div>${line}</div>`).join(""),
      placed: bestPlaced.length,
      best: bestPlaced.length,
      failed: names.length,
      currentCard: "-",
      closeLabel: "적용하고 닫기",
      actions: [{
        label: "되돌리기",
        danger: true,
        onClick: async ({ close, button }) => {
          if (rollbackConsumed) return;
          if (!confirm("이번 자동배치 결과를 되돌리고, 자동배치 전 시간표로 복원할까요?")) return;
          rollbackConsumed = true;
          if (button) { button.disabled = true; button.textContent = "되돌리는 중..."; }
          ttDomain().entries = cloneAutoAssignData(rollbackEntriesSnapshot) || [];
          await persistTimetableNow();
          recomputeConflicts();
          renderAll();
          addTimetableLog("undo", "자동배치 결과 되돌리기", "자동배치 전 시간표 상태로 복원했습니다.");
          setLastAutoAssignReport({ ...report, rolledBack: true, rolledBackAt: Date.now() });
          close?.();
        }
      }]
    });
    } catch (err) {
      if (err?.message === "__AUTO_ASSIGN_CANCELLED__") {
        addTimetableLog("auto", "자동 배치 취소", "사용자 요청으로 자동배치를 중단했습니다. 시간표에는 변경 사항을 반영하지 않았습니다.");
        if (progress) await progress.cancel("사용자 요청으로 자동배치를 중단했습니다. 시간표에는 변경 사항을 반영하지 않았습니다.");
      } else {
        console.error("Auto assign failed:", err);
        addTimetableLog("error", "자동 배치 오류", err?.message || String(err));
        if (progress) {
          await progress.error(`자동 배치 중 오류가 발생했습니다. ${err?.message || String(err)} 하단 [로그] 탭과 콘솔 로그를 확인해 주세요.`);
        } else {
          alert("자동 배치 중 오류가 발생했습니다. 하단 [로그] 탭과 콘솔 로그를 확인해 주세요.");
        }
      }
    } finally {
      autoAssignRunning = false;
      setAutoAssignBusy(false);
    }
  }


  autoAssignAll.openPrecheck = openAutoAssignPrecheckOnly;
  return autoAssignAll;
}
