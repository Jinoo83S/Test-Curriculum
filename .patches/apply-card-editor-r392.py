from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 occurrence, found {count}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# timetable.js: module import wiring
replace_once(
    "js/timetable.js",
    '''  teacherStatisticsModule,\n  displayDensityModule,\n  excelImportModule,''',
    '''  teacherStatisticsModule,\n  displayDensityModule,\n  cardEditorModule,\n  excelImportModule,''',
    "module list",
)
replace_once(
    "js/timetable.js",
    '''  import(versioned("./timetable-statistics.js")),\n  import(versioned("./timetable-display-density.js")),\n  import(versioned("./timetable-excel-import.js")),''',
    '''  import(versioned("./timetable-statistics.js")),\n  import(versioned("./timetable-display-density.js")),\n  import(versioned("./timetable-card-editor.js")),\n  import(versioned("./timetable-excel-import.js")),''',
    "module imports",
)
replace_once(
    "js/timetable.js",
    '''const { openStatisticsDialog } = teacherStatisticsModule;\nconst { setupTimetableDisplayDensity } = displayDensityModule;\nconst { createTimetableExcelImport } = excelImportModule;''',
    '''const { openStatisticsDialog } = teacherStatisticsModule;\nconst { setupTimetableDisplayDensity } = displayDensityModule;\nconst { createTimetableCardEditor } = cardEditorModule;\nconst { createTimetableExcelImport } = excelImportModule;''',
    "module destructure",
)

# Generated cards must honor auto-assign exclusion too.
replace_once(
    "js/timetable.js",
    '''function isTtCardIncludedInAutoAssign(card = {}) {\n  if (!card) return false;\n  if (!isManualTtCard(card)) return true;\n  return !isManualCardStored(card);\n}''',
    '''function isTtCardIncludedInAutoAssign(card = {}) {\n  if (!card) return false;\n  if (card.autoAssignExcluded === true) return false;\n  if (!isManualTtCard(card)) return true;\n  return !isManualCardStored(card);\n}''',
    "auto assign include",
)

helper = r'''let timetableCardEditorApi = null;

function syncEntriesFromEditedTtCards(cardIds = []) {
  const changedIds = new Set((cardIds || []).map(clean).filter(Boolean));
  if (!changedIds.size) return 0;
  let changed = 0;
  entries().forEach(entry => {
    const ids = ttCardIdsFromPlacement(entry).map(clean).filter(Boolean);
    if (!ids.some(id => changedIds.has(id))) return;
    const cards = ids.map(id => getTtCardById(id)).filter(Boolean);
    if (!cards.length) return;

    const teacherNames = [...new Set(cards.flatMap(card => getTeachersForTtCard(card)).map(clean).filter(Boolean))];
    const teacherIds = [...new Set(cards.flatMap(card => Array.isArray(card.teacherIds) ? card.teacherIds : []).map(clean).filter(Boolean))];
    const classKeys = [...new Set(cards.flatMap(card => getTtCardClassInfos(card).map(info => classKey(info))).map(clean).filter(Boolean))];

    entry.teacherName = teacherNames.join(", ");
    entry.teacherNames = teacherNames;
    entry.teacherIds = teacherIds;
    entry.audienceClassKeys = classKeys;
    changed += 1;
  });
  try { changed += reconcileExistingEntryRoomAssignmentsFromCards({ persist: false }) || 0; } catch (_) {}
  return changed;
}

async function applyTimetableCardEditorPatch(cardId, patch = {}) {
  if (!canEdit()) throw new Error("편집 권한이 없습니다.");
  const card = getTtCardById(cardId);
  if (!card) throw new Error("시간표 카드를 찾을 수 없습니다.");

  const domain = ttDomain();
  const previousCards = JSON.parse(JSON.stringify(domain.ttcards || []));
  const previousEntries = JSON.parse(JSON.stringify(domain.entries || []));
  const now = new Date().toISOString();
  captureTimetableUndo("시간표 카드 설정 수정");

  try {
    const teacherNames = [...new Set((patch.teacherNames || []).map(clean).filter(Boolean))];
    const teacherIds = [...new Set((patch.teacherIds || []).map(clean).filter(Boolean))];
    const classKeys = [...new Set((patch.classKeys || []).map(clean).filter(Boolean))];
    const classLabels = [...new Set((patch.classLabels || []).map(clean).filter(Boolean))];
    const credits = Number(patch.credits);
    if (!classKeys.length) throw new Error("대상 학급이 비어 있습니다.");
    if (!Number.isFinite(credits) || credits < 0) throw new Error("주당 시수가 올바르지 않습니다.");

    card.teacherIds = teacherIds;
    card.teacherName = teacherNames.join(", ");
    card.teachers = teacherNames;
    card.teacherMode = teacherNames.length ? "" : "none";
    card.classKeys = classKeys;
    card.classLabels = classLabels;
    card.studentKeys = [];
    card.credits = credits;
    card.isWholeGrade = !!patch.isWholeGrade;
    card.roomRule = clean(patch.roomRule || "teacher") || "teacher";
    card.fixedRoomId = card.roomRule === "fixed" ? (clean(patch.fixedRoomId) || null) : null;
    card.allowedSlots = (patch.allowedSlots || []).map(slot => ({ day: Number(slot.day), period: Number(slot.period) }));
    card.unavailableSlots = (patch.unavailableSlots || []).map(slot => ({ day: Number(slot.day), period: Number(slot.period) }));
    card.autoAssignExcluded = patch.autoAssignExcluded === true;
    if (isManualTtCard(card)) {
      card.manualAutoAssign = !card.autoAssignExcluded;
      card.manualCardStatus = card.autoAssignExcluded ? "stored" : "active";
    }
    card.manualEdited = true;
    card.editedAt = now;

    syncEntriesFromEditedTtCards([card.id]);
    scheduleSave("timetable");
    const saved = await saveNow("timetable", { force: true });
    if (saved === false) throw new Error("시간표 저장이 완료되지 않았습니다.");
    if (typeof savePendingNow === "function") await savePendingNow();
    recomputeConflicts();
    renderAll();
    try { console.info(`[card-editor:r392] saved card=${card.id} teachers=${teacherNames.length} classes=${classKeys.length} credits=${credits} excluded=${card.autoAssignExcluded ? 1 : 0}`); } catch (_) {}
    return true;
  } catch (error) {
    domain.ttcards = previousCards;
    domain.entries = previousEntries;
    try { recomputeConflicts(); renderAll(); } catch (_) {}
    throw error;
  }
}

function getTimetableCardEditorApi() {
  if (timetableCardEditorApi) return timetableCardEditorApi;
  timetableCardEditorApi = createTimetableCardEditor({
    getCards: () => appState.timetable?.ttcards || [],
    getTeachers: () => appState.teachers?.teachers || [],
    getClasses: () => appState.classes?.classes || [],
    getRooms,
    getPeriodCount: () => ttConfig()?.periodCount || 7,
    describeCard: describeTtCard,
    getGroupInfo: cardId => getGroupInfoForTeacherCard(cardId),
    canEdit,
    applyCardPatch: applyTimetableCardEditorPatch,
  });
  return timetableCardEditorApi;
}

'''
replace_once(
    "js/timetable.js",
    '''function setManualTtCardAutoAssign(cardIds = [], include = true) {''',
    helper + '''function setManualTtCardAutoAssign(cardIds = [], include = true) {''',
    "editor helper insertion",
)
replace_once(
    "js/timetable.js",
    '''$("ttFixedLessonsBtn")?.addEventListener("click", () => openFixedLessonManager());\n$("ttTeacherEventsBtn")?.addEventListener("click", () => teacherEventsManagerApi?.openTeacherEventsManager?.());''',
    '''$("ttFixedLessonsBtn")?.addEventListener("click", () => openFixedLessonManager());\n$("ttCardEditorBtn")?.addEventListener("click", () => getTimetableCardEditorApi().open());\n$("ttTeacherEventsBtn")?.addEventListener("click", () => teacherEventsManagerApi?.openTeacherEventsManager?.());''',
    "card editor button listener",
)

# Preserve generic auto-exclusion during generated-card refresh.
replace_once(
    "js/ttcards.js",
    '''["label","teacherIds","teacherName","teachers","teacherMode","credits","classKeys","classLabels","isWholeGrade","roomRule","fixedRoomId","allowedSlots","unavailableSlots"].forEach(k => {''',
    '''["label","teacherIds","teacherName","teachers","teacherMode","credits","classKeys","classLabels","isWholeGrade","roomRule","fixedRoomId","allowedSlots","unavailableSlots","autoAssignExcluded"].forEach(k => {''',
    "manual override preservation",
)

# timetable.html: explicit button + cache-bust only timetable runtime.
replace_once(
    "timetable.html",
    '''    <button id="ttFixedLessonsBtn" class="tt-fixed-btn" type="button">📌 고정 수업</button>\n    <button id="ttTeacherEventsBtn" class="tt-fixed-btn" type="button" title="학생·학급·교실 없이 교사 미팅 시간을 등록하고 해당 교사의 수업 배정을 차단합니다.">📅 교사 일정</button>''',
    '''    <button id="ttFixedLessonsBtn" class="tt-fixed-btn" type="button">📌 고정 수업</button>\n    <button id="ttCardEditorBtn" class="tt-fixed-btn" type="button" title="교사·대상반·시수·교실·시간조건·자동배치 여부를 시간표 카드에서 직접 수정합니다.">🛠 카드 편집</button>\n    <button id="ttTeacherEventsBtn" class="tt-fixed-btn" type="button" title="학생·학급·교실 없이 교사 미팅 시간을 등록하고 해당 교사의 수업 배정을 차단합니다.">📅 교사 일정</button>''',
    "html button",
)
replace_once(
    "timetable.html",
    '''window.HIS_RUNTIME_ASSET_VERSION = "2026-08-11-asc-teacher-meetings-r391";''',
    '''window.HIS_RUNTIME_ASSET_VERSION = "2026-08-12-timetable-card-editor-r392";''',
    "runtime version",
)
replace_once(
    "timetable.html",
    '''  "./js/timetable.js?v=2026-07-15-room-availability-separation-r355":"./js/timetable.js?v=2026-08-11-asc-teacher-meetings-r391",''',
    '''  "./js/timetable.js?v=2026-07-15-room-availability-separation-r355":"./js/timetable.js?v=2026-08-12-timetable-card-editor-r392",''',
    "import map timetable",
)
replace_once(
    "timetable.html",
    '''  const timetableModuleVersion = "2026-08-11-asc-teacher-meetings-r391";''',
    '''  const timetableModuleVersion = "2026-08-12-timetable-card-editor-r392";''',
    "module version",
)

print("CARD_EDITOR_R392_APPLY_OK")
