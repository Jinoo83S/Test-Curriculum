// ================================================================
// timetable-manual-replace.js · Manual drag replacement planning
// r380: an occupied target class slot is replaced by the moved card.
// ================================================================

const asArray = value => Array.isArray(value) ? value : [];
const clean = value => String(value ?? "").trim();

function asSet(value) {
  if (value instanceof Set) return value;
  return new Set(asArray(value).map(clean).filter(Boolean));
}

function intersects(a, b) {
  const left = asSet(a);
  const right = asSet(b);
  for (const value of left) if (right.has(value)) return true;
  return false;
}

function placementMatchesOccupancy(placement = {}, occupancy = {}) {
  const targetClasses = asSet(placement.classKeys);
  const occupiedClasses = asSet(occupancy.classKeys);
  if (targetClasses.size) return intersects(targetClasses, occupiedClasses);

  // Classless legacy/status entries fall back to physical-room occupancy.
  const targetRooms = asSet(placement.roomIds);
  const occupiedRooms = asSet(occupancy.roomIds);
  if (targetRooms.size) return intersects(targetRooms, occupiedRooms);

  return false;
}

/**
 * Build a replacement plan without mutating timetable data.
 *
 * `targetPlacements` is the future occupancy of every moved span member.
 * Existing entries that occupy the same class cell are displaced. A pinned
 * entry blocks the operation instead of being silently removed.
 */
export function buildManualReplacementPlan({
  entries = [],
  movingEntryIds = [],
  targetPlacements = [],
  getOccupancy = () => ({}),
  getOccurrenceEntries = entry => [entry],
} = {}) {
  const source = asArray(entries).filter(Boolean);
  const moving = new Set(asArray(movingEntryIds).map(clean).filter(Boolean));
  const occupantMap = new Map();

  asArray(targetPlacements).forEach(placement => {
    const day = Number(placement?.day);
    const period = Number(placement?.period);
    if (!Number.isInteger(day) || !Number.isInteger(period)) return;

    source.forEach(entry => {
      const id = clean(entry?.id);
      if (!id || moving.has(id)) return;
      if (Number(entry?.day) !== day || Number(entry?.period) !== period) return;
      if (!placementMatchesOccupancy(placement, getOccupancy(entry) || {})) return;
      occupantMap.set(id, entry);
    });
  });

  const occupants = [...occupantMap.values()];
  const pinned = occupants.filter(entry => entry?.pinned === true);
  if (pinned.length) {
    return {
      blocked: true,
      reason: "pinned-target",
      occupantEntries: occupants,
      pinnedEntries: pinned,
      displacementEntries: [],
      displacementIds: [],
    };
  }

  const displacementMap = new Map();
  occupants.forEach(entry => {
    const occurrence = asArray(getOccurrenceEntries(entry)).filter(Boolean);
    (occurrence.length ? occurrence : [entry]).forEach(member => {
      const id = clean(member?.id);
      if (id && !moving.has(id)) displacementMap.set(id, member);
    });
  });

  const protectedMembers = [...displacementMap.values()].filter(entry => entry?.pinned === true);
  if (protectedMembers.length) {
    return {
      blocked: true,
      reason: "pinned-target",
      occupantEntries: occupants,
      pinnedEntries: protectedMembers,
      displacementEntries: [],
      displacementIds: [],
    };
  }

  return {
    blocked: false,
    reason: occupants.length ? "replace" : "empty-target",
    occupantEntries: occupants,
    pinnedEntries: [],
    displacementEntries: [...displacementMap.values()],
    displacementIds: [...displacementMap.keys()],
  };
}
