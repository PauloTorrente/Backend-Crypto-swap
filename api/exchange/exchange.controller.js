const service = require('./exchange.service');

class ExchangeController {
  // List all exchange rates
  async getAllRates(req, res) {
    try {
      console.log('📊 Fetching all exchange rates...');
      const rates = await service.getAllRates();
      
      const formattedRates = rates.map(rate => ({
        id: rate.id,
        currency_code: rate.currency_code,
        currency_name: rate.currency_name,
        rate_type: rate.rate_type,
        buy_rate: parseFloat(rate.buy_rate).toFixed(2),
        sell_rate: parseFloat(rate.sell_rate).toFixed(2),
        bank_fee: parseFloat(rate.bank_fee).toFixed(4),
        platform_fee: parseFloat(rate.platform_fee).toFixed(4),
        spread: parseFloat(rate.spread).toFixed(2),
        mid_rate: parseFloat(rate.mid_rate).toFixed(2),
        last_updated: rate.last_updated
      }));

      res.json({
        success: true,
        data: formattedRates,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('❌ Error fetching rates:', error.message);
      res.status(500).json({ 
        success: false,
        message: 'Failed to load exchange rates',
        error: error.message,
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
      });
    }
  }

  // Get specific exchange rate
  async getRate(req, res) {
    try {
      const { currencyCode } = req.params;
      console.log(`🔍 Fetching rate for ${currencyCode}...`);
      
      const rate = await service.getRate(currencyCode.toUpperCase());
      if (!rate) {
        return res.status(404).json({ 
          success: false,
          message: `Currency ${currencyCode} not found`
        });
      }

      const formattedRate = {
        id: rate.id,
        currency_code: rate.currency_code,
        currency_name: rate.currency_name,
        rate_type: rate.rate_type,
        buy_rate: parseFloat(rate.buy_rate).toFixed(2),
        sell_rate: parseFloat(rate.sell_rate).toFixed(2),
        bank_fee: parseFloat(rate.bank_fee).toFixed(4),
        platform_fee: parseFloat(rate.platform_fee).toFixed(4),
        spread: parseFloat(rate.spread).toFixed(2),
        mid_rate: parseFloat(rate.mid_rate).toFixed(2),
        last_updated: rate.last_updated
      };

      res.json({ 
        success: true,
        data: formattedRate
      });
    } catch (error) {
      console.error(`❌ Error fetching ${req.params.currencyCode}:`, error.message);
      res.status(500).json({ 
        success: false,
        message: 'Failed to fetch rate',
        error: error.message,
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
      });
    }
  }

  // BOB ↔ BRL pair rates with margin
  async getPairRates(req, res) {
    try {
      console.log('💱 Fetching BOB/BRL pair rates...');
      const pairs = await service.getPairRates();

      res.json({
        success: true,
        data: {
          bob_per_brl: pairs.bob_per_brl.toFixed(4),
          margin: pairs.margin.toFixed(3),
          BOB_BRL: pairs.BOB_BRL.toFixed(4),
          BRL_BOB: pairs.BRL_BOB.toFixed(4)
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('❌ Error fetching pair rates:', error.message);
      res.status(500).json({ 
        success: false,
        message: 'Failed to load pair rates',
        error: error.message,
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
      });
    }
  }

  // Download do histórico em .txt: preço do USDT em BRL e BOB por corretora (sem as taxas com margem)
  // GET /api/rates/history/download?from=<ISO>&to=<ISO>&tz=America/La_Paz
  async downloadHistory(req, res) {
    const from = new Date(req.query.from);
    const to = new Date(req.query.to);
    if (isNaN(from) || isNaN(to)) {
      return res.status(400).json({
        success: false,
        message: 'Parameters "from" and "to" must be valid dates'
      });
    }
    if (from > to) {
      return res.status(400).json({
        success: false,
        message: '"from" must be before "to"'
      });
    }

    // Fuso usado para mostrar os horários no arquivo (o servidor roda em UTC)
    let timeZone = req.query.tz || 'America/La_Paz';
    try {
      new Intl.DateTimeFormat('pt-BR', { timeZone });
    } catch {
      timeZone = 'America/La_Paz';
    }
    const fmt = date => new Date(date).toLocaleString('pt-BR', { timeZone });
    const num = v => parseFloat(v).toFixed(4);
    const day = date => fmt(date).slice(0, 10).split('/').reverse().join('-');

    console.log(`📄 Downloading history ${from.toISOString()} → ${to.toISOString()}...`);

    try {
      const batches = service.iterateHistory(from, to);
      const first = await batches.next(); // valida o banco antes de começar a enviar o arquivo

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="cotacoes_${day(from)}_a_${day(to)}.txt"`
      );

      res.write(`Histórico de preços do USDT em BRL e BOB (compra/venda por corretora)\n`);
      res.write(`Período: ${fmt(from)} até ${fmt(to)} (${timeZone})\n\n`);

      let count = 0;
      const writeRows = rows => {
        for (const r of rows) {
          const prices = ['BRL', 'BOB'].map(code => {
            const sources = (r.prices[code] || [])
              .map(s => `${s.exchange} ${num(s.buy)}/${num(s.sell)}`)
              .join(', ');
            return `${code}: ${sources || '-'}`;
          });
          res.write(`[${fmt(r.created_at)}] ${prices.join(' | ')}\n`);
        }
        count += rows.length;
      };

      if (!first.done) writeRows(first.value);
      for await (const rows of batches) writeRows(rows);

      res.end(count === 0 ? 'Nenhum registro no período.\n' : `\nTotal: ${count} registros\n`);
    } catch (error) {
      console.error('❌ Error downloading history:', error.message);
      if (res.headersSent) return res.end(`\nERRO: ${error.message}\n`);
      res.status(500).json({
        success: false,
        message: 'Failed to download history',
        error: error.message,
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
      });
    }
  }

  // Currency conversion with optional custom rates
  async convert(req, res) {
    try {
      const { from, to, amount } = req.body;
      console.log(`🔄 Converting ${amount} ${from} → ${to}...`);

      // Validate required fields
      if (!from || !to || !amount) {
        return res.status(400).json({ 
          success: false,
          message: 'Parameters "from", "to" and "amount" are required'
        });
      }

      // Validate currency pair
      if (from === to) {
        return res.status(400).json({ 
          success: false,
          message: 'Source and target currencies must be different'
        });
      }

      // Validate amount
      if (isNaN(amount)) {
        return res.status(400).json({ 
          success: false,
          message: 'Amount must be a valid number'
        });
      }

      const numericAmount = parseFloat(amount);
      if (numericAmount <= 0) {
        return res.status(400).json({ 
          success: false,
          message: 'Amount must be greater than zero'
        });
      }

      // Process conversion
      const result = await service.convertCurrency(
        from.toUpperCase(), 
        to.toUpperCase(), 
        numericAmount
      );

      // Format response
      const response = {
        success: true,
        originalAmount: result.originalAmount.toFixed(2),
        fromCurrency: result.fromCurrency,
        toCurrency: result.toCurrency,
        finalAmount: result.finalAmount.toFixed(2),
        rates: {
          bob_per_brl: result.rates.bob_per_brl.toFixed(4),
          margin: result.rates.margin.toFixed(3),
          rateUsed: result.rates.rateUsed.toFixed(4)
        },
        timestamp: new Date().toISOString()
      };

      res.json(response);
    } catch (error) {
      console.error('❌ Conversion error:', error.message);
      res.status(400).json({ 
        success: false,
        message: 'Conversion failed',
        error: error.message,
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
      });
    }
  }

  // Update exchange rate
  async updateRate(req, res) {
    try {
      const { currencyCode } = req.params;
      console.log(`🔄 Updating rate for ${currencyCode}...`);

      const updated = await service.updateRate(
        currencyCode.toUpperCase(), 
        req.body
      );
      
      const response = {
        success: true,
        data: {
          currency_code: updated.currency_code,
          buy_rate: parseFloat(updated.buy_rate).toFixed(2),
          sell_rate: parseFloat(updated.sell_rate).toFixed(2),
          spread: parseFloat(updated.spread).toFixed(2),
          mid_rate: parseFloat(updated.mid_rate).toFixed(2),
          last_updated: updated.last_updated
        },
        timestamp: new Date().toISOString()
      };

      res.json(response);
    } catch (error) {
      console.error(`❌ Error updating ${req.params.currencyCode}:`, error.message);
      res.status(400).json({ 
        success: false,
        message: 'Failed to update rate',
        error: error.message,
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
      });
    }
  }

  // Add new currency
  async addCurrency(req, res) {
    try {
      console.log('➕ Adding new currency...');
      const newCurrency = await service.addCurrency(req.body);
      
      const response = {
        success: true,
        data: {
          id: newCurrency.id,
          currency_code: newCurrency.currency_code,
          currency_name: newCurrency.currency_name,
          rate_type: newCurrency.rate_type,
          buy_rate: parseFloat(newCurrency.buy_rate).toFixed(2),
          sell_rate: parseFloat(newCurrency.sell_rate).toFixed(2),
          spread: parseFloat(newCurrency.spread).toFixed(2),
          mid_rate: parseFloat(newCurrency.mid_rate).toFixed(2),
          created_at: new Date().toISOString()
        },
        timestamp: new Date().toISOString()
      };
      
      res.status(201).json(response);
    } catch (error) {
      console.error('❌ Error adding currency:', error.message);
      const status = error.message.includes('already exists') ? 409 : 400;
      res.status(status).json({ 
        success: false,
        message: 'Failed to create currency',
        error: error.message,
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
      });
    }
  }

  // Remove currency
  async removeCurrency(req, res) {
    try {
      const { currencyCode } = req.params;
      console.log(`🗑️ Removing currency ${currencyCode}...`);

      const result = await service.removeCurrency(currencyCode.toUpperCase());
      
      res.json({ 
        success: true,
        message: result.message,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error(`❌ Error removing ${req.params.currencyCode}:`, error.message);
      res.status(400).json({ 
        success: false,
        message: 'Failed to remove currency',
        error: error.message,
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
      });
    }
  }
}

module.exports = new ExchangeController();
