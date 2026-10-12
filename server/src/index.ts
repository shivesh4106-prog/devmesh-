import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import { ingestRouter } from './routes/ingest';
import { replayRouter } from './routes/replay';
import { endpointRouter } from './routes/endpoints';
import { eventsRouter } from './routes/events';
import { setSocketIO } from './services/socketService';
import { startBufferDrainer } from './services/bufferService';

const app = express();
const httpServer = createServer(app);

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: CLIENT_URL,
    methods: ['GET', 'POST'],
  },
});

setSocketIO(io);

app.use(cors({ origin: CLIENT_URL }));

// Raw body parser for HMAC verification (must come before json parser)
app.use('/api/v1/ingest', express.raw({ type: '*/*', limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/v1/ingest', ingestRouter);
app.use('/api/v1/replay', replayRouter);
app.use('/api/v1/endpoints', endpointRouter);
app.use('/api/v1/events', eventsRouter);

// Root status & landing page (helps users navigating directly to port 3001)
app.get('/', (_req, res) => {
  res.type('html').send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>DevMesh Backend API</title>
        <style>
          body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0b0f19; color: #f1f5f9; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
          .card { background: #131c31; border: 1px solid #1e293b; padding: 36px; border-radius: 14px; max-width: 520px; box-shadow: 0 16px 40px rgba(0,0,0,0.6); text-align: center; }
          .badge { display: inline-flex; align-items: center; gap: 6px; background: rgba(34,197,94,0.12); color: #4ade80; border: 1px solid rgba(34,197,94,0.3); padding: 5px 14px; border-radius: 999px; font-size: 12px; font-weight: 600; margin-bottom: 20px; }
          .dot { width: 8px; height: 8px; background: #22c55e; border-radius: 50%; box-shadow: 0 0 8px #22c55e; }
          h1 { margin: 0 0 10px; font-size: 26px; font-weight: 800; background: linear-gradient(135deg, #60a5fa, #a855f7); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
          p { color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 24px; }
          .btn { display: inline-flex; align-items: center; gap: 8px; background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; box-shadow: 0 4px 14px rgba(59,130,246,0.4); transition: transform 0.15s, opacity 0.15s; }
          .btn:hover { opacity: 0.95; transform: translateY(-1px); }
          .api-links { margin-top: 24px; padding-top: 20px; border-top: 1px solid #1e293b; font-size: 12px; color: #64748b; }
          .api-links a { color: #38bdf8; text-decoration: none; margin: 0 8px; }
          .api-links a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="badge"><span class="dot"></span>DevMesh Backend Online (Port 3001)</div>
          <h1>DevMesh Ingestion API</h1>
          <p>
            You have accessed the backend API server. The full interactive 
            <strong>Webhook Inspector &amp; Chaos Studio</strong> dashboard is hosted on the frontend application!
          </p>
          <a class="btn" href="${CLIENT_URL}">
            Open DevMesh Dashboard (${CLIENT_URL}) &rarr;
          </a>
          <div class="api-links">
            API Endpoints:
            <a href="/api/v1/endpoints">/api/v1/endpoints</a> &bull;
            <a href="/api/v1/health">/api/v1/health</a>
          </div>
        </div>
      </body>
    </html>
  `);
});

// Health check
app.get(['/health', '/api/v1/health'], (_req, res) => {
  res.json({ status: 'ok', service: 'DevMesh', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// Socket.io connection handler
io.on('connection', (socket) => {
  console.log(`[Socket.io] Client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`[Socket.io] Client disconnected: ${socket.id}`);
  });
});

// Start in-memory buffer drainer
startBufferDrainer();

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`\n🚀 DevMesh Server running on http://localhost:${PORT}`);
  console.log(`📡 Socket.io ready`);
  console.log(`🔗 Accepting webhooks at POST /api/v1/ingest/:endpointId\n`);
});

export { io };
