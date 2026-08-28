export type TransactionalCommercialEntityType = 'visit' | 'offer' | 'reservation';

/**
 * R2.1 mantiene el snapshot como writer de todas las entidades comerciales.
 * R2.2+ podrá declarar una familia migrada para impedir que el writer histórico
 * sobrescriba revisiones producidas por una RPC. Esta interfaz no está conectada
 * todavía al push productivo.
 */
export interface CommercialSyncAuthority {
  transactionOwnedEntityTypes: ReadonlySet<TransactionalCommercialEntityType>;
}

export const SNAPSHOT_ONLY_COMMERCIAL_AUTHORITY: CommercialSyncAuthority = {
  transactionOwnedEntityTypes: new Set(),
};

export function snapshotMayWriteCommercialEntity(
  entityType: TransactionalCommercialEntityType,
  authority: CommercialSyncAuthority = SNAPSHOT_ONLY_COMMERCIAL_AUTHORITY,
): boolean {
  return !authority.transactionOwnedEntityTypes.has(entityType);
}
