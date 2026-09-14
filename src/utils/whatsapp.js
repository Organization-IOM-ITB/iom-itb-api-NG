"use strict";

const sendWhatsApp = async (to, message, idempotencyKey, clientReference) => {
  const apiKey = String(process.env.WA_API_KEY || '').trim();
  const baseUrl = String(process.env.WA_API_URL || "https://ppl.adharidwan.com").trim().replace(/\/+$/, '');

  if (!apiKey) {
    return {
      ok: false,
      skipped: true,
      reason: "MISSING_WA_API_KEY",
    };
  }

  if (!to || !message || !idempotencyKey) {
    return {
      ok: false,
      skipped: true,
      reason: "INVALID_SEND_PARAMS",
    };
  }

  // Caller is expected to pass an already-normalized E.164 number.
  const body = { to, message };
  if (clientReference) body.client_reference = clientReference;

  console.log(`[WhatsApp] Sending to ${to}, key=${idempotencyKey}`);
  try {
    const res = await fetch(`${baseUrl}/api/v1/messages/whatsapp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Idempotency-Key": idempotencyKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();

    if (res.ok) {
      console.log(`[WhatsApp] Response ${res.status}:`, text);
    } else {
      console.warn(`[WhatsApp] Response ${res.status}:`, text);
    }

    return {
      ok: res.ok,
      skipped: false,
      status: res.status,
      responseBody: text,
      reason: res.ok ? null : "NON_2XX_RESPONSE",
    };
  } catch (err) {
    console.error("[WhatsApp] Failed to send notification:", err.message);
    return {
      ok: false,
      skipped: false,
      reason: "REQUEST_FAILED",
      error: err.message,
    };
  }
};

module.exports = sendWhatsApp;
