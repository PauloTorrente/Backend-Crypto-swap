const service = require('./exchange.service');

class ExchangeController {
  // List all exchange rates
  async getAllRates(req, res) {
    try {
      console.log('📊 Buscando todas as taxas de câmbio...');
      const rates = await service.getAllRates();
      
      // Format all numeric values in the rates array
      const formattedRates = rates.map(rate => ({
        ...rate,
        buy_rate: parseFloat(rate.buy_rate).toFixed(2),
        sell_rate: parseFloat(rate.sell_rate).toFixed(2),
        bank_fee: parseFloat(rate.bank_fee).toFixed(4),
        platform_fee: parseFloat(rate.platform_fee).toFixed(4),
        spread: parseFloat(rate.spread).toFixed(2),
        mid_rate: parseFloat(rate.mid_rate).toFixed(2)
      }));

      res.json({
        success: true,
        data: formattedRates
      });
    } catch (error) {
      console.error('❌ Erro ao buscar taxas:', error.message);
      res.status(500).json({ 
        success: false,
        message: 'Falha ao carregar taxas de câmbio',
        error: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  // Get specific exchange rate by currency code
  async getRate(req, res) {
    try {
      const { currencyCode } = req.params;
      console.log(`🔎 Buscando taxa para moeda ${currencyCode}...`);
      
      const rate = await service.getRate(currencyCode.toUpperCase());
      if (!rate) {
        return res.status(404).json({ 
          success: false,
          message: `Moeda ${currencyCode} não encontrada` 
        });
      }

      // Ensure all numeric values are properly formatted
      const formattedRate = {
        ...rate,
        buy_rate: parseFloat(rate.buy_rate).toFixed(2),
        sell_rate: parseFloat(rate.sell_rate).toFixed(2),
        bank_fee: parseFloat(rate.bank_fee).toFixed(4),
        platform_fee: parseFloat(rate.platform_fee).toFixed(4),
        spread: parseFloat(rate.spread).toFixed(2),
        mid_rate: parseFloat(rate.mid_rate).toFixed(2)
      };

      res.json({ 
        success: true,
        data: formattedRate 
      });
    } catch (error) {
      console.error(`❌ Erro ao buscar ${req.params.currencyCode}:`, error.message);
      res.status(500).json({ 
        success: false,
        message: 'Falha ao buscar taxa',
        error: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  // Convert between currencies
  async convert(req, res) {
    try {
      const { from, to, amount } = req.body;
      console.log(`🔄 Convertendo ${amount} ${from} para ${to}...`);

      if (!from || !to || !amount) {
        return res.status(400).json({ 
          success: false,
          message: 'Parâmetros from, to e amount são obrigatórios' 
        });
      }

      if (from === to) {
        return res.status(400).json({ 
          success: false,
          message: 'Moedas de origem e destino devem ser diferentes' 
        });
      }

      const result = await service.convertCurrency(
        from.toUpperCase(), 
        to.toUpperCase(), 
        parseFloat(amount)
      );
      
      // Format all numeric values in the response
      const formattedResult = {
        ...result,
        finalAmount: parseFloat(result.finalAmount).toFixed(2),
        steps: {
          ...result.steps,
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
            usdt: parseFloat(result.steps.exchangeRateUsed.usdt).toFixed(4)
          }
        }
      };

      res.json({ 
        success: true, 
        ...formattedResult 
      });
    } catch (error) {
      console.error('❌ Erro na conversão:', error.message);
      res.status(400).json({ 
        success: false,
        message: 'Falha na conversão',
        error: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  // Update exchange rate
  async updateRate(req, res) {
    try {
      const { currencyCode } = req.params;
      console.log(`🔄 Atualizando taxa para ${currencyCode}...`);

      const updated = await service.updateRate(
        currencyCode.toUpperCase(), 
        req.body
      );
      
      // Format the updated rate response
      const formattedRate = {
        ...updated,
        buy_rate: parseFloat(updated.buy_rate).toFixed(2),
        sell_rate: parseFloat(updated.sell_rate).toFixed(2),
        spread: parseFloat(updated.spread).toFixed(2),
        mid_rate: parseFloat(updated.mid_rate).toFixed(2)
      };

      res.json({ 
        success: true, 
        data: formattedRate 
      });
    } catch (error) {
      console.error(`❌ Erro ao atualizar ${req.params.currencyCode}:`, error.message);
      res.status(400).json({ 
        success: false,
        message: 'Falha ao atualizar taxa',
        error: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  // Add new currency
  async addCurrency(req, res) {
    try {
      console.log('➕ Adicionando nova moeda...');
      const newCurrency = await service.addCurrency(req.body);
      
      // Format the new currency response
      const formattedCurrency = {
        ...newCurrency,
        buy_rate: parseFloat(newCurrency.buy_rate).toFixed(2),
        sell_rate: parseFloat(newCurrency.sell_rate).toFixed(2),
        spread: parseFloat(newCurrency.spread).toFixed(2),
        mid_rate: parseFloat(newCurrency.mid_rate).toFixed(2)
      };
      
      res.status(201).json({ 
        success: true, 
        data: formattedCurrency 
      });
    } catch (error) {
      console.error('❌ Erro ao adicionar moeda:', error.message);
      const status = error.message.includes('já existe') ? 409 : 400;
      res.status(status).json({ 
        success: false,
        message: 'Falha ao criar moeda',
        error: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  // Remove currency
  async removeCurrency(req, res) {
    try {
      const { currencyCode } = req.params;
      console.log(`🗑️ Removendo moeda ${currencyCode}...`);

      const result = await service.removeCurrency(currencyCode.toUpperCase());
      
      res.json({ 
        success: true, 
        ...result 
      });
    } catch (error) {
      console.error(`❌ Erro ao remover ${req.params.currencyCode}:`, error.message);
      res.status(400).json({ 
        success: false,
        message: 'Falha ao remover moeda',
        error: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }
}

module.exports = new ExchangeController();
