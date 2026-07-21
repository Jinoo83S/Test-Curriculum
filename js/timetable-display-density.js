// ================================================================
// timetable-display-density.js · 전체보기 행높이/밀도 조절
// r381: 좁게/보통/넓게 + 세부 행높이 슬라이더, 브라우저별 저장
// ================================================================
const STORAGE_KEY = "his_timetable_display_density_r381";
const PRESETS = Object.freeze({ compact: 70, normal: 85, wide: 100 });

function clamp(value) {
  const n = Number.parseInt(value, 10);
  return Math.max(55, Math.min(115, Number.isFinite(n) ? n : PRESETS.normal));
}
function readState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const scale = clamp(parsed.scale);
    const preset = Object.entries(PRESETS).find(([, value]) => value === scale)?.[0] || "custom";
    return { scale, preset };
  } catch (_) {
    return { scale: PRESETS.normal, preset: "normal" };
  }
}
function saveState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ scale: clamp(state.scale) })); } catch (_) {}
}
function applyScale(scale) {
  const value = clamp(scale);
  document.documentElement.style.setProperty("--tt-user-row-scale", String(value / 100));
  document.documentElement.dataset.ttRowScale = String(value);
  window.dispatchEvent(new CustomEvent("tt-display-density-change", { detail: { scale: value } }));
  window.dispatchEvent(new Event("resize"));
  return value;
}

export function setupTimetableDisplayDensity() {
  const root = document.getElementById("ttDisplayDensityControls");
  if (!root || root.dataset.ready === "1") return null;
  root.dataset.ready = "1";
  const slider = root.querySelector('[data-role="row-slider"]');
  const output = root.querySelector('[data-role="row-value"]');
  const buttons = [...root.querySelectorAll('[data-density]')];
  let state = readState();

  const render = () => {
    state.scale = clamp(state.scale);
    state.preset = Object.entries(PRESETS).find(([, value]) => value === state.scale)?.[0] || "custom";
    if (slider) slider.value = String(state.scale);
    if (output) output.textContent = `${state.scale}%`;
    buttons.forEach(button => button.classList.toggle("active", button.dataset.density === state.preset));
    applyScale(state.scale);
  };
  const setScale = scale => {
    state.scale = clamp(scale);
    saveState(state);
    render();
  };

  buttons.forEach(button => button.addEventListener("click", () => {
    const value = PRESETS[button.dataset.density];
    if (value) setScale(value);
  }));
  slider?.addEventListener("input", () => setScale(slider.value));
  render();
  return { getScale: () => state.scale, setScale };
}
