'use strict';

const readline = require('readline');
const { createHost, runStartupLogin } = require('./host');

function writeLine(line) {
  return new Promise((resolve) => {
    process.stdout.write(`${line}\n`, () => resolve());
  });
}

function main() {
  let host;
  try {
    host = createHost({
      dataDir: process.env.STAYLIT_DATA_DIR || null,
      onFrame: (frame) => {
        void writeLine(JSON.stringify({ event: 'effect.frame', frame }));
      }
    });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
  let chain = Promise.resolve();
  const enqueue = (task) => {
    const run = chain.then(task, task);
    chain = run.then(() => {}, () => {});
    return run;
  };

  enqueue(async () => {
    await writeLine(JSON.stringify({ event: 'ready' }));
    await runStartupLogin(host);
  });

  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity
  });
  rl.on('line', (line) => {
    if (!line.trim()) {
      return;
    }
    enqueue(async () => {
      let out;
      try {
        out = await host.handleLine(line);
      } catch (err) {
        out = JSON.stringify({
          ok: false,
          error: { code: 'internal', message: err.message }
        });
      }
      if (out) {
        await writeLine(out);
      }
    });
  });
  rl.on('close', () => {
    enqueue(async () => {
      host.shutdown();
      if (host.player && typeof host.player.destroy === 'function') {
        host.player.destroy();
      }
      process.exit(0);
    });
  });
}

main();
