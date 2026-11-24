import { ACTIVE_SCHOOL_YEAR, LEGACY_SCHOOL_YEAR, getSchoolYearRefs, assertSchoolYearWriteContext } from "./config.js?v=2026-07-15-room-availability-separation-r355";
import { getKnownSchoolYears } from "./school-year.js?v=2026-07-15-room-availability-separation-r355";
import { LOCAL_DEV_MODE } from "./local-dev.js?v=2026-07-15-room-availability-separation-r355";
import { readRegisteredPortalYears } from "./school-portal-settings-data.js?v=r431";
import { getDocFromServer } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const nameKey = value => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

export function planRoomYearImport(source, existing) {
  const names = new Set(existing.map(room => nameKey(room.name)).filter(Boolean));
  const rooms = [], duplicates = [];
  for (const room of Array.isArray(source?.rooms) ? source.rooms : []) {
    const name = String(room?.name ?? "").trim();
    const key = nameKey(name);
    if (!key) continue;
    if (names.has(key)) { duplicates.push(name); continue; }
    names.add(key);
    const { type, capacity, grade, sharedUse, note } = room;
    rooms.push({ name, type, capacity, grade, sharedUse, note });
  }
  return { rooms, duplicates };
}

async function loadRoomsForYear(year) {
  if (LOCAL_DEV_MODE) {
    const key = year === LEGACY_SCHOOL_YEAR ? "his_local_dev_state_v1" : `his_local_dev_state_v1_${year}`;
    const snapshot = JSON.parse(localStorage.getItem(key) || "null");
    return (snapshot?.data || snapshot)?.rooms;
  }
  const snapshot = await getDocFromServer(getSchoolYearRefs(year).domains.rooms);
  return snapshot.data();
}

export async function openRoomYearImport({ existing, canApply, onApply }) {
  if (document.getElementById("roomYearImportDialog")?.open) return;
  const dialog = document.createElement("dialog");
  dialog.id = "roomYearImportDialog";
  dialog.className = "room-year-import-dialog";
  dialog.setAttribute("aria-labelledby", "roomYearImportTitle");
  const title = document.createElement("h2");
  title.id = "roomYearImportTitle";
  title.textContent = "다른 학년도 교실 가져오기";
  const hint = document.createElement("p");
  hint.textContent = `${ACTIVE_SCHOOL_YEAR}학년도에 새 교실만 추가합니다. 교실명·유형·수용인원·전용학년·복수배정·메모를 가져옵니다.`;
  const help = document.createElement("p");
  help.textContent = "홈룸, 담당 교사, 불가시간과 시간표 배정은 해당 학년도에서 따로 관리합니다.";
  const label = document.createElement("label");
  const select = document.createElement("select");
  select.id = "roomImportYear";
  label.append("가져올 학년도 ", select);
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const preview = document.createElement("ul");
  preview.className = "room-year-import-preview";
  const buttons = document.createElement("div");
  buttons.className = "room-year-import-actions";
  const cancel = document.createElement("button");
  cancel.className = "secondary-btn";
  cancel.type = "button";
  cancel.textContent = "닫기";
  const apply = document.createElement("button");
  apply.className = "primary-btn";
  apply.type = "button";
  apply.textContent = "새 교실 가져오기";
  apply.disabled = true;
  buttons.append(cancel, apply);
  dialog.append(title, hint, help, label, status, preview, buttons);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  cancel.addEventListener("click", () => dialog.close());
  dialog.showModal();

  let data, reviewed, request = 0;
  function showPreview() {
    reviewed = planRoomYearImport(data, existing());
    const { rooms, duplicates } = reviewed;
    status.textContent = `추가 ${rooms.length}개 · 같은 이름으로 제외 ${duplicates.length}개`;
    preview.replaceChildren(...[...rooms.map(room => `추가 · ${room.name}`), ...duplicates.map(name => `제외 · ${name}`)].map(value => {
      const item = document.createElement("li");
      item.textContent = value;
      return item;
    }));
    apply.disabled = !rooms.length || !canApply();
  }
  select.addEventListener("change", async () => {
    const serial = ++request;
    const year = select.value;
    reviewed = null;
    apply.disabled = true;
    preview.replaceChildren();
    if (!year) { status.textContent = ""; return; }
    status.textContent = `${year}학년도 교실을 불러오는 중입니다.`;
    try {
      const result = await loadRoomsForYear(year);
      if (!dialog.open || serial !== request) return;
      data = result;
      showPreview();
    } catch (error) {
      if (dialog.open && serial === request) status.textContent = `교실 조회 실패 · ${error.message}`;
    }
  });
  apply.addEventListener("click", () => {
    if (!reviewed?.rooms.length || !canApply()) return;
    try {
      assertSchoolYearWriteContext("다른 학년도 교실 가져오기");
      const latest = planRoomYearImport(data, existing());
      if (JSON.stringify(latest) !== JSON.stringify(reviewed)) {
        showPreview();
        status.prepend("현재 학년도 교실이 변경되었습니다. 다시 확인해 주세요. ");
        return;
      }
      onApply(latest.rooms);
      dialog.close();
    } catch (error) {
      status.textContent = `가져오기 실패 · ${error.message}`;
    }
  });

  select.disabled = true;
  status.textContent = "학년도 목록을 불러오는 중입니다.";
  const years = LOCAL_DEV_MODE ? getKnownSchoolYears() : await readRegisteredPortalYears().catch(() => getKnownSchoolYears());
  if (!dialog.open) return;
  const sourceYears = years.filter(year => year !== ACTIVE_SCHOOL_YEAR);
  select.replaceChildren(new Option("학년도 선택", ""), ...sourceYears.map(year => new Option(`${year}학년도`, year)));
  select.disabled = !sourceYears.length;
  status.textContent = sourceYears.length ? "" : "가져올 수 있는 다른 학년도가 없습니다.";
}
