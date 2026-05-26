// ================================================================
// timetable-data.js · Timetable Data Helpers
// ================================================================
import { GRADE_KEYS, CATEGORY_PALETTE } from "./config.js";
import { appState } from "./state.js";
import { getTemplateById, getTemplateCardTitle, splitTeacherNames } from "./templates.js";
import { getTtCards, getTtCardById } from "./ttcards.js";
import { clean, sectionLabel, gradeDisplay } from "./utils.js";

const ttDomain  = () => appState.timetable;
const entries   = () => ttDomain().entries || [];

export function getSubjectsForGrade(gradeKey) {
  const board = appState.curriculum.gradeBoards[gradeKey] || [];
  const seen = new Set();
  return board.flatMap(row => {
    const ids = [row.sem1TemplateId, row.sem2TemplateId].filter(Boolean);
    return ids.filter(id => !seen.has(id) && seen.add(id))
      .map(id => getTemplateById(id)).filter(Boolean);
  });
}

export function getCreditsForTemplate(gradeKey, templateId) {
  const row = (appState.curriculum.gradeBoards[gradeKey] || [])
    .find(r => r.sem1TemplateId === templateId || r.sem2TemplateId === templateId);
  return row ? (parseFloat(row.credits) || 0) : 0;
}

export function getCurriculumRowForTemplate(gradeKey, templateId) {
  return (appState.curriculum.gradeBoards[gradeKey] || [])
    .find(r => r.sem1TemplateId === templateId || r.sem2TemplateId === templateId) || null;
}

export function getCategoryForTemplate(gradeKey, templateId) {
  return getCurriculumRowForTemplate(gradeKey, templateId)?.category || "";
}

export function getTrackForTemplate(gradeKey, templateId) {
  return getCurriculumRowForTemplate(gradeKey, templateId)?.track || "";
}

export function getGroupNameForTemplate(gradeKey, templateId) {
  return getCurriculumRowForTemplate(gradeKey, templateId)?.group || "";
}

export function isWholeGradeTtCard(card) {
  if (!card?.templateId || !card?.gradeKey) return false;
  const tpl = getTemplateById(card.templateId);
  const title = getTemplateCardTitle(tpl) || clean(card.label);
  const category = clean(getCategoryForTemplate(card.gradeKey, card.templateId));
  const groupName = clean(getGroupNameForTemplate(card.gradeKey, card.templateId));
  const track = clean(getTrackForTemplate(card.gradeKey, card.templateId));
  const label = [title, category, groupName, track, card.label].join(" ");

  // 창체/채플/CA/SA/MS채플처럼 실제로 해당 학년 전체가 동시에 듣는 수업만
  // 모든 반을 점유하도록 봅니다.
  if (category === "창체") return true;
  if (/(채플|chapel|CA|SA|자율|동아리)/i.test(label)) return true;
  if (/(전체|전학년|whole|all)/i.test(label)) return true;
  return false;
}

export function getCategoryColor(category) {
  const idx = (appState.curriculum.options?.category || []).indexOf(category);
  return idx >= 0 ? CATEGORY_PALETTE[idx % CATEGORY_PALETTE.length] : { bg:"#f1f5f9", text:"#374151" };
}

export function getAssignedCount(templateId, gradeKey) {
  return entries().filter(e => entryHasGrade(e, gradeKey) && entryTemplateIds(e).includes(templateId)).length;
}

export function getTeachersForTemplate(templateId) {
  const tpl = getTemplateById(templateId); if (!tpl) return [];
  return [...new Set([
    ...splitTeacherNames(tpl.teacher),
    ...splitTeacherNames(tpl.sem1Teacher),
    ...splitTeacherNames(tpl.sem2Teacher)
  ].filter(Boolean))];
}

export function getSectionCount(templateId) {
  const meta = appState.rosters?.rosterMeta?.[templateId];
  return Math.max(1, parseInt(meta?.classCount) || 1);
}

export function getCreditsForTtCard(card) {
  if (!card) return 0;
  if (Number.isFinite(parseFloat(card.credits)) && parseFloat(card.credits) > 0) return parseFloat(card.credits);
  const row = (appState.curriculum.gradeBoards[card.gradeKey] || [])
    .find(r => r.sem1TemplateId === card.templateId || r.sem2TemplateId === card.templateId);
  return parseFloat(row?.credits) || 0;
}

export function getTeachersForTtCard(card) {
  if (!card) return [];
  if (Array.isArray(card.teachers) && card.teachers.length) return card.teachers;
  if (card.teacherName) return splitTeacherNames(card.teacherName);
  return getTeachersForTemplate(card.templateId);
}

export function getGroupCards(group) {
  if (!group) return [];
  const unitIds = new Set((group.units || []).flatMap(u => u.ttcardIds || []));
  const ids = [
    ...(group.poolCardIds || []).filter(id => !unitIds.has(id)),
    ...(group.units || []).flatMap(u => u.ttcardIds || [])
  ];
  const seen = new Set();
  return ids
    .filter(id => id && !seen.has(id) && seen.add(id))
    .map(id => getTtCardById(id))
    .filter(Boolean);
}

export function getClassInfoByGradeSection(gradeKey, sectionIdx) {
  return getAllClasses().find(c => c.gradeKey === gradeKey && (c.sectionIdx ?? 0) === (sectionIdx ?? 0)) || null;
}

export function getClassInfosByCardLabel(card) {
  const label = clean(card?.label || "");
  if (!label || !card?.gradeKey) return [];
  const gradeClasses = getAllClasses().filter(c => c.gradeKey === card.gradeKey);
  if (gradeClasses.length <= 1) return [];
  const compactLabel = label.replace(/\s+/g, "").toUpperCase();
  const classNames = gradeClasses.map(c => String(c.section || sectionLabel(c.sectionIdx ?? 0)).trim()).filter(Boolean);
  const compactNames = classNames.join("").toUpperCase();

  // 사용자가 카드 라벨을 "8AB", "7A/B", "A,B"처럼 직접 붙인 경우 보완 인식
  // 단일 문자 반명(A/B/C...)은 단어 경계로만 검사하면 "8AB"를 놓치므로 compact 조합도 확인합니다.
  const matchesCompactGroup = compactNames.length >= 2 && compactLabel.includes(compactNames);
  const matched = gradeClasses.filter(c => {
    const name = String(c.section || sectionLabel(c.sectionIdx ?? 0)).trim();
    if (!name) return false;
    const n = name.toUpperCase();
    if (matchesCompactGroup && compactNames.includes(n)) return true;
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^A-Z0-9가-힣])${escaped}([^A-Z0-9가-힣]|$)`, "i").test(label);
  });
  return matched;
}

export function normalizeGradeForClassKey(gradeKey) {
  return gradeDisplay(gradeKey || "").trim();
}

export function normalizeSectionForClassKey(info = {}) {
  const raw = String(info.section ?? "").trim();
  if (raw) {
    const compact = raw.replace(/\s+/g, "").replace(/학년/g, "").toUpperCase();
    // "9A"처럼 학년이 이미 붙은 표기는 뒤의 반명만 남깁니다.
    const m = compact.match(/^\d{1,2}(.+)$/);
    return m ? m[1] : compact;
  }
  return sectionLabel(info.sectionIdx ?? 0).toUpperCase();
}

export function classKey(info) {
  if (!info) return "";
  const grade = normalizeGradeForClassKey(info.gradeKey || info.grade);
  const section = normalizeSectionForClassKey(info);
  return grade && section ? `${grade}:${section}` : "";
}

export function classKeyFromCard(card) {
  if (!card) return "";
  return classKey({ gradeKey: card.gradeKey, sectionIdx: card.sectionIdx ?? 0 });
}

export function classInfoFromStoredLabel(label, fallbackGradeKey = "") {
  const compact = String(label || "").replace(/\s+/g, "").replace(/학년/g, "").toUpperCase();
  const m = compact.match(/^(\d{1,2})(.+)$/);
  if (m) return { gradeKey: `${m[1]}학년`, section: m[2], sectionIdx: Math.max(0, m[2].charCodeAt(0) - 65) };
  return { gradeKey: fallbackGradeKey, section: compact, sectionIdx: Math.max(0, compact.charCodeAt(0) - 65) };
}

export function classInfoFromStoredKey(key, fallbackGradeKey = "") {
  const [g, sec] = String(key || "").split(":");
  if (!g || !sec) return null;
  return classInfoFromStoredLabel(`${g}${sec}`, fallbackGradeKey);
}

export function getRosterEntriesForTtCard(card) {
  if (!card?.templateId) return [];
  return (appState.rosters?.rosters?.[card.templateId] || [])
    .filter(e => (e.sectionIdx ?? 0) === (card.sectionIdx ?? 0));
}

export function getTtCardClassInfos(card) {
  if (!card) return [];

  // 1순위: 시간표 사전작업에서 생성·수정되어 Firebase에 저장된 카드 데이터
  const stored = [];
  if (Array.isArray(card.classLabels) && card.classLabels.length) {
    card.classLabels.forEach(label => stored.push(classInfoFromStoredLabel(label, card.gradeKey)));
  } else if (Array.isArray(card.classKeys) && card.classKeys.length) {
    card.classKeys.forEach(key => {
      const info = classInfoFromStoredKey(key, card.gradeKey);
      if (info) stored.push(info);
    });
  }
  if (stored.length) {
    const seen = new Set();
    return stored.filter(info => {
      const key = classKey(info);
      if (!key || seen.has(key)) return false;
      seen.add(key); return true;
    });
  }

  // 이하 코드는 이전 데이터 호환용 fallback입니다.
  const rosterEntries = getRosterEntriesForTtCard(card);
  const allClasses = appState.classes?.classes || [];
  const classRows = getAllClasses();
  const seen = new Set();
  const infos = [];

  rosterEntries.forEach(re => {
    const clsObj = allClasses.find(c => c.id === re.classId);
    if (!clsObj || clsObj.grade !== card.gradeKey) return;
    const rowInfo = classRows.find(c => c.gradeKey === clsObj.grade && c.section === clsObj.name);
    const info = rowInfo || { gradeKey: clsObj.grade, section: clsObj.name, sectionIdx: card.sectionIdx ?? 0 };
    const key = classKey(info);
    if (key && !seen.has(key)) { seen.add(key); infos.push(info); }
  });

  if (infos.length) return infos;

  const labelInfos = getClassInfosByCardLabel(card);
  if (labelInfos.length) return labelInfos;

  const cc = Math.max(0, parseInt(appState.rosters?.rosterMeta?.[card.templateId]?.classCount) || 0);
  if (cc <= 1 && isWholeGradeTtCard(card)) {
    const allGradeClasses = classRows.filter(c => c.gradeKey === card.gradeKey);
    if (allGradeClasses.length) return allGradeClasses;
  }

  const matched = classRows.filter(c => c.gradeKey === card.gradeKey && (c.sectionIdx ?? 0) === (card.sectionIdx ?? 0));
  if (matched.length) return matched;

  const fallback = getClassInfoByGradeSection(card.gradeKey, card.sectionIdx ?? 0);
  return [fallback || { gradeKey: card.gradeKey, sectionIdx: card.sectionIdx ?? 0, section: sectionLabel(card.sectionIdx ?? 0) }];
}

export function getTtCardClassLabels(card) {
  return uniqueStrings(getTtCardClassInfos(card).map(info => info.section || sectionLabel(info.sectionIdx ?? 0)));
}

export function ttCardCoversClass(card, cls) {
  if (!card || !cls || card.gradeKey !== cls.gradeKey) return false;
  const infos = getTtCardClassInfos(card);
  return infos.some(info => {
    if (cls.section && info.section) return info.section === cls.section;
    return (info.sectionIdx ?? 0) === (cls.sectionIdx ?? 0);
  });
}

export function uniqueStrings(list) {
  return [...new Set((list || []).filter(Boolean))];
}

export function describeTtCard(card) {
  const tpl = getTemplateById(card?.templateId);
  const base = card?.subject || (tpl ? getTemplateCardTitle(tpl) : "?");
  const cc = Math.max(1, parseInt(appState.rosters?.rosterMeta?.[card?.templateId]?.classCount) || 1);
  const classLabels = getTtCardClassLabels(card);
  const sec = classLabels.length ? classLabels.join(", ") : sectionLabel(card?.sectionIdx ?? 0);
  const shouldShowSection = cc > 1 || classLabels.length > 1;
  return {
    title: shouldShowSection ? `${base} ${sec}` : base,
    subject: base,
    gradeKey: card?.gradeKey || "",
    sectionIdx: card?.sectionIdx ?? 0,
    sectionLabel: sec,
    classLabels,
    teachers: getTeachersForTtCard(card),
    credits: getCreditsForTtCard(card),
  };
}

export function buildEntryDataFromTtCards(cards, { day, period, groupId = null, unitId = null } = {}) {
  const validCards = (cards || []).filter(Boolean);
  if (!validCards.length) return null;
  const first = validCards[0];
  const templateIds = [...new Set(validCards.map(c => c.templateId).filter(Boolean))];
  const gradeKeys = [...new Set(validCards.map(c => c.gradeKey).filter(Boolean))];
  const teacherName = [...new Set(validCards.flatMap(c => getTeachersForTtCard(c)).filter(Boolean))].join(",");
  return {
    day, period,
    sectionIdx: first.sectionIdx ?? 0,
    unitId,
    groupId,
    ttcardId: validCards.length === 1 ? first.id : null,
    ttcardIds: validCards.map(c => c.id),
    templateIds,
    gradeKeys,
    templateId: templateIds[0] || first.templateId,
    gradeKey: gradeKeys[0] || first.gradeKey,
    teacherName,
    audienceClassKeys: [...new Set(validCards.flatMap(c => c.classKeys || []))],
    audienceStudentKeys: [...new Set(validCards.flatMap(c => c.studentKeys || []))],
    roomId: null
  };
}

export function makePlacementFromGroupItem(group, groupItem) {
  return buildEntryDataFromTtCards(groupItem.ttcards || [], {
    groupId: group.id,
    unitId: groupItem.unit?.id || null
  });
}

export function entryMatchesClass(entry, cls) {
  if (!entry || !cls) return false;
  const cardIds = [...(entry.ttcardIds || []), entry.ttcardId].filter(Boolean);

  if (cardIds.length) {
    // Check if ANY of the ttcards covers this class
    return cardIds.some(id => {
      const card = getTtCardById(id);
      if (!card) return false;
      // Grade must match
      if (card.gradeKey !== cls.gradeKey) return false;
      // Try roster-based class infos
      const infos = getTtCardClassInfos(card);
      if (infos.length) {
        return infos.some(info => {
          if (cls.section && info.section) return info.section === cls.section;
          return (info.sectionIdx ?? 0) === (cls.sectionIdx ?? 0);
        });
      }
      // Fallback: same sectionIdx
      return (card.sectionIdx ?? 0) === (cls.sectionIdx ?? 0);
    });
  }

  // No ttcardIds — gradeKeys + sectionIdx based
  const eGrades = entry.gradeKeys?.length ? entry.gradeKeys : [entry.gradeKey].filter(Boolean);
  if (!eGrades.includes(cls.gradeKey)) return false;
  const eSec = entry.sectionIdx ?? 0;
  if (eSec === cls.sectionIdx) return true;

  const tplId = entry.templateId || entry.templateIds?.[0];
  if (!tplId) return false;
  const allRosterEntries = (appState.rosters?.rosters?.[tplId] || []).filter(re => (re.sectionIdx ?? 0) === eSec);
  const allCls = appState.classes?.classes || [];
  return allRosterEntries.some(re => {
    const clsObj = allCls.find(c => c.id === re.classId);
    return clsObj && clsObj.grade === cls.gradeKey && clsObj.name === cls.section;
  });
}

export function getUnitForTemplate(templateId) {
  for (const grp of (appState.templates.templateGroups || [])) {
    for (const unit of (grp.units || [])) {
      if (unit.templateIds.includes(templateId)) return { group: grp, unit };
    }
  }
  return null;
}

/** Get display title for a unit (comma-joined template names) */

export function getUnitDisplayTitle(unit) {
  return unit.templateIds
    .map(id => { const t = getTemplateById(id); return t ? getTemplateCardTitle(t) : "?"; })
    .filter(Boolean).join(" / ") || unit.name || "?";
}

/** Get all grade keys covered by a unit's templates */

export function getUnitGradeKeys(unit) {
  const grades = new Set();
  unit.templateIds.forEach(id => {
    GRADE_KEYS.forEach(g => {
      const board = appState.curriculum.gradeBoards[g] || [];
      if (board.some(r => r.sem1TemplateId === id || r.sem2TemplateId === id)) grades.add(g);
    });
  });
  return [...grades];
}

/** Get teachers for a unit (union of all template teachers) */

export function getUnitTeachers(unit) {
  return [...new Set(unit.templateIds.flatMap(id => getTeachersForTemplate(id)))];
}

/**
 * Build schedulable items for auto-assign.
 * Returns items where each item = one timetable card slot to fill.
 * Groups with isConcurrent=true are returned as "blocks" (arrays that must share a slot).
 */

export function getAllClasses() {
  const classSet = new Map();
  const raw = appState.classes?.classes || [];
  // From student classes (source of truth)
  GRADE_KEYS.forEach(gradeKey => {
    raw.filter(c => c.grade === gradeKey && c.students.length > 0)
       .sort((a, b) => a.name.localeCompare(b.name))
       .forEach((cls, idx) => {
         const key = `${gradeKey}_${idx}`;
         if (!classSet.has(key)) classSet.set(key, {gradeKey, sectionIdx: idx, section: cls.name});
       });
  });
  // Fallback: derive from ttcards if no student data
  if (!classSet.size) {
    getTtCards().forEach(c => {
      const key = `${c.gradeKey}_${c.sectionIdx}`;
      if (!classSet.has(key)) classSet.set(key, {gradeKey: c.gradeKey, sectionIdx: c.sectionIdx, section: sectionLabel(c.sectionIdx)});
    });
  }
  return [...classSet.values()].sort((a, b) => {
    const gi = GRADE_KEYS.indexOf(a.gradeKey) - GRADE_KEYS.indexOf(b.gradeKey);
    return gi !== 0 ? gi : a.sectionIdx - b.sectionIdx;
  });
}

/** Full timetable: rows = classes (7A,7B,...), columns = days × periods (like aScTimetables) */

export function entryGradeKeys(e) {
  return e.gradeKeys?.length ? e.gradeKeys : (e.gradeKey ? [e.gradeKey] : []);
}

export function entryTemplateIds(e) {
  return e.templateIds?.length ? e.templateIds : (e.templateId ? [e.templateId] : []);
}

export function entryHasGrade(e, grade) {
  return entryGradeKeys(e).includes(grade);
}

export function entryTitle(e) {
  // Group entry → show group name
  if (e.groupId) {
    const grp = (appState.templates.templateGroups || []).find(g => g.id === e.groupId);
    if (grp?.name) return grp.name;
  }
  // ttcard standalone
  if (e.ttcardId) {
    const card = getTtCardById(e.ttcardId);
    if (card) {
      const tpl = getTemplateById(card.templateId);
      const base = tpl ? getTemplateCardTitle(tpl) : "?";
      const cc = Math.max(1, parseInt(appState.rosters?.rosterMeta?.[card.templateId]?.classCount) || 1);
      return cc > 1 ? `${base} ${sectionLabel(card.sectionIdx)}` : base;
    }
  }
  return getTemplateCardTitle(getTemplateById(e.templateId)) || "?";
}

export function entryTeachers(e) {
  // Always prefer stored teacherName (most accurate)
  if (e.teacherName) return splitTeacherNames(e.teacherName).filter(Boolean);
  // Unit entry → derive from ttcardIds (new) or templateIds (legacy)
  if (e.unitId) {
    const grp  = (appState.templates.templateGroups || []).find(g => g.id === e.groupId);
    const unit = grp?.units.find(u => u.id === e.unitId);
    if (unit) {
      if (unit.ttcardIds?.length) {
        const ttcards = getTtCards();
        return [...new Set(unit.ttcardIds.flatMap(id => {
          const card = ttcards.find(c => c.id === id);
          return card ? getTeachersForTemplate(card.templateId) : [];
        }))];
      }
      if (unit.templateIds?.length) return getUnitTeachers(unit);
    }
  }
  // ttcard standalone
  if (e.ttcardId) { const card = getTtCardById(e.ttcardId); if (card) return getTeachersForTemplate(card.templateId); }
  return getTeachersForTemplate(e.templateId);
}

// ── Entry card ────────────────────────────────────────────────────
