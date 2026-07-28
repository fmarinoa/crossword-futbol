# crossword-futbol

Crucigrama web de categoría única "futbolera". El tablero se muestra colapsado; al hacer click en
una entrada se hace zoom, se muestra la pista, y al acertar se revelan las letras (incluidas las
celdas compartidas con entradas cruzadas).

SPA estática (React + Vite), sin backend. Los puzzles se generan algorítmicamente en build time,
no en el navegador.

## Desarrollo

```bash
pnpm install
pnpm run dev
```

## Generar puzzles

Los puzzles estáticos (`public/puzzles/puzzle-NN.json` + `manifest.json`) se generan a partir de
`data/word-bank.json` con:

```bash
node scripts/generate-puzzles.mjs
```

Flags opcionales:

```bash
node scripts/generate-puzzles.mjs --count=10 --out=public/puzzles --bank=data/word-bank.json
```

El script termina con exit code distinto de 0 si no logra producir puzzles válidos y diversos
(por banco de palabras insuficiente). Nunca falla en runtime frente al usuario.

Para agregar palabras, editar `data/word-bank.json` (respuestas en MAYÚSCULAS, sin tildes ni
espacios) y volver a correr el generador.

## Build

```bash
pnpm run build
```

Corre `tsc -b` y `vite build`. Recordá correr el generador de puzzles antes de deployar si
cambiaste el banco de palabras — el build de Vite no regenera `public/puzzles/` automáticamente.

## Deploy

SPA estática: sirve el contenido de `dist/` en Netlify, Vercel, GitHub Pages o cualquier hosting
estático.

## Estructura

```
data/word-bank.json          banco de palabras editable a mano
scripts/generate-puzzles.mjs generador de puzzles (build time)
public/puzzles/               puzzles pre-generados + manifest
src/state/                    tipos, validador, reducer
src/components/                GridView (grilla colapsada), ZoomOverlay (pista + respuesta)
src/utils/rotation.ts          rotación de puzzles vía localStorage
```
