const service = require('./exchange.service');

const getAllRates = async (req, res) => {
  try {
    console.log('📥 Processando requisição para consultar taxas de câmbio...');
    const rates = await service.getAllRates();
    console.log('📤 Taxas recuperadas com sucesso.');
    res.json(rates);
  } catch (error) {
    console.error('⚠️ Erro ao consultar taxas de câmbio.');
    res.status(500).json({ 
      message: 'Erro ao consultar taxas de câmbio.',
      error: error.message 
    });
  }
};

const getRate = async (req, res) => {
  try {
    console.log('📥 Processando consulta de taxa de câmbio específica...');
    const rate = await service.getRate(req.params.currencyCode);
    if (rate) {
      console.log('📤 Taxa específica retornada com sucesso.');
      res.json(rate);
    } else {
      console.log('⚠️ Moeda não encontrada.');
      res.status(404).json({ 
        message: 'Moeda não encontrada' 
      });
    }
  } catch (error) {
    console.error('⚠️ Erro ao consultar taxa específica.');
    res.status(500).json({ 
      message: 'Erro ao consultar taxa de câmbio.',
      error: error.message 
    });
  }
};

const updateRate = async (req, res) => {
  try {
    console.log('📥 Processando atualização de taxa...');
    const updated = await service.updateRate(
      req.params.currencyCode, 
      req.body
    );
    if (updated) {
      console.log('📤 Taxa atualizada com sucesso.');
      res.json(updated);
    } else {
      console.log('⚠️ Moeda não encontrada para atualização.');
      res.status(404).json({ 
        message: 'Moeda não encontrada' 
      });
    }
  } catch (error) {
    console.error('⚠️ Erro ao atualizar taxa.');
    res.status(400).json({ 
      message: 'Erro ao atualizar taxa.',
      error: error.message 
    });
  }
};

const createCurrency = async (req, res) => {
  try {
    console.log('📥 Processando criação de nova moeda...');
    const newCurrency = await service.addCurrency(req.body);
    console.log('📤 Moeda criada com sucesso.');
    res.status(201).json(newCurrency);
  } catch (error) {
    console.error('⚠️ Erro ao criar moeda.');
    const status = error.message.includes('already exists') ? 409 : 400;
    res.status(status).json({ 
      message: 'Erro ao criar moeda.',
      error: error.message 
    });
  }
};

const deleteCurrency = async (req, res) => {
  try {
    console.log('📥 Processando exclusão de moeda...');
    const result = await service.removeCurrency(req.params.currencyCode);
    if (result) {
      console.log('📤 Moeda removida com sucesso.');
      res.json(result);
    } else {
      console.log('⚠️ Moeda não encontrada para exclusão.');
      res.status(404).json({ 
        message: 'Erro ao excluir moeda.',
        error: 'Moeda não encontrada'
      });
    }
  } catch (error) {
    console.error('⚠️ Erro ao excluir moeda.');
    res.status(404).json({ 
      message: 'Erro ao excluir moeda.',
      error: error.message 
    });
  }
};

module.exports = {
  getAllRates,
  getRate,
  updateRate,
  createCurrency,
  deleteCurrency
};
