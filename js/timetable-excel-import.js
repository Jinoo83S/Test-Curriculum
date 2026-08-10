// ================================================================
// timetable-excel-import.js · aSc 기반 정리 Excel 시간표 가져오기
// r389 · 2026-08-10: aSc 배치를 현재 그룹 구조 그대로 복원하고 기존 카드/교사/학급 메타를 유지합니다.
// ================================================================

const DAY_INDEX = new Map([
  ["월", 0], ["월요일", 0], ["mon", 0], ["monday", 0],
  ["화", 1], ["화요일", 1], ["tue", 1], ["tues", 1], ["tuesday", 1],
  ["수", 2], ["수요일", 2], ["wed", 2], ["wednesday", 2],
  ["목", 3], ["목요일", 3], ["thu", 3], ["thur", 3], ["thurs", 3], ["thursday", 3],
  ["금", 4], ["금요일", 4], ["fri", 4], ["friday", 4],
]);
const REQUIRED_HEADERS = ["학년", "반", "요일", "교시", "과목", "교사", "교실"];
const DAY_LABELS = ["월", "화", "수", "목", "금"];
const STYLE_ID = "ttAscExcelImportStyle20260810";

const clean = value => String(value ?? "").trim();
const asArray = value => Array.isArray(value) ? value : [];
const unique = values => [...new Set(asArray(values).map(clean).filter(Boolean))];
const deepClone = value => JSON.parse(JSON.stringify(value ?? null));

function fold(value = "") {
  let s = clean(value);
  try { s = s.normalize("NFKC"); } catch (_) {}
  s = s.toLowerCase().replaceAll("리더쉽", "리더십");
  return s.replace(/[\s\[\](){}_.:,/·&+\-]+/g, "");
}

function sourceBaseSubject(value = "") {
  let s = clean(value);
  s = s.replace(/^\d{1,2}\.\d+\s*-\s*/i, "");
  s = s.replace(/^MS\s*-\s*/i, "");
  s = s.replace(/^\d+(?=체육$)/, "");
  return s;
}

const GENERAL_ALIASES = new Map(Object.entries({
  "성경": ["성경", "기독교 연구", "종교와 생활", "현대사회와 종교"],
  "채플": ["채플", "종교1", "삶과 종교1"],
  "성품": ["성품과 공동체"],
  "이야기영어": ["이야기로 배우는 영어(중)", "영어 리딩(중)"],
  "수학영어": ["수학으로 세상 이해하기(중)", "기하", "대수학 I", "미적분학 기초", "미적분학 II"],
  "진로소명": ["진로와 소명"],
  "미션리빙": ["선교적 생활"],
  "리더십": ["섬김의 리더십", "변혁적 리더십"],
  "과제탐구": ["과제 탐구 및 발표 기초", "자율연구"],
  "공연기획11": ["스토리텔링과 공연기획"],
  "정보": ["정보", "프로그래밍"],
  "사회": ["사회", "세계역사의 이해", "통합사회1", "사회와 문화"],
  "사회영어": ["세계시민과 지리"],
  "사회AP": ["온라인 AP 과목"],
  "역사": ["역사", "세계역사의 이해", "한국사1", "세계사"],
  "역사-영어": ["사회", "세계사", "세계시민과 지리"],
  "심화영어": ["심화영어", "비판적 사고와 영어작문"],
  "컴퓨터": ["웹 프로그래밍", "로봇과 공학세계", "고급 프로그래밍", "프로그래밍"],
  "화학": ["화학", "물질과 에너지"],
  "생물": ["세포와 물질대사"],
  "물리": ["물리학", "심화물리(2)"],
  "주제탐": ["주제 탐구 독서"],
  "영어작문": ["심화 영어 작문 I"],
  "국제관계": ["국제관계의 이해"],
  "정치법": ["정치와 법"],
  "영문학": ["영문학"],
  "비판적": ["비판적 읽기와 쓰기"],
  "비교정치": ["비교정치"],
  "미적분": ["미적분(2)", "미적분학 II"],
  "세계문제": ["세계 문제와 미래 사회"],
  "창의경영": ["창의 경영"],
  "프로그래밍": ["고급 프로그래밍", "웹 프로그래밍", "프로그래밍"],
  "영어HS": ["영어 독해와 작문", "영어 I"],
  "영어HS.AP": ["온라인 AP 과목 (영어)"],
  "AP": ["온라인 AP 과목"],
  "HR-2": ["HR2"],
  "체육": ["[남] 체육", "[여] 체육", "[남] 체육1", "[여] 스포츠 생활1", "[남] 스포츠생활1", "[여] 체육1", "스포츠 생활"],
  "음악": ["음악", "음악 생활"],
  "미술": ["미술", "미술 창작", "디자인 심화"],
  "일본어": ["일본어", "생활일본어", "일본어 회화", "일본어 II"],
  "영어": ["영어", "공통영어1", "영어 I", "영어 독해와 작문"],
  "국어": ["국어", "공통국어1", "문학", "언어와 매체"],
  "한국어": ["한국어", "기본한국어1", "기본한국어3"],
  "수학": ["수학", "공통수학1", "대수", "확률과 통계"],
  "과학": ["과학", "화학", "융합과학"],
}).map(([key, values]) => [fold(key), values.map(fold)]));

const MS_ALIASES = new Map([
  [fold("영어"), [fold("영어 소통과 설득"), fold("심화영어토론")]],
  [fold("과학"), [fold("융합과학"), fold("과학탐구실험")]],
  [fold("수학"), [fold("체험수학"), fold("생활속의 수학적 사고")]],
  [fold("일본어"), [fold("생활일본어")]],
]);

function aliasTargets(sourceSubject = "") {
  const raw = clean(sourceSubject);
  const base = fold(sourceBaseSubject(raw));
  if (/^MS\s*-/i.test(raw)) return MS_ALIASES.get(base) || [base];
  return GENERAL_ALIASES.get(base) || [base];
}

function diceCoefficient(a = "", b = "") {
  const x = fold(a), y = fold(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const counts = new Map();
  for (let i = 0; i < x.length - 1; i += 1) {
    const pair = x.slice(i, i + 2);
    counts.set(pair, (counts.get(pair) || 0) + 1);
  }
  let intersection = 0;
  for (let i = 0; i < y.length - 1; i += 1) {
    const pair = y.slice(i, i + 2);
    const count = counts.get(pair) || 0;
    if (count > 0) { intersection += 1; counts.set(pair, count - 1); }
  }
  return (2 * intersection) / ((x.length - 1) + (y.length - 1));
}

function gradeNumber(value = "") {
  const m = clean(value).match(/\d{1,2}/);
  const n = m ? Number(m[0]) : NaN;
  return Number.isInteger(n) ? n : null;
}

function normalizeClassLabel(value = "", fallbackGrade = null) {
  let s = clean(value).replace(/\s+/g, "").replace(/학년/gi, "").toUpperCase();
  if (!s) return "";
  if (/^[A-Z]+$/.test(s) && fallbackGrade) s = `${fallbackGrade}${s}`;
  return s;
}

function normalizeTeacherName(value = "") {
  return clean(value).replace(/\s+/g, " ").toLowerCase();
}

function splitRooms(value = "") {
  return unique(clean(value).split(/[,/\n]+/g).map(x => x.trim()));
}

function roomLookupKey(value = "") {
  const v = clean(value);
  if (/^chapel$/i.test(v)) return "TH201";
  return v;
}

function parseTrackHint(sourceSubject = "") {
  const m = clean(sourceSubject).match(/^\d{1,2}\.(\d+)\s*-/);
  return m ? `선택${m[1]}` : "";
}

function candidateTitles(card = {}, template = null) {
  return unique([
    card.subject, card.subjectEn, card.label,
    template?.nameKo, template?.nameEn,
    template?.sem1NameKo, template?.sem1NameEn,
    template?.sem2NameKo, template?.sem2NameEn,
  ]);
}

function scoreCandidate(row, meta) {
  const aliases = aliasTargets(row.subject);
  const foldedTitles = meta.foldedTitles;
  let subjectScore = 0;
  let exactSubject = false;
  aliases.forEach(alias => {
    if (foldedTitles.includes(alias)) {
      subjectScore = Math.max(subjectScore, 120);
      exactSubject = true;
      return;
    }
    foldedTitles.forEach(title => {
      if (alias.length >= 2 && title.length >= 2 && (alias.includes(title) || title.includes(alias))) subjectScore = Math.max(subjectScore, 90);
    });
  });
  const base = fold(sourceBaseSubject(row.subject));
  foldedTitles.forEach(title => {
    const dice = diceCoefficient(base, title);
    if (dice >= 0.72) subjectScore = Math.max(subjectScore, Math.round(55 + dice * 35));
  });

  const teacherExact = meta.teacherKeys.has(normalizeTeacherName(row.teacher));
  const classExact = meta.classKeys.has(row.classKey);
  const trackHint = parseTrackHint(row.subject);
  const trackExact = !!trackHint && clean(meta.card.track) === trackHint;
  const score = subjectScore + (teacherExact ? 45 : 0) + (classExact ? 20 : 0) + (trackExact ? 15 : 0);
  return { score, subjectScore, exactSubject, teacherExact, classExact, trackExact };
}

function chooseCandidate(row, cardMetas, manualCardId = "") {
  if (manualCardId) {
    const forced = cardMetas.find(meta => meta.card.id === manualCardId && meta.gradeNo === row.gradeNo);
    if (forced) return { meta: forced, score: 999, manual: true, ambiguous: false, candidates: [] };
  }
  const scored = cardMetas
    .filter(meta => meta.gradeNo === row.gradeNo)
    .map(meta => ({ meta, ...scoreCandidate(row, meta) }))
    .sort((a, b) => b.score - a.score || Number(b.teacherExact) - Number(a.teacherExact) || Number(b.classExact) - Number(a.classExact));
  const best = scored[0] || null;
  const second = scored[1] || null;
  if (!best) return { meta: null, score: 0, manual: false, ambiguous: false, candidates: [] };
  const margin = best.score - (second?.score ?? -999);
  const decisive = best.exactSubject || (best.teacherExact && best.trackExact) || (best.teacherExact && best.subjectScore >= 70);
  const accepted = best.score >= 85 && (margin >= 10 || decisive);
  return {
    meta: accepted ? best.meta : null,
    score: best.score,
    manual: false,
    ambiguous: !accepted && best.score >= 70,
    candidates: scored.slice(0, 8),
  };
}

function detectPeriodOffset(rows, periodCount) {
  const nums = rows.map(row => Number.parseInt(clean(row["교시"]), 10)).filter(Number.isInteger);
  if (!nums.length) return 1;
  const min = Math.min(...nums), max = Math.max(...nums);
  // aSc 원본에는 HR이 1번 period로 들어가므로, 정리 파일이 2~(교시수+1)이면 2→1교시로 해석합니다.
  if (min >= 2 && max <= periodCount + 1 && !nums.includes(1)) return 2;
  return 1;
}

export function normalizeAscExcelRows(rawRows = [], { periodCount = 7, classMap = new Map() } = {}) {
  const offset = detectPeriodOffset(rawRows, periodCount);
  const rows = [];
  const invalid = [];
  rawRows.forEach((raw, idx) => {
    const gradeNo = gradeNumber(raw["학년"] || raw["반"]);
    const classLabel = normalizeClassLabel(raw["반"], gradeNo);
    const classInfo = classMap.get(classLabel) || null;
    const dayRaw = clean(raw["요일"]).toLowerCase();
    const day = DAY_INDEX.get(dayRaw);
    const rawPeriod = Number.parseInt(clean(raw["교시"]), 10);
    const period = Number.isInteger(rawPeriod) ? rawPeriod - offset : NaN;
    const row = {
      sourceRow: idx + 2,
      gradeNo,
      classLabel,
      classKey: classInfo?.key || "",
      day,
      period,
      rawPeriod,
      subject: clean(raw["과목"]),
      teacher: clean(raw["교사"]),
      roomText: clean(raw["교실"]),
      roomNames: splitRooms(raw["교실"]),
      classInfo,
      raw,
    };
    const reasons = [];
    if (!gradeNo || gradeNo < 7 || gradeNo > 12) reasons.push("학년");
    if (!classLabel || !classInfo) reasons.push("반");
    if (!Number.isInteger(day) || day < 0 || day > 4) reasons.push("요일");
    if (!Number.isInteger(period) || period < 0 || period >= periodCount) reasons.push("교시");
    if (!row.subject) reasons.push("과목");
    if (reasons.length) invalid.push({ ...row, reasons });
    else rows.push(row);
  });
  return { rows, invalid, periodOffset: offset };
}

function buildMembership(groups = []) {
  const membership = new Map();
  asArray(groups).forEach(group => {
    const excluded = new Set(asArray(group.excludedCardIds).map(clean).filter(Boolean));
    // 현재 시간표의 정식 배치 구조는 같은 group의 구성 카드를 같은 시간에 하나의 entry로 보관합니다.
    // units는 자동배치 후보를 구성하기 위한 내부 구조일 수 있으므로 Excel 복원 시 unit별 entry로 쪼개지 않습니다.
    const groupCardIds = unique([
      ...asArray(group.units).flatMap(unit => asArray(unit?.ttcardIds)),
      ...asArray(group.poolCardIds),
    ]).filter(id => id && !excluded.has(id));
    groupCardIds.forEach(id => {
      membership.set(id, {
        groupId: group.id,
        groupName: clean(group.name),
        groupCardIds,
        kind: "group",
      });
    });
  });
  return membership;
}

function makeClassMap(classes = [], classKeyFn = null) {
  const out = new Map();
  asArray(classes).forEach(info => {
    const gradeNo = gradeNumber(info.gradeKey || info.grade);
    const section = clean(info.section || info.name || "").replace(/\s+/g, "").toUpperCase();
    if (!gradeNo || !section) return;
    const label = `${gradeNo}${section}`;
    const key = typeof classKeyFn === "function" ? clean(classKeyFn(info)) : `${gradeNo}:${section}`;
    out.set(label, { ...info, key, label, gradeNo, section });
  });
  return out;
}

function makeRoomMap(rooms = []) {
  const out = new Map();
  asArray(rooms).forEach(room => {
    const name = clean(room.name || room.short || room.id);
    if (name) out.set(fold(name), room);
  });
  return out;
}

function resolveRoomIds(roomNames, roomMap) {
  const ids = [], missing = [];
  roomNames.forEach(sourceName => {
    const lookup = roomLookupKey(sourceName);
    const room = roomMap.get(fold(lookup));
    if (room?.id) ids.push(room.id); else missing.push(sourceName);
  });
  return { ids: unique(ids), missing: unique(missing) };
}

function buildCardMetas({ cards = [], getTemplateById, getTtCardClassInfos, classKeyFn, getTeachersForTtCard }) {
  return asArray(cards).filter(card => card?.id && card?.gradeKey).map(card => {
    const tpl = typeof getTemplateById === "function" ? getTemplateById(card.templateId) : null;
    const classKeys = new Set(asArray(getTtCardClassInfos?.(card)).map(info => classKeyFn?.(info)).map(clean).filter(Boolean));
    const teacherNames = unique(getTeachersForTtCard?.(card) || card.teachers || clean(card.teacherName).split(","));
    const titles = candidateTitles(card, tpl);
    return {
      card,
      gradeNo: gradeNumber(card.gradeKey),
      classKeys,
      teacherNames,
      teacherKeys: new Set(teacherNames.map(normalizeTeacherName)),
      titles,
      foldedTitles: titles.map(fold),
    };
  });
}

function mappingKey(row) {
  return [row.gradeNo, row.classLabel, row.subject, row.teacher].map(clean).join("¦");
}

function addBucketRow(bucket, row, cardId, roomResolution, teacherMap) {
  bucket.rows.push(row);
  bucket.cardIds.add(cardId);
  if (!bucket.cardRows.has(cardId)) bucket.cardRows.set(cardId, []);
  bucket.cardRows.get(cardId).push(row);
  if (row.classKey) bucket.classKeys.add(row.classKey);
  if (row.teacher) {
    bucket.teacherNames.add(row.teacher);
    const teacher = teacherMap.get(normalizeTeacherName(row.teacher));
    if (teacher?.id) bucket.teacherIds.add(teacher.id);
  }
  roomResolution.ids.forEach(id => bucket.roomIds.add(id));
  roomResolution.missing.forEach(name => bucket.missingRooms.add(name));
}

function compoundCoverageKey(card = {}) {
  if (!card?.compoundParentTemplateId || !card?.compoundPartId) return "";
  return `${card.gradeKey || ""}::${card.sectionIdx ?? 0}::${card.compoundParentTemplateId}`;
}

function analyzeGroupCoverage(bucket, cardById) {
  if (!bucket?.member?.groupId) return null;
  const expectedIds = unique(bucket.member.groupCardIds).filter(id => cardById.has(id));
  if (!expectedIds.length) return null;

  const present = new Set(bucket.cardIds);
  const missingPlain = [];
  const compoundAlternatives = new Map();

  expectedIds.forEach(id => {
    const card = cardById.get(id);
    const compoundKey = compoundCoverageKey(card);
    if (!compoundKey) {
      if (!present.has(id)) missingPlain.push(id);
      return;
    }
    if (!compoundAlternatives.has(compoundKey)) compoundAlternatives.set(compoundKey, []);
    compoundAlternatives.get(compoundKey).push(id);
  });

  const missingCompound = [...compoundAlternatives.entries()]
    .filter(([, ids]) => !ids.some(id => present.has(id)))
    .map(([key, ids]) => ({ key, ids }));

  if (!missingPlain.length && !missingCompound.length) return null;

  const labelForId = id => {
    const card = cardById.get(id) || {};
    return clean(card.subject || card.label || card.subjectEn || id);
  };
  return {
    groupId: bucket.member.groupId,
    groupName: bucket.member.groupName || bucket.member.groupId,
    day: bucket.day,
    period: bucket.period,
    presentCardIds: [...bucket.cardIds],
    missingPlainCardIds: missingPlain,
    missingPlainLabels: missingPlain.map(labelForId),
    missingCompoundKeys: missingCompound.map(item => item.key),
    missingCompoundLabels: missingCompound.map(item => unique(item.ids.map(labelForId)).join(" / ")),
  };
}

export function buildTimetableExcelImportPlan(rawRows = [], context = {}, manualMappings = {}) {
  const periodCount = Math.max(1, Number(context.periodCount || 7) || 7);
  const classMap = makeClassMap(context.classes, context.classKey);
  const normalized = normalizeAscExcelRows(rawRows, { periodCount, classMap });
  const roomMap = makeRoomMap(context.rooms);
  const teacherMap = new Map(asArray(context.teachers).map(t => [normalizeTeacherName(t.name), t]).filter(([name]) => name));
  const cardMetas = buildCardMetas({
    cards: context.cards,
    getTemplateById: context.getTemplateById,
    getTtCardClassInfos: context.getTtCardClassInfos,
    classKeyFn: context.classKey,
    getTeachersForTtCard: context.getTeachersForTtCard,
  });
  const membership = buildMembership(context.groups);
  const unresolved = [];
  const mappedRows = [];
  const warnings = [];
  const sourceTeacherMissing = new Set();
  const sourceRoomMissing = new Set();
  const classAudienceMismatch = [];

  normalized.rows.forEach(row => {
    const key = mappingKey(row);
    const picked = chooseCandidate(row, cardMetas, manualMappings[key]);
    if (!picked.meta) {
      unresolved.push({ key, row, ambiguous: picked.ambiguous, candidates: picked.candidates });
      return;
    }
    const roomResolution = resolveRoomIds(row.roomNames, roomMap);
    roomResolution.missing.forEach(name => sourceRoomMissing.add(name));
    if (row.teacher && !teacherMap.has(normalizeTeacherName(row.teacher))) sourceTeacherMissing.add(row.teacher);
    if (!picked.meta.classKeys.has(row.classKey)) classAudienceMismatch.push({ row, card: picked.meta.card });
    mappedRows.push({ row, key, cardMeta: picked.meta, roomResolution, manual: picked.manual, score: picked.score });
  });

  const buckets = new Map();
  mappedRows.forEach(mapped => {
    const { row, cardMeta, roomResolution } = mapped;
    const cardId = cardMeta.card.id;
    const member = membership.get(cardId) || null;
    // 같은 group에 속한 카드들은 현재 정상 시간표와 동일하게 요일+교시+groupId당 하나의 entry로 합칩니다.
    const bucketKey = member?.groupId
      ? `${row.day}:${row.period}:group:${member.groupId}`
      : `${row.day}:${row.period}:card:${cardId}`;
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, {
        key: bucketKey,
        day: row.day,
        period: row.period,
        member,
        rows: [],
        cardIds: new Set(),
        cardRows: new Map(),
        classKeys: new Set(),
        teacherNames: new Set(),
        teacherIds: new Set(),
        roomIds: new Set(),
        missingRooms: new Set(),
      });
    }
    addBucketRow(buckets.get(bucketKey), row, cardId, roomResolution, teacherMap);
  });

  const entries = [];
  const groupSyncWarnings = [];
  const cardById = new Map(cardMetas.map(meta => [meta.card.id, meta.card]));
  buckets.forEach(bucket => {
    const coverageWarning = analyzeGroupCoverage(bucket, cardById);
    if (coverageWarning) groupSyncWarnings.push(coverageWarning);
    const presentCardIds = [...bucket.cardIds];
    // Excel에 실제로 같은 시간에 존재하는 카드만 하나의 group entry로 합칩니다.
    // 현재 그룹의 나머지 카드를 임의로 추가하면 aSc 배치 자체를 바꾸게 되므로 절대 보충하지 않습니다.
    // 다만 저장 순서는 현재 group 정의를 우선해 재현성을 유지합니다.
    const groupOrder = bucket.member?.groupCardIds || [];
    const orderedPresent = groupOrder.filter(id => bucket.cardIds.has(id));
    const cardIds = orderedPresent.length
      ? [...orderedPresent, ...presentCardIds.filter(id => !orderedPresent.includes(id))]
      : presentCardIds;
    const cards = cardIds.map(id => cardById.get(id)).filter(Boolean);
    let data = context.buildEntryDataFromTtCards?.(cards, {
      day: bucket.day,
      period: bucket.period,
      groupId: bucket.member?.groupId || null,
      unitId: null,
      groupName: bucket.member?.groupName || "",
    });
    if (!data && cards.length) {
      const first = cards[0];
      data = {
        day: bucket.day, period: bucket.period,
        templateId: first.templateId, gradeKey: first.gradeKey, sectionIdx: first.sectionIdx ?? 0,
        ttcardId: cards.length === 1 ? first.id : null,
        ttcardIds: cardIds,
      };
    }
    if (!data) return;
    // 교사/학급 점유 범위는 현재 카드가 source of truth입니다.
    // Excel 행의 교사·반 텍스트로 덮어쓰면 한 그룹이 다시 여러 충돌로 보일 수 있으므로
    // buildEntryDataFromTtCards()가 만든 canonical 메타를 그대로 유지합니다.
    const roomIds = [...bucket.roomIds];
    const assignments = {};
    bucket.cardRows.forEach((rowsForCard, id) => {
      const ids = unique(rowsForCard.flatMap(r => resolveRoomIds(r.roomNames, roomMap).ids));
      if (ids.length) assignments[id] = ids[0];
    });
    if (Object.keys(assignments).length) data.roomAssignmentsByTtCardId = assignments;
    if (roomIds.length) {
      data.roomId = roomIds.length === 1 ? roomIds[0] : null;
      data.roomIds = [...roomIds];
      data.manualRoomIds = [...roomIds];
      data.fixedRoomIds = [...roomIds];
      data.solverFixedRoomIds = [...roomIds];
      data.requiredRoomIds = [...roomIds];
      if (roomIds.length > 1) {
        data.requiredRoomCount = roomIds.length;
        data.multiRoomCount = roomIds.length;
        data.solverRequiredRoomCount = roomIds.length;
      } else {
        delete data.requiredRoomCount;
        delete data.multiRoomCount;
        delete data.solverRequiredRoomCount;
      }
      data.roomRule = "fixed";
      data.roomPinned = true;
    } else {
      data.roomId = null;
      delete data.roomIds;
      delete data.manualRoomIds;
      delete data.fixedRoomIds;
      delete data.solverFixedRoomIds;
      delete data.requiredRoomIds;
      delete data.requiredRoomCount;
      delete data.multiRoomCount;
      delete data.solverRequiredRoomCount;
    }
    data.pinned = false;
    const normalizedEntry = context.normalizeTimetableEntry ? context.normalizeTimetableEntry({ id: context.uid?.("ent") || `ent-import-${Date.now()}-${entries.length}`, ...data }) : { id: context.uid?.("ent") || `ent-import-${Date.now()}-${entries.length}`, ...data };
    entries.push(normalizedEntry);
  });

  if (sourceTeacherMissing.size) warnings.push(`현재 교사 명단에 없는 이름: ${[...sourceTeacherMissing].join(", ")}`);
  if (sourceRoomMissing.size) warnings.push(`현재 교실 목록에 없는 이름: ${[...sourceRoomMissing].join(", ")}`);
  if (classAudienceMismatch.length) warnings.push(`Excel 반과 현재 과목카드 대상 반이 다른 행 ${classAudienceMismatch.length}개 — 배치에는 현재 과목카드의 대상 반을 유지합니다. 매칭을 확인해 주세요.`);
  if (groupSyncWarnings.length) warnings.push(`현재 동시배정 그룹 구성과 aSc Excel 배치가 다른 시간 ${groupSyncWarnings.length}개 — 누락 카드를 임의로 추가하지 않고 기존 동시배정 충돌 검사에 맡깁니다.`);
  if (normalized.invalid.length) warnings.push(`기본 열 값이 잘못되어 제외된 행 ${normalized.invalid.length}개`);

  const sourceSlotCount = new Set(normalized.rows.map(row => `${row.day}:${row.period}`)).size;
  const uniqueMappings = new Map();
  unresolved.forEach(item => { if (!uniqueMappings.has(item.key)) uniqueMappings.set(item.key, item); });
  return {
    periodCount,
    periodOffset: normalized.periodOffset,
    sourceRows: rawRows.length,
    validRows: normalized.rows.length,
    mappedRowCount: mappedRows.length,
    sourceSlotCount,
    entries,
    unresolved,
    unresolvedGroups: [...uniqueMappings.values()],
    invalidRows: normalized.invalid,
    warnings,
    sourceTeacherMissing: [...sourceTeacherMissing],
    sourceRoomMissing: [...sourceRoomMissing],
    classAudienceMismatch,
    groupSyncWarnings,
    // r388 호환 필드는 유지하되, 그룹 완성 여부는 기존 충돌검사의 syncRequired가 판정합니다.
    partialUnits: [],
    ready: unresolved.length === 0 && normalized.invalid.length === 0 && entries.length > 0,
  };
}

export function extractAscRowsFromWorkbook(workbook) {
  if (!workbook?.SheetNames?.length) throw new Error("Excel 시트를 찾을 수 없습니다.");
  const sheetName = workbook.SheetNames.includes("전체") ? "전체" : workbook.SheetNames.find(name => {
    const ws = workbook.Sheets[name];
    if (!ws || !globalThis.XLSX?.utils?.sheet_to_json) return false;
    const rows = globalThis.XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false, blankrows: false });
    const head = asArray(rows[0]).map(clean);
    return REQUIRED_HEADERS.every(h => head.includes(h));
  });
  if (!sheetName) throw new Error(`필수 열(${REQUIRED_HEADERS.join(", ")})이 있는 시트를 찾을 수 없습니다.`);
  const ws = workbook.Sheets[sheetName];
  const rows = globalThis.XLSX.utils.sheet_to_json(ws, { defval: "", raw: false, blankrows: false });
  const headers = rows.length ? Object.keys(rows[0] || {}).map(clean) : [];
  const missing = REQUIRED_HEADERS.filter(h => !headers.includes(h));
  if (missing.length) throw new Error(`필수 열이 없습니다: ${missing.join(", ")}`);
  return { sheetName, rows };
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.tt-xlsx-backdrop{position:fixed;inset:0;z-index:2147483620;background:rgba(15,23,42,.62);display:flex;align-items:center;justify-content:center;padding:18px;font-family:Arial,"Malgun Gothic",sans-serif}
.tt-xlsx-dialog{width:min(1120px,96vw);max-height:92vh;background:#fff;border-radius:14px;box-shadow:0 28px 80px rgba(15,23,42,.4);display:flex;flex-direction:column;overflow:hidden;color:#0f172a}
.tt-xlsx-head{display:flex;gap:12px;align-items:center;padding:14px 18px;background:#f8fafc;border-bottom:1px solid #e2e8f0}.tt-xlsx-head h2{margin:0;font-size:18px}.tt-xlsx-head p{margin:3px 0 0;font-size:11px;color:#64748b;font-weight:700}.tt-xlsx-close{margin-left:auto;width:34px;height:34px;border:0;border-radius:9px;background:#e2e8f0;font-size:20px;cursor:pointer}
.tt-xlsx-body{padding:14px 18px;overflow:auto}.tt-xlsx-summary{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:7px}.tt-xlsx-stat{padding:9px;border:1px solid #dbe4f0;border-radius:10px;background:#f8fafc;text-align:center}.tt-xlsx-stat b{display:block;font-size:18px}.tt-xlsx-stat span{font-size:10px;color:#64748b;font-weight:800}
.tt-xlsx-box{margin-top:12px;border:1px solid #dbe4f0;border-radius:10px;overflow:hidden}.tt-xlsx-box h3{margin:0;padding:8px 10px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-size:12px}.tt-xlsx-box-content{padding:9px 10px;font-size:11px;line-height:1.55}.tt-xlsx-ok{color:#166534}.tt-xlsx-warn{color:#92400e}.tt-xlsx-error{color:#991b1b}.tt-xlsx-map{display:grid;grid-template-columns:minmax(220px,1fr) minmax(280px,1.5fr);gap:8px;align-items:center;margin-bottom:7px}.tt-xlsx-map select{height:31px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;padding:0 7px;font-size:11px}.tt-xlsx-map small{display:block;color:#64748b;margin-top:2px}
.tt-xlsx-actions{display:flex;gap:8px;align-items:center;padding:12px 18px;border-top:1px solid #e2e8f0;background:#f8fafc}.tt-xlsx-actions button{height:34px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#334155;padding:0 12px;font-size:11px;font-weight:900;cursor:pointer}.tt-xlsx-actions .primary{background:#2563eb;border-color:#2563eb;color:#fff}.tt-xlsx-actions .secondary{background:#fff}.tt-xlsx-actions button:disabled{opacity:.45;cursor:not-allowed}.tt-xlsx-note{margin-left:auto;font-size:10px;color:#64748b;font-weight:700}
@media(max-width:900px){.tt-xlsx-summary{grid-template-columns:repeat(3,minmax(0,1fr))}.tt-xlsx-map{grid-template-columns:1fr}}
`;
  document.head.appendChild(style);
}

function escapeHtml(value = "") {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function candidateLabel(candidate) {
  const card = candidate.meta.card;
  const teacher = candidate.meta.teacherNames.join(", ") || "교사 없음";
  const classes = [...candidate.meta.classKeys].join(", ") || "대상반 없음";
  return `${card.gradeKey || ""} · ${card.subject || card.label || card.templateId || card.id} · ${teacher} · ${classes}`;
}

export function createTimetableExcelImport(context = {}) {
  const manualMappings = {};
  let currentRawRows = [];
  let currentPlan = null;
  let fileName = "";

  const planContext = () => ({
    periodCount: context.getPeriodCount?.() || 7,
    classes: context.getClasses?.() || [],
    rooms: context.getRooms?.() || [],
    teachers: context.getTeachers?.() || [],
    cards: context.getCards?.() || [],
    groups: context.getGroups?.() || [],
    classKey: context.classKey,
    getTemplateById: context.getTemplateById,
    getTtCardClassInfos: context.getTtCardClassInfos,
    getTeachersForTtCard: context.getTeachersForTtCard,
    buildEntryDataFromTtCards: context.buildEntryDataFromTtCards,
    normalizeTimetableEntry: context.normalizeTimetableEntry,
    uid: context.uid,
  });

  function rebuildPlan() {
    currentPlan = buildTimetableExcelImportPlan(currentRawRows, planContext(), manualMappings);
    return currentPlan;
  }

  function openPreview() {
    ensureStyle();
    document.getElementById("ttAscExcelImportBackdrop")?.remove();
    const backdrop = document.createElement("div");
    backdrop.id = "ttAscExcelImportBackdrop";
    backdrop.className = "tt-xlsx-backdrop";
    backdrop.innerHTML = `<section class="tt-xlsx-dialog" role="dialog" aria-modal="true">
      <header class="tt-xlsx-head"><div><h2>aSc Excel 시간표 가져오기</h2><p>${escapeHtml(fileName)} · 기존 카드/그룹/교사조건은 유지하고 배치(entries)만 만듭니다.</p></div><button type="button" class="tt-xlsx-close" aria-label="닫기">×</button></header>
      <div class="tt-xlsx-body" data-role="body"></div>
      <footer class="tt-xlsx-actions"><button type="button" class="secondary" data-action="save-only">저장본으로 추가</button><button type="button" class="primary" data-action="apply">현재 시간표에 적용</button><span class="tt-xlsx-note">적용 전 현재 배치를 자동 백업합니다.</span></footer>
    </section>`;
    document.body.appendChild(backdrop);
    const body = backdrop.querySelector('[data-role="body"]');
    const applyBtn = backdrop.querySelector('[data-action="apply"]');
    const saveBtn = backdrop.querySelector('[data-action="save-only"]');
    const close = () => backdrop.remove();
    backdrop.querySelector(".tt-xlsx-close")?.addEventListener("click", close);
    backdrop.addEventListener("click", event => { if (event.target === backdrop) close(); });

    const render = () => {
      const plan = rebuildPlan();
      const ready = plan.ready;
      applyBtn.disabled = !ready;
      saveBtn.disabled = !ready;
      const unresolvedHtml = plan.unresolvedGroups.length ? plan.unresolvedGroups.map(item => {
        const row = item.row;
        const options = item.candidates.map(candidate => `<option value="${escapeHtml(candidate.meta.card.id)}">${escapeHtml(candidateLabel(candidate))} · 점수 ${candidate.score}</option>`).join("");
        return `<div class="tt-xlsx-map"><div><b>${escapeHtml(`${row.gradeNo}학년 ${row.classLabel} · ${row.subject}`)}</b><small>Excel 교사: ${escapeHtml(row.teacher || "없음")} · 행 ${row.sourceRow}</small></div><select data-map-key="${escapeHtml(item.key)}"><option value="">현재 과목카드를 선택하세요</option>${options}</select></div>`;
      }).join("") : `<div class="tt-xlsx-ok">✓ 모든 유효 행이 현재 시간표 카드와 매칭되었습니다.</div>`;
      const warnings = plan.warnings.length ? `<ul>${plan.warnings.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : `<div class="tt-xlsx-ok">추가 경고가 없습니다.</div>`;
      const groupSyncHtml = plan.groupSyncWarnings.length
        ? `<ul>${plan.groupSyncWarnings.slice(0, 30).map(item => {
            const missing = [...item.missingPlainLabels, ...item.missingCompoundLabels].filter(Boolean).join(", ") || "구성 카드";
            return `<li><b>${escapeHtml(item.groupName)}</b> · ${DAY_LABELS[item.day] || "?"} ${item.period + 1}교시 · 현재 그룹 기준 누락: ${escapeHtml(missing)}</li>`;
          }).join("")}</ul>${plan.groupSyncWarnings.length > 30 ? `<div>외 ${plan.groupSyncWarnings.length - 30}개 시간</div>` : ""}`
        : `<div class="tt-xlsx-ok">✓ 현재 동시배정 그룹 구성과 일치합니다.</div>`;
      body.innerHTML = `<div class="tt-xlsx-summary">
        <div class="tt-xlsx-stat"><b>${plan.sourceRows}</b><span>Excel 행</span></div>
        <div class="tt-xlsx-stat"><b>${plan.mappedRowCount}</b><span>매칭 행</span></div>
        <div class="tt-xlsx-stat"><b>${plan.entries.length}</b><span>생성 배치</span></div>
        <div class="tt-xlsx-stat"><b>${plan.sourceSlotCount}</b><span>사용 시간칸</span></div>
        <div class="tt-xlsx-stat"><b>${plan.unresolved.length}</b><span>미매칭 행</span></div>
        <div class="tt-xlsx-stat"><b>${plan.invalidRows.length}</b><span>제외 행</span></div>
      </div>
      <div class="tt-xlsx-box"><h3>교시 해석</h3><div class="tt-xlsx-box-content">Excel 교시값에서 <b>${plan.periodOffset}</b>을 빼 현재 0기준 교시로 변환합니다. 이 파일처럼 aSc의 HR이 1번이고 실제 수업이 2~8이면 <b>2 → 1교시</b>, <b>8 → 7교시</b>로 들어갑니다.</div></div>
      <div class="tt-xlsx-box"><h3>과목카드 매칭${plan.unresolvedGroups.length ? ` · 확인 필요 ${plan.unresolvedGroups.length}종` : ""}</h3><div class="tt-xlsx-box-content ${plan.unresolvedGroups.length ? "tt-xlsx-error" : ""}">${unresolvedHtml}</div></div>
      <div class="tt-xlsx-box"><h3>동시배정 구조${plan.groupSyncWarnings.length ? ` · 확인 필요 ${plan.groupSyncWarnings.length}시간` : ""}</h3><div class="tt-xlsx-box-content ${plan.groupSyncWarnings.length ? "tt-xlsx-warn" : ""}">${groupSyncHtml}</div></div>
      <div class="tt-xlsx-box"><h3>경고</h3><div class="tt-xlsx-box-content ${plan.warnings.length ? "tt-xlsx-warn" : ""}">${warnings}</div></div>
      <div class="tt-xlsx-box"><h3>가져오기 원칙</h3><div class="tt-xlsx-box-content">“전체” 시트만 사용합니다. “교사별/반별/교실별”은 같은 데이터의 정렬본이므로 중복 가져오지 않습니다. 요일·교시가 없는 “미배정” 시트는 현재 시간표 위치를 만들 수 없어 제외합니다.</div></div>`;
      body.querySelectorAll("[data-map-key]").forEach(select => {
        select.value = manualMappings[select.dataset.mapKey] || "";
        select.addEventListener("change", () => {
          const key = select.dataset.mapKey;
          if (select.value) manualMappings[key] = select.value; else delete manualMappings[key];
          render();
        });
      });
    };
    applyBtn.addEventListener("click", async () => {
      const plan = rebuildPlan();
      if (!plan.ready) return;
      if (!confirm(`Excel 배치 ${plan.entries.length}개를 현재 시간표에 적용할까요?\n\n현재 배치는 자동 백업한 뒤 교체합니다.`)) return;
      applyBtn.disabled = true; saveBtn.disabled = true;
      try { await context.onApply?.({ fileName, plan, entries: deepClone(plan.entries) }); close(); }
      catch (error) { alert(`Excel 시간표 적용에 실패했습니다.\n${error?.message || error}`); applyBtn.disabled = false; saveBtn.disabled = false; }
    });
    saveBtn.addEventListener("click", async () => {
      const plan = rebuildPlan();
      if (!plan.ready) return;
      saveBtn.disabled = true;
      try { await context.onSaveOnly?.({ fileName, plan, entries: deepClone(plan.entries) }); close(); }
      catch (error) { alert(`Excel 시간표 저장본 추가에 실패했습니다.\n${error?.message || error}`); saveBtn.disabled = false; }
    });
    render();
  }

  async function openFile(file) {
    if (!file) return;
    if (!globalThis.XLSX?.read || !globalThis.XLSX?.utils?.sheet_to_json) throw new Error("SheetJS(XLSX)가 로드되지 않았습니다. 인터넷 연결 후 다시 시도해 주세요.");
    const buffer = await file.arrayBuffer();
    const workbook = globalThis.XLSX.read(buffer, { type: "array", cellDates: false, dense: false });
    const extracted = extractAscRowsFromWorkbook(workbook);
    currentRawRows = extracted.rows;
    fileName = clean(file.name) || "시간표.xlsx";
    Object.keys(manualMappings).forEach(key => delete manualMappings[key]);
    openPreview();
  }

  return { openFile, rebuildPlan };
}
