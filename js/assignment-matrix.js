import { buildReadOnlyCurriculumRows } from "./curriculum-read-view.js?v=r451-inline";
import { facultyCourseWorkload } from "./faculty-workload.js?v=r434";
import { isChanCheCategory } from "./utils.js?v=2026-07-15-room-availability-separation-r355";

const format = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });
const hoursLabel = value => Number.isFinite(value) ? format.format(value) : "—";
const teacherKey = ({ id, name }) => id ? "id:" + id : "name:" + name.normalize("NFKC").trim().toLowerCase();

const differs = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > 1e-8;

export function assignmentHourDifferences(row, subject) {
  const { credits, boardHours } = row;
  const { classCount, total } = subject;
  const creative = isChanCheCategory(row.category);
  const inputTotal = !creative && Number.isFinite(boardHours) && Number.isFinite(classCount) ? boardHours * classCount : null;
  const calculatedTotal = Number.isFinite(credits) && Number.isFinite(classCount) ? credits * classCount : null;
  const teacherHours = subject.jointLesson ? subject.jointLesson.hours : subject.teacherTotal;
  return {
    credits: !creative && differs(boardHours, credits)
      ? "입력 시수 " + hoursLabel(boardHours) + " · 계산에 적용된 시수 " + hoursLabel(credits) : "",
    course: differs(calculatedTotal, total)
      ? "계산 기준 총시수 " + hoursLabel(calculatedTotal) + " · 표시 총시수 " + hoursLabel(total)
      : differs(inputTotal, total) ? "입력 시수 × 학급수 " + hoursLabel(inputTotal) + " · 표시 총시수 " + hoursLabel(total) : "",
    teacher: creative
      ? (subject.jointLesson && subject.hasTeacherOverride && differs(subject.teacherTotal, teacherHours)
        ? "입력 교사시수 " + hoursLabel(subject.teacherTotal) + " · 합동수업 적용 시수 " + hoursLabel(teacherHours) : "")
      : differs(teacherHours, total)
        ? (subject.jointLesson ? "합동수업 교사시수 " : "교사시수 ") + hoursLabel(teacherHours) +
          " · 과목 총시수 " + hoursLabel(total) : ""
  };
}

export function summarizeMatrix(rows, term) {
  const teachers = new Map();
  const courses = [];
  for (const row of rows) {
    const subject = row[term];
    if (!subject) continue;
    const cells = new Map();
    for (const teacher of subject.teachers) {
      const key = teacherKey(teacher);
      if (cells.has(key)) continue;
      if (!teachers.has(key)) teachers.set(key, { key, name: teacher.name, hours: 0, count: 0, missing: 0, joint: new Set() });
      const summary = teachers.get(key);
      const lesson = subject.jointLesson;
      if (lesson && summary.joint.has(lesson.id)) {
        cells.set(key, { shared: true });
        continue;
      }
      if (lesson) summary.joint.add(lesson.id);
      const hours = lesson ? lesson.hours : subject.teacherTotal;
      summary.count++;
      if (Number.isFinite(hours)) summary.hours += hours;
      else summary.missing++;
      cells.set(key, { hours });
    }
    courses.push({ row, subject, cells, differences: assignmentHourDifferences(row, subject) });
  }
  return { courses, teachers: [...teachers.values()].sort((a, b) => a.name.localeCompare(b.name, "ko")) };
}

function node(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}

function flagDifference(cell, message) {
  if (!message) return;
  cell.classList.add("assignment-hours-difference");
  cell.title = message;
  const input = cell.querySelector("input");
  if (input) {
    input.title = message + " · " + input.title;
    input.setAttribute("aria-description", message);
  } else cell.setAttribute("aria-description", message);
}

function assignmentMatrixRows(data, teachers) {
  return buildReadOnlyCurriculumRows(data.curriculum, data.templates.templates, teachers.teachers, (id, credits) => {
    const roster = data.rosters.rosters?.[id];
    const meta = data.rosters.rosterMeta?.[id];
    const input = String(meta?.teacherLoadHours ?? "").trim();
    return {
      ...facultyCourseWorkload(meta, credits),
      hasTeacherOverride: /^\d+(?:\.\d+)?$/.test(input) && Number.isFinite(Number(input)),
      students: Array.isArray(roster) ? new Set(roster.map(item => item.classId + ":" + item.studentId)).size : null
    };
  });
}

export function assignmentHourIssues(data, teachers, { keys, term, grade } = {}) {
  const fields = { credits: "시수", course: "총시수", teacher: "교사시수" };
  return assignmentMatrixRows(data, teachers)
    .filter(row => (!keys || keys.has(row.grade + ":" + row.id)) && (!grade || row.grade === grade))
    .flatMap(row => (term ? [term] : ["sem1", "sem2"]).flatMap(semester => {
      const subject = row[semester];
      if (!subject) return [];
      return Object.entries(assignmentHourDifferences(row, subject))
        .filter(([, message]) => message)
        .map(([field, message]) => [row.grade, subject.name || subject.english, semester === "sem1" ? "1학기" : "2학기", fields[field], message]);
    }));
}

export function renderAssignmentMatrix(data, teachers, {
  term, grade, query, field, details = false, onCounts = () => {},
  columnWidths = new Map(), onResize = () => {}
}) {
  const needle = query.trim().toLocaleLowerCase();
  const rows = assignmentMatrixRows(data, teachers).filter(row => (!grade || row.grade === grade) && (!needle ||
      [row.grade, row.group, row.track, row[term]?.name, row[term]?.english, ...(row[term]?.teachers.map(t => t.name) || [])]
      .join(" ").toLocaleLowerCase().includes(needle)));
  const matrix = summarizeMatrix(rows, term);
  const panel = node("div");
  const warnings = matrix.courses.filter(course => Object.values(course.differences).some(Boolean)).length;
  onCounts(matrix.courses.length, matrix.teachers.length, warnings);
  if (!matrix.courses.length) {
    panel.append(node("p", "표시할 수업이 없습니다."));
    return panel;
  }

  const wrap = node("div", undefined, "assignment-matrix-scroll");
  wrap.tabIndex = 0;
  wrap.setAttribute("aria-label", "과목별·교사별 수업배정표");
  const detailColumns = details ? [
    ["범주", 46, "category"], ["구분", 50, "track"], ["교과군", 64, "group"],
    ["언어", 58, "language"], ["창체 시간", 54, "creative"]
  ] : [];
  const columns = [
    ["학년", 42, "grade"], ["국문 과목명", 155, "nameKo"], ["영문 과목명", 155, "nameEn"], ...detailColumns,
    ["시수", 44, "credits"], ["학급수", 40, "classCount"], ["총시수", 47, "total"], ["학생수", 42, "students"],
    ["담당교사", 94, "teacher"], ["교사수", 40, "teacherCount"],
    ...matrix.teachers.map(teacher => [teacher.name, 46, teacher.key, teacher])
  ];
  const table = node("table", undefined, "assignment-matrix");
  const colgroup = node("colgroup");
  const clampWidth = value => Math.max(32, Math.min(520, Math.round(value)));
  const widths = columns.map(([, width, id]) => {
    const saved = columnWidths.get(id);
    return Number.isFinite(saved) ? clampWidth(saved) : width;
  });
  const cols = widths.map(width => {
    const col = node("col");
    col.style.width = width + "px";
    colgroup.append(col);
    return col;
  });
  const updateTableWidth = () => {
    table.style.width = widths.reduce((sum, width) => sum + width, 0) + "px";
    table.style.setProperty("--assignment-grade-width", widths[0] + "px");
  };
  updateTableWidth();
  table.append(colgroup);
  const header = table.createTHead().insertRow();
  for (const [index, [label, , id, teacher]] of columns.entries()) {
    const cell = node("th", teacher ? undefined : label, teacher ? "assignment-teacher-head" : undefined);
    cell.scope = "col";
    if (teacher) {
      const total = teacher.count === teacher.missing ? "미설정" : format.format(teacher.hours) + " 시수";
      cell.title = teacher.name + " · " + total + " · " + teacher.count + "개 수업" +
        (teacher.missing ? " · 미설정 " + teacher.missing : "");
      const number = node("strong", (teacher.count === teacher.missing ? "—" : format.format(teacher.hours)) +
        " / " + teacher.count + (teacher.missing ? "*" : ""));
      if (teacher.hours - 20 > 1e-8) {
        number.classList.add("assignment-teacher-overload");
        cell.title += " · 20시수 초과";
      }
      cell.append(node("span", teacher.name), number);
    }

    const grip = node("span", undefined, "assignment-column-resizer");
    grip.tabIndex = 0;
    grip.setAttribute("role", "separator");
    grip.setAttribute("aria-orientation", "vertical");
    grip.setAttribute("aria-label", label + " 열 너비");
    grip.setAttribute("aria-valuemin", "32");
    grip.setAttribute("aria-valuemax", "520");
    grip.setAttribute("aria-valuenow", String(widths[index]));
    const resize = value => {
      widths[index] = clampWidth(value);
      cols[index].style.width = widths[index] + "px";
      grip.setAttribute("aria-valuenow", String(widths[index]));
      updateTableWidth();
    };
    let drag;
    grip.addEventListener("pointerdown", event => {
      if (event.button !== 0 || drag) return;
      event.preventDefault();
      drag = { pointer: event.pointerId, left: event.clientX, width: widths[index] };
      grip.setPointerCapture(event.pointerId);
    });
    grip.addEventListener("pointermove", event => {
      if (drag?.pointer === event.pointerId) resize(drag.width + event.clientX - drag.left);
    });
    grip.addEventListener("lostpointercapture", event => {
      if (drag?.pointer !== event.pointerId) return;
      if (widths[index] !== drag.width) onResize(id, widths[index]);
      drag = undefined;
    });
    grip.addEventListener("keydown", event => {
      const move = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      if (!move) return;
      event.preventDefault();
      resize(widths[index] + move * (event.shiftKey ? 16 : 4));
      onResize(id, widths[index]);
    });
    cell.append(grip);
    header.append(cell);
  }

  const body = table.createTBody();
  let previousGrade;
  for (const { row, subject, cells, differences } of matrix.courses) {
    const tr = body.insertRow();
    tr.dataset.grade = String(parseInt(row.grade, 10));
    if (row.grade !== previousGrade) tr.classList.add("assignment-grade-start");
    previousGrade = row.grade;
    const gradeCell = tr.insertCell();
    gradeCell.textContent = row.grade;
    const subjectCell = node("th");
    subjectCell.scope = "row";
    const rowKey = row.grade + ":" + row.id;
    const name = field(rowKey, term + ".nameKo");
    const note = [subject.english, row.category, row.track, row.group, subject.language, subject.jointLesson?.name]
      .filter(Boolean).join(" · ");
    if (note) name.title += " · " + note;
    subjectCell.append(name);
    if (subject.jointLesson?.name) {
      gradeCell.textContent = row.grade.replace("학년", "") + "·합";
      gradeCell.title = row.grade + " · 합동수업 · " + subject.jointLesson.name;
    }
    tr.append(subjectCell);
    const english = tr.insertCell();
    english.className = "assignment-english-name";
    english.append(field(rowKey, term + ".nameEn"));
    const creative = isChanCheCategory(row.category);
    for (const [, , id] of detailColumns) {
      const detail = tr.insertCell();
      if (id === "creative") {
        if (creative) {
          const time = field(rowKey, "credits");
          time.title = "창체 교육과정 시간 · 시간표 시수 " + hoursLabel(row.credits);
          time.setAttribute("aria-label", row.grade + " " + (subject.name || subject.english) + " 창체 교육과정 시간");
          detail.append(time);
        }
      } else detail.append(field(rowKey, id === "language" ? term + ".language" : id));
    }
    const creditsCell = tr.insertCell();
    if (creative) {
      creditsCell.textContent = hoursLabel(row.credits);
      creditsCell.title = "창체 시간표 시수 · 교육과정 시간은 과목 상세에서 확인";
    } else creditsCell.append(field(rowKey, "credits"));
    flagDifference(creditsCell, differences.credits);
    tr.insertCell().append(field(rowKey, term + ".classCount"));
    const courseHours = tr.insertCell();
    courseHours.textContent = hoursLabel(subject.total);
    courseHours.className = "assignment-course-hours";
    flagDifference(courseHours, differences.course);
    tr.insertCell().textContent = hoursLabel(subject.students);
    const assigned = tr.insertCell();
    assigned.className = "assignment-teacher-names";
    if (subject.compound) assigned.textContent = subject.teachers.map(teacher => teacher.name).join(", ") || "—";
    else assigned.append(field(rowKey, term + ".teacher"));
    tr.insertCell().textContent = hoursLabel(cells.size);
    for (const { key } of matrix.teachers) {
      const cell = tr.insertCell();
      const value = cells.get(key);
      if (!value) continue;
      const known = Number.isFinite(value.hours);
      cell.className = value.shared || !known ? "assignment-hours-muted" : "assignment-hours-filled";
      if (subject.jointLesson) cell.textContent = value.shared ? "합동" : hoursLabel(value.hours);
      else cell.append(field(rowKey, term + ".teacherLoadHours", known ? hoursLabel(value.hours) : "미설정"));
      flagDifference(cell, differences.teacher);
    }
  }
  wrap.append(table);
  panel.append(wrap);
  return panel;
}
