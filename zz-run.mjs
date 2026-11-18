import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
const env = { ...process.env };
for (const line of readFileSync("C:/Users/Amos Reddy/project/project/.env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !(m[1] in process.env)) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}
env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", ...process.argv.slice(2)], { env, stdio: "inherit" });
child.on("exit", (c) => process.exit(c ?? 1));
