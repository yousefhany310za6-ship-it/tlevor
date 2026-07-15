const { spawn, execSync } = require('child_process');
const path = require('path');

const FRAMEWORKS = [
  { name: 'Tlevor', file: 'tlevor.js', port: 7000 },
  { name: 'Express', file: 'express.js', port: 7001 },
  { name: 'Fastify', file: 'fastify.js', port: 7002 },
  { name: 'Koa', file: 'koa.js', port: 7003 },
];

function getMemoryUsage(pid) {
  try {
    const fs = require('fs');
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.split(' ');
    // field 24 is rss in pages
    const rssPages = parseInt(fields[23]);
    const pageSize = 4; // 4KB pages on most systems
    return rssPages * pageSize; // in KB
  } catch {
    try {
      const result = execSync(`ps -o rss= -p ${pid} 2>/dev/null`).toString().trim();
      return parseInt(result) || 0;
    } catch { return 0; }
  }
}

function startServer(serverFile, port) {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(__dirname, 'servers', serverFile);
    const child = spawn('node', [serverPath], {
      env: { ...process.env, PORT: port },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) reject(new Error(`Server ${serverFile} failed to start`));
    }, 10000);

    child.stdout.on('data', (data) => {
      if ((data.toString().includes(`on ${port}`) || data.toString().includes(`:${port}`)) && !started) {
        started = true;
        clearTimeout(timeout);
        // Wait for memory to stabilize
        setTimeout(() => resolve(child), 2000);
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

async function main() {
  console.log('📊 Memory Usage Comparison');
  console.log('━'.repeat(60));

  const results = [];

  for (const framework of FRAMEWORKS) {
    try {
      console.log(`Starting ${framework.name}...`);
      const server = await startServer(framework.file, framework.port);
      const memMB = getMemoryUsage(server.pid) / 1024;
      results.push({ name: framework.name, memoryMB: memMB.toFixed(2), pid: server.pid });
      console.log(`  ${framework.name}: ${memMB.toFixed(2)} MB (PID: ${server.pid})`);
      await stopServer(server);
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.error(`  ${framework.name}: FAILED - ${err.message}`);
    }
  }

  console.log('\n' + '━'.repeat(60));
  console.log('📊 Memory Usage Summary (MB)');
  console.log('━'.repeat(60));

  const sorted = results.sort((a, b) => parseFloat(a.memoryMB) - parseFloat(b.memoryMB));
  const minMem = parseFloat(sorted[0]?.memoryMB || 1);

  for (const r of sorted) {
    const bar = '█'.repeat(Math.ceil(parseFloat(r.memoryMB) / minMem * 20));
    console.log(`  ${r.name.padEnd(10)} ${r.memoryMB.padStart(8)} MB  ${bar}`);
  }
}

main().catch(console.error);
