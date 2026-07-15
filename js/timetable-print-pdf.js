// ================================================================
// timetable-print-pdf.js · Hidden iframe PDF/browser-print controller
// ================================================================

export function stripCssBlock(css, atRuleTester) {
  let out = "";
  let index = 0;
  while (index < css.length) {
    const at = css.indexOf("@", index);
    if (at < 0) {
      out += css.slice(index);
      break;
    }
    out += css.slice(index, at);
    const head = css.slice(at, Math.min(css.length, at + 80));
    if (!atRuleTester(head)) {
      out += "@";
      index = at + 1;
      continue;
    }
    const brace = css.indexOf("{", at);
    if (brace < 0) break;
    let depth = 0;
    let cursor = brace;
    for (; cursor < css.length; cursor += 1) {
      const char = css[cursor];
      if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          cursor += 1;
          break;
        }
      }
    }
    index = cursor;
  }
  return out;
}

export function collectDocumentStyleText(doc = document) {
  const chunks = [];

  // r359부터 출력 CSS가 외부 <link> 파일로 분리되었습니다.
  // style 태그만 읽으면 PDF iframe에는 표/테두리/카드 CSS가 하나도 전달되지 않습니다.
  // 이미 로드된 same-origin CSSOM을 우선 사용하여 외부 CSS도 동기적으로 복사합니다.
  for (const sheet of Array.from(doc?.styleSheets || [])) {
    try {
      const text = Array.from(sheet?.cssRules || []).map(rule => rule?.cssText || "").filter(Boolean).join("\n");
      if (text) chunks.push(text);
    } catch (_) {
      // 접근할 수 없는 외부 스타일시트는 아래 style 태그 fallback에서 제외됩니다.
    }
  }

  if (!chunks.length && typeof doc?.querySelectorAll === "function") {
    chunks.push(...Array.from(doc.querySelectorAll("style")).map(element => element.textContent || "").filter(Boolean));
  }
  return chunks.join("\n");
}

export function printBaseStyleText(doc = document) {
  const raw = collectDocumentStyleText(doc);
  let css = stripCssBlock(raw, head => /^@media\s+print\b/i.test(head));
  css = stripCssBlock(css, head => /^@page\b/i.test(head));
  return css;
}

export function removeHiddenPrintFrame(doc = document) {
  const old = doc.getElementById("hisHiddenPrintFrame");
  if (old?.parentNode) old.parentNode.removeChild(old);
}

export function createPdfExporter(deps = {}) {
  const required = [
    "isDataReady", "showRenderOverlay", "nextPaint", "renderEntityList", "selectedEntities",
    "isPortrait", "pagesForEntities", "exportTitle", "escapeHtml", "sleep", "setPreviewMeta",
    "previewMetaText", "hideRenderOverlay",
  ];
  for (const key of required) {
    if (typeof deps[key] !== "function") throw new TypeError(`PDF 의존 함수 누락: ${key}`);
  }

  return async function exportPdfReal() {
    if (!deps.isDataReady()) return;
    deps.showRenderOverlay("인쇄용 시간표를 준비하는 중입니다…");
    try {
      await deps.nextPaint();
      deps.renderEntityList();
      const entities = deps.selectedEntities();
      if (!entities.length) throw new Error("출력할 대상이 없습니다.");

      const portrait = !!deps.isPortrait();
      const pageCss = portrait
        ? { pageRule: "A4 portrait", paperW: "210mm", paperH: "297mm" }
        : { pageRule: "A4 landscape", paperW: "297mm", paperH: "210mm" };
      const pages = deps.pagesForEntities(entities);
      if (!pages.length) throw new Error("생성된 인쇄 페이지가 없습니다.");

      const styleText = printBaseStyleText(document);
      const bodyClass = Array.from(document.body.classList).filter(className => /^font-|ellipsis-enabled/.test(className)).join(" ");
      const printCss = `
        @page{size:${pageCss.pageRule};margin:0}
        html,body{margin:0!important;padding:0!important;background:#fff!important;overflow:visible!important;width:${pageCss.paperW}!important;min-width:${pageCss.paperW}!important;height:auto!important}
        body{font-family:var(--print-font, system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif)!important;color:#102033!important}
        .topbar,.sidebar,.preview-toolbar,.render-overlay{display:none!important}
        .app,.preview-wrap,.preview-scroll,.preview-inner{display:block!important;height:auto!important;min-height:0!important;overflow:visible!important;background:#fff!important;margin:0!important;padding:0!important;width:${pageCss.paperW}!important;max-width:${pageCss.paperW}!important;transform:none!important;zoom:1!important}
        .preview-inner{position:static!important}
        .preview-page{box-sizing:border-box!important;box-shadow:none!important;border:0!important;margin:0!important;padding:5mm!important;width:${pageCss.paperW}!important;height:${pageCss.paperH}!important;min-width:${pageCss.paperW}!important;min-height:${pageCss.paperH}!important;max-width:${pageCss.paperW}!important;max-height:${pageCss.paperH}!important;overflow:hidden!important;background:#fff!important;break-after:page!important;page-break-after:always!important}
        .preview-page:last-child{break-after:auto!important;page-break-after:auto!important}
        .preview-page.paper-landscape,.preview-page.paper-portrait{width:${pageCss.paperW}!important;height:${pageCss.paperH}!important;min-height:${pageCss.paperH}!important;max-width:${pageCss.paperW}!important;max-height:${pageCss.paperH}!important}
        @media print{
          @page{size:${pageCss.pageRule};margin:0}
          html,body{margin:0!important;padding:0!important;background:#fff!important;overflow:visible!important;width:${pageCss.paperW}!important;min-width:${pageCss.paperW}!important;height:auto!important}
          .preview-page{box-sizing:border-box!important;box-shadow:none!important;border:0!important;margin:0!important;padding:5mm!important;width:${pageCss.paperW}!important;height:${pageCss.paperH}!important;min-width:${pageCss.paperW}!important;min-height:${pageCss.paperH}!important;max-width:${pageCss.paperW}!important;max-height:${pageCss.paperH}!important;overflow:hidden!important;background:#fff!important;break-after:page!important;page-break-after:always!important}
          .preview-page:last-child{break-after:auto!important;page-break-after:auto!important}
        }
      `;
      const title = deps.exportTitle();
      const esc = deps.escapeHtml;
      const baseHref = String(document.baseURI || globalThis.location?.href || "");
      const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base href="${esc(baseHref)}"><title>${esc(title)}</title><style>${styleText}</style><style>${printCss}</style></head><body class="${esc(bodyClass)} ${portrait ? "print-portrait" : "print-landscape"}"><main class="preview-inner">${pages.join("")}</main></body></html>`;

      removeHiddenPrintFrame(document);
      const frame = document.createElement("iframe");
      frame.id = "hisHiddenPrintFrame";
      frame.title = "HIS 시간표 인쇄";
      frame.setAttribute("aria-hidden", "true");
      Object.assign(frame.style, {
        position: "fixed", right: "0", bottom: "0", width: "1px", height: "1px",
        border: "0", opacity: "0", pointerEvents: "none",
      });
      document.body.appendChild(frame);

      const frameDocument = frame.contentDocument || frame.contentWindow.document;
      frameDocument.open();
      frameDocument.write(html);
      frameDocument.close();
      try {
        if (frameDocument.fonts?.ready) {
          await Promise.race([frameDocument.fonts.ready, deps.sleep(800)]);
        }
      } catch (_) {}
      await deps.sleep(180);

      deps.setPreviewMeta(deps.previewMetaText(entities));
      deps.showRenderOverlay("인쇄창을 여는 중입니다…");
      await deps.sleep(450);
      deps.hideRenderOverlay();

      const frameWindow = frame.contentWindow;
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        setTimeout(() => removeHiddenPrintFrame(document), 300);
      };
      try { frameWindow.addEventListener("afterprint", cleanup, { once: true }); } catch {}
      setTimeout(cleanup, 60000);
      frameWindow.focus();
      frameWindow.print();
    } catch (error) {
      console.error("[hidden iframe print failed]", error);
      deps.hideRenderOverlay();
      removeHiddenPrintFrame(document);
      alert(`인쇄용 시간표 생성 중 오류가 발생했습니다: ${error?.message || String(error)}`);
    }
  };
}
