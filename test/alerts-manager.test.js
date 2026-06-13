const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadWithMocks } = require('../test-support/load-with-mocks');

const modulePath = path.join(__dirname, '..', 'src', 'Modules', 'AlertsManager', 'index.js');

test('AlertsManager supports CRUD, action metadata, and an empty trigger registry', async () => {
  const runCalls = [];
  const events = [];

  const dbMock = {
    Manager: {
      All: async () => [
        null,
        [
          {
            RuleID: 1,
            Title: 'Workspace Rule',
            Scope: JSON.stringify({ Workspace: true, Groups: [], Clients: [] }),
            TriggerType: 'CUSTOM_EVENT',
            TriggerConfig: JSON.stringify({}),
            Actions: JSON.stringify([{ Type: 'http-api', Settings: {} }]),
            Enabled: 1,
            Timestamp: 1,
            UpdatedAt: 1,
          },
        ],
      ],
      Run: async (sql, params) => {
        runCalls.push([sql, params]);
        if (sql.includes('INSERT INTO AlertRules')) return [null, { lastID: 9 }];
        return [null, { changes: 1 }];
      },
    },
  };

  const actionsMock = {
    Manager: {
      GetAll: () => [{ ID: 'http-api', Name: 'HTTP API' }],
      Execute: async () => ({ Success: true }),
    },
  };

  const { Manager } = loadWithMocks(modulePath, {
    '../Logger': { CreateLogger: () => ({ error: () => {} }) },
    '../DB': dbMock,
    '../AlertActions': actionsMock,
    '../Broadcast': { Manager: { emit: (event, payload) => events.push([event, payload]) } },
    '../Utils': require('../src/Modules/Utils'),
  });

  const [allErr, allRules] = await Manager.GetAll();
  assert.equal(allErr, null);
  assert.equal(allRules.length, 1);

  const [createErr, created] = await Manager.Create({
    Title: 'Rule 2',
    Scope: { Workspace: true, Groups: [], Clients: [] },
    TriggerType: 'CUSTOM_EVENT',
    TriggerConfig: {},
    Actions: [{ Type: 'http-api', Settings: {} }],
    Enabled: true,
  });
  assert.equal(createErr, null);
  assert.equal(created.RuleID, 9);

  const [updateErr, updated] = await Manager.Update(9, { Enabled: false, Title: 'Rule 2 Updated' });
  assert.equal(updateErr, null);
  assert.equal(updated.Enabled, false);

  const [setEnabledErr, enabledResult] = await Manager.SetEnabled(9, true);
  assert.equal(setEnabledErr, null);
  assert.equal(enabledResult.Enabled, true);

  const [getErr, fetched] = await Manager.Get(9);
  assert.equal(getErr, null);
  assert.equal(fetched.Title, 'Rule 2 Updated');

  const [deleteErr, deleted] = await Manager.Delete(9);
  assert.equal(deleteErr, null);
  assert.equal(deleted, true);

  // ShowTrak Flow ships with no built-in triggers.
  assert.deepEqual(Manager.GetTriggers(), []);

  const actionTypes = Manager.GetActionTypes();
  assert.deepEqual(actionTypes, [{ ID: 'http-api', Name: 'HTTP API' }]);

  assert.ok(runCalls.some(([sql]) => sql.includes('INSERT INTO AlertRules')));
  assert.ok(runCalls.some(([sql]) => sql.includes('UPDATE AlertRules')));
  assert.ok(runCalls.some(([sql]) => sql.includes('DELETE FROM AlertRules')));
  assert.ok(events.filter(([event]) => event === 'AlertRuleListChanged').length >= 3);
});

test('AlertsManager.Evaluate fires matching rules, writes history, and broadcasts', async () => {
  const executeCalls = [];
  const untrackedRunCalls = [];
  const events = [];

  const rules = [
    {
      RuleID: 1,
      Title: 'Workspace Custom Event',
      Scope: JSON.stringify({ Workspace: true, Groups: [], Clients: [] }),
      TriggerType: 'CUSTOM_EVENT',
      TriggerConfig: JSON.stringify({}),
      Actions: JSON.stringify([{ Type: 'http-api', Settings: { Route: '/custom' } }]),
      Enabled: 1,
      Timestamp: 1,
      UpdatedAt: 1,
    },
    {
      RuleID: 2,
      Title: 'Disabled Rule',
      Scope: JSON.stringify({ Workspace: true, Groups: [], Clients: [] }),
      TriggerType: 'CUSTOM_EVENT',
      TriggerConfig: JSON.stringify({}),
      Actions: JSON.stringify([{ Type: 'http-api', Settings: {} }]),
      Enabled: 0,
      Timestamp: 1,
      UpdatedAt: 1,
    },
  ];

  const dbMock = {
    Manager: {
      All: async () => [null, rules],
      Run: async () => [null, { changes: 1 }],
      RunWithoutDirtyTracking: async (sql, params) => {
        untrackedRunCalls.push([sql, params]);
        return [null, { changes: 1 }];
      },
    },
  };

  const actionsMock = {
    Manager: {
      GetAll: () => [],
      Execute: async (action, context) => {
        executeCalls.push({ action, context });
        return { Success: true };
      },
    },
  };

  const { Manager } = loadWithMocks(modulePath, {
    '../Logger': { CreateLogger: () => ({ error: () => {} }) },
    '../DB': dbMock,
    '../AlertActions': actionsMock,
    '../Broadcast': { Manager: { emit: (event, payload) => events.push([event, payload]) } },
    '../Utils': require('../src/Modules/Utils'),
  });

  await Manager.Init();

  // A matching context fires only the enabled rule.
  await Manager.Evaluate({
    TriggerType: 'CUSTOM_EVENT',
    EntityType: 'flow',
    EntityName: 'Flow Item',
    UUID: 'item-1',
    GroupID: 1,
  });

  // A non-matching trigger type fires nothing.
  await Manager.Evaluate({ TriggerType: 'OTHER_EVENT', EntityType: 'flow', UUID: 'item-1' });

  assert.equal(executeCalls.length, 1);
  assert.equal(executeCalls[0].action.Type, 'http-api');

  const historyWrites = untrackedRunCalls.filter(([sql]) =>
    sql.includes('INSERT INTO AlertHistory')
  );
  assert.equal(historyWrites.length, 1);

  const triggeredEvents = events.filter(([event]) => event === 'AlertTriggered');
  assert.equal(triggeredEvents.length, 1);
  assert.equal(triggeredEvents[0][1].TriggerType, 'CUSTOM_EVENT');
});

test('AlertsManager.Evaluate respects scope and the master action toggle', async () => {
  const executeCalls = [];

  const rules = [
    {
      RuleID: 1,
      Title: 'Group 5 Rule',
      Scope: JSON.stringify({ Workspace: false, Groups: [5], Clients: [] }),
      TriggerType: 'CUSTOM_EVENT',
      TriggerConfig: JSON.stringify({}),
      Actions: JSON.stringify([{ Type: 'http-api', Settings: {} }]),
      Enabled: 1,
      Timestamp: 1,
      UpdatedAt: 1,
    },
    {
      RuleID: 2,
      Title: 'Entity c1 Rule',
      Scope: JSON.stringify({ Workspace: false, Groups: [], Clients: ['c1'] }),
      TriggerType: 'CUSTOM_EVENT',
      TriggerConfig: JSON.stringify({}),
      Actions: JSON.stringify([{ Type: 'http-api', Settings: {} }]),
      Enabled: 1,
      Timestamp: 1,
      UpdatedAt: 1,
    },
  ];

  const dbMock = {
    Manager: {
      All: async () => [null, rules],
      Run: async () => [null, { changes: 1 }],
      RunWithoutDirtyTracking: async () => [null, { changes: 1 }],
    },
  };

  const actionsMock = {
    Manager: {
      GetAll: () => [],
      Execute: async (action, context) => {
        executeCalls.push({ action, context });
        return { Success: true };
      },
    },
  };

  const { Manager } = loadWithMocks(modulePath, {
    '../Logger': { CreateLogger: () => ({ error: () => {} }) },
    '../DB': dbMock,
    '../AlertActions': actionsMock,
    '../Broadcast': { Manager: { emit: () => {} } },
    '../Utils': require('../src/Modules/Utils'),
  });

  await Manager.Init();

  // Matches the group-scoped rule only.
  await Manager.Evaluate({ TriggerType: 'CUSTOM_EVENT', GroupID: 5, UUID: 'other' });
  assert.equal(executeCalls.length, 1);

  // Matches the entity-scoped rule only.
  await Manager.Evaluate({ TriggerType: 'CUSTOM_EVENT', GroupID: 99, UUID: 'c1' });
  assert.equal(executeCalls.length, 2);

  // Out of scope: no group/entity match.
  await Manager.Evaluate({ TriggerType: 'CUSTOM_EVENT', GroupID: 99, UUID: 'nope' });
  assert.equal(executeCalls.length, 2);

  // Disabling the master toggle suppresses execution.
  Manager.SetActionsEnabled(false);
  assert.equal(Manager.GetActionsEnabled(), false);
  await Manager.Evaluate({ TriggerType: 'CUSTOM_EVENT', GroupID: 5, UUID: 'other' });
  assert.equal(executeCalls.length, 2);
});
