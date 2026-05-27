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
    getGroupCards, getCreditsForTtCard, getTeachersForTtCard, getTtCardClassLabels, describeTtCard, calculateClassCreditSummary,
    getSubjectsForGrade, getUnitForTemplate, getUnitGradeKeys, getUnitTeachers,
    getCreditsForTemplate, getSectionCount, entryTemplateIds, entryHasGrade,
    getGradeColor, gradeDisplay, sectionLabel,
    showSidebarCardDetail, showEntryDetailByUnit,
    renderAll, setDragData,
  } = deps;

  function setDragging(value) {
    if (typeof setDragData === "function") setDragData(value);
  }

  const TT_DRAG_MIME = "application/x-his-timetable-drag";
  const GRADE_FILTER_STORAGE_KEY = "his_timetable_grade_filter";
  let activeGradeFilter = loadGradeFilter();

  function beginSidebarDrag(event, card, data, effect = "copy") {
    setDragging(data);
    if (event?.dataTransfer) {
      event.dataTransfer.effectAllowed = effect;
      const payload = JSON.stringify(data);
      event.dataTransfer.setData(TT_DRAG_MIME, payload);
      event.dataTransfer.setData("text/plain", payload);
    }
    card.classList.add("tt-dragging");
  }

  function endSidebarDrag(card) {
    setDragging(null);
    card.classList.remove("tt-dragging");
  }

  function renderSubjectPanel() {
    const panel = $("ttSubjectsContent");
    if (!panel) return;
    panel.innerHTML = "";

    const toolbar = document.createElement("div");
    toolbar.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:8px;padding:6px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;flex-wrap:wrap";

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

    const ttcards = appState.timetable?.ttcards || [];
    const filteredTtcards = filterTtCardsByGrade(ttcards);
    toolbar.append(loadBtn, refreshBtn, buildGradeFilterControls(ttcards), buildCreditDiagnosticButton(ttcards), buildClassCountSummary(ttcards));
    panel.appendChild(toolbar);

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
    const grpList = appState.timetable.ttcardGroups || [];

    // ── Groups: one card per group ──────────────────────────────
    grpList.forEach(grp => {
      const grpCards = getGroupCards(grp);
      if (!grpCards.length) return;
      if (!cardsMatchActiveGradeFilter(grpCards)) return;
      grpCards.forEach(c => seenIds.add(c.id));

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
      const classLabels = compactClassLabelGroups(
        detailItems.flatMap(item => classLabelsFromDetailItem(item))
      );
      const card = buildSidebarCard({ title, teachers, gradeKeys, classLabels, credits, assigned, isDone, gradeColor, groupName: grp.name, detailItems });
      card.dataset.groupId = grp.id;
      card.style.outline = "1.5px solid " + gradeColor.border;
      if (!isDone) {
        card.addEventListener("dragstart", ev => {
          beginSidebarDrag(ev, card, { kind: "group", groupId: grp.id, ttcardIds: grpCards.map(c => c.id), gradeKey: gradeKeys[0] });
        });
        card.addEventListener("dragend", () => endSidebarDrag(card));
      }
      (isDone ? doneCards : availableCards).push(card);
    });

    // ── Standalone ttcards (not in any group) ────────────────────
    allTtcards.forEach(c => {
      if (seenIds.has(c.id)) return;
      if (!cardMatchesActiveGradeFilter(c)) return;
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
        classLabels: compactClassLabelGroups(getClassLabelsForTtCard(c)),
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
        card.addEventListener("dragstart", ev => {
          beginSidebarDrag(ev, card, { kind: "subject", ttcardId: c.id, templateId: c.templateId, sectionIdx: c.sectionIdx, gradeKey: c.gradeKey });
        });
        card.addEventListener("dragend", () => endSidebarDrag(card));
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
      if (!gradeKeyMatchesActiveFilter(gradeKey)) return;
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
            classLabels: compactClassLabelGroups(gradeKeys.map(g => formatFullClassLabel(g, sectionLabel(0)))),
            credits,
            assigned,
            isDone,
            gradeColor: getGradeColor(gradeKeys[0] || gradeKey)
          });
          card.addEventListener("click", () => showEntryDetailByUnit(unit, group, gradeKeys));
          if (!isDone) {
            card.addEventListener("dragstart", ev => {
              beginSidebarDrag(ev, card, { kind: "subject", templateId: unit.templateIds[0], unitId: unit.id, groupId: group.id, sectionIdx: 0, gradeKey: gradeKeys[0] || gradeKey });
            });
            card.addEventListener("dragend", () => endSidebarDrag(card));
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
            const card = buildSidebarCard({ title, teachers, gradeKeys: [gradeKey], classLabels: compactClassLabelGroups([formatFullClassLabel(gradeKey, sectionLabel(sec))]), credits, assigned, isDone, gradeColor });
            if (!isDone) {
              card.addEventListener("dragstart", ev => {
                beginSidebarDrag(ev, card, { kind: "subject", templateId: tpl.id, sectionIdx: sec, gradeKey });
              });
              card.addEventListener("dragend", () => endSidebarDrag(card));
            }
            (isDone ? doneCards : availableCards).push(card);
          }
        }
      });
    });

    finalizeSidebarPanel(panel, availableCards, doneCards, "커리큘럼에 배치된 과목이 없습니다.");
  }

  function buildGradeFilterControls(ttcards) {
    const wrap = document.createElement("div");
    wrap.className = "tt-grade-filter-controls";
    wrap.style.cssText = "display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-left:4px;padding-left:6px;border-left:1px solid #cbd5e1";

    const label = document.createElement("span");
    label.textContent = "학년 필터";
    label.style.cssText = "font-size:11px;font-weight:800;color:#475569;margin-right:2px;white-space:nowrap";
    wrap.appendChild(label);

    const summary = getClassCreditSummary(ttcards);
    const gradeOptions = getAvailableGradeFilterOptions(summary);
    if (activeGradeFilter !== "all" && !gradeOptions.some(opt => opt.value === activeGradeFilter)) {
      activeGradeFilter = "all";
      saveGradeFilter(activeGradeFilter);
    }

    const makeFilterBtn = (value, text, countText) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tt-grade-filter-btn" + (activeGradeFilter === value ? " active" : "");
      btn.textContent = countText != null ? `${text} ${countText}` : text;
      btn.title = value === "all" ? "전체 학년 카드 보기" : `${text}학년 카드만 보기`;
      const active = activeGradeFilter === value;
      btn.style.cssText = active
        ? "height:24px;padding:0 9px;border-radius:999px;border:1px solid #2563eb;background:#2563eb;color:white;font-size:11px;font-weight:900;cursor:pointer;white-space:nowrap"
        : "height:24px;padding:0 9px;border-radius:999px;border:1px solid #cbd5e1;background:white;color:#334155;font-size:11px;font-weight:800;cursor:pointer;white-space:nowrap";
      btn.addEventListener("click", () => {
        if (activeGradeFilter === value) return;
        activeGradeFilter = value;
        saveGradeFilter(value);
        renderSubjectPanel();
      });
      return btn;
    };

    wrap.appendChild(makeFilterBtn("all", "전체", formatCreditValue(summary.total)));
    gradeOptions.forEach(opt => wrap.appendChild(makeFilterBtn(opt.value, opt.label, opt.countText)));
    return wrap;
  }

  function getAvailableGradeFilterOptions(summary) {
    return (summary.gradeSummaries || []).map(gs => {
      const countText = gs.isBalanced
        ? formatCreditValue(gs.value)
        : `${formatCreditValue(gs.min)}~${formatCreditValue(gs.max)}`;
      return { value: gs.grade, label: gs.grade, countText };
    });
  }

  function filterTtCardsByGrade(ttcards) {
    if (activeGradeFilter === "all") return ttcards || [];
    return (ttcards || []).filter(card => cardMatchesActiveGradeFilter(card));
  }

  function cardsMatchActiveGradeFilter(cards) {
    if (activeGradeFilter === "all") return true;
    return (cards || []).some(card => cardMatchesActiveGradeFilter(card));
  }

  function cardMatchesActiveGradeFilter(card) {
    if (activeGradeFilter === "all") return true;
    return collectGradeNumbersForCard(card).has(activeGradeFilter);
  }

  function gradeKeyMatchesActiveFilter(gradeKey) {
    if (activeGradeFilter === "all") return true;
    return getGradeNumber(gradeKey) === activeGradeFilter;
  }

  function collectGradeNumbersForCard(card) {
    const grades = new Set();
    const gradeFromKey = getGradeNumber(card?.gradeKey);
    if (gradeFromKey) grades.add(gradeFromKey);
    getClassLabelsForTtCard(card).forEach(label => {
      const parsed = parseClassLabel(label);
      if (parsed.grade) grades.add(parsed.grade);
    });
    if (Array.isArray(card?.gradeKeys)) {
      card.gradeKeys.forEach(g => {
        const n = getGradeNumber(g);
        if (n) grades.add(n);
      });
    }
    return grades;
  }

  function getGradeNumber(value) {
    const m = String(value || "").match(/\d{1,2}/);
    return m ? String(Number(m[0])) : "";
  }

  function loadGradeFilter() {
    try {
      return localStorage.getItem(GRADE_FILTER_STORAGE_KEY) || "all";
    } catch (err) {
      return "all";
    }
  }

  function saveGradeFilter(value) {
    try {
      localStorage.setItem(GRADE_FILTER_STORAGE_KEY, value || "all");
    } catch (err) {
      // ignore storage errors
    }
  }

  function buildCreditDiagnosticButton(ttcards) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "secondary-btn compact-btn";
    btn.textContent = "🔎 시수 진단";
    btn.title = "학급별 필요 시수 차이 원인을 확인합니다.";
    btn.addEventListener("click", () => showClassCreditDiagnostics(ttcards));
    return btn;
  }

  function buildClassCountSummary(ttcards) {
    const wrap = document.createElement("div");
    wrap.className = "tt-class-count-summary";
    wrap.style.cssText = "margin-left:auto;display:flex;align-items:center;gap:4px;flex-wrap:wrap;font-size:11px;color:#334155";

    const label = document.createElement("span");
    label.textContent = "학급별 필요 시수";
    label.style.cssText = "font-weight:800;color:#475569;margin-right:2px;white-space:nowrap";
    wrap.appendChild(label);

    const summary = getClassCreditSummary(ttcards);
    const rows = summary.classes || [];
    if (!rows.length) {
      const empty = document.createElement("span");
      empty.textContent = "없음";
      empty.style.cssText = "font-size:11px;color:#94a3b8";
      wrap.appendChild(empty);
      return wrap;
    }

    rows.forEach(row => {
      const chip = document.createElement("span");
      const gc = getGradeColor(row.gradeKey || gradeKeyFromClassLabel(row.label));
      chip.textContent = `${row.label} ${formatCreditValue(row.credits)}`;
      chip.title = `${row.label} 필요 시수 ${formatCreditValue(row.credits)}`;
      chip.style.cssText = `display:inline-flex;align-items:center;gap:2px;padding:1px 6px;border-radius:999px;background:${gc.bg};border:1px solid ${gc.border};color:${gc.text};font-weight:800;line-height:16px;white-space:nowrap`;
      wrap.appendChild(chip);
    });
    return wrap;
  }

  function getClassCreditSummary(ttcards) {
    if (typeof calculateClassCreditSummary === "function") {
      return calculateClassCreditSummary(ttcards || [], appState.timetable?.ttcardGroups || []);
    }
    return { classes: [], gradeSummaries: [], total: 0, diagnostics: ["시수 계산 함수를 찾을 수 없습니다."] };
  }

  function showClassCreditDiagnostics(ttcards) {
    const summary = getClassCreditSummary(ttcards);
    const lines = [];
    lines.push("학급별 필요 시수 진단");
    lines.push("");
    (summary.gradeSummaries || []).forEach(gs => {
      const label = gs.isBalanced
        ? `${gs.grade}학년: ${formatCreditValue(gs.value)}시수 균형`
        : `${gs.grade}학년: ${formatCreditValue(gs.min)}~${formatCreditValue(gs.max)}시수 차이 있음`;
      lines.push(label);
      (gs.rows || []).forEach(row => {
        lines.push(`- ${row.label}: ${formatCreditValue(row.credits)}시수`);
      });
      lines.push("");
    });
    lines.push("차이 원인 후보");
    lines.push(...(summary.diagnostics || []));
    alert(lines.join("\n"));
  }

  function formatCreditValue(value) {
    const n = Number(value) || 0;
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
  }

  function getClassLabelsForTtCard(card) {
    if (!card) return [];

    // timetable-data.js의 canonical class helper를 우선 사용합니다.
    // 채플/창체/전체학년 카드에 과거 classLabels가 7A만 저장되어 있어도
    // 현재 학급 목록 기준으로 7A/7B 전체가 표시됩니다.
    if (typeof getTtCardClassLabels === "function") {
      const canonical = getTtCardClassLabels(card)
        .map(label => formatFullClassLabel(card.gradeKey, label))
        .filter(Boolean);
      if (canonical.length) return unique(canonical);
    }

    const labels = [];
    if (Array.isArray(card.classLabels) && card.classLabels.length) {
      card.classLabels.forEach(label => labels.push(formatFullClassLabel(card.gradeKey, label)));
    } else if (Array.isArray(card.classKeys) && card.classKeys.length) {
      card.classKeys.forEach(key => {
        const [g, sec] = String(key || "").split(":");
        labels.push(formatFullClassLabel(g ? `${g}학년` : card.gradeKey, sec));
      });
    } else {
      labels.push(formatFullClassLabel(card.gradeKey, sectionLabel(card.sectionIdx ?? 0)));
    }
    return unique(labels.filter(Boolean));
  }

  function classLabelsFromDetailItem(item) {
    if (!item) return [];
    const raw = Array.isArray(item.classLabels) && item.classLabels.length
      ? item.classLabels
      : [item.sectionLabel || sectionLabel(item.sectionIdx ?? 0)];
    return raw.map(label => formatFullClassLabel(item.gradeKey, label)).filter(Boolean);
  }

  function compactClassLabelGroups(labels) {
    const parsed = unique((labels || []).map(normalizeClassLabel).filter(Boolean))
      .map(label => parseClassLabel(label));
    const byGrade = new Map();
    const others = [];
    parsed.forEach(item => {
      if (!item.grade || !item.section) { others.push(item.raw); return; }
      if (!byGrade.has(item.grade)) byGrade.set(item.grade, []);
      byGrade.get(item.grade).push(item.section);
    });
    const grouped = [...byGrade.entries()]
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([grade, sections]) => `${grade}${unique(sections).sort(compareSectionLabels).join("")}`);
    return [...grouped, ...unique(others)];
  }

  function formatFullClassLabel(gradeKey, section) {
    const grade = gradeDisplay(gradeKey || "").replace(/[^0-9]/g, "");
    const secRaw = String(section || "").trim();
    if (!secRaw) return "";
    const compact = secRaw.replace(/\s+/g, "").replace(/학년/g, "").toUpperCase();
    const parsed = parseClassLabel(compact);
    if (parsed.grade && parsed.section) return `${parsed.grade}${parsed.section}`;
    const sec = compact.replace(/^\d{1,2}/, "");
    return grade && sec ? `${grade}${sec}` : compact;
  }

  function normalizeClassLabel(label) {
    const compact = String(label || "").replace(/\s+/g, "").replace(/학년/g, "").toUpperCase();
    const parsed = parseClassLabel(compact);
    return parsed.grade && parsed.section ? `${parsed.grade}${parsed.section}` : compact;
  }

  function parseClassLabel(label) {
    const raw = String(label || "").replace(/\s+/g, "").replace(/학년/g, "").toUpperCase();
    const m = raw.match(/^(\d{1,2})([A-Z가-힣0-9]+)$/);
    return m ? { raw, grade: m[1], section: m[2] } : { raw, grade: "", section: "" };
  }

  function gradeKeyFromClassLabel(label) {
    const parsed = parseClassLabel(label);
    return parsed.grade ? `${parsed.grade}학년` : "";
  }

  function compareClassLabels(a, b) {
    const pa = parseClassLabel(a);
    const pb = parseClassLabel(b);
    const ga = parseInt(pa.grade, 10) || 0;
    const gb = parseInt(pb.grade, 10) || 0;
    if (ga !== gb) return ga - gb;
    return compareSectionLabels(pa.section || pa.raw, pb.section || pb.raw);
  }

  function compareSectionLabels(a, b) {
    return String(a || "").localeCompare(String(b || ""), "ko", { numeric: true });
  }

  function unique(list) {
    return [...new Set((list || []).filter(Boolean))];
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

  function buildSidebarCard({ title, teachers, gradeKeys, classLabels = [], credits, assigned, isDone, gradeColor, sectionIdx, groupName, detailItems = [] }) {
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
    const displayChips = classLabels?.length ? classLabels : compactClassLabelGroups((gradeKeys || []).map(g => `${gradeDisplay(g)}${sectionIdx != null ? sectionLabel(sectionIdx) : ""}`));
    displayChips.forEach(label => {
      const chip = document.createElement("span");
      const gradeKey = gradeKeyFromClassLabel(label) || (gradeKeys || [])[0];
      const gc = getGradeColor(gradeKey);
      chip.style.cssText = `font-size:8px;font-weight:800;padding:0 4px;line-height:14px;border-radius:999px;background:${gc.border};color:white;white-space:nowrap`;
      chip.textContent = label;
      chip.title = `대상 학급: ${label}`;
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
