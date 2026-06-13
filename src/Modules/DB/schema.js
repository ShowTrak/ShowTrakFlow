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

// Idempotent column additions for existing installs. Errors are ignored when
// the column already exists; sqlite has no native "ADD COLUMN IF NOT EXISTS".
Schema.Migrations = [];

module.exports = Schema;
