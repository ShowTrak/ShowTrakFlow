// ShowColoursManager
// Owns named show-wide colours that can be selected elsewhere in the app.
const { CreateLogger } = require('../Logger');
const Logger = CreateLogger('ShowColoursManager');

const { Manager: DB } = require('../DB');
const { Manager: BroadcastManager } = require('../Broadcast');
const { Ok, Fail } = require('../Utils');

const Manager = {};

let Initialized = false;
let InitPromise = null;
let ColourList = [];

const DEFAULT_SHOW_COLOURS = [
  { Label: 'Red', Colour: '#E53935' },
  { Label: 'Orange', Colour: '#FB8C00' },
  { Label: 'Yellow', Colour: '#FDD835' },
  { Label: 'Green', Colour: '#43A047' },
  { Label: 'Blue', Colour: '#1E88E5' },
  { Label: 'Indigo', Colour: '#3949AB' },
  { Label: 'Violet', Colour: '#8E24AA' },
];

const LEGACY_DEFAULT_LABELS = new Set(
  ['Primary Blue', 'Sun Amber', 'Emerald', 'Crimson', ...DEFAULT_SHOW_COLOURS.map((c) => c.Label)]
    .map((label) => String(label).trim().toLowerCase())
);

function NormalizeRow(Row) {
  return {
    ShowColourID: Number(Row.ShowColourID),
    Label: String(Row.Label || ''),
    Colour: String(Row.Colour || '#5B8DEF'),
    SortOrder: Number(Row.SortOrder || 0),
    Timestamp: Number(Row.Timestamp || 0),
    UpdatedAt: Number(Row.UpdatedAt || 0),
  };
}

async function ReconcileDefaultPalette() {
  const allRows = Array.isArray(ColourList) ? ColourList.slice() : [];
  const defaultRows = allRows.filter((row) =>
    LEGACY_DEFAULT_LABELS.has(String(row.Label || '').trim().toLowerCase())
  );
  const customRows = allRows.filter(
    (row) => !LEGACY_DEFAULT_LABELS.has(String(row.Label || '').trim().toLowerCase())
  );

  // If defaults already match target palette exactly and no duplicates exist,
  // only normalize custom sort order continuity.
  const normalizedDefaultLabels = defaultRows
    .map((row) => String(row.Label || '').trim().toLowerCase())
    .sort();
  const targetDefaultLabels = DEFAULT_SHOW_COLOURS.map((row) => row.Label.toLowerCase()).sort();
  const defaultsAlreadyCanonical =
    normalizedDefaultLabels.length === targetDefaultLabels.length &&
    normalizedDefaultLabels.every((label, index) => label === targetDefaultLabels[index]);

  const Timestamp = Date.now();
  if (!defaultsAlreadyCanonical || defaultRows.length !== DEFAULT_SHOW_COLOURS.length) {
    for (const row of defaultRows) {
      // Remove duplicates / legacy defaults so canonical defaults can be reinserted.
      await DB.Run('DELETE FROM ShowColours WHERE ShowColourID = ?', [Number(row.ShowColourID)]);
    }

    let sortOrder = 0;
    for (const entry of DEFAULT_SHOW_COLOURS) {
      await DB.Run(
        'INSERT INTO ShowColours (Label, Colour, SortOrder, Timestamp, UpdatedAt) VALUES (?, ?, ?, ?, ?)',
        [entry.Label, entry.Colour, sortOrder, Timestamp, Timestamp]
      );
      sortOrder += 1;
    }
  }

  // Keep custom colours, but place them after the defaults in stable order.
  const startSortOrder = DEFAULT_SHOW_COLOURS.length;
  const sortedCustom = customRows.sort(
    (a, b) => a.SortOrder - b.SortOrder || a.ShowColourID - b.ShowColourID
  );
  let sortOrder = startSortOrder;
  for (const row of sortedCustom) {
    await DB.Run('UPDATE ShowColours SET SortOrder = ?, UpdatedAt = ? WHERE ShowColourID = ?', [
      sortOrder,
      Timestamp,
      Number(row.ShowColourID),
    ]);
    sortOrder += 1;
  }
}

async function SeedDefaultsIfNeeded() {
  if (ColourList.length) return;
  const Timestamp = Date.now();
  let SortOrder = 0;
  for (const entry of DEFAULT_SHOW_COLOURS) {
    const [Err] = await DB.Run(
      'INSERT INTO ShowColours (Label, Colour, SortOrder, Timestamp, UpdatedAt) VALUES (?, ?, ?, ?, ?)',
      [entry.Label, entry.Colour, SortOrder, Timestamp, Timestamp]
    );
    if (Err) {
      Logger.error('Failed to seed default show colours', Err);
      return;
    }
    SortOrder += 1;
  }
}

Manager.Init = async () => {
  if (Initialized) return;
  if (InitPromise) return InitPromise;
  InitPromise = (async () => {
    await Manager.Reload();
    await SeedDefaultsIfNeeded();
    await Manager.Reload();
    await ReconcileDefaultPalette();
    await Manager.Reload();
    Initialized = true;
    InitPromise = null;
  })();
  return InitPromise;
};

Manager.Reload = async () => {
  const [Err, Rows] = await DB.All(
    'SELECT * FROM ShowColours ORDER BY SortOrder ASC, ShowColourID ASC',
    []
  );
  if (Err) {
    Logger.error('Failed to load show colours', Err);
    ColourList = [];
    return;
  }
  ColourList = (Rows || []).map(NormalizeRow);
};

Manager.GetAll = async () => {
  if (!Initialized) await Manager.Init();
  return Ok(ColourList);
};

Manager.Get = async (ShowColourID) => {
  if (!Initialized) await Manager.Init();
  const Colour = ColourList.find((C) => C.ShowColourID === Number(ShowColourID));
  if (!Colour) return Fail('Show colour not found');
  return Ok(Colour);
};

Manager.Create = async (Payload) => {
  if (!Initialized) await Manager.Init();
  const Timestamp = Date.now();
  const SortOrder = ColourList.length
    ? Math.max(...ColourList.map((C) => C.SortOrder)) + 1
    : 0;
  const [Err, Res] = await DB.Run(
    'INSERT INTO ShowColours (Label, Colour, SortOrder, Timestamp, UpdatedAt) VALUES (?, ?, ?, ?, ?)',
    [Payload.Label, Payload.Colour, SortOrder, Timestamp, Timestamp]
  );
  if (Err || !Res) return Fail('Failed to create show colour');
  const Created = NormalizeRow({
    ShowColourID: Res.lastID,
    Label: Payload.Label,
    Colour: Payload.Colour,
    SortOrder,
    Timestamp,
    UpdatedAt: Timestamp,
  });
  ColourList.push(Created);
  BroadcastManager.emit('ShowColourListChanged');
  return Ok(Created);
};

Manager.Update = async (ShowColourID, Payload) => {
  if (!Initialized) await Manager.Init();
  const ID = Number(ShowColourID);
  const Existing = ColourList.find((C) => C.ShowColourID === ID);
  if (!Existing) return Fail('Show colour not found');

  const Label = Object.prototype.hasOwnProperty.call(Payload, 'Label')
    ? Payload.Label
    : Existing.Label;
  const Colour = Object.prototype.hasOwnProperty.call(Payload, 'Colour')
    ? Payload.Colour
    : Existing.Colour;
  const UpdatedAt = Date.now();

  const [Err] = await DB.Run(
    'UPDATE ShowColours SET Label = ?, Colour = ?, UpdatedAt = ? WHERE ShowColourID = ?',
    [Label, Colour, UpdatedAt, ID]
  );
  if (Err) return Fail('Failed to update show colour');

  Existing.Label = Label;
  Existing.Colour = Colour;
  Existing.UpdatedAt = UpdatedAt;
  BroadcastManager.emit('ShowColourListChanged');
  return Ok(Existing);
};

Manager.Delete = async (ShowColourID) => {
  if (!Initialized) await Manager.Init();
  const ID = Number(ShowColourID);
  const [Err] = await DB.Run('DELETE FROM ShowColours WHERE ShowColourID = ?', [ID]);
  if (Err) return Fail('Failed to delete show colour');
  ColourList = ColourList.filter((C) => C.ShowColourID !== ID);
  BroadcastManager.emit('ShowColourListChanged');
  return Ok(true);
};

Manager.ResetToDefaults = async () => {
  if (!Initialized) await Manager.Init();
  const Timestamp = Date.now();
  const [DeleteErr] = await DB.Run('DELETE FROM ShowColours', []);
  if (DeleteErr) return Fail('Failed to reset show colours');

  let SortOrder = 0;
  for (const entry of DEFAULT_SHOW_COLOURS) {
    const [InsertErr] = await DB.Run(
      'INSERT INTO ShowColours (Label, Colour, SortOrder, Timestamp, UpdatedAt) VALUES (?, ?, ?, ?, ?)',
      [entry.Label, entry.Colour, SortOrder, Timestamp, Timestamp]
    );
    if (InsertErr) return Fail('Failed to reset show colours');
    SortOrder += 1;
  }

  await Manager.Reload();
  BroadcastManager.emit('ShowColourListChanged');
  return Ok(ColourList);
};

module.exports = { Manager };