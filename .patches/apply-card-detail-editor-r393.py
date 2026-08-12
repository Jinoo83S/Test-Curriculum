from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 occurrence, found {count}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_all_checked(path, old, new, label, min_count=1):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count < min_count:
        raise SystemExit(f"{label}: expected at least {min_count} occurrences, found {count}")
    p.write_text(text.replace(old, new), encoding="utf-8")
    return count


# ------------------------------------------------------------------
# timetable.html
# - 상단 고정 카드 편집 버튼 제거
# - r393 캐시 토큰 갱신
# ------------------------------------------------------------------
replace_once(
    "timetable.html",
    '    <button id="ttCardEditorBtn" class="tt-fixed-btn" type="button" title="교사·대상반·시수·교실·시간조건·자동배치 여부를 시간표 카드에서 직접 수정합니다.">🛠 카드 편집</button>\n',
    "",
    "remove top card editor button",
)
replace_all_checked(
    "timetable.html",
    "2026-08-12-timetable-card-editor-r392",
    "2026-08-12-card-detail-editor-occurrence-rooms-r393",
    "runtime cache token",
    min_count=2,
)


# ------------------------------------------------------------------
# timetable.js
# - 상단 버튼 listener 제거
# - 상세창에서 카드 편집기 열기 context 연결
# - 현재 배치 회차별 교실 편집 API 추가
# ------------------------------------------------------------------
replace_once(
    "js/timetable.js",
    '$("ttFixedLessonsBtn")?.addEventListener("click", () => openFixedLessonManager());\n$("ttCardEditorBtn")?.addEventListener("click", () => getTimetableCardEditorApi().open());\n$("ttTeacherEventsBtn")?.addEventListener("click", () => teacherEventsManagerApi?.openTeacherEventsManager?.());',
    '$("ttFixedLessonsBtn")?.addEventListener("click", () => openFixedLessonManager());\n$("ttTeacherEventsBtn")?.addEventListener("click", () => teacherEventsManagerApi?.openTeacherEventsManager?.());',
    "remove top card editor listener",
)

occurrence_helpers = r'''function getTimetableCardEditorOccurrences(cardId = "") {
  const id = clean(cardId);
  if (!id) return [];
  return entries()
    .filter(entry => ttCardIdsFromPlacement(entry).map(clean).includes(id))
    .map(entry => {
      const cardIds = ttCardIdsFromPlacement(entry).map(clean).filter(Boolean);
      const assignments = roomAssignmentsForEntry(entry);
      const roomId = clean(assignments[id] || (cardIds.length === 1 ? entry.roomId : "") || "");
      const editable = cardIds.length === 1 && !entry.groupId && !entry.unitId;
      return {
        entryId: clean(entry.id),
        day: Number(entry.day),
        period: Number(entry.period),
        roomId,
        editable,
        grouped: !editable,
      };
    })
    .filter(row => row.entryId && Number.isInteger(row.day) && Number.isInteger(row.period))
    .sort((a, b) => (a.day - b.day) || (a.period - b.period) || a.entryId.localeCompare(b.entryId));
}

async function applyTimetableCardOccurrenceRooms(cardId = "", changes = []) {
  if (!canEdit()) throw new Error("편집 권한이 없습니다.");
  const id = clean(cardId);
  const card = getTtCardById(id);
  if (!card) throw new Error("시간표 카드를 찾을 수 없습니다.");

  const pending = (Array.isArray(changes) ? changes : [])
    .map(row => ({ entryId: clean(row?.entryId), roomId: clean(row?.roomId) }))
    .filter(row => row.entryId);
  if (!pending.length) return true;

  const domain = ttDomain();
  const previousEntries = JSON.parse(JSON.stringify(domain.entries || []));
  captureTimetableUndo("카드 회차별 교실 수정");

  try {
    let changed = 0;
    pending.forEach(({ entryId, roomId }) => {
      const entry = entries().find(row => clean(row.id) === entryId);
      if (!entry) throw new Error(`배치 항목을 찾을 수 없습니다: ${entryId}`);
      const cardIds = ttCardIdsFromPlacement(entry).map(clean).filter(Boolean);
      if (!cardIds.includes(id)) throw new Error("선택한 배치에 해당 카드가 없습니다.");
      if (cardIds.length !== 1 || entry.groupId || entry.unitId) {
        throw new Error("묶음/그룹 수업의 회차별 교실은 배치 상세의 구성 과목별 교실에서 수정해 주세요.");
      }
      if (roomId && !getRoomById(roomId)) throw new Error(`등록되지 않은 교실입니다: ${roomId}`);

      const currentAssignments = roomAssignmentsForEntry(entry);
      const currentRoomId = clean(currentAssignments[id] || entry.roomId || "");
      const currentIsOccurrenceOverride = entry.roomPinned === true && normalizeRoomRuleValue(entry.roomRule || "teacher") === "fixed";
      if (roomId === currentRoomId && ((roomId && currentIsOccurrenceOverride) || (!roomId && !currentIsOccurrenceOverride))) return;

      const assignments = { ...(entry.roomAssignmentsByTtCardId || {}) };
      if (roomId) {
        entry.roomRule = "fixed";
        entry.fixedRoomId = roomId;
        entry.roomId = roomId;
        entry.roomPinned = true;
        assignments[id] = roomId;
        entry.roomAssignmentsByTtCardId = assignments;
        delete entry.roomIds;
      } else {
        entry.roomPinned = false;
        entry.roomRule = roomRuleForCard(card);
        delete entry.fixedRoomId;
        delete assignments[id];
        entry.roomAssignmentsByTtCardId = assignments;
        const defaultRoomId = clean(resolveRoomForTtCard(card, entry) || "");
        entry.roomId = defaultRoomId || null;
        if (defaultRoomId) entry.roomAssignmentsByTtCardId[id] = defaultRoomId;
        delete entry.roomIds;
      }
      changed += 1;
    });

    if (!changed) return true;
    scheduleSave("timetable");
    const saved = await saveNow("timetable", { force: true });
    if (saved === false) throw new Error("시간표 저장이 완료되지 않았습니다.");
    if (typeof savePendingNow === "function") await savePendingNow();
    recomputeConflicts();
    renderAll();
    try { console.info(`[card-editor:r393] occurrence-room card=${id} changed=${changed}`); } catch (_) {}
    return true;
  } catch (error) {
    domain.entries = previousEntries;
    try { recomputeConflicts(); renderAll(); } catch (_) {}
    throw error;
  }
}

'''
replace_once(
    "js/timetable.js",
    '''function getTimetableCardEditorApi() {''',
    occurrence_helpers + '''function getTimetableCardEditorApi() {''',
    "occurrence room helpers",
)
replace_once(
    "js/timetable.js",
    '''    getGroupInfo: cardId => getGroupInfoForTeacherCard(cardId),\n    canEdit,\n    applyCardPatch: applyTimetableCardEditorPatch,''',
    '''    getGroupInfo: cardId => getGroupInfoForTeacherCard(cardId),\n    getOccurrences: getTimetableCardEditorOccurrences,\n    canEdit,\n    applyCardPatch: applyTimetableCardEditorPatch,\n    applyOccurrenceRooms: applyTimetableCardOccurrenceRooms,''',
    "card editor occurrence context",
)
replace_once(
    "js/timetable.js",
    '''  getRoomDisplayName,\n  getEntryPinBlockEntries,\n  toggleEntryPinnedBlock,\n});''',
    '''  getRoomDisplayName,\n  getEntryPinBlockEntries,\n  toggleEntryPinnedBlock,\n  openTtCardEditor: cardId => getTimetableCardEditorApi().open(cardId),\n});''',
    "detail editor context",
)


# ------------------------------------------------------------------
# timetable-detail.js
# - 카드 상세/배치 상세 내부에 카드 편집 진입 버튼 배치
# ------------------------------------------------------------------
helper = r'''  function appendCardEditorButtons(box, cardIds = [], modal = null) {
    const ids = uniqueIds(cardIds).filter(id => getTtCardById(id));
    if (!ids.length || !canEdit() || typeof ctx.openTtCardEditor !== "function") return;

    const section = document.createElement("div");
    section.style.cssText = "margin:8px 0 10px;padding:8px 9px;border:1px solid #bfdbfe;border-radius:9px;background:#eff6ff";
    const label = document.createElement("div");
    label.style.cssText = "font-size:10.5px;font-weight:900;color:#1e3a8a;margin-bottom:6px";
    label.textContent = ids.length === 1 ? "과목카드 설정" : "구성 과목카드 설정";
    section.appendChild(label);

    const buttons = document.createElement("div");
    buttons.style.cssText = "display:flex;gap:6px;flex-wrap:wrap";
    ids.forEach(id => {
      const card = getTtCardById(id);
      const desc = card ? describeTtCard(card) : null;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.style.cssText = "min-height:30px;border:1px solid #60a5fa;border-radius:8px;background:#fff;color:#1d4ed8;padding:5px 9px;font-size:11px;font-weight:900;cursor:pointer;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      btn.textContent = ids.length === 1 ? "🛠 카드 편집" : `🛠 ${desc?.title || card?.subject || card?.label || "카드"}`;
      btn.title = "담당 교사·대상반·시수·교실·시간조건·자동배치 설정을 수정합니다.";
      btn.addEventListener("click", () => {
        modal?.remove?.();
        ctx.openTtCardEditor(id);
      });
      buttons.appendChild(btn);
    });
    section.appendChild(buttons);
    box.appendChild(section);
  }

'''
replace_once(
    "js/timetable-detail.js",
    '''export function createTimetableDetailHandlers(ctx) {\n  const entries = () => ctx.entries();\n  const ttConfig = () => ctx.ttConfig();\n  const currentGrade = () => ctx.currentGrade();\n\n  function showSidebarCardDetail''',
    '''export function createTimetableDetailHandlers(ctx) {\n  const entries = () => ctx.entries();\n  const ttConfig = () => ctx.ttConfig();\n  const currentGrade = () => ctx.currentGrade();\n\n''' + helper + '''  function showSidebarCardDetail''',
    "detail editor helper",
)
replace_once(
    "js/timetable-detail.js",
    '''    titleEl.textContent = title;\n    box.appendChild(titleEl);\n\n    const rows = [''',
    '''    titleEl.textContent = title;\n    box.appendChild(titleEl);\n    const topDetailCardIds = uniqueIds((detailItems || []).map(item => item.ttcardId || item.id));\n    appendCardEditorButtons(box, topDetailCardIds, modal);\n\n    const rows = [''',
    "sidebar detail card editor buttons",
)
replace_once(
    "js/timetable-detail.js",
    '''    titleEl.textContent = entryTitle(entry);\n    box.appendChild(titleEl);\n\n    function makeRow(label, value) {''',
    '''    titleEl.textContent = entryTitle(entry);\n    box.appendChild(titleEl);\n    appendCardEditorButtons(box, uniqueIds([entry.ttcardId, ...(entry.ttcardIds || [])]), modal);\n\n    function makeRow(label, value) {''',
    "entry detail card editor buttons",
)


# ------------------------------------------------------------------
# timetable-card-editor.js
# - 현재 배치 회차별 교실 편집 영역 추가
# ------------------------------------------------------------------
replace_once(
    "js/timetable-card-editor.js",
    "// r392 · 2026-08-12",
    "// r393 · 2026-08-12",
    "editor version comment",
)
replace_once(
    "js/timetable-card-editor.js",
    'const STYLE_ID = "ttCardEditorStyleR392";',
    'const STYLE_ID = "ttCardEditorStyleR393";',
    "editor style id",
)
replace_once(
    "js/timetable-card-editor.js",
    '''.tt-ce-note{padding:8px 10px;border-radius:8px;background:#fffbeb;border:1px solid #fde68a;color:#92400e;font-size:10px;line-height:1.45;margin-top:7px}\n.tt-ce-actions{position:sticky;bottom:-14px;background:#fff;border-top:1px solid #e2e8f0;margin:14px -17px -14px;padding:11px 17px;display:flex;gap:8px;align-items:center}.tt-ce-actions button{height:34px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:0 12px;font-size:11px;font-weight:900;cursor:pointer}.tt-ce-actions .primary{background:#2563eb;border-color:#2563eb;color:#fff}.tt-ce-actions span{margin-left:auto;font-size:10px;color:#64748b;font-weight:750}''',
    '''.tt-ce-note{padding:8px 10px;border-radius:8px;background:#fffbeb;border:1px solid #fde68a;color:#92400e;font-size:10px;line-height:1.45;margin-top:7px}\n.tt-ce-occ-list{display:flex;flex-direction:column;gap:6px}.tt-ce-occ-row{display:grid;grid-template-columns:minmax(88px,120px) minmax(160px,1fr);gap:8px;align-items:center;border:1px solid #e2e8f0;border-radius:8px;background:#fff;padding:7px 8px}.tt-ce-occ-row b{font-size:11px;color:#334155}.tt-ce-occ-row select{height:31px;border:1px solid #cbd5e1;border-radius:8px;padding:0 8px;font-size:11px;background:#fff}.tt-ce-occ-row.is-grouped{background:#f8fafc;opacity:.72}.tt-ce-occ-save{margin-top:8px;height:32px;border:1px solid #2563eb;border-radius:8px;background:#2563eb;color:#fff;padding:0 11px;font-size:11px;font-weight:900;cursor:pointer}.tt-ce-occ-save:disabled{opacity:.55;cursor:not-allowed}\n.tt-ce-actions{position:sticky;bottom:-14px;background:#fff;border-top:1px solid #e2e8f0;margin:14px -17px -14px;padding:11px 17px;display:flex;gap:8px;align-items:center}.tt-ce-actions button{height:34px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:0 12px;font-size:11px;font-weight:900;cursor:pointer}.tt-ce-actions .primary{background:#2563eb;border-color:#2563eb;color:#fff}.tt-ce-actions span{margin-left:auto;font-size:10px;color:#64748b;font-weight:750}''',
    "occurrence room styles",
)

occurrence_ui = r'''      const occurrences = asArray(context.getOccurrences?.(card.id));
      if (occurrences.length) {
        const occSection = document.createElement("section");
        occSection.className = "tt-ce-section";
        occSection.innerHTML = "<h3>현재 배치 회차별 교실</h3>";
        const occBody = document.createElement("div");
        occBody.className = "tt-ce-secbody";
        const occList = document.createElement("div");
        occList.className = "tt-ce-occ-list";
        const sortedRooms = getRooms().filter(room => clean(room.id)).sort((a,b)=>clean(a.name||a.id).localeCompare(clean(b.name||b.id),"ko",{numeric:true}));
        let editableOccurrenceCount = 0;

        occurrences.forEach((occ, index) => {
          const row = document.createElement("div");
          row.className = `tt-ce-occ-row${occ.editable ? "" : " is-grouped"}`;
          const slot = document.createElement("b");
          slot.textContent = `${DAY_LABELS[Number(occ.day)] || "?"} ${Number(occ.period) + 1}교시`;
          const select = document.createElement("select");
          select.dataset.entryId = clean(occ.entryId);
          select.dataset.originalRoomId = clean(occ.roomId);
          select.innerHTML = `<option value="">카드 기본 규칙 사용</option>${sortedRooms.map(room => `<option value="${escapeHtml(room.id)}">${escapeHtml(room.name || room.id)}</option>`).join("")}`;
          if (clean(occ.roomId) && !sortedRooms.some(room => clean(room.id) === clean(occ.roomId))) {
            const unknown = document.createElement("option");
            unknown.value = clean(occ.roomId);
            unknown.textContent = clean(occ.roomId);
            select.appendChild(unknown);
          }
          select.value = clean(occ.roomId);
          select.disabled = !canEdit || !occ.editable;
          if (occ.editable) editableOccurrenceCount += 1;
          else {
            select.title = "묶음/그룹 수업은 배치 상세에서 구성 과목별 교실을 수정합니다.";
            const grouped = document.createElement("option");
            grouped.value = clean(occ.roomId);
            grouped.textContent = `${clean(occ.roomId) ? "현재 교실 유지" : "그룹/묶음 수업"}`;
            if (![...select.options].some(option => option.value === grouped.value)) select.appendChild(grouped);
            select.value = clean(occ.roomId);
          }
          row.append(slot, select);
          occList.appendChild(row);
        });

        occBody.appendChild(occList);
        const occNote = document.createElement("div");
        occNote.className = "tt-ce-note";
        occNote.textContent = "이 설정은 현재 배치의 각 회차 교실만 고정합니다. 예: 같은 음악 카드의 한 회차는 Chapel, 다른 회차는 VH106으로 지정할 수 있습니다. 묶음/그룹 수업은 배치 상세의 구성 과목별 교실에서 수정합니다.";
        occBody.appendChild(occNote);

        if (editableOccurrenceCount) {
          const occSave = document.createElement("button");
          occSave.type = "button";
          occSave.className = "tt-ce-occ-save";
          occSave.textContent = "회차별 교실 저장";
          occSave.disabled = !canEdit;
          occSave.addEventListener("click", async () => {
            const changes = [...occList.querySelectorAll("select[data-entry-id]")]
              .filter(select => !select.disabled && clean(select.value) !== clean(select.dataset.originalRoomId))
              .map(select => ({ entryId: select.dataset.entryId, roomId: select.value }));
            if (!changes.length) {
              occSave.textContent = "변경 없음";
              setTimeout(() => { occSave.textContent = "회차별 교실 저장"; }, 1200);
              return;
            }
            occSave.disabled = true;
            occSave.textContent = "저장 중…";
            try {
              const result = await context.applyOccurrenceRooms?.(card.id, changes);
              if (result === false) throw new Error("회차별 교실 변경을 저장하지 못했습니다.");
              occSave.textContent = "저장됨";
              setTimeout(() => renderEditor(), 250);
            } catch (error) {
              alert(`회차별 교실 저장에 실패했습니다.\n${error?.message || error}`);
              occSave.disabled = !canEdit;
              occSave.textContent = "회차별 교실 저장";
            }
          });
          occBody.appendChild(occSave);
        }
        occSection.appendChild(occBody);
        editor.appendChild(occSection);
      }

'''
replace_once(
    "js/timetable-card-editor.js",
    '''      roomRule.addEventListener("change", refreshFixed); refreshFixed();\n\n      const timeSection = document.createElement("section");''',
    '''      roomRule.addEventListener("change", refreshFixed); refreshFixed();\n\n''' + occurrence_ui + '''      const timeSection = document.createElement("section");''',
    "occurrence room UI",
)

print("CARD_DETAIL_EDITOR_R393_APPLY_OK")
