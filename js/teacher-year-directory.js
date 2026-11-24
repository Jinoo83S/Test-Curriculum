import { splitTeacherIdentityNames } from "./teacher-identity.js?v=2026-07-15-room-availability-separation-r355";

const clean = value => String(value ?? "").trim();
const nameKey = value => clean(value).normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase();
export const schoolEmailKey = value => clean(value).toLowerCase();
const list = value => Array.isArray(value) ? value : [];
const namesFor = teacher => [teacher.name, ...list(teacher.aliases)].map(nameKey).filter(Boolean);

function assignment(card, term) {
  const field = suffix => term ? term + suffix : suffix[0].toLowerCase() + suffix.slice(1);
  return {
    ids: list(card[field("TeacherIds")]).map(clean).filter(Boolean),
    names: [...new Set(splitTeacherIdentityNames([card[field("Teacher")], ...list(card[field("TeacherNames")])]))],
  };
}

export function assignedTeachers(card, term) {
  const candidates = [assignment(card, term)];
  if (term === "sem2") candidates.push(assignment(card, "sem1"));
  candidates.push(assignment(card, ""));
  const selected = candidates.find(entry => entry.ids.length || entry.names.length) || { ids: [], names: [] };
  return {
    ids: [...new Set([...selected.ids, ...list(card.compoundParts).flatMap(part => assignment(part, "").ids)])],
    names: [...new Set([...selected.names, ...list(card.compoundParts).flatMap(part => assignment(part, "").names)])],
  };
}

export function buildTeacherYearRoster({ curriculum, templates, teachers } = {}, directory = []) {
  const saved = list(teachers).filter(teacher => teacher && typeof teacher === "object");
  const rows = saved.map(teacher => ({ ...teacher, automatic: false, subjects: [] }));
  const cards = new Map(list(templates).map(card => [card.id, card]));
  const generated = new Map();
  const uniqueMatch = (candidates, predicate) => {
    const matches = candidates.filter(predicate);
    return matches.length === 1 ? matches[0] : null;
  };
  const resolve = (id, name) => {
    const key = nameKey(name);
    const matchesName = teacher => key && namesFor(teacher).includes(key);
    const local = (id && rows.find(teacher => teacher.id === id)) || uniqueMatch(rows, matchesName);
    if (local) return local;
    const idCandidates = id ? directory.filter(teacher => teacher.id === id) : [];
    const candidates = idCandidates.length ? idCandidates : directory.filter(matchesName);
    const emails = new Map(candidates.filter(teacher => schoolEmailKey(teacher.email).endsWith("@his.sc.kr"))
      .map(teacher => [schoolEmailKey(teacher.email), teacher]));
    const profile = emails.size === 1 ? [...emails.values()][0] : null;
    const known = (profile && rows.find(teacher => schoolEmailKey(teacher.email) === schoolEmailKey(profile.email)));
    if (known) return known;
    const displayName = clean(profile?.name || name || (idCandidates.length === 1 ? idCandidates[0].name : ""));
    if (!displayName) return null;
    const identity = schoolEmailKey(profile?.email) || nameKey(displayName);
    if (!generated.has(identity)) generated.set(identity, {
      id: id || profile?.id || "", name: displayName, email: clean(profile?.email),
      note: clean(profile?.note), aliases: [...list(profile?.aliases)], automatic: true, subjects: [],
    });
    const entry = generated.get(identity);
    if (name && nameKey(name) !== nameKey(entry.name) && !entry.aliases.includes(name)) entry.aliases.push(name);
    return entry;
  };
  for (const gradeRows of Object.values(curriculum?.gradeBoards || {})) {
    for (const row of list(gradeRows)) {
      for (const term of ["sem1", "sem2"]) {
        const card = cards.get(row[term + "TemplateId"]);
        if (!card) continue;
        const subject = clean(card[term + "NameKo"] || card.nameKo || card[term + "NameEn"] || card.nameEn);
        if (!subject) continue;
        const assigned = assignedTeachers(card, term);
        const owners = new Set([
          ...assigned.ids.map(id => resolve(id, "")),
          ...assigned.names.map(name => resolve("", name)),
        ]);
        for (const teacher of owners) {
          if (teacher && !teacher.subjects.includes(subject)) teacher.subjects.push(subject);
        }
      }
    }
  }
  return [...rows, ...generated.values()];
}

export function appliedYearsForTeacher(teacher, rosters) {
  const email = schoolEmailKey(teacher.email);
  const aliases = namesFor(teacher);
  return [...rosters].filter(([, rows]) => {
    const assigned = rows.filter(row => row.subjects.length);
    if (assigned.some(row => email && schoolEmailKey(row.email) === email)) return true;
    if (assigned.some(row => teacher.id && row.id === teacher.id &&
        (!email || !schoolEmailKey(row.email) || schoolEmailKey(row.email) === email))) return true;
    const byName = rows.filter(row => namesFor(row).some(name => aliases.includes(name)));
    return byName.length === 1 && byName[0].subjects.length > 0 &&
      (!email || !schoolEmailKey(byName[0].email) || schoolEmailKey(byName[0].email) === email);
  }).map(([year]) => year);
}
