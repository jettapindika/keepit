// supabase/functions/schedule-daily-prompts/index.ts
// Invoked daily via pg_cron to schedule a random synchronized UTC trigger_at
// within each active couple's overlapping waking hours (09:00..21:00 local).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function localHourOffsetSeconds(tz: string, utcMidnight: Date): [number, number] {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      hour12: false,
    });
    const hourAtUtcMidnight = Number(formatter.format(utcMidnight)) % 24;
    // Waking window 09:00..21:00 local mapped into seconds after UTC midnight
    const startSec = ((9 - hourAtUtcMidnight + 24) % 24) * 3600;
    const endSec = startSec + 12 * 3600;
    return [startSec, endSec];
  } catch {
    return [9 * 3600, 21 * 3600];
  }
}

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!serviceKey || !authHeader.includes(serviceKey)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
  const todayIso = new Date().toISOString().slice(0, 10);
  const utcMidnight = new Date(`${todayIso}T00:00:00.000Z`);

  const { data: couples, error } = await supabase
    .from('couples')
    .select('id, user_a_id, user_b_id')
    .eq('state', 'active');

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  let scheduled = 0;
  for (const couple of couples ?? []) {
    const { data: users } = await supabase
      .from('users')
      .select('id, timezone')
      .in('id', [couple.user_a_id, couple.user_b_id].filter(Boolean));

    const tzA = users?.[0]?.timezone ?? 'UTC';
    const tzB = users?.[1]?.timezone ?? tzA;
    const [aStart, aEnd] = localHourOffsetSeconds(tzA, utcMidnight);
    const [bStart, bEnd] = localHourOffsetSeconds(tzB, utcMidnight);

    const overlapStart = Math.max(aStart, bStart);
    const overlapEnd = Math.min(aEnd, bEnd);

    const [winStart, winEnd] =
      overlapEnd - overlapStart >= 1800
        ? [overlapStart, overlapEnd]
        : [12 * 3600, 20 * 3600];

    const chosenSec =
      (winStart + Math.floor(Math.random() * Math.max(1, winEnd - winStart))) % 86400;
    const triggerAt = new Date(utcMidnight.getTime() + chosenSec * 1000).toISOString();

    const { error: upsertErr } = await supabase.from('daily_prompts').upsert(
      {
        couple_id: couple.id,
        prompt_date: todayIso,
        trigger_at: triggerAt,
      },
      { onConflict: 'couple_id,prompt_date', ignoreDuplicates: true }
    );

    if (!upsertErr) scheduled += 1;
  }

  return new Response(JSON.stringify({ date: todayIso, scheduled }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
