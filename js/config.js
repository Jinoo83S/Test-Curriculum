// ================================================================
// config.js · Firebase Init + App Constants
// ================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, doc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ACTIVE_SCHOOL_YEAR, IS_LEGACY_SCHOOL_YEAR } from "./school-year.js";

const firebaseConfig = {
  apiKey: "AIzaSyBwUERcfAYMiqewOsp9zsY6_CnHef-nfK0",
  authDomain: "his-curriculum-8e737.firebaseapp.com",
  projectId: "his-curriculum-8e737",
  storageBucket: "his-curriculum-8e737.firebasestorage.app",
  messagingSenderId: "1091130688532",
  appId: "1:1091130688532:web:79622f9da3591ab2d3d301",
};

export const fbApp    = initializeApp(firebaseConfig);
export const auth     = getAuth(fbApp);
// IndexedDB 오프라인 캐시 — 단일탭 모드 (redirect 흐름과 충돌 없음)
export const db = initializeFirestore(fbApp, {
  cache: persistentLocalCache()
});
export const provider = new GoogleAuthProvider();

// ── Firestore refs — active academic-year workspace ─────────────
// 2026 keeps the existing production paths. New years are isolated under
// schoolYears/{year}/domains so next-year preparation cannot overwrite 2026.
export { ACTIVE_SCHOOL_YEAR, IS_LEGACY_SCHOOL_YEAR };
export const schoolYearDomainPath = (domain) => IS_LEGACY_SCHOOL_YEAR
  ? `boards/${domain}`
  : `schoolYears/${ACTIVE_SCHOOL_YEAR}/domains/${domain}`;
export const refs = Object.fromEntries([
  "curriculum", "templates", "classes", "teachers", "rosters", "rooms", "timetable", "main"
].map(domain => [domain === "main" ? "legacy" : domain, IS_LEGACY_SCHOOL_YEAR
  ? doc(db, "boards", domain)
  : doc(db, "schoolYears", ACTIVE_SCHOOL_YEAR, "domains", domain)]));

// ── Grade / group constants ───────────────────────────────────────
export const GRADE_KEYS   = ["7학년","8학년","9학년","10학년","11학년","12학년"];
export const GRADE_GROUPS = {
  tab7to9:   ["7학년","8학년","9학년"],
  tab10to12: ["10학년","11학년","12학년"]
};
export const DEFAULT_OPTIONS = {
  category: ["교과","창체"],
  track:    ["공통","배정","선택"],
  group:    ["선택","국어","영어","수학","사회","과학","정보","예술","체육","자율활동","동아리","채플","기타"]
};
export const DEFAULT_ROW_COUNT  = 4;
export const SEMESTER_LABELS    = { sem1:"1학기", sem2:"2학기" };
export const CATEGORY_PALETTE   = [
  {bg:"#dbeafe",text:"#1e3a8a"},{bg:"#dcfce7",text:"#166534"},
  {bg:"#fef3c7",text:"#92400e"},{bg:"#fce7f3",text:"#9d174d"},
  {bg:"#ede9fe",text:"#5b21b6"},{bg:"#cffafe",text:"#155e75"}
];
export const DEFAULT_COL_WIDTHS = ["52px","52px","58px","1fr","1fr","40px","24px"];
export const colWidthsKey = (g) => `his_cw_${g}`;
