// ================================================================
// timetable-data.js · Timetable Data Helpers
// ================================================================
import { GRADE_KEYS, CATEGORY_PALETTE } from "./config.js";
import { appState } from "./state.js?v=2026-07-13-system-audit-r343";
import { getTemplateById, getTemplateCardTitle, splitTeacherNames } from "./templates.js";
import { getTtCards, getTtCardById } from "./ttcards.js";
export { getTtCardById } from "./ttcards.js";
import { clean, sectionLabel, gradeDisplay, getEffectiveCredit, isChanCheCategory, isProtectedWholeGradeLabel } from "./utils.js";

const ttDomain  = () => appState.timetable;
const entries   = () => ttDomain().entries || [];

function getTtCardTitleSnapshot(card) {
  if (!card) return "";
  const stored = clean(card.subject) || clean(card.label) || clean(card.subjectEn);
  if (stored) return stored;
  const tpl = getTemplateById(card.templateId);
  return tpl ? getTemplateCardTitle(tpl) : "";
}

function findTtCardSnapshot(gradeKey, templateId, sectionIdx = null) {
  return getTtCards().find(c =>
    (!gradeKey || c.gradeKey === gradeKey) &&
    (!templateId || c.templateId === templateId) &&
    (sectionIdx == null || (c.sectionIdx ?? 0) === (sectionIdx ?? 0))
  ) || null;
}

function getCardsForEntry(e) {
  const ids = ttCardIdsFromEntry(e);
  return ids.map(id => getTtCardById(id)).filter(Boolean);
}

function ttCardIdsFromEntry(e) {
  return [...(e?.ttcardIds || []), e?.ttcardId].filter(Boolean);
}

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
  // 시간표 화면에서는 커리큘럼 원본이 아니라 저장된 시간표 카드 스냅샷을 우선 사용합니다.
  const card = findTtCardSnapshot(gradeKey, templateId);
  if (card) return getCreditsForTtCard(card);
  const row = (appState.curriculum.gradeBoards[gradeKey] || [])
    .find(r => r.sem1TemplateId === templateId || r.sem2TemplateId === templateId);
  return row ? getEffectiveCredit(row) : 0;
}

export function getCurriculumRowForTemplate(gradeKey, templateId) {
  return (appState.curriculum.gradeBoards[gradeKey] || [])
    .find(r => r.sem1TemplateId === templateId || r.sem2TemplateId === templateId) || null;
}

export function getCategoryForTemplate(gradeKey, templateId) {
  const card = findTtCardSnapshot(gradeKey, templateId);
  return card?.category || getCurriculumRowForTemplate(gradeKey, templateId)?.category || "";
}

export function getTrackForTemplate(gradeKey, templateId) {
  const card = findTtCardSnapshot(gradeKey, templateId);
  return card?.track || getCurriculumRowForTemplate(gradeKey, templateId)?.track || "";
}

export function getGroupNameForTemplate(gradeKey, templateId) {
  const card = findTtCardSnapshot(gradeKey, templateId);
  return card?.group || getCurriculumRowForTemplate(gradeKey, templateId)?.group || "";
}

export function isWholeGradeTtCard(card) {
  if (!card?.templateId || !card?.gradeKey) return false;
  if (card.isWholeGrade) return true;

  // 카드가 이미 특정 반 대상(classKeys/classLabels)을 가지고 있으면 그 저장값을 우선합니다.
  // 제목이 "채플"이어도 사용자가/생성기가 반별 카드로 만든 경우 전체학년으로 되돌리지 않습니다.
  const hasStoredAudience = (Array.isArray(card.classKeys) && card.classKeys.length)
    || (Array.isArray(card.classLabels) && card.classLabels.length);
  if (hasStoredAudience) return false;

  const title = getTtCardTitleSnapshot(card);
  const category = clean(card.category || getCategoryForTemplate(card.gradeKey, card.templateId));
  const groupName = clean(card.group || getGroupNameForTemplate(card.gradeKey, card.templateId));
  const track = clean(card.track || getTrackForTemplate(card.gradeKey, card.templateId));
  const label = [title, category, groupName, track, card.label].join(" ");

  // 저장 대상 반이 없는 과거 데이터에 한해 명시적 전체학년 표현을 fallback으로 사용합니다.
  return isProtectedWholeGradeLabel(label);
}

export function getCategoryColor(category) {
  const idx = (appState.curriculum.options?.category || []).indexOf(category);
  return idx >= 0 ? CATEGORY_PALETTE[idx % CATEGORY_PALETTE.length] : { bg:"#f1f5f9", text:"#374151" };
}

export function getAssignedCount(templateId, gradeKey) {
  return entries().filter(e => entryHasGrade(e, gradeKey) && entryTemplateIds(e).includes(templateId)).length;
}

export function getTeachersForTemplate(templateId) {
  // 시간표에서는 저장된 ttcard 교사 스냅샷을 우선 사용합니다.
  const fromCards = [...new Set(getTtCards()
    .filter(c => c.templateId === templateId)
    .flatMap(c => (Array.isArray(c.teachers) && c.teachers.length) ? c.teachers : splitTeacherNames(c.teacherName))
    .filter(Boolean))];
  if (fromCards.length) return fromCards;

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
  // 저장된 시간표 카드 스냅샷을 우선합니다. 커리큘럼 원본 수정이 시간표에 즉시 반영되지 않도록 분리합니다.
  if (isChanCheCategory(card.category)) return 1;
  const stored = parseFloat(card.credits);
  if (Number.isFinite(stored) && stored > 0) return stored;

  // 이전 데이터 호환용 fallback: 카드에 시수 스냅샷이 없는 경우에만 커리큘럼을 참조합니다.
  const row = (appState.curriculum.gradeBoards[card.gradeKey] || [])
    .find(r => r.sem1TemplateId === card.templateId || r.sem2TemplateId === card.templateId);
  if (isChanCheCategory(row?.category)) return 1;
  return getEffectiveCredit(row);
}

export function getTeachersForTtCard(card) {
  if (!card) return [];
  if (clean(card.teacherMode) === "none") return [];
  if (Array.isArray(card.teachers) && card.teachers.length) return card.teachers;
  if (card.teacherName) return splitTeacherNames(card.teacherName);
  return getTeachersForTemplate(card.templateId);
}

export function getGroupCards(group) {
  if (!group) return [];
  const excluded = new Set(group.excludedCardIds || []);
  const unitIds = new Set((group.units || []).flatMap(u => u.ttcardIds || []));
  const ids = [
    ...(group.poolCardIds || []).filter(id => !unitIds.has(id)),
    ...(group.units || []).flatMap(u => u.ttcardIds || [])
  ];
  const seen = new Set();
  return ids
    .filter(id => id && !excluded.has(id) && !seen.has(id) && seen.add(id))
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

  const classRows = getAllClasses();

  // 1순위: 사용자가 편집한 저장 카드 데이터입니다.
  // 수동 카드/JSON 편집 카드에서는 isWholeGrade가 과거 값으로 true로 남아 있어도
  // classLabels/classKeys에 입력한 대상 반을 우선합니다.
  const stored = [];
  if (Array.isArray(card.classLabels) && card.classLabels.length) {
    card.classLabels.forEach(label => stored.push(classInfoFromStoredLabel(label, card.gradeKey)));
  } else if (Array.isArray(card.classKeys) && card.classKeys.length) {
    card.classKeys.forEach(key => {
      const info = classInfoFromStoredKey(key, card.gradeKey);
      if (info) stored.push(info);
    });
  }
  const normalizeStoredInfos = () => {
    const seen = new Set();
    return stored.filter(info => {
      const key = classKey(info);
      if (!key || seen.has(key)) return false;
      seen.add(key); return true;
    });
  };
  if (stored.length && (card.isManual || card.manualEdited)) return normalizeStoredInfos();

  const explicitWhole = isWholeGradeTtCard(card);

  // 전체학년/채플/창체 계열 카드는 과거 저장값에 7A만 남아 있어도
  // 현재 학급 목록 기준으로 해당 학년 전체 반을 우선 점유하게 합니다.
  // 단, 수동 편집 카드가 아닌 일반 생성 카드에 한정합니다.
  if (explicitWhole && card.gradeKey) {
    const allGradeClasses = classRows.filter(c => c.gradeKey === card.gradeKey);
    if (allGradeClasses.length) return allGradeClasses;
  }

  if (stored.length) return normalizeStoredInfos();

  // 이하 코드는 이전 데이터 호환용 fallback입니다.
  const rosterEntries = getRosterEntriesForTtCard(card);
  const allClasses = appState.classes?.classes || [];
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
  const base = getTtCardTitleSnapshot(card) || "?";
  const cc = Math.max(1, parseInt(appState.rosters?.rosterMeta?.[card?.templateId]?.classCount) || 1);
  const classLabels = getTtCardClassLabels(card);
  const sec = classLabels.length ? classLabels.join(", ") : sectionLabel(card?.sectionIdx ?? 0);
  const shouldShowSection = cc > 1 || classLabels.length > 1;
  return {
    id: card?.id || "",
    ttcardId: card?.id || "",
    templateId: card?.templateId || "",
    title: shouldShowSection ? `${base} ${sec}` : base,
    subject: base,
    gradeKey: card?.gradeKey || "",
    sectionIdx: card?.sectionIdx ?? 0,
    sectionLabel: sec,
    classLabels,
    teachers: getTeachersForTtCard(card),
    credits: getCreditsForTtCard(card),
    roomRule: card?.roomRule || "auto",
    fixedRoomId: card?.fixedRoomId || null,
  };
}

export function buildEntryDataFromTtCards(cards, { day, period, groupId = null, unitId = null, groupName = "" } = {}) {
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
    groupName: clean(groupName),
    ttcardId: validCards.length === 1 ? first.id : null,
    ttcardIds: validCards.map(c => c.id),
    templateIds,
    gradeKeys,
    templateId: templateIds[0] || first.templateId,
    gradeKey: gradeKeys[0] || first.gradeKey,
    teacherName,
    audienceClassKeys: [...new Set(validCards.flatMap(c => getTtCardClassInfos(c).map(classKey)).filter(Boolean))],
    // 학생 key는 시간표 배치/충돌 기준에서 제외합니다.
    audienceStudentKeys: [],
    roomId: null
  };
}

export function makePlacementFromGroupItem(group, groupItem) {
  return buildEntryDataFromTtCards(groupItem.ttcards || [], {
    groupId: group.id,
    unitId: groupItem.unit?.id || null,
    groupName: group.name || ""
  });
}

function entryAudienceClassKeySet(entry = {}) {
  return new Set((Array.isArray(entry.audienceClassKeys) ? entry.audienceClassKeys : [])
    .map(clean)
    .filter(Boolean));
}

export function entryMatchesClass(entry, cls) {
  if (!entry || !cls) return false;

  // 배치 상세에서 학반별 홈룸 배정을 적용하면 같은 과목카드를 여러 학반용 entry로
  // 분할합니다. 이 경우 카드 원본은 여러 반을 덮더라도 entry.audienceClassKeys가
  // 실제 표시/충돌 대상 반을 결정해야 합니다.
  const narrowedClassKeys = entryAudienceClassKeySet(entry);
  if (narrowedClassKeys.size) {
    const clsKey = classKey(cls);
    return !!clsKey && narrowedClassKeys.has(clsKey);
  }

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


export function calculateClassCreditSummary(ttcards = getTtCards(), groups = appState.timetable?.ttcardGroups || []) {
  const result = { classes: [], gradeSummaries: [], total: 0, targetPerClass: 0, targetTotal: 0, diagnostics: [] };
  const groupedIds = new Set();
  const groupedWholeKeys = new Set();
  const countedWholeKeys = new Set();
  const classMap = new Map();

  const ensureClass = (key, info = {}) => {
    if (!key) return null;
    if (!classMap.has(key)) {
      const label = formatClassLabelFromInfo(info, key);
      classMap.set(key, {
        key,
        label,
        gradeKey: info.gradeKey || gradeKeyFromClassKey(key),
        section: info.section || sectionFromClassKey(key),
        credits: 0,
        contributions: []
      });
    }
    return classMap.get(key);
  };

  const addContribution = (key, info, credits, meta) => {
    const value = Number(credits) || 0;
    if (!key || value <= 0) return;
    const row = ensureClass(key, info);
    if (!row) return;
    row.credits += value;
    row.contributions.push({ credits: value, ...meta });
  };

  const cardClassPairs = (card) => getTtCardClassInfos(card).map(info => ({ info, key: classKey(info) })).filter(x => x.key);

  const compoundCreditKey = (card) => {
    if (card?.compoundParentTemplateId) {
      return `compound:${card.compoundParentTemplateId}:${card.gradeKey || ""}:${card.sectionIdx ?? 0}`;
    }
    return `card:${card?.id || ""}`;
  };

  const wholeGradeCreditKey = (card) => {
    if (!card) return "";
    const label = [
      card.subject, card.subjectEn, card.label,
      card.category, card.track, card.group, card.nameKo, card.nameEn
    ].map(clean).filter(Boolean).join(" ");
    const isWhole = isWholeGradeTtCard(card);
    if (!isWhole) return "";
    const base = card.compoundParentTemplateId || card.templateId || clean(card.subject) || clean(card.label);
    const grade = clean(card.gradeKey);
    return grade && base ? `whole:${grade}:${base}` : "";
  };

  const getCardsForGroupCreditOptions = (group) => {
    const excluded = new Set(group?.excludedCardIds || []);
    const unitCardIds = new Set((group?.units || []).flatMap(u => u.ttcardIds || []));
    const options = [];

    (group?.units || []).forEach(unit => {
      const cards = (unit.ttcardIds || [])
        .filter(id => id && !excluded.has(id))
        .map(id => getTtCardById(id))
        .filter(Boolean);
      if (cards.length) options.push({ kind: "unit", unit, cards });
    });

    const poolBuckets = new Map();
    (group?.poolCardIds || []).forEach(id => {
      if (!id || excluded.has(id) || unitCardIds.has(id)) return;
      const card = getTtCardById(id);
      if (!card) return;
      const key = card.compoundParentTemplateId
        ? `compound:${card.compoundParentTemplateId}:${card.gradeKey || ""}:${card.sectionIdx ?? 0}`
        : `card:${card.id}`;
      if (!poolBuckets.has(key)) poolBuckets.set(key, []);
      poolBuckets.get(key).push(card);
    });
    poolBuckets.forEach(cards => options.push({ kind: "pool-card", unit: null, cards }));

    return options;
  };

  const optionCreditsByClass = (option) => {
    const byClass = new Map();
    (option.cards || []).forEach(card => {
      const credits = getCreditsForTtCard(card);
      cardClassPairs(card).forEach(({ key, info }) => {
        if (!byClass.has(key)) byClass.set(key, { key, info, buckets: new Map(), titles: [] });
        const row = byClass.get(key);
        const cKey = compoundCreditKey(card);
        const bucket = row.buckets.get(cKey) || { credits: 0, cards: [] };
        bucket.credits += credits;
        bucket.cards.push(card);
        row.buckets.set(cKey, bucket);
        const title = getTtCardTitleSnapshot(card) || card.subject || card.label;
        if (title) row.titles.push(title);
      });
    });

    const out = [];
    byClass.forEach(row => {
      // 같은 복합과목의 구성 카드(예: 미적분 2 + 심화물리 2)는 합산합니다.
      // 그 외 병렬 선택과목은 같은 시간대에서 한 학급을 한 번만 점유하므로 최대값으로 봅니다.
      const bucketValues = [...row.buckets.values()].map(b => Number(b.credits) || 0).filter(v => v > 0);
      const credits = bucketValues.length ? Math.max(...bucketValues) : 0;
      out.push({
        key: row.key,
        info: row.info,
        credits,
        title: uniqueStrings(row.titles).join(" + ")
      });
    });
    return out;
  };

  (groups || []).forEach(group => {
    const options = getCardsForGroupCreditOptions(group);
    const allGroupCards = options.flatMap(o => o.cards || []);
    if (!allGroupCards.length) return;
    allGroupCards.forEach(c => {
      groupedIds.add(c.id);
      const wholeKey = wholeGradeCreditKey(c);
      if (wholeKey) groupedWholeKeys.add(wholeKey);
    });

    // 그룹은 같은 시간대에 움직이는 선택/동시수업 단위입니다.
    // 각 학급에는 그룹 안 옵션 중 실제 점유 시수가 가장 큰 값만 더합니다.
    // 단, 복합과목의 구성 카드들은 compoundParentTemplateId 기준으로 먼저 합산합니다.
    const byClass = new Map();
    options.forEach(option => {
      optionCreditsByClass(option).forEach(row => {
        const prev = byClass.get(row.key);
        if (!prev || row.credits > prev.credits) {
          byClass.set(row.key, { ...row, option });
        }
      });
    });

    byClass.forEach(({ key, info, credits, title, option }) => {
      addContribution(key, info, credits, {
        kind: "group",
        groupId: group.id,
        groupName: group.name || "그룹",
        unitId: option?.unit?.id || null,
        title: title || group.name || "그룹 카드"
      });
    });
  });

  (ttcards || []).forEach(card => {
    if (!card || groupedIds.has(card.id)) return;

    // 창체·채플·동아리·자율활동처럼 전체 학년이 같은 시간에 듣는 카드는
    // 데이터상 반별 카드(_0, _1, _2)가 남아 있어도 한 학년당 1회만 계산해야 합니다.
    // 또한 그룹에 대표 카드(_0)만 들어가 있는 경우 같은 templateId/gradeKey의 나머지 반별 카드는
    // 이미 그 그룹이 해당 학년 전체를 점유한 것으로 보아 개별 계산에서 제외합니다.
    const wholeKey = wholeGradeCreditKey(card);
    if (wholeKey && groupedWholeKeys.has(wholeKey)) return;
    if (wholeKey && countedWholeKeys.has(wholeKey)) return;

    const credits = getCreditsForTtCard(card);
    cardClassPairs(card).forEach(({ key, info }) => {
      addContribution(key, info, credits, {
        kind: "card",
        cardId: card.id,
        title: getTtCardTitleSnapshot(card) || card.subject || card.label || "시간표 카드"
      });
    });
    if (wholeKey) countedWholeKeys.add(wholeKey);
  });

  const classes = [...classMap.values()].sort((a, b) => compareClassSummaryRows(a, b));
  const byGrade = new Map();
  classes.forEach(row => {
    const grade = gradeNumberFromGradeKey(row.gradeKey || gradeKeyFromClassKey(row.key));
    if (!grade) return;
    if (!byGrade.has(grade)) byGrade.set(grade, []);
    byGrade.get(grade).push(row);
  });

  const gradeSummaries = [...byGrade.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([grade, rows]) => {
      const values = rows.map(r => r.credits);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const total = values.reduce((sum, value) => sum + (Number(value) || 0), 0);
      return { grade, rows, min, max, value: max, total, isBalanced: min === max };
    });

  const targetPerClass = Math.max(0, parseInt(appState.timetable?.config?.periodCount, 10) || 7) * 5;
  classes.forEach(row => {
    row.targetCredits = targetPerClass;
    row.diffFromTarget = (Number(row.credits) || 0) - targetPerClass;
  });
  gradeSummaries.forEach(gs => {
    gs.targetCredits = targetPerClass;
    gs.targetTotal = targetPerClass * (gs.rows?.length || 0);
    gs.hasTargetIssue = (gs.rows || []).some(row => Number(row.diffFromTarget) !== 0);
  });

  result.classes = classes;
  result.gradeSummaries = gradeSummaries;
  // 전체 합계는 학년 대표값이 아니라 실제 학급별 점유 시수의 총합입니다.
  // 예: 15개 반 × 35시수 = 525
  result.total = classes.reduce((sum, row) => sum + (Number(row.credits) || 0), 0);
  result.targetPerClass = targetPerClass;
  result.targetTotal = targetPerClass * classes.length;
  result.diagnostics = buildClassCreditDiagnostics(classes, gradeSummaries);
  return result;
}

function buildClassCreditDiagnostics(classes, gradeSummaries) {
  const lines = [];
  gradeSummaries.forEach(gs => {
    const target = Number(gs.targetCredits) || 0;
    const issueRows = (gs.rows || []).filter(row => Number(row.diffFromTarget) !== 0);
    if (gs.isBalanced && !issueRows.length) return;
    const status = [];
    if (!gs.isBalanced) status.push(`${gs.min}~${gs.max}시수`);
    if (issueRows.length && target) status.push(`기준 ${target}시수와 차이`);
    lines.push(`${gs.grade}학년: ${status.join(" / ")}`);
    issueRows.forEach(row => {
      const diff = Number(row.diffFromTarget) || 0;
      const diffText = diff < 0 ? `${Math.abs(diff)}시수 부족` : `${diff}시수 초과`;
      lines.push(`- ${row.label}: ${row.credits}시수 (${diffText})`);
      const titles = row.contributions.slice(0, 8).map(c => `  · ${c.kind === "group" ? `[그룹] ${c.groupName}` : c.title}: ${c.credits}시수`);
      lines.push(...titles);
      if (row.contributions.length > 8) lines.push(`  · ... 외 ${row.contributions.length - 8}개`);
    });
  });
  if (!lines.length) lines.push("모든 학급이 기준 시수와 일치합니다.");
  return lines;
}

function formatClassLabelFromInfo(info = {}, fallbackKey = "") {
  const g = gradeNumberFromGradeKey(info.gradeKey || gradeKeyFromClassKey(fallbackKey));
  const s = info.section || sectionFromClassKey(fallbackKey) || sectionLabel(info.sectionIdx ?? 0);
  return g && s ? `${g}${s}` : (fallbackKey || "?");
}

function gradeKeyFromClassKey(key = "") {
  const g = String(key || "").split(":")[0] || "";
  return g ? `${Number(g)}학년` : "";
}

function sectionFromClassKey(key = "") {
  return String(key || "").split(":")[1] || "";
}

function gradeNumberFromGradeKey(gradeKey = "") {
  const m = String(gradeKey || "").match(/\d{1,2}/);
  return m ? String(Number(m[0])) : "";
}

function compareClassSummaryRows(a, b) {
  const ga = Number(gradeNumberFromGradeKey(a.gradeKey || gradeKeyFromClassKey(a.key))) || 0;
  const gb = Number(gradeNumberFromGradeKey(b.gradeKey || gradeKeyFromClassKey(b.key))) || 0;
  if (ga !== gb) return ga - gb;
  return String(a.section || sectionFromClassKey(a.key)).localeCompare(String(b.section || sectionFromClassKey(b.key)), "ko", { numeric: true });
}

export function getUnitForTemplate(templateId) {
  for (const grp of (appState.timetable.ttcardGroups || [])) {
    for (const unit of (grp.units || [])) {
      if (unit.templateIds.includes(templateId)) return { group: grp, unit };
    }
  }
  return null;
}

/** Get display title for a unit (comma-joined template names) */

export function getUnitDisplayTitle(unit) {
  if (Array.isArray(unit?.ttcardIds) && unit.ttcardIds.length) {
    const titles = unit.ttcardIds.map(id => getTtCardTitleSnapshot(getTtCardById(id))).filter(Boolean);
    if (titles.length) return [...new Set(titles)].join(" / ");
  }
  return (unit?.templateIds || [])
    .map(id => getTtCardTitleSnapshot(findTtCardSnapshot(null, id)) || (() => { const t = getTemplateById(id); return t ? getTemplateCardTitle(t) : "?"; })())
    .filter(Boolean).join(" / ") || unit?.name || "?";
}

/** Get all grade keys covered by a unit's templates */

export function getUnitGradeKeys(unit) {
  const grades = new Set();
  (unit?.ttcardIds || []).forEach(id => {
    const card = getTtCardById(id);
    if (card?.gradeKey) grades.add(card.gradeKey);
  });
  if (grades.size) return [...grades];

  (unit?.templateIds || []).forEach(id => {
    getTtCards().filter(c => c.templateId === id).forEach(c => { if (c.gradeKey) grades.add(c.gradeKey); });
    GRADE_KEYS.forEach(g => {
      const board = appState.curriculum.gradeBoards[g] || [];
      if (board.some(r => r.sem1TemplateId === id || r.sem2TemplateId === id)) grades.add(g);
    });
  });
  return [...grades];
}

/** Get teachers for a unit (union of all template teachers) */

export function getUnitTeachers(unit) {
  const fromCards = (unit?.ttcardIds || []).flatMap(id => getTeachersForTtCard(getTtCardById(id)));
  if (fromCards.length) return [...new Set(fromCards.filter(Boolean))];
  return [...new Set((unit?.templateIds || []).flatMap(id => getTeachersForTemplate(id)))];
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

/** Full timetable: rows = classes (7A,7B,...), columns = days × periods */

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
  const cards = getCardsForEntry(e);

  // Group entry → 배치 시점에 저장한 groupName과 현재 그룹명을 먼저 사용합니다.
  // 전체보기/학급보기 모두 track(구분명)보다 실제 그룹명이 우선 표시되어야 합니다.
  if (e.groupId) {
    if (clean(e.groupName)) return clean(e.groupName);
    const grp = (appState.timetable.ttcardGroups || []).find(g => g.id === e.groupId);
    if (grp?.name) return grp.name;
    const titles = [...new Set(cards.map(c => getTtCardTitleSnapshot(c)).filter(Boolean))];
    if (titles.length) return titles.join(" / ");
  }

  if (cards.length) {
    if (cards.length === 1) return describeTtCard(cards[0]).title;
    const titles = [...new Set(cards.map(c => getTtCardTitleSnapshot(c)).filter(Boolean))];
    return titles.join(" / ") || "?";
  }

  const snapshot = findTtCardSnapshot(e.gradeKey, e.templateId, e.sectionIdx);
  if (snapshot) return describeTtCard(snapshot).title;
  return getTemplateCardTitle(getTemplateById(e.templateId)) || "?";
}

export function entryTeachers(e) {
  // Always prefer stored teacherName (most accurate)
  if (e.teacherName) return splitTeacherNames(e.teacherName).filter(Boolean);

  const cards = getCardsForEntry(e);
  if (cards.length) {
    return [...new Set(cards.flatMap(c => getTeachersForTtCard(c)).filter(Boolean))];
  }

  // Unit entry → derive from ttcardIds (new) or templateIds (legacy)
  if (e.unitId) {
    const grp  = (appState.timetable.ttcardGroups || []).find(g => g.id === e.groupId);
    const unit = grp?.units.find(u => u.id === e.unitId);
    if (unit) return getUnitTeachers(unit);
  }

  const snapshot = findTtCardSnapshot(e.gradeKey, e.templateId, e.sectionIdx);
  if (snapshot) return getTeachersForTtCard(snapshot);
  return getTeachersForTemplate(e.templateId);
}

// ── Entry card ────────────────────────────────────────────────────
