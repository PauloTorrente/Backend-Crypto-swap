const express = require('express');
const app = express();
const db = require('./config/database');
const router = require('./api/router'); 
const PORT = process.env.PORT || 3000;

app.use(express.json()); 
app.use('/api', router); 

app.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT NOW()');
    res.json({ success: true, time: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
