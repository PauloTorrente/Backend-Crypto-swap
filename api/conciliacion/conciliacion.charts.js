// Gráficos nativos do Excel numa aba de uma planilha já gerada pelo exceljs (que não sabe criar
// gráficos). Escreve as partes DrawingML direto no .xlsx:
//   xl/charts/chartN.xml, xl/drawings/drawingN.xml (+ rels), a tag <drawing> na aba e os content types.
// Os gráficos apontam para células da planilha (continuam certos se os valores mudarem) e levam
// uma cópia dos valores (cache), para aparecerem mesmo em leitores que não recalculam.
const JSZip = require('jszip');

const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fill = color => `<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr>`;
const lineFill = color => `<c:spPr><a:ln w="28575" cap="rnd"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:round/></a:ln></c:spPr>`;

const title = text =>
  `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="es-ES" sz="1200" b="1"/><a:t>${esc(text)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`;

function numRef(ref, values, formatCode = 'General') {
  const pts = values.map((v, i) => (Number.isFinite(v) ? `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>` : '')).join('');
  return `<c:numRef><c:f>${esc(ref)}</c:f><c:numCache><c:formatCode>${esc(formatCode)}</c:formatCode><c:ptCount val="${values.length}"/>${pts}</c:numCache></c:numRef>`;
}

function strRef(ref, values) {
  const pts = values.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('');
  return `<c:strRef><c:f>${esc(ref)}</c:f><c:strCache><c:ptCount val="${values.length}"/>${pts}</c:strCache></c:strRef>`;
}

// Categoria: datas (numRef com formato dd/mm) ou textos
const categories = cat => (cat.dates ? numRef(cat.ref, cat.values, 'dd/mm') : strRef(cat.ref, cat.values));

function series(s, i, cat, kind) {
  const head = `<c:idx val="${i}"/><c:order val="${i}"/><c:tx>${strRef(s.nameRef, [s.name])}</c:tx>`;
  const body = `<c:cat>${categories(cat)}</c:cat><c:val>${numRef(s.ref, s.values, s.format)}</c:val>`;
  if (kind === 'line') return `<c:ser>${head}${lineFill(s.color)}<c:marker><c:symbol val="none"/></c:marker>${body}<c:smooth val="0"/></c:ser>`;
  return `<c:ser>${head}${fill(s.color)}<c:invertIfNegative val="0"/>${body}</c:ser>`;
}

function axes(catId, valId, { position = 'l', format = '#,##0', hidden = false, crosses = 'autoZero', dates = false } = {}) {
  const cat = `<c:catAx><c:axId val="${catId}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="${hidden ? 1 : 0}"/><c:axPos val="b"/>${
    dates ? '<c:numFmt formatCode="dd/mm" sourceLinked="0"/>' : ''
  }<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${valId}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`;
  const val = `<c:valAx><c:axId val="${valId}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${position}"/>${
    hidden ? '' : '<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E3E3E3"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>'
  }<c:numFmt formatCode="${esc(format)}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${catId}"/><c:crosses val="${crosses}"/><c:crossBetween val="between"/></c:valAx>`;
  return cat + val;
}

const legend = '<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>';

// spec: { type: 'bar' | 'combo' | 'doughnut', title, categories: { ref, values, dates }, series: [...], line?: [...] }
//   bar: series = barras (stacked: true empilha); combo: series = barras no eixo da esquerda,
//   line = linhas no eixo da direita; doughnut: uma série, uma fatia por categoria (colors)
function chartXml(spec) {
  const cat = spec.categories;
  let plot;
  if (spec.type === 'doughnut') {
    const s = spec.series[0];
    const points = spec.colors
      .map((color, i) => `<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:dPt>`)
      .join('');
    const labels =
      '<c:dLbls><c:numFmt formatCode="0%" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/><c:showLeaderLines val="1"/></c:dLbls>';
    plot = `<c:doughnutChart><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx>${strRef(s.nameRef, [s.name])}</c:tx>${points}${labels}<c:cat>${categories(cat)}</c:cat><c:val>${numRef(s.ref, s.values)}</c:val></c:ser><c:firstSliceAng val="0"/><c:holeSize val="55"/></c:doughnutChart>`;
  } else {
    const grouping = spec.stacked ? 'stacked' : 'clustered';
    const bars = spec.series.map((s, i) => series(s, i, cat, 'bar')).join('');
    plot = `<c:barChart><c:barDir val="col"/><c:grouping val="${grouping}"/><c:varyColors val="0"/>${bars}<c:gapWidth val="60"/>${
      spec.stacked ? '<c:overlap val="100"/>' : ''
    }<c:axId val="1001"/><c:axId val="1002"/></c:barChart>`;
    if (spec.type === 'combo') {
      const lines = spec.line.map((s, i) => series(s, spec.series.length + i, cat, 'line')).join('');
      plot += `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${lines}<c:marker val="1"/><c:axId val="1003"/><c:axId val="1004"/></c:lineChart>`;
    }
    plot += axes(1001, 1002, { format: spec.format, dates: cat.dates });
    if (spec.type === 'combo') plot += axes(1003, 1004, { position: 'r', format: spec.lineFormat || spec.format, hidden: true, crosses: 'max', dates: cat.dates });
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}"><c:roundedCorners val="0"/><c:chart>${title(spec.title)}<c:plotArea><c:layout/>${plot}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></c:spPr></c:chartSpace>`;
}

// anchor: { from: [col, row], to: [col, row] } (base 0)
function drawingXml(charts) {
  const anchors = charts
    .map(
      (c, i) => `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${c.anchor.from[0]}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${c.anchor.from[1]}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${c.anchor.to[0]}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${c.anchor.to[1]}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Gráfico ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" xmlns:r="${NS_R}" r:id="rId${i + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="${NS_A}">${anchors}</xdr:wsDr>`;
}

const relsXml = rels =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels
    .map(r => `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"/>`)
    .join('')}</Relationships>`;

// buffer: .xlsx gerado pelo exceljs; sheetIndex: posição da aba (1 = primeira)
async function addCharts(buffer, sheetIndex, charts) {
  if (!charts.length) return buffer;
  const zip = await JSZip.loadAsync(buffer);
  const sheetPath = `xl/worksheets/sheet${sheetIndex}.xml`;
  const sheetRelsPath = `xl/worksheets/_rels/sheet${sheetIndex}.xml.rels`;
  const n = Object.keys(zip.files).filter(f => /^xl\/drawings\/drawing\d+\.xml$/.test(f)).length + 1;
  const firstChart = Object.keys(zip.files).filter(f => /^xl\/charts\/chart\d+\.xml$/.test(f)).length + 1;

  charts.forEach((c, i) => zip.file(`xl/charts/chart${firstChart + i}.xml`, chartXml(c)));
  zip.file(`xl/drawings/drawing${n}.xml`, drawingXml(charts));
  zip.file(
    `xl/drawings/_rels/drawing${n}.xml.rels`,
    relsXml(charts.map((c, i) => ({ id: `rId${i + 1}`, type: `${REL}/chart`, target: `../charts/chart${firstChart + i}.xml` })))
  );

  // Relação aba → desenho (a aba pode já ter um .rels, por exemplo com hyperlinks)
  const drawingRel = { id: 'rIdResumoDrawing', type: `${REL}/drawing`, target: `../drawings/drawing${n}.xml` };
  const existingRels = zip.file(sheetRelsPath);
  if (existingRels) {
    const xml = await existingRels.async('string');
    zip.file(sheetRelsPath, xml.replace('</Relationships>', `<Relationship Id="${drawingRel.id}" Type="${drawingRel.type}" Target="${drawingRel.target}"/></Relationships>`));
  } else {
    zip.file(sheetRelsPath, relsXml([drawingRel]));
  }

  // <drawing> vem depois de pageMargins/pageSetup/headerFooter e antes de legacyDrawing/tableParts/extLst
  let sheet = await zip.file(sheetPath).async('string');
  const tag = `<drawing r:id="${drawingRel.id}"/>`;
  const before = sheet.match(/<(legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)[\s>/]/);
  sheet = before ? sheet.replace(before[0], tag + before[0]) : sheet.replace('</worksheet>', `${tag}</worksheet>`);
  zip.file(sheetPath, sheet);

  let types = await zip.file('[Content_Types].xml').async('string');
  const overrides = [
    `<Override PartName="/xl/drawings/drawing${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,
    ...charts.map((c, i) => `<Override PartName="/xl/charts/chart${firstChart + i}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`)
  ].join('');
  types = types.replace('</Types>', `${overrides}</Types>`);
  zip.file('[Content_Types].xml', types);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { addCharts };
