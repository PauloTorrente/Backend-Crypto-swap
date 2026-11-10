// Monta os câmbios automaticamente a partir dos extratos.
//
// Um câmbio = uma ENTRADA numa moeda (1 ou mais lançamentos do mesmo pagador, no mesmo dia)
//           + uma SAÍDA na outra moeda (1 ou mais lançamentos para o mesmo destinatário).
//
// Passos:
//   1. Tira o que não é câmbio: o que a planilha já liga (abas Cambios, P2P, GASTOS), tarifas,
//      comércios, transferências entre contas próprias e as ordens P2P (Bybit/Binance),
//      que batem pelo valor exato.
//   2. Cotação do USDT de cada moeda por dia = mediana das ordens P2P do dia.
//   3. Para cada par entrada × saída (moedas diferentes, até 1 dia de diferença) calcula a
//      margem como na aba Cambios: (recebido em USDT − entregado em USDT) ÷ recebido em USDT.
//      Só aceita margem dentro da faixa normal de comissão.
//   4. Pontua: margem perto da habitual + nomes parecidos (nome inteiro ou sobrenome raro).
//   5. Escolhe os melhores pares sem repetir lançamento e diz o grau de confiança de cada um.
//
// Linhas da aba Cambios com só um lado ligado ao extrato (ex.: E = =FIDU!F185, G = =E73*-2.22)
// entram com esse lado fixo, e o algoritmo sugere o lançamento que falta ("completar").

const DEFAULTS = {
  ownNames: ['DON JUAN', 'MORENO TORRENTE', 'JOAO SOLUCOES'], // contas da própria empresa
  // Pagamentos a comércios/serviços (não são clientes)
  ignore: ['TELECEL', 'HIPERMAXI', 'QR CENTRAL', 'ADMINISTRADORA DE TARJETAS'],
  useLinked: true, // pula o que a planilha já liga em Cambios/P2P/GASTOS
  minScore: 0.3,
  margin: { min: -0.01, max: 0.06, target: 0.02, tolerance: 0.04 },
  maxLegItems: 5, // máximo de lançamentos somados numa perna
  maxLegSpanHours: 3, // lançamentos com hora só se somam se estiverem perto
  maxDayDiff: 1,
  p2pMaxHours: 3,
  lateHour: 20, // ordem a partir das 20 h: o Pix pode cair no extrato sem hora (FIDU/PICPAY) no dia seguinte
  prices: {}, // cotação de reserva por moeda, quando não houver ordem P2P no período
  manualPrices: {} // { BRL: { '2026-10-01': 5.22 } }: tabela cotacoes_manuais, só para dias sem cotação própria
};

const DAY_MS = 24 * 3600 * 1000;
const dayKey = d => d.toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
const round2 = n => Math.round(n * 100) / 100;
const median = xs => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ---------- nomes ----------

const STOPWORDS = new Set(['DE', 'DA', 'DO', 'DOS', 'DAS', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'E', 'LTDA', 'SRL', 'S', 'A', 'SA', 'ME', 'EIRELI']);

// "TRASP.CTAS.TERCEROS LIMPIAS M RICARDO (B.NACIONAL ...) APOYO" → ['LIMPIAS', 'RICARDO']
function nameTokens(raw) {
  const s = String(raw || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/^(TRASP\.?CTAS\.?TERCEROS|BWEB:|PIX (RECEBIDO|ENVIADO) (DE|PARA))\s*/, '')
    .split('(')[0] // o que vem depois do banco é a nota da transferência
    .replace(/[^A-Z ]/g, ' ');
  return [...new Set(s.split(/\s+/).filter(t => t.length >= 2 && !STOPWORDS.has(t)))];
}

const titleCase = tokens => tokens.map(t => t[0] + t.slice(1).toLowerCase()).join(' ');

// Peso de cada palavra: sobrenome raro vale mais que "MARIA" ou "JOSE"
function buildIdf(txs) {
  const df = new Map();
  for (const t of txs) for (const tok of t.tokens) df.set(tok, (df.get(tok) || 0) + 1);
  const n = txs.length;
  return tok => Math.log((n + 1) / ((df.get(tok) || 0) + 1));
}

// 0..1: parte do nome mais curto que aparece no outro
function nameSimilarity(a, b, idf) {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  const weight = toks => toks.reduce((s, t) => s + idf(t), 0);
  const shared = weight(a.filter(t => setB.has(t)));
  return shared ? Math.min(1, shared / Math.min(weight(a), weight(b))) : 0;
}

// Apelido do P2P parecido com o nome do banco: "quispePaniagua" ↔ "Ivan Quispe Paniagua"
function nicknameMatches(nickname, tokens) {
  const parts = String(nickname)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(p => p.length >= 4 && p !== 'USER');
  const commonPrefix = (a, b) => {
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    return i;
  };
  return parts.some(p =>
    tokens.some(t => t.length >= 4 && (t.startsWith(p) || p.startsWith(t) || commonPrefix(p, t) >= 5))
  );
}

// ---------- 1. o que não é câmbio ----------

// Ordem P2P ↔ lançamento do banco com o mesmo valor (Compra = saiu fiat, Venta = entrou fiat).
// FIDU e PICPAY não têm hora, e valores redondos (100, 300...) se repetem no dia. Então:
//   a) primeiro fixa os casos certos (banco com hora, apelido parecido, ou valor único no dia);
//   b) esses viram âncoras: a hora de cada linha sem hora é estimada pela posição dela entre
//      duas âncoras (o extrato está em ordem cronológica);
//   c) o resto casa pela hora estimada mais próxima.
// A hora estimada também é usada depois para aproximar as pernas de um câmbio.
function matchP2P(bank, p2p, cfg) {
  const candidates = [];
  for (const o of p2p) {
    const sign = o.side === 'Compra' ? -1 : 1;
    for (const t of bank) {
      if (t.excluded || t.currency !== o.currency || Math.sign(t.amount) !== sign) continue;
      if (Math.abs(Math.abs(t.amount) - o.amount) > 0.01) continue;
      if (!nearOrder(t, o, cfg)) continue;
      candidates.push({ o, t, nick: nicknameMatches(o.counterparty, t.tokens) });
    }
  }

  const count = key => candidates.reduce((m, c) => m.set(key(c), (m.get(key(c)) || 0) + 1), new Map());
  const perOrder = count(c => c.o.id);
  const perTx = count(c => c.t.id);

  const matches = [];
  const usedOrders = new Set();
  const record = (o, txs, how) => {
    usedOrders.add(o.id);
    for (const t of txs) {
      t.excluded = 'P2P';
      t.estDate = o.date;
    }
    matches.push({
      order: o.id,
      orderRef: `${o.sheet}!B${o.row}`,
      side: o.side,
      currency: o.currency,
      amount: o.amount,
      contraparte: o.counterparty,
      bank: txs.map(t => t.id).join('+'),
      banks: txs.map(t => t.id),
      como: how
    });
  };
  const take = list => {
    for (const c of list) {
      if (usedOrders.has(c.o.id) || c.t.excluded) continue;
      record(c.o, [c.t], c.nick ? 'valor exacto + apodo' : 'valor exacto');
    }
  };

  // a) certos
  const hours = c => Math.abs((c.t.estDate || c.t.date) - c.o.date) / 3600000;
  take(
    candidates
      .filter(c => c.t.hasTime || c.nick || (perOrder.get(c.o.id) === 1 && perTx.get(c.t.id) === 1))
      .sort((a, b) => (a.t.hasTime ? hours(a) : 0) - (b.t.hasTime ? hours(b) : 0) || b.nick - a.nick)
  );

  // b) hora estimada
  estimateTimes(bank);

  // c) o resto, pela hora estimada (sem âncora no dia: aceita na ordem do extrato)
  const rest = candidates.filter(c => !c.t.excluded && !usedOrders.has(c.o.id));
  const estHours = c => (c.t.estDate ? Math.abs(c.t.estDate - c.o.date) / 3600000 : cfg.p2pMaxHours);
  take(rest.filter(c => estHours(c) <= cfg.p2pMaxHours).sort((a, b) => estHours(a) - estHours(b) || a.t.row - b.t.row));

  // d) pago partido: 2 a 4 transferências para/da mesma pessoa que somam o valor da ordem
  //    (ex.: 16.543,69 Bs = 3 × 5.514,56 por causa do limite por transferência)
  for (const o of p2p) {
    if (usedOrders.has(o.id)) continue;
    const split = splitPayment(o, bank, cfg);
    if (split) record(o, split, `suma de ${split.length} transferencias`);
  }

  return matches;
}

// Lançamento perto o bastante da ordem: com hora, até p2pMaxHours; sem hora, no mesmo dia ou,
// para ordens da noite, no dia seguinte
function nearOrder(t, o, cfg) {
  if (t.hasTime) return Math.abs(t.date - o.date) / 3600000 <= cfg.p2pMaxHours;
  const days = dayDiff(dayKey(o.date), dayKey(t.date));
  return days === 0 || (days === 1 && o.date.getUTCHours() >= cfg.lateHour);
}

function splitPayment(o, bank, cfg) {
  const sign = o.side === 'Compra' ? -1 : 1;
  const near = t => nearOrder(t, o, cfg);
  const groups = new Map();
  for (const t of bank) {
    if (t.excluded || t.currency !== o.currency || Math.sign(t.amount) !== sign || !t.tokens.length || !near(t)) continue;
    if (Math.abs(t.amount) >= o.amount) continue;
    const key = `${t.sheet}|${[...t.tokens].sort().join(' ')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  let best = null;
  for (const txs of groups.values()) {
    txs.sort((a, b) => a.date - b.date || a.row - b.row);
    // Transferências seguidas (em sequência no extrato), como acontece quando o valor é partido
    for (let i = 0; i < txs.length; i++) {
      let sum = 0;
      for (let j = i; j < Math.min(txs.length, i + 4); j++) {
        sum += Math.abs(txs[j].amount);
        if (j > i && Math.abs(sum - o.amount) <= 0.01) {
          const part = txs.slice(i, j + 1);
          // Sem hora (FIDU/PICPAY), só linhas vizinhas no extrato: 50 + 50 longe uma da outra é coincidência
          if (!part[0].hasTime && part.at(-1).row - part[0].row > part.length + 1) continue;
          const gap = Math.abs((part[0].hasTime ? part[0].date : o.date) - o.date);
          if (!best || gap < best.gap) best = { part, gap };
        }
        if (sum > o.amount + 0.01) break;
      }
    }
  }
  return best?.part || null;
}

// Hora aproximada das linhas sem hora, interpolando entre as âncoras P2P do mesmo extrato e dia
function estimateTimes(bank) {
  const byDay = new Map();
  for (const t of bank) {
    if (t.hasTime) continue;
    const key = `${t.sheet}|${dayKey(t.date)}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(t);
  }
  for (const rows of byDay.values()) {
    rows.sort((a, b) => a.row - b.row);
    const anchors = rows.filter(t => t.excluded === 'P2P' && t.estDate);
    if (!anchors.length) continue;
    for (const t of rows) {
      if (t.excluded === 'P2P') continue;
      const prev = anchors.filter(a => a.row < t.row).at(-1);
      const next = anchors.find(a => a.row > t.row);
      if (prev && next) {
        const f = (t.row - prev.row) / (next.row - prev.row);
        t.estDate = new Date(+prev.estDate + f * (next.estDate - prev.estDate));
      } else {
        t.estDate = (prev || next).estDate;
      }
    }
  }
}

const anyOf = words => new RegExp(words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');

function markExcluded(bank, p2p, linked, cfg) {
  const own = anyOf(cfg.ownNames);
  const ignore = anyOf(cfg.ignore);

  for (const t of bank) {
    const link = cfg.useLinked && linked.get(`${t.sheet}:${t.row}`);
    if (link) t.excluded = `planilha:${link.aba}`;
    else if (/tarifa/i.test(t.type)) t.excluded = 'tarifa';
    else if (own.test(t.counterparty)) t.excluded = 'conta própria';
    else if (!t.tokens.length || ignore.test(`${t.type} ${t.counterparty}`)) t.excluded = 'comércio/sem nome';
  }

  // Ordens que a planilha já ligou a algum lançamento não procuram outro
  const openOrders = cfg.useLinked ? p2p.filter(o => !linked.has(`${o.sheet}:${o.row}`)) : p2p;
  const p2pMatches = matchP2P(bank, openOrders, cfg);

  // Transferência entre contas próprias: mesmo valor com sinal trocado, em outra conta, no mesmo
  // minuto. Só com hora: no FIDU/PICPAY um +200 e um −200 no mesmo dia são comuns e não são espelho.
  const rest = bank.filter(t => !t.excluded && t.hasTime);
  for (const a of rest) {
    if (a.excluded || a.amount >= 0) continue;
    const b = rest.find(
      b =>
        !b.excluded &&
        b.sheet !== a.sheet &&
        b.currency === a.currency &&
        Math.abs(b.amount + a.amount) < 0.005 &&
        Math.abs(a.date - b.date) <= 10 * 60000
    );
    if (b) a.excluded = b.excluded = 'conta própria';
  }

  return p2pMatches;
}

// ---------- 2. cotação ----------

// Ordem de preferência para o preço do USDT numa moeda:
//   1. histórico de cotações (o mesmo do .txt de /historico) no horário do lançamento, até 3 h
//   2. média do histórico no dia (lançamentos sem hora: FIDU/PICPAY)
//   3. mediana das ordens P2P do dia
//   4. cotação manual do dia (tabela cotacoes_manuais), no lugar de usar a de outro dia
//   5. mediana das ordens P2P do dia mais próximo
//   6. cfg.prices
// Devolve { price, source }.
function buildPrices(p2p, history, cfg) {
  const byCurrency = {};
  for (const o of p2p) {
    if (!o.price) continue;
    ((byCurrency[o.currency] ||= {})[dayKey(o.date)] ||= []).push(o.price);
  }
  const daily = {};
  for (const [cur, days] of Object.entries(byCurrency)) {
    daily[cur] = Object.fromEntries(Object.entries(days).map(([d, ps]) => [d, median(ps)]));
  }

  const historyDay = {};
  for (const [cur, points] of Object.entries(history)) {
    const days = {};
    for (const [t, p] of points) (days[dayKey(new Date(t))] ||= []).push(p);
    historyDay[cur] = Object.fromEntries(Object.entries(days).map(([d, ps]) => [d, ps.reduce((a, b) => a + b, 0) / ps.length]));
  }

  const nearestPoint = (points, t) => {
    let lo = 0;
    let hi = points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid][0] < t) lo = mid + 1;
      else hi = mid;
    }
    return [points[lo], points[lo - 1]].filter(Boolean).sort((a, b) => Math.abs(a[0] - t) - Math.abs(b[0] - t))[0];
  };

  return (currency, day, time) => {
    if (currency === 'USDT') return { price: 1, source: 'USDT' };
    const points = history[currency];
    if (points?.length && time) {
      const p = nearestPoint(points, +time);
      if (Math.abs(p[0] - time) <= 3 * 3600000) return { price: p[1], source: 'histórico' };
    }
    if (historyDay[currency]?.[day]) return { price: historyDay[currency][day], source: 'histórico (média do dia)' };
    const days = daily[currency];
    if (days?.[day]) return { price: days[day], source: 'P2P do dia' };
    const manual = cfg.manualPrices[currency]?.[day];
    if (manual) return { price: manual, source: 'manual do dia' };
    if (days) {
      const nearest = Object.keys(days).sort((a, b) => Math.abs(dayDiff(a, day)) - Math.abs(dayDiff(b, day)))[0];
      return { price: days[nearest], source: `P2P de ${nearest}` };
    }
    return cfg.prices[currency] ? { price: cfg.prices[currency], source: 'padrão' } : null;
  };
}

// ---------- 3. pernas (1+ lançamentos somados) ----------

function buildLegs(txs, cfg) {
  const clusters = new Map();
  for (const t of txs) {
    const key = [t.sheet, dayKey(t.date), Math.sign(t.amount), [...t.tokens].sort().join(' ') || t.counterparty].join('|');
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push(t);
  }

  const legs = [];
  for (const items of clusters.values()) {
    items.sort((a, b) => a.date - b.date || a.row - b.row);
    for (let i = 0; i < items.length; i++) {
      for (let j = i; j < Math.min(items.length, i + cfg.maxLegItems); j++) {
        const part = items.slice(i, j + 1);
        if (part[0].hasTime && (part.at(-1).date - part[0].date) / 3600000 > cfg.maxLegSpanHours) break;
        legs.push({
          txs: part,
          ids: part.map(t => t.id),
          currency: part[0].currency,
          amount: round2(part.reduce((s, t) => s + t.amount, 0)),
          date: part[0].date,
          day: dayKey(part[0].date),
          // Hora real (ECOPF/ECOPJ) ou estimada pelas âncoras P2P (FIDU/PICPAY)
          time: part[0].hasTime ? part[0].date : part[0].estDate || null,
          tokens: part[0].tokens,
          counterparty: part[0].counterparty
        });
      }
    }
  }
  return legs;
}

// Uma perna fixa por linha da aba Cambios que tem só um dos lados ligado ao extrato
function partialLegs(txs, linked) {
  const byRow = new Map();
  for (const t of txs) {
    const link = linked.get(`${t.sheet}:${t.row}`);
    if (!link || link.aba !== 'Cambios' || !link.lado) continue;
    if (!byRow.has(link.fila)) byRow.set(link.fila, { recibido: [], entregado: [] });
    byRow.get(link.fila)[link.lado].push(t);
  }

  const legs = [];
  for (const [fila, sides] of byRow) {
    const [have, missing] = sides.recibido.length ? ['recibido', 'entregado'] : ['entregado', 'recibido'];
    if (sides[missing].length) continue; // os dois lados já estão ligados
    const part = sides[have].sort((a, b) => a.date - b.date || a.row - b.row);
    legs.push({
      fila,
      falta: missing,
      txs: part,
      ids: part.map(t => t.id),
      currency: part[0].currency,
      amount: round2(part.reduce((s, t) => s + t.amount, 0)),
      date: part[0].date,
      day: dayKey(part[0].date),
      time: part[0].hasTime ? part[0].date : part[0].estDate || null,
      tokens: part[0].tokens,
      counterparty: part[0].counterparty
    });
  }
  return legs;
}

// ---------- 4. pares candidatos ----------

function scorePairs(legs, priceOf, idf, cfg) {
  const ins = legs.filter(l => l.amount > 0);
  const outs = legs.filter(l => l.amount < 0);
  const { min, max, target, tolerance } = cfg.margin;
  const candidates = [];

  for (const inn of ins) {
    const quoteIn = priceOf(inn.currency, inn.day, inn.time);
    if (!quoteIn) continue;
    const pIn = quoteIn.price;
    const receivedUsdt = inn.amount / pIn;

    for (const out of outs) {
      if (out.currency === inn.currency) continue;
      const days = dayDiff(inn.day, out.day);
      if (Math.abs(days) > cfg.maxDayDiff) continue;
      // Cotação do momento em que o dinheiro entrou (ou, sem hora, de quando saiu)
      const quoteOut = priceOf(out.currency, inn.day, inn.time || out.time);
      if (!quoteOut) continue;
      const pOut = quoteOut.price;

      const deliveredUsdt = -out.amount / pOut;
      const margin = (receivedUsdt - deliveredUsdt) / receivedUsdt;
      if (margin < min || margin > max) continue;

      if (inn.fila && out.fila) continue;
      const name = nameSimilarity(inn.tokens, out.tokens, idf);
      // Para completar uma linha da planilha exige nome parecido: o lado que falta muitas
      // vezes foi em dinheiro e não está em extrato nenhum
      if ((inn.fila || out.fila) && name < 0.2) continue;
      const marginFit = Math.max(0, 1 - Math.abs(margin - target) / tolerance);
      const extraItems = inn.txs.length + out.txs.length - 2;
      // Pernas com hora (real ou estimada) perto uma da outra: até 6 h ainda ajuda
      const gapHours = inn.time && out.time ? Math.abs(out.time - inn.time) / 3600000 : null;
      const closeness = gapHours === null ? 0 : Math.max(0, 1 - gapHours / 6);
      const score = marginFit + 2 * name + 0.5 * closeness - 0.25 * Math.abs(days) - 0.15 * extraItems;

      if (score < cfg.minScore) continue;
      const priceSource = [...new Set([quoteIn.source, quoteOut.source])].join(' / ');
      candidates.push({ in: inn, out, margin, name, marginFit, days, gapHours, score, priceIn: pIn, priceOut: pOut, priceSource });
    }
  }
  return candidates.sort((a, b) => b.score - a.score);
}

// ---------- 5. escolha ----------

function confidence(c, rivals) {
  if (c.name >= 0.5) return 'alta';
  // Nenhum outro par que use algum desses lançamentos chega perto
  const unique = rivals < 1;
  if (c.name >= 0.2 || (unique && c.marginFit >= 0.5)) return 'media';
  return 'baixa';
}

function assign(candidates) {
  const used = new Set();
  const chosen = [];
  for (const c of candidates) {
    const ids = [...c.in.ids, ...c.out.ids];
    if (ids.some(id => used.has(id))) continue;
    ids.forEach(id => used.add(id));
    chosen.push(c);
  }

  // Rivais: outros candidatos que disputam algum dos mesmos lançamentos com pontuação próxima
  for (const c of chosen) {
    const ids = new Set([...c.in.ids, ...c.out.ids]);
    c.rivals = candidates.filter(
      o => o !== c && o.score >= c.score - 0.2 && [...o.in.ids, ...o.out.ids].some(id => ids.has(id))
    ).length;
  }
  return { chosen, used };
}

function legSide(leg) {
  return {
    moneda: leg.currency,
    monto: Math.abs(leg.amount),
    formula: '=' + leg.ids.join('+'),
    lancamentos: leg.txs.map(t => ({ id: t.id, fecha: t.date.toISOString(), monto: t.amount, contraparte: t.counterparty }))
  };
}

function describe(c) {
  // O cliente costuma ser o lado boliviano (quem paga ou recebe em BOB)
  const bobSide = c.in.currency === 'BOB' ? c.in : c.out;
  const reasons = [`margem ${(c.margin * 100).toFixed(2)}%`];
  if (c.name >= 0.5) reasons.push('mesmo nome nos dois extratos');
  else if (c.name > 0) reasons.push('sobrenome em comum');
  if (c.gapHours !== null && c.gapHours <= 2) reasons.push('horários próximos');
  if (c.days) reasons.push(`${Math.abs(c.days)} dia de diferença`);
  if (c.in.txs.length > 1 || c.out.txs.length > 1) reasons.push('soma de vários lançamentos');
  if (c.rivals) reasons.push(`${c.rivals} alternativa(s) parecida(s)`);

  return {
    fecha: (c.in.day < c.out.day ? c.in : c.out).day,
    cliente: titleCase(bobSide.tokens) || bobSide.counterparty,
    recibido: legSide(c.in),
    entregado: legSide(c.out),
    // Mesmos campos da aba Cambios: G é negativo (saída)
    tasa: round2((Math.abs(c.out.amount) / c.in.amount) * 1e4) / 1e4,
    precio_usdt_recibida: Math.round(c.priceIn * 1e4) / 1e4,
    precio_usdt_entregada: Math.round(c.priceOut * 1e4) / 1e4,
    precio_fuente: c.priceSource,
    margen: round2(c.margin * 1e4) / 1e4,
    utilidad_usdt: round2(c.in.amount / c.priceIn - Math.abs(c.out.amount) / c.priceOut),
    confianza: confidence(c, c.rivals),
    score: round2(c.score * 100) / 100,
    motivos: reasons
  };
}

// bank / p2p: saída do parser. Devolve os câmbios sugeridos e o que sobrou para revisar.
function reconcile({ bank, p2p, linked = new Map(), history = {} }, options = {}) {
  const cfg = { ...DEFAULTS, ...options, margin: { ...DEFAULTS.margin, ...options.margin } };
  const txs = bank.map(t => ({ ...t, tokens: nameTokens(t.counterparty), excluded: null }));

  // Ordens canceladas ficam só para a validação (não movem dinheiro nem dão cotação)
  const done = p2p.filter(o => (o.status || 'Completado') === 'Completado');
  const p2pMatches = markExcluded(txs, done, linked, cfg);
  const priceOf = buildPrices(done, history, cfg);
  const open = txs.filter(t => !t.excluded);
  const idf = buildIdf(open);

  const fixed = cfg.useLinked ? partialLegs(txs, linked) : [];
  const candidates = scorePairs([...buildLegs(open, cfg), ...fixed], priceOf, idf, cfg);
  const { chosen, used } = assign(candidates);

  const cambios = chosen
    .filter(c => !c.in.fila && !c.out.fila)
    .map(describe)
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.recibido.formula.localeCompare(b.recibido.formula));
  const completar = chosen
    .filter(c => c.in.fila || c.out.fila)
    .map(c => {
      const row = c.in.fila || c.out.fila;
      const side = c.in.fila ? 'entregado' : 'recibido';
      const d = describe(c);
      return { fila: row, falta: side, columna: side === 'recibido' ? 'E' : 'G', formula: d[side].formula, ...d };
    })
    .sort((a, b) => a.fila - b.fila);
  const pendientes = open
    .filter(t => !used.has(t.id))
    .map(t => ({ id: t.id, fecha: t.date.toISOString(), moneda: t.currency, monto: t.amount, contraparte: t.counterparty }));

  const excluded = {};
  for (const t of txs) if (t.excluded) excluded[t.excluded] = (excluded[t.excluded] || 0) + 1;

  return {
    resumen: {
      lancamentos: txs.length,
      excluidos: excluded,
      cambios: cambios.length,
      completar: completar.length,
      por_confianza: cambios.reduce((acc, c) => ({ ...acc, [c.confianza]: (acc[c.confianza] || 0) + 1 }), {}),
      pendientes: pendientes.length
    },
    cambios,
    completar,
    pendientes,
    p2p: p2pMatches,
    excluidos: txs.filter(t => t.excluded).map(t => ({ id: t.id, motivo: t.excluded }))
  };
}

module.exports = { reconcile, nameTokens, nicknameMatches, DEFAULTS };
