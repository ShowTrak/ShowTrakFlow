const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const { loadWithMocks } = require('../test-support/load-with-mocks');

function createLoggerStub() {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
  };
}

test('BackupManager saves, opens, and creates new ShowTrak files', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'showtrak-backup-'));
  const savePath = path.join(tmpDir, 'nested', 'Show.ShowTrak');

  const events = [];
  const snapshotCalls = [];
  const replaceCalls = [];
  let resetCalls = 0;
  let hasUnsavedChanges = true;
  const dbMock = {
    Manager: {
      // Emulate VACUUM INTO by writing a placeholder snapshot file.
      SnapshotTo: async (target) => {
        snapshotCalls.push(target);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, 'SQLiteSnapshot');
        return [null, target];
      },
      ReplaceWithFile: async (source) => {
        replaceCalls.push(source);
        return [null, source];
      },
      ResetToEmpty: async () => {
        resetCalls += 1;
        return [null, 'db'];
      },
      HasData: async () => true,
      HasUnsavedChanges: async () => hasUnsavedChanges,
      MarkClean: () => {
        hasUnsavedChanges = false;
      },
    },
  };

  const statePath = path.join(tmpDir, 'state.json');
  const modulePath = path.join(__dirname, '..', 'src', 'Modules', 'BackupManager', 'index.js');
  const { Manager } = loadWithMocks(modulePath, {
    '../Logger': { CreateLogger: () => createLoggerStub() },
    '../DB': dbMock,
    '../AppData': { Manager: { GetStateFilePath: () => statePath } },
    '../Broadcast': { Manager: { emit: (event) => events.push(event) } },
  });

  // Save As: delegates to a full-database snapshot and reports success.
  const [saveErr, saveMsg] = await Manager.Save(savePath);
  assert.equal(saveErr, null);
  assert.match(saveMsg, /saved/i);
  assert.deepEqual(snapshotCalls, [savePath]);
  assert.equal(fs.existsSync(savePath), true);
  // The open file path is persisted so it survives a relaunch.
  assert.equal(Manager.GetCurrentFilePath(), savePath);
  assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).CurrentFilePath, savePath);
  // With a file associated, working data is considered saved (not legacy).
  assert.equal(await Manager.HasUnsavedWorkingData(), false);
  assert.equal(await Manager.HasUnsavedChanges(), false);

  // The saved file exists on disk, so the boot-time integrity check is a no-op.
  const [, presentResult] = await Manager.EnsureCurrentFileExists();
  assert.equal(presentResult.Missing, false);
  assert.equal(Manager.GetCurrentFilePath(), savePath);

  // Open: swaps the working database and triggers a full re-hydration.
  const [openErr, openMsg] = await Manager.Open(savePath);
  assert.equal(openErr, null);
  assert.match(openMsg, /opened/i);
  assert.deepEqual(replaceCalls, [savePath]);
  assert.ok(events.includes('ReinitializeSystem'));

  // Opening a missing file fails before touching the database.
  const [missingErr] = await Manager.Open(path.join(tmpDir, 'does-not-exist.ShowTrak'));
  assert.match(String(missingErr), /does not exist/i);
  assert.equal(replaceCalls.length, 1);

  // New: resets the database to empty and clears the current file pointer.
  const resetBeforeNew = resetCalls;
  const [newErr, newMsg] = await Manager.New();
  assert.equal(newErr, null);
  assert.match(newMsg, /new show/i);
  assert.equal(resetCalls, resetBeforeNew + 1);
  assert.equal(Manager.GetCurrentFilePath(), null);
  assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).CurrentFilePath, null);
  // With no file associated but data present, it reports unsaved legacy data.
  assert.equal(await Manager.HasUnsavedWorkingData(), true);
  assert.equal(await Manager.HasUnsavedChanges(), false);

  // Boot-time integrity check: re-associate a file then delete it from disk;
  // the next check wipes the working data and clears the pointer.
  await Manager.Save(savePath);
  assert.equal(Manager.GetCurrentFilePath(), savePath);
  fs.unlinkSync(savePath);
  const resetBeforeMissing = resetCalls;
  const [missingCheckErr, missingResult] = await Manager.EnsureCurrentFileExists();
  assert.equal(missingCheckErr, null);
  assert.equal(missingResult.Missing, true);
  assert.equal(resetCalls, resetBeforeMissing + 1);
  assert.equal(Manager.GetCurrentFilePath(), null);
  assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).CurrentFilePath, null);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('ChecksumManager delegates to checksum.file and returns the digest', async () => {
  const checksumModulePath = path.join(
    __dirname,
    '..',
    'src',
    'Modules',
    'ChecksumManager',
    'index.js'
  );
  const { Manager } = loadWithMocks(checksumModulePath, {
    checksum: {
      file: (_filePath, cb) => cb(null, 'deadbeef'),
    },
  });

  const result = await Manager.Checksum('/tmp/file.txt');
  assert.equal(result, 'deadbeef');
});
