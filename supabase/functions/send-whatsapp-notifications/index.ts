import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import {
  buildTemplateRequestPayload,
  getMissingActivationRequirements,
  NotificationEventType,
  NotificationOutboxRow,
  readWhatsAppRuntimeConfig,
  sendMetaTemplateMessage,
  timingSafeEqualString,
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
  // 3. Verified authenticated Admin JWT (can dispatch all pending / retry specific event)
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

  // Activation check BEFORE claiming outbox rows so events remain safely queued
  // as 'pending' without incrementing attempt_count while Meta setup is incomplete.
  const missingRequirements = getMissingActivationRequirements(config);
  if (missingRequirements.length > 0) {
    return jsonResponse(
      {
        ok: true,
        queuedOnly: true,
        whatsappEnabled: config.enabled,
        message:
          'WhatsApp Cloud API delivery is currently paused until Meta setup and credentials are activated. Events remain safely queued in whatsapp_notification_events.',
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

  const events = Array.isArray(claimedRows) ? (claimedRows as NotificationOutboxRow[]) : [];
  if (events.length === 0) {
    return jsonResponse({
      ok: true,
      whatsappEnabled: true,
      processed: 0,
      sent: 0,
      failed: 0,
      results: [],
    });
  }

  let sentCount = 0;
  let failedCount = 0;
  const results: Array<{
    eventId: string;
    bookingId: string;
    eventType: NotificationEventType;
    status: 'sent' | 'failed';
    messageId?: string | null;
    error?: string | null;
  }> = [];

  for (const event of events) {
    try {
      const prepared = buildTemplateRequestPayload(event, config);
      const sendResult = await sendMetaTemplateMessage(prepared.body, config);

      if (sendResult.ok) {
        sentCount += 1;
        await adminClient
          .from('whatsapp_notification_events')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            next_retry_at: null,
            provider_message_id: sendResult.messageId,
            last_error: null,
            provider_response: sendResult.rawResponse,
          })
          .eq('id', event.id);

        results.push({
          eventId: event.id,
          bookingId: event.booking_id,
          eventType: event.event_type,
          status: 'sent',
          messageId: sendResult.messageId,
        });
      } else {
        failedCount += 1;
        const canRetry = event.attempt_count < event.max_attempts;
        await adminClient
          .from('whatsapp_notification_events')
          .update({
            status: 'failed',
            next_retry_at: canRetry ? computeNextRetryIso(event.attempt_count) : null,
            last_error: sendResult.errorMessage,
            provider_response: sendResult.rawResponse,
          })
          .eq('id', event.id);

        results.push({
          eventId: event.id,
          bookingId: event.booking_id,
          eventType: event.event_type,
          status: 'failed',
          error: sendResult.errorMessage,
        });
      }
    } catch (err) {
      failedCount += 1;
      const errMessage = err instanceof Error ? err.message : 'Unexpected WhatsApp dispatch error.';
      const canRetry = event.attempt_count < event.max_attempts;
      await adminClient
        .from('whatsapp_notification_events')
        .update({
          status: 'failed',
          next_retry_at: canRetry ? computeNextRetryIso(event.attempt_count) : null,
          last_error: errMessage,
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
    processed: events.length,
    sent: sentCount,
    failed: failedCount,
    results,
  });
});
