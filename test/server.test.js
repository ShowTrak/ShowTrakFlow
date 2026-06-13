const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');

const { loadWithMocks } = require('../test-support/load-with-mocks');

function serverPath(name) {
  return path.join(__dirname, '..', 'src', 'Modules', 'Server', name);
}

const loggerStub = {
  CreateLogger: () => ({
    log: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    success: () => {},
    database: () => {},
    databaseError: () => {},
  }),
};

// Minimal fake socket that records emitted events and exposes a trigger() to
// invoke registered handlers, mimicking the Socket.IO socket surface.
function makeSocket(handshake) {
  const handlers = {};
  const emitted = [];
  return {
    id: 'sock-1',
    handshake,
    joined: [],
    emitted,
    disconnected: null,
    join(room) {
      this.joined.push(room);
    },
    emit(event, ...args) {
      emitted.push({ event, args });
    },
    disconnect(flag) {
      this.disconnected = flag;
    },
    on(event, handler) {
      handlers[event] = handler;
    },
    async trigger(event, ...args) {
      if (handlers[event]) return handlers[event](...args);
    },
    hasHandler(event) {
      return typeof handlers[event] === 'function';
    },
  };
}

// Load the stripped Web UI namespace with mocked settings + broadcast.
function loadWebUi(settings, broadcast) {
  const managers = {
    '../Logger': loggerStub,
    '../Config': { Config: { Application: { Version: '9.9.9' } } },
    '../SettingsManager': { Manager: { GetValue: async (key) => settings[key] } },
    '../Broadcast': { Manager: broadcast },
  };
  return loadWithMocks(serverPath('webui-namespace.js'), managers);
}

function makeUiIo() {
  const ns = new EventEmitter();
  ns.middlewares = [];
  ns.use = (fn) => ns.middlewares.push(fn);
  ns._connection = null;
  const realOn = ns.on.bind(ns);
  ns.on = (event, handler) => {
    if (event === 'connection') ns._connection = handler;
    return realOn(event, handler);
  };
  return { of: () => ns, _ns: ns };
}

test('Web UI namespace gates access behind authentication', async () => {
  const broadcast = new EventEmitter();
  broadcast.off = broadcast.removeListener.bind(broadcast);
  const { SetupWebUiNamespace } = loadWebUi(
    {
      WEBUI_ENABLED: true,
      WEBUI_PASSWORD_PROTECTION_ENABLED: true,
      WEBUI_PASSWORD: 'secret',
    },
    broadcast
  );

  const io = makeUiIo();
  SetupWebUiNamespace(io);

  // Run the auth middleware with no token -> not authed.
  const socket = makeSocket({ auth: {}, query: {}, address: '127.0.0.1' });
  await new Promise((resolve) => io._ns.middlewares[0](socket, resolve));
  assert.equal(socket.Authed, false);

  await io._ns._connection(socket);
  // hello is always emitted; bootstrap is withheld until authed.
  assert.ok(socket.emitted.some((e) => e.event === 'hello'));
  assert.equal(
    socket.emitted.some((e) => e.event === 'bootstrap'),
    false
  );

  // Wrong password is rejected.
  let resp;
  await socket.trigger('auth:login', { password: 'nope' }, (r) => (resp = r));
  assert.deepEqual(resp, { error: 'invalid_password' });

  // Correct password authenticates and returns a token + a config-only bootstrap.
  await socket.trigger('auth:login', { password: 'secret' }, (r) => (resp = r));
  assert.equal(resp.ok, true);
  assert.equal(typeof resp.token, 'string');
  const bootstrap = socket.emitted.find((e) => e.event === 'bootstrap');
  assert.ok(bootstrap);
  assert.equal(bootstrap.args[0].config.Version, '9.9.9');

  // config:get returns the public config.
  await socket.trigger('config:get', (r) => (resp = r));
  assert.equal(resp.data.Version, '9.9.9');

  // Logout clears the session.
  await socket.trigger('auth:logout', (r) => (resp = r));
  assert.deepEqual(resp, { ok: true });

  // Disconnect detaches the settings broadcast listener.
  await socket.trigger('disconnect');
  assert.equal(broadcast.listenerCount('SettingsUpdated'), 0);
});

test('Web UI namespace disables access when the master toggle is off', async () => {
  const broadcast = new EventEmitter();
  broadcast.off = broadcast.removeListener.bind(broadcast);
  const { SetupWebUiNamespace } = loadWebUi(
    {
      WEBUI_ENABLED: false,
      WEBUI_PASSWORD_PROTECTION_ENABLED: false,
    },
    broadcast
  );

  const io = makeUiIo();
  SetupWebUiNamespace(io);

  const socket = makeSocket({ auth: {}, query: {}, address: '127.0.0.1' });
  await new Promise((resolve) => io._ns.middlewares[0](socket, resolve));
  await io._ns._connection(socket);

  const hello = socket.emitted.find((e) => e.event === 'hello');
  assert.equal(hello.args[0].Enabled, false);
  assert.equal(
    socket.emitted.some((e) => e.event === 'bootstrap'),
    false
  );

  let resp;
  await socket.trigger('auth:login', { password: '1234' }, (r) => (resp = r));
  assert.deepEqual(resp, { error: 'disabled' });
});

test('Server mirrors OSC routes to GET/POST and serves the Web UI', async () => {
  const getRoutes = [];
  const postRoutes = [];
  const getHandlers = {};
  const ioMock = {
    to: () => ({ emit: () => {} }),
    on: () => {},
    of: () => ({ use: () => {}, on: () => {} }),
  };

  loadWithMocks(serverPath('index.js'), {
    '../Logger': loggerStub,
    http: { createServer: () => ({ on: () => {}, listen: (_p, cb) => cb && cb() }) },
    'socket.io': {
      Server: class {
        constructor() {
          return ioMock;
        }
      },
    },
    express: Object.assign(
      () => {
        const app = () => {};
        app.use = () => {};
        app.get = (routePath, handler) => {
          getRoutes.push(routePath);
          if (typeof handler === 'function') getHandlers[routePath] = handler;
        };
        app.post = (routePath) => postRoutes.push(routePath);
        return app;
      },
      { static: () => () => {} }
    ),
    '../OSC': {
      OSC: {
        GetRoutes: () => [
          { Path: '/API/Shutdown', Title: 'Shutdown', Callback: async () => ({ ok: true }) },
          {
            Path: '/API/Shutdown/Force',
            Title: 'Force Shutdown',
            Callback: async () => ({ ok: true }),
          },
        ],
      },
    },
    '../Config': { Config: { Application: { Port: 0, Version: '1.0' } } },
    './webui-namespace': { SetupWebUiNamespace: () => {} },
  });

  // OSC routes are mirrored to both GET and POST under /API.
  assert.ok(getRoutes.includes('/API/Shutdown'));
  assert.ok(postRoutes.includes('/API/Shutdown'));
  assert.ok(getRoutes.includes('/API/Shutdown/Force'));
  assert.ok(postRoutes.includes('/API/Shutdown/Force'));
  // The legacy client list endpoint is gone.
  assert.ok(!getRoutes.includes('/API/Clients'));

  // The mirrored handler returns the OSC route result as a success payload.
  const shutdownHandler = getHandlers['/API/Shutdown'];
  assert.equal(typeof shutdownHandler, 'function');
  let statusCode = 200;
  let payload = null;
  const res = {
    locals: {},
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      payload = body;
      return this;
    },
  };
  await shutdownHandler({ params: {}, ip: '127.0.0.1' }, res);
  assert.equal(statusCode, 200);
  assert.equal(payload.Error, false);
  assert.equal(payload.Response.Status, 'OK');
});
