// ================================================================
// cp-sat-constraint-policy.js · CP-SAT hard/soft/off policy bridge
// r378: 연도별 제한 정책 정규화, payload 반영, 결과 감사
// ================================================================

const clean = value => String(value ?? "").trim();
const asArray = value => Array.isArray(value) ? value : [];
const unique = values => [...new Set(asArray(values).map(clean).filter(Boolean))];
const deepClone = value => JSON.parse(JSON.stringify(value ?? null));

export const CP_SAT_POLICY_SCHEMA_VERSION = "r378-cpsat-constraint-policy-v1";
export const CP_SAT_POLICY_MODES = Object.freeze(["hard", "soft", "off"]);
export const CP_SAT_POLICY_PRIORITIES = Object.freeze(["low", "medium", "high"]);

export const CP_SAT_LOCKED_RULES = Object.freeze([
  { key: "cardCoverage", label: "카드별 요구 시수", description: "부족·초과 없이 정확히 배치" },
  { key: "teacherConflict", label: "교사 시간 충돌", description: "동일 교사의 동시간 중복 금지" },
  { key: "studentConflict", label: "학생 시간 충돌", description: "동일 학생의 동시간 중복 금지" },
  { key: "classConflict", label: "학급 시간 충돌", description: "동일 학급의 동시간 중복 금지" },
  { key: "roomConflict", label: "교실 시간 충돌", description: "동일 교실의 비의도 중복 금지" },
  { key: "unavailableTime", label: "수업 불가시간", description: "교사·교실·카드 불가시간 준수" },
  { key: "fixedPlacement", label: "고정수업·고정교실", description: "고정 배치와 고정 교실 유지" },
  { key: "concurrentGroup", label: "묶음수업 동시배치", description: "그룹 구성 카드를 같은 시간에 배치" },
  { key: "continuousBlock", label: "연속수업", description: "지정된 연속 교시와 순서 유지" },
  { key: "requiredRooms", label: "필수 다중교실", description: "필요한 교실 수와 지정 교실 확보" },
]);

export const CP_SAT_EDITABLE_RULES = Object.freeze([
  {
    key: "teacherMaxPerDay",
    label: "교사 하루 최대 시수",
    description: "교사별 maxPerDay 값을 적용합니다.",
    allowedModes: ["hard", "soft", "off"],
  },
  {
    key: "teacherMaxConsecutive",
    label: "교사 최대 연속수업",
    description: "교사별 maxConsecutive 값을 적용합니다.",
    allowedModes: ["hard", "soft", "off"],
  },
  {
    key: "teacherMaxPerWeek",
    label: "교사 주간 최대 시수",
    description: "0이 아닌 교사별 maxPerWeek 값을 적용합니다.",
    allowedModes: ["hard", "soft", "off"],
  },
  {
    key: "roomCapacity",
    label: "교실 수용인원",
    description: "교실 정원보다 많은 학생이 배치되는 것을 제어합니다.",
    allowedModes: ["hard", "soft", "off"],
  },
  {
    key: "sameSubjectDay",
    label: "동일 과목 하루 중복",
    description: "같은 학급·과목의 하루 반복 횟수를 제어합니다.",
    allowedModes: ["hard", "soft", "off"],
    valueKey: "maxPerDay",
    valueLabel: "하루 최대",
    min: 1,
    max: 4,
  },
  {
    key: "classDailyBalance",
    label: "학급 요일별 시수 균형",
    description: "요일별 수업 수 차이가 커지는 것을 줄입니다.",
    allowedModes: ["soft", "off"],
    valueKey: "maxDailySpread",
    valueLabel: "권장 차이",
    min: 0,
    max: 5,
  },
  {
    key: "teacherRoomPreference",
    label: "담당교사 교실 우선",
    description: "roomRule=teacher 카드의 담당교사 교실 사용을 우선합니다.",
    allowedModes: ["soft", "off"],
  },
  {
    key: "homeroomPreference",
    label: "홈룸 교실 우선",
    description: "roomRule=homeroom 카드의 홈룸 사용을 우선합니다.",
    allowedModes: ["soft", "off"],
  },
]);

const DEFAULT_RULES = Object.freeze({
  teacherMaxPerDay: { mode: "hard", priority: "high" },
  teacherMaxConsecutive: { mode: "hard", priority: "high" },
  teacherMaxPerWeek: { mode: "off", priority: "medium" },
  roomCapacity: { mode: "soft", priority: "high" },
  sameSubjectDay: { mode: "soft", priority: "high", maxPerDay: 1 },
  classDailyBalance: { mode: "soft", priority: "medium", maxDailySpread: 1 },
  teacherRoomPreference: { mode: "soft", priority: "low" },
  homeroomPreference: { mode: "soft", priority: "low" },
});

function normalizeMode(value, allowedModes, fallback) {
  const mode = clean(value).toLowerCase();
  return allowedModes.includes(mode) ? mode : fallback;
}

function normalizePriority(value, fallback = "medium") {
  const priority = clean(value).toLowerCase();
  return CP_SAT_POLICY_PRIORITIES.includes(priority) ? priority : fallback;
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function defaultCpSatConstraintPolicy() {
  return {
    schemaVersion: CP_SAT_POLICY_SCHEMA_VERSION,
    updatedAt: "",
    source: "default-r378",
    rules: deepClone(DEFAULT_RULES),
  };
}

export function normalizeCpSatConstraintPolicy(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const sourceRules = source.rules && typeof source.rules === "object" ? source.rules : source;
  const normalized = defaultCpSatConstraintPolicy();
  normalized.updatedAt = clean(source.updatedAt);
  normalized.source = clean(source.source) || "normalized-r378";

  CP_SAT_EDITABLE_RULES.forEach(def => {
    const defaults = DEFAULT_RULES[def.key] || { mode: "off", priority: "medium" };
    const saved = sourceRules?.[def.key] && typeof sourceRules[def.key] === "object"
      ? sourceRules[def.key]
      : {};
    const rule = {
      mode: normalizeMode(saved.mode, def.allowedModes, defaults.mode),
      priority: normalizePriority(saved.priority, defaults.priority),
    };
    if (def.valueKey) {
      rule[def.valueKey] = clampInt(
        saved[def.valueKey],
        defaults[def.valueKey],
        Number(def.min ?? 0),
        Number(def.max ?? 99),
      );
    }
    normalized.rules[def.key] = rule;
  });
  return normalized;
}

export function hasActiveSoftCpSatPolicy(policy = {}) {
  const normalized = normalizeCpSatConstraintPolicy(policy);
  return Object.values(normalized.rules).some(rule => rule?.mode === "soft");
}

export function cpSatConstraintPolicySummary(policy = {}) {
  const normalized = normalizeCpSatConstraintPolicy(policy);
  const counts = { hard: CP_SAT_LOCKED_RULES.length, soft: 0, off: 0 };
  Object.values(normalized.rules).forEach(rule => {
    if (rule.mode === "hard") counts.hard += 1;
    else if (rule.mode === "soft") counts.soft += 1;
    else counts.off += 1;
  });
  return `강제 ${counts.hard} · 유연 ${counts.soft} · 사용 안 함 ${counts.off}`;
}

function modeFor(policy, key) {
  return normalizeCpSatConstraintPolicy(policy).rules[key]?.mode || "off";
}

function priorityWeight(priority = "medium") {
  if (priority === "high") return 12;
  if (priority === "low") return 1;
  return 4;
}

function zeroConstraintField(map, field) {
  if (!map || typeof map !== "object") return;
  Object.values(map).forEach(value => {
    if (value && typeof value === "object") value[field] = 0;
  });
}

export function applyCpSatConstraintPolicyToPayload(data = {}, policy = {}) {
  const normalized = normalizeCpSatConstraintPolicy(policy);
  const tt = data?.timetable && typeof data.timetable === "object" ? data.timetable : null;
  if (!tt) return { data, policy: normalized, relaxedFields: [] };

  const relaxedFields = [];
  const originalTeacherConstraints = deepClone(tt.teacherConstraints || {});
  const originalTeacherConstraintsById = deepClone(tt.teacherConstraintsById || {});
  const maps = [tt.teacherConstraints, tt.teacherConstraintsById];
  const relax = (ruleKey, field) => {
    if (normalized.rules[ruleKey]?.mode === "hard") return;
    maps.forEach(map => zeroConstraintField(map, field));
    relaxedFields.push(field);
  };
  relax("teacherMaxPerDay", "maxPerDay");
  relax("teacherMaxConsecutive", "maxConsecutive");
  relax("teacherMaxPerWeek", "maxPerWeek");

  tt.cpSatConstraintPolicy = deepClone(normalized);
  tt.cpSatConstraintPolicyBridge = {
    schemaVersion: "r378-cpsat-policy-bridge-v1",
    serverBaseline: "r348",
    relaxedTeacherFields: unique(relaxedFields),
    originalTeacherConstraints,
    originalTeacherConstraintsById,
    note: "hard 교사 제한은 solver 입력에 유지하고 soft/off 교사 제한은 0으로 완화합니다. 기타 정책은 결과 감사와 서버 확장용 정책 객체로 전달합니다.",
  };
  return { data, policy: normalized, relaxedFields: unique(relaxedFields) };
}

function payloadFromState(state = {}) {
  return state?.data || state?.normalized || state || {};
}

function splitTeacherNames(value = "") {
  return unique(String(value || "").split(/[,/\n]+/g));
}

function teacherKeysFromEntry(entry = {}) {
  const ids = unique([...(entry.teacherIds || [])]);
  if (ids.length) return ids;
  return unique([...(entry.teacherNames || []), ...splitTeacherNames(entry.teacherName || entry.teacher)]);
}

function cardIdsFromEntry(entry = {}) {
  return unique([...(entry.ttcardIds || []), entry.ttcardId]);
}

function classKeysFromEntry(entry = {}) {
  // 요일 중복·균형은 학년 전체가 아니라 실제 학급 단위로 계산해야 합니다.
  // gradeKeys(예: 10학년)를 섞으면 10A/10B/10C 수업을 같은 학급의 중복으로 오인합니다.
  return unique([
    ...(entry.audienceClassKeys || []),
    ...(entry.classKeys || []),
  ]).filter(key => /:\s*[^:]+$/.test(key));
}

function roomAssignmentForCard(entry = {}, cardId = "") {
  const assignments = entry.roomAssignmentsByTtCardId && typeof entry.roomAssignmentsByTtCardId === "object"
    ? entry.roomAssignmentsByTtCardId
    : {};
  return clean(assignments[cardId] || entry.roomId || (asArray(entry.roomIds).length === 1 ? entry.roomIds[0] : ""));
}

function addDetail(details, ruleKey, mode, message, amount = 1, context = {}) {
  details.push({ ruleKey, mode, message, amount: Math.max(1, Number(amount || 1) || 1), ...context });
}

function constraintMaps(payload = {}) {
  const tt = payload?.timetable || {};
  const bridge = tt.cpSatConstraintPolicyBridge || {};
  return [
    bridge.originalTeacherConstraintsById || {},
    bridge.originalTeacherConstraints || {},
    tt.teacherConstraintsById || {},
    tt.teacherConstraints || {},
  ];
}

function teacherConstraint(payload, teacherKey) {
  for (const map of constraintMaps(payload)) {
    if (map?.[teacherKey]) return map[teacherKey];
  }
  const teachers = asArray(payload?.teachers?.teachers);
  const teacher = teachers.find(item => clean(item?.id) === teacherKey || clean(item?.name) === teacherKey);
  if (!teacher) return {};
  for (const map of constraintMaps(payload)) {
    if (map?.[clean(teacher.id)]) return map[clean(teacher.id)];
    if (map?.[clean(teacher.name)]) return map[clean(teacher.name)];
  }
  return {};
}

function maxConsecutive(periodSet) {
  const periods = [...periodSet].map(Number).filter(Number.isInteger).sort((a, b) => a - b);
  let best = 0;
  let streak = 0;
  let previous = null;
  periods.forEach(period => {
    streak = previous != null && period === previous + 1 ? streak + 1 : 1;
    best = Math.max(best, streak);
    previous = period;
  });
  return best;
}

export function auditCpSatConstraintPolicy({ state = {}, entries = [], policy = {}, capacityAudit = null } = {}) {
  const payload = payloadFromState(state);
  const normalized = normalizeCpSatConstraintPolicy(policy || payload?.timetable?.cpSatConstraintPolicy || {});
  const details = [];
  const teacherSlots = new Map();

  asArray(entries).forEach(entry => {
    const day = Number(entry?.day);
    const period = Number(entry?.period);
    if (!Number.isInteger(day) || !Number.isInteger(period)) return;
    teacherKeysFromEntry(entry).forEach(teacherKey => {
      if (!teacherSlots.has(teacherKey)) teacherSlots.set(teacherKey, new Map());
      const byDay = teacherSlots.get(teacherKey);
      if (!byDay.has(day)) byDay.set(day, new Set());
      byDay.get(day).add(period);
    });
  });

  teacherSlots.forEach((byDay, teacherKey) => {
    const constraint = teacherConstraint(payload, teacherKey);
    const weekCount = [...byDay.values()].reduce((sum, set) => sum + set.size, 0);
    const dailyMode = normalized.rules.teacherMaxPerDay.mode;
    const consecutiveMode = normalized.rules.teacherMaxConsecutive.mode;
    const weeklyMode = normalized.rules.teacherMaxPerWeek.mode;
    const maxDay = Math.max(0, Number(constraint.maxPerDay || 0) || 0);
    const maxCon = Math.max(0, Number(constraint.maxConsecutive || 0) || 0);
    const maxWeek = Math.max(0, Number(constraint.maxPerWeek || 0) || 0);

    byDay.forEach((periods, day) => {
      if (dailyMode !== "off" && maxDay > 0 && periods.size > maxDay) {
        addDetail(details, "teacherMaxPerDay", dailyMode, `${teacherKey} · ${day + 1}일차 ${periods.size}/${maxDay}시수`, periods.size - maxDay, { teacherKey, day });
      }
      const consecutive = maxConsecutive(periods);
      if (consecutiveMode !== "off" && maxCon > 0 && consecutive > maxCon) {
        addDetail(details, "teacherMaxConsecutive", consecutiveMode, `${teacherKey} · ${day + 1}일차 연속 ${consecutive}/${maxCon}시수`, consecutive - maxCon, { teacherKey, day });
      }
    });
    if (weeklyMode !== "off" && maxWeek > 0 && weekCount > maxWeek) {
      addDetail(details, "teacherMaxPerWeek", weeklyMode, `${teacherKey} · 주간 ${weekCount}/${maxWeek}시수`, weekCount - maxWeek, { teacherKey });
    }
  });

  const tt = payload?.timetable || {};
  const cards = asArray(tt.ttcards || tt.ttCards || tt.cards);
  const cardById = new Map(cards.map(card => [clean(card?.id), card]).filter(([id]) => id));
  const sameSubjectMode = normalized.rules.sameSubjectDay.mode;
  const sameSubjectMax = normalized.rules.sameSubjectDay.maxPerDay;
  if (sameSubjectMode !== "off") {
    const occurrences = new Map();
    asArray(entries).forEach(entry => {
      if (Number(entry?.autoBlockSpanIndex || 0) > 0) return;
      const day = Number(entry?.day);
      if (!Number.isInteger(day)) return;
      const entryCards = cardIdsFromEntry(entry);
      if (entryCards.length) {
        entryCards.forEach(cardId => {
          const card = cardById.get(cardId) || {};
          const subjectKey = clean(card.templateId || card.subjectId || card.subject || cardId);
          const classKeys = unique([...(card.classKeys || []), ...classKeysFromEntry(entry)]);
          classKeys.forEach(classKey => {
            const key = `${classKey}|${day}|${subjectKey}`;
            if (!occurrences.has(key)) occurrences.set(key, { classKey, day, subjectKey, blocks: new Set() });
            occurrences.get(key).blocks.add(clean(entry.groupId || entry.autoBlockKey || entry.id || `${cardId}:${entry.period}`));
          });
        });
      } else {
        const subjectKey = clean(entry.templateId || asArray(entry.templateIds)[0] || entry.groupId || entry.id);
        classKeysFromEntry(entry).forEach(classKey => {
          const key = `${classKey}|${day}|${subjectKey}`;
          if (!occurrences.has(key)) occurrences.set(key, { classKey, day, subjectKey, blocks: new Set() });
          occurrences.get(key).blocks.add(clean(entry.groupId || entry.autoBlockKey || entry.id));
        });
      }
    });
    occurrences.forEach(item => {
      if (item.blocks.size <= sameSubjectMax) return;
      addDetail(details, "sameSubjectDay", sameSubjectMode, `${item.classKey} · ${item.day + 1}일차 동일 과목 ${item.blocks.size}/${sameSubjectMax}회`, item.blocks.size - sameSubjectMax, item);
    });
  }

  const capacityMode = normalized.rules.roomCapacity.mode;
  if (capacityMode !== "off") {
    asArray(capacityAudit?.details).forEach(item => {
      addDetail(
        details,
        "roomCapacity",
        capacityMode,
        `${item.roomName || item.roomId} · ${Number(item.day) + 1}일차 ${Number(item.period) + 1}교시 · ${item.studentCount}/${item.capacity}명`,
        Math.max(1, Number(item.overBy || 1) || 1),
        { roomId: item.roomId, day: item.day, period: item.period },
      );
    });
  }

  const balanceRule = normalized.rules.classDailyBalance;
  if (balanceRule.mode === "soft") {
    const classDays = new Map();
    asArray(entries).forEach(entry => {
      const day = Number(entry?.day);
      const period = Number(entry?.period);
      if (!Number.isInteger(day) || !Number.isInteger(period)) return;
      classKeysFromEntry(entry).forEach(classKey => {
        if (!classDays.has(classKey)) classDays.set(classKey, Array.from({ length: 5 }, () => new Set()));
        if (day >= 0 && day < 5) classDays.get(classKey)[day].add(period);
      });
    });
    classDays.forEach((days, classKey) => {
      const loads = days.map(set => set.size);
      const spread = Math.max(...loads) - Math.min(...loads);
      if (spread > balanceRule.maxDailySpread) {
        addDetail(details, "classDailyBalance", "soft", `${classKey} · 요일별 ${loads.join("/")}시수 · 차이 ${spread}`, spread - balanceRule.maxDailySpread, { classKey, loads });
      }
    });
  }

  const teacherRoomRule = normalized.rules.teacherRoomPreference;
  const homeroomRule = normalized.rules.homeroomPreference;
  const classes = asArray(payload?.classes?.classes);
  const classRoomMap = new Map();
  classes.forEach(item => {
    const gradeNo = Number(String(item?.grade || "").replace(/[^0-9]/g, ""));
    const section = clean(item?.name || item?.section || item?.className);
    const classKey = gradeNo && section ? `${gradeNo}:${section}` : clean(item?.classKey);
    const roomId = clean(item?.homeRoomId || item?.roomId);
    if (classKey && roomId) classRoomMap.set(classKey, roomId);
  });

  if (teacherRoomRule.mode === "soft" || homeroomRule.mode === "soft") {
    asArray(entries).forEach(entry => {
      cardIdsFromEntry(entry).forEach(cardId => {
        const card = cardById.get(cardId) || {};
        const assigned = roomAssignmentForCard(entry, cardId);
        if (!assigned) return;
        const roomRule = clean(card.roomRule || entry.roomRule).toLowerCase();
        if (roomRule === "teacher" && teacherRoomRule.mode === "soft") {
          const teacherId = clean(asArray(card.teacherIds)[0]);
          const teacherName = clean(asArray(card.teacherNames)[0] || card.teacherName || card.teacher);
          const constraint = teacherConstraint(payload, teacherId || teacherName);
          const expected = clean(constraint.assignedRoomId || (constraint.useHomeRoom ? constraint.homeRoomId : ""));
          if (expected && assigned !== expected) {
            addDetail(details, "teacherRoomPreference", "soft", `${teacherName || teacherId || cardId} · 담당교실 ${expected} 대신 ${assigned}`, 1, { cardId });
          }
        }
        if (roomRule === "homeroom" && homeroomRule.mode === "soft") {
          unique(card.classKeys || classKeysFromEntry(entry)).forEach(classKey => {
            const expected = classRoomMap.get(classKey);
            if (expected && assigned !== expected) {
              addDetail(details, "homeroomPreference", "soft", `${classKey} · 홈룸 ${expected} 대신 ${assigned}`, 1, { cardId, classKey });
            }
          });
        }
      });
    });
  }

  let hardIssueCount = 0;
  let softViolationCount = 0;
  let softPenalty = 0;
  const ruleCounts = {};
  details.forEach(item => {
    ruleCounts[item.ruleKey] = (ruleCounts[item.ruleKey] || 0) + 1;
    if (item.mode === "hard") hardIssueCount += 1;
    if (item.mode === "soft") {
      softViolationCount += 1;
      const priority = normalized.rules[item.ruleKey]?.priority || "medium";
      softPenalty += item.amount * priorityWeight(priority);
    }
  });

  return {
    schemaVersion: "r378-cpsat-policy-audit-v1",
    policy: normalized,
    ok: hardIssueCount === 0,
    canApply: hardIssueCount === 0,
    hardIssueCount,
    softViolationCount,
    softPenalty,
    ruleCounts,
    summary: `정책 강제위반 ${hardIssueCount} · 유연위반 ${softViolationCount} · 벌점 ${softPenalty}`,
    details: details.slice(0, 300),
  };
}
