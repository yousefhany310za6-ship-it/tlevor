const autocannon = require('autocannon');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const FRAMEWORKS = [
  { name: 'Tlevor', file: 'tlevor.js', port: 7000 },
  { name: 'Express', file: 'express.js', port: 7001 },
  { name: 'Fastify', file: 'fastify.js', port: 7002 },
  { name: 'Koa', file: 'koa.js', port: 7003 },
  { name: 'Hono', file: 'hono.js', port: 7004 },
];

const SCENARIOS = [
  { name: 'JSON 10c', connections: 10, duration: 5, pipelining: 1, url: '/json', method: 'GET' },
  { name: 'JSON 50c', connections: 50, duration: 10, pipelining: 1, url: '/json', method: 'GET' },
  { name: 'JSON 100c', connections: 100, duration: 10, pipelining: 1, url: '/json', method: 'GET' },
  { name: 'JSON 200c', connections: 200, duration: 10, pipelining: 1, url: '/json', method: 'GET' },
  { name: 'JSON 500c', connections: 500, duration: 10, pipelining: 1, url: '/json', method: 'GET' },
  { name: 'Route Params 100c', connections: 100, duration: 10, pipelining: 1, url: '/user/42', method: 'GET' },
  { name: 'Text 100c', connections: 100, duration: 10, pipelining: 1, url: '/text', method: 'GET' },
  { name: 'POST JSON 100c', connections: 100, duration: 10, pipelining: 1, url: '/json', method: 'POST', body: JSON.stringify({ name: 'test', value: 123 }) },
  { name: 'Headers 100c', connections: 100, duration: 10, pipelining: 1, url: '/headers', method: 'GET' },
  { name: 'Pipeline 10x10', connections: 10, duration: 10, pipelining: 10, url: '/json', method: 'GET' },
  { name: 'Pipeline 50x10', connections: 50, duration: 10, pipelining: 10, url: '/json', method: 'GET' },
  { name: 'Latency 1c', connections: 1, duration: 5, pipelining: 1, url: '/json', method: 'GET' },
];

function startServer(serverFile, port) {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(__dirname, 'servers', serverFile);
    const child = spawn('node', [serverPath], {
      env: { ...process.env, PORT: String(port) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) {
        child.kill('SIGKILL');
        reject(new Error(`${serverFile} failed to start on port ${port}`));
      }
    }, 10000);

    child.stdout.on('data', (data) => {
      const output = data.toString();
      if ((output.includes(`on ${port}`) || output.includes(`:${port}`)) && !started) {
        started = true;
        clearTimeout(timeout);
        resolve(child);
      }
    });

    child.stderr.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('Error') && !msg.includes('EPIPE')) {
        console.error(`  [${serverFile}] ${msg.trim()}`);
      }
    });

    child.on('error', reject);
  });
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.killed) { resolve(); return; }
    child.on('close', resolve);
    child.kill('SIGTERM');
    setTimeout(() => { try { child.kill('SIGKILL'); } catch(e) {} resolve(); }, 3000);
  });
}

function waitForPort(port) {
  return new Promise((resolve) => {
    const check = () => {
      const net = require('net');
      const s = new net.Socket();
      s.once('error', () => { s.destroy(); setTimeout(check, 200); });
      s.once('connect', () => { s.destroy(); resolve(); });
      s.connect(port, '127.0.0.1');
    };
    check();
  });
}

function waitForPortFree(port) {
  return new Promise((resolve) => {
    const check = () => {
      const net = require('net');
      const s = new net.Socket();
      s.once('error', () => { s.destroy(); resolve(); });
      s.once('connect', () => { s.destroy(); setTimeout(check, 200); });
      s.connect(port, '127.0.0.1');
    };
    check();
  });
}

function runBenchmark(port, scenario) {
  const url = `http://127.0.0.1:${port}${scenario.url || '/json'}`;
  const opts = {
    url,
    connections: scenario.connections,
    duration: scenario.duration,
    pipelining: scenario.pipelining,
    method: scenario.method || 'GET',
    headers: { 'content-type': 'application/json' },
  };
  if (scenario.body) opts.body = scenario.body;

  return new Promise((resolve, reject) => {
    const instance = autocannon(opts, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

function extract(result) {
  return {
    rps: result.requests.average,
    rpsMax: result.requests.max,
    latAvg: result.latency.average,
    latP50: result.latency.p50,
    latP95: result.latency.p95,
    latP99: result.latency.p99,
    latMax: result.latency.max,
    tpMBs: +(result.throughput.average / 1024 / 1024).toFixed(2),
    total: result.requests.total,
    errors: result.errors.timeout + result.errors.connection,
  };
}

function bar(val, max, width = 30) {
  const len = max > 0 ? Math.round((val / max) * width) : 0;
  return '█'.repeat(Math.max(0, Math.min(width, len)));
}

async function main() {
  const startTime = Date.now();
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║        TLEVOR vs TOP FRAMEWORKS - BENCHMARK SUITE           ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Frameworks: ${FRAMEWORKS.map(f => f.name).join(', ').padEnd(46)}║`);
  console.log(`║  Scenarios:  ${SCENARIOS.length} tests across ${FRAMEWORKS.length} frameworks`.padEnd(63) + '║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  const allResults = {};
  const summary = {};

  for (const framework of FRAMEWORKS) {
    console.log(`\n┌─ ${framework.name} ─────────────────────────────────────────`);

    let server;
    try {
      await waitForPortFree(framework.port);
      server = await startServer(framework.file, framework.port);
      await waitForPort(framework.port);
      console.log(`│ ✅ Started on port ${framework.port}`);

      console.log(`│ 🔥 Warmup...`);
      await runBenchmark(framework.port, { connections: 10, duration: 2, pipelining: 1, url: '/json', method: 'GET' });

      allResults[framework.name] = {};

      for (const scenario of SCENARIOS) {
        process.stdout.write(`│   ${scenario.name.padEnd(22)} `);
        try {
          const result = await runBenchmark(framework.port, scenario);
          const data = extract(result);
          allResults[framework.name][scenario.name] = data;
          console.log(`${String(data.rps).padStart(8)} req/s  │  ${String(data.latP99).padStart(6)} p99  │  ${String(data.errors).padStart(3)} err`);
        } catch (err) {
          console.log(`FAILED`.padStart(8) + `         │         │   ${err.message}`);
          allResults[framework.name][scenario.name] = { error: err.message };
        }
      }
    } catch (err) {
      console.log(`│ ❌ Failed to start: ${err.message}`);
    } finally {
      if (server) await stopServer(server);
      await waitForPortFree(framework.port);
      await new Promise(r => setTimeout(r, 500));
    }
    console.log(`└────────────────────────────────────────────────────────────`);
  }

  // ── Summary Table ──
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                                 FINAL RESULTS (req/sec)                                                ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════════════════════╝');

  for (const scenario of SCENARIOS) {
    const results = {};
    for (const fw of FRAMEWORKS) {
      const data = allResults[fw.name]?.[scenario.name];
      results[fw.name] = data?.rps || 0;
    }
    const max = Math.max(...Object.values(results));

    console.log(`\n  ${scenario.name}`);
    console.log(`  ${'─'.repeat(90)}`);
    for (const fw of FRAMEWORKS) {
      const val = results[fw.name];
      const isMax = val === max && val > 0;
      console.log(`    ${fw.name.padEnd(10)} ${String(val).padStart(8)} req/s  ${bar(val, max)}${isMax ? ' ◄ BEST' : ''}`);
    }
  }

  // ── Latency Table ──
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                                 LATENCY p99 (ms - lower is better)                                    ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════════════════════╝');

  for (const scenario of SCENARIOS) {
    const results = {};
    for (const fw of FRAMEWORKS) {
      const data = allResults[fw.name]?.[scenario.name];
      results[fw.name] = data?.latP99 || 0;
    }
    const min = Math.min(...Object.values(results).filter(v => v > 0));
    const max = Math.max(...Object.values(results));

    console.log(`\n  ${scenario.name}`);
    console.log(`  ${'─'.repeat(90)}`);
    for (const fw of FRAMEWORKS) {
      const val = results[fw.name];
      const isMin = val === min && val > 0;
      console.log(`    ${fw.name.padEnd(10)} ${String(val).padStart(8)} ms   ${bar(max - val, max)}${isMin ? ' ◄ BEST' : ''}`);
    }
  }

  // ── Overall Score ──
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                                 OVERALL SCORE (wins across scenarios)                                   ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════════════════════╝');

  const wins = {};
  for (const fw of FRAMEWORKS) wins[fw.name] = { rps: 0, latency: 0 };

  for (const scenario of SCENARIOS) {
    let bestRps = 0, bestRpsFw = '';
    let bestLat = Infinity, bestLatFw = '';
    for (const fw of FRAMEWORKS) {
      const data = allResults[fw.name]?.[scenario.name];
      if (data?.rps > bestRps) { bestRps = data.rps; bestRpsFw = fw.name; }
      if (data?.latP99 > 0 && data.latP99 < bestLat) { bestLat = data.latP99; bestLatFw = fw.name; }
    }
    if (bestRpsFw) wins[bestRpsFw].rps++;
    if (bestLatFw) wins[bestLatFw].latency++;
  }

  console.log('');
  for (const fw of FRAMEWORKS) {
    const w = wins[fw.name];
    const total = w.rps + w.latency;
    console.log(`    ${fw.name.padEnd(10)} Speed wins: ${String(w.rps).padStart(2)}  │  Latency wins: ${String(w.latency).padStart(2)}  │  Total: ${String(total).padStart(2)}`);
  }

  // ── Errors ──
  let totalErrors = 0;
  for (const fw of FRAMEWORKS) {
    for (const scenario of SCENARIOS) {
      const data = allResults[fw.name]?.[scenario.name];
      if (data?.errors) totalErrors += data.errors;
    }
  }

  console.log(`\n  Total errors across all tests: ${totalErrors}`);

  // ── Save ──
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n  Benchmark completed in ${elapsed}s`);

  fs.writeFileSync(path.join(__dirname, 'results-full.json'), JSON.stringify(allResults, null, 2));
  console.log(`  Results saved to results-full.json\n`);
}

main().catch(console.error);
