// supabase/functions/sign-moment-urls/index.ts
// Mints short-lived signed URLs for private Moment photos ONLY after verifying
// the caller belongs to the couple AND (for partner photos) has posted today's Moment.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization') ?? '';

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();

  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { promptId } = (await req.json()) as { promptId?: string };
  if (!promptId) {
    return new Response(JSON.stringify({ error: 'Missing promptId' }), { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: moments, error } = await admin
    .from('moments')
    .select('*')
    .eq('prompt_id', promptId);

  if (error || !moments) {
    return new Response(JSON.stringify({ error: 'Prompt not found' }), { status: 404 });
  }

  const mine = moments.find((m) => m.user_id === user.id) ?? null;
  const partner = moments.find((m) => m.user_id !== user.id) ?? null;

  // Verify couple membership if caller hasn't posted yet
  if (!mine && partner) {
    const { data: couple } = await admin
      .from('couples')
      .select('id')
      .eq('id', partner.couple_id)
      .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`)
      .maybeSingle();

    if (!couple) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }
  }

  const pathsToSign: string[] = [];
  if (mine) {
    pathsToSign.push(mine.back_photo_path, mine.front_photo_path);
  }
  if (mine && partner) {
    pathsToSign.push(partner.back_photo_path, partner.front_photo_path);
  }

  const signedMap: Record<string, string> = {};
  if (pathsToSign.length > 0) {
    const { data: signed } = await admin.storage
      .from('moments')
      .createSignedUrls(pathsToSign, 3600);

    for (const item of signed ?? []) {
      if (item.path && item.signedUrl) {
        signedMap[item.path] = item.signedUrl;
      }
    }
  }

  return new Response(JSON.stringify({ urls: signedMap, unlocked: Boolean(mine && partner) }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
