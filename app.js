/* Acompanhamento de alunos de pós-graduação — LBS
 * Versão inicial: HTML + CSS + JavaScript puro, dados no localStorage.
 */
(() => {
  'use strict';

  const STORAGE_KEY = 'lbs-acompanhamento-v1';

  const DEFAULT_RULES = {
    msTotal: 24,        // mestrado: 2 anos
    msQual: 18,         // qualificação do mestrado: 1 ano e meio
    dsTotal: 48,        // doutorado: 4 anos
    dsQual: 24,         // qualificação do doutorado: 2 anos
    firstDraft: 3,      // 1ª versão do texto: 3 meses antes (seleção da banca)
    boardDraft: 3,      // banca marcada: 3 meses antes, junto com a 1ª versão (após aprovação do orientador)
    finalDraft: 1,      // versão final: 1 mês antes (agendamento pela secretaria)
    defenseDrafts: true,// aplicar as mesmas entregas para a defesa
    alertWindow: 60,    // dias de antecedência para avisos
    boardRuleV3: true,  // marca: regras já no padrão "banca 3 meses antes"
  };

  const LEVEL_LABEL = { mestrado: 'Mestrado', doutorado: 'Doutorado' };
  const PROGRAMS = ['Bioinformática', 'Ciência da Computação'];
  const LEVEL_ACRONYM = { mestrado: 'mest', doutorado: 'dout' };
  const PROGRAM_ACRONYM = { 'Bioinformática': 'bioinfo', 'Ciência da Computação': 'comp' };
  // Publicações do doutorado: por ano, uma como 1º autor e outra como coautor (com o grupo).
  // Dados antigos tinham só "pubs" (uma por ano): contam como publicação de 1º autor.
  const PUB_HELP = 'Recomendamos, a cada ano do doutorado, 1 publicação como primeiro autor e outra como coautor com colegas do grupo — isso incentiva a colaboração entre os alunos do LBS. A publicação pode ser um artigo ou um capítulo de livro. Apenas no primeiro ano aceitamos uma apresentação de pôster em conferência.';
  function pubFlags(s) {
    return {
      first: s.pubsFirst || s.pubs || [],
      co: s.pubsCo || [],
    };
  }

  // Checkboxes de entrega/banca por etapa (qual = qualificação, def = defesa).
  // "Scheduled" = banca marcada (nome mantido por compatibilidade com dados salvos).
  const STAGE_FLAGS = ['qualFirst', 'qualFinal', 'qualScheduled', 'defFirst', 'defFinal', 'defScheduled'];
  const STOPWORDS = new Set(['da', 'de', 'do', 'das', 'dos', 'e', 'em', 'para']);

  // Sigla do programa: lista fixa; para "outros", iniciais (2+ palavras) ou começo da palavra.
  function programAcronym(program) {
    if (!program) return '';
    if (PROGRAM_ACRONYM[program]) return PROGRAM_ACRONYM[program];
    const words = program.split(/\s+/).filter(w => w && !STOPWORDS.has(w.toLowerCase()));
    if (words.length >= 2) return words.map(w => w[0]).join('').toUpperCase();
    return (words[0] || program).slice(0, 6).toLowerCase();
  }
  const OTHER_PROGRAM = '__outro__';
  const STAGE_LABEL = { qual: 'qualificação', def: 'defesa' };

  // Mestrado em Ciência da Computação não tem qualificação: o marco equivalente é a
  // aprovação na disciplina PAA (Projeto e Análise de Algoritmos), sem entrega de texto.
  function usesPAA(s) {
    return s.level === 'mestrado' && s.program === 'Ciência da Computação';
  }
  // Nomes do marco "qualificação" conforme o aluno.
  function qualTerms(s) {
    return usesPAA(s)
      ? { name: 'Aprovação em PAA', short: 'PAA', tag: 'PAA', done: 'Aprovado(a) em PAA', pending: 'Ainda não foi aprovado(a) em PAA', did: 'Já foi aprovado(a) em PAA' }
      : { name: 'Qualificação', short: 'Qualificação', tag: 'quali', done: 'Qualificado(a)', pending: 'Ainda não qualificou', did: 'Já qualificou' };
  }

  // ---------------------------------------------------------------- estado
  // Os dados só são carregados depois da senha (eles vêm cifrados em dados-lbs.enc.js).
  let state = { students: [], rules: { ...DEFAULT_RULES } };

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        const saved = Array.isArray(data.students) ? data.students : [];
        const rules = { ...DEFAULT_RULES, ...(data.rules || {}) };
        // Regras salvas antes da mudança "banca 3 meses antes" (era 2): adota o novo padrão.
        if (!data.rules?.boardRuleV3) rules.boardDraft = DEFAULT_RULES.boardDraft;
        rules.boardRuleV3 = true;
        // Navegador que só tinha os antigos alunos teste: troca pelos alunos do LBS.
        // (Nunca descarta alunos cadastrados pelo usuário.)
        if (saved.every(s => String(s.id).startsWith('teste-'))) {
          const fresh = { students: initialStudents(), rules };
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh)); } catch { /* segue sem salvar */ }
          return fresh;
        }
        return { students: saved, rules };
      }
    } catch (e) {
      console.warn('Não foi possível ler os dados salvos:', e);
    }
    // Primeiro acesso: começa com os alunos do LBS (dados-lbs.enc.js, já decifrado).
    return { students: initialStudents(), rules: { ...DEFAULT_RULES } };
  }

  function initialStudents() {
    const data = Array.isArray(window.LBS_DADOS_INICIAIS) ? window.LBS_DADOS_INICIAIS : [];
    return data.map(s => ({ ...s, pubsFirst: [...(s.pubsFirst || [])], pubsCo: [...(s.pubsCo || [])] }));
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      toast('Não foi possível salvar no navegador (espaço cheio?). Exporte um backup em JSON.');
      return false;
    }
  }

  // ---------------------------------------------------------------- datas
  const DAY = 86400000;

  function parseDate(iso) {
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }

  function toISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function today() {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), t.getDate());
  }

  // Soma meses respeitando fim de mês (31/01 + 1 mês = 28 ou 29/02).
  function addMonths(date, months) {
    const y = date.getFullYear();
    const m = date.getMonth() + months;
    const lastDay = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(date.getDate(), lastDay));
  }

  function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  }

  // Prazos finais são sempre no ÚLTIMO DIA DO MÊS (a entrada pode ser em qualquer dia).
  function endOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0);
  }

  // Último dia do mês "entrada + N meses". Ex.: entrada fev/2025 + 24 → 28/02/2027.
  function deadlineAfter(entry, months) {
    return endOfMonth(addMonths(new Date(entry.getFullYear(), entry.getMonth(), 1), months));
  }

  // Fim do período de N meses completos contando o mês de entrada.
  // Ex.: entrada dez/2022, 48 meses → defesa até 30/11/2026 (como a previsão do PPG).
  function periodEnd(entry, months) {
    return deadlineAfter(entry, months - 1);
  }

  // Prazo "N meses antes" de outro prazo: fim do mês correspondente.
  // Ex.: qualificação 28/02/2027 → banca (2 meses antes) 31/12/2026, 1ª versão (3 meses) 30/11/2026.
  function monthEndBefore(deadline, months) {
    return endOfMonth(new Date(deadline.getFullYear(), deadline.getMonth() - months, 1));
  }

  // Banca: marcada até N meses antes do prazo (fim do mês), depois da aprovação do texto.
  function boardDate(deadline, rules) {
    return monthEndBefore(deadline, rules.boardDraft ?? 2);
  }

  function daysBetween(a, b) {
    return Math.round((b - a) / DAY);
  }

  function fmtDate(date) {
    return date.toLocaleDateString('pt-BR');
  }

  function plural(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
  }

  // Meses e dias inteiros entre duas datas (from <= to).
  function diffParts(from, to) {
    let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
    if (addMonths(from, months) > to) months--;
    return { months, days: daysBetween(addMonths(from, months), to) };
  }

  // Duração legível entre duas datas (from <= to).
  function fmtDuration(from, to) {
    const { months, days } = diffParts(from, to);
    if (months >= 12) {
      const years = Math.floor(months / 12);
      const rest = months % 12;
      return rest ? `${plural(years, 'ano', 'anos')} e ${plural(rest, 'mês', 'meses')}` : plural(years, 'ano', 'anos');
    }
    if (months > 0) {
      return days ? `${plural(months, 'mês', 'meses')} e ${plural(days, 'dia', 'dias')}` : plural(months, 'mês', 'meses');
    }
    return plural(days, 'dia', 'dias');
  }

  // Versão compacta para etiquetas: 1a2m, 3m22d, 15d.
  function shortDuration(from, to) {
    const { months, days } = diffParts(from, to);
    if (months >= 12) return `${Math.floor(months / 12)}a${months % 12 ? `${months % 12}m` : ''}`;
    if (months > 0) return `${months}m${days ? `${days}d` : ''}`;
    return `${days}d`;
  }

  function fmtRelative(days) {
    if (days === 0) return 'hoje';
    if (days === 1) return 'amanhã';
    if (days === -1) return 'ontem';
    return days > 0 ? `em ${days} dias` : `há ${-days} dias`;
  }

  // ---------------------------------------------------------------- regras
  function analyze(student, rules = state.rules) {
    const now = today();
    const entry = parseDate(student.entry);
    const isMs = student.level === 'mestrado';
    const totalM = Number(isMs ? rules.msTotal : rules.dsTotal);
    const qualM = Number(isMs ? rules.msQual : rules.dsQual);
    const end = periodEnd(entry, totalM); // defesa: fim do último mês do curso
    const qual = deadlineAfter(entry, qualM);

    const elapsed = daysBetween(entry, now);
    const totalDays = daysBetween(entry, end);
    const pct = Math.max(0, (elapsed / totalDays) * 100);

    const events = [];
    // Checkboxes do aluno: textos entregues e qualificação/defesa agendada.
    const paa = usesPAA(student);
    // Mestrado não marca banca de qualificação (só a de defesa); PAA não tem texto nem banca.
    const flag = (stage, what) => !(paa && stage === 'qual')
      && !(isMs && stage === 'qual' && what === 'Scheduled')
      && !!student[`${stage}${what}`];
    // Fluxo: 1ª versão → orientador aprova → banca marcada → versão final → qualificação/defesa.
    const pushStage = (stage, deadline, withDrafts, withBoard) => {
      if (withDrafts) {
        events.push({
          stage, kind: 'first', date: monthEndBefore(deadline, rules.firstDraft),
          completed: flag(stage, 'First'),
          label: `Entrega da 1ª versão do texto (${STAGE_LABEL[stage]}) — seleção da banca`,
          short: `1ª versão (${STAGE_LABEL[stage]})`,
        });
      }
      if (withBoard) {
        events.push({
          stage, kind: 'board', date: boardDate(deadline, rules),
          completed: flag(stage, 'Scheduled'),
          label: `Prazo para marcar a banca (${STAGE_LABEL[stage]})`,
          short: `Banca marcada (${STAGE_LABEL[stage]})`,
        });
      }
      if (withDrafts) {
        events.push({
          stage, kind: 'final', date: monthEndBefore(deadline, rules.finalDraft),
          completed: flag(stage, 'Final'),
          label: `Entrega da versão final (${STAGE_LABEL[stage]}) — agendamento pela secretaria`,
          short: `Versão final (${STAGE_LABEL[stage]})`,
        });
      }
      events.push({
        stage, kind: 'deadline', date: deadline,
        scheduled: flag(stage, 'Scheduled'),
        label: stage === 'qual'
          ? (paa ? 'Prazo para aprovação em PAA' : 'Prazo para a qualificação')
          : 'Prazo final para a defesa',
        short: stage === 'qual' ? (paa ? 'PAA' : 'Qualificação') : 'Defesa',
      });
    };

    if (!student.done) {
      // PAA é uma disciplina: sem entrega de texto nem agendamento.
      if (student.notQualified) pushStage('qual', qual, !paa, !paa && !isMs); // banca de quali só no doutorado
      pushStage('def', end, !!rules.defenseDrafts, true);
    }

    // Classifica cada evento.
    const lateStages = new Set();
    for (const ev of events) {
      ev.days = daysBetween(now, ev.date);
      if (ev.kind === 'deadline' && ev.days < 0) lateStages.add(ev.stage);
    }
    // Status: done (texto entregue), late (venceu sem entrega/defesa), hidden (entrega vencida
    // numa etapa cujo prazo final já venceu — atraso, mas sem aviso duplicado), scheduled
    // (agendada, prazo ainda não venceu), info (dentro da janela de avisos) ou future.
    for (const ev of events) {
      if (ev.completed) ev.status = 'done';
      else if (ev.days < 0) {
        ev.status = ev.kind !== 'deadline' && lateStages.has(ev.stage) ? 'hidden' : 'late';
      } else if (ev.scheduled) ev.status = 'scheduled';
      else if (ev.days <= rules.alertWindow) ev.status = 'info';
      else ev.status = 'future';
    }

    // Qualquer atraso → late (vermelho). Sem atraso → ok/warn (azul; warn = há prazo próximo).
    // Pendências de requisitos (aviso amarelo):
    //  - mestrado: já qualificou e ainda não participou de congresso;
    //  - doutorado: algum ano já concluído sem publicação.
    const issues = [];
    if (!student.done) {
      if (isMs && !student.notQualified && !student.congress) {
        issues.push({
          badge: 'congresso ⚠',
          text: `${qualTerms(student).did} e ainda não participou de congresso`,
          tip: `${qualTerms(student).did} e ainda não participou de nenhum congresso (obrigatório no mestrado)`,
          date: null,
        });
      }
      if (!isMs) {
        // Anos já concluídos sem publicação, agrupados numa única pendência.
        const missing = [];
        const pubs = pubFlags(student);
        for (let i = 0; i < pubYears(rules); i++) {
          const yEnd = periodEnd(entry, 12 * (i + 1));
          if (now < yEnd) continue;
          const lack = [];
          if (!pubs.first[i]) lack.push('1º autor');
          if (!pubs.co[i]) lack.push('coautoria');
          const yStart = i === 0 ? entry : addDays(periodEnd(entry, 12 * i), 1);
          if (lack.length) missing.push({ year: i + 1, start: yStart, end: yEnd, lack });
        }
        if (missing.length) {
          const years = missing.map(m => m.year);
          const list = years.length === 1 ? `no ano ${years[0]}`
            : `nos anos ${years.slice(0, -1).join(', ')} e ${years[years.length - 1]}`;
          const range = years.length === 1 ? `ano ${years[0]}`
            : years.every((y, k) => k === 0 || y === years[k - 1] + 1) ? `anos ${years[0]}–${years[years.length - 1]}` : `anos ${years.join(',')}`;
          issues.push({
            badge: `pub ⚠ ${range}`,
            text: `Publicações pendentes ${list}`,
            tip: `Publicações pendentes — ${missing.map(m => `ano ${m.year} (${fmtDate(m.start)} a ${fmtDate(m.end)}): falta ${m.lack.join(' e ')}`).join('; ')}. Recomendado por ano: 1 como 1º autor e 1 como coautor.`,
            date: missing[0].end,
          });
        }
      }
    }

    // Cor do cartão: done (cinza) · late (vermelho: qualquer atraso) ·
    // attention (amarelo: pendência de congresso/publicação) · soon/ok (azul).
    let status = 'ok';
    if (student.done) status = 'done';
    else if (events.some(e => e.status === 'late' || e.status === 'hidden')) status = 'late';
    else if (issues.length) status = 'attention';
    else if (events.some(e => e.status === 'info')) status = 'soon';

    const upcoming = events.filter(e => e.days >= 0 && !e.completed).sort((a, b) => a.date - b.date);
    const overdue = events.filter(e => e.status === 'late').sort((a, b) => a.date - b.date);

    return {
      entry, end, qual, totalM, qualM, pct, elapsed, totalDays,
      events, status, lateStages, issues,
      next: upcoming[0] || null,
      mostOverdue: overdue[0] || null,
      overEnd: now > end,
      now,
    };
  }

  // ---------------------------------------------------------------- utilidades
  function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function uid() {
    return (crypto.randomUUID && crypto.randomUUID()) || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  const $ = sel => document.querySelector(sel);

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ---------------------------------------------------------------- painel

  function renderSummary(analyzed) {
    const active = analyzed.filter(x => !x.s.done);
    const count = f => active.filter(f).length;
    const stats = [
      { label: 'Alunos em andamento', value: active.length },
      { label: 'Mestrado', value: count(x => x.s.level === 'mestrado') },
      { label: 'Doutorado', value: count(x => x.s.level === 'doutorado') },
      { label: 'Atrasados', value: count(x => x.a.status === 'late'), cls: 'late' },
      { label: 'Pendências (congresso/publicação)', value: count(x => x.a.status === 'attention'), cls: 'warn' },
      { label: 'Com prazos próximos', value: count(x => x.a.status !== 'late' && x.a.events.some(e => e.status === 'info')), cls: 'info' },
    ];
    $('#summary').innerHTML = stats.map(s => `
      <div class="stat ${s.cls && s.value ? s.cls : ''}">
        <div class="value">${s.value}</div>
        <div class="label">${s.label}</div>
      </div>`).join('');
  }

  function renderAlerts(analyzed) {
    // Itens: atrasos (vermelho), pendências de requisitos (amarelo) e prazos próximos (azul).
    const items = [];
    for (const { s, a } of analyzed) {
      for (const ev of a.events) {
        if (ev.status === 'late') {
          items.push({ s, status: 'late', date: ev.date,
            html: `<strong>${esc(s.name)}</strong> está <strong>atrasado(a)</strong>: ${esc(ev.label.toLowerCase())} venceu.`,
            when: `${fmtDate(ev.date)} · ${fmtRelative(ev.days)}` });
        } else if (ev.status === 'info') {
          items.push({ s, status: 'info', date: ev.date,
            html: `<strong>${esc(s.name)}</strong> — ${esc(ev.label)}`,
            when: `${fmtDate(ev.date)} · ${fmtRelative(ev.days)}` });
        }
      }
      for (const issue of a.issues) {
        items.push({ s, status: 'warn', date: issue.date,
          html: `<strong>${esc(s.name)}</strong> — ${esc(issue.text)}.`,
          when: issue.date ? `pendente desde ${fmtDate(issue.date)}` : 'requisito do mestrado' });
      }
    }
    const rank = { late: 0, warn: 1, info: 2 };
    items.sort((x, y) => rank[x.status] - rank[y.status] || (x.date ?? 0) - (y.date ?? 0));

    $('#alert-window-hint').textContent = `Atrasos, pendências e prazos dos próximos ${state.rules.alertWindow} dias`;

    // Contador do sininho: vermelho se houver atraso, amarelo se houver pendência, azul nos demais casos.
    const count = $('#bell-count');
    count.hidden = !items.length;
    count.textContent = items.length > 99 ? '99+' : items.length;
    const hasLate = items.some(x => x.status === 'late');
    count.classList.toggle('late', hasLate);
    count.classList.toggle('warn', !hasLate && items.some(x => x.status === 'warn'));
    $('#bell').setAttribute('aria-label', items.length
      ? `Avisos e datas importantes: ${items.length} aviso(s)`
      : 'Avisos e datas importantes: nenhum aviso');

    if (!items.length) {
      $('#alerts').innerHTML = `<li class="alert empty">Nenhum atraso, pendência ou prazo próximo. 🎉</li>`;
      return;
    }

    $('#alerts').innerHTML = items.map(({ s, status, html, when }) => `<li>
        <button type="button" class="alert ${status}" data-student="${esc(s.id)}">
          ${avatarHtml(s, 'sm')}
          <span class="alert-body">
            <span class="alert-text">${html}</span>
            <span class="alert-when">${when}</span>
          </span>
        </button>
      </li>`).join('');
  }

  // ---------------------------------------------------------------- exportar: mensagem do mês (WhatsApp)
  // Lista quem está atrasado e quem tem alguma etapa neste mês, no formato do WhatsApp
  // (*negrito*, _itálico_). A mensagem é enviada manualmente no grupo do laboratório.
  function monthlyMessage() {
    const now = today();
    const mStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const mEnd = addMonths(mStart, 1);
    const monthName = `${MONTH_NAMES[now.getMonth()].toLowerCase()}/${now.getFullYear()}`;
    const what = (s, ev) => {
      const stage = ev.stage === 'qual' ? qualTerms(s).name.toLowerCase() : 'defesa';
      return {
        first: `entregar a 1ª versão do texto (${stage})`,
        board: `marcar a banca (${stage})`,
        final: `entregar a versão final do texto (${stage})`,
        deadline: ev.stage === 'qual' ? (usesPAA(s) ? 'aprovação em PAA' : 'qualificação') : 'defesa',
      }[ev.kind];
    };
    const late = [];
    const month = [];
    for (const s of state.students) {
      if (s.done || !parseDate(s.entry)) continue;
      const a = analyze(s);
      const overdue = a.events.filter(e => e.status === 'late').sort((x, y) => x.date - y.date);
      if (overdue.length) late.push({ s, evs: overdue, first: overdue[0].date });
      const due = a.events.filter(e => !e.completed && e.days >= 0 && e.date >= mStart && e.date < mEnd)
        .sort((x, y) => x.date - y.date);
      if (due.length) month.push({ s, evs: due, first: due[0].date });
    }
    late.sort((x, y) => x.first - y.first);
    month.sort((x, y) => x.first - y.first);

    const lines = [`*LBS — Pendências de ${monthName}*`, `_Atualizado em ${fmtDate(now)}_`, ''];
    if (late.length) {
      lines.push('*Urgente*');
      for (const { s, evs } of late) {
        lines.push(`• *${s.name}* — ${evs.map(ev => `${what(s, ev)} (venceu em ${fmtDate(ev.date)})`).join('; ')}`);
      }
      lines.push('');
    }
    if (month.length) {
      lines.push(`*Para ${MONTH_NAMES[now.getMonth()].toLowerCase()}*`);
      for (const { s, evs } of month) {
        lines.push(`• *${s.name}* — ${evs.map(ev => `${what(s, ev)} até ${fmtDate(ev.date)}${ev.status === 'scheduled' ? ' (banca marcada)' : ''}`).join('; ')}`);
      }
      lines.push('');
    }
    if (!late.length && !month.length) {
      lines.push('✅ Nenhum atraso e nenhuma atividade prevista para este mês. Bom trabalho!', '');
    } else {
      lines.push('*Lembretes*');
      lines.push('• Envie o texto primeiro a um pós-doc do LBS; depois da aprovação dele, ao orientador.');
      lines.push('• A banca só pode ser marcada depois que o orientador aprovar o texto.');
      lines.push('• Dúvidas? Procurem o orientador ou um pós-doc do LBS.');
    }
    return lines.join('\n').trim();
  }

  function waLink(text) {
    // Emojis fora do plano básico (ex.: 📋) chegam quebrados (como um losango com interrogação) pelo link: são removidos.
    const safe = [...text].filter(ch => ch.codePointAt(0) <= 0xFFFF).join('');
    return `https://wa.me/?text=${encodeURIComponent(safe)}`;
  }

  function setExportMenuOpen(open) {
    $('#export-menu').hidden = !open;
    $('#export-menu-btn').setAttribute('aria-expanded', open);
    if (open) $('#wa-open').href = waLink(monthlyMessage());
  }

  // ---------------------------------------------------------------- sininho
  function setNotifOpen(open) {
    const panel = $('#notif-panel');
    panel.hidden = !open;
    $('#bell').setAttribute('aria-expanded', open);
    // Em telas estreitas o painel é fixo: posiciona logo abaixo do sininho.
    panel.style.top = open && matchMedia('(max-width: 600px)').matches
      ? `${Math.round($('#bell').getBoundingClientRect().bottom + 10)}px`
      : '';
  }

  // Abre o cartão do aluno a partir de um aviso.
  function focusStudent(id) {
    setNotifOpen(false);
    showView('painel');
    // Garante que o aluno apareça mesmo com filtros ativos.
    $('#filter-level').value = 'all';
    $('#filter-program').value = 'all';
    $('#filter-status').value = 'active';
    $('#search').value = '';
    renderDashboard();
    const card = document.querySelector(`.student[data-id="${CSS.escape(id)}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.remove('flash');
    void card.offsetWidth; // reinicia a animação
    card.classList.add('flash');
    openDetails(id);
  }

  // ---------------------------------------------------------------- confirmação na página
  // (a confirmação nativa do navegador não funciona em todos os ambientes, ex.: páginas publicadas no claude.ai)
  function askConfirm(message, okLabel = 'Confirmar', danger = false) {
    const dlg = $('#confirm-dialog');
    $('#confirm-msg').textContent = message;
    const ok = $('#confirm-ok');
    ok.textContent = okLabel;
    ok.classList.toggle('danger-fill', danger);
    ok.classList.toggle('primary', !danger);
    return new Promise(resolve => {
      const finish = value => {
        dlg.removeEventListener('close', onClose);
        ok.onclick = null;
        $('#confirm-cancel').onclick = null;
        if (dlg.open) dlg.close();
        resolve(value);
      };
      const onClose = () => finish(false);
      ok.onclick = () => finish(true);
      $('#confirm-cancel').onclick = () => finish(false);
      dlg.addEventListener('close', onClose);
      dlg.showModal();
      $('#confirm-cancel').focus();
    });
  }

  // Foto remota que não carrega (site fora do ar, bloqueio do ambiente): usa a silhueta.
  document.addEventListener('error', e => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    if (img.classList.contains('avatar')) {
      const div = document.createElement('div');
      div.className = img.className + ' generic';
      div.title = 'Sem foto';
      div.innerHTML = GENERIC_PHOTO;
      img.replaceWith(div);
    } else if (img.parentElement?.classList.contains('avatar')) {
      img.parentElement.classList.add('generic');
      img.parentElement.innerHTML = GENERIC_PHOTO;
    }
  }, true);

  // ---------------------------------------------------------------- detalhes (janela do "+")
  function openDetails(id) {
    const s = state.students.find(x => x.id === id);
    if (!s || !parseDate(s.entry)) return;
    const a = analyze(s);
    const dlg = $('#details-dialog');
    $('#details-content').innerHTML = `
      <header class="dlg-head">
        ${avatarHtml(s, 'xl')}
        <div class="student-info">
          <h2 id="details-title">${esc(s.name)}</h2>
          <div class="badges">${studentBadges(s, a)}</div>
        </div>
        <button type="button" class="btn small icon" data-close data-tip="Fechar" aria-label="Fechar">×</button>
      </header>
      <div class="dlg-body">
        <div class="progress-labels">
          <span><strong>${Math.min(100, Math.round(a.pct))}%</strong> decorrido</span>
          <span>${remainingText(s, a)}</span>
        </div>
        ${keyLine(s, a)}
        ${detailsHtml(s, a)}
      </div>
      <footer class="dlg-foot">
        <button type="button" class="btn" data-close>Fechar</button>
        <button type="button" class="btn primary" data-edit="${esc(s.id)}">Editar aluno</button>
      </footer>`;
    if (!dlg.open) dlg.showModal();
    dlg.querySelector('.dlg-head [data-close]').focus();
  }

  function closeDetails() {
    const dlg = $('#details-dialog');
    if (dlg.open) dlg.close();
  }

  function progressMarkers(s, a) {
    const posDate = d => Math.min(100, Math.max(0, (daysBetween(a.entry, d) / a.totalDays) * 100));
    const markers = [];
    if (s.notQualified && !s.done && !usesPAA(s)) {
      markers.push(`<span class="marker draft" style="left:${posDate(monthEndBefore(a.qual, state.rules.firstDraft))}%" title="1ª versão (qualificação)"></span>`);
      if (s.level !== 'mestrado') markers.push(`<span class="marker draft" style="left:${posDate(boardDate(a.qual, state.rules))}%" title="Banca marcada (qualificação)"></span>`);
      markers.push(`<span class="marker draft" style="left:${posDate(monthEndBefore(a.qual, state.rules.finalDraft))}%" title="Versão final (qualificação)"></span>`);
    }
    const q = qualTerms(s);
    markers.push(`<span class="marker" style="left:${posDate(a.qual)}%" data-label="${q.short}" title="${q.name}: ${fmtDate(a.qual)}"></span>`);
    if (state.rules.defenseDrafts && !s.done) {
      markers.push(`<span class="marker draft" style="left:${posDate(monthEndBefore(a.end, state.rules.firstDraft))}%" title="1ª versão (defesa)"></span>`);
      markers.push(`<span class="marker draft" style="left:${posDate(boardDate(a.end, state.rules))}%" title="Banca marcada (defesa)"></span>`);
      markers.push(`<span class="marker draft" style="left:${posDate(monthEndBefore(a.end, state.rules.finalDraft))}%" title="Versão final (defesa)"></span>`);
    }
    return markers.join('');
  }

  function timelineItems(s, a) {
    const view = ev => ({
      done: ['doneitem', '✓ ', ''],
      late: ['late', '⚠ ', ''],
      hidden: ['late', '⚠ ', ''],
      scheduled: ['doneitem', '📅 ', ' — banca marcada'],
      info: ['soon', '', ''],
      future: ['', '', ''],
    }[ev.status]);
    const items = [];
    if (!s.notQualified) items.push(`<span class="doneitem">✓ ${qualTerms(s).done}</span>`);
    for (const ev of a.events) {
      let [cls, icon, suffix] = view(ev);
      if (ev.status === 'done') suffix = ev.kind === 'board' ? ' — feito' : ' — entregue';
      items.push(`<span class="${cls}" title="${esc(ev.label)}">${icon}${esc(ev.short)}: ${fmtDate(ev.date)}${suffix}</span>`);
    }
    if (s.done) items.push(`<span class="doneitem">✓ Defesa realizada</span>`);
    return items.join('');
  }

  function remainingText(s, a) {
    if (s.done) return 'Concluído';
    if (a.overEnd) return `<strong>${fmtDuration(a.end, a.now)}</strong> além do prazo`;
    return `Faltam <strong>${fmtDuration(a.now, a.end)}</strong>`;
  }

  // Etiqueta curta com tooltip explicando a sigla.
  function tag(text, tip, cls = '') {
    return `<span class="badge ${cls}" data-tip="${esc(tip)}" aria-label="${esc(tip)}" tabindex="0">${esc(text)}</span>`;
  }

  function studentBadges(s, a) {
    const b = [tag(LEVEL_ACRONYM[s.level], LEVEL_LABEL[s.level], s.level === 'mestrado' ? 'ms' : 'ds')];
    if (s.program) b.push(tag(programAcronym(s.program), `Programa: ${s.program}`, 'prog'));
    if (s.done) {
      b.push(tag('defendeu ✓', 'Concluído — já defendeu'));
      return b.join('');
    }
    for (const ev of a.events.filter(e => e.status === 'late')) {
      const ago = `${fmtDuration(ev.date, a.now)} (prazo: ${fmtDate(ev.date)})`;
      if (ev.kind === 'deadline') {
        const what = ev.stage === 'qual' ? qualTerms(s).name : 'Defesa';
        b.push(tag(`${ev.stage === 'qual' ? qualTerms(s).tag : 'defesa'} ⚠ ${shortDuration(ev.date, a.now)}`,
          `${what} atrasada há ${ago}`, 'late'));
      } else {
        const short = { first: '1ª versão', final: 'v. final', board: 'banca' }[ev.kind];
        const why = ev.kind === 'board' ? 'banca ainda não marcada' : 'texto não entregue';
        b.push(tag(`${short} ⚠ ${shortDuration(ev.date, a.now)}`,
          `${ev.short.replace('Banca marcada', 'Marcar banca')}: ${why}, atrasado há ${ago}`, 'late'));
      }
    }
    for (const ev of a.events.filter(e => e.status === 'scheduled')) {
      const what = ev.stage === 'qual' ? 'Qualificação' : 'Defesa';
      b.push(tag(`${ev.stage === 'qual' ? 'quali' : 'defesa'} 📅`, `${what}: banca marcada (prazo: ${fmtDate(ev.date)})`, 'info'));
    }
    for (const issue of a.issues) b.push(tag(issue.badge, issue.tip, 'warn'));
    const nextInfo = a.events.filter(e => e.status === 'info').sort((x, y) => x.date - y.date)[0];
    if (nextInfo && a.status !== 'late') {
      const ev = nextInfo;
      b.push(tag(ev.days === 0 ? 'prazo hoje' : `prazo ${ev.days}d`, `Próximo prazo: ${ev.short} ${fmtRelative(ev.days)} (${fmtDate(ev.date)})`, 'info'));
    }
    const q = qualTerms(s);
    b.push(s.notQualified
      ? tag(`s/ ${q.tag}`, q.pending)
      : tag(`${q.tag} ✓`, q.did, 'ok'));
    return b.join('');
  }

  // Linha de destaque sempre visível: o atraso mais antigo ou o próximo prazo.
  function keyLine(s, a) {
    if (s.done) return '';
    const late = a.events.filter(e => e.status === 'late').sort((x, y) => x.date - y.date)[0];
    if (late) return `<div class="key-line late">⚠ ${esc(late.label)} venceu em ${fmtDate(late.date)}</div>`;
    if (a.issues.length) return `<div class="key-line warn">⚠ ${esc(a.issues[0].text)}${a.issues.length > 1 ? ` (+${a.issues.length - 1})` : ''}</div>`;
    if (a.next) {
      const sched = a.next.status === 'scheduled' ? ' — banca marcada' : '';
      return `<div class="key-line ${a.next.status === 'future' ? '' : 'info'}">Próximo: ${esc(a.next.short)} ${fmtRelative(a.next.days)} (${fmtDate(a.next.date)})${sched}</div>`;
    }
    return '';
  }

  // Painel de detalhes exibido pelo botão "+".
  // Orientações para o aluno, montadas a partir da situação dele (fluxo do texto, banca,
  // publicações e congresso). Aparecem nos detalhes, abaixo das observações.
  function guidanceHtml(s, a) {
    if (s.done) return '<em>Concluído — nenhuma orientação pendente.</em>';
    const items = [];
    const isMs = s.level === 'mestrado';
    const add = (html, alert = false) => items.push(`<li class="${alert ? 'guide-alert' : ''}">${html}</li>`);

    // Fluxo do texto (qualificação/defesa)
    const steps = a.events.filter(e => e.kind !== 'deadline' && !e.completed).sort((x, y) => x.date - y.date);
    const next = steps[0];
    const stageName = ev => (ev.stage === 'qual' ? qualTerms(s).name.toLowerCase() : 'defesa');
    const m = n => `${n} ${n === 1 ? 'mês' : 'meses'}`;
    if (next) {
      const when = next.days < 0
        ? `<strong>atrasado desde ${fmtDate(next.date)}</strong>`
        : `até <strong>${fmtDate(next.date)}</strong>`;
      const what = { first: 'entregar a 1ª versão do texto', board: 'marcar a banca', final: 'entregar a versão final do texto' }[next.kind];
      add(`Próximo passo: ${what} da ${stageName(next)}, ${when}.`, next.days < 0);
    }
    if (a.events.some(e => e.kind === 'first' || e.kind === 'final')) {
      add('Antes de enviar o texto ao orientador, envie-o a um <strong>pós-doc do LBS</strong> para revisão. Só depois da aprovação do pós-doc, envie ao orientador.');
      add(`O texto deve ser entregue <strong>antes</strong> da ${a.events.some(e => e.stage === 'qual' && e.kind === 'first') ? 'qualificação ou da defesa' : 'defesa'}: a 1ª versão ${m(state.rules.firstDraft)} antes e a versão final ${m(state.rules.finalDraft)} antes (para a secretaria agendar).`);
    }
    if (a.events.some(e => e.kind === 'board')) {
      add(`<strong>Marcação da banca:</strong> só depois que o <strong>orientador aprovar o texto</strong>. Convide os membros, combine a data e marque a banca até ${m(state.rules.boardDraft ?? 2)} antes da ${a.events.some(e => e.stage === 'qual' && e.kind === 'board') ? 'qualificação ou da defesa' : 'defesa'} (fim do mês). É uma etapa trabalhosa: comece cedo.`);
    }
    if (usesPAA(s) && s.notQualified) {
      add('No mestrado em Ciência da Computação, o marco equivalente à qualificação é a <strong>aprovação na disciplina PAA</strong> (Projeto e Análise de Algoritmos).');
    }

    // Congresso: mestrado, ou doutorado no primeiro ano (pôster aceito)
    const firstYear = !isMs && a.now <= periodEnd(a.entry, 12);
    if (isMs || firstYear) {
      const missing = isMs && !s.congress;
      const pending = missing && !s.notQualified; // amarelo só depois da qualificação/PAA, como no cartão
      add(`${isMs ? (missing ? 'Você ainda não registrou participação em congresso (obrigatório no mestrado). ' : '') : 'No 1º ano do doutorado, uma apresentação de pôster em conferência conta como publicação. '}Congressos indicados: <strong>X-Meeting</strong> (congresso da AB3C) ou <strong>BSB</strong> (Brazilian Symposium on Bioinformatics).`, pending);
    }

    // Publicações (doutorado)
    if (!isMs) {
      const pubs = pubFlags(s);
      const none = !pubs.first.some(Boolean) && !pubs.co.some(Boolean);
      add(`${none ? 'Você ainda não tem publicações registradas. ' : ''}Política de publicação do LBS: <strong>pelo menos 2 artigos por ano</strong> — um como <strong>1º autor</strong> e outro como <strong>coautor</strong> com colegas do grupo, o que incentiva a colaboração. Vale artigo ou capítulo de livro.`, a.issues.length > 0); // amarelo só com ano concluído sem publicação
    }

    add('Dúvidas? Procure seu <strong>orientador</strong> ou um <strong>pós-doc do LBS</strong>.');
    return `<ul class="guide">${items.join('')}</ul>`;
  }

  function detailsHtml(s, a) {
    const row = (label, value) => `<dt>${label}</dt><dd>${value}</dd>`;
    return `<dl class="details-list">
      ${row(s.level === 'mestrado' ? 'Dissertação' : 'Tese', s.theme ? `<strong>${esc(s.theme)}</strong>` : '<em>Título não informado</em>')}
      ${row('Orientador(a)', s.advisor ? esc(s.advisor) : '<em>Não informado</em>')}
      ${row('Programa', s.program ? esc(s.program) : '<em>Não informado</em>')}
      ${row('Nível', LEVEL_LABEL[s.level])}
      ${row('Entrada', fmtDate(a.entry))}
      ${row('Término previsto', fmtDate(a.end))}
      ${row('Datas', `<div class="timeline">${timelineItems(s, a)}</div>`)}
      ${row(s.level === 'mestrado' ? 'Congresso' : 'Publicações', requirementsHtml(s, a))}
      ${row('Observações', s.notes ? esc(s.notes) : '<em>Nenhuma</em>')}
      ${row('Orientações', guidanceHtml(s, a))}
    </dl>`;
  }

  function renderStudents(analyzed) {
    const level = $('#filter-level').value;
    const program = $('#filter-program').value;
    const status = $('#filter-status').value;
    const sortBy = $('#sort-by').value;
    const q = $('#search').value.trim().toLowerCase();

    let list = analyzed.filter(({ s, a }) => {
      if (level !== 'all' && s.level !== level) return false;
      if (program !== 'all' && (s.program || '') !== program) return false;
      if (status === 'active' && s.done) return false;
      if (status === 'done' && !s.done) return false;
      if (status === 'late' && a.status !== 'late') return false;
      if (status === 'attention' && !['late', 'attention', 'soon'].includes(a.status)) return false;
      if (q && ![s.name, s.advisor, s.theme, s.program].some(v => (v || '').toLowerCase().includes(q))) return false;
      return true;
    });

    // Ordem "mais atrasado": 1) qualquer atraso (prazo ou entrega de texto), do maior para o
    // menor; 2) sem atraso, pelo próximo prazo mais perto; 3) concluídos.
    const delayKey = ({ s, a }) => {
      if (s.done) return [3, 0];
      const late = a.events.filter(e => e.status === 'late' || e.status === 'hidden');
      if (late.length) return [0, -Math.max(...late.map(e => -e.days))];
      if (a.issues.length) return [1, -a.issues.length];
      return [1.5, (a.next?.date ?? a.end).getTime()];
    };
    list.sort((x, y) => {
      if (sortBy === 'name') return x.s.name.localeCompare(y.s.name, 'pt-BR');
      if (sortBy === 'entry') return x.a.entry - y.a.entry;
      const [r1, v1] = delayKey(x), [r2, v2] = delayKey(y);
      return r1 - r2 || v1 - v2 || x.s.name.localeCompare(y.s.name, 'pt-BR');
    });

    if (!state.students.length) {
      $('#students').innerHTML = `<div class="empty-state">
        Nenhum aluno cadastrado ainda.<br><br>
        <button class="btn primary" data-goto="config">Ir para a configuração</button>
      </div>`;
      return;
    }
    if (!list.length) {
      $('#students').innerHTML = `<div class="empty-state">Nenhum aluno corresponde aos filtros.</div>`;
      return;
    }

    $('#students').innerHTML = list.map(({ s, a }) => {
      return `
      <article class="student ${a.status}${a.overEnd && !s.done ? ' expired' : ''}" data-id="${esc(s.id)}">
        <div class="student-head">
          ${avatarHtml(s, 'lg')}
          <div class="student-info">
            <div class="student-name">${esc(s.name)}</div>
            <div class="student-meta">Entrada: ${fmtDate(a.entry)}</div>
            <div class="badges">${studentBadges(s, a)}</div>
          </div>
          <div class="card-actions">
            <button class="btn small icon" data-details="${esc(s.id)}" aria-haspopup="dialog"
              data-tip="Mais detalhes: título, orientador, datas, requisitos, observações"
              aria-label="Mais detalhes de ${esc(s.name)}">+</button>
            <button class="btn small icon" data-edit="${esc(s.id)}" data-tip="Editar aluno" aria-label="Editar ${esc(s.name)}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17.25V20h2.75L17.8 8.94l-2.75-2.75L4 17.25Zm15.71-10.04a1 1 0 0 0 0-1.41l-1.51-1.51a1 1 0 0 0-1.41 0l-1.2 1.2 2.92 2.92 1.2-1.2Z"/></svg>
            </button>
          </div>
        </div>
        <div class="progress-wrap">
          <div class="progress-labels">
            <span data-tip="Parte do prazo total já decorrida"><strong>${Math.min(100, Math.round(a.pct))}%</strong> decorrido</span>
            <span data-tip="Término previsto: ${fmtDate(a.end)}">${remainingText(s, a)}</span>
          </div>
          <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, Math.round(a.pct))}">
            <div class="progress-fill" style="width:${s.done ? 100 : Math.min(100, a.pct)}%"></div>
            ${progressMarkers(s, a)}
          </div>
          <div class="progress-scale"></div>
        </div>
        <div class="key-slot">${keyLine(s, a)}</div>
      </article>`;
    }).join('');
  }

  // Opções do filtro: programas padrão + programas "outros" já cadastrados.
  function renderProgramFilter() {
    const sel = $('#filter-program');
    const current = sel.value;
    const extra = [...new Set(state.students.map(s => s.program).filter(p => p && !PROGRAMS.includes(p)))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const opts = [['all', 'Todos'], ...[...PROGRAMS, ...extra].map(p => [p, p])];
    if (state.students.some(s => !s.program)) opts.push(['', 'Não informado']);
    sel.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
    sel.value = opts.some(([v]) => v === current) ? current : 'all';
  }

  // ---------------------------------------------------------------- linha do tempo (próximos meses)
  const TIMELINE_MONTHS = 6;
  // Nome curto para a linha do tempo: primeiro nome + último sobrenome (ignorando Junior/Filho/Neto).
  function shortName(name) {
    const parts = String(name).replace(/\(.*?\)/g, '').trim().split(/\s+/);
    if (parts.length < 2) return parts[0] || '';
    let i = parts.length - 1;
    if (/^(j[uú]nior|filho|neto|sobrinho)$/i.test(parts[i]) && i > 1) i--;
    const last = parts[i].replace(/\.$/, '');
    return last.length <= 2 ? parts.slice(0, 2).join(' ') : `${parts[0]} ${last}`;
  }

  // Rótulo curto do prazo: "Defesa", "Qualificação", "PAA", "1ª versão · quali", "v. final · defesa".
  function eventChipLabel(s, ev) {
    const stage = ev.stage === 'qual' ? qualTerms(s).tag : 'defesa';
    if (ev.kind === 'deadline') return ev.stage === 'qual' ? qualTerms(s).name.replace('Aprovação em ', '') : 'Defesa';
    if (ev.kind === 'board') return `marcar banca · ${stage}`;
    return `${ev.kind === 'first' ? '1ª versão' : 'v. final'} · ${stage}`;
  }

  // Linha do tempo em eixo horizontal: um círculo por prazo, na data, com o nome do aluno
  // acima ou abaixo (em faixas, para os rótulos não se sobreporem). Atrasados ficam em "hoje".
  const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const MONTH_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const monthYear = d => `${MONTH_SHORT[d.getMonth()]}/${d.getFullYear()}`;
  let lastTimelineData = null;

  // Sigla do prazo na linha do tempo: Q (qualificação), PAA, D (defesa), EM (entregar manuscrito).
  function eventCode(s, ev) {
    if (ev.kind === 'board') {
      return { code: 'MB', name: `Marcar banca (${ev.stage === 'qual' ? qualTerms(s).name.toLowerCase() : 'defesa'}) — depois da aprovação do orientador` };
    }
    if (ev.kind !== 'deadline') {
      return { code: 'EM', name: `Entregar manuscrito: ${ev.kind === 'first' ? '1ª versão' : 'versão final'} (${ev.stage === 'qual' ? qualTerms(s).name.toLowerCase() : 'defesa'})` };
    }
    if (ev.stage === 'def') return { code: 'D', name: 'Defesa' };
    return usesPAA(s) ? { code: 'PAA', name: 'Aprovação em PAA' } : { code: 'Q', name: 'Qualificação' };
  }

  function renderTimeline(analyzed) {
    if (analyzed) lastTimelineData = analyzed;
    analyzed = lastTimelineData || [];
    const host = $('#tl');
    const now = today();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = addMonths(start, TIMELINE_MONTHS);

    // Linhas: uma por aluno em cada mês, com as siglas das etapas daquele mês lado a lado
    // (ex.: entregar manuscrito e marcar banca, que costumam ficar a ~2 semanas um do outro).
    // Atrasados entram em "este mês" com todas as etapas vencidas.
    // Uma linha por aluno em cada mês (nunca o mesmo aluno duas vezes no mesmo mês).
    // Em "este mês", as etapas vencidas (siglas vermelhas) e as que vencem no mês (siglas
    // normais) ficam juntas na mesma linha.
    const rows = [];
    const monthKey = d => `${d.getFullYear()}-${d.getMonth()}`;
    const nowKey = monthKey(now);
    const uniqCodes = (s, evs, late) => {
      const seen = new Map();
      evs.forEach(ev => { const c = eventCode(s, ev); if (!seen.has(c.code)) seen.set(c.code, { ...c, late }); });
      return [...seen.values()];
    };
    for (const { s, a } of analyzed) {
      if (s.done) continue;
      const overdue = a.events.filter(e => e.status === 'late').sort((x, y) => x.date - y.date);
      const byMonth = new Map();
      for (const ev of a.events) {
        if (ev.completed || ev.days < 0 || ev.date >= end) continue;
        const k = monthKey(ev.date);
        if (!byMonth.has(k)) byMonth.set(k, []);
        byMonth.get(k).push(ev);
      }
      const upcomingText = evs => {
        const sched = evs.some(ev => ev.status === 'scheduled');
        return `${evs.map(ev => eventChipLabel(s, ev)).join(' + ')}${sched ? ' 📅' : ''} · ${monthYear(evs[0].date)}`;
      };
      const upcomingTip = evs => `${evs.map(ev => `${ev.label}${ev.status === 'scheduled' ? ' (banca marcada)' : ''}`).join('; ')} — ${monthYear(evs[0].date)}`;

      if (overdue.length) {
        const thisMonth = (byMonth.get(nowKey) || []).sort((x, y) => x.date - y.date);
        byMonth.delete(nowKey); // entra na mesma linha dos atrasados
        const lateText = overdue.map(ev => `${eventChipLabel(s, ev)} (${monthYear(ev.date)})`).join(' + ') + ' · vencido';
        rows.push({ s, cat: 'late', date: now,
          codes: [...uniqCodes(s, overdue, true), ...uniqCodes(s, thisMonth, false)],
          what: thisMonth.length ? `${lateText} | ${upcomingText(thisMonth)}` : lateText,
          tip: `${s.name}: ${overdue.map(ev => `${ev.label} venceu em ${monthYear(ev.date)}`).join('; ')}${thisMonth.length ? `; ${upcomingTip(thisMonth)}` : ''}`,
          sort: overdue[0].date });
      }
      byMonth.forEach(evs => {
        evs.sort((x, y) => x.date - y.date);
        rows.push({ s, cat: evs.some(ev => ev.kind === 'deadline') ? 'milestone' : 'text', date: evs[0].date,
          codes: uniqCodes(s, evs, false),
          what: upcomingText(evs),
          tip: `${s.name}: ${upcomingTip(evs)}`,
          sort: evs[0].date });
      });
    }
    // Atrasados primeiro (ficam mais perto do eixo); depois por data.
    rows.sort((x, y) => (y.cat === 'late') - (x.cat === 'late') || x.sort - y.sort);

    // Linhas com a mesma informação (mesmo mês e mesmas etapas) viram um rótulo com vários alunos.
    const groups = [];
    for (const r of rows) {
      const key = `${r.cat}|${r.what}`;
      const g = groups.find(x => x.key === key);
      if (g) g.people.push(r);
      else groups.push({ key, cat: r.cat, date: r.date, what: r.what, people: [r] });
    }
    const all = groups;

    // Largura: a do quadro (mínimo 760px; abaixo disso o quadro rola para o lado).
    // Telas estreitas (celular): cada tela mostra 1,5 mês e o resto rola para o lado.
    const visible = host.parentElement.clientWidth;
    const W = visible < 600 ? Math.round(visible * TIMELINE_MONTHS / 1.5) : Math.max(visible, 760);
    const PAD = 14;
    const span = end - start;
    const xOf = d => PAD + (W - 2 * PAD) * Math.min(1, Math.max(0, (d - start) / span));
    // Rótulos alinhados à esquerda do mês (o dia não importa aqui); a marcação fica sob a 1ª foto.
    const LABEL_INSET = 6;
    const monthStart = d => xOf(new Date(d.getFullYear(), d.getMonth(), 1));

    // 1) Rótulos primeiro, para medir a largura de cada um.
    host.style.width = `${W}px`;
    // Um aluno por linha: foto e nome alinhados, um abaixo do outro.
    host.innerHTML = all.map(g => `
      <div class="tlx-label ${g.cat}">
        ${g.people.map(p => `
          <span class="tlx-row">
            ${avatarHtml(p.s, 'xs')}
            <button type="button" class="tlx-name" data-student="${esc(p.s.id)}" aria-label="${esc(p.tip)}" title="${esc(p.s.name)}">${g.cat === 'late' ? '⚠ ' : ''}${esc(shortName(p.s.name))}</button>
            ${p.codes.map(c => `<abbr class="tlx-code${c.late ? ' late' : ''}" title="${esc(c.name)}${c.late ? ' — vencido' : ''}">${c.code}</abbr>`).join('')}
          </span>`).join('')}
        <span class="tlx-what">${esc(g.what)}</span>
      </div>`).join('');
    const labels = [...host.querySelectorAll('.tlx-label')];
    // Cada rótulo cabe na largura do SEU mês (os meses têm larguras diferentes: fevereiro é menor).
    all.forEach((g, i) => {
      const m0 = new Date(g.date.getFullYear(), g.date.getMonth(), 1);
      const width = xOf(addMonths(m0, 1)) - xOf(m0) - LABEL_INSET - 4;
      labels[i].style.maxWidth = `${Math.floor(width)}px`;
    });

    // 2) Cada mês empilha seus rótulos de forma independente, do eixo para cima, bem juntos
    //    (os rótulos nunca passam da largura do mês, então meses vizinhos não se sobrepõem).
    const LGAP = 1;
    const HEAD = 30;
    const STEM = 12;
    const stackH = new Map(); // mês (posição x inicial) -> altura já empilhada
    all.forEach((it, i) => {
      const el = labels[i];
      it.left = monthStart(it.date) + LABEL_INSET;
      it.x = it.left + 14; // centro da primeira foto
      const used = stackH.get(it.left) || 0;
      it.rise = used + el.offsetHeight; // distância do topo do rótulo até a base da pilha
      stackH.set(it.left, used + el.offsetHeight + LGAP);
    });

    // 3) Posições verticais.
    const tallest = Math.max(0, ...stackH.values());
    const axisY = HEAD + tallest + STEM;
    host.style.height = `${axisY + STEM + 6}px`;

    all.forEach((it, i) => {
      const el = labels[i];
      const top = axisY - STEM - it.rise;
      el.style.left = `${it.left}px`;
      el.style.top = `${top}px`;
      it.stem = [top + el.offsetHeight, axisY - 7];
    });

    // 4) Eixo, meses, "hoje", hastes e círculos.
    const parts = [];
    // Faixas cinza-claro em meses alternados, para separar visualmente os meses.
    for (let m = 1; m < TIMELINE_MONTHS; m += 2) {
      const x0 = xOf(addMonths(start, m)), x1 = xOf(addMonths(start, m + 1));
      parts.push(`<div class="tlx-band" style="left:${x0}px;width:${x1 - x0}px"></div>`);
    }
    parts.push(`<div class="tlx-axis" style="top:${axisY}px"></div>`);
    parts.push(`<div class="tlx-past" style="top:${axisY}px;left:${PAD}px;width:${xOf(now) - PAD}px"></div>`);
    for (let m = 0; m <= TIMELINE_MONTHS; m++) {
      const d = addMonths(start, m);
      parts.push(`<div class="tlx-tick" style="left:${xOf(d)}px;top:${axisY - 10}px"></div>`);
      if (m < TIMELINE_MONTHS) {
        const mid = (xOf(d) + xOf(addMonths(start, m + 1))) / 2;
        const label = MONTH_NAMES[d.getMonth()] + (d.getMonth() === 0 || m === 0 ? ` ${d.getFullYear()}` : '');
        parts.push(`<div class="tlx-month${m === 0 ? ' now' : ''}" style="left:${mid}px">${label}</div>`);
      }
    }
    parts.push(`<div class="tlx-today" style="left:${xOf(now)}px;top:${axisY}px" title="Hoje: ${fmtDate(now)}"></div>`);
    // Uma haste e um círculo por mês: do eixo até o rótulo mais próximo da pilha
    // (rótulos têm fundo transparente, então hastes não podem passar por trás do texto).
    const byX = new Map();
    all.forEach(it => {
      const nearest = byX.get(it.x);
      if (!nearest || it.stem[0] > nearest.stem[0]) byX.set(it.x, it);
    });
    byX.forEach((it, x) => {
      parts.push(`<div class="tlx-stem" style="left:${x}px;top:${it.stem[0]}px;height:${axisY - 7 - it.stem[0]}px"></div>`);
      parts.push(`<div class="tlx-dot" style="left:${x}px;top:${axisY}px"></div>`);
    });
    host.insertAdjacentHTML('afterbegin', parts.join(''));

    if (!all.length) {
      host.insertAdjacentHTML('beforeend', `<div class="tlx-empty" style="top:${axisY + 20}px">Nenhum prazo nos próximos ${TIMELINE_MONTHS} meses.</div>`);
      host.style.height = `${axisY + 50}px`;
    }
  }

  // Redesenha a linha do tempo quando a largura do quadro muda.
  if ('ResizeObserver' in window) {
    let lastW = 0, raf = 0;
    new ResizeObserver(entries => {
      const w = Math.round(entries[0].contentRect.width);
      if (!w || w === lastW) return;
      lastW = w;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => renderTimeline());
    }).observe(document.querySelector('.tl-scroll'));
  }

  function renderDashboard() {
    renderProgramFilter();
    const analyzed = state.students
      .filter(s => parseDate(s.entry))
      .map(s => ({ s, a: analyze(s) }));
    renderSummary(analyzed);
    renderTimeline(analyzed);
    renderAlerts(analyzed);
    renderStudents(analyzed);
  }

  // ---------------------------------------------------------------- configuração
  function renderTable() {
    const editingId = $('#f-id').value;
    const rows = [...state.students].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    if (!rows.length) {
      $('#students-table').innerHTML = `<tr><td colspan="7" class="hint">Nenhum aluno cadastrado.</td></tr>`;
      return;
    }
    $('#students-table').innerHTML = rows.map(s => `
      <tr class="${s.id === editingId ? 'editing' : ''}">
        <td><div class="name-cell">${avatarHtml(s, 'sm')}<span>${esc(s.name)}${s.done ? ' <span class="badge">Concluído</span>' : ''}</span></div></td>
        <td>${tag(LEVEL_ACRONYM[s.level], LEVEL_LABEL[s.level], s.level === 'mestrado' ? 'ms' : 'ds')}</td>
        <td>${s.program ? tag(programAcronym(s.program), `Programa: ${s.program}`, 'prog') : '—'}</td>
        <td>${s.entry ? fmtDate(parseDate(s.entry)) : '—'}</td>
        <td class="theme">${esc(s.theme) || '—'}</td>
        <td>${s.notQualified ? 'Não' : 'Sim'}${usesPAA(s) ? ' <span class="hint">(PAA)</span>' : ''}</td>
        <td class="actions">
          <button class="btn small" data-edit="${esc(s.id)}">Editar</button>
          <button class="btn small danger" data-delete="${esc(s.id)}">Excluir</button>
        </td>
      </tr>`).join('');
  }

  function fillRulesForm() {
    const r = state.rules;
    $('#r-ms-total').value = r.msTotal;
    $('#r-ms-qual').value = r.msQual;
    $('#r-ds-total').value = r.dsTotal;
    $('#r-ds-qual').value = r.dsQual;
    $('#r-first').value = r.firstDraft;
    $('#r-final').value = r.finalDraft;
    $('#r-board').value = r.boardDraft ?? 2;
    $('#r-defense-drafts').checked = !!r.defenseDrafts;
    $('#r-window').value = r.alertWindow;
  }

  // Seleciona o programa no formulário; nomes fora da lista vão para "Outro…".
  function setProgramField(program) {
    const known = !program || PROGRAMS.includes(program);
    $('#f-program').value = known ? (program || PROGRAMS[0]) : OTHER_PROGRAM;
    $('#f-program-other').value = known ? '' : program;
    toggleProgramOther();
  }

  function toggleProgramOther() {
    const other = $('#f-program').value === OTHER_PROGRAM;
    $('#f-program-other-wrap').hidden = !other;
    $('#f-program-other').required = other;
  }

  // ---------------------------------------------------------------- foto
  const PHOTO_SIZE = 200; // px — mantém cada foto com ~10–20 KB no localStorage
  let pendingPhoto = '';

  // Silhueta genérica para alunos sem foto.
  const GENERIC_PHOTO = `<svg viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="25" r="12"/>
    <path d="M8 64c0-14 10.7-24 24-24s24 10 24 24z"/>
  </svg>`;

  // Na versão publicada, as fotos do site do LBS são trocadas por cópias locais (window.LBS_FOTOS,
  // gerado pelo publicar.py), porque o ambiente bloqueia imagens de outros sites.
  function photoSrc(url) {
    const map = window.LBS_FOTOS;
    return (map && map[url]) || url;
  }

  function avatarHtml(s, size) {
    if (s.photo) return `<img class="avatar ${size}" src="${esc(photoSrc(s.photo))}" alt="Foto de ${esc(s.name)}">`;
    return `<div class="avatar generic ${size}" title="Sem foto">${GENERIC_PHOTO}</div>`;
  }

  function renderPhotoPreview() {
    const box = $('#f-photo-preview');
    box.innerHTML = pendingPhoto
      ? `<img src="${esc(photoSrc(pendingPhoto))}" alt="Pré-visualização da foto">`
      : GENERIC_PHOTO;
    box.classList.toggle('generic', !pendingPhoto);
    $('#f-photo-remove').hidden = !pendingPhoto;
  }

  // Lê a imagem, recorta no centro em quadrado e reduz para PHOTO_SIZE.
  function resizePhoto(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - side) / 2;
        const sy = (img.naturalHeight - side) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = PHOTO_SIZE;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);
        ctx.drawImage(img, sx, sy, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('imagem inválida')); };
      img.src = url;
    });
  }

  // ---------------------------------------------------------------- requisitos
  // Número de anos do doutorado (um checkbox de publicação por ano).
  function pubYears(rules = state.rules) {
    return Math.max(1, Math.ceil(Number(rules.dsTotal) / 12));
  }

  function renderPubChecks(s = {}) {
    const pubs = pubFlags(s);
    $('#f-pubs').innerHTML = `
      <div class="pub-grid" role="group" aria-label="Publicações por ano">
        <span></span><span class="pub-col">1º autor</span><span class="pub-col">Coautor (grupo)</span>
        ${Array.from({ length: pubYears() }, (_, i) => `
          <span class="pub-year">Ano ${i + 1}${i === 0 ? ' <span class="hint">(pôster aceito)</span>' : ''}</span>
          <label class="pub-cell"><input type="checkbox" data-pub-first="${i}" ${pubs.first[i] ? 'checked' : ''}
            aria-label="Ano ${i + 1}: publicação como 1º autor"></label>
          <label class="pub-cell"><input type="checkbox" data-pub-co="${i}" ${pubs.co[i] ? 'checked' : ''}
            aria-label="Ano ${i + 1}: publicação como coautor com o grupo"></label>`).join('')}
      </div>`;
  }


  // Esconde a etapa de qualificação se o aluno já qualificou e a de defesa se já defendeu.
  function toggleStageFields() {
    const paa = usesPAA({ level: $('#f-level').value, program: currentProgramValue() });
    // Banca de qualificação: só no doutorado.
    $('#f-qualScheduled').closest('label').hidden = $('#f-level').value === 'mestrado';
    $('#f-notqualified-label').textContent = paa ? 'Ainda não foi aprovado em PAA' : 'Ainda não qualificou';
    $('#f-stage-qual').hidden = paa || !$('#f-notqualified').checked;
    $('#f-stage-def').hidden = $('#f-done').checked;
  }

  function currentProgramValue() {
    return $('#f-program').value === OTHER_PROGRAM ? $('#f-program-other').value.trim() : $('#f-program').value;
  }

  function toggleReqFields() {
    const ms = $('#f-level').value === 'mestrado';
    $('#f-req-ms').hidden = !ms;
    $('#f-req-ds').hidden = ms;
  }

  // Situação de cada ano de publicação do doutorado.
  function pubStatus(s, a) {
    const pubs = pubFlags(s);
    return Array.from({ length: pubYears() }, (_, i) => {
      const start = i === 0 ? a.entry : addDays(periodEnd(a.entry, 12 * i), 1);
      const end = periodEnd(a.entry, 12 * (i + 1));
      const first = !!pubs.first[i];
      const co = !!pubs.co[i];
      let status = 'future';
      if (first && co) status = 'ok';
      else if (a.now >= end) status = 'warn';
      else if (a.now >= start) status = 'current';
      return { year: i + 1, start, end, first, co, status };
    });
  }


  // Botão "?" que abre a explicação sobre publicações.
  function helpHtml() {
    return `<details class="help"><summary aria-label="Ajuda sobre publicações" data-tip="Ajuda">?</summary><p>${esc(PUB_HELP)}</p></details>`;
  }

  function requirementsHtml(s, a) {
    if (s.level === 'mestrado') {
      return s.congress
        ? '<span class="req-item ok">✓ Participou de pelo menos 1 congresso</span>'
        : `<span class="req-item ${!s.notQualified ? 'warn' : 'pending'}">✗ Ainda não participou de congresso${!s.notQualified ? ` (${qualTerms(s).did.toLowerCase()})` : ''}</span>`;
    }
    const mark = ok => (ok ? '✓' : '✗');
    return `<div class="req-list">${pubStatus(s, a).map(p => {
      const period = `${fmtDate(p.start)} a ${fmtDate(p.end)}`;
      const parts = `1º autor ${mark(p.first)} · coautor ${mark(p.co)}`;
      const text = {
        ok: `✓ Ano ${p.year}: ${parts}`,
        warn: `⚠ Ano ${p.year}: ${parts}`,
        current: `Ano ${p.year} (em andamento, até ${fmtDate(p.end)}): ${parts}`,
        future: `Ano ${p.year}: ainda não começou`,
      }[p.status];
      return `<span class="req-item ${p.status === 'current' ? 'pending' : p.status}" data-tip="Ano ${p.year}: ${period}">${text}</span>`;
    }).join('')}</div>${helpHtml()}`;
  }

  function resetForm() {
    $('#student-form').reset();
    pendingPhoto = '';
    renderPhotoPreview();
    setProgramField('');
    $('#f-id').value = '';
    $('#f-notqualified').checked = true;
    renderPubChecks();
    toggleReqFields();
    toggleStageFields();
    $('#form-title').textContent = 'Adicionar aluno';
    $('#f-submit').textContent = 'Adicionar';
    $('#f-cancel').hidden = true;
    renderTable();
  }

  function startEdit(id) {
    const s = state.students.find(x => x.id === id);
    if (!s) return;
    closeDetails();
    showView('config');
    $('#f-id').value = s.id;
    $('#f-name').value = s.name;
    $('#f-level').value = s.level;
    setProgramField(s.program);
    $('#f-entry').value = s.entry;
    $('#f-advisor').value = s.advisor || '';
    $('#f-theme').value = s.theme || '';
    $('#f-notqualified').checked = !!s.notQualified;
    $('#f-done').checked = !!s.done;
    $('#f-notes').value = s.notes || '';
    $('#f-congress').checked = !!s.congress;
    renderPubChecks(s);
    toggleReqFields();
    for (const f of STAGE_FLAGS) $(`#f-${f}`).checked = !!s[f];
    toggleStageFields();
    pendingPhoto = s.photo || '';
    renderPhotoPreview();
    $('#form-title').textContent = `Editar: ${s.name}`;
    $('#f-submit').textContent = 'Salvar alterações';
    $('#f-cancel').hidden = false;
    renderTable();
    $('#f-name').focus();
    $('#student-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function render() {
    renderDashboard();
    renderTable();
  }

  // ---------------------------------------------------------------- navegação
  function showView(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
    if (name === 'painel') renderDashboard();
  }

  // ---------------------------------------------------------------- dados de exemplo
  function sampleStudents() {
    const t = today();
    const ago = months => toISO(addMonths(t, -months));
    return [
      { name: 'Ana Souza (exemplo)', level: 'mestrado', entry: ago(17), advisor: 'Prof. Orientador A', theme: 'Detecção de anomalias em séries temporais biomédicas', notQualified: true },
      { name: 'Bruno Lima (exemplo)', level: 'mestrado', program: 'Ciência da Computação', entry: ago(20), advisor: 'Prof. Orientador B', theme: 'Aprendizado federado para dados de saúde', notQualified: true },
      { name: 'Carla Mendes (exemplo)', level: 'doutorado', entry: ago(30), advisor: 'Prof. Orientador A', theme: 'Modelos de linguagem para análise de prontuários', notQualified: false },
      { name: 'Daniel Rocha (exemplo)', level: 'doutorado', program: 'Engenharia Elétrica', entry: ago(22), advisor: 'Prof. Orientador C', theme: 'Redes complexas aplicadas à epidemiologia', notQualified: true },
      { name: 'Eduarda Alves (exemplo)', level: 'doutorado', entry: ago(49), advisor: 'Prof. Orientador B', theme: 'Bioinformática estrutural de proteínas', notQualified: false, notes: 'Pedido de prorrogação em análise.' },
      { name: 'Felipe Costa (exemplo)', level: 'mestrado', program: 'Ciência da Computação', entry: ago(6), advisor: 'Prof. Orientador C', theme: '', notQualified: true },
    ].map(s => ({ id: uid(), done: false, notes: '', program: 'Bioinformática', ...s }));
  }

  // ---------------------------------------------------------------- eventos
  document.querySelectorAll('.tab').forEach(tab =>
    tab.addEventListener('click', () => showView(tab.dataset.view)));

  ['#filter-level', '#filter-program', '#filter-status', '#sort-by'].forEach(sel =>
    $(sel).addEventListener('change', renderDashboard));
  $('#search').addEventListener('input', renderDashboard);

  // Alunos por linha (preferência de quem está vendo, guardada só neste navegador).
  const COLS_KEY = 'lbs-acompanhamento-colunas';
  function setCols(n) {
    $('#students').dataset.cols = n;
    document.querySelectorAll('.seg [data-cols]').forEach(b => b.setAttribute('aria-pressed', b.dataset.cols === String(n)));
    try { localStorage.setItem(COLS_KEY, n); } catch { /* sem armazenamento: vale só nesta visita */ }
  }
  document.querySelectorAll('.seg [data-cols]').forEach(b => b.addEventListener('click', () => setCols(b.dataset.cols)));
  {
    let saved = null;
    try { saved = localStorage.getItem(COLS_KEY); } catch { /* ignora */ }
    setCols(['1', '3', '4', '6'].includes(saved) ? saved : '3');
  }

  // Logo: volta para a página inicial (Painel, no topo).
  $('#home-link').addEventListener('click', e => {
    e.preventDefault();
    closeDetails();
    setNotifOpen(false);
    showView('painel');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Clique fora da janela (no fundo escurecido) fecha os detalhes.
  $('#details-dialog').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeDetails();
  });

  // Exportar → mensagem do mês para o WhatsApp
  $('#export-menu-btn').addEventListener('click', () => {
    setNotifOpen(false);
    setExportMenuOpen($('#export-menu').hidden);
  });
  $('#wa-open').addEventListener('click', () => setExportMenuOpen(false));

  $('#bell').addEventListener('click', e => {
    e.stopPropagation();
    setExportMenuOpen(false);
    setNotifOpen($('#notif-panel').hidden);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#export-menu').hidden) {
      setExportMenuOpen(false);
      $('#export-menu-btn').focus();
    }
    if (e.key === 'Escape' && !$('#notif-panel').hidden) {
      setNotifOpen(false);
      $('#bell').focus();
    }
  });

  document.addEventListener('click', e => {
    const alertBtn = e.target.closest('[data-student]');
    if (alertBtn) return focusStudent(alertBtn.dataset.student);
    if (!e.target.closest('.notif')) setNotifOpen(false);
    if (!e.target.closest('#export-wrap')) setExportMenuOpen(false);

    const details = e.target.closest('[data-details]');
    if (details) return openDetails(details.dataset.details);

    if (e.target.closest('[data-close]')) return closeDetails();

    const edit = e.target.closest('[data-edit]');
    if (edit) return startEdit(edit.dataset.edit);

    const del = e.target.closest('[data-delete]');
    if (del) {
      const s = state.students.find(x => x.id === del.dataset.delete);
      if (!s) return;
      askConfirm(`Excluir ${s.name}? Esta ação não pode ser desfeita.`, 'Excluir', true).then(yes => {
        if (!yes) return;
        state.students = state.students.filter(x => x.id !== s.id);
        save();
        if ($('#f-id').value === s.id) resetForm();
        render();
        toast('Aluno excluído.');
      });
      return;
    }

    const go = e.target.closest('[data-goto]');
    if (go) showView(go.dataset.goto);
  });

  $('#student-form').addEventListener('submit', e => {
    e.preventDefault();
    const id = $('#f-id').value;
    const data = {
      name: $('#f-name').value.trim(),
      level: $('#f-level').value,
      program: $('#f-program').value === OTHER_PROGRAM
        ? $('#f-program-other').value.trim()
        : $('#f-program').value,
      entry: $('#f-entry').value,
      advisor: $('#f-advisor').value.trim(),
      theme: $('#f-theme').value.trim(),
      notQualified: $('#f-notqualified').checked,
      done: $('#f-done').checked,
      notes: $('#f-notes').value.trim(),
      photo: pendingPhoto,
      congress: $('#f-congress').checked,
      pubsFirst: [...document.querySelectorAll('#f-pubs [data-pub-first]')].map(c => c.checked),
      pubsCo: [...document.querySelectorAll('#f-pubs [data-pub-co]')].map(c => c.checked),
      ...Object.fromEntries(STAGE_FLAGS.map(f => [f, $(`#f-${f}`).checked])),
    };
    if (!data.name || !parseDate(data.entry)) {
      toast('Informe nome e data de entrada.');
      return;
    }
    if (!data.program) {
      toast('Informe o nome do programa de pós-graduação.');
      $('#f-program-other').focus();
      return;
    }
    const before = state.students;
    state.students = id
      ? state.students.map(x => (x.id === id ? { ...x, ...data } : x))
      : [...state.students, { id: uid(), ...data }];
    if (!save()) {
      state.students = before; // não perde o formulário se o navegador recusar salvar
      return;
    }
    toast(id ? 'Alterações salvas.' : 'Aluno adicionado.');
    resetForm();
    render();
  });

  $('#f-cancel').addEventListener('click', resetForm);
  $('#f-level').addEventListener('change', () => { toggleReqFields(); toggleStageFields(); });
  $('#f-notqualified').addEventListener('change', toggleStageFields);
  $('#f-done').addEventListener('change', toggleStageFields);
  $('#f-photo').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      pendingPhoto = await resizePhoto(file);
      renderPhotoPreview();
    } catch {
      toast('Não foi possível ler a imagem. Use JPG, PNG ou WebP.');
    }
  });
  $('#f-photo-remove').addEventListener('click', () => {
    pendingPhoto = '';
    renderPhotoPreview();
  });
  $('#f-program').addEventListener('change', () => {
    toggleStageFields();
    toggleProgramOther();
    if ($('#f-program').value === OTHER_PROGRAM) $('#f-program-other').focus();
  });

  // "Regras e prazos" fica escondido até clicar no botão.
  function setRulesOpen(open) {
    $('#rules-card').hidden = !open;
    $('#config-grid').classList.toggle('rules-open', open);
    $('#rules-toggle').setAttribute('aria-expanded', open);
    if (open) $('#rules-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  $('#rules-toggle').addEventListener('click', () => setRulesOpen($('#rules-card').hidden));
  $('#rules-close').addEventListener('click', () => { setRulesOpen(false); $('#rules-toggle').focus(); });

  $('#rules-form').addEventListener('submit', e => {
    e.preventDefault();
    const num = (sel, min) => Math.max(min, parseInt($(sel).value, 10) || 0);
    const r = {
      msTotal: num('#r-ms-total', 1),
      msQual: num('#r-ms-qual', 1),
      dsTotal: num('#r-ds-total', 1),
      dsQual: num('#r-ds-qual', 1),
      firstDraft: num('#r-first', 0),
      finalDraft: num('#r-final', 0),
      boardDraft: num('#r-board', 0),
      defenseDrafts: $('#r-defense-drafts').checked,
      alertWindow: num('#r-window', 1),
    };
    if (r.msQual > r.msTotal || r.dsQual > r.dsTotal) {
      toast('A qualificação não pode ser depois do prazo final.');
      return;
    }
    if (!(r.firstDraft >= r.boardDraft && r.boardDraft >= r.finalDraft)) {
      toast('Ordem esperada (meses antes): 1ª versão ≥ banca marcada ≥ versão final.');
      return;
    }
    state.rules = { ...r, boardRuleV3: true };
    save();
    render();
    toast('Regras salvas.');
  });

  $('#r-reset').addEventListener('click', () => {
    state.rules = { ...DEFAULT_RULES };
    save();
    fillRulesForm();
    render();
    toast('Regras restauradas para o padrão.');
  });

  // Exportar: mostra o JSON numa janela (copiar sempre funciona; baixar depende do ambiente).
  $('#btn-export').addEventListener('click', () => {
    $('#export-text').value = JSON.stringify(state, null, 2);
    $('#export-dialog').showModal();
    $('#export-copy').focus();
  });
  $('#export-close').addEventListener('click', () => $('#export-dialog').close());
  $('#export-copy').addEventListener('click', () => {
    const text = $('#export-text').value;
    const fallback = () => {
      $('#export-text').select();
      toast('Texto selecionado. Use Ctrl+C (ou Cmd+C) para copiar.');
    };
    try {
      navigator.clipboard.writeText(text).then(() => toast('JSON copiado.'), fallback);
    } catch {
      fallback();
    }
  });
  // (o botão não existe na versão publicada no claude.ai, onde downloads são bloqueados)
  $('#export-download')?.addEventListener('click', () => {
    try {
      const blob = new Blob([$('#export-text').value], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `acompanhamento-lbs-${toISO(today())}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch {
      toast('Download indisponível aqui. Use “Copiar”.');
    }
  });

  $('#btn-import').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const students = Array.isArray(data) ? data : data.students;
      if (!Array.isArray(students)) throw new Error('formato inválido');
      const clean = students
        .filter(s => s && s.name && parseDate(s.entry))
        .map(s => ({
          id: s.id || uid(),
          name: String(s.name),
          level: s.level === 'doutorado' ? 'doutorado' : 'mestrado',
          program: s.program ? String(s.program) : '',
          entry: s.entry,
          advisor: s.advisor || '',
          theme: s.theme || '',
          notQualified: s.notQualified !== false,
          done: !!s.done,
          notes: s.notes || '',
          photo: typeof s.photo === 'string' && /^(data:image\/|https:\/\/|assets\/fotos\/)/.test(s.photo) ? s.photo : '',
          congress: !!s.congress,
          pubsFirst: (Array.isArray(s.pubsFirst) ? s.pubsFirst : Array.isArray(s.pubs) ? s.pubs : []).map(Boolean),
          pubsCo: Array.isArray(s.pubsCo) ? s.pubsCo.map(Boolean) : [],
          ...Object.fromEntries(STAGE_FLAGS.map(f => [f, !!s[f]])),
        }));
      if (!await askConfirm(`Importar ${clean.length} aluno(s)? Os dados atuais serão substituídos.`, 'Importar', true)) return;
      state.students = clean;
      if (!Array.isArray(data) && data.rules) state.rules = { ...DEFAULT_RULES, ...data.rules };
      save();
      fillRulesForm();
      resetForm();
      render();
      toast('Dados importados.');
    } catch (err) {
      toast('Arquivo inválido: ' + err.message);
    }
  });

  $('#btn-sample').addEventListener('click', async () => {
    if (state.students.length && !await askConfirm('Adicionar alunos de exemplo (fictícios) à lista atual?', 'Adicionar')) return;
    state.students.push(...sampleStudents());
    save();
    render();
    toast('Exemplos carregados.');
  });

  // ---------------------------------------------------------------- acesso (senha + dados cifrados)
  // Os dados dos alunos ficam cifrados (AES-256-GCM) em dados-lbs.enc.js; a chave é derivada da
  // senha (PBKDF2-SHA256). A senha não está no código: ela é conferida ao decifrar os dados.
  // "Manter conectado" guarda a chave (não a senha) neste navegador por 30 dias.
  const AUTH_KEY = 'lbs-acompanhamento-acesso';
  const AUTH_DAYS = 30;

  const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const toB64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));

  async function keyFromPassword(password) {
    const meta = window.LBS_DADOS_CRIPTO;
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: fromB64(meta.salt), iterations: meta.iter, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, true, ['decrypt'],
    );
  }

  async function decryptSeed(key) {
    const meta = window.LBS_DADOS_CRIPTO;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(meta.iv) }, key, fromB64(meta.data));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  function savedAccess() {
    try {
      const remembered = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
      if (remembered && remembered.until > Date.now() && remembered.key) return remembered.key;
      const session = JSON.parse(sessionStorage.getItem(AUTH_KEY) || 'null');
      if (session && session.key) return session.key;
    } catch { /* sem armazenamento: pede a senha a cada visita */ }
    return null;
  }

  function clearAccess() {
    try {
      localStorage.removeItem(AUTH_KEY);
      sessionStorage.removeItem(AUTH_KEY);
    } catch { /* ignora */ }
  }

  function setLocked(locked) {
    $('#gate').hidden = !locked;
    // Enquanto bloqueado, o site atrás da tela não recebe foco nem cliques.
    document.querySelectorAll('body > header, body > main').forEach(el => { el.inert = locked; });
    if (locked) setTimeout(() => $('#gate-pass').focus(), 0);
  }

  // Decifra os dados iniciais, carrega o estado e mostra o site.
  async function unlock(key) {
    window.LBS_DADOS_INICIAIS = await decryptSeed(key);
    state = load();
    fillRulesForm();
    resetForm();
    render();
    setLocked(false);
    renderTimeline(); // mede a largura de novo, agora visível
  }

  $('#gate-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!window.crypto?.subtle) {
      $('#gate-error').textContent = 'Este navegador não permite abrir os dados aqui. Acesse pelo endereço https.';
      $('#gate-error').hidden = false;
      return;
    }
    const button = $('#gate-form button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Verificando…';
    try {
      const key = await keyFromPassword($('#gate-pass').value);
      await unlock(key); // senha errada → a decifragem falha
      const raw = toB64(await crypto.subtle.exportKey('raw', key));
      try {
        if ($('#gate-remember').checked) {
          localStorage.setItem(AUTH_KEY, JSON.stringify({ until: Date.now() + AUTH_DAYS * DAY, key: raw }));
        } else {
          sessionStorage.setItem(AUTH_KEY, JSON.stringify({ key: raw })); // só até fechar o navegador
        }
      } catch { /* sem armazenamento: vale só nesta página */ }
      $('#gate-error').hidden = true;
      $('#gate-pass').value = '';
    } catch (err) {
      if (err?.name !== 'OperationError') console.error(err); // OperationError = senha errada
      $('#gate-error').textContent = 'Senha incorreta. Tente novamente.';
      $('#gate-error').hidden = false;
      $('#gate-pass').select();
    } finally {
      button.disabled = false;
      button.textContent = 'Entrar';
    }
  });

  $('#logout-btn').addEventListener('click', () => {
    clearAccess();
    closeDetails();
    setNotifOpen(false);
    setExportMenuOpen(false);
    setLocked(true);
  });

  // Ao abrir: se este navegador já está conectado, decifra direto; senão, pede a senha.
  async function startup() {
    const raw = savedAccess();
    if (raw && window.crypto?.subtle) {
      try {
        const key = await crypto.subtle.importKey('raw', fromB64(raw), 'AES-GCM', false, ['decrypt']);
        await unlock(key);
        return;
      } catch {
        clearAccess(); // chave antiga (ex.: dados cifrados de novo com outra senha)
      }
    }
    setLocked(true);
  }


  // ---------------------------------------------------------------- início
  fillRulesForm();
  renderPhotoPreview();
  renderPubChecks();
  toggleReqFields();
  toggleStageFields();
  render();
  startup();
})();
