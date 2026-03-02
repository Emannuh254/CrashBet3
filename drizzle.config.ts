import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required in .env");
}

export default defineConfig({
  schema: "./shared/schema.ts", // your SQLite schema
  out: "./migrations", // folder to save migrations
  dialect: "sqlite", // ✅ must be sqlite
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
