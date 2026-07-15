// ================================================================
// firestore-usage.js · Client-side Firestore usage monitor UI
// ================================================================
import {
  getFirestoreUsageStats,
  resetFirestoreUsageStats,
  exportFirestoreUsageSnapshot
} from "./state.js?v=2026-07-15-room-availability-separation-r355";
import { LOCAL_DEV_MODE } from "./local-dev.js?v=2026-07-15-room-availability-separation-r355";

function pct(value, limit) {
  if (!limit) return 0;
  return Math.max(0, Math.min(100, Math.round((Number(value || 0) / Number(limit || 1)) * 100)));
}

function fmt(n) {
  return Number(n || 0).toLocaleString("ko-KR");
}

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function downloadJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

function usageRow(label, value, limit, help = "") {
  const percent = pct(value, limit);
  const warnClass = percent >= 90 ? "danger" : percent >= 70 ? "warn" : "";
  return `
    <div class="usage-meter-row ${warnClass}">
      <div class="usage-meter-head">
        <strong>${escapeHtml(label)}</strong>
        <span>${fmt(value)} / ${fmt(limit)} · ${percent}%</span>
      </div>
      <div class="usage-meter-bar"><i style="width:${percent}%"></i></div>
      ${help ? `<p>${escapeHtml(help)}</p>` : ""}
    </div>`;
}

function renderLog(logs = []) {
  if (!logs.length) return `<p class="usage-empty">기록된 사용량 이벤트가 아직 없습니다.</p>`;
  return `<div class="usage-log-list">${logs.slice().reverse().map(item => `
    <div class="usage-log-item">
      <span>${escapeHtml((item.at || "").replace("T", " ").slice(11, 19))}</span>
      <b>${escapeHtml(item.type || "-")}</b>
      <strong>${fmt(item.count)}</strong>
      <em>${escapeHtml(item.label || "")}</em>
    </div>`).join("")}</div>`;
}

export function openFirestoreUsageDialog() {
  const prev = document.querySelector(".usage-modal-backdrop");
  if (prev) prev.remove();

  const stats = getFirestoreUsageStats();
  const current = stats.current || {};
  const limits = stats.limits || {};
  const estimate = stats.currentSubscriptionEstimate || {};
  const subscribed = stats.subscribedDomains || [];
  const warning = LOCAL_DEV_MODE
    ? "현재 로컬 모드입니다. Firestore 읽기/쓰기 없이 localStorage만 사용합니다."
    : "이 화면의 수치는 이 브라우저에서 앱이 기록한 추정치입니다. Firebase 콘솔의 전체 프로젝트 사용량과는 차이가 날 수 있습니다.";

  const backdrop = document.createElement("div");
  backdrop.className = "usage-modal-backdrop";
  backdrop.innerHTML = `
    <div class="usage-modal" role="dialog" aria-modal="true" aria-label="Firestore 사용량 체크">
      <div class="usage-modal-header">
        <div>
          <h2>Firestore 사용량 체크</h2>
          <p>${escapeHtml(warning)}</p>
        </div>
        <button type="button" class="usage-close-btn" data-usage-close>×</button>
      </div>

      <div class="usage-summary-grid">
        <div><strong>오늘</strong><span>${escapeHtml(current.day || "-")}</span></div>
        <div><strong>모드</strong><span>${LOCAL_DEV_MODE ? "로컬" : "온라인"}</span></div>
        <div><strong>구독 도메인</strong><span>${subscribed.length ? escapeHtml(subscribed.join(", ")) : "-"}</span></div>
        <div><strong>현재 화면 예상 초기 읽기</strong><span>${fmt(estimate.total || 0)} docs</span></div>
      </div>

      <div class="usage-section">
        <h3>오늘 누적 추정치</h3>
        ${usageRow("읽기", current.reads || 0, limits.reads || 50000, "실시간 구독 초기 로딩, 진단 내보내기, 컬렉션 조회가 포함됩니다.")}
        ${usageRow("쓰기", current.writes || 0, limits.writes || 20000, "자동저장, 수동저장, DB 정리 실행이 포함됩니다.")}
        ${usageRow("삭제", current.deletes || 0, limits.deletes || 20000, "중복 카드 정리처럼 문서를 삭제하는 작업이 포함됩니다.")}
      </div>

      <div class="usage-section">
        <h3>현재 화면 구독 예상</h3>
        <table class="usage-table">
          <thead><tr><th>도메인</th><th>예상 문서 수</th><th>비고</th></tr></thead>
          <tbody>
            ${(estimate.byDomain || []).map(row => `<tr><td>${escapeHtml(row.domain)}</td><td>${fmt(row.count)}</td><td>${escapeHtml(row.note || "")}</td></tr>`).join("") || `<tr><td colspan="3">구독 중인 도메인이 없습니다.</td></tr>`}
          </tbody>
        </table>
      </div>

      <div class="usage-section">
        <h3>최근 이벤트</h3>
        ${renderLog(current.logs || [])}
      </div>

      <div class="usage-actions">
        <button type="button" class="secondary-btn" data-usage-export>사용량 JSON 내보내기</button>
        <button type="button" class="secondary-btn danger-outline" data-usage-reset>오늘 기록 초기화</button>
        <button type="button" class="primary-btn" data-usage-close>닫기</button>
      </div>
    </div>`;

  document.body.appendChild(backdrop);
  backdrop.querySelectorAll("[data-usage-close]").forEach(btn => btn.addEventListener("click", () => backdrop.remove()));
  backdrop.addEventListener("click", event => { if (event.target === backdrop) backdrop.remove(); });
  backdrop.querySelector("[data-usage-export]")?.addEventListener("click", () => {
    downloadJsonFile(`his-firestore-usage-${new Date().toISOString().slice(0,10)}.json`, exportFirestoreUsageSnapshot());
  });
  backdrop.querySelector("[data-usage-reset]")?.addEventListener("click", () => {
    if (!confirm("이 브라우저에 저장된 오늘의 사용량 추정 기록을 초기화할까요? Firebase 데이터에는 영향이 없습니다.")) return;
    resetFirestoreUsageStats();
    backdrop.remove();
    openFirestoreUsageDialog();
  });
}
