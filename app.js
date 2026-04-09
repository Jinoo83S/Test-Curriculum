import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBwUERcfAYMiqewOsp9zsY6_CnHef-nfK0",
  authDomain: "his-curriculum-8e737.firebaseapp.com",
  projectId: "his-curriculum-8e737",
  storageBucket: "his-curriculum-8e737.firebasestorage.app",
  messagingSenderId: "1091130688532",
  appId: "1:1091130688532:web:79622f9da3591ab2d3d301",
};

const BOARD_DOCUMENT_PATH = ["boards", "main"];

const defaultSubjects = [
  { nameKo: "영어", nameEn: "English", teacher: "", language: "English" },
  { nameKo: "수학", nameEn: "Math", teacher: "", language: "Both" },
  { nameKo: "과학", nameEn: "Science", teacher: "", language: "Both" },
  { nameKo: "성경", nameEn: "Bible", teacher: "", language: "English" },
  { nameKo: "체육", nameEn: "PE", teacher: "", language: "Korean" },
  { nameKo: "미술", nameEn: "Art", teacher: "", language: "Korean" },
];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
const boardRef = doc(db, ...BOARD_DOCUMENT_PATH);

const pool = document.getElementById("cardPool");
const cells = document.querySelectorAll(".drop-cell");
const areas = document.querySelectorAll(".drop-area");
const resetBtn = document.getElementById("resetBtn");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const userInfo = document.getElementById("userInfo");
const loginNotice = document.getElementById("loginNotice");
const appLayout = document.getElementById("appLayout");

const addSubjectBtn = document.getElementById("addSubjectBtn");
const newNameKo = document.getElementById("newNameKo");
const newNameEn = document.getElementById("newNameEn");
const newTeacher = document.getElementById("newTeacher");
const newLanguage = document.getElementById("newLanguage");

const editModal = document.getElementById("editModal");
const editNameKo = document.getElementById("editNameKo");
const editNameEn = document.getElementById("editNameEn");
const editTeacher = document.getElementById("editTeacher");
const editLanguage = document.getElementById("editLanguage");
const saveEditBtn = document.getElementById("saveEditBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");

let draggedCardId = null;
let editingCardId = null;
let currentUser = null;
let unsubscribeBoard = null;
let isBoardLoaded = false;

function makeId() {
  return `subj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getCellKeys() {
  return [...cells].map((cell) => cell.dataset.cell);
}

function stripGradeSuffix(text) {
  if (!text) return "";
  return String(text).replace(/\s+(7|8|9|10|11|12)$/g, "").trim();
}

function normalizeCard(card) {
  return {
    id: card.id || makeId(),
    nameKo: stripGradeSuffix(card.nameKo ?? card.name ?? ""),
    nameEn: stripGradeSuffix(card.nameEn ?? ""),
    teacher: card.teacher ?? "",
    language: ["Korean", "English", "Both"].includes(card.language)
      ? card.language
      : "Both",
  };
}

function createInitialState() {
  const state = {
    pool: defaultSubjects.map((item) => normalizeCard(item)),
    cells: {},
  };

  getCellKeys().forEach((key) => {
    state.cells[key] = [];
  });

  return state;
}

let state = createInitialState();

function normalizeState(source) {
  const emptyTemplate = createInitialState();

  const nextState = {
    pool: Array.isArray(source?.pool)
      ? source.pool.map(normalizeCard)
      : emptyTemplate.pool,
    cells: {},
  };

  getCellKeys().forEach((key) => {
    const sourceCards = Array.isArray(source?.cells?.[key]) ? source.cells[key] : [];
    nextState.cells[key] = sourceCards.map(normalizeCard);
  });

  return nextState;
}

async function saveState() {
  if (!currentUser) return;

  await setDoc(
    boardRef,
    {
      state,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.email || currentUser.uid,
    },
    { merge: true }
  );
}

async function ensureBoardExists() {
  const snap = await getDoc(boardRef);
  if (!snap.exists()) {
    state = createInitialState();
    await saveState();
  }
}

function findCardById(cardId) {
  const inPool = state.pool.find((card) => card.id === cardId);
  if (inPool) return inPool;

  for (const key of Object.keys(state.cells)) {
    const found = state.cells[key].find((card) => card.id === cardId);
    if (found) return found;
  }

  return null;
}

function removeCardById(cardId) {
  state.pool = state.pool.filter((card) => card.id !== cardId);

  Object.keys(state.cells).forEach((key) => {
    state.cells[key] = state.cells[key].filter((card) => card.id !== cardId);
  });
}

async function moveCardToArea(cardId, areaName) {
  const card = findCardById(cardId);
  if (!card) return;

  removeCardById(cardId);

  if (areaName === "pool") {
    state.pool.push(card);
  } else {
    state.cells[areaName].push(card);
  }

  render();
  await saveState();
}

function getCardLabel(card) {
  return card.nameKo || card.nameEn || "이름 없음";
}

async function addNewCard(cardData) {
  if (!cardData.nameKo.trim() && !cardData.nameEn.trim()) {
    alert("한글 이름 또는 영어 이름 중 하나는 입력해 주세요.");
    return;
  }

  state.pool.push(
    normalizeCard({
      id: makeId(),
      ...cardData,
    })
  );

  render();
  await saveState();
}

async function updateCard(cardId, cardData) {
  const card = findCardById(cardId);
  if (!card) return;

  if (!cardData.nameKo.trim() && !cardData.nameEn.trim()) {
    alert("한글 이름 또는 영어 이름 중 하나는 입력해 주세요.");
    return;
  }

  card.nameKo = cardData.nameKo.trim();
  card.nameEn = cardData.nameEn.trim();
  card.teacher = cardData.teacher.trim();
  card.language = cardData.language;

  render();
  await saveState();
}

async function deleteCard(cardId) {
  removeCardById(cardId);
  render();
  await saveState();
}

function openEditModal(cardId) {
  const card = findCardById(cardId);
  if (!card) return;

  editingCardId = cardId;
  editNameKo.value = card.nameKo;
  editNameEn.value = card.nameEn;
  editTeacher.value = card.teacher;
  editLanguage.value = card.language;
  editModal.classList.remove("hidden");
}

function closeEditModal() {
  editingCardId = null;
  editModal.classList.add("hidden");
}

function createMetaBadge(text) {
  const badge = document.createElement("span");
  badge.className = "meta-badge";
  badge.textContent = text;
  return badge;
}

function createCardElement(card) {
  const el = document.createElement("div");
  el.className = `subject-card lang-${card.language.toLowerCase()}`;
  el.draggable = true;
  el.dataset.id = card.id;

  const main = document.createElement("div");
  main.className = "card-main";

  const ko = document.createElement("div");
  ko.className = "card-name-ko";
  ko.textContent = card.nameKo || "-";

  const en = document.createElement("div");
  en.className = "card-name-en";
  en.textContent = card.nameEn || "-";

  main.appendChild(ko);
  main.appendChild(en);

  const meta = document.createElement("div");
  meta.className = "card-meta";
  meta.appendChild(createMetaBadge(card.language));
  if (card.teacher) {
    meta.appendChild(createMetaBadge(card.teacher));
  }

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const editBtn = document.createElement("button");
  editBtn.className = "edit-btn";
  editBtn.textContent = "수정";
  editBtn.type = "button";

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "delete-btn";
  deleteBtn.textContent = "삭제";
  deleteBtn.type = "button";

  editBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openEditModal(card.id);
  });

  deleteBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const ok = confirm(`"${getCardLabel(card)}" 카드를 삭제할까요?`);
    if (!ok) return;
    await deleteCard(card.id);
  });

  editBtn.addEventListener("mousedown", (e) => e.stopPropagation());
  deleteBtn.addEventListener("mousedown", (e) => e.stopPropagation());

  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);

  el.appendChild(main);
  el.appendChild(meta);
  el.appendChild(actions);

  el.addEventListener("dragstart", () => {
    draggedCardId = card.id;
    el.classList.add("dragging");
  });

  el.addEventListener("dragend", () => {
    el.classList.remove("dragging");
  });

  return el;
}

function renderArea(target, cardList) {
  target.innerHTML = "";
  cardList.forEach((card) => {
    target.appendChild(createCardElement(card));
  });
}

function render() {
  renderArea(pool, state.pool);

  cells.forEach((cell) => {
    const key = cell.dataset.cell;
    renderArea(cell, state.cells[key] || []);
  });
}

function setEditingEnabled(enabled) {
  appLayout.classList.toggle("disabled", !enabled);
  loginNotice.classList.toggle("hidden", enabled);
  logoutBtn.classList.toggle("hidden", !enabled);
  resetBtn.classList.toggle("hidden", !enabled);
  loginBtn.classList.toggle("hidden", enabled);
}

areas.forEach((area) => {
  area.addEventListener("dragover", (e) => {
    if (!currentUser) return;
    e.preventDefault();
    area.classList.add("dragover");
  });

  area.addEventListener("dragleave", () => {
    area.classList.remove("dragover");
  });

  area.addEventListener("drop", async (e) => {
    if (!currentUser) return;
    e.preventDefault();
    area.classList.remove("dragover");

    if (!draggedCardId) return;

    const targetArea = area.dataset.area || area.dataset.cell;
    await moveCardToArea(draggedCardId, targetArea);
    draggedCardId = null;
  });
});

addSubjectBtn.addEventListener("click", async () => {
  if (!currentUser) return;

  await addNewCard({
    nameKo: newNameKo.value,
    nameEn: newNameEn.value,
    teacher: newTeacher.value,
    language: newLanguage.value,
  });

  newNameKo.value = "";
  newNameEn.value = "";
  newTeacher.value = "";
  newLanguage.value = "Korean";
  newNameKo.focus();
});

[newNameKo, newNameEn, newTeacher].forEach((input) => {
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      addSubjectBtn.click();
    }
  });
});

saveEditBtn.addEventListener("click", async () => {
  if (!editingCardId) return;

  await updateCard(editingCardId, {
    nameKo: editNameKo.value,
    nameEn: editNameEn.value,
    teacher: editTeacher.value,
    language: editLanguage.value,
  });

  closeEditModal();
});

cancelEditBtn.addEventListener("click", closeEditModal);

editModal.addEventListener("click", (e) => {
  if (e.target === editModal) {
    closeEditModal();
  }
});

resetBtn.addEventListener("click", async () => {
  if (!currentUser) return;

  const ok = confirm("전체 보드를 초기화할까요?");
  if (!ok) return;

  state = createInitialState();
  render();
  await saveState();
});

loginBtn.addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    alert(`로그인 실패: ${error.message}`);
  }
});

logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (unsubscribeBoard) {
    unsubscribeBoard();
    unsubscribeBoard = null;
  }

  if (!user) {
    userInfo.textContent = "로그인 안 됨";
    setEditingEnabled(false);
    state = createInitialState();
    render();
    isBoardLoaded = false;
    return;
  }

  userInfo.textContent = user.email || user.displayName || "로그인됨";
  setEditingEnabled(true);

  try {
    await ensureBoardExists();

    unsubscribeBoard = onSnapshot(boardRef, (snap) => {
      if (!snap.exists()) return;
      state = normalizeState(snap.data().state);
      render();
      isBoardLoaded = true;
    });
  } catch (error) {
    alert(`보드 불러오기 실패: ${error.message}`);
  }
});

render();
