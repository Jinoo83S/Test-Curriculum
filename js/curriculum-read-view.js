import { buildTeacherIdentityIndex, normalizeTeacherAssignment, teacherNameById } from "./teacher-identity.js?v=2026-07-15-room-availability-separation-r355";
import { assignedTeachers } from "./teacher-year-directory.js?v=r432";
import { getEffectiveCredit } from "./utils.js?v=2026-07-15-room-availability-separation-r355";

const text = value => String(value ?? "").trim();
const key = value => text(value).normalize("NFKC").replace(/\s+/g, " ").toLowerCase();

export function buildReadOnlyCurriculumRows(curriculum, templates, teachers = [], workload) {
  const cards = new Map(templates.map(card => [card.id, card]));
  const index = buildTeacherIdentityIndex(teachers);
  const semester = (row, term) => {
    const id = row[term + "TemplateId"];
    const card = cards.get(id);
    if (!card) return null;
    const identity = normalizeTeacherAssignment(assignedTeachers(card, term), index);
    const teachers = identity.ids.map(id => ({ name: teacherNameById(index, id), id })).filter(entry => entry.name);
    const matched = new Set(teachers.map(entry => key(entry.name)));
    const credits = getEffectiveCredit(row);
    return {
      name: text(card[term + "NameKo"] || card.nameKo || card[term + "NameEn"] || card.nameEn),
      english: text(card[term + "NameEn"] || card.nameEn),
      teachers: [...teachers, ...identity.names.filter(name => !matched.has(key(name))).map(name => ({ name, id: "" }))],
      ...workload?.(id, credits, term),
    };
  };
  return Object.entries(curriculum?.gradeBoards || {}).sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10))
    .flatMap(([grade, rows]) => (Array.isArray(rows) ? rows : []).flatMap(row => {
      const sem1 = semester(row, "sem1"), sem2 = semester(row, "sem2");
      return sem1 || sem2 ? [{ grade, category: row.category, track: row.track, group: row.group,
        credits: getEffectiveCredit(row), sem1, sem2 }] : [];
    }));
}

export function groupTeacherAssignments(rows, term, currentTeacher) {
  const names = new Set([currentTeacher?.name, ...(Array.isArray(currentTeacher?.aliases) ? currentTeacher.aliases : [])]
    .map(key).filter(Boolean));
  const groups = new Map();
  for (const row of rows) {
    const subject = row[term];
    if (!subject) continue;
    const teachers = subject.teachers.length ? subject.teachers : [{ name: "", id: "" }];
    for (const teacher of teachers) {
      const groupKey = teacher.id || key(teacher.name);
      if (!groups.has(groupKey)) groups.set(groupKey, {
        name: teacher.name,
        own: !!(currentTeacher && (teacher.id ? teacher.id === currentTeacher.id : names.has(key(teacher.name)))),
        rows: [],
      });
      groups.get(groupKey).rows.push({ ...row, subject });
    }
  }
  return [...groups.values()].sort((a, b) =>
    Number(b.own) - Number(a.own) || Number(!a.name) - Number(!b.name) || a.name.localeCompare(b.name, "ko"));
}

const create = (tag, label = "") => {
  const node = document.createElement(tag);
  node.textContent = label;
  return node;
};
const small = label => create("small", label);
function makeTable(labels) {
  const table = create("table");
  table.className = "faculty-curriculum-table";
  const row = table.createTHead().insertRow();
  for (const label of labels) {
    const th = create("th", label);
    th.scope = "col";
    row.append(th);
  }
  const wrap = create("div");
  wrap.className = "faculty-table-wrap";
  wrap.append(table);
  return { table, wrap };
}

export function renderTeacherAssignmentTable(groups, { language = "ko", workload = false } = {}) {
  const en = language === "en";
  const { table, wrap } = makeTable(en
    ? ["Grade", "Category", "Course", "Hours / class", ...(workload ? ["Classes", "Total hours"] : [])]
    : ["학년", "범주", "과목명", "학급별 시수", ...(workload ? ["학급 수", "총 시수"] : [])]);
  const width = workload ? 6 : 4;
  for (const group of groups) {
    const body = table.createTBody();
    body.className = group.own ? "faculty-teacher-group own" : "faculty-teacher-group";
    const header = create("th");
    header.scope = "rowgroup";
    header.colSpan = width;
    header.append(create("strong", group.name || (en ? "Unassigned" : "미배정")));
    if (group.own) {
      const label = create("span", en ? "My courses" : "내 담당");
      label.className = "faculty-own-badge";
      header.append(label);
    }
    const summary = en ? `${group.rows.length} courses` : `${group.rows.length}과목`;
    const total = group.rows.reduce((sum, row) => sum + (row.subject.total || 0), 0);
    header.append(small(workload ? `${summary} · ${en ? "Total" : "합계"} ${total}${en ? " hours" : "시수"}` : summary));
    body.insertRow().append(header);
    for (const { grade, category, credits, subject } of group.rows) {
      const row = body.insertRow();
      row.insertCell().textContent = grade;
      row.insertCell().textContent = category;
      const course = row.insertCell();
      course.append(create("strong", subject.name));
      if (subject.english && subject.english !== subject.name) course.append(small(subject.english));
      row.insertCell().textContent = credits || "—";
      if (workload) {
        row.insertCell().textContent = subject.classCount || "—";
        row.insertCell().textContent = subject.total || "—";
      }
    }
  }
  return wrap;
}

export function renderAnnualCurriculumTable(rows, language = "ko") {
  const en = language === "en";
  const { table, wrap } = makeTable(en
    ? ["Grade", "Category", "Track", "Subject Area", "Semester 1", "Semester 2", "Hours / class"]
    : ["학년", "범주", "구분", "교과군", "1학기", "2학기", "학급별 시수"]);
  const body = table.createTBody();
  for (const item of rows) {
    const row = body.insertRow();
    for (const field of ["grade", "category", "track", "group"]) row.insertCell().textContent = item[field] || "—";
    for (const subject of [item.sem1, item.sem2]) {
      const cell = row.insertCell();
      cell.append(create("strong", subject?.name || "—"));
      if (subject?.english && subject.english !== subject.name) cell.append(small(subject.english));
      if (subject?.teachers.length) cell.append(small(subject.teachers.map(teacher => teacher.name).join(", ")));
    }
    row.insertCell().textContent = item.credits || "—";
  }
  return wrap;
}
