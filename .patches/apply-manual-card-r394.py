from pathlib import Path

BASE_SHA = "a1bf0250119320dac9d9b38c104dbc86cf6ae799"


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 occurrence, found {count}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# 1) timetable-card-editor.js · manual card UI
replace_once(
    "js/timetable-card-editor.js",
    "// r393 · 2026-08-12\n// - 교사 / 대상반 / 시수 / 교실 규칙 / 가능·불가시간 / 자동배치 포함",
    "// r394 · 2026-08-12\n// - 교사 / 대상반 / 시수 / 교실 규칙 / 가능·불가시간 / 자동배치 포함\n// - 카드 상세에서 독립 수동카드 복제/삭제 및 수동카드 과목명 편집",
    "editor version header",
)
replace_once(
    "js/timetable-card-editor.js",
    'const STYLE_ID = "ttCardEditorStyleR393";',
    'const STYLE_ID = "ttCardEditorStyleR394";',
    "editor style id",
)
replace_once(
    "js/timetable-card-editor.js",
    '''function cardClassKeys(card = {}) {\n  return unique(card.classKeys || []);\n}\n\nfunction roomRuleLabel(rule = "teacher") {''',
    '''function cardClassKeys(card = {}) {\n  return unique(card.classKeys || []);\n}\n\nfunction isManualCard(card = {}) {\n  return card?.isManual === true || clean(card?.id).startsWith("ttc_manual") || clean(card?.templateId).startsWith("manual_");\n}\n\nfunction roomRuleLabel(rule = "teacher") {''',
    "manual card helper",
)
replace_once(
    "js/timetable-card-editor.js",
    '''.tt-ce-actions{position:sticky;bottom:-14px;background:#fff;border-top:1px solid #e2e8f0;margin:14px -17px -14px;padding:11px 17px;display:flex;gap:8px;align-items:center}.tt-ce-actions button{height:34px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:0 12px;font-size:11px;font-weight:900;cursor:pointer}.tt-ce-actions .primary{background:#2563eb;border-color:#2563eb;color:#fff}.tt-ce-actions span{margin-left:auto;font-size:10px;color:#64748b;font-weight:750}''',
    '''.tt-ce-actions{position:sticky;bottom:-14px;background:#fff;border-top:1px solid #e2e8f0;margin:14px -17px -14px;padding:11px 17px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.tt-ce-actions button{height:34px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:0 12px;font-size:11px;font-weight:900;cursor:pointer}.tt-ce-actions .primary{background:#2563eb;border-color:#2563eb;color:#fff}.tt-ce-actions .danger{border-color:#fecaca;color:#b91c1c;background:#fff}.tt-ce-actions span{margin-left:auto;font-size:10px;color:#64748b;font-weight:750}''',
    "action styles",
)
replace_once(
    "js/timetable-card-editor.js",
    '''      const title = document.createElement("div");\n      title.innerHTML = `<div style="font-size:17px;font-weight:950;color:#0f172a">${escapeHtml(cardTitle(card))}</div><div class="tt-ce-summary"><span class="tt-ce-chip">${escapeHtml(`${gradeNo(card.gradeKey)||"?"}학년`)}</span><span class="tt-ce-chip">${escapeHtml(groupSummary(card.id))}</span>${card.manualEdited ? '<span class="tt-ce-chip manual">수동 수정</span>' : ''}${card.autoAssignExcluded === true ? '<span class="tt-ce-chip manual">자동배치 제외</span>' : ''}</div>`;\n      editor.appendChild(title);\n\n      const teacherSection = document.createElement("section");''',
    '''      const title = document.createElement("div");\n      title.innerHTML = `<div style="font-size:17px;font-weight:950;color:#0f172a">${escapeHtml(cardTitle(card))}</div><div class="tt-ce-summary"><span class="tt-ce-chip">${escapeHtml(`${gradeNo(card.gradeKey)||"?"}학년`)}</span><span class="tt-ce-chip">${escapeHtml(groupSummary(card.id))}</span>${card.manualEdited ? '<span class="tt-ce-chip manual">수동 수정</span>' : ''}${isManualCard(card) ? '<span class="tt-ce-chip manual">수동카드</span>' : ''}${card.autoAssignExcluded === true ? '<span class="tt-ce-chip manual">자동배치 제외</span>' : ''}</div>`;\n      editor.appendChild(title);\n\n      const identitySection = document.createElement("section");\n      identitySection.className = "tt-ce-section";\n      identitySection.innerHTML = "<h3>카드 기본 정보</h3>";\n      const identityBody = document.createElement("div");\n      identityBody.className = "tt-ce-secbody";\n      if (isManualCard(card)) {\n        identityBody.classList.add("tt-ce-grid2");\n        const subjectField = document.createElement("div");\n        subjectField.className = "tt-ce-field";\n        subjectField.innerHTML = `<label>과목명</label><input data-field="subject" type="text" value="${escapeHtml(clean(card.subject || card.label))}"><small>수동카드는 시간표 운영용 과목명을 직접 수정할 수 있습니다.</small>`;\n        const subjectEnField = document.createElement("div");\n        subjectEnField.className = "tt-ce-field";\n        subjectEnField.innerHTML = `<label>영문명</label><input data-field="subjectEn" type="text" value="${escapeHtml(clean(card.subjectEn))}"><small>필요하지 않으면 비워 두어도 됩니다.</small>`;\n        const gradeField = document.createElement("div");\n        gradeField.className = "tt-ce-field";\n        gradeField.innerHTML = `<label>학년</label><input type="text" value="${escapeHtml(card.gradeKey || "")}" disabled><small>학년을 바꿔야 하면 원하는 학년의 카드를 먼저 복제하세요.</small>`;\n        identityBody.append(subjectField, subjectEnField, gradeField);\n      } else {\n        identityBody.innerHTML = `<div style="font-size:11px;line-height:1.5;color:#475569"><b>${escapeHtml(card.gradeKey || "")}</b> · 커리큘럼 생성 카드입니다.<br>과목명과 학년은 커리큘럼 원본을 보호하기 위해 여기서 변경하지 않습니다. 별도 과목카드가 필요하면 아래 <b>이 카드 복제</b>를 사용하세요.</div>`;\n      }\n      identitySection.appendChild(identityBody);\n      editor.appendChild(identitySection);\n\n      const teacherSection = document.createElement("section");''',
    "identity section",
)
replace_once(
    "js/timetable-card-editor.js",
    '''      const actions = document.createElement("div"); actions.className = "tt-ce-actions";\n      const save = document.createElement("button"); save.type="button"; save.className="primary"; save.textContent="카드 설정 저장"; save.disabled=!canEdit;\n      const closeBtn = document.createElement("button"); closeBtn.type="button"; closeBtn.textContent="닫기"; closeBtn.addEventListener("click",close);\n      const status=document.createElement("span"); status.textContent=canEdit?"저장 시 현재 배치에도 즉시 반영됩니다.":"읽기 전용";\n      actions.append(save, closeBtn, status); editor.appendChild(actions);\n\n      save.addEventListener("click", async () => {''',
    '''      const actions = document.createElement("div"); actions.className = "tt-ce-actions";\n      const save = document.createElement("button"); save.type="button"; save.className="primary"; save.textContent="카드 설정 저장"; save.disabled=!canEdit;\n      const cloneBtn = document.createElement("button"); cloneBtn.type="button"; cloneBtn.textContent="＋ 이 카드 복제"; cloneBtn.disabled=!canEdit; cloneBtn.title="현재 카드의 학년·교사·대상반·시수·교실·시간조건을 복사한 독립 수동카드를 만듭니다.";\n      const deleteBtn = document.createElement("button"); deleteBtn.type="button"; deleteBtn.className="danger"; deleteBtn.textContent="수동카드 삭제"; deleteBtn.disabled=!canEdit || !isManualCard(card); deleteBtn.style.display=isManualCard(card)?"":"none";\n      const closeBtn = document.createElement("button"); closeBtn.type="button"; closeBtn.textContent="닫기"; closeBtn.addEventListener("click",close);\n      const status=document.createElement("span"); status.textContent=canEdit?"복제 카드는 자동배치 제외 상태로 만들어집니다.":"읽기 전용";\n      actions.append(save, cloneBtn, deleteBtn, closeBtn, status); editor.appendChild(actions);\n\n      cloneBtn.addEventListener("click", async () => {\n        if (!confirm(`‘${cardTitle(card)}’ 카드를 독립 수동카드로 복제할까요?\\n\\n복제본은 자동배치 제외 상태로 생성되며, 과목명·교사·반·시수를 수정한 뒤 자동배치 포함으로 전환할 수 있습니다.`)) return;\n        cloneBtn.disabled = true;\n        cloneBtn.textContent = "복제 중…";\n        status.textContent = "";\n        try {\n          const newId = await context.cloneCard?.(card.id);\n          if (!newId) throw new Error("복제된 카드 ID를 받지 못했습니다.");\n          selectedCardId = newId;\n          status.textContent = "복제됨 · 자동배치 제외";\n          renderGradeFilter();\n          renderList();\n          renderEditor();\n        } catch (error) {\n          alert(`카드 복제에 실패했습니다.\\n${error?.message || error}`);\n          cloneBtn.disabled = !canEdit;\n          cloneBtn.textContent = "＋ 이 카드 복제";\n          status.textContent = "복제 실패";\n        }\n      });\n\n      deleteBtn.addEventListener("click", async () => {\n        if (!isManualCard(card)) return;\n        if (!confirm(`수동카드 ‘${cardTitle(card)}’를 완전히 삭제할까요?\\n\\n현재 시간표에 배치되어 있거나 묶음수업에 연결된 카드는 삭제되지 않습니다.`)) return;\n        deleteBtn.disabled = true;\n        deleteBtn.textContent = "삭제 중…";\n        try {\n          const result = await context.deleteManualCard?.(card.id);\n          if (result === false) throw new Error("수동카드를 삭제하지 못했습니다.");\n          selectedCardId = cards.find(row => row.id !== card.id)?.id || "";\n          renderGradeFilter();\n          renderList();\n          renderEditor();\n        } catch (error) {\n          alert(`수동카드 삭제에 실패했습니다.\\n${error?.message || error}`);\n          deleteBtn.disabled = !canEdit;\n          deleteBtn.textContent = "수동카드 삭제";\n        }\n      });\n\n      save.addEventListener("click", async () => {''',
    "action buttons",
)
replace_once(
    "js/timetable-card-editor.js",
    '''        const patch = {\n          teacherNames: selectedTeacherNames,''',
    '''        const manualSubject = isManualCard(card) ? clean(editor.querySelector('[data-field="subject"]')?.value) : "";\n        const manualSubjectEn = isManualCard(card) ? clean(editor.querySelector('[data-field="subjectEn"]')?.value) : "";\n        if (isManualCard(card) && !manualSubject) { alert("수동카드 과목명을 입력하세요."); return; }\n        const patch = {\n          subject: manualSubject,\n          subjectEn: manualSubjectEn,\n          teacherNames: selectedTeacherNames,''',
    "manual subject patch",
)

# 2) timetable.js · clone/delete persistence + manual subject edit
replace_once(
    "js/timetable.js",
    '''    const credits = Number(patch.credits);\n    if (!classKeys.length) throw new Error("대상 학급이 비어 있습니다.");\n    if (!Number.isFinite(credits) || credits < 0) throw new Error("주당 시수가 올바르지 않습니다.");\n\n    card.teacherIds = teacherIds;''',
    '''    const credits = Number(patch.credits);\n    if (!classKeys.length) throw new Error("대상 학급이 비어 있습니다.");\n    if (!Number.isFinite(credits) || credits < 0) throw new Error("주당 시수가 올바르지 않습니다.");\n    if (isManualTtCard(card)) {\n      const subject = clean(patch.subject || card.subject || card.label);\n      if (!subject) throw new Error("수동카드 과목명이 비어 있습니다.");\n      card.subject = subject;\n      card.label = subject;\n      card.subjectEn = clean(patch.subjectEn ?? card.subjectEn ?? "");\n    }\n\n    card.teacherIds = teacherIds;''',
    "manual subject persistence",
)
replace_once(
    "js/timetable.js",
    '''function getTimetableCardEditorOccurrences(cardId = "") {''',
    r'''async function cloneTimetableCardForManualUse(cardId = "") {
  if (!canEdit()) throw new Error("편집 권한이 없습니다.");
  const source = getTtCardById(clean(cardId));
  if (!source) throw new Error("복제할 시간표 카드를 찾을 수 없습니다.");

  const domain = ttDomain();
  if (!Array.isArray(domain.ttcards)) domain.ttcards = [];
  const cards = domain.ttcards;
  const previousCards = JSON.parse(JSON.stringify(cards));
  const now = new Date().toISOString();
  const id = uid("ttc_manual");
  captureTimetableUndo("시간표 수동카드 복제");

  try {
    const cloned = JSON.parse(JSON.stringify(source));
    cloned.id = id;
    cloned.templateId = `manual_${id}`;
    cloned.sectionIdx = 0;
    cloned.label = clean(source.subject || source.label || "새 수동카드") || "새 수동카드";
    cloned.subject = cloned.label;
    cloned.subjectEn = clean(source.subjectEn || "");
    cloned.category = clean(source.category || "교과") || "교과";
    cloned.track = "수동";
    cloned.group = "수동보정";
    cloned.studentKeys = [];
    cloned.generatedAt = now;
    cloned.manualEdited = true;
    cloned.isManual = true;
    cloned.manualCreatedAt = now;
    cloned.manualNote = `카드 상세에서 복제 · 원본 ${clean(source.id)}`;
    cloned.manualSourceCardId = clean(source.id);
    cloned.manualCardStatus = "stored";
    cloned.manualAutoAssign = false;
    cloned.autoAssignExcluded = true;
    cloned.compoundParentTemplateId = null;
    cloned.compoundPartId = null;
    cloned.compoundPartIndex = null;
    cloned.compoundPartCount = 0;
    cloned.compoundTotalCredits = 0;
    cloned.editedAt = now;

    // 자동배치/CP-SAT 실행 때 만든 파생값은 새 카드에 복사하지 않습니다.
    [
      "solverFixedRoomId", "solverFixedRoomIds", "solverFixedRoomSource", "solverFixedRoomGenerated",
      "solverRequiredRoomCount", "solverDurationPeriods", "solverTeacherIds", "solverTeacherNames",
      "lastPlacedAt", "lastAutoAssignedAt", "placementId", "entryId"
    ].forEach(key => { delete cloned[key]; });

    cards.push(cloned);
    scheduleSave("timetable");
    const saved = await saveNow("timetable", { force: true });
    if (saved === false) throw new Error("수동카드 저장이 완료되지 않았습니다.");
    if (typeof savePendingNow === "function") await savePendingNow();
    try { recomputeConflicts(); renderAll(); } catch (_) {}
    try { console.info(`[card-editor:r394] cloned source=${source.id} card=${id} autoAssignExcluded=1`); } catch (_) {}
    return id;
  } catch (error) {
    cards.splice(0, cards.length, ...previousCards);
    try { recomputeConflicts(); renderAll(); } catch (_) {}
    throw error;
  }
}

function cardGroupReferences(cardId = "") {
  const id = clean(cardId);
  const refs = [];
  (appState.timetable?.ttcardGroups || []).forEach(group => {
    if ((group.poolCardIds || []).includes(id)) refs.push(clean(group.name || group.id || "그룹"));
    if ((group.excludedCardIds || []).includes(id)) refs.push(clean(group.name || group.id || "그룹"));
    (group.units || []).forEach(unit => {
      if ((unit.ttcardIds || []).includes(id)) refs.push(clean(`${group.name || group.id || "그룹"} / ${unit.name || unit.id || "단위"}`));
    });
  });
  return [...new Set(refs.filter(Boolean))];
}

async function deleteManualTimetableCard(cardId = "") {
  if (!canEdit()) throw new Error("편집 권한이 없습니다.");
  const id = clean(cardId);
  const card = getTtCardById(id);
  if (!card) throw new Error("삭제할 시간표 카드를 찾을 수 없습니다.");
  if (!isManualTtCard(card)) throw new Error("커리큘럼 생성 카드는 여기서 삭제할 수 없습니다. 수동카드만 삭제할 수 있습니다.");

  const usedEntries = entries().filter(entry => ttCardIdsFromPlacement(entry).map(clean).includes(id));
  if (usedEntries.length) throw new Error(`현재 시간표에 ${usedEntries.length}회 배치된 카드입니다. 배치를 먼저 제거한 뒤 삭제하세요.`);
  const groupRefs = cardGroupReferences(id);
  if (groupRefs.length) throw new Error(`묶음/동시수업에 연결된 카드입니다. 그룹에서 먼저 빼 주세요: ${groupRefs.slice(0, 3).join(", ")}`);

  const domain = ttDomain();
  if (!Array.isArray(domain.ttcards)) domain.ttcards = [];
  const cards = domain.ttcards;
  const previousCards = JSON.parse(JSON.stringify(cards));
  const previousScheduleConditions = domain.scheduleConditions == null ? null : JSON.parse(JSON.stringify(domain.scheduleConditions));
  const previousMetaScheduleConditions = domain.autoAssignMeta?.scheduleConditions == null ? null : JSON.parse(JSON.stringify(domain.autoAssignMeta.scheduleConditions));
  captureTimetableUndo("시간표 수동카드 삭제");

  try {
    const index = cards.findIndex(row => clean(row.id) === id);
    if (index < 0) throw new Error("삭제할 카드가 목록에서 사라졌습니다.");
    cards.splice(index, 1);
    if (domain.scheduleConditions?.cards) delete domain.scheduleConditions.cards[id];
    if (domain.autoAssignMeta?.scheduleConditions?.cards) delete domain.autoAssignMeta.scheduleConditions.cards[id];

    scheduleSave("timetable");
    const saved = await saveNow("timetable", { force: true });
    if (saved === false) throw new Error("수동카드 삭제 저장이 완료되지 않았습니다.");
    if (typeof savePendingNow === "function") await savePendingNow();
    try { recomputeConflicts(); renderAll(); } catch (_) {}
    try { console.info(`[card-editor:r394] deleted manual card=${id}`); } catch (_) {}
    return true;
  } catch (error) {
    cards.splice(0, cards.length, ...previousCards);
    if (previousScheduleConditions == null) delete domain.scheduleConditions;
    else domain.scheduleConditions = previousScheduleConditions;
    if (!domain.autoAssignMeta || typeof domain.autoAssignMeta !== "object") domain.autoAssignMeta = {};
    if (previousMetaScheduleConditions == null) delete domain.autoAssignMeta.scheduleConditions;
    else domain.autoAssignMeta.scheduleConditions = previousMetaScheduleConditions;
    try { recomputeConflicts(); renderAll(); } catch (_) {}
    throw error;
  }
}

function getTimetableCardEditorOccurrences(cardId = "") {''',
    "manual card operations",
)
replace_once(
    "js/timetable.js",
    '''    canEdit,\n    applyCardPatch: applyTimetableCardEditorPatch,\n    applyOccurrenceRooms: applyTimetableCardOccurrenceRooms,''',
    '''    canEdit,\n    applyCardPatch: applyTimetableCardEditorPatch,\n    cloneCard: cloneTimetableCardForManualUse,\n    deleteManualCard: deleteManualTimetableCard,\n    applyOccurrenceRooms: applyTimetableCardOccurrenceRooms,''',
    "editor api callbacks",
)

# 3) timetable.html cache bust only. No top-bar button is added.
replace_once(
    "timetable.html",
    "2026-08-12-card-detail-editor-occurrence-rooms-r393",
    "2026-08-12-manual-card-clone-delete-r394",
    "html cache marker",
)

print("MANUAL_CARD_R394_APPLY_OK")
