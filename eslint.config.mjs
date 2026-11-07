import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/*
  Architecture rules, enforced so they cannot erode:

  1. Layers: client, server and shared never import across each other
     (client <-> server). Shared imports neither.
  2. Vendor isolation (ports and adapters): a vendor's library may be imported
     only by the one folder that owns it. Everything else talks to our own
     interfaces in src/server/ports, wired up in src/server/services.ts.

       @aws-sdk/*, nodemailer,
       @supabase/*              only in src/server/adapters
       drizzle-orm, postgres    only in src/server/db

  Switching a vendor then means editing one adapter, not hunting through the app.
*/

const clientImport = {
  group: ["@/client/*", "**/client/*"],
  message: "Server code must not import client code. Put shared logic in src/shared.",
};
const serverImport = {
  group: ["@/server/*", "**/server/*", "server-only"],
  message: "Client code must not import server code. Call a server action or API route instead.",
};
const storageAndEmailSdks = {
  group: ["@aws-sdk/*", "nodemailer", "@supabase/*"],
  message: "Vendor SDK. Use the port in src/server/ports via src/server/services. Only src/server/adapters may import it.",
};
const databaseSdks = {
  group: ["drizzle-orm", "drizzle-orm/*", "postgres"],
  message: "Database vendor code lives in src/server/db only. Add a function there and import that instead.",
};

const restrict = (...patterns) => ({
  "no-restricted-imports": ["error", { patterns }],
});

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  { files: ["src/app/**/*.{ts,tsx}"], rules: restrict(storageAndEmailSdks, databaseSdks) },
  {
    files: ["src/client/**/*.{ts,tsx}"],
    rules: restrict(serverImport, storageAndEmailSdks, databaseSdks),
  },
  {
    files: ["src/server/**/*.{ts,tsx}"],
    rules: restrict(clientImport, storageAndEmailSdks, databaseSdks),
  },
  // Each vendor folder may import its own vendor libraries, and only those.
  { files: ["src/server/adapters/**/*.{ts,tsx}"], rules: restrict(clientImport, databaseSdks) },
  { files: ["src/server/db/**/*.{ts,tsx}"], rules: restrict(clientImport, storageAndEmailSdks) },
  {
    files: ["src/shared/**/*.{ts,tsx}"],
    rules: restrict(
      { ...clientImport, message: "Shared code must not depend on client or server code." },
      { ...serverImport, message: "Shared code must not depend on client or server code." },
      storageAndEmailSdks,
      databaseSdks,
    ),
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
