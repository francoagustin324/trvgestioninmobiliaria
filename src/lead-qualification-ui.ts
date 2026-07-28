import { requestIntelligentQualification, mergeQualificationSuggestions } from './lead-qualification-ai-client.js';
import {
  analyzeLeadQualification,
  applyQualificationReview,
  confirmedValue,
  conversationQualificationText,
  qualificationActivities,
  sourceLabel,
  suggestionBlockedByConfirmedValue,
  type QualificationAnalysis,
  type QualificationField,
  type QualificationSource,
  type ReviewedQualificationSuggestion,
} from './lead-qualification.js';
import type { Client, WhatsAppConversation } from './models.js';
import { saveData, state } from './store.js';
import { addActivity, visibleClients, visibleConversations } from './team-access.js';
import { escapeHtml } from './utils.js';

interface QualificationSession {
  clientId: number;
  source: QualificationSource;
  conversationId?: number;
  pastedText: string;
  analysis?: QualificationAnalysis;
  analyzing: boolean;
  error?: string;
  info?: string;
}

const sessions = new Map<number, QualificationSession>();
let openClientId: number | null = null;
const dateFormatter = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});

function sessionFor(clientId: number): QualificationSession {
  let session = sessions.get(clientId);
  if (!session) {
    const conversation = associatedConversations(clientId)[0];
    session = {
      clientId,
      source: conversation ? 'conversation' : 'whatsapp_text',
      conversationId: conversation?.id,
      pastedText: '',
      analyzing: false,
    };
    sessions.set(clientId, session);
  }
  return session;
}

function associatedConversations(clientId: number): WhatsAppConversation[] {
  return visibleConversations()
    .filter((conversation) => conversation.clientId === clientId)
    .sort((left, right) => right.lastActivity.localeCompare(left.lastActivity));
}

function sourceText(session: QualificationSession): string {
  if (session.source !== 'conversation') return session.pastedText.trim();
  const conversation = associatedConversations(session.clientId)
    .find((item) => item.id === session.conversationId);
  return conversation ? conversationQualificationText(conversation) : '';
}

function sourceOptions(session: QualificationSession, conversations: WhatsAppConversation[]): string {
  const sourceValues: Array<[QualificationSource, string]> = [
    ['conversation', 'Conversación asociada'],
    ['whatsapp_text', 'Texto de WhatsApp pegado'],
    ['notes_transcript', 'Notas o transcripción pegada'],
  ];
  return sourceValues.map(([value, label]) => {
    const disabled = value === 'conversation' && !conversations.length ? ' disabled' : '';
    const selected = session.source === value ? ' selected' : '';
    return `<option value="${value}"${selected}${disabled}>${label}</option>`;
  }).join('');
}

function conversationOptions(session: QualificationSession, conversations: WhatsAppConversation[]): string {
  return conversations.map((conversation) => {
    const date = new Date(conversation.lastActivity);
    const formatted = Number.isNaN(date.getTime()) ? conversation.lastActivity : dateFormatter.format(date);
    return `<option value="${conversation.id}"${session.conversationId === conversation.id ? ' selected' : ''}>${escapeHtml(formatted)} · ${conversation.messages.length} mensajes</option>`;
  }).join('');
}

function confidenceClass(value: string): string {
  return value === 'Alta' ? 'high' : value === 'Media' ? 'medium' : 'low';
}

function sameValue(left: string, right: string): boolean {
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  return normalize(left) === normalize(right);
}

function suggestionStatus(client: Client, field: QualificationField, value: string, ambiguous: boolean): string {
  const current = confirmedValue(client, field);
  if (ambiguous) return 'Ambiguo';
  if (current && sameValue(current, value)) return 'Confirmado';
  return 'Sugerido';
}

function suggestionRow(client: Client, item: QualificationAnalysis['suggestions'][number]): string {
  const current = confirmedValue(client, item.field);
  const blocked = suggestionBlockedByConfirmedValue(client, item);
  const status = suggestionStatus(client, item.field, item.value, Boolean(item.ambiguous));
  const terminal = item.terminalConfirmationRequired;
  const checked = !item.ambiguous && !blocked && !terminal && status !== 'Confirmado';
  const conflict = current && !sameValue(current, item.value);
  return `<article class="lead-qualification-suggestion ${status.toLowerCase()}${blocked ? ' blocked' : ''}" data-qualification-suggestion="${escapeHtml(item.id)}" data-field="${item.field}" data-confidence="${item.confidence}" data-original-value="${escapeHtml(item.value)}" data-ambiguous="${item.ambiguous ? 'true' : 'false'}">
    <div class="lead-qualification-suggestion-head">
      <label><input type="checkbox" data-accept-suggestion${checked ? ' checked' : ''}${blocked ? ' disabled' : ''}><span>${escapeHtml(item.label)}</span></label>
      <span class="qualification-state ${status.toLowerCase()}">${status}</span>
      <span class="qualification-confidence ${confidenceClass(item.confidence)}">Confianza ${item.confidence.toLowerCase()}</span>
    </div>
    ${current ? `<small class="qualification-current">Confirmado actualmente: <strong>${escapeHtml(current)}</strong></small>` : ''}
    <input data-suggestion-value value="${escapeHtml(item.value)}" aria-label="Valor propuesto para ${escapeHtml(item.label)}"${blocked ? ' disabled' : ''}>
    <blockquote>${escapeHtml(item.evidence)}</blockquote>
    ${item.warning ? `<p class="qualification-warning">${escapeHtml(item.warning)}</p>` : ''}
    ${conflict && !blocked ? '<label class="qualification-overwrite"><input type="checkbox" data-allow-overwrite>Reemplazar el dato confirmado</label>' : ''}
    ${blocked ? '<p class="qualification-protected">El dato confirmado no se reemplaza con una sugerencia ambigua o de menor confianza.</p>' : ''}
  </article>`;
}

function questionsBlock(analysis: QualificationAnalysis): string {
  if (!analysis.missingQuestions.length) return '<p class="qualification-complete">No queda una pregunta comercial prioritaria.</p>';
  const question = analysis.missingQuestions[0] || '';
  return `<section class="qualification-questions"><div><h4>Próxima pregunta</h4><p>Una sola pregunta, priorizada por impacto comercial.</p></div><p data-next-question>${escapeHtml(question)}</p><button type="button" class="secondary" data-copy-next-question>Copiar próxima pregunta</button></section>`;
}

function analysisBlock(client: Client, analysis: QualificationAnalysis): string {
  const stage = analysis.suggestions.find((item) => item.field === 'pipeline');
  const temperature = analysis.suggestions.find((item) => item.field === 'temperature');
  const terminal = Boolean(stage?.terminalConfirmationRequired);
  return `<div class="lead-qualification-review">
    <div class="qualification-legend" aria-label="Estados de revisión"><span class="confirmado">Confirmado</span><span class="sugerido">Sugerido</span><span class="faltante">Faltante</span><span class="ambiguo">Ambiguo</span></div>
    <div class="qualification-recommendations">
      <div><span>Etapa sugerida</span><strong>${escapeHtml(stage?.value || 'Sin sugerencia')}</strong><small>${escapeHtml(stage?.evidence || 'Sin señales suficientes.')}</small></div>
      <div><span>Temperatura sugerida</span><strong>${escapeHtml(temperature?.value || 'Sin sugerencia')}</strong><small>${escapeHtml(temperature?.evidence || 'Sin señales suficientes.')}</small></div>
    </div>
    ${analysis.visitWarning ? `<div class="qualification-visit-warning"><strong>${escapeHtml(analysis.visitWarning)}</strong></div>` : '<div class="qualification-visit-ready">El Lead tiene señales suficientes para evaluar una visita.</div>'}
    <div class="lead-qualification-suggestions">${analysis.suggestions.map((item) => suggestionRow(client, item)).join('') || '<p class="empty-state">No se detectaron datos comerciales concretos.</p>'}</div>
    ${terminal ? '<label class="qualification-terminal-confirm"><input type="checkbox" data-confirm-terminal>Confirmo humanamente el estado terminal sugerido</label>' : ''}
    ${questionsBlock(analysis)}
    <div class="lead-qualification-actions"><button type="button" data-apply-qualification>Aplicar calificación</button><small>Solo se guardan los campos aceptados. La información detectada sigue siendo editable.</small></div>
  </div>`;
}

export function isLeadQualificationOpen(clientId: number): boolean {
  return openClientId === clientId;
}

export function requestLeadQualification(clientId: number, conversationId?: number): void {
  const client = visibleClients().find((item) => item.id === clientId);
  if (!client) return;
  openClientId = clientId;
  const session = sessionFor(clientId);
  if (conversationId && associatedConversations(clientId).some((item) => item.id === conversationId)) {
    session.source = 'conversation';
    session.conversationId = conversationId;
  }
  session.error = undefined;
  document.dispatchEvent(new CustomEvent('trv-render'));
}

export function closeLeadQualification(): void {
  openClientId = null;
}

function keepMobileControlVisible(control: HTMLElement): void {
  if (typeof window === 'undefined' || !window.matchMedia('(max-width: 720px)').matches) return;
  window.requestAnimationFrame(() => {
    if (!control.isConnected) return;
    const rect = control.getBoundingClientRect();
    const navigation = document.querySelector<HTMLElement>('.mobile-bottom-nav');
    const navigationVisible = navigation && getComputedStyle(navigation).display !== 'none';
    const navigationTop = navigationVisible ? navigation.getBoundingClientRect().top : window.innerHeight;
    const topBoundary = 76;
    const bottomBoundary = navigationTop - 12;
    if (rect.top >= topBoundary && rect.bottom <= bottomBoundary) return;
    const availableHeight = Math.max(120, bottomBoundary - topBoundary);
    const targetTop = Math.max(0, window.scrollY + rect.top - topBoundary - Math.max(0, (availableHeight - rect.height) / 2));
    window.scrollTo({ top: targetTop, behavior: 'auto' });
  });
}

export function renderLeadQualificationPanel(client: Client): string {
  if (!isLeadQualificationOpen(client.id)) return '';
  const session = sessionFor(client.id);
  const conversations = associatedConversations(client.id);
  const showTextarea = session.source !== 'conversation';
  const placeholder = session.source === 'notes_transcript'
    ? 'Pegá notas de una llamada, reunión o transcripción de audio.'
    : 'Pegá el intercambio de WhatsApp. Si incluye nombres, se excluirán las preguntas del corredor.';
  return `<section class="lead-qualification-panel" data-qualification-client="${client.id}">
    <header><div><span>Calificación supervisada</span><h3>Calificar automáticamente</h3><p>Detecta solo la información comercial esencial y siempre requiere revisión antes de guardar.</p></div><button type="button" class="quiet-button" data-close-qualification>Cerrar</button></header>
    <div class="lead-qualification-source">
      <label>Fuente<select data-qualification-source>${sourceOptions(session, conversations)}</select></label>
      ${session.source === 'conversation' ? `<label>Conversación<select data-qualification-conversation>${conversationOptions(session, conversations)}</select></label>` : ''}
      ${showTextarea ? `<label class="qualification-textarea">Texto para analizar<textarea rows="7" data-qualification-text placeholder="${escapeHtml(placeholder)}">${escapeHtml(session.pastedText)}</textarea></label>` : `<div class="qualification-source-summary"><strong>${conversations.length ? 'Se analizarán únicamente los mensajes entrantes del cliente.' : 'No hay una conversación asociada visible.'}</strong><span>Los audios usan la transcripción disponible.</span></div>`}
    </div>
    <div class="lead-qualification-analyze"><button type="button" data-analyze-qualification${session.analyzing ? ' disabled' : ''}>${session.analyzing ? 'Analizando…' : 'Analizar'}</button><small>El extractor determinístico funciona sin servicios pagos. La capa inteligente solo se consulta si está configurada en el servidor.</small></div>
    ${session.error ? `<p class="form-error">${escapeHtml(session.error)}</p>` : ''}
    ${session.info ? `<p class="qualification-info">${escapeHtml(session.info)}</p>` : ''}
    ${session.analysis ? analysisBlock(client, session.analysis) : '<div class="qualification-empty"><strong>Todavía no se modificó el Lead.</strong><span>Elegí una fuente y analizá para revisar únicamente los campos detectados.</span></div>'}
  </section>`;
}

function reviewedSuggestions(panel: HTMLElement, analysis: QualificationAnalysis): ReviewedQualificationSuggestion[] {
  return analysis.suggestions.map((item) => {
    const row = panel.querySelector<HTMLElement>(`[data-qualification-suggestion="${CSS.escape(item.id)}"]`);
    const checkbox = row?.querySelector<HTMLInputElement>('[data-accept-suggestion]');
    const input = row?.querySelector<HTMLInputElement>('[data-suggestion-value]');
    const overwrite = row?.querySelector<HTMLInputElement>('[data-allow-overwrite]');
    const editedValue = input?.value.trim() || item.value;
    const humanEdited = editedValue !== item.value;
    return {
      ...item,
      accepted: Boolean(checkbox?.checked),
      editedValue,
      confidence: humanEdited ? 'Alta' : item.confidence,
      confidenceScore: humanEdited ? 100 : item.confidenceScore,
      ambiguous: humanEdited ? false : item.ambiguous,
      allowConfirmedOverwrite: humanEdited || Boolean(overwrite?.checked),
    };
  });
}

async function analyze(client: Client, session: QualificationSession, rerender: () => void): Promise<void> {
  const text = sourceText(session);
  if (!text) {
    session.error = session.source === 'conversation'
      ? 'La conversación asociada no contiene mensajes entrantes analizables.'
      : 'Pegá un texto antes de analizar.';
    rerender();
    return;
  }
  session.error = undefined;
  session.info = undefined;
  session.analyzing = true;
  rerender();
  const deterministic = analyzeLeadQualification(client, text, session.source);
  session.analysis = deterministic;
  qualificationActivities(client.id, deterministic).forEach(addActivity);
  saveData(`Calificación analizada: ${client.name}`);
  const intelligent = await requestIntelligentQualification(text, deterministic);
  session.analysis = {
    ...deterministic,
    suggestions: mergeQualificationSuggestions(deterministic.suggestions, intelligent.suggestions),
    intelligentUsed: intelligent.suggestions.length > 0,
    providerAvailable: intelligent.available,
  };
  session.info = intelligent.error
    || (intelligent.suggestions.length ? 'Se agregaron sugerencias opcionales del análisis del servidor.' : 'Resultado generado con el extractor determinístico.');
  session.analyzing = false;
  rerender();
}

export function bindLeadQualificationPanel(
  container: HTMLElement,
  client: Client,
  rerender: () => void,
): void {
  const panel = container.querySelector<HTMLElement>(`[data-qualification-client="${client.id}"]`);
  if (!panel) return;
  const session = sessionFor(client.id);

  panel.querySelectorAll<HTMLElement>('input, textarea, select, button').forEach((control) => {
    control.addEventListener('focus', () => keepMobileControlVisible(control));
  });
  panel.querySelector<HTMLButtonElement>('[data-close-qualification]')?.addEventListener('click', () => {
    closeLeadQualification();
    rerender();
  });
  panel.querySelector<HTMLSelectElement>('[data-qualification-source]')?.addEventListener('change', (event) => {
    session.source = (event.currentTarget as HTMLSelectElement).value as QualificationSource;
    session.analysis = undefined;
    session.error = undefined;
    rerender();
  });
  panel.querySelector<HTMLSelectElement>('[data-qualification-conversation]')?.addEventListener('change', (event) => {
    session.conversationId = Number((event.currentTarget as HTMLSelectElement).value);
    session.analysis = undefined;
  });
  panel.querySelector<HTMLTextAreaElement>('[data-qualification-text]')?.addEventListener('input', (event) => {
    session.pastedText = (event.currentTarget as HTMLTextAreaElement).value;
  });
  panel.querySelector<HTMLButtonElement>('[data-analyze-qualification]')?.addEventListener('click', () => {
    void analyze(client, session, rerender);
  });
  panel.querySelector<HTMLButtonElement>('[data-copy-next-question]')?.addEventListener('click', async () => {
    const question = session.analysis?.missingQuestions[0];
    if (!question) return;
    try {
      await navigator.clipboard.writeText(question);
      session.info = 'Próxima pregunta copiada.';
    } catch {
      session.info = question;
    }
    rerender();
  });
  panel.querySelector<HTMLButtonElement>('[data-apply-qualification]')?.addEventListener('click', () => {
    const current = visibleClients().find((item) => item.id === client.id);
    const analysis = session.analysis;
    if (!current || !analysis) return;
    const reviewed = reviewedSuggestions(panel, analysis);
    const confirmTerminal = Boolean(panel.querySelector<HTMLInputElement>('[data-confirm-terminal]')?.checked);
    const result = applyQualificationReview(current, reviewed, confirmTerminal);
    const index = state.crm.clients.findIndex((item) => item.id === current.id);
    if (index === -1) return;
    state.crm.clients[index] = result.client;
    qualificationActivities(current.id, analysis, result).slice(1).forEach(addActivity);
    const alreadyConfirmed = analysis.suggestions.filter((item) => {
      const currentValue = confirmedValue(current, item.field);
      return Boolean(currentValue && sameValue(currentValue, item.value));
    }).length;
    const newCount = result.appliedFields.length;
    const reviewRequired = result.reviewRequiredFields.length;
    session.info = `${newCount} ${newCount === 1 ? 'dato nuevo guardado' : 'datos nuevos guardados'}; ${alreadyConfirmed} ${alreadyConfirmed === 1 ? 'dato ya estaba confirmado' : 'datos ya estaban confirmados'}; ${reviewRequired} ${reviewRequired === 1 ? 'dato requiere revisión' : 'datos requieren revisión'}.`;
    saveData(`Calificación aplicada: ${current.name}`);
    rerender();
  });
}

export function resetLeadQualificationForTests(): void {
  sessions.clear();
  openClientId = null;
}

export function qualificationSourceLabelForTests(source: QualificationSource): string {
  return sourceLabel(source);
}
