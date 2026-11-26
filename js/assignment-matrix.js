import { buildReadOnlyCurriculumRows } from "./curriculum-read-view.js?v=r451-inline";
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

export function renderAssignmentMatrix(data, teachers, { term, grade, query, field }) {
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
  for (const label of ["학년", "과목", "수업 시수", "학급수", "과목 총시수", "학생수", "담당교사", "교사수"]) {
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
    const rowKey = row.grade + ":" + row.id;
    subjectCell.append(field(rowKey, term + ".nameKo"), field(rowKey, term + ".nameEn"));
    const options = node("div", undefined, "assignment-course-options");
    for (const name of ["category", "track", "group", term + ".language"]) options.append(field(rowKey, name));
    subjectCell.append(options);
    if (subject.jointLesson?.name) subjectCell.append(node("small", subject.jointLesson.name));
    tr.append(subjectCell);
    tr.insertCell().append(field(rowKey, "credits"));
    tr.insertCell().append(field(rowKey, term + ".classCount"));
    const courseHours = tr.insertCell();
    courseHours.textContent = hoursLabel(subject.total);
    courseHours.className = "assignment-course-hours";
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
    }
  }
  wrap.append(table);
  panel.append(wrap);
  return panel;
}
