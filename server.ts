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

interface SendPaymentLinkBody {
  phone_number: string;
  amount: string;
}

app.post("/send-payment-link", async (req: Request<{}, {}, SendPaymentLinkBody>, res: Response) => {
  console.log("req.body:", req.body);
  const { phone_number, amount } = req.body;

  if (!phone_number || !amount) {
    res.status(400).json({ success: false, error: "phone_number and amount are required" });
    return;
  }

  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) {
    res.status(400).json({ success: false, error: "amount must be a positive number" });
    return;
  }

  try {
    // Step 1: Create Razorpay payment link
    const paymentLink = await (razorpay.paymentLink.create as (p: unknown) => Promise<{ short_url: string }>)({
      amount: Math.round(amountNum * 100), // INR to paise
      currency: "INR",
      description: "Payment request from agent",
      notify: { sms: false, email: false },
    });

    const shortUrl = paymentLink.short_url;

    // Step 2: Send SMS via Twilio
    const message = await twilioClient.messages.create({
      body: `Your payment link for INR ${amountNum}: ${shortUrl}`,
      from: process.env.TWILIO_FROM_NUMBER!,
      to: phone_number,
    });

    res.json({ success: true, payment_link: shortUrl, message_sid: message.sid });
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    console.error("Error:", message);
    res.status(500).json({ success: false, error: message });
  }
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
