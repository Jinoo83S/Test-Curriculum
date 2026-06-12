 // ================================================================
// timetable-validator.js · Canonical timetable validation helpers
// ================================================================
// r41e: 자동배치/저장/복원 코드가 같은 기준을 보도록 하는 작고 순수한
// 검증 보조 모듈입니다. 무거운 시간표 검증은 timetable-autoassign.js의
// 기존 validator를 사용하되, 저장 정합성과 실험 복구 격리 기준은 이 파일의
// 함수만 사용합니다.

export const TIMETABLE_VALIDATOR_VERSION = "2026-06-12-canonical-validator-r41e";
export const EXPERIMENTAL_RESIDUAL_REPAIR_DEFAULT = false;

export function cleanValidatorText(value) {
  return String(value ?? "").trim();
}

export function hasTimetableEntryIdentity(entry = {}) {
  if (!entry || typeof entry !== "object") return false;
  if (cleanValidatorText(entry.templateId)) return true;
  if (cleanValidatorText(entry.ttcardId)) return true;
  if (Array.isArray(entry.ttcardIds) && entry.ttcardIds.some(cleanValidatorText)) return true;
  if (Array.isArray(entry.templateIds) && entry.templateIds.some(cleanValidatorText)) return true;
  return false;
}

export function validatorSafeEntryFilter(entry = {}) {
  if (!hasTimetableEntryIdentity(entry)) return false;
  return Number.isInteger(entry.day) && Number.isInteger(entry.period);
}

export function residualPuzzleReportIsCurrent(report = null) {
  if (!report || typeof report !== "object") return false;
  const schema = cleanValidatorText(report.schemaVersion);
  return !!schema && /^2026-06-12/.test(schema);
}

export function stripStaleResidualPuzzleReport(report = null) {
  return residualPuzzleReportIsCurrent(report) ? report : null;
}

export function isExperimentalResidualRepairEnabled(options = {}) {
  if (options?.experimentalResidualRepair === true) return true;
  if (options?.enableExperimentalResidualRepair === true) return true;
  if (options?.engineProfile?.enableExperimentalResidualRepair === true) return true;
  if (options?.engineProfile?.enableEjectionChainRepair === true) return true;
  if (options?.engineProfile?.enableMinConflictsRepair === true) return true;
  if (options?.engineProfile?.enableResidualTwoCycleRepair === true) return true;
  if (options?.engineProfile?.enableForceResidualRepair === true) return true;
  return EXPERIMENTAL_RESIDUAL_REPAIR_DEFAULT;
}

export function canonicalizeAutoAssignMeta(meta = {}, overrides = {}) {
  if (!meta || typeof meta !== "object") return null;
  const next = {
    ...meta,
    ...overrides,
    schemaVersion: cleanValidatorText(overrides.schemaVersion || meta.schemaVersion) || TIMETABLE_VALIDATOR_VERSION,
    validatorVersion: TIMETABLE_VALIDATOR_VERSION,
    metricCompleteness: cleanValidatorText(overrides.metricCompleteness || meta.metricCompleteness) || "complete",
    metricSource: cleanValidatorText(overrides.metricSource || meta.metricSource) || "canonicalEvaluation"
  };
  next.residualPuzzleReport = stripStaleResidualPuzzleReport(next.residualPuzzleReport);
  return next;
}

export function markExperimentalResidualRepairSkipped(meta = {}, reason = "experimental-residual-repair-disabled") {
  const base = meta && typeof meta === "object" ? meta : {};
  return canonicalizeAutoAssignMeta(base, {
    experimentalResidualRepairEnabled: false,
    experimentalResidualRepairSkipped: true,
    experimentalResidualRepairSkipReason: reason
  });
}
