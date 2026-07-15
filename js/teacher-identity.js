// ================================================================
// teacher-identity.js · Canonical teacher ID links + legacy snapshots
// ================================================================
// Teacher IDs are the canonical relationship key. Human-readable names remain
// as snapshots for display, export, and backward compatibility with older data.

const cleanLocal = value => String(value ?? "").trim();
const nameKey = value => cleanLocal(value).replace(/\s+/g, " ").toLocaleLowerCase("ko");

export function splitTeacherIdentityNames(value) {
  const source = Array.isArray(value) ? value : [value];
  return source
    .flatMap(item => cleanLocal(item).split(/[,，·]+/))
    .map(cleanLocal)
    .filter(Boolean);
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const out = [];
  values.forEach(value => {
    const v = cleanLocal(value);
    if (!v) return;
    const key = v.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(v);
  });
  return out;
}

function sameArray(a = [], b = []) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function setValue(target, field, value) {
  const before = target?.[field];
  const equal = Array.isArray(value)
    ? Array.isArray(before) && sameArray(before, value)
    : before === value;
  if (equal) return false;
  target[field] = value;
  return true;
}

export function buildTeacherIdentityIndex(teachers = []) {
  const byId = new Map();
  const byName = new Map();
  const duplicateIds = [];
  const duplicateNames = [];

  (Array.isArray(teachers) ? teachers : []).forEach(teacher => {
    const id = cleanLocal(teacher?.id);
    const name = cleanLocal(teacher?.name);
    if (!id) return;
    if (byId.has(id)) duplicateIds.push(id);
    else byId.set(id, teacher);

    const aliases = uniqueStrings([name, ...(Array.isArray(teacher?.aliases) ? teacher.aliases : [])]);
    aliases.forEach(alias => {
      const key = nameKey(alias);
      if (!key) return;
      if (!byName.has(key)) byName.set(key, []);
      const list = byName.get(key);
      if (!list.includes(id)) list.push(id);
    });
  });

  byName.forEach((ids, key) => {
    if (ids.length > 1) duplicateNames.push({ key, ids: [...ids] });
  });

  return { byId, byName, duplicateIds, duplicateNames };
}

export function teacherNameById(index, teacherId) {
  return cleanLocal(index?.byId?.get(cleanLocal(teacherId))?.name);
}

export function resolveTeacherIdByName(index, teacherName) {
  const ids = index?.byName?.get(nameKey(teacherName)) || [];
  return ids.length === 1 ? ids[0] : "";
}

export function normalizeTeacherAssignment({ ids = [], names = [] } = {}, index, report = null, context = "") {
  const validIds = [];
  const missingIds = [];
  uniqueStrings(Array.isArray(ids) ? ids : [ids]).forEach(id => {
    if (index.byId.has(id)) validIds.push(id);
    else missingIds.push(id);
  });

  const unresolvedNames = [];
  const ambiguousNames = [];
  const currentNamesById = new Set(validIds.map(id => nameKey(teacherNameById(index, id))).filter(Boolean));

  uniqueStrings(splitTeacherIdentityNames(names)).forEach(name => {
    const key = nameKey(name);
    if (!key || currentNamesById.has(key)) return;
    const matches = index.byName.get(key) || [];
    if (matches.length === 1) {
      if (!validIds.includes(matches[0])) validIds.push(matches[0]);
      currentNamesById.add(nameKey(teacherNameById(index, matches[0])));
    } else {
      unresolvedNames.push(name);
      if (matches.length > 1) ambiguousNames.push(name);
    }
  });

  const canonicalNames = uniqueStrings([
    ...validIds.map(id => teacherNameById(index, id)).filter(Boolean),
    ...unresolvedNames,
  ]);

  if (report) {
    missingIds.forEach(id => report.missingIds.push({ context, teacherId: id }));
    unresolvedNames.forEach(name => report.unresolvedNames.push({ context, teacherName: name }));
    ambiguousNames.forEach(name => report.ambiguousNames.push({ context, teacherName: name }));
  }

  return { ids: validIds, names: canonicalNames, missingIds, unresolvedNames, ambiguousNames };
}

function synchronizeAssignment(target, { idField, idsField, nameField, namesField, single = false, context }, index, report) {
  if (!target || typeof target !== "object") return false;
  const rawIds = single
    ? [target[idField]].filter(Boolean)
    : (Array.isArray(target[idsField]) ? target[idsField] : []);
  const rawNames = single
    ? [target[nameField]].filter(Boolean)
    : [target[nameField], ...(Array.isArray(target[namesField]) ? target[namesField] : [])];
  const resolved = normalizeTeacherAssignment({ ids: rawIds, names: rawNames }, index, report, context);
  let changed = false;
  if (single) {
    changed = setValue(target, idField, resolved.ids[0] || "") || changed;
    changed = setValue(target, nameField, resolved.names[0] || "") || changed;
  } else {
    changed = setValue(target, idsField, resolved.ids) || changed;
    changed = setValue(target, namesField, resolved.names) || changed;
    changed = setValue(target, nameField, resolved.names.join(", ")) || changed;
  }
  return changed;
}

function synchronizeTemplate(template, index, report) {
  let changed = false;
  changed = synchronizeAssignment(template, {
    idsField: "teacherIds", namesField: "teacherNames", nameField: "teacher", context: `template:${template.id}:base`
  }, index, report) || changed;
  changed = synchronizeAssignment(template, {
    idsField: "sem1TeacherIds", namesField: "sem1TeacherNames", nameField: "sem1Teacher", context: `template:${template.id}:sem1`
  }, index, report) || changed;
  changed = synchronizeAssignment(template, {
    idsField: "sem2TeacherIds", namesField: "sem2TeacherNames", nameField: "sem2Teacher", context: `template:${template.id}:sem2`
  }, index, report) || changed;
  (Array.isArray(template.compoundParts) ? template.compoundParts : []).forEach(part => {
    changed = synchronizeAssignment(part, {
      idsField: "teacherIds", namesField: "teacherNames", nameField: "teacher", context: `template:${template.id}:part:${part.id}`
    }, index, report) || changed;
  });
  return changed;
}

function synchronizeTimetableEntry(entry, index, report, contextPrefix = "entry") {
  return synchronizeAssignment(entry, {
    idsField: "teacherIds", namesField: "teacherNames", nameField: "teacherName", context: `${contextPrefix}:${entry?.id || "unknown"}`
  }, index, report);
}

function synchronizeConstraintMaps(timetable, index, report) {
  if (!timetable || typeof timetable !== "object") return false;
  const legacy = timetable.teacherConstraints && typeof timetable.teacherConstraints === "object"
    ? timetable.teacherConstraints
    : {};
  const byId = timetable.teacherConstraintsById && typeof timetable.teacherConstraintsById === "object"
    ? { ...timetable.teacherConstraintsById }
    : {};
  const unresolvedLegacy = {};

  Object.entries(legacy).forEach(([rawName, constraint]) => {
    const name = cleanLocal(rawName);
    // Legacy timetable constraints also contain reserved room/class availability
    // keys. They are not teacher names and must remain untouched until the
    // dedicated constraint-map separation migration.
    if (name.startsWith("__room_unavailable__:") || name.startsWith("__class_unavailable__:")) {
      unresolvedLegacy[name] = constraint;
      return;
    }
    const id = resolveTeacherIdByName(index, name);
    if (id) {
      if (!byId[id]) byId[id] = constraint;
    } else {
      unresolvedLegacy[name] = constraint;
      const matches = index.byName.get(nameKey(name)) || [];
      const bucket = matches.length > 1 ? report.ambiguousNames : report.unresolvedNames;
      bucket.push({ context: "timetable:teacherConstraints", teacherName: name });
    }
  });

  const canonicalLegacy = { ...unresolvedLegacy };
  Object.entries(byId).forEach(([id, constraint]) => {
    const name = teacherNameById(index, id);
    if (name) canonicalLegacy[name] = constraint;
    else report.missingIds.push({ context: "timetable:teacherConstraintsById", teacherId: id });
  });

  let changed = false;
  const beforeById = JSON.stringify(timetable.teacherConstraintsById || {});
  const beforeLegacy = JSON.stringify(timetable.teacherConstraints || {});
  if (beforeById !== JSON.stringify(byId)) {
    timetable.teacherConstraintsById = byId;
    changed = true;
  }
  if (beforeLegacy !== JSON.stringify(canonicalLegacy)) {
    timetable.teacherConstraints = canonicalLegacy;
    changed = true;
  }
  return changed;
}

function synchronizeTeacherOptions(timetable, index, report) {
  const options = timetable?.ttcardTeacherOptions;
  if (!options || typeof options !== "object") return false;
  return synchronizeAssignment(options, {
    idField: "representativeTeacherId",
    nameField: "representativeTeacher",
    single: true,
    context: "timetable:ttcardTeacherOptions"
  }, index, report);
}

export function synchronizeTeacherIdentityReferences(state = {}) {
  const report = {
    changedDomains: [],
    changedCounts: { templates: 0, rooms: 0, timetableCards: 0, timetableEntries: 0, savedEntries: 0, constraints: 0, options: 0 },
    missingIds: [],
    unresolvedNames: [],
    ambiguousNames: [],
    duplicateTeacherIds: [],
    duplicateTeacherNames: [],
  };
  const teachers = Array.isArray(state?.teachers?.teachers) ? state.teachers.teachers : [];
  const index = buildTeacherIdentityIndex(teachers);
  report.duplicateTeacherIds = [...index.duplicateIds];
  report.duplicateTeacherNames = [...index.duplicateNames];
  const changedDomains = new Set();

  (Array.isArray(state?.templates?.templates) ? state.templates.templates : []).forEach(template => {
    if (synchronizeTemplate(template, index, report)) {
      changedDomains.add("templates");
      report.changedCounts.templates += 1;
    }
  });

  (Array.isArray(state?.rooms?.rooms) ? state.rooms.rooms : []).forEach(room => {
    if (synchronizeAssignment(room, {
      idField: "teacherId", nameField: "teacherName", single: true, context: `room:${room.id}`
    }, index, report)) {
      changedDomains.add("rooms");
      report.changedCounts.rooms += 1;
    }
  });

  const timetable = state?.timetable;
  if (timetable && typeof timetable === "object") {
    (Array.isArray(timetable.ttcards) ? timetable.ttcards : []).forEach(card => {
      if (synchronizeAssignment(card, {
        idsField: "teacherIds", namesField: "teachers", nameField: "teacherName", context: `ttcard:${card.id}`
      }, index, report)) {
        changedDomains.add("timetable");
        report.changedCounts.timetableCards += 1;
      }
    });
    (Array.isArray(timetable.entries) ? timetable.entries : []).forEach(entry => {
      if (synchronizeTimetableEntry(entry, index, report)) {
        changedDomains.add("timetable");
        report.changedCounts.timetableEntries += 1;
      }
    });
    (Array.isArray(timetable.savedSchedules) ? timetable.savedSchedules : []).forEach(schedule => {
      (Array.isArray(schedule?.entries) ? schedule.entries : []).forEach(entry => {
        if (synchronizeTimetableEntry(entry, index, report, `savedSchedule:${schedule.id}`)) {
          changedDomains.add("timetable");
          report.changedCounts.savedEntries += 1;
        }
      });
    });
    (Array.isArray(timetable.bestAutoAssignSnapshot?.entries) ? timetable.bestAutoAssignSnapshot.entries : []).forEach(entry => {
      if (synchronizeTimetableEntry(entry, index, report, "bestSnapshot")) {
        changedDomains.add("timetable");
        report.changedCounts.savedEntries += 1;
      }
    });
    if (synchronizeConstraintMaps(timetable, index, report)) {
      changedDomains.add("timetable");
      report.changedCounts.constraints += 1;
    }
    if (synchronizeTeacherOptions(timetable, index, report)) {
      changedDomains.add("timetable");
      report.changedCounts.options += 1;
    }
  }

  report.changedDomains = [...changedDomains];
  report.ok = report.duplicateTeacherIds.length === 0 && report.ambiguousNames.length === 0;
  return report;
}

export function countTeacherIdentityReferences(state = {}, teacherId = "", teacherName = "") {
  const id = cleanLocal(teacherId);
  const key = nameKey(teacherName);
  const hasId = item => Array.isArray(item?.teacherIds) && item.teacherIds.includes(id);
  const hasName = value => splitTeacherIdentityNames(value).some(name => nameKey(name) === key);
  const counts = { templates: 0, compoundParts: 0, rooms: 0, timetableCards: 0, timetableEntries: 0, savedEntries: 0, constraints: 0, options: 0 };

  (state?.templates?.templates || []).forEach(template => {
    if ([template.teacherIds, template.sem1TeacherIds, template.sem2TeacherIds].some(ids => Array.isArray(ids) && ids.includes(id))
      || [template.teacher, template.sem1Teacher, template.sem2Teacher].some(hasName)) counts.templates += 1;
    (template.compoundParts || []).forEach(part => {
      if (hasId(part) || hasName(part.teacher)) counts.compoundParts += 1;
    });
  });
  (state?.rooms?.rooms || []).forEach(room => {
    if (room.teacherId === id || hasName(room.teacherName)) counts.rooms += 1;
  });
  (state?.timetable?.ttcards || []).forEach(card => {
    if (hasId(card) || hasName([card.teacherName, ...(card.teachers || [])])) counts.timetableCards += 1;
  });
  const countEntry = entry => {
    if (hasId(entry) || hasName([entry.teacherName, ...(entry.teacherNames || [])])) return 1;
    return 0;
  };
  counts.timetableEntries = (state?.timetable?.entries || []).reduce((sum, entry) => sum + countEntry(entry), 0);
  counts.savedEntries = (state?.timetable?.savedSchedules || []).reduce((sum, schedule) => sum + (schedule.entries || []).reduce((s, entry) => s + countEntry(entry), 0), 0)
    + (state?.timetable?.bestAutoAssignSnapshot?.entries || []).reduce((sum, entry) => sum + countEntry(entry), 0);
  if (state?.timetable?.teacherConstraintsById?.[id] || state?.timetable?.teacherConstraints?.[teacherName]) counts.constraints = 1;
  const options = state?.timetable?.ttcardTeacherOptions || {};
  if (options.representativeTeacherId === id || nameKey(options.representativeTeacher) === key) counts.options = 1;
  counts.total = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
  return counts;
}
