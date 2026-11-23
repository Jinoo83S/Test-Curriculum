// Curriculum display mode is local to the curriculum page. School-year switching
// keeps the query parameter, while other pages always use annual data.
const PARAM = "curriculumMode";
const PLAN = "threeYear";

export function getCurriculumMode() {
  try {
    return new URLSearchParams(globalThis.location?.search || "").get(PARAM) === PLAN ? PLAN : "annual";
  } catch (_) {
    return "annual";
  }
}

export function setCurriculumMode(mode) {
  const next = mode === PLAN ? PLAN : "annual";
  const url = new URL(globalThis.location.href);
  if (next === PLAN) url.searchParams.set(PARAM, PLAN);
  else url.searchParams.delete(PARAM);
  globalThis.history.replaceState(null, "", url.toString());
  return next;
}
