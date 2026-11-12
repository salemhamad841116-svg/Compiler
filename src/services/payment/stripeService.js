const crypto = require('crypto');
const config = require('../../config');
const audit = require('../auditService');
const { AppError } = require('../../utils/errors');
const { nowIso } = require('../../utils/clock');

const UAE_VAT_RATE = 0.05; // 5% UAE VAT
const DEFAULT_CURRENCY = 'aed';

const SUBSCRIPTION_TIERS = {
  standard: {
    id: 'standard',
    name: 'Standard Tier',
    priceAed: 49,
    priceFils: 4900,
    features: ['basic_rag', 'camel_heritage', 'general_knowledge'],
  },
  pro: {
    id: 'pro',
    name: 'Pro Tier',
    priceAed: 149,
    priceFils: 14900,
    features: ['advanced_rag', 'programming_engineering', 'voice_library', 'fast_embeddings'],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise Tier',
    priceAed: 499,
    priceFils: 49900,
    features: ['unlimited_rag', 'custom_spaces', 'dedicated_agent', 'priority_support'],
  },
};

function calculateVat(subtotalFils) {
  const vatFils = Math.round(subtotalFils * UAE_VAT_RATE);
  const totalFils = subtotalFils + vatFils;
  return {
    subtotalFils,
    vatRate: UAE_VAT_RATE,
    vatFils,
    totalFils,
    subtotalAed: subtotalFils / 100,
    vatAed: vatFils / 100,
    totalAed: totalFils / 100,
  };
}

class StripeService {
  constructor() {
    this.apiKey = process.env.STRIPE_SECRET_KEY || null;
    this.webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || null;
    this.currency = DEFAULT_CURRENCY;
  }

  isLive() {
    return Boolean(this.apiKey && this.apiKey.startsWith('sk_'));
  }

  getTiers() {
    return Object.values(SUBSCRIPTION_TIERS).map((t) => {
      const calculation = calculateVat(t.priceFils);
      return {
        ...t,
        currency: 'AED',
        pricing: calculation,
      };
    });
  }

  async createCheckoutSession({
    tier = 'pro',
    customerEmail,
    customerName = null,
    referralCode = null,
    successUrl = 'https://admin.misruq.com/billing/success?session_id={CHECKOUT_SESSION_ID}',
    cancelUrl = 'https://admin.misruq.com/billing/cancel',
    actor = null,
  }) {
    const tierConfig = SUBSCRIPTION_TIERS[tier];
    if (!tierConfig) {
      throw new AppError(400, 'INVALID_SUBSCRIPTION_TIER', `Unknown tier: ${tier}`);
    }

    const pricing = calculateVat(tierConfig.priceFils);
    const sessionId = `cs_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;

    if (this.isLive()) {
      try {
        const bodyParams = new URLSearchParams();
        bodyParams.append('mode', 'subscription');
        bodyParams.append('payment_method_types[0]', 'card');
        bodyParams.append('customer_email', customerEmail);
        bodyParams.append('success_url', successUrl);
        bodyParams.append('cancel_url', cancelUrl);
        bodyParams.append('client_reference_id', customerEmail);
        bodyParams.append('metadata[tier]', tier);
        bodyParams.append('metadata[referral_code]', referralCode || '');
        bodyParams.append('metadata[vat_amount_fils]', String(pricing.vatFils));

        // Subtotal item
        bodyParams.append('line_items[0][price_data][currency]', DEFAULT_CURRENCY);
        bodyParams.append('line_items[0][price_data][product_data][name]', `${tierConfig.name} Subscription`);
        bodyParams.append('line_items[0][price_data][unit_amount]', String(pricing.subtotalFils));
        bodyParams.append('line_items[0][price_data][recurring][interval]', 'month');
        bodyParams.append('line_items[0][quantity]', '1');

        // UAE VAT 5% item
        bodyParams.append('line_items[1][price_data][currency]', DEFAULT_CURRENCY);
        bodyParams.append('line_items[1][price_data][product_data][name]', 'UAE VAT (5%)');
        bodyParams.append('line_items[1][price_data][unit_amount]', String(pricing.vatFils));
        bodyParams.append('line_items[1][price_data][recurring][interval]', 'month');
        bodyParams.append('line_items[1][quantity]', '1');

        const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: bodyParams.toString(),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error ? err.error.message : 'Stripe checkout creation failed');
        }

        const data = await res.json();
        audit.record({
          action: 'payment.checkout_created',
          actor: actor || { id: customerEmail, name: customerName || customerEmail },
          detail: { sessionId: data.id, tier, currency: DEFAULT_CURRENCY, totalAed: pricing.totalAed, live: true },
        });

        return {
          sessionId: data.id,
          url: data.url,
          currency: DEFAULT_CURRENCY,
          pricing,
          live: true,
        };
      } catch (err) {
        throw new AppError(502, 'PAYMENT_GATEWAY_ERROR', `Stripe error: ${err.message}`);
      }
    }

    // Mock session (offline/dev/staging mode)
    const mockUrl = `${successUrl.replace('{CHECKOUT_SESSION_ID}', sessionId)}&mock=true`;
    audit.record({
      action: 'payment.checkout_created',
      actor: actor || { id: customerEmail || 'guest', name: customerName || 'Guest' },
      detail: { sessionId, tier, currency: DEFAULT_CURRENCY, totalAed: pricing.totalAed, live: false },
    });

    return {
      sessionId,
      url: mockUrl,
      currency: DEFAULT_CURRENCY,
      pricing,
      live: false,
    };
  }

  verifySignature(rawBuffer, signatureHeader) {
    if (!this.webhookSecret) return true;
    if (!signatureHeader) {
      throw new AppError(400, 'INVALID_WEBHOOK_SIGNATURE', 'Missing stripe-signature header.');
    }

    const sigMap = {};
    for (const item of String(signatureHeader).split(',')) {
      const idx = item.indexOf('=');
      if (idx !== -1) {
        const k = item.slice(0, idx).trim();
        const v = item.slice(idx + 1).trim();
        sigMap[k] = v;
      }
    }

    if (!sigMap.t || !sigMap.v1) {
      throw new AppError(400, 'INVALID_WEBHOOK_SIGNATURE', 'Invalid stripe-signature header format.');
    }

    const signedPayload = `${sigMap.t}.${rawBuffer.toString('utf8')}`;
    const expectedSig = crypto.createHmac('sha256', this.webhookSecret).update(signedPayload).digest('hex');
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    const actualBuf = Buffer.from(sigMap.v1, 'utf8');

    if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
      throw new AppError(400, 'INVALID_WEBHOOK_SIGNATURE', 'Stripe signature mismatch.');
    }

    return true;
  }

  handleWebhookEvent(rawBodyOrObject, signatureHeader = null) {
    let event = null;
    let rawBuffer = null;

    if (Buffer.isBuffer(rawBodyOrObject)) {
      rawBuffer = rawBodyOrObject;
      this.verifySignature(rawBuffer, signatureHeader);
      try {
        event = JSON.parse(rawBuffer.toString('utf8'));
      } catch (_) {
        throw new AppError(400, 'INVALID_WEBHOOK_PAYLOAD', 'Invalid JSON in webhook body.');
      }
    } else if (typeof rawBodyOrObject === 'string') {
      rawBuffer = Buffer.from(rawBodyOrObject, 'utf8');
      this.verifySignature(rawBuffer, signatureHeader);
      try {
        event = JSON.parse(rawBodyOrObject);
      } catch (_) {
        throw new AppError(400, 'INVALID_WEBHOOK_PAYLOAD', 'Invalid JSON in webhook body.');
      }
    } else if (rawBodyOrObject && typeof rawBodyOrObject === 'object') {
      if (this.webhookSecret && signatureHeader) {
        rawBuffer = Buffer.from(JSON.stringify(rawBodyOrObject), 'utf8');
        this.verifySignature(rawBuffer, signatureHeader);
      }
      event = rawBodyOrObject;
    }

    if (!event || !event.type) {
      throw new AppError(400, 'INVALID_WEBHOOK_PAYLOAD', 'Invalid webhook payload.');
    }

    const { type, data } = event;
    const object = (data && data.object) || {};
    const eventId = event.id || (object.id ? `evt_${object.id}` : null);

    // Idempotency check: prevent duplicate activations
    if (eventId) {
      try {
        const { getDb } = require('../../db/database');
        const db = getDb();
        const existing = db.prepare('SELECT id FROM processed_webhook_events WHERE id = ?').get(eventId);
        if (existing) {
          return {
            status: 'ignored',
            reason: 'already_processed',
            eventId,
            type,
          };
        }
      } catch (_) {}
    }

    let result = { status: 'ignored', type, eventId };

    if (type === 'checkout.session.completed') {
      const tier = (object.metadata && object.metadata.tier) || 'standard';
      const referralCode = object.metadata && object.metadata.referral_code;
      const customerEmail = object.customer_email || object.client_reference_id;

      audit.record({
        action: 'payment.subscription_activated',
        actor: { id: customerEmail || 'stripe', name: 'Stripe Webhook' },
        detail: {
          sessionId: object.id,
          eventId,
          tier,
          customerEmail,
          referralCode: referralCode || null,
          currency: DEFAULT_CURRENCY,
          amountTotal: object.amount_total,
        },
      });

      result = { status: 'processed', action: 'activated', tier, customerEmail, eventId };
    } else if (type === 'customer.subscription.deleted') {
      audit.record({
        action: 'payment.subscription_cancelled',
        actor: { id: 'stripe', name: 'Stripe Webhook' },
        detail: { subscriptionId: object.id, eventId },
      });
      result = { status: 'processed', action: 'cancelled', eventId };
    }

    // Save event ID to prevent duplicate processing
    if (eventId) {
      try {
        const { getDb } = require('../../db/database');
        const db = getDb();
        db.prepare(`
          INSERT OR IGNORE INTO processed_webhook_events (id, event_type, provider, payload_summary, processed_at)
          VALUES (?, ?, 'stripe', ?, ?)
        `).run(
          eventId,
          type,
          JSON.stringify({ tier: object.metadata?.tier || null, customerEmail: object.customer_email || object.client_reference_id || null }),
          nowIso()
        );
      } catch (_) {}
    }

    return result;
  }
}

module.exports = new StripeService();
