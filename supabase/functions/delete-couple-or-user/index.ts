// supabase/functions/delete-couple-or-user/index.ts
// Purges all private Storage objects in `moments/{couple_id}/...` and deletes either:
// - mode = 'unpair': dissolves the couple & cascades shared moments/statuses/streaks/locations
// - mode = 'delete_account': wipes storage, couple, public.users row, and auth.users identity

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
    error: authErr,
  } = await userClient.auth.getUser();

  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { mode = 'delete_account' } = (await req.json().catch(() => ({}))) as {
    mode?: 'unpair' | 'delete_account';
  };

  const admin = createClient(supabaseUrl, serviceKey);

  // Locate caller's couple to purge shared storage folder
  const { data: couple } = await admin
    .from('couples')
    .select('id')
    .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`)
    .maybeSingle();

  if (couple?.id) {
    const { data: dateFolders } = await admin.storage.from('moments').list(couple.id);
    for (const folder of dateFolders ?? []) {
      const { data: files } = await admin.storage
        .from('moments')
        .list(`${couple.id}/${folder.name}`);
      const paths = (files ?? []).map((f) => `${couple.id}/${folder.name}/${f.name}`);
      if (paths.length > 0) {
        await admin.storage.from('moments').remove(paths);
      }
    }
    await admin.from('couples').delete().eq('id', couple.id);
  }

  if (mode === 'delete_account') {
    await admin.from('users').delete().eq('id', user.id);
    const { error: deleteAuthErr } = await admin.auth.admin.deleteUser(user.id);
    if (deleteAuthErr) {
      return new Response(JSON.stringify({ error: deleteAuthErr.message }), { status: 500 });
    }
  }

  return new Response(JSON.stringify({ ok: true, mode }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
