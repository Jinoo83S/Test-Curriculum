// ================================================================
// app-domains.js · View-scoped Firestore subscription manager
// ================================================================
import { canEdit } from "./auth.js?v=2026-07-15-room-availability-separation-r355";
import { initialLoad, subscribeDomains, unsubscribeAll, unsubscribeDomains } from "./state.js?v=2026-07-15-room-availability-separation-r355";

// 화면별로 필요한 Firestore 도메인만 실시간 구독합니다.
// appState에는 마지막으로 읽은 값이 남아 있으므로, 화면 전환 시 필요한 도메인만 다시 붙입니다.
export const VIEW_DOMAIN_SETS = {
  board:        ["curriculum", "templates", "teachers"],
  manager:      ["curriculum", "templates", "teachers"],
  teachers:     ["templates", "teachers"],
  students:     ["classes", "rosters"],
  rooms:        ["rooms", "teachers", "classes"],
  subjectsetup: ["curriculum", "templates", "rosters"],
  rosters:      ["curriculum", "templates", "classes", "rosters"],
  ttcards:      ["curriculum", "templates", "classes", "rosters", "rooms", "timetable"],
  groups:       ["curriculum", "templates", "classes", "rosters", "rooms", "timetable"],
  results:      ["curriculum", "templates", "rosters"],
};

let activeDomainSubscriptions = new Set();

function uniqueDomains(domains) {
  return [...new Set(domains || [])].filter(Boolean);
}

function nextFrame(callback) {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
  return setTimeout(callback, 16);
}

export function domainsForView(view) {
  return VIEW_DOMAIN_SETS[view] || VIEW_DOMAIN_SETS.board;
}

export function getActiveDomainSubscriptions() {
  return new Set(activeDomainSubscriptions);
}

export function resetDomainSubscriptions() {
  activeDomainSubscriptions.clear();
}

export function stopAllDomainSubscriptions() {
  try {
    unsubscribeAll();
  } finally {
    resetDomainSubscriptions();
  }
}

export function waitForDomainsLoaded(domains, timeoutMs = 7000) {
  const list = uniqueDomains(domains);
  if (!list.length || list.every(domain => initialLoad[domain])) return Promise.resolve(true);

  const startedAt = Date.now();
  const timeout = Math.max(1000, Number(timeoutMs) || 7000);

  return new Promise(resolve => {
    let settled = false;

    const finish = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const check = () => {
      if (settled) return;

      const pending = list.filter(domain => !initialLoad[domain]);
      if (!pending.length) return finish(true);

      if (Date.now() - startedAt >= timeout) {
        console.warn(`[domain-load] timeout after ${timeout}ms: ${pending.join(", ")}`);
        return finish(false);
      }

      nextFrame(check);
    };

    // subscribeDomains 직후 동기 반영을 먼저 받을 수 있도록 microtask 이후부터 확인합니다.
    Promise.resolve().then(() => {
      if (list.every(domain => initialLoad[domain])) finish(true);
      else nextFrame(check);
    });
  });
}

export function syncDomainSubscriptionsForView(view) {
  if (!canEdit()) return false;

  const desired = new Set(domainsForView(view));
  const toRemove = [...activeDomainSubscriptions].filter(domain => !desired.has(domain));
  const toAdd = [...desired].filter(domain => !activeDomainSubscriptions.has(domain));

  if (toRemove.length) {
    unsubscribeDomains(toRemove);
    toRemove.forEach(domain => activeDomainSubscriptions.delete(domain));
  }

  if (toAdd.length) {
    // subscribeDomains는 이미 구독 중인 도메인은 건너뛰므로 전체 desired를 넘겨도 안전합니다.
    subscribeDomains([...desired]);
    toAdd.forEach(domain => activeDomainSubscriptions.add(domain));
  }

  return true;
}

export async function ensureDomains(domains, timeoutMs = 7000) {
  if (!canEdit()) return false;

  const requested = uniqueDomains(domains);
  const desired = new Set([...activeDomainSubscriptions, ...requested]);
  const toAdd = [...desired].filter(domain => !activeDomainSubscriptions.has(domain));

  if (toAdd.length) {
    subscribeDomains([...desired]);
    toAdd.forEach(domain => activeDomainSubscriptions.add(domain));
  }

  return waitForDomainsLoaded(requested, timeoutMs);
}
