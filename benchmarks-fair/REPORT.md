# Tlevor Fair Benchmark Report

## Environment

| Property | Value |
|---|---|
| Platform | linux (x64) |
| OS | PRETTY_NAME="Ubuntu 24.04.3 LTS"
NAME="Ubuntu" |
| CPU | AMD EPYC 7742 64-Core Processor (4 cores) |
| RAM | 7.8 GB total |
| Node.js | v22.23.1 |
| Timestamp | 2026-07-15T03:09:05.435Z |

## Methodology

- **Repetitions:** 5 per scenario
- **Warmup:** 3 seconds (discarded)
- **Scenarios:** 8
- **Frameworks:** Tlevor, Express, Fastify, Koa, Hono
- **Order:** Randomized each round
- **Load generator:** autocannon (separate process)
- **Resource monitoring:** ps sampled every 100ms during each run
- **Handler logic:** Identical across all frameworks
- **Middleware:** None (body parsing only where required for POST)

## Handler Code (identical logic)

See `handler-code.json` for full source of each server.
All servers implement the same 5 routes with the same response bodies.

---

## Results: Throughput (req/sec)  mean ± stdDev

| Scenario | Fastify | Tlevor | Hono | Koa | Express |
|---|---|---|---|---|---|
| GET JSON (100c, 10s) | 10361 ± 1000 | 9628 ± 723 | 8985 ± 863 | 6648 ± 360 | 3101 ± 164 |
| GET Route Params (100c, 10s) | 10409 ± 1155 | 9189 ± 708 | 9330 ± 594 | 6364 ± 125 | 3053 ± 132 |
| GET Text (100c, 10s) | 10968 ± 932 | 9677 ± 604 | 11195 ± 685 | 6583 ± 237 | 3159 ± 192 |
| POST Echo (100c, 10s) | 6134 ± 561 | 8115 ± 540 | 7237 ± 373 | 5210 ± 169 | 2532 ± 137 |
| GET Headers (100c, 10s) | 9467 ± 543 | 9603 ± 813 | 8026 ± 390 | 5961 ± 212 | 3047 ± 231 |
| GET JSON (10c, 10s) | 7835 ± 550 | 7895 ± 744 | 7141 ± 426 | 4670 ± 478 | 2407 ± 88 |
| GET JSON (500c, 10s) | 11447 ± 806 | 10667 ± 382 | 10556 ± 462 | 7686 ± 389 | 3226 ± 165 |
| Pipeline 10x10 (10s) | 14626 ± 1189 | 15510 ± 1062 | 12829 ± 627 | 9376 ± 416 | 3649 ± 279 |

## Results: Latency p99 (ms)  mean ± stdDev (lower = better)

| Scenario | Fastify | Tlevor | Hono | Koa | Express |
|---|---|---|---|---|---|
| GET JSON (100c, 10s) | 48.8 ± 3.1 | 48.4 ± 2.6 | 49.8 ± 4.0 | 51.6 ± 1.9 | 75.8 ± 6.8 |
| GET Route Params (100c, 10s) | 47.2 ± 4.4 | 48.6 ± 3.3 | 49.4 ± 2.0 | 53.6 ± 1.4 | 77.0 ± 4.0 |
| GET Text (100c, 10s) | 44.4 ± 2.2 | 48.0 ± 2.6 | 44.4 ± 2.9 | 53.0 ± 1.8 | 74.8 ± 6.3 |
| POST Echo (100c, 10s) | 58.6 ± 6.3 | 50.0 ± 3.3 | 51.4 ± 2.9 | 60.6 ± 3.6 | 92.0 ± 3.5 |
| GET Headers (100c, 10s) | 48.4 ± 2.3 | 48.8 ± 3.2 | 49.6 ± 2.1 | 56.4 ± 2.2 | 75.0 ± 7.6 |
| GET JSON (10c, 10s) | 25.6 ± 1.6 | 25.0 ± 1.4 | 25.8 ± 1.2 | 30.6 ± 1.4 | 35.2 ± 1.2 |
| GET JSON (500c, 10s) | 100.2 ± 4.3 | 108.6 ± 6.8 | 108.8 ± 4.9 | 140.2 ± 9.9 | 293.6 ± 25.4 |
| Pipeline 10x10 (10s) | 39.8 ± 3.0 | 38.6 ± 0.8 | 41.4 ± 1.0 | 47.6 ± 2.4 | 74.0 ± 9.1 |

## Results: Server Resource Usage

| Scenario | Framework | CPU % | RAM % |
|---|---|---|---|
| GET JSON (100c, 10s) | Fastify | 44.6 ± 1.4 | 1.0 ± 0.0 |
| GET JSON (100c, 10s) | Tlevor | 47.4 ± 2.6 | 0.9 ± 0.0 |
| GET JSON (100c, 10s) | Hono | 47.0 ± 2.8 | 0.9 ± 0.0 |
| GET JSON (100c, 10s) | Koa | 55.3 ± 2.0 | 1.0 ± 0.0 |
| GET JSON (100c, 10s) | Express | 61.4 ± 3.1 | 1.6 ± 0.0 |
| GET Route Params (100c, 10s) | Fastify | 40.8 ± 2.4 | 1.0 ± 0.0 |
| GET Route Params (100c, 10s) | Tlevor | 42.6 ± 2.6 | 1.0 ± 0.0 |
| GET Route Params (100c, 10s) | Hono | 41.6 ± 2.6 | 1.0 ± 0.0 |
| GET Route Params (100c, 10s) | Koa | 48.8 ± 1.7 | 1.1 ± 0.0 |
| GET Route Params (100c, 10s) | Express | 58.4 ± 2.8 | 1.6 ± 0.0 |
| GET Text (100c, 10s) | Fastify | 40.3 ± 2.4 | 1.0 ± 0.0 |
| GET Text (100c, 10s) | Tlevor | 41.2 ± 2.7 | 1.0 ± 0.0 |
| GET Text (100c, 10s) | Hono | 41.2 ± 2.2 | 1.1 ± 0.1 |
| GET Text (100c, 10s) | Koa | 46.4 ± 1.7 | 1.2 ± 0.0 |
| GET Text (100c, 10s) | Express | 57.5 ± 2.1 | 1.6 ± 0.0 |
| POST Echo (100c, 10s) | Fastify | 41.7 ± 2.3 | 1.6 ± 0.0 |
| POST Echo (100c, 10s) | Tlevor | 41.2 ± 2.3 | 1.2 ± 0.0 |
| POST Echo (100c, 10s) | Hono | 42.1 ± 1.6 | 1.2 ± 0.0 |
| POST Echo (100c, 10s) | Koa | 45.5 ± 1.5 | 1.2 ± 0.0 |
| POST Echo (100c, 10s) | Express | 57.7 ± 1.8 | 1.6 ± 0.0 |
| GET Headers (100c, 10s) | Fastify | 42.2 ± 2.4 | 1.7 ± 0.0 |
| GET Headers (100c, 10s) | Tlevor | 41.1 ± 1.7 | 1.2 ± 0.0 |
| GET Headers (100c, 10s) | Hono | 42.5 ± 1.0 | 1.2 ± 0.0 |
| GET Headers (100c, 10s) | Koa | 44.8 ± 1.0 | 1.2 ± 0.0 |
| GET Headers (100c, 10s) | Express | 57.8 ± 1.8 | 1.6 ± 0.0 |
| GET JSON (10c, 10s) | Fastify | 40.6 ± 2.2 | 1.7 ± 0.0 |
| GET JSON (10c, 10s) | Tlevor | 39.9 ± 1.5 | 1.2 ± 0.0 |
| GET JSON (10c, 10s) | Hono | 41.4 ± 0.8 | 1.2 ± 0.0 |
| GET JSON (10c, 10s) | Koa | 43.5 ± 0.6 | 1.2 ± 0.0 |
| GET JSON (10c, 10s) | Express | 56.5 ± 1.9 | 1.6 ± 0.0 |
| GET JSON (500c, 10s) | Fastify | 39.9 ± 1.6 | 1.7 ± 0.0 |
| GET JSON (500c, 10s) | Tlevor | 39.2 ± 1.4 | 1.2 ± 0.0 |
| GET JSON (500c, 10s) | Hono | 40.7 ± 0.7 | 1.2 ± 0.0 |
| GET JSON (500c, 10s) | Koa | 43.1 ± 0.6 | 1.3 ± 0.0 |
| GET JSON (500c, 10s) | Express | 55.5 ± 1.4 | 1.6 ± 0.0 |
| Pipeline 10x10 (10s) | Fastify | 40.3 ± 1.2 | 1.7 ± 0.0 |
| Pipeline 10x10 (10s) | Tlevor | 39.7 ± 1.1 | 1.3 ± 0.0 |
| Pipeline 10x10 (10s) | Hono | 41.0 ± 0.6 | 1.2 ± 0.0 |
| Pipeline 10x10 (10s) | Koa | 43.5 ± 0.7 | 1.3 ± 0.0 |
| Pipeline 10x10 (10s) | Express | 55.7 ± 1.0 | 1.6 ± 0.0 |

## Raw Data (all 5 runs)

### Tlevor

| Scenario | Run 1 | Run 2 | Run 3 | Run 4 | Run 5 | Mean | StdDev |
|---|---|---|---|---|---|---|---|
| GET JSON (100c, 10s) | 9,521 | 9,089 | 10,650 | 8,668 | 10,214 | 9,628 | 723 |
| GET Route Params (100c, 10s) | 8,498 | 8,758 | 9,438 | 8,788 | 10,461 | 9,189 | 708 |
| GET Text (100c, 10s) | 9,262 | 9,620 | 9,830 | 8,947 | 10,722 | 9,677 | 604 |
| POST Echo (100c, 10s) | 8,204 | 7,335 | 7,911 | 9,009 | 8,117 | 8,115 | 540 |
| GET Headers (100c, 10s) | 10,582 | 8,814 | 8,666 | 10,508 | 9,445 | 9,603 | 813 |
| GET JSON (10c, 10s) | 8,766 | 7,055 | 7,236 | 8,788 | 7,628 | 7,895 | 744 |
| GET JSON (500c, 10s) | 11,266 | 10,224 | 10,862 | 10,685 | 10,297 | 10,667 | 382 |
| Pipeline 10x10 (10s) | 15,177 | 17,094 | 16,382 | 14,428 | 14,469 | 15,510 | 1,062 |

### Express

| Scenario | Run 1 | Run 2 | Run 3 | Run 4 | Run 5 | Mean | StdDev |
|---|---|---|---|---|---|---|---|
| GET JSON (100c, 10s) | 3,051 | 3,067 | 3,059 | 2,918 | 3,409 | 3,101 | 164 |
| GET Route Params (100c, 10s) | 2,912 | 3,175 | 2,932 | 3,005 | 3,242 | 3,053 | 132 |
| GET Text (100c, 10s) | 3,020 | 3,170 | 2,885 | 3,426 | 3,293 | 3,159 | 192 |
| POST Echo (100c, 10s) | 2,553 | 2,710 | 2,336 | 2,637 | 2,422 | 2,532 | 137 |
| GET Headers (100c, 10s) | 3,251 | 3,282 | 2,655 | 3,111 | 2,937 | 3,047 | 231 |
| GET JSON (10c, 10s) | 2,442 | 2,541 | 2,314 | 2,431 | 2,305 | 2,407 | 88 |
| GET JSON (500c, 10s) | 3,165 | 3,195 | 3,548 | 3,126 | 3,096 | 3,226 | 165 |
| Pipeline 10x10 (10s) | 3,217 | 3,820 | 4,054 | 3,577 | 3,580 | 3,649 | 279 |

### Fastify

| Scenario | Run 1 | Run 2 | Run 3 | Run 4 | Run 5 | Mean | StdDev |
|---|---|---|---|---|---|---|---|
| GET JSON (100c, 10s) | 9,681 | 11,085 | 9,618 | 9,443 | 11,980 | 10,361 | 1,000 |
| GET Route Params (100c, 10s) | 11,922 | 10,655 | 9,088 | 9,077 | 11,303 | 10,409 | 1,155 |
| GET Text (100c, 10s) | 11,984 | 10,701 | 11,709 | 9,333 | 11,115 | 10,968 | 932 |
| POST Echo (100c, 10s) | 6,396 | 6,459 | 6,684 | 5,091 | 6,042 | 6,134 | 561 |
| GET Headers (100c, 10s) | 9,534 | 9,455 | 10,253 | 8,548 | 9,546 | 9,467 | 543 |
| GET JSON (10c, 10s) | 7,129 | 7,240 | 8,445 | 8,339 | 8,020 | 7,835 | 550 |
| GET JSON (500c, 10s) | 10,729 | 12,685 | 10,916 | 12,130 | 10,776 | 11,447 | 806 |
| Pipeline 10x10 (10s) | 13,692 | 15,896 | 14,476 | 16,041 | 13,026 | 14,626 | 1,189 |

### Koa

| Scenario | Run 1 | Run 2 | Run 3 | Run 4 | Run 5 | Mean | StdDev |
|---|---|---|---|---|---|---|---|
| GET JSON (100c, 10s) | 6,042 | 6,728 | 6,952 | 7,039 | 6,481 | 6,648 | 360 |
| GET Route Params (100c, 10s) | 6,299 | 6,312 | 6,419 | 6,578 | 6,214 | 6,364 | 125 |
| GET Text (100c, 10s) | 6,464 | 6,416 | 6,729 | 6,975 | 6,329 | 6,583 | 237 |
| POST Echo (100c, 10s) | 5,060 | 5,384 | 5,413 | 4,988 | 5,202 | 5,210 | 169 |
| GET Headers (100c, 10s) | 6,233 | 5,676 | 6,121 | 6,017 | 5,758 | 5,961 | 212 |
| GET JSON (10c, 10s) | 5,617 | 4,334 | 4,405 | 4,503 | 4,489 | 4,670 | 478 |
| GET JSON (500c, 10s) | 8,406 | 7,614 | 7,244 | 7,672 | 7,496 | 7,686 | 389 |
| Pipeline 10x10 (10s) | 10,005 | 9,068 | 9,742 | 9,085 | 8,982 | 9,376 | 416 |

### Hono

| Scenario | Run 1 | Run 2 | Run 3 | Run 4 | Run 5 | Mean | StdDev |
|---|---|---|---|---|---|---|---|
| GET JSON (100c, 10s) | 9,203 | 7,759 | 10,420 | 8,887 | 8,657 | 8,985 | 863 |
| GET Route Params (100c, 10s) | 9,756 | 9,745 | 9,680 | 9,270 | 8,198 | 9,330 | 594 |
| GET Text (100c, 10s) | 11,842 | 11,301 | 10,656 | 11,985 | 10,193 | 11,195 | 685 |
| POST Echo (100c, 10s) | 7,322 | 6,970 | 6,844 | 7,139 | 7,910 | 7,237 | 373 |
| GET Headers (100c, 10s) | 7,908 | 7,786 | 7,551 | 8,204 | 8,683 | 8,026 | 390 |
| GET JSON (10c, 10s) | 6,889 | 6,997 | 6,616 | 7,354 | 7,851 | 7,141 | 426 |
| GET JSON (500c, 10s) | 10,825 | 10,374 | 9,778 | 10,657 | 11,146 | 10,556 | 462 |
| Pipeline 10x10 (10s) | 12,789 | 13,990 | 12,099 | 12,676 | 12,589 | 12,829 | 627 |

## Errors

No errors recorded during testing.

---

*Report generated by Tlevor Fair Benchmark Suite v2.0*
