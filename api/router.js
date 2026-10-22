const express = require('express');
const router = express.Router();

// Import routes
const exchangeRouter = require('./exchange/exchange.router');
const authRouter = require('./auth/auth.router');
const usersRouter = require('./users/users.router');
const cambiosRouter = require('./cambios/cambios.router');
const conciliacionRouter = require('./conciliacion/conciliacion.router');

// Use routes with proper prefixes
router.use('/rates', exchangeRouter);
router.use('/auth', authRouter);
router.use('/users', usersRouter);
router.use('/cambios', cambiosRouter); // registros de câmbio (admin)
router.use('/conciliacion', conciliacionRouter); // monta os câmbios a partir dos extratos

module.exports = router;
