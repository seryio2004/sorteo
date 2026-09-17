# Sorteo QR + GitHub Pages

Web estática para realizar un sorteo presencial:

- el participante escanea un QR;
- introduce un **nombre único**;
- solo se permite una papeleta por `device_id` guardado en el navegador;
- la base de datos cierra la inscripción a la hora configurada;
- al llegar la hora, el sorteo se ejecuta en Supabase;
- todos los navegadores ven el mismo ganador;
- GitHub Actions hace una comprobación cada 5 minutos como fallback.

## Arquitectura

```text
QR
 │
 ▼
GitHub Pages
(index.html + CSS + JS)
 │
 │ publishable key
 ▼
Supabase PostgreSQL
 ├─ raffle_entries
 ├─ raffle_settings
 ├─ register_entry()
 ├─ get_public_state()
 └─ draw_if_due()
        ▲
        │ fallback cada 5 min
GitHub Actions
```

GitHub Pages sirve HTML/CSS/JS estático. La lista de participantes y la elección del ganador no se guardan en el navegador.

## 1. Crear Supabase

Crea un proyecto en Supabase.

En **SQL Editor**, pega y ejecuta:

```text
supabase/schema.sql
```

Al final del archivo encontrarás la configuración del sorteo:

```sql
insert into public.raffle_settings (
  id,
  title,
  registration_opens_at,
  registration_closes_at,
  draw_at
)
values (
  1,
  'Sorteo del evento',
  '2026-09-17 09:00:00+02',
  '2026-09-17 19:55:00+02',
  '2026-09-17 20:00:00+02'
)
...
```

Cambia título y fechas.

### Reiniciar el sorteo

Antes de crear un sorteo nuevo:

```sql
update public.raffle_settings
set winner_entry_id = null,
    winner_drawn_at = null
where id = 1;

delete from public.raffle_entries;
```

Después actualiza las fechas:

```sql
update public.raffle_settings
set
  title = 'Mi nuevo sorteo',
  registration_opens_at = '2026-10-10 18:00:00+02',
  registration_closes_at = '2026-10-10 21:55:00+02',
  draw_at = '2026-10-10 22:00:00+02',
  updated_at = now()
where id = 1;
```

## 2. Configurar la web

En Supabase abre **Project Settings > API**.

Copia:

- Project URL
- Publishable key

Edita `config.js`:

```js
export const SUPABASE_URL = "https://xxxx.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_xxxx";
```

La **publishable key** está pensada para usarse en navegador. El proyecto no necesita una secret/service_role key en el frontend.

## 3. Subir a GitHub

```bash
git init
git add .
git commit -m "Initial raffle site"
git branch -M main
git remote add origin git@github.com:TU_USUARIO/TU_REPO.git
git push -u origin main
```

En GitHub:

```text
Settings
→ Pages
→ Build and deployment
→ Source: Deploy from a branch
→ Branch: main
→ Folder: / (root)
→ Save
```

La URL quedará normalmente así:

```text
https://TU_USUARIO.github.io/TU_REPO/
```

## 4. Fallback automático con GitHub Actions

La web abierta por cualquier participante intentará ejecutar `draw_if_due()` justo cuando llegue la hora.

Además se incluye:

```text
.github/workflows/draw.yml
```

Este workflow llama a la misma función cada 5 minutos, así que también puede realizar el sorteo si nadie tiene la página abierta.

Añade en:

```text
Settings
→ Secrets and variables
→ Actions
→ New repository secret
```

estos secretos:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
```

No hace falta usar una service role key para este workflow porque `draw_if_due()` está diseñada para ser pública y no puede ejecutarse antes de la hora configurada.

## 5. QR

En la parte superior de la web hay un botón **Mostrar QR**.

Cuando la web esté desplegada en GitHub Pages, genera automáticamente un QR con la URL real de la página. Puedes enseñarlo en una pantalla o imprimirlo.

## Qué significa "una papeleta por persona"

El proyecto aplica dos controles:

1. un **nombre normalizado único** en la base de datos;
2. un único `device_id` por navegador/dispositivo.

Esto evita duplicados accidentales y que una misma instalación del navegador se registre dos veces.

Sin login, documento, correo verificado, código individual o algún otro identificador de identidad, una web pública no puede demostrar que dos dispositivos distintos pertenecen a la misma persona. Si necesitas un control fuerte de "una persona real = una papeleta", añade autenticación o entrega códigos únicos a los asistentes.

## Seguridad

- Las tablas tienen RLS activado.
- `anon` y `authenticated` no pueden consultar directamente las tablas.
- El navegador solo puede llamar a tres funciones SQL limitadas.
- El ganador no se expone antes de `draw_at`.
- La función `draw_if_due()` bloquea la fila de configuración para impedir que dos llamadas simultáneas generen dos ganadores.
- No subas nunca una Supabase secret/service_role key al repositorio.

## Desarrollo local

Al ser una web estática puedes usar:

```bash
python -m http.server 8080
```

y abrir:

```text
http://localhost:8080
```

No abras `index.html` directamente con `file://`, porque los imports ES modules funcionan mejor mediante un servidor HTTP local.

## Estructura

```text
.
├── index.html
├── styles.css
├── app.js
├── config.js
├── supabase/
│   └── schema.sql
├── .github/
│   └── workflows/
│       └── draw.yml
└── README.md
```
