#!/usr/bin/env node
// Servidor do Acompanhamento LBS: serve o site e guarda os dados de forma permanente.
//
// - Dados: um arquivo JSON em DATA_DIR (volume do Docker), gravado de forma atômica,
//   com uma cópia de segurança por dia (mantém as últimas 30).
// - Acesso: a senha fica só no servidor (variável SENHA). O login devolve um token assinado
//   (HMAC) que vale 30 dias ("manter conectado") ou 1 dia.
// - Primeira execução: cria a base decifrando dados-lbs.enc.js com a SENHA.
//
// Variáveis: SENHA (obrigatória), PORT (8080), DATA_DIR (/data), SITE_DIR (pasta do site).
// Sem dependências: só a biblioteca padrão do Node (>= 18).

import http from 'node:http';
import { createHash, createHmac, randomBytes, timingSafeEqual, webcrypto } from 'node:crypto';
import { promises as fs, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || '/data';
const SITE_DIR = path.resolve(process.env.SITE_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), '..'));
const SENHA = process.env.SENHA;
if (!SENHA) {
  console.error('Defina a variável SENHA (a mesma senha do site).');
  process.exit(1);
}

const DATA_FILE = path.join(DATA_DIR, 'dados.json');
const SEED_FILE = path.join(DATA_DIR, 'semente.json');
const SECRET_FILE = path.join(DATA_DIR, 'segredo.key');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MAX_BODY = 8 * 1024 * 1024; // fotos vão como data URL (~20 KB cada)
const DAY = 86_400_000;

mkdirSync(BACKUP_DIR, { recursive: true });

// ---------------------------------------------------------------- segredo dos tokens
if (!existsSync(SECRET_FILE)) writeFileSync(SECRET_FILE, randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = readFileSync(SECRET_FILE, 'utf8').trim();

const b64url = buf => Buffer.from(buf).toString('base64url');
function signToken(days) {
  const payload = b64url(JSON.stringify({ exp: Date.now() + days * DAY }));
  return `${payload}.${b64url(createHmac('sha256', SECRET).update(payload).digest())}`;
}
function checkToken(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return false;
  const expected = b64url(createHmac('sha256', SECRET).update(payload).digest());
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now(); } catch { return false; }
}
const sha = s => createHash('sha256').update(String(s)).digest();
const passwordOk = p => timingSafeEqual(sha(p), sha(SENHA));

// ---------------------------------------------------------------- dados
async function decryptSeed() {
  const src = readFileSync(path.join(SITE_DIR, 'dados-lbs.enc.js'), 'utf8');
  const meta = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1));
  const { subtle } = webcrypto;
  const base = await subtle.importKey('raw', new TextEncoder().encode(SENHA), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey(
    { name: 'PBKDF2', salt: Buffer.from(meta.salt, 'base64'), iterations: meta.iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(meta.iv, 'base64') }, key, Buffer.from(meta.data, 'base64'));
  return JSON.parse(new TextDecoder().decode(plain));
}

let db; // { version, updatedAt, rules, students }
let seed = [];

async function loadData() {
  if (existsSync(SEED_FILE)) seed = JSON.parse(await fs.readFile(SEED_FILE, 'utf8'));
  if (existsSync(DATA_FILE)) {
    db = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
    return;
  }
  try {
    seed = await decryptSeed();
  } catch (err) {
    console.error('Não foi possível decifrar dados-lbs.enc.js com a SENHA informada:', err.message);
    process.exit(1);
  }
  await fs.writeFile(SEED_FILE, JSON.stringify(seed, null, 1));
  db = { version: 1, updatedAt: new Date().toISOString(), rules: null, students: seed };
  await writeData();
  console.log(`Base criada com ${seed.length} alunos (a partir de dados-lbs.enc.js).`);
}

// Gravações em fila (uma de cada vez), atômicas (arquivo temporário + rename).
let queue = Promise.resolve();
function writeData() {
  queue = queue.then(async () => {
    const tmp = `${DATA_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(db, null, 1));
    await fs.rename(tmp, DATA_FILE);
    const today = new Date().toISOString().slice(0, 10);
    const backup = path.join(BACKUP_DIR, `dados-${today}.json`);
    await fs.copyFile(DATA_FILE, backup); // a cópia do dia fica com o último estado do dia
    const old = (await fs.readdir(BACKUP_DIR)).filter(f => f.startsWith('dados-')).sort().slice(0, -30);
    await Promise.all(old.map(f => fs.unlink(path.join(BACKUP_DIR, f))));
  });
  return queue;
}

function bump() {
  db.version += 1;
  db.updatedAt = new Date().toISOString();
}

function validStudent(s) {
  return s && typeof s === 'object' && typeof s.id === 'string' && s.id && typeof s.name === 'string' && s.name.trim();
}

// ---------------------------------------------------------------- limite de tentativas de login
const attempts = new Map(); // ip -> [timestamps]
function tooMany(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter(t => now - t < 5 * 60_000);
  attempts.set(ip, list);
  return list.length >= 10;
}

// ---------------------------------------------------------------- HTTP
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.json': 'application/json',
};
const PUBLIC_FILES = new Set(['/index.html', '/styles.css', '/app.js', '/dados-lbs.enc.js']);

function send(res, status, body, headers = {}) {
  const isJson = body !== undefined && typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    ...(isJson ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Dados grandes demais.'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { reject(Object.assign(new Error('JSON inválido.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

async function serveStatic(req, res, urlPath) {
  let p = decodeURIComponent(urlPath);
  if (p === '/' || p === '') p = '/index.html';
  const allowed = PUBLIC_FILES.has(p) || (p.startsWith('/assets/') && !p.includes('..') && !/\/\./.test(p));
  if (!allowed) return send(res, 404, 'Não encontrado');
  const file = path.join(SITE_DIR, p);
  if (!file.startsWith(SITE_DIR + path.sep)) return send(res, 404, 'Não encontrado');
  try {
    const data = await fs.readFile(file);
    send(res, 200, data, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  } catch {
    send(res, 404, 'Não encontrado');
  }
}

async function handleApi(req, res, urlPath) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

  if (urlPath === '/api/status' && req.method === 'GET') {
    return send(res, 200, { app: 'acompanhamento-lbs', ok: true });
  }

  if (urlPath === '/api/login' && req.method === 'POST') {
    if (tooMany(ip)) return send(res, 429, { error: 'Muitas tentativas. Aguarde alguns minutos.' });
    const { password, remember } = await readBody(req);
    if (!passwordOk(password || '')) {
      attempts.get(ip).push(Date.now());
      return send(res, 401, { error: 'Senha incorreta.' });
    }
    const days = remember ? 30 : 1;
    return send(res, 200, { token: signToken(days), expires: Date.now() + days * DAY });
  }

  // Demais rotas exigem login.
  const auth = String(req.headers.authorization || '');
  if (!checkToken(auth.replace(/^Bearer\s+/i, ''))) return send(res, 401, { error: 'Sessão expirada. Entre de novo.' });

  if (urlPath === '/api/dados' && req.method === 'GET') return send(res, 200, db);
  if (urlPath === '/api/semente' && req.method === 'GET') return send(res, 200, { students: seed });

  const m = urlPath.match(/^\/api\/alunos\/([^/]+)$/);
  if (m && req.method === 'PUT') {
    const id = decodeURIComponent(m[1]);
    const student = await readBody(req);
    if (!validStudent(student) || student.id !== id) return send(res, 400, { error: 'Aluno inválido.' });
    const i = db.students.findIndex(s => s.id === id);
    if (i >= 0) db.students[i] = student; else db.students.push(student);
    bump();
    await writeData();
    return send(res, 200, { version: db.version, student });
  }
  if (m && req.method === 'DELETE') {
    const id = decodeURIComponent(m[1]);
    db.students = db.students.filter(s => s.id !== id);
    bump();
    await writeData();
    return send(res, 200, { version: db.version });
  }

  if (urlPath === '/api/regras' && req.method === 'PUT') {
    const rules = await readBody(req);
    if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return send(res, 400, { error: 'Regras inválidas.' });
    db.rules = rules;
    bump();
    await writeData();
    return send(res, 200, { version: db.version });
  }

  if (urlPath === '/api/dados' && req.method === 'PUT') {
    const { students, rules } = await readBody(req);
    if (!Array.isArray(students) || !students.every(validStudent)) return send(res, 400, { error: 'Lista de alunos inválida.' });
    db.students = students;
    if (rules && typeof rules === 'object') db.rules = rules;
    bump();
    await writeData();
    return send(res, 200, { version: db.version });
  }

  return send(res, 404, { error: 'Rota não encontrada.' });
}

await loadData();

http.createServer(async (req, res) => {
  const urlPath = new URL(req.url, 'http://localhost').pathname;
  try {
    if (urlPath.startsWith('/api/')) await handleApi(req, res, urlPath);
    else if (req.method === 'GET' || req.method === 'HEAD') await serveStatic(req, res, urlPath);
    else send(res, 405, 'Método não permitido');
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'Erro interno no servidor.' });
  }
}).listen(PORT, () => {
  console.log(`Acompanhamento LBS em http://0.0.0.0:${PORT} — ${db.students.length} alunos, dados em ${DATA_FILE}`);
});
