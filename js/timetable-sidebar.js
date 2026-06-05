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
      let n = getTtCards().length;
      if (n === 0 && canEdit()) {
        n = refreshTtCardData();
        if (n < 0) {
          alert("시간표 카드 원본 데이터가 아직 로딩되지 않았습니다. 잠시 후 다시 시도해 주세요.");
          return;
        }
        renderAll();
      }
      refreshSubjectViews();
      alert(`저장된 시간표 카드 ${n}개를 불러왔습니다.`);
    });

    const refreshBtn = makeBtn("🔄 갱신", "his-ui-btn his-ui-btn-secondary his-ui-btn-compact tt-toolbar-action", () => {
      if (!canEdit()) return;
      const n = refreshTtCardData();
      if (n < 0) {
        alert("시간표 카드 원본 데이터가 아직 로딩되지 않았습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }
      alert(`${n}개 카드 데이터를 갱신했습니다.`);
      renderAll();
      refreshSubjectViews();
    });
    refreshBtn.disabled = !canEdit();

    const manualBtn = makeBtn("➕ 수동 카드", "his-ui-btn his-ui-btn-primary his-ui-btn-compact tt-toolbar-action", () => {
      openManualTtCardDialog();
    });
    manualBtn.title = "커리큘럼에 없는 보정용 시간표 카드를 직접 생성합니다.";
    manualBtn.disabled = !canEdit();

    const diagBtn = buildCreditDiagnosticButton(appState.timetable?.ttcards || []);
    const compareBtn = buildCurriculumTimetableDiagnosticButton();
    actionGroup.append(loadBtn, refreshBtn, manualBtn, diagBtn, compareBtn);

    if (!modal) {
      const popupBtn = makeBtn("🗂 팝업", "his-ui-btn his-ui-btn-primary his-ui-btn-compact tt-toolbar-action tt-subject-popup-open", () => {
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

  function getManualClassRowsForGrade(gradeKey) {
    return (appState.classes?.classes || [])
      .filter(cls => String(cls.grade || "").trim() === gradeKey)
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ko"));
  }

  function manualClassLabel(gradeKey, sectionName) {
    const g = gradeDisplay(gradeKey);
    const sec = String(sectionName || "").trim().toUpperCase();
    return g && sec ? `${g}${sec}` : "";
  }

  function manualClassKeyFromLabel(label, fallbackGradeKey = "") {
    const compact = String(label || "").replace(/\s+/g, "").replace(/학년/g, "").toUpperCase();
    const m = compact.match(/^(\d{1,2})(.+)$/);
    if (m) return `${Number(m[1])}:${m[2]}`;
    const g = gradeDisplay(fallbackGradeKey);
    return g && compact ? `${g}:${compact}` : "";
  }

  function splitManualTeacherNames(value) {
    return unique(String(value || "").split(/[,，/+·&]|\band\b/gi).map(v => v.trim()).filter(Boolean));
  }

  function selectedManualAudience(gradeKey, selectedLabels = []) {
    const labels = unique((selectedLabels || []).map(v => String(v || "").trim()).filter(Boolean));
    const classKeys = unique(labels.map(label => manualClassKeyFromLabel(label, gradeKey)).filter(Boolean));
    const studentKeys = [];
    const selectedKeys = new Set(classKeys);
    (appState.classes?.classes || []).forEach(cls => {
      if (String(cls.grade || "").trim() !== gradeKey) return;
      const key = manualClassKeyFromLabel(manualClassLabel(gradeKey, cls.name), gradeKey);
      if (!selectedKeys.has(key)) return;
      (cls.students || []).forEach(stu => {
        const sid = stu?.id || stu?.studentId || stu?.name || "";
        if (sid) studentKeys.push(`${cls.id || key}:${sid}`);
      });
    });
    return { classLabels: labels, classKeys, studentKeys: unique(studentKeys) };
  }

  function openManualTtCardDialog() {
    if (!canEdit()) return;
    const overlay = document.createElement("div");
    overlay.className = "tt-manual-card-modal";
    overlay.style.cssText = "position:fixed;inset:0;z-index:2700;background:rgba(15,23,42,.42);display:flex;align-items:center;justify-content:center;padding:20px;";

    const dialog = document.createElement("div");
    dialog.className = "tt-manual-card-dialog";
    dialog.style.cssText = "width:min(720px,94vw);max-height:88vh;background:#fff;border-radius:16px;box-shadow:0 24px 70px rgba(15,23,42,.30);border:1px solid #dbe5f2;display:flex;flex-direction:column;overflow:hidden;";

    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 18px;border-bottom:1px solid #e2e8f0;background:#f8fafc;";
    header.innerHTML = `<div><div style="font-size:17px;font-weight:900;color:#0f172a;">수동 시간표 카드 생성</div><div style="margin-top:3px;font-size:12px;color:#64748b;line-height:1.45;">커리큘럼에 없는 보정용 카드를 직접 만들 수 있습니다. 생성된 카드는 카드 새로고침/재생성 시에도 유지됩니다.</div></div>`;
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "tt-subject-card-dialog-close";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => overlay.remove());
    header.appendChild(closeBtn);

    const body = document.createElement("div");
    body.style.cssText = "padding:16px 18px;overflow:auto;display:grid;gap:12px;";

    const field = (labelText, el, hint = "") => {
      const wrap = document.createElement("label");
      wrap.style.cssText = "display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:900;color:#334155;";
      const label = document.createElement("span");
      label.textContent = labelText;
      wrap.append(label, el);
      if (hint) {
        const h = document.createElement("span");
        h.textContent = hint;
        h.style.cssText = "font-size:11px;font-weight:700;color:#64748b;line-height:1.35;";
        wrap.appendChild(h);
      }
      return wrap;
    };
    const inputStyle = "height:34px;border:1px solid #cbd5e1;border-radius:9px;padding:0 10px;background:#fff;font-size:13px;font-weight:800;color:#0f172a;";

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.placeholder = "예: 12학년 보정 수업";
    titleInput.style.cssText = inputStyle;

    const row1 = document.createElement("div");
    row1.style.cssText = "display:grid;grid-template-columns:1.4fr .8fr .8fr;gap:10px;";
    const gradeSel = document.createElement("select");
    gradeSel.style.cssText = inputStyle;
    GRADE_KEYS.forEach(g => {
      const opt = document.createElement("option");
      opt.value = g;
      opt.textContent = `${gradeDisplay(g)}학년`;
      if (g === "12학년") opt.selected = true;
      gradeSel.appendChild(opt);
    });
    const creditInput = document.createElement("input");
    creditInput.type = "number";
    creditInput.min = "0.5";
    creditInput.step = "0.5";
    creditInput.value = "2";
    creditInput.style.cssText = inputStyle;
    const categorySel = document.createElement("select");
    categorySel.style.cssText = inputStyle;
    ["교과", "창체"].forEach(v => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      categorySel.appendChild(opt);
    });
    row1.append(field("학년", gradeSel), field("시수", creditInput), field("분류", categorySel));

    const teacherInput = document.createElement("input");
    teacherInput.type = "text";
    teacherInput.placeholder = "예: 담임교사 또는 담당교사";
    teacherInput.style.cssText = inputStyle;

    const groupInput = document.createElement("input");
    groupInput.type = "text";
    groupInput.placeholder = "예: 수동보정, 선택7, 자율 등";
    groupInput.value = "수동보정";
    groupInput.style.cssText = inputStyle;

    const wholeWrap = document.createElement("label");
    wholeWrap.style.cssText = "display:flex;align-items:center;gap:8px;font-size:12px;font-weight:900;color:#334155;";
    const wholeChk = document.createElement("input");
    wholeChk.type = "checkbox";
    wholeChk.checked = true;
    wholeWrap.append(wholeChk, document.createTextNode("선택한 학년 전체반을 동시에 점유하는 카드로 생성"));

    const classBox = document.createElement("div");
    classBox.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;padding:10px;border:1px solid #dbe4f0;border-radius:12px;background:#f8fafc;";

    const renderClassChecks = () => {
      classBox.innerHTML = "";
      const rows = getManualClassRowsForGrade(gradeSel.value);
      if (!rows.length) {
        const empty = document.createElement("div");
        empty.style.cssText = "font-size:12px;color:#64748b;font-weight:800;";
        empty.textContent = "해당 학년의 반 정보가 없습니다.";
        classBox.appendChild(empty);
        return;
      }
      rows.forEach(cls => {
        const labelText = manualClassLabel(gradeSel.value, cls.name);
        const chip = document.createElement("label");
        chip.style.cssText = "display:flex;align-items:center;gap:5px;padding:6px 9px;border:1px solid #cbd5e1;border-radius:999px;background:#fff;font-size:12px;font-weight:900;color:#0f172a;";
        const chk = document.createElement("input");
        chk.type = "checkbox";
        chk.value = labelText;
        chk.checked = true;
        chip.append(chk, document.createTextNode(labelText));
        classBox.appendChild(chip);
      });
    };
    renderClassChecks();
    gradeSel.addEventListener("change", renderClassChecks);

    const note = document.createElement("div");
    note.style.cssText = "padding:10px 12px;border-radius:12px;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;font-size:12px;line-height:1.45;font-weight:800;";
    note.textContent = "예: 12학년이 2시수 부족하면 제목과 시수 2를 입력하고 12A·12B·12C를 선택해 생성한 뒤, 하단 카드에서 드래그하여 시간표에 배치하세요.";

    body.append(
      field("카드명", titleInput),
      row1,
      field("담당 교사", teacherInput, "비워두면 교사 충돌 검사에서는 교사 없음 카드로 처리됩니다."),
      field("구분/그룹 표시", groupInput),
      wholeWrap,
      field("대상 반", classBox, "필요한 반만 체크할 수 있습니다. 전체반 수업은 모든 반을 선택하세요."),
      note
    );

    const footer = document.createElement("div");
    footer.style.cssText = "display:flex;justify-content:flex-end;gap:8px;padding:13px 18px;border-top:1px solid #e2e8f0;background:#f8fafc;";
    const cancelBtn = makeBtn("취소", "his-ui-btn his-ui-btn-secondary his-ui-btn-compact", () => overlay.remove());
    const createBtn = makeBtn("생성", "his-ui-btn his-ui-btn-primary his-ui-btn-compact", () => {
      const title = clean(titleInput.value);
      const credits = parseFloat(creditInput.value);
      if (!title) { alert("카드명을 입력해 주세요."); titleInput.focus(); return; }
      if (!Number.isFinite(credits) || credits <= 0) { alert("시수를 0보다 크게 입력해 주세요."); creditInput.focus(); return; }
      const selected = [...classBox.querySelectorAll('input[type="checkbox"]:checked')].map(chk => chk.value).filter(Boolean);
      if (!selected.length) { alert("대상 반을 하나 이상 선택해 주세요."); return; }

      const id = `ttc_manual_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const audience = selectedManualAudience(gradeSel.value, selected);
      const teachers = splitManualTeacherNames(teacherInput.value);
      const card = {
        id,
        templateId: `manual_${id}`,
        gradeKey: gradeSel.value,
        sectionIdx: 0,
        label: title,
        subject: title,
        subjectEn: "",
        teacherName: teachers.join(", "),
        teachers,
        credits,
        category: categorySel.value || "교과",
        track: "수동",
        group: clean(groupInput.value) || "수동보정",
        classKeys: audience.classKeys,
        classLabels: audience.classLabels,
        studentKeys: audience.studentKeys,
        isWholeGrade: !!wholeChk.checked && audience.classLabels.length === getManualClassRowsForGrade(gradeSel.value).length,
        roomRule: "auto",
        fixedRoomId: null,
        generatedAt: new Date().toISOString(),
        manualEdited: true,
        isManual: true,
        manualCreatedAt: new Date().toISOString(),
        manualNote: "시간표 편집 화면에서 수동 생성"
      };
      if (!Array.isArray(appState.timetable.ttcards)) appState.timetable.ttcards = [];
      appState.timetable.ttcards.push(card);
      scheduleSave("timetable");
      overlay.remove();
      renderAll();
      refreshSubjectViews();
    });
    footer.append(cancelBtn, createBtn);

    dialog.append(header, body, footer);
    overlay.appendChild(dialog);
    overlay.addEventListener("keydown", ev => { if (ev.key === "Escape") overlay.remove(); });
    document.body.appendChild(overlay);
    titleInput.focus();
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
      renderSubjectPanelInto(subjectCardModalBody, { modal: true });
      return;
    }

    subjectCardModal = document.createElement("div");
    subjectCardModal.className = "tt-subject-card-modal";
    subjectCardModal.tabIndex = -1;

    const dialog = document.createElement("div");
    dialog.className = "tt-subject-card-dialog";

    const header = document.createElement("div");
    header.className = "tt-subject-card-dialog-head";
    header.innerHTML = `<div><strong>과목 카드 팝업 편집</strong><span>저장된 시간표 카드 JSON 값을 카드별로 확인하고 수정합니다.</span></div>`;

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

  function renderSubjectCardEditor(container) {
    if (!container) return;
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
        subjectCardEditorSelectedId = card.id;
        renderSubjectCardEditor(subjectCardModalBody);
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
          beginSidebarDrag(ev, card, { kind: "group", groupId: grp.id, groupName: grp.name || "", ttcardIds: grpCards.map(c => c.id), gradeKey: gradeKeys[0] });
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
              beginSidebarDrag(ev, card, { kind: "subject", templateId: unit.templateIds[0], unitId: unit.id, groupId: group.id, groupName: group?.name || "", sectionIdx: 0, gradeKey: gradeKeys[0] || gradeKey });
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



  // ─────────────────────────────────────────────────────────────
  // Curriculum ↔ Timetable Read-only Diagnostic
  // ─────────────────────────────────────────────────────────────
  function buildCurriculumTimetableDiagnosticButton() {
    const btn = makeBtn("🧭 커리큘럼 대조", "his-ui-btn his-ui-btn-secondary his-ui-btn-compact tt-toolbar-action", () => {
      openCurriculumTimetableDiagnosticDialog();
    });
    btn.title = "커리큘럼 보드 → 수강명단 → 시간표카드 → 배치까지 변환 상태를 읽기 전용으로 점검합니다.";
    return btn;
  }

  function openCurriculumTimetableDiagnosticDialog() {
    const model = buildCurriculumTimetableDiagnosticModel();
    const overlay = document.createElement("div");
    overlay.className = "tt-curriculum-diagnostic-modal";
    overlay.style.cssText = "position:fixed;inset:0;z-index:2600;background:rgba(15,23,42,.38);display:flex;align-items:center;justify-content:center;padding:22px;";

    const dialog = document.createElement("div");
    dialog.className = "tt-curriculum-diagnostic-dialog";
    dialog.style.cssText = "width:min(1280px,96vw);height:min(820px,92vh);background:#fff;border-radius:16px;box-shadow:0 24px 70px rgba(15,23,42,.28);display:flex;flex-direction:column;overflow:hidden;border:1px solid #dbe5f2;";

    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:14px;padding:16px 18px;border-bottom:1px solid #e2e8f0;background:#f8fafc;";
    header.innerHTML = `<div><div style="font-weight:900;font-size:18px;color:#0f172a;">커리큘럼-시간표 대조 진단</div><div style="margin-top:3px;font-size:12px;color:#64748b;">읽기 전용 · 커리큘럼 보드, 수강명단, 시간표카드, 실제 배치의 차이를 비교합니다.</div></div>`;

    const headerActions = document.createElement("div");
    headerActions.style.cssText = "display:flex;gap:8px;align-items:center;";
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "his-ui-btn his-ui-btn-secondary his-ui-btn-compact";
    copyBtn.textContent = "복사";
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(buildCurriculumDiagnosticText(model));
        copyBtn.textContent = "복사됨";
        setTimeout(() => copyBtn.textContent = "복사", 1200);
      } catch (_) {
        alert("클립보드 복사에 실패했습니다. TXT 저장을 사용해 주세요.");
      }
    });
    const txtBtn = document.createElement("button");
    txtBtn.type = "button";
    txtBtn.className = "his-ui-btn his-ui-btn-secondary his-ui-btn-compact";
    txtBtn.textContent = "TXT 저장";
    txtBtn.addEventListener("click", () => {
      const blob = new Blob([buildCurriculumDiagnosticText(model)], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "커리큘럼_시간표_대조진단.txt";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "tt-subject-card-dialog-close";
    closeBtn.textContent = "×";
    closeBtn.title = "닫기";
    closeBtn.addEventListener("click", () => overlay.remove());
    headerActions.append(copyBtn, txtBtn, closeBtn);
    header.appendChild(headerActions);

    const body = document.createElement("div");
    body.style.cssText = "flex:1;overflow:auto;padding:16px 18px 22px;background:#ffffff;";
    body.appendChild(buildCurriculumDiagnosticPrettyView(model));

    dialog.append(header, body);
    overlay.appendChild(dialog);
    overlay.addEventListener("keydown", ev => { if (ev.key === "Escape") overlay.remove(); });
    document.body.appendChild(overlay);
    overlay.tabIndex = -1;
    overlay.focus?.();
  }

  function buildCurriculumTimetableDiagnosticModel() {
    const gradeBoards = appState.curriculum?.gradeBoards || {};
    const templates = appState.templates?.templates || [];
    const templateMap = new Map(templates.map(t => [t.id, t]));
    const rosters = appState.rosters?.rosters || {};
    const rosterMeta = appState.rosters?.rosterMeta || {};
    const cards = getTtCards() || [];
    const groups = appState.timetable?.ttcardGroups || [];
    const actualEntries = entries() || [];
    const classes = getDiagnosticClasses();
    const cardsByTemplateGrade = new Map();
    cards.forEach(card => {
      const key = diagnosticKey(card.templateId || card.compoundParentTemplateId, card.gradeKey);
      if (!cardsByTemplateGrade.has(key)) cardsByTemplateGrade.set(key, []);
      cardsByTemplateGrade.get(key).push(card);
    });

    const rows = [];
    const issues = [];
    const transforms = [];
    const gradeMap = new Map();
    const seenTemplateGrades = new Set();

    GRADE_KEYS.forEach(gradeKey => {
      const boardRows = gradeBoards[gradeKey] || [];
      const gradeClasses = classes.filter(cls => cls.grade === gradeKey || cls.grade === gradeDisplay(gradeKey));
      const gradeSummary = ensureGradeSummary(gradeMap, gradeKey, gradeClasses.length);
      boardRows.forEach((row, rowIndex) => {
        const templateIds = uniqueDiagnosticValues([row.sem1TemplateId, row.sem2TemplateId].filter(Boolean));
        if (!templateIds.length) {
          const item = makeCurriculumDiagRow({ gradeKey, row, rowIndex, status: "error", note: "커리큘럼 행에 과목카드가 연결되어 있지 않습니다.", template: null, actualCards: [] });
          rows.push(item); issues.push(item); updateGradeCounters(gradeSummary, item); return;
        }
        templateIds.forEach(templateId => {
          seenTemplateGrades.add(diagnosticKey(templateId, gradeKey));
          const template = templateMap.get(templateId);
          const actualCards = cardsByTemplateGrade.get(diagnosticKey(templateId, gradeKey)) || [];
          const item = makeCurriculumDiagRow({ gradeKey, row, rowIndex, template, actualCards, rosters, rosterMeta, groups, actualEntries });
          rows.push(item);
          updateGradeCounters(gradeSummary, item);
          if (item.level === "error" || item.level === "warn") issues.push(item);
          if (item.level === "info" || item.transformNote) transforms.push(item);
        });
      });
    });

    const orphanCards = cards.filter(card => !seenTemplateGrades.has(diagnosticKey(card.templateId || card.compoundParentTemplateId, card.gradeKey)));
    orphanCards.forEach(card => {
      const item = {
        level: "warn",
        status: "orphan-card",
        gradeKey: card.gradeKey || "",
        track: card.track || "",
        group: card.group || "",
        title: card.subject || card.label || card.templateId || "(제목 없음)",
        curriculumCredits: 0,
        expectedCredits: 0,
        actualCredits: Number(card.credits) || 0,
        actualCardCount: 1,
        studentCount: (card.studentKeys || []).length,
        note: "시간표카드는 있으나 현재 커리큘럼 행과 직접 연결되지 않습니다.",
        reason: "커리큘럼 보드의 해당 학년/과목카드 연결에서 찾지 못한 고아 카드입니다.",
        subjectClassCount: 0,
        actualClassCount: 1,
        coveredClassCount: getDiagnosticCoveredClassLabels([card]).length || 1,
        expectedCardCount: 0,
        expectedClassLabels: [],
        coveredClassLabels: getDiagnosticCoveredClassLabels([card]),
        cardSectionLabels: getDiagnosticCardSectionLabels([card]),
        targetClassLabelText: formatDiagnosticLabels(getDiagnosticCoveredClassLabels([card])),
        actualCards: [card],
      };
      issues.push(item);
      const gs = ensureGradeSummary(gradeMap, card.gradeKey || "기타", 0);
      gs.orphanCards += 1;
    });

    const gradeSummaries = [...gradeMap.values()].sort((a, b) => gradeOrderValue(a.gradeKey) - gradeOrderValue(b.gradeKey));
    const levelCounts = rows.reduce((acc, row) => { acc[row.level] = (acc[row.level] || 0) + 1; return acc; }, { ok: 0, info: 0, warn: 0, error: 0 });
    orphanCards.forEach(() => levelCounts.warn = (levelCounts.warn || 0) + 1);

    return {
      generatedAt: new Date().toLocaleString("ko-KR"),
      totals: {
        curriculumRows: rows.length,
        templateCount: templates.length,
        rosterSubjectCount: Object.keys(rosters).length,
        ttcardCount: cards.length,
        groupCount: groups.length,
        entryCount: actualEntries.length,
        issueCount: issues.length,
        transformCount: transforms.length,
        levelCounts,
      },
      gradeSummaries,
      rows,
      issues,
      transforms,
      orphanCards,
      groups,
    };
  }

  function makeCurriculumDiagRow({ gradeKey, row, rowIndex, template, actualCards = [], rosters = {}, rosterMeta = {}, groups = [], actualEntries = [] }) {
    const rawCredits = toDiagnosticNumber(row?.credits, 0);
    const title = template ? getTemplateCardTitle(template) : row?.sem1TemplateId || row?.sem2TemplateId || "(템플릿 없음)";
    const category = row?.category || "";
    const track = row?.track || "";
    const group = row?.group || "";
    const isZeroCreative = category === "창체" && rawCredits <= 0;
    const isCreative = category === "창체";
    const isCompound = !!template?.isCompound && Array.isArray(template?.compoundParts) && template.compoundParts.length > 0;
    const compoundPartCount = isCompound ? Math.max(1, template.compoundParts.length) : 1;
    const rosterCount = getDiagnosticRosterCountForGrade(rosters[template?.id] || [], gradeKey);
    const meta = rosterMeta?.[template?.id] || {};
    const missingExcluded = !!meta.missingExcluded;
    const isWholeGrade = isDiagnosticWholeGradeItem(row, template) || isCreative || actualCards.some(card => !!card.isWholeGrade);
    const groupInfo = getDiagnosticGroupInfo(actualCards, groups);

    // 과목 반수는 "실제 수업 섹션 수" 기준으로 계산합니다.
    // 전체학년 카드가 7A/7B를 모두 덮더라도 카드는 1개가 정상일 수 있으므로,
    // 대상 학급 수와 카드 생성 반수를 분리해서 진단합니다.
    const subjectClassCount = getDiagnosticSubjectClassCount(meta, actualCards, gradeKey, isWholeGrade);
    const actualClassCount = getDiagnosticActualClassCount(actualCards);
    const coveredClassLabels = getDiagnosticCoveredClassLabels(actualCards);
    const expectedClassLabels = getDiagnosticExpectedClassLabels({ gradeKey, subjectClassCount, isWholeGrade, actualCards });
    const cardSectionLabels = getDiagnosticCardSectionLabels(actualCards);
    const expectedCardCount = isZeroCreative ? 0 : Math.max(1, subjectClassCount || 1) * compoundPartCount;
    const actualCreditTotal = actualCards.reduce((sum, card) => sum + (Number(card.credits) || 0), 0);
    const actualCardCount = actualCards.length;
    const actualStudentCount = uniqueDiagnosticValues(actualCards.flatMap(card => card.studentKeys || [])).length;
    const expectedCredits = isZeroCreative ? 0 : isCreative ? 1 : rawCredits;
    const expectedCardMode = isZeroCreative ? "제외" : isCompound ? "복합 분할" : isCreative ? "창체 1시수" : "일반";

    let level = "ok";
    let status = "normal";
    let note = "정상";
    let transformNote = "";
    let reason = "";

    if (!template) {
      level = "error"; status = "missing-template"; note = "연결된 과목카드 템플릿을 찾지 못했습니다.";
    } else if (isZeroCreative) {
      level = actualCardCount ? "warn" : "info";
      status = actualCardCount ? "excluded-but-card-exists" : "excluded";
      note = actualCardCount ? "0시간 창체인데 시간표카드가 존재합니다." : "0시간 창체로 시간표카드 생성 제외됨.";
      reason = actualCardCount ? getDiagnosticCardMismatchReason({ actualCards, expectedCardCount, compoundParts: template?.compoundParts || [], subjectClassCount, isCompound }) : "생성 제외 조건이 정상 적용되었습니다.";
      transformNote = "창체 0시간 → 시간표 제외";
    } else if (isCompound) {
      const partCredits = template.compoundParts.reduce((sum, part) => sum + (Number(part.credits) || 0), 0);
      const expectedParts = template.compoundParts.length;
      const expectedTotalCredits = partCredits * Math.max(1, subjectClassCount || 1);
      const hasAllParts = expectedParts > 0 && new Set(actualCards.map(card => card.compoundPartId).filter(Boolean)).size >= expectedParts;
      if (!actualCardCount) {
        level = "error"; status = "missing-ttcard"; note = "복합과목인데 시간표 구성 카드가 없습니다.";
      } else if (!hasAllParts || actualCardCount !== expectedCardCount || Math.abs(actualCreditTotal - expectedTotalCredits) > 0.001) {
        level = "warn"; status = "compound-check"; note = `복합과목 구성 확인 필요 · 과목 반수 ${subjectClassCount || "?"}, 기대 카드 ${expectedCardCount}개/${formatDiagnosticNumber(expectedTotalCredits)}시수, 실제 카드 ${actualCardCount}개/${formatDiagnosticNumber(actualCreditTotal)}시수`;
      } else {
        level = "info"; status = "compound"; note = `복합과목 분할 생성 정상 · 과목 반수 ${subjectClassCount || actualClassCount || 1}`;
      }
      reason = getDiagnosticCardMismatchReason({ actualCards, expectedCardCount, compoundParts: template?.compoundParts || [], subjectClassCount, isCompound });
      transformNote = `복합과목 ${formatDiagnosticNumber(rawCredits)}시수 → ${template.compoundParts.map(p => `${p.nameKo || p.nameEn || "구성"} ${formatDiagnosticNumber(Number(p.credits)||0)}`).join(" + ")}`;
    } else if (!actualCardCount) {
      level = "error"; status = "missing-ttcard"; note = "커리큘럼에는 있으나 시간표카드가 없습니다.";
      reason = getDiagnosticCardMismatchReason({ actualCards, expectedCardCount, compoundParts: [], subjectClassCount, isCompound });
    } else if (subjectClassCount && actualCardCount !== expectedCardCount) {
      level = "warn"; status = "class-card-mismatch"; note = `과목 반수와 시간표카드 수가 맞지 않습니다 · 과목 반수 ${subjectClassCount}, 기대 카드 ${expectedCardCount}개, 실제 카드 ${actualCardCount}개`;
      reason = getDiagnosticCardMismatchReason({ actualCards, expectedCardCount, compoundParts: [], subjectClassCount, isCompound });
    } else if (isCreative && actualCards.some(card => (Number(card.credits) || 0) !== 1)) {
      level = "warn"; status = "creative-credit"; note = "창체 시간표카드는 1시수여야 합니다.";
      reason = "창체 카드는 커리큘럼 입력 시간과 관계없이 시간표에서는 1시수 카드로 변환되어야 합니다.";
      transformNote = `창체 ${formatDiagnosticNumber(rawCredits)}시간 → 시간표 1시수`;
    } else if (Math.max(...actualCards.map(card => Number(card.credits) || 0), 0) !== expectedCredits && !isCreative) {
      level = "warn"; status = "credit-mismatch"; note = `시수 확인 필요 · 커리큘럼 ${formatDiagnosticNumber(rawCredits)}, 시간표카드 ${actualCards.map(c => formatDiagnosticNumber(Number(c.credits)||0)).join("/")}`;
      reason = "시간표카드의 시수 스냅샷이 커리큘럼 원본 시수와 다릅니다. 카드 데이터 갱신 여부를 확인하세요.";
    } else if (isCreative) {
      level = "info"; status = "creative-transform"; note = "창체 시간→시간표 1시수 변환 정상";
      reason = `전체학년/창체 대상 반: ${coveredClassLabels.join(", ") || expectedClassLabels.join(", ") || "-"}`;
      transformNote = `창체 ${formatDiagnosticNumber(rawCredits)}시간 → 시간표 1시수`;
    }

    if (missingExcluded && rosterCount > 0 && level === "ok") {
      level = "info";
      status = "missing-excluded-with-students";
      note = "미지정 제외 표시가 있으나 실제 수강생이 있어 시간표카드에 포함됩니다.";
      reason = "수강명단에 학생이 남아 있어 생성 제외가 아니라 정상 카드 생성 대상으로 판단했습니다.";
    }

    const structuralReason = getDiagnosticCardMismatchReason({ actualCards, expectedCardCount, compoundParts: template?.compoundParts || [], subjectClassCount, isCompound });
    if (!reason && level === "ok" && structuralReason !== "카드 수와 섹션 구성이 기대값과 일치합니다.") {
      level = "warn";
      status = "section-mismatch";
      note = "카드 반 구성을 확인해야 합니다.";
      reason = structuralReason;
    }

    if (!reason) {
      reason = structuralReason;
      if (reason === "카드 수와 섹션 구성이 기대값과 일치합니다.") {
        const labelText = coveredClassLabels.join(", ") || expectedClassLabels.join(", ");
        reason = labelText ? `대상 반 ${labelText} 기준으로 일치합니다.` : reason;
      }
    }

    if (actualCardCount && actualStudentCount === 0 && groupInfo.count > 0 && (level === "ok" || level === "warn")) {
      level = "info";
      status = "group-placeholder";
      note = `수강생 0명 카드이지만 ${groupInfo.summary}에 포함되어 있어 의도적 묶음 유지 카드로 봅니다.`;
      reason = `동시수업 그룹(${groupInfo.summary})의 시간표 슬롯을 유지하기 위한 카드입니다.`;
      transformNote = "수강생 0명 카드 → 동시수업 그룹 유지용으로 인정";
    }

    const groupHitCount = groupInfo.count;
    const assignedCount = actualEntries.filter(e => actualCards.some(c => e.ttcardId === c.id || (e.ttcardIds || []).includes(c.id))).length;

    return {
      level, status, gradeKey, rowIndex, category, track, group, title,
      templateId: template?.id || row?.sem1TemplateId || row?.sem2TemplateId || "",
      curriculumCredits: rawCredits,
      expectedCredits,
      actualCredits: actualCreditTotal,
      actualCardCount,
      studentCount: actualStudentCount,
      rosterCount,
      classCountMeta: meta?.classCount || "",
      subjectClassCount,
      actualClassCount,
      coveredClassCount: coveredClassLabels.length,
      expectedClassLabels,
      coveredClassLabels,
      cardSectionLabels,
      targetClassLabelText: formatDiagnosticLabels(coveredClassLabels.length ? coveredClassLabels : expectedClassLabels),
      expectedCardCount,
      expectedCardMode,
      note,
      reason,
      transformNote,
      groupHitCount,
      groupNames: groupInfo.names,
      assignedCount,
      actualCards,
      compoundParts: template?.compoundParts || [],
    };
  }

  function buildCurriculumDiagnosticPrettyView(model) {
    const root = document.createElement("div");
    root.style.cssText = "display:flex;flex-direction:column;gap:16px;color:#0f172a;";

    const summary = document.createElement("div");
    summary.style.cssText = "display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;";
    [
      ["커리큘럼 행", model.totals.curriculumRows],
      ["수강명단 과목", model.totals.rosterSubjectCount],
      ["시간표카드", model.totals.ttcardCount],
      ["그룹", model.totals.groupCount],
      ["배치", model.totals.entryCount],
      ["확인 필요", model.totals.issueCount],
    ].forEach(([label, value]) => summary.appendChild(makeCurriculumDiagStat(label, value)));
    root.appendChild(summary);

    root.appendChild(makeCurriculumDiagSection("학년별 요약", buildCurriculumGradeSummaryTable(model.gradeSummaries), "커리큘럼 원본과 시간표카드 생성 결과를 학년별로 비교합니다."));
    root.appendChild(makeCurriculumDiagSection("확인 필요", buildCurriculumIssueTable(model.issues), "빨강은 오류, 노랑은 확인 필요입니다. 의도된 예외는 파랑/회색으로 표시됩니다."));
    root.appendChild(makeCurriculumDiagSection("의도된 변환/예외", buildCurriculumTransformTable(model.transforms), "창체 16시간→1시수, 0시간 제외, 복합과목 분할 등 의도된 차이를 따로 보여줍니다."));
    root.appendChild(makeCurriculumDiagSection("전체 상세", buildCurriculumFullTable(model.rows), "필요할 때만 펼쳐 확인하세요.", true));
    return root;
  }

  function makeCurriculumDiagStat(label, value) {
    const card = document.createElement("div");
    card.style.cssText = "border:1px solid #dbe5f2;border-radius:12px;background:#f8fafc;padding:12px;min-height:60px;";
    card.innerHTML = `<div style="font-size:12px;color:#64748b;font-weight:800;">${escapeEditorHtml(label)}</div><div style="font-size:22px;font-weight:900;margin-top:4px;color:#0f172a;">${escapeEditorHtml(String(value))}</div>`;
    return card;
  }

  function makeCurriculumDiagSection(title, content, desc = "", collapsed = false) {
    const details = document.createElement("details");
    details.open = !collapsed;
    details.style.cssText = "border:1px solid #dbe5f2;border-radius:14px;overflow:hidden;background:#fff;";
    const summary = document.createElement("summary");
    summary.style.cssText = "cursor:pointer;list-style:none;padding:12px 14px;background:#f1f5f9;border-bottom:1px solid #e2e8f0;";
    summary.innerHTML = `<div style="font-weight:900;font-size:15px;">${escapeEditorHtml(title)}</div>${desc ? `<div style="font-size:12px;color:#64748b;margin-top:2px;">${escapeEditorHtml(desc)}</div>` : ""}`;
    const body = document.createElement("div");
    body.style.cssText = "padding:12px;overflow:auto;";
    body.appendChild(content);
    details.append(summary, body);
    return details;
  }

  function buildCurriculumGradeSummaryTable(items) {
    return buildCurriculumDiagTable(["학년", "반", "커리큘럼", "시간표카드", "정상", "변환", "확인", "오류", "고아카드"], items.map(gs => [
      gs.gradeKey, gs.classCount, gs.curriculumRows, gs.ttcardCount, gs.ok, gs.info, gs.warn, gs.error, gs.orphanCards || 0
    ]));
  }

  function buildCurriculumIssueTable(items) {
    if (!items.length) return makeCurriculumDiagEmpty("확인 필요한 항목이 없습니다.");
    return buildCurriculumDiagTable(["상태", "학년", "구분", "과목", "반수", "대상 반", "커리큘럼", "카드", "학생", "원인/내용"], items.map(item => [
      levelBadgeHtml(item.level), item.gradeKey || "-", [item.track, item.group].filter(Boolean).join(" / ") || "-", item.title,
      formatDiagnosticClassCountCell(item), item.targetClassLabelText || formatDiagnosticLabels(item.coveredClassLabels || item.expectedClassLabels || []),
      formatDiagnosticNumber(item.curriculumCredits), `${item.actualCardCount || 0}/${item.expectedCardCount || 0}개 · ${formatDiagnosticNumber(item.actualCredits || 0)}시수`, item.studentCount ?? item.rosterCount ?? "-",
      [item.reason, item.note].filter(Boolean).join("\n")
    ]), true);
  }

  function buildCurriculumTransformTable(items) {
    const list = items.filter(item => item.transformNote || item.level === "info");
    if (!list.length) return makeCurriculumDiagEmpty("표시할 변환/예외 항목이 없습니다.");
    return buildCurriculumDiagTable(["종류", "학년", "구분", "과목", "변환 내용", "카드"], list.map(item => [
      levelBadgeHtml(item.level), item.gradeKey, [item.track, item.group].filter(Boolean).join(" / ") || "-", item.title,
      item.transformNote || item.note || "", `${item.actualCardCount || 0}개`
    ]), true);
  }

  function buildCurriculumFullTable(items) {
    if (!items.length) return makeCurriculumDiagEmpty("진단할 커리큘럼 행이 없습니다.");
    return buildCurriculumDiagTable(["상태", "학년", "분류", "구분", "교과군", "과목", "대상 반", "카드 반", "과목 반수", "실제 섹션", "대상 학급", "원본", "시간표", "카드", "학생", "메모/원인"], items.map(item => [
      levelBadgeHtml(item.level), item.gradeKey, item.category, item.track, item.group, item.title,
      item.targetClassLabelText || formatDiagnosticLabels(item.coveredClassLabels || item.expectedClassLabels || []),
      (item.cardSectionLabels || []).join(", ") || "-",
      item.subjectClassCount || "-", item.actualClassCount || "-", item.coveredClassCount || "-",
      formatDiagnosticNumber(item.curriculumCredits), formatDiagnosticNumber(item.expectedCredits), `${item.actualCardCount || 0}/${item.expectedCardCount || 0}`, item.studentCount, [item.note, item.reason].filter(Boolean).join("\n")
    ]), true);
  }

  function buildCurriculumDiagTable(headers, rows, htmlCells = false) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "overflow:auto;max-width:100%;";
    const table = document.createElement("table");
    table.style.cssText = "width:100%;border-collapse:collapse;font-size:12px;min-width:1080px;";
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    headers.forEach(h => {
      const th = document.createElement("th");
      th.textContent = h;
      th.style.cssText = "position:sticky;top:0;background:#eaf1fb;border:1px solid #d4e0ee;padding:7px 8px;text-align:left;font-weight:900;color:#1e3a5f;white-space:nowrap;";
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    const tbody = document.createElement("tbody");
    rows.forEach(row => {
      const tr = document.createElement("tr");
      row.forEach(cell => {
        const td = document.createElement("td");
        td.style.cssText = "border:1px solid #e2e8f0;padding:7px 8px;vertical-align:top;line-height:1.35;white-space:pre-line;";
        if (htmlCells && typeof cell === "string" && cell.startsWith("<")) td.innerHTML = cell;
        else td.textContent = String(cell ?? "");
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.append(thead, tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function makeCurriculumDiagEmpty(text) {
    const div = document.createElement("div");
    div.style.cssText = "padding:18px;border:1px dashed #cbd5e1;border-radius:10px;background:#f8fafc;color:#64748b;text-align:center;font-weight:700;";
    div.textContent = text;
    return div;
  }

  function levelBadgeHtml(level) {
    const map = {
      ok: ["정상", "#dcfce7", "#166534"],
      info: ["변환", "#dbeafe", "#1d4ed8"],
      warn: ["확인", "#fef3c7", "#92400e"],
      error: ["오류", "#fee2e2", "#b91c1c"],
    };
    const [text, bg, color] = map[level] || map.ok;
    return `<span style="display:inline-flex;align-items:center;border-radius:999px;padding:2px 8px;background:${bg};color:${color};font-weight:900;font-size:11px;white-space:nowrap;">${text}</span>`;
  }

  function buildCurriculumDiagnosticText(model) {
    const lines = [];
    lines.push("커리큘럼-시간표 대조 진단");
    lines.push(`생성: ${model.generatedAt}`);
    lines.push("");
    lines.push("[전체 요약]");
    lines.push(`- 커리큘럼 행: ${model.totals.curriculumRows}`);
    lines.push(`- 수강명단 과목: ${model.totals.rosterSubjectCount}`);
    lines.push(`- 시간표카드: ${model.totals.ttcardCount}`);
    lines.push(`- 그룹: ${model.totals.groupCount}`);
    lines.push(`- 배치: ${model.totals.entryCount}`);
    lines.push(`- 확인 필요: ${model.totals.issueCount}`);
    lines.push("");
    lines.push("[학년별 요약]");
    model.gradeSummaries.forEach(gs => lines.push(`- ${gs.gradeKey}: 반 ${gs.classCount}, 커리큘럼 ${gs.curriculumRows}, 카드 ${gs.ttcardCount}, 정상 ${gs.ok}, 변환 ${gs.info}, 확인 ${gs.warn}, 오류 ${gs.error}, 고아카드 ${gs.orphanCards || 0}`));
    lines.push("");
    lines.push("[확인 필요]");
    if (!model.issues.length) lines.push("- 없음");
    model.issues.forEach(item => lines.push(`- [${item.level}] ${item.gradeKey} / ${item.track || ""} / ${item.group || ""} / ${item.title}: ${item.note} (대상 반 ${item.targetClassLabelText || "-"}, 과목 반수 ${item.subjectClassCount || "-"}, 실제 섹션 ${item.actualClassCount || "-"}, 대상 학급 ${item.coveredClassCount || "-"}, 카드 ${item.actualCardCount || 0}/${item.expectedCardCount || 0}, 원인 ${item.reason || "-"})`));
    lines.push("");
    lines.push("[의도된 변환/예외]");
    const transforms = model.transforms.filter(item => item.transformNote || item.level === "info");
    if (!transforms.length) lines.push("- 없음");
    transforms.forEach(item => lines.push(`- ${item.gradeKey} / ${item.title}: ${item.transformNote || item.note}`));
    return lines.join("\n");
  }

  function getDiagnosticSubjectClassCount(meta, actualCards = [], gradeKey = "", isWholeGrade = false) {
    // 전체학년/창체/채플/자율/동아리는 대상 학급이 여러 개여도
    // 시간표카드 생성 단위는 1개 섹션이 정상입니다.
    if (isWholeGrade) return 1;

    const fromMeta = Number(meta?.classCount);
    if (Number.isFinite(fromMeta) && fromMeta > 0) return fromMeta;

    const sectionCount = getDiagnosticActualClassCount(actualCards);
    if (sectionCount > 0) return sectionCount;

    // 카드 생성 로직도 classCount가 비어 있으면 최소 1개 섹션을 만듭니다.
    return 1;
  }

  function getDiagnosticActualClassCount(actualCards = []) {
    return getDiagnosticSectionKeys(actualCards).length;
  }

  function getDiagnosticSectionKeys(actualCards = []) {
    const keys = new Set();
    (actualCards || []).forEach(card => {
      if (card.sectionIdx !== undefined && card.sectionIdx !== null) {
        keys.add(String(card.sectionIdx));
        return;
      }
      const id = card.id || card.ttcardId || "";
      const fallback = id.match(/::sec(\d+)/)?.[1] || id.match(/:(\d+)(?::|$)/)?.[1];
      if (fallback !== undefined && fallback !== null && fallback !== "") keys.add(String(fallback));
    });
    return [...keys].sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
  }

  function getDiagnosticCardSectionLabels(actualCards = []) {
    return getDiagnosticSectionKeys(actualCards).map(sec => sectionLabel(Number(sec) || 0));
  }

  function getDiagnosticCoveredClassLabels(actualCards = []) {
    const labels = [];
    (actualCards || []).forEach(card => {
      const cardLabels = getClassLabelsForTtCard(card);
      if (cardLabels.length) labels.push(...cardLabels);
      else labels.push(formatFullClassLabel(card.gradeKey, sectionLabel(card.sectionIdx ?? 0)));
    });
    return unique(labels.map(normalizeClassLabel).filter(Boolean)).sort(compareClassLabels);
  }

  function getDiagnosticExpectedClassLabels({ gradeKey = "", subjectClassCount = 0, isWholeGrade = false, actualCards = [] } = {}) {
    const actualLabels = getDiagnosticCoveredClassLabels(actualCards);
    if (actualLabels.length) return actualLabels;
    const gradeLabels = getDiagnosticGradeClassLabels(gradeKey);
    if (isWholeGrade && gradeLabels.length) return gradeLabels;
    const count = Math.max(1, Number(subjectClassCount) || 1);
    return Array.from({ length: count }, (_, idx) => formatFullClassLabel(gradeKey, sectionLabel(idx))).filter(Boolean);
  }

  function getDiagnosticGradeClassLabels(gradeKey = "") {
    const labels = getDiagnosticClasses()
      .filter(cls => cls.grade === gradeKey || cls.grade === gradeDisplay(gradeKey))
      .map((cls, idx) => formatFullClassLabel(gradeKey, cls.name || sectionLabel(idx)))
      .filter(Boolean);
    return unique(labels.map(normalizeClassLabel).filter(Boolean)).sort(compareClassLabels);
  }


  function isDiagnosticWholeGradeItem(row = null, template = null) {
    if ((row?.category || "") === "창체") return true;
    const text = [row?.category, row?.track, row?.group, template?.nameKo, template?.nameEn, template?.sem1NameKo, template?.sem1NameEn, template?.sem2NameKo, template?.sem2NameEn]
      .map(v => String(v ?? "").trim()).filter(Boolean).join(" ");
    return /(창체|채플|chapel|자율|동아리|전체|전학년|whole\s*grade|all\s*grade)/i.test(text);
  }

  function getDiagnosticGroupInfo(actualCards = [], groups = []) {
    const cardIds = new Set((actualCards || []).map(c => c.id).filter(Boolean));
    const names = [];
    let count = 0;
    (groups || []).forEach(g => {
      let hit = false;
      if ((g.poolCardIds || []).some(id => cardIds.has(id))) hit = true;
      if ((g.excludedCardIds || []).some(id => cardIds.has(id))) hit = true;
      if ((g.units || []).some(u => (u.ttcardIds || []).some(id => cardIds.has(id)))) hit = true;
      if (hit) {
        count += 1;
        names.push(g.name || g.id || "묶음");
      }
    });
    const uniqueNames = uniqueDiagnosticValues(names);
    return { count, names: uniqueNames, summary: uniqueNames.join(", ") || `${count}개 묶음` };
  }

  function getDiagnosticCardMismatchReason({ actualCards = [], expectedCardCount = 0, compoundParts = [], subjectClassCount = 0, isCompound = false } = {}) {
    const actualCardCount = actualCards.length;
    const reasons = [];
    if (actualCardCount < expectedCardCount) reasons.push(`카드 ${expectedCardCount - actualCardCount}개 부족`);
    if (actualCardCount > expectedCardCount) reasons.push(`카드 ${actualCardCount - expectedCardCount}개 초과`);

    const expectedSections = Math.max(1, Number(subjectClassCount) || 1);
    const cardsBySection = new Map();
    actualCards.forEach(card => {
      const sec = String(card.sectionIdx ?? 0);
      if (!cardsBySection.has(sec)) cardsBySection.set(sec, []);
      cardsBySection.get(sec).push(card);
    });
    const missingSections = [];
    for (let i = 0; i < expectedSections; i++) {
      if (!cardsBySection.has(String(i))) missingSections.push(sectionLabel(i));
    }
    if (missingSections.length) reasons.push(`누락 반 ${missingSections.join(", ")}`);

    const expectedPerSection = isCompound ? Math.max(1, compoundParts.length || 1) : 1;
    const duplicateSections = [...cardsBySection.entries()]
      .filter(([, list]) => list.length > expectedPerSection)
      .map(([sec, list]) => `${sectionLabel(Number(sec) || 0)} ${list.length}개`);
    if (duplicateSections.length) reasons.push(`중복/초과 반 ${duplicateSections.join(", ")}`);

    if (isCompound && compoundParts.length) {
      const expectedPartIds = compoundParts.map((part, idx) => String(part.id || `part${idx + 1}`));
      const partNames = new Map(compoundParts.map((part, idx) => [String(part.id || `part${idx + 1}`), part.nameKo || part.nameEn || `구성${idx + 1}`]));
      const sectionPartIssues = [];
      for (let i = 0; i < expectedSections; i++) {
        const sec = String(i);
        const cards = cardsBySection.get(sec) || [];
        const actualPartIds = new Set(cards.map(card => String(card.compoundPartId || "")).filter(Boolean));
        const missingPartNames = expectedPartIds.filter(id => !actualPartIds.has(id)).map(id => partNames.get(id) || id);
        if (missingPartNames.length) sectionPartIssues.push(`${sectionLabel(i)}: ${missingPartNames.join(", ")}`);
      }
      if (sectionPartIssues.length) reasons.push(`복합 구성 누락 ${sectionPartIssues.join(" / ")}`);
    }

    if (!actualCardCount && expectedCardCount > 0) reasons.push("시간표카드가 생성되지 않았습니다. 카드 데이터 갱신 또는 수강명단 반수 설정을 확인하세요.");
    return reasons.length ? reasons.join(" · ") : "카드 수와 섹션 구성이 기대값과 일치합니다.";
  }

  function formatDiagnosticClassCountCell(item) {
    const expected = item?.subjectClassCount || "-";
    const actualSections = item?.actualClassCount || "-";
    const covered = item?.coveredClassCount || "-";
    return `${expected} / ${actualSections} / ${covered}`;
  }

  function formatDiagnosticLabels(labels = []) {
    const list = unique((labels || []).map(normalizeClassLabel).filter(Boolean)).sort(compareClassLabels);
    if (!list.length) return "-";
    const compact = compactClassLabelGroups(list);
    return compact.join(", ");
  }

  function getDiagnosticClasses() {
    const list = appState.classes?.classes;
    return Array.isArray(list) ? list : [];
  }

  function getDiagnosticRosterCountForGrade(rosterRows, gradeKey) {
    const classIds = new Set(getDiagnosticClasses().filter(cls => cls.grade === gradeKey || cls.grade === gradeDisplay(gradeKey)).map(cls => cls.id));
    const ids = new Set();
    (rosterRows || []).forEach(row => {
      if (!classIds.has(row.classId)) return;
      ids.add(row.studentId || `${row.classId}:${row.studentKey || ""}`);
    });
    return ids.size;
  }

  function ensureGradeSummary(map, gradeKey, classCount = 0) {
    if (!map.has(gradeKey)) map.set(gradeKey, { gradeKey, classCount, curriculumRows: 0, ttcardCount: 0, ok: 0, info: 0, warn: 0, error: 0, orphanCards: 0 });
    const item = map.get(gradeKey);
    if (classCount && !item.classCount) item.classCount = classCount;
    return item;
  }

  function updateGradeCounters(summary, item) {
    summary.curriculumRows += 1;
    summary.ttcardCount += item.actualCardCount || 0;
    summary[item.level] = (summary[item.level] || 0) + 1;
  }

  function diagnosticKey(templateId, gradeKey) {
    return `${templateId || ""}::${gradeKey || ""}`;
  }

  function uniqueDiagnosticValues(values) {
    return [...new Set((values || []).filter(v => v !== null && v !== undefined && String(v) !== ""))];
  }

  function toDiagnosticNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function formatDiagnosticNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value ?? "");
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
  }

  function gradeOrderValue(gradeKey) {
    const n = Number(String(gradeKey || "").match(/\d+/)?.[0] || 999);
    return Number.isFinite(n) ? n : 999;
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
    const report = buildClassCreditDiagnosticReport(summary, ttcards || []);
    openCreditDiagnosticDialog(report, summary, ttcards || []);
  }

  function buildClassCreditDiagnosticReport(summary, ttcards) {
    const lines = [];
    const groups = appState.timetable?.ttcardGroups || [];
    const rows = summary.classes || [];
    const gradeSummaries = summary.gradeSummaries || [];

    lines.push("학급별 필요 시수 상세 진단");
    lines.push(`생성 시각: ${new Date().toLocaleString("ko-KR")}`);
    lines.push("");
    lines.push("[전체 요약]");
    lines.push(`- 시간표 카드: ${(ttcards || []).length}개`);
    lines.push(`- 동시배정/그룹: ${groups.length}개`);
    lines.push(`- 진단 대상 학급: ${rows.length}개`);
    lines.push(`- 총 필요 시수 기준 합계: ${formatCreditValue(summary.total || 0)}시수`);
    lines.push("");

    const capacityRows = buildGradeCapacityRows(summary, ttcards || []);
    lines.push("[시간표 전체 용량 비교]");
    lines.push(`- 설정: 월~금 ${getConfiguredPeriodCount()}교시 = 학급당 ${getWeeklySlotCapacityPerClass()}칸`);
    if (!capacityRows.length) {
      lines.push("- 비교할 학년 데이터가 없습니다.");
    } else {
      capacityRows.forEach(row => {
        const diffText = row.perClassDiff >= 0
          ? `학급당 여유 ${formatCreditValue(row.perClassDiff)}칸`
          : `학급당 초과 ${formatCreditValue(Math.abs(row.perClassDiff))}칸`;
        lines.push(`- ${row.gradeLabel}: ${row.classCount}개 반 / 카드 ${row.cardCount}개 / 그룹 ${row.groupCount}개 / 필요 ${formatCreditValue(row.requiredMin)}~${formatCreditValue(row.requiredMax)}시수 / ${diffText}`);
      });
    }
    lines.push("");

    lines.push("[학년별 요약]");
    if (!gradeSummaries.length) {
      lines.push("- 진단할 학급별 시수 데이터가 없습니다.");
    }
    gradeSummaries.forEach(gs => {
      const diff = (Number(gs.max) || 0) - (Number(gs.min) || 0);
      const status = gs.isBalanced ? "균형" : `차이 ${formatCreditValue(diff)}시수`;
      lines.push(`- ${gs.grade}학년: ${formatCreditValue(gs.min)}~${formatCreditValue(gs.max)}시수 / ${status}`);
      (gs.rows || []).forEach(row => {
        const lack = (Number(gs.max) || 0) - (Number(row.credits) || 0);
        lines.push(`  · ${row.label}: ${formatCreditValue(row.credits)}시수${lack > 0 ? ` / 기준보다 ${formatCreditValue(lack)}시수 적음` : ""}`);
      });
    });
    lines.push("");

    const unbalanced = gradeSummaries.filter(gs => !gs.isBalanced);
    lines.push("[차이 원인 후보]");
    if (!unbalanced.length) {
      lines.push("- 학급별 필요 시수가 모두 균형 상태입니다.");
    } else {
      unbalanced.forEach(gs => {
        lines.push(`${gs.grade}학년`);
        const max = Number(gs.max) || 0;
        (gs.rows || []).forEach(row => {
          const lack = max - (Number(row.credits) || 0);
          if (lack <= 0) return;
          lines.push(`- ${row.label}: ${formatCreditValue(row.credits)}시수 / ${formatCreditValue(lack)}시수 부족`);
          appendContributionList(lines, row.contributions || [], { indent: "  ", limit: 999 });
        });
      });
    }
    lines.push("");

    lines.push("[학급별 상세 내역]");
    if (!rows.length) {
      lines.push("- 내역 없음");
    }
    rows.forEach(row => {
      lines.push(`${row.label} · 총 ${formatCreditValue(row.credits)}시수`);
      appendContributionList(lines, row.contributions || [], { indent: "  ", limit: 999 });
      lines.push("");
    });

    lines.push("[그룹별 계산 참고]");
    if (!groups.length) {
      lines.push("- 그룹 없음");
    } else {
      groups.forEach(group => {
        const cards = getGroupCards(group) || [];
        const groupTitle = group.name || group.title || group.id || "그룹";
        lines.push(`- ${groupTitle}: ${cards.length}개 카드`);
        cards.forEach(card => {
          const title = getCardDiagnosticTitle(card);
          const classes = getClassLabelsForTtCard(card).join(", ") || "학급 없음";
          const teachers = (getTeachersForTtCard(card) || []).join(", ") || card.teacherName || "교사 없음";
          lines.push(`  · ${title} / ${formatCreditValue(getCreditsForTtCard(card))}시수 / ${teachers} / ${classes}`);
        });
      });
    }

    return lines.join("\n");
  }

  function appendContributionList(lines, contributions, { indent = "", limit = 999 } = {}) {
    if (!contributions.length) {
      lines.push(`${indent}- 세부 내역 없음`);
      return;
    }
    contributions.slice(0, limit).forEach(c => {
      const kind = c.kind === "group" ? `[그룹] ${c.groupName || "그룹"}` : "[개별]";
      const title = c.title || c.cardId || "시간표 카드";
      lines.push(`${indent}- ${kind} ${title}: ${formatCreditValue(c.credits)}시수`);
    });
    if (contributions.length > limit) {
      lines.push(`${indent}- ... 외 ${contributions.length - limit}개`);
    }
  }

  function getCardDiagnosticTitle(card) {
    if (!card) return "?";
    try {
      return describeTtCard?.(card)?.title || card.subject || card.label || card.nameKo || card.id || "시간표 카드";
    } catch (err) {
      return card.subject || card.label || card.nameKo || card.id || "시간표 카드";
    }
  }

  function openCreditDiagnosticDialog(reportText, summary = {}, ttcards = []) {
    const old = document.querySelector(".tt-credit-diagnostic-modal");
    if (old) old.remove();

    const overlay = document.createElement("div");
    overlay.className = "tt-credit-diagnostic-modal";
    Object.assign(overlay.style, {
      position: "fixed", inset: "0", zIndex: "99999",
      background: "rgba(15,23,42,0.42)", display: "flex",
      alignItems: "center", justifyContent: "center", padding: "22px"
    });

    const box = document.createElement("div");
    Object.assign(box.style, {
      width: "min(1180px, 97vw)", height: "min(820px, 92vh)",
      background: "#fff", borderRadius: "16px", border: "1px solid #d8e1ef",
      boxShadow: "0 24px 70px rgba(15,23,42,.30)", display: "flex",
      flexDirection: "column", overflow: "hidden"
    });

    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px",
      padding: "13px 18px", borderBottom: "1px solid #e5eaf3", background: "#f8fbff"
    });

    const title = document.createElement("div");
    const titleMain = document.createElement("strong");
    titleMain.textContent = "학급별 필요 시수 상세 진단";
    titleMain.style.fontSize = "15px";
    const titleSub = document.createElement("div");
    titleSub.textContent = "요약 → 차이 원인 → 학급별 상세 → 그룹별 참고 순서로 확인합니다.";
    Object.assign(titleSub.style, { fontSize: "12px", color: "#64748b", marginTop: "3px" });
    title.append(titleMain, titleSub);
    header.appendChild(title);

    const actions = document.createElement("div");
    Object.assign(actions.style, { display: "flex", gap: "8px", flexShrink: "0" });

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "his-ui-btn his-ui-btn-secondary his-ui-btn-compact";
    copyBtn.textContent = "복사";
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(reportText);
        copyBtn.textContent = "복사됨";
        setTimeout(() => { copyBtn.textContent = "복사"; }, 1200);
      } catch (err) {
        const tmp = document.createElement("textarea");
        tmp.value = reportText;
        document.body.appendChild(tmp);
        tmp.select();
        document.execCommand("copy");
        tmp.remove();
      }
    };

    const downloadBtn = document.createElement("button");
    downloadBtn.type = "button";
    downloadBtn.className = "his-ui-btn his-ui-btn-primary his-ui-btn-compact";
    downloadBtn.textContent = "TXT 저장";
    downloadBtn.onclick = () => {
      const blob = new Blob([reportText], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "시간표_시수진단.txt";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 500);
    };

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "his-ui-btn his-ui-btn-ghost his-ui-btn-compact";
    closeBtn.textContent = "닫기";
    closeBtn.onclick = () => overlay.remove();

    actions.append(copyBtn, downloadBtn, closeBtn);
    header.appendChild(actions);

    const body = document.createElement("div");
    Object.assign(body.style, {
      flex: "1", overflow: "auto", padding: "16px 18px 22px",
      background: "#f3f7fc", color: "#0f172a", fontSize: "13px"
    });
    body.appendChild(buildCreditDiagnosticPrettyView(summary, ttcards));

    box.append(header, body);
    overlay.appendChild(box);
    overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
    document.addEventListener("keydown", function onKey(e) {
      if (e.key === "Escape" && overlay.isConnected) { overlay.remove(); document.removeEventListener("keydown", onKey); }
    });
    document.body.appendChild(overlay);
  }

  function buildCreditDiagnosticPrettyView(summary = {}, ttcards = []) {
    const wrap = document.createElement("div");
    Object.assign(wrap.style, { display: "flex", flexDirection: "column", gap: "14px" });

    const groups = appState.timetable?.ttcardGroups || [];
    const rows = summary.classes || [];
    const gradeSummaries = summary.gradeSummaries || [];
    const unbalanced = gradeSummaries.filter(gs => !gs.isBalanced);
    const capacityRows = buildGradeCapacityRows(summary, ttcards || []);
    const capacityPerClass = getWeeklySlotCapacityPerClass();
    const periodCount = getConfiguredPeriodCount();

    const overview = document.createElement("div");
    Object.assign(overview.style, {
      display: "grid", gridTemplateColumns: "repeat(4, minmax(120px, 1fr))", gap: "10px"
    });
    overview.append(
      buildDiagStatCard("시간표 카드", `${(ttcards || []).length}개`),
      buildDiagStatCard("동시배정/그룹", `${groups.length}개`),
      buildDiagStatCard("진단 학급", `${rows.length}개`),
      buildDiagStatCard("총 필요 시수", `${formatCreditValue(summary.total || 0)}시수`)
    );
    wrap.appendChild(overview);

    const capacitySection = buildDiagSection("1. 시간표 전체 용량 비교", `현재 설정은 월~금 ${periodCount}교시입니다. 학급당 가능한 시간표 칸은 ${capacityPerClass}칸이며, 학년별 필요 시수·카드 수와 비교합니다.`);
    const capacityTable = buildDiagTable(["학년", "반 수", "카드/그룹", "필요 시수", "학급당 용량", "판정"]);
    if (!capacityRows.length) {
      appendDiagEmptyRow(capacityTable, 6, "비교할 학년 데이터가 없습니다.");
    } else {
      capacityRows.forEach(row => {
        const diffText = row.perClassDiff >= 0
          ? `여유 ${formatCreditValue(row.perClassDiff)}칸`
          : `초과 ${formatCreditValue(Math.abs(row.perClassDiff))}칸`;
        const statusText = row.perClassDiff >= 0 ? diffText : diffText;
        const tr = document.createElement("tr");
        tr.append(
          buildDiagTd(row.gradeLabel, { strong: true }),
          buildDiagTd(`${row.classCount}개 반`),
          buildDiagTd(`카드 ${row.cardCount}개 · 그룹 ${row.groupCount}개`),
          buildDiagTd(`${formatCreditValue(row.requiredMin)}~${formatCreditValue(row.requiredMax)}시수 / 학년합계 ${formatCreditValue(row.requiredTotal)}시수`),
          buildDiagTd(`${capacityPerClass}칸/반 · ${row.gradeCapacity}칸/학년`),
          buildDiagTd(statusText, { badge: row.perClassDiff >= 0 ? "ok" : "warn" })
        );
        capacityTable.querySelector("tbody").appendChild(tr);
      });
    }
    capacitySection.appendChild(capacityTable);
    wrap.appendChild(capacitySection);

    const gradeSection = buildDiagSection("2. 학년별 균형 요약", "학년 안에서 학급별 필요 시수가 같은지 먼저 확인합니다.");
    const gradeTable = buildDiagTable(["학년", "상태", "범위", "학급별 시수"]);
    if (!gradeSummaries.length) {
      appendDiagEmptyRow(gradeTable, 4, "진단할 학급별 시수 데이터가 없습니다.");
    } else {
      gradeSummaries.forEach(gs => {
        const tr = document.createElement("tr");
        const diff = (Number(gs.max) || 0) - (Number(gs.min) || 0);
        tr.append(
          buildDiagTd(`${gs.grade}학년`, { strong: true }),
          buildDiagTd(gs.isBalanced ? "완료" : `차이 ${formatCreditValue(diff)}시수`, { badge: gs.isBalanced ? "ok" : "warn" }),
          buildDiagTd(`${formatCreditValue(gs.min)} ~ ${formatCreditValue(gs.max)}시수`),
          buildDiagTd((gs.rows || []).map(row => `${row.label} ${formatCreditValue(row.credits)}`).join(" · ") || "-")
        );
        gradeTable.querySelector("tbody").appendChild(tr);
      });
    }
    gradeSection.appendChild(gradeTable);
    wrap.appendChild(gradeSection);

    const causeSection = buildDiagSection("3. 차이 원인 후보", "시수가 부족한 학급만 모아서 어떤 카드가 계산에 들어갔는지 보여줍니다.");
    if (!unbalanced.length) {
      causeSection.appendChild(buildDiagNotice("학급별 필요 시수가 모두 균형 상태입니다.", "ok"));
    } else {
      unbalanced.forEach(gs => {
        const gradeBox = document.createElement("div");
        Object.assign(gradeBox.style, {
          border: "1px solid #dbe5f2", borderRadius: "12px", background: "#fff", overflow: "hidden", marginTop: "10px"
        });
        const head = document.createElement("div");
        head.textContent = `${gs.grade}학년`;
        Object.assign(head.style, { padding: "9px 12px", fontWeight: "800", background: "#eef5ff", borderBottom: "1px solid #dbe5f2" });
        gradeBox.appendChild(head);

        const list = document.createElement("div");
        Object.assign(list.style, { display: "flex", flexDirection: "column", gap: "8px", padding: "10px" });
        const max = Number(gs.max) || 0;
        (gs.rows || []).forEach(row => {
          const lack = max - (Number(row.credits) || 0);
          if (lack <= 0) return;
          const item = document.createElement("details");
          item.open = true;
          Object.assign(item.style, { border: "1px solid #e2e8f0", borderRadius: "10px", background: "#fafcff" });
          const summaryEl = document.createElement("summary");
          summaryEl.textContent = `${row.label}: ${formatCreditValue(row.credits)}시수 · ${formatCreditValue(lack)}시수 부족`;
          Object.assign(summaryEl.style, { cursor: "pointer", padding: "8px 10px", fontWeight: "700", color: "#9a3412" });
          item.appendChild(summaryEl);
          item.appendChild(buildContributionTable(row.contributions || []));
          list.appendChild(item);
        });
        gradeBox.appendChild(list);
        causeSection.appendChild(gradeBox);
      });
    }
    wrap.appendChild(causeSection);

    const classSection = buildDiagSection("4. 학급별 상세 내역", "각 학급의 총 시수에 어떤 개별 카드와 그룹 카드가 더해졌는지 확인합니다.");
    if (!rows.length) {
      classSection.appendChild(buildDiagNotice("내역 없음", "muted"));
    } else {
      rows.forEach(row => {
        const details = document.createElement("details");
        details.open = false;
        Object.assign(details.style, { marginTop: "8px", border: "1px solid #dbe5f2", borderRadius: "10px", background: "#fff", overflow: "hidden" });
        const summaryEl = document.createElement("summary");
        summaryEl.textContent = `${row.label} · 총 ${formatCreditValue(row.credits)}시수 · ${row.contributions?.length || 0}개 항목`;
        Object.assign(summaryEl.style, { cursor: "pointer", padding: "9px 11px", fontWeight: "800" });
        details.appendChild(summaryEl);
        details.appendChild(buildContributionTable(row.contributions || []));
        classSection.appendChild(details);
      });
    }
    wrap.appendChild(classSection);

    const groupSection = buildDiagSection("5. 그룹별 계산 참고", "동시배정 그룹 안에 들어간 카드와 대상 학급입니다.");
    if (!groups.length) {
      groupSection.appendChild(buildDiagNotice("그룹 없음", "muted"));
    } else {
      groups.forEach(group => {
        const cards = getGroupCards(group) || [];
        const details = document.createElement("details");
        details.open = false;
        Object.assign(details.style, { marginTop: "8px", border: "1px solid #dbe5f2", borderRadius: "10px", background: "#fff", overflow: "hidden" });
        const summaryEl = document.createElement("summary");
        summaryEl.textContent = `${group.name || group.title || group.id || "그룹"} · ${cards.length}개 카드`;
        Object.assign(summaryEl.style, { cursor: "pointer", padding: "9px 11px", fontWeight: "800" });
        details.appendChild(summaryEl);
        const table = buildDiagTable(["과목", "시수", "교사", "대상 학급"]);
        cards.forEach(card => {
          const tr = document.createElement("tr");
          tr.append(
            buildDiagTd(getCardDiagnosticTitle(card), { strong: true }),
            buildDiagTd(`${formatCreditValue(getCreditsForTtCard(card))}`),
            buildDiagTd((getTeachersForTtCard(card) || []).join(", ") || card.teacherName || "교사 없음"),
            buildDiagTd(getClassLabelsForTtCard(card).join(", ") || "학급 없음")
          );
          table.querySelector("tbody").appendChild(tr);
        });
        details.appendChild(table);
        groupSection.appendChild(details);
      });
    }
    wrap.appendChild(groupSection);

    return wrap;
  }

  function getConfiguredPeriodCount() {
    const count = Number(appState.timetable?.config?.periodCount || 0);
    return count > 0 ? count : 7;
  }

  function getConfiguredDayCount() {
    return 5;
  }

  function getWeeklySlotCapacityPerClass() {
    return getConfiguredDayCount() * getConfiguredPeriodCount();
  }

  function normalizeDiagnosticGradeLabel(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (/학년$/.test(raw)) return raw;
    return `${raw}학년`;
  }

  function diagnosticGradeNumber(value) {
    const m = String(value || "").match(/\d+/);
    return m ? Number(m[0]) : 999;
  }

  function getGradeClassCount(gradeLabel) {
    return (appState.classes?.classes || []).filter(cls => String(cls.grade || "").trim() === gradeLabel).length;
  }

  function cardHasDiagnosticGrade(card, gradeLabel) {
    if (!card || !gradeLabel) return false;
    if (String(card.gradeKey || "").trim() === gradeLabel) return true;
    const labels = getClassLabelsForTtCard(card) || [];
    return labels.some(label => String(label || "").trim().startsWith(gradeLabel.replace("학년", "")) || String(label || "").trim().startsWith(gradeLabel));
  }

  function groupHasDiagnosticGrade(group, gradeLabel) {
    return (getGroupCards(group) || []).some(card => cardHasDiagnosticGrade(card, gradeLabel));
  }

  function buildGradeCapacityRows(summary = {}, ttcards = []) {
    const gradeSummaries = summary.gradeSummaries || [];
    const groups = appState.timetable?.ttcardGroups || [];
    const capacityPerClass = getWeeklySlotCapacityPerClass();
    return gradeSummaries.map(gs => {
      const gradeLabel = normalizeDiagnosticGradeLabel(gs.grade);
      const rows = gs.rows || [];
      const classCount = getGradeClassCount(gradeLabel) || rows.length || 0;
      const requiredValues = rows.map(row => Number(row.credits) || 0);
      const requiredMin = requiredValues.length ? Math.min(...requiredValues) : 0;
      const requiredMax = requiredValues.length ? Math.max(...requiredValues) : 0;
      const requiredTotal = requiredValues.reduce((sum, value) => sum + value, 0);
      const cardCount = (ttcards || []).filter(card => cardHasDiagnosticGrade(card, gradeLabel)).length;
      const groupCount = groups.filter(group => groupHasDiagnosticGrade(group, gradeLabel)).length;
      const gradeCapacity = capacityPerClass * classCount;
      return {
        grade: gs.grade,
        gradeLabel,
        classCount,
        cardCount,
        groupCount,
        requiredMin,
        requiredMax,
        requiredTotal,
        capacityPerClass,
        gradeCapacity,
        perClassDiff: capacityPerClass - requiredMax,
      };
    }).sort((a, b) => diagnosticGradeNumber(a.gradeLabel) - diagnosticGradeNumber(b.gradeLabel));
  }

  function buildDiagStatCard(label, value) {
    const card = document.createElement("div");
    Object.assign(card.style, { background: "#fff", border: "1px solid #dbe5f2", borderRadius: "12px", padding: "11px 13px" });
    const l = document.createElement("div");
    l.textContent = label;
    Object.assign(l.style, { color: "#64748b", fontSize: "12px", marginBottom: "4px" });
    const v = document.createElement("div");
    v.textContent = value;
    Object.assign(v.style, { fontWeight: "900", fontSize: "18px", color: "#0f172a" });
    card.append(l, v);
    return card;
  }

  function buildDiagSection(title, description = "") {
    const section = document.createElement("section");
    Object.assign(section.style, { background: "#fff", border: "1px solid #dbe5f2", borderRadius: "14px", padding: "14px" });
    const h = document.createElement("div");
    h.textContent = title;
    Object.assign(h.style, { fontWeight: "900", fontSize: "15px", marginBottom: "3px" });
    section.appendChild(h);
    if (description) {
      const d = document.createElement("div");
      d.textContent = description;
      Object.assign(d.style, { color: "#64748b", fontSize: "12px", marginBottom: "10px" });
      section.appendChild(d);
    }
    return section;
  }

  function buildDiagTable(headers) {
    const table = document.createElement("table");
    Object.assign(table.style, { width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: "12px" });
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    headers.forEach(h => {
      const th = document.createElement("th");
      th.textContent = h;
      Object.assign(th.style, {
        textAlign: "left", padding: "8px 9px", background: "#eaf2ff",
        borderBottom: "1px solid #cbd8ea", color: "#1e3a5f", fontWeight: "800"
      });
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    const tbody = document.createElement("tbody");
    table.append(thead, tbody);
    return table;
  }

  function buildDiagTd(text, opts = {}) {
    const td = document.createElement("td");
    td.textContent = text == null || text === "" ? "-" : String(text);
    Object.assign(td.style, { padding: "7px 9px", borderBottom: "1px solid #eef2f7", verticalAlign: "top", wordBreak: "keep-all" });
    if (opts.strong) td.style.fontWeight = "800";
    if (opts.badge) {
      const value = td.textContent;
      td.textContent = "";
      const badge = document.createElement("span");
      badge.textContent = value;
      Object.assign(badge.style, {
        display: "inline-flex", alignItems: "center", borderRadius: "999px", padding: "3px 8px",
        fontWeight: "800", fontSize: "11px",
        background: opts.badge === "ok" ? "#dcfce7" : "#ffedd5",
        color: opts.badge === "ok" ? "#166534" : "#9a3412"
      });
      td.appendChild(badge);
    }
    return td;
  }

  function appendDiagEmptyRow(table, colspan, text) {
    const tr = document.createElement("tr");
    const td = buildDiagTd(text || "내역 없음");
    td.colSpan = colspan;
    td.style.textAlign = "center";
    td.style.color = "#64748b";
    tr.appendChild(td);
    table.querySelector("tbody").appendChild(tr);
  }

  function buildContributionTable(contributions) {
    const table = buildDiagTable(["구분", "과목/그룹", "시수"]);
    if (!contributions.length) {
      appendDiagEmptyRow(table, 3, "세부 내역 없음");
      return table;
    }
    contributions.forEach(c => {
      const tr = document.createElement("tr");
      tr.append(
        buildDiagTd(c.kind === "group" ? `그룹 · ${c.groupName || "그룹"}` : "개별"),
        buildDiagTd(c.title || c.cardId || "시간표 카드", { strong: true }),
        buildDiagTd(`${formatCreditValue(c.credits)}시수`)
      );
      table.querySelector("tbody").appendChild(tr);
    });
    return table;
  }

  function buildDiagNotice(text, type = "muted") {
    const div = document.createElement("div");
    div.textContent = text;
    Object.assign(div.style, {
      borderRadius: "10px", padding: "10px 12px", fontSize: "13px",
      background: type === "ok" ? "#ecfdf5" : "#f8fafc",
      color: type === "ok" ? "#166534" : "#64748b",
      border: type === "ok" ? "1px solid #bbf7d0" : "1px solid #e2e8f0"
    });
    return div;
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
