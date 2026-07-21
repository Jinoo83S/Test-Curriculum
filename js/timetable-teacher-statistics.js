// ================================================================
// timetable-teacher-statistics.js · 교사별 실제 점유 시수 통계
// r379: teacherId + 요일 + 교시 기준 중복 제거, 요일별 연속수업 통계
// ================================================================

const clean = value => String(value ?? "").trim();
const asArray = value => Array.isArray(value) ? value : [];
const unique = values => [...new Set(asArray(values).map(clean).filter(Boolean))];
const DAY_LABELS = Object.freeze(["월", "화", "수", "목", "금"]);
const DEFAULT_POLICY_MODES = Object.freeze({
  teacherMaxPerDay: "hard",
  teacherMaxConsecutive: "hard",
  teacherMaxPerWeek: "off",
});

function splitTeacherNames(value = "") {
  return unique(String(value || "").split(/[,/\n]+/g));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeMode(value, fallback = "off") {
  const mode = clean(value).toLowerCase();
  return ["hard", "soft", "off"].includes(mode) ? mode : fallback;
}

function policyModes(policy = {}) {
  const rules = policy?.rules && typeof policy.rules === "object" ? policy.rules : policy || {};
  return {
    teacherMaxPerDay: normalizeMode(rules?.teacherMaxPerDay?.mode, DEFAULT_POLICY_MODES.teacherMaxPerDay),
    teacherMaxConsecutive: normalizeMode(rules?.teacherMaxConsecutive?.mode, DEFAULT_POLICY_MODES.teacherMaxConsecutive),
    teacherMaxPerWeek: normalizeMode(rules?.teacherMaxPerWeek?.mode, DEFAULT_POLICY_MODES.teacherMaxPerWeek),
  };
}

function normalizeConstraint(value = {}) {
  const maxPerDay = Number.parseInt(value?.maxPerDay, 10);
  const maxConsecutive = Number.parseInt(value?.maxConsecutive, 10);
  const maxPerWeek = Number.parseInt(value?.maxPerWeek, 10);
  return {
    maxPerDay: Number.isInteger(maxPerDay) && maxPerDay > 0 ? maxPerDay : 6,
    maxConsecutive: Number.isInteger(maxConsecutive) && maxConsecutive > 0 ? maxConsecutive : 3,
    maxPerWeek: Number.isInteger(maxPerWeek) && maxPerWeek > 0 ? maxPerWeek : 0,
  };
}

function longestConsecutive(periods = []) {
  const sorted = [...new Set(asArray(periods).map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
  let longest = 0;
  let current = 0;
  let previous = null;
  sorted.forEach(period => {
    current = previous !== null && period === previous + 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = period;
  });
  return longest;
}

function teacherKeyFromName(name = "") {
  return `name:${clean(name).toLowerCase()}`;
}

function cardIdsFromEntry(entry = {}) {
  return unique([...(entry?.ttcardIds || []), entry?.ttcardId]);
}

function cardSubject(card = {}) {
  return clean(card?.subject || card?.label || card?.nameKo || card?.subjectEn || card?.nameEn || "");
}

function classKeysFromEntry(entry = {}) {
  return unique([...(entry?.audienceClassKeys || []), ...(entry?.classKeys || [])]);
}

function resolveConstraint(teacher, byId = {}, byName = {}) {
  const idValue = clean(teacher?.id) ? byId?.[clean(teacher.id)] : null;
  const nameValue = clean(teacher?.name) ? byName?.[clean(teacher.name)] : null;
  return normalizeConstraint(idValue || nameValue || {});
}

function makeTeacherRegistry(teachers = []) {
  const rows = new Map();
  const byId = new Map();
  const byName = new Map();

  asArray(teachers).forEach((teacher, index) => {
    const id = clean(teacher?.id);
    const name = clean(teacher?.name) || id || `교사 ${index + 1}`;
    const key = id || teacherKeyFromName(name);
    const row = {
      key,
      id,
      name,
      source: id ? "teacher-table" : "name-only",
      slots: new Set(),
      slotDetails: new Map(),
    };
    rows.set(key, row);
    if (id) byId.set(id, row);
    byName.set(name.toLowerCase(), row);
  });

  const ensure = ({ id = "", name = "" } = {}) => {
    const normalizedId = clean(id);
    const normalizedName = clean(name);
    let row = normalizedId ? byId.get(normalizedId) : null;
    if (!row && normalizedName) row = byName.get(normalizedName.toLowerCase()) || null;
    if (row) return row;
    const key = normalizedId || teacherKeyFromName(normalizedName || "미확인 교사");
    row = rows.get(key) || {
      key,
      id: normalizedId,
      name: normalizedName || normalizedId || "미확인 교사",
      source: "timetable-reference",
      slots: new Set(),
      slotDetails: new Map(),
    };
    rows.set(key, row);
    if (normalizedId) byId.set(normalizedId, row);
    if (normalizedName) byName.set(normalizedName.toLowerCase(), row);
    return row;
  };

  return { rows, byId, byName, ensure };
}

function teacherRefsFromCard(card = {}, registry) {
  const ids = unique(card?.teacherIds || []);
  const names = unique([...(card?.teachers || []), ...splitTeacherNames(card?.teacherName || card?.teacher)]);
  const refs = [];

  if (ids.length) {
    ids.forEach((id, index) => {
      const known = registry.byId.get(id);
      refs.push({ id, name: known?.name || names[index] || "" });
    });
    names.forEach(name => {
      const known = registry.byName.get(name.toLowerCase());
      if (known?.id && ids.includes(known.id)) return;
      if (!known?.id && refs.some(ref => clean(ref.name).toLowerCase() === name.toLowerCase())) return;
      refs.push({ id: known?.id || "", name });
    });
    return refs;
  }

  names.forEach(name => {
    const known = registry.byName.get(name.toLowerCase());
    refs.push({ id: known?.id || "", name });
  });
  return refs;
}

function teacherRefsFromEntry(entry = {}, registry) {
  const ids = unique(entry?.teacherIds || []);
  const names = unique([...(entry?.teacherNames || []), ...splitTeacherNames(entry?.teacherName || entry?.teacher)]);
  if (ids.length) {
    return ids.map((id, index) => ({ id, name: registry.byId.get(id)?.name || names[index] || "" }));
  }
  return names.map(name => ({ id: registry.byName.get(name.toLowerCase())?.id || "", name }));
}

function addTeacherSlot(row, entry, cards = []) {
  const day = Number(entry?.day);
  const period = Number(entry?.period);
  if (!Number.isInteger(day) || day < 0 || day >= DAY_LABELS.length) return;
  if (!Number.isInteger(period) || period < 0) return;
  const slotKey = `${day}:${period}`;
  row.slots.add(slotKey);
  if (!row.slotDetails.has(slotKey)) {
    row.slotDetails.set(slotKey, {
      day,
      period,
      subjects: new Set(),
      classKeys: new Set(),
      entryIds: new Set(),
    });
  }
  const detail = row.slotDetails.get(slotKey);
  cards.map(cardSubject).filter(Boolean).forEach(subject => detail.subjects.add(subject));
  classKeysFromEntry(entry).forEach(classKey => detail.classKeys.add(classKey));
  if (clean(entry?.id)) detail.entryIds.add(clean(entry.id));
}

function modeLabel(mode = "off") {
  if (mode === "hard") return "강제";
  if (mode === "soft") return "유연";
  return "끔";
}

function limitViolation(actual, limit, mode) {
  if (mode === "off" || !(limit > 0) || actual <= limit) return null;
  return { mode, actual, limit, overBy: actual - limit };
}

export function buildTeacherStatistics({
  entries = [],
  ttcards = [],
  teachers = [],
  teacherConstraints = {},
  teacherConstraintsById = {},
  constraintPolicy = {},
  periodCount = 7,
} = {}) {
  const registry = makeTeacherRegistry(teachers);
  const cardById = new Map(asArray(ttcards).map(card => [clean(card?.id), card]).filter(([id]) => id));
  const modes = policyModes(constraintPolicy);
  let unresolvedCardCount = 0;

  asArray(entries).forEach(entry => {
    const cards = cardIdsFromEntry(entry).map(id => cardById.get(id)).filter(Boolean);
    const refs = [];
    cards.forEach(card => refs.push(...teacherRefsFromCard(card, registry)));
    if (!cards.length && cardIdsFromEntry(entry).length) unresolvedCardCount += 1;
    if (!refs.length) refs.push(...teacherRefsFromEntry(entry, registry));

    const usedKeys = new Set();
    refs.forEach(ref => {
      const row = registry.ensure(ref);
      if (usedKeys.has(row.key)) return;
      usedKeys.add(row.key);
      addTeacherSlot(row, entry, cards);
    });
  });

  const rows = [...registry.rows.values()].map(row => {
    const constraint = resolveConstraint(row, teacherConstraintsById, teacherConstraints);
    const dayPeriods = DAY_LABELS.map((_, day) => [...row.slots]
      .map(key => key.split(":").map(Number))
      .filter(([slotDay, period]) => slotDay === day && Number.isInteger(period) && period < Math.max(1, Number(periodCount) || 7))
      .map(([, period]) => period)
      .sort((a, b) => a - b));
    const daily = dayPeriods.map((periods, day) => ({
      day,
      label: DAY_LABELS[day],
      count: periods.length,
      maxConsecutive: longestConsecutive(periods),
      periods,
    }));
    const total = daily.reduce((sum, item) => sum + item.count, 0);
    const maxPerDay = Math.max(0, ...daily.map(item => item.count));
    const maxConsecutive = Math.max(0, ...daily.map(item => item.maxConsecutive));
    const violations = [
      limitViolation(maxPerDay, constraint.maxPerDay, modes.teacherMaxPerDay),
      limitViolation(maxConsecutive, constraint.maxConsecutive, modes.teacherMaxConsecutive),
      limitViolation(total, constraint.maxPerWeek, modes.teacherMaxPerWeek),
    ].filter(Boolean);
    const hardViolations = violations.filter(item => item.mode === "hard");
    const softViolations = violations.filter(item => item.mode === "soft");
    const status = hardViolations.length ? "hard" : softViolations.length ? "soft" : "ok";
    const slotDetails = [...row.slotDetails.values()]
      .sort((a, b) => (a.day - b.day) || (a.period - b.period))
      .map(detail => ({
        day: detail.day,
        period: detail.period,
        subjects: [...detail.subjects].sort((a, b) => a.localeCompare(b, "ko")),
        classKeys: [...detail.classKeys].sort(),
        entryIds: [...detail.entryIds].sort(),
      }));
    return {
      key: row.key,
      teacherId: row.id,
      name: row.name,
      identitySource: row.source,
      total,
      daily,
      maxPerDay,
      maxConsecutive,
      constraint,
      policyModes: modes,
      violations,
      hardViolationCount: hardViolations.length,
      softViolationCount: softViolations.length,
      status,
      slotDetails,
    };
  }).sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric: true }));

  return {
    schemaVersion: "r379-teacher-statistics-v1",
    generatedAt: new Date().toISOString(),
    periodCount: Math.max(1, Number(periodCount) || 7),
    teacherCount: rows.length,
    registeredTeacherCount: asArray(teachers).length,
    referencedTeacherCount: rows.filter(row => row.total > 0).length,
    totalTeacherPeriods: rows.reduce((sum, row) => sum + row.total, 0),
    hardViolationTeacherCount: rows.filter(row => row.hardViolationCount > 0).length,
    softViolationTeacherCount: rows.filter(row => row.softViolationCount > 0).length,
    unresolvedCardCount,
    policyModes: modes,
    rows,
  };
}

const STYLE_ID = "ttTeacherStatisticsStyleR379";
function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.tt-teacher-stats-backdrop{position:fixed;inset:0;z-index:2147483600;background:rgba(15,23,42,.62);display:flex;align-items:center;justify-content:center;padding:18px}
.tt-teacher-stats-dialog{width:min(1500px,98vw);height:min(900px,94vh);background:#fff;border-radius:14px;box-shadow:0 28px 80px rgba(15,23,42,.35);display:flex;flex-direction:column;overflow:hidden;color:#0f172a;font-family:Arial,"Malgun Gothic",sans-serif}
.tt-teacher-stats-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 18px;border-bottom:1px solid #e2e8f0;background:#f8fafc}
.tt-teacher-stats-head h2{margin:0;font-size:20px}.tt-teacher-stats-head p{margin:5px 0 0;color:#64748b;font-size:12px}
.tt-teacher-stats-close{border:0;background:#e2e8f0;border-radius:8px;width:34px;height:34px;font-size:20px;cursor:pointer}
.tt-teacher-stats-summary{display:grid;grid-template-columns:repeat(5,minmax(130px,1fr));gap:8px;padding:12px 18px;border-bottom:1px solid #e2e8f0}
.tt-teacher-stats-card{border:1px solid #e2e8f0;border-radius:10px;padding:9px 11px;background:#fff}.tt-teacher-stats-card b{display:block;font-size:18px}.tt-teacher-stats-card span{font-size:11px;color:#64748b}
.tt-teacher-stats-tools{display:flex;align-items:center;gap:8px;padding:10px 18px;border-bottom:1px solid #e2e8f0;flex-wrap:wrap}
.tt-teacher-stats-tools input,.tt-teacher-stats-tools select{height:32px;border:1px solid #cbd5e1;border-radius:7px;padding:0 9px;font-size:12px}.tt-teacher-stats-tools input{min-width:220px}
.tt-teacher-stats-tools button{height:32px;border:1px solid #2563eb;background:#eff6ff;color:#1d4ed8;border-radius:7px;padding:0 11px;font-weight:700;cursor:pointer}.tt-teacher-stats-tools small{margin-left:auto;color:#64748b}
.tt-teacher-stats-main{display:grid;grid-template-rows:minmax(250px,1fr) auto;min-height:0;flex:1}
.tt-teacher-stats-table-wrap{overflow:auto;min-height:0}.tt-teacher-stats-table{width:100%;border-collapse:separate;border-spacing:0;font-size:12px;white-space:nowrap}
.tt-teacher-stats-table th{position:sticky;top:0;z-index:2;background:#e2e8f0;border-bottom:1px solid #cbd5e1;padding:8px 7px;text-align:center}.tt-teacher-stats-table td{border-bottom:1px solid #e2e8f0;padding:7px;text-align:center}
.tt-teacher-stats-table td:first-child,.tt-teacher-stats-table th:first-child{text-align:left;position:sticky;left:0;z-index:1;background:#fff}.tt-teacher-stats-table th:first-child{z-index:3;background:#e2e8f0}
.tt-teacher-stats-row{cursor:pointer}.tt-teacher-stats-row:hover td{background:#eff6ff}.tt-teacher-stats-row.selected td{background:#dbeafe}.tt-teacher-stats-row.selected td:first-child{background:#dbeafe}
.tt-teacher-stats-row.status-hard td:last-child{color:#b91c1c;font-weight:800}.tt-teacher-stats-row.status-soft td:last-child{color:#b45309;font-weight:800}.tt-teacher-stats-row.status-ok td:last-child{color:#047857;font-weight:800}
.tt-teacher-stats-day b{font-size:13px}.tt-teacher-stats-day small{display:block;color:#64748b;margin-top:2px}.tt-teacher-stats-detail{border-top:1px solid #cbd5e1;background:#f8fafc;padding:12px 18px;max-height:250px;overflow:auto}
.tt-teacher-stats-detail h3{margin:0 0 8px;font-size:15px}.tt-teacher-stats-detail-grid{display:grid;grid-template-columns:repeat(5,minmax(150px,1fr));gap:8px}.tt-teacher-stats-detail-day{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:8px}.tt-teacher-stats-detail-day b{display:block;margin-bottom:4px}.tt-teacher-stats-detail-day div{font-size:11px;color:#475569;line-height:1.5}
.tt-teacher-stats-empty{text-align:center!important;color:#64748b;padding:30px!important}
@media(max-width:900px){.tt-teacher-stats-summary{grid-template-columns:repeat(2,minmax(130px,1fr))}.tt-teacher-stats-detail-grid{grid-template-columns:1fr}.tt-teacher-stats-tools small{width:100%;margin-left:0}}
`;
  document.head.appendChild(style);
}

function statusLabel(row) {
  if (row.status === "hard") return "강제 초과";
  if (row.status === "soft") return "유연 초과";
  return "정상";
}

function dayTitle(day = {}) {
  const periods = day.periods.map(period => `${period + 1}교시`).join(", ") || "수업 없음";
  return `${day.label}요일 · ${day.count}시수 · 최대연속 ${day.maxConsecutive} · ${periods}`;
}

function limitSummary(row) {
  const c = row.constraint;
  const m = row.policyModes;
  const week = c.maxPerWeek > 0 ? c.maxPerWeek : "-";
  return `일 ${c.maxPerDay}(${modeLabel(m.teacherMaxPerDay)}) · 연 ${c.maxConsecutive}(${modeLabel(m.teacherMaxConsecutive)}) · 주 ${week}(${modeLabel(m.teacherMaxPerWeek)})`;
}

function detailHtml(row) {
  if (!row) return `<div class="tt-teacher-stats-empty">교사 행을 선택하면 실제 수업 교시와 제한값을 확인할 수 있습니다.</div>`;
  const byDay = DAY_LABELS.map((label, day) => {
    const daily = row.daily[day];
    const slots = row.slotDetails.filter(slot => slot.day === day);
    const lines = slots.length ? slots.map(slot => {
      const subject = escapeHtml(slot.subjects.join(", ") || "과목명 없음");
      const classes = escapeHtml(slot.classKeys.join(", ") || "대상 미표시");
      return `${slot.period + 1}교시 · ${subject} · ${classes}`;
    }).join("<br>") : "수업 없음";
    return `<div class="tt-teacher-stats-detail-day"><b>${label} · ${daily.count}시수 / 최대연속 ${daily.maxConsecutive}</b><div>${lines}</div></div>`;
  }).join("");
  const identityNote = row.identitySource === "teacher-table" ? "" : " · 교사 DB 외 시간표 참조";
  return `
    <h3>${escapeHtml(row.name)} · 전체 ${row.total}시수 · 일일최대 ${row.maxPerDay} · 주간 최대연속 ${row.maxConsecutive}${escapeHtml(identityNote)}</h3>
    <div style="font-size:11px;color:#475569;margin-bottom:8px">제한: ${escapeHtml(limitSummary(row))}</div>
    <div class="tt-teacher-stats-detail-grid">${byDay}</div>`;
}

export function openTeacherStatisticsDialog(context = {}) {
  if (typeof document === "undefined") return null;
  ensureStyle();
  document.getElementById("ttTeacherStatisticsBackdrop")?.remove();

  let report = buildTeacherStatistics({
    entries: typeof context.getEntries === "function" ? context.getEntries() : context.entries,
    ttcards: typeof context.getTtCards === "function" ? context.getTtCards() : context.ttcards,
    teachers: typeof context.getTeachers === "function" ? context.getTeachers() : context.teachers,
    teacherConstraints: typeof context.getTeacherConstraints === "function" ? context.getTeacherConstraints() : context.teacherConstraints,
    teacherConstraintsById: typeof context.getTeacherConstraintsById === "function" ? context.getTeacherConstraintsById() : context.teacherConstraintsById,
    constraintPolicy: typeof context.getConstraintPolicy === "function" ? context.getConstraintPolicy() : context.constraintPolicy,
    periodCount: typeof context.getPeriodCount === "function" ? context.getPeriodCount() : context.periodCount,
  });

  const backdrop = document.createElement("div");
  backdrop.id = "ttTeacherStatisticsBackdrop";
  backdrop.className = "tt-teacher-stats-backdrop";
  backdrop.innerHTML = `
    <section class="tt-teacher-stats-dialog" role="dialog" aria-modal="true" aria-labelledby="ttTeacherStatisticsTitle">
      <header class="tt-teacher-stats-head">
        <div><h2 id="ttTeacherStatisticsTitle">교사 통계</h2><p>teacherId + 요일 + 교시 기준으로 묶음수업 중복을 제거한 실제 점유 시수입니다.</p></div>
        <button class="tt-teacher-stats-close" type="button" data-action="close" aria-label="닫기">×</button>
      </header>
      <div class="tt-teacher-stats-summary" data-role="summary"></div>
      <div class="tt-teacher-stats-tools">
        <input type="search" data-role="search" placeholder="교사 이름 검색">
        <select data-role="status"><option value="all">전체 상태</option><option value="ok">정상</option><option value="hard">강제 초과</option><option value="soft">유연 초과</option></select>
        <select data-role="sort"><option value="name">이름순</option><option value="total-desc">전체 시수 많은 순</option><option value="maxday-desc">일일 최대 많은 순</option><option value="consecutive-desc">연속수업 많은 순</option></select>
        <button type="button" data-action="refresh">새로고침</button>
        <small>요일 칸: 전체 시수 / 최대 연속</small>
      </div>
      <div class="tt-teacher-stats-main">
        <div class="tt-teacher-stats-table-wrap"><table class="tt-teacher-stats-table"><thead><tr><th>교사</th><th>전체</th>${DAY_LABELS.map(label => `<th>${label}<br><small>시수/연속</small></th>`).join("")}<th>일일최대</th><th>주간최대연속</th><th>적용 제한</th><th>상태</th></tr></thead><tbody data-role="body"></tbody></table></div>
        <div class="tt-teacher-stats-detail" data-role="detail"></div>
      </div>
    </section>`;
  document.body.appendChild(backdrop);

  const summaryEl = backdrop.querySelector('[data-role="summary"]');
  const bodyEl = backdrop.querySelector('[data-role="body"]');
  const detailEl = backdrop.querySelector('[data-role="detail"]');
  const searchEl = backdrop.querySelector('[data-role="search"]');
  const statusEl = backdrop.querySelector('[data-role="status"]');
  const sortEl = backdrop.querySelector('[data-role="sort"]');
  let selectedKey = report.rows.find(row => row.total > 0)?.key || report.rows[0]?.key || "";

  const rebuild = () => {
    report = buildTeacherStatistics({
      entries: typeof context.getEntries === "function" ? context.getEntries() : context.entries,
      ttcards: typeof context.getTtCards === "function" ? context.getTtCards() : context.ttcards,
      teachers: typeof context.getTeachers === "function" ? context.getTeachers() : context.teachers,
      teacherConstraints: typeof context.getTeacherConstraints === "function" ? context.getTeacherConstraints() : context.teacherConstraints,
      teacherConstraintsById: typeof context.getTeacherConstraintsById === "function" ? context.getTeacherConstraintsById() : context.teacherConstraintsById,
      constraintPolicy: typeof context.getConstraintPolicy === "function" ? context.getConstraintPolicy() : context.constraintPolicy,
      periodCount: typeof context.getPeriodCount === "function" ? context.getPeriodCount() : context.periodCount,
    });
    if (!report.rows.some(row => row.key === selectedKey)) selectedKey = report.rows[0]?.key || "";
  };

  const render = () => {
    summaryEl.innerHTML = [
      [report.teacherCount, "표시 교사"],
      [report.referencedTeacherCount, "수업 배정 교사"],
      [report.totalTeacherPeriods, "전체 교사 점유시수"],
      [report.hardViolationTeacherCount, "강제 제한 초과 교사"],
      [report.softViolationTeacherCount, "유연 제한 초과 교사"],
    ].map(([value, label]) => `<div class="tt-teacher-stats-card"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`).join("");

    const query = clean(searchEl.value).toLowerCase();
    const status = statusEl.value;
    const sort = sortEl.value;
    const rows = report.rows.filter(row => (!query || row.name.toLowerCase().includes(query)) && (status === "all" || row.status === status));
    rows.sort((a, b) => {
      if (sort === "total-desc") return (b.total - a.total) || a.name.localeCompare(b.name, "ko");
      if (sort === "maxday-desc") return (b.maxPerDay - a.maxPerDay) || (b.total - a.total) || a.name.localeCompare(b.name, "ko");
      if (sort === "consecutive-desc") return (b.maxConsecutive - a.maxConsecutive) || (b.total - a.total) || a.name.localeCompare(b.name, "ko");
      return a.name.localeCompare(b.name, "ko", { numeric: true });
    });

    bodyEl.innerHTML = rows.length ? rows.map(row => `
      <tr class="tt-teacher-stats-row status-${row.status}${row.key === selectedKey ? " selected" : ""}" data-key="${escapeHtml(row.key)}" tabindex="0">
        <td><b>${escapeHtml(row.name)}</b>${row.identitySource === "teacher-table" ? "" : " <small>⚠</small>"}</td>
        <td><b>${row.total}</b></td>
        ${row.daily.map(day => `<td class="tt-teacher-stats-day" title="${escapeHtml(dayTitle(day))}"><b>${day.count}</b><small>/ ${day.maxConsecutive}</small></td>`).join("")}
        <td>${row.maxPerDay}</td><td>${row.maxConsecutive}</td><td>${escapeHtml(limitSummary(row))}</td><td>${statusLabel(row)}</td>
      </tr>`).join("") : `<tr><td class="tt-teacher-stats-empty" colspan="12">조건에 맞는 교사가 없습니다.</td></tr>`;
    const selected = report.rows.find(row => row.key === selectedKey) || null;
    detailEl.innerHTML = detailHtml(selected);
  };

  const close = () => {
    document.removeEventListener("keydown", onKeyDown, true);
    backdrop.remove();
  };
  const onKeyDown = event => {
    if (event.key === "Escape") close();
  };
  document.addEventListener("keydown", onKeyDown, true);

  backdrop.addEventListener("click", event => {
    if (event.target === backdrop || event.target.closest('[data-action="close"]')) close();
    const row = event.target.closest(".tt-teacher-stats-row[data-key]");
    if (row) { selectedKey = row.dataset.key || ""; render(); }
    if (event.target.closest('[data-action="refresh"]')) { rebuild(); render(); }
  });
  backdrop.addEventListener("keydown", event => {
    const row = event.target.closest(".tt-teacher-stats-row[data-key]");
    if (row && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      selectedKey = row.dataset.key || "";
      render();
    }
  });
  [searchEl, statusEl, sortEl].forEach(el => el.addEventListener(el === searchEl ? "input" : "change", render));
  render();
  searchEl.focus();
  return { close, report: () => report };
}
