// ================================================================
// timetable-log.js · Bottom log / auto-assign result panel
// ================================================================

const TT_LOG_KEY = "his_tt_logs_v1";
const TT_AUTO_REPORT_KEY = "his_tt_auto_report_v1";
const LOG_LIMIT = 80;

function loadJsonLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) { return fallback; }
}

function formatLogTime(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  return `${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
}

export function createTimetableLogHandlers({
  entries,
  ttConfig,
  uid,
  escapeHtml,
  $,
  getEntryConflictSet,
  getOrderedConflictTypes,
  CONFLICT_DISPLAY,
  CONFLICT_PRIORITY,
  getRelatedConflictEntries,
  entryTitle,
  getEntryClassSummary,
  getConstraintConflictMessage,
  entryTeachers,
  getRoomDisplayName,
  getConflictLabel,
  recomputeConflicts,
}) {
  let timetableLogs = loadJsonLocal(TT_LOG_KEY, []);
  let lastAutoAssignReport = loadJsonLocal(TT_AUTO_REPORT_KEY, null);

  function persistLogState() {
    try {
      localStorage.setItem(TT_LOG_KEY, JSON.stringify(timetableLogs.slice(0, LOG_LIMIT)));
      if (lastAutoAssignReport) localStorage.setItem(TT_AUTO_REPORT_KEY, JSON.stringify(lastAutoAssignReport));
      else localStorage.removeItem(TT_AUTO_REPORT_KEY);
    } catch (_) {}
  }

  function addTimetableLog(kind, title, message = "", detail = {}) {
    timetableLogs.unshift({ id: uid("log"), ts: Date.now(), kind, title, message, detail });
    if (timetableLogs.length > LOG_LIMIT) timetableLogs = timetableLogs.slice(0, LOG_LIMIT);
    persistLogState();
    const logsEl = $("ttLogsContent");
    if (logsEl && !logsEl.classList.contains("hidden")) renderLogPanel();
  }

  function setLastAutoAssignReport(report) {
    lastAutoAssignReport = report;
    persistLogState();
  }

  function getConflictCounts() {
    const counts = Object.fromEntries(CONFLICT_PRIORITY.map(type => [type, 0]));
    const affectedIds = new Set();
    const combined = new Map();
    entries().forEach(e => combined.set(e.id, getEntryConflictSet(e)));
    combined.forEach((set, id) => {
      if (!set || !set.size) return;
      affectedIds.add(id);
      getOrderedConflictTypes(set).forEach(type => { counts[type] = (counts[type] || 0) + 1; });
    });
    return { counts, totalAffected: affectedIds.size };
  }

  function getConflictDetailRows() {
    const rows = [];
    const dayLabels = ["월", "화", "수", "목", "금"];
    entries()
      .filter(e => getEntryConflictSet(e).size > 0)
      .sort((a, b) => a.day !== b.day ? a.day - b.day : (a.period !== b.period ? a.period - b.period : entryTitle(a).localeCompare(entryTitle(b), "ko")))
      .forEach(entry => {
        const types = getOrderedConflictTypes(getEntryConflictSet(entry));
        types.forEach(type => {
          const meta = CONFLICT_DISPLAY[type];
          if (!meta) return;
          const related = getRelatedConflictEntries(entry, type);
          let detail = "";
          if (["teacher", "room", "student", "syncRequired"].includes(type)) {
            detail = related.length
              ? related.slice(0, 4).map(({ entry: other, detail }) => `${entryTitle(other)} · ${getEntryClassSummary(other)}${detail ? ` (${detail})` : ""}`).join(" / ")
              : getConflictLabel(new Set([type]));
            if (related.length > 4) detail += ` / 외 ${related.length - 4}건`;
          } else if (type === "roomMissing") {
            detail = "교실이 배정되지 않았습니다. 자동배치 결과에서 누락된 교실입니다.";
          } else {
            detail = getConstraintConflictMessage(type, entry);
          }
          rows.push({
            type,
            label: meta.label,
            color: meta.color,
            slot: `${dayLabels[entry.day] ?? "?"} ${ttConfig().periodLabels?.[entry.period] || `${entry.period + 1}교시`}`,
            title: entryTitle(entry),
            cls: getEntryClassSummary(entry),
            teacher: entryTeachers(entry).join(", ") || "-",
            room: getRoomDisplayName(entry.roomId),
            detail
          });
        });
      });
    return rows;
  }

  function renderLogPanel() {
    const el = $("ttLogsContent");
    if (!el) return;

    const { counts, totalAffected } = getConflictCounts();
    const conflictRows = getConflictDetailRows();
    const conflictBadges = CONFLICT_PRIORITY
      .filter(type => counts[type] > 0)
      .map(type => `<span class="tt-conflict-chip" data-type="${type}">${escapeHtml(CONFLICT_DISPLAY[type].label)} ${counts[type]}</span>`)
      .join("");

    const auto = lastAutoAssignReport;
    const failedList = auto?.failedNames?.length
      ? `<ul class="tt-log-failed-list">${auto.failedNames.slice(0, 20).map(name => `<li>${escapeHtml(name)}</li>`).join("")}${auto.failedNames.length > 20 ? `<li>외 ${auto.failedNames.length - 20}개</li>` : ""}</ul>`
      : "";

    const failureDiagnostics = Array.isArray(auto?.failedDiagnostics) ? auto.failedDiagnostics : [];
    const failureDiagHtml = failureDiagnostics.length
      ? `<div class="tt-log-failure-diag">
          <div class="tt-log-subtitle">미배치 원인 후보 및 완화 제안</div>
          ${failureDiagnostics.slice(0, 12).map(d => {
            const reasons = Array.isArray(d.topReasons) ? d.topReasons.slice(0, 3) : [];
            const reasonHtml = reasons.length
              ? `<ul>${reasons.map(r => {
                  const samples = Array.isArray(r.samples) && r.samples.length ? ` <span class="tt-log-muted">예: ${escapeHtml(r.samples[0])}</span>` : "";
                  return `<li>${escapeHtml(r.label || r.code || "원인")} ${Number(r.count || 0)}칸${samples}</li>`;
                }).join("")}</ul>`
              : `<div class="tt-log-muted">세부 원인을 확인하지 못했습니다.</div>`;
            const restricted = Array.isArray(d.restrictedTeachers) && d.restrictedTeachers.length
              ? `<span class="tt-log-badge warn">제약교사 ${escapeHtml(d.restrictedTeachers.join(", "))}</span>`
              : "";
            const suggestions = Array.isArray(d.suggestions) ? d.suggestions.slice(0, 3) : [];
            const suggestionHtml = suggestions.length
              ? `<div class="tt-log-relax-suggestions"><div class="tt-log-subtitle tiny">풀어볼 조건</div><ol>${suggestions.map(s => `<li><b>${escapeHtml(s.title || "조건 조정")}</b><span>${escapeHtml(s.detail || "")}${Number(s.availableAfter || 0) ? ` · 완화 시 ${Number(s.availableAfter || 0)}칸 가능` : ""}</span></li>`).join("")}</ol></div>`
              : "";
            return `<div class="tt-log-diag-item">
              <div class="tt-log-diag-title"><b>${escapeHtml(d.name || "미확인 카드")}</b>${d.occurrences > 1 ? ` <span class="tt-log-muted">×${d.occurrences}</span>` : ""}${restricted}</div>
              <div class="tt-log-muted">${escapeHtml(d.summary || `가능 ${d.validSlots ?? 0}/${d.totalSlots ?? "?"}칸`)}</div>
              ${reasonHtml}
              ${suggestionHtml}
            </div>`;
          }).join("")}
          ${failureDiagnostics.length > 12 ? `<div class="tt-log-muted">외 ${failureDiagnostics.length - 12}개</div>` : ""}
        </div>`
      : "";



    const outcome = auto?.outcomeAnalysis || null;
    const outcomeHtml = outcome
      ? (() => {
          const failedUnits = Array.isArray(outcome.topFailedUnits) ? outcome.topFailedUnits : [];
          const failedUnitHtml = failedUnits.length
            ? `<ul>${failedUnits.slice(0, 10).map(row => `<li><b>${escapeHtml(row.name || "-")}</b> ${Number(row.occurrences || 0)}회차 · 카드 ${Number(row.cardCount || 0)}개${row.restrictedTeachers?.length ? ` <span class="tt-log-badge warn">제약교사</span>` : ""}</li>`).join("")}${failedUnits.length > 10 ? `<li>외 ${failedUnits.length - 10}개 유닛</li>` : ""}</ul>`
            : `<div class="tt-log-validation-block ok">남은 수업 유닛 없음</div>`;
          return `<div class="tt-log-validation tt-log-outcome">
            <div class="tt-log-subtitle">자동배치 결과 분석</div>
            <dl class="tt-log-kv compact">
              <dt>신규 배치</dt><dd>${outcome.placedEntryCount ?? 0} entry</dd>
              <dt>수업 블록</dt><dd>${outcome.placedBlockCount ?? 0}개</dd>
              <dt>그룹/일반</dt><dd>${outcome.placedGroupBlockCount ?? 0} / ${outcome.placedStandaloneBlockCount ?? 0}</dd>
              <dt>배치 카드</dt><dd>${outcome.placedCardCount ?? 0}개</dd>
              <dt>미배치 유닛</dt><dd>${outcome.failedUnitCount ?? 0}개 · ${outcome.failedOccurrenceCount ?? 0}회차</dd>
            </dl>
            <div class="tt-log-validation-block"><div class="tt-log-subtitle">남은 수업 유닛</div>${failedUnitHtml}</div>
          </div>`;
        })()
      : "";

    const validation = auto?.postValidation || null;
    const validationHtml = validation
      ? (() => {
          const classIssues = validation.classSlots?.issues || [];
          const restrictedIssues = validation.restrictedTeachers?.issues || [];
          const protectedSamples = validation.protectedIntrusions?.samples || [];
          const classRowsHtml = classIssues.length
            ? `<div class="tt-log-validation-block"><div class="tt-log-subtitle">학급별 시수</div><ul>${classIssues.slice(0, 12).map(row => `<li><b>${escapeHtml(row.label || row.key)}</b> ${row.count}/${row.target}시수 <span class="tt-log-muted">${row.diff < 0 ? Math.abs(row.diff) + "시수 부족" : row.diff + "시수 초과"}</span></li>`).join("")}${classIssues.length > 12 ? `<li>외 ${classIssues.length - 12}개 학급</li>` : ""}</ul></div>`
            : `<div class="tt-log-validation-block ok">학급별 시수 정상</div>`;
          const restrictedHtml = restrictedIssues.length
            ? `<div class="tt-log-validation-block"><div class="tt-log-subtitle">제약교사 조건</div><ul>${restrictedIssues.slice(0, 10).map(row => `<li><b>${escapeHtml(row.teacher)}</b> ${escapeHtml((row.issueParts || []).join(", "))}</li>`).join("")}${restrictedIssues.length > 10 ? `<li>외 ${restrictedIssues.length - 10}명</li>` : ""}</ul></div>`
            : `<div class="tt-log-validation-block ok">제약교사 조건 정상</div>`;
          const protectedHtml = protectedSamples.length
            ? `<div class="tt-log-validation-block"><div class="tt-log-subtitle">고정/보호 수업 침범 후보</div><ul>${protectedSamples.slice(0, 8).map(text => `<li>${escapeHtml(text)}</li>`).join("")}${protectedSamples.length > 8 ? `<li>외 ${protectedSamples.length - 8}건</li>` : ""}</ul></div>`
            : `<div class="tt-log-validation-block ok">고정/보호 수업 침범 없음</div>`;
          const missingHtml = validation.missingRoomCount
            ? `<div class="tt-log-validation-block"><div class="tt-log-subtitle">교실 미배정</div><ul>${(validation.missingRoomNames || []).slice(0, 10).map(name => `<li>${escapeHtml(name)}</li>`).join("")}${(validation.missingRoomNames || []).length > 10 ? `<li>외 ${(validation.missingRoomNames || []).length - 10}개</li>` : ""}</ul></div>`
            : `<div class="tt-log-validation-block ok">교실 미배정 없음</div>`;
          return `<div class="tt-log-validation">
            <div class="tt-log-subtitle">자동배치 검증 리포트</div>
            <div class="tt-log-validation-summary ${validation.ok ? "ok" : "warn"}">${escapeHtml(validation.summary || "-")}</div>
            <dl class="tt-log-kv compact">
              <dt>학급 시수</dt><dd>${validation.classSlots?.total ?? "-"}/${validation.classSlots?.targetTotal ?? "-"}</dd>
              <dt>시수 불일치</dt><dd>${validation.classSlots?.issueCount ?? 0}개 학급</dd>
              <dt>제약교사</dt><dd>${validation.restrictedTeachers?.issueCount ?? 0}/${validation.restrictedTeachers?.totalTeachers ?? 0}명 확인</dd>
              <dt>고정침범</dt><dd>${validation.protectedIntrusions?.total ?? 0}건</dd>
            </dl>
            ${classRowsHtml}${restrictedHtml}${protectedHtml}${missingHtml}
          </div>`;
        })()
      : "";

    const logItems = timetableLogs.length
      ? timetableLogs.slice(0, 25).map(log => `
        <div class="tt-log-item">
          <div class="tt-log-item-title"><span>${escapeHtml(log.title)}</span><span class="tt-log-item-time">${formatLogTime(log.ts)}</span></div>
          ${log.message ? `<div class="tt-log-item-msg">${escapeHtml(log.message)}</div>` : ""}
        </div>`).join("")
      : `<div class="tt-log-empty">아직 기록된 로그가 없습니다.</div>`;

    const conflictTable = conflictRows.length
      ? `<div class="tt-log-table-wrap"><table class="tt-log-table">
          <thead><tr><th>유형</th><th>시간</th><th>수업</th><th>반</th><th>교사/교실</th><th>상세</th></tr></thead>
          <tbody>${conflictRows.map(row => `
            <tr>
              <td><span class="tt-log-type-chip" style="background:${row.color}">${escapeHtml(row.label)}</span></td>
              <td>${escapeHtml(row.slot)}</td>
              <td>${escapeHtml(row.title)}</td>
              <td>${escapeHtml(row.cls)}</td>
              <td>${escapeHtml(row.teacher)}<br><span style="color:#64748b">${escapeHtml(row.room)}</span></td>
              <td>${escapeHtml(row.detail)}</td>
            </tr>`).join("")}</tbody>
        </table></div>`
      : `<div class="tt-log-empty">현재 충돌 내역이 없습니다.</div>`;

    el.innerHTML = `
      <div class="tt-log-toolbar">
        <div class="tt-log-title">시간표 로그 · 자동배치 결과 · 충돌 내역</div>
        <div class="tt-log-actions">
          <button type="button" onclick="window._ttRefreshLogs?.()">새로고침</button>
          <button type="button" onclick="window._ttClearLogs?.()">로그 지우기</button>
        </div>
      </div>
      <div class="tt-log-grid">
        <div style="display:flex;flex-direction:column;gap:10px">
          <section class="tt-log-card">
            <div class="tt-log-card-hdr"><span>자동배치 결과</span>${auto ? `<span class="tt-log-item-time">${formatLogTime(auto.ts)}</span>` : ""}</div>
            <div class="tt-log-card-body">
              ${auto ? `
                <dl class="tt-log-kv">
                  <dt>대상 학년</dt><dd>${escapeHtml(auto.activeGrades || "-")}</dd>
                  <dt>배치 방식</dt><dd>${escapeHtml(auto.stageLabel || "-")}</dd>
                  <dt>대상 슬롯</dt><dd>${auto.totalTarget ?? "-"}개</dd>
                  <dt>고정 유지</dt><dd>${auto.pinnedCount ?? 0}개</dd>
                  <dt>신규 배치</dt><dd>${auto.placedCount ?? 0}개</dd>
                  <dt>후처리 개선</dt><dd>${auto.postProcessImprovedCount ?? 0}건</dd>
                  <dt>미배치</dt><dd>${auto.failedCount ?? 0}개</dd>
                  <dt>소요 시간</dt><dd>${auto.durationMs != null ? (auto.durationMs / 1000).toFixed(1) + "초" : "-"}</dd>
                </dl>
                <div class="tt-log-badges">
                  <span class="tt-log-badge ${auto.failedCount ? "warn" : "ok"}">${auto.failedCount ? "부분 완료" : "전체 완료"}</span>
                  ${(auto.conflictTotal || 0) > 0 ? `<span class="tt-log-badge danger">충돌 ${auto.conflictTotal}건</span>` : `<span class="tt-log-badge ok">충돌 없음</span>`}
                  ${auto.validationOk === false ? `<span class="tt-log-badge warn">검증 필요</span>` : (auto.validationOk === true ? `<span class="tt-log-badge ok">검증 통과</span>` : "")}
                  ${auto.failedUnitCount != null ? `<span class="tt-log-badge ${auto.failedUnitCount ? "warn" : "ok"}">미배치 유닛 ${auto.failedUnitCount}개</span>` : ""}
                </div>
                ${outcomeHtml}
                ${validationHtml}
                ${failedList}
                ${failureDiagHtml}` : `<div class="tt-log-empty">아직 자동배치 실행 기록이 없습니다.</div>`}
            </div>
          </section>
          <section class="tt-log-card">
            <div class="tt-log-card-hdr"><span>최근 로그</span><span class="tt-log-item-time">최대 ${LOG_LIMIT}개 보관</span></div>
            <div class="tt-log-card-body"><div class="tt-log-list">${logItems}</div></div>
          </section>
        </div>
        <section class="tt-log-card">
          <div class="tt-log-card-hdr">
            <span>현재 충돌 내역</span>
            <span style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">${totalAffected ? `<span class="tt-conflict-summary-label">충돌 ${totalAffected}건</span>${conflictBadges}` : `<span class="tt-log-badge ok">충돌 없음</span>`}</span>
          </div>
          <div class="tt-log-card-body">${conflictTable}</div>
        </section>
      </div>`;
  }

  window._ttRefreshLogs = () => { recomputeConflicts(); renderLogPanel(); };
  window._ttClearLogs = () => {
    if (!confirm("로그 기록을 지울까요? 자동배치 마지막 결과도 함께 지워집니다.")) return;
    timetableLogs = [];
    lastAutoAssignReport = null;
    persistLogState();
    renderLogPanel();
  };

  return { addTimetableLog, setLastAutoAssignReport, getConflictCounts, renderLogPanel };
}
