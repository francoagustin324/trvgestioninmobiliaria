import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAgendaItems } from '../agenda.js';
import { clientFromFormValues } from '../client-editor.js';
import {
  calculateCommissionAmount,
  closeLostClient,
  closeWonClient,
  commercialCloseSummary,
  hasStructuredClose,
  reopenCommercialClient,
  suggestedClosePropertyId,
  validateLostCloseValues,
  validateWonCloseValues,
} from '../commercial-close.js';
import { activitiesForClientSave, isTerminalClient } from '../lead-pipeline.js';
import type { Client, Offer, Reservation, SyncedVisit } from '../models.js';

function baseClient(overrides: Partial<Client> = {}): Client {
  return {
    id: 41,
    uid: '11111111-1111-4111-8111-111111111111',
    revision: 3,
    name: 'Cliente cierre',
    phone: '5493515550199',
    email: 'cierre@example.test',
    interest: 'Departamento de 2 dormitorios',
    status: 'Lead',
    temperature: 'Caliente',
    pipeline: 'Negociación',
    nextAction: 'Confirmar propuesta',
    nextFollowUp: '2026-09-10',
    budget: 'USD 120.000',
    currency: 'USD',
    paymentMethod: 'Contado',
    purchaseTimeframe: '0-3 meses',
    purpose: 'Vivir',
    knowsArea: 'Sí',
    canMoveForward: 'Sí',
    zones: 'General Paz',
    assignedToId: 1,
    createdById: 1,
    ...overrides,
  };
}

const commonFormValues = {
  name: 'Cliente cierre',
  phone: '5493515550199',
  email: 'cierre@example.test',
  interest: 'Departamento de 2 dormitorios',
  temperature: 'Caliente',
  budget: 'USD 120.000',
  currency: 'USD',
  paymentMethod: 'Contado',
  purchaseTimeframe: '0-3 meses',
  purpose: 'Vivir',
  knowsArea: 'Sí',
  canMoveForward: 'Sí',
  zones: 'General Paz',
};

function wonValues(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    ...commonFormValues,
    pipeline: 'Ganado',
    closedAt: '2026-09-03',
    dealAmount: '100000',
    dealCurrency: 'USD',
    dealPropertyId: '',
    dealPropertyUid: '',
    dealPropertyLabel: '',
    commissionMode: 'percentage',
    commissionPercentage: '3',
    commissionAmount: '3000',
    closeNote: 'Cierre documentado.',
    ...overrides,
  };
}

function lostValues(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    ...commonFormValues,
    pipeline: 'Perdido',
    closedAt: '2026-09-03',
    lostReason: 'Precio',
    lostReasonDetail: '',
    closeNote: '',
    ...overrides,
  };
}

test('Won valida precio, moneda y calcula comisión porcentual persistiendo monto explícito', () => {
  assert.equal(validateWonCloseValues(wonValues({ dealAmount: '0' })).ok, false);
  assert.equal(validateWonCloseValues(wonValues({ dealCurrency: '' })).ok, false);
  assert.equal(calculateCommissionAmount(100000, 3), 3000);

  const previous = baseClient();
  const won = clientFromFormValues(previous.id, wonValues(), previous);
  assert.equal(won.pipeline, 'Ganado');
  assert.equal(won.status, 'Operación ganada');
  assert.equal(won.outcome, 'won');
  assert.equal(won.dealAmount, 100000);
  assert.equal(won.dealCurrency, 'USD');
  assert.equal(won.commissionMode, 'percentage');
  assert.equal(won.commissionPercentage, 3);
  assert.equal(won.commissionAmount, 3000);
  assert.equal(won.commissionCurrency, 'USD');
  assert.equal(won.dealPropertyId, undefined);
  assert.equal(won.nextAction, undefined);
  assert.equal(won.nextFollowUp, undefined);
  assert.equal(buildAgendaItems([won], [], '2026-09-03').length, 0);
  assert.equal(hasStructuredClose(won), true);

  const activities = activitiesForClientSave(previous, won);
  assert.deepEqual(activities.map((entry) => entry.action), ['Operación ganada']);
  assert.match(activities[0]!.detail, /USD 100\.000/);
  assert.match(activities[0]!.detail, /Comisión USD 3\.000/);
});

test('Won acepta comisión fija y Property opcional o vinculada', () => {
  const previous = baseClient();
  const withoutProperty = closeWonClient(previous, wonValues({
    commissionMode: 'fixed',
    commissionPercentage: '',
    commissionAmount: '2500.50',
  }));
  assert.equal(withoutProperty.commissionPercentage, undefined);
  assert.equal(withoutProperty.commissionAmount, 2500.5);
  assert.equal(withoutProperty.dealPropertyId, undefined);

  const withProperty = closeWonClient(previous, wonValues({
    dealPropertyId: '17',
    dealPropertyUid: '22222222-2222-4222-8222-222222222222',
    dealPropertyLabel: 'Departamento General Paz',
  }));
  assert.equal(withProperty.dealPropertyId, 17);
  assert.equal(withProperty.dealPropertyUid, '22222222-2222-4222-8222-222222222222');
  assert.equal(withProperty.dealPropertyLabel, 'Departamento General Paz');
});

test('Lost exige motivo, Otro exige detalle, limpia Agenda y crea una Activity lógica', () => {
  assert.equal(validateLostCloseValues(lostValues({ lostReason: '' })).ok, false);
  assert.equal(validateLostCloseValues(lostValues({ lostReason: 'Otro', lostReasonDetail: '' })).ok, false);
  assert.equal(validateLostCloseValues(lostValues({ lostReason: 'Otro', lostReasonDetail: 'Cambio de ciudad' })).ok, true);

  const previous = baseClient();
  const lost = clientFromFormValues(previous.id, lostValues({
    lostReason: 'Otro',
    lostReasonDetail: 'Cambio de ciudad',
    closeNote: 'Retomar sólo si vuelve a Córdoba.',
  }), previous);
  assert.equal(lost.pipeline, 'Perdido');
  assert.equal(lost.status, 'Operación perdida');
  assert.equal(lost.outcome, 'lost');
  assert.equal(lost.lostReason, 'Otro');
  assert.equal(lost.lostReasonDetail, 'Cambio de ciudad');
  assert.equal(lost.dealAmount, undefined);
  assert.equal(lost.commissionAmount, undefined);
  assert.equal(lost.nextAction, undefined);
  assert.equal(lost.nextFollowUp, undefined);
  assert.equal(buildAgendaItems([lost], [], '2026-09-03').length, 0);

  const activities = activitiesForClientSave(previous, lost);
  assert.deepEqual(activities.map((entry) => entry.action), ['Operación perdida']);
  assert.match(activities[0]!.detail, /Cambio de ciudad/);
});

test('Reopen vuelve a etapa activa, limpia cierre vigente y conserva historial por Activity append-only', () => {
  const won = closeWonClient(baseClient(), wonValues());
  const oldActivity = {
    id: 90,
    actorId: 1,
    action: 'Operación ganada',
    entityType: 'Cliente' as const,
    entityId: won.id,
    detail: 'Cierre histórico',
    createdAt: '2026-09-03T12:00:00.000Z',
  };
  const history = [oldActivity];
  const reopened = reopenCommercialClient(won, 'Negociación');
  assert.equal(reopened.pipeline, 'Negociación');
  assert.equal(reopened.status, 'Lead');
  assert.equal(isTerminalClient(reopened), false);
  assert.equal(reopened.outcome, undefined);
  assert.equal(reopened.dealAmount, undefined);
  assert.equal(reopened.commissionAmount, undefined);
  assert.equal(reopened.closedAt, undefined);
  assert.deepEqual(history, [oldActivity]);

  const activities = activitiesForClientSave(won, reopened);
  assert.deepEqual(activities.map((entry) => entry.action), ['Operación reabierta']);
});

test('editar un Won estructurado sin re-cerrar conserva metadata; reabrir por editor la elimina', () => {
  const won = closeWonClient(baseClient(), wonValues({ dealPropertyId: '17', dealPropertyLabel: 'Depto' }));
  const sameTerminal = clientFromFormValues(won.id, {
    ...commonFormValues,
    pipeline: 'Ganado',
    interest: 'Departamento actualizado',
  }, won);
  assert.equal(sameTerminal.outcome, 'won');
  assert.equal(sameTerminal.dealAmount, 100000);
  assert.equal(sameTerminal.commissionAmount, 3000);
  assert.equal(sameTerminal.dealPropertyId, 17);

  const reopened = clientFromFormValues(won.id, {
    ...commonFormValues,
    pipeline: 'Contactado',
  }, won);
  assert.equal(reopened.pipeline, 'Contactado');
  assert.equal(reopened.outcome, undefined);
  assert.equal(reopened.dealAmount, undefined);
});

test('resumen comercial nunca mezcla USD y ARS y cuenta históricos sin inventar importes', () => {
  const usd = closeWonClient(baseClient({ id: 1 }), wonValues({ dealAmount: '100000', dealCurrency: 'USD', commissionAmount: '3000' }));
  const ars = closeWonClient(baseClient({ id: 2 }), wonValues({
    dealAmount: '90000000',
    dealCurrency: 'ARS',
    commissionMode: 'fixed',
    commissionPercentage: '',
    commissionAmount: '2700000',
  }));
  const historicalWon = baseClient({ id: 3, pipeline: 'Ganada', status: 'Operación ganada', nextAction: undefined, nextFollowUp: undefined });
  const historicalLost = baseClient({ id: 4, pipeline: 'Perdida', status: 'Operación perdida', nextAction: undefined, nextFollowUp: undefined });
  const summary = commercialCloseSummary([usd, ars, historicalWon, historicalLost]);
  assert.equal(summary.wonCount, 3);
  assert.equal(summary.lostCount, 1);
  assert.deepEqual(summary.byCurrency.USD, { dealAmount: 100000, commissionAmount: 3000 });
  assert.deepEqual(summary.byCurrency.ARS, { dealAmount: 90000000, commissionAmount: 2700000 });
  assert.equal(hasStructuredClose(historicalWon), false);
  assert.equal(hasStructuredClose(historicalLost), false);
});

test('preselección de Property sólo ocurre cuando la relación comercial es inequívoca y visible', () => {
  const clientId = 41;
  const offer = (id: number, propertyId: number, status: Offer['status'] = 'Aceptada'): Offer => ({
    id,
    clientId,
    propertyId,
    origin: 'Cliente',
    amount: 100000,
    currency: 'USD',
    status,
    assignedToId: 1,
    createdById: 1,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
  });
  const reservation = (id: number, propertyId: number): Reservation => ({
    id,
    clientId,
    propertyId,
    amount: 1000,
    currency: 'USD',
    reservedAt: '2026-09-02',
    status: 'Activa',
    assignedToId: 1,
    createdById: 1,
    createdAt: '2026-09-02T10:00:00.000Z',
    updatedAt: '2026-09-02T10:00:00.000Z',
  });
  const visit = (id: number, propertyId: number): SyncedVisit => ({
    id,
    clientId,
    propertyId,
    scheduledAt: '2026-09-04T18:00:00.000Z',
    status: 'Realizada',
    assignedToId: 1,
    createdById: 1,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
  });

  assert.equal(suggestedClosePropertyId(clientId, [offer(1, 7)], [], [], [7, 8]), 7);
  assert.equal(suggestedClosePropertyId(clientId, [offer(1, 7), offer(2, 8)], [], [], [7, 8]), undefined);
  assert.equal(suggestedClosePropertyId(clientId, [offer(1, 7)], [reservation(1, 8)], [visit(1, 7)], [7, 8]), 8);
  assert.equal(suggestedClosePropertyId(clientId, [], [], [visit(1, 7)], [8]), undefined);
});

test('un cierre porcentual incoherente no puede persistir una comisión recalculable distinta', () => {
  const invalid = wonValues({ commissionPercentage: '3', commissionAmount: '2999' });
  assert.equal(validateWonCloseValues(invalid).ok, false);
  assert.throws(() => closeWonClient(baseClient(), invalid));
});

test('closeLostClient nunca pide ni conserva dinero del cierre anterior', () => {
  const won = closeWonClient(baseClient(), wonValues());
  const lost = closeLostClient(won, lostValues({ lostReason: 'Financiación' }));
  assert.equal(lost.outcome, 'lost');
  assert.equal(lost.dealAmount, undefined);
  assert.equal(lost.dealCurrency, undefined);
  assert.equal(lost.commissionMode, undefined);
  assert.equal(lost.commissionAmount, undefined);
});
