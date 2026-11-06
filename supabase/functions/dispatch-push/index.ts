// supabase/functions/dispatch-push/index.ts
// Dispatches APNs / Expo Push / FCM notifications for:
// 1) Daily Moment 2-minute window alerts
// 2) Mandatory partner alert whenever location_shares.mode changes
// 3) Partner Nudge / Poke + silent background widget timeline refresh

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface PushEventBody {
  eventId?: string;
  coupleId: string;
  actorId?: string;
  eventType: 'daily_prompt' | 'location_mode_changed' | 'nudge' | 'moment_posted';
  payload?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!serviceKey || !authHeader.includes(serviceKey)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const body = (await req.json()) as PushEventBody;
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);

  const { data: couple } = await admin
    .from('couples')
    .select('id, user_a_id, user_b_id')
    .eq('id', body.coupleId)
    .maybeSingle();

  if (!couple || !couple.user_b_id) {
    return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
  }

  const { data: users } = await admin
    .from('users')
    .select('id, display_name, push_token')
    .in('id', [couple.user_a_id, couple.user_b_id]);

  const actor = users?.find((u) => u.id === body.actorId);
  const actorName = actor?.display_name ?? 'Your partner';

  const recipients =
    body.eventType === 'daily_prompt'
      ? (users ?? [])
      : (users ?? []).filter((u) => u.id !== body.actorId);

  const messages = recipients
    .filter((r) => Boolean(r.push_token))
    .map((r) => {
      let title = 'KeepIt';
      let messageBody = 'Open KeepIt to check in together.';

      if (body.eventType === 'daily_prompt') {
        title = 'Time for today’s Moment (2:00)';
        messageBody = 'Capture your front and back Moment together within 2 minutes.';
      } else if (body.eventType === 'location_mode_changed') {
        const nextMode = String(body.payload?.new_mode ?? 'ghost');
        const label =
          nextMode === 'live'
            ? 'turned ON Live location sharing'
            : nextMode === 'on_moment'
              ? 'switched location sharing to Only on Moment'
              : 'turned OFF location sharing (Ghost mode)';
        title = 'Location privacy updated';
        messageBody = `${actorName} ${label}.`;
      } else if (body.eventType === 'nudge') {
        const note = String(body.payload?.note ?? 'Thinking of you');
        title = `${actorName} nudged you`;
        messageBody = note;
      } else if (body.eventType === 'moment_posted') {
        title = `${actorName} posted today’s Moment`;
        messageBody = 'Post yours to reveal both photos side by side.';
      }

      return {
        to: r.push_token,
        sound: 'default',
        title,
        body: messageBody,
        contentAvailable: true, // wakes iOS WidgetKit / Android Glance silent refresh
        data: {
          eventType: body.eventType,
          coupleId: body.coupleId,
          deepLink: 'keepit://',
        },
      };
    });

  if (messages.length > 0) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });
  }

  return new Response(JSON.stringify({ sent: messages.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
