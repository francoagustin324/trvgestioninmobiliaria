import { state, registerTransientStateReset } from './store.js';
import { visibleClients, visibleProperties } from './team-access.js';

export type ReadEntityType = 'lead' | 'property';

export type ReadEntityTarget = Readonly<{
  entityType: ReadEntityType;
  entityId: number;
}>;

export type ReadEntityNavigationSnapshot = Readonly<{
  target: ReadEntityTarget | null;
  returnTarget: ReadEntityTarget | null;
}>;

let target: ReadEntityTarget | null = null;
let returnTarget: ReadEntityTarget | null = null;

function copyTarget(value: ReadEntityTarget | null): ReadEntityTarget | null {
  return value ? Object.freeze({ ...value }) : null;
}

function validTargetShape(value: ReadEntityTarget | null | undefined): value is ReadEntityTarget {
  return Boolean(
    value
    && (value.entityType === 'lead' || value.entityType === 'property')
    && Number.isInteger(value.entityId)
    && value.entityId > 0,
  );
}

export function readEntityTargetIsVisible(value: ReadEntityTarget | null | undefined): boolean {
  if (!validTargetShape(value)) return false;
  return value.entityType === 'lead'
    ? visibleClients().some((client) => client.id === value.entityId)
    : visibleProperties().some((property) => property.id === value.entityId);
}

function activateReadTarget(value: ReadEntityTarget): void {
  if (value.entityType === 'lead') {
    state.activeModule = 'crm';
    state.editingClientId = null;
    state.openForms.client = false;
  } else {
    state.activeModule = 'propiedades';
    state.editingPropertyId = null;
    state.openForms.property = false;
  }
  target = copyTarget(value);
}

function renderReadTarget(): void {
  document.dispatchEvent(new CustomEvent('trv-render'));
}

export function openEntityReadOnly(
  nextTarget: ReadEntityTarget,
  options: Readonly<{ returnTarget?: ReadEntityTarget | null }> = {},
): boolean {
  if (!readEntityTargetIsVisible(nextTarget)) return false;
  const nextReturn = options.returnTarget ?? null;
  returnTarget = readEntityTargetIsVisible(nextReturn) ? copyTarget(nextReturn) : null;
  activateReadTarget(nextTarget);
  renderReadTarget();
  return true;
}

export function returnToEntityReadOnly(): boolean {
  const nextTarget = returnTarget;
  returnTarget = null;
  if (!nextTarget || !readEntityTargetIsVisible(nextTarget)) {
    target = null;
    return false;
  }
  activateReadTarget(nextTarget);
  renderReadTarget();
  return true;
}

export function currentReadEntityTarget(): ReadEntityTarget | null {
  const current = target;
  if (!current || !readEntityTargetIsVisible(current)) {
    target = null;
    return null;
  }
  return copyTarget(current);
}

export function currentReadEntityReturnTarget(): ReadEntityTarget | null {
  const current = returnTarget;
  if (!current || !readEntityTargetIsVisible(current)) {
    returnTarget = null;
    return null;
  }
  return copyTarget(current);
}

export function clearReadEntityNavigation(): void {
  target = null;
  returnTarget = null;
}

export function readEntityNavigationSnapshot(): ReadEntityNavigationSnapshot {
  return Object.freeze({
    target: currentReadEntityTarget(),
    returnTarget: currentReadEntityReturnTarget(),
  });
}

registerTransientStateReset(clearReadEntityNavigation);
