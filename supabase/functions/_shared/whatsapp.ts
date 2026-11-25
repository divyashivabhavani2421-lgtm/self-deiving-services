export type NotificationEventType =
  | 'booking_created_admin'
  | 'booking_confirmed_customer';

export interface NotificationOutboxRow {
  id: string;
  booking_id: string;
  event_type: NotificationEventType;
  idempotency_key: string;
  recipient_role: 'admin' | 'customer';
  recipient_phone: string;
  template_key: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'processing' | 'sent' | 'failed' | 'skipped';
  skip_reason: string | null;
  attempt_count: number;
  max_attempts: number;
}

export interface WhatsAppRuntimeConfig {
  enabled: boolean;
  accessToken: string;
  phoneNumberId: string;
  businessAccountId: string;
  senderNumber: string;
  adminPhone: string;
  templateAdminNewBooking: string;
  templateCustomerConfirmed: string;
  templateLanguage: string;
  graphApiVersion: string;
  dispatchSecret: string;
  metaAppSecret: string;
  webhookVerifyToken: string;
}

export function readWhatsAppRuntimeConfig(): WhatsAppRuntimeConfig {
  return {
    enabled: (Deno.env.get('WHATSAPP_ENABLED') || '').trim().toLowerCase() === 'true',
    accessToken: (Deno.env.get('WHATSAPP_ACCESS_TOKEN') || '').trim(),
    phoneNumberId: (Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') || '').trim(),
    businessAccountId: (Deno.env.get('WHATSAPP_BUSINESS_ACCOUNT_ID') || '').trim(),
    senderNumber: (Deno.env.get('WHATSAPP_SENDER_NUMBER') || '916302543640').trim(),
    adminPhone: (Deno.env.get('WHATSAPP_ADMIN_PHONE') || '916302543640').trim(),
    templateAdminNewBooking: (
      Deno.env.get('WHATSAPP_TEMPLATE_ADMIN_NEW_BOOKING') || 'admin_new_booking_alert'
    ).trim(),
    templateCustomerConfirmed: (
      Deno.env.get('WHATSAPP_TEMPLATE_CUSTOMER_CONFIRMED') || 'customer_booking_confirmed'
    ).trim(),
    templateLanguage: (Deno.env.get('WHATSAPP_TEMPLATE_LANGUAGE') || 'en').trim(),
    graphApiVersion: (Deno.env.get('WHATSAPP_GRAPH_API_VERSION') || 'v22.0').trim(),
    dispatchSecret: (Deno.env.get('WHATSAPP_DISPATCH_SECRET') || '').trim(),
    metaAppSecret: (Deno.env.get('META_APP_SECRET') || '').trim(),
    webhookVerifyToken: (Deno.env.get('WHATSAPP_WEBHOOK_VERIFY_TOKEN') || '').trim(),
  };
}

export function getMissingActivationRequirements(config: WhatsAppRuntimeConfig): string[] {
  const missing: string[] = [];
  if (!config.enabled) missing.push('WHATSAPP_ENABLED must be set to "true"');
  if (!config.accessToken) missing.push('WHATSAPP_ACCESS_TOKEN');
  if (!config.phoneNumberId) missing.push('WHATSAPP_PHONE_NUMBER_ID');
  if (!config.businessAccountId) missing.push('WHATSAPP_BUSINESS_ACCOUNT_ID');
  return missing;
}

/**
 * Normalizes an Indian mobile number to Meta WhatsApp Cloud API digits format (`91XXXXXXXXXX`).
 */
export function toWhatsAppDigits(rawPhone: string | null | undefined): string | null {
  const cleaned = String(rawPhone || '').replace(/[\s\-()+]/g, '').trim();
  if (!cleaned) return null;

  let local = cleaned;
  if (cleaned.startsWith('91') && cleaned.length === 12) {
    local = cleaned.slice(2);
  } else if (cleaned.startsWith('0') && cleaned.length === 11) {
    local = cleaned.slice(1);
  }

  if (!/^[6-9]\d{9}$/.test(local)) {
    return null;
  }
  return `91${local}`;
}

/**
 * Meta WhatsApp Cloud API forbids empty strings, newlines, tabs, or >4 consecutive
 * spaces in template body text parameters.
 */
export function sanitizeTemplateParam(
  value: unknown,
  fallback = 'Not provided',
  maxLength = 240
): string {
  const raw = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const cleaned = raw
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!cleaned) return fallback;
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 3)}...` : cleaned;
}

export function buildTemplateRequestPayload(
  event: NotificationOutboxRow,
  config: WhatsAppRuntimeConfig
): {
  recipientDigits: string;
  templateName: string;
  body: Record<string, unknown>;
} {
  const payload = event.payload || {};

  const targetPhone =
    event.event_type === 'booking_created_admin'
      ? config.adminPhone || event.recipient_phone
      : event.recipient_phone;

  const recipientDigits = toWhatsAppDigits(targetPhone);
  if (!recipientDigits) {
    throw new Error(`Invalid Indian recipient phone number for WhatsApp delivery: "${targetPhone}"`);
  }

  if (event.event_type === 'booking_created_admin') {
    const params = [
      sanitizeTemplateParam(payload.customer_name, 'Customer'),
      sanitizeTemplateParam(payload.customer_phone, 'Not provided'),
      sanitizeTemplateParam(payload.vehicle_make_model, 'Self-Drive Vehicle'),
      sanitizeTemplateParam(payload.booking_reference, 'Pending Ref'),
      sanitizeTemplateParam(payload.pickup_ist, 'Not specified'),
      sanitizeTemplateParam(payload.return_ist, 'Not specified'),
      sanitizeTemplateParam(payload.rental_duration_label, '12 Hours'),
      sanitizeTemplateParam(payload.pickup_type_label, 'Hub Pickup (Siddipet)'),
      sanitizeTemplateParam(payload.delivery_address, 'Not applicable (Hub Pickup)'),
      sanitizeTemplateParam(payload.estimated_amount_display, 'INR 0'),
      sanitizeTemplateParam(payload.booking_status, 'Pending'),
    ];

    return {
      recipientDigits,
      templateName: config.templateAdminNewBooking,
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipientDigits,
        type: 'template',
        template: {
          name: config.templateAdminNewBooking,
          language: { code: config.templateLanguage },
          components: [
            {
              type: 'body',
              parameters: params.map((text) => ({ type: 'text', text })),
            },
          ],
        },
      },
    };
  }

  // booking_confirmed_customer (only on pending -> confirmed with opt-in)
  const customerParams = [
    sanitizeTemplateParam(payload.customer_name, 'Customer'),
    sanitizeTemplateParam(payload.booking_reference, 'Booking Ref'),
    sanitizeTemplateParam(payload.vehicle_make_model, 'Self-Drive Vehicle'),
    sanitizeTemplateParam(payload.pickup_ist, 'Not specified'),
    sanitizeTemplateParam(payload.return_ist, 'Not specified'),
    sanitizeTemplateParam(payload.rental_duration_label, '12 Hours'),
    sanitizeTemplateParam(payload.pickup_type_label, 'Hub Pickup (Siddipet)'),
    sanitizeTemplateParam(payload.delivery_address, 'Not applicable (Hub Pickup)'),
    sanitizeTemplateParam(payload.estimated_amount_display, 'INR 0'),
    sanitizeTemplateParam(payload.business_contact_phone, '6302543640'),
  ];

  return {
    recipientDigits,
    templateName: config.templateCustomerConfirmed,
    body: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipientDigits,
      type: 'template',
      template: {
        name: config.templateCustomerConfirmed,
        language: { code: config.templateLanguage },
        components: [
          {
            type: 'body',
            parameters: customerParams.map((text) => ({ type: 'text', text })),
          },
        ],
      },
    },
  };
}

export async function sendMetaTemplateMessage(
  requestBody: Record<string, unknown>,
  config: WhatsAppRuntimeConfig
): Promise<{
  ok: boolean;
  httpStatus: number;
  messageId: string | null;
  errorMessage: string | null;
  rawResponse: Record<string, unknown>;
}> {
  const endpoint = `https://graph.facebook.com/${config.graphApiVersion}/${encodeURIComponent(
    config.phoneNumberId
  )}/messages`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  let parsed: Record<string, unknown> = {};
  try {
    parsed = (await response.json()) as Record<string, unknown>;
  } catch {
    parsed = { status: response.status, statusText: response.statusText };
  }

  if (!response.ok) {
    const errObj = (parsed.error as Record<string, unknown> | undefined) ?? undefined;
    const errMessage =
      (typeof errObj?.message === 'string' && errObj.message) ||
      `Meta Graph API returned HTTP ${response.status}`;
    return {
      ok: false,
      httpStatus: response.status,
      messageId: null,
      errorMessage: errMessage,
      rawResponse: parsed,
    };
  }

  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  const firstMsg = (messages[0] as Record<string, unknown> | undefined) ?? undefined;
  const messageId = typeof firstMsg?.id === 'string' ? firstMsg.id : null;

  return {
    ok: true,
    httpStatus: response.status,
    messageId,
    errorMessage: null,
    rawResponse: parsed,
  };
}

/**
 * Constant-time string comparison for webhook/dispatch secret checks.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);

  if (aBytes.length !== bBytes.length || aBytes.length === 0) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < aBytes.length; i += 1) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

/**
 * Verifies Meta X-Hub-Signature-256 (`sha256=<hex>`) against raw request body.
 */
export async function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string
): Promise<boolean> {
  if (!signatureHeader || !appSecret) return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(signatureHeader.trim());
  if (!match) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const expectedHex = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return timingSafeEqualString(expectedHex.toLowerCase(), match[1].toLowerCase());
}
