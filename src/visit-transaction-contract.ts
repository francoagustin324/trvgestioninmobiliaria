import type { ActivityEntry, Client, SyncedVisit, VisitInterest, VisitStatus } from './models.js';

export type CommercialRecordReference =
  | { uid: string; legacyId?: never }
  | { uid?: never; legacyId: number };

interface VisitIntentBase {
  operationId: string;
  client: CommercialRecordReference;
  expectedClientRevision: number;
}

/** Frontend intent only. Organization, actor, membership and timestamps are server-derived. */
export interface VisitCreateIntent extends VisitIntentBase {
  operationType: 'VISIT_CREATE';
  property: CommercialRecordReference;
  localDate: string;
  localTime: string;
}

/** Frontend intent only. The server rechecks every relation and commercial invariant. */
export interface VisitResolveIntent extends VisitIntentBase {
  operationType: 'VISIT_RESOLVE';
  visitUid: string;
  expectedVisitRevision: number;
  status: Extract<VisitStatus, 'Realizada' | 'Cancelada' | 'No asistió'>;
  interest?: VisitInterest;
  objection?: string;
  nextAction?: string;
  nextFollowUp?: string;
}

export type VisitMutationIntent = VisitCreateIntent | VisitResolveIntent;

export interface TransactionalVisitActivity extends ActivityEntry {
  uid: string;
  revision: 0;
  operationId: string;
  visitUid: string;
  transactionOwner: 'visit';
}

/** Full server-authoritative aggregate returned by a committed mutation or replay. */
export interface VisitMutationResult {
  success: true;
  replayed: boolean;
  errorCode?: 'IDEMPOTENCY_REPLAY';
  operationId: string;
  operationType: VisitMutationIntent['operationType'];
  organizationId: string;
  serverTimestamp: string;
  client: Client & { revision: number };
  visit: SyncedVisit & { uid: string; revision: number; operationId: string };
  activity: TransactionalVisitActivity;
}

/** Backend-only foundation used by R2.2C to replace stale Client snapshot updates/deletes. */
export type ClientSnapshotCasIntent = {
  client: CommercialRecordReference;
  expectedRevision: number;
} & (
  | { action: 'update'; payload: Client }
  | { action: 'delete' }
);

export interface ClientSnapshotCasResult {
  success: true;
  organizationId: string;
  action: ClientSnapshotCasIntent['action'];
  client?: Client & { revision: number };
  serverTimestamp: string;
}
