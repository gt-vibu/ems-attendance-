import { drizzle } from 'drizzle-orm/node-postgres';
import pkg from 'pg';
const { Pool } = pkg;
import * as schema from './packages/database/src/schema.ts';
import * as dotenv from 'dotenv';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

dotenv.config(); 

const pool = new Pool({
  host: process.env.SQL_HOST || '127.0.0.1',
  user: process.env.SQL_ADMIN_USER || 'postgres',
  password: process.env.SQL_ADMIN_PASSWORD || 'password',
  database: process.env.SQL_DB_NAME || 'postgres',
});

const db = drizzle(pool, { schema });

async function seed() {
  try {
    const adminUid = crypto.randomUUID();
    const adminEmail = process.env.SEED_SUPER_ADMIN_EMAIL || 'admin@company.com';
    const adminPasswordPlain = process.env.SEED_SUPER_ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');

    // Create tenant
    const t = await db.insert(schema.tenants).values({
      name: 'Seed Company',
      adminUid: adminUid,
    }).returning();
    
    // Create admin user — password is bcrypt-hashed, never stored in plaintext.
    await db.insert(schema.users).values({
      uid: adminUid,
      email: adminEmail,
      password: await bcrypt.hash(adminPasswordPlain, 12),
      name: 'Admin User',
      role: 'admin',
      mustChangePassword: true,
      tenantId: t[0].id
    });

    console.log(`Seeded admin successfully! Email: ${adminEmail}, Password: ${adminPasswordPlain}`);
    console.log('(This password is shown once and must be changed on first login.)');
  } catch (err) {
    console.error("Failed to seed database:", err);
  } finally {
    process.exit(0);
  }
}

seed();
