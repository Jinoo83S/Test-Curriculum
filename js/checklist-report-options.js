export const CHECKLIST_REPORT_SECTIONS = [
  ["neis", "나이스 성적표", "NEIS Report Card", [
    ["reportCourseGroup", "교과군", ["보통교과"], "Course Group"],
    ["reportCurricularCategory", "편제명", ["선택", "국어", "영어", "수학", "사회(역사포함)/도덕", "과학/기술·가정/정보", "체육", "예술(음악/미술)", "예술"], "Curricular Category"],
    ["reportCategory", "과목구분", ["체육•예술", "일반 선택", "진로 선택", "보통 교과(탐구)-과학-진로 선택", "보통 교과(생활·교양)-교양"], "Course Type"],
    ["reportRawScore", "원점수", ["O", "X"], "Raw Score"],
    ["reportAverage", "과목평균", ["O", "X"], "Average"],
    ["reportAchievementLevels", "성취도", ["5 Levels", "3 Levels", "P/F", "P"], "Achievement Levels"],
    ["reportStandardDeviation", "표준편차/성취도별 분포비율", ["O", "X", "성취도별 분포비율"], "Standard Deviation / Achievement Level Distribution"],
    ["reportEnrollmentCount", "수강자수", ["O", "X"], "Enrollment"],
    ["reportRanking", "석차등급", ["O", "X"], "Ranking"],
  ]],
  ["transcript", "영문 성적표", "English Transcript", [
    ["transcriptAchievementLevels", "성취도", ["12 Levels", "X"], "Achievement Levels"],
    ["transcriptGradePoints", "평점", ["O", "X", "P"], "Grade Points"],
    ["transcriptGpa", "평점 평균", ["O", "X"], "Grade Points Average (GPA)"],
  ]],
  ["assessment", "평가", "Assessment", [
    ["writtenAssessmentCount", "석차등급에 따른 지필평가 횟수", ["1", "2"], "Written Assessments by Ranking"],
    ["singleAssessmentAllowed", "수행평가 또는 지필평가 1회를 볼 수 있는 경우", ["O", "X"], "Single Performance or Written Assessment Allowed"],
  ]],
];
export const REPORT_FIELDS = CHECKLIST_REPORT_SECTIONS.flatMap(([, , , fields]) => fields);

export const normalizeReportValue = value => typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

const englishValues = new Map([
  ["보통교과", "General Courses"], ["선택", "Elective"], ["국어", "Korean"], ["영어", "English"], ["수학", "Mathematics"],
  ["사회(역사포함)/도덕", "Social Studies (incl. History) / Ethics"], ["과학/기술·가정/정보", "Science / Technology and Home Economics / Information"],
  ["체육", "Physical Education"], ["예술(음악/미술)", "Arts (Music / Visual Arts)"], ["예술", "Arts"], ["체육•예술", "Physical Education / Arts"],
  ["일반 선택", "General Elective"], ["진로 선택", "Career Elective"], ["진로선택", "Career Elective"],
  ["보통 교과(탐구)-과학-진로 선택", "General Courses (Inquiry) – Science – Career Elective"],
  ["보통 교과(생활·교양)-교양", "General Courses (Life and Liberal Arts) – Liberal Arts"],
  ["성취도별 분포비율", "Achievement Level Distribution"],
]);

export function localizedReportValue(value, language) {
  return language === "en" ? englishValues.get(value) ?? value : value;
}

export function normalizeChecklistReportOptions(config) {
  return Object.fromEntries(REPORT_FIELDS.map(([key, , defaults]) => {
    const values = Array.isArray(config?.[key]) ? config[key] : defaults;
    return [key, [...new Set(values.map(normalizeReportValue).filter(Boolean))]];
  }));
}
