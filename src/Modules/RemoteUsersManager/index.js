// RemoteUsersManager
// Owns remote user profiles used by the Show Settings "Remote Users" feature.
// Each user has username, mandatory 4-digit PIN, admin toggle, colour, and
// Bootstrap icon. This manager provides CRUD + list fan-out broadcasts.
const { CreateLogger } = require('../Logger');
const Logger = CreateLogger('RemoteUsersManager');

const { Manager: DB } = require('../DB');
const { Manager: BroadcastManager } = require('../Broadcast');
const { Ok, Fail } = require('../Utils');

const Manager = {};

let Initialized = false;
let UserList = [];

function NormalizeRow(Row) {
  return {
    RemoteUserID: Number(Row.RemoteUserID),
    Username: String(Row.Username || ''),
    Pin: String(Row.Pin || ''),
    IsAdmin: Number(Row.IsAdmin || 0) === 1,
    Colour: Row.Colour == null || String(Row.Colour).trim() === '' ? '#5B8DEF' : String(Row.Colour),
    Icon: String(Row.Icon || 'person-fill'),
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
    'SELECT * FROM RemoteUsers ORDER BY SortOrder ASC, RemoteUserID ASC',
    []
  );
  if (Err) {
    Logger.error('Failed to load remote users', Err);
    UserList = [];
    return;
  }
  UserList = (Rows || []).map(NormalizeRow);
};

Manager.GetAll = async () => {
  if (!Initialized) await Manager.Init();
  return Ok(UserList);
};

Manager.Get = async (RemoteUserID) => {
  if (!Initialized) await Manager.Init();
  const User = UserList.find((U) => U.RemoteUserID === Number(RemoteUserID));
  if (!User) return Fail('Remote user not found');
  return Ok(User);
};

Manager.Create = async (Payload) => {
  if (!Initialized) await Manager.Init();
  const Timestamp = Date.now();
  const SortOrder = UserList.length
    ? Math.max(...UserList.map((U) => U.SortOrder)) + 1
    : 0;
  const [Err, Res] = await DB.Run(
    'INSERT INTO RemoteUsers (Username, Pin, IsAdmin, Colour, Icon, SortOrder, Timestamp, UpdatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      Payload.Username,
      Payload.Pin,
      Payload.IsAdmin ? 1 : 0,
      Payload.Colour || '#5B8DEF',
      Payload.Icon || 'person-fill',
      SortOrder,
      Timestamp,
      Timestamp,
    ]
  );
  if (Err || !Res) return Fail('Failed to create remote user');
  const Created = NormalizeRow({
    RemoteUserID: Res.lastID,
    Username: Payload.Username,
    Pin: Payload.Pin,
    IsAdmin: Payload.IsAdmin ? 1 : 0,
    Colour: Payload.Colour || '#5B8DEF',
    Icon: Payload.Icon || 'person-fill',
    SortOrder,
    Timestamp,
    UpdatedAt: Timestamp,
  });
  UserList.push(Created);
  BroadcastManager.emit('RemoteUserListChanged');
  return Ok(Created);
};

Manager.Update = async (RemoteUserID, Payload) => {
  if (!Initialized) await Manager.Init();
  const ID = Number(RemoteUserID);
  const Existing = UserList.find((U) => U.RemoteUserID === ID);
  if (!Existing) return Fail('Remote user not found');

  const Username = Object.prototype.hasOwnProperty.call(Payload, 'Username')
    ? Payload.Username
    : Existing.Username;
  const Pin = Object.prototype.hasOwnProperty.call(Payload, 'Pin') ? Payload.Pin : Existing.Pin;
  const IsAdmin = Object.prototype.hasOwnProperty.call(Payload, 'IsAdmin')
    ? !!Payload.IsAdmin
    : Existing.IsAdmin;
  const Colour = Object.prototype.hasOwnProperty.call(Payload, 'Colour')
    ? Payload.Colour
    : Existing.Colour;
  const Icon = Object.prototype.hasOwnProperty.call(Payload, 'Icon') ? Payload.Icon : Existing.Icon;
  const UpdatedAt = Date.now();

  const [Err] = await DB.Run(
    'UPDATE RemoteUsers SET Username = ?, Pin = ?, IsAdmin = ?, Colour = ?, Icon = ?, UpdatedAt = ? WHERE RemoteUserID = ?',
    [Username, Pin, IsAdmin ? 1 : 0, Colour, Icon, UpdatedAt, ID]
  );
  if (Err) return Fail('Failed to update remote user');

  Existing.Username = Username;
  Existing.Pin = Pin;
  Existing.IsAdmin = IsAdmin;
  Existing.Colour = Colour;
  Existing.Icon = Icon;
  Existing.UpdatedAt = UpdatedAt;
  BroadcastManager.emit('RemoteUserListChanged');
  return Ok(Existing);
};

Manager.Delete = async (RemoteUserID) => {
  if (!Initialized) await Manager.Init();
  const ID = Number(RemoteUserID);
  const [Err] = await DB.Run('DELETE FROM RemoteUsers WHERE RemoteUserID = ?', [ID]);
  if (Err) return Fail('Failed to delete remote user');
  UserList = UserList.filter((U) => U.RemoteUserID !== ID);
  BroadcastManager.emit('RemoteUserListChanged');
  return Ok(true);
};

module.exports = { Manager };