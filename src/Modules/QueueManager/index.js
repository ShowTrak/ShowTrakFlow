// QueueManager
// Owns the live "Active Show" queue: editable copies of groups loaded from a
// Flow. Edits here never write back to the source Flow. Rows are persisted in
// the show database so the running show survives restarts (crash recovery), and
// the whole queue can be reset to a blank state before loading another Flow.
//
// Location lifecycle: 'QUEUE' (upcoming) -> 'SCENE' (active, SceneID set) ->
// 'DONE'. Group instances advance through the fixed Scene list during the show.
const { CreateLogger } = require('../Logger');
const Logger = CreateLogger('QueueManager');

const { Manager: DB } = require('../DB');
const { Manager: BroadcastManager } = require('../Broadcast');
const { Manager: FlowGroupsManager } = require('../FlowGroupsManager');
const { Manager: SceneManager } = require('../SceneManager');
const { Ok, Fail } = require('../Utils');

const Manager = {};

const VALID_LOCATIONS = new Set(['QUEUE', 'SCENE', 'DONE']);

function ParseJSONArray(Value) {
  if (Array.isArray(Value)) return Value;
  if (typeof Value !== 'string' || !Value.trim()) return [];
  try {
    const Parsed = JSON.parse(Value);
    return Array.isArray(Parsed) ? Parsed : [];
  } catch {
    return [];
  }
}

function NormalizeRow(Row) {
  return {
    InstanceID: Number(Row.InstanceID),
    GroupID: String(Row.GroupID || ''),
    Label: String(Row.Label || ''),
    Time: Row.Time == null ? null : String(Row.Time),
    Colour: Row.Colour == null ? null : String(Row.Colour),
    Notes: ParseJSONArray(Row.Notes),
    Flags: ParseJSONArray(Row.Flags),
    Location: VALID_LOCATIONS.has(Row.Location) ? Row.Location : 'QUEUE',
    SceneID: Row.SceneID == null ? null : Number(Row.SceneID),
    SortOrder: Number(Row.SortOrder || 0),
    SourceFlowID: Row.SourceFlowID == null ? null : Number(Row.SourceFlowID),
    Timestamp: Number(Row.Timestamp || 0),
    UpdatedAt: Number(Row.UpdatedAt || 0),
  };
}

Manager.Init = async () => {
  const [Err] = await DB.All('SELECT InstanceID FROM QueueGroups LIMIT 1', []);
  if (Err) Logger.error('Failed to access QueueGroups table', Err);
};

Manager.GetAll = async () => {
  const [Err, Rows] = await DB.All(
    'SELECT * FROM QueueGroups ORDER BY SortOrder ASC, InstanceID ASC',
    []
  );
  if (Err) return Fail('Failed to load queue');
  return Ok((Rows || []).map(NormalizeRow));
};

Manager.Get = async (InstanceID) => {
  const [Err, Row] = await DB.Get('SELECT * FROM QueueGroups WHERE InstanceID = ?', [
    Number(InstanceID),
  ]);
  if (Err) return Fail('Failed to load queue item');
  if (!Row) return Fail('Queue item not found');
  return Ok(NormalizeRow(Row));
};

async function NextSortOrder() {
  const [Err, Row] = await DB.Get('SELECT MAX(SortOrder) AS MaxOrder FROM QueueGroups', []);
  if (Err || !Row || Row.MaxOrder == null) return 0;
  return Number(Row.MaxOrder) + 1;
}

async function InsertGroup(Group, SortOrder, SourceFlowID) {
  const Timestamp = Date.now();
  return DB.Run(
    'INSERT INTO QueueGroups (GroupID, Label, Time, Colour, Notes, Flags, Location, SceneID, SortOrder, SourceFlowID, Timestamp, UpdatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      Group.GroupID,
      Group.Label,
      Group.Time ?? null,
      Group.Colour ?? null,
      JSON.stringify(Group.Notes || []),
      JSON.stringify(Group.Flags || []),
      'QUEUE',
      null,
      SortOrder,
      SourceFlowID ?? null,
      Timestamp,
      Timestamp,
    ]
  );
}

// Replace the entire queue with a fresh copy of the given flow's groups.
Manager.LoadFlow = async (FlowID) => {
  const [Err, Flow] = await FlowGroupsManager.GetFlowWithGroups(FlowID);
  if (Err) return Fail(Err);

  const [ClearErr] = await DB.Run('DELETE FROM QueueGroups', []);
  if (ClearErr) return Fail('Failed to clear queue');

  let SortOrder = 0;
  for (const Group of Flow.Groups) {
    const [InsertErr] = await InsertGroup(Group, SortOrder, Flow.FlowID);
    if (InsertErr) return Fail('Failed to load flow into queue');
    SortOrder += 1;
  }
  BroadcastManager.emit('QueueChanged');
  return Manager.GetAll();
};

// Append a single group to the queue without clearing existing items.
Manager.AddGroup = async (Payload) => {
  const SortOrder = await NextSortOrder();
  const [Err, Res] = await InsertGroup(
    {
      GroupID: Payload.GroupID,
      Label: Payload.Label,
      Time: Payload.Time ?? null,
      Colour: Payload.Colour ?? null,
      Notes: Payload.Notes || [],
      Flags: Payload.Flags || [],
    },
    SortOrder,
    Payload.SourceFlowID ?? null
  );
  if (Err || !Res) return Fail('Failed to add group to queue');
  BroadcastManager.emit('QueueChanged');
  return Manager.Get(Res.lastID);
};

Manager.UpdateGroup = async (InstanceID, Payload) => {
  const [GetErr, Existing] = await Manager.Get(InstanceID);
  if (GetErr) return Fail(GetErr);

  const Next = {
    GroupID: Object.prototype.hasOwnProperty.call(Payload, 'GroupID')
      ? Payload.GroupID
      : Existing.GroupID,
    Label: Object.prototype.hasOwnProperty.call(Payload, 'Label') ? Payload.Label : Existing.Label,
    Time: Object.prototype.hasOwnProperty.call(Payload, 'Time') ? Payload.Time : Existing.Time,
    Colour: Object.prototype.hasOwnProperty.call(Payload, 'Colour')
      ? Payload.Colour
      : Existing.Colour,
    Notes: Object.prototype.hasOwnProperty.call(Payload, 'Notes') ? Payload.Notes : Existing.Notes,
    Flags: Object.prototype.hasOwnProperty.call(Payload, 'Flags') ? Payload.Flags : Existing.Flags,
  };
  const UpdatedAt = Date.now();
  const [Err] = await DB.Run(
    'UPDATE QueueGroups SET GroupID = ?, Label = ?, Time = ?, Colour = ?, Notes = ?, Flags = ?, UpdatedAt = ? WHERE InstanceID = ?',
    [
      Next.GroupID,
      Next.Label,
      Next.Time ?? null,
      Next.Colour ?? null,
      JSON.stringify(Next.Notes || []),
      JSON.stringify(Next.Flags || []),
      UpdatedAt,
      Number(InstanceID),
    ]
  );
  if (Err) return Fail('Failed to update queue item');
  BroadcastManager.emit('QueueChanged');
  return Ok({ ...Existing, ...Next, UpdatedAt });
};

Manager.DeleteGroup = async (InstanceID) => {
  const [Err] = await DB.Run('DELETE FROM QueueGroups WHERE InstanceID = ?', [Number(InstanceID)]);
  if (Err) return Fail('Failed to remove queue item');
  BroadcastManager.emit('QueueChanged');
  return Ok(true);
};

Manager.SetOrder = async (OrderedInstanceIDs) => {
  if (!Array.isArray(OrderedInstanceIDs)) return Fail('OrderedInstanceIDs must be an array');
  const UpdatedAt = Date.now();
  let SortOrder = 0;
  for (const RawID of OrderedInstanceIDs) {
    const [Err] = await DB.Run(
      'UPDATE QueueGroups SET SortOrder = ?, UpdatedAt = ? WHERE InstanceID = ?',
      [SortOrder, UpdatedAt, Number(RawID)]
    );
    if (Err) return Fail('Failed to reorder queue');
    SortOrder += 1;
  }
  BroadcastManager.emit('QueueChanged');
  return Manager.GetAll();
};

// Move a group instance into a scene (or out of the queue/scene lifecycle).
Manager.SetLocation = async (InstanceID, Location, SceneID = null) => {
  const NextLocation = VALID_LOCATIONS.has(Location) ? Location : 'QUEUE';
  const NextSceneID = NextLocation === 'SCENE' ? (SceneID == null ? null : Number(SceneID)) : null;

  if (NextLocation === 'SCENE') {
    if (!Number.isInteger(NextSceneID) || NextSceneID <= 0) {
      return Fail('A valid scene is required');
    }
    const [SceneErr, Scene] = await SceneManager.Get(NextSceneID);
    if (SceneErr || !Scene) return Fail('Scene not found');
    if (Scene.MaxGroups != null) {
      const [CountErr, CountRow] = await DB.Get(
        'SELECT COUNT(*) AS Count FROM QueueGroups WHERE Location = ? AND SceneID = ? AND InstanceID != ?',
        ['SCENE', NextSceneID, Number(InstanceID)]
      );
      if (CountErr) return Fail('Failed to move queue item');
      const count = Number((CountRow && CountRow.Count) || 0);
      if (count >= Number(Scene.MaxGroups)) {
        return Fail(`Scene "${Scene.Label}" is full (${Scene.MaxGroups} max groups)`);
      }
    }
  }

  const UpdatedAt = Date.now();
  const [Err] = await DB.Run(
    'UPDATE QueueGroups SET Location = ?, SceneID = ?, UpdatedAt = ? WHERE InstanceID = ?',
    [NextLocation, NextSceneID, UpdatedAt, Number(InstanceID)]
  );
  if (Err) return Fail('Failed to move queue item');
  BroadcastManager.emit('QueueChanged');
  return Manager.Get(InstanceID);
};

// Reset the entire Active Show / queue to a blank state.
Manager.Reset = async () => {
  const [Err] = await DB.Run('DELETE FROM QueueGroups', []);
  if (Err) return Fail('Failed to reset queue');
  BroadcastManager.emit('QueueChanged');
  return Ok(true);
};

module.exports = { Manager };
