// ================================================================
// timetable-solve-result-status.js · r367 solver result truth audit
// ---------------------------------------------------------------
// Pure helpers shared by the CP-SAT bridge and release tests.
// A solver's FEASIBLE/OPTIMAL response is not called "complete" until
// the returned entries also pass coverage and conflict validation.
// ================================================================

const asArray = value => Array.isArray(value) ? value : [];
const clean = value => String(value ?? "").trim();
const unique = values => [...new Set(asArray(values).map(clean).filter(Boolean))];

function payloadRoot(state = {}) {
  return state?.data || state?.normalized || state || {};
}

function timetableRoot(state = {}) {
  return payloadRoot(state)?.timetable || {};
}

function timetableCards(state = {}) {
  const tt = timetableRoot(state);
  return asArray(tt.ttcards).length ? asArray(tt.ttcards)
    : asArray(tt.ttCards).length ? asArray(tt.ttCards)
      : asArray(tt.cards);
}

function normalizeClassKey(value = "", fallbackGrade = "") {
  const raw = clean(value).replace(/학년/g, "").replace(/\s+/g, "").toUpperCase();
  if (!raw) return "";
  if (raw.includes(":")) {
    const [grade, section] = raw.split(":");
    const gradeNo = Number(String(grade || fallbackGrade).replace(/[^0-9]/g, ""));
    return gradeNo && section ? `${gradeNo}:${section}` : "";
  }
  const match = raw.match(/^(\d{1,2})([A-Z0-9]+)$/);
  if (match) return `${Number(match[1])}:${match[2]}`;
  const fallbackNo = Number(String(fallbackGrade || "").replace(/[^0-9]/g, ""));
  return fallbackNo && raw ? `${fallbackNo}:${raw}` : "";
}

function classKeysForEntry(entry = {}) {
  const direct = [
    ...asArray(entry.audienceClassKeys),
    ...asArray(entry.classKeys),
    ...asArray(entry.audienceClassLabels),
    ...asArray(entry.classLabels),
  ].map(value => normalizeClassKey(value, entry.gradeKey)).filter(Boolean);
  if (direct.length) return unique(direct);
  const gradeNo = Number(String(entry.gradeKey || "").replace(/[^0-9]/g, ""));
  const section = Number.isInteger(entry.sectionIdx)
    ? String.fromCharCode(65 + entry.sectionIdx)
    : Number.isInteger(entry.sectionIndex)
      ? String.fromCharCode(65 + entry.sectionIndex)
      : "";
  return gradeNo && section ? [`${gradeNo}:${section}`] : [];
}

function classSlotCount(entries = []) {
  const slots = new Set();
  asArray(entries).forEach(entry => {
    const day = Number(entry?.day);
    const period = Number(entry?.period);
    if (!Number.isInteger(day) || day < 0 || day > 4 || !Number.isInteger(period) || period < 0) return;
    classKeysForEntry(entry).forEach(key => slots.add(`${key}@${day}:${period}`));
  });
  return slots.size;
}

function expectedScopeClassKeys(state = {}) {
  const root = payloadRoot(state);
  const classes = asArray(root?.classes?.classes);
  const cardKeys = new Set();
  timetableCards(state).forEach(card => classKeysForEntry(card).forEach(key => cardKeys.add(key)));
  const classKeys = classes.map(cls => normalizeClassKey(`${clean(cls.grade)}${clean(cls.name)}`)).filter(Boolean);
  if (!cardKeys.size) return unique(classKeys);
  const inScope = classKeys.filter(key => cardKeys.has(key));
  return unique(inScope.length ? inScope : classKeys);
}

function validationCounts(apiResult = {}) {
  return apiResult?.validation?.counts || {};
}

function hardIssueCount(counts = {}) {
  return [
    "overageCount",
    "teacherConflictCount",
    "studentConflictCount",
    "roomConflictCount",
    "classConflictCount",
    "timeViolationCount",
  ].reduce((sum, key) => sum + Math.max(0, Number(counts?.[key] || 0)), 0);
}

function solverEngineLabel(apiResult = {}) {
  return clean(apiResult?.meta?.engine || apiResult?.engine || apiResult?.status || apiResult?.state);
}

function isCpSatEngine(apiResult = {}) {
  const engine = solverEngineLabel(apiResult);
  const status = clean(apiResult?.status || apiResult?.state);
  return /OR-Tools\s*CP-SAT/i.test(engine) || /^CP-SAT-/i.test(status);
}

export function buildCpSatScopeAudit(state = {}, options = {}) {
  const tt = timetableRoot(state);
  const cards = timetableCards(state);
  const meta = tt.autoAssignMeta && typeof tt.autoAssignMeta === "object" ? tt.autoAssignMeta : {};
  const seed = meta.cpSatEntrySeedPreflight && typeof meta.cpSatEntrySeedPreflight === "object"
    ? meta.cpSatEntrySeedPreflight
    : {};
  const excludedIds = unique(meta.manualCardExcludedIds);
  const classKeys = expectedScopeClassKeys(state);
  const periodCount = Math.max(1, Number(tt?.config?.periodCount || options.periodCount || 7) || 7);
  const sourceCardCount = cards.length + excludedIds.length;
  return {
    schemaVersion: "r367-cpsat-scope-audit-v1",
    sourceCardCount,
    includedCardCount: cards.length,
    excludedCardCount: excludedIds.length,
    excludedCardIds: excludedIds,
    preservedSeedEntryCount: Math.max(0, Number(seed.keptSeedEntryCount || 0)),
    droppedGeneratedEntryCount: Math.max(0, Number(seed.droppedGeneratedEntryCount || 0)),
    originalEntryCount: Math.max(0, Number(seed.originalEntryCount || options.originalEntryCount || 0)),
    scopeClassCount: classKeys.length,
    scopeClassKeys: classKeys,
    periodCount,
    expectedClassSlotCount: classKeys.length * 5 * periodCount,
  };
}

export function auditCpSatResult({ apiResult = {}, state = {}, scopeAudit = null, entries = [], clientPreflight = null } = {}) {
  const normalizedEntries = asArray(entries);
  const scope = scopeAudit && typeof scopeAudit === "object" ? scopeAudit : buildCpSatScopeAudit(state, { originalEntryCount: normalizedEntries.length });
  const counts = validationCounts(apiResult);
  const hard = hardIssueCount(counts);
  const shortage = Math.max(0, Number(counts.shortageCount || 0));
  const overage = Math.max(0, Number(counts.overageCount || 0));
  const actualClassSlots = classSlotCount(normalizedEntries);
  const expectedClassSlots = Math.max(0, Number(scope.expectedClassSlotCount || 0));
  const coverageKnown = expectedClassSlots > 0;
  const coverageComplete = !coverageKnown || actualClassSlots === expectedClassSlots;
  const validationOk = apiResult?.validation?.ok === true;
  const cpSat = isCpSatEngine(apiResult);
  const preflightBlockingCount = Math.max(0, Number(clientPreflight?.blockingCount || 0));
  const hasEntries = normalizedEntries.length > 0;
  const finalValidationComplete = cpSat && hasEntries && validationOk && hard === 0 && shortage === 0 && overage === 0 && coverageComplete;

  let status = "partial_success";
  let title = "CP-SAT 부분 성공";
  let reason = "해를 찾았지만 전체 시간표 검증이 남아 있습니다.";
  let level = "warn";

  if (!cpSat || !hasEntries || hard > 0) {
    status = "failed";
    title = "CP-SAT 실패";
    level = "bad";
    if (!cpSat) reason = `OR-Tools CP-SAT 결과가 아닙니다. 엔진: ${solverEngineLabel(apiResult) || "확인 불가"}`;
    else if (!hasEntries) reason = "결과 entries가 없습니다.";
    else reason = `교사·교실·학급·시간조건의 강한 위반이 ${hard}건 있습니다.`;
  } else if (finalValidationComplete && preflightBlockingCount > 0) {
    status = "diagnostic_mismatch";
    title = "CP-SAT 성공 · 사전진단 불일치";
    level = "warn";
    reason = `최종 결과는 전체 검증을 통과했지만 브라우저 사전진단은 ${preflightBlockingCount}개를 차단 대상으로 판정했습니다.`;
  } else if (finalValidationComplete) {
    status = "complete_success";
    title = "CP-SAT 완전 성공";
    level = "ok";
    reason = "OR-Tools CP-SAT 결과가 전체 시수·학급칸·교사·교실·시간조건 검증을 모두 통과했습니다.";
  } else {
    const parts = [];
    if (!validationOk) parts.push(clean(apiResult?.validation?.summary) || "서버 검증 미통과");
    if (shortage) parts.push(`미배치 ${shortage}건`);
    if (overage) parts.push(`초과 ${overage}건`);
    if (!coverageComplete) parts.push(`학급칸 ${actualClassSlots}/${expectedClassSlots}`);
    reason = parts.filter(Boolean).join(" · ") || reason;
  }

  return {
    schemaVersion: "r367-cpsat-result-audit-v1",
    status,
    title,
    reason,
    level,
    canApply: finalValidationComplete,
    finalValidationComplete,
    cpSatEngine: cpSat,
    engine: solverEngineLabel(apiResult),
    entryCount: normalizedEntries.length,
    actualClassSlotCount: actualClassSlots,
    expectedClassSlotCount: expectedClassSlots,
    coverageComplete,
    validationOk,
    hardIssueCount: hard,
    shortageCount: shortage,
    overageCount: overage,
    preflightBlockingCount,
    scope,
  };
}

export function cpSatResultStatusLabel(audit = {}) {
  return clean(audit?.title) || "CP-SAT 결과 확인 필요";
}
