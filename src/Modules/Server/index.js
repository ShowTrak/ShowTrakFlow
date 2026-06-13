// HTTP/Socket.IO server hosting the ShowTrak Flow Web UI (PWA) at root and
// mirroring OSC routes to HTTP under /API.
const { CreateLogger } = require('../Logger');
const Logger = CreateLogger('WebServer');

const HTTP = require('http');
const path = require('path');
const { Server: WebServer } = require('socket.io');
const { Config } = require('../Config');
const { OSC } = require('../OSC');
const express = require('express');

const { SetupWebUiNamespace } = require('./webui-namespace');

// HTTP server backing express + Socket.IO
const Server = HTTP.createServer();
Server.on('error', (e) => {
  Logger.error('HTTP/Socket server error:', e && e.code ? e.code : e);
});

const app = express();

app.use('/API', (req, res, next) => {
  const startAt = Date.now();
  res.on('finish', () => {
    const statusCode = Number(res.statusCode || 0);
    const sourceIP =
      (req.ip ||
        (req.socket && req.socket.remoteAddress) ||
        (req.connection && req.connection.remoteAddress)) ||
      null;

    const detailParts = [];
    if (res.locals && res.locals.debugTrafficDetail) {
      detailParts.push(String(res.locals.debugTrafficDetail));
    }
    detailParts.push(`${statusCode || '---'}`);
    if (Date.now() - startAt >= 0) detailParts.push(`${Date.now() - startAt}ms`);
    if (sourceIP) detailParts.push(sourceIP);

    Logger.log(`API ${req.method} ${req.originalUrl} -> ${statusCode}`);
    require('../Broadcast').Manager.emit('DebugTrafficEntry', {
      protocol: 'http',
      timestamp: Date.now(),
      valid: statusCode > 0 && statusCode < 400,
      summary: `${req.method} ${req.originalUrl || req.url || '/API'}`,
      detail: detailParts.join(' • '),
      source: sourceIP,
    });
  });
  next();
});

function sendApiError(res, httpStatus, code, message) {
  return res.status(httpStatus).json({
    Error: true,
    Code: code || httpStatus,
    Message: String(message || 'Request failed'),
  });
}

function sendApiSuccess(res, response) {
  return res.json({
    Error: false,
    Response: response,
  });
}

// All HTTP API routes are mirrored from the OSC routes defined in OSC/index.js.
// Example: /API/Shutdown (GET or POST) maps to the matching OSC route.
for (const Route of OSC.GetRoutes()) {
  const NormalizedPath =
    String(Route.Path || '').replace(/^\/(?:ShowTrak|API)(?=\/|$)/i, '') || '/';
  const ApiPath = `/API${NormalizedPath === '/' ? '' : NormalizedPath}`;
  const OSCToHTTPHandler = async (req, res) => {
    const Params = req.params || {};
    const SourceIP =
      (req.ip ||
        (req.socket && req.socket.remoteAddress) ||
        (req.connection && req.connection.remoteAddress)) ||
      null;

    let Result = null;
    try {
      Result = await Route.Callback(Params, { IP: SourceIP });
    } catch (Error) {
      const Message = String(
        (Error && Error.message) ||
          Error ||
          `Unhandled error while processing ${Route.Path}`
      );
      res.locals.debugTrafficDetail = Message;
      return sendApiError(res, 500, 'OSC_HTTP_HANDLER_EXCEPTION', Message);
    }

    const Passed =
      Result && typeof Result === 'object' ? Result.ok !== false : Result !== false;
    const Detail =
      Result && typeof Result === 'object' && Result.detail
        ? String(Result.detail)
        : Route.Title || Route.Path;

    res.locals.debugTrafficDetail = Detail;
    if (!Passed) {
      return sendApiError(res, 400, 'OSC_ROUTE_FAILED', Detail);
    }
    return sendApiSuccess(res, {
      Status: 'OK',
      Detail,
    });
  };
  app.get(ApiPath, OSCToHTTPHandler);
  app.post(ApiPath, OSCToHTTPHandler);
}

app.use('/API', (_req, res) => {
  res.locals.debugTrafficDetail = 'API route not found';
  return sendApiError(res, 404, 'API_ROUTE_NOT_FOUND', 'API route not found');
});

// Serve Web UI (PWA) at root
const WebUIRoot = path.join(__dirname, '../../WebUI');
app.use('/', express.static(WebUIRoot));
app.get('/', (_req, res) => {
  res.sendFile(path.join(WebUIRoot, 'index.html'));
});
Server.on('request', app);

// Initialize Socket.IO server with conservative timeouts
const io = new WebServer(Server, {
  cors: {
    origin: '*', // Adjust as needed for security
    methods: ['GET', 'POST'],
  },
  connectTimeout: 4000,
  pingTimeout: 2500,
  pingInterval: 5000,
});

const Manager = {};

// Wire the Web UI '/ui' Socket.IO namespace.
SetupWebUiNamespace(io);

Server.listen(Config.Application.Port, () => {
  Logger.log(`Socket.IO server running on port ${Config.Application.Port}`);
});

module.exports = {
  Manager,
};
