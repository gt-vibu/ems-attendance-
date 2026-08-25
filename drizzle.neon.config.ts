import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

dotenv.config();

export default defineConfig({
  schema: "./packages/database/src/schema.ts",
  out: "./packages/database/drizzle",
  dialect: "postgresql",
  schemaFilter: ["public"],
  dbCredentials: {
    host: process.env.SQL_HOST!,
    user: process.env.SQL_ADMIN_USER!,
    password: process.env.SQL_ADMIN_PASSWORD!,
    database: process.env.SQL_DB_NAME!,
    port: 5432,
    ssl: true,
  },
  verbose: true,
});
