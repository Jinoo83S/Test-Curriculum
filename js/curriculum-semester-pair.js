export function swapSemesterPair(source, destination) {
  const first = source.sem1TemplateId || null;
  const second = source.sem2TemplateId || null;
  source.sem1TemplateId = destination.sem1TemplateId || null;
  source.sem2TemplateId = destination.sem2TemplateId || null;
  destination.sem1TemplateId = first;
  destination.sem2TemplateId = second;
}

export function pairedSemesterTitles(first, second, sameCard) {
  const titles = document.createElement("div");
  titles.className = "placed-title-wrap";
  const visibleName = term => [term.nameKo || term.nameEn || "-", term.nameEn || "-"];
  const names = [visibleName(first), visibleName(second)];
  const showBoth = !sameCard || names[0].some((name, index) => name !== names[1][index]);
  if (showBoth) titles.classList.add("paired-semester-titles");
  names.slice(0, showBoth ? 2 : 1).forEach(([nameKo, nameEn], index) => {
    const part = document.createElement("div");
    if (showBoth) {
      part.className = "paired-semester-title";
      part.dataset.semester = index === 0 ? "sem1" : "sem2";
      part.title = `${index + 1}학기 · ${nameKo} / ${nameEn}`;
    }
    const ko = document.createElement("div"); ko.className = "placed-title-ko"; ko.textContent = nameKo;
    const en = document.createElement("div"); en.className = "placed-title-en"; en.textContent = nameEn;
    part.append(ko, en);
    titles.append(part);
  });
  return titles;
}
