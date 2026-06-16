// ================================================================
// utils.js · Pure Utility Functions
// ================================================================

export const uid  = (p="id") => `${p}-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
export const clean= (v) => String(v??"").trim();
export const cloneJson = (v) => JSON.parse(JSON.stringify(v));

/** sectionIdx → "A", "B", "C", … */
export const sectionLabel = i => String.fromCharCode(65 + Math.max(0, i));

/** "7학년" → "7", "10학년" → "10" */
export const gradeDisplay = g => String(g ?? "").replace("학년", "");

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

/** 창체는 원본 입력값(시간 수)을 보존하되, 결과표/시간표 적용 시수는 항상 1로 봅니다. */
export function isChanCheCategory(category) {
  return clean(category) === "창체";
}

export function getEffectiveCredit(rowOrCredits, category = "") {
  const isRow = rowOrCredits && typeof rowOrCredits === "object" && !Array.isArray(rowOrCredits);
  const rawCategory = isRow ? rowOrCredits.category : category;
  if (isChanCheCategory(rawCategory)) return 1;
  const rawCredits = isRow ? rowOrCredits.credits : rowOrCredits;
  const n = parseCreditValue(rawCredits);
  return n > 0 ? n : 0;
}

/**
 * 고정/전체학년 보호 대상: 실제로 같은 학년·여러 반 전체를 막아야 하는 수업만 true.
 *
 * 주의: CA/SA는 학교 내 교과군·분류명으로도 쓰일 수 있어, 그 자체만으로
 * 전체학년 수업으로 판단하면 9A/9B처럼 서로 다른 반 수업이 학생 충돌로 오판됩니다.
 * 따라서 CA/SA 단독 표기는 보호 키워드에서 제외하고, 창체/채플/전체/전학년 등
 * 명시적인 전체학년 성격의 표현이나 카드의 실제 classKeys로 판단합니다.
 */
export function isProtectedWholeGradeLabel(...values) {
  const text = values.map(clean).filter(Boolean).join(" ");
  if (!text) return false;
  // 전체 학년으로 고정해야 하는 표현만 보호합니다.
  // "창체", "자율", "동아리" 같은 큰 분류명은 반별 수업에도 쓰이므로
  // 이 함수에서 전체학년으로 판정하지 않습니다. 실제 전체/반별 여부는 카드 생성 시
  // 수강명단의 sectionIdx/classId 구조를 우선해 결정합니다.
  return /(채플|chapel|ms\s*채플|전체\s*(학년|반)?|전학년|학년\s*전체|whole\s*grade|all\s*grade)/i.test(text);
}

export function languageClass(lang) {
  return `lang-${String(lang || "both").toLowerCase()}`;
}
