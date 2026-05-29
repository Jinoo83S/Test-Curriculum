// ================================================================
// timetable-sidebar.js · Bottom Subject/Card Panel Rendering
// ================================================================

/**
 * Creates handlers for the timetable bottom card panel.
 * The module is intentionally dependency-injected so timetable.js can keep
 * the single source of truth for current drag state and render orchestration.
 */
export function createTimetableSidebarHandlers(deps) {
  const {
    GRADE_KEYS, appState, entries, $, makeBtn, canEdit,
    getTemplateById, getTemplateCardTitle,
    getTtCards, getTtCardById, refreshTtCardData,
    getGroupCards, getCreditsForTtCard, getTeachersForTtCard, getTtCardClassLabels, describeTtCard, calculateClassCreditSummary,
    getSubjectsForGrade, getUnitForTemplate, getUnitGradeKeys, getUnitTeachers,
    getCreditsForTemplate, getCategoryForTemplate, getTrackForTemplate, getGroupNameForTemplate, getSectionCount, entryTemplateIds, entryHasGrade,
    getGradeColor, gradeDisplay, sectionLabel,
    showSidebarCardDetail, showEntryDetailByUnit,
    renderAll, setDragData, scheduleSave = () => {},
  } = deps;

  function setDragging(value) {
    if (typeof setDragData === "function") setDragData(value);
  }

  const TT_DRAG_MIME = "application/x-his-timetable-drag";
  const GRADE_FILTER_STORAGE_KEY = "his_timetable_grade_filter";
  const CARD_SORT_STORAGE_KEY = "his_timetable_card_sort";
  let activeGradeFilter = loadGradeFilter();
  let activeCardSort = loadCardSort();

  function beginSidebarDrag(event, card, data, effect = "copy") {
    setDragging(data);
    if (event?.dataTransfer) {
      event.dataTransfer.effectAllowed = effect;
      const payload = JSON.stringify(data);
      event.dataTransfer.setData(TT_DRAG_MIME, payload);
      event.dataTransfer.setData("text/plain", payload);
    }
    card.classList.add("tt-dragging");
  }

  function endSidebarDrag(card) {
    setDragging(null);
    card.classList.remove("tt-dragging");
  }

  let subjectCardModal = null;
  let subjectCardModalBody = null;
  let subjectCardModalQuery = "";
  let subjectCardEditorSelectedId = "";
  let subjectCardEditorScrollState = { body: 0, list: 0 };

  function renderSubjectPanel() {
    renderSubjectPanelInto($("ttSubjectsContent"), { modal: false });
  }

  function refreshSubjectViews() {
    renderSubjectPanelInto($("ttSubjectsContent"), { modal: false });
    if (subjectCardModalBody && subjectCardModal?.isConnected) {
      renderSubjectCardEditor(subjectCardModalBody);
    }
  }

  function renderSubjectPanelInto(panel, { modal = false } = {}) {
    if (!panel) return;
    panel.innerHTML = "";
    panel.classList.toggle("tt-subject-modal-body-inner", !!modal);

    const toolbar = document.createElement("div");
    toolbar.className = "tt-card-toolbar his-card-toolbar" + (modal ? " is-modal" : "");

    const actionGroup = document.createElement("div");
    actionGroup.className = "tt-card-toolbar-actions";

    const loadBtn = makeBtn("📥 불러오기", "his-ui-btn his-ui-btn-secondary his-ui-btn-compact tt-toolbar-action", () => {
      refreshSubjectViews();
      alert(`저장된 시간표 카드 ${getTtCards().length}개를 불러왔습니다.`);
    });

    const refreshBtn = makeBtn("🔄 갱신", "his-ui-btn his-ui-btn-secondary his-ui-btn-compact tt-toolbar-action", () => {
      if (!canEdit()) return;
      const n = refreshTtCardData();
      alert(`${n}개 카드 데이터를 갱신했습니다.`);
      renderAll();
      refreshSubjectViews();
    });
    refreshBtn.disabled = !canEdit();

    const diagBtn = buildCreditDiagnosticButton(appState.timetable?.ttcards || []);
    actionGroup.append(loadBtn, refreshBtn, diagBtn);

    if (!modal) {
      const popupBtn = makeBtn("🗂 편집", "his-ui-btn his-ui-btn-primary his-ui-btn-compact tt-toolbar-action tt-subject-popup-open", () => {
        openSubjectCardModal();
      });
      popupBtn.title = "넓은 팝업창에서 과목 카드별 저장 데이터를 편집합니다.";
      actionGroup.append(popupBtn);
    }

    const ttcards = appState.timetable?.ttcards || [];
    toolbar.append(actionGroup, buildCardSortControls(), buildGradeFilterControls(ttcards));
    if (modal) toolbar.appendChild(buildSubjectCardSearchControl(panel));
    toolbar.appendChild(buildClassCountSummary(ttcards));
    panel.appendChild(toolbar);

    if (modal) {
      const note = document.createElement("div");
      note.className = "tt-subject-modal-note";
      note.textContent = "하단바 기능은 그대로 유지됩니다. 이 창에서는 과목 카드를 넓게 보고, 검색·정렬·필터·상세 확인을 할 수 있습니다.";
      panel.appendChild(note);
    }

    if (ttcards.length > 0) {
      renderSubjectPanelTtCards(panel, ttcards);
      if (modal) applySubjectCardSearch(panel);
      return;
    }

    renderSubjectPanelLegacy(panel);
    if (modal) applySubjectCardSearch(panel);
  }

  function buildSubjectCardSearchControl(panel) {
    const wrap = document.createElement("label");
    wrap.className = "tt-subject-card-search";
    wrap.innerHTML = `<span>검색</span>`;
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = "과목·교사·교실·반";
    input.value = subjectCardModalQuery;
    input.addEventListener("input", () => {
      subjectCardModalQuery = input.value || "";
      applySubjectCardSearch(panel);
    });
    wrap.appendChild(input);
    return wrap;
  }

  function applySubjectCardSearch(panel) {
    const root = panel || subjectCardModalBody;
    if (!root) return;
    const query = String(subjectCardModalQuery || "").trim().toLocaleLowerCase("ko");
    root.querySelectorAll(".tt-subject-card").forEach(card => {
      const haystack = String(card.dataset.searchText || card.textContent || "").toLocaleLowerCase("ko");
      card.classList.toggle("hidden", !!query && !haystack.includes(query));
    });
    root.querySelectorAll(".tt-card-status-section").forEach(section => {
      const visible = [...section.querySelectorAll(".tt-subject-card")].some(card => !card.classList.contains("hidden"));
      section.classList.toggle("is-search-empty", !visible);
    });
  }

  function openSubjectCardModal() {
    if (subjectCardModal?.isConnected) {
      subjectCardModal.classList.remove("hidden");
      subjectCardModal.focus?.();
      renderSubjectCardEditor(subjectCardModalBody);
      return;
    }

    subjectCardModal = document.createElement("div");
    subjectCardModal.className = "tt-subject-card-modal";
    subjectCardModal.tabIndex = -1;

    const dialog = document.createElement("div");
    dialog.className = "tt-subject-card-dialog";

    const header = document.createElement("div");
    header.className = "tt-subject-card-dialog-head";
    header.innerHTML = `<div><strong>과목 카드 편집</strong><span>저장된 시간표 카드 JSON 값을 카드별로 확인하고 수정합니다.</span></div>`;

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "tt-subject-card-dialog-close";
    closeBtn.textContent = "×";
    closeBtn.title = "닫기";
    closeBtn.addEventListener("click", closeSubjectCardModal);
    header.appendChild(closeBtn);

    subjectCardModalBody = document.createElement("div");
    subjectCardModalBody.className = "tt-subject-card-dialog-body";

    dialog.append(header, subjectCardModalBody);
    subjectCardModal.appendChild(dialog);
    document.body.appendChild(subjectCardModal);

    subjectCardModal.addEventListener("keydown", ev => {
      if (ev.key === "Escape") closeSubjectCardModal();
    });
    // 교사 조건 팝업처럼 작업용 창으로 사용하므로 바깥 클릭으로는 닫지 않습니다.

    renderSubjectCardEditor(subjectCardModalBody);
    subjectCardModal.focus?.();
  }

  function renderSubjectCardEditor(container, options = {}) {
    if (!container) return;
    const { preserveScroll = true } = options;
    const previousScroll = preserveScroll ? captureSubjectCardEditorScroll(container) : { body: 0, list: 0 };
    container.innerHTML = "";

    const allCards = getTtCards() || [];
    const query = String(subjectCardModalQuery || "").trim().toLocaleLowerCase("ko");
    let list = allCards.filter(card => cardMatchesActiveGradeFilter(card));
    if (query) {
      list = list.filter(card => getSubjectCardSearchText(card).includes(query));
    }
    list = sortEditableTtCards(list);

    if (!subjectCardEditorSelectedId || !allCards.some(card => card.id === subjectCardEditorSelectedId)) {
      subjectCardEditorSelectedId = list[0]?.id || allCards[0]?.id || "";
    }
    if (list.length && !list.some(card => card.id === subjectCardEditorSelectedId)) {
      subjectCardEditorSelectedId = list[0].id;
    }

    const layout = document.createElement("div");
    layout.className = "tt-subject-editor-layout";

    const left = buildSubjectEditorListPane(list, allCards.length);
    const card = getTtCardById(subjectCardEditorSelectedId) || list[0] || allCards[0] || null;
    const center = buildSubjectEditorFormPane(card);
    const right = buildSubjectEditorJsonPane(card);

    layout.append(left, center, right);
    container.appendChild(layout);
    restoreSubjectCardEditorScroll(container, previousScroll);
  }

  function captureSubjectCardEditorScroll(container) {
    return {
      body: container?.scrollTop || 0,
      list: container?.querySelector(".tt-subject-editor-card-list")?.scrollTop || subjectCardEditorScrollState.list || 0,
    };
  }

  function restoreSubjectCardEditorScroll(container, state = {}) {
    subjectCardEditorScrollState = {
      body: Number(state.body) || 0,
      list: Number(state.list) || 0,
    };
    requestAnimationFrame(() => {
      if (!container?.isConnected) return;
      const list = container.querySelector(".tt-subject-editor-card-list");
      if (list) list.scrollTop = subjectCardEditorScrollState.list;
      container.scrollTop = subjectCardEditorScrollState.body;
    });
  }

  function buildSubjectEditorListPane(cards, totalCount) {
    const pane = document.createElement("aside");
    pane.className = "tt-subject-editor-list-pane";

    const toolbar = document.createElement("div");
    toolbar.className = "tt-subject-editor-list-toolbar";

    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "과목·교사·반 검색";
    search.value = subjectCardModalQuery;
    search.addEventListener("input", () => {
      subjectCardModalQuery = search.value || "";
      renderSubjectCardEditor(subjectCardModalBody);
    });

    const sort = document.createElement("select");
    [
      ["name", "가나다"],
      ["group", "구분"],
      ["teacher", "교사"],
      ["room", "교실"],
    ].forEach(([value, text]) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = text;
      if (activeCardSort === value) opt.selected = true;
      sort.appendChild(opt);
    });
    sort.addEventListener("change", () => {
      activeCardSort = sort.value || "name";
      saveCardSort(activeCardSort);
      renderSubjectCardEditor(subjectCardModalBody);
    });

    toolbar.append(search, sort);
    pane.appendChild(toolbar);

    const gradeBar = document.createElement("div");
    gradeBar.className = "tt-subject-editor-gradebar";
    const summary = getClassCreditSummary(getTtCards());
    const options = [{ value: "all", label: `전체 ${totalCount}` }, ...getAvailableGradeFilterOptions(summary).map(opt => ({ value: opt.value, label: `${opt.label} ${opt.countText || ""}`.trim() }))];
    options.forEach(opt => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = opt.label;
      btn.className = activeGradeFilter === opt.value ? "active" : "";
      btn.addEventListener("click", () => {
        activeGradeFilter = opt.value;
        saveGradeFilter(activeGradeFilter);
        renderSubjectCardEditor(subjectCardModalBody);
        renderSubjectPanel();
      });
      gradeBar.appendChild(btn);
    });
    pane.appendChild(gradeBar);

    const count = document.createElement("div");
    count.className = "tt-subject-editor-count";
    count.textContent = `카드 ${cards.length}개 / 전체 ${totalCount}개`;
    pane.appendChild(count);

    const list = document.createElement("div");
    list.className = "tt-subject-editor-card-list";
    if (!cards.length) {
      const empty = document.createElement("div");
      empty.className = "tt-subject-editor-empty";
      empty.textContent = "조건에 맞는 카드가 없습니다.";
      list.appendChild(empty);
    }
    cards.forEach(card => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "tt-subject-editor-card-item" + (card.id === subjectCardEditorSelectedId ? " active" : "");
      const teachers = getEditableCardTeachers(card).join(", ") || "-";
      const labels = getClassLabelsForTtCard(card).join(", ") || `${gradeDisplay(card.gradeKey)}${sectionLabel(card.sectionIdx ?? 0)}`;
      item.innerHTML = `
        <strong>${escapeEditorHtml(getEditableCardTitle(card))}</strong>
        <span>${escapeEditorHtml(teachers)}</span>
        <em>${escapeEditorHtml(labels)}</em>
      `;
      item.addEventListener("click", () => {
        subjectCardEditorScrollState = captureSubjectCardEditorScroll(subjectCardModalBody);
        subjectCardEditorSelectedId = card.id;
        renderSubjectCardEditor(subjectCardModalBody, { preserveScroll: true });
      });
      list.appendChild(item);
    });
    pane.appendChild(list);
    return pane;
  }

  function buildSubjectEditorFormPane(card) {
    const pane = document.createElement("section");
    pane.className = "tt-subject-editor-form-pane";
    if (!card) {
      pane.innerHTML = `<div class="tt-subject-editor-empty">편집할 과목 카드가 없습니다.</div>`;
      return pane;
    }

    const title = document.createElement("div");
    title.className = "tt-subject-editor-pane-title";
    title.innerHTML = `<strong>${escapeEditorHtml(getEditableCardTitle(card))}</strong><span>${escapeEditorHtml(card.id || "")}</span>`;
    pane.appendChild(title);

    const form = document.createElement("div");
    form.className = "tt-subject-editor-form";

    const subject = makeEditorInput("과목명", card.subject || "", "text");
    const label = makeEditorInput("카드 라벨", card.label || "", "text", "비워두면 과목명을 사용합니다.");
    const teacher = makeEditorInput("담당 교사", card.teacherName || getEditableCardTeachers(card).join(", "), "text", "여러 명은 쉼표로 구분합니다.");
    const credits = makeEditorInput("시수", card.credits ?? "", "number");
    credits.input.step = "0.5";
    credits.input.min = "0";

    const metaRow = document.createElement("div");
    metaRow.className = "tt-subject-editor-grid-3";
    const category = makeEditorInput("영역", card.category || "", "text");
    const track = makeEditorInput("트랙", card.track || "", "text");
    const group = makeEditorInput("구분", card.group || "", "text");
    metaRow.append(category.wrap, track.wrap, group.wrap);

    const classLabels = makeEditorTextarea("대상 학급", (card.classLabels || []).join(", "), "예: 9A, 9B / 쉼표 또는 줄바꿈 구분");
    const classKeys = makeEditorTextarea("classKeys", (card.classKeys || []).join(", "), "고급 항목: 9:A 형식. 비워두면 대상 학급에서 자동 생성합니다.");
    const studentKeys = makeEditorTextarea("studentKeys", (card.studentKeys || []).join("\n"), "고급 항목: 수강명단 기준 학생 key. 직접 수정은 신중히 진행하세요.");

    const roomRow = document.createElement("div");
    roomRow.className = "tt-subject-editor-grid-2";
    const roomRule = makeEditorSelect("교실 규칙", [
      ["auto", "자동 추천"],
      ["teacher", "교사 담당교실"],
      ["homeroom", "홈룸"],
      ["fixed", "고정 교실"],
      ["none", "교실 없음"],
    ], card.roomRule || "auto");
    const fixedRoom = makeRoomSelect("고정 교실", card.fixedRoomId || "");
    roomRow.append(roomRule.wrap, fixedRoom.wrap);

    const flags = document.createElement("label");
    flags.className = "tt-subject-editor-check";
    const isWhole = document.createElement("input");
    isWhole.type = "checkbox";
    isWhole.checked = !!card.isWholeGrade;
    flags.append(isWhole, document.createTextNode(" 전체 학년/전체 반 수업으로 처리"));

    form.append(subject.wrap, label.wrap, teacher.wrap, credits.wrap, metaRow, classLabels.wrap, classKeys.wrap, studentKeys.wrap, roomRow, flags);

    const actions = document.createElement("div");
    actions.className = "tt-subject-editor-actions";
    const saveBtn = makeBtn("저장", "his-ui-btn his-ui-btn-primary his-ui-btn-compact", () => {
      if (!canEdit()) return;
      saveSubjectCardFromForm(card.id, {
        subject: subject.input.value,
        label: label.input.value,
        teacherName: teacher.input.value,
        credits: credits.input.value,
        category: category.input.value,
        track: track.input.value,
        group: group.input.value,
        classLabels: classLabels.input.value,
        classKeys: classKeys.input.value,
        studentKeys: studentKeys.input.value,
        roomRule: roomRule.input.value,
        fixedRoomId: fixedRoom.input.value,
        isWholeGrade: isWhole.checked,
      });
    });
    saveBtn.disabled = !canEdit();

    const detailBtn = makeBtn("상세보기", "his-ui-btn his-ui-btn-secondary his-ui-btn-compact", () => {
      const desc = describeTtCard(card);
      showSidebarCardDetail({
        title: desc.title,
        teachers: getEditableCardTeachers(card),
        gradeKeys: [card.gradeKey],
        credits: getCreditsForTtCard(card),
        assigned: countAssignedForCard(card),
        isDone: false,
        sectionIdx: card.sectionIdx,
        detailItems: [desc],
      });
    });
    actions.append(saveBtn, detailBtn);

    pane.append(form, actions);
    return pane;
  }

  function buildSubjectEditorJsonPane(card) {
    const pane = document.createElement("section");
    pane.className = "tt-subject-editor-json-pane";
    if (!card) return pane;

    const groupNames = getGroupsForCardId(card.id).map(g => g.name || g.id);
    const info = document.createElement("div");
    info.className = "tt-subject-editor-json-info";
    info.innerHTML = `
      <strong>저장 JSON</strong>
      <span>그룹: ${escapeEditorHtml(groupNames.join(", ") || "없음")}</span>
      <span>배정: ${countAssignedForCard(card)} / ${escapeEditorHtml(String(getCreditsForTtCard(card) || card.credits || 0))}</span>
    `;

    const ta = document.createElement("textarea");
    ta.spellcheck = false;
    ta.value = JSON.stringify(card, null, 2);

    const msg = document.createElement("div");
    msg.className = "tt-subject-editor-json-message";
    msg.textContent = "JSON을 직접 수정할 경우 id는 유지됩니다.";

    const apply = makeBtn("JSON 적용", "his-ui-btn his-ui-btn-secondary his-ui-btn-compact", () => {
      if (!canEdit()) return;
      try {
        const parsed = JSON.parse(ta.value || "{}");
        applySubjectCardJson(card.id, parsed);
        msg.textContent = "JSON을 적용했습니다.";
        msg.className = "tt-subject-editor-json-message ok";
      } catch (err) {
        msg.textContent = "JSON 형식 오류: " + (err?.message || err);
        msg.className = "tt-subject-editor-json-message error";
      }
    });
    apply.disabled = !canEdit();

    pane.append(info, ta, apply, msg);
    return pane;
  }

  function closeSubjectCardModal() {
    if (!subjectCardModal) return;
    subjectCardModal.remove();
    subjectCardModal = null;
    subjectCardModalBody = null;
  }

  function makeEditorInput(label, value, type = "text", hint = "") {
    const wrap = document.createElement("label");
    wrap.className = "tt-subject-editor-field";
    const span = document.createElement("span");
    span.textContent = label;
    const input = document.createElement("input");
    input.type = type;
    input.value = value ?? "";
    wrap.append(span, input);
    if (hint) {
      const small = document.createElement("em");
      small.textContent = hint;
      wrap.appendChild(small);
    }
    return { wrap, input };
  }

  function makeEditorTextarea(label, value, hint = "") {
    const wrap = document.createElement("label");
    wrap.className = "tt-subject-editor-field";
    const span = document.createElement("span");
    span.textContent = label;
    const input = document.createElement("textarea");
    input.value = value ?? "";
    wrap.append(span, input);
    if (hint) {
      const small = document.createElement("em");
      small.textContent = hint;
      wrap.appendChild(small);
    }
    return { wrap, input };
  }

  function makeEditorSelect(label, options, value) {
    const wrap = document.createElement("label");
    wrap.className = "tt-subject-editor-field";
    const span = document.createElement("span");
    span.textContent = label;
    const input = document.createElement("select");
    (options || []).forEach(([v, text]) => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = text;
      if (String(value ?? "") === String(v)) opt.selected = true;
      input.appendChild(opt);
    });
    wrap.append(span, input);
    return { wrap, input };
  }

  function makeRoomSelect(label, value) {
    const rooms = appState.rooms?.rooms || [];
    const options = [["", "선택 안 함"], ...rooms.map(r => [r.id, r.name || r.id])];
    return makeEditorSelect(label, options, value || "");
  }

  function saveSubjectCardFromForm(cardId, values) {
    const card = getTtCardById(cardId);
    if (!card) return;
    const classLabels = parseEditorList(values.classLabels);
    const classKeys = parseEditorList(values.classKeys);
    const studentKeys = parseEditorList(values.studentKeys);
    card.subject = String(values.subject || "").trim() || card.subject || "";
    card.label = String(values.label || "").trim();
    card.teacherName = String(values.teacherName || "").trim();
    card.teachers = splitEditorTeachers(card.teacherName);
    card.credits = parseFloat(values.credits) || 0;
    card.category = String(values.category || "").trim();
    card.track = String(values.track || "").trim();
    card.group = String(values.group || "").trim();
    card.classLabels = classLabels;
    card.classKeys = classKeys.length ? classKeys : classLabels.map(label => classLabelToKey(label, card.gradeKey)).filter(Boolean);
    card.studentKeys = studentKeys;
    card.roomRule = values.roomRule || "auto";
    card.fixedRoomId = values.roomRule === "fixed" ? (values.fixedRoomId || null) : (values.fixedRoomId || null);
    card.isWholeGrade = !!values.isWholeGrade;
    card.manualEdited = true;
    card.editedAt = new Date().toISOString();
    scheduleSave("timetable");
    renderAll();
    refreshSubjectViews();
  }

  function applySubjectCardJson(cardId, parsed) {
    const card = getTtCardById(cardId);
    if (!card || !parsed || typeof parsed !== "object") return;
    const keepId = card.id;
    Object.keys(card).forEach(key => delete card[key]);
    Object.assign(card, parsed, { id: keepId, manualEdited: true, editedAt: new Date().toISOString() });
    if (card.teacherName && !Array.isArray(card.teachers)) card.teachers = splitEditorTeachers(card.teacherName);
    if (Array.isArray(card.teachers) && !card.teacherName) card.teacherName = card.teachers.join(", ");
    scheduleSave("timetable");
    renderAll();
    refreshSubjectViews();
  }

  function parseEditorList(value) {
    return String(value || "")
      .split(/[,，\n]+/)
      .map(v => v.trim())
      .filter(Boolean);
  }

  function splitEditorTeachers(value) {
    return String(value || "")
      .split(/[,，·/]+/)
      .map(v => v.trim())
      .filter(Boolean);
  }

  function classLabelToKey(label, fallbackGradeKey = "") {
    const compact = String(label || "").replace(/\s+/g, "").replace(/학년/g, "").toUpperCase();
    const m = compact.match(/^(\d{1,2})([A-Z가-힣0-9]+)$/);
    if (m) return `${Number(m[1])}:${m[2]}`;
    const grade = gradeDisplay(fallbackGradeKey || "").replace(/[^0-9]/g, "");
    return grade && compact ? `${Number(grade)}:${compact.replace(/^\d{1,2}/, "")}` : "";
  }

  function getEditableCardTitle(card) {
    return card?.label || card?.subject || getTemplateCardTitle(getTemplateById(card?.templateId)) || "(제목 없음)";
  }

  function getEditableCardTeachers(card) {
    if (Array.isArray(card?.teachers) && card.teachers.length) return card.teachers.filter(Boolean);
    return splitEditorTeachers(card?.teacherName || "");
  }

  function getSubjectCardSearchText(card) {
    return String([
      getEditableCardTitle(card),
      getEditableCardTeachers(card).join(" "),
      gradeDisplay(card?.gradeKey),
      sectionLabel(card?.sectionIdx ?? 0),
      (card?.classLabels || []).join(" "),
      card?.category,
      card?.track,
      card?.group,
      roomNameById(card?.fixedRoomId),
    ].filter(Boolean).join(" ")).toLocaleLowerCase("ko");
  }

  function sortEditableTtCards(cards) {
    const field = activeCardSort === "teacher" ? "teacher" : activeCardSort === "group" ? "group" : activeCardSort === "room" ? "room" : "name";
    return [...(cards || [])].sort((a, b) => {
      const av = editableSortValue(a, field);
      const bv = editableSortValue(b, field);
      const primary = av.localeCompare(bv, "ko", { numeric: true, sensitivity: "base" });
      if (primary !== 0) return primary;
      return editableSortValue(a, "name").localeCompare(editableSortValue(b, "name"), "ko", { numeric: true, sensitivity: "base" });
    });
  }

  function editableSortValue(card, field) {
    if (field === "teacher") return normalizeSortText(getEditableCardTeachers(card).join(", "));
    if (field === "group") return normalizeSortText(card?.group || card?.track || card?.category || "");
    if (field === "room") return normalizeSortText(roomNameById(card?.fixedRoomId) || "");
    return normalizeSortText(getEditableCardTitle(card));
  }

  function countAssignedForCard(card) {
    if (!card) return 0;
    return entries().filter(e =>
      e.ttcardId === card.id ||
      (e.ttcardIds || []).includes(card.id) ||
      (entryTemplateIds(e).includes(card.templateId) && entryHasGrade(e, card.gradeKey) && (e.sectionIdx ?? 0) === (card.sectionIdx ?? 0))
    ).length;
  }

  function getGroupsForCardId(cardId) {
    if (!cardId) return [];
    return (appState.timetable?.ttcardGroups || []).filter(group =>
      (group.poolCardIds || []).includes(cardId) ||
      (group.excludedCardIds || []).includes(cardId) ||
      (group.units || []).some(unit => (unit.ttcardIds || []).includes(cardId))
    );
  }

  function escapeEditorHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function renderSubjectPanelTtCards(panel, allTtcards) {
    const availableCards = [];
    const doneCards = [];
    const seenIds = new Set();
    const grpList = appState.timetable.ttcardGroups || [];

    // ── Groups: one card per group ──────────────────────────────
    grpList.forEach(grp => {
      const grpCards = getGroupCards(grp);
      if (!grpCards.length) return;
      if (!cardsMatchActiveGradeFilter(grpCards)) return;
      grpCards.forEach(c => seenIds.add(c.id));

      const gradeKeys = [...new Set(grpCards.map(c => c.gradeKey).filter(Boolean))];
      const credits = Math.max(1, ...grpCards.map(getCreditsForTtCard).filter(v => v > 0));
      const teachers = [...new Set(grpCards.flatMap(c => getTeachersForTtCard(c)).filter(Boolean))];
      const relatedEntries = entries().filter(e =>
        e.groupId === grp.id || grpCards.some(c => e.ttcardId === c.id || (e.ttcardIds || []).includes(c.id))
      );
      const assigned = new Set(relatedEntries.map(e => `${e.day}:${e.period}`)).size;
      const isDone = credits > 0 && assigned >= credits;
      const gradeColor = getGradeColor(gradeKeys[0] || "7학년");
      const detailItems = grpCards.map(describeTtCard);
      const title = `[${grp.name}] ${detailItems.map(i => i.title).join(" · ")}`;
      const classLabels = compactClassLabelGroups(
        detailItems.flatMap(item => classLabelsFromDetailItem(item))
      );
      const card = buildSidebarCard({ title, teachers, gradeKeys, classLabels, credits, assigned, isDone, gradeColor, groupName: grp.name, detailItems, sortGroup: getSortGroupForCards(grpCards, grp.name), sortRoom: collectRoomNamesForEntries(relatedEntries).join(", ") });
      card.dataset.groupId = grp.id;
      card.style.outline = "1.5px solid " + gradeColor.border;
      if (!isDone) {
        card.addEventListener("dragstart", ev => {
          beginSidebarDrag(ev, card, { kind: "group", groupId: grp.id, ttcardIds: grpCards.map(c => c.id), gradeKey: gradeKeys[0] });
        });
        card.addEventListener("dragend", () => endSidebarDrag(card));
      }
      (isDone ? doneCards : availableCards).push(card);
    });

    // ── Standalone ttcards (not in any group) ────────────────────
    allTtcards.forEach(c => {
      if (seenIds.has(c.id)) return;
      if (!cardMatchesActiveGradeFilter(c)) return;
      const gradeColor = getGradeColor(c.gradeKey);
      const credits = getCreditsForTtCard(c);
      const desc = describeTtCard(c);
      const assigned = entries().filter(e =>
        (e.ttcardId === c.id || (e.ttcardIds || []).includes(c.id)) ||
        (entryTemplateIds(e).includes(c.templateId) && entryHasGrade(e, c.gradeKey) && (e.sectionIdx ?? 0) === c.sectionIdx)
      ).length;
      const isDone = credits > 0 && assigned >= credits;
      const relatedEntries = entries().filter(e =>
        (e.ttcardId === c.id || (e.ttcardIds || []).includes(c.id)) ||
        (entryTemplateIds(e).includes(c.templateId) && entryHasGrade(e, c.gradeKey) && (e.sectionIdx ?? 0) === c.sectionIdx)
      );
      const card = buildSidebarCard({
        title: desc.title,
        teachers: getTeachersForTtCard(c),
        gradeKeys: [c.gradeKey],
        classLabels: compactClassLabelGroups(getClassLabelsForTtCard(c)),
        credits,
        assigned,
        isDone,
        gradeColor,
        sectionIdx: c.sectionIdx,
        detailItems: [desc],
        sortGroup: getSortGroupForCards([c], desc.title),
        sortRoom: collectRoomNamesForEntries(relatedEntries).join(", ")
      });
      card.dataset.templateId = c.templateId;
      card.dataset.ttcardId = c.id;
      if (!isDone) {
        card.addEventListener("dragstart", ev => {
          beginSidebarDrag(ev, card, { kind: "subject", ttcardId: c.id, templateId: c.templateId, sectionIdx: c.sectionIdx, gradeKey: c.gradeKey });
        });
        card.addEventListener("dragend", () => endSidebarDrag(card));
      }
      (isDone ? doneCards : availableCards).push(card);
    });

    finalizeSidebarPanel(panel, availableCards, doneCards, "시간표 카드가 없습니다. '시간표 카드' 탭에서 카드를 생성하세요.");
  }

  function renderSubjectPanelLegacy(panel) {
    const availableCards = [];
    const doneCards = [];
    const seenUnitIds = new Set();
    const seenStandalone = new Set();

    GRADE_KEYS.forEach(gradeKey => {
      if (!gradeKeyMatchesActiveFilter(gradeKey)) return;
      getSubjectsForGrade(gradeKey).forEach(tpl => {
        const unitInfo = getUnitForTemplate(tpl.id);
        if (unitInfo) {
          const { group, unit } = unitInfo;
          if (seenUnitIds.has(unit.id)) return;
          seenUnitIds.add(unit.id);
          unit.templateIds.forEach(id => seenUnitIds.add("tpl:" + id));
          const gradeKeys = getUnitGradeKeys(unit);
          const teachers = getUnitTeachers(unit);
          const credits = Math.max(1, ...unit.templateIds.map(id =>
            Math.max(...gradeKeys.map(g => getCreditsForTemplate(g, id)).filter(c => c > 0), 0)
          ).filter(c => c > 0));
          const assigned = entries().filter(e => e.unitId === unit.id).length;
          const isDone = credits > 0 && assigned >= credits;
          const card = buildSidebarCard({
            title: getUnitDisplayTitleSafe(unit),
            teachers,
            gradeKeys,
            classLabels: compactClassLabelGroups(gradeKeys.map(g => formatFullClassLabel(g, sectionLabel(0)))),
            credits,
            assigned,
            isDone,
            gradeColor: getGradeColor(gradeKeys[0] || gradeKey),
            sortGroup: group?.name || getUnitDisplayTitleSafe(unit)
          });
          card.addEventListener("click", () => showEntryDetailByUnit(unit, group, gradeKeys));
          if (!isDone) {
            card.addEventListener("dragstart", ev => {
              beginSidebarDrag(ev, card, { kind: "subject", templateId: unit.templateIds[0], unitId: unit.id, groupId: group.id, sectionIdx: 0, gradeKey: gradeKeys[0] || gradeKey });
            });
            card.addEventListener("dragend", () => endSidebarDrag(card));
          }
          (isDone ? doneCards : availableCards).push(card);
        } else {
          if (seenUnitIds.has("tpl:" + tpl.id)) return;
          const credits = getCreditsForTemplate(gradeKey, tpl.id);
          const sections = getSectionCount(tpl.id);
          const teachers = getTeachersForTemplateSafe(tpl.id);
          for (let sec = 0; sec < Math.max(1, sections); sec++) {
            const key = `${tpl.id}:${gradeKey}:${sec}`;
            if (seenStandalone.has(key)) continue;
            seenStandalone.add(key);
            const assigned = entries().filter(e => entryTemplateIds(e).includes(tpl.id) && entryHasGrade(e, gradeKey) && e.sectionIdx === sec).length;
            const isDone = credits > 0 && assigned >= credits;
            const gradeColor = getGradeColor(gradeKey);
            const title = sections > 1 ? `${getTemplateCardTitle(tpl)} ${sectionLabel(sec)}` : getTemplateCardTitle(tpl);
            const card = buildSidebarCard({ title, teachers, gradeKeys: [gradeKey], classLabels: compactClassLabelGroups([formatFullClassLabel(gradeKey, sectionLabel(sec))]), credits, assigned, isDone, gradeColor, sortGroup: getTemplateMetaValue({ gradeKey, templateId: tpl.id }, getGroupNameForTemplate) || getTemplateMetaValue({ gradeKey, templateId: tpl.id }, getTrackForTemplate) || getTemplateMetaValue({ gradeKey, templateId: tpl.id }, getCategoryForTemplate) || title });
            if (!isDone) {
              card.addEventListener("dragstart", ev => {
                beginSidebarDrag(ev, card, { kind: "subject", templateId: tpl.id, sectionIdx: sec, gradeKey });
              });
              card.addEventListener("dragend", () => endSidebarDrag(card));
            }
            (isDone ? doneCards : availableCards).push(card);
          }
        }
      });
    });

    finalizeSidebarPanel(panel, availableCards, doneCards, "커리큘럼에 배치된 과목이 없습니다.");
  }

  function buildGradeFilterControls(ttcards) {
    const wrap = document.createElement("div");
    wrap.className = "tt-grade-filter-controls";

    const label = document.createElement("span");
    label.className = "tt-toolbar-label";
    label.textContent = "학년 필터";
    wrap.appendChild(label);

    const summary = getClassCreditSummary(ttcards);
    const gradeOptions = getAvailableGradeFilterOptions(summary);
    if (activeGradeFilter !== "all" && !gradeOptions.some(opt => opt.value === activeGradeFilter)) {
      activeGradeFilter = "all";
      saveGradeFilter(activeGradeFilter);
    }

    const makeFilterBtn = (value, text, countText) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tt-grade-filter-btn" + (activeGradeFilter === value ? " active" : "");
      btn.textContent = countText != null ? `${text} ${countText}` : text;
      btn.title = value === "all" ? "전체 학년 카드 보기" : `${text}학년 카드만 보기`;
      const active = activeGradeFilter === value;
      btn.addEventListener("click", () => {
        if (activeGradeFilter === value) return;
        activeGradeFilter = value;
        saveGradeFilter(value);
        refreshSubjectViews();
      });
      return btn;
    };

    wrap.appendChild(makeFilterBtn("all", "전체", formatCreditValue(summary.total)));
    gradeOptions.forEach(opt => wrap.appendChild(makeFilterBtn(opt.value, opt.label, opt.countText)));
    return wrap;
  }

  function getAvailableGradeFilterOptions(summary) {
    return (summary.gradeSummaries || []).map(gs => {
      const countText = gs.isBalanced
        ? formatCreditValue(gs.value)
        : `${formatCreditValue(gs.min)}~${formatCreditValue(gs.max)}`;
      return { value: gs.grade, label: gs.grade, countText };
    });
  }

  function filterTtCardsByGrade(ttcards) {
    if (activeGradeFilter === "all") return ttcards || [];
    return (ttcards || []).filter(card => cardMatchesActiveGradeFilter(card));
  }

  function cardsMatchActiveGradeFilter(cards) {
    if (activeGradeFilter === "all") return true;
    return (cards || []).some(card => cardMatchesActiveGradeFilter(card));
  }

  function cardMatchesActiveGradeFilter(card) {
    if (activeGradeFilter === "all") return true;
    return collectGradeNumbersForCard(card).has(activeGradeFilter);
  }

  function gradeKeyMatchesActiveFilter(gradeKey) {
    if (activeGradeFilter === "all") return true;
    return getGradeNumber(gradeKey) === activeGradeFilter;
  }

  function collectGradeNumbersForCard(card) {
    const grades = new Set();
    const gradeFromKey = getGradeNumber(card?.gradeKey);
    if (gradeFromKey) grades.add(gradeFromKey);
    getClassLabelsForTtCard(card).forEach(label => {
      const parsed = parseClassLabel(label);
      if (parsed.grade) grades.add(parsed.grade);
    });
    if (Array.isArray(card?.gradeKeys)) {
      card.gradeKeys.forEach(g => {
        const n = getGradeNumber(g);
        if (n) grades.add(n);
      });
    }
    return grades;
  }

  function getGradeNumber(value) {
    const m = String(value || "").match(/\d{1,2}/);
    return m ? String(Number(m[0])) : "";
  }

  function loadGradeFilter() {
    try {
      return localStorage.getItem(GRADE_FILTER_STORAGE_KEY) || "all";
    } catch (err) {
      return "all";
    }
  }

  function saveGradeFilter(value) {
    try {
      localStorage.setItem(GRADE_FILTER_STORAGE_KEY, value || "all");
    } catch (err) {
      // ignore storage errors
    }
  }

  function buildCardSortControls() {
    const wrap = document.createElement("label");
    wrap.className = "tt-card-sort-control";
    wrap.style.cssText = "display:flex;align-items:center;gap:5px;height:30px;padding:0 8px;border:1px solid #dbe4f0;border-radius:10px;background:#fff;font-size:11px;font-weight:900;color:#334155;white-space:nowrap;";

    const label = document.createElement("span");
    label.textContent = "정렬";
    label.className = "tt-toolbar-label";

    const select = document.createElement("select");
    select.className = "tt-card-sort-select";
    select.style.cssText = "height:24px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;padding:0 22px 0 7px;font-size:11px;font-weight:900;color:#0f172a;";
    [
      ["name", "가나다 순"],
      ["group", "구분 순"],
      ["teacher", "교사 순"],
      ["room", "교실 순"],
    ].forEach(([value, text]) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = text;
      if (activeCardSort === value) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener("change", () => {
      activeCardSort = select.value || "name";
      saveCardSort(activeCardSort);
      refreshSubjectViews();
    });

    wrap.append(label, select);
    return wrap;
  }

  function sortSidebarCards(cards) {
    const key = activeCardSort || "name";
    const field = key === "teacher" ? "sortTeacher" : key === "group" ? "sortGroup" : key === "room" ? "sortRoom" : "sortName";
    return [...(cards || [])].sort((a, b) => {
      const av = a?.dataset?.[field] || "";
      const bv = b?.dataset?.[field] || "";
      const primary = av.localeCompare(bv, "ko", { numeric: true, sensitivity: "base" });
      if (primary !== 0) return primary;
      return (a?.dataset?.sortName || "").localeCompare(b?.dataset?.sortName || "", "ko", { numeric: true, sensitivity: "base" });
    });
  }

  function loadCardSort() {
    try {
      const value = localStorage.getItem(CARD_SORT_STORAGE_KEY) || "name";
      return ["name", "group", "teacher", "room"].includes(value) ? value : "name";
    } catch (err) {
      return "name";
    }
  }

  function saveCardSort(value) {
    try {
      localStorage.setItem(CARD_SORT_STORAGE_KEY, value || "name");
    } catch (err) {
      // ignore storage errors
    }
  }

  function normalizeSortText(value) {
    return String(value || "").trim().replace(/^\[|\]$/g, "").toLocaleLowerCase("ko");
  }

  function guessGroupFromTitle(title) {
    const text = String(title || "").trim();
    const m = text.match(/^\[?\d{1,2}-([^\]\s]+)\]?/);
    if (m) return m[1];
    return text.split(/[\s/·,]+/)[0] || text;
  }

  function getTemplateMetaValue(card, getter) {
    if (!card || typeof getter !== "function") return "";
    try { return getter(card.gradeKey, card.templateId) || getter(card.templateId) || ""; }
    catch (err) { return ""; }
  }

  function getSortGroupForCards(cards, fallback = "") {
    const values = unique((cards || []).flatMap(card => [
      getTemplateMetaValue(card, getGroupNameForTemplate),
      getTemplateMetaValue(card, getTrackForTemplate),
      getTemplateMetaValue(card, getCategoryForTemplate),
    ]).filter(Boolean));
    return values.join(" / ") || fallback;
  }

  function roomNameById(roomId) {
    if (!roomId) return "";
    const room = (appState.rooms?.rooms || []).find(r => r.id === roomId);
    return room?.name || roomId;
  }

  function collectRoomNamesForEntries(list) {
    return unique((list || []).map(e => roomNameById(e.roomId)).filter(Boolean));
  }

  function collectRoomNamesForDetailItems(items) {
    return unique((items || []).map(item => roomNameById(item.fixedRoomId || item.roomId)).filter(Boolean));
  }

  function buildCreditDiagnosticButton(ttcards) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "his-ui-btn his-ui-btn-ghost his-ui-btn-compact tt-toolbar-action";
    btn.textContent = "🔎 진단";
    btn.title = "학급별 필요 시수 차이 원인을 확인합니다.";
    btn.addEventListener("click", () => showClassCreditDiagnostics(ttcards));
    return btn;
  }

  function buildClassCountSummary(ttcards) {
    const wrap = document.createElement("div");
    wrap.className = "tt-class-count-summary";

    const label = document.createElement("span");
    label.textContent = "학급별 필요 시수";
    label.className = "tt-toolbar-label";
    wrap.appendChild(label);

    const summary = getClassCreditSummary(ttcards);
    const rows = summary.classes || [];
    if (!rows.length) {
      const empty = document.createElement("span");
      empty.textContent = "없음";
      empty.className = "tt-summary-empty";
      wrap.appendChild(empty);
      return wrap;
    }

    rows.forEach(row => {
      const chip = document.createElement("span");
      const gc = getGradeColor(row.gradeKey || gradeKeyFromClassLabel(row.label));
      chip.textContent = `${row.label} ${formatCreditValue(row.credits)}`;
      chip.title = `${row.label} 필요 시수 ${formatCreditValue(row.credits)}`;
      chip.className = "tt-credit-chip";
      chip.style.setProperty("--tt-chip-bg", gc.bg);
      chip.style.setProperty("--tt-chip-border", gc.border);
      chip.style.setProperty("--tt-chip-text", gc.text);
      wrap.appendChild(chip);
    });
    return wrap;
  }

  function getClassCreditSummary(ttcards) {
    if (typeof calculateClassCreditSummary === "function") {
      return calculateClassCreditSummary(ttcards || [], appState.timetable?.ttcardGroups || []);
    }
    return { classes: [], gradeSummaries: [], total: 0, diagnostics: ["시수 계산 함수를 찾을 수 없습니다."] };
  }

  function showClassCreditDiagnostics(ttcards) {
    const summary = getClassCreditSummary(ttcards);
    const lines = [];
    lines.push("학급별 필요 시수 진단");
    lines.push("");
    (summary.gradeSummaries || []).forEach(gs => {
      const label = gs.isBalanced
        ? `${gs.grade}학년: ${formatCreditValue(gs.value)}시수 균형`
        : `${gs.grade}학년: ${formatCreditValue(gs.min)}~${formatCreditValue(gs.max)}시수 차이 있음`;
      lines.push(label);
      (gs.rows || []).forEach(row => {
        lines.push(`- ${row.label}: ${formatCreditValue(row.credits)}시수`);
      });
      lines.push("");
    });
    lines.push("차이 원인 후보");
    lines.push(...(summary.diagnostics || []));
    alert(lines.join("\n"));
  }

  function formatCreditValue(value) {
    const n = Number(value) || 0;
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
  }

  function getClassLabelsForTtCard(card) {
    if (!card) return [];

    // timetable-data.js의 canonical class helper를 우선 사용합니다.
    // 채플/창체/전체학년 카드에 과거 classLabels가 7A만 저장되어 있어도
    // 현재 학급 목록 기준으로 7A/7B 전체가 표시됩니다.
    if (typeof getTtCardClassLabels === "function") {
      const canonical = getTtCardClassLabels(card)
        .map(label => formatFullClassLabel(card.gradeKey, label))
        .filter(Boolean);
      if (canonical.length) return unique(canonical);
    }

    const labels = [];
    if (Array.isArray(card.classLabels) && card.classLabels.length) {
      card.classLabels.forEach(label => labels.push(formatFullClassLabel(card.gradeKey, label)));
    } else if (Array.isArray(card.classKeys) && card.classKeys.length) {
      card.classKeys.forEach(key => {
        const [g, sec] = String(key || "").split(":");
        labels.push(formatFullClassLabel(g ? `${g}학년` : card.gradeKey, sec));
      });
    } else {
      labels.push(formatFullClassLabel(card.gradeKey, sectionLabel(card.sectionIdx ?? 0)));
    }
    return unique(labels.filter(Boolean));
  }

  function classLabelsFromDetailItem(item) {
    if (!item) return [];
    const raw = Array.isArray(item.classLabels) && item.classLabels.length
      ? item.classLabels
      : [item.sectionLabel || sectionLabel(item.sectionIdx ?? 0)];
    return raw.map(label => formatFullClassLabel(item.gradeKey, label)).filter(Boolean);
  }

  function compactClassLabelGroups(labels) {
    const parsed = unique((labels || []).map(normalizeClassLabel).filter(Boolean))
      .map(label => parseClassLabel(label));
    const byGrade = new Map();
    const others = [];
    parsed.forEach(item => {
      if (!item.grade || !item.section) { others.push(item.raw); return; }
      if (!byGrade.has(item.grade)) byGrade.set(item.grade, []);
      byGrade.get(item.grade).push(item.section);
    });
    const grouped = [...byGrade.entries()]
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([grade, sections]) => `${grade}${unique(sections).sort(compareSectionLabels).join("")}`);
    return [...grouped, ...unique(others)];
  }

  function formatFullClassLabel(gradeKey, section) {
    const grade = gradeDisplay(gradeKey || "").replace(/[^0-9]/g, "");
    const secRaw = String(section || "").trim();
    if (!secRaw) return "";
    const compact = secRaw.replace(/\s+/g, "").replace(/학년/g, "").toUpperCase();
    const parsed = parseClassLabel(compact);
    if (parsed.grade && parsed.section) return `${parsed.grade}${parsed.section}`;
    const sec = compact.replace(/^\d{1,2}/, "");
    return grade && sec ? `${grade}${sec}` : compact;
  }

  function normalizeClassLabel(label) {
    const compact = String(label || "").replace(/\s+/g, "").replace(/학년/g, "").toUpperCase();
    const parsed = parseClassLabel(compact);
    return parsed.grade && parsed.section ? `${parsed.grade}${parsed.section}` : compact;
  }

  function parseClassLabel(label) {
    const raw = String(label || "").replace(/\s+/g, "").replace(/학년/g, "").toUpperCase();
    const m = raw.match(/^(\d{1,2})([A-Z가-힣0-9]+)$/);
    return m ? { raw, grade: m[1], section: m[2] } : { raw, grade: "", section: "" };
  }

  function gradeKeyFromClassLabel(label) {
    const parsed = parseClassLabel(label);
    return parsed.grade ? `${parsed.grade}학년` : "";
  }

  function compareClassLabels(a, b) {
    const pa = parseClassLabel(a);
    const pb = parseClassLabel(b);
    const ga = parseInt(pa.grade, 10) || 0;
    const gb = parseInt(pb.grade, 10) || 0;
    if (ga !== gb) return ga - gb;
    return compareSectionLabels(pa.section || pa.raw, pb.section || pb.raw);
  }

  function compareSectionLabels(a, b) {
    return String(a || "").localeCompare(String(b || ""), "ko", { numeric: true });
  }

  function unique(list) {
    return [...new Set((list || []).filter(Boolean))];
  }

  function getTeachersForTemplateSafe(templateId) {
    const cardHelpers = deps.getTeachersForTemplate;
    if (typeof cardHelpers === "function") return cardHelpers(templateId);
    const tpl = getTemplateById(templateId);
    const teacher = tpl?.teacher || tpl?.sem1Teacher || tpl?.sem2Teacher || "";
    return teacher ? [teacher] : [];
  }

  function getUnitDisplayTitleSafe(unit) {
    const fn = deps.getUnitDisplayTitle;
    if (typeof fn === "function") return fn(unit);
    return unit?.name || (unit?.templateIds || [])
      .map(id => getTemplateCardTitle(getTemplateById(id)))
      .filter(Boolean)
      .join(" / ") || "묶음수업";
  }

  function buildSidebarCard({ title, teachers, gradeKeys, classLabels = [], credits, assigned, isDone, gradeColor, sectionIdx, groupName, detailItems = [], sortGroup = "", sortRoom = "" }) {
    const card = document.createElement("div");
    card.className = "tt-subject-card tt-sc-compact" + (isDone ? " tt-subject-done" : "");
    card.style.borderLeftColor = isDone ? "#22c55e" : gradeColor.border;
    card.style.background = isDone ? "#f0fdf4" : gradeColor.bg + "dd";
    card.draggable = canEdit() && !isDone;
    const displayTitle = groupName || title;
    const uniqueTeachers = [...new Set(teachers || [])];
    card.dataset.sortName = normalizeSortText(displayTitle);
    card.dataset.sortTeacher = normalizeSortText(uniqueTeachers.join(", "));
    card.dataset.sortGroup = normalizeSortText(sortGroup || groupName || guessGroupFromTitle(displayTitle));
    card.dataset.sortRoom = normalizeSortText(sortRoom || collectRoomNamesForDetailItems(detailItems).join(", "));
    card.dataset.searchText = normalizeSortText([
      displayTitle,
      uniqueTeachers.join(", "),
      (classLabels || []).join(", "),
      (gradeKeys || []).join(", "),
      sortGroup,
      sortRoom,
      collectRoomNamesForDetailItems(detailItems).join(", ")
    ].filter(Boolean).join(" "));

    const row1 = document.createElement("div");
    row1.className = "tt-sc-row1";
    const nameEl = document.createElement("div");
    nameEl.className = "tt-sc-name";
    nameEl.textContent = displayTitle;
    nameEl.title = displayTitle;
    nameEl.style.textOverflow = "clip";
    const badge = document.createElement("span");
    badge.className = "tt-sc-badge";
    badge.textContent = `${assigned}/${credits}`;
    badge.style.background = isDone ? "#dcfce7" : assigned > 0 ? "#fef9c3" : "#f1f5f9";
    badge.style.color = isDone ? "#166534" : "#374151";
    row1.append(nameEl, badge);

    const row2 = document.createElement("div");
    row2.className = "tt-sc-row2";
    const tchEl = document.createElement("div");
    tchEl.className = "tt-sc-teacher";
    tchEl.textContent = uniqueTeachers.join(", ") || "-";
    tchEl.title = uniqueTeachers.join(", ");
    tchEl.style.textOverflow = "clip";
    const chipWrap = document.createElement("div");
    chipWrap.className = "tt-sc-grade-chips";
    const displayChips = classLabels?.length ? classLabels : compactClassLabelGroups((gradeKeys || []).map(g => `${gradeDisplay(g)}${sectionIdx != null ? sectionLabel(sectionIdx) : ""}`));
    displayChips.forEach(label => {
      const chip = document.createElement("span");
      const gradeKey = gradeKeyFromClassLabel(label) || (gradeKeys || [])[0];
      const gc = getGradeColor(gradeKey);
      chip.style.cssText = `font-size:8px;font-weight:800;padding:0 4px;line-height:14px;border-radius:999px;background:${gc.border};color:white;white-space:nowrap`;
      chip.textContent = label;
      chip.title = `대상 학급: ${label}`;
      chipWrap.appendChild(chip);
    });
    row2.append(tchEl, chipWrap);
    card.append(row1, row2);

    card.addEventListener("click", ev => {
      if (ev.defaultPrevented) return;
      showSidebarCardDetail({ title, teachers: uniqueTeachers, gradeKeys, credits, assigned, isDone, sectionIdx, groupName, detailItems });
    });

    return card;
  }

  function finalizeSidebarPanel(panel, available, done, emptyMsg) {
    if (!available.length && !done.length) {
      panel.appendChild(Object.assign(document.createElement("div"), { className: "tt-empty", textContent: emptyMsg }));
      return;
    }

    const appendSection = (title, cards, extraClass = "") => {
      if (!cards.length) return;
      const section = document.createElement("section");
      section.className = `tt-card-status-section ${extraClass}`.trim();
      const head = document.createElement("div");
      head.className = "tt-panel-section-title" + (extraClass ? " tt-panel-section-done" : "");
      head.textContent = title;
      const wrapper = document.createElement("div");
      wrapper.className = "tt-sc-cards";
      sortSidebarCards(cards).forEach(c => wrapper.appendChild(c));
      section.append(head, wrapper);
      panel.appendChild(section);
    };

    appendSection(`배치 필요 (${available.length})`, available);
    appendSection(`배치 완료 (${done.length})`, done, "is-done");
  }

  return { renderSubjectPanel };
}
