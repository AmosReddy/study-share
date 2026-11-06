import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  // Only manage our own tables. Supabase owns the auth and storage schemas.
  schemaFilter: ["public"],
  dbCredentials: {
    // Migrations use the direct connection, not the pooled one.
    url: process.env.DATABASE_MIGRATION_URL ?? "",
  },
});
