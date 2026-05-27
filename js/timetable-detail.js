// ================================================================
// timetable-detail.js · Detail modals and context menu
// ================================================================
import { appState, scheduleSave } from "./state.js";
import { canEdit } from "./auth.js";
import { getRooms } from "./rooms.js";
import { sectionLabel, gradeDisplay } from "./utils.js";
import {
  entryTitle, entryTeachers, entryGradeKeys, getTtCardClassLabels, getUnitDisplayTitle,
  describeTtCard
} from "./timetable-data.js";
import { getTtCardById } from "./ttcards.js";

function removeExistingModal() {
  const existing = document.getElementById("tt-entry-detail-modal");
  if (existing) existing.remove();
}

function makeModal({ maxWidth = 440, minWidth = 300 } = {}) {
  removeExistingModal();
  const modal = document.createElement("div");
  modal.id = "tt-entry-detail-modal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:9999;display:flex;align-items:center;justify-content:center";

  const box = document.createElement("div");
  box.style.cssText = `background:white;border-radius:10px;padding:18px 20px;min-width:${minWidth}px;max-width:${maxWidth}px;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.25);font-size:13px;position:relative`;

  const closeBtn = document.createElement("button");
  closeBtn.style.cssText = "position:absolute;top:10px;right:12px;border:none;background:transparent;font-size:18px;cursor:pointer;color:#9ca3af;line-height:1";
  closeBtn.textContent = "×";
  closeBtn.onclick = () => modal.remove();

  modal.appendChild(box);
  modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
  return { modal, box, closeBtn };
}

function formatClassLabel(gradeKey, sectionText) {
  const grade = gradeDisplay(gradeKey);
  const section = String(sectionText ?? "").trim();
  if (!section) return grade || "-";
  const compact = section.replace(/\s+/g, "").replace(/학년/g, "");
  if (/^\d{1,2}[A-Za-z가-힣0-9]/.test(compact)) return compact;
  return `${grade}${section}`;
}

function formatClassLabelList(gradeKey, labels = []) {
  const rawLabels = (Array.isArray(labels) ? labels : [labels])
    .flatMap(label => String(label ?? "")
      .split(/[,，·\/]+/)
      .map(x => x.trim())
      .filter(Boolean));
  const normalized = rawLabels.length ? rawLabels : [""];
  return [...new Set(normalized.map(label => formatClassLabel(gradeKey, label)))].join(", ") || "-";
}


function getGroupDetailCards(entry) {
  if (!entry) return [];
  const directIds = [entry.ttcardId, ...(entry.ttcardIds || [])].filter(Boolean);
  const group = entry.groupId
    ? (appState.timetable.ttcardGroups || []).find(g => g.id === entry.groupId)
    : null;

  let ids = [...directIds];

  if (group) {
    const unit = entry.unitId ? (group.units || []).find(u => u.id === entry.unitId) : null;
    if (unit?.ttcardIds?.length) {
      ids = [...ids, ...unit.ttcardIds];
    } else if (!ids.length) {
      ids = [
        ...(group.poolCardIds || []),
        ...(group.units || []).flatMap(u => u.ttcardIds || [])
      ];
    }
  }

  const seen = new Set();
  return ids
    .filter(id => id && !seen.has(id) && seen.add(id))
    .map(id => getTtCardById(id))
    .filter(Boolean)
    .map(describeTtCard);
}

function appendGroupDetailSection(box, detailItems, { title = "구성 과목" } = {}) {
  if (!detailItems?.length) return;

  const section = document.createElement("div");
  section.style.cssText = "margin:10px 0 10px;padding:10px;border:1px solid #e2e8f0;border-radius:9px;background:#f8fafc";

  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:7px";
  const h = document.createElement("div");
  h.style.cssText = "font-size:12px;font-weight:800;color:#334155";
  h.textContent = title;
  const count = document.createElement("span");
  count.style.cssText = "font-size:10px;font-weight:800;color:#166534;background:#dcfce7;border-radius:999px;padding:2px 7px";
  count.textContent = `${detailItems.length}개`;
  header.append(h, count);
  section.appendChild(header);

  const list = document.createElement("div");
  list.style.cssText = "display:flex;flex-direction:column;gap:5px";
  detailItems.forEach(item => {
    const row = document.createElement("div");
    row.style.cssText = "display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center;padding:7px 8px;border:1px solid #e5e7eb;border-radius:8px;background:white";

    const main = document.createElement("div");
    main.style.cssText = "min-width:0";
    const name = document.createElement("div");
    name.style.cssText = "font-size:12px;font-weight:800;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
    name.textContent = item.title || item.subject || "-";
    name.title = name.textContent;

    const sub = document.createElement("div");
    sub.style.cssText = "font-size:10px;color:#64748b;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
    const cls = formatClassLabelList(
      item.gradeKey,
      item.classLabels?.length ? item.classLabels : [item.sectionLabel || sectionLabel(item.sectionIdx ?? 0)]
    );
    sub.textContent = `${cls} · ${(item.teachers || []).join(", ") || "교사 없음"}`;
    sub.title = sub.textContent;
    main.append(name, sub);

    const credit = document.createElement("span");
    credit.style.cssText = "font-size:10px;font-weight:800;color:#334155;background:#e2e8f0;border-radius:999px;padding:2px 7px;white-space:nowrap";
    credit.textContent = `${item.credits || "-"}시수`;

    row.append(main, credit);
    list.appendChild(row);
  });
  section.appendChild(list);
  box.appendChild(section);
}

export function createTimetableDetailHandlers(ctx) {
  const entries = () => ctx.entries();
  const ttConfig = () => ctx.ttConfig();
  const currentGrade = () => ctx.currentGrade();

  function showSidebarCardDetail({ title, teachers, gradeKeys, credits, assigned, isDone, sectionIdx, groupName, detailItems = [] }) {
    const { modal, box, closeBtn } = makeModal({ maxWidth: 460, minWidth: 300 });

    const firstGrade = gradeKeys[0] || currentGrade();
    const gc = ctx.getGradeColor(firstGrade);
    box.style.borderTop = `4px solid ${gc.border}`;

    const titleEl = document.createElement("div");
    titleEl.style.cssText = "font-weight:700;font-size:15px;margin-bottom:10px;color:#1e3a5f;padding-right:20px";
    titleEl.textContent = title;
    box.appendChild(titleEl);

    const rows = [
      ["학년", gradeKeys.map(g => gradeDisplay(g)).join(", ") || "-"],
      ["반", detailItems.length ? `${detailItems.length}개 구성 카드` : (sectionIdx != null ? formatClassLabel(firstGrade, sectionLabel(sectionIdx)) : "-")],
      ["담당 교사", teachers.join(", ") || "-"],
      ["시수", String(credits || "-")],
      ["배정 현황", `${assigned} / ${credits} 차시${isDone ? "  ✅ 완료" : ""}`],
      ["그룹", groupName || "미배정"],
    ];

    rows.forEach(([lbl, val]) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:8px;margin-bottom:5px;font-size:12px;align-items:baseline";
      const l = document.createElement("span");
      l.style.cssText = "color:#6b7280;font-weight:600;width:72px;flex-shrink:0";
      l.textContent = lbl;
      const v = document.createElement("span");
      v.style.cssText = "color:#1e293b;flex:1";
      v.textContent = val;
      row.append(l, v);
      box.appendChild(row);
    });

    if (detailItems.length) {
      const listTitle = document.createElement("div");
      listTitle.style.cssText = "margin-top:12px;margin-bottom:6px;font-size:12px;font-weight:700;color:#475569";
      listTitle.textContent = "구성 카드";
      box.appendChild(listTitle);

      const list = document.createElement("div");
      list.style.cssText = "display:flex;flex-direction:column;gap:5px";
      detailItems.forEach(item => {
        const row = document.createElement("div");
        row.style.cssText = "display:grid;grid-template-columns:1fr auto;gap:6px;padding:7px 9px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc";
        const main = document.createElement("div");
        main.style.cssText = "min-width:0";
        const nm = document.createElement("div");
        nm.style.cssText = "font-weight:700;color:#1e293b;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
        nm.textContent = item.title;
        const sub = document.createElement("div");
        sub.style.cssText = "font-size:10px;color:#64748b;margin-top:2px";
        const itemClassLabel = formatClassLabelList(item.gradeKey, item.classLabels?.length ? item.classLabels : [item.sectionLabel || sectionLabel(item.sectionIdx ?? 0)]);
        sub.textContent = `${itemClassLabel} · ${(item.teachers || []).join(", ") || "교사 없음"}`;
        main.append(nm, sub);
        const cr = document.createElement("div");
        cr.style.cssText = "font-size:10px;font-weight:700;color:#334155;align-self:center;background:#e2e8f0;border-radius:999px;padding:2px 7px";
        cr.textContent = `${item.credits || "-"}시수`;
        row.append(main, cr);
        list.appendChild(row);
      });
      box.appendChild(list);
    }

    if (credits > 0) {
      const pct = Math.min(100, Math.round((assigned / credits) * 100));
      const bar = document.createElement("div");
      bar.style.cssText = "margin-top:10px;background:#f1f5f9;border-radius:999px;height:6px;overflow:hidden";
      const fill = document.createElement("div");
      fill.style.cssText = `height:100%;border-radius:999px;width:${pct}%;background:${isDone ? "#22c55e" : "#3b82f6"};transition:width .3s`;
      bar.appendChild(fill);
      box.appendChild(bar);
    }

    box.appendChild(closeBtn);
    document.body.appendChild(modal);
  }

  function showEntryDetailByUnit(unit, group, gradeKeys) {
    const { modal, box, closeBtn } = makeModal({ maxWidth: 340, minWidth: 260 });
    box.innerHTML = `<div style="font-weight:700;font-size:14px;margin-bottom:8px;color:#1e3a5f">${getUnitDisplayTitle(unit)}</div>
      <div style="font-size:11px;color:#6b7280;margin-bottom:4px">그룹: ${group?.name || "-"}</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">${gradeKeys.map(g => `<span style="background:${ctx.getGradeColor(g).border};color:white;font-size:10px;font-weight:700;padding:1px 7px;border-radius:999px">${gradeDisplay(g)}</span>`).join("")}</div>`;
    box.appendChild(closeBtn);
    document.body.appendChild(modal);
  }

  function showEntryContextMenu(entry, x, y) {
    document.getElementById("tt-context-menu")?.remove();
    const menu = document.createElement("div");
    menu.id = "tt-context-menu";
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:white;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.15);z-index:9998;min-width:180px;overflow:hidden;font-size:12px`;

    function menuItem(label, action, opts = {}) {
      const btn = document.createElement("div");
      btn.style.cssText = `padding:8px 14px;cursor:${opts.disabled ? "default" : "pointer"};color:${opts.danger ? "#dc2626" : opts.disabled ? "#9ca3af" : "#1e293b"};display:flex;align-items:center;gap:8px`;
      btn.innerHTML = label;
      if (!opts.disabled) {
        btn.onmouseenter = () => { btn.style.background = "#f8fafc"; };
        btn.onmouseleave = () => { btn.style.background = ""; };
        btn.onclick = () => { menu.remove(); action?.(); };
      }
      return btn;
    }
    function sep() {
      const hr = document.createElement("div");
      hr.style.cssText = "height:1px;background:#f1f5f9;margin:2px 0";
      return hr;
    }

    menu.appendChild(menuItem("📋 수업 정보 편집", () => showEntryDetail(entry)));
    menu.appendChild(menuItem("📅 배정 현황 보기", () => showSubjectAssignmentHistory(entry)));
    menu.appendChild(menuItem("🔍 하단 카드에서 찾기", () => highlightSidebarCard(entry)));
    menu.appendChild(sep());
    menu.appendChild(menuItem(entry.pinned ? "📌 고정 해제" : "📍 이 시간에 고정", () => {
      const e = entries().find(x => x.id === entry.id);
      if (e) {
        ctx.captureTimetableUndo("수업 고정 변경");
        e.pinned = !e.pinned;
        scheduleSave("timetable");
        ctx.renderAll();
      }
    }));
    menu.appendChild(sep());
    menu.appendChild(menuItem("🗑 이 수업 삭제", () => {
      ctx.removeEntry(entry.id);
      ctx.recomputeConflicts();
      ctx.renderAll();
    }, { danger: true }));

    setTimeout(() => {
      document.addEventListener("click", () => menu.remove(), { once: true });
      document.addEventListener("contextmenu", () => menu.remove(), { once: true });
    }, 10);

    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = `${x - rect.width}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${y - rect.height}px`;
  }

  function showSubjectAssignmentHistory(entry) {
    const { modal, box, closeBtn } = makeModal({ maxWidth: 440, minWidth: 300 });
    const gradeKeys = entryGradeKeys(entry);
    const gc = ctx.getGradeColor(gradeKeys[0] || currentGrade());
    box.style.borderTop = `4px solid ${gc.border}`;

    const titleEl = document.createElement("div");
    titleEl.style.cssText = "font-weight:700;font-size:15px;margin-bottom:12px;color:#1e3a5f;padding-right:24px";
    titleEl.textContent = `${entryTitle(entry)} — 배정 현황`;
    box.appendChild(titleEl);

    const tplId = entry.templateId || entry.templateIds?.[0];
    const grpId = entry.groupId;
    const related = entries().filter(e => {
      if (grpId && e.groupId === grpId) return true;
      if (tplId && (e.templateId === tplId || e.templateIds?.includes(tplId))) return true;
      return false;
    }).sort((a, b) => a.day - b.day || a.period - b.period);

    const dayLabels = ["월", "화", "수", "목", "금"];
    const periods = ttConfig().periodLabels || [];

    if (!related.length) {
      box.appendChild(Object.assign(document.createElement("div"), { textContent: "배정된 시수가 없습니다.", style: "color:#9ca3af;font-size:12px" }));
    } else {
      const list = document.createElement("div");
      list.style.cssText = "display:flex;flex-direction:column;gap:4px";
      related.forEach((e, i) => {
        const row = document.createElement("div");
        row.style.cssText = `display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:6px;background:${e.id === entry.id ? gc.bg + "99" : "#f8fafc"};border:1px solid ${e.id === entry.id ? gc.border : "#e2e8f0"};cursor:pointer`;
        const idxEl = document.createElement("span");
        idxEl.style.cssText = "font-size:10px;color:#6b7280;width:18px;text-align:center;font-weight:700";
        idxEl.textContent = i + 1;
        const slotEl = document.createElement("span");
        slotEl.style.cssText = "font-weight:700;color:#1e293b";
        slotEl.textContent = `${dayLabels[e.day]} ${periods[e.period] || `${e.period + 1}교시`}`;
        const secEl = document.createElement("span");
        secEl.style.cssText = "font-size:10px;color:#6b7280;flex:1";
        secEl.textContent = ctx.getEntryClassSummary(e);
        const pinEl = document.createElement("span");
        if (e.pinned) { pinEl.textContent = "📌"; pinEl.style.fontSize = "10px"; }
        row.append(idxEl, slotEl, secEl, pinEl);
        row.onclick = () => { modal.remove(); showEntryDetail(e); };
        list.appendChild(row);
      });
      box.appendChild(list);

      const tplCredits = (() => {
        const g = gradeKeys[0] || currentGrade();
        const row = (appState.curriculum.gradeBoards[g] || []).find(r => r.sem1TemplateId === tplId || r.sem2TemplateId === tplId);
        return row?.credits ?? "?";
      })();
      const sumEl = document.createElement("div");
      sumEl.style.cssText = "margin-top:10px;font-size:11px;color:#6b7280;text-align:right";
      sumEl.textContent = `${related.length} / ${tplCredits} 시수 배정됨`;
      box.appendChild(sumEl);
    }

    box.appendChild(closeBtn);
    document.body.appendChild(modal);
  }

  function highlightSidebarCard(entry) {
    const tplId = entry.templateId || entry.templateIds?.[0];
    const grpId = entry.groupId;
    document.querySelectorAll(".tt-sc-highlighted").forEach(el => el.classList.remove("tt-sc-highlighted"));
    document.querySelectorAll(".tt-subject-card").forEach(card => {
      const grpMatch = grpId && card.dataset.groupId === grpId;
      const tplMatch = tplId && card.dataset.templateId === tplId;
      if (grpMatch || tplMatch) {
        card.classList.add("tt-sc-highlighted");
        card.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
      }
    });
    setTimeout(() => document.querySelectorAll(".tt-sc-highlighted").forEach(el => el.classList.remove("tt-sc-highlighted")), 3000);
  }

  function showEntryDetail(entry) {
    const { modal, box, closeBtn } = makeModal({ maxWidth: 400, minWidth: 300 });
    const gradeKeys = entryGradeKeys(entry);
    const gc = ctx.getGradeColor(gradeKeys[0] || currentGrade());
    box.style.borderTop = `4px solid ${gc.border}`;

    const titleEl = document.createElement("div");
    titleEl.style.cssText = "font-weight:700;font-size:15px;margin-bottom:8px;color:#1e3a5f;padding-right:24px";
    titleEl.textContent = entryTitle(entry);
    box.appendChild(titleEl);

    function makeRow(label, value) {
      const r = document.createElement("div");
      r.style.cssText = "display:flex;align-items:baseline;gap:8px;margin-bottom:6px;font-size:12px";
      const l = document.createElement("span");
      l.style.cssText = "color:#6b7280;font-weight:600;width:70px;flex-shrink:0";
      l.textContent = label;
      const v = document.createElement("span");
      v.style.cssText = "color:#1e293b;flex:1";
      v.textContent = value;
      r.append(l, v);
      box.appendChild(r);
      return r;
    }

    makeRow("학년/반", ctx.getEntryClassSummary(entry));

    const teachers = entryTeachers(entry);
    const tLabel = document.createElement("label");
    tLabel.style.cssText = "display:block;margin-bottom:3px;font-size:11px;color:#6b7280;font-weight:600";
    tLabel.textContent = "담당 교사";
    const tSel = document.createElement("select");
    tSel.style.cssText = "width:100%;padding:5px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;margin-bottom:8px";
    tSel.disabled = !canEdit();
    [{ v: "", l: "교사 없음" }, ...teachers.map(t => ({ v: t, l: t }))].forEach(({ v, l }) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = l;
      if (v === entry.teacherName) o.selected = true;
      tSel.appendChild(o);
    });
    tSel.addEventListener("change", e => {
      ctx.updateEntry(entry.id, "teacherName", e.target.value || null);
      ctx.recomputeConflicts();
      ctx.renderAll();
    });
    box.append(tLabel, tSel);

    const tplId = entry.templateId || entry.templateIds?.[0];
    if (tplId) {
      const credits = (() => {
        const row = (appState.curriculum.gradeBoards[gradeKeys[0] || currentGrade()] || []).find(r => r.sem1TemplateId === tplId || r.sem2TemplateId === tplId);
        return row?.credits ?? "-";
      })();
      const assigned = entries().filter(e => (e.templateId === tplId || e.templateIds?.includes(tplId)) && e.gradeKey === (gradeKeys[0] || currentGrade())).length;
      makeRow("시수/배정", `${assigned} / ${credits} 차시`);
    }

    if (entry.groupId) {
      const grp = (appState.timetable.ttcardGroups || []).find(g => g.id === entry.groupId);
      makeRow("그룹", grp?.name || entry.groupId);
      const detailCards = getGroupDetailCards(entry);
      appendGroupDetailSection(box, detailCards, { title: entry.unitId ? "묶음수업 구성" : "그룹 구성 과목" });
    }

    const rLabel = document.createElement("label");
    rLabel.style.cssText = "display:block;margin-bottom:3px;font-size:11px;color:#6b7280;font-weight:600";
    rLabel.textContent = "교실";
    const rSel = document.createElement("select");
    rSel.style.cssText = "width:100%;padding:5px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;margin-bottom:8px";
    rSel.disabled = !canEdit();
    const noR = document.createElement("option");
    noR.value = "";
    noR.textContent = "교실 없음";
    rSel.appendChild(noR);
    getRooms().forEach(r => {
      const o = document.createElement("option");
      o.value = r.id;
      o.textContent = r.name;
      if (r.id === entry.roomId) o.selected = true;
      rSel.appendChild(o);
    });
    rSel.addEventListener("change", e => {
      ctx.updateEntry(entry.id, "roomId", e.target.value || null);
      ctx.recomputeConflicts();
      ctx.renderAll();
    });
    box.append(rLabel, rSel);

    ctx.renderEntryConflictDetailSection(box, entry);

    const dayLabels = ["월", "화", "수", "목", "금"];
    const periods = ttConfig().periodLabels || [];
    const dtRow = document.createElement("div");
    dtRow.style.cssText = "display:flex;gap:6px;margin-bottom:8px";
    const dayLabel = document.createElement("label");
    dayLabel.style.cssText = "font-size:11px;color:#6b7280;font-weight:600;display:block;margin-bottom:3px";
    dayLabel.textContent = "요일";
    const daySel = document.createElement("select");
    daySel.style.cssText = "padding:5px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;flex:1";
    daySel.disabled = !canEdit();
    dayLabels.forEach((l, i) => {
      const o = document.createElement("option");
      o.value = i;
      o.textContent = l;
      if (i === entry.day) o.selected = true;
      daySel.appendChild(o);
    });
    const perLabel = document.createElement("label");
    perLabel.style.cssText = "font-size:11px;color:#6b7280;font-weight:600;display:block;margin-bottom:3px";
    perLabel.textContent = "교시";
    const perSel = document.createElement("select");
    perSel.style.cssText = "padding:5px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;flex:1";
    perSel.disabled = !canEdit();
    periods.forEach((l, i) => {
      const o = document.createElement("option");
      o.value = i;
      o.textContent = `${i + 1}교시`;
      if (i === entry.period) o.selected = true;
      perSel.appendChild(o);
    });
    const dayWrap = document.createElement("div");
    dayWrap.style.flex = "1";
    dayWrap.append(dayLabel, daySel);
    const perWrap = document.createElement("div");
    perWrap.style.flex = "1";
    perWrap.append(perLabel, perSel);

    const applySlot = () => {
      const d = parseInt(daySel.value);
      const p = parseInt(perSel.value);
      ctx.moveEntry(entry.id, d, p);
      ctx.recomputeConflicts();
      ctx.renderAll();
    };
    daySel.addEventListener("change", applySlot);
    perSel.addEventListener("change", applySlot);
    dtRow.append(dayWrap, perWrap);
    box.appendChild(dtRow);

    if (canEdit()) {
      const pinBtn = document.createElement("button");
      pinBtn.style.cssText = "width:100%;padding:5px;border:1px solid #d1d5db;border-radius:5px;background:#f8fafc;font-size:12px;cursor:pointer;margin-bottom:8px;font-weight:600";
      pinBtn.textContent = entry.pinned ? "📌 고정 해제" : "📍 이 시간에 고정";
      pinBtn.onclick = () => {
        const e = entries().find(x => x.id === entry.id);
        if (!e) return;
        ctx.captureTimetableUndo("수업 고정 변경");
        e.pinned = !e.pinned;
        scheduleSave("timetable");
        ctx.renderAll();
        modal.remove();
      };
      box.appendChild(pinBtn);
    }

    if (canEdit()) {
      const delBtn = document.createElement("button");
      delBtn.style.cssText = "width:100%;padding:6px;border:1px solid #fca5a5;border-radius:5px;background:#fef2f2;color:#dc2626;cursor:pointer;font-size:12px;font-weight:600";
      delBtn.textContent = "🗑 이 수업 삭제";
      delBtn.onclick = () => {
        ctx.removeEntry(entry.id);
        ctx.recomputeConflicts();
        ctx.renderAll();
        modal.remove();
      };
      box.appendChild(delBtn);
    }

    box.appendChild(closeBtn);
    document.body.appendChild(modal);
  }

  return {
    showSidebarCardDetail,
    showEntryDetailByUnit,
    showEntryContextMenu,
    showSubjectAssignmentHistory,
    highlightSidebarCard,
    showEntryDetail,
  };
}
