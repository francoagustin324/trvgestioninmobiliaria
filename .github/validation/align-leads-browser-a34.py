from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 anchor, found {count}")
    return text.replace(old, new, 1)


path = Path("src/tests/leads-desktop-zero-training.test.ts")
text = path.read_text()

old_membership = r'''function syntheticMembership() {
  return {
    organization_id: ORG_ID,
    member_id: 1,
    user_id: USER_ID,
    role: 'owner',
    status: 'active',
    display_name: owner().name,
    email: owner().email,
    phone: owner().phone,
    created_at: '2026-08-11T12:00:00.000Z',
    last_active_at: '2026-09-13T18:00:00.000Z',
  };
}
'''
new_membership = r'''function syntheticOwnerMembership() {
  return {
    organization_id: ORG_ID,
    member_id: 1,
    user_id: USER_ID,
    role: 'owner',
    status: 'active',
    display_name: owner().name,
    email: owner().email,
    phone: owner().phone,
    created_at: '2026-08-11T12:00:00.000Z',
    last_active_at: '2026-09-13T18:00:00.000Z',
  };
}

function syntheticSecondMembership() {
  const member = secondMember();
  return {
    organization_id: ORG_ID,
    member_id: member.id,
    user_id: member.userId,
    role: 'owner',
    status: 'active',
    display_name: member.name,
    email: member.email,
    phone: member.phone,
    created_at: member.createdAt,
    last_active_at: '2026-09-13T18:00:00.000Z',
  };
}
'''
text = replace_once(text, old_membership, new_membership, "membership helpers")

old_route = r'''    if (url.pathname.endsWith('/rest/v1/organization_members')) {
      await route.fulfill(syntheticJson([syntheticMembership()]));
      return;
    }
'''
new_route = r'''    if (url.pathname.endsWith('/rest/v1/organization_members')) {
      const userFilter = url.searchParams.get('user_id');
      const organizationFilter = url.searchParams.get('organization_id');
      if (userFilter === `eq.${USER_ID}`) {
        await route.fulfill(syntheticJson([syntheticOwnerMembership()]));
        return;
      }
      if (organizationFilter === `eq.${ORG_ID}`) {
        await route.fulfill(syntheticJson([syntheticOwnerMembership(), syntheticSecondMembership()]));
        return;
      }
      await route.fulfill(syntheticJson({ error: 'UNEXPECTED_ORGANIZATION_MEMBERS_QUERY', search: url.search }, 500));
      return;
    }
'''
text = replace_once(text, old_route, new_route, "organization roster semantics")

old_assertion_anchor = r'''    await filterSummary.click();
    await waitForFilterPanelVisible(page);
    for (const selector of ['#mvp-lead-stage-filter', '#mvp-lead-temperature-filter', '#mvp-lead-assignee-filter', '#mvp-lead-order']) {
'''
new_assertion_anchor = r'''    await filterSummary.click();
    await waitForFilterPanelVisible(page);
    const assigneeOptions = await page.locator('#mvp-lead-assignee-filter option').evaluateAll((options) => options.map((option) => ({
      value: (option as HTMLOptionElement).value,
      label: option.textContent?.trim() ?? '',
    })));
    assert.ok(assigneeOptions.some((option) => option.value === '1'), `Falta member 1 en asignados: ${JSON.stringify(assigneeOptions)}`);
    assert.ok(assigneeOptions.some((option) => option.value === '2'), `Falta member 2 en asignados: ${JSON.stringify(assigneeOptions)}`);
    console.log(`PR143_ASSIGNEE_OPTIONS=${JSON.stringify(assigneeOptions)}`);
    for (const selector of ['#mvp-lead-stage-filter', '#mvp-lead-temperature-filter', '#mvp-lead-assignee-filter', '#mvp-lead-order']) {
'''
text = replace_once(text, old_assertion_anchor, new_assertion_anchor, "assignee runtime proof")

path.write_text(text)
