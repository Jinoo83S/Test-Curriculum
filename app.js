const STORAGE_KEY = "curriculum-board-v2";

const defaultSubjects = [
  "English 7",
  "Math 7",
  "Science 7",
  "Bible 7",
  "PE 7",
  "Art 7"
];

const pool = document.getElementById("cardPool");
const cells = document.querySelectorAll(".drop-cell");
const areas = document.querySelectorAll(".drop-area");
const resetBtn = document.getElementById("resetBtn");
const addSubjectBtn = document.getElementById("addSubjectBtn");
const newSubjectInput = document.getElementById("newSubjectInput");

let draggedCardId = null;

function makeId() {
  return `subj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getCellKeys() {
  return [...cells].map(cell => cell.dataset.cell);
}

function createInitialState() {
  const state = {
    pool: defaultSubjects.map(name => ({
      id: makeId(),
      name
    })),
    cells: {}
  };

  getCellKeys().forEach(key => {
    state.cells[key] = [];
  });

  return state;
}

let state = createInitialState();

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);

  if (!saved) {
    state = createInitialState();
    saveState();
    return;
  }

  try {
    const parsed = JSON.parse(saved);
    const emptyTemplate = createInitialState();

    state = {
      pool: Array.isArray(parsed.pool) ? parsed.pool : emptyTemplate.pool,
      cells: { ...emptyTemplate.cells, ...(parsed.cells || {}) }
    };

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

function updateCardName(cardId, newName) {
  const trimmed = newName.trim();
  if (!trimmed) return;

  const card = findCardById(cardId);
  if (!card) return;

  card.name = trimmed;
  saveState();
  render();
}

function deleteCard(cardId) {
  removeCardById(cardId);
  saveState();
  render();
}

function addNewCard(name) {
  const trimmed = name.trim();
  if (!trimmed) return;

  state.pool.push({
    id: makeId(),
    name: trimmed
  });

  saveState();
  render();
}

function createCardElement(card) {
  const el = document.createElement("div");
  el.className = "subject-card";
  el.draggable = true;
  el.dataset.id = card.id;

  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = card.name;

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
    const nextName = prompt("과목명을 수정하세요.", card.name);
    if (nextName === null) return;
    updateCardName(card.id, nextName);
  });

  deleteBtn.addEventListener("click", e => {
    e.stopPropagation();
    const ok = confirm(`"${card.name}" 카드를 삭제할까요?`);
    if (!ok) return;
    deleteCard(card.id);
  });

  editBtn.addEventListener("mousedown", e => e.stopPropagation());
  deleteBtn.addEventListener("mousedown", e => e.stopPropagation());

  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);

  el.appendChild(title);
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
  addNewCard(newSubjectInput.value);
  newSubjectInput.value = "";
  newSubjectInput.focus();
});

newSubjectInput.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    addNewCard(newSubjectInput.value);
    newSubjectInput.value = "";
  }
});

resetBtn.addEventListener("click", () => {
  const ok = confirm("전체 보드를 초기화할까요?");
  if (!ok) return;

  localStorage.removeItem(STORAGE_KEY);
  loadState();
  render();
});

loadState();
render();