# B1.1 — Calificación, pipeline y próxima acción de Leads

## Estado

Implementación preparada en GitHub. No se ejecutó SQL, no se modificó Supabase y no se modificó producción.

## Diagnóstico del flujo existente

### Modelo y persistencia

`Client` ya almacenaba presupuesto, forma de pago, plazo, finalidad, conocimiento de zona, capacidad económica, objeciones, notas, etapa y fecha de seguimiento. Faltaba un campo explícito para el texto de la próxima acción.

Los clientes se serializan como payload JSON dentro de `propcontrol_records`. Por eso `nextAction?: string` es compatible con la persistencia actual y no requiere tablas ni migraciones.

La normalización local y cloud conserva propiedades adicionales del payload mediante spread y serialización completa del objeto `Client`. Los leads históricos pueden seguir cargando aunque no contengan los campos nuevos.

### Leads

La pantalla mostraba únicamente nombre, WhatsApp, email, interés, presupuesto y temperatura. La lista y la búsqueda leían directamente `state.crm.clients`, por lo que no reutilizaban la visibilidad centralizada de `visibleClients()`.

No existían filtros comerciales, contadores por etapa, completitud de calificación, próxima acción visible ni historial relacionado dentro de cada tarjeta.

### Agenda

Agenda ya generaba un elemento automático desde `Client.nextFollowUp`, con identidad estable `client-{id}`. Esa es la fuente correcta para el seguimiento automático del lead.

Completar el elemento únicamente limpiaba `nextFollowUp`. No actualizaba `lastContact`, no limpiaba `nextAction` y no registraba actividad. Reprogramar cambiaba la fecha, pero tampoco registraba actividad.

Los recordatorios manuales siguen siendo objetos independientes. B1.1 no crea un `Reminder` al guardar la próxima acción del lead, evitando la duplicación advertida en el PR #73.

### Matching

El motor ya consideraba interés, presupuesto, pago, objeciones y notas. Solo reconocía parcialmente etapas terminales históricas. Ganado y Perdido debían quedar excluidos explícitamente.

### Permisos

`team-access.ts` ya centraliza la visibilidad por asignación:

- Dueño y Administrador ven toda la operación.
- Corredor ve únicamente registros asignados.

B1.1 reutiliza `visibleClients()`, `visibleProperties()` y `visibleReminders()`. No modifica RLS ni sustituye la protección del servidor por filtros visuales.

## Referencia conceptual del PR #73

El PR #73 fue revisado únicamente como referencia de etapas, historial y experiencia comercial. No se reutilizó su rama, no se hizo merge y no se hizo cherry-pick.

Su estrategia de crear simultáneamente un `Reminder` y actualizar `Client.nextFollowUp` podía generar dos elementos en Agenda. B1.1 conserva únicamente `Client.nextFollowUp` como seguimiento automático del lead.

## Solución implementada

### Modelo comercial

Etapas normalizadas:

1. Nuevo
2. Contactado
3. Calificado
4. Visita coordinada
5. Negociación
6. Reservado
7. Ganado
8. Perdido

Se agregó `Client.nextAction?: string`.

Los estados históricos se traducen de forma segura, entre ellos:

- `Visita posible` → `Visita coordinada`
- `Ganada` → `Ganado`
- `Perdida` → `Perdido`
- `Cerrado` → `Ganado`

### Calificación

El formulario principal muestra los datos indispensables. La calificación extendida queda dentro de un bloque desplegable para no mantener un formulario interminable abierto.

La completitud utiliza ocho campos reales:

- interés;
- presupuesto;
- forma de pago;
- plazo;
- finalidad;
- conocimiento de zona;
- capacidad de avance;
- condicionantes.

El resultado se presenta como `Calificación N/8`. No representa una predicción de inteligencia artificial.

### Pipeline y filtros

La lista conserva el formato actual y agrega:

- etapa visible;
- filtro por etapa;
- filtro por temperatura;
- filtro de seguimientos vencidos;
- filtro de leads sin próxima acción completa;
- contadores por etapa;
- búsqueda ampliada a datos de calificación.

### Próxima acción y Agenda

Guardar una próxima acción requiere texto y fecha. Se persisten:

- `Client.nextAction`;
- `Client.nextFollowUp`.

No se crea un `Reminder` automático.

Al completar desde Agenda:

- se actualiza `lastContact`;
- se limpia `nextFollowUp`;
- se limpia `nextAction`;
- se registra `Seguimiento completado` en `activityLog`.

Al reprogramar:

- solo cambia `nextFollowUp`;
- se conserva `nextAction`;
- se registra la reprogramación;
- no se crea otro objeto.

Al pasar a Ganado o Perdido:

- se limpian fecha y acción futuras;
- Agenda deja de generar el elemento automático;
- matching excluye el lead;
- el cliente y su historial se conservan.

### Historial

Se registran:

- creación;
- cambio de etapa;
- programación;
- actualización o reprogramación;
- seguimiento completado;
- operación ganada;
- operación perdida.

Cada tarjeta muestra hasta cinco movimientos recientes en un bloque desplegable.

### Experiencia responsive

El diseño agrega reglas específicas para:

- 430 px;
- 720 px;
- 1366 × 768.

Los filtros se reorganizan, los resúmenes reducen columnas, los botones conservan área táctil y los contadores permiten desplazamiento horizontal interno sin desbordar la página.

## Compatibilidad cloud

`nextAction` viaja dentro del payload completo del cliente. B1.1 no agrega relaciones ni columnas SQL.

La serialización mantiene el filtro actual por asignación para Corredor. Dueño y Administrador conservan el comportamiento vigente.

## Pruebas

La suite cubre:

- creación y edición completa;
- leads históricos;
- normalización de etapas;
- filtros y contadores;
- visibilidad por rol y asignación;
- Ganado y Perdido;
- próxima acción única;
- reprogramación;
- seguimiento completado;
- ausencia de Reminder automático;
- activityLog;
- persistencia cloud;
- matching;
- layout real en Chrome a 430, 720 y 1366 px.

## Riesgos y límites

1. Los nombres de etapas históricas no reconocidos se normalizan a Nuevo. Los valores conocidos están cubiertos por pruebas.
2. Un recordatorio creado manualmente por una persona puede referirse al mismo lead. B1.1 garantiza una única fuente automática, pero no elimina tareas manuales existentes.
3. `activityLog` conserva el límite global vigente de 250 entradas.
4. No se implementa Kanban, automatización de WhatsApp ni scoring predictivo.
5. No se modifica la política RLS ni el modelo de asignaciones del servidor.
6. No se cambia autenticación, organizaciones, invitaciones ni usuarios.

## Exclusiones confirmadas

B1.1 no:

- crea tablas;
- crea migraciones;
- ejecuta SQL;
- modifica Supabase;
- modifica RLS o Storage;
- modifica Railway ni variables;
- modifica autenticación;
- modifica organizaciones, invitaciones o usuarios;
- publica ni fusiona automáticamente.
