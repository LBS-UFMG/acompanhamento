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

O site pede uma senha. Os dados iniciais (usados só no primeiro acesso) ficam **cifrados** em `dados-lbs.enc.js`, gerado a partir de `dados-lbs.fonte.js` (legível, só na máquina de quem mantém o site) com `node ferramentas/criptografar-dados.mjs` (pede a senha; use a mesma do site). São os alunos de mestrado e doutorado do LBS, coletados da [página da equipe](https://bioinfo.dcc.ufmg.br/pt/team) e das [listas de alunos do PPG Bioinformática](https://www.pgbioinfo.icb.ufmg.br/alunos.php?ano=2025&nivel=M). Alunos sem data no PPG ficaram com entrada em 23/11/2026 e uma observação pedindo correção.

Depois do primeiro acesso, os dados ficam no `localStorage` do navegador. Use **Exportar JSON** para backup ou para levar os dados para outro computador, e **Importar JSON** para restaurar.
