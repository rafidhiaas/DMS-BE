import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import logger from '../utils/logger.js';

// ============ 1. Validasi DATABASE_URL ============
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  logger.error('❌ FATAL: DATABASE_URL tidak di-set di environment variables');
  logger.error('   Cek file .env atau environment variables deployment');
  process.exit(1);
}

// ✅ Validasi format URL (protocol postgresql)
try {
  const url = new URL(DATABASE_URL);
  if (!['postgresql:', 'postgres:'].includes(url.protocol)) {
    throw new Error(
      `Protocol "${url.protocol}" tidak didukung (harus postgresql:// atau postgres://)`
    );
  }
} catch (error) {
  logger.error('❌ FATAL: DATABASE_URL format tidak valid');
  logger.error(`   ${(error as Error).message}`);
  logger.error('   Contoh: postgresql://user:pass@localhost:5432/dbname');
  process.exit(1);
}

// ============ 2. Prisma Client Setup ============
const adapter = new PrismaPg({
  connectionString: DATABASE_URL,
});

const globalForPrisma = global as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'info', 'warn', 'error']
        : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// ============ 3. Test Koneksi ============
/**
 * Test koneksi ke database dengan eksekusi query ringan.
 * Pakai `$queryRaw\`SELECT 1\`` agar benar-benar hit DB (bukan lazy $connect).
 * 
 * Caller (index.ts) yang bertanggung jawab log status.
 */
export async function testDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.error('❌ Database connection test failed:', error);
    return false;
  }
}

// ============ 4. Graceful Disconnect ============
/**
 * Disconnect database dengan aman.
 * Dipanggil dari `index.ts` saat SIGTERM/SIGINT.
 */
export async function disconnectDatabase(): Promise<void> {
  try {
    await prisma.$disconnect();
    logger.info('🔌 Database disconnected');
  } catch (error) {
    logger.error('Error during database disconnect:', error);
  }
}

// ⚠️ CATATAN PENTING:
// Signal handler (process.on SIGINT/SIGTERM) TIDAK di sini.
// Signal handler ada di `index.ts` karena hanya di sana tahu
// kapan HTTP server siap dimatikan (urutan: stop HTTP → disconnect DB).

export default prisma;