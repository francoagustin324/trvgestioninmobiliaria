# B1.2.1 — Calificación automática comercial esencial

## Estado

Esta etapa simplifica B1.2 para determinar rápidamente si existe una oportunidad comercial real. El cambio está preparado en GitHub y no fue desplegado en producción.

No se ejecutó SQL, no se modificó Supabase, no se modificó Railway y no se configuró ningún proveedor de inteligencia artificial pago.

## Diagnóstico

B1.2 permitía detectar una cantidad amplia de datos, pero la calificación visual y las preguntas faltantes podían dar demasiada importancia a tipología, dormitorios, características, objeciones y otros datos que suelen cambiar durante la búsqueda.

Ese enfoque podía producir tres problemas:

1. hacer que una conversación comercial parezca un interrogatorio;
2. retrasar la clasificación de una oportunidad real por campos secundarios ausentes;
3. presentar preferencias variables como si fueran datos definitivos.

B1.2.1 mantiene la extracción supervisada, pero separa claramente la información esencial de la secundaria.

## Fuente de verdad

`Client` continúa siendo la única fuente de verdad comercial.

- `WhatsAppConversation.clientId` vincula la conversación con el Lead.
- Los mensajes permanecen dentro de la conversación.
- Las sugerencias existen solo durante la revisión.
- Únicamente los valores aceptados se guardan en `Client`.
- `activityLog` registra un resumen y no copia la conversación completa.
- Los campos nuevos continúan dentro del payload JSON existente; no requieren migración SQL.

## Ocho datos comerciales esenciales

La calificación principal utiliza:

1. presupuesto o rango aproximado;
2. moneda;
3. forma de pago;
4. situación del crédito;
5. zona o barrios principales;
6. finalidad;
7. plazo o urgencia;
8. posibilidad actual de avanzar.

El conocimiento de la zona se muestra como dato comercial adicional. Puede influir en la preparación de una visita, pero no impide por sí solo que un Lead quede Calificado.

## Estados visuales

La tarjeta muestra un estado simple:

- `Información inicial`;
- `Falta presupuesto`;
- `Falta forma de pago`;
- `Falta confirmar capacidad de avance`;
- `Calificado`;
- `No listo todavía`.

El estado no es una predicción de cierre ni una probabilidad generada por inteligencia artificial.

## Criterio de Calificado

Un Lead puede quedar `Calificado` cuando existen señales suficientes de:

- presupuesto y moneda;
- forma de pago;
- zona aproximada;
- finalidad;
- plazo o urgencia;
- posibilidad razonable de avanzar.

Cuando la compra depende de un crédito hipotecario, el estado del crédito debe ser coherente con una posibilidad actual de avance.

No se exigen dormitorios, tipología exacta, objeciones, características, fecha de visita ni conocimiento completo de la zona.

## Información secundaria y flexible

Cuando aparece naturalmente, el extractor puede sugerir:

- tipo de propiedad;
- dormitorios;
- cochera;
- patio;
- pileta;
- propiedad apto crédito requerida;
- características;
- preferencias;
- objeciones;
- fechas;
- próxima acción.

Estos campos se guardan como datos editables y no forman parte del bloqueo principal de calificación.

## Próxima pregunta

Se genera una sola pregunta prioritaria.

Orden:

1. presupuesto;
2. moneda;
3. forma de pago;
4. situación del crédito;
5. capacidad real de avanzar;
6. plazo;
7. zona;
8. finalidad;
9. conocimiento de zona como dato adicional.

Cuando existe financiación sin monto de entrega confirmado, se prioriza:

> ¿Qué monto podrías entregar y cuánto necesitarías financiar?

No se vuelve a preguntar tipo, dormitorios ni características solo para completar la ficha.

## Visitas

La advertencia de visita revisa:

- presupuesto;
- moneda;
- forma de pago;
- situación del crédito cuando corresponde;
- capacidad de avanzar;
- aceptación básica de la zona.

No exige que exista una objeción declarada y no bloquea al corredor.

Mensaje:

> Conviene confirmar presupuesto y forma de pago antes de coordinar.

## Caso Edgardo

Para la conversación:

```text
Edgardo: Hola, estoy buscando un dúplex en Manantiales.
Franco: ¿Qué presupuesto manejás?
Edgardo: Hasta USD 120.000, tengo una parte y necesitaría financiar el resto.
Franco: ¿Es para vivir o invertir?
Edgardo: Para vivir. Conozco la zona y podría avanzar este mes.
```

B1.2.1 detecta:

- presupuesto `USD 120.000`;
- moneda `USD`;
- forma de pago `Combinación`;
- zona `Manantiales`;
- finalidad `Vivir`;
- plazo `0-3 meses`;
- urgencia alta;
- conocimiento de zona `Sí`;
- posibilidad de avanzar `Sí`;
- tipo secundario `Dúplex`;
- interés `Dúplex en Manantiales`;
- etapa sugerida `Calificado`.

Las preguntas de Franco se excluyen del texto analizado cuando el texto pegado contiene interlocutores identificables. La evidencia de presupuesto conserva la línea completa con `USD 120.000`.

## Crédito

Estados admitidos:

- `No necesita`;
- `Todavía no iniciado`;
- `En trámite`;
- `Preaprobado`;
- `Aprobado`.

El monto aprobado se extrae únicamente cuando aparece explícitamente, por ejemplo:

```text
Tengo crédito hipotecario aprobado por USD 80.000.
```

`Apto crédito` referido a la propiedad se guarda como preferencia secundaria y no se confunde con el estado del crédito del comprador.

## Aplicación supervisada

Analizar nunca guarda automáticamente.

Antes de aplicar se mantiene la revisión campo por campo con:

- valor;
- confianza;
- evidencia;
- aceptar;
- editar;
- descartar.

Después de aplicar se informa:

- cantidad de datos nuevos guardados;
- cantidad de datos que ya estaban confirmados;
- cantidad de datos que requieren revisión.

Los valores ambiguos o de menor confianza no reemplazan datos confirmados sin autorización humana.

## Experiencia

La tarjeta muestra de forma compacta:

- presupuesto;
- forma de pago;
- crédito;
- zona;
- finalidad;
- plazo o urgencia;
- capacidad de avance;
- conocimiento de zona;
- próxima acción;
- fecha de seguimiento;
- responsable;
- fecha de actualización de la calificación.

La información secundaria permanece en un bloque opcional y editable.

El layout se valida en:

- 430 px;
- 720 px;
- 1366 × 768.

## Límites

1. La extracción sigue siendo conservadora y basada principalmente en reglas observables.
2. Barrios no incluidos en el catálogo pueden requerir revisión manual.
3. Fechas vagas pueden requerir edición.
4. Un audio necesita transcripción para ser analizado.
5. La información detectada no se considera definitiva: presupuesto, barrio, pago, finalidad, urgencia y tipología pueden cambiar.
6. La capa inteligente opcional permanece desactivada sin configuración de servidor.

## Exclusiones

B1.2.1 no:

- ejecuta SQL;
- modifica Supabase;
- modifica Railway;
- agrega variables reales;
- configura IA paga;
- crea tablas ni migraciones;
- cambia autenticación, organizaciones, invitaciones o usuarios;
- fusiona ni publica el PR automáticamente.
