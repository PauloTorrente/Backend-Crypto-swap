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

  // Currency conversion with optional custom rates
  async convert(req, res) {
    try {
      const { from, to, amount, customRates } = req.body;
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
        numericAmount,
        customRates
      );

      // Format response
      const response = {
        success: true,
        originalAmount: parseFloat(result.originalAmount).toFixed(2),
        fromCurrency: result.fromCurrency,
        toCurrency: result.toCurrency,
        finalAmount: parseFloat(result.finalAmount).toFixed(2),
        steps: {
          bankFee: parseFloat(result.steps.bankFee).toFixed(2),
          netAfterBank: parseFloat(result.steps.netAfterBank).toFixed(2),
          usdtAcquired: parseFloat(result.steps.usdtAcquired).toFixed(2),
          platformFee: parseFloat(result.steps.platformFee).toFixed(2),
          netUsdt: parseFloat(result.steps.netUsdt).toFixed(2),
          spread: parseFloat(result.steps.spread).toFixed(2),
          finalUsdt: parseFloat(result.steps.finalUsdt).toFixed(2),
          exchangeRateUsed: {
            from: parseFloat(result.steps.exchangeRateUsed.from).toFixed(2),
            to: parseFloat(result.steps.exchangeRateUsed.to).toFixed(2),
            usdt: parseFloat(result.steps.exchangeRateUsed.usdt).toFixed(4),
            ...(result.steps.exchangeRateUsed.bankFeeRate && {
              bankFeeRate: parseFloat(result.steps.exchangeRateUsed.bankFeeRate).toFixed(4)
            }),
            ...(result.steps.exchangeRateUsed.spreadRate && {
              spreadRate: parseFloat(result.steps.exchangeRateUsed.spreadRate).toFixed(4)
            })
          },
          isCustom: result.steps.isCustom || false
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
