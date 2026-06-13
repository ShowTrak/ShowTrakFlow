const { CreateLogger } = require('../Logger');
const Logger = CreateLogger('OSC');

const { Server } = require('node-osc');

const { Manager: Broadcast } = require('../Broadcast');
var OSCServer = new Server(3333, '0.0.0.0', () => {
  console.log('OSC Server is listening');
});

let Routes = [];

const OSC = {};

function emitDebugEntry(payload) {
  Broadcast.emit('DebugTrafficEntry', {
    protocol: 'osc',
    timestamp: Date.now(),
    ...payload,
  });
}

function successResult(detail = '') {
  return {
    ok: true,
    detail: String(detail || ''),
  };
}

OSCServer.on('message', async function (Route, Info) {
  const RawPath = Array.isArray(Route) && Route.length > 0 ? String(Route[0] || '') : '';
  let ValidRoutes = [];

  Main: for (const PRoute of Routes) {
    let PRouteParts = PRoute.Path.split('/');
    let RouteParts = RawPath.split('/');
    if (PRouteParts.length !== RouteParts.length) continue Main;
    Sub: for (let i = 0; i < PRouteParts.length; i++) {
      if (PRouteParts[i] === RouteParts[i] || PRouteParts[i].startsWith(':')) continue Sub;
      continue Main;
    }
    ValidRoutes.push(PRoute);
  }

  if (!ValidRoutes || ValidRoutes.length == 0) {
    emitDebugEntry({
      valid: false,
      summary: RawPath || '[empty route]',
      detail: 'No matching OSC route',
    });
    return Logger.error(`Invalid OSC Route: ${RawPath}`);
  }

  for (const ValidRoute of ValidRoutes) {
    Logger.log(`Executing route: ${ValidRoute.Path}`);

    let Req = {};

    let PRouteParts = ValidRoute.Path.split('/');
    let RouteParts = RawPath.split('/');

    for (let i = 0; i < PRouteParts.length; i++) {
      if (PRouteParts[i].startsWith(':')) {
        Req[PRouteParts[i].substring(1)] = RouteParts[i];
      }
    }

    // Source address of the UDP packet (used by routes that record sender IPs).
    const Meta = { IP: Info && Info.address ? Info.address : null };

    let RequestComplete = await ValidRoute.Callback(Req, Meta);
    const RequestPassed =
      RequestComplete && typeof RequestComplete === 'object'
        ? RequestComplete.ok !== false
        : RequestComplete !== false;
    const RequestDetail =
      RequestComplete && typeof RequestComplete === 'object' && RequestComplete.detail
        ? String(RequestComplete.detail)
        : ValidRoute.Title || ValidRoute.Path;

    if (!RequestPassed) {
      emitDebugEntry({
        valid: false,
        summary: RawPath,
        detail: RequestDetail,
        source: Meta.IP || null,
      });
      continue;
    }
    emitDebugEntry({
      valid: true,
      summary: RawPath,
      detail: RequestDetail,
      source: Meta.IP || null,
    });
    Broadcast.emit('Notify', `OSC Processed Successfully`, 'success', 1200);
    return Logger.success(`OSC Complete: ${RawPath}`);
  }
  return Logger.warn(`OSC Incomplete but has matching path: ${RawPath}`);
});

OSC.GetRoutes = () => {
  return Routes;
};

OSC.CreateRoute = (Path, Callback, Title = 'Default OSC Route') => {
  Routes.push({
    Title: Title,
    Path: Path,
    Callback: Callback,
  });
  return;
};

// System Control
OSC.CreateRoute(
  '/API/Shutdown',
  async (_Req) => {
    Logger.warn('Received shutdown command via OSC');
    Broadcast.emit('Shutdown');
    return successResult('Shutdown requested');
  },
  'Close ShowTrak Flow'
);

OSC.CreateRoute(
  '/API/Shutdown/Force',
  async (_Req) => {
    Logger.warn('Received force shutdown command via OSC');
    Broadcast.emit('ShutdownForce');
    return successResult('Force shutdown requested');
  },
  'Force close ShowTrak Flow without save/show-mode prompts'
);

module.exports = { OSC };
