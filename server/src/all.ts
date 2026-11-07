import { spawn } from 'node:child_process';

const children = [
  spawn(process.execPath, ['--max-old-space-size=220', 'dist/server.js'], {
    stdio: 'inherit',
    env: process.env,
  }),
  spawn(process.execPath, ['--max-old-space-size=220', 'dist/worker.js'], {
    stdio: 'inherit',
    env: process.env,
  }),
];

let shuttingDown = false;
let remaining = children.length;
let exitCode = 0;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }

  const forceExit = setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  }, 12_000);
  forceExit.unref();
}

for (const child of children) {
  child.on('error', (error) => {
    console.error('Failed to start API/worker process:', error);
    exitCode = 1;
    shutdown('SIGTERM');
  });
  child.on('exit', (code) => {
    remaining -= 1;
    if (code && code !== 0) exitCode = code;
    if (!shuttingDown) shutdown('SIGTERM');
    if (remaining === 0) process.exitCode = exitCode;
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
