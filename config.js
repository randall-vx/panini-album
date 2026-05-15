// ============================================
// CONFIGURACION - editar antes de usar
// ============================================
//
// Estos dos valores son PUBLICOS por diseno (van en el navegador).
// La seguridad real la dan el login con Google y las reglas RLS
// definidas en schema.sql. No hay ningun secreto en este archivo.
//
// IMPORTANTE: el "Client Secret" de Google OAuth NO va aca.
// Ese se pega unicamente en el panel de Supabase. Ver README.
//
// Donde sacar estos valores:
//   Supabase > Project Settings > API
//     - Project URL        -> SUPABASE_URL
//     - Project API keys > anon public -> SUPABASE_ANON_KEY
// ============================================

const CONFIG = {
  SUPABASE_URL: "https://xjuqhzrutopqbrlkkeea.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_ZwhLQ7s_6J5h3J9Si_54Hg_yzXuzc-N",

  // URL exacta donde queda publicada la app (GitHub Pages).
  // Se calcula sola y debe coincidir con la configurada en Google Cloud
  // y en Supabase. Para este repo:
  //   https://randall-vx.github.io/panini-album/
  REDIRECT_URL: window.location.origin + window.location.pathname
};
