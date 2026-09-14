from pathlib import Path

path = Path('src/tests/sec-fix-a3-5-stale-role-fallback-authority.test.ts')
text = path.read_text(encoding='utf-8')

old = """interface CloudTelemetry {
  catalogMembershipQueries: number;
  directoryMembershipQueries: number;
  recordsGets: number;
  recordsPosts: number;
  recordsDeletes: number;
  visitAuthorityChecks: number;
  unexpectedEndpoints: string[];
}
"""
new = """interface RecordPostClassification {
  allowedRecommendationTelemetry: boolean;
  crmSnapshot: boolean;
  forbidden: boolean;
  reason: string;
}

interface CloudTelemetry {
  catalogMembershipQueries: number;
  directoryMembershipQueries: number;
  recordsGets: number;
  recordsPosts: number;
  recordPostBodies: unknown[];
  recommendationTelemetryPosts: number;
  crmSnapshotPosts: number;
  forbiddenRecordPosts: number;
  recordsDeletes: number;
  visitAuthorityChecks: number;
  unexpectedEndpoints: string[];
}
"""
if old not in text:
    raise SystemExit('CloudTelemetry marker not found')
text = text.replace(old, new, 1)

marker = "function syntheticJson(body: unknown, status = 200) {\n"
helper = """const FORBIDDEN_RECORD_POST_SENTINELS = [
  STALE_OWNER,
  STALE_SENTINEL,
  'A35_MISSING_MEMBER_DIRTY',
  'A35_MEMBER_ID_MISMATCH_DIRTY',
  SAME_ROLE_DIRTY,
] as const;

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function recommendationTelemetryPost(options: {
  organizationId?: string;
  entityType?: string;
  entityKey?: string;
  assignedMemberId?: number;
  createdBy?: string;
  recordKind?: string;
  eventType?: string;
  actorId?: number;
  clientId?: number;
} = {}): unknown[] {
  const organizationId = options.organizationId ?? ORG_ID;
  return [{
    organization_id: organizationId,
    entity_type: options.entityType ?? 'activity',
    entity_key: options.entityKey ?? `${organizationId}:recommendation-event:a35-classifier-event`,
    assigned_member_id: options.assignedMemberId ?? USER_MEMBER_ID,
    payload: {
      recordKind: options.recordKind ?? 'supervised_recommendation_event',
      eventId: 'a35-classifier-event',
      eventType: options.eventType ?? 'RECOMMENDATION_SHOWN',
      logicalRecommendationId: 'a35-classifier-recommendation',
      recommendationCycleId: 'a35-classifier-cycle',
      organizationId,
      actorId: options.actorId ?? USER_MEMBER_ID,
      clientId: options.clientId ?? 3500,
      occurredAt: '2026-09-14T00:05:00.000Z',
    },
    created_by: options.createdBy ?? USER_ID,
  }];
}

function classifyRecordPostBody(body: unknown): RecordPostClassification {
  const rows = Array.isArray(body) ? body : [body];
  const serialized = JSON.stringify(body) ?? '';
  const crmSnapshot = rows.some((value) => objectRecord(value)?.entity_type === 'client');
  if (!rows.length) {
    return { allowedRecommendationTelemetry: false, crmSnapshot: false, forbidden: true, reason: 'empty-body' };
  }
  if (FORBIDDEN_RECORD_POST_SENTINELS.some((sentinel) => serialized.includes(sentinel))) {
    return { allowedRecommendationTelemetry: false, crmSnapshot, forbidden: true, reason: 'stale-fixture-data' };
  }
  if (crmSnapshot) {
    return { allowedRecommendationTelemetry: false, crmSnapshot: true, forbidden: true, reason: 'crm-client-row' };
  }

  const namespace = `${ORG_ID}:recommendation-event:`;
  const allowed = rows.every((value) => {
    const row = objectRecord(value);
    if (!row) return false;
    const payload = objectRecord(row.payload);
    const entityKey = row.entity_key;
    return row.organization_id === ORG_ID
      && row.entity_type === 'activity'
      && typeof entityKey === 'string'
      && entityKey.startsWith(namespace)
      && entityKey.length > namespace.length
      && row.assigned_member_id === USER_MEMBER_ID
      && row.created_by === USER_ID
      && payload?.recordKind === 'supervised_recommendation_event'
      && payload.eventType === 'RECOMMENDATION_SHOWN'
      && payload.organizationId === ORG_ID
      && payload.actorId === USER_MEMBER_ID
      && payload.clientId === 3500;
  });
  return allowed
    ? { allowedRecommendationTelemetry: true, crmSnapshot: false, forbidden: false, reason: 'allowed-recommendation-telemetry' }
    : { allowedRecommendationTelemetry: false, crmSnapshot: false, forbidden: true, reason: 'unrecognized-record-post' };
}

function syntheticJson(body: unknown, status = 200) {
"""
if marker not in text:
    raise SystemExit('syntheticJson marker not found')
text = text.replace(marker, helper, 1)

old = """    recordsGets: 0,
    recordsPosts: 0,
    recordsDeletes: 0,
"""
new = """    recordsGets: 0,
    recordsPosts: 0,
    recordPostBodies: [],
    recommendationTelemetryPosts: 0,
    crmSnapshotPosts: 0,
    forbiddenRecordPosts: 0,
    recordsDeletes: 0,
"""
if old not in text:
    raise SystemExit('telemetry initializer marker not found')
text = text.replace(old, new, 1)

old = """      if (request.method() === 'POST') {
        telemetry.recordsPosts += 1;
        if (options.pushFailure) {
          await route.fulfill(syntheticJson(options.pushFailure.body, options.pushFailure.status));
          return;
        }
        const body = request.postDataJSON();
        rows = Array.isArray(body) ? structuredClone(body) : [structuredClone(body)];
        await route.fulfill(syntheticJson([], 201));
        return;
      }
"""
new = """      if (request.method() === 'POST') {
        telemetry.recordsPosts += 1;
        const body = request.postDataJSON();
        telemetry.recordPostBodies.push(structuredClone(body));
        const classification = classifyRecordPostBody(body);
        if (classification.allowedRecommendationTelemetry) telemetry.recommendationTelemetryPosts += 1;
        if (classification.crmSnapshot) telemetry.crmSnapshotPosts += 1;
        if (classification.forbidden) telemetry.forbiddenRecordPosts += 1;
        if (options.pushFailure) {
          await route.fulfill(syntheticJson(options.pushFailure.body, options.pushFailure.status));
          return;
        }
        rows = Array.isArray(body) ? structuredClone(body) : [structuredClone(body)];
        await route.fulfill(syntheticJson([], 201));
        return;
      }
"""
if old not in text:
    raise SystemExit('POST handler marker not found')
text = text.replace(old, new, 1)

marker = "test('A3.5 A: normal role downgrade with successful cloud hydration stays safe', async () => {\n"
classifier_tests = """test('A3.5 classifier contract: only exact current recommendation telemetry is allowed', () => {
  const valid = classifyRecordPostBody(recommendationTelemetryPost());
  assert.equal(valid.allowedRecommendationTelemetry, true);
  assert.equal(valid.crmSnapshot, false);
  assert.equal(valid.forbidden, false);

  const staleCrm = classifyRecordPostBody([{
    organization_id: ORG_ID,
    entity_type: 'client',
    entity_key: `${ORG_ID}:3501`,
    assigned_member_id: USER_MEMBER_ID,
    payload: { id: 3501, name: STALE_OWNER },
    created_by: USER_ID,
  }]);
  assert.equal(staleCrm.allowedRecommendationTelemetry, false);
  assert.equal(staleCrm.crmSnapshot, true);
  assert.equal(staleCrm.forbidden, true);

  const wrongTenant = classifyRecordPostBody(recommendationTelemetryPost({ organizationId: 'a35-wrong-org' }));
  assert.equal(wrongTenant.allowedRecommendationTelemetry, false);
  assert.equal(wrongTenant.forbidden, true);

  const wrongActor = classifyRecordPostBody(recommendationTelemetryPost({ actorId: OTHER_MEMBER_ID }));
  assert.equal(wrongActor.allowedRecommendationTelemetry, false);
  assert.equal(wrongActor.forbidden, true);

  const wrongMember = classifyRecordPostBody(recommendationTelemetryPost({ assignedMemberId: OTHER_MEMBER_ID }));
  assert.equal(wrongMember.allowedRecommendationTelemetry, false);
  assert.equal(wrongMember.forbidden, true);

  const wrongCreator = classifyRecordPostBody(recommendationTelemetryPost({ createdBy: OTHER_USER_ID }));
  assert.equal(wrongCreator.allowedRecommendationTelemetry, false);
  assert.equal(wrongCreator.forbidden, true);

  const wrongClient = classifyRecordPostBody(recommendationTelemetryPost({ clientId: 9999 }));
  assert.equal(wrongClient.allowedRecommendationTelemetry, false);
  assert.equal(wrongClient.forbidden, true);

  const genericActivity = classifyRecordPostBody(recommendationTelemetryPost({
    recordKind: 'generic_activity',
    eventType: 'GENERIC_ACTIVITY',
  }));
  assert.equal(genericActivity.allowedRecommendationTelemetry, false);
  assert.equal(genericActivity.forbidden, true);

  const mixedRows = classifyRecordPostBody([
    ...recommendationTelemetryPost(),
    {
      organization_id: ORG_ID,
      entity_type: 'activity',
      entity_key: `${ORG_ID}:arbitrary-activity:1`,
      assigned_member_id: USER_MEMBER_ID,
      payload: { recordKind: 'arbitrary_activity' },
      created_by: USER_ID,
    },
  ]);
  assert.equal(mixedRows.allowedRecommendationTelemetry, false);
  assert.equal(mixedRows.forbidden, true);

  console.log('CONTROL_F_CLASSIFIER_VALID_TELEMETRY=ALLOWED');
  console.log('CONTROL_F_CLASSIFIER_STALE_CRM=FORBIDDEN');
  console.log('CONTROL_F_CLASSIFIER_WRONG_TENANT=FORBIDDEN');
  console.log('CONTROL_F_CLASSIFIER_WRONG_ACTOR=FORBIDDEN');
  console.log('CONTROL_F_CLASSIFIER_WRONG_MEMBER=FORBIDDEN');
  console.log('CONTROL_F_CLASSIFIER_WRONG_CREATOR=FORBIDDEN');
  console.log('CONTROL_F_CLASSIFIER_WRONG_CLIENT=FORBIDDEN');
  console.log('CONTROL_F_CLASSIFIER_GENERIC_ACTIVITY=FORBIDDEN');
  console.log('CONTROL_F_CLASSIFIER_MIXED_ROWS=FORBIDDEN');
});

test('A3.5 A: normal role downgrade with successful cloud hydration stays safe', async () => {
"""
if marker not in text:
    raise SystemExit('Control A marker not found')
text = text.replace(marker, classifier_tests, 1)

old = """    assert.ok(control.telemetry.directoryMembershipQueries > 0);
    assert.ok(control.telemetry.recordsGets > 0);
    assert.equal(control.telemetry.recordsPosts, 0);
    assert.equal(control.telemetry.recordsDeletes, 0);
    console.log('CONTROL_F_CLEAN_STALE_REPLACED=YES');
"""
new = """    assert.ok(control.telemetry.directoryMembershipQueries > 0);
    assert.ok(control.telemetry.recordsGets > 0);
    assert.equal(control.telemetry.crmSnapshotPosts, 0, 'CONTROL_F: clean replacement must never POST a CRM snapshot');
    assert.equal(control.telemetry.forbiddenRecordPosts, 0, 'CONTROL_F: every record POST must satisfy the strict recommendation telemetry contract');
    assert.equal(
      control.telemetry.recordsPosts,
      control.telemetry.recommendationTelemetryPosts,
      'CONTROL_F: zero POSTs or exclusively allowed recommendation telemetry POSTs are valid',
    );
    for (const body of control.telemetry.recordPostBodies) {
      const classification = classifyRecordPostBody(body);
      assert.equal(classification.allowedRecommendationTelemetry, true, `CONTROL_F: forbidden record POST: ${classification.reason}`);
      assert.equal(classification.forbidden, false);
    }
    assert.equal(control.telemetry.recordsDeletes, 0);
    console.log(`CONTROL_F_RECORDS_POSTS=${control.telemetry.recordsPosts}`);
    console.log(`CONTROL_F_RECOMMENDATION_TELEMETRY_POSTS=${control.telemetry.recommendationTelemetryPosts}`);
    console.log(`CONTROL_F_CRM_SNAPSHOT_POSTS=${control.telemetry.crmSnapshotPosts}`);
    console.log(`CONTROL_F_FORBIDDEN_RECORD_POSTS=${control.telemetry.forbiddenRecordPosts}`);
    console.log('CONTROL_F_CLEAN_STALE_REPLACED=YES');
"""
if old not in text:
    raise SystemExit('Control F assertion marker not found')
text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
print('TEST_ONLY_PATCH=APPLIED')
