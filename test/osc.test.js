const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadWithMocks } = require('../test-support/load-with-mocks');

const noopLogger = {
  CreateLogger: () => ({
    log: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    success: () => {},
    debug: () => {},
  }),
};

function loadOSC(overrides = {}) {
  const handlers = {};
  const oscMock = {
    Server: class {
      constructor(_port, _host, cb) {
        if (typeof cb === 'function') cb();
      }
      on(event, handler) {
        handlers[event] = handler;
      }
    },
  };

  const broadcastEvents = [];
  const mocks = {
    'node-osc': oscMock,
    '../Logger': noopLogger,
    '../Broadcast': { Manager: { emit: (...args) => broadcastEvents.push(args) } },
    ...overrides,
  };

  const { OSC } = loadWithMocks(
    path.join(__dirname, '..', 'src', 'Modules', 'OSC', 'index.js'),
    mocks
  );
  return { OSC, handlers, broadcastEvents };
}

test('OSC registers the built-in shutdown routes', () => {
  const { OSC } = loadOSC();
  const routes = OSC.GetRoutes().map((r) => r.Path);
  assert.ok(routes.includes('/API/Shutdown'));
  assert.ok(routes.includes('/API/Shutdown/Force'));
});

test('OSC shutdown route emits Shutdown broadcast', async () => {
  const { handlers, broadcastEvents } = loadOSC();
  await handlers.message(['/API/Shutdown']);
  assert.ok(broadcastEvents.some(([event]) => event === 'Shutdown'));
});

test('OSC force shutdown route emits ShutdownForce broadcast', async () => {
  const { handlers, broadcastEvents } = loadOSC();
  await handlers.message(['/API/Shutdown/Force']);
  assert.ok(broadcastEvents.some(([event]) => event === 'ShutdownForce'));
});

test('OSC ignores routes that do not match any registered path', async () => {
  const { handlers, broadcastEvents } = loadOSC();
  await handlers.message(['/Unknown/Route']);
  assert.ok(
    !broadcastEvents.some(
      ([event]) => event === 'OSCBulkAction' || event === 'Notify' || event === 'Shutdown'
    )
  );
});

test('OSC.CreateRoute registers custom routes', () => {
  const { OSC } = loadOSC();
  const before = OSC.GetRoutes().length;
  OSC.CreateRoute('/Custom/:Value', async () => true, 'Custom route');
  assert.equal(OSC.GetRoutes().length, before + 1);
});
