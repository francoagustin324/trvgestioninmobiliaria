# B1.2.2 — Corrección crítica de Leads en celular

## Estado

La corrección está preparada en GitHub. No fue desplegada ni ejecutada en producción.

- SQL ejecutado: **NO**
- Supabase modificado: **NO**
- Railway modificado: **NO**
- Variables o claves agregadas: **NO**
- Lógica comercial modificada: **NO**
- Persistencia modificada: **NO**

## Causa raíz confirmada

El problema no provenía de un único tamaño de fuente. Era una colisión de estructura y cascada:

1. `lead-pipeline.css` definía correctamente una tarjeta de una columna para teléfonos de hasta 520 px.
2. `mobile-leads-polish.css`, cargado después, volvía a imponer dos columnas incluso a 430 px:

   ```css
   .mvp-lead-card-main {
     grid-template-columns: minmax(0, 1fr) auto;
   }
   ```

3. Ese mismo archivo colocaba `.mvp-lead-actions` en la segunda columna.
4. B1.2 agregó dentro de esas acciones el botón largo `Calificar automáticamente`.
5. `lead-qualification.css` se agregaba dinámicamente después de cargar la aplicación y asignaba `width: 100%` al botón en móvil.
6. La segunda columna crecía para contener el botón y el bloque principal del Lead se reducía a pocos píxeles.
7. Nombres e intereses tenían `overflow-wrap: anywhere`, por lo que el navegador podía partirlos letra por letra.
8. El CSS móvil seguía estilizando `.mvp-lead-name`, aunque el HTML vigente utiliza `.mvp-lead-title-line`.
9. `liquid-glass-skin.css` posicionaba las acciones en absoluto y otros archivos las devolvían parcialmente al flujo normal.
10. La prueba anterior renderizaba solamente un fragmento de resumen comercial con tres hojas CSS. No utilizaba el shell, la tarjeta, los botones, los filtros, la navegación inferior ni el orden real de `index.html`.

## Cascada consolidada

`index.html` carga explícitamente:

1. `lead-pipeline.css`;
2. `lead-qualification.css`;
3. `mobile-layout-fix.css`;
4. `liquid-glass-skin.css`;
5. `mobile-bottom-nav.css`;
6. `mobile-leads-polish.css`.

`lead-qualification.css` dejó de insertarse dinámicamente desde JavaScript.

La responsabilidad queda separada:

- `lead-pipeline.css`: estructura base de Leads para escritorio y tablet;
- `mobile-leads-polish.css`: única fuente del layout móvil de Leads;
- `mobile-layout-fix.css`: shell, cabecera y navegación general, sin reglas de tarjetas de Leads;
- `mobile-bottom-nav.css`: barra inferior y espacio seguro;
- `liquid-glass-skin.css`: apariencia premium general.

## Tarjeta móvil

Para teléfonos de hasta 520 px la jerarquía es vertical:

1. temperatura, nombre y etapa;
2. interés y metadatos breves;
3. WhatsApp, llamada y email;
4. `Calificar automáticamente` en una fila independiente;
5. editar y eliminar en otra fila;
6. próxima acción, fecha y responsable;
7. resumen comercial;
8. estado comercial;
9. historial y propiedades compatibles.

El botón principal ya no comparte una columna rígida con el nombre.

## Texto

Nombres, intereses, títulos de propiedades, evidencias y textos comerciales utilizan:

```css
word-break: normal;
overflow-wrap: break-word;
hyphens: none;
min-width: 0;
max-width: 100%;
```

Se eliminaron las reglas móviles antiguas que aplicaban `overflow-wrap: anywhere` sobre la tarjeta de Leads.

## Filtros

En móvil:

- el buscador ocupa el ancho disponible;
- el placeholder es `Nombre, WhatsApp o interés`;
- la cantidad permanece visible;
- etapa, temperatura y checks viven dentro de `Más filtros`;
- los filtros activos se resumen en el encabezado del bloque;
- inputs y selects utilizan fondo claro y texto oscuro;
- los checks tienen superficies táctiles de 44 px;
- no se elimina ninguna función.

## Pipeline

Los contadores:

- tienen `max-width: 100%`;
- desplazan solamente su propio contenedor;
- usan `overscroll-behavior-inline: contain`;
- usan `scroll-snap-type: x proximity`;
- conservan padding inicial y final;
- comienzan en `scrollLeft = 0`;
- no producen scroll horizontal del documento.

## Resumen comercial

Los seis datos prioritarios permanecen visibles:

- presupuesto;
- forma de pago;
- crédito;
- zona;
- plazo o urgencia;
- posibilidad de avanzar.

Finalidad y conocimiento de zona se muestran en `Ver calificación completa`, abierto en escritorio y plegado inicialmente en teléfonos.

## Navegación inferior

La barra continúa fija.

El contenido utiliza:

```css
--pc-mobile-nav-clearance: calc(
  var(--pc-mobile-nav-height)
  + var(--pc-mobile-nav-edge)
  + 56px
  + env(safe-area-inset-bottom)
);
```

Ese valor se aplica como `padding-bottom`, `scroll-padding-bottom` y `scroll-margin-bottom` en tarjetas y paneles. Permite desplazar el último botón por encima de la navegación y respeta el área segura del dispositivo.

## Panel automático

El panel se valida con:

- textarea al 100%;
- sugerencias reales;
- checkboxes;
- valores editables;
- evidencias;
- próxima pregunta;
- copiar pregunta;
- aplicar calificación;
- navegación inferior fija;
- ausencia de scroll horizontal.

## Prueba visual real

La prueba `b1-2-2-mobile-leads-real-app.test.ts`:

1. compila y levanta `dist/server.js`;
2. abre `index.html` real;
3. carga todas las hojas CSS en el orden real;
4. utiliza el shell real y la navegación inferior real;
5. siembra datos mediante el almacenamiento local real asociado a una sesión aislada;
6. renderiza dos tarjetas completas;
7. abre matching, historial y calificación automática;
8. analiza texto y renderiza sugerencias reales;
9. valida cada ancho solicitado.

Anchos cubiertos:

- 320 × 568;
- 360 × 800;
- 375 × 812;
- 390 × 844;
- 412 × 915;
- 430 × 932;
- 720 × 1024;
- 1366 × 768.

Chrome Android se emula con:

- user agent móvil;
- `hasTouch: true`;
- `isMobile: true`;
- `deviceScaleFactor: 3`;
- validación específica a 360 y 412 px.

La prueba comprueba programáticamente:

- documento sin scroll horizontal;
- tarjetas dentro del viewport;
- botones dentro de cada tarjeta;
- nombres e intereses sin colapsar;
- saltos por palabras;
- contraste mínimo de inputs y selects;
- botón automático sin truncarse;
- primer chip visible;
- controles principales de al menos 44 px;
- panel abierto sin desborde;
- textarea dentro de su contenedor;
- `Aplicar calificación` por encima de la navegación;
- campo enfocado visible;
- última tarjeta por encima de la navegación inferior.

## Datos visuales obligatorios

### Lead 1

- Lucía Martín;
- Visita coordinada;
- Casa de 2 habitaciones en zona centro;
- próxima acción;
- calificación completa;
- propiedades compatibles.

### Lead 2

- María de los Ángeles Fernández;
- Calificado;
- Departamento de dos dormitorios en Nueva Córdoba apto crédito;
- crédito aprobado;
- USD 120.000;
- historial.

## Screenshots

La prueba genera, dentro de:

```text
artifacts/b1-2-2-mobile-leads/
```

capturas de la pantalla y del panel abierto para:

- 360 × 800;
- 390 × 844;
- 430 × 932;
- 720 × 1024;
- 1366 × 768.

## Comparación

### Antes

- dos columnas forzadas a 430 px;
- acción larga junto al nombre;
- nombre e interés partidos por caracteres;
- editar y eliminar compitiendo con el contenido;
- selectores obsoletos;
- filtros altos;
- chips cortados;
- prueba con HTML parcial.

### Después

- tarjeta vertical en teléfonos;
- acción principal independiente;
- acciones secundarias táctiles y separadas;
- textos envueltos por palabras;
- filtros plegables;
- contraste explícito;
- pipeline con desplazamiento propio;
- resumen compacto;
- espacio inferior calculado;
- prueba contra la aplicación real.

## Límites

Los navegadores headless no muestran el teclado virtual del sistema operativo. La prueba sí activa foco táctil, reduce el viewport hasta 320 × 568, desplaza el campo enfocado y verifica que quede por encima de la navegación fija. La revisión final en un dispositivo Android físico continúa siendo recomendable antes de desplegar.
