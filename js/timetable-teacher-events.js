// ================================================================
// timetable-teacher-events.js · 교사 전용 일정(미팅/회의)
// r369-2: 학생·학급·교실 점유 없이 해당 교사의 수업 배정만 차단합니다.
// ================================================================

const DAY_LABELS = Object.freeze(["월", "화", "수", "목", "금"]);
const STYLE_ID = "ttTeacherEventsStyleR369";

const clean = value => String(value ?? "").trim();
const asArray = value => Array.isArray(value) ? value : [];
const unique = values => [...new Set(asArray(values).map(clean).filter(Boolean))];

function splitNames(value = "") {
  if (Array.isArray(value)) return unique(value.flatMap(splitNames));
  return unique(String(value || "").split(/[,/\n]+/g));
}

function teacherId(teacher = {}) {
  return clean(teacher.id || teacher.teacherId || teacher.uid);
}

function teacherName(teacher = {}) {
  return clean(teacher.name || teacher.teacherName || teacher.label || teacher.displayName);
}

export function normalizeTeacherEvent(raw = {}, options = {}) {
  const periodCount = Math.max(1, Number(options.periodCount || 12) || 12);
  const day = Math.max(0, Math.min(4, Number.parseInt(raw.day, 10) || 0));
  const period = Math.max(0, Math.min(periodCount - 1, Number.parseInt(raw.period, 10) || 0));
  const durationPeriods = Math.max(1, Math.min(periodCount - period, Number.parseInt(raw.durationPeriods || raw.duration || 1, 10) || 1));
  return {
    id: clean(raw.id),
    title: clean(raw.title || raw.name || raw.label || "교사 미팅"),
    day,
    period,
    durationPeriods,
    teacherIds: unique(raw.teacherIds || raw.attendeeTeacherIds || []),
    teacherNames: unique([
      ...splitNames(raw.teacherNames || raw.attendeeTeacherNames || []),
      ...splitNames(raw.teacherName || raw.attendeeTeacherName || ""),
    ]),
    note: clean(raw.note || raw.memo),
    active: raw.active !== false,
    createdAt: clean(raw.createdAt),
    updatedAt: clean(raw.updatedAt),
  };
}

export function normalizeTeacherEvents(raw = [], options = {}) {
  const seen = new Set();
  return asArray(raw).map(item => normalizeTeacherEvent(item, options)).filter(item => {
    if (!item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return item.teacherIds.length > 0 || item.teacherNames.length > 0;
  });
}

export function resolveTeacherEventNames(event = {}, teachers = []) {
  const byId = new Map(asArray(teachers).map(item => [teacherId(item), teacherName(item)]).filter(([id, name]) => id && name));
  const ids = unique(event.teacherIds || []);
  const resolved = ids.map(id => byId.get(clean(id)) || "").filter(Boolean);
  // 모든 ID를 현재 교사 명단에서 확인할 수 있으면 최신 이름만 사용합니다.
  // 일부 ID가 사라진 오래된 데이터는 저장 당시 이름을 보조값으로 유지합니다.
  return ids.length > 0 && resolved.length === ids.length
    ? unique(resolved)
    : unique([...resolved, ...asArray(event.teacherNames)]);
}

export function teacherEventSlots(event = {}, periodCount = 12) {
  const normalized = normalizeTeacherEvent(event, { periodCount });
  const out = [];
  for (let offset = 0; offset < normalized.durationPeriods; offset += 1) {
    const period = normalized.period + offset;
    if (period >= 0 && period < periodCount) out.push({ day: normalized.day, period });
  }
  return out;
}

export function findTeacherEventBlockers({ teacherNames = [], day, period, teacherEvents = [], teachers = [], periodCount = 12 } = {}) {
  const requested = new Set(unique(teacherNames));
  if (!requested.size) return [];
  return normalizeTeacherEvents(teacherEvents, { periodCount }).filter(event => {
    if (!event.active) return false;
    const eventNames = resolveTeacherEventNames(event, teachers);
    if (!eventNames.some(name => requested.has(name))) return false;
    return teacherEventSlots(event, periodCount).some(slot => slot.day === Number(day) && slot.period === Number(period));
  });
}

export function buildEffectiveTeacherConstraints(base = {}, teacherEvents = [], teachers = [], periodCount = 12) {
  const result = {};
  Object.entries(base && typeof base === "object" ? base : {}).forEach(([key, value]) => {
    result[key] = {
      ...(value && typeof value === "object" ? value : {}),
      unavailableSlots: asArray(value?.unavailableSlots).map(slot => ({ day: Number(slot.day), period: Number(slot.period) }))
        .filter(slot => Number.isInteger(slot.day) && Number.isInteger(slot.period)),
    };
  });

  normalizeTeacherEvents(teacherEvents, { periodCount }).filter(event => event.active).forEach(event => {
    const slots = teacherEventSlots(event, periodCount);
    resolveTeacherEventNames(event, teachers).forEach(name => {
      // 기존 교사 제한값이 없더라도 미팅 시간만 추가합니다.
      // maxPerDay/maxConsecutive 등의 새 기본값을 만들면 기존 배치 정책이 달라질 수 있습니다.
      const current = result[name] || { unavailableSlots: [] };
      const map = new Map(asArray(current.unavailableSlots).map(slot => [`${slot.day}:${slot.period}`, { day: Number(slot.day), period: Number(slot.period) }]));
      slots.forEach(slot => map.set(`${slot.day}:${slot.period}`, slot));
      result[name] = { ...current, unavailableSlots: [...map.values()].sort((a, b) => (a.day - b.day) || (a.period - b.period)) };
    });
  });
  return result;
}

export function buildTeacherEventPrintEntries(teacherEvents = [], teachers = [], periodCount = 12) {
  const out = [];
  normalizeTeacherEvents(teacherEvents, { periodCount }).filter(event => event.active).forEach(event => {
    const names = resolveTeacherEventNames(event, teachers);
    teacherEventSlots(event, periodCount).forEach((slot, index) => {
      out.push({
        id: `teacher-event:${event.id}:${index}`,
        teacherEventId: event.id,
        isTeacherEvent: true,
        day: slot.day,
        period: slot.period,
        title: event.title,
        subject: event.title,
        label: event.title,
        teacherName: names.join(", "),
        teacherNames: names,
        roomId: null,
        roomIds: [],
        audienceClassKeys: [],
        classKeys: [],
        note: event.note,
        pinned: true,
      });
    });
  });
  return out;
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.tt-te-backdrop{position:fixed;inset:0;z-index:2147483600;background:rgba(15,23,42,.58);display:flex;align-items:center;justify-content:center;padding:18px}
.tt-te-dialog{width:min(1120px,96vw);height:min(760px,92vh);background:#fff;border-radius:15px;box-shadow:0 28px 80px rgba(15,23,42,.38);display:flex;flex-direction:column;overflow:hidden;color:#0f172a;font-family:Arial,"Malgun Gothic",sans-serif}
.tt-te-head{display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid #e2e8f0;background:#f8fafc}.tt-te-head h2{margin:0;font-size:18px}.tt-te-head p{margin:2px 0 0;font-size:11px;color:#64748b;font-weight:700}.tt-te-head button{margin-left:auto;width:34px;height:34px;border:0;border-radius:9px;background:#e2e8f0;font-size:20px;cursor:pointer}
.tt-te-body{flex:1;min-height:0;display:grid;grid-template-columns:390px minmax(0,1fr)}.tt-te-list-pane{border-right:1px solid #e2e8f0;padding:14px;overflow:auto;background:#f8fafc}.tt-te-form-pane{padding:16px 18px;overflow:auto}
.tt-te-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:10px}.tt-te-toolbar b{font-size:13px}.tt-te-toolbar button,.tt-te-btn{height:30px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#334155;padding:0 10px;font-size:11px;font-weight:900;cursor:pointer}.tt-te-toolbar button{margin-left:auto;background:#2563eb;color:#fff;border-color:#2563eb}
.tt-te-list{display:flex;flex-direction:column;gap:7px}.tt-te-row{border:1px solid #dbe4f0;border-radius:11px;background:#fff;padding:9px 10px;cursor:pointer}.tt-te-row.active{border-color:#2563eb;background:#eff6ff}.tt-te-row.off{opacity:.55}.tt-te-row-title{font-size:13px;font-weight:950}.tt-te-row-meta{margin-top:4px;font-size:10.5px;color:#64748b;font-weight:750;line-height:1.4}.tt-te-empty{padding:30px 10px;text-align:center;color:#94a3b8;font-size:12px}
.tt-te-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.tt-te-field{display:flex;flex-direction:column;gap:5px;margin-bottom:10px}.tt-te-field.full{grid-column:1/-1}.tt-te-field label{font-size:11px;font-weight:900;color:#475569}.tt-te-field input,.tt-te-field select,.tt-te-field textarea{border:1px solid #cbd5e1;border-radius:9px;background:#fff;padding:7px 9px;font-size:12px}.tt-te-field input,.tt-te-field select{height:34px}.tt-te-field textarea{min-height:72px;resize:vertical}
.tt-te-teachers{grid-column:1/-1;border:1px solid #dbe4f0;border-radius:11px;padding:10px;background:#f8fafc}.tt-te-teacher-tools{display:flex;gap:6px;margin-bottom:8px}.tt-te-teacher-tools input{flex:1;height:30px;border:1px solid #cbd5e1;border-radius:8px;padding:0 8px}.tt-te-teacher-tools button{height:30px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;font-size:11px;font-weight:850;cursor:pointer}.tt-te-teacher-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;max-height:250px;overflow:auto}.tt-te-teacher{display:flex;align-items:center;gap:6px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;padding:6px 7px;font-size:11px;font-weight:800;min-width:0}.tt-te-teacher span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tt-te-actions{display:flex;align-items:center;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid #e2e8f0}.tt-te-actions .primary{background:#2563eb;color:#fff;border-color:#2563eb}.tt-te-actions .danger{margin-left:auto;background:#fff1f2;color:#be123c;border-color:#fecdd3}.tt-te-active{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:850;color:#334155}
@media(max-width:820px){.tt-te-body{grid-template-columns:1fr}.tt-te-list-pane{max-height:230px;border-right:0;border-bottom:1px solid #e2e8f0}.tt-te-teacher-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;
  document.head.appendChild(style);
}

function htmlEscape(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

export function createTeacherEventsManager(context = {}) {
  const {
    ttDomain,
    getTeachers = () => [],
    getPeriodCount = () => 7,
    getEntries = () => [],
    getEntryTeachers = entry => splitNames(entry?.teacherNames || entry?.teacherName || ""),
    canEdit = () => false,
    uid = prefix => `${prefix}-${Date.now()}`,
    captureTimetableUndo = () => {},
    scheduleSave = () => {},
    recomputeConflicts = () => {},
    renderAll = () => {},
  } = context;

  const events = () => {
    const domain = ttDomain?.();
    if (!domain) return [];
    domain.teacherEvents = normalizeTeacherEvents(domain.teacherEvents, { periodCount: getPeriodCount() });
    return domain.teacherEvents;
  };

  const persist = label => {
    scheduleSave("timetable");
    recomputeConflicts();
    renderAll();
    try { console.info(`[teacher-events:r369-2] ${label} count=${events().length}`); } catch (_) {}
  };

  function openTeacherEventsManager(initialId = "") {
    ensureStyle();
    const previous = document.getElementById("ttTeacherEventsBackdrop");
    previous?._ttTeacherEventsCleanup?.();
    previous?.remove();
    const teachers = asArray(getTeachers()).filter(item => teacherId(item) || teacherName(item)).sort((a, b) => teacherName(a).localeCompare(teacherName(b), "ko", { numeric: true }));
    const periodCount = Math.max(1, Number(getPeriodCount()) || 7);
    let selectedId = clean(initialId);

    const backdrop = document.createElement("div");
    backdrop.id = "ttTeacherEventsBackdrop";
    backdrop.className = "tt-te-backdrop";
    backdrop.innerHTML = `<section class="tt-te-dialog" role="dialog" aria-modal="true">
      <header class="tt-te-head"><div><h2>교사 일정</h2><p>학생·학급·교실은 점유하지 않고, 선택 교사의 해당 시간 수업 배정만 차단합니다.</p></div><button type="button" data-action="close" aria-label="닫기">×</button></header>
      <div class="tt-te-body"><aside class="tt-te-list-pane"><div class="tt-te-toolbar"><b>등록 일정</b><button type="button" data-action="new">+ 새 일정</button></div><div class="tt-te-list" data-role="list"></div></aside>
      <main class="tt-te-form-pane"><div data-role="form"></div></main></div>
    </section>`;
    document.body.appendChild(backdrop);
    let onKey = null;
    const close = () => {
      if (onKey) document.removeEventListener("keydown", onKey, true);
      backdrop.remove();
    };
    backdrop._ttTeacherEventsCleanup = close;
    const listEl = backdrop.querySelector('[data-role="list"]');
    const formEl = backdrop.querySelector('[data-role="form"]');

    const currentEvent = () => events().find(item => item.id === selectedId) || null;
    const slotLabel = item => `${DAY_LABELS[item.day] || "?"} ${item.period + 1}교시${item.durationPeriods > 1 ? `~${item.period + item.durationPeriods}교시` : ""}`;

    const renderList = () => {
      const list = events().slice().sort((a, b) => (a.day - b.day) || (a.period - b.period) || a.title.localeCompare(b.title, "ko"));
      listEl.innerHTML = list.length ? list.map(item => {
        const names = resolveTeacherEventNames(item, teachers);
        return `<div class="tt-te-row${item.id === selectedId ? " active" : ""}${item.active ? "" : " off"}" data-event-id="${htmlEscape(item.id)}">
          <div class="tt-te-row-title">${htmlEscape(item.title)}</div><div class="tt-te-row-meta">${htmlEscape(slotLabel(item))} · ${names.length}명${item.active ? "" : " · 사용 안 함"}<br>${htmlEscape(names.join(", "))}</div>
        </div>`;
      }).join("") : `<div class="tt-te-empty">등록된 교사 일정이 없습니다.</div>`;
      listEl.querySelectorAll("[data-event-id]").forEach(row => row.addEventListener("click", () => { selectedId = row.dataset.eventId; render(); }));
    };

    const renderForm = () => {
      const item = currentEvent();
      const draft = item || normalizeTeacherEvent({ id: "", title: "교사 미팅", day: 0, period: 0, durationPeriods: 1, active: true }, { periodCount });
      const selectedIds = new Set(draft.teacherIds);
      const selectedNames = new Set(resolveTeacherEventNames(draft, teachers));
      formEl.innerHTML = `<div class="tt-te-form-grid">
        <div class="tt-te-field full"><label>일정명</label><input data-field="title" value="${htmlEscape(draft.title)}" maxlength="80"></div>
        <div class="tt-te-field"><label>요일</label><select data-field="day">${DAY_LABELS.map((label, idx) => `<option value="${idx}"${draft.day === idx ? " selected" : ""}>${label}요일</option>`).join("")}</select></div>
        <div class="tt-te-field"><label>시작 교시</label><select data-field="period">${Array.from({ length: periodCount }, (_, idx) => `<option value="${idx}"${draft.period === idx ? " selected" : ""}>${idx + 1}교시</option>`).join("")}</select></div>
        <div class="tt-te-field"><label>연속 교시 수</label><select data-field="duration">${Array.from({ length: periodCount }, (_, idx) => idx + 1).map(value => `<option value="${value}"${draft.durationPeriods === value ? " selected" : ""}>${value}교시</option>`).join("")}</select></div>
        <div class="tt-te-field"><label>사용 여부</label><label class="tt-te-active"><input type="checkbox" data-field="active"${draft.active ? " checked" : ""}> 이 일정을 배정 제한에 적용</label></div>
        <div class="tt-te-teachers"><div class="tt-te-teacher-tools"><input type="search" data-role="teacher-search" placeholder="교사 검색"><button type="button" data-action="select-all">전체 선택</button><button type="button" data-action="clear-all">전체 해제</button></div><div class="tt-te-teacher-grid" data-role="teacher-grid">${teachers.map(t => {
          const id = teacherId(t), name = teacherName(t);
          const checked = (id && selectedIds.has(id)) || selectedNames.has(name);
          return `<label class="tt-te-teacher" data-teacher-label="${htmlEscape(name.toLowerCase())}"><input type="checkbox" data-teacher-id="${htmlEscape(id)}" data-teacher-name="${htmlEscape(name)}"${checked ? " checked" : ""}><span>${htmlEscape(name)}</span></label>`;
        }).join("")}</div></div>
        <div class="tt-te-field full"><label>메모</label><textarea data-field="note" placeholder="예: 중등 교사 정기회의">${htmlEscape(draft.note)}</textarea></div>
      </div><div class="tt-te-actions"><button type="button" class="tt-te-btn primary" data-action="save">${item ? "수정 저장" : "일정 추가"}</button><button type="button" class="tt-te-btn" data-action="close">닫기</button>${item ? `<button type="button" class="tt-te-btn danger" data-action="delete">삭제</button>` : ""}</div>`;

      const periodSelect = formEl.querySelector('[data-field="period"]');
      const durationSelect = formEl.querySelector('[data-field="duration"]');
      const syncDurationOptions = () => {
        const start = Math.max(0, Number(periodSelect?.value || 0));
        const max = Math.max(1, periodCount - start);
        const current = Math.min(max, Math.max(1, Number(durationSelect?.value || draft.durationPeriods || 1)));
        if (durationSelect) durationSelect.innerHTML = Array.from({ length: max }, (_, idx) => idx + 1)
          .map(value => `<option value="${value}"${value === current ? " selected" : ""}>${value}교시</option>`).join("");
      };
      periodSelect?.addEventListener("change", syncDurationOptions);
      syncDurationOptions();

      const search = formEl.querySelector('[data-role="teacher-search"]');
      search?.addEventListener("input", () => {
        const query = clean(search.value).toLowerCase();
        formEl.querySelectorAll("[data-teacher-label]").forEach(label => { label.style.display = !query || label.dataset.teacherLabel.includes(query) ? "" : "none"; });
      });
      formEl.querySelector('[data-action="select-all"]')?.addEventListener("click", () => formEl.querySelectorAll('[data-teacher-id]').forEach(box => { if (box.closest("label")?.style.display !== "none") box.checked = true; }));
      formEl.querySelector('[data-action="clear-all"]')?.addEventListener("click", () => formEl.querySelectorAll('[data-teacher-id]').forEach(box => { if (box.closest("label")?.style.display !== "none") box.checked = false; }));
      formEl.querySelectorAll('[data-action="close"]').forEach(button => button.addEventListener("click", close));
      formEl.querySelector('[data-action="save"]')?.addEventListener("click", () => {
        if (!canEdit()) { alert("편집 권한이 없습니다."); return; }
        const title = clean(formEl.querySelector('[data-field="title"]')?.value);
        const selected = [...formEl.querySelectorAll('[data-teacher-id]:checked')];
        if (!title) { alert("일정명을 입력하세요."); return; }
        if (!selected.length) { alert("참석 교사를 한 명 이상 선택하세요."); return; }
        const now = new Date().toISOString();
        const next = normalizeTeacherEvent({
          ...(item || {}),
          id: item?.id || uid("teacher-event"),
          title,
          day: Number(formEl.querySelector('[data-field="day"]')?.value || 0),
          period: Number(formEl.querySelector('[data-field="period"]')?.value || 0),
          durationPeriods: Number(formEl.querySelector('[data-field="duration"]')?.value || 1),
          active: !!formEl.querySelector('[data-field="active"]')?.checked,
          note: clean(formEl.querySelector('[data-field="note"]')?.value),
          teacherIds: unique(selected.map(box => box.dataset.teacherId)),
          teacherNames: unique(selected.map(box => box.dataset.teacherName)),
          createdAt: item?.createdAt || now,
          updatedAt: now,
        }, { periodCount });
        const nextTeacherSet = new Set(resolveTeacherEventNames(next, teachers));
        const nextSlotSet = new Set(teacherEventSlots(next, periodCount).map(slot => `${slot.day}:${slot.period}`));
        const eventOverlaps = next.active ? events().filter(other => {
          if (!other.active || other.id === item?.id) return false;
          const sameTeacher = resolveTeacherEventNames(other, teachers).some(name => nextTeacherSet.has(name));
          const sameSlot = teacherEventSlots(other, periodCount).some(slot => nextSlotSet.has(`${slot.day}:${slot.period}`));
          return sameTeacher && sameSlot;
        }) : [];
        if (eventOverlaps.length) {
          alert(`같은 교사가 같은 시간에 참석하는 다른 일정이 있습니다.\n\n${[...new Set(eventOverlaps.map(row => row.title))].join(", ")}`);
          return;
        }
        const overlapping = asArray(getEntries()).filter(entry => {
          if (!nextSlotSet.has(`${Number(entry?.day)}:${Number(entry?.period)}`)) return false;
          return asArray(getEntryTeachers(entry)).some(name => nextTeacherSet.has(clean(name)));
        });
        if (overlapping.length && !confirm(`현재 배치된 수업 ${overlapping.length}개와 시간이 겹칩니다.

일정을 저장하면 해당 수업은 충돌로 표시되며 다른 시간으로 옮겨야 합니다. 계속할까요?`)) return;
        captureTimetableUndo(item ? "교사 일정 수정" : "교사 일정 추가");
        const domain = ttDomain();
        domain.teacherEvents = item ? events().map(row => row.id === item.id ? next : row) : [...events(), next];
        selectedId = next.id;
        persist(item ? "updated" : "created");
        render();
      });
      formEl.querySelector('[data-action="delete"]')?.addEventListener("click", () => {
        if (!item || !canEdit()) return;
        if (!confirm(`"${item.title}" 일정을 삭제할까요?`)) return;
        captureTimetableUndo("교사 일정 삭제");
        const domain = ttDomain();
        domain.teacherEvents = events().filter(row => row.id !== item.id);
        selectedId = "";
        persist("deleted");
        render();
      });
    };

    const render = () => { renderList(); renderForm(); };
    backdrop.querySelector('[data-action="close"]')?.addEventListener("click", close);
    backdrop.querySelector('[data-action="new"]')?.addEventListener("click", () => { selectedId = ""; render(); });
    backdrop.addEventListener("click", event => { if (event.target === backdrop) close(); });
    onKey = event => { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", onKey, true);
    render();
    return { close };
  }

  return { openTeacherEventsManager, getTeacherEvents: events };
}
