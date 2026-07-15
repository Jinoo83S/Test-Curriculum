import assert from 'node:assert/strict';
import {
  allocateProportionalHeights,
  card3x3Dimensions,
  cardGridDimensions,
  docxCellSize,
  wordSpanWidth,
  wordTableWidths,
} from '../js/timetable-print-word-layout.js';

assert.equal(docxCellSize('과목'), 14);
assert.equal(docxCellSize('x'.repeat(100), false, false, false), 12);
assert.equal(docxCellSize('x'.repeat(101), false, true, true), 6);

const card = card3x3Dimensions(1600, 500);
assert.equal(card.widths.reduce((a,b)=>a+b,0), 1600);
assert.equal(card.heights.reduce((a,b)=>a+b,0), 500);
assert.equal(card.widths.length, 3);
assert.equal(card.heights.length, 4);

const grid = cardGridDimensions(4800, 3, 1, false);
assert.equal(grid.gridCols.length, 1);
assert.equal(grid.gridCols.reduce((a,b)=>a+b,0), grid.totalW);
assert.equal(grid.rowH, 360);

const allocated = allocateProportionalHeights(900, [1, 2, 1], [120, 260, 120]);
assert.equal(allocated.reduce((a,b)=>a+b,0), 900);
assert.ok(allocated.every((v,i)=>v >= [120,260,120][i]));

// Landscape three-row regression: subject and English minimums must never be clipped.
const threeRow = allocateProportionalHeights(950, [0.96, 1.04, 1.0, 0.96], [120, 286, 224, 120]);
assert.equal(threeRow.reduce((a,b)=>a+b,0), 950);
assert.ok(threeRow[1] >= 286);
assert.ok(threeRow[2] >= 224);

const table = wordTableWidths(15000, 6, true, false, false);
assert.equal(table.widths.length, 6);
assert.equal(table.widths.reduce((a,b)=>a+b,0), 15000);
assert.equal(wordSpanWidth(table.widths, 1, 3), table.widths.slice(1,4).reduce((a,b)=>a+b,0));

console.log('TIMETABLE_PRINT_WORD_LAYOUT_OK');
