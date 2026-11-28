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
  provider_response?: Record<string, unknown> | null;
}

export const ZERNIO_API_BASE = 'https://zernio.com/api/v1';
export const ZERNIO_SANDBOX_SENDER_DIGITS = '12029087457';
export const ZERNIO_SANDBOX_TEST_RECIPIENT_DIGITS = '916302543640';

export interface WhatsAppRuntimeConfig {
  enabled: boolean;
  zernioApiKey: string;
  zernioMode: string;
  sandboxAccountIdOverride: string;
  sandboxRecipientRaw: string;
  sandboxRecipientDigits: string | null;
  allowUnscopedBatch: boolean;
  processAfterIso: string;
  dispatchSecret: string;
  metaAppSecret: string;
  webhookVerifyToken: string;
}

export function readWhatsAppRuntimeConfig(): WhatsAppRuntimeConfig {
  const sandboxRecipientRaw = (
    Deno.env.get('ZERNIO_SANDBOX_RECIPIENT') ||
    Deno.env.get('WHATSAPP_ADMIN_PHONE') ||
    ZERNIO_SANDBOX_TEST_RECIPIENT_DIGITS
  ).trim();

  return {
    enabled: (Deno.env.get('WHATSAPP_ENABLED') || '').trim().toLowerCase() === 'true',
    zernioApiKey: (Deno.env.get('ZERNIO_API_KEY') || '').trim(),
    zernioMode: (Deno.env.get('ZERNIO_MODE') || 'sandbox').trim().toLowerCase(),
    sandboxAccountIdOverride: (Deno.env.get('ZERNIO_SANDBOX_ACCOUNT_ID') || '').trim(),
    sandboxRecipientRaw,
    sandboxRecipientDigits: toWhatsAppDigits(sandboxRecipientRaw),
    allowUnscopedBatch:
      (Deno.env.get('ZERNIO_ALLOW_UNSCOPED_BATCH') || '').trim().toLowerCase() === 'true',
    processAfterIso: (Deno.env.get('WHATSAPP_PROCESS_AFTER') || '').trim(),
    dispatchSecret: (Deno.env.get('WHATSAPP_DISPATCH_SECRET') || '').trim(),
    metaAppSecret: (Deno.env.get('META_APP_SECRET') || '').trim(),
    webhookVerifyToken: (Deno.env.get('WHATSAPP_WEBHOOK_VERIFY_TOKEN') || '').trim(),
  };
}

export function getMissingActivationRequirements(config: WhatsAppRuntimeConfig): string[] {
  const missing: string[] = [];
  if (!config.enabled) {
    missing.push('WHATSAPP_ENABLED must be set to "true"');
  }
  if (config.zernioMode !== 'sandbox') {
    missing.push(
      'Production WhatsApp mode is disabled. ZERNIO_MODE must remain "sandbox" for Sandbox testing.'
    );
  }
  if (!config.zernioApiKey) {
    missing.push('ZERNIO_API_KEY');
  }
  if (config.sandboxRecipientDigits !== ZERNIO_SANDBOX_TEST_RECIPIENT_DIGITS) {
    missing.push(
      'Zernio Sandbox supports only the activated test phone (+916302543640).'
    );
  }
  if (config.processAfterIso && Number.isNaN(Date.parse(config.processAfterIso))) {
    missing.push('WHATSAPP_PROCESS_AFTER must be a valid ISO-8601 timestamp');
  }
  return missing;
}

function assertSandboxMode(config: WhatsAppRuntimeConfig): void {
  if (config.zernioMode !== 'sandbox') {
    throw new Error('Production WhatsApp mode is blocked. Only Zernio Sandbox mode is allowed.');
  }
}

/**
 * Normalizes an Indian mobile number to WhatsApp digits format (`91XXXXXXXXXX`).
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
 * Normalizes display values safely for plain-text WhatsApp messages.
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickNonEmptyString(...values: unknown[]): string | null {
  for (const val of values) {
    if (typeof val === 'string' && val.trim()) {
      return val.trim();
    }
  }
  return null;
}

function normalizePhoneDigits(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\D/g, '') : '';
}

async function parseJsonSafe(response: Response): Promise<Record<string, unknown>> {
  try {
    const data = await response.json();
    return asRecord(data) ?? { data };
  } catch {
    return { status: response.status, statusText: response.statusText };
  }
}

function extractZernioErrorMessage(
  parsed: Record<string, unknown>,
  fallback: string
): string {
  const errObj = asRecord(parsed.error);
  return (
    pickNonEmptyString(
      parsed.message,
      parsed.detail,
      errObj?.message,
      errObj?.error_user_msg,
      typeof parsed.error === 'string' ? parsed.error : null
    ) || fallback
  );
}

/**
 * Formats a concise, readable WhatsApp message from the booking outbox snapshot.
 */
export function formatBookingNotificationText(event: NotificationOutboxRow): string {
  const payload = event.payload || {};
  const bookingRef = sanitizeTemplateParam(payload.booking_reference, 'Pending Ref', 64);
  const customerName = sanitizeTemplateParam(payload.customer_name, 'Customer', 100);
  const customerPhone = sanitizeTemplateParam(payload.customer_phone, 'Not provided', 40);
  const vehicle = sanitizeTemplateParam(payload.vehicle_make_model, 'Self-Drive Vehicle', 120);
  const pickupIst = sanitizeTemplateParam(payload.pickup_ist, 'Not specified', 80);
  const returnIst = sanitizeTemplateParam(payload.return_ist, 'Not specified', 80);
  const duration = sanitizeTemplateParam(payload.rental_duration_label, '12 Hours', 60);
  const pickupType = sanitizeTemplateParam(payload.pickup_type_label, 'Hub Pickup (Siddipet)', 60);
  const deliveryAddress = sanitizeTemplateParam(
    payload.delivery_address,
    'Not applicable (Hub Pickup)',
    220
  );
  const amount = sanitizeTemplateParam(payload.estimated_amount_display, 'INR 0', 40);
  const status = sanitizeTemplateParam(payload.booking_status, 'Pending', 40);
  const businessPhone = sanitizeTemplateParam(payload.business_contact_phone, '6302543640', 20);
  const isGuest = Boolean(payload.is_guest);

  if (event.event_type === 'booking_created_admin') {
    return [
      '[SANDBOX TEST - ADMIN ALERT]',
      '*New Booking Request - Siddipet Self Drive Cars*',
      '',
      `Reference: ${bookingRef}`,
      `Customer: ${customerName} (${customerPhone})${isGuest ? ' [Guest]' : ''}`,
      `Vehicle: ${vehicle}`,
      `Pickup: ${pickupIst}`,
      `Return: ${returnIst}`,
      `Duration: ${duration}`,
      `Pickup Type: ${pickupType}`,
      `Delivery Address: ${deliveryAddress}`,
      `Estimated Total: ${amount}`,
      `Status: ${status}`,
      '',
      'Please open the Admin Dashboard to review and confirm this booking.',
    ].join('\n');
  }

  return [
    '[SANDBOX TEST - CUSTOMER CONFIRMATION]',
    `(Live recipient when enabled: ${customerPhone})`,
    '',
    '*Booking Confirmed - Siddipet Self Drive Cars*',
    `Hello ${customerName}, your booking *${bookingRef}* is confirmed!`,
    '',
    `Vehicle: ${vehicle}`,
    `Pickup: ${pickupIst}`,
    `Return: ${returnIst}`,
    `Duration: ${duration}`,
    `Pickup Type: ${pickupType}`,
    `Delivery Address: ${deliveryAddress}`,
    `Estimated Total: ${amount}`,
    '',
    `For pickup assistance, call or WhatsApp: +91 ${businessPhone}`,
  ].join('\n');
}

/**
 * Retrieves and verifies the Zernio Sandbox accountId via GET /v1/phone-numbers
 * against the official Sandbox sender (+1 202 908 7457). Never accepts an accountId
 * without positive sender confirmation, and rejects conflicting accountIds or numbers.
 */
export async function getZernioSandboxAccountId(config: WhatsAppRuntimeConfig): Promise<{
  ok: boolean;
  httpStatus: number;
  accountId: string | null;
  errorMessage: string | null;
  rawResponse: Record<string, unknown>;
}> {
  assertSandboxMode(config);

  const response = await fetch(`${ZERNIO_API_BASE}/phone-numbers`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.zernioApiKey}`,
      Accept: 'application/json',
    },
  });

  const parsed = await parseJsonSafe(response);
  if (!response.ok) {
    return {
      ok: false,
      httpStatus: response.status,
      accountId: null,
      errorMessage: extractZernioErrorMessage(
        parsed,
        `Zernio /v1/phone-numbers returned HTTP ${response.status}`
      ),
      rawResponse: parsed,
    };
  }

  const extractAccountIdFromObj = (obj: Record<string, unknown>): string | null => {
    const accountObj = asRecord(obj.account);
    return pickNonEmptyString(
      obj.accountId,
      obj.account_id,
      obj.id,
      obj._id,
      accountObj?.accountId,
      accountObj?.account_id,
      accountObj?.id,
      accountObj?._id
    );
  };

  const extractPhoneFromObj = (obj: Record<string, unknown>): string | null =>
    pickNonEmptyString(
      obj.phoneNumber,
      obj.phone_number,
      obj.number,
      obj.displayPhoneNumber,
      obj.display_phone_number,
      obj.phone
    );

  const dataObj = asRecord(parsed.data);
  const directSandbox = asRecord(parsed.sandbox) || asRecord(dataObj?.sandbox);
  const candidateArrays = Array.from(
    new Set(
      [
        parsed.phoneNumbers,
        parsed.numbers,
        parsed.data,
        dataObj?.phoneNumbers,
        dataObj?.numbers,
      ].filter((arr): arr is unknown[] => Array.isArray(arr))
    )
  );
  const candidates = candidateArrays.flat();

  let directAccountId: string | null = null;
  let directHasPositiveSender = false;

  if (directSandbox) {
    if (directSandbox.isSandbox === false) {
      return {
        ok: false,
        httpStatus: response.status,
        accountId: null,
        errorMessage:
          'Zernio sandbox entry is marked isSandbox=false. Expected verified Sandbox sender +1 202 908 7457.',
        rawResponse: parsed,
      };
    }

    directAccountId = extractAccountIdFromObj(directSandbox);
    const sandboxPhoneRaw = extractPhoneFromObj(directSandbox);
    const sandboxPhoneDigits = normalizePhoneDigits(sandboxPhoneRaw);

    if (sandboxPhoneRaw && sandboxPhoneDigits !== ZERNIO_SANDBOX_SENDER_DIGITS) {
      return {
        ok: false,
        httpStatus: response.status,
        accountId: null,
        errorMessage: `Zernio sandbox phone mismatch: expected +1 202 908 7457 (${ZERNIO_SANDBOX_SENDER_DIGITS}), got "${sandboxPhoneRaw}".`,
        rawResponse: parsed,
      };
    }

    directHasPositiveSender = sandboxPhoneDigits === ZERNIO_SANDBOX_SENDER_DIGITS;
  }

  const candidateRecords: Array<{
    item: Record<string, unknown>;
    accountId: string | null;
    phoneRaw: string | null;
    phoneDigits: string;
  }> = [];

  for (const entry of candidates) {
    const item = asRecord(entry);
    if (!item) continue;
    const itemAccountId = extractAccountIdFromObj(item);
    const itemPhoneRaw = extractPhoneFromObj(item);
    const itemPhoneDigits = normalizePhoneDigits(itemPhoneRaw);

    candidateRecords.push({
      item,
      accountId: itemAccountId,
      phoneRaw: itemPhoneRaw,
      phoneDigits: itemPhoneDigits,
    });

    if (item.isSandbox === true) {
      if (itemPhoneRaw && itemPhoneDigits !== ZERNIO_SANDBOX_SENDER_DIGITS) {
        return {
          ok: false,
          httpStatus: response.status,
          accountId: null,
          errorMessage: `Zernio sandbox-marked entry has non-sandbox phone "${itemPhoneRaw}", expected +1 202 908 7457.`,
          rawResponse: parsed,
        };
      }
      if (directAccountId && itemAccountId && itemAccountId !== directAccountId) {
        return {
          ok: false,
          httpStatus: response.status,
          accountId: null,
          errorMessage: `Conflicting Zernio Sandbox accountIds detected ("${directAccountId}" vs "${itemAccountId}").`,
          rawResponse: parsed,
        };
      }
    }
  }

  const matchedSenderRecords = candidateRecords.filter(
    (r) => r.phoneDigits === ZERNIO_SANDBOX_SENDER_DIGITS
  );

  for (const matched of matchedSenderRecords) {
    if (matched.item.isSandbox === false) {
      return {
        ok: false,
        httpStatus: response.status,
        accountId: null,
        errorMessage:
          'Zernio entry for +1 202 908 7457 is marked isSandbox=false and cannot be used for Sandbox delivery.',
        rawResponse: parsed,
      };
    }
  }

  const distinctLinkedAccountIds = new Set(
    matchedSenderRecords.map((r) => r.accountId).filter((id): id is string => Boolean(id))
  );

  if (distinctLinkedAccountIds.size > 1) {
    return {
      ok: false,
      httpStatus: response.status,
      accountId: null,
      errorMessage: `Conflicting Zernio accountIds found for Sandbox sender +1 202 908 7457: ${Array.from(distinctLinkedAccountIds).join(', ')}.`,
      rawResponse: parsed,
    };
  }

  const linkedAccountId =
    distinctLinkedAccountIds.size === 1 ? Array.from(distinctLinkedAccountIds)[0] : null;

  if (directAccountId && linkedAccountId && directAccountId !== linkedAccountId) {
    return {
      ok: false,
      httpStatus: response.status,
      accountId: null,
      errorMessage: `Conflicting Zernio Sandbox accountIds: sandbox object returned "${directAccountId}" while linked +1 202 908 7457 record returned "${linkedAccountId}".`,
      rawResponse: parsed,
    };
  }

  const verifiedAccountId =
    linkedAccountId || (directHasPositiveSender && directAccountId ? directAccountId : null);

  if (!verifiedAccountId) {
    const errorMessage = directAccountId
      ? 'Zernio response included a sandbox accountId without positively confirming sender +1 202 908 7457 (12029087457). Refusing unverified account.'
      : 'Could not verify Zernio Sandbox accountId for sender +1 202 908 7457 (12029087457) in GET /v1/phone-numbers.';
    return {
      ok: false,
      httpStatus: response.status,
      accountId: null,
      errorMessage,
      rawResponse: parsed,
    };
  }

  // Reject if the verified Sandbox accountId is also linked to any other phone number
  for (const rec of candidateRecords) {
    if (
      rec.accountId === verifiedAccountId &&
      rec.phoneRaw &&
      rec.phoneDigits !== ZERNIO_SANDBOX_SENDER_DIGITS
    ) {
      return {
        ok: false,
        httpStatus: response.status,
        accountId: null,
        errorMessage: `Zernio account ${verifiedAccountId} is linked to conflicting phone number "${rec.phoneRaw}", not solely +1 202 908 7457.`,
        rawResponse: parsed,
      };
    }
  }

  if (
    config.sandboxAccountIdOverride &&
    config.sandboxAccountIdOverride !== verifiedAccountId
  ) {
    return {
      ok: false,
      httpStatus: response.status,
      accountId: null,
      errorMessage:
        'Configured ZERNIO_SANDBOX_ACCOUNT_ID does not match the verified Sandbox sender (+1 202 908 7457) accountId returned by Zernio.',
      rawResponse: parsed,
    };
  }

  return {
    ok: true,
    httpStatus: response.status,
    accountId: verifiedAccountId,
    errorMessage: null,
    rawResponse: parsed,
  };
}

function extractConversationAccountId(conv: Record<string, unknown>): string | null {
  return pickNonEmptyString(
    conv.accountId,
    conv.account_id,
    asRecord(conv.account)?.id,
    asRecord(conv.account)?._id
  );
}

/**
 * Strictly matches an Inbox conversation against BOTH:
 * 1. Exact non-empty Sandbox `accountId` (unless explicitly permitted for an already
 *    account-scoped lookup whose response body omits `accountId`)
 * 2. Exact normalized WhatsApp recipient digits (`916302543640`)
 */
export function conversationMatchesTarget(
  conv: Record<string, unknown>,
  accountId: string,
  recipientDigits: string,
  options?: { allowOmittedAccountId?: boolean }
): boolean {
  const convPlatform = pickNonEmptyString(conv.platform);
  if (convPlatform && convPlatform.toLowerCase() !== 'whatsapp') {
    return false;
  }

  const convAccountId = extractConversationAccountId(conv);
  if (convAccountId) {
    if (convAccountId !== accountId) {
      return false;
    }
  } else if (!options?.allowOmittedAccountId) {
    return false;
  }

  const participant = asRecord(conv.participant);
  const contact = asRecord(conv.contact);

  const phoneCandidates = [
    conv.participantId,
    conv.participant_id,
    conv.participantPhone,
    conv.participant_phone,
    conv.recipientPhone,
    conv.phone,
    participant?.id,
    participant?._id,
    participant?.phone,
    participant?.phoneNumber,
    contact?.phone,
    contact?.phoneNumber,
  ];

  return phoneCandidates.some((candidate) => {
    if (typeof candidate !== 'string' && typeof candidate !== 'number') return false;
    return toWhatsAppDigits(String(candidate)) === recipientDigits;
  });
}

function extractConversationsList(parsed: Record<string, unknown>): Record<string, unknown>[] {
  const dataObj = asRecord(parsed.data);
  const list = [
    parsed.conversations,
    parsed.items,
    parsed.results,
    parsed.data,
    dataObj?.conversations,
    dataObj?.items,
  ].find((item) => Array.isArray(item)) as unknown[] | undefined;

  if (!list) return [];
  return list.map(asRecord).filter((item): item is Record<string, unknown> => item !== null);
}

/**
 * Looks up an existing WhatsApp Inbox conversation for the verified Sandbox account & test phone.
 * Checks `status=active` first, then falls back to all WhatsApp conversations so retries never
 * repeatedly trigger `sandbox_start` when a conversation already exists.
 */
export async function findZernioInboxConversation(
  accountId: string,
  recipientDigits: string,
  config: WhatsAppRuntimeConfig
): Promise<{
  ok: boolean;
  found: boolean;
  conversationId: string | null;
  errorMessage: string | null;
  rawResponse: Record<string, unknown>;
}> {
  assertSandboxMode(config);

  const urls = [
    `${ZERNIO_API_BASE}/inbox/conversations?platform=whatsapp&status=active`,
    `${ZERNIO_API_BASE}/inbox/conversations?platform=whatsapp`,
  ];

  let lastParsed: Record<string, unknown> = {};
  for (const url of urls) {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.zernioApiKey}`,
        Accept: 'application/json',
      },
    });

    const parsed = await parseJsonSafe(response);
    lastParsed = parsed;

    if (!response.ok) {
      return {
        ok: false,
        found: false,
        conversationId: null,
        errorMessage: extractZernioErrorMessage(
          parsed,
          `Zernio /v1/inbox/conversations returned HTTP ${response.status}`
        ),
        rawResponse: parsed,
      };
    }

    const conversations = extractConversationsList(parsed);
    const matched = conversations.find((conv) =>
      conversationMatchesTarget(conv, accountId, recipientDigits)
    );

    if (matched) {
      const conversationId = pickNonEmptyString(
        matched.id,
        matched._id,
        matched.conversationId,
        matched.conversation_id
      );
      if (conversationId) {
        return {
          ok: true,
          found: true,
          conversationId,
          errorMessage: null,
          rawResponse: matched,
        };
      }
    }
  }

  return {
    ok: true,
    found: false,
    conversationId: null,
    errorMessage: null,
    rawResponse: lastParsed,
  };
}

/**
 * Validates a previously saved conversationId directly against Zernio's
 * GET /v1/inbox/conversations/{conversationId}?accountId=... endpoint.
 * Rejects any conversation belonging to another account or recipient, and returns
 * a retryable error (`ok: false`) if ownership cannot be established safely.
 */
export async function verifyZernioInboxConversation(
  conversationId: string,
  accountId: string,
  recipientDigits: string,
  config: WhatsAppRuntimeConfig,
  options?: { allowOmittedAccountId?: boolean }
): Promise<{
  ok: boolean;
  valid: boolean;
  errorMessage: string | null;
  rawResponse: Record<string, unknown>;
}> {
  assertSandboxMode(config);

  const response = await fetch(
    `${ZERNIO_API_BASE}/inbox/conversations/${encodeURIComponent(
      conversationId
    )}?accountId=${encodeURIComponent(accountId)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.zernioApiKey}`,
        Accept: 'application/json',
      },
    }
  );

  const parsed = await parseJsonSafe(response);
  if (response.status === 404) {
    return {
      ok: true,
      valid: false,
      errorMessage: 'Saved conversation ID was not found on Zernio.',
      rawResponse: parsed,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      valid: false,
      errorMessage: extractZernioErrorMessage(
        parsed,
        `Zernio GET /v1/inbox/conversations/{id} returned HTTP ${response.status}`
      ),
      rawResponse: parsed,
    };
  }

  const dataObj = asRecord(parsed.data);
  const convObj =
    asRecord(parsed.conversation) || asRecord(dataObj?.conversation) || dataObj || parsed;
  const matches = conversationMatchesTarget(convObj, accountId, recipientDigits, {
    allowOmittedAccountId: Boolean(options?.allowOmittedAccountId),
  });

  if (!matches) {
    return {
      ok: false,
      valid: false,
      errorMessage:
        'Saved conversation ownership could not be verified against the Sandbox accountId and test recipient +916302543640.',
      rawResponse: parsed,
    };
  }

  return {
    ok: true,
    valid: true,
    errorMessage: null,
    rawResponse: parsed,
  };
}

/**
 * Checks whether an outbound message with the exact formatted text already exists
 * in the conversation (using Zernio's documented GET messages endpoint) so retries
 * after a post-send crash/timeout avoid resending duplicates when history confirms delivery.
 * Fails open (`checked: false`) if the endpoint is unavailable or unrecognized.
 */
export async function findDeliveredMessageInConversation(
  conversationId: string,
  accountId: string,
  expectedMessageText: string,
  config: WhatsAppRuntimeConfig
): Promise<{
  checked: boolean;
  matchedMessageId: string | null;
  rawResponse: Record<string, unknown>;
}> {
  assertSandboxMode(config);

  try {
    const response = await fetch(
      `${ZERNIO_API_BASE}/inbox/conversations/${encodeURIComponent(
        conversationId
      )}/messages?accountId=${encodeURIComponent(accountId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${config.zernioApiKey}`,
          Accept: 'application/json',
        },
      }
    );

    const parsed = await parseJsonSafe(response);
    if (!response.ok) {
      return { checked: false, matchedMessageId: null, rawResponse: parsed };
    }

    const dataObj = asRecord(parsed.data);
    const list = [
      parsed.messages,
      parsed.items,
      parsed.results,
      parsed.data,
      dataObj?.messages,
      dataObj?.items,
    ].find((item) => Array.isArray(item)) as unknown[] | undefined;

    if (!list) {
      return { checked: false, matchedMessageId: null, rawResponse: parsed };
    }

    const normalizedExpected = expectedMessageText.trim();
    for (const entry of list) {
      const msg = asRecord(entry);
      if (!msg) continue;

      const direction = pickNonEmptyString(msg.direction, msg.senderType, msg.role)?.toLowerCase();
      const isInbound =
        direction === 'inbound' ||
        direction === 'incoming' ||
        direction === 'customer' ||
        msg.fromMe === false;
      if (isInbound) continue;

      const textCandidate = pickNonEmptyString(
        msg.message,
        msg.text,
        msg.body,
        msg.content,
        asRecord(msg.text)?.body
      );
      if (!textCandidate || textCandidate.trim() !== normalizedExpected) {
        continue;
      }

      const status = pickNonEmptyString(msg.status)?.toLowerCase();
      if (status === 'failed' || status === 'undelivered') {
        continue;
      }

      const messageId = pickNonEmptyString(
        msg.messageId,
        msg.message_id,
        msg.providerMessageId,
        msg.id,
        msg._id
      );
      if (messageId) {
        return { checked: true, matchedMessageId: messageId, rawResponse: msg };
      }
    }

    return { checked: true, matchedMessageId: null, rawResponse: parsed };
  } catch {
    return { checked: false, matchedMessageId: null, rawResponse: {} };
  }
}

/**
 * Opens a Zernio Sandbox Inbox conversation using the fixed `sandbox_start` template.
 * Does NOT send free-form text immediately; recipient must reply first.
 */
export async function openZernioSandboxConversation(
  accountId: string,
  recipientDigits: string,
  config: WhatsAppRuntimeConfig
): Promise<{
  ok: boolean;
  httpStatus: number;
  conversationId: string | null;
  errorMessage: string | null;
  rawResponse: Record<string, unknown>;
}> {
  assertSandboxMode(config);

  if (recipientDigits !== ZERNIO_SANDBOX_TEST_RECIPIENT_DIGITS) {
    throw new Error('Zernio Sandbox only permits +916302543640 as participantId.');
  }

  const response = await fetch(`${ZERNIO_API_BASE}/inbox/conversations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.zernioApiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      accountId,
      participantId: recipientDigits,
      templateName: 'sandbox_start',
      templateLanguage: 'en',
      templateParams: [],
    }),
  });

  const parsed = await parseJsonSafe(response);
  if (!response.ok) {
    return {
      ok: false,
      httpStatus: response.status,
      conversationId: null,
      errorMessage: extractZernioErrorMessage(
        parsed,
        `Zernio POST /v1/inbox/conversations returned HTTP ${response.status}`
      ),
      rawResponse: parsed,
    };
  }

  const dataObj = asRecord(parsed.data);
  const convObj =
    asRecord(parsed.conversation) || asRecord(dataObj?.conversation) || dataObj;
  const conversationId = pickNonEmptyString(
    parsed.conversationId,
    parsed.conversation_id,
    convObj?.id,
    convObj?._id,
    convObj?.conversationId,
    convObj?.conversation_id,
    parsed.id,
    parsed._id
  );

  return {
    ok: true,
    httpStatus: response.status,
    conversationId,
    errorMessage: null,
    rawResponse: parsed,
  };
}

/**
 * Classifies an error as a closed/expired 24-hour customer service window ONLY when the
 * provider response explicitly indicates that condition (e.g. Meta code 131047 or explicit
 * window-closed phrasing). Preserves all other errors (auth, validation, rate limits, 5xx) as-is.
 */
export function isExplicitWindowClosedError(
  parsed: Record<string, unknown>,
  message: string
): boolean {
  const errObj = asRecord(parsed.error);
  const codeCandidates = [
    parsed.code,
    parsed.errorCode,
    parsed.error_code,
    errObj?.code,
    errObj?.error_subcode,
  ]
    .map((c) => (c !== undefined && c !== null ? String(c).trim() : ''))
    .filter(Boolean);

  if (codeCandidates.includes('131047')) {
    return true;
  }

  const combinedText = [
    message,
    pickNonEmptyString(parsed.error_user_msg, errObj?.error_user_msg, errObj?.type, parsed.code),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return (
    /24[\s-]*hour/.test(combinedText) ||
    combinedText.includes('customer service window') ||
    combinedText.includes('re-engagement') ||
    combinedText.includes('reengagement') ||
    combinedText.includes('outside the allowed window') ||
    combinedText.includes('messaging window') ||
    combinedText.includes('window has closed') ||
    combinedText.includes('window is closed') ||
    combinedText.includes('window closed') ||
    combinedText.includes('window expired') ||
    combinedText.includes('outside window')
  );
}

/**
 * Sends a free-form booking notification message inside an existing Zernio Inbox conversation.
 * Passes Zernio's official `Idempotency-Key` header (scoped 24h for 2xx responses, released on 4xx)
 * and only reports `ok: true` when HTTP 2xx returns a valid provider message ID.
 */
export async function sendZernioConversationMessage(
  conversationId: string,
  accountId: string,
  messageText: string,
  config: WhatsAppRuntimeConfig,
  idempotencyKey?: string
): Promise<{
  ok: boolean;
  httpStatus: number;
  messageId: string | null;
  isWindowClosed: boolean;
  idempotentReplayed: boolean;
  errorMessage: string | null;
  rawResponse: Record<string, unknown>;
}> {
  assertSandboxMode(config);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.zernioApiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (idempotencyKey && idempotencyKey.trim()) {
    headers['Idempotency-Key'] = idempotencyKey.trim().slice(0, 255);
  }

  const response = await fetch(
    `${ZERNIO_API_BASE}/inbox/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        accountId,
        message: messageText,
      }),
    }
  );

  const idempotentReplayed =
    (response.headers.get('idempotent-replayed') || '').trim().toLowerCase() === 'true';

  const parsed = await parseJsonSafe(response);
  if (!response.ok) {
    const rawMsg = extractZernioErrorMessage(
      parsed,
      `Zernio POST /v1/inbox/conversations/{id}/messages returned HTTP ${response.status}`
    );
    return {
      ok: false,
      httpStatus: response.status,
      messageId: null,
      isWindowClosed: isExplicitWindowClosedError(parsed, rawMsg),
      idempotentReplayed,
      errorMessage: rawMsg,
      rawResponse: parsed,
    };
  }

  const msgObj = asRecord(parsed.message) || asRecord(parsed.data);
  const messageId = pickNonEmptyString(
    parsed.messageId,
    parsed.message_id,
    msgObj?.id,
    msgObj?._id,
    msgObj?.messageId,
    msgObj?.providerMessageId,
    parsed.id,
    parsed._id
  );

  if (!messageId) {
    return {
      ok: false,
      httpStatus: response.status,
      messageId: null,
      isWindowClosed: false,
      idempotentReplayed,
      errorMessage:
        'Zernio returned HTTP 2xx without a confirmed message ID. Keeping event retryable.',
      rawResponse: parsed,
    };
  }

  return {
    ok: true,
    httpStatus: response.status,
    messageId,
    isWindowClosed: false,
    idempotentReplayed,
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
