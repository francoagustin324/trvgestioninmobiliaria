# B1.2.3 — Leads compactos, priorizados y fáciles de recorrer

## Diagnóstico

La lista posterior a B1.2.2 era responsive, pero mantenía resumen, historial y matching dentro del flujo visual de cada tarjeta. Eso aumentaba la altura y dificultaba recorrer muchos Leads.

## Solución

- Tarjeta compacta con identidad, etapa, alerta única, búsqueda, tres datos comerciales, próxima acción y acciones frecuentes.
- Ficha completa bajo demanda; en móvil solo una permanece abierta.
- Estado visual conservado durante rerenders mientras el Lead siga visible.
- Alerta única y determinística, sin scoring predictivo.
- Fechas comerciales relativas.
- Responsable legible sin modificar asignaciones.
- Orden por prioridad después de permisos y filtros.
- Pipeline horizontal con indicación de contenido oculto y chip seleccionado visible.
- Completar y reprogramar reutilizan las funciones existentes de B1.1.
- Estados futuros de envío de propiedades quedan documentados, no persistidos.

## Exclusiones

No se modifican modelos, persistencia, SQL, Supabase, Railway, autenticación, IA paga ni reglas comerciales de B1.2.1.
