// server.js
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

/**
 * ENV variables (create a .env file)
 * CONSUMER_KEY=your_consumer_key
 * CONSUMER_SECRET=your_consumer_secret
 * SHORTCODE=your_paybill_or_till_short_code (e.g. Till or Paybill)
 * PASSKEY=your_lipa_na_mpesa_passkey (needed for STK Push)
 * BASE_URL=https://sandbox.safaricom.co.ke (or https://api.safaricom.co.ke for live)
 */
const {
  CONSUMER_KEY, CONSUMER_SECRET, SHORTCODE, PASSKEY, BASE_URL
} = process.env;

if (!CONSUMER_KEY || !CONSUMER_SECRET || !SHORTCODE || !PASSKEY) {
  console.warn('Missing env vars - please set CONSUMER_KEY, CONSUMER_SECRET, SHORTCODE, PASSKEY');
}

// Helper: get OAuth token (client_credentials)
async function getOAuthToken(){
  const url = `${BASE_URL || 'https://sandbox.safaricom.co.ke'}/oauth/v1/generate?grant_type=client_credentials`;
  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
  const res = await axios.get(url, { headers: { Authorization: `Basic ${auth}` } });
  return res.data.access_token;
}

/**
 * STK Push (Lipa Na M-PESA)
 * Front-end will POST { amount, phone, accountReference, description }
 */
app.post('/stkpush', async (req, res) => {
  try {
    const { amount, phone, accountReference = 'BOOK', description = 'Hotel booking' } = req.body;
    const token = await getOAuthToken();

    // Daraja expects timestamp + password (Base64(SHORTCODE + PASSKEY + Timestamp))
    const timestamp = new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14); // YYYYMMDDHHMMSS
    const password = Buffer.from(`${SHORTCODE}${PASSKEY}${timestamp}`).toString('base64');

    const payload = {
      BusinessShortCode: SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline', // or CustomerBuyGoodsOnline for Till flows
      Amount: amount,
      PartyA: phone,            // customer's MSISDN (2547XXXXXXXX)
      PartyB: SHORTCODE,        // till/paybill number
      PhoneNumber: phone,       // msisdn again
      CallBackURL: process.env.CALLBACK_URL || 'https://yourdomain.com/callback',
      AccountReference: accountReference,
      TransactionDesc: description
    };

    const url = `${BASE_URL || 'https://sandbox.safaricom.co.ke'}/mpesa/stkpush/v1/processrequest`;
    const r = await axios.post(url, payload, { headers: { Authorization: `Bearer ${token}` }});
    // success response contains CheckoutRequestID & ResponseCode etc.
    res.json(r.data);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

/**
 * Register C2B URLs (only necessary in sandbox / when registering webhook)
 * POST body { confirmationURL, validationURL }
 */
app.post('/c2b/register', async (req, res) => {
  try {
    const { confirmationURL, validationURL } = req.body;
    const token = await getOAuthToken();
    const url = `${BASE_URL || 'https://sandbox.safaricom.co.ke'}/mpesa/c2b/v1/registerurl`;
    const payload = {
      ShortCode: SHORTCODE,
      ResponseType: "Completed",
      ConfirmationURL: confirmationURL,
      ValidationURL: validationURL
    };
    const r = await axios.post(url, payload, { headers: { Authorization: `Bearer ${token}` }});
    res.json(r.data);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

/**
 * Webhook callback endpoint to receive payment notifications
 * Safaricom will POST payment notifications here (C2B or STK callback)
 */
app.post('/callback', async (req, res) => {
  console.log('Callback received:', JSON.stringify(req.body).slice(0,1000));
  // TODO: validate payload signature if available & process transaction (save to DB)
  // respond with HTTP 200 quickly
  res.status(200).send({ ResultCode: 0, ResultDesc: 'Accepted' });
});

/* Simple route for manual token retrieval (debug) */
app.get('/token', async (req, res) => {
  try {
    const token = await getOAuthToken();
    res.json({ access_token: token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log(`Server listening on ${PORT}`));
