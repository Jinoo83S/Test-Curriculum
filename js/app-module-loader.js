// ================================================================
// app-module-loader.js · Lazy module loader for main app views
// ================================================================
import { versioned } from "./version.js?v=2026-07-03-cpsat-fixed-room-preflight-r217";

const DEFAULT_MODULE_PATHS = Object.freeze({
  students:     "./students.js",
  teachers:     "./teachers.js",
  rosters:      "./rosters.js",
  results:      "./results.js",
  ttcards:      "./ttcards.js",
  subjectSetup: "./subject-setup.js",
  rooms:        "./rooms.js",
});

export function createAppModuleLoader(modulePaths = DEFAULT_MODULE_PATHS) {
  const cache = new Map();

  function resolvePath(key) {
    const path = modulePaths[key];
    if (!path) {
      throw new Error(`Unknown lazy module: ${key}`);
    }
    return path;
  }

  function load(key) {
    if (cache.has(key)) return cache.get(key);

    const path = resolvePath(key);
    const promise = import(versioned(path)).catch(err => {
      // 실패한 Promise를 계속 캐시에 두면 재시도가 불가능합니다.
      cache.delete(key);
      console.error(`[module-loader:${key}]`, err);
      throw err;
    });

    cache.set(key, promise);
    return promise;
  }

  function preload(keys = []) {
    return Promise.allSettled(keys.map(key => load(key)));
  }

  function clear(key) {
    if (key) cache.delete(key);
    else cache.clear();
  }

  function has(key) {
    return cache.has(key);
  }

  return { load, preload, clear, has };
}

export const APP_LAZY_MODULES = DEFAULT_MODULE_PATHS;
