import { buildReadOnlyCurriculumRows } from "./curriculum-read-view.js?v=r451-matrix";
import { facultyCourseWorkload } from "./faculty-workload.js?v=r434";

const format = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });
const hoursLabel = value => Number.isFinite(value) ? format.format(value) : "—";
const teacherKey = ({ id, name }) => id ? "id:" + id : "name:" + name.normalize("NFKC").trim().toLowerCase();

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
    courses.push({ row, subject, cells });
  }
  return { courses, teachers: [...teachers.values()].sort((a, b) => a.name.localeCompare(b.name, "ko")) };
}

function node(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}

export function renderAssignmentMatrix(data, teachers, { term, grade, query, edit }) {
  const needle = query.trim().toLocaleLowerCase();
  const rows = buildReadOnlyCurriculumRows(data.curriculum, data.templates.templates, teachers.teachers, (id, credits) => {
    const roster = data.rosters.rosters?.[id];
    return {
      ...facultyCourseWorkload(data.rosters.rosterMeta?.[id], credits),
      students: Array.isArray(roster) ? new Set(roster.map(item => item.classId + ":" + item.studentId)).size : null
    };
  }).filter(row => (!grade || row.grade === grade) && (!needle ||
      [row.grade, row.group, row.track, row[term]?.name, row[term]?.english, ...(row[term]?.teachers.map(t => t.name) || [])]
      .join(" ").toLocaleLowerCase().includes(needle)));
  const matrix = summarizeMatrix(rows, term);
  const panel = node("div");
  const heading = node("p", undefined, "assignment-matrix-summary");
  heading.append(node("strong", matrix.courses.length + "개 수업"), node("span", matrix.teachers.length + "명 배정"),
    node("span", "교사 합계는 현재 표시 범위 기준 · — 미설정 · 합동 수업은 교사별 한 번 합산"));
  panel.append(heading);
  if (!matrix.courses.length) {
    panel.append(node("p", "표시할 수업이 없습니다."));
    return panel;
  }

  const wrap = node("div", undefined, "assignment-matrix-scroll");
  wrap.tabIndex = 0;
  wrap.setAttribute("aria-label", "과목별·교사별 수업배정표");
  const table = node("table", undefined, "assignment-matrix");
  const header = table.createTHead().insertRow();
  for (const label of ["학년", "과목", "수업 시수", "학급수", "과목 총시수", "학생수", "교사수"]) {
    const cell = node("th", label);
    cell.scope = "col";
    header.append(cell);
  }
  for (const teacher of matrix.teachers) {
    const cell = node("th", undefined, "assignment-teacher-head");
    cell.scope = "col";
    const total = teacher.count === teacher.missing ? "미설정" : format.format(teacher.hours) + " 시수";
    cell.append(node("span", teacher.name), node("strong", total),
      node("small", teacher.count + "개 수업" + (teacher.missing ? " · 미설정 " + teacher.missing : "")));
    header.append(cell);
  }

  const body = table.createTBody();
  for (const { row, subject, cells } of matrix.courses) {
    const tr = body.insertRow();
    const gradeCell = tr.insertCell();
    gradeCell.textContent = row.grade;
    const subjectCell = node("th");
    subjectCell.scope = "row";
    const button = node("button", subject.name || subject.english, "assignment-course-link");
    button.type = "button";
    button.addEventListener("click", () => edit(row.grade + ":" + row.id));
    subjectCell.append(button);
    if (subject.english && subject.english !== subject.name) subjectCell.append(node("small", subject.english));
    subjectCell.append(node("small", [row.group, row.track, subject.jointLesson?.name].filter(Boolean).join(" · ")));
    tr.append(subjectCell);
    for (const [index, value] of [row.credits, subject.classCount, subject.total, subject.students, cells.size].entries()) {
      const cell = tr.insertCell();
      cell.textContent = hoursLabel(value);
      if (index === 2) cell.className = "assignment-course-hours";
    }
    for (const { key } of matrix.teachers) {
      const cell = tr.insertCell();
      const value = cells.get(key);
      if (!value) continue;
      const known = Number.isFinite(value.hours);
      cell.className = value.shared || !known ? "assignment-hours-muted" : "assignment-hours-filled";
      cell.textContent = value.shared ? "합동" : known ? hoursLabel(value.hours) : "미설정";
    }
  }
  wrap.append(table);
  panel.append(wrap);
  return panel;
}
