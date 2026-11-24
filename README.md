# Acompanhamento LBS

Painel para acompanhar os prazos de alunos de mestrado e doutorado do LBS (HTML + CSS + JavaScript, sem dependências).

## Como usar

Abra `index.html` no navegador, ou sirva a pasta localmente:

```bash
python3 -m http.server 8765
```

e acesse http://localhost:8765.

## Regras padrão (editáveis em Configuração → Regras e prazos)

| | Duração | Qualificação |
|---|---|---|
| Mestrado | 24 meses | 18 meses |
| Doutorado | 48 meses | 24 meses |

- 1ª versão do texto: 3 meses antes (seleção da banca)
- Versão final: 1 mês antes (agendamento pela secretaria)
- As mesmas entregas são aplicadas à defesa (pode ser desligado)
- Avisos aparecem com 60 dias de antecedência

## Dados

Em produção, o site roda com o servidor em `servidor/server.mjs` (Node, sem dependências): ele
serve as páginas e **grava os dados de forma permanente** num arquivo JSON no servidor, com uma
cópia de segurança por dia. Todos veem as mesmas informações; o site busca alterações de outras
pessoas a cada minuto. A senha é conferida pelo servidor (variável `SENHA`).

```bash
SENHA=... DATA_DIR=./dados node servidor/server.mjs   # http://localhost:8080
```

Na primeira execução, o servidor cria a base decifrando `dados-lbs.enc.js` (os alunos do LBS,
cifrados com a senha). Esse arquivo é gerado a partir de `dados-lbs.fonte.js` — legível, só na
máquina de quem mantém o site — com `node ferramentas/criptografar-dados.mjs`.

Sem o servidor (abrindo os arquivos direto, ou na versão publicada no claude.ai), o site funciona
em **modo local**: os dados ficam só no navegador.
