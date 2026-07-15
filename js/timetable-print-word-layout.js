 // Word output layout helpers. Pure functions only: no DOM or Firestore access.

export function docxCellSize(text = "", header = false, overview = false, wideOverview = false) {
  if (header) return wideOverview ? 7 : (overview ? 10 : 14);
  const t = String(text || "");
  const lines = t.split(/\n/).length;
  const len = t.length;
  if (overview) {
    if (wideOverview) {
      if (lines > 8 || len > 100) return 6;
      if (lines > 5 || len > 70) return 7;
      return 8;
    }
    if (lines > 10 || len > 130) return 8;
    if (lines > 7 || len > 90) return 9;
    return 10;
  }
  if (lines > 14 || len > 190) return 9;
  if (lines > 10 || len > 140) return 10;
  if (lines > 7 || len > 95) return 12;
  return 14;
}

export function splitExactTotal(total, count, minimum = 1) {
  const safeCount = Math.max(1, Number(count) || 1);
  const safeTotal = Math.max(safeCount * minimum, Math.round(Number(total) || 0));
  const base = Math.max(minimum, Math.floor(safeTotal / safeCount));
  const values = Array(safeCount).fill(base);
  let diff = safeTotal - values.reduce((a, b) => a + b, 0);
  for (let i = 0; diff > 0; i++, diff--) values[i % safeCount]++;
  return values;
}

export function card3x3Dimensions(totalW = 1600, totalH = 500) {
  const widths = splitExactTotal(Math.max(3, totalW), 3, 1);
  const safeH = Math.max(270, Math.round(Number(totalH) || 500));
  const topH = Math.max(55, Math.floor(safeH * 0.20));
  const subjectH = Math.max(90, Math.floor(safeH * 0.30));
  const englishH = Math.max(70, Math.floor(safeH * 0.22));
  const bottomH = Math.max(55, safeH - topH - subjectH - englishH);
  return { widths, heights: [topH, subjectH, englishH, bottomH] };
}

export function cardGridDimensions(totalW = 1600, rows = 1, cols = 1, overview = false) {
  const safeCols = Math.max(1, Number(cols) || 1);
  const safeRows = Math.max(1, Number(rows) || 1);
  const width = Math.max(1200, Math.round((Number(totalW) || 1600) - 28));
  const gridCols = splitExactTotal(width, safeCols, 1);
  const rowH = overview ? 260 : (safeRows > 1 ? 360 : 520);
  return { totalW: width, gridCols, rowH };
}

export function allocateProportionalHeights(total, ratios = [], minimums = []) {
  const count = Math.max(ratios.length, minimums.length);
  if (!count) return [];
  const mins = Array.from({ length: count }, (_, i) => Math.max(0, Math.ceil(Number(minimums[i]) || 0)));
  const safeTotal = Math.max(mins.reduce((a, b) => a + b, 0), Math.round(Number(total) || 0));
  const safeRatios = Array.from({ length: count }, (_, i) => Math.max(0, Number(ratios[i]) || 0));
  const locked = new Set();
  const values = Array(count).fill(0);

  for (let guard = 0; guard < count + 2; guard++) {
    const lockedTotal = [...locked].reduce((sum, i) => sum + mins[i], 0);
    const remaining = Math.max(0, safeTotal - lockedTotal);
    const ratioTotal = safeRatios.reduce((sum, value, i) => sum + (locked.has(i) ? 0 : value), 0) || 1;
    const newlyLocked = [];
    safeRatios.forEach((ratio, i) => {
      if (locked.has(i)) {
        values[i] = mins[i];
        return;
      }
      values[i] = remaining * ratio / ratioTotal;
      if (values[i] < mins[i]) newlyLocked.push(i);
    });
    if (!newlyLocked.length) break;
    newlyLocked.forEach(i => locked.add(i));
  }

  const ints = values.map((value, i) => Math.max(mins[i], Math.floor(value)));
  let diff = safeTotal - ints.reduce((a, b) => a + b, 0);
  if (diff > 0) {
    const order = values.map((value, i) => ({ i, frac: value - Math.floor(value) }))
      .sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (let n = 0; diff > 0; n++, diff--) ints[order[n % order.length].i]++;
  } else if (diff < 0) {
    const order = ints.map((value, i) => ({ i, room: value - mins[i] }))
      .filter(item => item.room > 0)
      .sort((a, b) => b.room - a.room || a.i - b.i);
    let n = 0;
    while (diff < 0 && order.length) {
      const item = order[n % order.length];
      if (ints[item.i] > mins[item.i]) {
        ints[item.i]--;
        diff++;
      }
      n++;
      if (n > safeTotal * 2) break;
    }
  }
  return ints;
}

export function wordTableWidths(totalWidth, colCount, overview = false, dayOverview = false, wideOverview = false) {
  const count = Math.max(1, Number(colCount) || 1);
  const tblW = Math.max(count, Math.round(Number(totalWidth) || 1));
  if (count <= 1) return { tblW, widths: [tblW] };
  const first = overview ? (wideOverview ? 680 : (dayOverview ? 780 : 650)) : 520;
  const remaining = Math.max(count - 1, tblW - first);
  const rest = splitExactTotal(remaining, count - 1, 1);
  return { tblW, widths: [first, ...rest] };
}

export function wordSpanWidth(widths = [], startIndex = 0, span = 1) {
  let sum = 0;
  const safeSpan = Math.max(1, Number(span) || 1);
  for (let i = startIndex; i < Math.min(widths.length, startIndex + safeSpan); i++) sum += widths[i] || 0;
  return sum || widths[startIndex] || 1600;
}
