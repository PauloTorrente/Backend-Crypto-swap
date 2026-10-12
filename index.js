const cors = require('cors');
const express = require('express');
const path = require('path');
const app = express();
const db = require('./config/database'); // Certifique-se que isso exporta uma instância do Sequelize
const router = require('./api/router');
const exchangeService = require('./api/exchange/exchange.service');
const PORT = process.env.PORT || 3000;

// ✅ Libera requisições de qualquer origem (útil para desenvolvimento local)
app.use(cors({ exposedHeaders: ['Content-Disposition'] })); // permite ao front ler o nome do .txt

app.use(express.json()); 
app.use('/api', router); 

// Página para baixar o histórico de cotações em .txt
app.get('/historico', (req, res) => res.sendFile(path.join(__dirname, 'public', 'historico.html')));

app.get('/', async (req, res) => {
  try {
    // Sequelize retorna [resultados, metadata] em consultas brutas
    const [results] = await db.query('SELECT NOW()');
    
    // Verifica se há resultados e pega o primeiro registro
    if (!results || results.length === 0) {
      throw new Error('Nenhum resultado retornado');
    }

    // Acessa a propriedade 'now' (nome da coluna retornada pelo PostgreSQL)
    res.json({ 
      success: true, 
      time: results[0].now 
    });

  } catch (err) {
    console.error('Erro na rota /:', err);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// Mostra as cotações do par no terminal ao subir e a cada 30s, e grava no banco (se houver)
const RATES_LOG_INTERVAL_MS = 30 * 1000;

async function logPairRates() {
  try {
    const p = await exchangeService.saveSnapshot();
    const time = new Date().toLocaleTimeString('pt-BR');
    console.log(
      `📈 [${time}] BOB/BRL ${p.bob_per_brl.toFixed(4)} | ` +
      `BOB→BRL ${p.BOB_BRL.toFixed(4)} | BRL→BOB ${p.BRL_BOB.toFixed(4)} (margem ${p.margin})` +
      (exchangeService.hasDatabase ? ' 💾' : '')
    );
  } catch (err) {
    console.error('❌ Erro ao buscar/gravar cotações:', err.message);
  }
}

async function start() {
  if (process.env.DATABASE_URL) {
    // Cria as tabelas que ainda não existem (não altera as que já existem)
    await db.sync();
    await exchangeService.ensureHistorySchema();
    console.log('✅ Tabelas sincronizadas com o banco de dados');
  }

  app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
    logPairRates();
    setInterval(logPairRates, RATES_LOG_INTERVAL_MS);
  });
}

start().catch(err => {
  console.error('🔴 Falha ao iniciar o servidor:', err);
  process.exit(1);
});
