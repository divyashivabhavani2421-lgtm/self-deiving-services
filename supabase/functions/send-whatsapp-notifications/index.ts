import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import {
  findDeliveredMessageInConversation,
  findZernioInboxConversation,
  formatBookingNotificationText,
  getMissingActivationRequirements,
  getZernioSandboxAccountId,
  NotificationEventType,
  NotificationOutboxRow,
  openZernioSandboxConversation,
  readWhatsAppRuntimeConfig,
  sendZernioConversationMessage,
  timingSafeEqualString,
  toWhatsAppDigits,
  verifyZernioInboxConversation,
  ZERNIO_SANDBOX_TEST_RECIPIENT_DIGITS,
} from '../_shared/whatsapp.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface DispatchRequestBody {
  bookingId?: string;
  eventId?: string;
  eventType?: NotificationEventType;
  limit?: number;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim())
  );
}

function computeNextRetryIso(attemptCount: number): string {
  // Exponential backoff in minutes: 2m, 6m, 15m, 30m, 60m
  const backoffMinutes = [2, 6, 15, 30, 60];
  const minutes = backoffMinutes[Math.min(Math.max(attemptCount - 1, 0), backoffMinutes.length - 1)];
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function readPriorSavedConversation(
  event: NotificationOutboxRow,
  expectedAccountId: string,
  expectedRecipientDigits: string
): string | null {
  const resp = event.provider_response;
  if (!resp || typeof resp !== 'object') return null;

  const rec = resp as Record<string, unknown>;
  const savedConvId =
    typeof rec.conversation_id === 'string' && rec.conversation_id.trim()
      ? rec.conversation_id.trim()
      : null;
  if (!savedConvId) return null;

  const savedAccountId =
    typeof rec.account_id === 'string' && rec.account_id.trim() ? rec.account_id.trim() : null;
  const savedRecipient =
    typeof rec.recipient === 'string' ? toWhatsAppDigits(rec.recipient) : null;

  if (savedAccountId !== expectedAccountId || savedRecipient !== expectedRecipientDigits) {
    return null;
  }

  return savedConvId;
}

function hasUncertainSandboxStart(
  event: NotificationOutboxRow,
  expectedAccountId: string,
  expectedRecipientDigits: string
): boolean {
  const resp = event.provider_response;
  if (!resp || typeof resp !== 'object') return false;

  const rec = resp as Record<string, unknown>;
  const savedAccountId =
    typeof rec.account_id === 'string' && rec.account_id.trim() ? rec.account_id.trim() : null;
  const savedRecipient =
    typeof rec.recipient === 'string' ? toWhatsAppDigits(rec.recipient) : null;

  if (savedAccountId && savedAccountId !== expectedAccountId) return false;
  if (savedRecipient && savedRecipient !== expectedRecipientDigits) return false;

  const hasConvId =
    typeof rec.conversation_id === 'string' && rec.conversation_id.trim().length > 0;

  return (
    rec.sandbox_start_uncertain === true ||
    rec.step === 'sandbox_start_uncertain' ||
    (rec.sandbox_start_sent === true && !hasConvId)
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = (Deno.env.get('SUPABASE_URL') || '').trim();
  const serviceRoleKey = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  const anonKey = (Deno.env.get('SUPABASE_ANON_KEY') || '').trim();

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { ok: false, error: 'Supabase service credentials are not configured in Edge Function.' },
      500
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: DispatchRequestBody = {};
  try {
    const text = await req.text();
    if (text.trim()) {
      body = JSON.parse(text) as DispatchRequestBody;
    }
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON request body.' }, 400);
  }

  const config = readWhatsAppRuntimeConfig();

  // Caller authentication & scope enforcement:
  // 1. Trusted Database Webhook / Cron secret header (`x-webhook-secret`)
  // 2. Trusted service_role bearer token
  // 3. Verified authenticated Admin JWT (can dispatch scoped or permitted retries)
  // 4. Narrow public post-booking dispatch trigger ONLY for a specific bookingId + booking_created_admin
  const webhookSecretHeader = (req.headers.get('x-webhook-secret') || '').trim();
  const authHeader = (req.headers.get('authorization') || '').trim();
  const bearerToken = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';

  const isWebhookAuthorized =
    Boolean(config.dispatchSecret) &&
    Boolean(webhookSecretHeader) &&
    timingSafeEqualString(webhookSecretHeader, config.dispatchSecret);

  const isServiceRoleAuthorized =
    Boolean(bearerToken) && timingSafeEqualString(bearerToken, serviceRoleKey);

  let isAdminUser = false;
  if (!isWebhookAuthorized && !isServiceRoleAuthorized && bearerToken && bearerToken !== anonKey) {
    const { data: userData, error: userErr } = await adminClient.auth.getUser(bearerToken);
    if (!userErr && userData.user) {
      const { data: profileData } = await adminClient
        .from('profiles')
        .select('role')
        .eq('id', userData.user.id)
        .maybeSingle();

      if (profileData && String(profileData.role || '').toLowerCase() === 'admin') {
        isAdminUser = true;
      }
    }
  }

  const isTrustedBatchCaller = isWebhookAuthorized || isServiceRoleAuthorized || isAdminUser;

  if (!isTrustedBatchCaller) {
    // Public/customer caller may ONLY nudge an already-queued `booking_created_admin`
    // outbox row for a specific bookingId. Payload text & recipient are NEVER read from the request.
    if (!isUuid(body.bookingId) || body.eventType !== 'booking_created_admin') {
      return jsonResponse(
        {
          ok: false,
          error: 'Unauthorized: admin authentication or webhook secret required.',
        },
        401
      );
    }
  }

  // Activation & Sandbox-only check BEFORE claiming outbox rows so events remain safely queued
  // as 'pending' without incrementing attempt_count while paused or misconfigured.
  const missingRequirements = getMissingActivationRequirements(config);
  if (missingRequirements.length > 0) {
    return jsonResponse(
      {
        ok: true,
        queuedOnly: true,
        whatsappEnabled: config.enabled,
        mode: config.zernioMode,
        message:
          'Zernio Sandbox delivery is currently paused until WHATSAPP_ENABLED="true", ZERNIO_MODE="sandbox", and ZERNIO_API_KEY are active. Events remain safely queued in whatsapp_notification_events.',
        missingRequirements,
        processed: 0,
        sent: 0,
        failed: 0,
      },
      200
    );
  }

  const claimEventId = isTrustedBatchCaller && isUuid(body.eventId) ? body.eventId.trim() : null;
  const claimBookingId = isUuid(body.bookingId) ? body.bookingId.trim() : null;
  const claimEventType = isTrustedBatchCaller
    ? body.eventType === 'booking_created_admin' || body.eventType === 'booking_confirmed_customer'
      ? body.eventType
      : null
    : 'booking_created_admin';
  const claimLimit = isTrustedBatchCaller
    ? Math.min(Math.max(Number(body.limit) || 10, 1), 25)
    : 1;

  // Historical pending-event safeguard:
  // Never automatically sweep historical pending rows on unscoped queue runs unless explicitly
  // scoped via bookingId/eventId, filtered by WHATSAPP_PROCESS_AFTER, or opted in via ZERNIO_ALLOW_UNSCOPED_BATCH=true.
  const isUnscopedBatch = !claimEventId && !claimBookingId;
  if (isUnscopedBatch && !config.allowUnscopedBatch && !config.processAfterIso) {
    return jsonResponse(
      {
        ok: true,
        queuedOnly: true,
        historicalProtected: true,
        whatsappEnabled: true,
        mode: config.zernioMode,
        message:
          'Historical pending events are protected from unscoped batch dispatch. Trigger dispatch for a new booking, click Retry on an individual event in WhatsApp Logs, or set WHATSAPP_PROCESS_AFTER to process only newer events.',
        processed: 0,
        sent: 0,
        failed: 0,
      },
      200
    );
  }

  let events: NotificationOutboxRow[] = [];

  if (isUnscopedBatch && !config.allowUnscopedBatch && config.processAfterIso) {
    let query = adminClient
      .from('whatsapp_notification_events')
      .select('id, status, attempt_count, max_attempts')
      .gte('created_at', config.processAfterIso)
      .in('status', ['pending', 'failed'])
      .order('created_at', { ascending: true })
      .limit(Math.max(claimLimit * 2, 25));

    if (claimEventType) {
      query = query.eq('event_type', claimEventType);
    }

    const { data: recentRows, error: recentErr } = await query;
    if (recentErr) {
      return jsonResponse(
        { ok: false, error: `Could not filter recent notification queue: ${recentErr.message}` },
        500
      );
    }

    const eligibleIds = (recentRows || [])
      .filter((r) => r.status === 'pending' || Number(r.attempt_count) < Number(r.max_attempts))
      .slice(0, claimLimit);

    for (const row of eligibleIds) {
      const { data: claimedSingle, error: claimSingleErr } = await adminClient.rpc(
        'claim_whatsapp_notification_events',
        {
          p_event_id: row.id,
          p_booking_id: null,
          p_event_type: claimEventType,
          p_limit: 1,
        }
      );
      if (!claimSingleErr && Array.isArray(claimedSingle) && claimedSingle.length > 0) {
        events.push(claimedSingle[0] as NotificationOutboxRow);
      }
    }
  } else {
    const { data: claimedRows, error: claimError } = await adminClient.rpc(
      'claim_whatsapp_notification_events',
      {
        p_event_id: claimEventId,
        p_booking_id: claimBookingId,
        p_event_type: claimEventType,
        p_limit: claimLimit,
      }
    );

    if (claimError) {
      return jsonResponse(
        { ok: false, error: `Could not claim notification queue: ${claimError.message}` },
        500
      );
    }

    events = Array.isArray(claimedRows) ? (claimedRows as NotificationOutboxRow[]) : [];
  }

  if (events.length === 0) {
    return jsonResponse({
      ok: true,
      whatsappEnabled: true,
      mode: 'sandbox',
      processed: 0,
      sent: 0,
      failed: 0,
      results: [],
    });
  }

  // Retrieve & verify Sandbox accountId against sender +1 202 908 7457 once per invocation
  const sandboxAccountLookup = await getZernioSandboxAccountId(config);
  if (!sandboxAccountLookup.ok || !sandboxAccountLookup.accountId) {
    const lookupError =
      sandboxAccountLookup.errorMessage || 'Failed to resolve Zernio Sandbox accountId.';
    const results: Array<{
      eventId: string;
      bookingId: string;
      eventType: NotificationEventType;
      status: 'sent' | 'failed';
      error: string;
    }> = [];

    for (const event of events) {
      const canRetry = event.attempt_count < event.max_attempts;
      await adminClient
        .from('whatsapp_notification_events')
        .update({
          status: 'failed',
          next_retry_at: canRetry ? computeNextRetryIso(event.attempt_count) : null,
          last_error: lookupError,
          provider_response: {
            provider: 'zernio',
            mode: 'sandbox',
            step: 'sandbox_account_lookup_failed',
            raw: sandboxAccountLookup.rawResponse,
          },
        })
        .eq('id', event.id);

      results.push({
        eventId: event.id,
        bookingId: event.booking_id,
        eventType: event.event_type,
        status: 'failed',
        error: lookupError,
      });
    }

    return jsonResponse({
      ok: true,
      whatsappEnabled: true,
      mode: 'sandbox',
      processed: events.length,
      sent: 0,
      failed: events.length,
      results,
    });
  }

  const sandboxAccountId = sandboxAccountLookup.accountId;
  const recipientDigits = ZERNIO_SANDBOX_TEST_RECIPIENT_DIGITS;

  let sentCount = 0;
  let failedCount = 0;
  let awaitingReplyCount = 0;
  const results: Array<{
    eventId: string;
    bookingId: string;
    eventType: NotificationEventType;
    status: 'sent' | 'failed';
    awaitingReply?: boolean;
    messageId?: string | null;
    error?: string | null;
  }> = [];

  for (const event of events) {
    const canRetry = event.attempt_count < event.max_attempts;

    try {
      // 1. Check whether a Zernio Inbox conversation already exists for BOTH the verified
      //    Sandbox accountId and exact test recipient +916302543640.
      const lookupRes = await findZernioInboxConversation(
        sandboxAccountId,
        recipientDigits,
        config
      );

      if (!lookupRes.ok) {
        failedCount += 1;
        const errMsg = lookupRes.errorMessage || 'Failed to check Zernio Inbox conversations.';
        await adminClient
          .from('whatsapp_notification_events')
          .update({
            status: 'failed',
            next_retry_at: canRetry ? computeNextRetryIso(event.attempt_count) : null,
            last_error: errMsg,
            provider_response: {
              provider: 'zernio',
              mode: 'sandbox',
              step: 'conversation_lookup_failed',
              account_id: sandboxAccountId,
              recipient: recipientDigits,
              raw: lookupRes.rawResponse,
            },
          })
          .eq('id', event.id);

        results.push({
          eventId: event.id,
          bookingId: event.booking_id,
          eventType: event.event_type,
          status: 'failed',
          error: errMsg,
        });
        continue;
      }

      let conversationId = lookupRes.conversationId;

      // 2. If not found in the listing, validate any previously saved conversation_id
      //    (already bound in provider_response to exact Sandbox accountId & +916302543640).
      //    If Zernio's single-conversation endpoint omits `accountId` in its body, accept it
      //    only because it is already verified as originating from this Sandbox account & recipient.
      if (!conversationId) {
        const candidateSavedId = readPriorSavedConversation(
          event,
          sandboxAccountId,
          recipientDigits
        );

        if (candidateSavedId) {
          const verifyRes = await verifyZernioInboxConversation(
            candidateSavedId,
            sandboxAccountId,
            recipientDigits,
            config,
            { allowOmittedAccountId: true }
          );

          if (!verifyRes.ok) {
            failedCount += 1;
            const errMsg =
              verifyRes.errorMessage || 'Failed to verify saved Zernio Inbox conversation.';
            await adminClient
              .from('whatsapp_notification_events')
              .update({
                status: 'failed',
                next_retry_at: canRetry ? computeNextRetryIso(event.attempt_count) : null,
                last_error: errMsg,
                provider_response: {
                  provider: 'zernio',
                  mode: 'sandbox',
                  step: 'conversation_verification_failed',
                  account_id: sandboxAccountId,
                  conversation_id: candidateSavedId,
                  recipient: recipientDigits,
                  raw: verifyRes.rawResponse,
                },
              })
              .eq('id', event.id);

            results.push({
              eventId: event.id,
              bookingId: event.booking_id,
              eventType: event.event_type,
              status: 'failed',
              error: errMsg,
            });
            continue;
          }

          if (verifyRes.valid) {
            conversationId = candidateSavedId;
          }
        }
      }

      // 3. If NO verified conversation exists yet:
      //    - If a previous sandbox_start attempt had an uncertain outcome (no conversation ID returned),
      //      DO NOT send another sandbox_start automatically; stop for manual review.
      //    - Otherwise, initialize the conversation with `sandbox_start` and stop without sending text.
      if (!conversationId) {
        if (hasUncertainSandboxStart(event, sandboxAccountId, recipientDigits)) {
          failedCount += 1;
          awaitingReplyCount += 1;
          const manualReviewMsg =
            'Previous sandbox_start attempt succeeded without returning a conversation ID, and no verified conversation was found for +91 6302543640. Stopped without sending a duplicate sandbox_start. Confirm reply on +91 6302543640 and retry manually once the conversation appears.';

          await adminClient
            .from('whatsapp_notification_events')
            .update({
              status: 'failed',
              next_retry_at: null,
              provider_message_id: null,
              last_error: manualReviewMsg,
              provider_response: {
                ...(event.provider_response && typeof event.provider_response === 'object'
                  ? event.provider_response
                  : {}),
                provider: 'zernio',
                mode: 'sandbox',
                step: 'sandbox_start_uncertain',
                sandbox_start_sent: true,
                sandbox_start_uncertain: true,
                awaiting_manual_review: true,
                account_id: sandboxAccountId,
                recipient: recipientDigits,
              },
            })
            .eq('id', event.id);

          results.push({
            eventId: event.id,
            bookingId: event.booking_id,
            eventType: event.event_type,
            status: 'failed',
            awaitingReply: true,
            error: manualReviewMsg,
          });
          continue;
        }

        const openRes = await openZernioSandboxConversation(
          sandboxAccountId,
          recipientDigits,
          config
        );

        failedCount += 1;

        if (openRes.ok && openRes.conversationId) {
          awaitingReplyCount += 1;
          const instruction =
            'Sandbox conversation initialized with sandbox_start. Reply to the sandbox_start message on +91 6302543640 to open the 24-hour free-form window, then click Retry to send this booking notification.';

          await adminClient
            .from('whatsapp_notification_events')
            .update({
              status: 'failed',
              next_retry_at: canRetry ? computeNextRetryIso(event.attempt_count) : null,
              provider_message_id: null,
              last_error: instruction,
              provider_response: {
                provider: 'zernio',
                mode: 'sandbox',
                step: 'awaiting_sandbox_reply',
                sandbox_start_sent: true,
                sandbox_start_uncertain: false,
                awaiting_reply: true,
                account_id: sandboxAccountId,
                conversation_id: openRes.conversationId,
                recipient: recipientDigits,
                raw: openRes.rawResponse,
              },
            })
            .eq('id', event.id);

          results.push({
            eventId: event.id,
            bookingId: event.booking_id,
            eventType: event.event_type,
            status: 'failed',
            awaitingReply: true,
            error: instruction,
          });
        } else if (openRes.ok && !openRes.conversationId) {
          awaitingReplyCount += 1;
          const uncertainInstruction =
            'sandbox_start request succeeded, but Zernio did not return a conversation ID. Outcome is uncertain; paused automatic sandbox_start retries for manual review. Have +91 6302543640 reply to sandbox_start, then retry manually.';

          await adminClient
            .from('whatsapp_notification_events')
            .update({
              status: 'failed',
              next_retry_at: null,
              provider_message_id: null,
              last_error: uncertainInstruction,
              provider_response: {
                provider: 'zernio',
                mode: 'sandbox',
                step: 'sandbox_start_uncertain',
                sandbox_start_sent: true,
                sandbox_start_uncertain: true,
                awaiting_reply: true,
                awaiting_manual_review: true,
                account_id: sandboxAccountId,
                conversation_id: null,
                recipient: recipientDigits,
                http_status: openRes.httpStatus,
                raw: openRes.rawResponse,
              },
            })
            .eq('id', event.id);

          results.push({
            eventId: event.id,
            bookingId: event.booking_id,
            eventType: event.event_type,
            status: 'failed',
            awaitingReply: true,
            error: uncertainInstruction,
          });
        } else {
          const errMsg = openRes.errorMessage || 'Failed to open Zernio Sandbox conversation.';
          await adminClient
            .from('whatsapp_notification_events')
            .update({
              status: 'failed',
              next_retry_at: canRetry ? computeNextRetryIso(event.attempt_count) : null,
              provider_message_id: null,
              last_error: errMsg,
              provider_response: {
                provider: 'zernio',
                mode: 'sandbox',
                step: 'sandbox_start_failed',
                account_id: sandboxAccountId,
                recipient: recipientDigits,
                http_status: openRes.httpStatus,
                raw: openRes.rawResponse,
              },
            })
            .eq('id', event.id);

          results.push({
            eventId: event.id,
            bookingId: event.booking_id,
            eventType: event.event_type,
            status: 'failed',
            error: errMsg,
          });
        }
        continue;
      }

      const messageText = formatBookingNotificationText(event);

      // 4. On retry / stale lock recovery (`attempt_count > 1`), inspect Zernio's conversation
      //    messages first to reconcile if an earlier attempt delivered before DB persistence.
      if (event.attempt_count > 1) {
        const priorMsgCheck = await findDeliveredMessageInConversation(
          conversationId,
          sandboxAccountId,
          messageText,
          config
        );

        if (priorMsgCheck.matchedMessageId) {
          sentCount += 1;
          await adminClient
            .from('whatsapp_notification_events')
            .update({
              status: 'sent',
              sent_at: new Date().toISOString(),
              next_retry_at: null,
              provider_message_id: priorMsgCheck.matchedMessageId,
              last_error: null,
              provider_response: {
                provider: 'zernio',
                mode: 'sandbox',
                step: 'reconciled_existing_message',
                account_id: sandboxAccountId,
                conversation_id: conversationId,
                recipient: recipientDigits,
                raw: priorMsgCheck.rawResponse,
              },
            })
            .eq('id', event.id);

          results.push({
            eventId: event.id,
            bookingId: event.booking_id,
            eventType: event.event_type,
            status: 'sent',
            messageId: priorMsgCheck.matchedMessageId,
          });
          continue;
        }
      }

      // 5. Verified conversation exists: skip `sandbox_start` and send the booking notification text
      //    with Zernio's official `Idempotency-Key` header (`event.id` UUID).
      const sendRes = await sendZernioConversationMessage(
        conversationId,
        sandboxAccountId,
        messageText,
        config,
        event.id
      );

      if (sendRes.ok && sendRes.messageId) {
        sentCount += 1;
        await adminClient
          .from('whatsapp_notification_events')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            next_retry_at: null,
            provider_message_id: sendRes.messageId,
            last_error: null,
            provider_response: {
              provider: 'zernio',
              mode: 'sandbox',
              step: 'delivered',
              idempotent_replayed: sendRes.idempotentReplayed,
              account_id: sandboxAccountId,
              conversation_id: conversationId,
              recipient: recipientDigits,
              raw: sendRes.rawResponse,
            },
          })
          .eq('id', event.id);

        results.push({
          eventId: event.id,
          bookingId: event.booking_id,
          eventType: event.event_type,
          status: 'sent',
          messageId: sendRes.messageId,
        });
      } else {
        failedCount += 1;
        if (sendRes.isWindowClosed) {
          awaitingReplyCount += 1;
        }
        const errMsg = sendRes.isWindowClosed
          ? `24-hour Sandbox window closed or awaiting reply (${sendRes.errorMessage || 'window closed'}). Reply to the Zernio Sandbox chat from +91 6302543640, then click Retry.`
          : sendRes.errorMessage || 'Failed to send Zernio Sandbox message.';

        await adminClient
          .from('whatsapp_notification_events')
          .update({
            status: 'failed',
            next_retry_at: canRetry ? computeNextRetryIso(event.attempt_count) : null,
            provider_message_id: null,
            last_error: errMsg,
            provider_response: {
              provider: 'zernio',
              mode: 'sandbox',
              step: sendRes.isWindowClosed ? 'awaiting_sandbox_reply' : 'send_failed',
              sandbox_start_sent: true,
              awaiting_reply: sendRes.isWindowClosed,
              account_id: sandboxAccountId,
              conversation_id: conversationId,
              recipient: recipientDigits,
              http_status: sendRes.httpStatus,
              raw: sendRes.rawResponse,
            },
          })
          .eq('id', event.id);

        results.push({
          eventId: event.id,
          bookingId: event.booking_id,
          eventType: event.event_type,
          status: 'failed',
          awaitingReply: sendRes.isWindowClosed,
          error: errMsg,
        });
      }
    } catch (err) {
      failedCount += 1;
      const errMessage = err instanceof Error ? err.message : 'Unexpected Zernio dispatch error.';
      await adminClient
        .from('whatsapp_notification_events')
        .update({
          status: 'failed',
          next_retry_at: canRetry ? computeNextRetryIso(event.attempt_count) : null,
          provider_message_id: null,
          last_error: errMessage,
          provider_response: {
            provider: 'zernio',
            mode: 'sandbox',
            step: 'unexpected_error',
            account_id: sandboxAccountId,
            recipient: recipientDigits,
          },
        })
        .eq('id', event.id);

      results.push({
        eventId: event.id,
        bookingId: event.booking_id,
        eventType: event.event_type,
        status: 'failed',
        error: errMessage,
      });
    }
  }

  return jsonResponse({
    ok: true,
    whatsappEnabled: true,
    mode: 'sandbox',
    processed: events.length,
    sent: sentCount,
    failed: failedCount,
    awaitingReply: awaitingReplyCount,
    results,
  });
});
