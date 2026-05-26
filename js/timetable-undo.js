// ================================================================
// timetable-undo.js · Timetable undo stack
// ================================================================

const UNDO_LIMIT = 50;

function cloneForUndo(v) {
  try { return structuredClone(v); }
  catch (_) { return JSON.parse(JSON.stringify(v ?? null)); }
}

function sameUndoSnapshot(a, b) {
  try { return JSON.stringify(a) === JSON.stringify(b); }
  catch (_) { return false; }
}

function shouldIgnoreUndoShortcut(target) {
  if (!target) return false;
  const tag = target.tagName;
  return target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function createTimetableUndoHandlers({
  canEdit,
  getSnapshot,
  restoreSnapshot,
  scheduleSave,
  recomputeConflicts,
  renderAll,
  addTimetableLog,
  getFeedbackElement,
}) {
  let undoStack = [];
  let undoCaptureLocked = false;
  let undoApplying = false;

  function captureTimetableUndo(label = "시간표 편집") {
    if (!canEdit() || undoApplying || undoCaptureLocked) return;
    const snapshot = cloneForUndo(getSnapshot());
    const last = undoStack[undoStack.length - 1];
    if (!last || !sameUndoSnapshot(last.data, snapshot)) {
      undoStack.push({ label, data: snapshot });
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    }
    undoCaptureLocked = true;
    queueMicrotask(() => { undoCaptureLocked = false; });
  }

  function undoLastTimetableEdit() {
    if (!canEdit()) return;
    const snapshot = undoStack.pop();
    if (!snapshot) {
      const bar = getFeedbackElement?.();
      if (bar) {
        const prev = bar.textContent;
        bar.textContent = "되돌릴 작업이 없습니다.";
        setTimeout(() => {
          if (bar.textContent === "되돌릴 작업이 없습니다.") bar.textContent = prev;
        }, 1200);
      }
      return;
    }

    undoApplying = true;
    restoreSnapshot(cloneForUndo(snapshot.data));
    undoApplying = false;
    scheduleSave("timetable");
    recomputeConflicts();
    renderAll();
    addTimetableLog?.("undo", "되돌리기", `${snapshot.label || "직전 작업"} 상태로 되돌렸습니다.`);
  }

  function installUndoShortcut() {
    document.addEventListener("keydown", e => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z" || e.shiftKey || e.altKey) return;
      if (shouldIgnoreUndoShortcut(e.target)) return;
      e.preventDefault();
      undoLastTimetableEdit();
    });
  }

  return { captureTimetableUndo, undoLastTimetableEdit, installUndoShortcut };
}
