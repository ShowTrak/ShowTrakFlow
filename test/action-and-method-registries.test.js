const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadWithMocks } = require('../test-support/load-with-mocks');

function createLoggerStub() {
  return {
    warn: () => {},
    info: () => {},
    error: () => {},
    child: () => createLoggerStub(),
  };
}

test('AlertActions manager normalizes, validates, and executes actions', async () => {
  const actionA = {
    ID: 'alpha',
    Name: 'Alpha',
    Settings: [{ Key: 'Count', Type: 'number', Default: 5, Min: 1, Max: 10 }],
    Execute: async (config) => ({ Success: true, got: config.Settings.Count }),
  };
  const actionB = {
    ID: 'beta',
    Name: 'Beta',
    NormalizeSettings: (input) => ({ Hooked: !!(input && input.Hooked) }),
    ValidateSettings: (normalized) => {
      if (!normalized.Hooked) throw new Error('Hooked must be true');
    },
    Execute: async () => ({ Success: true }),
  };

  const modulePath = path.join(__dirname, '..', 'src', 'Modules', 'AlertActions', 'index.js');
  const { Manager } = loadWithMocks(modulePath, {
    '../Logger': { CreateLogger: () => createLoggerStub() },
    './osc-trigger': actionA,
    './http-api': actionB,
    './discord-webhook': { Name: 'invalid-no-id' },
    './play-sound': { Name: 'invalid-no-id' },
    './showtrak-alert': { Name: 'invalid-no-id' },
  });

  assert.equal(Manager.Has('alpha'), true);
  assert.equal(Manager.Has('beta'), true);
  assert.equal(Manager.Has('missing'), false);

  const publicList = Manager.GetAll();
  assert.equal(publicList.length, 2);
  assert.ok(!Object.prototype.hasOwnProperty.call(publicList[0], 'Execute'));

  const normalizedAlpha = Manager.NormalizeSettings('alpha', { Count: 999 });
  assert.deepEqual(normalizedAlpha, { Count: 10 });

  const resultAlpha = await Manager.Execute({ Type: 'alpha', Settings: { Count: 2 } }, {});
  assert.deepEqual(resultAlpha, { Success: true, got: 2 });

  const resultBetaFail = await Manager.Execute({ Type: 'beta', Settings: { Hooked: false } }, {});
  assert.equal(resultBetaFail.Success, false);
  assert.match(resultBetaFail.Error, /Hooked must be true/i);

  const missing = await Manager.Execute({ Type: 'missing', Settings: {} }, {});
  assert.equal(missing.Success, false);
  assert.match(missing.Error, /Unknown alert action/i);
});
