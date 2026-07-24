// ================================================================
// timetable-statistics.js · 교사/교실 통합 통계
// r381: 교사 통계 유지 + 교실 담당교사/고정수업/기타사용 분류
// ================================================================
import { buildTeacherStatistics } from "./timetable-teacher-statistics.js";
import { normalizeTeacherEvents, resolveTeacherEventNames, teacherEventSlots } from "./timetable-teacher-events.js?v=2026-07-24-teacher-events-r369-2";

const clean = value => String(value ?? "").trim();
const asArray = value => Array.isArray(value) ? value : [];
const unique = values => [...new Set(asArray(values).map(clean).filter(Boolean))];
const DAY_LABELS = Object.freeze(["월", "화", "수", "목", "금"]);
const STYLE_ID = "ttStatisticsStyleR381";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function splitNames(value = "") { return unique(String(value || "").split(/[,/\n]+/g)); }
function cardIds(entry = {}) { return unique([...(entry.ttcardIds || []), entry.ttcardId]); }
function cardTeachers(card = {}) {
  return { ids: unique(card.teacherIds || []), names: unique([...(card.teachers || []), ...splitNames(card.teacherName || card.teacher)]) };
}
function entryTeachers(entry = {}) {
  return { ids: unique(entry.teacherIds || []), names: unique([...(entry.teacherNames || []), ...splitNames(entry.teacherName || entry.teacher)]) };
}
function cardSubject(card = {}, entry = {}) { return clean(card.subject || card.label || card.nameKo || entry.subject || entry.label || entry.groupName || "미확인 수업"); }
function roomTeacherRefs(room = {}) {
  return {
    ids: unique([...(room.teacherIds || []), room.teacherId]),
    names: unique([...(room.teacherNames || []), room.teacherName]),
  };
}
function intersects(a = [], b = []) { const set = new Set(a); return b.some(value => set.has(value)); }
function assignedTeacherMatch(roomRefs, usageRefs) {
  if (roomRefs.ids.length && usageRefs.ids.length && intersects(roomRefs.ids, usageRefs.ids)) return true;
  const roomNames = roomRefs.names.map(name => name.toLowerCase());
  const usageNames = usageRefs.names.map(name => name.toLowerCase());
  return intersects(roomNames, usageNames);
}
function roomIdsFromEntry(entry = {}) {
  return unique([entry.roomId, ...(entry.roomIds || []), ...(entry.manualRoomIds || []), ...(entry.requiredRoomIds || [])]);
}
function roomRuleFor(card = {}, entry = {}) { return clean(card.roomRule || entry.roomRule || "teacher").toLowerCase(); }
function usageCategory(room, slot) {
  const refs = { ids: [...slot.teacherIds], names: [...slot.teacherNames] };
  if (assignedTeacherMatch(roomTeacherRefs(room), refs)) return "responsible";
  if (slot.rules.has("fixed") || slot.roomPinned || slot.pinned) return "fixedOther";
  if (slot.rules.has("homeroom")) return "homeroom";
  return "other";
}
function addCount(map, key) { map.set(key, (map.get(key) || 0) + 1); }

export function buildRoomStatistics({ entries = [], ttcards = [], rooms = [], periodCount = 7 } = {}) {
  const roomList = asArray(rooms);
  const roomById = new Map(roomList.map(room => [clean(room.id), room]).filter(([id]) => id));
  const cardById = new Map(asArray(ttcards).map(card => [clean(card.id), card]).filter(([id]) => id));
  const slotsByRoom = new Map(roomList.map(room => [clean(room.id), new Map()]));
  let unresolvedRoomReferenceCount = 0;

  const ensureRoomSlots = roomId => {
    if (!slotsByRoom.has(roomId)) slotsByRoom.set(roomId, new Map());
    return slotsByRoom.get(roomId);
  };
  const addUsage = (roomId, entry, card = null) => {
    const id = clean(roomId);
    if (!id) return;
    if (!roomById.has(id)) unresolvedRoomReferenceCount += 1;
    const day = Number(entry.day), period = Number(entry.period);
    if (!Number.isInteger(day) || day < 0 || day > 4 || !Number.isInteger(period) || period < 0 || period >= Math.max(1, Number(periodCount) || 7)) return;
    const key = `${day}:${period}`;
    const slots = ensureRoomSlots(id);
    const slot = slots.get(key) || {
      roomId: id, day, period, teacherIds: new Set(), teacherNames: new Set(), subjects: new Set(),
      rules: new Set(), entryIds: new Set(), cardIds: new Set(), roomPinned: false, pinned: false,
    };
    const refs = card ? cardTeachers(card) : entryTeachers(entry);
    refs.ids.forEach(value => slot.teacherIds.add(value));
    refs.names.forEach(value => slot.teacherNames.add(value));
    slot.subjects.add(cardSubject(card || {}, entry));
    slot.rules.add(roomRuleFor(card || {}, entry));
    clean(entry.id) && slot.entryIds.add(clean(entry.id));
    card && clean(card.id) && slot.cardIds.add(clean(card.id));
    slot.roomPinned ||= Boolean(entry.roomPinned || card?.roomPinned);
    slot.pinned ||= Boolean(entry.pinned || card?.pinned);
    slots.set(key, slot);
  };

  asArray(entries).forEach(entry => {
    const mapping = entry.roomAssignmentsByTtCardId && typeof entry.roomAssignmentsByTtCardId === "object" ? entry.roomAssignmentsByTtCardId : {};
    const mapped = Object.entries(mapping).filter(([, roomId]) => clean(roomId));
    if (mapped.length) {
      mapped.forEach(([cardId, roomId]) => addUsage(roomId, entry, cardById.get(clean(cardId)) || null));
      return;
    }
    const cards = cardIds(entry).map(id => cardById.get(id)).filter(Boolean);
    roomIdsFromEntry(entry).forEach(roomId => {
      if (cards.length === 1) addUsage(roomId, entry, cards[0]);
      else addUsage(roomId, entry, null);
    });
  });

  const allRoomIds = unique([...roomList.map(room => room.id), ...slotsByRoom.keys()]);
  const rows = allRoomIds.map(roomId => {
    const room = roomById.get(roomId) || { id: roomId, name: roomId, type: "미등록" };
    const assigned = roomTeacherRefs(room);
    const categoryCounts = { responsible: 0, fixedOther: 0, homeroom: 0, other: 0 };
    const fixedSubjectCounts = new Map();
    const responsibleSubjectCounts = new Map();
    const otherSubjectCounts = new Map();
    const slotDetails = [...(slotsByRoom.get(roomId)?.values() || [])]
      .sort((a, b) => (a.day - b.day) || (a.period - b.period))
      .map(slot => {
        const category = usageCategory(room, slot);
        categoryCounts[category] += 1;
        const subjects = [...slot.subjects].sort((a, b) => a.localeCompare(b, "ko"));
        subjects.forEach(subject => {
          if (category === "responsible") addCount(responsibleSubjectCounts, subject);
          else if (category === "fixedOther" || category === "homeroom") addCount(fixedSubjectCounts, subject);
          else addCount(otherSubjectCounts, subject);
        });
        return { day: slot.day, period: slot.period, category, subjects, teachers: [...slot.teacherNames].sort((a,b)=>a.localeCompare(b,"ko")) };
      });
    const total = slotDetails.length;
    const utilization = Math.round((total / Math.max(1, 5 * (Number(periodCount) || 7))) * 100);
    return {
      roomId, name: clean(room.name) || roomId, type: clean(room.type) || "일반",
      assignedTeacherCount: Math.max(assigned.ids.length, assigned.names.length),
      assignedTeacherNames: assigned.names,
      responsibleCount: categoryCounts.responsible,
      fixedOtherCount: categoryCounts.fixedOther,
      homeroomCount: categoryCounts.homeroom,
      otherCount: categoryCounts.other,
      total, utilization,
      fixedSubjectCounts: [...fixedSubjectCounts.entries()].sort((a,b)=>(b[1]-a[1])||a[0].localeCompare(b[0],"ko")),
      responsibleSubjectCounts: [...responsibleSubjectCounts.entries()].sort((a,b)=>(b[1]-a[1])||a[0].localeCompare(b[0],"ko")),
      otherSubjectCounts: [...otherSubjectCounts.entries()].sort((a,b)=>(b[1]-a[1])||a[0].localeCompare(b[0],"ko")),
      slotDetails,
    };
  }).sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric: true }));

  return {
    schemaVersion: "r381-room-statistics-v1", generatedAt: new Date().toISOString(), periodCount,
    roomCount: rows.length, usedRoomCount: rows.filter(row => row.total > 0).length,
    totalResponsibleUses: rows.reduce((sum,row)=>sum+row.responsibleCount,0),
    totalOtherFixedUses: rows.reduce((sum,row)=>sum+row.fixedOtherCount+row.homeroomCount,0),
    totalOtherUses: rows.reduce((sum,row)=>sum+row.otherCount,0),
    unresolvedRoomReferenceCount, rows,
  };
}

function buildTeacherEventStatistics({ teacherEvents = [], teachers = [], periodCount = 7 } = {}) {
  const byName = new Map();
  let totalPeriods = 0;
  normalizeTeacherEvents(teacherEvents, { periodCount }).filter(event => event.active).forEach(event => {
    const slots = teacherEventSlots(event, periodCount);
    resolveTeacherEventNames(event, teachers).forEach(name => {
      const row = byName.get(name) || { count: 0, details: [] };
      row.count += slots.length;
      slots.forEach(slot => row.details.push({ title: event.title, note: event.note, day: slot.day, period: slot.period }));
      byName.set(name, row);
      totalPeriods += slots.length;
    });
  });
  byName.forEach(row => row.details.sort((a, b) => (a.day - b.day) || (a.period - b.period) || a.title.localeCompare(b.title, "ko")));
  return { byName, totalPeriods };
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.tt-stat-backdrop{position:fixed;inset:0;z-index:2147483600;background:rgba(15,23,42,.62);display:flex;align-items:center;justify-content:center;padding:18px}
.tt-stat-dialog{width:min(1540px,98vw);height:min(920px,94vh);background:#fff;border-radius:14px;box-shadow:0 28px 80px rgba(15,23,42,.35);display:flex;flex-direction:column;overflow:hidden;color:#0f172a;font-family:Arial,"Malgun Gothic",sans-serif}
.tt-stat-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px 10px;border-bottom:1px solid #e2e8f0;background:#f8fafc}.tt-stat-head h2{margin:0;font-size:20px}.tt-stat-close{border:0;background:#e2e8f0;border-radius:8px;width:34px;height:34px;font-size:20px;cursor:pointer}
.tt-stat-tabs{display:flex;gap:4px;padding:8px 18px;border-bottom:1px solid #e2e8f0}.tt-stat-tab{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:7px 18px;font-weight:800;cursor:pointer}.tt-stat-tab.active{background:#2563eb;color:#fff;border-color:#2563eb}
.tt-stat-summary{display:grid;grid-template-columns:repeat(5,minmax(130px,1fr));gap:8px;padding:10px 18px;border-bottom:1px solid #e2e8f0}.tt-stat-card{border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px;background:#fff}.tt-stat-card b{display:block;font-size:18px}.tt-stat-card span{font-size:11px;color:#64748b}
.tt-stat-tools{display:flex;align-items:center;gap:8px;padding:9px 18px;border-bottom:1px solid #e2e8f0;flex-wrap:wrap}.tt-stat-tools input,.tt-stat-tools select{height:32px;border:1px solid #cbd5e1;border-radius:7px;padding:0 9px;font-size:12px}.tt-stat-tools input{min-width:220px}.tt-stat-tools button{height:32px;border:1px solid #2563eb;background:#eff6ff;color:#1d4ed8;border-radius:7px;padding:0 11px;font-weight:700;cursor:pointer}.tt-stat-tools small{margin-left:auto;color:#64748b}
.tt-stat-main{display:grid;grid-template-rows:minmax(260px,1fr) minmax(120px,260px);min-height:0;flex:1}.tt-stat-table-wrap{overflow:auto;min-height:0}.tt-stat-table{width:100%;border-collapse:separate;border-spacing:0;font-size:12px;white-space:nowrap}.tt-stat-table th{position:sticky;top:0;z-index:2;background:#e2e8f0;border-bottom:1px solid #cbd5e1;padding:8px 7px;text-align:center}.tt-stat-table td{border-bottom:1px solid #e2e8f0;padding:7px;text-align:center}.tt-stat-table td:first-child,.tt-stat-table th:first-child{text-align:left;position:sticky;left:0;z-index:1;background:#fff}.tt-stat-table th:first-child{z-index:3;background:#e2e8f0}.tt-stat-row{cursor:pointer}.tt-stat-row:hover td,.tt-stat-row.selected td{background:#eff6ff}.tt-stat-row.selected td:first-child{background:#eff6ff}
.tt-stat-detail{border-top:1px solid #cbd5e1;background:#f8fafc;padding:12px 18px;overflow:auto}.tt-stat-detail h3{margin:0 0 8px;font-size:15px}.tt-stat-detail-grid{display:grid;grid-template-columns:repeat(3,minmax(180px,1fr));gap:8px}.tt-stat-detail-card{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:8px}.tt-stat-detail-card b{display:block;margin-bottom:5px}.tt-stat-detail-card div{font-size:11px;color:#475569;line-height:1.55}.tt-stat-empty{text-align:center!important;color:#64748b;padding:30px!important}
@media(max-width:900px){.tt-stat-summary{grid-template-columns:repeat(2,minmax(130px,1fr))}.tt-stat-detail-grid{grid-template-columns:1fr}.tt-stat-tools small{width:100%;margin-left:0}}
`;
  document.head.appendChild(style);
}
function countLines(items) { return items.length ? items.map(([name,count])=>`${escapeHtml(name)} <b>${count}회</b>`).join("<br>") : "없음"; }
function teacherDetail(row) {
  if (!row) return `<div class="tt-stat-empty">교사 행을 선택하면 실제 수업 교시와 제한값을 확인할 수 있습니다.</div>`;
  const days = row.daily.map(day => {
    const details = row.slotDetails.filter(item => item.day === day.day).map(item => `${item.period + 1}교시 · ${item.subjects.join(", ") || "수업"}`).join("<br>") || "수업 없음";
    return `<div class="tt-stat-detail-card"><b>${day.label} · ${day.count}시수 / 최대연속 ${day.maxConsecutive}</b><div>${escapeHtml(details).replaceAll("&lt;br&gt;","<br>")}</div></div>`;
  }).join("");
  const eventDetails = asArray(row.teacherEventDetails).map(item => `${DAY_LABELS[item.day]} ${item.period + 1}교시 · ${item.title}${item.note ? ` (${item.note})` : ""}`).join("<br>") || "등록 일정 없음";
  return `<h3>${escapeHtml(row.name)} · 수업 ${row.total}시수 · 교사 일정 ${row.teacherEventPeriods || 0}시수</h3><div class="tt-stat-detail-grid">${days}<div class="tt-stat-detail-card" style="grid-column:1/-1"><b>교사 일정</b><div>${escapeHtml(eventDetails).replaceAll("&lt;br&gt;","<br>")}</div></div></div>`;
}
function roomDetail(row) {
  if (!row) return `<div class="tt-stat-empty">교실 행을 선택하면 담당교사와 고정수업 분류를 확인할 수 있습니다.</div>`;
  const slots = row.slotDetails.map(item => `${DAY_LABELS[item.day]} ${item.period + 1}교시 · ${item.subjects.join(", ")} · ${item.teachers.join(", ") || "교사 없음"}`).join("<br>") || "사용 없음";
  return `<h3>${escapeHtml(row.name)} · 총 ${row.total}회 사용 · 가동률 ${row.utilization}%</h3><div class="tt-stat-detail-grid">
    <div class="tt-stat-detail-card"><b>담당교사</b><div>${escapeHtml(row.assignedTeacherNames.join(", ") || "미지정")}<br>담당교사 수업 ${row.responsibleCount}회<br>${countLines(row.responsibleSubjectCounts)}</div></div>
    <div class="tt-stat-detail-card"><b>다른 고정 수업 분류</b><div>직접 고정 ${row.fixedOtherCount}회 · 홈룸 ${row.homeroomCount}회<br>${countLines(row.fixedSubjectCounts)}</div></div>
    <div class="tt-stat-detail-card"><b>기타/자동배정 수업</b><div>${row.otherCount}회<br>${countLines(row.otherSubjectCounts)}</div></div>
    <div class="tt-stat-detail-card" style="grid-column:1/-1"><b>요일·교시별 사용</b><div>${slots}</div></div>
  </div>`;
}

export function openStatisticsDialog(context = {}) {
  ensureStyle();
  document.getElementById("ttStatisticsBackdrop")?.remove();
  let activeTab = "teacher";
  let selectedTeacher = "", selectedRoom = "";
  let teacherReport, roomReport;
  const rebuild = () => {
    const teacherList = context.getTeachers?.() || context.teachers || [];
    const periodCount = context.getPeriodCount?.() || context.periodCount || 7;
    teacherReport = buildTeacherStatistics({
      entries: context.getEntries?.() || context.entries || [], ttcards: context.getTtCards?.() || context.ttcards || [],
      teachers: teacherList, teacherConstraints: context.getTeacherConstraints?.() || context.teacherConstraints || {},
      teacherConstraintsById: context.getTeacherConstraintsById?.() || context.teacherConstraintsById || {}, constraintPolicy: context.getConstraintPolicy?.() || context.constraintPolicy || {},
      periodCount,
    });
    const eventStats = buildTeacherEventStatistics({ teacherEvents: context.getTeacherEvents?.() || context.teacherEvents || [], teachers: teacherList, periodCount });
    teacherReport.rows = teacherReport.rows.map(row => {
      const stat = eventStats.byName.get(row.name) || { count: 0, details: [] };
      return { ...row, teacherEventPeriods: stat.count, teacherEventDetails: stat.details };
    });
    teacherReport.totalTeacherEventPeriods = eventStats.totalPeriods;
    roomReport = buildRoomStatistics({ entries: context.getEntries?.() || context.entries || [], ttcards: context.getTtCards?.() || context.ttcards || [], rooms: context.getRooms?.() || context.rooms || [], periodCount: context.getPeriodCount?.() || context.periodCount || 7 });
    if (!teacherReport.rows.some(row => row.key === selectedTeacher)) selectedTeacher = teacherReport.rows.find(row=>row.total>0)?.key || teacherReport.rows[0]?.key || "";
    if (!roomReport.rows.some(row => row.roomId === selectedRoom)) selectedRoom = roomReport.rows.find(row=>row.total>0)?.roomId || roomReport.rows[0]?.roomId || "";
  };
  rebuild();
  const backdrop = document.createElement("div"); backdrop.id = "ttStatisticsBackdrop"; backdrop.className = "tt-stat-backdrop";
  backdrop.innerHTML = `<section class="tt-stat-dialog" role="dialog" aria-modal="true"><header class="tt-stat-head"><h2>통계</h2><button class="tt-stat-close" data-action="close" aria-label="닫기">×</button></header>
    <div class="tt-stat-tabs"><button class="tt-stat-tab active" data-tab="teacher">교사 통계</button><button class="tt-stat-tab" data-tab="room">교실 통계</button></div>
    <div class="tt-stat-summary" data-role="summary"></div><div class="tt-stat-tools"><input data-role="search" placeholder="이름 검색"><select data-role="sort"></select><button data-action="refresh">현재 시간표 기준 새로고침</button><small data-role="note"></small></div>
    <div class="tt-stat-main"><div class="tt-stat-table-wrap"><table class="tt-stat-table"><thead data-role="head"></thead><tbody data-role="body"></tbody></table></div><div class="tt-stat-detail" data-role="detail"></div></div></section>`;
  document.body.appendChild(backdrop);
  const summary = backdrop.querySelector('[data-role="summary"]'), search = backdrop.querySelector('[data-role="search"]'), sort = backdrop.querySelector('[data-role="sort"]'), head = backdrop.querySelector('[data-role="head"]'), body = backdrop.querySelector('[data-role="body"]'), detail = backdrop.querySelector('[data-role="detail"]'), note = backdrop.querySelector('[data-role="note"]');
  const render = () => {
    backdrop.querySelectorAll('[data-tab]').forEach(button=>button.classList.toggle("active",button.dataset.tab===activeTab));
    const query = clean(search.value).toLowerCase();
    if (activeTab === "teacher") {
      const previousSort = sort.value || "name";
      search.placeholder = "교사 이름 검색"; sort.innerHTML = `<option value="name">이름순</option><option value="total">전체 시수 많은 순</option><option value="maxday">일일 최대 많은 순</option>`;
      sort.value = ["name","total","maxday"].includes(previousSort) ? previousSort : "name";
      const rows = teacherReport.rows.filter(row=>!query||row.name.toLowerCase().includes(query));
      rows.sort((a,b)=>sort.value==="total"?(b.total-a.total)||a.name.localeCompare(b.name,"ko"):sort.value==="maxday"?(b.maxPerDay-a.maxPerDay)||a.name.localeCompare(b.name,"ko"):a.name.localeCompare(b.name,"ko",{numeric:true}));
      summary.innerHTML = [[teacherReport.teacherCount,"표시 교사"],[teacherReport.totalTeacherPeriods,"전체 수업 시수"],[teacherReport.totalTeacherEventPeriods || 0,"교사 일정 시수"],[teacherReport.hardViolationTeacherCount,"강제 제한 초과"],[teacherReport.softViolationTeacherCount,"유연 제한 초과"]].map(([v,l])=>`<div class="tt-stat-card"><b>${v}</b><span>${l}</span></div>`).join("");
      head.innerHTML = `<tr><th>교사</th><th>수업</th><th>일정</th>${DAY_LABELS.map(label=>`<th>${label}<br><small>시수/연속</small></th>`).join("")}<th>일일최대</th><th>최대연속</th><th>상태</th></tr>`;
      body.innerHTML = rows.length?rows.map(row=>`<tr class="tt-stat-row${selectedTeacher===row.key?" selected":""}" data-key="${escapeHtml(row.key)}"><td><b>${escapeHtml(row.name)}</b></td><td>${row.total}</td><td>${row.teacherEventPeriods || 0}</td>${row.daily.map(day=>`<td>${day.count} / ${day.maxConsecutive}</td>`).join("")}<td>${row.maxPerDay}</td><td>${row.maxConsecutive}</td><td>${row.status==="hard"?"강제 초과":row.status==="soft"?"유연 초과":"정상"}</td></tr>`).join(""):`<tr><td class="tt-stat-empty" colspan="12">교사가 없습니다.</td></tr>`;
      detail.innerHTML = teacherDetail(teacherReport.rows.find(row=>row.key===selectedTeacher)); note.textContent = "수업 시수와 교사 일정 시수를 분리 표시";
    } else {
      const previousSort = sort.value || "name";
      search.placeholder = "교실 이름 검색"; sort.innerHTML = `<option value="name">교실명순</option><option value="total">총 사용 많은 순</option><option value="responsible">담당교사 수업 많은 순</option><option value="fixed">다른 고정 수업 많은 순</option>`;
      sort.value = ["name","total","responsible","fixed"].includes(previousSort) ? previousSort : "name";
      const rows = roomReport.rows.filter(row=>!query||row.name.toLowerCase().includes(query));
      rows.sort((a,b)=>sort.value==="total"?(b.total-a.total)||a.name.localeCompare(b.name,"ko"):sort.value==="responsible"?(b.responsibleCount-a.responsibleCount)||a.name.localeCompare(b.name,"ko"):sort.value==="fixed"?((b.fixedOtherCount+b.homeroomCount)-(a.fixedOtherCount+a.homeroomCount))||a.name.localeCompare(b.name,"ko"):a.name.localeCompare(b.name,"ko",{numeric:true}));
      summary.innerHTML = [[roomReport.roomCount,"전체 교실"],[roomReport.usedRoomCount,"사용 중 교실"],[roomReport.totalResponsibleUses,"담당교사 수업 합계"],[roomReport.totalOtherFixedUses,"다른 고정 수업 합계"],[roomReport.totalOtherUses,"기타 수업 합계"]].map(([v,l])=>`<div class="tt-stat-card"><b>${v}</b><span>${l}</span></div>`).join("");
      head.innerHTML = `<tr><th>교실</th><th>유형</th><th>담당교사 수</th><th>담당교사</th><th>담당교사 수업</th><th>다른 직접고정</th><th>홈룸 고정</th><th>기타/자동</th><th>총 사용</th><th>가동률</th></tr>`;
      body.innerHTML = rows.length?rows.map(row=>`<tr class="tt-stat-row${selectedRoom===row.roomId?" selected":""}" data-key="${escapeHtml(row.roomId)}"><td><b>${escapeHtml(row.name)}</b></td><td>${escapeHtml(row.type)}</td><td>${row.assignedTeacherCount}명</td><td>${escapeHtml(row.assignedTeacherNames.join(", ")||"미지정")}</td><td>${row.responsibleCount}회</td><td>${row.fixedOtherCount}회</td><td>${row.homeroomCount}회</td><td>${row.otherCount}회</td><td><b>${row.total}회</b></td><td>${row.utilization}%</td></tr>`).join(""):`<tr><td class="tt-stat-empty" colspan="10">교실이 없습니다.</td></tr>`;
      detail.innerHTML = roomDetail(roomReport.rows.find(row=>row.roomId===selectedRoom)); note.textContent = "교실ID + 요일 + 교시 기준 중복 제거";
    }
  };
  const close=()=>{document.removeEventListener("keydown",onKey,true);backdrop.remove();}; const onKey=e=>{if(e.key==="Escape")close();}; document.addEventListener("keydown",onKey,true);
  backdrop.addEventListener("click",event=>{if(event.target===backdrop||event.target.closest('[data-action="close"]'))return close();const tab=event.target.closest('[data-tab]');if(tab){activeTab=tab.dataset.tab;search.value="";render();return;}const row=event.target.closest('.tt-stat-row[data-key]');if(row){if(activeTab==="teacher")selectedTeacher=row.dataset.key;else selectedRoom=row.dataset.key;render();}if(event.target.closest('[data-action="refresh"]')){rebuild();render();}});
  search.addEventListener("input",render); sort.addEventListener("change",render); render(); search.focus();
  return { close, teacherReport:()=>teacherReport, roomReport:()=>roomReport };
}
