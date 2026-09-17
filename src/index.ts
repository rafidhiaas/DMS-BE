import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { errorHandler } from './middlewares/errorHandler.js';
import { testDatabaseConnection, disconnectDatabase } from './config/prisma.js';
import logger from './utils/logger.js';

// Routes
import authRoutes from './routes/authRoutes.js';
import documentRoutes from './routes/documentRoutes.js';
import folderRoutes from './routes/folderRoutes.js';
import shareRoutes from './routes/shareRoutes.js';
import activityLogRoutes from './routes/activityLogRoutes.js';
import userRoutes from './routes/userRoutes.js';
import metadataRoutes from './routes/metadataRoutes.js';

dotenv.config();

// ✅ BigInt JSON serializer
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

// ✅ Parse CORS origins (trim whitespace)
const getAllowedOrigins = (): string[] => {
  const env = process.env.CLIENT_URL || 'http://localhost:3000';
  return env
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
};

const app = express();
const PORT = process.env.PORT || 5000;

// ============ Middleware ============
app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      const allowed = getAllowedOrigins();
      // Izinkan request tanpa origin (curl, Postman, mobile)
      if (!origin) return callback(null, true);
      if (allowed.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files
app.use('/uploads', express.static(process.env.UPLOAD_DIR || './uploads'));

// ============ Routes ============
app.use('/api/auth', authRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/shares', shareRoutes);
app.use('/api/activity-logs', activityLogRoutes);
app.use('/api/users', userRoutes);
app.use('/api/metadata', metadataRoutes);

// ============ Health Check ============
app.get('/healthz', async (_req, res) => {
  try {
    const dbOk = await testDatabaseConnection();

    res.status(dbOk ? 200 : 503).json({
      status: dbOk ? 'OK' : 'DEGRADED',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      services: {
        database: dbOk ? 'up' : 'down',
      },
    });
  } catch (error) {
    res.status(503).json({
      status: 'ERROR',
      message: 'Health check failed',
    });
  }
});

// ============ 404 Handler ============
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} tidak ditemukan`,
  });
});

// ============ Error Handler (HARUS paling akhir) ============
app.use(errorHandler);

// ============ Start Server ============
async function startServer() {
  try {
    // Test DB dulu sebelum listen
    logger.info('🔍 Testing database connection...');
    const dbOk = await testDatabaseConnection();

    if (!dbOk) {
      logger.error('❌ Database tidak dapat diakses. Server tidak dijalankan.');
      logger.error('   Cek: PostgreSQL running? DATABASE_URL benar?');
      process.exit(1);
    }

    logger.info('✅ Database connected');

    const server = app.listen(PORT, () => {
      logger.info(`🚀 DMS Backend running on http://localhost:${PORT}`);
      logger.info(`📊 Environment: ${process.env.NODE_ENV}`);
    });

    // ✅ Signal handler DI SINI (satu-satunya tempat)
    const shutdown = async (signal: string) => {
      logger.info(`\n${signal} received. Shutting down gracefully...`);

      server.close(async () => {
        logger.info('HTTP server closed');
        await disconnectDatabase();
        process.exit(0);
      });

      // Force exit kalau > 10 detik
      setTimeout(() => {
        logger.error('Force exit after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();