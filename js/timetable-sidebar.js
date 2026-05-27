// ================================================================
// timetable-sidebar.js · Bottom Subject/Card Panel Rendering
// ================================================================

/**
 * Creates handlers for the timetable bottom card panel.
 * The module is intentionally dependency-injected so timetable.js can keep
 * the single source of truth for current drag state and render orchestration.
 */
export function createTimetableSidebarHandlers(deps) {
  const {
    GRADE_KEYS, appState, entries, $, makeBtn, canEdit,
    getTemplateById, getTemplateCardTitle,
    getTtCards, refreshTtCardData,
    getGroupCards, getCreditsForTtCard, getTeachersForTtCard, describeTtCard,
    getSubjectsForGrade, getUnitForTemplate, getUnitGradeKeys, getUnitTeachers,
    getCreditsForTemplate, getSectionCount, entryTemplateIds, entryHasGrade,
    getGradeColor, gradeDisplay, sectionLabel,
    showSidebarCardDetail, showEntryDetailByUnit,
    renderAll, setDragData,
  } = deps;

  function setDragging(value) {
    if (typeof setDragData === "function") setDragData(value);
  }

  function renderSubjectPanel() {
    const panel = $("ttSubjectsContent");
    if (!panel) return;
    panel.innerHTML = "";

    const toolbar = document.createElement("div");
    toolbar.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:8px;padding:6px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc";

    const loadBtn = makeBtn("📥 카드 불러오기", "secondary-btn compact-btn", () => {
      renderSubjectPanel();
      alert(`저장된 시간표 카드 ${getTtCards().length}개를 불러왔습니다.`);
    });

    const refreshBtn = makeBtn("🔄 카드 데이터 갱신", "secondary-btn compact-btn", () => {
      if (!canEdit()) return;
      const n = refreshTtCardData();
      alert(`${n}개 카드 데이터를 갱신했습니다.`);
      renderAll();
    });
    refreshBtn.disabled = !canEdit();

    toolbar.append(loadBtn, refreshBtn);
    panel.appendChild(toolbar);

    const ttcards = appState.timetable?.ttcards || [];
    if (ttcards.length > 0) {
      renderSubjectPanelTtCards(panel, ttcards);
      return;
    }

    renderSubjectPanelLegacy(panel);
  }

  function renderSubjectPanelTtCards(panel, allTtcards) {
    const availableCards = [];
    const doneCards = [];
    const seenIds = new Set();
    const grpList = appState.templates.templateGroups || [];

    // ── Groups: one card per group ──────────────────────────────
    grpList.forEach(grp => {
      const grpCards = getGroupCards(grp);
      grpCards.forEach(c => seenIds.add(c.id));
      if (!grpCards.length) return;

      const gradeKeys = [...new Set(grpCards.map(c => c.gradeKey).filter(Boolean))];
      const credits = Math.max(1, ...grpCards.map(getCreditsForTtCard).filter(v => v > 0));
      const teachers = [...new Set(grpCards.flatMap(c => getTeachersForTtCard(c)).filter(Boolean))];
      const relatedEntries = entries().filter(e =>
        e.groupId === grp.id || grpCards.some(c => e.ttcardId === c.id || (e.ttcardIds || []).includes(c.id))
      );
      const assigned = new Set(relatedEntries.map(e => `${e.day}:${e.period}`)).size;
      const isDone = credits > 0 && assigned >= credits;
      const gradeColor = getGradeColor(gradeKeys[0] || "7학년");
      const detailItems = grpCards.map(describeTtCard);
      const title = `[${grp.name}] ${detailItems.map(i => i.title).join(" · ")}`;
      const card = buildSidebarCard({ title, teachers, gradeKeys, credits, assigned, isDone, gradeColor, groupName: grp.name, detailItems });
      card.dataset.groupId = grp.id;
      card.style.outline = "1.5px solid " + gradeColor.border;
      if (!isDone) {
        card.addEventListener("dragstart", () => {
          setDragging({ kind: "group", groupId: grp.id, ttcardIds: grpCards.map(c => c.id), gradeKey: gradeKeys[0] });
          card.classList.add("tt-dragging");
        });
        card.addEventListener("dragend", () => {
          setDragging(null);
          card.classList.remove("tt-dragging");
        });
      }
      (isDone ? doneCards : availableCards).push(card);
    });

    // ── Standalone ttcards (not in any group) ────────────────────
    allTtcards.forEach(c => {
      if (seenIds.has(c.id)) return;
      const gradeColor = getGradeColor(c.gradeKey);
      const credits = getCreditsForTtCard(c);
      const desc = describeTtCard(c);
      const assigned = entries().filter(e =>
        (e.ttcardId === c.id || (e.ttcardIds || []).includes(c.id)) ||
        (entryTemplateIds(e).includes(c.templateId) && entryHasGrade(e, c.gradeKey) && (e.sectionIdx ?? 0) === c.sectionIdx)
      ).length;
      const isDone = credits > 0 && assigned >= credits;
      const card = buildSidebarCard({
        title: desc.title,
        teachers: getTeachersForTtCard(c),
        gradeKeys: [c.gradeKey],
        credits,
        assigned,
        isDone,
        gradeColor,
        sectionIdx: c.sectionIdx,
        detailItems: [desc]
      });
      card.dataset.templateId = c.templateId;
      card.dataset.ttcardId = c.id;
      if (!isDone) {
        card.addEventListener("dragstart", () => {
          setDragging({ kind: "subject", ttcardId: c.id, templateId: c.templateId, sectionIdx: c.sectionIdx, gradeKey: c.gradeKey });
          card.classList.add("tt-dragging");
        });
        card.addEventListener("dragend", () => {
          setDragging(null);
          card.classList.remove("tt-dragging");
        });
      }
      (isDone ? doneCards : availableCards).push(card);
    });

    finalizeSidebarPanel(panel, availableCards, doneCards, "시간표 카드가 없습니다. '시간표 카드' 탭에서 카드를 생성하세요.");
  }

  function renderSubjectPanelLegacy(panel) {
    const availableCards = [];
    const doneCards = [];
    const seenUnitIds = new Set();
    const seenStandalone = new Set();

    GRADE_KEYS.forEach(gradeKey => {
      getSubjectsForGrade(gradeKey).forEach(tpl => {
        const unitInfo = getUnitForTemplate(tpl.id);
        if (unitInfo) {
          const { group, unit } = unitInfo;
          if (seenUnitIds.has(unit.id)) return;
          seenUnitIds.add(unit.id);
          unit.templateIds.forEach(id => seenUnitIds.add("tpl:" + id));
          const gradeKeys = getUnitGradeKeys(unit);
          const teachers = getUnitTeachers(unit);
          const credits = Math.max(1, ...unit.templateIds.map(id =>
            Math.max(...gradeKeys.map(g => getCreditsForTemplate(g, id)).filter(c => c > 0), 0)
          ).filter(c => c > 0));
          const assigned = entries().filter(e => e.unitId === unit.id).length;
          const isDone = credits > 0 && assigned >= credits;
          const card = buildSidebarCard({
            title: getUnitDisplayTitleSafe(unit),
            teachers,
            gradeKeys,
            credits,
            assigned,
            isDone,
            gradeColor: getGradeColor(gradeKeys[0] || gradeKey)
          });
          card.addEventListener("click", () => showEntryDetailByUnit(unit, group, gradeKeys));
          if (!isDone) {
            card.addEventListener("dragstart", () => {
              setDragging({ kind: "subject", templateId: unit.templateIds[0], unitId: unit.id, groupId: group.id, sectionIdx: 0, gradeKey: gradeKeys[0] || gradeKey });
              card.classList.add("tt-dragging");
            });
            card.addEventListener("dragend", () => {
              setDragging(null);
              card.classList.remove("tt-dragging");
            });
          }
          (isDone ? doneCards : availableCards).push(card);
        } else {
          if (seenUnitIds.has("tpl:" + tpl.id)) return;
          const credits = getCreditsForTemplate(gradeKey, tpl.id);
          const sections = getSectionCount(tpl.id);
          const teachers = getTeachersForTemplateSafe(tpl.id);
          for (let sec = 0; sec < Math.max(1, sections); sec++) {
            const key = `${tpl.id}:${gradeKey}:${sec}`;
            if (seenStandalone.has(key)) continue;
            seenStandalone.add(key);
            const assigned = entries().filter(e => entryTemplateIds(e).includes(tpl.id) && entryHasGrade(e, gradeKey) && e.sectionIdx === sec).length;
            const isDone = credits > 0 && assigned >= credits;
            const gradeColor = getGradeColor(gradeKey);
            const title = sections > 1 ? `${getTemplateCardTitle(tpl)} ${sectionLabel(sec)}` : getTemplateCardTitle(tpl);
            const card = buildSidebarCard({ title, teachers, gradeKeys: [gradeKey], credits, assigned, isDone, gradeColor });
            if (!isDone) {
              card.addEventListener("dragstart", () => {
                setDragging({ kind: "subject", templateId: tpl.id, sectionIdx: sec, gradeKey });
                card.classList.add("tt-dragging");
              });
              card.addEventListener("dragend", () => {
                setDragging(null);
                card.classList.remove("tt-dragging");
              });
            }
            (isDone ? doneCards : availableCards).push(card);
          }
        }
      });
    });

    finalizeSidebarPanel(panel, availableCards, doneCards, "커리큘럼에 배치된 과목이 없습니다.");
  }

  function getTeachersForTemplateSafe(templateId) {
    const cardHelpers = deps.getTeachersForTemplate;
    if (typeof cardHelpers === "function") return cardHelpers(templateId);
    const tpl = getTemplateById(templateId);
    const teacher = tpl?.teacher || tpl?.sem1Teacher || tpl?.sem2Teacher || "";
    return teacher ? [teacher] : [];
  }

  function getUnitDisplayTitleSafe(unit) {
    const fn = deps.getUnitDisplayTitle;
    if (typeof fn === "function") return fn(unit);
    return unit?.name || (unit?.templateIds || [])
      .map(id => getTemplateCardTitle(getTemplateById(id)))
      .filter(Boolean)
      .join(" / ") || "묶음수업";
  }

  function buildSidebarCard({ title, teachers, gradeKeys, credits, assigned, isDone, gradeColor, sectionIdx, groupName, detailItems = [] }) {
    const card = document.createElement("div");
    card.className = "tt-subject-card tt-sc-compact" + (isDone ? " tt-subject-done" : "");
    card.style.borderLeftColor = isDone ? "#22c55e" : gradeColor.border;
    card.style.background = isDone ? "#f0fdf4" : gradeColor.bg + "dd";
    card.draggable = canEdit() && !isDone;

    const row1 = document.createElement("div");
    row1.className = "tt-sc-row1";
    const displayTitle = groupName || title;
    const nameEl = document.createElement("div");
    nameEl.className = "tt-sc-name";
    nameEl.textContent = displayTitle;
    nameEl.title = displayTitle;
    const badge = document.createElement("span");
    badge.className = "tt-sc-badge";
    badge.textContent = `${assigned}/${credits}`;
    badge.style.background = isDone ? "#dcfce7" : assigned > 0 ? "#fef9c3" : "#f1f5f9";
    badge.style.color = isDone ? "#166534" : "#374151";
    row1.append(nameEl, badge);

    const row2 = document.createElement("div");
    row2.className = "tt-sc-row2";
    const uniqueTeachers = [...new Set(teachers || [])];
    const tchEl = document.createElement("div");
    tchEl.className = "tt-sc-teacher";
    tchEl.textContent = uniqueTeachers.join(", ") || "-";
    tchEl.title = uniqueTeachers.join(", ");
    const chipWrap = document.createElement("div");
    chipWrap.className = "tt-sc-grade-chips";
    (gradeKeys || []).forEach(g => {
      const chip = document.createElement("span");
      const gc = getGradeColor(g);
      chip.style.cssText = `font-size:8px;font-weight:700;padding:0 4px;line-height:14px;border-radius:999px;background:${gc.border};color:white;white-space:nowrap`;
      chip.textContent = gradeDisplay(g);
      chipWrap.appendChild(chip);
    });
    row2.append(tchEl, chipWrap);
    card.append(row1, row2);

    card.addEventListener("click", ev => {
      if (ev.defaultPrevented) return;
      showSidebarCardDetail({ title, teachers: uniqueTeachers, gradeKeys, credits, assigned, isDone, sectionIdx, groupName, detailItems });
    });

    return card;
  }

  function finalizeSidebarPanel(panel, available, done, emptyMsg) {
    if (!available.length && !done.length) {
      panel.appendChild(Object.assign(document.createElement("div"), { className: "tt-empty", textContent: emptyMsg }));
      return;
    }
    const wrapper = document.createElement("div");
    wrapper.className = "tt-sc-cards";
    if (available.length) {
      panel.appendChild(Object.assign(document.createElement("div"), { className: "tt-panel-section-title", textContent: `배치 필요 (${available.length})` }));
      available.forEach(c => wrapper.appendChild(c));
    }
    if (done.length) {
      wrapper.appendChild(Object.assign(document.createElement("div"), { className: "tt-panel-section-title tt-panel-section-done", textContent: `배치 완료 (${done.length})` }));
      done.forEach(c => wrapper.appendChild(c));
    }
    panel.appendChild(wrapper);
  }

  return { renderSubjectPanel };
}
