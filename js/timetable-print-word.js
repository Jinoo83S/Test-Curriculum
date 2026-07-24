// ================================================================
// timetable-print-word.js · DOCX package builder
// ================================================================
import { zipStore } from "./timetable-print-archive.js?v=1.0.0-20260724.1";

function requireFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`DOCX 의존 함수 누락: ${name}`);
  return value;
}

export function createDocxBuilder(deps = {}) {
  const wordModelsForExport = requireFunction(deps.wordModelsForExport, "wordModelsForExport");
  const isWideOfficeOverview = requireFunction(deps.isWideOfficeOverview, "isWideOfficeOverview");
  const officeWordPageSize = requireFunction(deps.officeWordPageSize, "officeWordPageSize");
  const officeWordPageMargins = requireFunction(deps.officeWordPageMargins, "officeWordPageMargins");
  const wordHeaderRowXml = requireFunction(deps.wordHeaderRowXml, "wordHeaderRowXml");
  const wordTableXml = requireFunction(deps.wordTableXml, "wordTableXml");
  const isPortrait = requireFunction(deps.isPortrait, "isPortrait");

  return function buildDocxBlob(models = []) {
    const wordModels = wordModelsForExport(models);
    const portrait = !!isPortrait();
    const hasWideOverview = wordModels.some(isWideOfficeOverview);
    const pageMetricModel = hasWideOverview
      ? { profile: "class:overview", layoutMode: "overview", cols: 35 }
      : (wordModels[0] || null);
    const pageSize = officeWordPageSize(pageMetricModel);
    const margins = officeWordPageMargins();
    const body = wordModels.map((model, index) => `${index ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : ""}${wordHeaderRowXml(model)}${wordTableXml(model)}`).join("");
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="${pageSize.w}" w:h="${pageSize.h}"${portrait ? "" : ' w:orient="landscape"'}/><w:pgMar w:top="${margins.top}" w:right="${margins.right}" w:bottom="${margins.bottom}" w:left="${margins.left}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Malgun Gothic" w:hAnsi="Malgun Gothic" w:eastAsia="맑은 고딕"/><w:sz w:val="12"/><w:szCs w:val="12"/></w:rPr><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:style></w:styles>`;
    const settingsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/></w:settings>`;

    return zipStore([
      { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>` },
      { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
      { name: "word/_rels/document.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>` },
      { name: "word/document.xml", data: documentXml },
      { name: "word/styles.xml", data: stylesXml },
      { name: "word/settings.xml", data: settingsXml },
    ]);
  };
}
