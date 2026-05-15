# Configuracion

Guia completa para configurar el proyecto desde cero. Son tres partes:
Supabase, Google OAuth y GitHub Pages. En total unos 30-40 minutos.

## Parte 1 — Supabase

1. Crear cuenta en https://supabase.com y crear un proyecto nuevo.
2. Ir a **SQL Editor > New query**, pegar todo el contenido de `schema.sql` y ejecutar.
3. En **Project Settings > API** copiar:
   - **Project URL** → `SUPABASE_URL` en `config.js`
   - **Publishable key** → `SUPABASE_ANON_KEY` en `config.js`

## Parte 2 — Google OAuth

1. Ir a https://console.cloud.google.com y crear un proyecto nuevo.
2. Buscar **Google Auth Platform** > **Audience** > confirmar tipo **External**.
3. Ir a **Clients** > **Create OAuth client** > tipo **Web application**.
   - **Authorized JavaScript origins**: `https://TU_USUARIO.github.io`
   - **Authorized redirect URIs**: `https://TU_PROYECTO.supabase.co/auth/v1/callback`
     (esta URL la encontras en Supabase > **Authentication > Providers > Google**)
4. Copiar el **Client ID** y el **Client Secret**.
5. En Supabase > **Authentication > Providers > Google**: activar y pegar ambos valores. Guardar.

## Parte 3 — URLs y despliegue

1. En Supabase > **Authentication > URL Configuration**:
   - **Site URL**: `https://TU_USUARIO.github.io/panini-album/`
   - **Redirect URLs**: `https://TU_USUARIO.github.io/panini-album/**`
2. Editar `config.js` con la URL y Publishable key de Supabase.
3. Subir el proyecto a GitHub y activar **Pages** en Settings > Pages > main / root.

## Primer uso

1. Entrar a la app publicada y hacer login con Google.
   El primer usuario queda como admin automaticamente.
2. Elegir apodo.
3. Compartir el link con la familia. Cuando entren apareceran como pendientes
   en la pestana **Admin**. Aprobarlos desde ahi.

## Promover admin manualmente

Si perdes acceso a la cuenta admin, desde el SQL Editor de Supabase:

```sql
-- Deshabilitar el trigger para poder editar desde el SQL Editor
alter table profiles disable trigger protect_profile_fields_trigger;

update profiles set is_admin = true, estado = 'aprobado'
where email = 'tu@email.com';

alter table profiles enable trigger protect_profile_fields_trigger;
```

## Ajustar nombres de selecciones

Los nombres en `data.js` siguen el formato `"Grupo X - PAGE | CODE"`:
- **X**: letra del grupo (A-L) segun el fixture FIFA 2026
- **PAGE**: pagina del album fisico donde aparece la seleccion
- **CODE**: codigo de 3 letras de la seleccion

Si en una edicion futura cambian los grupos o paginas, editar el array `TEAMS` en `data.js`.
Los numeros de pagina se leen de la planilla impresa oficial del album.

## Notas

- La capa gratuita de Supabase pausa el proyecto tras una semana sin uso.
  Se reactiva entrando al panel de Supabase.
- El **Client Secret** de Google va unicamente en Supabase, nunca en `config.js`.
- La Publishable key de Supabase es publica por diseno; la seguridad la dan las
  politicas RLS definidas en `schema.sql`.
