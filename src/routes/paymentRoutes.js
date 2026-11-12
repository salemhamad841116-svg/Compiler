const express = require('express');
const stripeService = require('../services/payment/stripeService');
const { asyncHandler } = require('../auth/middleware');

const router = express.Router();

router.get('/tiers', (req, res) => {
  const tiers = stripeService.getTiers();
  res.json({ tiers });
});

router.post(
  '/checkout',
  asyncHandler(async (req, res) => {
    const { tier, customerEmail, customerName, referralCode, successUrl, cancelUrl } = req.body;
    const session = await stripeService.createCheckoutSession({
      tier,
      customerEmail: customerEmail || (req.user ? req.user.email : null),
      customerName: customerName || (req.user ? req.user.name : null),
      referralCode,
      successUrl,
      cancelUrl,
      actor: req.user ? { id: req.user.id, name: req.user.name } : null,
    });
    res.json(session);
  })
);

router.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    const signature = req.headers['stripe-signature'] || null;
    const result = await stripeService.handleWebhookEvent(req.body, signature);
    res.json(result);
  })
);

module.exports = router;
