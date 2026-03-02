import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@shared/schema";

// This creates (or opens) db.sqlite in project root
const sqlite = new Database("db.sqlite");

export const db = drizzle(sqlite, { schema });
