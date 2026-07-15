 // ================================================================
// destructive-operation-guard.js · Backup / audit / target guards
// ================================================================
import { auth, db, getSchoolYearRefs } from "./config.js?v=2026-07-15-school-year-path-guard-r353";
import { assertSchoolYearPathSpec, getSchoolYearPathSpec, pathSegmentsToString } from "./school-year-paths.js?v=2026-07-15-school-year-path-guard-r353";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const DESTRUCTIVE_OPERATION_GUARD_BUILD = "2026-07-15-school-year-path-guard-r353";

function safePart(value, fallback = "data") {
  const cleaned = String(value ?? "")
    .normalize("NFKD")
    .replace(/[^0-9A-Za-z._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || fallback;
}

function stamp(date = new Date()) {
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

export function buildBackupFilename({ year, scope, operation, at = new Date() } = {}) {
  return `${safePart(year, "year")}-${safePart(scope, "workspace")}-before-${safePart(operation, "operation")}-${stamp(at)}.json`;
}

export function downloadJsonBackup(payload, filename) {
  const json = JSON.stringify(payload, null, 2);
  if (!json || json.length < 2) throw new Error("백업 JSON 생성에 실패했습니다.");
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = safePart(filename, "school-year-backup.json");
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  return { filename: safePart(filename, "school-year-backup.json"), bytes: blob.size };
}

export function assertDestructiveTarget({ year, expectedPath, context = "파괴적 작업" } = {}) {
  const spec = getSchoolYearPathSpec(year);
  assertSchoolYearPathSpec(spec, year, context);
  if (expectedPath) {
    const candidates = [
      spec.labels.root,
      spec.labels.workspaceMeta,
      spec.labels.timetableMeta,
      ...Object.values(spec.labels.domains || {}),
      ...Object.values(spec.labels.collections || {}),
    ];
    if (!candidates.includes(String(expectedPath))) {
      const error = new Error(`${context} 대상 경로가 중앙 학년도 경로표와 일치하지 않습니다: ${expectedPath}`);
      error.code = "destructive-target-path-mismatch";
      throw error;
    }
  }
  return spec;
}

const LOCAL_OPERATION_AUDIT_KEY = "his_school_year_operation_audit_v1";

function recordLocalOperationAudit(entry = {}) {
  try {
    const raw = localStorage.getItem(LOCAL_OPERATION_AUDIT_KEY);
    const rows = Array.isArray(JSON.parse(raw || "[]")) ? JSON.parse(raw || "[]") : [];
    rows.unshift({
      ...entry,
      recordedAt: new Date().toISOString(),
      userEmail: String(auth.currentUser?.email || ""),
      userUid: String(auth.currentUser?.uid || ""),
    });
    localStorage.setItem(LOCAL_OPERATION_AUDIT_KEY, JSON.stringify(rows.slice(0, 100)));
    return true;
  } catch (_) {
    return false;
  }
}

export async function recordDestructiveOperation(entry = {}) {
  const localStored = recordLocalOperationAudit(entry);
  try {
    const year = String(entry.year || "");
    const refs = getSchoolYearRefs(year || undefined);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const ref = doc(refs.operationAuditCollection, id);
    await setDoc(ref, {
      schemaVersion: 1,
      year,
      operation: String(entry.operation || "unknown"),
      scope: String(entry.scope || ""),
      status: String(entry.status || "unknown"),
      targetPaths: Array.isArray(entry.targetPaths) ? entry.targetPaths.map(String) : [],
      counts: entry.counts && typeof entry.counts === "object" ? entry.counts : {},
      backupFilename: String(entry.backupFilename || ""),
      backupBytes: Number(entry.backupBytes || 0) || 0,
      message: String(entry.message || ""),
      userEmail: String(auth.currentUser?.email || ""),
      userUid: String(auth.currentUser?.uid || ""),
      clientAt: new Date().toISOString(),
      createdAt: serverTimestamp(),
      auditPath: pathSegmentsToString(getSchoolYearPathSpec(year).operationAuditCollection),
    }, { merge: false });
    return { ok: true, id, localStored };
  } catch (error) {
    console.warn("[school-year audit log failed]", error);
    return { ok: false, error, localStored };
  }
}
