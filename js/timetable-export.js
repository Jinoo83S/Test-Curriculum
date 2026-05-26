// ================================================================
// timetable-export.js · XLSX export for timetable page
// ================================================================

export function exportTimetableXlsx({
  workbookName = "HIS_Timetable.xlsx",
  GRADE_KEYS,
  entries,
  ttConfig,
  splitTeacherNames,
  entryHasGrade,
  entryTitle,
  entryGradeKeys,
  gradeDisplay,
  getRooms,
}) {
  if (!window.XLSX?.utils) {
    alert("엑셀 내보내기 라이브러리를 불러오지 못했습니다.");
    return;
  }

  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();
  const days = ["월","화","수","목","금"];
  const periods = ttConfig().periodLabels;

  GRADE_KEYS.forEach(grade => {
    const data = [["교시/요일", ...days]];
    periods.forEach((label, period) => {
      const row = [label];
      days.forEach((_, day) => {
        const cell = entries()
          .filter(e => entryHasGrade(e, grade) && e.day === day && e.period === period)
          .map(e => {
            const name = entryTitle(e);
            const room = getRooms().find(r => r.id === e.roomId);
            return [name, e.teacherName, room?.name].filter(Boolean).join("/");
          }).join("|");
        row.push(cell);
      });
      data.push(row);
    });
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 8 }, ...days.map(() => ({ wch: 20 }))];
    XLSX.utils.book_append_sheet(wb, ws, grade);
  });

  const teacherRows = [["교사", "요일", "교시", "과목", "학년", "교실"]];
  const allTeachers = [...new Set(entries().flatMap(e => splitTeacherNames(e.teacherName)).filter(Boolean))]
    .sort((a,b) => a.localeCompare(b,"ko"));
  const dayLabels = ["월","화","수","목","금"];
  allTeachers.forEach(teacher => {
    entries().filter(e => splitTeacherNames(e.teacherName).includes(teacher))
      .sort((a, b) => a.day !== b.day ? a.day - b.day : a.period - b.period)
      .forEach(e => {
        const room = getRooms().find(r => r.id === e.roomId);
        teacherRows.push([
          teacher,
          dayLabels[e.day],
          ttConfig().periodLabels[e.period] || `${e.period + 1}교시`,
          entryTitle(e),
          entryGradeKeys(e).map(gradeDisplay).join(", "),
          room?.name || ""
        ]);
      });
  });
  const wsT = XLSX.utils.aoa_to_sheet(teacherRows);
  wsT["!cols"] = [14,6,8,20,8,14].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, wsT, "교사별");

  XLSX.writeFile(wb, workbookName);
}
