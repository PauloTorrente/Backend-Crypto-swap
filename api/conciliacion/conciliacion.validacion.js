// Valida as ordens P2P (Bybit/Binance) em dois passos:
//   1. banco ↔ exchange: cada ordem completada tem que ter o dinheiro no extrato (Compra = saiu
//      fiat do banco, Venta = entrou). O casamento vem do matcher (valor exato, apelido, pago
//      partido) ou da aba P2P da planilha. Ordem cancelada com o valor no banco é alerta.
//   2. exchange ↔ mercado: o preço de cada ordem contra a cotação do mercado na mesma hora
//      (histórico gravado a cada 30 s): compra contra o ask, venda contra o bid. Sem histórico
//      naquele horário, contra a mediana das próprias ordens de ±2 h (ou do dia), que só pega
//      ordem fora da curva.
const { BANKS, P2P } = require('./conciliacion.parser');
const { nameTokens, nicknameMatches } = require('./conciliacion.matcher');

const DEFAULTS = {
  marketTolerance: 0.005, // desvio desfavorável aceito frente ao mercado (0,5%)
  ownTolerance: 0.01, // frente à mediana das próprias ordens, que é menos precisa
  marketMaxMinutes: 30, // cotação do histórico até 30 min da ordem
  ownWindowHours: 2, // mediana das ordens até 2 h antes/depois (o preço anda durante o dia)
  p2pMaxHours: 3,
  useLinked: true
};

const EXCHANGE_NAMES = Object.fromEntries(Object.entries(P2P).map(([sheet, c]) => [sheet, c.name]));
const dayKey = d => d.toISOString().slice(0, 10);
const round = (n, d = 2) => (n === null || n === undefined ? null : Math.round(n * 10 ** d) / 10 ** d);
const median = xs => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmtDay = day => day.split('-').reverse().slice(0, 2).join('/');

// Dias cobertos por cada aba de extrato: do primeiro ao último lançamento
function coverage(bank) {
  const range = {};
  for (const t of bank) {
    const d = dayKey(t.date);
    const r = (range[t.sheet] ||= { from: d, to: d });
    if (d < r.from) r.from = d;
    if (d > r.to) r.to = d;
  }
  // Abas da moeda sem dados no dia (ex.: BRL no dia 15 sem o extrato da FIDU)
  return (currency, day) =>
    Object.entries(BANKS)
      .filter(([, cfg]) => cfg.currency === currency)
      .map(([sheet]) => sheet)
      .filter(sheet => !range[sheet] || day < range[sheet].from || day > range[sheet].to);
}

// Cotação de mercado no instante da ordem
function marketPrice(market, ownMedian, cfg) {
  const nearest = (points, t) => {
    let lo = 0;
    let hi = points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid][0] < t) lo = mid + 1;
      else hi = mid;
    }
    return [points[lo], points[lo - 1]].filter(Boolean).sort((a, b) => Math.abs(a[0] - t) - Math.abs(b[0] - t))[0];
  };
  return o => {
    const points = market[o.currency]?.[o.side === 'Compra' ? 'buy' : 'sell'];
    if (points?.length) {
      const p = nearest(points, +o.date);
      const minutes = Math.abs(p[0] - o.date) / 60000;
      if (minutes <= cfg.marketMaxMinutes) return { price: p[1], source: 'mercado', tolerance: cfg.marketTolerance };
    }
    const own = ownMedian(o);
    return own ? { ...own, tolerance: cfg.ownTolerance } : null;
  };
}

function validate(parsed, result, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const { bank, p2p, linked = new Map(), market = {} } = parsed;
  const missingSheets = coverage(bank);

  // Casamentos ordem → lançamentos: os do matcher e os que a planilha já tinha na aba P2P
  const byOrder = new Map(result.p2p.map(m => [m.order, { banks: m.banks || [m.bank], como: m.como || 'valor exacto' }]));
  if (cfg.useLinked) {
    const bankByFila = new Map();
    for (const t of bank) {
      const link = linked.get(`${t.sheet}:${t.row}`);
      if (link?.aba === 'P2P') bankByFila.set(link.fila, [...(bankByFila.get(link.fila) || []), t.id]);
    }
    for (const o of p2p) {
      const link = linked.get(`${o.sheet}:${o.row}`);
      if (link?.aba === 'P2P' && !byOrder.has(o.id)) {
        byOrder.set(o.id, { banks: bankByFila.get(link.fila) || [], como: `planilla (P2P fila ${link.fila})` });
      }
    }
  }
  const txById = new Map(bank.map(t => [t.id, t]));

  // Referência própria: mediana das outras ordens completadas da mesma moeda e lado, de ±2 h
  // (ou do dia inteiro, se perto não houver pelo menos 3)
  const done = p2p.filter(o => o.status === 'Completado');
  const groups = new Map();
  for (const o of done) {
    const key = `${o.currency}|${o.side}|${dayKey(o.date)}`;
    groups.set(key, [...(groups.get(key) || []), o]);
  }
  const ownMedian = o => {
    const others = (groups.get(`${o.currency}|${o.side}|${dayKey(o.date)}`) || []).filter(x => x !== o && x.price);
    const near = others.filter(x => Math.abs(x.date - o.date) <= cfg.ownWindowHours * 3600000);
    if (near.length >= 3) return { price: median(near.map(x => x.price)), source: `mediana de las órdenes ±${cfg.ownWindowHours} h` };
    if (others.length >= 3) return { price: median(others.map(x => x.price)), source: 'mediana de las órdenes del día' };
    return null;
  };
  const marketOf = marketPrice(market, ownMedian, cfg);

  const ordenes = done.map(o => {
    const day = dayKey(o.date);
    const match = byOrder.get(o.id);
    const hasStatement = Object.values(BANKS).some(b => b.currency === o.currency);
    const missing = hasStatement ? missingSheets(o.currency, day) : [];

    let banco_estado;
    let banco_detalle = '';
    if (match?.banks.length) {
      banco_estado = 'Conciliada';
      const txs = match.banks.map(id => txById.get(id)).filter(Boolean);
      const withTime = txs.find(t => t.hasTime);
      const minutes = withTime ? Math.round((withTime.date - o.date) / 60000) : null;
      banco_detalle = [match.como, minutes !== null && `${minutes >= 0 ? '+' : ''}${minutes} min`].filter(Boolean).join(', ');
    } else if (!hasStatement) {
      banco_estado = 'Otra moneda';
      banco_detalle = `${o.currency}: sin extracto bancario en esa moneda`;
    } else if (missing.length) {
      banco_estado = 'Falta extracto';
      banco_detalle = `${missing.join(', ')} sin datos del ${fmtDay(day)}`;
    } else {
      banco_estado = 'Sin movimiento en banco';
      banco_detalle = `ningún ${o.side === 'Compra' ? 'débito' : 'crédito'} de ${o.amount} ${o.currency} cerca de la hora de la orden`;
    }

    const ref = marketOf(o);
    let mercado_estado = 'Sin cotización';
    let desvio = null;
    let costo = null;
    if (ref) {
      // Positivo = peor que el mercado: compra más cara o venta más barata
      desvio = o.side === 'Compra' ? o.price / ref.price - 1 : 1 - o.price / ref.price;
      costo = o.usdt * desvio;
      mercado_estado = desvio > ref.tolerance ? 'Desfavorable' : desvio < -3 * ref.tolerance ? 'Revisar (muy distinto)' : 'OK';
    }

    return {
      ref: `${o.sheet}!B${o.row}`,
      id: o.id,
      exchange: EXCHANGE_NAMES[o.sheet] || o.sheet,
      orden: o.order,
      fecha: o.date.toISOString(),
      tipo: o.side,
      moneda: o.currency,
      monto: o.amount,
      precio: o.price,
      usdt: o.usdt,
      comision: o.fee ?? null,
      contraparte: o.counterparty,
      banco: match?.banks.join('+') || null,
      banco_estado,
      banco_detalle,
      mercado: ref ? round(ref.price, 4) : null,
      mercado_fuente: ref?.source || null,
      desvio: round(desvio, 5),
      costo_usdt: round(costo),
      mercado_estado
    };
  });

  // Ordem cancelada mas com o valor exato no banco (perto da hora, ou no mesmo dia com o apelido
  // parecido com o nome do extrato): dinheiro que pode ter ido sem o USDT voltar
  const open = new Map(result.pendientes.map(p => [p.id, txById.get(p.id)]));
  const canceladas = [];
  for (const o of p2p.filter(x => x.status !== 'Completado')) {
    const sign = o.side === 'Compra' ? -1 : 1;
    const hit = [...open.values()].find(t => {
      if (!t || t.currency !== o.currency || Math.sign(t.amount) !== sign || Math.abs(Math.abs(t.amount) - o.amount) > 0.01) return false;
      if (t.hasTime) return Math.abs(t.date - o.date) / 3600000 <= cfg.p2pMaxHours;
      return dayKey(t.date) === dayKey(o.date) && nicknameMatches(o.counterparty, nameTokens(t.counterparty));
    });
    if (!hit) continue;
    open.delete(hit.id);
    canceladas.push({
      ref: `${o.sheet}!B${o.row}`,
      exchange: EXCHANGE_NAMES[o.sheet] || o.sheet,
      orden: o.order,
      fecha: o.date.toISOString(),
      estado: o.status,
      tipo: o.side,
      moneda: o.currency,
      monto: o.amount,
      contraparte: o.counterparty,
      banco: hit.id,
      banco_contraparte: hit.counterparty
    });
  }

  const count = (list, key) => list.reduce((acc, x) => ({ ...acc, [x[key]]: (acc[x[key]] || 0) + 1 }), {});
  const porExchange = {};
  for (const o of ordenes) {
    const e = (porExchange[o.exchange] ||= { ordenes: 0, conciliadas: 0, sin_banco: 0, desfavorables: 0 });
    e.ordenes++;
    if (o.banco_estado === 'Conciliada') e.conciliadas++;
    if (o.banco_estado === 'Sin movimiento en banco') e.sin_banco++;
    if (o.mercado_estado === 'Desfavorable') e.desfavorables++;
  }
  const compared = ordenes.filter(o => o.desvio !== null);
  const loss = compared.filter(o => o.mercado_estado === 'Desfavorable').reduce((s, o) => s + o.costo_usdt, 0);

  return {
    resumen: {
      ordenes: ordenes.length,
      banco: count(ordenes, 'banco_estado'),
      canceladas_con_movimiento: canceladas.length,
      mercado: {
        ...count(ordenes, 'mercado_estado'),
        contra_mercado: compared.filter(o => o.mercado_fuente === 'mercado').length,
        contra_mediana: compared.filter(o => o.mercado_fuente !== 'mercado').length,
        costo_desfavorable_usdt: round(loss)
      },
      por_exchange: porExchange
    },
    ordenes,
    canceladas
  };
}

module.exports = { validate, DEFAULTS };
