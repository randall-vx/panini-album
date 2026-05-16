# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Album Panini FIFA 2026** is a web application for family coordination of FIFA 2026 Panini sticker album collection. It provides:
- Google OAuth login with approval workflow
- Real-time synchronization across devices
- Admin-controlled user access management
- Sticker status tracking (missing/pasted/duplicates)
- Activity logging
- Export/backup functionality

The app is a vanilla JavaScript single-page application (no build step) published to GitHub Pages, with Supabase as the backend for authentication, database, and real-time features.

## File Structure

```
panini-album/
  index.html            # Single-page HTML with screens for login, pending, nickname, and main app
  app.js                # Core application logic
  data.js               # Album structure: teams, sticker codes, special blocks
  config.js             # Supabase credentials configuration (template - user must fill in)
  styles.css            # Styling for mobile-optimized UI
  manifest.json         # PWA manifest (name, icons, colors, display mode)
  sw.js                 # Service worker: cache-first for static assets, network for Supabase/Google
  icons/                # PWA icons: apple-touch-icon.png, icon-192.png, icon-512.png, SVG variants
  docs/
    schema.sql          # Database schema, RLS policies, and triggers for Supabase
    configuracion.md    # Spanish setup guide for Supabase, Google OAuth, and GitHub Pages
  README.md             # Project overview and quick reference
```

**Criterio de organización:** solo van en el root los archivos que el browser sirve directamente o que GitHub Pages necesita encontrar ahí (`sw.js` y `manifest.json` deben estar en root para que el scope del service worker cubra toda la app). Archivos de infraestructura/setup que no se sirven al browser van en `docs/`.

## Architecture

### Frontend Architecture

**Single Page with Screen Management:**
- Five UI screens managed by `showScreen()` function: login, pending, nickname, app (main), and admin
- State object stores: session, profile, stickers (dictionary by code), activity log, quickLoad flag, online status, completedTeams (Set), filterComplete flag
- Minimal dependencies: only Supabase client library loaded via CDN

**Key Application Phases:**
1. **Authentication**: `initSupabase()` → `handleAuth()` → Google OAuth redirect or session recovery
2. **Profile Loading**: `loadProfileAndRoute()` checks approval status and routes user
3. **App Entry**: `enterApp()` loads data, subscribes to real-time, renders UI
4. **Real-time Sync**: `subscribeRealtime()` listens to `stickers` and `activity` table changes

**Data Management:**
- Local cache: stores stickers state in localStorage with key `panini2026_cache`
- Server state: all data lives in Supabase, browser is thin client
- Render cycle: `renderAll()` updates DOM based on `state.stickers` object

### Album Data Structure

Sticker codes follow the official Panini structure (994 total):
- **FWC Intro block**: "FWC00", "FWC1"–"FWC8" (9 stickers)
- **48 Teams**: each team has 20 stickers (e.g., "MEX1"–"MEX20")
  - Exception: Croatia ("CRO") uses zero-padding ("CRO01"–"CRO020")
- **FWC Closing block**: "FWC9"–"FWC19" (11 stickers)
- **Coca-Cola block**: "CC1"–"CC14" (14 stickers)

To adjust for structure changes, edit `data.js`:
- `TEAMS`: array of `{ code, name }` in exact planilla order. `name` sigue el formato `"Grupo X - PAGE | CODE"` donde X es la letra del grupo (A-L), PAGE es la página del álbum físico donde aparece la selección, y CODE es el código de 3 letras. Ejemplo: `"Grupo L - 104 | PAN"`. Los números de página vienen de la planilla oficial impresa del álbum.
- `STICKERS_PER_TEAM`: quantity per team (typically 20)
- `ZERO_PADDED_TEAMS`: teams requiring zero-padding in codes
- `SPECIAL_BLOCKS`: non-standard blocks with explicit IDs and labels

### Backend & Database

**Supabase Tables:**
- `profiles`: user info, approval state, admin flag, nickname
- `stickers`: sticker code, status (falta/pegada/repe), duplicate count, who updated, when
- `activity`: movement log for audit trail

**Row Level Security (RLS):**
- Unapproved users see nothing
- Approved users see their own profile and all stickers/activity
- Admin users see all profiles and can approve/reject access
- Users cannot self-promote: triggers revert `estado` and `is_admin` changes on non-admin updates

**Automatic User Setup:**
- On first Google login, a trigger creates a profile
- First user becomes admin and approved automatically
- Subsequent users enter "pending" state until admin approval

**User Roles (`profiles.estado`):**
- `pendiente`: newly registered, no access until admin approves
- `aprobado`: full access — can view and edit stickers, see activity, interact with all tabs
- `solo_lectura`: read-only access — can only view Faltan and Repes tabs; cannot write stickers, log activity, or see the grid/activity/admin tabs; no UI controls (quickload, filter, repe minus buttons) are rendered
- `rechazado`: blocked; no access, profile kept for audit
- Admin routes `solo_lectura` profiles to `enterReadonlyApp()` which sets `document.body.classList.add("is-readonly")` and hides restricted tabs via CSS
- DB enforcement: `private.is_viewer()` (aprobado OR solo_lectura) gates sticker SELECT; `private.is_approved()` (aprobado only) gates INSERT/UPDATE — so even if JS is bypassed, the DB rejects writes

**Real-time Subscriptions:**
- Supabase publication `supabase_realtime` includes `stickers` and `activity` tables
- App subscribes via `sb.channel("stickers-changes")` and updates state on INSERT/UPDATE/DELETE events

## Configuration

Before deploying, **configure `config.js`** with Supabase credentials (public values only):
- `SUPABASE_URL`: Project URL from Supabase > Project Settings > API
- `SUPABASE_ANON_KEY`: Anon public key from Supabase > Project Settings > API
- `REDIRECT_URL`: Auto-calculated from window location; must match Google Cloud and Supabase URL configs

**Important:** Never commit the Google OAuth Client Secret—it only goes in Supabase Authentication > Providers > Google.

## Development & Deployment

### Running Locally

No build process. Serve the directory with any HTTP server for local development:
```bash
# Python 3
python -m http.server 8000

# Node (if you have http-server installed)
npx http-server .

# macOS/Linux with Python 2
python -m SimpleHTTPServer 8000
```

Open `http://localhost:8000` and configure `config.js` with test Supabase credentials.

### Deploying to GitHub Pages

1. Ensure `config.js` has production Supabase credentials
2. Commit and push to GitHub (branch configured in repo settings for Pages)
3. GitHub Pages serves the `index.html` at `https://[username].github.io/[repo]/`
4. Must match URL configured in Google Cloud Console (authorized origin) and Supabase (Site URL and Redirect URLs)

## Key Implementation Details

**Quick Load Mode (`state.quickLoad`):**
- When active, sticker taps toggle between falta/pegada immediately without modal
- Does not log to activity table (prevents spam)
- Disable by clicking "Carga rápida" button again

**Modal Interaction:**
- Tapping a sticker abre un bottom sheet con botones Falta, Pegada, y +/− para repetidas
- Tocar Falta o Pegada llama `updateSticker()` y cierra el sheet automáticamente (auto-close 150ms)
- Tocar fuera del sheet también cierra
- Modal state is in the DOM, not in `state` object

**`updateSticker()` — escritura a la DB:**
- Usa optimistic update: actualiza `state.stickers[code]` y re-renderiza ANTES de confirmar con Supabase
- Guarda el estado anterior en `prev` para poder revertir si el upsert falla
- Usa `.upsert({ onConflict: "code" }).select()` — el `.select()` es esencial: si RLS bloquea silenciosamente la escritura, `data` llega vacío y se puede detectar sin depender del campo `error`
- Si falla (error de red, token expirado, RLS) o `data` llega vacío: revierte `state.stickers[code]` a `prev`, llama `renderAll()` y muestra mensaje con el error exacto de Supabase en consola (`[updateSticker] Error al guardar:`)
- Si la escritura es bloqueada por RLS sin error HTTP: log `[updateSticker] Upsert sin efecto (RLS?):` en consola

**Grilla — índice y filtro:**
- `renderTeamsIndex()` genera chips horizontales fijos (`position: sticky`) bajo los tabs para saltar directamente a cada equipo
- Cada bloque tiene barra de progreso delgada y header verde con ✓ al completarse
- La animación de equipo completo (`.newly-complete`) corre una sola vez gracias a `state.completedTeams` (Set que persiste en memoria); los renders siguientes usan solo `.complete`
- Botón "Ocultar completos" usa `state.filterComplete` para omitir bloques en `renderGrid()`

**Repetidas:**
- `repe-count` muestra la suma de todos los valores `repe` (figuritas disponibles), no la cantidad de códigos
- Los grupos siguen el mismo orden que la grilla (`GRID_BLOCKS`): FWC intro → 48 selecciones en orden de planilla → FWC cierre → Coca-Cola
- Botón −1 en cada chip usa event delegation en `setupRepeChipMinus()` — no se re-registra en cada render

**Tiempo real y feedback:**
- Toast (`showToast()`) aparece cuando otro usuario marca una figurita, extraído del canal `activity-changes`
- Haptic feedback (`haptic()`) en cada tap de sticker via `navigator.vibrate()`
- Pull-to-refresh detecta gesto táctil desde `scrollY === 0`; recarga stickers y actividad

**Reconexión automática de Realtime (`onChannelStatus`):**
- `subscribeRealtime()` pasa `onChannelStatus` como callback al canal `stickers-changes`
- Si el canal cae (`CHANNEL_ERROR`, `TIMED_OUT`, `CLOSED`): muestra toast "Reconectando..." y programa un retry en 5s via `realtimeRetryTimer`; el retry llama `sb.removeAllChannels()` + `subscribeRealtime()` para recrear ambos canales
- Al reconectarse (`SUBSCRIBED` tras una caida): muestra toast "Sincronizado" y llama `loadStickers()` para recuperar eventos perdidos durante la desconexión
- `realtimeDisconnected` (flag global) evita que el toast "Reconectando..." spamee si el canal falla repetidas veces antes de reconectarse

**Búsqueda rápida de figuritas:**
- Ícono de lupa en el topbar abre un overlay de búsqueda (`#search-overlay`)
- `setupSearch()` / `renderSearchResults()` en `app.js`: filtra `ALL_STICKERS` por prefijo del código (case-insensitive) en tiempo real
- Muestra hasta 40 resultados con código, equipo y estado coloreado (Falta / Pegada / Repe x N)
- Tocar un resultado cierra el overlay y abre el modal de esa figurita
- Se cierra con ✕, toque fuera del box, o tecla Escape

**Leyenda — agrupación de botones:**
- "Carga rapida" y "Ocultar completos" están dentro de `.legend-btns` con `margin-left: auto` para que siempre queden en la misma línea que los indicadores de estado
- No usar `margin-left: auto` directamente sobre `.quickload-btn`; el wrapper `.legend-btns` es quien empuja al lado derecho

**Preservación de scroll al actualizar:**
- `renderGrid()` guarda `window.scrollY` antes de reconstruir el `innerHTML` y lo restaura con `requestAnimationFrame(() => window.scrollTo(0, scrollY))` para que el usuario no pierda su posición al marcar una figurita
- El restore solo se ejecuta si `scrollY > 0` para evitar calls innecesarios

**Scroll preciso desde índice de equipos y selector de grupos:**
- Nunca usar `scrollIntoView({ block: "start" })` en esta app — ignora los sticky headers y el título queda oculto debajo de ellos
- Patrón correcto en ambos casos (chips del índice y chips de grupo):
  ```js
  const stickyBottom = document.getElementById("teams-index").getBoundingClientRect().bottom;
  const y = target.getBoundingClientRect().top + window.scrollY - stickyBottom - 8;
  window.scrollTo({ top: y, behavior: "smooth" });
  ```
- Para el selector de grupos, `target` es el primer `.team-block` visible tras el render del filtro

**Pull-to-refresh:**
- Usar `window.scrollY > 5` en lugar de `window.scrollY !== 0` — en móvil el scroll puede ser un valor fraccionario (0.33px) por subpixel rendering y el check estricto falla aunque el usuario esté en el tope
- Incluir listener `touchcancel` para limpiar el estado si el gesto se interrumpe (notificación, llamada entrante, etc.)

**Badge de Admin:**
- `updateAdminBadge(profiles)` se llama desde `loadAdminList()` y muestra un punto rojo con el conteo de usuarios pendientes sobre el tab Admin

**Seguridad en schema.sql:**
- `is_admin()` e `is_approved()` viven en schema `private` (no expuesto por PostgREST) para evitar llamadas directas via RPC
- `security definer` en funciones y triggers ejecuta con permisos del owner (postgres), no del usuario que llama
- `set search_path = public` en cada función previene ataques de search_path injection
- `stable` en las funciones helper habilita cache de plan dentro de la misma transacción
- Funciones trigger tienen `REVOKE EXECUTE FROM PUBLIC` — PostgreSQL otorga EXECUTE a PUBLIC implícitamente al crear funciones; hay que revocarlo explícitamente
- RLS no puede comparar OLD vs NEW en WITH CHECK; por eso existe el trigger `protect_profile_fields` para prevenir auto-promoción a admin
- Al editar profiles desde el SQL Editor de Supabase, `auth.uid()` es NULL — el trigger revertirá los cambios. Deshabilitar antes de editar:
  ```sql
  alter table profiles disable trigger protect_profile_fields_trigger;
  -- hacer cambios --
  alter table profiles enable trigger protect_profile_fields_trigger;
  ```

**Documentación de schema.sql:**
- Cada tabla tiene comentario por columna explicando propósito y decisiones de diseño (ON DELETE CASCADE vs SET NULL, por qué se copia actor_apodo, etc.)
- Cada función y trigger documenta el problema que resuelve, no solo lo que hace
- Las secciones de RLS explican quién ve qué y por qué no alcanza con una sola política
- El script es idempotente: usa IF NOT EXISTS y DROP IF EXISTS; se puede re-ejecutar sin romper datos

**PWA — instalación desde Chrome e iOS:**
- `manifest.json`: nombre, short_name, colores, orientación portrait, íconos PNG
- `sw.js`: service worker con estrategia cache-first para assets estáticos; Supabase, Google OAuth y Google Fonts siempre van por red directa
- Íconos en `icons/`: `icon-192.png`, `icon-512.png` (manifest Chrome/Android), `apple-touch-icon.png` 180×180 (iOS), `icon.svg` / `icon-maskable.svg` (SVG de respaldo)
- Los PNGs se generan con Pillow (`python3`) — gradiente `#00d68f → #4a9eff`, texto "26" centrado, bordes redondeados
- Cache name: `panini-v1` — bumpearlo en `sw.js` al hacer cambios para que los clientes instalados reciban la actualización
- En iOS: Safari → compartir → "Agregar a pantalla de inicio". En Chrome/Android: banner automático o menú → "Instalar app"

**Responsive Design:**
- 4 columnas en pantallas ≤360px, 5 en mobile estándar, 10 en ≥480px
- CSS usa flexbox y grid; `viewport` con no-zoom
- PWA instalable en iOS y Android

## Common Edits

**Adjust Team List or Sticker Structure:**
Edit `data.js` and re-run `schema.sql` to reset the `stickers` table with new codes.

**Change Approval Workflow:**
Modify `is_approved()` and related policies in `schema.sql`. Trigger in `handle_new_user()` sets first user as admin. To add new user roles, update `profiles.estado` constraint in `schema.sql` and the routing checks in `app.js`.

## Database Initialization

To set up a new Supabase project:
1. Copy entire `schema.sql` to Supabase SQL Editor
2. Execute to create tables, policies, triggers, and real-time publications
3. Enable Google OAuth in Supabase Authentication > Providers
4. Add exact URLs to Google Cloud Console and Supabase URL Configuration

If you need to manually promote a user to admin in Supabase SQL Editor:
```sql
alter table profiles disable trigger protect_profile_fields_trigger;
update profiles set is_admin = true, estado = 'aprobado' where email = 'user@example.com';
alter table profiles enable trigger protect_profile_fields_trigger;
```

## Debugging Tips

- Check browser console for Supabase errors (auth, RLS violations)
- Verify `config.js` URLs match exactly across Google Cloud, Supabase, and browser
- If login redirects to blank page: check Supabase "Redirect URLs" configuration
- If data doesn't sync: check Supabase real-time publication includes `stickers` and `activity`
- If user stays in pending: check admin approved the user in the Admin tab
- Check localStorage (`panini2026_cache`) for locally cached sticker state
