import assert from 'node:assert/strict';
import test from 'node:test';
import type { Client, ConversationStatus, FollowUpDecision, WhatsAppConversation } from '../models.js';
import { auditConversation, safeConversationMode } from '../conversation-audit.js';

const activeSearch = [
  'Sigo buscando, mandame opciones',
  'Seguimos buscando una casa',
  'Sigo en la búsqueda',
  'Seguimos en la búsqueda',
  'Todavía busco departamento',
  'Todavía estamos buscando',
  'Continúo buscando',
  'Continuamos buscando',
  'Mandame opciones por favor',
  'Mandame más opciones',
  'Enviame opciones',
  'Pasame opciones',
  'Compartime opciones',
  'Mostrame alternativas',
  'Avisame si aparece algo',
  'Avisame cuando tengas algo',
  'Quiero seguir viendo propiedades',
  'Queremos seguir viendo',
  'Estoy buscando un departamento',
  'Estamos buscando una casa',
  'Quiero comprar este año',
  'Queremos comprar',
  'Necesito comprar una vivienda',
  'Necesitamos comprar',
  'Me interesa ver opciones',
  'Sí, sigo buscando',
  'Aún sigo buscando',
  'Todavía necesito encontrar algo',
  'Seguimos con la búsqueda',
  'Continuo con la busqueda',
  'Busco departamento de dos dormitorios',
  'Buscamos casa en zona norte',
  'Estoy en búsqueda activa',
  'Mandame propiedades',
  'Pasame departamentos',
  'Avisenme si sale algo',
] as const;

const waitingToSell = [
  'Todavía no vendí',
  'Todavía no vendimos',
  'Aún no vendí mi casa',
  'No pude vender',
  'No pudimos vender',
  'Todavía no pude vender',
  'No logré vender',
  'No logramos vender',
  'Mi casa no se vendió',
  'El departamento no se vendió',
  'Dependo de vender',
  'Dependemos de vender',
  'Dependo de la venta',
  'Primero tengo que vender',
  'Primero tenemos que vender',
  'Primero debo vender',
  'Primero debemos vender',
  'Antes tengo que vender',
  'Antes debemos vender',
  'Hasta que no venda no puedo avanzar',
  'Hasta que no vendamos no compramos',
  'Cuando venda puedo comprar',
  'Cuando vendamos retomamos',
  'Estoy esperando vender',
  'Seguimos esperando vender',
  'Estoy vendiendo mi casa primero',
  'Estamos vendiendo antes de comprar',
  'Si vendo avanzo',
  'Si vendemos compramos',
  'La compra depende de vender mi casa',
  'Necesito vender antes de comprar',
  'Tenemos que vender antes de avanzar',
  'Mi propiedad sigue publicada',
  'Todavía tengo la casa a la venta',
  'Hasta vender no puedo avanzar',
  'No se vendió todavía',
] as const;

const alreadyBought = [
  'Ya compré',
  'Ya compramos',
  'Compramos una casa',
  'Compramos un departamento',
  'Ya conseguí',
  'Ya conseguimos',
  'Ya encontré',
  'Ya encontramos',
  'Ya resolví',
  'Ya lo resolvimos',
  'Cerré con otra inmobiliaria',
  'Cerramos con otra inmobiliaria',
  'Compré por otro lado',
  'Compramos por otro lado',
  'Ya cerré la compra',
  'Ya cerramos la operación',
  'Ya señé una propiedad',
  'Ya señamos un departamento',
  'Ya reservé',
  'Ya reservamos',
  'Ya tengo casa',
  'Ya tenemos departamento',
  'Finalmente compré',
  'Finalmente encontramos',
  'Elegí otra propiedad y ya cerré',
  'Ya solucioné el tema',
  'Ya está resuelta la compra',
  'Compramos con otra inmobiliaria',
  'Encontré una opción por mi cuenta',
  'Conseguí algo en otra zona',
  'Ya adquirí una propiedad',
  'Concretamos la compra',
  'Firmé por otro departamento',
  'Ya tenemos dónde mudarnos',
  'Ya elegimos y compramos',
  'Gracias, ya conseguimos vivienda',
] as const;

const stoppedSearching = [
  'No busco más',
  'Ya no busco',
  'No estoy buscando',
  'Ya no estoy buscando',
  'Ya no seguimos buscando',
  'Dejé de buscar',
  'Dejamos de buscar',
  'No quiero comprar',
  'No queremos comprar',
  'Desistimos de comprar',
  'No me escribas',
  'No me escriban',
  'No me contacten',
  'No quiero recibir mensajes',
  'Sacame de la lista',
  'Borrenme',
  'Por ahora no busco',
  'Suspendí la búsqueda',
  'Pausamos la búsqueda',
  'Cancelé la búsqueda',
  'Cancelamos la compra',
  'Dimos de baja la búsqueda',
  'No voy a comprar',
  'No vamos a comprar',
  'No sigas buscando para mí',
  'No necesitamos más opciones',
  'No quiero seguir viendo propiedades',
  'Dejalo, no compro',
  'Prefiero no continuar con la búsqueda',
  'Abandonamos la idea de comprar',
  'Frené la búsqueda',
  'No hace falta que me mandes más',
  'Gracias pero no buscamos más',
  'Ya no necesito una propiedad',
  'No tengo intención de comprar',
  'Decidí no comprar',
] as const;

const commercialContacts = [
  'Soy corredor',
  'Soy corredora',
  'Soy corredor inmobiliario',
  'Soy martillero',
  'Soy martillera',
  'Soy asesor inmobiliario',
  'Soy asesora inmobiliaria',
  'Soy agente inmobiliario',
  'Soy vendedor inmobiliario',
  'Soy vendedora de una constructora',
  'Soy constructor',
  'Soy constructora',
  'Soy desarrollista',
  'Soy de una inmobiliaria',
  'Soy de una constructora',
  'Soy de una desarrollista',
  'Trabajo en una inmobiliaria',
  'Trabajo para una constructora',
  'Represento a una desarrollista',
  'Trabajo como corredor',
  'Trabajo como vendedor inmobiliario',
  'Soy del equipo comercial',
  'Trabajo en ventas inmobiliarias',
  'Te comparto una propiedad',
  'Te paso un producto',
  'Les envío una unidad',
  'Te mando disponibilidad',
  'Compartimos comisión',
  'Comparto comisión',
  'Soy propietario',
  'Soy el propietario',
  'Soy el dueño',
  'Quiero vender mi casa',
  'Necesito vender un departamento',
  'Tengo unidades para ofrecer',
  'Vendo departamentos de pozo',
] as const;

const manualReview = [
  'Hola',
  'Gracias',
  'Después te aviso',
  'Lo voy a pensar',
  'Puede ser',
  'No sé todavía',
  'Estoy viendo',
  'Quizás más adelante',
  'Me interesa ese departamento',
  'No me interesa esta propiedad',
  'Ese barrio no me gusta',
  'El precio está alto',
  '¿Dónde queda?',
  '¿Tiene escritura?',
  '¿Aceptan crédito?',
  '¿Se puede ver?',
  '¿Cuántos dormitorios tiene?',
  'Estoy comparando opciones',
  'Hablamos la semana que viene',
  'Déjame consultarlo con mi pareja',
  'Todavía no decidimos',
  'Quiero información',
  'Me gustaría saber más',
  'Mándame la ubicación',
  'Estoy evaluando',
  'No puedo hoy',
  'Ahora estoy ocupado',
  'El presupuesto no me alcanza',
  'Quizá venda más adelante',
  'Tengo una casa',
  'Compré hace años',
  'Soy vendedor de autos',
  'Trabajo en una aseguradora',
  'Sigo buscando pero primero tengo que vender',
  'Ya compré para vivir, pero sigo buscando para invertir',
  'No busco más en General Paz, pero sigo buscando en Cofico',
] as const;

const expectedDecision: Record<ConversationStatus, FollowUpDecision> = {
  'Sigue buscando': 'Seguimiento supervisado',
  'Esperando vender': 'Pausar',
  'Ya compró': 'No contactar',
  'No busca más': 'No contactar',
  'Contacto comercial': 'No contactar',
  'Revisar manualmente': 'Revisión manual',
};

function client(): Client {
  return {
    id: 1,
    name: 'Cliente corpus',
    phone: '5493515550001',
    interest: 'Propiedad en Córdoba',
    status: 'Lead',
    temperature: 'Tibio',
    pipeline: 'Contactado',
  };
}

function conversation(text: string): WhatsAppConversation {
  return {
    id: 1,
    clientId: 1,
    phone: '5493515550001',
    mode: 'IA supervisada',
    unread: 1,
    lastActivity: '2026-07-13T18:00:00.000Z',
    messages: [{
      id: 1,
      direction: 'inbound',
      sender: 'Cliente',
      text,
      createdAt: '2026-07-13T18:00:00.000Z',
    }],
  };
}

const corpus: Array<{ status: ConversationStatus; phrases: readonly string[] }> = [
  { status: 'Sigue buscando', phrases: activeSearch },
  { status: 'Esperando vender', phrases: waitingToSell },
  { status: 'Ya compró', phrases: alreadyBought },
  { status: 'No busca más', phrases: stoppedSearching },
  { status: 'Contacto comercial', phrases: commercialContacts },
  { status: 'Revisar manualmente', phrases: manualReview },
];

test('el corpus contiene por lo menos 200 conversaciones distintas', () => {
  const phrases = corpus.flatMap((group) => group.phrases);
  assert.equal(phrases.length, 216);
  assert.equal(new Set(phrases.map((phrase) => phrase.toLowerCase())).size, phrases.length);
});

for (const group of corpus) {
  test(`clasifica ${group.phrases.length} casos como ${group.status}`, () => {
    for (const phrase of group.phrases) {
      const result = auditConversation(conversation(phrase), client(), [], '2026-07-13T18:30:00.000Z');
      assert.equal(result.status, group.status, `Frase: ${phrase}`);
      assert.equal(result.decision, expectedDecision[group.status], `Decisión para: ${phrase}`);
      const safeMode = safeConversationMode(result, 'IA supervisada');
      assert.equal(safeMode, group.status === 'Sigue buscando' ? 'IA supervisada' : 'Pausada', `Modo seguro para: ${phrase}`);
    }
  });
}

test('el último estado explícito del historial prevalece', () => {
  const history = conversation('Sigo buscando');
  history.messages.push({
    id: 2,
    direction: 'inbound',
    sender: 'Cliente',
    text: 'Gracias, ya compré por otro lado',
    createdAt: '2026-07-13T19:00:00.000Z',
  });
  assert.equal(auditConversation(history, client(), []).status, 'Ya compró');
});

test('una coincidencia con Red comercial bloquea incluso un texto de búsqueda', () => {
  const result = auditConversation(conversation('Sigo buscando un departamento'), client(), [{
    id: 9,
    type: 'Constructor / Desarrollista',
    name: 'Desarrollos Centro',
    phone: '351 555-0001',
    createdAt: '2026-07-13T18:00:00.000Z',
  }]);
  assert.equal(result.status, 'Contacto comercial');
  assert.equal(result.decision, 'No contactar');
});
