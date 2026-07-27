const { createClient } = require('@supabase/supabase-js');
const supabaseServiceClient = require('../lib/supabase');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.split(' ')[1];

  // Verify the JWT using the anon client (validates the user token)
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = user;
  req.token = token;
  next();
}

// Middleware adicional para rutas de administración (panel de denuncias,
// ver server/routes/admin.js). Debe ir SIEMPRE después de requireAuth en
// la cadena (necesita req.user.id ya resuelto). Comprueba el flag
// is_admin de la fila del usuario con la service key — no se puede
// confiar en nada que venga del cliente para esta comprobación.
async function requireAdmin(req, res, next) {
  try {
    const { data, error } = await supabaseServiceClient
      .from('users')
      .select('is_admin')
      .eq('id', req.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data?.is_admin) {
      return res.status(403).json({ error: 'No tienes permisos de administración' });
    }
    next();
  } catch (err) {
    console.error('[auth] requireAdmin error:', err);
    res.status(500).json({ error: 'Error al verificar permisos' });
  }
}

module.exports = { requireAuth, requireAdmin };
