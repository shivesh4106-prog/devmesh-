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

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'DevMesh', timestamp: new Date().toISOString() });
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
