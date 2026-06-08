// ================================================================
// app-sidebar-ui.js · Application sidebar collapse / resize controls
// ================================================================

const STORAGE_KEY = "cur_sbW";
const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 220;
const MAX_WIDTH = 520;

function clampWidth(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_WIDTH;
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(n)));
}

function ensureFloatingToggle(pageEl, sidebarEl) {
  let btn = document.getElementById("appSidebarFloatingToggle");
  if (btn || !pageEl || !sidebarEl) return btn;

  btn = document.createElement("button");
  btn.id = "appSidebarFloatingToggle";
  btn.type = "button";
  btn.className = "sidebar-floating-toggle hidden";
  btn.textContent = "▶";
  btn.title = "사이드바 펼치기";
  document.body.appendChild(btn);
  return btn;
}

export function setupAppSidebarUi(options = {}) {
  const pageEl = options.pageEl || document.querySelector(".page");
  const sidebarEl = options.sidebarEl || document.getElementById("appSidebar");
  const sidebarToggleBtn = options.toggleBtn || document.getElementById("appSidebarToggle");
  const sidebarResizer = options.resizer || document.getElementById("appSidebarResizer");
  const floatingToggleBtn = options.floatingToggleBtn || ensureFloatingToggle(pageEl, sidebarEl);

  if (!pageEl) return null;

  let sidebarWidth = clampWidth(localStorage.getItem(STORAGE_KEY) || DEFAULT_WIDTH);

  function applySidebarState(hidden = pageEl.classList.contains("sidebar-hidden")) {
    const isHidden = !!hidden;
    pageEl.style.setProperty("--sidebar-width", isHidden ? "0px" : `${sidebarWidth}px`);
    pageEl.classList.toggle("sidebar-hidden", isHidden);

    if (sidebarToggleBtn) {
      sidebarToggleBtn.textContent = isHidden ? "▶" : "◀";
      sidebarToggleBtn.title = isHidden ? "사이드바 펼치기" : "사이드바 접기";
      sidebarToggleBtn.setAttribute("aria-expanded", String(!isHidden));
    }

    if (floatingToggleBtn) {
      floatingToggleBtn.classList.toggle("hidden", !isHidden);
      floatingToggleBtn.textContent = "▶";
      floatingToggleBtn.title = "사이드바 펼치기";
      floatingToggleBtn.setAttribute("aria-expanded", String(!isHidden));
    }
  }

  function toggleSidebar() {
    applySidebarState(!pageEl.classList.contains("sidebar-hidden"));
  }

  sidebarToggleBtn?.addEventListener("click", toggleSidebar);
  floatingToggleBtn?.addEventListener("click", toggleSidebar);

  sidebarResizer?.addEventListener("mousedown", event => {
    if (pageEl.classList.contains("sidebar-hidden")) return;
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = sidebarEl?.getBoundingClientRect().width || sidebarWidth;

    const onMove = moveEvent => {
      sidebarWidth = clampWidth(startWidth + moveEvent.clientX - startX);
      pageEl.style.setProperty("--sidebar-width", `${sidebarWidth}px`);
    };

    const onUp = () => {
      localStorage.setItem(STORAGE_KEY, String(sidebarWidth));
      document.body.classList.remove("is-resizing-sidebar");
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.body.classList.add("is-resizing-sidebar");
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  applySidebarState(false);

  return {
    applySidebarState,
    toggleSidebar,
    getWidth: () => sidebarWidth,
  };
}
