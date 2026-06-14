const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadWithMocks } = require('../test-support/load-with-mocks');

const Logger = { CreateLogger: () => ({ error() {}, log() {}, database() {}, databaseError() {} }) };
const Utils = require('../src/Modules/Utils');

function makeBroadcast(events) {
  return { Manager: { emit: (event, payload) => events.push([event, payload]) } };
}

const flagPath = path.join(__dirname, '..', 'src', 'Modules', 'FlagManager', 'index.js');
const remoteUsersPath = path.join(
  __dirname,
  '..',
  'src',
  'Modules',
  'RemoteUsersManager',
  'index.js'
);
const showColoursPath = path.join(
  __dirname,
  '..',
  'src',
  'Modules',
  'ShowColoursManager',
  'index.js'
);
const chatRoomsPath = path.join(
  __dirname,
  '..',
  'src',
  'Modules',
  'ChatRoomsManager',
  'index.js'
);
const scenePath = path.join(__dirname, '..', 'src', 'Modules', 'SceneManager', 'index.js');
const flowPath = path.join(__dirname, '..', 'src', 'Modules', 'FlowGroupsManager', 'index.js');
const queuePath = path.join(__dirname, '..', 'src', 'Modules', 'QueueManager', 'index.js');

test('FlagManager performs CRUD and reorder with broadcasts', async () => {
  const events = [];
  const runCalls = [];
  const dbMock = {
    Manager: {
      All: async () => [null, [{ FlagID: 1, Label: 'VIP', Icon: 'star', SortOrder: 0 }]],
      Run: async (sql, params) => {
        runCalls.push([sql, params]);
        if (/INSERT INTO FlagDefinitions/.test(sql)) return [null, { lastID: 7 }];
        return [null, { changes: 1 }];
      },
    },
  };
  const { Manager } = loadWithMocks(flagPath, {
    '../Logger': Logger,
    '../DB': dbMock,
    '../Broadcast': makeBroadcast(events),
    '../Utils': Utils,
  });

  const [allErr, all] = await Manager.GetAll();
  assert.equal(allErr, null);
  assert.equal(all.length, 1);

  const [createErr, created] = await Manager.Create({ Label: 'Wheelchair', Icon: 'person-wheelchair' });
  assert.equal(createErr, null);
  assert.equal(created.FlagID, 7);
  assert.equal(created.Colour, '#F4C453');

  const [updateErr, updated] = await Manager.Update(7, { Label: 'Access', Colour: '#00AACC' });
  assert.equal(updateErr, null);
  assert.equal(updated.Label, 'Access');
  assert.equal(updated.Colour, '#00AACC');

  const [delErr, delRes] = await Manager.Delete(7);
  assert.equal(delErr, null);
  assert.equal(delRes, true);

  assert.ok(events.filter(([e]) => e === 'FlagListChanged').length >= 3);
});

test('RemoteUsersManager performs CRUD with 4-digit pin payloads and broadcasts', async () => {
  const events = [];
  const dbMock = {
    Manager: {
      All: async () => [
        null,
        [
          {
            RemoteUserID: 1,
            Username: 'TechOne',
            Pin: '1234',
            IsAdmin: 1,
            Colour: '#5B8DEF',
            Icon: 'person-fill',
            SortOrder: 0,
          },
        ],
      ],
      Run: async (sql) => {
        if (/INSERT INTO RemoteUsers/.test(sql)) return [null, { lastID: 9 }];
        return [null, { changes: 1 }];
      },
    },
  };
  const { Manager } = loadWithMocks(remoteUsersPath, {
    '../Logger': Logger,
    '../DB': dbMock,
    '../Broadcast': makeBroadcast(events),
    '../Utils': Utils,
  });

  const [allErr, all] = await Manager.GetAll();
  assert.equal(allErr, null);
  assert.equal(all.length, 1);
  assert.equal(all[0].IsAdmin, true);

  const [createErr, created] = await Manager.Create({
    Username: 'OpsTwo',
    Pin: '6789',
    IsAdmin: false,
    Colour: '#FF9900',
    Icon: 'shield-lock',
  });
  assert.equal(createErr, null);
  assert.equal(created.RemoteUserID, 9);
  assert.equal(created.Pin, '6789');
  assert.equal(created.IsAdmin, false);

  const [updateErr, updated] = await Manager.Update(9, {
    Username: 'OpsTwoAdmin',
    IsAdmin: true,
    Pin: '1111',
  });
  assert.equal(updateErr, null);
  assert.equal(updated.Username, 'OpsTwoAdmin');
  assert.equal(updated.IsAdmin, true);
  assert.equal(updated.Pin, '1111');

  const [delErr, delRes] = await Manager.Delete(9);
  assert.equal(delErr, null);
  assert.equal(delRes, true);

  assert.ok(events.filter(([e]) => e === 'RemoteUserListChanged').length >= 3);
});

test('ShowColoursManager performs CRUD and broadcasts', async () => {
  const events = [];
  const runCalls = [];
  const dbMock = {
    Manager: {
      All: async () => [
        null,
        [
          {
            ShowColourID: 1,
            Label: 'Primary Blue',
            Colour: '#5B8DEF',
            SortOrder: 0,
          },
        ],
      ],
      Run: async (sql) => {
        runCalls.push(sql);
        if (/INSERT INTO ShowColours/.test(sql)) return [null, { lastID: 6 }];
        return [null, { changes: 1 }];
      },
    },
  };
  const { Manager } = loadWithMocks(showColoursPath, {
    '../Logger': Logger,
    '../DB': dbMock,
    '../Broadcast': makeBroadcast(events),
    '../Utils': Utils,
  });

  const [allErr, all] = await Manager.GetAll();
  assert.equal(allErr, null);
  assert.equal(all.length, 1);

  const [createErr, created] = await Manager.Create({ Label: 'Signal Red', Colour: '#E05858' });
  assert.equal(createErr, null);
  assert.equal(created.ShowColourID, 6);
  assert.equal(created.Colour, '#E05858');

  const [updateErr, updated] = await Manager.Update(6, { Label: 'Signal Crimson' });
  assert.equal(updateErr, null);
  assert.equal(updated.Label, 'Signal Crimson');

  const [delErr, delRes] = await Manager.Delete(6);
  assert.equal(delErr, null);
  assert.equal(delRes, true);

  const [resetErr, resetRes] = await Manager.ResetToDefaults();
  assert.equal(resetErr, null);
  assert.ok(Array.isArray(resetRes));
  assert.ok(runCalls.some((sql) => /DELETE FROM ShowColours/.test(sql)));

  assert.ok(events.filter(([e]) => e === 'ShowColourListChanged').length >= 3);
});

test('ChatRoomsManager merges custom + scene rooms and sends Control messages', async () => {
  const events = [];
  const runCalls = [];
  const dbMock = {
    Manager: {
      All: async (sql) => {
        if (/FROM CustomChatRooms/.test(sql)) {
          return [
            null,
            [
              {
                CustomChatRoomID: 10,
                Label: 'Ops Room',
                Colour: '#1E88E5',
                Icon: 'chat-square-text',
                SortOrder: 0,
              },
            ],
          ];
        }
        if (/FROM ChatMessages/.test(sql)) {
          return [
            null,
            [
              {
                MessageID: 1,
                RoomType: 'CUSTOM',
                RoomID: 10,
                AuthorLabel: 'Control',
                AuthorIcon: 'gear-fill',
                AuthorColour: '#E53935',
                Message: 'Hello',
                Timestamp: 1700000000000,
              },
            ],
          ];
        }
        return [null, []];
      },
      Get: async (sql) => {
        if (/FROM CustomChatRooms/.test(sql)) return [null, { CustomChatRoomID: 10 }];
        return [null, null];
      },
      Run: async (sql, params) => {
        runCalls.push([sql, params]);
        if (/INSERT INTO ChatMessages/.test(sql)) return [null, { lastID: 2 }];
        if (/INSERT INTO CustomChatRooms/.test(sql)) return [null, { lastID: 11 }];
        return [null, { changes: 1 }];
      },
    },
  };
  const sceneManagerMock = {
    Manager: {
      GetAll: async () => [
        null,
        [
          {
            SceneID: 2,
            Label: 'Scene Room',
            HasChatRoom: true,
            Colour: '#43A047',
            Icon: 'chat-left-text-fill',
            SortOrder: 0,
          },
        ],
      ],
      Get: async () => [
        null,
        {
          SceneID: 2,
          Label: 'Scene Room',
          HasChatRoom: true,
          Colour: '#43A047',
          Icon: 'chat-left-text-fill',
          SortOrder: 0,
        },
      ],
    },
  };

  const { Manager } = loadWithMocks(chatRoomsPath, {
    '../Logger': Logger,
    '../DB': dbMock,
    '../Broadcast': makeBroadcast(events),
    '../SceneManager': sceneManagerMock,
    '../Utils': Utils,
  });

  const [roomsErr, rooms] = await Manager.GetAllRooms();
  assert.equal(roomsErr, null);
  assert.equal(rooms.length, 2);
  assert.equal(rooms[0].RoomType, 'CUSTOM');
  assert.equal(rooms[1].RoomType, 'SCENE');

  const [sendErr, sendRes] = await Manager.SendControlMessage('CUSTOM', 10, 'Hello world');
  assert.equal(sendErr, null);
  assert.equal(sendRes, true);
  assert.ok(
    runCalls.some(
      ([sql, params]) =>
        /INSERT INTO ChatMessages/.test(sql) && params[2] === 'Control' && params[3] === 'gear-fill'
    )
  );

  const [messagesErr, messages] = await Manager.GetMessages('CUSTOM', 10);
  assert.equal(messagesErr, null);
  assert.equal(messages[0].AuthorLabel, 'Control');
});

test('SceneManager creates, updates and reorders scenes', async () => {
  const events = [];
  const dbMock = {
    Manager: {
      All: async () => [
        null,
        [
          {
            SceneID: 1,
            Label: 'Lobby',
            Duration: 120,
            Milestones: '[]',
            TimerStartedAt: null,
            HasChatRoom: 0,
            MaxGroups: null,
            SortOrder: 0,
          },
        ],
      ],
      Run: async (sql) => {
        if (/INSERT INTO Scenes/.test(sql)) return [null, { lastID: 4 }];
        return [null, { changes: 1 }];
      },
    },
  };
  const { Manager } = loadWithMocks(scenePath, {
    '../Logger': Logger,
    '../DB': dbMock,
    '../Broadcast': makeBroadcast(events),
    '../Utils': Utils,
  });

  const [createErr, created] = await Manager.Create({
    Label: 'Maze',
    Duration: 300,
    HasChatRoom: true,
    MaxGroups: 2,
    Milestones: [{ Label: 'Reveal', Offset: 60, Colour: '#FF0000' }],
  });
  assert.equal(createErr, null);
  assert.equal(created.SceneID, 4);
  assert.equal(created.Milestones.length, 1);
  assert.equal(created.HasChatRoom, true);
  assert.equal(created.MaxGroups, 2);

  const [updateErr, updated] = await Manager.Update(4, { Label: 'Maze 2', MaxGroups: 3 });
  assert.equal(updateErr, null);
  assert.equal(updated.Label, 'Maze 2');
  assert.equal(updated.MaxGroups, 3);

  const [orderErr] = await Manager.SetOrder([4, 1]);
  assert.equal(orderErr, null);

  const [startErr, startedScene] = await Manager.StartTimer(4);
  assert.equal(startErr, null);
  assert.equal(startedScene.SceneID, 4);
  assert.ok(Number.isFinite(startedScene.TimerStartedAt));

  assert.ok(events.some(([e]) => e === 'SceneListChanged'));
});

test('FlowGroupsManager manages flows and their groups', async () => {
  const events = [];
  const dbMock = {
    Manager: {
      All: async (sql) => {
        if (/FROM Flows/.test(sql)) {
          return [null, [{ FlowID: 1, Label: 'Monday', SortOrder: 0 }]];
        }
        if (/FROM FlowGroups/.test(sql)) {
          return [
            null,
            [
              {
                RowID: 10,
                FlowID: 1,
                GroupID: 'G1',
                Label: 'Group A',
                Time: '19:30',
                Colour: '#5B8DEF',
                Notes: '[]',
                Flags: '[]',
                SortOrder: 0,
              },
            ],
          ];
        }
        return [null, []];
      },
      Get: async (sql) => {
        if (/SELECT \* FROM Flows WHERE FlowID/.test(sql)) {
          return [null, { FlowID: 1, Label: 'Monday', SortOrder: 0 }];
        }
        if (/SELECT RowID FROM FlowGroups/.test(sql)) {
          return [null, null]; // GroupID does not yet exist
        }
        if (/MAX\(SortOrder\) AS MaxOrder FROM FlowGroups/.test(sql)) {
          return [null, { MaxOrder: 0 }];
        }
        if (/MAX\(SortOrder\) AS MaxOrder FROM Flows/.test(sql)) {
          return [null, { MaxOrder: 0 }];
        }
        if (/SELECT \* FROM FlowGroups WHERE RowID/.test(sql)) {
          return [
            null,
            {
              RowID: 10,
              FlowID: 1,
              GroupID: 'G1',
              Label: 'Group A',
              Notes: '[]',
              Flags: '[]',
              SortOrder: 0,
            },
          ];
        }
        return [null, null];
      },
      Run: async (sql) => {
        if (/INSERT INTO Flows/.test(sql)) return [null, { lastID: 2 }];
        if (/INSERT INTO FlowGroups/.test(sql)) return [null, { lastID: 11 }];
        return [null, { changes: 1 }];
      },
    },
  };
  const { Manager } = loadWithMocks(flowPath, {
    '../Logger': Logger,
    '../DB': dbMock,
    '../Broadcast': makeBroadcast(events),
    '../Utils': Utils,
  });

  const [flowsErr, flows] = await Manager.GetAllFlows();
  assert.equal(flowsErr, null);
  assert.equal(flows.length, 1);

  const [createFlowErr, flow] = await Manager.CreateFlow({ Label: 'Bank Holiday' });
  assert.equal(createFlowErr, null);
  assert.equal(flow.FlowID, 2);

  const [withGroupsErr, withGroups] = await Manager.GetFlowWithGroups(1);
  assert.equal(withGroupsErr, null);
  assert.equal(withGroups.Groups.length, 1);
  assert.equal(withGroups.Groups[0].GroupID, 'G1');

  const [createGroupErr, group] = await Manager.CreateGroup(1, {
    GroupID: 'G2',
    Label: 'Group B',
    Notes: [],
    Flags: [],
  });
  assert.equal(createGroupErr, null);
  assert.equal(group.RowID, 11);
  assert.equal(group.GroupID, 'G2');

  assert.ok(events.some(([e]) => e === 'FlowGroupsChanged'));
});

test('QueueManager loads a flow into the queue and edits copies', async () => {
  const events = [];
  const runCalls = [];
  const dbMock = {
    Manager: {
      All: async () => [
        null,
        [
          {
            InstanceID: 1,
            GroupID: 'G1',
            Label: 'Group A',
            Notes: '[]',
            Flags: '[]',
            Location: 'QUEUE',
            SortOrder: 0,
          },
        ],
      ],
      Get: async (sql) => {
        if (/MAX\(SortOrder\)/.test(sql)) return [null, { MaxOrder: 0 }];
        if (/WHERE InstanceID/.test(sql)) {
          return [
            null,
            {
              InstanceID: 5,
              GroupID: 'G1',
              Label: 'Group A',
              Notes: '[]',
              Flags: '[]',
              Location: 'QUEUE',
              SortOrder: 0,
            },
          ];
        }
        return [null, null];
      },
      Run: async (sql, params) => {
        runCalls.push([sql, params]);
        if (/INSERT INTO QueueGroups/.test(sql)) return [null, { lastID: 5 }];
        return [null, { changes: 1 }];
      },
    },
  };
  const flowGroupsMock = {
    Manager: {
      GetFlowWithGroups: async () => [
        null,
        {
          FlowID: 1,
          Label: 'Monday',
          Groups: [
            { GroupID: 'G1', Label: 'Group A', Notes: [], Flags: [] },
            { GroupID: 'G2', Label: 'Group B', Notes: [], Flags: [] },
          ],
        },
      ],
    },
  };
  const { Manager } = loadWithMocks(queuePath, {
    '../Logger': Logger,
    '../DB': dbMock,
    '../Broadcast': makeBroadcast(events),
    '../FlowGroupsManager': flowGroupsMock,
    '../Utils': Utils,
  });

  const [loadErr] = await Manager.LoadFlow(1);
  assert.equal(loadErr, null);
  // Clears existing queue, then inserts both groups.
  assert.ok(runCalls.some(([sql]) => /DELETE FROM QueueGroups/.test(sql)));
  assert.equal(runCalls.filter(([sql]) => /INSERT INTO QueueGroups/.test(sql)).length, 2);

  const [addErr, added] = await Manager.AddGroup({ GroupID: 'G3', Label: 'Walk-up' });
  assert.equal(addErr, null);
  assert.equal(added.InstanceID, 5);

  const [updateErr, updated] = await Manager.UpdateGroup(5, { Label: 'Renamed' });
  assert.equal(updateErr, null);
  assert.equal(updated.Label, 'Renamed');

  const [resetErr, resetRes] = await Manager.Reset();
  assert.equal(resetErr, null);
  assert.equal(resetRes, true);

  assert.ok(events.filter(([e]) => e === 'QueueChanged').length >= 3);
});
