import {
  buildPrintTemplateMap,
  resolveSemesterCardValues,
  resolveSemesterEntryValues,
} from "../../js/timetable-print-semester.js";

const DAYS = 5;
const clean = value => String(value ?? "").trim();
const unique = values => [...new Set((values || []).map(clean).filter(Boolean))];

function splitTeachers(value = "") {
  if (Array.isArray(value)) return unique(value);
  return unique(clean(value).split(/[,，、/]+/));
}

function gradeNo(value = "") {
  const match = clean(value).match(/\d{1,2}/);
  return match ? Number(match[0]) : 0;
}

function normalizeClassKey(value = "") {
  const raw = clean(value).replace(/학년/g, "").replace(/\s+/g, "");
  const match = raw.match(/^(\d{1,2})[:\-]?([A-Z가-힣])$/i);
  return match ? `${Number(match[1])}:${match[2].toUpperCase()}` : raw;
}

function classKey(cls = {}) {
  const grade = gradeNo(cls.gradeKey || cls.grade);
  const section = clean(cls.name || cls.section || cls.label).replace(/^\d+/, "");
  return grade && section ? `${grade}:${section.toUpperCase()}` : clean(cls.key || cls.id);
}

function normSpecial(value = "") {
  return clean(value).toLowerCase().replace(/[\s·⋅・_\-\/()\[\]]+/g, "");
}

function balancedPageCount(length, maxSize) {
  return Math.max(1, Math.ceil(Math.max(0, Number(length) || 0) / Math.max(1, Number(maxSize) || 1)));
}

function snapshotDomains(input = {}) {
  const source = input?.normalized || input?.data || input;
  return {
    classes: source?.classes?.classes || [],
    rooms: source?.rooms?.rooms || [],
    templates: source?.templates?.templates || [],
    rosters: source?.rosters?.rosters || source?.rosters || {},
    timetable: source?.timetable || {},
  };
}

export function buildOperationalPrintAudit(input = {}) {
  const domains = snapshotDomains(input);
  const classes = domains.classes.map(cls => ({ ...cls, key: classKey(cls), gradeNo: gradeNo(cls.gradeKey || cls.grade) }))
    .filter(cls => cls.gradeNo >= 7 && cls.gradeNo <= 12);
  const rooms = domains.rooms.filter(room => room?.id);
  const cards = domains.timetable.ttcards || [];
  const entries = domains.timetable.entries || [];
  const periodCount = Math.max(1, Number(domains.timetable?.config?.periodCount) || (domains.timetable?.config?.periodLabels || []).length || 7);
  const templateMap = buildPrintTemplateMap(domains.templates);
  const cardMap = new Map(cards.map(card => [card.id, card]));
  const roomMap = new Map(rooms.map(room => [room.id, room]));
  const classById = new Map(classes.map(cls => [cls.id, cls]));

  const entryCardIds = entry => unique([...(entry?.ttcardIds || []), entry?.ttcardId]);
  const cardClassKeys = card => unique([...(card?.classKeys || []), ...(card?.classLabels || []).map(normalizeClassKey)]).map(normalizeClassKey);
  const entryClassKeys = entry => unique([
    ...(entry?.audienceClassKeys || []).map(normalizeClassKey),
    ...entryCardIds(entry).flatMap(id => cardClassKeys(cardMap.get(id))),
  ]);
  const entryRoomIds = entry => unique([
    entry?.roomId,
    ...(entry?.roomIds || []),
    ...Object.values(entry?.roomAssignmentsByTtCardId || {}),
    ...entryCardIds(entry).map(id => cardMap.get(id)?.fixedRoomId),
  ]);
  const roomIdsForCard = (entry, card) => unique([
    entry?.roomAssignmentsByTtCardId?.[card?.id],
    card?.fixedRoomId,
    ...(entryCardIds(entry).length <= 1 ? entryRoomIds(entry) : []),
  ]);
  const cardResolved = (card, entry, semester) => resolveSemesterCardValues(card || {}, entry || {}, templateMap, semester);
  const cardTeachers = (card, entry, semester) => cardResolved(card, entry, semester).teachers;
  const entryTeachers = (entry, semester) => {
    const ids = entryCardIds(entry);
    if (ids.length) return unique(ids.flatMap(id => cardTeachers(cardMap.get(id), entry, semester)));
    return resolveSemesterEntryValues(entry || {}, templateMap, semester).teachers;
  };
  const cardTitle = (card, entry, semester) => clean(cardResolved(card, entry, semester).subject || card?.subject || card?.label || "수업");

  const rosterRowsForCard = card => {
    const keys = unique([card?.templateId, card?.compoundParentTemplateId, card?.parentTemplateId, card?.subjectTemplateId, card?.templateKey]);
    return keys.flatMap(key => {
      const value = domains.rosters?.[key];
      if (Array.isArray(value)) return value;
      if (Array.isArray(value?.rows)) return value.rows;
      if (Array.isArray(value?.students)) return value.students;
      return [];
    });
  };
  const isLikelyWholeClassCard = (card, cls) => {
    const keys = cardClassKeys(card);
    const subject = clean(card?.subject || card?.label);
    if (!keys.includes(cls?.key)) return false;
    if (subject.includes("[남]") || subject.includes("[여]")) return false;
    if (clean(card?.track) === "공통" && keys.length === 1) return true;
    return Boolean(card?.isWholeClass || card?.entireClass || card?.audienceMode === "whole");
  };
  const rosterMatchForStudent = (card, student, cls) => {
    const rows = rosterRowsForCard(card);
    if (!rows.length) return null;
    const studentId = clean(student.id || student.key);
    const classId = clean(cls?.id || cls?.classId);
    const key = clean(cls?.key || cls?.classKey);
    const cardSection = card?.sectionIdx ?? card?.sectionIndex ?? null;
    return rows.some(row => {
      const rowStudent = clean(row.studentId || row.studentKey || row.id || row.name);
      const rowClass = clean(row.classId || row.classKey || row.className);
      const rowSection = row.sectionIdx ?? row.sectionIndex ?? null;
      const classOk = !rowClass || rowClass === classId || normalizeClassKey(rowClass) === key;
      const sectionOk = rowSection == null || cardSection == null || String(rowSection) === String(cardSection);
      return classOk && sectionOk && rowStudent === studentId;
    });
  };
  const cardMatchesStudent = (card, entry, student, cls) => {
    if (!card) return false;
    const studentId = clean(student.id || student.key);
    const cardStudents = (card?.studentKeys || card?.studentIds || []).map(clean).filter(Boolean);
    if (cardStudents.length) return cardStudents.includes(studentId);
    const rosterMatch = rosterMatchForStudent(card, student, cls);
    if (rosterMatch !== null) return rosterMatch;
    if (card.isManual && entryClassKeys(entry).includes(cls.key)) return true;
    return isLikelyWholeClassCard(card, cls);
  };

  function entityList(type, semester, classScope = classes) {
    if (type === "class") {
      return classScope.map(cls => ({ type, key: cls.key, label: cls.key, cls, match: entry => entryClassKeys(entry).includes(cls.key) }))
        .filter(entity => entries.some(entity.match));
    }
    if (type === "teacher") {
      const names = unique(entries.flatMap(entry => entryTeachers(entry, semester))).sort();
      return names.map(name => ({ type, key: name, label: name, match: entry => entryTeachers(entry, semester).includes(name) }))
        .filter(entity => entries.some(entity.match));
    }
    if (type === "room") {
      return rooms.map(room => ({ type, key: room.id, label: clean(room.name || room.short || room.id), room, match: entry => entryRoomIds(entry).includes(room.id) }))
        .filter(entity => entries.some(entity.match));
    }
    return classScope.flatMap(cls => (cls.students || []).map(student => ({
      type: "student",
      key: clean(student.id || `${cls.key}:${student.name}`),
      label: clean(student.id || student.name || student.label),
      cls,
      student,
      match: entry => {
        if ((entry?.audienceStudentKeys || []).map(clean).includes(clean(student.id))) return true;
        return entryCardIds(entry).some(id => cardMatchesStudent(cardMap.get(id), entry, student, cls));
      },
    }))).filter(entity => entries.some(entity.match));
  }

  function itemCount(entry, entity, semester) {
    const ids = entryCardIds(entry);
    const entryCards = ids.map(id => cardMap.get(id)).filter(Boolean);
    if (entity.type === "teacher") {
      if (entryCards.length) {
        const matched = entryCards.filter(card => {
          const teachers = cardTeachers(card, entry, semester);
          return teachers.length ? teachers.includes(entity.key) : splitTeachers(entry.teacherName).includes(entity.key);
        });
        return matched.length ? 1 : 0;
      }
      return resolveSemesterEntryValues(entry || {}, templateMap, semester).teachers.includes(entity.key) ? 1 : 0;
    }
    if (entity.type === "room") {
      if (entryCards.length) {
        const matched = entryCards.filter(card => {
          const idsForCard = roomIdsForCard(entry, card);
          return idsForCard.length ? idsForCard.includes(entity.key) : entryRoomIds(entry).includes(entity.key);
        });
        return matched.length ? 1 : 0;
      }
      return entryRoomIds(entry).includes(entity.key) ? 1 : 0;
    }
    if (entity.type === "class") {
      if (entryCards.length) {
        const matched = entryCards.filter(card => {
          const keys = cardClassKeys(card);
          return keys.length ? keys.includes(entity.key) : entryClassKeys(entry).includes(entity.key);
        });
        if (matched.length) return matched.length;
      }
      return entity.match(entry) ? 1 : 0;
    }
    const matched = entryCards.filter(card => cardMatchesStudent(card, entry, entity.student, entity.cls));
    if (matched.length <= 1) return matched.length;
    const titles = unique(matched.map(card => cardTitle(card, entry, semester)));
    const first = normSpecial(titles[0] || "");
    return titles.length <= 1 || titles.every(title => normSpecial(title) === first) ? 1 : matched.length;
  }

  function auditEntitySlots(entity, semester) {
    const counts = [];
    for (let day = 0; day < DAYS; day++) {
      for (let period = 0; period < periodCount; period++) {
        const count = entries.filter(entry => Number(entry.day) === day && Number(entry.period) === period && entity.match(entry))
          .reduce((sum, entry) => sum + itemCount(entry, entity, semester), 0);
        counts.push(count);
      }
    }
    return counts;
  }

  const anomalies = [];
  const missingCardRefs = [];
  entries.forEach(entry => {
    if (!Number.isInteger(Number(entry.day)) || Number(entry.day) < 0 || Number(entry.day) >= DAYS) anomalies.push(`entry ${entry.id}: invalid day ${entry.day}`);
    if (!Number.isInteger(Number(entry.period)) || Number(entry.period) < 0 || Number(entry.period) >= periodCount) anomalies.push(`entry ${entry.id}: invalid period ${entry.period}`);
    entryCardIds(entry).forEach(id => { if (!cardMap.has(id)) missingCardRefs.push({ entryId: entry.id, cardId: id }); });
  });
  const missingRooms = unique(entries.flatMap(entry => entryRoomIds(entry)).filter(id => !roomMap.has(id)));

  const semesterChanges = cards.map(card => {
    const sem1 = cardResolved(card, {}, "1");
    const sem2 = cardResolved(card, {}, "2");
    const changedFields = [
      sem1.subject !== sem2.subject ? "subject" : "",
      sem1.english !== sem2.english ? "english" : "",
      sem1.teacher !== sem2.teacher ? "teacher" : "",
    ].filter(Boolean);
    return changedFields.length ? { cardId: card.id, templateId: card.templateId, changedFields } : null;
  }).filter(Boolean);

  const profileAudits = [];
  const splitHistogram = { "0": 0, "1": 0, "2": 0, "3": 0, "4": 0, "5+": 0 };
  let globalMaxItems = 0;
  for (const semester of ["1", "2"]) {
    for (const type of ["class", "teacher", "room", "student"]) {
      const entities = entityList(type, semester);
      let nonEmptySlots = 0;
      let maxItems = 0;
      let overflowSlots = 0;
      entities.forEach(entity => {
        auditEntitySlots(entity, semester).forEach(count => {
          if (count > 0) nonEmptySlots++;
          maxItems = Math.max(maxItems, count);
          globalMaxItems = Math.max(globalMaxItems, count);
          if (count > 4) overflowSlots++;
          const bucket = count >= 5 ? "5+" : String(count);
          splitHistogram[bucket]++;
        });
      });
      profileAudits.push({
        semester,
        type,
        layoutMode: "individual",
        entityCount: entities.length,
        sheetCount: entities.length,
        rows: periodCount + 1,
        cols: DAYS + 1,
        nonEmptySlots,
        maxItemsPerCell: maxItems,
        overflowSlots,
        orientations: ["landscape", "portrait"],
      });
      if (type !== "student") {
        const rowsPerPage = type === "class" ? 9 : 10;
        profileAudits.push({
          semester,
          type,
          layoutMode: "overview",
          entityCount: entities.length,
          sheetCount: balancedPageCount(entities.length, rowsPerPage),
          rowsPerPage,
          rows: Math.min(rowsPerPage, entities.length) + 2,
          cols: DAYS * periodCount + 1,
          orientations: ["landscape"],
        });
      }
    }
  }

  const classMiddle = classes.filter(cls => cls.gradeNo >= 7 && cls.gradeNo <= 9);
  const classHigh = classes.filter(cls => cls.gradeNo >= 10 && cls.gradeNo <= 12);
  const classScopePages = {
    middle: balancedPageCount(entityList("class", "1", classMiddle).length, 9),
    high: balancedPageCount(entityList("class", "1", classHigh).length, 9),
    all: balancedPageCount(entityList("class", "1", classes).length, 9),
  };

  const modelCombinationCount = profileAudits.reduce((sum, profile) => sum + profile.orientations.length, 0);
  const pdfCombinationCount = modelCombinationCount;
  const wordCombinationCount = profileAudits.filter(profile => profile.layoutMode === "individual")
    .reduce((sum, profile) => sum + profile.orientations.length, 0);

  return {
    source: input?.sourceLabel || input?.mode || "operational-data",
    counts: {
      classes: classes.length,
      students: classes.reduce((sum, cls) => sum + (cls.students || []).length, 0),
      rooms: rooms.length,
      templates: domains.templates.length,
      cards: cards.length,
      entries: entries.length,
      periods: periodCount,
    },
    structural: {
      missingCardReferenceCount: missingCardRefs.length,
      missingRoomReferenceCount: missingRooms.length,
      invalidEntryCount: anomalies.length,
      classScopePages,
    },
    semester: {
      changedCardCount: semesterChanges.length,
      changedSubjectCount: semesterChanges.filter(item => item.changedFields.includes("subject")).length,
      changedEnglishCount: semesterChanges.filter(item => item.changedFields.includes("english")).length,
      changedTeacherCount: semesterChanges.filter(item => item.changedFields.includes("teacher")).length,
    },
    coverage: {
      profileAudits,
      splitHistogram,
      globalMaxItemsPerCell: globalMaxItems,
      pdfCombinationCount,
      wordCombinationCount,
      excelDatabaseCombinationCount: 2,
    },
    anomalies: [...anomalies, ...missingCardRefs.map(item => `entry ${item.entryId}: missing card ${item.cardId}`), ...missingRooms.map(id => `missing room ${id}`)],
  };
}

export function operationalAuditText(audit) {
  const lines = [];
  lines.push("Operational timetable print regression");
  lines.push(`source=${audit.source}`);
  lines.push(`classes=${audit.counts.classes} students=${audit.counts.students} rooms=${audit.counts.rooms} templates=${audit.counts.templates} cards=${audit.counts.cards} entries=${audit.counts.entries}`);
  lines.push(`semesterChangedCards=${audit.semester.changedCardCount} subject=${audit.semester.changedSubjectCount} english=${audit.semester.changedEnglishCount} teacher=${audit.semester.changedTeacherCount}`);
  lines.push(`classOverviewPages middle=${audit.structural.classScopePages.middle} high=${audit.structural.classScopePages.high} all=${audit.structural.classScopePages.all}`);
  lines.push(`splitHistogram=${JSON.stringify(audit.coverage.splitHistogram)} maxItems=${audit.coverage.globalMaxItemsPerCell}`);
  lines.push(`combinations pdf=${audit.coverage.pdfCombinationCount} word=${audit.coverage.wordCombinationCount} excel=${audit.coverage.excelDatabaseCombinationCount}`);
  lines.push(`anomalies=${audit.anomalies.length}`);
  return lines.join("\n");
}
