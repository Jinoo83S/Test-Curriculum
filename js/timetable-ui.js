// ================================================================
// timetable-ui.js · Shared timetable display metadata and helpers
// ================================================================

export const GRADE_COLORS = {
  "7학년":  { bg:"#dbeafe", text:"#1d4ed8", border:"#3b82f6" },
  "8학년":  { bg:"#dcfce7", text:"#166534", border:"#22c55e" },
  "9학년":  { bg:"#fef3c7", text:"#92400e", border:"#f59e0b" },
  "10학년": { bg:"#fce7f3", text:"#be185d", border:"#ec4899" },
  "11학년": { bg:"#ede9fe", text:"#6d28d9", border:"#8b5cf6" },
  "12학년": { bg:"#e0f2fe", text:"#0369a1", border:"#0ea5e9" }
};

export function getGradeColor(gradeKey) {
  return GRADE_COLORS[gradeKey] || { bg:"#f1f5f9", text:"#374151", border:"#94a3b8" };
}

export const CONFLICT_DISPLAY = {
  teacher:        { label:"교사", short:"교", color:"#dc2626" },
  room:           { label:"교실", short:"실", color:"#ea580c" },
  roomUnavailable:{ label:"교실불가", short:"불", color:"#b45309" },
  roomMissing:    { label:"교실미배정", short:"미", color:"#f97316" },
  student:        { label:"학급", short:"반", color:"#7c3aed" },
  syncRequired:   { label:"동시배정", short:"동", color:"#2563eb" },
  unavailable:    { label:"불가시간", short:"불", color:"#475569" },
  maxConsecutive: { label:"연속초과", short:"연", color:"#ca8a04" },
  maxPerDay:      { label:"일일초과", short:"일", color:"#ca8a04" },
};

export const CONFLICT_PRIORITY = ["teacher", "room", "roomUnavailable", "roomMissing", "student", "syncRequired", "unavailable", "maxConsecutive", "maxPerDay"];

export function getOrderedConflictTypes(conflicts) {
  return CONFLICT_PRIORITY.filter(type => conflicts.has(type));
}

export function applyConflictVisuals(card, conflictTypes, conflicts, getConflictLabel) {
  if (!conflictTypes.length) return;
  const primary = conflictTypes[0];
  card.style.setProperty("--tt-conflict-color", CONFLICT_DISPLAY[primary]?.color || "#dc2626");
  conflictTypes.forEach(type => card.classList.add(`tt-conflict-${type}`));
  card.dataset.conflictTypes = conflictTypes.join(",");
  card.title = typeof getConflictLabel === "function" ? getConflictLabel(conflicts) : "";

  // 카드 우측 상단: 충돌 유형별 짧은 배지
  const markers = document.createElement("div");
  markers.className = "tt-conflict-markers";
  conflictTypes.forEach(type => {
    const meta = CONFLICT_DISPLAY[type];
    if (!meta) return;
    const dot = document.createElement("span");
    dot.className = "tt-conflict-dot";
    dot.dataset.type = type;
    dot.textContent = meta.short;
    dot.title = meta.label;
    markers.appendChild(dot);
  });
  card.appendChild(markers);

  // 카드 하단: 여러 충돌이 있을 때 항목별 색을 한눈에 보이게 하는 스트라이프
  const stripes = document.createElement("div");
  stripes.className = "tt-conflict-stripes";
  conflictTypes.forEach(type => {
    const meta = CONFLICT_DISPLAY[type];
    if (!meta) return;
    const seg = document.createElement("span");
    seg.className = "tt-conflict-stripe";
    seg.dataset.type = type;
    seg.title = meta.label;
    stripes.appendChild(seg);
  });
  card.appendChild(stripes);
}
