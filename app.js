const STORAGE_KEY = "curriculum-board-v5";

const defaultSubjects = [
  { nameKo: "영어", nameEn: "English", teacher: "", language: "English" },
  { nameKo: "수학", nameEn: "Math", teacher: "", language: "Both" },
  { nameKo: "과학", nameEn: "Science", teacher: "", language: "Both" },
  { nameKo: "성경", nameEn: "Bible", teacher: "", language: "English" },
  { nameKo: "체육", nameEn: "PE", teacher: "", language: "Korean" },
  { nameKo: "미술", nameEn: "Art", teacher: "", language: "Korean" }
];

const pool = document.getElementById("cardPool");
const cells = document.querySelectorAll(".drop-cell");
const areas = document.querySelectorAll(".drop-area");
const resetBtn = document.getElementById("resetBtn");

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

function makeId() {
  return `subj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getCellKeys() {
  return [...cells].map(cell => cell.dataset.cell);
}

function normalizeCard(card) {
  return {
    id: card.id || makeId(),
    nameKo: card.nameKo ?? card.name ?? "",
    nameEn: card.nameEn ?? "",
    teacher: card.teacher ?? "",
    language: ["Korean", "English", "Both"].includes(card.language) ? card.language : "Both"
  };
}

function createInitialState() {
  const state = {
    pool: defaultSubjects.map(item => normalizeCard(item)),
    cells: {}
  };

  getCellKeys().forEach(key => {
    state.cells[key] = [];
  });

  return state;
}

let state = createInitialState();

function getLegacySavedData() {
  return (
    localStorage.getItem(STORAGE_KEY) ||
    localStorage.getItem("curriculum-board-v3") ||
    localStorage.getItem("curriculum-board-v2")
  );
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  const saved = getLegacySavedData();

  if (!saved) {
    state = createInitialState();
    saveState();
    return;
  }

  try {
    const parsed = JSON.parse(saved);
    const emptyTemplate = createInitialState();

    state = {
      pool: Array.isArray(parsed.pool) ? parsed.pool.map(normalizeCard) : emptyTemplate.pool,
      cells: {}
    };

    getCellKeys().forEach(key => {
      const source = Array.isArray(parsed.cells?.[key]) ? parsed.cells[key] : [];
      state.cells[key] = source.map(normalizeCard);
    });

    saveState();
  } catch (e) {
    state = createInitialState();
    saveState();
  }
}

function findCardById(cardId) {
  const inPool = state.pool.find(card => card.id === cardId);
  if (inPool) return inPool;

  for (const key of Object.keys(state.cells)) {
    const found = state.cells[key].find(card => card.id === cardId);
    if (found) return found;
  }

  return null;
}

function removeCardById(cardId) {
  state.pool = state.pool.filter(card => card.id !== cardId);

  Object.keys(state.cells).forEach(key => {
    state.cells[key] = state.cells[key].filter(card => card.id !== cardId);
  });
}

function moveCardToArea(cardId, areaName) {
  const card = findCardById(cardId);
  if (!card) return;

  removeCardById(cardId);

  if (areaName === "pool") {
    state.pool.push(card);
  } else {
    state.cells[areaName].push(card);
  }

  saveState();
  render();
}

function getCardLabel(card) {
  return card.nameKo || card.nameEn || "이름 없음";
}

function addNewCard(cardData) {
  if (!cardData.nameKo.trim() && !cardData.nameEn.trim()) {
    alert("한글 이름 또는 영어 이름 중 하나는 입력해 주세요.");
    return;
  }

  state.pool.push(
    normalizeCard({
      id: makeId(),
      ...cardData
    })
  );

  saveState();
  render();
}

function updateCard(cardId, cardData) {
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

  saveState();
  render();
}

function deleteCard(cardId) {
  removeCardById(cardId);
  saveState();
  render();
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
  meta.appendChild(createMetaBadge(`${card.language}`));
  if (card.teacher) {
    meta.appendChild(createMetaBadge(`${card.teacher}`));
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

  editBtn.addEventListener("click", e => {
    e.stopPropagation();
    openEditModal(card.id);
  });

  deleteBtn.addEventListener("click", e => {
    e.stopPropagation();
    const ok = confirm(`"${getCardLabel(card)}" 카드를 삭제할까요?`);
    if (!ok) return;
    deleteCard(card.id);
  });

  editBtn.addEventListener("mousedown", e => e.stopPropagation());
  deleteBtn.addEventListener("mousedown", e => e.stopPropagation());

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
  cardList.forEach(card => {
    target.appendChild(createCardElement(card));
  });
}

function render() {
  renderArea(pool, state.pool);

  cells.forEach(cell => {
    const key = cell.dataset.cell;
    renderArea(cell, state.cells[key] || []);
  });
}

areas.forEach(area => {
  area.addEventListener("dragover", e => {
    e.preventDefault();
    area.classList.add("dragover");
  });

  area.addEventListener("dragleave", () => {
    area.classList.remove("dragover");
  });

  area.addEventListener("drop", e => {
    e.preventDefault();
    area.classList.remove("dragover");

    if (!draggedCardId) return;

    const targetArea = area.dataset.area || area.dataset.cell;
    moveCardToArea(draggedCardId, targetArea);
    draggedCardId = null;
  });
});

addSubjectBtn.addEventListener("click", () => {
  addNewCard({
    nameKo: newNameKo.value,
    nameEn: newNameEn.value,
    teacher: newTeacher.value,
    language: newLanguage.value
  });

  newNameKo.value = "";
  newNameEn.value = "";
  newTeacher.value = "";
  newLanguage.value = "Korean";
  newNameKo.focus();
});

[newNameKo, newNameEn, newTeacher].forEach(input => {
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      addSubjectBtn.click();
    }
  });
});

saveEditBtn.addEventListener("click", () => {
  if (!editingCardId) return;

  updateCard(editingCardId, {
    nameKo: editNameKo.value,
    nameEn: editNameEn.value,
    teacher: editTeacher.value,
    language: editLanguage.value
  });

  closeEditModal();
});

cancelEditBtn.addEventListener("click", closeEditModal);

editModal.addEventListener("click", e => {
  if (e.target === editModal) {
    closeEditModal();
  }
});

resetBtn.addEventListener("click", () => {
  const ok = confirm("전체 보드를 초기화할까요?");
  if (!ok) return;

  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem("curriculum-board-v3");
  localStorage.removeItem("curriculum-board-v2");
  loadState();
  render();
});

loadState();
render();