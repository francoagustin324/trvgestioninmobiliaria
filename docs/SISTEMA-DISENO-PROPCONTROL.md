# Sistema de diseño PropControl — "Liquid Glass" (0 AI slop)

> Documento para el rediseño visual de PropControl. Objetivo: look premium, moderno,
> con efecto vidrio líquido, fondo en movimiento y animaciones con gusto — sin que
> parezca "hecho por IA".

---

## ⛔ LO PRIMERO (leer antes de tocar nada) — El stack de PropControl NO es React

El sistema de diseño de referencia venía escrito para **React + Tailwind v4 + framer-motion + lucide-react**. **PropControl NO usa nada de eso.** PropControl es:

- **TypeScript + HTML + CSS a mano** (sin framework, sin React, sin Tailwind, sin JSX).
- La interfaz se arma con **plantillas de strings HTML** dentro de los archivos `src/*-ui.ts` (usando `innerHTML`).
- Los estilos son **archivos CSS** en `src/` (`mvp.css`, `styles.css`, etc.).

**Si se copia el sistema tal cual (React/Tailwind), la única forma de aplicarlo sería reescribir toda la app a otro stack → se rompe TODO, incluido el trabajo de seguridad ya publicado.** Eso está prohibido.

**La buena noticia:** el efecto liquid glass, las luces/sombras/brillos, el fondo en movimiento y TODAS las animaciones se logran con **CSS puro + un poco de JavaScript vanilla**. No hacen falta ni React, ni Tailwind, ni framer-motion, ni lucide-react. Este documento es la receta ya traducida a lo que PropControl sí usa.

### Reglas duras para Codex (no negociables)

1. **NO** agregar React, Tailwind, framer-motion, lucide-react, ni cambiar el build. Es CSS + TS vanilla.
2. **NO** reescribir la estructura ni la lógica. Solo visual: escribir CSS y **agregar clases** a las plantillas HTML existentes en los `*-ui.ts`.
3. **Mantener `escapeHtml()`** en todos los datos dinámicos (nombres, direcciones, etc.). Nunca quitarlo — es seguridad.
4. **No tocar**: servidor, Supabase, RLS, sincronización, datos, WhatsApp, ni las PRs ya publicadas.
5. **Mobile-first**: los corredores usan el celular. Probar todo a 375px de ancho y respetar `env(safe-area-inset-*)`.
6. **Cambios chicos y reversibles**: una zona por PR (primero tokens + nav + 1 pantalla). Correr `npm run build` y `npm test` (tienen que quedar en verde). Abrir PR clara. **No fusionar sin la palabra exacta `PUBLICAR`.**
7. **Cero dependencias nuevas de npm** salvo que se justifique (la única candidata es `canvas-confetti`, y es opcional).

---

## Las 3 capas (de dónde sale la profundidad)

Tres capas fijas, una atrás de otra:

- **Capa 1 — Fondo en movimiento** (atrás de todo, `z-index:-1`): gradientes de color que se mueven lento.
- **Capa 2 — Superficies "glass"**: tarjetas, nav, header, modales — el vidrio líquido que deja ver el fondo esmerilado.
- **Capa 3 — Contenido**: texto, íconos, controles. **Siempre sobre una superficie glass o sólida con suficiente opacidad, nunca texto denso directo sobre el fondo en movimiento** (legibilidad).

---

## 1) Tokens (variables CSS) — poné esto en un archivo nuevo `src/design-tokens.css`

> Los **colores son de ejemplo** (la identidad actual: navy + dorado). Einar los cambia.
> **Regla de oro del vidrio:** al re-colorear, cambiás SOLO los fondos translúcidos
> (`--glass-*`). Los brillos blancos y las sombras negras NO se tocan — esos son los
> que hacen que "lea" como vidrio con cualquier color.

```css
:root {
  /* ---- Color (EDITAR) ---- */
  --brand:        #d0a33c;   /* acento (dorado) */
  --brand-deep:   #173951;   /* navy */
  --ink:          #0f1c24;   /* texto principal */
  --ink-soft:     #526b78;   /* texto secundario */
  --ok:           #2f9e6f;
  --warn:         #d98a2b;

  /* ---- Glass (fondos translúcidos: editar el color, NO los brillos) ---- */
  --glass-bg:     rgba(255, 255, 255, 0.10);
  --glass-brand:  rgba(208, 163, 60, 0.18);
  --glass-stroke: rgba(255, 255, 255, 0.22);

  /* ---- Brillos y sombras del vidrio (NO tocar al re-colorear) ---- */
  --glass-hi:     inset 0 1px 0 rgba(255, 255, 255, 0.55);  /* brillo ARRIBA */
  --glass-lo:     inset 0 -1px 0 rgba(0, 0, 0, 0.18);       /* sombra ABAJO  */
  --glass-glow:   0 18px 40px -14px rgba(0, 0, 0, 0.40);    /* flota */

  /* ---- Forma (canto rodado / gota) ---- */
  --radius-md:  0.8rem;
  --radius-xl:  1.1rem;
  --radius-2xl: 1.5rem;

  /* ---- Movimiento ---- */
  --ease-ui: cubic-bezier(0.4, 0, 0.2, 1);
  --dur-ui:  0.2s;

  /* ---- Tipografía ---- */
  --font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
}

html { font-family: var(--font); letter-spacing: -0.01em; -webkit-font-smoothing: antialiased; }
```

---

## 2) La receta del "liquid glass" (CSS puro)

Los 5 ingredientes: fondo translúcido + `backdrop-filter: blur() saturate()` + brillo interno arriba + sombra interna abajo + glow externo.

```css
.glass {
  background: var(--glass-bg);
  -webkit-backdrop-filter: blur(18px) saturate(1.6);
  backdrop-filter: blur(18px) saturate(1.6);
  border: 1px solid var(--glass-stroke);
  border-radius: var(--radius-2xl);
  box-shadow: var(--glass-hi), var(--glass-lo), var(--glass-glow);
}

/* Variante con acento de marca (para el botón/nav primario) */
.glass-brand { background: var(--glass-brand); }

/* Fallback: si el navegador no soporta backdrop-filter, usar un fondo más opaco
   para no perder legibilidad. */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .glass { background: rgba(14, 28, 36, 0.86); }
}
```

**Aplicación:** poné `class="glass"` en tarjetas, el header, la nav flotante, los modales.
Todo con esquinas muy redondeadas (`--radius-2xl`).

---

## 3) El fondo en movimiento (Capa 1) — CSS puro

Agregá un `<div class="app-backdrop"></div>` como primer hijo del `<body>` (una sola vez, en `index.html`), y este CSS:

```css
.app-backdrop {
  position: fixed; inset: 0; z-index: -1; overflow: hidden;
  background:
    radial-gradient(60% 55% at 18% 20%, var(--brand-deep), transparent 60%),
    radial-gradient(55% 45% at 82% 28%, var(--brand),      transparent 55%),
    radial-gradient(70% 60% at 50% 92%, #0b2330,           transparent 62%),
    #07141b;
}
.app-backdrop::before {
  content: ""; position: absolute; inset: -25%;
  background: inherit; filter: blur(70px);
  animation: backdrop-drift 26s var(--ease-ui) infinite alternate;
  will-change: transform;
}
@keyframes backdrop-drift {
  to { transform: translate3d(5%, -4%, 0) scale(1.12); }
}
```

---

## 4) Animaciones (traducción de framer-motion a CSS/JS vanilla)

framer-motion es solo una comodidad; los mismos efectos salen con CSS y la Web Animations API.

```css
/* Entrada con "pop" elástico (spring) */
@keyframes pop-in {
  0%   { opacity: 0; transform: translateY(10px) scale(0.96); }
  60%  { transform: translateY(-2px) scale(1.01); }
  100% { opacity: 1; transform: none; }
}
.pop-in { animation: pop-in 0.45s var(--ease-ui) both; }

/* Stagger: cada tarjeta entra un poquito después. En el .ts, al generar cada
   tarjeta, agregale style="--i:0", "--i:1"... según su índice. */
.stagger > * { animation: pop-in 0.45s var(--ease-ui) both; animation-delay: calc(var(--i, 0) * 60ms); }

/* Barras que se llenan */
.bar > span { display:block; height:100%; width:0; transition: width 0.9s ease-out; }

/* Hover/press del primario y borde de tarjeta */
.btn-primary { transition: filter var(--dur-ui) var(--ease-ui); }
.btn-primary:hover { filter: brightness(1.1); }
.card { transition: border-color var(--dur-ui) var(--ease-ui); }
.card:hover { border-color: var(--brand); }

/* Chevron del select rota 180° al abrir */
.select-chevron { transition: transform var(--dur-ui) var(--ease-ui); }
[open] .select-chevron, .is-open .select-chevron { transform: rotate(180deg); }

/* Toast de logro: baja desde arriba */
@keyframes toast-in { from { opacity:0; transform: translateY(-16px); } to { opacity:1; transform:none; } }
.toast { animation: toast-in 0.3s var(--ease-ui) both; }
```

**CountUp** (números que suben, ej. métricas del dashboard) — mini función vanilla:

```ts
export function countUp(el: HTMLElement, to: number, ms = 900): void {
  const start = performance.now();
  const step = (now: number) => {
    const p = Math.min(1, (now - start) / ms);
    el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))).toLocaleString('es-AR');
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
```

**Confetti (opcional):** solo si se justifica (ej. al marcar un lead como "Vendido"). Se puede
con `canvas-confetti` (dependencia chica) o un burst propio. Es lo último de la lista, no bloquea nada.

---

## 5) Forma, jerarquía e íconos

- **Todo redondeado**: tarjetas, botones, nav, inputs → `--radius-2xl` (sensación de gota).
- **Nav flotante**: una píldora `glass` fija abajo, centrada, separada de los bordes, respetando `env(safe-area-inset-bottom)`.
- **Header**: píldora `glass` sticky arriba.
- **Botones**: primario = `glass glass-brand`; secundario = `glass`; terciario = solo texto (ghost).
- **Íconos**: usar los de **lucide como SVG crudo inline** (son MIT, se copia el `<path>`). NO `lucide-react`. Tamaños consistentes (16/20/24px), trazo 1.8, y el color de acento **solo en el ícono**. PropControl ya inserta SVGs inline, seguir ese patrón.

---

## 6) Accesibilidad y rendimiento (obligatorio — para que NO se rompa en celulares baratos)

- **Legibilidad**: el texto va sobre superficies glass/sólidas con opacidad suficiente. **Nunca** texto de párrafo directo sobre el fondo en movimiento. Contraste AA como mínimo.
- **`prefers-reduced-motion`**: apagar animaciones para quien lo pida.
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, ::before, ::after { animation: none !important; transition-duration: 0.01ms !important; }
    .app-backdrop::before { animation: none; }
  }
  ```
- **Rendimiento**: `backdrop-filter` es pesado para la GPU. Usar `glass` en el "chrome" (nav, header, tarjetas, modales), **NO** en listas largas con decenas de filas. Probar en un Android de gama media real.
- **Foco visible**: mantener estados `:focus-visible` claros (accesibilidad de teclado).

---

## 7) Checklist "esto NO parece hecho por IA"

- [ ] Tipografía con jerarquía real (tamaños/pesos con intención, no todo igual).
- [ ] Profundidad real (el glass: brillo arriba, sombra abajo, glow externo).
- [ ] Movimiento con intención (pop de entrada, stagger, barras) — no animar por animar.
- [ ] Sistema de íconos consistente (lucide, mismo trazo y tamaños).
- [ ] Layout considerado, no el grid genérico de 3 tarjetas iguales.
- [ ] Estados vacíos con personalidad (no "No hay datos").
- [ ] Microcopy humano.

---

## 8) Orden de trabajo sugerido (PRs chicas, en este orden)

1. **Fundación**: `design-tokens.css` + clase `.glass` + `.app-backdrop` + cargar el fondo en `index.html`.
2. **1 pantalla de referencia** (ej. Leads): convertirla entera al sistema. Esta pantalla es el "molde" que se copia para las demás.
3. Header + nav flotante glass.
4. El resto de las pantallas, una por PR (Propiedades, Dashboard, Agenda, Equipo, Ficha pública).
5. Animaciones finas y (opcional) confetti/CountUp.

Cada PR: `npm run build` + `npm test` en verde, captura antes/después, y **no fusionar sin `PUBLICAR`**.
