// ================================================================
// timetable-print-file-utils.js · Browser file name and download helpers
// ================================================================

export function safeFilePart(value = "") {
  return String(value ?? "").trim().replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_").slice(0, 80) || "시간표";
}

function triggerDownload(filename, blob) {
  if (!(blob instanceof Blob)) throw new TypeError("다운로드 데이터는 Blob이어야 합니다.");
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    anchor.remove();
  }, 1000);
}

export function downloadTextFile(filename, content, mime = "text/plain;charset=utf-8") {
  triggerDownload(filename, new Blob([content], { type: mime }));
}

export function downloadBlobFile(filename, blob) {
  triggerDownload(filename, blob);
}
