// ================================================================
// app-templates-ui.js · Template sidebar/form/manager UI wiring
// ================================================================
import { canEdit } from "./auth.js?v=1.0.0-20260724.1";
import { appState, scheduleSave, normalizeTemplate, synchronizeTeacherIdentityState } from "./state.js?v=1.0.0-20260724.1";
import {
  renderTemplates, renderTemplateManagerTable, handleTableInput, handleTableChange, handleTableDeleteClick,
  addTemplateManagerRow, getOrCreateDraft, resetDraft, commitDraft,
  deleteTemplate, addLiveTemplateGroup,
  templateEditId, templateFormSchoolLevel,
  setTemplateEditId, setTemplateFormSchoolLevel,
  getTemplateById, getSemesterTemplateData,
  managerUi,
  setSidebarLevel,
  copyTemplate, setOnTemplateChange, updateTeacherDatalist, syncSchoolLevels,
  clearStableOrder, parseTemplatePaste, addParsedTemplates
} from "./templates.js?v=1.0.0-20260724.1";
const $ = id => document.getElementById(id);

export function setupAppTemplatesUi({
  ensureDomains,
  invalidateTabs,
  renderApp,
  renderBoardTab,
  renderResultsPanel,
  renderTeacherPanel,
  renderGroupManagerView,
  getActiveView,
  navigateToBoard,
  curriculumApi,
} = {}) {
  const {
    renderOptionChips = () => {},
    addOption = () => {},
    setOnCurriculumChange = () => {},
    openTemplateCardPopup = () => {},
  } = curriculumApi || {};
  // ── DOM: Topbar / board helpers ────────────────────────────────
  const resetBoardBtn = $("resetBoardBtn");

  // ── DOM: Sidebar ───────────────────────────────────────────────
  const templateListEl        = $("templateList");
  const sidebarTemplateAddBtn = $("sidebarTemplateAddBtn");
  const sidebarLevelFilter    = $("sidebarSchoolLevelFilter");
  const categoryOptionList    = $("categoryOptionList");
  const trackOptionList       = $("trackOptionList");
  const groupOptionList       = $("groupOptionList");
  const categoryOptionInput   = $("categoryOptionInput");
  const trackOptionInput      = $("trackOptionInput");
  const groupOptionInput      = $("groupOptionInput");
  const addCategoryOptionBtn  = $("addCategoryOptionBtn");
  const addTrackOptionBtn     = $("addTrackOptionBtn");
  const addGroupOptionBtn     = $("addGroupOptionBtn");

  // ── DOM: Template Form ─────────────────────────────────────────
  const templateNameKo    = $("templateNameKo");
  const templateNameEn    = $("templateNameEn");
  const templateTeacher   = $("templateTeacher");
  const templateLanguage  = $("templateLanguage");
  const templateSubmitBtn = $("templateSubmitBtn");
  const templateCancelBtn = $("templateCancelBtn");
  const templateSepCheck  = $("templateSeparateSemesters");
  const semesterFields    = $("semesterTemplateFields");
  const sem1NameKo  = $("templateSem1NameKo");
  const sem1NameEn  = $("templateSem1NameEn");
  const sem1Teacher = $("templateSem1Teacher");
  const sem2NameKo  = $("templateSem2NameKo");
  const sem2NameEn  = $("templateSem2NameEn");
  const sem2Teacher = $("templateSem2Teacher");
  const levelPicker = $("templateSchoolLevelPicker");

  // ── DOM: Template Manager ──────────────────────────────────────
  const tplMgrView      = $("templateManagerView");
  const tplMgrBackBtn   = $("templateManagerBackBtn");
  const tplMgrAddBtn    = $("templateManagerAddRowBtn");
  const tplMgrSaveBtn   = $("templateManagerSaveBtn");
  const tplMgrDiscBtn   = $("templateManagerDiscardBtn");
  const tplMgrTableWrap = $("templateManagerTableWrap");
  const tplMgrCount     = $("templateManagerCount");
  const tplMgrSearch    = $("templateManagerSearchInput");
  const tplMgrLang      = $("templateManagerLanguageFilter");
  const tplMgrSplit     = $("templateManagerSplitFilter");
  const tplMgrSort      = $("templateManagerSortSelect");
  const tplMgrLevel     = $("templateManagerLevelFilter");
  const tplMgrSortBtn   = $("templateManagerSortBtn");
  const groupMgrAddBtn  = $("groupManagerAddGroupBtn");

  const tplPasteArea     = $("tplPasteArea");
  const tplPasteBtn      = $("tplPasteBtn");
  const tplPasteClearBtn = $("tplPasteClearBtn");

  function activeView() {
    return typeof getActiveView === "function" ? getActiveView() : "board";
  }

  function render() {
    if (typeof renderApp === "function") renderApp();
  }

  function renderBoard() {
    if (typeof renderBoardTab === "function") renderBoardTab();
  }

  function renderSidebar() {
    if (!templateListEl) return;
    [templateTeacher, sem1Teacher, sem2Teacher].forEach(el => {
      if (el) el.setAttribute("list", "tpl-teacher-list");
    });
    updateTeacherDatalist();
    renderTemplates(templateListEl, {
      onEdit: id => openTemplateCardPopup(id),
      onDelete: async id => {
        if (typeof ensureDomains === "function") await ensureDomains(["rosters", "timetable"]);
        deleteTemplate(id);
        invalidateTabs?.();
        renderSidebar();
        renderBoard();
      },
      onCopy: id => {
        copyTemplate(id);
        invalidateTabs?.();
        renderSidebar();
        renderBoard();
      },
    });
    renderOptionChips(categoryOptionList, "category");
    renderOptionChips(trackOptionList, "track");
    renderOptionChips(groupOptionList, "group");
  }

  function renderTemplateManagerView() {
    renderTemplateManagerLevelTabs();
    renderTemplateManagerTable(tplMgrTableWrap, tplMgrCount);
  }

  function renderTemplateManagerLevelTabs() {
    if (!tplMgrView) return;
    let tabs = $("templateManagerLevelTabs");
    if (!tabs) {
      tabs = document.createElement("div");
      tabs.id = "templateManagerLevelTabs";
      tabs.className = "tpl-manager-level-tabs";
    }

    const header  = tplMgrView.querySelector(".manager-header");
    const actions = tplMgrView.querySelector(".manager-actions");
    const toolbar = tplMgrView.querySelector(".manager-toolbar");
    if (header) {
      if (tabs.parentElement !== header) header.insertBefore(tabs, actions || null);
    } else if (tabs.parentElement !== (toolbar?.parentNode || tplMgrView)) {
      (toolbar?.parentNode || tplMgrView).insertBefore(tabs, toolbar || tplMgrView.firstChild);
    }

    const items = [
      { value: "전체", title: "전체" },
      { value: "중등", title: "중등" },
      { value: "고등", title: "고등" },
    ];

    tabs.innerHTML = items.map(item => `
      <button type="button" class="tpl-manager-level-tab ${managerUi.level === item.value ? "active" : ""}" data-level="${item.value}">
        <strong>${item.title}</strong>
      </button>
    `).join("");

    tabs.querySelectorAll("button[data-level]").forEach(btn => {
      btn.addEventListener("click", () => {
        const level = btn.dataset.level || "전체";
        if (managerUi.level === level) return;
        managerUi.level = level;
        if (tplMgrLevel) tplMgrLevel.value = level;
        clearStableOrder();
        renderTemplateManagerView();
      });
    });

    if (tplMgrLevel && tplMgrLevel.value !== managerUi.level) {
      tplMgrLevel.value = managerUi.level;
    }
  }

  function setLevelPickerActive(level) {
    setTemplateFormSchoolLevel(level);
    levelPicker?.querySelectorAll(".level-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.level === level);
    });
  }

  function toggleSemesterMode() {
    semesterFields?.classList.toggle("hidden", !templateSepCheck?.checked);
  }

  function resetTemplateForm() {
    setTemplateEditId(null);
    [
      templateNameKo, templateNameEn, templateTeacher,
      sem1NameKo, sem1NameEn, sem1Teacher,
      sem2NameKo, sem2NameEn, sem2Teacher,
    ].forEach(el => { if (el) el.value = ""; });
    if (templateLanguage)  templateLanguage.value  = "Korean";
    if (templateSepCheck)  templateSepCheck.checked = false;
    if (templateSubmitBtn) templateSubmitBtn.textContent = "카드 추가";
    templateCancelBtn?.classList.add("hidden");
    setLevelPickerActive("공통");
    toggleSemesterMode();
  }

  function fillTemplateForm(id) {
    const item = getTemplateById(id);
    if (!item) return;
    setTemplateEditId(id);
    if (templateNameKo)  templateNameKo.value  = item.nameKo || getSemesterTemplateData(item, "sem1").nameKo;
    if (templateNameEn)  templateNameEn.value  = item.nameEn || getSemesterTemplateData(item, "sem1").nameEn;
    if (templateTeacher) templateTeacher.value = item.teacher || (item.sem1Teacher === item.sem2Teacher ? item.sem1Teacher : "");
    if (templateLanguage) templateLanguage.value = item.language;
    if (templateSepCheck) templateSepCheck.checked = item.useSemesterOverrides;
    if (sem1NameKo)  sem1NameKo.value  = getSemesterTemplateData(item, "sem1").nameKo;
    if (sem1NameEn)  sem1NameEn.value  = getSemesterTemplateData(item, "sem1").nameEn;
    if (sem1Teacher) sem1Teacher.value = getSemesterTemplateData(item, "sem1").teacher;
    if (sem2NameKo)  sem2NameKo.value  = getSemesterTemplateData(item, "sem2").nameKo;
    if (sem2NameEn)  sem2NameEn.value  = getSemesterTemplateData(item, "sem2").nameEn;
    if (sem2Teacher) sem2Teacher.value = getSemesterTemplateData(item, "sem2").teacher;
    if (templateSubmitBtn) templateSubmitBtn.textContent = "카드 수정 저장";
    templateCancelBtn?.classList.remove("hidden");
    setLevelPickerActive(item.schoolLevel || "공통");
    toggleSemesterMode();
  }

  function submitTemplateForm() {
    if (!canEdit()) return;
    const useSep = !!templateSepCheck?.checked;
    const editId = templateEditId;
    const newId = editId || `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const data = normalizeTemplate({
      id: newId,
      language: templateLanguage?.value || "Korean",
      useSemesterOverrides: useSep,
      nameKo: templateNameKo?.value || "",
      nameEn: templateNameEn?.value || "",
      teacher: templateTeacher?.value || "",
      sem1NameKo: sem1NameKo?.value || "",
      sem1NameEn: sem1NameEn?.value || "",
      sem1Teacher: sem1Teacher?.value || "",
      sem2NameKo: sem2NameKo?.value || "",
      sem2NameEn: sem2NameEn?.value || "",
      sem2Teacher: sem2Teacher?.value || "",
      schoolLevel: templateFormSchoolLevel,
    });

    if (!data.nameKo && !data.nameEn && !(useSep && (data.sem1NameKo || data.sem1NameEn))) {
      alert("한글 이름 또는 영어 이름을 입력해 주세요.");
      return;
    }

    const prev = getTemplateById(data.id);
    if (prev) {
      data.calcGroupId = prev.calcGroupId || null;
      data.isCompound = !!prev.isCompound;
      data.compoundParts = Array.isArray(prev.compoundParts) ? prev.compoundParts : [];
    }

    const tpls = appState.templates.templates;
    const idx = tpls.findIndex(t => t.id === data.id);
    if (idx >= 0) tpls[idx] = data;
    else tpls.push(data);

    synchronizeTeacherIdentityState({ persist:true, reason:"template-form-save" });
    resetDraft();
    resetTemplateForm();
    scheduleSave("templates");
    invalidateTabs?.();
    render();
  }

  function setDisabled(disabled) {
    [
      templateNameKo, templateNameEn, templateTeacher, templateLanguage,
      templateSubmitBtn, templateCancelBtn, templateSepCheck,
      sem1NameKo, sem1NameEn, sem1Teacher, sem2NameKo, sem2NameEn, sem2Teacher,
      categoryOptionInput, trackOptionInput, groupOptionInput,
      addCategoryOptionBtn, addTrackOptionBtn, addGroupOptionBtn,
      resetBoardBtn,
      groupMgrAddBtn,
      tplMgrBackBtn, tplMgrAddBtn, tplMgrSaveBtn, tplMgrDiscBtn,
      tplMgrSearch, tplMgrLang, tplMgrSplit, tplMgrSort, tplMgrSortBtn, tplMgrLevel,
    ].forEach(el => { if (el) el.disabled = disabled; });
  }

  function wireEvents() {
    tplMgrBackBtn?.addEventListener("click", () => navigateToBoard?.());
    groupMgrAddBtn?.addEventListener("click", () => {
      addLiveTemplateGroup();
      renderGroupManagerView?.();
    });

    sidebarLevelFilter?.addEventListener("change", e => {
      setSidebarLevel(e.target.value);
      renderSidebar();
    });
    sidebarTemplateAddBtn?.addEventListener("click", () => openTemplateCardPopup(null, { mode: "new" }));

    templateSubmitBtn?.addEventListener("click", submitTemplateForm);
    templateCancelBtn?.addEventListener("click", resetTemplateForm);
    templateSepCheck?.addEventListener("change", () => {
      if (templateSepCheck.checked && [sem1NameKo, sem1NameEn, sem1Teacher, sem2NameKo, sem2NameEn, sem2Teacher].every(el => !el?.value)) {
        const ko = templateNameKo?.value;
        const en = templateNameEn?.value;
        const teacher = templateTeacher?.value;
        [sem1NameKo, sem2NameKo].forEach(el => { if (el && !el.value) el.value = ko; });
        [sem1NameEn, sem2NameEn].forEach(el => { if (el && !el.value) el.value = en; });
        [sem1Teacher, sem2Teacher].forEach(el => { if (el && !el.value) el.value = teacher; });
      }
      toggleSemesterMode();
    });
    levelPicker?.addEventListener("click", e => {
      const btn = e.target.closest(".level-btn");
      if (btn) setLevelPickerActive(btn.dataset.level);
    });
    [templateNameKo, templateNameEn, templateTeacher, sem1NameKo, sem1NameEn, sem1Teacher, sem2NameKo, sem2NameEn, sem2Teacher]
      .forEach(el => el?.addEventListener("keydown", e => {
        if (e.key === "Enter") submitTemplateForm();
      }));

    addCategoryOptionBtn?.addEventListener("click", () => {
      addOption("category", categoryOptionInput?.value);
      if (categoryOptionInput) categoryOptionInput.value = "";
      invalidateTabs?.();
      render();
    });
    addTrackOptionBtn?.addEventListener("click", () => {
      addOption("track", trackOptionInput?.value);
      if (trackOptionInput) trackOptionInput.value = "";
      invalidateTabs?.();
      render();
    });
    addGroupOptionBtn?.addEventListener("click", () => {
      addOption("group", groupOptionInput?.value);
      if (groupOptionInput) groupOptionInput.value = "";
      invalidateTabs?.();
      render();
    });
    [[categoryOptionInput, addCategoryOptionBtn], [trackOptionInput, addTrackOptionBtn], [groupOptionInput, addGroupOptionBtn]]
      .forEach(([input, btn]) => input?.addEventListener("keydown", e => {
        if (e.key === "Enter") btn?.click();
      }));

    tplMgrAddBtn?.addEventListener("click", () => {
      addTemplateManagerRow();
      renderTemplateManagerView();
    });
    tplMgrDiscBtn?.addEventListener("click", () => {
      if (!canEdit()) return;
      renderTemplateManagerView();
      renderSidebar();
    });
    tplMgrSaveBtn?.addEventListener("click", async () => {
      await commitDraft();
      invalidateTabs?.();
      render();
    });
    tplMgrSearch?.addEventListener("input", e => {
      managerUi.search = e.target.value;
      clearStableOrder();
      renderTemplateManagerView();
    });
    tplMgrLang?.addEventListener("change", e => {
      managerUi.language = e.target.value;
      clearStableOrder();
      renderTemplateManagerView();
    });
    tplMgrSplit?.addEventListener("change", e => {
      managerUi.split = e.target.value;
      clearStableOrder();
      renderTemplateManagerView();
    });
    tplMgrSort?.addEventListener("change", e => {
      managerUi.sort = e.target.value;
    });
    tplMgrLevel?.addEventListener("change", e => {
      managerUi.level = e.target.value;
      clearStableOrder();
      renderTemplateManagerView();
    });
    tplMgrSortBtn?.addEventListener("click", () => {
      clearStableOrder();
      renderTemplateManagerView();
    });
    tplMgrTableWrap?.addEventListener("input", e => handleTableInput(e));
    tplMgrTableWrap?.addEventListener("change", e => handleTableChange(e, renderTemplateManagerView));
    tplMgrTableWrap?.addEventListener("click", async e => {
      if (e.target.closest("button[data-action='delete-template']")) {
        if (typeof ensureDomains === "function") await ensureDomains(["rosters", "timetable"]);
      }
      handleTableDeleteClick(e, renderTemplateManagerView);
    });

    tplPasteBtn?.addEventListener("click", () => {
      if (!canEdit()) return;
      const raw = tplPasteArea?.value.trim();
      if (!raw) {
        alert("붙여넣기 영역이 비어 있습니다.");
        return;
      }
      const parsed = parseTemplatePaste(raw);
      if (!parsed.length) {
        alert("파싱된 과목카드가 없습니다.\n첫 번째 열에 한글 이름이 있는지 확인하세요.");
        return;
      }
      const added = addParsedTemplates(parsed);
      if (tplPasteArea) tplPasteArea.value = "";
      $("tplMgrPasteDetails")?.removeAttribute("open");
      renderTemplateManagerView();
      renderSidebar();
      alert(`${added}개 과목카드가 추가되었습니다.`);
    });
    tplPasteClearBtn?.addEventListener("click", () => {
      if (tplPasteArea) tplPasteArea.value = "";
    });
  }

  function wireUpdateHooks() {
    document.addEventListener("his:template-updated", () => {
      updateTeacherDatalist();
      invalidateTabs?.();
      renderSidebar();
      if (activeView() === "board") renderBoard();
      if (activeView() === "manager") renderTemplateManagerView();
    });

    setOnTemplateChange(() => {
      updateTeacherDatalist();
      invalidateTabs?.();
      renderSidebar();
      if (activeView() === "board") renderBoard();
      if (activeView() === "manager") renderTemplateManagerView();
      if (activeView() === "teachers") void renderTeacherPanel?.();
    });

    setOnCurriculumChange(() => {
      invalidateTabs?.();
      renderSidebar();
      if (activeView() === "board") renderBoard();
      if (activeView() === "results") void renderResultsPanel?.();
    });
  }

  wireEvents();
  wireUpdateHooks();

  return {
    clearStableOrder,
    fillTemplateForm,
    renderSidebar,
    renderTemplateManagerView,
    resetTemplateForm,
    setDisabled,
    syncSchoolLevels,
    updateTeacherDatalist,
  };
}
