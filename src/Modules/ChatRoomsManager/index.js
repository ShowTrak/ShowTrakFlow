// ChatRoomsManager
// Aggregates custom chat rooms and scene-derived chat rooms, and stores local
// chat messages authored from the main application.
const { CreateLogger } = require('../Logger');
const Logger = CreateLogger('ChatRoomsManager');

const { Manager: DB } = require('../DB');
const { Manager: BroadcastManager } = require('../Broadcast');
const { Manager: SceneManager } = require('../SceneManager');
const { Ok, Fail } = require('../Utils');

const Manager = {};

Manager.Init = async () => {
  // Stateless manager; no warm cache required.
};

function NormalizeCustomRoomRow(Row) {
  return {
    RoomType: 'CUSTOM',
    RoomID: Number(Row.CustomChatRoomID),
    Label: String(Row.Label || ''),
    Colour: String(Row.Colour || '#1E88E5'),
    Icon: String(Row.Icon || 'chat-square-text'),
    SortOrder: Number(Row.SortOrder || 0),
    Timestamp: Number(Row.Timestamp || 0),
    UpdatedAt: Number(Row.UpdatedAt || 0),
  };
}

function NormalizeMessageRow(Row) {
  return {
    MessageID: Number(Row.MessageID),
    RoomType: String(Row.RoomType || '').toUpperCase(),
    RoomID: Number(Row.RoomID),
    AuthorLabel: String(Row.AuthorLabel || ''),
    AuthorIcon: String(Row.AuthorIcon || 'person-fill'),
    AuthorColour: String(Row.AuthorColour || '#FFFFFF'),
    Message: String(Row.Message || ''),
    Timestamp: Number(Row.Timestamp || 0),
  };
}

function NormalizeSceneRoom(scene) {
  return {
    RoomType: 'SCENE',
    RoomID: Number(scene.SceneID),
    Label: String(scene.Label || ''),
    Colour: String(scene.Colour || '#1E88E5'),
    Icon: String(scene.Icon || 'chat-left-text-fill'),
    SortOrder: Number(scene.SortOrder || 0),
    Timestamp: Number(scene.Timestamp || 0),
    UpdatedAt: Number(scene.UpdatedAt || 0),
  };
}

async function GetCustomRooms() {
  const [Err, Rows] = await DB.All(
    'SELECT * FROM CustomChatRooms ORDER BY SortOrder ASC, CustomChatRoomID ASC',
    []
  );
  if (Err) return [Err, []];
  return [null, (Rows || []).map(NormalizeCustomRoomRow)];
}

Manager.GetAllRooms = async () => {
  const [CustomErr, CustomRooms] = await GetCustomRooms();
  if (CustomErr) {
    Logger.error('Failed to load custom chat rooms', CustomErr);
    return Fail('Failed to load chat rooms');
  }

  const [SceneErr, Scenes] = await SceneManager.GetAll();
  if (SceneErr) return Fail(SceneErr);
  const SceneRooms = (Scenes || []).filter((s) => !!s.HasChatRoom).map(NormalizeSceneRoom);

  // Required ordering: custom chat rooms first, then scene chat rooms.
  return Ok([...CustomRooms, ...SceneRooms]);
};

Manager.CreateCustomRoom = async (Payload) => {
  const [GetErr, Existing] = await GetCustomRooms();
  if (GetErr) return Fail('Failed to create chat room');
  const Timestamp = Date.now();
  const SortOrder = Existing.length
    ? Math.max(...Existing.map((R) => Number(R.SortOrder || 0))) + 1
    : 0;
  const [Err, Res] = await DB.Run(
    'INSERT INTO CustomChatRooms (Label, Colour, Icon, SortOrder, Timestamp, UpdatedAt) VALUES (?, ?, ?, ?, ?, ?)',
    [Payload.Label, Payload.Colour, Payload.Icon, SortOrder, Timestamp, Timestamp]
  );
  if (Err || !Res) return Fail('Failed to create chat room');
  BroadcastManager.emit('ChatRoomListChanged');
  return Ok({
    RoomType: 'CUSTOM',
    RoomID: Res.lastID,
    Label: Payload.Label,
    Colour: Payload.Colour,
    Icon: Payload.Icon,
    SortOrder,
    Timestamp,
    UpdatedAt: Timestamp,
  });
};

Manager.UpdateCustomRoom = async (RoomID, Payload) => {
  const ID = Number(RoomID);
  const [Err, Row] = await DB.Get('SELECT * FROM CustomChatRooms WHERE CustomChatRoomID = ?', [ID]);
  if (Err) return Fail('Failed to update chat room');
  if (!Row) return Fail('Custom chat room not found');
  const Existing = NormalizeCustomRoomRow(Row);

  const Next = {
    Label: Object.prototype.hasOwnProperty.call(Payload, 'Label') ? Payload.Label : Existing.Label,
    Colour: Object.prototype.hasOwnProperty.call(Payload, 'Colour') ? Payload.Colour : Existing.Colour,
    Icon: Object.prototype.hasOwnProperty.call(Payload, 'Icon') ? Payload.Icon : Existing.Icon,
  };
  const UpdatedAt = Date.now();

  const [UpdErr] = await DB.Run(
    'UPDATE CustomChatRooms SET Label = ?, Colour = ?, Icon = ?, UpdatedAt = ? WHERE CustomChatRoomID = ?',
    [Next.Label, Next.Colour, Next.Icon, UpdatedAt, ID]
  );
  if (UpdErr) return Fail('Failed to update chat room');
  BroadcastManager.emit('ChatRoomListChanged');
  return Ok({ ...Existing, ...Next, UpdatedAt });
};

Manager.DeleteCustomRoom = async (RoomID) => {
  const ID = Number(RoomID);
  const [Err] = await DB.Run('DELETE FROM CustomChatRooms WHERE CustomChatRoomID = ?', [ID]);
  if (Err) return Fail('Failed to delete chat room');
  await DB.Run('DELETE FROM ChatMessages WHERE RoomType = ? AND RoomID = ?', ['CUSTOM', ID]);
  BroadcastManager.emit('ChatRoomListChanged');
  return Ok(true);
};

Manager.GetMessages = async (RoomType, RoomID) => {
  const type = String(RoomType || '').toUpperCase();
  const id = Number(RoomID);
  const [Err, Rows] = await DB.All(
    'SELECT * FROM ChatMessages WHERE RoomType = ? AND RoomID = ? ORDER BY Timestamp ASC, MessageID ASC',
    [type, id]
  );
  if (Err) return Fail('Failed to load chat messages');
  return Ok((Rows || []).map(NormalizeMessageRow));
};

Manager.SendControlMessage = async (RoomType, RoomID, Message) => {
  const type = String(RoomType || '').toUpperCase();
  const id = Number(RoomID);

  if (type === 'CUSTOM') {
    const [Err, Row] = await DB.Get('SELECT CustomChatRoomID FROM CustomChatRooms WHERE CustomChatRoomID = ?', [id]);
    if (Err || !Row) return Fail('Chat room not found');
  } else if (type === 'SCENE') {
    const [Err, Scene] = await SceneManager.Get(id);
    if (Err || !Scene) return Fail('Scene chat room not found');
    if (!Scene.HasChatRoom) return Fail('Scene chat room is disabled');
  } else {
    return Fail('Invalid chat room type');
  }

  const Timestamp = Date.now();
  const [Err] = await DB.Run(
    'INSERT INTO ChatMessages (RoomType, RoomID, AuthorLabel, AuthorIcon, AuthorColour, Message, Timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [type, id, 'Control', 'gear-fill', '#E53935', Message, Timestamp]
  );
  if (Err) return Fail('Failed to send chat message');

  BroadcastManager.emit('ChatMessagesChanged', { RoomType: type, RoomID: id });
  return Ok(true);
};

module.exports = { Manager };
