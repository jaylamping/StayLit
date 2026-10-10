'use strict';

console.log = (...args) => {
  console.error(...args);
};

const readline = require('readline');
const { createHost, runStartupLogin } = require('./host');

function writeLine(line) {
  return new Promise((resolve) => {
    process.stdout.write(`${line}\n`, () => resolve());
  });
}

async function main() {
  const host = createHost({
    dataDir: process.env.STAYLIT_DATA_DIR || null
  });
  let chain = Promise.resolve();
  const enqueue = (line) => {
    chain = chain.then(() => writeLine(line)).catch((err) => {
      console.error(err);
    });
  };

  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity
  });
  rl.on('line', (line) => {
    if (!line.trim()) {
      return;
    }
    host.handleLine(line).then((out) => {
      if (out) {
        enqueue(out);
      }
    }).catch((err) => {
      enqueue(JSON.stringify({
        ok: false,
        error: { code: 'internal', message: err.message }
      }));
    });
  });
  rl.on('close', () => {
    host.shutdown();
    if (host.player && typeof host.player.destroy === 'function') {
      host.player.destroy();
    }
    process.exit(0);
  });

  enqueue(JSON.stringify({ event: 'ready' }));
  runStartupLogin(host).catch((err) => {
    console.error(err);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
