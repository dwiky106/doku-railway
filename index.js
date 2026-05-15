const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const axios = require("axios");
const admin = require("firebase-admin");

require("dotenv").config();

const app = express();

app.use(cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static("public"));

/*
|--------------------------------------------------------------------------
| FIREBASE
|--------------------------------------------------------------------------
*/

console.log(process.env.FIREBASE_SERVICE_ACCOUNT);

const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

/*
|--------------------------------------------------------------------------
| DOKU CONFIG
|--------------------------------------------------------------------------
*/

const CLIENT_ID = process.env.DOKU_CLIENT_ID;
const SECRET_KEY = process.env.DOKU_SECRET_KEY;

const DOKU_URL =
  "https://api.doku.com/checkout/v1/payment";

/*
|--------------------------------------------------------------------------
| TEST ROUTE
|--------------------------------------------------------------------------
*/

app.get("/", (req, res) => {
  res.send("DOKU Railway Backend Running");
});

/*
|--------------------------------------------------------------------------
| CREATE PAYMENT
|--------------------------------------------------------------------------
*/

app.post("/createPayment", async (req, res) => {
  try {

    console.log("=== CREATE PAYMENT REQUEST ===");
    console.log(req.body);

    const {
      amount,
      invoice_number,
      customer_name,
      customer_email,
    } = req.body;

    /*
    |--------------------------------------------------------------------------
    | REQUEST BODY
    |--------------------------------------------------------------------------
    */

    const requestBody = {
  order: {
    amount: Number(amount),

    invoice_number: invoice_number,

    currency: "IDR",
  },

  payment: {
    payment_due_date: 60,
  },

  customer: {
    name: customer_name,
    email: customer_email,
  },

  additional_info: {
    callback_url:
      "https://doku-railway-production.up.railway.app/notification",

    callback_url_cancel:
      "https://doku-railway-production.up.railway.app",

    callback_url_result:
      "https://doku-railway-production.up.railway.app",

    auto_redirect: false,
  },
};

    /*
    |--------------------------------------------------------------------------
    | BODY STRING
    |--------------------------------------------------------------------------
    */

    const bodyString =
      JSON.stringify(requestBody);

    console.log("=== BODY STRING ===");
    console.log(bodyString);

    /*
    |--------------------------------------------------------------------------
    | HEADERS
    |--------------------------------------------------------------------------
    */

    const requestId =
      crypto.randomUUID();

    const timestamp = new Date()
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z");

    /*
    |--------------------------------------------------------------------------
    | DIGEST
    |--------------------------------------------------------------------------
    */

    const digest = crypto
      .createHash("sha256")
      .update(bodyString)
      .digest("base64");

    console.log("=== DIGEST ===");
    console.log(digest);

    /*
    |--------------------------------------------------------------------------
    | COMPONENT SIGNATURE
    |--------------------------------------------------------------------------
    */

    const componentSignature =
      `Client-Id:${CLIENT_ID}\n` +
      `Request-Id:${requestId}\n` +
      `Request-Timestamp:${timestamp}\n` +
      `Request-Target:/checkout/v1/payment\n` +
      `Digest:${digest}`;

    console.log(
      "=== COMPONENT SIGNATURE ==="
    );

    console.log(componentSignature);

    /*
    |--------------------------------------------------------------------------
    | SIGNATURE
    |--------------------------------------------------------------------------
    */

    const signature = crypto
      .createHmac(
        "sha256",
        SECRET_KEY
      )
      .update(componentSignature)
      .digest("base64");

    console.log("=== SIGNATURE ===");
    console.log(signature);

    /*
    |--------------------------------------------------------------------------
    | HEADERS
    |--------------------------------------------------------------------------
    */

    const headers = {
      "Content-Type":
        "application/json",

      "Client-Id": CLIENT_ID,

      "Request-Id": requestId,

      "Request-Timestamp":
        timestamp,

      Digest: digest,

      Signature:
        `HMACSHA256=${signature}`,
    };

    console.log("=== HEADERS ===");
    console.log(headers);

    /*
    |--------------------------------------------------------------------------
    | SEND TO DOKU
    |--------------------------------------------------------------------------
    */

    const response =
      await axios.post(
        DOKU_URL,
        requestBody,
        { headers }
      );

    console.log("==================================");
    console.log("DOKU SUCCESS");
    console.log("==================================");

    console.log(
      JSON.stringify(
        response.data,
        null,
        2
      )
    );

    /*
    |--------------------------------------------------------------------------
    | SAVE TO FIRESTORE
    |--------------------------------------------------------------------------
    */

    await db
      .collection("transactions")
      .doc(invoice_number)
      .set({
        invoice_number,

        amount,

        customer_name,

        customer_email,

        payment_url:
          response.data.response
            .payment.url,

        status: "PENDING",

        created_at:
          admin.firestore.FieldValue.serverTimestamp(),
      });

    /*
    |--------------------------------------------------------------------------
    | RESPONSE
    |--------------------------------------------------------------------------
    */

    return res.status(200).json({
      success: true,

      payment_url:
        response.data.response
          .payment.url,

      data: response.data,
    });

  } catch (error) {

    console.log("=== ERROR ===");

    if (error.response) {

      console.log(error.response.data);

      return res.status(
        error.response.status
      ).json({
        success: false,
        error: error.response.data,
      });
    }

    console.log(error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});


/*
|--------------------------------------------------------------------------
| DOKU WEBHOOK
|--------------------------------------------------------------------------
*/

app.post("/notification", async (req, res) => {

  console.log("=== HEADERS ===");
  console.log(req.headers);

  console.log("=== BODY ===");
  console.log(req.body);

  try {

    console.log("==================================");
    console.log("DOKU WEBHOOK");
    console.log("==================================");

    console.log(JSON.stringify(req.body, null, 2));

    const body = req.body;

    /*
    |--------------------------------------------------------------------------
    | AMBIL DATA
    |--------------------------------------------------------------------------
    */

    const invoiceNumber =
      body?.order?.invoice_number;

    const transactionStatus =
      body?.transaction?.status;

    const amount =
      body?.order?.amount;

    /*
    |--------------------------------------------------------------------------
    | VALIDASI
    |--------------------------------------------------------------------------
    */

    if (!invoiceNumber) {
      return res.status(400).json({
        success: false,
        message: "Invoice number kosong",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | UPDATE FIRESTORE
    |--------------------------------------------------------------------------
    */

    await db
      .collection("transactions")
      .doc(invoiceNumber)
      .update({
        transaction_status:
          transactionStatus || "UNKNOWN",

        paid_amount: amount || 0,

        webhook_response: body,

        updated_at:
          admin.firestore.FieldValue.serverTimestamp(),
      });

    console.log("==================================");
    console.log("FIRESTORE UPDATED");
    console.log("==================================");

    /*
    |--------------------------------------------------------------------------
    | SUCCESS RESPONSE
    |--------------------------------------------------------------------------
    */

    return res.status(200).json({
      success: true,
    });

  } catch (error) {

    console.log("==================================");
    console.log("WEBHOOK ERROR");
    console.log("==================================");

    console.log(error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});


/*
|--------------------------------------------------------------------------
| TEST WEBHOOK
|--------------------------------------------------------------------------
*/

app.get("/notification", (req, res) => {
  res.send("WEBHOOK ACTIVE");
});



/*
|--------------------------------------------------------------------------
| PORT
|--------------------------------------------------------------------------
*/

const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(
    `Server running on port ${PORT}`
  );
});

