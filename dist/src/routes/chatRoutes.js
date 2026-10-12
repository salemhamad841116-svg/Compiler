const express = require('express');
const { handleUserChatQuery } = require('../controllers/chatController');
const { asyncHandler } = require('../auth/middleware');

const router = express.Router();

router.post('/query', asyncHandler(handleUserChatQuery));

module.exports = router;
