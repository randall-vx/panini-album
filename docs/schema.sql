-- ============================================================
-- ALBUM PANINI FIFA 2026 - Esquema de base de datos
-- ============================================================
--
-- USO: pegar todo este archivo en el SQL Editor de Supabase y
-- ejecutar una sola vez. Es idempotente: usa IF NOT EXISTS y
-- DROP IF EXISTS, por lo que re-ejecutarlo no rompe datos.
--
-- QUE CREA:
--   - 3 tablas: profiles, stickers, activity
--   - Row Level Security (RLS) en las 3 tablas
--   - 2 funciones helper en schema privado (is_admin, is_approved)
--   - 2 triggers: creacion automatica de perfil y proteccion de campos
--   - Publicacion de realtime para stickers y activity
--
-- FLUJO DE USUARIO NUEVO:
--   1. Usuario entra con Google OAuth → Supabase crea fila en auth.users
--   2. Trigger on_auth_user_created crea fila en profiles automaticamente
--   3. Si es el primer usuario del sistema → queda admin y aprobado
--   4. Si no → queda en estado 'pendiente' hasta que un admin lo apruebe
--   5. Una vez aprobado → puede ver y modificar stickers en tiempo real
--
-- ============================================================


-- ============================================================
-- TABLA: profiles
-- ============================================================
-- Una fila por usuario registrado. Extiende auth.users de Supabase
-- (que maneja la autenticacion) con datos propios de la app.
--
-- Columnas:
--   id        → mismo UUID que auth.users.id; ON DELETE CASCADE
--               elimina el perfil si se borra el usuario de auth
--   email     → copiado de auth.users al registrarse (via trigger)
--   apodo     → nombre elegido por el usuario, visible a todos
--               en los toasts de actividad en tiempo real
--   estado    → 'pendiente' al registrarse, 'aprobado' para acceder,
--               'rechazado' para bloquear sin borrar el registro
--   is_admin  → solo el primer usuario o quien un admin promueva;
--               protegido por trigger para evitar auto-promocion
--   created_at → para ordenar la lista en el panel admin (primeros arriba)
-- ============================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  apodo       text,
  estado      text not null default 'pendiente'
              check (estado in ('pendiente', 'aprobado', 'rechazado')),
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now()
);


-- ============================================================
-- TABLA: stickers
-- ============================================================
-- Una fila por figurita del album (994 en total segun el album FIFA 2026).
-- Los codigos se generan en data.js y se insertan desde la app.
--
-- Columnas:
--   code       → identificador unico de la figurita (MEX1, ARG12,
--                FWC00, CC3, etc.). Ver data.js para la estructura completa.
--   status     → 'falta' (no la tiene), 'pegada' (en el album),
--                'repe' (tiene duplicadas para tradear)
--   repe       → cantidad de copias extra disponibles para tradear.
--                Solo relevante cuando status = 'repe'; en los demas
--                casos se guarda como 0.
--   updated_by → quien hizo el ultimo cambio; ON DELETE SET NULL para
--                no perder el registro si el usuario se borra
--   updated_at → timestamp del ultimo cambio, para ordenar actividad
-- ============================================================
create table if not exists public.stickers (
  code        text primary key,
  status      text not null default 'falta'
              check (status in ('falta', 'pegada', 'repe')),
  repe        integer not null default 0 check (repe >= 0),
  updated_by  uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);


-- ============================================================
-- TABLA: activity
-- ============================================================
-- Log de auditoria: cada vez que un usuario cambia una figurita
-- (excepto en modo carga rapida) se inserta una fila aqui.
-- La app muestra los ultimos 50 movimientos en el tab Actividad
-- y emite un toast en tiempo real a los demas usuarios conectados.
--
-- Columnas:
--   id          → identity (bigint autoincrementado)
--   code        → codigo de la figurita modificada
--   action      → 'pegada', 'falta' o 'repe'
--   actor       → quien hizo el cambio (referencia a profiles)
--   actor_apodo → copiado de profiles.apodo al momento del insert
--                 para no perder el nombre si el usuario se borra
--   created_at  → indexado DESC para que las queries de "ultimos N"
--                 sean rapidas sin full scan
-- ============================================================
create table if not exists public.activity (
  id          bigint generated always as identity primary key,
  code        text not null,
  action      text not null,
  actor       uuid references public.profiles(id) on delete set null,
  actor_apodo text,
  created_at  timestamptz not null default now()
);

-- Indice para la query ORDER BY created_at DESC LIMIT 50 en loadActivity().
create index if not exists activity_created_idx on public.activity (created_at desc);


-- ============================================================
-- SCHEMA PRIVADO: funciones helper de RLS
-- ============================================================
-- Las funciones is_admin() e is_approved() se usan en todas las
-- politicas RLS. Las ponemos en el schema 'private' (no 'public')
-- porque PostgREST expone automaticamente todo lo que esta en
-- 'public' via /rest/v1/rpc/. En 'private' no son alcanzables
-- desde el cliente aunque tengan permisos de ejecucion.
-- ============================================================
create schema if not exists private;


-- Devuelve true si el usuario de la sesion actual tiene estado = 'aprobado'.
-- Se usa en todas las politicas de stickers y activity.
-- 'security definer' ejecuta con permisos del owner (postgres), no del
-- usuario que llama; esto permite leer profiles aunque el usuario aun
-- no tenga politica de SELECT sobre su propia fila.
-- 'stable' le dice a Postgres que el resultado no cambia dentro de una
-- misma transaccion, habilitando optimizaciones de cache de plan.
-- 'set search_path = public' evita ataques de search_path injection.
create or replace function private.is_approved()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and estado = 'aprobado'
  );
$$;


-- Devuelve true si el usuario de la sesion actual tiene is_admin = true.
-- Se usa en las politicas de profiles (admin ve y edita todos los perfiles).
create or replace function private.is_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_admin = true
  );
$$;


-- Si en alguna version anterior estas funciones existian en 'public',
-- las eliminamos con CASCADE para limpiar las politicas RLS que
-- pudieran depender de ellas; se recrean abajo con las nuevas.
drop function if exists public.is_approved() cascade;
drop function if exists public.is_admin() cascade;


-- ============================================================
-- TRIGGER: creacion automatica de perfil al registrarse
-- ============================================================
-- Cuando Supabase crea una fila en auth.users (primer login con Google),
-- este trigger crea automaticamente la fila correspondiente en profiles.
--
-- Razon de existir: la app asume que todo auth.user tiene un perfil.
-- Sin este trigger habria una ventana de tiempo (primer request post-login)
-- donde el perfil no existiria y la app mostraria error. La app reintenta
-- hasta 4 veces con 400ms de espera para cubrir latencia del trigger.
--
-- Primer usuario: queda como admin + aprobado para poder arrancar el
-- sistema sin necesidad de acceso directo a la DB. Cualquier usuario
-- posterior entra como 'pendiente' y necesita aprobacion manual.
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  user_count integer;
begin
  select count(*) into user_count from public.profiles;

  if user_count = 0 then
    -- Primer usuario del sistema: admin automatico para bootstrappear.
    insert into public.profiles (id, email, estado, is_admin)
    values (new.id, new.email, 'aprobado', true);
  else
    insert into public.profiles (id, email, estado, is_admin)
    values (new.id, new.email, 'pendiente', false);
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================
-- RLS garantiza que cada usuario solo vea y modifique lo que le
-- corresponde, incluso si alguien llama a la API directamente con
-- la anon key. Supabase aplica RLS en cada query automaticamente.
--
-- Reglas generales:
--   - Usuario no aprobado: no ve NADA (ninguna politica lo cubre)
--   - Usuario aprobado: ve todos los stickers y toda la actividad
--   - Admin: ademas ve y edita todos los perfiles
-- ============================================================
alter table public.profiles enable row level security;
alter table public.stickers enable row level security;
alter table public.activity enable row level security;


-- ---- PROFILES ----
--
-- SELECT: cada usuario ve solo su propio perfil; admin ve todos.
-- Necesario para que la app cargue el perfil propio al entrar
-- y para que el panel admin muestre la lista de usuarios.
drop policy if exists "profiles: ver propio o admin ve todos" on public.profiles;
create policy "profiles: ver propio o admin ve todos"
  on public.profiles for select
  using (id = (select auth.uid()) or private.is_admin());

-- UPDATE: cada usuario puede actualizar su propio perfil (apodo);
-- admin puede actualizar cualquiera (para cambiar estado o is_admin).
-- Una sola politica cubre ambos casos. El trigger protect_profile_fields
-- (mas abajo) se encarga de que un usuario comun no pueda cambiar
-- estado ni is_admin aunque la politica lo autorice a hacer el UPDATE.
drop policy if exists "profiles: editar propio perfil" on public.profiles;
drop policy if exists "profiles: admin actualiza cualquiera" on public.profiles;
drop policy if exists "profiles: actualizar perfil" on public.profiles;
create policy "profiles: actualizar perfil"
  on public.profiles for update
  using (id = (select auth.uid()) or private.is_admin())
  with check (id = (select auth.uid()) or private.is_admin());


-- ---- STICKERS ----
--
-- Solo usuarios aprobados pueden ver, insertar o actualizar stickers.
-- No hay politica de DELETE porque la app nunca borra figuritas;
-- los cambios de estado se hacen via UPDATE (upsert en la app).
drop policy if exists "stickers: ver si aprobado" on public.stickers;
create policy "stickers: ver si aprobado"
  on public.stickers for select
  using (private.is_approved());

drop policy if exists "stickers: insertar si aprobado" on public.stickers;
create policy "stickers: insertar si aprobado"
  on public.stickers for insert
  with check (private.is_approved());

drop policy if exists "stickers: actualizar si aprobado" on public.stickers;
create policy "stickers: actualizar si aprobado"
  on public.stickers for update
  using (private.is_approved())
  with check (private.is_approved());


-- ---- ACTIVITY ----
--
-- Solo usuarios aprobados pueden ver o insertar actividad.
-- No hay UPDATE ni DELETE: el log es append-only por diseno.
drop policy if exists "activity: ver si aprobado" on public.activity;
create policy "activity: ver si aprobado"
  on public.activity for select
  using (private.is_approved());

drop policy if exists "activity: insertar si aprobado" on public.activity;
create policy "activity: insertar si aprobado"
  on public.activity for insert
  with check (private.is_approved());


-- ============================================================
-- TRIGGER: proteccion contra auto-promocion
-- ============================================================
-- Problema que resuelve: RLS permite que un usuario aprobado haga
-- UPDATE sobre su propio perfil (para cambiar el apodo). Pero esa
-- misma politica le daria la posibilidad de enviar un payload con
-- is_admin=true o estado='aprobado' en el body del request.
--
-- RLS no puede comparar OLD vs NEW en un WITH CHECK, por eso no
-- alcanza con la politica sola. Este trigger revierte cualquier
-- intento de cambiar estado, is_admin o email si quien ejecuta
-- el UPDATE no es admin.
--
-- IMPORTANTE para desarrollo: cuando se edita profiles desde el
-- SQL Editor de Supabase, auth.uid() devuelve NULL (no hay sesion
-- de usuario), por lo que is_admin() retorna false y el trigger
-- revierte los cambios. Siempre deshabilitar antes de editar:
--
--   alter table profiles disable trigger protect_profile_fields_trigger;
--   -- hacer cambios --
--   alter table profiles enable trigger protect_profile_fields_trigger;
-- ============================================================
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if not private.is_admin() then
    new.estado   := old.estado;
    new.is_admin := old.is_admin;
    new.email    := old.email;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_fields_trigger on public.profiles;
create trigger protect_profile_fields_trigger
  before update on public.profiles
  for each row execute function public.protect_profile_fields();


-- ============================================================
-- REALTIME
-- ============================================================
-- Agrega stickers y activity a la publicacion de Supabase Realtime
-- para que los cambios se transmitan en tiempo real a todos los
-- clientes conectados (via WebSocket). La app se suscribe en
-- subscribeRealtime() en app.js.
--
-- El bloque DO...EXCEPTION ignora el error si la tabla ya estaba
-- en la publicacion (re-ejecucion del script).
-- ============================================================
do $$ begin
  alter publication supabase_realtime add table public.stickers;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.activity;
exception when duplicate_object then null; end $$;


-- ============================================================
-- SEGURIDAD: revocar ejecucion directa de funciones de trigger
-- ============================================================
-- Al crear una funcion en PostgreSQL, se le otorga automaticamente
-- EXECUTE a PUBLIC (todos los roles, incluido anon). Aunque estas
-- funciones no hacen nada util si se llaman directamente, es buena
-- practica revocar ese permiso para minimizar superficie de ataque.
--
-- Nota: is_admin e is_approved ya estan protegidas por estar en el
-- schema 'private' (PostgREST no las expone), pero revocamos igual
-- como defensa en profundidad.
-- ============================================================
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.protect_profile_fields() from public;


-- ============================================================
-- PROXIMOS PASOS (ver README para instrucciones detalladas)
-- ============================================================
-- 1. Habilitar Google OAuth en Supabase:
--    Authentication > Providers > Google
--    Necesitas Client ID y Secret de Google Cloud Console.
--
-- 2. Configurar URLs en Supabase:
--    Authentication > URL Configuration
--    Site URL y Redirect URLs deben coincidir exactamente con
--    la URL donde este publicada la app (GitHub Pages o localhost).
--
-- 3. Completar config.js con SUPABASE_URL y SUPABASE_ANON_KEY.
--    Ambos valores estan en Supabase > Project Settings > API.
--
-- 4. El primer usuario que entre con Google queda como admin.
--    Desde el tab Admin de la app puede aprobar al resto.
-- ============================================================
