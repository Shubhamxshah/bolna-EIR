import "dotenv/config";
import express, { Request, Response } from "express";
import Razorpay from "razorpay";
import twilio from "twilio";

const app = express();
app.use(express.json());

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);

async function notifyMake(data: Record<string, unknown>) {
  const url = process.env.MAKE_WEBHOOK_URL;
  if (!url) return;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

interface SendPaymentLinkBody {
  phone_number: string;
  amount: string;
  orders: string;
}

app.post("/send-payment-link", async (req: Request<{}, {}, SendPaymentLinkBody>, res: Response) => {
  const { phone_number, amount, orders } = req.body;

  if (!phone_number || !amount || !orders) {
    res.status(400).json({ success: false, error: "phone_number, amount, and orders are required" });
    return;
  }

  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) {
    res.status(400).json({ success: false, error: "amount must be a positive number" });
    return;
  }

  try {
    // Step 1: Create Razorpay payment link
    const paymentLink = await (razorpay.paymentLink.create as (p: unknown) => Promise<{ id: string; short_url: string }>)({
      amount: Math.round(amountNum * 100), // INR to paise
      currency: "INR",
      description: orders,
      notify: { sms: false, email: false },
    });

    const { id: paymentLinkId, short_url: shortUrl } = paymentLink;

    // Step 2: Send SMS via Twilio
    const message = await twilioClient.messages.create({
      body: `Your payment link for INR ${amountNum} (${orders}): ${shortUrl}`,
      from: process.env.TWILIO_FROM_NUMBER!,
      to: phone_number,
    });

    // Step 3: Notify Make.com — add pending row to Google Sheet
    await notifyMake({
      payment_link_id: paymentLinkId,
      payment_link_url: shortUrl,
      phone_number,
      orders,
      amount: amountNum,
      status: "pending",
    });

    res.json({ success: true, payment_link: shortUrl, message_sid: message.sid });
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    console.error("Error:", message);
    res.status(500).json({ success: false, error: message });
  }
});

// Bolna polls this to check if payment is done
app.get("/payment-status", async (req: Request, res: Response) => {
  const { payment_link_id } = req.query;

  if (!payment_link_id || typeof payment_link_id !== "string") {
    res.status(400).json({ success: false, error: "payment_link_id is required" });
    return;
  }

  try {
    const link = await (razorpay.paymentLink.fetch as (id: string) => Promise<{ status: string; id: string }>)(payment_link_id);
    res.json({
      success: true,
      payment_link_id: link.id,
      status: link.status,
      paid: link.status === "paid",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    res.status(500).json({ success: false, error: message });
  }
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
