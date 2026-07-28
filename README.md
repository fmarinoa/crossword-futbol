# crossword-futbol

Crucigrama web de categoría única "futbolera". El tablero se muestra colapsado; al hacer click en
una entrada se hace zoom, se muestra la pista, y al acertar se revelan las letras (incluidas las
celdas compartidas con entradas cruzadas).

React + Vite (frontend) + Cloudflare Workers/Durable Objects (backend). Cada partida vive en una
"sala" (`/room/<id>`) con un puzzle único generado dinámicamente en el servidor y progreso
persistente. Por ahora las salas son de un solo jugador: el id vive en la URL/localStorage por
conveniencia, sin auth ni sync entre dispositivos.

## Desarrollo

Dos procesos en paralelo:

```bash
pnpm install
pnpm run dev          # vite --host, puerto 5173
pnpm run worker:dev     # wrangler dev, puerto 8787 (API + Durable Object)
```

`vite.config.ts` proxea `/api/*` hacia `localhost:8787`, así que basta con abrir `localhost:5173`.

## Word bank

`data/word-bank.json` es la fuente de verdad de palabras/pistas, editada a mano. Cada entrada:
`{ id, answer, clue, category }`, con `answer` ya normalizado (MAYÚSCULAS, sin tildes ni espacios).
Solo lo importa el Worker (`worker/src/room.ts`) — el cliente nunca recibe el campo `answer`, la
validación de respuestas corre 100% server-side.

## Build y deploy

```bash
pnpm run build     # tsc -b && vite build
pnpm run deploy     # build + wrangler deploy
```

Un solo Worker sirve todo bajo el mismo dominio: assets estáticos (`dist/`) para todo lo que no
matchee `/api/*`, y la API + Durable Object `Room` para `/api/*`. Sin CORS ni en dev ni en prod.

## Estructura

```
data/word-bank.json            banco de palabras editable a mano (solo lo usa el Worker)
wrangler.jsonc                  config del Worker (assets + Durable Object binding)
worker/src/index.ts              rutas HTTP (crear sala, obtener sala, submit de respuesta)
worker/src/room.ts               Durable Object Room (storage + validación)
worker/src/generator.ts           generación de puzzles (subset selection + grid placement)
src/state/                        tipos, reducer, roomClient (fetch al backend)
src/components/                    GridView (grilla colapsada), ZoomOverlay (pista + respuesta)
```
