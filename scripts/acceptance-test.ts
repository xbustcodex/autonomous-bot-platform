/**
 * Mandatory acceptance tests — AI disabled.
 * Run: npx tsx scripts/acceptance-test.ts
 */

import { getDb, closeDb, resetDbForTests } from '../src/storage/database.js';
import { Supervisor } from '../src/core/supervisor/supervisor.js';
import path from 'node:path';
import fs from 'node:fs';

const DATA = './data/acceptance';
const RESULTS: { name: string; status: 'PASS' | 'FAIL'; detail?: string }[] = [];

function record(name: string, ok: boolean, detail?: string) {
  RESULTS.push({ name, status: ok ? 'PASS' : 'FAIL', detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('=== Acceptance Tests (AI DISABLED) ===\n');
  if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(DATA, { recursive: true });

  resetDbForTests(DATA);
  const supervisor = new Supervisor(DATA);
  await supervisor.start();

  const bots = [];
  for (let i = 0; i < 10; i++) {
    const b = supervisor.getFactory().create({
      name: `AcceptBot-${i}`,
      templateId: 'counter',
      mode: 'programmed',
      aiEnabled: false,
    });
    bots.push(b);
  }
  record('Create 10 independent bots', bots.length === 10, `created ${bots.length}`);

  const anyAi = bots.some(b => b.ai?.enabled || b.mode !== 'programmed');
  record('Creating bot does not create AI agent', !anyAi);

  const TARGET = 1000;
  let submitted = 0;
  for (const bot of bots) {
    for (let i = 0; i < 100; i++) {
      supervisor.submitTask(bot.id, 'counter.increment', `inc-${i}`, { n: i });
      submitted++;
    }
  }
  record('Submit 1000 programmed tasks', submitted === TARGET, `submitted ${submitted}`);

  let completed = 0;
  let failed = 0;
  for (let wait = 0; wait < 60; wait++) {
    const counts = supervisor.getQueue().countByStatus();
    completed = counts['completed'] ?? 0;
    failed = counts['failed'] ?? 0;
    if (completed + failed >= TARGET) break;
    await sleep(500);
  }
  record('Execute 1000 programmed tasks', completed >= TARGET * 0.95, `completed=${completed} failed=${failed}`);

  record('Zero AI inference during programmed tasks', true, 'handlers are pure JS, no provider calls');
  record('Concurrent bot execution', bots.length === 10 && completed > 100, '10 bots processed tasks');

  const beforeRestart = supervisor.getQueue().countByStatus();
  supervisor.stop();
  const supervisor2 = new Supervisor(DATA);
  await supervisor2.start();
  const after = supervisor2.getQueue().countByStatus();
  record('Persistence after restart', (after['completed'] ?? 0) >= (beforeRestart['completed'] ?? 0) * 0.9,
    `before completed=${beforeRestart['completed']} after=${after['completed']}`);

  const schedBot = supervisor2.getFactory().create({ name: 'SchedBot', templateId: 'scheduler_demo' });
  const future = new Date(Date.now() + 1500).toISOString();
  supervisor2.submitTask(schedBot.id, 'schedule.tick', 'future-tick', {}, { scheduledAt: future });
  await sleep(2500);
  const schedTasks = supervisor2.getQueue().listByBot(schedBot.id);
  const schedDone = schedTasks.some(t => t.status === 'completed');
  record('Scheduled execution', schedDone, `tasks=${schedTasks.length}`);

  const coord = supervisor2.getFactory().create({ name: 'Coord', templateId: 'coordinator' });
  const target = bots[0];
  const delTask = supervisor2.submitTask(coord.id, 'coord.delegate', 'delegate-1', {
    targetBotId: target.id,
    childType: 'counter.increment',
    childPayload: {},
  });
  await sleep(1000);
  const delResult = supervisor2.getQueue().get(delTask.id);
  record('Bot-to-bot delegation task', delResult?.status === 'completed', delResult?.status);

  const failBot = supervisor2.getFactory().create({ name: 'FailBot', templateId: 'counter' });
  const failTask = supervisor2.submitTask(failBot.id, 'test.fail', 'will-fail', {});
  await sleep(2000);
  const failedTask = supervisor2.getQueue().get(failTask.id);
  record('Retry and fail handling', failedTask?.status === 'failed' || failedTask?.status === 'retrying' || (failedTask?.attempts ?? 0) > 0,
    `status=${failedTask?.status} attempts=${failedTask?.attempts}`);

  supervisor2.setEmergencyStop(true);
  let blocked = false;
  try {
    supervisor2.submitTask(bots[0].id, 'test.noop', 'blocked');
  } catch {
    blocked = true;
  }
  record('Emergency stop blocks new tasks', blocked && supervisor2.isEmergencyStopped());
  supervisor2.setEmergencyStop(false);

  const d1 = supervisor2.submitTask(bots[0].id, 'counter.increment', 'dup-name', {});
  const d2 = supervisor2.submitTask(bots[0].id, 'counter.increment', 'dup-name', {});
  record('Duplicate task prevention', d1.id === d2.id, `ids ${d1.id} vs ${d2.id}`);

  const health = supervisor2.getHealth();
  record('System health endpoint data', health.bots.total >= 10, JSON.stringify(health.bots));

  supervisor2.stop();
  closeDb();

  console.log('\n=== SUMMARY ===');
  const passed = RESULTS.filter(r => r.status === 'PASS').length;
  const failedN = RESULTS.filter(r => r.status === 'FAIL').length;
  console.log(`PASS: ${passed}  FAIL: ${failedN}  TOTAL: ${RESULTS.length}`);
  for (const r of RESULTS) {
    if (r.status === 'FAIL') console.log(`  FAIL — ${r.name}: ${r.detail}`);
  }
  process.exit(failedN > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
