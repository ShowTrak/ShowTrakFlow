// FlowGroupsManager
// Owns Flow templates and the ordered Groups that belong to each Flow. A Flow is
// a reusable, ordered collection of groups (e.g. "Monday", "Bank Holiday") that
// can be loaded into the live Queue. Editing groups here mutates the template;
// the Queue keeps its own editable copies (see QueueManager).
const { CreateLogger } = require('../Logger');
const Logger = CreateLogger('FlowGroupsManager');

const { Manager: DB } = require('../DB');
const { Manager: BroadcastManager } = require('../Broadcast');
const { Ok, Fail } = require('../Utils');

const Manager = {};

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

function NormalizeFlowRow(Row) {
  return {
    FlowID: Number(Row.FlowID),
    Label: String(Row.Label || ''),
    SortOrder: Number(Row.SortOrder || 0),
    Timestamp: Number(Row.Timestamp || 0),
    UpdatedAt: Number(Row.UpdatedAt || 0),
  };
}

function NormalizeGroupRow(Row) {
  return {
    RowID: Number(Row.RowID),
    FlowID: Number(Row.FlowID),
    GroupID: String(Row.GroupID || ''),
    Label: String(Row.Label || ''),
    Time: Row.Time == null ? null : String(Row.Time),
    Colour: Row.Colour == null ? null : String(Row.Colour),
    Notes: ParseJSONArray(Row.Notes),
    Flags: ParseJSONArray(Row.Flags),
    SortOrder: Number(Row.SortOrder || 0),
    Timestamp: Number(Row.Timestamp || 0),
    UpdatedAt: Number(Row.UpdatedAt || 0),
  };
}

Manager.Init = async () => {
  // No in-memory cache; Flows/Groups are read on demand. Init exists for parity
  // with other managers and to surface load errors early.
  const [Err] = await DB.All('SELECT FlowID FROM Flows LIMIT 1', []);
  if (Err) Logger.error('Failed to access Flows table', Err);
};

// ---- Flows ----

Manager.GetAllFlows = async () => {
  const [Err, Rows] = await DB.All(
    'SELECT * FROM Flows ORDER BY SortOrder ASC, FlowID ASC',
    []
  );
  if (Err) return Fail('Failed to load flows');
  return Ok((Rows || []).map(NormalizeFlowRow));
};

Manager.GetFlow = async (FlowID) => {
  const [Err, Row] = await DB.Get('SELECT * FROM Flows WHERE FlowID = ?', [Number(FlowID)]);
  if (Err) return Fail('Failed to load flow');
  if (!Row) return Fail('Flow not found');
  return Ok(NormalizeFlowRow(Row));
};

// Returns a flow together with its ordered groups.
Manager.GetFlowWithGroups = async (FlowID) => {
  const [FlowErr, Flow] = await Manager.GetFlow(FlowID);
  if (FlowErr) return Fail(FlowErr);
  const [GroupsErr, Groups] = await Manager.GetGroups(FlowID);
  if (GroupsErr) return Fail(GroupsErr);
  return Ok({ ...Flow, Groups });
};

Manager.CreateFlow = async (Payload) => {
  const Timestamp = Date.now();
  const [OrderErr, MaxRow] = await DB.Get('SELECT MAX(SortOrder) AS MaxOrder FROM Flows', []);
  if (OrderErr) return Fail('Failed to create flow');
  const SortOrder = MaxRow && MaxRow.MaxOrder != null ? Number(MaxRow.MaxOrder) + 1 : 0;
  const [Err, Res] = await DB.Run(
    'INSERT INTO Flows (Label, SortOrder, Timestamp, UpdatedAt) VALUES (?, ?, ?, ?)',
    [Payload.Label, SortOrder, Timestamp, Timestamp]
  );
  if (Err || !Res) return Fail('Failed to create flow');
  BroadcastManager.emit('FlowListChanged');
  return Ok(NormalizeFlowRow({
    FlowID: Res.lastID,
    Label: Payload.Label,
    SortOrder,
    Timestamp,
    UpdatedAt: Timestamp,
  }));
};

Manager.UpdateFlow = async (FlowID, Payload) => {
  const ID = Number(FlowID);
  const [GetErr, Existing] = await Manager.GetFlow(ID);
  if (GetErr) return Fail(GetErr);
  const Label = Object.prototype.hasOwnProperty.call(Payload, 'Label')
    ? Payload.Label
    : Existing.Label;
  const UpdatedAt = Date.now();
  const [Err] = await DB.Run('UPDATE Flows SET Label = ?, UpdatedAt = ? WHERE FlowID = ?', [
    Label,
    UpdatedAt,
    ID,
  ]);
  if (Err) return Fail('Failed to update flow');
  BroadcastManager.emit('FlowListChanged');
  return Ok({ ...Existing, Label, UpdatedAt });
};

Manager.DeleteFlow = async (FlowID) => {
  const ID = Number(FlowID);
  const [Err] = await DB.Run('DELETE FROM Flows WHERE FlowID = ?', [ID]);
  if (Err) return Fail('Failed to delete flow');
  await DB.Run('DELETE FROM FlowGroups WHERE FlowID = ?', [ID]);
  BroadcastManager.emit('FlowListChanged');
  return Ok(true);
};

Manager.SetFlowOrder = async (OrderedFlowIDs) => {
  if (!Array.isArray(OrderedFlowIDs)) return Fail('OrderedFlowIDs must be an array');
  const UpdatedAt = Date.now();
  let SortOrder = 0;
  for (const RawID of OrderedFlowIDs) {
    const [Err] = await DB.Run(
      'UPDATE Flows SET SortOrder = ?, UpdatedAt = ? WHERE FlowID = ?',
      [SortOrder, UpdatedAt, Number(RawID)]
    );
    if (Err) return Fail('Failed to reorder flows');
    SortOrder += 1;
  }
  BroadcastManager.emit('FlowListChanged');
  return Manager.GetAllFlows();
};

// ---- Flow Groups ----

Manager.GetGroups = async (FlowID) => {
  const [Err, Rows] = await DB.All(
    'SELECT * FROM FlowGroups WHERE FlowID = ? ORDER BY SortOrder ASC, RowID ASC',
    [Number(FlowID)]
  );
  if (Err) return Fail('Failed to load groups');
  return Ok((Rows || []).map(NormalizeGroupRow));
};

async function GroupIDExists(FlowID, GroupID, ExcludeRowID = null) {
  const [Err, Row] = await DB.Get(
    'SELECT RowID FROM FlowGroups WHERE FlowID = ? AND GroupID = ?' +
      (ExcludeRowID != null ? ' AND RowID != ?' : ''),
    ExcludeRowID != null ? [Number(FlowID), GroupID, Number(ExcludeRowID)] : [Number(FlowID), GroupID]
  );
  if (Err) return false;
  return !!Row;
}

// Generate an unused alphanumeric GroupID within a flow (G1, G2, ...).
async function GenerateGroupID(FlowID) {
  for (let i = 1; i < 100000; i += 1) {
    const Candidate = `G${i}`;
    if (!(await GroupIDExists(FlowID, Candidate))) return Candidate;
  }
  return `G${Date.now()}`;
}

Manager.CreateGroup = async (FlowID, Payload) => {
  const ID = Number(FlowID);
  const [FlowErr] = await Manager.GetFlow(ID);
  if (FlowErr) return Fail(FlowErr);

  let GroupID = Payload.GroupID || (await GenerateGroupID(ID));
  if (await GroupIDExists(ID, GroupID)) {
    return Fail(`Group ID "${GroupID}" already exists in this flow`);
  }

  const Timestamp = Date.now();
  const [OrderErr, MaxRow] = await DB.Get(
    'SELECT MAX(SortOrder) AS MaxOrder FROM FlowGroups WHERE FlowID = ?',
    [ID]
  );
  if (OrderErr) return Fail('Failed to create group');
  const SortOrder = MaxRow && MaxRow.MaxOrder != null ? Number(MaxRow.MaxOrder) + 1 : 0;

  const Notes = JSON.stringify(Payload.Notes || []);
  const Flags = JSON.stringify(Payload.Flags || []);
  const [Err, Res] = await DB.Run(
    'INSERT INTO FlowGroups (FlowID, GroupID, Label, Time, Colour, Notes, Flags, SortOrder, Timestamp, UpdatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      ID,
      GroupID,
      Payload.Label,
      Payload.Time ?? null,
      Payload.Colour ?? null,
      Notes,
      Flags,
      SortOrder,
      Timestamp,
      Timestamp,
    ]
  );
  if (Err || !Res) return Fail('Failed to create group');
  BroadcastManager.emit('FlowGroupsChanged', ID);
  return Ok(NormalizeGroupRow({
    RowID: Res.lastID,
    FlowID: ID,
    GroupID,
    Label: Payload.Label,
    Time: Payload.Time ?? null,
    Colour: Payload.Colour ?? null,
    Notes,
    Flags,
    SortOrder,
    Timestamp,
    UpdatedAt: Timestamp,
  }));
};

Manager.UpdateGroup = async (RowID, Payload) => {
  const ID = Number(RowID);
  const [Err, Row] = await DB.Get('SELECT * FROM FlowGroups WHERE RowID = ?', [ID]);
  if (Err) return Fail('Failed to load group');
  if (!Row) return Fail('Group not found');
  const Existing = NormalizeGroupRow(Row);

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

  if (Next.GroupID !== Existing.GroupID && (await GroupIDExists(Existing.FlowID, Next.GroupID, ID))) {
    return Fail(`Group ID "${Next.GroupID}" already exists in this flow`);
  }

  const UpdatedAt = Date.now();
  const [UpdErr] = await DB.Run(
    'UPDATE FlowGroups SET GroupID = ?, Label = ?, Time = ?, Colour = ?, Notes = ?, Flags = ?, UpdatedAt = ? WHERE RowID = ?',
    [
      Next.GroupID,
      Next.Label,
      Next.Time ?? null,
      Next.Colour ?? null,
      JSON.stringify(Next.Notes || []),
      JSON.stringify(Next.Flags || []),
      UpdatedAt,
      ID,
    ]
  );
  if (UpdErr) return Fail('Failed to update group');
  BroadcastManager.emit('FlowGroupsChanged', Existing.FlowID);
  return Ok({ ...Existing, ...Next, UpdatedAt });
};

Manager.DeleteGroup = async (RowID) => {
  const ID = Number(RowID);
  const [GetErr, Row] = await DB.Get('SELECT FlowID FROM FlowGroups WHERE RowID = ?', [ID]);
  if (GetErr) return Fail('Failed to delete group');
  const [Err] = await DB.Run('DELETE FROM FlowGroups WHERE RowID = ?', [ID]);
  if (Err) return Fail('Failed to delete group');
  if (Row) BroadcastManager.emit('FlowGroupsChanged', Number(Row.FlowID));
  return Ok(true);
};

Manager.SetGroupOrder = async (FlowID, OrderedRowIDs) => {
  if (!Array.isArray(OrderedRowIDs)) return Fail('OrderedRowIDs must be an array');
  const ID = Number(FlowID);
  const UpdatedAt = Date.now();
  let SortOrder = 0;
  for (const RawID of OrderedRowIDs) {
    const [Err] = await DB.Run(
      'UPDATE FlowGroups SET SortOrder = ?, UpdatedAt = ? WHERE RowID = ? AND FlowID = ?',
      [SortOrder, UpdatedAt, Number(RawID), ID]
    );
    if (Err) return Fail('Failed to reorder groups');
    SortOrder += 1;
  }
  BroadcastManager.emit('FlowGroupsChanged', ID);
  return Manager.GetGroups(ID);
};

module.exports = { Manager };
