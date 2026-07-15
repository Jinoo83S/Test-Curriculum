 // ================================================================
// timetable-revision-history.js · Firestore revision history UI
// ================================================================

function clean(value) {
  return String(value ?? "").trim();
}

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value?.toMillis === "function") return new Date(value.toMillis());
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value) {
  const date = toDate(value);
  if (!date) return "시간 정보 없음";
  const pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function reasonLabel(reason) {
  const map = {
    save: "자동 저장",
    backup: "백업",
    "pre-restore-save": "복구 전 저장",
    "pre-restore-backup": "복구 전 자동 백업",
    restore: "복구 완료본",
  };
  return map[clean(reason)] || clean(reason) || "저장";
}

function buildSummary(record = {}) {
  const counts = record.counts || record.snapshot?.counts || {};
  const changes = record.changes || {};
  return {
    entries: Number(counts.entries || 0),
    cards: Number(counts.cards || 0),
    groups: Number(counts.groups || 0),
    changed: Number(changes.entrySets || 0) + Number(changes.entryDeletes || 0) + Number(changes.cardSets || 0) + Number(changes.cardDeletes || 0),
  };
}

export function createTimetableRevisionHistoryUi({
  activeSchoolYear,
  listRevisions,
  restoreRevision,
  getConfirmationText,
  escapeHtml = value => String(value ?? ""),
  onRestored = () => {},
} = {}) {
  let host = null;
  let busy = false;

  const setStatus = (message, tone = "info") => {
    const target = host?.querySelector?.("[data-revision-status]");
    if (!target) return;
    target.textContent = clean(message);
    target.dataset.tone = tone;
    target.hidden = !clean(message);
  };

  const renderRows = records => {
    const list = host?.querySelector?.("[data-revision-list]");
    if (!list) return;
    if (!records.length) {
      list.innerHTML = `<div class="tt-revision-empty">r357 적용 후 시간표를 저장하면 복구 가능한 서버 저장 기록이 생성됩니다.</div>`;
      return;
    }

    list.innerHTML = records.map(record => {
      const summary = buildSummary(record);
      const actor = clean(record.actor?.displayName || record.actor?.email) || "사용자 정보 없음";
      const restorable = record.restorable === true;
      const restoredFrom = clean(record.restoredFrom);
      return `<article class="tt-revision-row" data-revision-id="${escapeHtml(record.id)}">
        <div class="tt-revision-row-main">
          <div class="tt-revision-title-line">
            <strong>${escapeHtml(record.label || reasonLabel(record.reason))}</strong>
            <span class="tt-revision-kind">${escapeHtml(reasonLabel(record.reason))}</span>
            ${restorable ? `<span class="tt-revision-ready">복구 가능</span>` : `<span class="tt-revision-legacy">기록만 있음</span>`}
          </div>
          <div class="tt-revision-meta">
            <span>${escapeHtml(formatDate(record.committedAt))}</span>
            <span>배치 ${summary.entries}</span>
            <span>카드 ${summary.cards}</span>
            <span>그룹 ${summary.groups}</span>
            <span>변경 ${summary.changed}</span>
            <span>${escapeHtml(actor)}</span>
            <span>${escapeHtml(formatBytes(record.snapshot?.payloadBytes))}</span>
          </div>
          <div class="tt-revision-id">${escapeHtml(record.id)}${restoredFrom ? ` · 원본 ${escapeHtml(restoredFrom)}` : ""}</div>
        </div>
        <div class="tt-revision-row-actions">
          <button type="button" data-action="restore-revision" data-id="${escapeHtml(record.id)}" ${restorable ? "" : "disabled data-permanent-disabled=\"true\""}>이 저장본 복구</button>
        </div>
      </article>`;
    }).join("");

    list.querySelectorAll('[data-action="restore-revision"]').forEach(button => {
      button.addEventListener("click", () => void restoreRecord(button.dataset.id, records));
    });
  };

  const refresh = async () => {
    if (!host || busy) return;
    busy = true;
    host.querySelectorAll("button").forEach(button => { button.disabled = true; });
    setStatus("서버 저장 기록을 불러오고 있습니다.");
    try {
      const records = await listRevisions({ limit: 30 });
      renderRows(Array.isArray(records) ? records : []);
      setStatus(`최근 저장 기록 ${records.length}개를 확인했습니다.`, "success");
    } catch (error) {
      console.error("Timetable revision history load failed.", error);
      renderRows([]);
      setStatus(`저장 기록을 불러오지 못했습니다. ${error?.message || error}`, "error");
    } finally {
      busy = false;
      host.querySelectorAll("button").forEach(button => {
        if (!button.hasAttribute("data-permanent-disabled")) button.disabled = false;
      });
    }
  };

  const restoreRecord = async (revisionId, records = []) => {
    if (busy || !revisionId) return;
    const record = records.find(item => item.id === revisionId);
    if (!record?.restorable) return;
    const summary = buildSummary(record);
    const expected = getConfirmationText(revisionId);
    const warning = [
      `${activeSchoolYear}학년도 시간표를 다음 저장본으로 복구합니다.`,
      `저장 시각: ${formatDate(record.committedAt)}`,
      `배치 ${summary.entries}개 / 카드 ${summary.cards}개 / 그룹 ${summary.groups}개`,
      "",
      "복구 직전에 현재 시간표가 서버 저장 기록으로 자동 백업됩니다.",
      "복구 변경량이 Firestore 원자적 한도를 넘으면 실제 데이터 변경 전에 차단됩니다.",
    ].join("\n");
    if (!confirm(warning)) return;
    const typed = prompt(`복구 확인 문구를 정확히 입력하세요.\n\n${expected}`, "");
    if (typed == null) return;

    busy = true;
    host.querySelectorAll("button").forEach(button => { button.disabled = true; });
    try {
      setStatus("복구 준비 중입니다.");
      const result = await restoreRevision(revisionId, {
        confirmationText: typed,
        onProgress: message => setStatus(message),
      });
      if (result?.unchanged) {
        setStatus("현재 시간표가 선택한 저장본과 같아 복구할 변경이 없습니다.", "success");
        alert("현재 시간표가 선택한 저장본과 같습니다.");
      } else {
        setStatus("시간표 복구와 복구 후 저장 기록 생성이 완료되었습니다.", "success");
        alert(
          "시간표 복구가 완료되었습니다.\n\n" +
          `복구 전 자동 백업: ${result?.backup?.id || "생성됨"}\n` +
          `복구 완료 기록: ${result?.revision?.id || "생성됨"}`
        );
        onRestored(result);
      }
      busy = false;
      await refresh();
    } catch (error) {
      console.error("Timetable revision restore failed.", error);
      setStatus(`복구하지 못했습니다. ${error?.message || error}`, "error");
      alert(`시간표 복구를 중단했습니다.\n\n${error?.message || error}`);
    } finally {
      busy = false;
      host?.querySelectorAll("button").forEach(button => {
        button.disabled = button.hasAttribute("data-permanent-disabled");
      });
    }
  };

  const mount = async element => {
    host = element || null;
    if (!host) return;
    host.innerHTML = `<section class="tt-revision-panel">
      <div class="tt-revision-head">
        <div>
          <div class="tt-revision-kicker">서버 자동 저장 이력</div>
          <h4>${escapeHtml(activeSchoolYear)}학년도 시간표 복구</h4>
          <p>r357 이후 저장본에는 배치·카드·그룹·설정 전체가 압축 보관됩니다. 다른 학년도 기록은 표시되지 않습니다.</p>
        </div>
        <button type="button" class="secondary" data-action="refresh-revisions">새로고침</button>
      </div>
      <div class="tt-revision-status" data-revision-status hidden></div>
      <div class="tt-revision-list" data-revision-list></div>
    </section>`;
    host.querySelector('[data-action="refresh-revisions"]')?.addEventListener("click", () => void refresh());
    await refresh();
  };

  return { mount, refresh };
}
