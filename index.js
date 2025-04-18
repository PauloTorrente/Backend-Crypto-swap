const cors = require('cors');
const express = require('express');
const app = express();
const db = require('./config/database'); // Certifique-se que isso exporta uma instância do Sequelize
const router = require('./api/router'); 
const PORT = process.env.PORT || 3000;

// ✅ Libera requisições de qualquer origem (útil para desenvolvimento local)
app.use(cors());

app.use(express.json()); 
app.use('/api', router); 

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

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
