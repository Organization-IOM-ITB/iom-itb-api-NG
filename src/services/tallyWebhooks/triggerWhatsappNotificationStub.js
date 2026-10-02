"use strict";

const sendWhatsApp = require("../../utils/whatsapp");
const { normalizeWhatsAppRecipient } = require("../../utils/whatsappPhone");

const DEFAULT_TEMPLATE_BY_FORM = {
  pendaftaran_anggota:
    "Assalamu'alaikum {{name}}, terima kasih. Form pendaftaran anggota Anda sudah kami terima. Ref: {{submission_id}}.",
  pengajuan_bantuan:
    "Assalamu'alaikum {{name}}, pengajuan bantuan Anda sudah kami terima dan akan diproses. Ref: {{submission_id}}.",
  orang_tua_asuh:
    "Assalamu'alaikum {{name}}, terima kasih. Form Orang Tua Asuh Anda sudah kami terima. Ref: {{submission_id}}.",
  // Sengaja tidak menyebut dana "sudah diterima": transfer belum diverifikasi.
  donasi:
    "Assalamu'alaikum {{name}}, terima kasih. Konfirmasi donasi Anda sudah kami terima dan akan dicek oleh Bendahara IOM-ITB. Ref: {{submission_id}}.",
};

function normalizeLabelForMatching(label) {
  return String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickDisplayName(answersByLabel) {
  if (!answersByLabel || typeof answersByLabel !== "object") return null;

  const entries = Object.entries(answersByLabel);
  const preferredPatterns = [
    /nama orang tua/,
    /nama wali/,
    /nama mahasiswa/,
    /^nama$/,
  ];

  for (const pattern of preferredPatterns) {
    const found = entries.find(([label, value]) => {
      const normalizedLabel = normalizeLabelForMatching(label);
      return (
        pattern.test(normalizedLabel) &&
        value != null &&
        String(value).trim() !== ""
      );
    });

    if (found) return String(found[1]).trim();
  }

  return null;
}

function renderTemplate(template, values) {
  return String(template || "").replace(
    /{{\s*([a-zA-Z0-9_]+)\s*}}/g,
    (_, key) => {
      const value = values[key];
      return value == null ? "" : String(value);
    },
  );
}

function getTemplateByForm(formSlug) {
  const perFormEnv = {
    pendaftaran_anggota:
      process.env.TALLY_WHATSAPP_TEMPLATE_PENDAFTARAN_ANGGOTA,
    pengajuan_bantuan: process.env.TALLY_WHATSAPP_TEMPLATE_PENGAJUAN_BANTUAN,
    orang_tua_asuh: process.env.TALLY_WHATSAPP_TEMPLATE_ORANG_TUA_ASUH,
    donasi: process.env.TALLY_WHATSAPP_TEMPLATE_DONASI,
  };

  return (
    perFormEnv[formSlug] ||
    process.env.TALLY_WHATSAPP_TEMPLATE_DEFAULT ||
    DEFAULT_TEMPLATE_BY_FORM[formSlug] ||
    "Halo {{name}}, terima kasih. Form Anda sudah kami terima. Ref: {{submission_id}}."
  );
}

function sanitizeKeySegment(input, maxLen = 80) {
  const value = String(input || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen);
  return value || "unknown";
}

function buildIdempotencyKey(formSlug, submission) {
  const slugSegment = sanitizeKeySegment(formSlug || "unknown", 40);
  const submissionSegment = sanitizeKeySegment(
    submission?.tallySubmissionId ||
      submission?.payload?.submissionId ||
      submission?.id ||
      "unknown",
    120,
  );
  return `tally-${slugSegment}-submission-${submissionSegment}`;
}

function buildClientReference(formSlug, submission) {
  const raw = `tally:${formSlug || "unknown"}:${submission?.tallySubmissionId || submission?.id || "unknown"}`;
  return raw.slice(0, 255);
}

const triggerWhatsappNotification = async ({ formSlug, submission, idempotencySuffix = null }) => {
  const notificationsEnabled =
    String(
      process.env.TALLY_WHATSAPP_NOTIFICATIONS_ENABLED || "true",
    ).toLowerCase() !== "false";

  if (!notificationsEnabled) {
    console.info("WHATSAPP_NOTIFICATION_SKIPPED", {
      reason: "DISABLED_BY_ENV",
      formSlug,
      submissionId: submission?.id,
      tallySubmissionId: submission?.tallySubmissionId,
    });
    return {
      ok: false,
      skipped: true,
      reason: "DISABLED_BY_ENV",
    };
  }

  const phoneResult = normalizeWhatsAppRecipient(
    submission?.extractedWhatsapp,
    {
      defaultCountryCode: process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || "62",
    },
  );

  if (!phoneResult.isValid || !phoneResult.normalized) {
    console.info("WHATSAPP_NOTIFICATION_SKIPPED", {
      reason: "INVALID_RECIPIENT",
      formSlug,
      submissionId: submission?.id,
      tallySubmissionId: submission?.tallySubmissionId,
      whatsappRaw: submission?.extractedWhatsapp || null,
      whatsappNormalizeReason: phoneResult.reason,
    });
    return {
      ok: false,
      skipped: true,
      reason: "INVALID_RECIPIENT",
      whatsappRaw: submission?.extractedWhatsapp || null,
      whatsappNormalized: null,
    };
  }

  const answersByLabel = submission?.payload?.answersByLabel || {};
  const displayName = pickDisplayName(answersByLabel) || "Bapak/Ibu";

  const template = getTemplateByForm(formSlug);
  const message = renderTemplate(template, {
    name: displayName,
    form_slug: formSlug || "",
    submission_id:
      submission?.tallySubmissionId || submission?.payload?.submissionId || "",
    respondent_id:
      submission?.respondentId || submission?.payload?.respondentId || "",
  }).trim();

  if (!message) {
    console.info("WHATSAPP_NOTIFICATION_SKIPPED", {
      reason: "EMPTY_RENDERED_MESSAGE",
      formSlug,
      submissionId: submission?.id,
      tallySubmissionId: submission?.tallySubmissionId,
    });
    return {
      ok: false,
      skipped: true,
      reason: "EMPTY_RENDERED_MESSAGE",
      whatsappRaw: submission?.extractedWhatsapp || null,
      whatsappNormalized: phoneResult.normalized,
    };
  }

  const baseIdempotencyKey = buildIdempotencyKey(formSlug, submission);
  const idempotencyKey = idempotencySuffix
    ? `${baseIdempotencyKey}-${sanitizeKeySegment(idempotencySuffix, 60)}`
    : baseIdempotencyKey;
  const clientReference = buildClientReference(formSlug, submission);

  const sendResult = await sendWhatsApp(
    phoneResult.normalized,
    message,
    idempotencyKey,
    clientReference,
  );

  const logPayload = {
    formSlug,
    submissionId: submission?.id,
    tallySubmissionId: submission?.tallySubmissionId,
    whatsappRaw: submission?.extractedWhatsapp || null,
    whatsappNormalized: phoneResult.normalized,
    idempotencyKey,
    clientReference,
    waStatus: sendResult?.status || null,
    waOk: Boolean(sendResult?.ok),
    waSkipped: Boolean(sendResult?.skipped),
    waReason: sendResult?.reason || null,
  };

  if (sendResult?.ok) {
    console.info("WHATSAPP_NOTIFICATION_QUEUED", logPayload);
    return {
      ...sendResult,
      whatsappRaw: submission?.extractedWhatsapp || null,
      whatsappNormalized: phoneResult.normalized,
      idempotencyKey,
      clientReference,
    };
  }

  console.warn("WHATSAPP_NOTIFICATION_NOT_QUEUED", logPayload);
  return {
    ...sendResult,
    whatsappRaw: submission?.extractedWhatsapp || null,
    whatsappNormalized: phoneResult.normalized,
    idempotencyKey,
    clientReference,
  };
};

module.exports = triggerWhatsappNotification;
