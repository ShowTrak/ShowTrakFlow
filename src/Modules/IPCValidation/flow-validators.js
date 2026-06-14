// ShowTrak Flow validators: Flows, Flow Groups, Scenes, Flags and the Queue.
// All validators throw on invalid input and return normalized values.
const { fail, isPlainObject, normalizeNonEmptyString } = require('./primitives');

const GROUP_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const HEX_PATTERN = /^#?[0-9A-Fa-f]{6}$/;
const ICON_PATTERN = /^[A-Za-z0-9-]+$/;
const PIN_PATTERN = /^\d{4}$/;

function normalizePositiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    fail(`${fieldName} must be a positive integer`);
  }
  return number;
}

function normalizeHexColour(value, fieldName) {
  if (typeof value !== 'string' || !HEX_PATTERN.test(value.trim())) {
    fail(`${fieldName} must be a 6-digit hex colour`);
  }
  const hex = value.trim().replace(/^#/, '');
  return `#${hex.toUpperCase()}`;
}

function normalizeOptionalTime(value, fieldName) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !TIME_PATTERN.test(value.trim())) {
    fail(`${fieldName} must be in HH:MM format`);
  }
  return value.trim();
}

function normalizeOptionalColour(value, fieldName) {
  if (value == null || value === '') return null;
  return normalizeHexColour(value, fieldName);
}

function normalizeIDArray(value, validator, fieldName) {
  if (!Array.isArray(value)) fail(`${fieldName} must be an array`);
  return value.map((item) => validator(item, `${fieldName} entry`));
}

function normalizeNotes(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) fail('Notes must be an array');
  return value.map((note) => {
    if (!isPlainObject(note)) fail('Each note must be an object');
    return {
      Message: normalizeNonEmptyString(note.Message, 'Note message', { maxLength: 2000 }),
      Timestamp: Number.isFinite(Number(note.Timestamp)) ? Number(note.Timestamp) : Date.now(),
      AuthorID: Number.isFinite(Number(note.AuthorID)) ? Number(note.AuthorID) : 0,
    };
  });
}

function normalizeFlags(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) fail('Flags must be an array');
  return value.map((flag) => {
    if (!isPlainObject(flag)) fail('Each flag must be an object');
    const out = {
      Label: normalizeNonEmptyString(flag.Label, 'Flag label', { maxLength: 80 }),
      Icon: normalizeNonEmptyString(flag.Icon, 'Flag icon', { maxLength: 64 }),
      Colour: normalizeOptionalColour(flag.Colour, 'Flag colour') || '#F4C453',
      Comment:
        flag.Comment == null || flag.Comment === ''
          ? null
          : normalizeNonEmptyString(flag.Comment, 'Flag comment', { maxLength: 2000 }),
      Timestamp: Number.isFinite(Number(flag.Timestamp)) ? Number(flag.Timestamp) : Date.now(),
      AuthorID: Number.isFinite(Number(flag.AuthorID)) ? Number(flag.AuthorID) : 0,
    };
    if (flag.DefinitionID != null) {
      out.DefinitionID = normalizePositiveInteger(flag.DefinitionID, 'Flag definition ID');
    }
    if (!ICON_PATTERN.test(out.Icon)) {
      fail('Flag icon must be a Bootstrap icon name (letters, numbers and dashes)');
    }
    return out;
  });
}

function normalizeMilestones(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) fail('Milestones must be an array');
  return value.map((milestone) => {
    if (!isPlainObject(milestone)) fail('Each milestone must be an object');
    const offset = Number(milestone.Offset);
    if (!Number.isFinite(offset) || offset < 0) {
      fail('Milestone offset must be a non-negative number of seconds');
    }
    return {
      Label:
        milestone.Label == null || milestone.Label === ''
          ? ''
          : normalizeNonEmptyString(milestone.Label, 'Milestone label', { maxLength: 120 }),
      Offset: Math.round(offset),
      Colour: normalizeHexColour(milestone.Colour, 'Milestone colour'),
    };
  });
}

function normalizeGroupPayload(value, { requireGroupID = false } = {}) {
  if (!isPlainObject(value)) fail('Group payload must be an object');
  const out = {
    Label: normalizeNonEmptyString(value.Label, 'Group label', { maxLength: 200 }),
    Time: normalizeOptionalTime(value.Time, 'Group time'),
    Colour: normalizeOptionalColour(value.Colour, 'Group colour'),
    Notes: normalizeNotes(value.Notes),
    Flags: normalizeFlags(value.Flags),
  };
  const hasGroupID = value.GroupID != null && String(value.GroupID).trim() !== '';
  if (hasGroupID) {
    const groupID = String(value.GroupID).trim();
    if (!GROUP_ID_PATTERN.test(groupID)) {
      fail('Group ID must be alphanumeric without spaces');
    }
    if (groupID.length > 64) fail('Group ID must be at most 64 characters');
    out.GroupID = groupID;
  } else if (requireGroupID) {
    fail('Group ID is required');
  }
  if (value.SourceFlowID != null) {
    out.SourceFlowID = normalizePositiveInteger(value.SourceFlowID, 'Source flow ID');
  }
  return out;
}

module.exports = function registerFlowValidators(Manager) {
  Manager.FlowID = (value) => normalizePositiveInteger(value, 'Flow ID');
  Manager.FlowGroupRowID = (value) => normalizePositiveInteger(value, 'Group row ID');
  Manager.SceneID = (value) => normalizePositiveInteger(value, 'Scene ID');
  Manager.FlagID = (value) => normalizePositiveInteger(value, 'Flag ID');
  Manager.QueueInstanceID = (value) => normalizePositiveInteger(value, 'Queue instance ID');
  Manager.RemoteUserID = (value) => normalizePositiveInteger(value, 'Remote user ID');
  Manager.ShowColourID = (value) => normalizePositiveInteger(value, 'Show colour ID');

  Manager.FlowPayload = (value) => {
    if (!isPlainObject(value)) fail('Flow payload must be an object');
    const out = {};
    if (Object.prototype.hasOwnProperty.call(value, 'Label')) {
      out.Label = normalizeNonEmptyString(value.Label, 'Flow label', { maxLength: 200 });
    }
    return out;
  };

  Manager.FlowGroupPayload = (value) => normalizeGroupPayload(value);
  Manager.QueueGroupPayload = (value) => normalizeGroupPayload(value, { requireGroupID: true });

  Manager.ScenePayload = (value) => {
    if (!isPlainObject(value)) fail('Scene payload must be an object');
    const out = {};
    if (Object.prototype.hasOwnProperty.call(value, 'Label')) {
      out.Label = normalizeNonEmptyString(value.Label, 'Scene label', { maxLength: 200 });
    }
    if (Object.prototype.hasOwnProperty.call(value, 'Duration')) {
      if (value.Duration == null || value.Duration === '') {
        out.Duration = null;
      } else {
        const duration = Number(value.Duration);
        if (!Number.isFinite(duration) || duration < 0) {
          fail('Scene duration must be a non-negative number of seconds');
        }
        out.Duration = Math.round(duration);
      }
    }
    if (Object.prototype.hasOwnProperty.call(value, 'Milestones')) {
      out.Milestones = normalizeMilestones(value.Milestones);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'HasChatRoom')) {
      out.HasChatRoom = !!value.HasChatRoom;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'MaxGroups')) {
      if (value.MaxGroups == null || value.MaxGroups === '') {
        out.MaxGroups = null;
      } else {
        const maxGroups = Number(value.MaxGroups);
        if (!Number.isInteger(maxGroups) || maxGroups <= 0) {
          fail('Scene max groups must be a positive integer');
        }
        out.MaxGroups = maxGroups;
      }
    }
    if (Object.prototype.hasOwnProperty.call(value, 'Colour')) {
      out.Colour = normalizeHexColour(value.Colour, 'Scene colour');
    }
    if (Object.prototype.hasOwnProperty.call(value, 'Icon')) {
      const icon = normalizeNonEmptyString(value.Icon, 'Scene icon', { maxLength: 64 });
      if (!ICON_PATTERN.test(icon)) {
        fail('Scene icon must be a Bootstrap icon name (letters, numbers and dashes)');
      }
      out.Icon = icon;
    }
    return out;
  };

  Manager.FlagPayload = (value) => {
    if (!isPlainObject(value)) fail('Flag payload must be an object');
    const out = {};
    if (Object.prototype.hasOwnProperty.call(value, 'Label')) {
      out.Label = normalizeNonEmptyString(value.Label, 'Flag label', { maxLength: 80 });
    }
    if (Object.prototype.hasOwnProperty.call(value, 'Icon')) {
      const icon = normalizeNonEmptyString(value.Icon, 'Flag icon', { maxLength: 64 });
      if (!ICON_PATTERN.test(icon)) {
        fail('Flag icon must be a Bootstrap icon name (letters, numbers and dashes)');
      }
      out.Icon = icon;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'Colour')) {
      out.Colour = normalizeHexColour(value.Colour, 'Flag colour');
    }
    return out;
  };

  Manager.RemoteUserPayload = (value) => {
    if (!isPlainObject(value)) fail('Remote user payload must be an object');
    const out = {};
    if (Object.prototype.hasOwnProperty.call(value, 'Username')) {
      out.Username = normalizeNonEmptyString(value.Username, 'Username', { maxLength: 80 });
    }
    if (Object.prototype.hasOwnProperty.call(value, 'Pin')) {
      const pin = normalizeNonEmptyString(value.Pin, 'PIN', { minLength: 4, maxLength: 4 });
      if (!PIN_PATTERN.test(pin)) fail('PIN must be exactly 4 digits');
      out.Pin = pin;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'IsAdmin')) {
      out.IsAdmin = !!value.IsAdmin;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'Colour')) {
      out.Colour = normalizeHexColour(value.Colour, 'Remote user colour');
    }
    if (Object.prototype.hasOwnProperty.call(value, 'Icon')) {
      const icon = normalizeNonEmptyString(value.Icon, 'Remote user icon', { maxLength: 64 });
      if (!ICON_PATTERN.test(icon)) {
        fail('Remote user icon must be a Bootstrap icon name (letters, numbers and dashes)');
      }
      out.Icon = icon;
    }
    return out;
  };

  Manager.ShowColourPayload = (value) => {
    if (!isPlainObject(value)) fail('Show colour payload must be an object');
    const out = {};
    if (Object.prototype.hasOwnProperty.call(value, 'Label')) {
      out.Label = normalizeNonEmptyString(value.Label, 'Show colour label', { maxLength: 80 });
    }
    if (Object.prototype.hasOwnProperty.call(value, 'Colour')) {
      out.Colour = normalizeHexColour(value.Colour, 'Show colour');
    }
    return out;
  };

  Manager.CustomChatRoomPayload = (value) => {
    if (!isPlainObject(value)) fail('Custom chat room payload must be an object');
    const out = {};
    if (Object.prototype.hasOwnProperty.call(value, 'Label')) {
      out.Label = normalizeNonEmptyString(value.Label, 'Chat room label', { maxLength: 120 });
    }
    if (Object.prototype.hasOwnProperty.call(value, 'Colour')) {
      out.Colour = normalizeHexColour(value.Colour, 'Chat room colour');
    }
    if (Object.prototype.hasOwnProperty.call(value, 'Icon')) {
      const icon = normalizeNonEmptyString(value.Icon, 'Chat room icon', { maxLength: 64 });
      if (!ICON_PATTERN.test(icon)) {
        fail('Chat room icon must be a Bootstrap icon name (letters, numbers and dashes)');
      }
      out.Icon = icon;
    }
    return out;
  };

  Manager.ChatRoomType = (value) => {
    const type = String(value || '').toUpperCase();
    if (!['CUSTOM', 'SCENE'].includes(type)) {
      fail('Chat room type must be CUSTOM or SCENE');
    }
    return type;
  };

  Manager.ChatMessageText = (value) =>
    normalizeNonEmptyString(value, 'Chat message', { maxLength: 4000 });

  Manager.FlowIDList = (value) => normalizeIDArray(value, Manager.FlowID, 'Flow IDs');
  Manager.FlowGroupRowIDList = (value) =>
    normalizeIDArray(value, Manager.FlowGroupRowID, 'Group row IDs');
  Manager.SceneIDList = (value) => normalizeIDArray(value, Manager.SceneID, 'Scene IDs');
  Manager.FlagIDList = (value) => normalizeIDArray(value, Manager.FlagID, 'Flag IDs');
  Manager.QueueInstanceIDList = (value) =>
    normalizeIDArray(value, Manager.QueueInstanceID, 'Queue instance IDs');

  Manager.QueueLocation = (value) => {
    const location = String(value || '').toUpperCase();
    if (!['QUEUE', 'SCENE', 'DONE'].includes(location)) {
      fail('Location must be QUEUE, SCENE or DONE');
    }
    return location;
  };
};
