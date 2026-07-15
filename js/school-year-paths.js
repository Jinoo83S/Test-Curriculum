// ================================================================
// school-year-paths.js · Single source of truth for academic-year paths
// ================================================================

export const SCHOOL_YEAR_PATHS_BUILD = "2026-07-15-room-availability-separation-r355";
export const LEGACY_PATH_YEAR = "2026";
export const SCHOOL_YEAR_DOMAIN_NAMES = Object.freeze([
  "curriculum", "templates", "classes", "teachers", "rosters", "rooms", "timetable", "main"
]);
export const SCHOOL_YEAR_COLLECTION_NAMES = Object.freeze([
  "classes", "rosters", "timetableEntries", "ttcards"
]);

function normalizeYear(value, fallback = LEGACY_PATH_YEAR) {
  const match = String(value ?? "").trim().match(/(20\d{2})/);
  if (!match) return fallback;
  const year = Number(match[1]);
  return year >= 2020 && year <= 2099 ? String(year) : fallback;
}

export function pathSegmentsToString(segments = []) {
  return (Array.isArray(segments) ? segments : []).map(String).join("/");
}

export function getSchoolYearPathSpec(value) {
  const year = normalizeYear(value);
  const legacy = year === LEGACY_PATH_YEAR;
  const domainSegments = name => legacy
    ? ["boards", String(name)]
    : ["schoolYears", year, "domains", String(name)];
  const collectionSegments = name => legacy
    ? ["boards", "_split", String(name)]
    : ["schoolYears", year, String(name)];

  const domains = Object.fromEntries(SCHOOL_YEAR_DOMAIN_NAMES.map(name => [name, domainSegments(name)]));
  const collections = Object.fromEntries(SCHOOL_YEAR_COLLECTION_NAMES.map(name => [name, collectionSegments(name)]));
  const timetableMeta = legacy
    ? ["boards", "_split", "timetableMeta", "main"]
    : ["schoolYears", year, "meta", "timetable"];
  const workspaceMeta = legacy ? null : ["schoolYears", year];

  const spec = {
    schemaVersion: 1,
    year,
    legacy,
    root: legacy ? ["boards"] : ["schoolYears", year],
    workspaceMeta,
    domains,
    collections,
    timetableMeta,
    schoolYearsCollection: ["schoolYears"],
    // Global operational audit namespace. This is not curriculum data and is
    // intentionally independent from the target academic-year workspace.
    operationAuditCollection: ["boards", "_audit", "schoolYearOperations"],
  };

  spec.labels = {
    root: pathSegmentsToString(spec.root),
    rootDisplay: legacy ? "boards (2026 기존 운영 경로)" : pathSegmentsToString(spec.root),
    workspaceMeta: workspaceMeta ? pathSegmentsToString(workspaceMeta) : "없음 (2026 기존 운영 경로)",
    timetableMeta: pathSegmentsToString(timetableMeta),
    domains: Object.fromEntries(Object.entries(domains).map(([key, segments]) => [key, pathSegmentsToString(segments)])),
    collections: Object.fromEntries(Object.entries(collections).map(([key, segments]) => [key, pathSegmentsToString(segments)])),
    operationAuditCollection: pathSegmentsToString(spec.operationAuditCollection),
  };

  return Object.freeze(spec);
}

export function assertSchoolYearPathSpec(spec, expectedYear, context = "학년도 경로") {
  const expected = normalizeYear(expectedYear, "");
  const actual = normalizeYear(spec?.year, "");
  if (!expected || !actual || expected !== actual) {
    const error = new Error(`${context} 불일치: 기대 학년도=${expected || "없음"}, 경로 학년도=${actual || "없음"}`);
    error.code = "school-year-path-mismatch";
    error.expectedSchoolYear = expected;
    error.actualSchoolYear = actual;
    throw error;
  }

  const forbidden = expected === LEGACY_PATH_YEAR ? "schoolYears/" : "boards/curriculum";
  const allLabels = [
    spec?.labels?.root,
    spec?.labels?.workspaceMeta,
    spec?.labels?.timetableMeta,
    ...Object.values(spec?.labels?.domains || {}),
    ...Object.values(spec?.labels?.collections || {}),
  ].filter(Boolean).join("\n");

  if (expected === LEGACY_PATH_YEAR && allLabels.includes("schoolYears/2026")) {
    throw new Error(`${context} 오류: 2026 운영 경로가 schoolYears/2026을 가리킵니다.`);
  }
  if (expected !== LEGACY_PATH_YEAR && Object.values(spec?.labels?.domains || {}).some(path => path.startsWith("boards/"))) {
    throw new Error(`${context} 오류: ${expected}학년도 도메인이 2026 boards 경로를 가리킵니다.`);
  }

  return { ok: true, year: expected, forbiddenMarker: forbidden };
}

export function getCurriculumTargetDescriptor(year, level = "all") {
  const spec = getSchoolYearPathSpec(year);
  const levelLabel = level === "middle" ? "중등 7·8·9학년" : level === "high" ? "고등 10·11·12학년" : "전체 7~12학년";
  return {
    year: spec.year,
    level,
    levelLabel,
    targetPath: spec.labels.domains.curriculum,
    operating2026Impact: spec.year === LEGACY_PATH_YEAR ? "2026 운영 데이터 직접 변경" : "없음",
  };
}
