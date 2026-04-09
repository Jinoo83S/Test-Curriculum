const pool = document.getElementById("cardPool");
const cells = document.querySelectorAll(".drop-cell");
const resetBtn = document.getElementById("resetBtn");

let draggedCard = null;

function saveBoard() {
  const data = {
    pool: [...pool.querySelectorAll(".subject-card")].map(card => card.dataset.subject),
    cells: {}
  };

  cells.forEach(cell => {
    const key = cell.dataset.cell;
    data.cells[key] = [...cell.querySelectorAll(".subject-card")].map(card => card.dataset.subject);
  });

  localStorage.setItem("curriculum-board", JSON.stringify(data));
}

function createCard(name) {
  const card = document.createElement("div");
  card.className = "subject-card";
  card.draggable = true;
  card.dataset.subject = name;
  card.textContent = name;

  card.addEventListener("dragstart", () => {
    draggedCard = card;
    card.classList.add("dragging");
  });

  card.addEventListener("dragend", () => {
    card.classList.remove("dragging");
    draggedCard = null;
    saveBoard();
  });

  return card;
}

function loadBoard() {
  const saved = localStorage.getItem("curriculum-board");
  if (!saved) {
    bindInitialCards();
    return;
  }

  const data = JSON.parse(saved);

  pool.innerHTML = "";
  cells.forEach(cell => (cell.innerHTML = ""));

  data.pool.forEach(name => {
    pool.appendChild(createCard(name));
  });

  Object.entries(data.cells).forEach(([cellKey, subjects]) => {
    const targetCell = document.querySelector(`.drop-cell[data-cell="${cellKey}"]`);
    if (!targetCell) return;
    subjects.forEach(name => {
      targetCell.appendChild(createCard(name));
    });
  });
}

function bindInitialCards() {
  const initialCards = [...document.querySelectorAll(".subject-card")];
  initialCards.forEach(card => {
    const newCard = createCard(card.dataset.subject);
    card.replaceWith(newCard);
  });
  saveBoard();
}

[pool, ...cells].forEach(area => {
  area.addEventListener("dragover", e => {
    e.preventDefault();
    if (area.classList.contains("drop-cell")) {
      area.classList.add("dragover");
    }
  });

  area.addEventListener("dragleave", () => {
    area.classList.remove("dragover");
  });

  area.addEventListener("drop", e => {
    e.preventDefault();
    area.classList.remove("dragover");
    if (!draggedCard) return;
    area.appendChild(draggedCard);
    saveBoard();
  });
});

resetBtn.addEventListener("click", () => {
  localStorage.removeItem("curriculum-board");
  location.reload();
});

loadBoard();
