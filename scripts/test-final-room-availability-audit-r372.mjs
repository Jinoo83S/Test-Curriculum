import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const bridge = fs.readFileSync(path.join(root, 'js', 'cp-sat-webapp-import.js'), 'utf8');
const match = bridge.match(/function finalRoomAvailabilityAudit\(scopeState = null, entries = \[\]\) \{[\s\S]*?\n\}\n\nfunction engineApplyBlock/);
if (!match) throw new Error('finalRoomAvailabilityAudit function not found');
const fnSource = match[0].replace(/\n\nfunction engineApplyBlock[\s\S]*$/, '');
const asArray = value => Array.isArray(value) ? value : [];
const cleanLocal = value => String(value ?? '').trim();
const unique = list => [...new Set(asArray(list).map(cleanLocal).filter(Boolean))];
const payloadFromWrappedState = state => state?.data || state?.normalized || state || {};
const finalRoomAvailabilityAudit = new Function(
  'asArray', 'cleanLocal', 'unique', 'payloadFromWrappedState',
  `${fnSource}; return finalRoomAvailabilityAudit;`
)(asArray, cleanLocal, unique, payloadFromWrappedState);

const scope = {
  normalized: {
    rooms: {
      rooms: [
        { id: 'room-ground', name: 'Ground', unavailableSlots: [{ day: 0, period: 0 }] },
        { id: 'room-music', name: 'VH106', unavailableSlots: [{ day: 0, period: 1 }] },
      ],
    },
  },
};
const entries = [
  {
    id: 'entry-pe', day: 0, period: 0, pinned: false,
    ttcardIds: ['pe-m', 'pe-f'],
    roomAssignmentsByTtCardId: { 'pe-m': 'room-ground', 'pe-f': 'room-ground' },
  },
  { id: 'entry-music', day: 0, period: 1, pinned: false, ttcardId: 'music', roomId: 'room-music' },
  { id: 'entry-ok', day: 0, period: 2, pinned: false, ttcardId: 'ok', roomId: 'room-ground' },
  { id: 'entry-pinned-override', day: 0, period: 0, pinned: true, ttcardId: 'override', roomId: 'room-ground' },
];
const audit = finalRoomAvailabilityAudit(scope, entries);
if (audit.blockingCount !== 2) throw new Error(`expected 2 room blocks, got ${audit.blockingCount}`);
if (audit.ok !== false) throw new Error('room violation must make audit fail');
const names = new Set(audit.details.map(item => item.roomName));
for (const expected of ['Ground', 'VH106']) {
  if (!names.has(expected)) throw new Error(`missing room ${expected}`);
}
console.log('FINAL_ROOM_AVAILABILITY_AUDIT_R372_OK', audit.blockingCount, [...names].sort().join(','));
