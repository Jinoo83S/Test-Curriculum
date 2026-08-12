 // ================================================================
// timetable-card-editor.js · 시간표 카드 마스터 상세 편집기
// r394 · 2026-08-12
// - 교사 / 대상반 / 시수 / 교실 규칙 / 가능·불가시간 / 자동배치 포함
// - 카드 상세에서 독립 수동카드 복제/삭제 및 수동카드 과목명 편집
// - 묶음수업 구조 자체는 수정하지 않고 기존 그룹 관리 기능을 유지합니다.
// ================================================================

const STYLE_ID = "ttCardEditorStyleR394";
const DAY_LABELS = ["월", "화", "수", "목", "금"];
const clean = value => String(value ?? "").trim();
const asArray = value => Array.isArray(value) ? value : [];
const unique = values => [...new Set(asArray(values).map(clean).filter(Boolean))];
const escapeHtml = value => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

function gradeNo(value = "") {
  const m = clean(value).match(/\d{1,2}/);
  return m ? Number(m[0]) : null;
}

function teacherId(row = {}) {
  return clean(row.id || row.teacherId || row.uid);
}
function teacherName(row = {}) {
  return clean(row.name || row.teacherName || row.displayName || row.label);
}
function classSection(row = {}) {
  return clean(row.name || row.section || row.label).replace(/^\d{1,2}/, "").toUpperCase();
}
function classKey(row = {}, fallbackGrade = "") {
  const g = gradeNo(row.grade || row.gradeKey || fallbackGrade);
  const sec = classSection(row);
  return g && sec ? `${g}:${sec}` : "";
}
function classLabel(row = {}, fallbackGrade = "") {
  const g = gradeNo(row.grade || row.gradeKey || fallbackGrade);
  const sec = classSection(row);
  return g && sec ? `${g}${sec}` : "";
}
function slotKey(day, period) { return `${Number(day)}:${Number(period)}`; }
function normalizeSlots(list = [], periodCount = 7) {
  const seen = new Set();
  const out = [];
  asArray(list).forEach(slot => {
    const day = Number(slot?.day);
    const period = Number(slot?.period);
    if (!Number.isInteger(day) || day < 0 || day > 4 || !Number.isInteger(period) || period < 0 || period >= periodCount) return;
    const key = slotKey(day, period);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ day, period });
  });
  return out.sort((a, b) => (a.day - b.day) || (a.period - b.period));
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.tt-ce-backdrop{position:fixed;inset:0;z-index:2147483635;background:rgba(15,23,42,.58);display:flex;align-items:center;justify-content:center;padding:18px;font-family:system-ui,-apple-system,"Segoe UI","Malgun Gothic",sans-serif;color:#0f172a}
.tt-ce-dialog{width:min(1180px,97vw);height:min(820px,94vh);background:#fff;border-radius:16px;box-shadow:0 28px 80px rgba(15,23,42,.38);display:flex;flex-direction:column;overflow:hidden}
.tt-ce-head{display:flex;align-items:center;gap:12px;padding:13px 17px;border-bottom:1px solid #e2e8f0;background:linear-gradient(135deg,#f8fafc,#eff6ff)}
.tt-ce-head h2{margin:0;font-size:17px}.tt-ce-head p{margin:3px 0 0;font-size:11px;color:#64748b;font-weight:700}.tt-ce-head button{margin-left:auto;width:34px;height:34px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;font-size:20px;cursor:pointer}
.tt-ce-body{flex:1;min-height:0;display:grid;grid-template-columns:320px minmax(0,1fr)}
.tt-ce-left{border-right:1px solid #e2e8f0;background:#f8fafc;padding:12px;display:flex;flex-direction:column;min-height:0}
.tt-ce-search{height:34px;border:1px solid #cbd5e1;border-radius:9px;padding:0 10px;font-size:12px;margin-bottom:8px}
.tt-ce-filter{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px}.tt-ce-filter button{height:27px;border:1px solid #cbd5e1;border-radius:999px;background:#fff;padding:0 9px;font-size:10px;font-weight:850;cursor:pointer}.tt-ce-filter button.active{background:#2563eb;color:#fff;border-color:#2563eb}
.tt-ce-list{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:6px}.tt-ce-card{border:1px solid #dbe4f0;border-radius:10px;background:#fff;padding:8px 9px;cursor:pointer;text-align:left}.tt-ce-card.active{border-color:#2563eb;box-shadow:0 0 0 2px #dbeafe}.tt-ce-card.excluded{opacity:.62}.tt-ce-card b{display:block;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tt-ce-card span{display:block;margin-top:3px;font-size:9.5px;color:#64748b;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tt-ce-right{overflow:auto;padding:14px 17px}.tt-ce-empty{display:flex;align-items:center;justify-content:center;height:100%;color:#94a3b8;font-size:13px;font-weight:800}
.tt-ce-summary{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:12px}.tt-ce-chip{border:1px solid #dbe4f0;border-radius:999px;background:#f8fafc;padding:4px 9px;font-size:10px;font-weight:850;color:#475569}.tt-ce-chip.manual{background:#fff7ed;border-color:#fed7aa;color:#9a3412}
.tt-ce-section{border:1px solid #dbe4f0;border-radius:11px;background:#fff;margin-bottom:10px;overflow:hidden}.tt-ce-section h3{margin:0;padding:8px 10px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-size:12px}.tt-ce-secbody{padding:10px}
.tt-ce-grid2{display:grid;grid-template-columns:1fr 1fr;gap:9px}.tt-ce-field{display:flex;flex-direction:column;gap:4px}.tt-ce-field label{font-size:10.5px;font-weight:900;color:#475569}.tt-ce-field input,.tt-ce-field select{height:33px;border:1px solid #cbd5e1;border-radius:8px;padding:0 8px;font-size:12px;background:#fff}.tt-ce-field small{font-size:9.5px;color:#64748b;line-height:1.35}
.tt-ce-checktools{display:flex;gap:6px;align-items:center;margin-bottom:7px}.tt-ce-checktools input{flex:1;height:30px;border:1px solid #cbd5e1;border-radius:8px;padding:0 8px;font-size:11px}.tt-ce-checktools button{height:30px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:0 8px;font-size:10px;font-weight:850;cursor:pointer}
.tt-ce-checkgrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;max-height:180px;overflow:auto}.tt-ce-check{display:flex;align-items:center;gap:5px;border:1px solid #e2e8f0;border-radius:7px;padding:5px 6px;font-size:10.5px;font-weight:800;background:#fff;min-width:0}.tt-ce-check span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tt-ce-time-head{display:flex;gap:6px;align-items:center;margin-bottom:8px}.tt-ce-time-head select{height:31px;border:1px solid #cbd5e1;border-radius:8px;padding:0 8px;font-size:11px}.tt-ce-time-head span{font-size:10px;color:#64748b;font-weight:750}
.tt-ce-timegrid{display:grid;grid-template-columns:48px repeat(5,minmax(48px,1fr));gap:4px;min-width:390px}.tt-ce-timecell{min-height:28px;border:1px solid #dbe4f0;border-radius:7px;background:#fff;font-size:10px;font-weight:850}.tt-ce-timecell.hdr{display:flex;align-items:center;justify-content:center;background:#f1f5f9;color:#475569}.tt-ce-timecell.on{background:#dbeafe;border-color:#60a5fa;color:#1d4ed8}.tt-ce-timecell.danger.on{background:#fee2e2;border-color:#f87171;color:#991b1b}
.tt-ce-note{padding:8px 10px;border-radius:8px;background:#fffbeb;border:1px solid #fde68a;color:#92400e;font-size:10px;line-height:1.45;margin-top:7px}
.tt-ce-occ-list{display:flex;flex-direction:column;gap:6px}.tt-ce-occ-row{display:grid;grid-template-columns:minmax(88px,120px) minmax(160px,1fr);gap:8px;align-items:center;border:1px solid #e2e8f0;border-radius:8px;background:#fff;padding:7px 8px}.tt-ce-occ-row b{font-size:11px;color:#334155}.tt-ce-occ-row select{height:31px;border:1px solid #cbd5e1;border-radius:8px;padding:0 8px;font-size:11px;background:#fff}.tt-ce-occ-row.is-grouped{background:#f8fafc;opacity:.72}.tt-ce-occ-save{margin-top:8px;height:32px;border:1px solid #2563eb;border-radius:8px;background:#2563eb;color:#fff;padding:0 11px;font-size:11px;font-weight:900;cursor:pointer}.tt-ce-occ-save:disabled{opacity:.55;cursor:not-allowed}
.tt-ce-actions{position:sticky;bottom:-14px;background:#fff;border-top:1px solid #e2e8f0;margin:14px -17px -14px;padding:11px 17px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.tt-ce-actions button{height:34px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:0 12px;font-size:11px;font-weight:900;cursor:pointer}.tt-ce-actions .primary{background:#2563eb;border-color:#2563eb;color:#fff}.tt-ce-actions .danger{border-color:#fecaca;color:#b91c1c;background:#fff}.tt-ce-actions span{margin-left:auto;font-size:10px;color:#64748b;font-weight:750}
@media(max-width:860px){.tt-ce-body{grid-template-columns:1fr}.tt-ce-left{max-height:250px;border-right:0;border-bottom:1px solid #e2e8f0}.tt-ce-checkgrid{grid-template-columns:repeat(2,minmax(0,1fr))}.tt-ce-grid2{grid-template-columns:1fr}}
`;
  document.head.appendChild(style);
}

function cardTeachers(card = {}) {
  return unique([
    ...asArray(card.teachers),
    ...clean(card.teacherName).split(/[,/;|\n]+/g),
  ]);
}

function cardClassKeys(card = {}) {
  return unique(card.classKeys || []);
}

function isManualCard(card = {}) {
  return card?.isManual === true || clean(card?.id).startsWith("ttc_manual") || clean(card?.templateId).startsWith("manual_");
}

function roomRuleLabel(rule = "teacher") {
  return ({ teacher:"교사 교실", homeroom:"홈룸", fixed:"지정 교실", autoRoom:"자동 교실", none:"교실 없음" })[rule] || rule;
}

export function createTimetableCardEditor(context = {}) {
  let selectedCardId = "";
  let filterGrade = "all";
  let searchText = "";

  const getCards = () => asArray(context.getCards?.());
  const getTeachers = () => asArray(context.getTeachers?.());
  const getClasses = () => asArray(context.getClasses?.());
  const getRooms = () => asArray(context.getRooms?.());
  const periodCount = () => Math.max(1, Number(context.getPeriodCount?.() || 7) || 7);

  function cardTitle(card = {}) {
    return clean(card.subject || card.label || context.describeCard?.(card)?.title || card.templateId || card.id || "과목카드");
  }

  function classRowsForCard(card = {}) {
    const g = gradeNo(card.gradeKey);
    return getClasses().filter(row => gradeNo(row.grade || row.gradeKey) === g)
      .map(row => ({ row, key: classKey(row, card.gradeKey), label: classLabel(row, card.gradeKey) }))
      .filter(row => row.key)
      .sort((a, b) => a.label.localeCompare(b.label, "ko", { numeric:true }));
  }

  function groupSummary(cardId = "") {
    const info = context.getGroupInfo?.(cardId) || {};
    return clean([info.groupName, info.unitName].filter(Boolean).join(" · ")) || "그룹 없음";
  }

  function open(cardId = "") {
    ensureStyle();
    document.getElementById("ttCardEditorBackdrop")?.remove();
    const cards = getCards();
    if (!cards.length) { alert("시간표 카드가 없습니다."); return; }
    if (cardId && cards.some(card => card.id === cardId)) selectedCardId = cardId;
    if (!selectedCardId || !cards.some(card => card.id === selectedCardId)) selectedCardId = cards[0].id;

    const backdrop = document.createElement("div");
    backdrop.id = "ttCardEditorBackdrop";
    backdrop.className = "tt-ce-backdrop";
    backdrop.innerHTML = `<section class="tt-ce-dialog" role="dialog" aria-modal="true">
      <header class="tt-ce-head"><div><h2>시간표 카드 편집</h2><p>커리큘럼 원본은 유지하고 시간표 카드의 운영용 조건만 수정합니다.</p></div><button type="button" data-action="close" aria-label="닫기">×</button></header>
      <div class="tt-ce-body"><aside class="tt-ce-left"><input class="tt-ce-search" type="search" placeholder="과목·교사·반 검색"><div class="tt-ce-filter" data-role="grade-filter"></div><div class="tt-ce-list" data-role="list"></div></aside><main class="tt-ce-right" data-role="editor"></main></div>
    </section>`;
    document.body.appendChild(backdrop);

    const search = backdrop.querySelector(".tt-ce-search");
    const gradeFilter = backdrop.querySelector('[data-role="grade-filter"]');
    const list = backdrop.querySelector('[data-role="list"]');
    const editor = backdrop.querySelector('[data-role="editor"]');
    const close = () => backdrop.remove();
    backdrop.querySelector('[data-action="close"]')?.addEventListener("click", close);
    backdrop.addEventListener("click", event => { if (event.target === backdrop) close(); });

    const renderGradeFilter = () => {
      const grades = [...new Set(cards.map(card => clean(card.gradeKey)).filter(Boolean))].sort((a,b)=>(gradeNo(a)||0)-(gradeNo(b)||0));
      gradeFilter.innerHTML = "";
      [["all","전체"], ...grades.map(g => [g, `${gradeNo(g)}학년`])].forEach(([value,label]) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = filterGrade === value ? "active" : "";
        btn.textContent = label;
        btn.addEventListener("click", () => { filterGrade = value; renderGradeFilter(); renderList(); });
        gradeFilter.appendChild(btn);
      });
    };

    const renderList = () => {
      const q = clean(searchText).toLowerCase();
      const visible = cards.filter(card => {
        if (filterGrade !== "all" && card.gradeKey !== filterGrade) return false;
        const text = [cardTitle(card), card.gradeKey, ...cardTeachers(card), ...(card.classLabels || []), groupSummary(card.id)].join(" ").toLowerCase();
        return !q || text.includes(q);
      }).sort((a,b) => (gradeNo(a.gradeKey)||0)-(gradeNo(b.gradeKey)||0) || cardTitle(a).localeCompare(cardTitle(b),"ko",{numeric:true}));
      list.innerHTML = "";
      visible.forEach(card => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `tt-ce-card${card.id === selectedCardId ? " active" : ""}${card.autoAssignExcluded === true ? " excluded" : ""}`;
        btn.innerHTML = `<b>${escapeHtml(cardTitle(card))}</b><span>${escapeHtml(`${gradeNo(card.gradeKey) || "?"}학년 · ${(card.classLabels || []).join(", ") || "대상반 없음"} · ${cardTeachers(card).join(", ") || "교사 없음"}`)}</span><span>${escapeHtml(`${groupSummary(card.id)} · ${roomRuleLabel(clean(card.roomRule) || "teacher")} · ${Number(card.credits || 0)}시수`)}</span>`;
        btn.addEventListener("click", () => { selectedCardId = card.id; renderList(); renderEditor(); });
        list.appendChild(btn);
      });
      if (!visible.length) list.innerHTML = `<div style="padding:24px 8px;text-align:center;color:#94a3b8;font-size:11px">검색 결과가 없습니다.</div>`;
    };

    const buildCheckGrid = (rows, selectedValues, kind, searchable = true) => {
      const wrap = document.createElement("div");
      if (searchable) {
        const tools = document.createElement("div"); tools.className = "tt-ce-checktools";
        const input = document.createElement("input"); input.type = "search"; input.placeholder = kind === "teacher" ? "교사 검색" : "반 검색";
        const all = document.createElement("button"); all.type = "button"; all.textContent = "전체";
        const clear = document.createElement("button"); clear.type = "button"; clear.textContent = "해제";
        tools.append(input, all, clear); wrap.appendChild(tools);
        input.addEventListener("input", () => {
          const q = clean(input.value).toLowerCase();
          wrap.querySelectorAll("[data-check-label]").forEach(label => { label.style.display = !q || label.dataset.checkLabel.includes(q) ? "" : "none"; });
        });
        all.addEventListener("click", () => wrap.querySelectorAll('input[type="checkbox"]').forEach(box => { if (box.closest("label")?.style.display !== "none") box.checked = true; }));
        clear.addEventListener("click", () => wrap.querySelectorAll('input[type="checkbox"]').forEach(box => { if (box.closest("label")?.style.display !== "none") box.checked = false; }));
      }
      const grid = document.createElement("div"); grid.className = "tt-ce-checkgrid";
      const set = new Set(selectedValues);
      rows.forEach(row => {
        const value = row.value; const labelText = row.label;
        const label = document.createElement("label"); label.className = "tt-ce-check"; label.dataset.checkLabel = labelText.toLowerCase();
        const cb = document.createElement("input"); cb.type = "checkbox"; cb.value = value; cb.checked = set.has(value); cb.dataset.kind = kind;
        const span = document.createElement("span"); span.textContent = labelText; span.title = labelText;
        label.append(cb, span); grid.appendChild(label);
      });
      wrap.appendChild(grid); return wrap;
    };

    const renderEditor = () => {
      const card = cards.find(row => row.id === selectedCardId);
      if (!card) { editor.innerHTML = `<div class="tt-ce-empty">왼쪽에서 카드를 선택하세요.</div>`; return; }
      editor.innerHTML = "";
      const canEdit = context.canEdit?.() !== false;
      const title = document.createElement("div");
      title.innerHTML = `<div style="font-size:17px;font-weight:950;color:#0f172a">${escapeHtml(cardTitle(card))}</div><div class="tt-ce-summary"><span class="tt-ce-chip">${escapeHtml(`${gradeNo(card.gradeKey)||"?"}학년`)}</span><span class="tt-ce-chip">${escapeHtml(groupSummary(card.id))}</span>${card.manualEdited ? '<span class="tt-ce-chip manual">수동 수정</span>' : ''}${isManualCard(card) ? '<span class="tt-ce-chip manual">수동카드</span>' : ''}${card.autoAssignExcluded === true ? '<span class="tt-ce-chip manual">자동배치 제외</span>' : ''}</div>`;
      editor.appendChild(title);

      const identitySection = document.createElement("section");
      identitySection.className = "tt-ce-section";
      identitySection.innerHTML = "<h3>카드 기본 정보</h3>";
      const identityBody = document.createElement("div");
      identityBody.className = "tt-ce-secbody";
      if (isManualCard(card)) {
        identityBody.classList.add("tt-ce-grid2");
        const subjectField = document.createElement("div");
        subjectField.className = "tt-ce-field";
        subjectField.innerHTML = `<label>과목명</label><input data-field="subject" type="text" value="${escapeHtml(clean(card.subject || card.label))}"><small>수동카드는 시간표 운영용 과목명을 직접 수정할 수 있습니다.</small>`;
        const subjectEnField = document.createElement("div");
        subjectEnField.className = "tt-ce-field";
        subjectEnField.innerHTML = `<label>영문명</label><input data-field="subjectEn" type="text" value="${escapeHtml(clean(card.subjectEn))}"><small>필요하지 않으면 비워 두어도 됩니다.</small>`;
        const gradeField = document.createElement("div");
        gradeField.className = "tt-ce-field";
        gradeField.innerHTML = `<label>학년</label><input type="text" value="${escapeHtml(card.gradeKey || "")}" disabled><small>학년을 바꿔야 하면 원하는 학년의 카드를 먼저 복제하세요.</small>`;
        identityBody.append(subjectField, subjectEnField, gradeField);
      } else {
        identityBody.innerHTML = `<div style="font-size:11px;line-height:1.5;color:#475569"><b>${escapeHtml(card.gradeKey || "")}</b> · 커리큘럼 생성 카드입니다.<br>과목명과 학년은 커리큘럼 원본을 보호하기 위해 여기서 변경하지 않습니다. 별도 과목카드가 필요하면 아래 <b>이 카드 복제</b>를 사용하세요.</div>`;
      }
      identitySection.appendChild(identityBody);
      editor.appendChild(identitySection);

      const teacherSection = document.createElement("section"); teacherSection.className = "tt-ce-section"; teacherSection.innerHTML = "<h3>담당 교사</h3>";
      const teacherBody = document.createElement("div"); teacherBody.className = "tt-ce-secbody";
      const teacherRows = getTeachers().map(row => ({ value: teacherName(row), label: teacherName(row), id: teacherId(row) })).filter(row => row.value).sort((a,b)=>a.label.localeCompare(b.label,"ko"));
      teacherBody.appendChild(buildCheckGrid(teacherRows, cardTeachers(card), "teacher"));
      teacherSection.appendChild(teacherBody); editor.appendChild(teacherSection);

      const classSection = document.createElement("section"); classSection.className = "tt-ce-section"; classSection.innerHTML = "<h3>대상 학급</h3>";
      const classBody = document.createElement("div"); classBody.className = "tt-ce-secbody";
      const classes = classRowsForCard(card);
      classBody.appendChild(buildCheckGrid(classes.map(row => ({ value: row.key, label: row.label })), cardClassKeys(card), "class", false));
      if (!classes.length) classBody.innerHTML = `<div style="font-size:11px;color:#b45309">${escapeHtml(card.gradeKey || "학년 미확인")} 학급 정보를 찾지 못했습니다.</div>`;
      classSection.appendChild(classBody); editor.appendChild(classSection);

      const basic = document.createElement("section"); basic.className = "tt-ce-section"; basic.innerHTML = "<h3>시수 · 교실 · 자동배치</h3>";
      const basicBody = document.createElement("div"); basicBody.className = "tt-ce-secbody tt-ce-grid2";
      const creditField = document.createElement("div"); creditField.className = "tt-ce-field"; creditField.innerHTML = `<label>주당 시수</label><input data-field="credits" type="number" min="0" max="20" step="0.5" value="${Number(card.credits || 0)}"><small>시간표 카드의 목표 배치 횟수입니다.</small>`;
      const ruleField = document.createElement("div"); ruleField.className = "tt-ce-field"; ruleField.innerHTML = `<label>교실 배정 방식</label><select data-field="roomRule"><option value="teacher">교사 교실</option><option value="homeroom">홈룸</option><option value="fixed">지정 교실</option><option value="autoRoom">자동 교실</option><option value="none">교실 사용 안 함</option></select><small>묶음수업의 카드별 교실은 배치 상세에서도 추가 조정할 수 있습니다.</small>`;
      const fixedField = document.createElement("div"); fixedField.className = "tt-ce-field";
      const roomOptions = [`<option value="">교실 선택</option>`, ...getRooms().filter(r=>clean(r.id)).sort((a,b)=>clean(a.name||a.id).localeCompare(clean(b.name||b.id),"ko",{numeric:true})).map(r=>`<option value="${escapeHtml(r.id)}">${escapeHtml(r.name||r.id)}</option>`)].join("");
      fixedField.innerHTML = `<label>지정 교실</label><select data-field="fixedRoomId">${roomOptions}</select><small>‘지정 교실’일 때 사용합니다. 여러 교실 동시 사용은 기존 ‘조건’ 기능에서 설정합니다.</small>`;
      const autoField = document.createElement("div"); autoField.className = "tt-ce-field"; autoField.innerHTML = `<label>자동배치</label><label style="height:33px;display:flex;align-items:center;gap:7px;border:1px solid #cbd5e1;border-radius:8px;padding:0 9px"><input data-field="autoInclude" type="checkbox" style="height:auto"> 자동배치 대상에 포함</label><small>제외해도 카드와 기존 배치는 삭제되지 않습니다.</small>`;
      basicBody.append(creditField, ruleField, fixedField, autoField); basic.appendChild(basicBody); editor.appendChild(basic);
      const roomRule = basic.querySelector('[data-field="roomRule"]'); roomRule.value = clean(card.roomRule) || "teacher";
      const fixedRoom = basic.querySelector('[data-field="fixedRoomId"]'); fixedRoom.value = clean(card.fixedRoomId);
      const autoInclude = basic.querySelector('[data-field="autoInclude"]'); autoInclude.checked = card.autoAssignExcluded !== true;
      const refreshFixed = () => { fixedRoom.disabled = roomRule.value !== "fixed"; fixedField.style.opacity = roomRule.value === "fixed" ? "1" : ".62"; };
      roomRule.addEventListener("change", refreshFixed); refreshFixed();

      const occurrences = asArray(context.getOccurrences?.(card.id));
      if (occurrences.length) {
        const occSection = document.createElement("section");
        occSection.className = "tt-ce-section";
        occSection.innerHTML = "<h3>현재 배치 회차별 교실</h3>";
        const occBody = document.createElement("div");
        occBody.className = "tt-ce-secbody";
        const occList = document.createElement("div");
        occList.className = "tt-ce-occ-list";
        const sortedRooms = getRooms().filter(room => clean(room.id)).sort((a,b)=>clean(a.name||a.id).localeCompare(clean(b.name||b.id),"ko",{numeric:true}));
        let editableOccurrenceCount = 0;

        occurrences.forEach((occ, index) => {
          const row = document.createElement("div");
          row.className = `tt-ce-occ-row${occ.editable ? "" : " is-grouped"}`;
          const slot = document.createElement("b");
          slot.textContent = `${DAY_LABELS[Number(occ.day)] || "?"} ${Number(occ.period) + 1}교시`;
          const select = document.createElement("select");
          select.dataset.entryId = clean(occ.entryId);
          select.dataset.originalRoomId = clean(occ.roomId);
          select.innerHTML = `<option value="">카드 기본 규칙 사용</option>${sortedRooms.map(room => `<option value="${escapeHtml(room.id)}">${escapeHtml(room.name || room.id)}</option>`).join("")}`;
          if (clean(occ.roomId) && !sortedRooms.some(room => clean(room.id) === clean(occ.roomId))) {
            const unknown = document.createElement("option");
            unknown.value = clean(occ.roomId);
            unknown.textContent = clean(occ.roomId);
            select.appendChild(unknown);
          }
          select.value = clean(occ.roomId);
          select.disabled = !canEdit || !occ.editable;
          if (occ.editable) editableOccurrenceCount += 1;
          else {
            select.title = "묶음/그룹 수업은 배치 상세에서 구성 과목별 교실을 수정합니다.";
            const grouped = document.createElement("option");
            grouped.value = clean(occ.roomId);
            grouped.textContent = `${clean(occ.roomId) ? "현재 교실 유지" : "그룹/묶음 수업"}`;
            if (![...select.options].some(option => option.value === grouped.value)) select.appendChild(grouped);
            select.value = clean(occ.roomId);
          }
          row.append(slot, select);
          occList.appendChild(row);
        });

        occBody.appendChild(occList);
        const occNote = document.createElement("div");
        occNote.className = "tt-ce-note";
        occNote.textContent = "이 설정은 현재 배치의 각 회차 교실만 고정합니다. 예: 같은 음악 카드의 한 회차는 Chapel, 다른 회차는 VH106으로 지정할 수 있습니다. 묶음/그룹 수업은 배치 상세의 구성 과목별 교실에서 수정합니다.";
        occBody.appendChild(occNote);

        if (editableOccurrenceCount) {
          const occSave = document.createElement("button");
          occSave.type = "button";
          occSave.className = "tt-ce-occ-save";
          occSave.textContent = "회차별 교실 저장";
          occSave.disabled = !canEdit;
          occSave.addEventListener("click", async () => {
            const changes = [...occList.querySelectorAll("select[data-entry-id]")]
              .filter(select => !select.disabled && clean(select.value) !== clean(select.dataset.originalRoomId))
              .map(select => ({ entryId: select.dataset.entryId, roomId: select.value }));
            if (!changes.length) {
              occSave.textContent = "변경 없음";
              setTimeout(() => { occSave.textContent = "회차별 교실 저장"; }, 1200);
              return;
            }
            occSave.disabled = true;
            occSave.textContent = "저장 중…";
            try {
              const result = await context.applyOccurrenceRooms?.(card.id, changes);
              if (result === false) throw new Error("회차별 교실 변경을 저장하지 못했습니다.");
              occSave.textContent = "저장됨";
              setTimeout(() => renderEditor(), 250);
            } catch (error) {
              alert(`회차별 교실 저장에 실패했습니다.\n${error?.message || error}`);
              occSave.disabled = !canEdit;
              occSave.textContent = "회차별 교실 저장";
            }
          });
          occBody.appendChild(occSave);
        }
        occSection.appendChild(occBody);
        editor.appendChild(occSection);
      }

      const timeSection = document.createElement("section"); timeSection.className = "tt-ce-section"; timeSection.innerHTML = "<h3>배정 가능·불가 시간</h3>";
      const timeBody = document.createElement("div"); timeBody.className = "tt-ce-secbody";
      const allowed = normalizeSlots(card.allowedSlots || card.availableSlots || [], periodCount());
      const unavailable = normalizeSlots(card.unavailableSlots || [], periodCount());
      const mode = allowed.length ? "allowed" : unavailable.length ? "unavailable" : "none";
      const timeHead = document.createElement("div"); timeHead.className = "tt-ce-time-head"; timeHead.innerHTML = `<select data-field="timeMode"><option value="none">시간 제한 없음</option><option value="allowed">선택 시간만 가능</option><option value="unavailable">선택 시간 불가</option></select><span>선택한 모드에 따라 아래 칸의 의미가 바뀝니다.</span>`;
      const modeSel = timeHead.querySelector("select"); modeSel.value = mode; timeBody.appendChild(timeHead);
      const grid = document.createElement("div"); grid.className = "tt-ce-timegrid";
      const selectedSlots = new Set((mode === "allowed" ? allowed : unavailable).map(slot => slotKey(slot.day, slot.period)));
      const corner = document.createElement("div"); corner.className = "tt-ce-timecell hdr"; corner.textContent = "교시"; grid.appendChild(corner);
      DAY_LABELS.forEach(day => { const h=document.createElement("div"); h.className="tt-ce-timecell hdr"; h.textContent=day; grid.appendChild(h); });
      for (let p=0;p<periodCount();p+=1) {
        const ph=document.createElement("div"); ph.className="tt-ce-timecell hdr"; ph.textContent=`${p+1}`; grid.appendChild(ph);
        for (let d=0;d<5;d+=1) {
          const btn=document.createElement("button"); btn.type="button"; btn.dataset.day=String(d); btn.dataset.period=String(p); btn.className=`tt-ce-timecell${selectedSlots.has(slotKey(d,p)) ? " on" : ""}${mode === "unavailable" ? " danger" : ""}`; btn.textContent=selectedSlots.has(slotKey(d,p)) ? "●" : "";
          btn.addEventListener("click",()=>{ const key=slotKey(d,p); if(selectedSlots.has(key)) selectedSlots.delete(key); else selectedSlots.add(key); refreshGrid(); }); grid.appendChild(btn);
        }
      }
      const refreshGrid = () => {
        const currentMode = modeSel.value;
        grid.querySelectorAll("button[data-day]").forEach(btn => { const key=slotKey(btn.dataset.day,btn.dataset.period); const on=selectedSlots.has(key); btn.className=`tt-ce-timecell${on?" on":""}${currentMode==="unavailable"?" danger":""}`; btn.textContent=on?"●":""; btn.disabled=currentMode==="none"; });
        grid.style.opacity = currentMode === "none" ? ".48" : "1";
      };
      modeSel.addEventListener("change",()=>{ selectedSlots.clear(); refreshGrid(); });
      timeBody.appendChild(grid);
      const note=document.createElement("div"); note.className="tt-ce-note"; note.textContent="연속교시 수와 여러 교실 동시 사용 조건은 현재 하단 ‘조건’ 기능을 그대로 사용합니다. 이 편집기는 기존 조건 로직을 중복 생성하지 않습니다."; timeBody.appendChild(note);
      timeSection.appendChild(timeBody); editor.appendChild(timeSection); refreshGrid();

      const actions = document.createElement("div"); actions.className = "tt-ce-actions";
      const save = document.createElement("button"); save.type="button"; save.className="primary"; save.textContent="카드 설정 저장"; save.disabled=!canEdit;
      const cloneBtn = document.createElement("button"); cloneBtn.type="button"; cloneBtn.textContent="＋ 이 카드 복제"; cloneBtn.disabled=!canEdit; cloneBtn.title="현재 카드의 학년·교사·대상반·시수·교실·시간조건을 복사한 독립 수동카드를 만듭니다.";
      const deleteBtn = document.createElement("button"); deleteBtn.type="button"; deleteBtn.className="danger"; deleteBtn.textContent="수동카드 삭제"; deleteBtn.disabled=!canEdit || !isManualCard(card); deleteBtn.style.display=isManualCard(card)?"":"none";
      const closeBtn = document.createElement("button"); closeBtn.type="button"; closeBtn.textContent="닫기"; closeBtn.addEventListener("click",close);
      const status=document.createElement("span"); status.textContent=canEdit?"복제 카드는 자동배치 제외 상태로 만들어집니다.":"읽기 전용";
      actions.append(save, cloneBtn, deleteBtn, closeBtn, status); editor.appendChild(actions);

      cloneBtn.addEventListener("click", async () => {
        if (!confirm(`‘${cardTitle(card)}’ 카드를 독립 수동카드로 복제할까요?\n\n복제본은 자동배치 제외 상태로 생성되며, 과목명·교사·반·시수를 수정한 뒤 자동배치 포함으로 전환할 수 있습니다.`)) return;
        cloneBtn.disabled = true;
        cloneBtn.textContent = "복제 중…";
        status.textContent = "";
        try {
          const newId = await context.cloneCard?.(card.id);
          if (!newId) throw new Error("복제된 카드 ID를 받지 못했습니다.");
          selectedCardId = newId;
          status.textContent = "복제됨 · 자동배치 제외";
          renderGradeFilter();
          renderList();
          renderEditor();
        } catch (error) {
          alert(`카드 복제에 실패했습니다.\n${error?.message || error}`);
          cloneBtn.disabled = !canEdit;
          cloneBtn.textContent = "＋ 이 카드 복제";
          status.textContent = "복제 실패";
        }
      });

      deleteBtn.addEventListener("click", async () => {
        if (!isManualCard(card)) return;
        if (!confirm(`수동카드 ‘${cardTitle(card)}’를 완전히 삭제할까요?\n\n현재 시간표에 배치되어 있거나 묶음수업에 연결된 카드는 삭제되지 않습니다.`)) return;
        deleteBtn.disabled = true;
        deleteBtn.textContent = "삭제 중…";
        try {
          const result = await context.deleteManualCard?.(card.id);
          if (result === false) throw new Error("수동카드를 삭제하지 못했습니다.");
          selectedCardId = cards.find(row => row.id !== card.id)?.id || "";
          renderGradeFilter();
          renderList();
          renderEditor();
        } catch (error) {
          alert(`수동카드 삭제에 실패했습니다.\n${error?.message || error}`);
          deleteBtn.disabled = !canEdit;
          deleteBtn.textContent = "수동카드 삭제";
        }
      });

      save.addEventListener("click", async () => {
        const selectedTeacherNames = [...editor.querySelectorAll('input[data-kind="teacher"]:checked')].map(box => box.value);
        const teacherByName = new Map(getTeachers().map(row => [teacherName(row), teacherId(row)]));
        const selectedClassKeys = [...editor.querySelectorAll('input[data-kind="class"]:checked')].map(box => box.value);
        if (!selectedClassKeys.length) { alert("대상 학급을 한 개 이상 선택하세요."); return; }
        const credit = Number(editor.querySelector('[data-field="credits"]')?.value || 0);
        if (!Number.isFinite(credit) || credit < 0) { alert("주당 시수를 확인하세요."); return; }
        const rule = roomRule.value;
        if (rule === "fixed" && !fixedRoom.value) { alert("지정 교실을 선택하세요."); return; }
        const classLabelByKey = new Map(classes.map(row => [row.key, row.label]));
        const slots = [...selectedSlots].map(key => { const [day,period]=key.split(":").map(Number); return {day,period}; });
        const manualSubject = isManualCard(card) ? clean(editor.querySelector('[data-field="subject"]')?.value) : "";
        const manualSubjectEn = isManualCard(card) ? clean(editor.querySelector('[data-field="subjectEn"]')?.value) : "";
        if (isManualCard(card) && !manualSubject) { alert("수동카드 과목명을 입력하세요."); return; }
        const patch = {
          subject: manualSubject,
          subjectEn: manualSubjectEn,
          teacherNames: selectedTeacherNames,
          teacherIds: unique(selectedTeacherNames.map(name => teacherByName.get(name))),
          classKeys: selectedClassKeys,
          classLabels: selectedClassKeys.map(key => classLabelByKey.get(key) || key.replace(":","")),
          credits: credit,
          roomRule: rule,
          fixedRoomId: rule === "fixed" ? fixedRoom.value : null,
          autoAssignExcluded: !autoInclude.checked,
          allowedSlots: modeSel.value === "allowed" ? normalizeSlots(slots, periodCount()) : [],
          unavailableSlots: modeSel.value === "unavailable" ? normalizeSlots(slots, periodCount()) : [],
          isWholeGrade: classes.length > 1 && selectedClassKeys.length === classes.length,
        };
        save.disabled=true; save.textContent="저장 중…"; status.textContent="";
        try {
          const result = await context.applyCardPatch?.(card.id, patch);
          if (result === false) throw new Error("카드 변경을 저장하지 못했습니다.");
          status.textContent="저장됨"; selectedCardId=card.id; renderList(); renderEditor();
        } catch (error) {
          alert(`카드 설정 저장에 실패했습니다.\n${error?.message || error}`);
          save.disabled=false; save.textContent="카드 설정 저장"; status.textContent="저장 실패";
        }
      });
    };

    search.value = searchText;
    search.addEventListener("input",()=>{ searchText=search.value; renderList(); });
    renderGradeFilter(); renderList(); renderEditor();
  }

  return { open };
}
