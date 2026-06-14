const Schema = [];

Schema.push({
  Name: 'Settings',
  SQL: 'CREATE TABLE IF NOT EXISTS `Settings` ( \
            Key TEXT PRIMARY KEY, \
            Value BLOB \
    )',
});

Schema.push({
  Name: 'AlertRules',
  SQL: 'CREATE TABLE IF NOT EXISTS `AlertRules` ( \
            RuleID INTEGER PRIMARY KEY AUTOINCREMENT, \
            Title TEXT NOT NULL, \
            Scope TEXT NOT NULL, \
            TriggerType TEXT NOT NULL, \
            TriggerConfig TEXT, \
            Actions TEXT NOT NULL, \
            Enabled INTEGER NOT NULL DEFAULT 1, \
            Timestamp BIGINT(11) NOT NULL, \
            UpdatedAt BIGINT(11) NOT NULL \
    )',
});

Schema.push({
  Name: 'AlertHistory',
  SQL: 'CREATE TABLE IF NOT EXISTS `AlertHistory` ( \
            HistoryID INTEGER PRIMARY KEY AUTOINCREMENT, \
            RuleID INTEGER NOT NULL, \
            TriggerType TEXT NOT NULL, \
            TriggerSource TEXT NOT NULL, \
            Context TEXT, \
            Result TEXT, \
            Timestamp BIGINT(11) NOT NULL \
    )',
});

// --- ShowTrak Flow domain ---
// A Flow is an ordered, reusable template collection of groups (e.g. "Monday").
Schema.push({
  Name: 'Flows',
  SQL: 'CREATE TABLE IF NOT EXISTS `Flows` ( \
            FlowID INTEGER PRIMARY KEY AUTOINCREMENT, \
            Label TEXT NOT NULL, \
            SortOrder INTEGER NOT NULL DEFAULT 0, \
            Timestamp BIGINT(11) NOT NULL, \
            UpdatedAt BIGINT(11) NOT NULL \
    )',
});

// Groups belonging to a Flow template. GroupID is a customisable alphanumeric
// identifier (unique within a Flow). Notes and Flags are JSON-encoded arrays.
Schema.push({
  Name: 'FlowGroups',
  SQL: 'CREATE TABLE IF NOT EXISTS `FlowGroups` ( \
            RowID INTEGER PRIMARY KEY AUTOINCREMENT, \
            FlowID INTEGER NOT NULL, \
            GroupID TEXT NOT NULL, \
            Label TEXT NOT NULL, \
            Time TEXT, \
            Colour TEXT, \
            Notes TEXT NOT NULL DEFAULT \'[]\', \
            Flags TEXT NOT NULL DEFAULT \'[]\', \
            SortOrder INTEGER NOT NULL DEFAULT 0, \
            Timestamp BIGINT(11) NOT NULL, \
            UpdatedAt BIGINT(11) NOT NULL \
    )',
});

// Scenes are the fixed, ordered body of the show. Milestones are JSON-encoded.
Schema.push({
  Name: 'Scenes',
  SQL: 'CREATE TABLE IF NOT EXISTS `Scenes` ( \
            SceneID INTEGER PRIMARY KEY AUTOINCREMENT, \
            Label TEXT NOT NULL, \
            Duration INTEGER, \
            Milestones TEXT NOT NULL DEFAULT \'[]\', \
            TimerStartedAt BIGINT(11), \
            HasChatRoom INTEGER NOT NULL DEFAULT 0, \
            MaxGroups INTEGER, \
            Colour TEXT, \
            Icon TEXT, \
            SortOrder INTEGER NOT NULL DEFAULT 0, \
            Timestamp BIGINT(11) NOT NULL, \
            UpdatedAt BIGINT(11) NOT NULL \
    )',
});

Schema.push({
  Name: 'CustomChatRooms',
  SQL: 'CREATE TABLE IF NOT EXISTS `CustomChatRooms` ( \
            CustomChatRoomID INTEGER PRIMARY KEY AUTOINCREMENT, \
            Label TEXT NOT NULL, \
            Colour TEXT NOT NULL, \
            Icon TEXT NOT NULL, \
            SortOrder INTEGER NOT NULL DEFAULT 0, \
            Timestamp BIGINT(11) NOT NULL, \
            UpdatedAt BIGINT(11) NOT NULL \
    )',
});

Schema.push({
  Name: 'ChatMessages',
  SQL: 'CREATE TABLE IF NOT EXISTS `ChatMessages` ( \
            MessageID INTEGER PRIMARY KEY AUTOINCREMENT, \
            RoomType TEXT NOT NULL, \
            RoomID INTEGER NOT NULL, \
            AuthorLabel TEXT NOT NULL, \
            AuthorIcon TEXT NOT NULL, \
            AuthorColour TEXT NOT NULL, \
            Message TEXT NOT NULL, \
            Timestamp BIGINT(11) NOT NULL \
    )',
});

// Predefined flag definitions (configured in Show Settings).
Schema.push({
  Name: 'FlagDefinitions',
  SQL: 'CREATE TABLE IF NOT EXISTS `FlagDefinitions` ( \
            FlagID INTEGER PRIMARY KEY AUTOINCREMENT, \
            Label TEXT NOT NULL, \
            Icon TEXT NOT NULL, \
            Colour TEXT, \
            SortOrder INTEGER NOT NULL DEFAULT 0, \
            Timestamp BIGINT(11) NOT NULL, \
            UpdatedAt BIGINT(11) NOT NULL \
    )',
});

// Remote users configured in Show Settings for remote-auth capable workflows.
Schema.push({
  Name: 'RemoteUsers',
  SQL: 'CREATE TABLE IF NOT EXISTS `RemoteUsers` ( \
            RemoteUserID INTEGER PRIMARY KEY AUTOINCREMENT, \
            Username TEXT NOT NULL, \
            Pin TEXT NOT NULL, \
            IsAdmin INTEGER NOT NULL DEFAULT 0, \
            Colour TEXT, \
            Icon TEXT, \
            SortOrder INTEGER NOT NULL DEFAULT 0, \
            Timestamp BIGINT(11) NOT NULL, \
            UpdatedAt BIGINT(11) NOT NULL \
    )',
});

Schema.push({
  Name: 'ShowColours',
  SQL: 'CREATE TABLE IF NOT EXISTS `ShowColours` ( \
            ShowColourID INTEGER PRIMARY KEY AUTOINCREMENT, \
            Label TEXT NOT NULL, \
            Colour TEXT NOT NULL, \
            SortOrder INTEGER NOT NULL DEFAULT 0, \
            Timestamp BIGINT(11) NOT NULL, \
            UpdatedAt BIGINT(11) NOT NULL \
    )',
});

// The live "Active Show" queue. Group instances here are editable copies that
// do not write back to their source Flow. Location tracks queue/scene/done so
// the running show survives restarts (crash recovery).
Schema.push({
  Name: 'QueueGroups',
  SQL: "CREATE TABLE IF NOT EXISTS `QueueGroups` ( \
            InstanceID INTEGER PRIMARY KEY AUTOINCREMENT, \
            GroupID TEXT NOT NULL, \
            Label TEXT NOT NULL, \
            Time TEXT, \
            Colour TEXT, \
            Notes TEXT NOT NULL DEFAULT '[]', \
            Flags TEXT NOT NULL DEFAULT '[]', \
            Location TEXT NOT NULL DEFAULT 'QUEUE', \
            SceneID INTEGER, \
            SortOrder INTEGER NOT NULL DEFAULT 0, \
            SourceFlowID INTEGER, \
            Timestamp BIGINT(11) NOT NULL, \
            UpdatedAt BIGINT(11) NOT NULL \
    )",
});

// Idempotent column additions for existing installs. Errors are ignored when
// the column already exists; sqlite has no native "ADD COLUMN IF NOT EXISTS".
Schema.Migrations = [
  'ALTER TABLE `FlagDefinitions` ADD COLUMN Colour TEXT',
  'ALTER TABLE `RemoteUsers` ADD COLUMN Colour TEXT',
  'ALTER TABLE `RemoteUsers` ADD COLUMN Icon TEXT',
  'ALTER TABLE `Scenes` ADD COLUMN HasChatRoom INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE `Scenes` ADD COLUMN MaxGroups INTEGER',
  'ALTER TABLE `Scenes` ADD COLUMN TimerStartedAt BIGINT(11)',
  'ALTER TABLE `Scenes` ADD COLUMN Colour TEXT',
  'ALTER TABLE `Scenes` ADD COLUMN Icon TEXT',
];

// Tables left behind by the removed flow-canvas feature that reuse a current
// table name with an incompatible structure. Each entry names a legacy-only
// marker column; when present, the table is dropped during schema init so the
// correct definition above is recreated. A table matching the current schema
// lacks the marker column and is therefore never affected.
Schema.LegacyReplacements = [
  { Table: 'Scenes', LegacyColumn: 'PositionX' },
  { Table: 'FlowGroups', LegacyColumn: 'CurrentNodeID' },
];

module.exports = Schema;
