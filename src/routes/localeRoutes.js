const express = require('express');
const router = express.Router();
const { getLocaleDictionary } = require('../controllers/localeController');

router.get('/:lang', getLocaleDictionary);

module.exports = router;
