export const REPORT_FIELDS = [
  ["reportCategory", "구분", ["체육•예술", "진로선택"]],
  ["reportRawScore", "원점수", ["O", "X"]],
  ["reportAverage", "평균", ["O", "X"]],
  ["reportStandardDeviation", "표준편차", ["O", "X", "성취도별 분포비율"]],
  ["reportAchievementLevels", "성취도", ["5 Levels", "3 Levels", "P/F", "P"]],
  ["reportEnrollmentCount", "수강자수", ["O", "X"]],
  ["reportRanking", "석차", ["O", "X"]],
];

export const normalizeReportValue = value => typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

export function normalizeChecklistReportOptions(config) {
  return Object.fromEntries(REPORT_FIELDS.map(([key, , defaults]) => {
    const values = Array.isArray(config?.[key]) ? config[key] : defaults;
    return [key, [...new Set(values.map(normalizeReportValue).filter(Boolean))]];
  }));
}
