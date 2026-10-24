#!/usr/bin/env node
// Test double for uv: appends each call's arguments and tool folders to FAKE_UV_LOG and reports success.
import fs from 'node:fs';

if (process.env.FAKE_UV_LOG) {
  const call = { args: process.argv.slice(2), toolDir: process.env.UV_TOOL_DIR, binDir: process.env.UV_TOOL_BIN_DIR };
  fs.appendFileSync(process.env.FAKE_UV_LOG, `${JSON.stringify(call)}\n`);
}
process.stdout.write('Installed 1 executable: graphify\n');
