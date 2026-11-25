/**
 * Autonomous Bot Platform — entry point
 * AI is disabled by default. Bots are programmable workers.
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { Supervisor } from './core/supervisor/supervisor.js';
import { getDb, closeDb } from './storage/database.js';
import { attachMcpHttp } from './mcp/server/transport.js';
import { createMcpToken, listMcpTokens } from './mcp/auth.js';

const PORT = parseInt(process.env.PORT ?? '3847', 10);
const HOST = process.env.HOST ?? '127.0.0.1';
const DATA_DIR = process.env.DATA_DIR ?? './data';
const AI_ENABLED = process.env.AI_ENABLED === 'true';

async function main() {
  console.log('=== Autonomous Bot Platform ===');
  console.log(`AI providers: ${AI_ENABLED ? 'ENABLED' : 'DISABLED (default)'}`);
  console.log(`Data dir: ${DATA_DIR}`);

  getDb(DATA_DIR);
  const supervisor = new Supervisor(DATA_DIR);
  await supervisor.start();

  const MCP_ENABLED = process.env.MCP_ENABLED !== 'false';
  const MCP_PATH = process.env.MCP_PATH ?? '/mcp';

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  if (MCP_ENABLED) {
    attachMcpHttp(app, supervisor, { path: MCP_PATH });
    // Bootstrap: if no tokens and no env token, create one and print once
    if (!process.env.MCP_AUTH_TOKEN && process.env.MCP_AUTH_DISABLED !== 'true') {
      const existing = listMcpTokens(DATA_DIR);
      if (existing.length === 0) {
        const { token, record } = createMcpToken(DATA_DIR, { name: 'bootstrap' });
        console.log('MCP bootstrap token (store securely, shown once):', token);
        console.log('Token id:', record.id, 'prefix:', record.prefix);
      }
    }
  }

  app.get('/health', (_req, res) => {
    res.json(supervisor.getHealth());
  });

  app.get('/api/bots', (_req, res) => {
    res.json(supervisor.getFactory().list());
  });

  app.post('/api/bots', (req, res) => {
    try {
      const bot = supervisor.getFactory().create({
        name: req.body.name,
        description: req.body.description,
        purpose: req.body.purpose,
        templateId: req.body.templateId,
        mode: req.body.mode ?? 'programmed',
        aiEnabled: AI_ENABLED && req.body.aiEnabled === true,
      });
      supervisor.audit('user', 'create_bot', bot.id, { name: bot.name }, true);
      res.status(201).json(bot);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/bots/:id', (req, res) => {
    const bot = supervisor.getFactory().get(req.params.id);
    if (!bot) return res.status(404).json({ error: 'not found' });
    res.json(bot);
  });

  app.delete('/api/bots/:id', (req, res) => {
    supervisor.getFactory().delete(req.params.id);
    supervisor.audit('user', 'delete_bot', req.params.id, {}, true);
    res.status(204).end();
  });

  app.post('/api/bots/:id/tasks', (req, res) => {
    try {
      const task = supervisor.submitTask(
        req.params.id,
        req.body.type,
        req.body.name ?? req.body.type,
        req.body.payload ?? {},
        { priority: req.body.priority, scheduledAt: req.body.scheduledAt }
      );
      supervisor.audit('user', 'submit_task', task.id, { botId: req.params.id, type: task.type }, true);
      res.status(201).json(task);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/bots/:id/tasks', (req, res) => {
    res.json(supervisor.getQueue().listByBot(req.params.id));
  });

  app.get('/api/tasks/:id', (req, res) => {
    const task = supervisor.getQueue().get(req.params.id);
    if (!task) return res.status(404).json({ error: 'not found' });
    res.json(task);
  });

  app.post('/api/emergency-stop', (req, res) => {
    const on = req.body.on !== false;
    supervisor.setEmergencyStop(on);
    supervisor.audit('user', 'emergency_stop', 'system', { on }, true);
    res.json({ emergencyStop: on });
  });

  app.get('/api/templates', async (_req, res) => {
    const { TEMPLATES } = await import('./bots/templates/index.js');
    res.json(Object.values(TEMPLATES).map((t: any) => ({
      id: t.id,
      name: t.name,
      description: t.description,
    })));
  });

  app.get('/api/system', (_req, res) => {
    res.json({
      ...supervisor.getHealth(),
      aiEnabled: AI_ENABLED,
      version: '0.1.0',
    });
  });

  app.get('/', (_req, res) => {
    res.type('html').send(`<!DOCTYPE html>
<html><head><title>Autonomous Bot Platform</title>
<style>
  body{font-family:system-ui;background:#0f1115;color:#e6e6e6;margin:0;padding:2rem}
  h1{color:#7dd3fc} .card{background:#1a1d24;padding:1rem;border-radius:8px;margin:1rem 0}
  button{background:#0ea5e9;color:#000;border:0;padding:.5rem 1rem;border-radius:6px;cursor:pointer;margin-right:.5rem}
  pre{background:#111;padding:1rem;overflow:auto}
</style></head>
<body>
  <h1>Autonomous Bot Platform</h1>
  <p>Native programmable bots · AI optional · SQLite persistence</p>
  <div class="card">
    <button onclick="load()">Refresh Health</button>
    <button onclick="createDemo()">Create 10 Demo Bots</button>
    <button onclick="runStress()">Run 100 Programmed Tasks</button>
    <button onclick="emergency()">Emergency Stop</button>
  </div>
  <pre id="out">Loading…</pre>
  <script>
    const out = document.getElementById('out');
    async function load(){
      const h = await fetch('/health').then(r=>r.json());
      const bots = await fetch('/api/bots').then(r=>r.json());
      out.textContent = JSON.stringify({health:h, bots:bots.length, sample:bots.slice(0,3)}, null, 2);
    }
    async function createDemo(){
      for(let i=0;i<10;i++){
        await fetch('/api/bots',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({name:'Demo Bot '+i, templateId:'counter', mode:'programmed'})});
      }
      load();
    }
    async function runStress(){
      const bots = await fetch('/api/bots').then(r=>r.json());
      if(!bots.length){alert('Create bots first');return;}
      let n=0;
      for(const b of bots){
        for(let i=0;i<10;i++){
          await fetch('/api/bots/'+b.id+'/tasks',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({type:'counter.increment',name:'inc-'+i,payload:{}})});
          n++;
        }
      }
      out.textContent = 'Submitted '+n+' tasks. Waiting…';
      setTimeout(load, 3000);
    }
    async function emergency(){
      await fetch('/api/emergency-stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({on:true})});
      load();
    }
    load();
  </script>
</body></html>`);
  });

  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'hello', health: supervisor.getHealth() }));
    const onHb = (h: any) => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'health', data: h })); };
    supervisor.on('heartbeat', onHb);
    ws.on('close', () => supervisor.off('heartbeat', onHb));
  });

  server.listen(PORT, HOST, () => {
    console.log(`API + Dashboard: http://${HOST}:${PORT}`);
    console.log(`WebSocket: ws://${HOST}:${PORT}/ws`);
    console.log('Ready. AI is OFF unless AI_ENABLED=true');
    if (MCP_ENABLED) {
      console.log(`MCP HTTP: http://${HOST}:${PORT}${MCP_PATH} (Bearer auth)`);
      console.log('MCP stdio: npx tsx src/mcp/server/stdio-entry.ts');
    }
  });

  process.on('SIGINT', () => {
    console.log('Shutting down…');
    supervisor.stop();
    closeDb();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
