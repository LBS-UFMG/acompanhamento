#!/usr/bin/env node
// Cifra os dados dos alunos para poderem ficar num repositório público.
//
// Lê   dados-lbs.fonte.js  (legível, fica só na sua máquina — está no .gitignore)
// Gera dados-lbs.enc.js    (cifrado com AES-256-GCM; a chave vem da senha via PBKDF2-SHA256)
//
// Uso (na pasta do projeto):
//   node ferramentas/criptografar-dados.mjs              → pede a senha
//   DADOS_SENHA=... node ferramentas/criptografar-dados.mjs
//
// A senha precisa ser a mesma que as pessoas digitam no site.

import { readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import vm from 'node:vm';
import readline from 'node:readline/promises';

const SOURCE = 'dados-lbs.fonte.js';
const TARGET = 'dados-lbs.enc.js';
const ITERATIONS = 250_000;

const b64 = bytes => Buffer.from(bytes).toString('base64');

async function askPassword() {
  if (process.env.DADOS_SENHA) return process.env.DADOS_SENHA;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Senha do site: ');
  rl.close();
  return answer;
}

// Executa o arquivo-fonte num ambiente isolado só para obter window.LBS_DADOS_INICIAIS.
const sandbox = { window: {} };
vm.runInNewContext(readFileSync(SOURCE, 'utf8'), sandbox, { filename: SOURCE });
const data = sandbox.window.LBS_DADOS_INICIAIS;
if (!Array.isArray(data)) throw new Error(`${SOURCE} não define window.LBS_DADOS_INICIAIS`);

const password = await askPassword();
if (!password) throw new Error('Senha vazia.');

const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey(
  { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
  baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt'],
);
const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data)));

const payload = { v: 1, kdf: 'PBKDF2-SHA256', iter: ITERATIONS, salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(cipher)) };
writeFileSync(TARGET, `/* Dados dos alunos do LBS, cifrados (AES-256-GCM, chave derivada da senha por PBKDF2-SHA256).
 * Gerado por ferramentas/criptografar-dados.mjs a partir de dados-lbs.fonte.js — não edite à mão. */
window.LBS_DADOS_CRIPTO = ${JSON.stringify(payload, null, 1)};
`);
console.log(`${TARGET} gerado: ${data.length} alunos cifrados.`);
