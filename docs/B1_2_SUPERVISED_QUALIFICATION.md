# B1.2 — Calificación automática supervisada desde conversaciones

## Estado

Implementación preparada en GitHub. No se ejecutó SQL, no se modificó Supabase, no se modificó Railway y no se modificó producción.

## Diagnóstico del flujo existente

### Fuente de verdad

La relación vigente es:

- `WhatsAppConversation.clientId` referencia `Client.id`;
- `ConversationMessage[]` permanece dentro de la conversación;
- `ConversationAudit` permanece dentro de la conversación y protege decisiones de contacto;
- `activityLog` registra trazabilidad resumida mediante `entityType = Cliente` y `entityId`;
- los datos comerciales confirmados se almacenan únicamente en `Client`.

B1.2 conserva esa arquitectura. Las sugerencias de extracción son transitorias y no se persisten como otra entidad. Analizar un texto no modifica el Lead. Solo la acción humana **Aplicar calificación** actualiza `Client`.

### Persistencia

Los clientes y conversaciones se guardan como payload JSON en los registros cloud existentes. Los campos opcionales nuevos son compatibles con Leads históricos y no requieren columnas, tablas ni migraciones.

### Auditoría de conversaciones

`conversation-audit.ts` determina si una conversación puede recibir seguimiento, si debe pausarse o si requiere revisión manual. B1.2 no reemplaza ni debilita ese motor. La nueva extracción comercial utiliza únicamente mensajes entrantes y, para audio, la transcripción disponible.

### Seguridad y permisos

`visibleClients()` y `visibleConversations()` aplican la visibilidad vigente por asignación:

- Dueño y Administrador conservan la visibilidad actual;
- Corredor solo analiza y modifica Leads y conversaciones asignados;
- la persistencia cloud continúa filtrando por `assigned_member_id`;
- no se modificó RLS ni la seguridad del servidor.

## Funcionamiento implementado

### Fuentes de análisis

El panel permite elegir:

1. conversación asociada al Lead;
2. texto de WhatsApp pegado;
3. notas o transcripción pegada.

No se agregó una integración nueva con WhatsApp API.

### Extractor determinístico

El extractor local identifica únicamente información presente en el texto:

- nombre y teléfono;
- zonas;
- tipo de propiedad y operación;
- dormitorios;
- presupuesto y moneda;
- contado, crédito, financiación y cuotas;
- finalidad;
- plazo;
- conocimiento de zona;
- capacidad de avance;
- interés;
- objeciones o condicionantes;
- urgencia;
- próxima acción y fecha;
- etapa y temperatura sugeridas.

Cada sugerencia contiene:

- campo;
- valor;
- confianza;
- fragmento de respaldo;
- advertencia de ambigüedad cuando corresponde.

El extractor funciona siempre, sin claves ni servicios pagos.

### Presupuesto

Se contemplan formatos habituales:

- `USD 120.000`;
- `120 mil dólares`;
- `120k`;
- rangos como `entre 110 y 130`;
- entrega más cuotas;
- monto disponible más financiación del resto.

La moneda no se inventa. Un importe sin moneda queda marcado para confirmación. Números grandes sin contexto suficiente, como `1200000`, se presentan como ambiguos.

### Revisión supervisada

Antes de guardar, el usuario puede:

- aceptar;
- editar;
- descartar;
- autorizar expresamente el reemplazo de un dato confirmado.

Los datos confirmados del Lead no se reemplazan automáticamente con sugerencias ambiguas o de menor confianza. Una edición humana se considera confirmación explícita.

Los estados `Reservado`, `Ganado` y `Perdido` requieren una confirmación humana adicional.

### Preguntas faltantes

Se generan como máximo tres preguntas concretas con esta prioridad:

1. presupuesto y moneda;
2. forma de pago o financiación;
3. finalidad;
4. plazo;
5. zona;
6. tipo y dormitorios;
7. capacidad real de avanzar;
8. conocimiento de ubicación.

El botón **Copiar próxima pregunta** copia la primera pregunta prioritaria.

### Pipeline

Reglas mínimas:

- una consulta inicial queda como `Contactado`;
- pedir una visita no equivale a estar calificado;
- `Visita coordinada` exige confirmación explícita y fecha;
- `Negociación` exige oferta, precio o condiciones;
- `Calificado` requiere información comercial suficiente y no ambigua;
- estados terminales requieren confirmación humana.

### Temperatura

La temperatura se sugiere con una explicación observable:

- urgencia;
- presupuesto;
- forma de pago;
- capacidad de avance;
- dependencia de venta o crédito.

No representa probabilidad de cierre ni una predicción de inteligencia artificial.

### Prevención de visitas improductivas

Antes de coordinar una visita se advierte cuando faltan:

- presupuesto o rango;
- moneda;
- forma de pago;
- conocimiento de zona;
- posibilidad real de avanzar;
- aceptación de condiciones principales.

La advertencia no bloquea al corredor.

### Capa inteligente opcional

Existe una capa opcional de servidor para lenguaje ambiguo. Solo se considera configurada cuando el servidor dispone de:

- endpoint;
- clave;
- modelo.

La ruta:

- valida la sesión mediante Supabase Auth;
- mantiene la clave exclusivamente en servidor;
- sanitiza campos y evidencia mediante una lista permitida;
- no se ejecuta cuando no hay proveedor configurado;
- no interrumpe el extractor determinístico ante errores.

No se agregó ninguna dependencia externa y no se cargaron valores reales en Railway.

## Campos confirmados agregados a Client

B1.2 agrega campos opcionales al payload JSON:

- `zones`;
- `propertyType`;
- `operation`;
- `bedrooms`;
- `currency`;
- `needsFinancing`;
- `creditPossible`;
- `urgency`.

El formulario manual conserva esos valores aunque no estén visibles por defecto.

## Matching

El motor vigente incorpora los campos confirmados de zona, tipo, dormitorios, moneda, financiación y crédito. No se reescribió el motor y se mantiene la exclusión de Leads terminales.

## Historial

Se registran resúmenes de:

- análisis realizado;
- sugerencias aplicadas;
- campos descartados o protegidos;
- preguntas faltantes generadas.

No se copia la conversación completa dentro de `activityLog`.

## Ajustes visuales menores

Se corrigieron:

- nombre personal del responsable cuando el registro contiene un slug técnico;
- presupuesto visible con moneda confirmada;
- advertencia cuando falta moneda;
- fecha visible en formato argentino;
- textos de filtros de vencidos y próxima acción.

## Experiencia responsive

El panel:

- permanece cerrado hasta pulsar **Calificar automáticamente**;
- solo muestra campos detectados;
- organiza la revisión en tarjetas compactas;
- usa controles táctiles de al menos 40–44 px;
- se adapta a 430 px, 720 px y 1366 × 768;
- evita scroll horizontal de página.

## Límites del extractor

1. No interpreta cualquier barrio del país: combina una lista inicial de zonas frecuentes con expresiones explícitas de zona o barrio.
2. Los importes sin moneda o sin contexto quedan ambiguos.
3. Fechas relativas complejas, como “el viernes de la otra semana”, requieren confirmación manual.
4. La capa determinística no resuelve ironía, contradicciones largas ni referencias anafóricas complejas.
5. Un audio sin transcripción no puede analizarse.
6. La capa inteligente opcional no está activada ni configurada en este PR.
7. El extractor no decide automáticamente Ganado, Perdido ni Reservado.

## Riesgos

1. Una expresión ambigua puede producir una sugerencia incorrecta; por eso nunca se guarda sin confirmación.
2. El catálogo inicial de zonas deberá ampliarse gradualmente con casos reales.
3. Un proveedor inteligente futuro implicará costos y políticas de tratamiento de datos que deben aprobarse antes de configurarlo.
4. Los campos confirmados se persisten en el payload actual; no existe una columna SQL independiente para cada dato.
5. `activityLog` conserva el límite global vigente de 250 entradas.

## Exclusiones confirmadas

B1.2 no:

- ejecuta SQL;
- crea tablas ni migraciones;
- modifica Supabase, RLS o Storage;
- modifica Railway ni variables reales;
- agrega claves reales;
- modifica autenticación, organizaciones, invitaciones o usuarios;
- integra una nueva WhatsApp API;
- activa servicios pagos;
- fusiona ni publica automáticamente.
