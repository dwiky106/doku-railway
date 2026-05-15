const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const axios = require("axios");
const admin = require("firebase-admin");

require("dotenv").config();

const app = express();

/*
|--------------------------------------------------------------------------
| MIDDLEWARE
|--------------------------------------------------------------------------
*/

app.use(cors());

app.use(express.json());

app.use(express.urlencoded({
  extended: true,
}));

app.use(express.static("public"));

/*
|--------------------------------------------------------------------------
| FIREBASE
|--------------------------------------------------------------------------
*/

console.log("=== FIREBASE INIT ===");

const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT
);

admin.initializeApp({
  credential:
    admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

console.log("FIREBASE CONNECTED");

/*
|--------------------------------------------------------------------------
| DOKU CONFIG
|--------------------------------------------------------------------------
*/

const CLIENT_ID =
  process.env.DOKU_CLIENT_ID;

const SECRET_KEY =
  process.env.DOKU_SECRET_KEY;

const DOKU_URL =
  "https://api.doku.com/checkout/v1/payment";

/*
|--------------------------------------------------------------------------
| ROOT
|--------------------------------------------------------------------------
*/

app.get("/", (req, res) => {
  res.send(
    "DOKU Railway Backend Running"
  );
});

/*
|--------------------------------------------------------------------------
| CREATE PAYMENT
|--------------------------------------------------------------------------
*/

app.post("/createPayment", async (req, res) => {

  try {

    console.log("");
    console.log("==================================");
    console.log("CREATE PAYMENT");
    console.log("==================================");

    console.log(req.body);

    const {
      amount,
      invoice_number,
      customer_name,
      customer_email,
    } = req.body;

    /*
    |--------------------------------------------------------------------------
    | VALIDASI
    |--------------------------------------------------------------------------
    */

    if (
      !amount ||
      !invoice_number ||
      !customer_name ||
      !customer_email
    ) {

      return res.status(400).json({
        success: false,
        message:
          "Data pembayaran tidak lengkap",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | REQUEST BODY
    |--------------------------------------------------------------------------
    */

    const requestBody = {

      order: {

        amount: Number(amount),

        invoice_number:
          invoice_number,

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

        callback_url_result:
          "https://doku-railway-production.up.railway.app",

        callback_url_cancel:
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

    /*
    |--------------------------------------------------------------------------
    | REQUEST ID & TIMESTAMP
    |--------------------------------------------------------------------------
    */

    const requestId =
      crypto.randomUUID();

    const timestamp =
      new Date()
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z");

    /*
    |--------------------------------------------------------------------------
    | DIGEST
    |--------------------------------------------------------------------------
    */

    const digest =
      crypto
      .createHash("sha256")
      .update(bodyString)
      .digest("base64");

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

    /*
    |--------------------------------------------------------------------------
    | SIGNATURE
    |--------------------------------------------------------------------------
    */

    const signature =
      crypto
      .createHmac(
        "sha256",
        SECRET_KEY
      )
      .update(componentSignature)
      .digest("base64");

    /*
    |--------------------------------------------------------------------------
    | HEADERS
    |--------------------------------------------------------------------------
    */

    const headers = {

      "Content-Type":
        "application/json",

      "Client-Id":
        CLIENT_ID,

      "Request-Id":
        requestId,

      "Request-Timestamp":
        timestamp,

      Digest:
        digest,

      Signature:
        `HMACSHA256=${signature}`,
    };

    /*
    |--------------------------------------------------------------------------
    | LOG REQUEST
    |--------------------------------------------------------------------------
    */

    console.log("");
    console.log("=== REQUEST BODY ===");
    console.log(
      JSON.stringify(
        requestBody,
        null,
        2
      )
    );

    console.log("");
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

    console.log("");
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
    | PAYMENT URL
    |--------------------------------------------------------------------------
    */

    const paymentUrl =
      response.data.response
      .payment.url;

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

        amount:
          Number(amount),

        customer_name,

        customer_email,

        payment_url:
          paymentUrl,

        status:
          "PENDING",

        created_at:
          admin.firestore
          .FieldValue
          .serverTimestamp(),
      });

    console.log("");
    console.log("FIRESTORE SAVED");

    /*
    |--------------------------------------------------------------------------
    | RESPONSE
    |--------------------------------------------------------------------------
    */

    return res.status(200).json({

      success: true,

      payment_url:
        paymentUrl,
    });

  } catch (error) {

    console.log("");
    console.log("==================================");
    console.log("CREATE PAYMENT ERROR");
    console.log("==================================");

    if (error.response) {

      console.log(
        JSON.stringify(
          error.response.data,
          null,
          2
        )
      );

      return res
      .status(
        error.response.status
      )
      .json({

        success: false,

        error:
          error.response.data,
      });
    }

    console.log(error);

    return res.status(500).json({

      success: false,

      message:
        error.message,
    });
  }
});

/*
|--------------------------------------------------------------------------
| DOKU WEBHOOK
|--------------------------------------------------------------------------
*/

app.post("/notification", async (req, res) => {

  try {

    console.log("");
    console.log("==================================");
    console.log("WEBHOOK MASUK");
    console.log("==================================");

    /*
    |--------------------------------------------------------------------------
    | LOG HEADERS
    |--------------------------------------------------------------------------
    */

    console.log("");
    console.log("=== HEADERS ===");

    console.log(
      JSON.stringify(
        req.headers,
        null,
        2
      )
    );

    /*
    |--------------------------------------------------------------------------
    | LOG BODY
    |--------------------------------------------------------------------------
    */

    console.log("");
    console.log("=== BODY ===");

    console.log(
      JSON.stringify(
        req.body,
        null,
        2
      )
    );

    const body = req.body;

    /*
    |--------------------------------------------------------------------------
    | AMBIL DATA
    |--------------------------------------------------------------------------
    */

    const invoiceNumber =

      body?.order?.invoice_number ||

      body?.invoice_number ||

      body?.virtual_account_info
      ?.invoice_number ||

      null;

    const transactionStatus =

      body?.transaction?.status ||

      body?.transaction_status ||

      body?.status ||

      "SUCCESS";

    const amount =

      body?.order?.amount ||

      body?.amount ||

      0;

    /*
    |--------------------------------------------------------------------------
    | VALIDASI
    |--------------------------------------------------------------------------
    */

    if (!invoiceNumber) {

      console.log(
        "INVOICE NUMBER TIDAK ADA"
      );

      return res.status(400).json({

        success: false,

        message:
          "Invoice number kosong",
      });
    }

    console.log("");
    console.log(
      "INVOICE:",
      invoiceNumber
    );

    console.log(
      "STATUS:",
      transactionStatus
    );

    /*
    |--------------------------------------------------------------------------
    | UPDATE FIRESTORE
    |--------------------------------------------------------------------------
    */

    await db
      .collection("transactions")
      .doc(invoiceNumber)
      .update({

        status:
          transactionStatus,

        paid_amount:
          Number(amount),

        webhook_response:
          body,

        updated_at:
          admin.firestore
          .FieldValue
          .serverTimestamp(),
      });

    console.log("");
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

    console.log("");
    console.log("==================================");
    console.log("WEBHOOK ERROR");
    console.log("==================================");

    console.log(error);

    return res.status(500).json({

      success: false,

      message:
        error.message,
    });
  }
});

/*
|--------------------------------------------------------------------------
| TEST WEBHOOK
|--------------------------------------------------------------------------
*/

app.get("/notification", (req, res) => {

  res.send(
    "WEBHOOK ACTIVE"
  );
});

/*
|--------------------------------------------------------------------------
| TEST POST WEBHOOK
|--------------------------------------------------------------------------
*/

app.post("/test-webhook", (req, res) => {

  console.log("");
  console.log("==================================");
  console.log("TEST WEBHOOK HIT");
  console.log("==================================");

  console.log(req.body);

  return res.json({

    success: true,

    body: req.body,
  });
});

/*
|--------------------------------------------------------------------------
| PORT
|--------------------------------------------------------------------------
*/

const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log("");
  console.log("==================================");

  console.log(
    `SERVER RUNNING ON PORT ${PORT}`
  );

  console.log("==================================");
});
