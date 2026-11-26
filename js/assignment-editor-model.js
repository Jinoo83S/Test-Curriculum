import { getSemesterTemplateData } from "./templates.js?v=r425";
import { replaceImportedTeachers } from "./curriculum-paste.js?v=r450";
import { assignedTeachers } from "./teacher-year-directory.js?v=r433";
import { buildTeacherIdentityIndex, normalizeTeacherAssignment, synchronizeTeacherIdentityReferences } from "./teacher-identity.js?v=2026-07-15-room-availability-separation-r355";
import { buildReadOnlyCurriculumRows, groupTeacherAssignments, teacherSemesterTotal } from "./curriculum-read-view.js?v=r451-assignment";
import { facultyCourseWorkload } from "./faculty-workload.js?v=r434";
import { getEffectiveCredit } from "./utils.js?v=2026-07-15-room-availability-separation-r355";

export const terms = ["sem1", "sem2"];
export const rowFields = ["category", "track", "group", "credits"];
export const termFields = ["nameKo", "nameEn", "teacher", "language", "classCount", "teacherLoadHours"];
const languageValues = ["Korean", "English", "Both"];
const text = value => String(value ?? "").trim();
const rowLabels = { category: "범주", track: "구분", group: "교과군" };

function teacherText(card, term, index) {
  return normalizeTeacherAssignment(assignedTeachers(card, term), index).names.join(", ");
}

export function assignmentRows(data, teachers) {
  const cards = new Map(data.templates.templates.map(card => [card.id, card]));
  const identity = buildTeacherIdentityIndex(teachers.teachers);
  return Object.entries(data.curriculum.gradeBoards).flatMap(([grade, rows]) => rows.flatMap(row => {
    const entry = { grade, key: grade + ":" + row.id, row };
    for (const term of terms) {
      const card = cards.get(row[term + "TemplateId"]);
      if (!card) continue;
      const meta = data.rosters.rosterMeta?.[card.id];
      const roster = data.rosters.rosters?.[card.id];
      entry[term] = {
        id: card.id, ...getSemesterTemplateData(card, term), language: card.language || "Both",
        teacher: teacherText(card, term, identity), compound: !!card.isCompound,
        classCount: text(meta?.classCount), teacherLoadHours: text(meta?.teacherLoadHours),
        workload: facultyCourseWorkload(meta, getEffectiveCredit(row)),
        students: Array.isArray(roster) ? new Set(roster.map(item => item.classId + ":" + item.studentId)).size : null
      };
    }
    return entry.sem1 || entry.sem2 ? [entry] : [];
  }));
}

function assignOnce(patches, id, field, value) {
  if (!patches.has(id)) patches.set(id, new Map());
  const patch = patches.get(id);
  if (patch.has(field) && patch.get(field) !== value) {
    throw new Error("같은 과목카드에 서로 다른 값이 입력되었습니다. 연결된 행의 입력값을 확인해 주세요.");
  }
  patch.set(field, value);
}

function numeric(value, field) {
  const label = { credits: "학급별 시수", classCount: "학급수", teacherLoadHours: "교사시수" }[field];
  if (value && (!/^\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value)) ||
    (field === "classCount" && !Number.isSafeInteger(Number(value))))) {
    throw new Error(label + "에 올바른 숫자를 입력해 주세요.");
  }
}

export function planAssignments(before, teachers, drafts) {
  const after = structuredClone(before);
  const originals = assignmentRows(before, teachers);
  const targets = new Map(assignmentRows(after, teachers).map(entry => [entry.key, entry]));
  const cards = new Map(after.templates.templates.map(card => [card.id, card]));
  const identity = buildTeacherIdentityIndex(teachers.teachers);
  const cardPatches = new Map(), rosterPatches = new Map();

  for (const [key, changes] of drafts) {
    const entry = targets.get(key);
    if (!entry) throw new Error("수정할 행을 찾을 수 없습니다.");
    for (const [name, raw] of Object.entries(changes)) {
      const value = text(raw);
      if (rowFields.includes(name)) {
        if (name === "credits") numeric(value, name);
        else if (!value || !after.curriculum.options[name].includes(value)) throw new Error("기존 " + rowLabels[name] + " 목록의 값을 사용해 주세요.");
        entry.row[name] = value;
        continue;
      }
      const [term, field] = name.split(".");
      const subject = entry[term];
      if (!terms.includes(term) || !termFields.includes(field) || !subject) throw new Error("연결된 과목카드를 확인해 주세요.");
      if (field === "classCount" || field === "teacherLoadHours") {
        numeric(value, field);
        assignOnce(rosterPatches, subject.id, field, value);
      } else if (field === "language") {
        if (!languageValues.includes(value)) throw new Error("수업 언어는 Korean, English, Both 중 하나를 선택해 주세요.");
        assignOnce(cardPatches, subject.id, field, value);
      } else {
        if (field === "teacher" && subject.compound) throw new Error("복합 과목의 교사 배정은 과목카드에서 수정해 주세요.");
        if (field !== "teacher" && !value) throw new Error("과목명은 비울 수 없습니다. 과목카드에서 언어별 표기를 관리해 주세요.");
        assignOnce(cardPatches, subject.id, term + field[0].toUpperCase() + field.slice(1), value);
      }
    }
  }

  const teacherChanges = [];
  for (const [id, patch] of cardPatches) {
    const card = cards.get(id);
    const currentAssignments = terms.map(term => normalizeTeacherAssignment(assignedTeachers(card, term), identity));
    const nextTeachers = terms.map((term, index) => patch.get(term + "Teacher") ?? currentAssignments[index].names.join(", "));
    if (patch.has("sem1Teacher") || patch.has("sem2Teacher")) {
      // Semester two inherits semester one when it has no teacher override.
      if (nextTeachers[0] && !nextTeachers[1]) throw new Error("1학기 교사가 있는 카드의 2학기만 비울 수 없습니다. 과목카드 연결을 확인해 주세요.");
      for (const [index, term] of terms.entries()) {
        if (patch.has(term + "Teacher") && normalizeTeacherAssignment({ names: nextTeachers[index] }, identity).ambiguousNames.length) {
          throw new Error("동명이인 교사가 있습니다. 과목카드에서 교사를 직접 선택해 주세요.");
        }
      }
      replaceImportedTeachers(card, nextTeachers);
      for (const [index, term] of terms.entries()) {
        if (!patch.has(term + "Teacher") && currentAssignments[index].ids.length) {
          card[term + "TeacherIds"] = currentAssignments[index].ids;
          card[term + "TeacherNames"] = currentAssignments[index].names;
          card.useSemesterOverrides = true;
        }
      }
      teacherChanges.push(card);
    }
    for (const [field, value] of patch) {
      if (!field.endsWith("Teacher")) card[field] = value;
      if (/^sem[12]Name/.test(field)) card.useSemesterOverrides = true;
    }
  }
  if (teacherChanges.length) synchronizeTeacherIdentityReferences({
    teachers: structuredClone(teachers), templates: { templates: teacherChanges }
  });
  after.rosters.rosterMeta ||= {};
  for (const [id, patch] of rosterPatches) {
    after.rosters.rosterMeta[id] = { ...after.rosters.rosterMeta[id], ...Object.fromEntries(patch) };
  }

  const updated = new Map(assignmentRows(after, teachers).map(entry => [entry.key, entry]));
  const rows = originals.flatMap(original => {
    const next = updated.get(original.key);
    const fields = [];
    for (const field of rowFields) {
      if (text(original.row[field]) !== text(next.row[field])) fields.push(field);
    }
    for (const term of terms) {
      for (const field of termFields) {
        if (original[term]?.[field] !== next[term]?.[field]) fields.push(term + "." + field);
      }
    }
    return fields.length ? [{ original, next, fields }] : [];
  });
  const planningRows = Object.values(before.curriculum.threeYear?.gradeBoards || {}).flat()
    .filter(row => terms.some(term => cardPatches.has(row[term + "TemplateId"]))).length;
  return { after, rows, planningRows, includeRosters: rosterPatches.size > 0 };
}

export function teacherTotals(data, teachers) {
  const rows = buildReadOnlyCurriculumRows(data.curriculum, data.templates.templates, teachers.teachers,
    (id, credits) => facultyCourseWorkload(data.rosters.rosterMeta?.[id], credits));
  const totals = new Map();
  for (const term of terms) {
    for (const group of groupTeacherAssignments(rows, term)) {
      if (!group.name) continue;
      totals.set(term + ":" + group.key, { term, name: group.name, count: group.rows.length, hours: teacherSemesterTotal(group, term) });
    }
  }
  return totals;
}
