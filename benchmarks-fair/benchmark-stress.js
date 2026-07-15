/**
 * Tlevor STRESS Benchmark Suite — extreme load test
 *
 * Differences from benchmark.js (fair):
 * - 3 repetitions per scenario
 * - High concurrency (1000 / 2000 / 5000 connections)
 * - Longer sustained duration (20s) to measure steady-state throughput
 * - Pipelining stress (50x) for max-throughput ceiling
 * - Identical handler logic, minimal config, randomized order, warmup discarded
 */

const { spawn, execSync } = require('child_process');
const autocannon = require('autocannon');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ─── Configuration ───────────────────────────────────────────────────────────

const REPETITIONS    = 3;
const WARMUP_SECONDS = 5;
const BASE_PORT      = 7000;
const FRAMEWORKS     = [
  { name: 'Tlevor',  file: 'tlevor.js',  port: BASE_PORT + 0 },
  { name: 'Express', file: 'express.js', port: BASE_PORT + 1 },
  { name: 'Fastify', file: 'fastify.js', port: BASE_PORT + 2 },
  { name: 'Koa',     file: 'koa.js',     port: BASE_PORT + 3 },
  { name: 'Hono',    file: 'hono.js',    port: BASE_PORT + 4 },
];

// Extreme load scenarios — high concurrency, sustained duration
const SCENARIOS = [
  { name: 'GET JSON — 1000c x20s',        connections: 1000, duration: 20, pipelining: 1,  url: '/json',      method: 'GET'  },
  { name: 'GET JSON — 2000c x20s',        connections: 2000, duration: 20, pipelining: 1,  url: '/json',      method: 'GET'  },
  { name: 'GET JSON — 5000c x20s (max)',  connections: 5000, duration: 20, pipelining: 1,  url: '/json',      method: 'GET'  },
  { name: 'GET Route Params — 1000c',     connections: 1000, duration: 20, pipelining: 1,  url: '/user/42',   method: 'GET'  },
  { name: 'POST Echo — 1000c',            connections: 1000, duration: 20, pipelining: 1,  url: '/json',      method: 'POST', body: '{"name":"bench","value":42}' },
  { name: 'Pipeline 50x — 100c (ceiling)', connections: 100, duration: 20, pipelining: 50, url: '/json',      method: 'GET'  },
  { name: 'GET Text — 2000c',             connections: 2000, duration: 20, pipelining: 1,  url: '/text',      method: 'GET'  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function mean(arr) { return arr.reduce((s, v) => s + v, 0) / arr.length; }

function stdDev(arr) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

function waitForPortFree(port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const net = require('net');
      const s = new net.Socket();
      s.once('error', () => { s.destroy(); resolve(); });
      s.once('connect', () => { s.destroy(); if (Date.now() - start < timeoutMs) setTimeout(check, 200); else resolve(); });
      s.connect(port, '127.0.0.1');
    };
    check();
  });
}

function waitForPort(port, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const net = require('net');
      const s = new net.Socket();
      s.once('error', () => { s.destroy(); if (Date.now() - start < timeoutMs) setTimeout(check, 200); else reject(new Error('timeout')); });
      s.once('connect', () => { s.destroy(); resolve(); });
      s.connect(port, '127.0.0.1');
    };
    check();
  });
}

// ─── Server lifecycle ────────────────────────────────────────────────────────

function startServer(serverFile, port) {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(__dirname, 'servers', serverFile);
    const child = spawn('node', [serverPath], {
      env: { ...process.env, PORT: String(port) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) { child.kill('SIGKILL'); reject(new Error(`${serverFile} failed to start on ${port}`)); }
    }, 10000);

    child.stdout.on('data', (data) => {
      const output = data.toString();
      if ((output.includes(`on ${port}`) || output.includes(`:${port}`)) && !started) {
        started = true;
        clearTimeout(timeout);
        resolve(child);
      }
    });

    child.stderr.on('data', () => {});
    child.on('error', reject);
  });
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.killed) { resolve(); return; }
    child.on('close', resolve);
    child.kill('SIGTERM');
    setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve(); }, 3000);
  });
}

// ─── Resource monitor ────────────────────────────────────────────────────────

function getProcessStats(pid) {
  try {
    const out = execSync(`ps -p ${pid} -o %cpu,%mem,rss --no-headers 2>/dev/null`, { encoding: 'utf-8' }).trim();
    if (!out) return null;
    const parts = out.split(/\s+/);
    return { cpu: parseFloat(parts[0]) || 0, memPct: parseFloat(parts[1]) || 0, rssKB: parseInt(parts[2]) || 0 };
  } catch { return null; }
}

function monitorProcess(pid, intervalMs = 100) {
  const samples = [];
  const timer = setInterval(() => {
    const stats = getProcessStats(pid);
    if (stats) samples.push(stats);
  }, intervalMs);
  return { stop: () => { clearInterval(timer); return samples; } };
}

// ─── Benchmark runner ────────────────────────────────────────────────────────

function runAutocannon(port, scenario) {
  const url = `http://127.0.0.1:${port}${scenario.url}`;
  const opts = {
    url,
    connections: scenario.connections,
    duration: scenario.duration,
    pipelining: scenario.pipelining,
    method: scenario.method,
    headers: { 'content-type': 'application/json' },
  };
  if (scenario.body) opts.body = scenario.body;

  return new Promise((resolve, reject) => {
    autocannon(opts, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

function extractMetrics(result) {
  return {
    rps: result.requests.average,
    rpsMax: result.requests.max,
    latAvg: result.latency.average,
    latP50: result.latency.p50,
    latP95: result.latency.p95,
    latP99: result.latency.p99,
    latMax: result.latency.max,
    tpMBs: +(result.throughput.average / 1024 / 1024).toFixed(2),
    totalRequests: result.requests.total,
    errors: result.errors.timeout + result.errors.connection,
  };
}

// ─── Environment info ────────────────────────────────────────────────────────

function collectEnvironment() {
  const cpus = os.cpus();
  return {
    platform: os.platform(),
    arch: os.arch(),
    os: execSync('cat /etc/os-release 2>/dev/null | head -2 || uname -sr', { encoding: 'utf-8' }).trim(),
    cpuModel: cpus[0]?.model || 'unknown',
    cpuCores: cpus.length,
    totalMemGB: +(os.totalmem() / 1024 / 1024 / 1024).toFixed(1),
    freeMemGB: +(os.freemem() / 1024 / 1024 / 1024).toFixed(1),
    nodeVersion: process.version,
    timestamp: new Date().toISOString(),
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const env = collectEnvironment();
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║          TLEVOR STRESS BENCHMARK — extreme load (3 reps)     ║');
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log(`║  Node: ${env.nodeVersion.padEnd(12)} OS: ${env.os.slice(0, 38).padEnd(38)} ║`);
  console.log(`║  CPU: ${env.cpuModel.slice(0, 52).padEnd(52)} ║`);
  console.log(`║  RAM: ${env.totalMemGB}GB total, Cores: ${env.cpuCores}`.padEnd(63) + '║');
  console.log(`║  Repetitions: ${REPETITIONS} per scenario, Warmup: ${WARMUP_SECONDS}s (discarded)`.padEnd(63) + '║');
  console.log(`║  Concurrency: up to 5000 connections, 20s sustained`.padEnd(63) + '║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');

  const results = {};
  const resourceData = {};
  const errors = [];

  for (const fw of FRAMEWORKS) {
    results[fw.name] = {};
    resourceData[fw.name] = {};
  }

  for (let round = 1; round <= REPETITIONS; round++) {
    const order = shuffle(FRAMEWORKS);
    console.log(`\n━━━ Round ${round}/${REPETITIONS}  Order: ${order.map(f => f.name).join(' → ')} ━━━`);

    for (const fw of order) {
      console.log(`\n  ┌─ ${fw.name} (round ${round})`);

      let server;
      try {
        await waitForPortFree(fw.port);
        server = await startServer(fw.file, fw.port);
        await waitForPort(fw.port);

        const pid = server.pid;
        console.log(`  │ ✅ PID ${pid} on port ${fw.port}`);

        // Warmup — discard results
        console.log(`  │ 🔥 Warmup (${WARMUP_SECONDS}s)...`);
        await runAutocannon(fw.port, { connections: 200, duration: WARMUP_SECONDS, pipelining: 1, url: '/json', method: 'GET' });

        // Run each scenario
        for (const scenario of SCENARIOS) {
          if (!results[fw.name][scenario.name]) results[fw.name][scenario.name] = [];
          if (!resourceData[fw.name][scenario.name]) resourceData[fw.name][scenario.name] = { cpu: [], mem: [] };

          process.stdout.write(`  │   ${scenario.name.padEnd(38)} `);

          const monitor = monitorProcess(pid, 100);
          await new Promise(r => setTimeout(r, 200));

          try {
            const result = await runAutocannon(fw.port, scenario);
            const metrics = extractMetrics(result);
            results[fw.name][scenario.name].push(metrics);

            const samples = monitor.stop();
            if (samples.length > 0) {
              resourceData[fw.name][scenario.name].cpu.push(mean(samples.map(s => s.cpu)));
              resourceData[fw.name][scenario.name].mem.push(mean(samples.map(s => s.memPct)));
            } else { monitor.stop(); }

            const errStr = metrics.errors > 0 ? `  ⚠ errors:${metrics.errors}` : '';
            process.stdout.write(`${String(Math.round(metrics.rps)).padStart(8)} req/s  p99: ${String(Math.round(metrics.latP99)).padStart(5)}ms${errStr}\n`);
          } catch (err) {
            monitor.stop();
            process.stdout.write(`ERROR: ${err.message}\n`);
            errors.push({ framework: fw.name, scenario: scenario.name, round, error: err.message });
          }
        }
      } catch (err) {
        console.log(`  │ ❌ Failed to start: ${err.message}`);
        errors.push({ framework: fw.name, scenario: 'STARTUP', round, error: err.message });
      } finally {
        if (server) await stopServer(server);
        await waitForPortFree(fw.port);
        await new Promise(r => setTimeout(r, 500));
      }
      console.log(`  └────────────────────────`);
    }
  }

  // ─── Generate report ─────────────────────────────────────────────────────

  const report = { environment: env, methodology: { repetitions: REPETITIONS, warmupSeconds: WARMUP_SECONDS, scenarios: SCENARIOS.length, frameworks: FRAMEWORKS.map(f => f.name), mode: 'STRESS' }, raw: {}, summary: {}, errors };

  for (const fw of FRAMEWORKS) {
    report.raw[fw.name] = {};
    for (const scenario of SCENARIOS) {
      const runs = results[fw.name][scenario.name] || [];
      report.raw[fw.name][scenario.name] = {
        rps: runs.map(r => r.rps),
        latP99: runs.map(r => r.latP99),
        latP95: runs.map(r => r.latP95),
        latAvg: runs.map(r => r.latAvg),
        errors: runs.map(r => r.errors),
        tpMBs: runs.map(r => r.tpMBs),
      };
    }
  }

  for (const fw of FRAMEWORKS) {
    report.summary[fw.name] = {};
    for (const scenario of SCENARIOS) {
      const runs = results[fw.name][scenario.name] || [];
      if (runs.length === 0) { report.summary[fw.name][scenario.name] = { rps: 'N/A', latP99: 'N/A' }; continue; }
      const rpsValues = runs.map(r => r.rps);
      const latValues = runs.map(r => r.latP99);
      const cpuValues = resourceData[fw.name][scenario.name]?.cpu || [];
      const memValues = resourceData[fw.name][scenario.name]?.mem || [];
      report.summary[fw.name][scenario.name] = {
        rps: { mean: +mean(rpsValues).toFixed(1), std: +stdDev(rpsValues).toFixed(1), min: +Math.min(...rpsValues).toFixed(1), max: +Math.max(...rpsValues).toFixed(1) },
        latP99: { mean: +mean(latValues).toFixed(1), std: +stdDev(latValues).toFixed(1), min: +Math.min(...latValues).toFixed(1), max: +Math.max(...latValues).toFixed(1) },
        serverCPU: cpuValues.length > 0 ? { mean: +mean(cpuValues).toFixed(1), std: +stdDev(cpuValues).toFixed(1) } : null,
        serverMemPct: memValues.length > 0 ? { mean: +mean(memValues).toFixed(1), std: +stdDev(memValues).toFixed(1) } : null,
        runs: runs.length,
      };
    }
  }

  // ─── Console table ───────────────────────────────────────────────────────

  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                                          STRESS THROUGHPUT (req/sec)  mean ± stdDev                                        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝');

  for (const scenario of SCENARIOS) {
    console.log(`\n  ${scenario.name}`);
    console.log(`  ${'─'.repeat(100)}`);

    const data = FRAMEWORKS.map(fw => {
      const s = report.summary[fw.name]?.[scenario.name];
      return { name: fw.name, mean: s?.rps?.mean || 0, std: s?.rps?.std || 0, min: s?.rps?.min || 0, max: s?.rps?.max || 0 };
    }).sort((a, b) => b.mean - a.mean);

    for (const d of data) {
      const barLen = data[0].mean > 0 ? Math.round((d.mean / data[0].mean) * 30) : 0;
      const bar = '█'.repeat(barLen);
      console.log(`    ${d.name.padEnd(10)} ${String(Math.round(d.mean)).padStart(8)} ± ${String(Math.round(d.std)).padStart(5)}  [${String(Math.round(d.min)).padStart(8)} – ${String(Math.round(d.max)).padStart(8)}]  ${bar}`);
    }
  }

  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                                          STRESS LATENCY p99 (ms)  mean ± stdDev  (lower is better)                           ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝');

  for (const scenario of SCENARIOS) {
    console.log(`\n  ${scenario.name}`);
    console.log(`  ${'─'.repeat(100)}`);

    const data = FRAMEWORKS.map(fw => {
      const s = report.summary[fw.name]?.[scenario.name];
      return { name: fw.name, mean: s?.latP99?.mean || 0, std: s?.latP99?.std || 0 };
    }).sort((a, b) => a.mean - b.mean);

    for (const d of data) {
      console.log(`    ${d.name.padEnd(10)} ${String(d.mean.toFixed(1)).padStart(8)} ± ${String(d.std.toFixed(1)).padStart(6)} ms`);
    }
  }

  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                                          STRESS SERVER RESOURCE USAGE (mean)                                                ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝');

  for (const scenario of SCENARIOS) {
    console.log(`\n  ${scenario.name}`);
    console.log(`  ${'─'.repeat(100)}`);
    console.log(`    ${'Framework'.padEnd(10)} ${'CPU %'.padStart(8)}  ${'RAM %'.padStart(8)}`);
    console.log(`    ${'─'.repeat(30)}`);
    for (const fw of FRAMEWORKS) {
      const s = report.summary[fw.name]?.[scenario.name];
      const cpu = s?.serverCPU?.mean != null ? `${s.serverCPU.mean.toFixed(1)} ± ${s.serverCPU.std.toFixed(1)}` : 'N/A';
      const mem = s?.serverMemPct?.mean != null ? `${s.serverMemPct.mean.toFixed(1)} ± ${s.serverMemPct.std.toFixed(1)}` : 'N/A';
      console.log(`    ${fw.name.padEnd(10)} ${cpu.padStart(16)}  ${mem.padStart(16)}`);
    }
  }

  if (errors.length > 0) {
    console.log('\n\n  ERRORS:');
    for (const e of errors) console.log(`    [${e.framework}] round ${e.round} ${e.scenario}: ${e.error}`);
  }

  // ─── Save report ─────────────────────────────────────────────────────────

  const reportPath = path.join(__dirname, 'report-stress.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n  Report saved to ${reportPath}`);
}

main().catch(console.error);
