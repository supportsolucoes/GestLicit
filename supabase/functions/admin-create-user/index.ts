import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Método não permitido.' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace('Bearer ', '');
    if (!jwt) return json({ error: 'Não autenticado.' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser(jwt);
    if (userError || !userData?.user) return json({ error: 'Sessão inválida.' }, 401);

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: callerProfile, error: profileError } = await adminClient
      .from('app_profiles')
      .select('role')
      .eq('id', userData.user.id)
      .single();

    if (profileError || callerProfile?.role !== 'administrador') {
      return json({ error: 'Apenas administradores podem criar usuários.' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const { email, password, nome, role, paginas_permitidas, must_change_password } = body;

    if (!email || !password || !nome) {
      return json({ error: 'Informe nome, e-mail e senha.' }, 400);
    }
    if (password.length < 6) {
      return json({ error: 'A senha precisa ter pelo menos 6 caracteres.' }, 400);
    }
    if (role !== 'administrador' && role !== 'usuario') {
      return json({ error: 'Perfil inválido.' }, 400);
    }

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nome },
    });

    if (createError || !created?.user) {
      return json({ error: createError?.message || 'Erro ao criar usuário.' }, 400);
    }

    const { error: updateError } = await adminClient
      .from('app_profiles')
      .update({
        nome,
        role,
        paginas_permitidas: role === 'administrador' ? [] : (Array.isArray(paginas_permitidas) ? paginas_permitidas : []),
        ativo: true,
        must_change_password: must_change_password !== false,
      })
      .eq('id', created.user.id);

    if (updateError) return json({ error: updateError.message }, 400);

    return json({ success: true, id: created.user.id });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erro inesperado.' }, 500);
  }
});
