const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadWithMocks } = require('../test-support/load-with-mocks');

function modulePath(...parts) {
  return path.join(__dirname, '..', 'src', 'Modules', ...parts);
}

test('AppData initializes folders and resolves directory paths', async () => {
  const made = [];
  const existing = new Set();
  const fsMock = {
    existsSync: (p) => existing.has(p),
    mkdirSync: (p) => {
      made.push(p);
      existing.add(p);
    },
  };
  let spawned = null;
  const childMock = {
    spawn: (command, args) => {
      spawned = { command, args };
      return { unref: () => {} };
    },
  };
  const osMock = { homedir: () => '/home/test' };

  const { Manager } = loadWithMocks(modulePath('AppData', 'index.js'), {
    fs: fsMock,
    os: osMock,
    child_process: childMock,
  });

  await Manager.Initialize();
  // Re-running is a no-op.
  await Manager.Initialize();

  assert.ok(made.some((p) => p.endsWith('Logs')));
  assert.ok(made.some((p) => p.endsWith('Storage')));

  assert.match(Manager.GetLogsDirectory(), /Logs$/);
  assert.match(Manager.GetStorageDirectory(), /Storage$/);
  assert.match(Manager.GetStateFilePath(), /state\.json$/);

  // OpenFolder returns false when the folder does not exist.
  assert.equal(Manager.OpenFolder('/missing'), false);

  // OpenFolder spawns the platform opener when the folder exists.
  existing.add('/some/dir');
  assert.equal(Manager.OpenFolder('/some/dir'), true);
  assert.ok(spawned);
  assert.deepEqual(spawned.args, ['/some/dir']);
});

test('Broadcast manager is a shared event emitter', () => {
  const { Manager } = loadWithMocks(modulePath('Broadcast', 'index.js'), {});
  let received = null;
  Manager.on('Ping', (payload) => (received = payload));
  Manager.emit('Ping', 42);
  assert.equal(received, 42);
});

test('OS manager exposes the hostname', () => {
  const { Manager } = loadWithMocks(modulePath('OS', 'index.js'), {
    os: { hostname: () => 'unit-test-host' },
  });
  assert.equal(Manager.Hostname, 'unit-test-host');
});

test('FileSelectorManager delegates to the electron dialog', async () => {
  const calls = [];
  const dialogMock = {
    showOpenDialog: async (opts) => {
      calls.push(['open', opts]);
      return { canceled: false, filePaths: ['/x.ShowTrak'] };
    },
    showSaveDialog: async (opts) => {
      calls.push(['save', opts]);
      return { canceled: false, filePath: '/y.ShowTrak' };
    },
  };
  const { Manager } = loadWithMocks(modulePath('FileSelectorManager', 'index.js'), {
    electron: { dialog: dialogMock },
  });

  const open = await Manager.OpenDialog('Open a show');
  assert.deepEqual(open.filePaths, ['/x.ShowTrak']);
  assert.equal(calls[0][1].title, 'Open a show');

  const save = await Manager.SaveDialog('Save a show');
  assert.equal(save.filePath, '/y.ShowTrak');
  assert.match(calls[1][1].defaultPath, /\.ShowTrak$/);
});
