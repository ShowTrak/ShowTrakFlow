// SceneManager
// Owns the fixed, ordered list of Scenes that form the body of the show. Each
// scene has a Label, an optional Duration (seconds), optional scene capacity,
// chat-room toggle, and an array of Milestones (timestamped events rendered as
// coloured markers on the scene progress bar).
const { CreateLogger } = require('../Logger');
const Logger = CreateLogger('SceneManager');

const { Manager: DB } = require('../DB');
const { Manager: BroadcastManager } = require('../Broadcast');
const { Ok, Fail } = require('../Utils');

const Manager = {};

let Initialized = false;
let SceneList = [];

function ParseMilestones(Value) {
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
    SceneID: Number(Row.SceneID),
    Label: String(Row.Label || ''),
    Duration: Row.Duration == null ? null : Number(Row.Duration),
    Milestones: ParseMilestones(Row.Milestones),
    TimerStartedAt: Row.TimerStartedAt == null ? null : Number(Row.TimerStartedAt),
    HasChatRoom: Number(Row.HasChatRoom || 0) === 1,
    MaxGroups: Row.MaxGroups == null ? null : Number(Row.MaxGroups),
    Colour: Row.Colour == null || String(Row.Colour).trim() === '' ? '#1E88E5' : String(Row.Colour),
    Icon: Row.Icon == null || String(Row.Icon).trim() === '' ? 'chat-left-text-fill' : String(Row.Icon),
    SortOrder: Number(Row.SortOrder || 0),
    Timestamp: Number(Row.Timestamp || 0),
    UpdatedAt: Number(Row.UpdatedAt || 0),
  };
}

function WithTimerRuntime(Scene, now = Date.now()) {
  const Duration = Number(Scene.Duration);
  const StartedAt = Scene.TimerStartedAt == null ? null : Number(Scene.TimerStartedAt);

  if (!Number.isFinite(Duration) || Duration <= 0 || !Number.isFinite(StartedAt)) {
    return {
      ...Scene,
      IsTimerRunning: false,
      TimerElapsedSeconds: 0,
      TimerRemainingSeconds: Number.isFinite(Duration) && Duration > 0 ? Duration : 0,
      TimerProgressPercent: 0,
    };
  }

  const ElapsedSeconds = Math.max(0, (now - StartedAt) / 1000);
  const RemainingSeconds = Math.max(0, Math.ceil(Duration - ElapsedSeconds));
  const ProgressPercent = Math.max(0, Math.min(100, (ElapsedSeconds / Duration) * 100));

  return {
    ...Scene,
    IsTimerRunning: ElapsedSeconds < Duration,
    TimerElapsedSeconds: ElapsedSeconds,
    TimerRemainingSeconds: RemainingSeconds,
    TimerProgressPercent: ProgressPercent,
  };
}

Manager.Init = async () => {
  if (Initialized) return;
  await Manager.Reload();
  Initialized = true;
};

Manager.Reload = async () => {
  const [Err, Rows] = await DB.All('SELECT * FROM Scenes ORDER BY SortOrder ASC, SceneID ASC', []);
  if (Err) {
    Logger.error('Failed to load scenes', Err);
    SceneList = [];
    return;
  }
  SceneList = (Rows || []).map(NormalizeRow);
};

Manager.GetAll = async () => {
  if (!Initialized) await Manager.Init();
  const now = Date.now();
  return Ok(SceneList.map((Scene) => WithTimerRuntime(Scene, now)));
};

Manager.Get = async (SceneID) => {
  if (!Initialized) await Manager.Init();
  const Scene = SceneList.find((S) => S.SceneID === Number(SceneID));
  if (!Scene) return Fail('Scene not found');
  return Ok(WithTimerRuntime(Scene));
};

Manager.Create = async (Payload) => {
  if (!Initialized) await Manager.Init();
  const Timestamp = Date.now();
  const SortOrder = SceneList.length
    ? Math.max(...SceneList.map((S) => S.SortOrder)) + 1
    : 0;
  const Milestones = JSON.stringify(Payload.Milestones || []);
  const [Err, Res] = await DB.Run(
    'INSERT INTO Scenes (Label, Duration, Milestones, HasChatRoom, MaxGroups, Colour, Icon, SortOrder, Timestamp, UpdatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      Payload.Label,
      Payload.Duration ?? null,
      Milestones,
      Payload.HasChatRoom ? 1 : 0,
      Payload.MaxGroups ?? null,
      Payload.Colour || '#1E88E5',
      Payload.Icon || 'chat-left-text-fill',
      SortOrder,
      Timestamp,
      Timestamp,
    ]
  );
  if (Err || !Res) return Fail('Failed to create scene');
  const Created = NormalizeRow({
    SceneID: Res.lastID,
    Label: Payload.Label,
    Duration: Payload.Duration ?? null,
    Milestones,
    HasChatRoom: Payload.HasChatRoom ? 1 : 0,
    MaxGroups: Payload.MaxGroups ?? null,
    Colour: Payload.Colour || '#1E88E5',
    Icon: Payload.Icon || 'chat-left-text-fill',
    SortOrder,
    Timestamp,
    UpdatedAt: Timestamp,
  });
  SceneList.push(Created);
  BroadcastManager.emit('SceneListChanged');
  return Ok(Created);
};

Manager.Update = async (SceneID, Payload) => {
  if (!Initialized) await Manager.Init();
  const ID = Number(SceneID);
  const Existing = SceneList.find((S) => S.SceneID === ID);
  if (!Existing) return Fail('Scene not found');

  const Next = {
    Label: Object.prototype.hasOwnProperty.call(Payload, 'Label') ? Payload.Label : Existing.Label,
    Duration: Object.prototype.hasOwnProperty.call(Payload, 'Duration')
      ? Payload.Duration
      : Existing.Duration,
    Milestones: Object.prototype.hasOwnProperty.call(Payload, 'Milestones')
      ? Payload.Milestones
      : Existing.Milestones,
    HasChatRoom: Object.prototype.hasOwnProperty.call(Payload, 'HasChatRoom')
      ? !!Payload.HasChatRoom
      : Existing.HasChatRoom,
    MaxGroups: Object.prototype.hasOwnProperty.call(Payload, 'MaxGroups')
      ? Payload.MaxGroups
      : Existing.MaxGroups,
    Colour: Object.prototype.hasOwnProperty.call(Payload, 'Colour')
      ? Payload.Colour
      : Existing.Colour,
    Icon: Object.prototype.hasOwnProperty.call(Payload, 'Icon') ? Payload.Icon : Existing.Icon,
  };
  const UpdatedAt = Date.now();
  const [Err] = await DB.Run(
    'UPDATE Scenes SET Label = ?, Duration = ?, Milestones = ?, HasChatRoom = ?, MaxGroups = ?, Colour = ?, Icon = ?, UpdatedAt = ? WHERE SceneID = ?',
    [
      Next.Label,
      Next.Duration ?? null,
      JSON.stringify(Next.Milestones || []),
      Next.HasChatRoom ? 1 : 0,
      Next.MaxGroups ?? null,
      Next.Colour || '#1E88E5',
      Next.Icon || 'chat-left-text-fill',
      UpdatedAt,
      ID,
    ]
  );
  if (Err) return Fail('Failed to update scene');
  Object.assign(Existing, Next, { UpdatedAt });
  BroadcastManager.emit('SceneListChanged');
  return Ok(Existing);
};

Manager.Delete = async (SceneID) => {
  if (!Initialized) await Manager.Init();
  const ID = Number(SceneID);
  const [Err] = await DB.Run('DELETE FROM Scenes WHERE SceneID = ?', [ID]);
  if (Err) return Fail('Failed to delete scene');
  SceneList = SceneList.filter((S) => S.SceneID !== ID);
  BroadcastManager.emit('SceneListChanged');
  return Ok(true);
};

Manager.SetOrder = async (OrderedSceneIDs) => {
  if (!Initialized) await Manager.Init();
  if (!Array.isArray(OrderedSceneIDs)) return Fail('OrderedSceneIDs must be an array');
  const UpdatedAt = Date.now();
  let SortOrder = 0;
  for (const RawID of OrderedSceneIDs) {
    const ID = Number(RawID);
    const Existing = SceneList.find((S) => S.SceneID === ID);
    if (!Existing) continue;
    const [Err] = await DB.Run(
      'UPDATE Scenes SET SortOrder = ?, UpdatedAt = ? WHERE SceneID = ?',
      [SortOrder, UpdatedAt, ID]
    );
    if (Err) return Fail('Failed to reorder scenes');
    Existing.SortOrder = SortOrder;
    Existing.UpdatedAt = UpdatedAt;
    SortOrder += 1;
  }
  SceneList.sort((a, b) => a.SortOrder - b.SortOrder || a.SceneID - b.SceneID);
  BroadcastManager.emit('SceneListChanged');
  return Ok(SceneList);
};

Manager.StartTimer = async (SceneID) => {
  if (!Initialized) await Manager.Init();
  const ID = Number(SceneID);
  const Existing = SceneList.find((S) => S.SceneID === ID);
  if (!Existing) return Fail('Scene not found');
  const Duration = Number(Existing.Duration);
  if (!Number.isFinite(Duration) || Duration <= 0) {
    return Fail('Scene has no duration set');
  }
  const TimerStartedAt = Date.now();
  const UpdatedAt = TimerStartedAt;
  const [Err] = await DB.Run(
    'UPDATE Scenes SET TimerStartedAt = ?, UpdatedAt = ? WHERE SceneID = ?',
    [TimerStartedAt, UpdatedAt, ID]
  );
  if (Err) return Fail('Failed to start scene timer');
  Existing.TimerStartedAt = TimerStartedAt;
  Existing.UpdatedAt = UpdatedAt;
  BroadcastManager.emit('SceneListChanged');
  return Ok(WithTimerRuntime(Existing));
};

module.exports = { Manager };
