"use strict";

const crypto = require("crypto");
const { UniqueConstraintError } = require("sequelize");
const db = require("../../models");
const triggerWhatsappNotification = require("./triggerWhatsappNotificationStub");
const {
  buildWebhookNormalized,
} = require("../../utils/tallyPayloadNormalizer");

const FORM_SLUGS = {
  PENDAFTARAN_ANGGOTA: "pendaftaran_anggota",
  PENGAJUAN_BANTUAN: "pengajuan_bantuan",
  ORANG_TUA_ASUH: "orang_tua_asuh",
  DONASI: "donasi",
};

function getNestedValue(obj, path) {
  return (
    path
      .split(".")
      .reduce((cur, part) => (cur == null ? null : cur[part]), obj) ?? null
  );
}

function pickFirst(obj, paths) {
  for (const p of paths) {
    const v = getNestedValue(obj, p);
    if (v !== null && v !== undefined && String(v).trim() !== "")
      return String(v).trim();
  }
  return null;
}

function parseDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/.test(s))
    return new Date(s.replace(" ", "T") + "Z");
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function sha256Hex(inputBuffer) {
  return crypto.createHash("sha256").update(inputBuffer).digest("hex");
}

function extractSignatureCandidates(headerValue) {
  if (!headerValue) return [];
  const raw = String(headerValue).trim();
  const candidates = [raw];
  raw.split(",").forEach((segment) => {
    const [key, value] = segment.split("=");
    if (!value) return;
    const k = String(key || "")
      .trim()
      .toLowerCase();
    if (k === "v1" || k === "sha256") candidates.push(String(value).trim());
  });
  return [...new Set(candidates)];
}

function safeEqual(a, b) {
  const aBuf = Buffer.from(String(a));
  const bBuf = Buffer.from(String(b));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function isSignatureValid({ rawBody, signatureHeaderValue, secret }) {
  if (!secret) return false;
  const expectedBase64 = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64");
  const expectedHex = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  return extractSignatureCandidates(signatureHeaderValue).some((candidate) => {
    const n = String(candidate)
      .replace(/^sha256=/i, "")
      .trim();
    return safeEqual(n, expectedBase64) || safeEqual(n, expectedHex);
  });
}

function parseWebhookBody(rawBodyBuffer, formSlug) {
  let rawPayload;
  try {
    rawPayload = JSON.parse(rawBodyBuffer.toString("utf8"));
  } catch {
    const err = new Error("Invalid JSON payload");
    err.status = 400;
    throw err;
  }

  const { payload, extractedWhatsapp } = buildWebhookNormalized(
    rawPayload,
    formSlug,
  );
  const submittedAt = parseDate(payload.submittedAt) || new Date();

  const payloadEventId = pickFirst(rawPayload, [
    "eventId",
    "data.responseId",
    "data.submissionId",
  ]);

  return {
    rawPayload,
    payload,
    submissionId: payload.submissionId,
    respondentId: payload.respondentId,
    formId: payload.formId,
    submittedAt,
    extractedWhatsapp,
    payloadEventId,
  };
}

async function processTallyWebhook({ formSlug, headers, rawBody }) {
  const secret = process.env.TALLY_WEBHOOK_SECRET || "";
  const signatureHeaderName = (
    process.env.TALLY_WEBHOOK_SIGNATURE_HEADER || "tally-signature"
  ).toLowerCase();
  const signatureRequired =
    process.env.TALLY_WEBHOOK_SIGNATURE_REQUIRED === "true" ||
    process.env.NODE_ENV === "production";

  const signatureHeaderValue = headers[signatureHeaderName] || null;

  if (
    signatureRequired &&
    !isSignatureValid({ rawBody, signatureHeaderValue, secret })
  ) {
    const err = new Error("Invalid webhook signature");
    err.status = 401;
    throw err;
  }

  const normalized = parseWebhookBody(rawBody, formSlug);
  const fallbackHash = sha256Hex(rawBody).slice(0, 40);
  const tallySubmissionId = normalized.submissionId || fallbackHash;

  const eventKeySource =
    headers["x-tally-event-id"] ||
    headers["x-webhook-id"] ||
    normalized.payloadEventId ||
    `${formSlug}:${tallySubmissionId}:${normalized.submittedAt.toISOString()}`;
  const eventKey = `${formSlug}:${eventKeySource}`;

  let webhookEvent;
  try {
    webhookEvent = await db.TallyWebhookEvents.create({
      eventKey,
      formSlug,
      signatureHeader: signatureHeaderValue,
      headersJson: headers,
      payloadJson: normalized.payload,
      processStatus: "RECEIVED",
      receivedAt: new Date(),
    });
  } catch (error) {
    if (error instanceof UniqueConstraintError) return { duplicated: true };
    throw error;
  }

  try {
    await db.sequelize.transaction(async (transaction) => {
      await db.TallySubmissions.upsert(
        {
          tallySubmissionId,
          respondentId: normalized.respondentId,
          formId: normalized.formId,
          formSlug,
          submittedAt: normalized.submittedAt,
          payload: normalized.payload,
          extractedWhatsapp: normalized.extractedWhatsapp,
          sourceType: "webhook",
        },
        { transaction },
      );

      const submission = await db.TallySubmissions.findOne({
        where: { formSlug, tallySubmissionId },
        transaction,
      });

      if (formSlug === FORM_SLUGS.PENGAJUAN_BANTUAN && submission) {
        await db.PengajuanBantuanStatuses.findOrCreate({
          where: { submissionId: submission.id },
          defaults: {
            submissionId: submission.id,
            currentStatus: "VERIFIKASI_BERKAS",
            catatan: null,
            updatedBy: "SYSTEM_WEBHOOK",
          },
          transaction,
        });

        await db.PengajuanBantuanStatusHistories.findOrCreate({
          where: {
            submissionId: submission.id,
            oldStatus: null,
            newStatus: "VERIFIKASI_BERKAS",
            oldCatatan: null,
            newCatatan: null,
            changedBy: "SYSTEM_WEBHOOK",
          },
          defaults: {
            submissionId: submission.id,
            oldStatus: null,
            newStatus: "VERIFIKASI_BERKAS",
            oldCatatan: null,
            newCatatan: null,
            changedBy: "SYSTEM_WEBHOOK",
            changedAt: new Date(),
          },
          transaction,
        });
      }

      await webhookEvent.update(
        {
          processStatus: "PROCESSED",
          processedAt: new Date(),
          errorMessage: null,
        },
        { transaction },
      );
    });

    const processedSubmission = await db.TallySubmissions.findOne({
      where: { formSlug, tallySubmissionId },
    });

    await triggerWhatsappNotification({
      formSlug,
      submission: processedSubmission,
    });

    return { duplicated: false, tallySubmissionId };
  } catch (error) {
    await webhookEvent.update({
      processStatus: "FAILED",
      errorMessage: error.message,
      processedAt: new Date(),
    });
    throw error;
  }
}

module.exports = { FORM_SLUGS, processTallyWebhook };
