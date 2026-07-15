 const text = value => String(value ?? "").trim();
const unique = values => [...new Set((values || []).map(text).filter(Boolean))];

export function normalizePrintSemester(value = "1") {
  return String(value) === "2" ? "2" : "1";
}

export function printSemesterLabel(value = "1") {
  return `${normalizePrintSemester(value)}학기`;
}

export function splitPrintTeacherNames(value = "") {
  if (Array.isArray(value)) return unique(value);
  return unique(text(value).split(/[,，、\/]+/));
}

export function buildPrintTemplateMap(templatesDomain = {}) {
  const rows = Array.isArray(templatesDomain)
    ? templatesDomain
    : Array.isArray(templatesDomain?.templates)
      ? templatesDomain.templates
      : [];
  return new Map(rows.filter(row => row?.id).map(row => [String(row.id), row]));
}

export function resolveSemesterTemplateValues(template, semester = "1") {
  if (!template || template.useSemesterOverrides !== true) return null;
  const sem = normalizePrintSemester(semester);
  const prefix = sem === "2" ? "sem2" : "sem1";
  return {
    semester: sem,
    subject: text(template[`${prefix}NameKo`] || template.nameKo),
    english: text(template[`${prefix}NameEn`] || template.nameEn),
    teacher: text(template[`${prefix}Teacher`] || template.teacher),
    teachers: splitPrintTeacherNames(template[`${prefix}Teacher`] || template.teacher),
  };
}

export function resolveSemesterCardValues(card = {}, entry = {}, templateMap = new Map(), semester = "1") {
  const fallback = {
    semester: normalizePrintSemester(semester),
    subject: text(card?.subject || card?.label || entry?.groupName || entry?.subject || "수업"),
    english: text(card?.subjectEn || entry?.subjectEn),
    teacher: text(card?.teacherName || (card?.teachers || []).join(", ") || entry?.teacherName),
    teachers: unique([...(card?.teachers || []), ...splitPrintTeacherNames(card?.teacherName || entry?.teacherName)]),
    overridden: false,
  };

  // 복합과목의 구성 카드는 구성요소 이름과 교사를 유지해야 한다.
  if (card?.compoundPartId || card?.compoundParentTemplateId) return fallback;

  const templateId = text(card?.templateId || entry?.templateId);
  const template = templateId ? templateMap.get(templateId) : null;
  const resolved = resolveSemesterTemplateValues(template, semester);
  if (!resolved) return fallback;

  return {
    ...fallback,
    subject: resolved.subject || fallback.subject,
    english: resolved.english || fallback.english,
    teacher: resolved.teacher || fallback.teacher,
    teachers: resolved.teachers.length ? resolved.teachers : fallback.teachers,
    overridden: true,
    templateId,
  };
}

export function resolveSemesterEntryValues(entry = {}, templateMap = new Map(), semester = "1") {
  const templateId = text(entry?.templateId);
  const template = templateId ? templateMap.get(templateId) : null;
  const resolved = resolveSemesterTemplateValues(template, semester);
  const teacher = text(resolved?.teacher || entry?.teacherName);
  return {
    semester: normalizePrintSemester(semester),
    subject: text(resolved?.subject || entry?.groupName || entry?.subject || entry?.title || "수업"),
    english: text(resolved?.english || entry?.subjectEn),
    teacher,
    teachers: splitPrintTeacherNames(teacher),
    overridden: !!resolved,
    templateId,
  };
}
