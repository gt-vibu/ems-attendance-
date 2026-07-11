import { sql } from 'drizzle-orm';
import { pgTable, text, integer, timestamp } from 'drizzle-orm/pg-core';

const users = pgTable('users', {
  createdAt: timestamp('created_at'),
});

const clause = sql`created_at >= ${new Date()}`;
const chunks = (clause as any).queryChunks || [];
console.log('Number of chunks in SQL template:', chunks.length);
for (let i = 0; i < chunks.length; i++) {
  const chunk = chunks[i];
  console.log(`Chunk ${i}:`, {
    type: chunk?.constructor?.name,
    keys: Object.keys(chunk || {}),
    value: chunk?.value,
  });
}
