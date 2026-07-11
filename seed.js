import { drizzle } from 'drizzle-orm/node-postgres';
import pkg from 'pg';
const { Pool } = pkg;
import * as schema from './packages/database/src/schema.js';
import * as dotenv from 'dotenv';
import crypto from 'crypto';

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
    
    // Create tenant
    const t = await db.insert(schema.tenants).values({
      name: 'Seed Company',
      adminUid: adminUid,
    }).returning();
    
    // Create admin user
    await db.insert(schema.users).values({
      uid: adminUid,
      email: 'admin@company.com',
      password: 'password123',
      name: 'Admin User',
      role: 'admin',
      tenantId: t[0].id
    });
    
    console.log("Seeded admin successfully! Email: admin@company.com, Password: password123");
  } catch (err) {
    console.error("Failed to seed database:", err);
  } finally {
    process.exit(0);
  }
}

seed();
