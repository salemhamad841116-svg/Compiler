const express = require('express');
const { handleUserChatQuery } = require('../controllers/chatController');

const router = express.Router();

router.post('/query', handleUserChatQuery);

module.exports = router;
