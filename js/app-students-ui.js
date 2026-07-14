// ================================================================
// app-students-ui.js · Student Management UI Coordinator
// ================================================================
import { scheduleSave } from "./state.js?v=2026-07-14-school-year-workspaces-r345";

const $ = id => document.getElementById(id);

export function setupStudentManagementUi({ loadStudents, getActiveView } = {}) {
  let selectedClassId = null;

  const dom = {
    classListEl:       $("classList"),
    addClassBtn:       $("addClassBtn"),
    classNameInput:    $("classNameInput"),
    classGradeSelect:  $("classGradeSelect"),
    deleteClassBtn:    $("deleteClassBtn"),
    studentCountEl:    $("studentCount"),
    studentMainEmpty:  $("studentMainEmpty"),
    studentMainContent:$("studentMainContent"),
    excelPasteArea:    $("excelPasteArea"),
    parsePasteBtn:     $("parsePasteBtn"),
    clearPasteBtn:     $("clearPasteBtn"),
    studentTableBody:  $("studentTableBody"),
    studentTableEmpty: $("studentTableEmpty"),
    addStudentRowBtn:  $("addStudentRowBtn"),
    exportStudentBtn:  $("exportStudentXlsxBtn"),
  };

  const isStudentView = () => getActiveView?.() === "students";
  const ensureLoader = () => {
    if (typeof loadStudents !== "function") throw new Error("loadStudents loader is required.");
    return loadStudents();
  };

  function showEmptyState() {
    dom.studentMainEmpty?.classList.remove("hidden");
    dom.studentMainContent?.classList.add("hidden");
  }

  function showClassState(cls) {
    dom.studentMainEmpty?.classList.add("hidden");
    dom.studentMainContent?.classList.remove("hidden");
    if (dom.classNameInput) dom.classNameInput.value = cls?.name || "";
    if (dom.classGradeSelect) dom.classGradeSelect.value = cls?.grade || "7학년";
  }

  async function renderStudentView() {
    if (!isStudentView()) return;
    const { renderClassList, getClassById } = await ensureLoader();
    if (!isStudentView()) return;

    function handleClassSelect(classId) {
      selectedClassId = classId;
      const cls = getClassById(classId);
      if (cls) showClassState(cls);
      void renderStudentTableView();
      if (dom.classListEl) renderClassList(dom.classListEl, selectedClassId, handleClassSelect);
    }

    if (selectedClassId && !getClassById(selectedClassId)) {
      selectedClassId = null;
      showEmptyState();
    }
    if (dom.classListEl) renderClassList(dom.classListEl, selectedClassId, handleClassSelect);
    if (selectedClassId) {
      const cls = getClassById(selectedClassId);
      if (cls) showClassState(cls);
      void renderStudentTableView();
    }
  }

  async function renderStudentTableView() {
    if (!selectedClassId || !isStudentView()) return;
    const { renderStudentTable } = await ensureLoader();
    if (isStudentView()) {
      renderStudentTable(dom.studentTableBody, selectedClassId, dom.studentTableEmpty, dom.studentCountEl);
    }
  }

  function resetSelection() {
    selectedClassId = null;
    showEmptyState();
  }

  function setDisabled(disabled) {
    [
      dom.addClassBtn,
      dom.deleteClassBtn,
      dom.classNameInput,
      dom.classGradeSelect,
      dom.parsePasteBtn,
      dom.clearPasteBtn,
      dom.addStudentRowBtn,
      dom.exportStudentBtn,
    ].forEach(el => { if (el) el.disabled = disabled; });
  }

  function setupEventListeners() {
    dom.addClassBtn?.addEventListener("click", async () => {
      const { addNewClass } = await ensureLoader();
      const cls = addNewClass();
      if (!cls) return;
      selectedClassId = cls.id;
      showClassState(cls);
      await renderStudentView();
      await renderStudentTableView();
      setTimeout(() => {
        dom.classNameInput?.focus();
        dom.classNameInput?.select();
      }, 50);
    });

    dom.deleteClassBtn?.addEventListener("click", async () => {
      const { deleteClass } = await ensureLoader();
      if (deleteClass(selectedClassId)) {
        resetSelection();
        void renderStudentView();
      }
    });

    dom.classNameInput?.addEventListener("change", async e => {
      const { updateClass } = await ensureLoader();
      updateClass(selectedClassId, "name", e.target.value);
      void renderStudentView();
    });

    dom.classGradeSelect?.addEventListener("change", async e => {
      const { updateClass } = await ensureLoader();
      updateClass(selectedClassId, "grade", e.target.value);
      void renderStudentView();
    });

    dom.parsePasteBtn?.addEventListener("click", async () => {
      const raw = dom.excelPasteArea?.value.trim();
      if (!raw) {
        alert("붙여넣기 영역이 비어 있습니다.");
        return;
      }
      const { getClassById, parseExcelPaste } = await ensureLoader();
      const cls = getClassById(selectedClassId);
      if (!cls) {
        alert("반을 먼저 선택해 주세요.");
        return;
      }
      const parsed = parseExcelPaste(raw);
      if (!parsed.length) {
        alert("파싱된 학생이 없습니다.\n엑셀에서 이름이 포함된 셀을 복사해 붙여넣기 해주세요.");
        return;
      }
      parsed.forEach(s => cls.students.push(s));
      scheduleSave("classes");
      if (dom.excelPasteArea) dom.excelPasteArea.value = "";
      void renderStudentTableView();
      void renderStudentView();
      alert(`${parsed.length}명이 추가되었습니다.`);
    });

    dom.clearPasteBtn?.addEventListener("click", () => {
      if (dom.excelPasteArea) dom.excelPasteArea.value = "";
    });

    dom.addStudentRowBtn?.addEventListener("click", async () => {
      const { addStudentToClass } = await ensureLoader();
      const student = addStudentToClass(selectedClassId);
      if (!student) return;
      await renderStudentTableView();
      await renderStudentView();
      setTimeout(() => {
        const rows = dom.studentTableBody?.querySelectorAll("tr");
        const last = rows?.[rows.length - 1];
        last?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        last?.querySelector("input")?.focus();
      }, 50);
    });

    dom.exportStudentBtn?.addEventListener("click", async () => {
      const { exportStudentXlsx } = await ensureLoader();
      exportStudentXlsx(selectedClassId);
    });
  }

  setupEventListeners();

  return {
    renderStudentView,
    renderStudentTableView,
    resetSelection,
    setDisabled,
    getSelectedClassId: () => selectedClassId,
  };
}
