const autocannon = require('autocannon');
const { spawn } = require('child_process');
const path = require('path');

const FRAMEWORKS = [
  { name: 'Tlevor', file: 'tlevor.js', port: 7000 },
  { name: 'Express', file: 'express.js', port: 7001 },
  { name: 'Fastify', file: 'fastify.js', port: 7002 },
  { name: 'Koa', file: 'koa.js', port: 7003 },
];

const SCENARIOS = [
  // Low load
  { name: 'Low Load (10c, 5s)', connections: 10, duration: 5, pipelining: 1 },
  // Medium load
  { name: 'Medium Load (50c, 10s)', connections: 50, duration: 10, pipelining: 1 },
  // High load
  { name: 'High Load (100c, 10s)', connections: 100, duration: 10, pipelining: 1 },
  // Extreme load
  { name: 'Extreme Load (200c, 10s)', connections: 200, duration: 10, pipelining: 1 },
  // Pipelining (HTTP pipelining)
  { name: 'Pipelining (10c, 10pipe, 10s)', connections: 10, duration: 10, pipelining: 10 },
  // JSON response
  { name: 'JSON Response (100c, 10s)', connections: 100, duration: 10, pipelining: 1, url: '/json' },
  // Route params
  { name: 'Route Params (100c, 10s)', connections: 100, duration: 10, pipelining: 1, url: '/user/123' },
  // Text response
  { name: 'Text Response (100c, 10s)', connections: 100, duration: 10, pipelining: 1, url: '/text' },
];

function startServer(serverFile, port) {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(__dirname, 'servers', serverFile);
    const child = spawn('node', [serverPath], {
      env: { ...process.env, PORT: port },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) reject(new Error(`Server ${serverFile} failed to start on port ${port}`));
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
      if (data.toString().includes('Error')) {
        console.error(`[${serverFile}] Error:`, data.toString());
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
    setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); resolve(); }, 3000);
  });
}

function runBenchmark(port, scenario) {
  const url = `http://127.0.0.1:${port}${scenario.url || '/json'}`;
  return new Promise((resolve, reject) => {
    const instance = autocannon({
      url,
      connections: scenario.connections,
      duration: scenario.duration,
      pipelining: scenario.pipelining,
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    }, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

function formatResults(results) {
  return {
    'req/sec (avg)': results.requests.average,
    'req/sec (max)': results.requests.max,
    'latency avg (ms)': results.latency.average,
    'latency p50 (ms)': results.latency.p50,
    'latency p95 (ms)': results.latency.p95,
    'latency p99 (ms)': results.latency.p99,
    'throughput (MB/s)': (results.throughput.average / 1024 / 1024).toFixed(2),
    'total requests': results.requests.total,
    'errors': results.errors.timeout + results.errors.connection,
  };
}

function printComparison(results) {
  console.log('\n' + '='.repeat(120));
  console.log('FRAMEWORK COMPARISON RESULTS');
  console.log('='.repeat(120));

  for (const scenario of SCENARIOS) {
    console.log(`\n${'─'.repeat(120)}`);
    console.log(`📊 ${scenario.name}`);
    console.log(`${'─'.repeat(120)}`);

    const header = ['Metric', ...FRAMEWORKS.map(f => f.name)];
    const rows = [];

    const metrics = ['req/sec (avg)', 'req/sec (max)', 'latency avg (ms)', 'latency p50 (ms)', 'latency p95 (ms)', 'latency p99 (ms)', 'throughput (MB/s)', 'total requests', 'errors'];

    for (const metric of metrics) {
      const row = [metric];
      const values = [];
      for (const fw of FRAMEWORKS) {
        const fwResults = results[fw.name]?.[scenario.name];
        const value = fwResults ? fwResults[metric] : 'N/A';
        row.push(typeof value === 'number' ? value.toLocaleString() : String(value));
        if (typeof value === 'number') values.push({ name: fw.name, value });
      }
      rows.push(row);
    }

    // Print table
    const colWidths = header.map((h, i) => {
      const maxRow = rows.reduce((max, r) => Math.max(max, String(r[i]).length), h.length);
      return maxRow;
    });

    const headerLine = header.map((h, i) => h.padEnd(colWidths[i] + 2)).join('│ ');
    console.log(headerLine);
    console.log(colWidths.map(w => '─'.repeat(w + 2)).join('┼─'));

    for (const row of rows) {
      const line = row.map((cell, i) => String(cell).padEnd(colWidths[i] + 2)).join('│ ');
      console.log(line);
    }
  }
}

async function main() {
  console.log('🚀 Tlevor Framework Benchmark Suite');
  console.log('━'.repeat(60));
  console.log('Testing: Tlevor vs Express vs Fastify vs Koa');
  console.log('Scenarios: Low, Medium, High, Extreme, Pipelining');
  console.log('━'.repeat(60));

  const allResults = {};

  for (const framework of FRAMEWORKS) {
    console.log(`\n🔧 Starting ${framework.name}...`);
    let server;
    try {
      server = await startServer(framework.file, framework.port);
      console.log(`✅ ${framework.name} started on port ${framework.port}`);

      // Warmup
      console.log(`  Warming up...`);
      await runBenchmark(framework.port, { connections: 10, duration: 2, pipelining: 1, url: '/json' });

      allResults[framework.name] = {};

      for (const scenario of SCENARIOS) {
        process.stdout.write(`  Running: ${scenario.name}... `);
        try {
          const result = await runBenchmark(framework.port, scenario);
          allResults[framework.name][scenario.name] = formatResults(result);
          console.log(`${result.requests.average} req/s`);
        } catch (err) {
          console.log(`FAILED: ${err.message}`);
          allResults[framework.name][scenario.name] = { error: err.message };
        }
      }
    } catch (err) {
      console.error(`❌ Failed to start ${framework.name}: ${err.message}`);
    } finally {
      if (server) await stopServer(server);
      // Wait between servers
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  printComparison(allResults);

  // Save results
  const fs = require('fs');
  const resultsPath = path.join(__dirname, 'results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(allResults, null, 2));
  console.log(`\n📁 Results saved to ${resultsPath}`);
}

main().catch(console.error);
