// FlagManager
// Owns the predefined flag definitions configured in Show Settings. Each flag
// definition has a Label, Bootstrap icon name, and display colour. Flag
// *instances* (with an optional comment, timestamp and author) are stored on
// individual groups by the Flow / Queue managers; this module only manages the
// catalogue.
const { CreateLogger } = require('../Logger');
const Logger = CreateLogger('FlagManager');

const { Manager: DB } = require('../DB');
const { Manager: BroadcastManager } = require('../Broadcast');
const { Ok, Fail } = require('../Utils');

const Manager = {};

let Initialized = false;
let FlagList = [];

function NormalizeRow(Row) {
  return {
    FlagID: Number(Row.FlagID),
    Label: String(Row.Label || ''),
    Icon: String(Row.Icon || ''),
    Colour: Row.Colour == null || String(Row.Colour).trim() === '' ? '#F4C453' : String(Row.Colour),
    SortOrder: Number(Row.SortOrder || 0),
    Timestamp: Number(Row.Timestamp || 0),
    UpdatedAt: Number(Row.UpdatedAt || 0),
  };
}

Manager.Init = async () => {
  if (Initialized) return;
  await Manager.Reload();
  Initialized = true;
};

Manager.Reload = async () => {
  const [Err, Rows] = await DB.All(
    'SELECT * FROM FlagDefinitions ORDER BY SortOrder ASC, FlagID ASC',
    []
  );
  if (Err) {
    Logger.error('Failed to load flag definitions', Err);
    FlagList = [];
    return;
  }
  FlagList = (Rows || []).map(NormalizeRow);
};

Manager.GetAll = async () => {
  if (!Initialized) await Manager.Init();
  return Ok(FlagList);
};

Manager.Get = async (FlagID) => {
  if (!Initialized) await Manager.Init();
  const Flag = FlagList.find((F) => F.FlagID === Number(FlagID));
  if (!Flag) return Fail('Flag not found');
  return Ok(Flag);
};

Manager.Create = async (Payload) => {
  if (!Initialized) await Manager.Init();
  const Timestamp = Date.now();
  const SortOrder = FlagList.length
    ? Math.max(...FlagList.map((F) => F.SortOrder)) + 1
    : 0;
  const [Err, Res] = await DB.Run(
    'INSERT INTO FlagDefinitions (Label, Icon, Colour, SortOrder, Timestamp, UpdatedAt) VALUES (?, ?, ?, ?, ?, ?)',
    [Payload.Label, Payload.Icon, Payload.Colour || '#F4C453', SortOrder, Timestamp, Timestamp]
  );
  if (Err || !Res) return Fail('Failed to create flag');
  const Created = NormalizeRow({
    FlagID: Res.lastID,
    Label: Payload.Label,
    Icon: Payload.Icon,
    Colour: Payload.Colour || '#F4C453',
    SortOrder,
    Timestamp,
    UpdatedAt: Timestamp,
  });
  FlagList.push(Created);
  BroadcastManager.emit('FlagListChanged');
  return Ok(Created);
};

Manager.Update = async (FlagID, Payload) => {
  if (!Initialized) await Manager.Init();
  const ID = Number(FlagID);
  const Existing = FlagList.find((F) => F.FlagID === ID);
  if (!Existing) return Fail('Flag not found');

  const Label = Object.prototype.hasOwnProperty.call(Payload, 'Label')
    ? Payload.Label
    : Existing.Label;
  const Icon = Object.prototype.hasOwnProperty.call(Payload, 'Icon')
    ? Payload.Icon
    : Existing.Icon;
  const Colour = Object.prototype.hasOwnProperty.call(Payload, 'Colour')
    ? Payload.Colour
    : Existing.Colour;
  const UpdatedAt = Date.now();

  const [Err] = await DB.Run(
    'UPDATE FlagDefinitions SET Label = ?, Icon = ?, Colour = ?, UpdatedAt = ? WHERE FlagID = ?',
    [Label, Icon, Colour, UpdatedAt, ID]
  );
  if (Err) return Fail('Failed to update flag');

  Existing.Label = Label;
  Existing.Icon = Icon;
  Existing.Colour = Colour;
  Existing.UpdatedAt = UpdatedAt;
  BroadcastManager.emit('FlagListChanged');
  return Ok(Existing);
};

Manager.Delete = async (FlagID) => {
  if (!Initialized) await Manager.Init();
  const ID = Number(FlagID);
  const [Err] = await DB.Run('DELETE FROM FlagDefinitions WHERE FlagID = ?', [ID]);
  if (Err) return Fail('Failed to delete flag');
  FlagList = FlagList.filter((F) => F.FlagID !== ID);
  BroadcastManager.emit('FlagListChanged');
  return Ok(true);
};

Manager.SetOrder = async (OrderedFlagIDs) => {
  if (!Initialized) await Manager.Init();
  if (!Array.isArray(OrderedFlagIDs)) return Fail('OrderedFlagIDs must be an array');
  const UpdatedAt = Date.now();
  let SortOrder = 0;
  for (const RawID of OrderedFlagIDs) {
    const ID = Number(RawID);
    const Existing = FlagList.find((F) => F.FlagID === ID);
    if (!Existing) continue;
    const [Err] = await DB.Run(
      'UPDATE FlagDefinitions SET SortOrder = ?, UpdatedAt = ? WHERE FlagID = ?',
      [SortOrder, UpdatedAt, ID]
    );
    if (Err) return Fail('Failed to reorder flags');
    Existing.SortOrder = SortOrder;
    Existing.UpdatedAt = UpdatedAt;
    SortOrder += 1;
  }
  FlagList.sort((a, b) => a.SortOrder - b.SortOrder || a.FlagID - b.FlagID);
  BroadcastManager.emit('FlagListChanged');
  return Ok(FlagList);
};

module.exports = { Manager };
