// ================================================================
// room-availability.js · Canonical room unavailable-time storage
// ================================================================
// Room availability belongs to rooms.rooms[].unavailableSlots.
// Older releases stored room slots inside timetable.teacherConstraints using
// a reserved pseudo-teacher key. This module migrates those values once,
// preserves unresolved room IDs outside the teacher map, and is idempotent.

export const LEGACY_ROOM_UNAVAILABLE_PREFIX = "__room_unavailable__:";

const cleanLocal = value => String(value ?? "").trim();

export function normalizeRoomUnavailableSlots(slots = []) {
  const seen = new Set();
  return (Array.isArray(slots) ? slots : [])
    .map(slot => ({ day: Number(slot?.day), period: Number(slot?.period) }))
    .filter(slot => Number.isInteger(slot.day) && slot.day >= 0 && slot.day <= 4
      && Number.isInteger(slot.period) && slot.period >= 0 && slot.period <= 11)
    .filter(slot => {
      const key = `${slot.day}:${slot.period}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.day - b.day || a.period - b.period);
}

export function isLegacyRoomAvailabilityKey(key = "") {
  return cleanLocal(key).startsWith(LEGACY_ROOM_UNAVAILABLE_PREFIX);
}

export function legacyRoomIdFromAvailabilityKey(key = "") {
  const value = cleanLocal(key);
  return isLegacyRoomAvailabilityKey(value)
    ? cleanLocal(value.slice(LEGACY_ROOM_UNAVAILABLE_PREFIX.length))
    : "";
}

function sameSlots(a = [], b = []) {
  const left = normalizeRoomUnavailableSlots(a);
  const right = normalizeRoomUnavailableSlots(b);
  return left.length === right.length
    && left.every((slot, index) => slot.day === right[index].day && slot.period === right[index].period);
}

export function mergeRoomUnavailableSlots(...sources) {
  return normalizeRoomUnavailableSlots(sources.flatMap(source => Array.isArray(source) ? source : []));
}

export function normalizeRoomAvailabilityOrphans(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  Object.entries(raw).forEach(([roomId, value]) => {
    const id = cleanLocal(roomId);
    if (!id) return;
    const slots = normalizeRoomUnavailableSlots(value?.unavailableSlots ?? value);
    if (!slots.length) return;
    out[id] = {
      unavailableSlots: slots,
      source: cleanLocal(value?.source || "legacy-room-constraint"),
      note: cleanLocal(value?.note || "등록되지 않은 교실 ID의 불가시간을 보존했습니다."),
    };
  });
  return out;
}

function collectLegacyEntries(map = {}) {
  if (!map || typeof map !== "object" || Array.isArray(map)) return [];
  return Object.entries(map)
    .filter(([key]) => isLegacyRoomAvailabilityKey(key))
    .map(([key, value]) => ({
      key,
      roomId: legacyRoomIdFromAvailabilityKey(key),
      unavailableSlots: normalizeRoomUnavailableSlots(value?.unavailableSlots || []),
    }));
}

export function inspectRoomAvailabilitySeparation(roomsDomain = {}, timetableDomain = {}) {
  const rooms = Array.isArray(roomsDomain?.rooms) ? roomsDomain.rooms : [];
  const legacyEntries = [
    ...collectLegacyEntries(timetableDomain?.teacherConstraints),
    ...collectLegacyEntries(timetableDomain?.teacherConstraintsById),
  ];
  const roomSlotCount = rooms.reduce((sum, room) => sum + normalizeRoomUnavailableSlots(room?.unavailableSlots).length, 0);
  const unavailableRoomCount = rooms.filter(room => normalizeRoomUnavailableSlots(room?.unavailableSlots).length > 0).length;
  const orphanStore = normalizeRoomAvailabilityOrphans(timetableDomain?.roomAvailabilityOrphans);
  const orphanSlotCount = Object.values(orphanStore)
    .reduce((sum, row) => sum + normalizeRoomUnavailableSlots(row?.unavailableSlots).length, 0);
  return {
    legacyKeyCount: legacyEntries.length,
    legacySlotCount: legacyEntries.reduce((sum, row) => sum + row.unavailableSlots.length, 0),
    unavailableRoomCount,
    roomSlotCount,
    orphanRoomCount: Object.keys(orphanStore).length,
    orphanSlotCount,
  };
}

export function migrateLegacyRoomAvailability(roomsDomain = {}, timetableDomain = {}) {
  const rooms = Array.isArray(roomsDomain?.rooms) ? roomsDomain.rooms : [];
  const roomById = new Map(rooms.map(room => [cleanLocal(room?.id), room]).filter(([id]) => id));
  const teacherConstraints = timetableDomain?.teacherConstraints && typeof timetableDomain.teacherConstraints === "object"
    ? timetableDomain.teacherConstraints
    : {};
  const teacherConstraintsById = timetableDomain?.teacherConstraintsById && typeof timetableDomain.teacherConstraintsById === "object"
    ? timetableDomain.teacherConstraintsById
    : {};
  const orphanStore = normalizeRoomAvailabilityOrphans(timetableDomain?.roomAvailabilityOrphans);
  const legacyEntries = [
    ...collectLegacyEntries(teacherConstraints).map(row => ({ ...row, sourceMap: teacherConstraints })),
    ...collectLegacyEntries(teacherConstraintsById).map(row => ({ ...row, sourceMap: teacherConstraintsById })),
  ];

  const report = {
    changedDomains: [],
    legacyKeyCount: legacyEntries.length,
    legacySlotCount: legacyEntries.reduce((sum, row) => sum + row.unavailableSlots.length, 0),
    migratedRoomCount: 0,
    migratedSlotCount: 0,
    orphanRoomIds: [],
    removedLegacyKeys: [],
    changed: false,
  };
  const changedDomains = new Set();
  const migratedRooms = new Set();

  legacyEntries.forEach(row => {
    const roomId = cleanLocal(row.roomId);
    const room = roomById.get(roomId);
    if (room) {
      const before = normalizeRoomUnavailableSlots(room.unavailableSlots);
      const next = mergeRoomUnavailableSlots(before, row.unavailableSlots);
      if (!sameSlots(before, next)) {
        room.unavailableSlots = next;
        report.migratedSlotCount += Math.max(0, next.length - before.length);
        changedDomains.add("rooms");
      }
      migratedRooms.add(roomId);
      if (orphanStore[roomId]) {
        delete orphanStore[roomId];
        changedDomains.add("timetable");
      }
    } else if (roomId && row.unavailableSlots.length) {
      const before = normalizeRoomUnavailableSlots(orphanStore[roomId]?.unavailableSlots);
      const next = mergeRoomUnavailableSlots(before, row.unavailableSlots);
      orphanStore[roomId] = {
        unavailableSlots: next,
        source: "legacy-room-constraint",
        note: "등록되지 않은 교실 ID의 불가시간을 보존했습니다.",
      };
      report.orphanRoomIds.push(roomId);
      changedDomains.add("timetable");
    }

    if (row.sourceMap && Object.prototype.hasOwnProperty.call(row.sourceMap, row.key)) {
      delete row.sourceMap[row.key];
      report.removedLegacyKeys.push(row.key);
      changedDomains.add("timetable");
    }
  });

  const normalizedOrphans = normalizeRoomAvailabilityOrphans(orphanStore);
  const beforeOrphans = JSON.stringify(normalizeRoomAvailabilityOrphans(timetableDomain?.roomAvailabilityOrphans));
  const afterOrphans = JSON.stringify(normalizedOrphans);
  if (beforeOrphans !== afterOrphans || legacyEntries.length) {
    timetableDomain.roomAvailabilityOrphans = normalizedOrphans;
    if (beforeOrphans !== afterOrphans) changedDomains.add("timetable");
  }

  report.migratedRoomCount = migratedRooms.size;
  report.orphanRoomIds = [...new Set(report.orphanRoomIds)].sort();
  report.changedDomains = [...changedDomains];
  report.changed = report.changedDomains.length > 0;
  return report;
}
