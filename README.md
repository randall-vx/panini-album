# Album Panini FIFA 2026

App web para controlar el album de figuritas del Mundial 2026 en familia.
Login con Google, aprobacion de accesos y sincronizacion en tiempo real.

## Caracteristicas

- Grilla con la estructura oficial del album (994 figuritas), organizada por grupo (A-L) y con numero de pagina del album fisico
- Login con Google OAuth
- El admin aprueba o rechaza cada acceso desde la app
- Tres estados por figurita: Falta / Pegada / Repetida, con guardado confiable y reversion automatica si falla la conexion
- Listas de faltantes y repetidas agrupadas por seleccion, compartibles por WhatsApp
- Registro de actividad y exportacion de respaldo en JSON
- Modo carga rapida para ingresar una planilla ya empezada
- Sincronizacion en tiempo real entre dispositivos
- Seguridad con Row Level Security en Supabase
- Optimizada para mobile

## Uso

- **Tap en una figurita**: abre modal para marcar Falta / Pegada / Repetida
- **Carga rapida**: cada tap alterna el estado sin abrir el modal
- **Faltan / Repes**: listas agrupadas por seleccion con boton de compartir
- **Actividad**: ultimos 50 movimientos y boton de exportar respaldo
- **Admin**: aprobar o rechazar usuarios pendientes

## Stack

- Vanilla JS, sin build step
- [Supabase](https://supabase.com) — auth, base de datos y realtime
- GitHub Pages — hosting

## Configuracion

Ver [docs/configuracion.md](docs/configuracion.md) para la guia completa de setup.
El esquema de base de datos esta en [docs/schema.sql](docs/schema.sql).

## Licencia

MIT

---

Lo hice con mucho ❤️ para mi hijo Danielosky 🐧
