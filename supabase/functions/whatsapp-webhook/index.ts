import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import {
  readWhatsAppRuntimeConfig,
  timingSafeEqualString,
  verifyMetaWebhookSignature,
} from '../_shared/whatsapp.ts';

interface MetaWebhookStatus {
  id?: string;
  status?: string;
  timestamp?: string;
  recipient_id?: string;
  errors?: Array<{ code?: number; title?: string; message?: string }>;
}

interface MetaWebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        statuses?: MetaWebhookStatus[];
      };
    }>;
  }>;
}

Deno.serve(async (req: Request) => {
  const config = readWhatsAppRuntimeConfig();

  // 1. Meta Webhook URL Verification (GET)
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode') || '';
    const verifyToken = url.searchParams.get('hub.verify_token') || '';
    const challenge = url.searchParams.get('hub.challenge') || '';

    if (
      mode === 'subscribe' &&
      config.webhookVerifyToken &&
      timingSafeEqualString(verifyToken, config.webhookVerifyToken)
    ) {
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    return new Response('Forbidden', { status: 403 });
  }

  // 2. Meta Delivery Status Callbacks (POST)
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get('x-hub-signature-256');

  if (!config.metaAppSecret) {
    return new Response(
      JSON.stringify({ ok: false, error: 'META_APP_SECRET is not configured.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const signatureValid = await verifyMetaWebhookSignature(rawBody, signature, config.metaAppSecret);
  if (!signatureValid) {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid webhook signature.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = (Deno.env.get('SUPABASE_URL') || '').trim();
  const serviceRoleKey = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Supabase service credentials are missing.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let payload: MetaWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as MetaWebhookPayload;
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON payload.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let updatedCount = 0;
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const statuses = change.value?.statuses || [];
      for (const statusItem of statuses) {
        if (!statusItem.id) continue;

        const errMsg =
          Array.isArray(statusItem.errors) && statusItem.errors.length > 0
            ? statusItem.errors
                .map((e) => e.message || e.title || `Meta error ${e.code ?? ''}`)
                .join('; ')
            : null;

        const updateFields: Record<string, unknown> = {
          provider_response: {
            webhook_status: statusItem.status || null,
            webhook_timestamp: statusItem.timestamp || null,
            recipient_id: statusItem.recipient_id || null,
            errors: statusItem.errors || null,
          },
        };

        if (statusItem.status === 'failed' && errMsg) {
          updateFields.last_error = errMsg;
        }

        const { error } = await adminClient
          .from('whatsapp_notification_events')
          .update(updateFields)
          .eq('provider_message_id', statusItem.id);

        if (!error) {
          updatedCount += 1;
        }
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, updated: updatedCount }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
