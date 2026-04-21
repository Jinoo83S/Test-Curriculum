// ================================================================
// utils.js · Pure Utility Functions
// ================================================================

export const uid  = (p="id") => `${p}-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
export const clean= (v) => String(v??"").trim();
export const cloneJson = (v) => JSON.parse(JSON.stringify(v));

export function uniqueOrdered(arr) {
  const out = [];
  arr.forEach(v => { if (v != null && v !== "" && !out.includes(v)) out.push(v); });
  return out;
}

export function makeBtn(text, cls, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  if (cls) b.className = cls;
  b.textContent = text;
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

export function escapeHtml(v) {
  return String(v ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

export const parseCreditValue = v => {
  const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export function languageClass(lang) {
  return `lang-${String(lang || "both").toLowerCase()}`;
}
