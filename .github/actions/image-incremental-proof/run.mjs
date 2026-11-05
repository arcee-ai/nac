import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The runner supplies the existing Actions cache runtime environment to a
// JavaScript action. Never expose token values through outputs or command args.
// Python passes those keys only to the exact cache-reading Docker build child.
const script = fileURLToPath(new URL('../../scripts/image-incremental-proof.py', import.meta.url));
const child = spawn('python3', [script], { stdio: 'inherit', env: process.env });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal);
    // The controller normally kills/reaps its invocation-owned CLI group first.
    const timer = setTimeout(() => child.kill('SIGKILL'), 150_000);
    timer.unref();
  });
}
child.on('error', () => { process.exitCode = 1; });
child.on('close', code => { process.exitCode = code ?? 1; });
