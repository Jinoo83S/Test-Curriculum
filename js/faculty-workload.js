function numberOrNull(value, integer = false) {
  const raw = String(value ?? "").trim();
  if (!raw || !/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isFinite(number) && (!integer || Number.isInteger(number)) ? number : null;
}

export function summarizeFacultyWorkload(records) {
  return records.flatMap(({ id, meta }) => {
    const classCount = numberOrNull(meta?.classCount, true);
    const teacherLoadHours = numberOrNull(meta?.teacherLoadHours);
    return id && (classCount !== null || teacherLoadHours !== null) ? [[id, { classCount, teacherLoadHours }]] : [];
  });
}

export function facultyCourseWorkload(record, credits) {
  const classCount = numberOrNull(record?.classCount, true);
  const override = numberOrNull(record?.teacherLoadHours);
  const total = classCount !== null && Number.isFinite(credits) && credits > 0
    ? Number((classCount * credits).toFixed(8)) : null;
  return { classCount, total, teacherTotal: override ?? total };
}
