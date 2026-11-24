export const CHAPEL_PERIODS = 2;

export function isChapelTitle(...titles) {
  return titles.some(title => /^(?:(?:중등|중학교|중|고등|고등학교|고|ms|hs|middle school|high school)\s*)?(?:채플|chapel)(?:\s*\((?:중등|중학교|중|고등|고등학교|고|ms|hs)\))?$/i
    .test(String(title ?? "").normalize("NFKC").trim()));
}

export function isSchoolChapelCard(card) {
  return card?.id === "ttc_school_chapel_middle" || card?.id === "ttc_school_chapel_high";
}

export function isChapelTemplate(template) {
  if (!template) return false;
  const { nameKo, nameEn, sem1NameKo, sem1NameEn, sem2NameKo, sem2NameEn } = template;
  const terms = [[sem1NameKo, sem1NameEn], [sem2NameKo, sem2NameEn]]
    .map(names => names.some(Boolean) ? names : [nameKo, nameEn])
    .filter(names => names.some(Boolean));
  return terms.length > 0 && terms.every(names => isChapelTitle(...names));
}
