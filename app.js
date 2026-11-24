// PedalConfig - interface
// Organizacao: barra de cima (conexao + gravar) | esquerda: presets e ajustes do pedal |
// centro: o preset como o pedal de verdade (visor + 8 botoes) | direita: edicao do botao escolhido.
'use strict';

// ---------------- estado ----------------
let cfg = PM.factory();            // o que esta sendo editado (JSON = fonte de verdade)
let pedalCfg = null;               // ultimo lido/gravado no pedal (para saber se ha mudancas e para o diff)
let pedalInfo = null;              // { fw, schema } do pedal conectado
let sel = { view: 'preset', preset: 0, sw: 0 };
let mode = 'edit';                 // 'edit' = clicar escolhe o botao; 'test' = clicar pisa no botao (simulador)
let learning = null;               // { msg, redraw }
let livePreset = null;             // preset atual no pedal (quando conectado)

const $ = id => document.getElementById(id);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
}
const ICON = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  fixed: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 12h6M12 9v6"/>',
  display: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h4M7 14h10"/>',
  expr: '<path d="M4 18 18 6"/><path d="M4 18h16"/><circle cx="18" cy="6" r="2"/>',
  combo: '<circle cx="8" cy="12" r="4"/><circle cx="16" cy="12" r="4"/>',
  banks: '<rect x="3" y="4" width="8" height="16" rx="1.5"/><rect x="13" y="4" width="8" height="16" rx="1.5"/>',
  midi: '<circle cx="12" cy="12" r="8"/><circle cx="8.5" cy="11" r=".9"/><circle cx="15.5" cy="11" r=".9"/><circle cx="12" cy="8" r=".9"/><circle cx="10" cy="15" r=".9"/><circle cx="14" cy="15" r=".9"/>',
  wire: '<path d="M4 7h6v10h4V7h6"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  alert: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17v.5"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>', down: '<path d="M12 5v14M6 13l6 6 6-6"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V4h12"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
};
const icon = (n, s = 16) => h('span', { style: 'display:inline-flex', html: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[n]}</svg>` });

const toastEl = $('toast'); let toastT;
function toast(t) { toastEl.textContent = t; toastEl.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 3500); }

// rascunho local (so conveniencia; a fonte de verdade e o arquivo JSON / o pedal)
const DRAFT = 'pedalconfig.draft';
function saveDraft() { try { localStorage.setItem(DRAFT, JSON.stringify(cfg)); } catch (e) {} }
function loadDraft() { try { const s = localStorage.getItem(DRAFT); if (s) cfg = PM.normalize(JSON.parse(s)); } catch (e) {} }

function changed(full) {
  saveDraft(); updateMeter(); updateDirty();
  if (full) render(); else { renderNav(); refreshPads(); }
}
const clean3 = v => PM.ascii(v).toUpperCase().replace(/[^ -Z]/g, '').slice(0, 3);

// ---------------- topo: memoria e "nao gravado" ----------------
function updateMeter() {
  const r = PM.pack(cfg), m = $('meter');
  m.classList.remove('full', 'near');
  if (r.errors.length) {
    const mem = r.errors.find(e => e.where === 'Memória');
    $('meterText').textContent = mem ? 'Memória cheia' : `${r.errors.length} problema(s) para corrigir`;
    m.classList.add('full'); $('meterBar').style.width = '100%';
    m.title = r.errors.map(e => `${e.where}: ${e.text}`).join('\n');
  } else {
    const pct = Math.round(r.used / PM.CFG_END * 100);
    $('meterText').textContent = `Memória do pedal · ${pct}% usada`;
    $('meterBar').style.width = pct + '%';
    if (pct > 85) m.classList.add('near');
    m.title = `${r.used} de ${PM.CFG_END} bytes`;
  }
  return r;
}
function updateDirty() {
  const dirty = !!pedalCfg && JSON.stringify(cfg) !== JSON.stringify(pedalCfg);
  $('dirtyDot').hidden = !dirty;
}

// ---------------- navegacao ----------------
const SETTINGS = [
  ['banks', 'Bancos', 'banks'], ['fixed', 'Botões fixos', 'fixed'], ['display', 'Visor', 'display'], ['expression', 'Pedal de expressão', 'expr'],
  ['combos', 'Combos', 'combo'], ['midi', 'MIDI e tempos', 'midi'], ['hardware', 'Ligações', 'wire'], ['file', 'Arquivo e backup', 'file'],
];
function renderNav() {
  const nav = $('nav'); nav.textContent = '';
  const presets = h('div', { class: 'navgroup' },
    h('div', { class: 'navhead' }, h('span', { class: 'eyebrow' }, 'Presets'),
      h('button', { class: 'btn small ghost', title: 'Novo preset', onclick: addPreset, disabled: cfg.presets.length >= PM.MAX_PRESETS }, icon('plus', 14), 'Novo')),
    cfg.presets.map((p, i) => {
      const ppb = cfg.global.presetsPerBank, banks = cfg.presets.length > ppb;
      return [banks && i % ppb === 0 ? h('div', { class: 'bankhead' }, `Banco ${i / ppb + 1}`) : null,
        h('button', {
          class: 'navitem' + (sel.view === 'preset' && sel.preset === i ? ' active' : ''),
          onclick: () => { sel = { view: 'preset', preset: i, sw: sel.sw }; render(); },
        }, h('span', { class: 'num' }, String(banks ? i % ppb + 1 : i + 1)), h('span', { class: 'nm' }, p.name || 'sem nome'),
          livePreset === i ? h('span', { class: 'live', title: 'É o preset que está tocando no pedal agora' }) : null,
          h('span', { class: 'sc', title: 'Sigla no modo MOD' }, (p.short || '').padEnd(3, ' ')))];
    }));
  const other = h('div', { class: 'navgroup' }, h('div', { class: 'navhead' }, h('span', { class: 'eyebrow' }, 'Pedal')),
    SETTINGS.map(([v, t, ic]) => h('button', { class: 'navitem' + (sel.view === v ? ' active' : ''), onclick: () => { sel.view = v; render(); } }, icon(ic), h('span', { class: 'nm' }, t))));
  nav.append(presets, other);
}

function addPreset() {
  if (cfg.presets.length >= PM.MAX_PRESETS) return toast(`Máximo de ${PM.MAX_PRESETS} presets.`);
  const n = cfg.presets.length + 1;
  cfg.presets.push(PM.newPreset('PRESET ' + n, 'P' + n));
  sel = { view: 'preset', preset: cfg.presets.length - 1, sw: 0 };
  changed(true);
}
function movePreset(i, d) {
  const old = cfg.presets.slice();
  const p = cfg.presets.splice(i, 1)[0]; cfg.presets.splice(i + d, 0, p); sel.preset = i + d;
  fixRefs(old); changed(true);
}
// Referencias a presets sao por numero (camada 2, preset ao ligar, "ir para preset").
// Depois de mover/duplicar/apagar, renumera para continuar apontando para o MESMO preset.
function fixRefs(old) {
  const n = cfg.presets.length;
  const map = num => { if (!old) return num; const k = cfg.presets.indexOf(old[num - 1]); return k >= 0 ? k + 1 : 0; };
  cfg.presets.forEach((p, k) => { p.layer = p.layer ? map(p.layer) : 0; if (p.layer > n || p.layer === k + 1) p.layer = 0; });
  const sp = map(cfg.global.startPreset); cfg.global.startPreset = sp >= 1 && sp <= n ? sp : 1;
  const msgs = [cfg.combos.map(c => c.action), cfg.global.fixed.tap, cfg.global.fixed.tunerOn, cfg.global.fixed.tunerOff,
    cfg.presets.map(p => [p.enter, ...p.switches.map(s => PM.EVENTS.map(e => s[e] || []))])].flat(4);
  msgs.forEach(m => { if (m && m.type === 'pedal' && m.op === 'preset' && m.value) { const v = map(m.value); m.value = v || 1; } });
}

// ---------------- ajudantes de botoes ----------------
const fx = () => cfg.global.fixed;
const isMode = i => i === fx().modeSwitch - 1, isTap = i => i === fx().tapSwitch - 1, isFixed = i => isMode(i) || isTap(i);
const top1to4 = () => cfg.global.display.topRow === '1-4';
const swAt = (row, k) => ((row === 0) === top1to4()) ? k : 4 + k;           // igual ao firmware
const BEH = [['toggle', 'Liga/desliga'], ['momentary', 'Momentâneo'], ['macro', 'Disparo'], ['step', 'Sequência']];
const BEH_DESC = {
  toggle: 'Cada pisada alterna: liga na 1ª, desliga na 2ª. A sigla fica invertida enquanto estiver ligado. Ideal para efeitos.',
  momentary: 'Liga enquanto o pé está em cima e desliga ao soltar. Bom para boost, freeze ou “segurar”.',
  macro: 'Cada pisada manda as mesmas mensagens, em ordem. Bom para trocar de patch, cena ou várias coisas de uma vez.',
  step: 'Cada pisada manda a próxima mensagem da lista (1, 2, 3, 1…). Bom para percorrer cenas ou valores.',
};
const BEH_TAG = { toggle: 'liga/desliga', momentary: 'momentâneo', macro: 'disparo', step: 'sequência' };
function padSummary(sw) {
  const p = sw.press, r = sw.release, extra = [];
  if (sw.hold.length) extra.push('segurar'); if (sw.doubleTap.length) extra.push('2 toques'); if (sw.tap) extra.push('tap');
  let s = null;
  if (p.length === 1 && r.length === 1 && p[0].type === 'cc' && r[0].type === 'cc' && p[0].number === r[0].number) s = `CC ${p[0].number} · ${p[0].value} / ${r[0].value}`;
  else if (p.length) s = PM.describeList(p);
  else if (r.length) s = 'ao soltar: ' + PM.describeList(r);
  if (!s && !extra.length) return null;
  return [s, extra.length ? '+ ' + extra.join(', ') : null].filter(Boolean).join(' ');
}

// ---------------- pagina do preset ----------------
function renderPreset(main) {
  const i = sel.preset, pr = cfg.presets[i];
  // cabecalho: nome (tela inteira na troca) + sigla (modo MOD) + menu
  const menuPop = h('div', { class: 'pop', hidden: true });
  const menuItem = (ic, t, fn, dis, cls) => h('button', { class: 'btn ghost' + (cls ? ' ' + cls : ''), disabled: dis, onclick: () => { menuPop.hidden = true; fn(); } }, icon(ic), t);
  menuPop.append(
    menuItem('copy', 'Duplicar preset', () => { if (cfg.presets.length >= PM.MAX_PRESETS) return toast('Sem espaço para mais presets.'); const c = JSON.parse(JSON.stringify(pr)), old = cfg.presets.slice(); cfg.presets.splice(i + 1, 0, c); sel.preset = i + 1; fixRefs(old); changed(true); }, cfg.presets.length >= PM.MAX_PRESETS),
    menuItem('up', 'Mover para cima', () => movePreset(i, -1), i === 0),
    menuItem('down', 'Mover para baixo', () => movePreset(i, 1), i === cfg.presets.length - 1),
    menuItem('trash', 'Apagar preset', () => { if (!confirm(`Apagar o preset ${i + 1} (${pr.name})?`)) return; const old = cfg.presets.slice(); cfg.presets.splice(i, 1); sel.preset = Math.max(0, i - 1); fixRefs(old); changed(true); }, cfg.presets.length === 1, 'danger'));
  const shortIn = h('input', { type: 'text', class: 'code3', maxlength: 3, value: pr.short, title: 'Aparece no lugar do botão quando você aperta MOD',
    oninput: e => { const v = clean3(e.target.value); if (v !== e.target.value) e.target.value = v; pr.short = v; changed(); } });
  main.append(h('div', { class: 'preset-head' },
    h('div', { class: 'field' }, h('span', { class: 'eyebrow' }, `Preset ${i + 1}`),
      h('input', { type: 'text', class: 'name-input', maxlength: PM.NAME_LEN, value: pr.name, placeholder: 'NOME DO PRESET', spellcheck: 'false',
        oninput: e => { pr.name = PM.ascii(e.target.value).toUpperCase(); changed(); } }),
      h('span', { class: 'hint' }, `Até ${PM.NAME_LEN} letras. Aparece na tela inteira quando você troca para este preset.`)),
    h('label', { class: 'field' }, h('span', {}, 'Sigla'), shortIn, h('span', { class: 'sub' }, 'no modo MOD')),
    h('div', { class: 'menu' }, h('button', { class: 'btn icon', title: 'Mais opções', onclick: e => { e.stopPropagation(); menuPop.hidden = !menuPop.hidden; } }, icon('more')), menuPop)));

  main.append(deviceCard(pr, i), enterCard(pr, i));
}

// visor + 8 botoes, na mesma posicao do pedal
function deviceCard(pr, idx) {
  simFor(pr, idx);
  const canvas = h('canvas', { class: 'lcd', id: 'lcd', title: 'Como vai ficar no visor do pedal' });
  const seg = h('div', { class: 'seg' }, [['edit', 'Editar'], ['test', 'Testar']].map(([m, t]) =>
    h('button', { class: mode === m ? 'on' : '', onclick: () => { mode = m; sim = null; render(); } }, t)));
  const hint = mode === 'edit' ? 'Clique num botão para editar.' : 'Clique para pisar. TAP: clique no ritmo; segure para o afinador.';
  return h('div', { class: 'device' },
    h('div', { class: 'device-bar' }, h('span', { class: 'eyebrow' }, 'Pedal'), seg,
      mode === 'test' ? h('button', { class: 'btn small', title: 'Simula ligar o pedal: mensagem de abertura e depois o preset', onclick: () => { sim.bootAt = performance.now(); } }, '⏻ Ligar o pedal') : null,
      h('span', { class: 'hint' }, hint)),
    h('div', { class: 'lcd-wrap' }, canvas),
    h('div', { class: 'lcd-note', id: 'lcdNote' }),
    h('div', { class: 'pads' + (mode === 'test' ? ' testing' : ''), id: 'pads' }));
}

function refreshPads() {
  const box = $('pads'); if (!box) return;
  const pr = cfg.presets[sel.preset], f = fx(); box.textContent = '';
  for (let row = 0; row < 2; row++) for (let k = 0; k < 4; k++) {
    const i = swAt(row, k), sw = pr.switches[i];
    let label, type, sum, cls = 'pad';
    if (isTap(i)) { label = f.tapLabel; type = 'fixo · tap'; sum = 'Toque: tap tempo · Segurar: afinador'; cls += ' fixed'; }
    else if (isMode(i)) { label = f.modeLabel; type = 'fixo · modo'; sum = 'Alterna entre efeitos e presets'; cls += ' fixed'; }
    else { label = sw.label; type = BEH_TAG[sw.behavior]; sum = padSummary(sw); }
    if (mode === 'edit' && sel.sw === i) cls += ' sel';
    if (mode === 'test' && sim) {
      const on = isTap(i) ? sim.tunerOn : isMode(i) ? (sim.modePreset || sim.bankMode) : sw.behavior === 'toggle' ? sim.toggles[i] : sim.pressed[i];
      if (on) cls += ' on';
    }
    const up = () => { if (mode === 'test' && sim && sim.pressed[i]) { simPress(cfg.presets[sim.preset], i, false); refreshPads(); } };
    box.append(h('button', {
      class: cls, id: 'pad' + i,
      onclick: () => { if (mode !== 'edit') return; sel.sw = i; refreshPads(); renderInspector(); },
      onpointerdown: e => { if (mode !== 'test') return; e.preventDefault(); simPress(cfg.presets[sim.preset], i, true); refreshPads(); },
      onpointerup: up, onpointerleave: up,
    }, h('div', { class: 'ptop' }, h('span', { class: 'pn' }, String(i + 1)), h('span', { class: 'ptype' }, type)),
      h('div', { class: 'plabel' }, (label || '').toUpperCase() || '—'),
      h('div', { class: 'psum' + (sum ? '' : ' empty') }, sum || 'sem função'),
      mode === 'test' ? h('span', { class: 'foot', title: 'Acesa = ligado (ou pisado)' }) : null, h('span', { class: 'flash' })));
  }
  const note = $('lcdNote');
  if (note) {
    const worst = LCD.worstCase(cfg, pr);
    note.textContent = '';
    if (worst.overflow.length) note.append(h('span', { class: 'warn-t', title: 'O visor só consegue desenhar 8 letras diferentes invertidas ao mesmo tempo. Repetir letras entre as siglas resolve.' }, icon('alert', 14),
      `Com tudo ligado, as letras ${worst.overflow.join(', ')} não ficariam invertidas (o visor desenha até 8 letras diferentes invertidas).`));
    else note.append(`Siglas invertidas: até ${worst.slots.length} letras diferentes de 8 possíveis.`);
  }
}

// "Ao entrar neste preset": PC da pedaleira + sincronizar os liga/desliga
function enterCard(pr, idx) {
  const toggles = pr.switches.map((s, i) => ({ s, i })).filter(x => x.s.behavior === 'toggle' && !isFixed(x.i));
  const state = toggles.length ? toggles.map(x => `${x.s.label || x.i + 1} ${x.s.startOn ? 'ligado' : 'desligado'}`).join(' · ') : 'nenhum liga/desliga neste preset';
  const layerSel = h('select', { onchange: e => { pr.layer = +e.target.value; changed(); } }, h('option', { value: 0 }, 'não usa'),
    cfg.presets.map((p, k) => k === idx ? null : h('option', { value: k + 1 }, `Preset ${k + 1} · ${p.name}`)));
  layerSel.value = pr.layer;
  return h('div', { class: 'card', style: 'margin-top:16px' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Ao entrar neste preset'), h('span', { class: 'hint' }, 'o que o pedal faz quando você troca para cá')),
    h('div', { class: 'enter-grid' },
      eventBox('Mandar', 'ex.: o PC que chama o patch na pedaleira', pr.enter, { quick: 'pc' }),
      h('div', { class: 'stack' },
        check('Deixar a pedaleira igual ao pedal', `Depois de ${cfg.global.syncDelayMs} ms, manda o estado de todos os liga/desliga. Assim a pedaleira obedece ao pedal, não importa como o patch foi salvo.`, pr, 'syncOnEnter', true),
        check('Começar sempre do jeito configurado', 'Os liga/desliga voltam ao estado inicial de cada botão. Sem isto, ficam como você deixou da última vez.', pr, 'resetOnEnter', true),
        h('p', { class: 'hint' }, 'Estado inicial: ' + state),
        h('details', { class: 'more', open: pr.layer ? true : null }, h('summary', {}, 'Avançado'),
          h('div', { class: 'stack' }, h('label', { class: 'field' }, h('span', {}, 'Camada 2 (segunda função dos botões)'), layerSel,
            h('span', { class: 'sub' }, 'Com uma ação “Camada” num botão, os botões passam a fazer o que está no preset escolhido, sem trocar de preset.')))))));
}

function check(title, hint, obj, key, full) {
  return h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: obj[key], onchange: e => { obj[key] = e.target.checked; changed(full); } }),
    h('span', {}, h('b', {}, title), hint ? h('span', { class: 'hint' }, hint) : null));
}

// ---------------- painel da direita: o botao escolhido ----------------
function renderInspector() {
  const ins = $('inspector'); ins.textContent = '';
  if (sel.view !== 'preset') return;
  const i = sel.sw, pr = cfg.presets[sel.preset], sw = pr.switches[i];
  const where = `${(i < 4) === top1to4() ? 'linha de cima' : 'linha de baixo'}, ${(i % 4) + 1}º da esquerda`;
  const head = (title, sub, fixed) => h('div', { class: 'insp-head' },
    h('div', { class: 't' }, h('span', { class: 'bignum' + (fixed ? ' fixed' : '') }, String(i + 1)), h('div', {}, h('h2', {}, title), h('div', { class: 'sub' }, sub))));
  const body = h('div', { class: 'insp-body' });
  if (isTap(i) || isMode(i)) {
    ins.append(head(isTap(i) ? 'TAP / Afinador' : 'MOD · trocar de preset', `Botão fixo · igual em todos os presets · ${where}`, true), body);
    fixedEditor(body, isTap(i) ? 'tap' : 'mode');
    body.append(h('button', { class: 'btn', onclick: () => { sel.view = 'fixed'; render(); } }, 'Escolher outro botão para ser fixo…'));
    return;
  }
  ins.append(head(`Botão ${i + 1}`, where), body);
  const lbl = h('input', { type: 'text', class: 'code3', maxlength: 3, value: sw.label || '',
    oninput: e => { const v = clean3(e.target.value); if (v !== e.target.value) e.target.value = v; sw.label = v; changed(); } });
  body.append(h('div', { class: 'insp-sec' }, h('span', { class: 'eyebrow' }, 'Sigla no visor'),
    h('div', { class: 'row', style: 'align-items:center;flex-wrap:nowrap' }, lbl, h('span', { class: 'hint' }, '3 letras. Fica invertida (fundo claro) quando o efeito está ligado.'))));
  body.append(h('div', { class: 'insp-sec' }, h('span', { class: 'eyebrow' }, 'Como o botão funciona'),
    h('div', { class: 'seg full' }, BEH.map(([id, t]) => h('button', { class: sw.behavior === id ? 'on' : '', onclick: () => { sw.behavior = id; changed(); renderInspector(); } }, t))),
    h('div', { class: 'typedesc' }, BEH_DESC[sw.behavior])));
  const sec = h('div', { class: 'insp-sec' });
  if (sw.behavior === 'toggle') {
    sec.append(eventBox('Ao ligar', '1ª pisada', sw.press), eventBox('Ao desligar', '2ª pisada', sw.release, { mirror: sw.press }),
      check('Começa ligado', 'Estado ao ligar o pedal (e ao entrar no preset, se estiver marcado “Começar sempre do jeito configurado”).', sw, 'startOn'));
  } else if (sw.behavior === 'momentary') {
    sec.append(eventBox('Ao pisar', 'pé desce', sw.press), eventBox('Ao soltar', 'pé sobe', sw.release, { mirror: sw.press }));
  } else if (sw.behavior === 'macro') {
    sec.append(eventBox('Ao pisar', 'manda tudo, em ordem', sw.press));
  } else {
    sec.append(eventBox('Sequência', 'uma por pisada', sw.press, { step: true }),
      check('Vai e volta', '1 → 2 → 3 → 2 → 1 em vez de 1 → 2 → 3 → 1.', sw, 'pingPong'));
  }
  body.append(sec);
  const hasMore = sw.hold.length || sw.doubleTap.length || sw.tap || (sw.behavior === 'macro' && sw.release.length);
  body.append(h('details', { class: 'more', open: hasMore ? true : null }, h('summary', {}, 'Mais funções neste botão'),
    h('div', { class: 'stack' },
      sw.behavior === 'macro' ? eventBox('Ao soltar', 'opcional', sw.release) : null,
      eventBox('Ao segurar', `pisar e segurar ${cfg.global.holdMs} ms`, sw.hold),
      eventBox('Dois toques', 'duas pisadas rápidas', sw.doubleTap),
      check('Também bate o tempo', 'Mede o tempo a cada pisada e a sigla pisca no ritmo. Ponha a mensagem de tap da pedaleira em “Ao pisar”.', sw, 'tap'),
      (sw.hold.length || sw.doubleTap.length) ? h('p', { class: 'hint' }, `Com “segurar” ou “dois toques”, o toque normal só sai quando der para ter certeza (ao soltar, ou ${cfg.global.doubleTapMs} ms depois). Sem eles, o botão reage na hora.`) : null)));
}

// edicao dos botoes fixos (usada no painel da direita e na pagina "Botoes fixos")
function fixedEditor(box, which) {
  const f = fx();
  const lbl = key => h('input', { type: 'text', class: 'code3', maxlength: 3, value: f[key],
    oninput: e => { const v = clean3(e.target.value); if (v !== e.target.value) e.target.value = v; f[key] = v; changed(); } });
  if (which === 'tap') {
    box.append(
      h('div', { class: 'insp-sec' }, h('span', { class: 'eyebrow' }, 'Sigla no visor'), h('div', { class: 'row', style: 'align-items:center' }, lbl('tapLabel'),
        h('span', { class: 'hint' }, 'Pisca no tempo depois que você bate o tap.'))),
      h('div', { class: 'typedesc' }, 'Toque = tap tempo. Segurar = liga o afinador (a tela mostra TUNER). Com o afinador ligado, um toque desliga.'),
      eventBox('Ao tocar', 'tap tempo da pedaleira', f.tap),
      eventBox('Ao segurar', 'liga o afinador', f.tunerOn),
      eventBox('Ao sair do afinador', 'um toque desliga', f.tunerOff, { mirror: f.tunerOn }));
  } else {
    const n = cfg.presets.length, cur = sel.preset || 0, ppb = cfg.global.presetsPerBank;
    const map = h('div', { class: 'map' }, Array.from({ length: 8 }, (_, s) => s).filter(s => !isFixed(s)).map(s => {
      const p = LCD.presetOfSwitch(cfg, s, cur);
      return [h('span', { class: 'k' }, `botão ${s + 1}`), h('span', {}, p >= 0 && p < n ? `${cfg.presets[p].short || '—'} · ${cfg.presets[p].name}` : '—')];
    }));
    if (n > ppb) map.prepend(h('span', { class: 'k', style: 'grid-column:1/-1;margin-bottom:4px' }, `No banco ${Math.floor(cur / ppb) + 1} (o MOD mostra os presets do banco atual):`));
    box.append(
      h('div', { class: 'insp-sec' }, h('span', { class: 'eyebrow' }, 'Sigla no visor'), h('div', { class: 'row', style: 'align-items:center' }, lbl('modeLabel'),
        h('span', { class: 'hint' }, 'Fica invertida enquanto você está escolhendo o preset.'))),
      h('div', { class: 'typedesc' }, 'Toque no MOD: os outros botões mostram a sigla dos presets do banco atual; pise num deles para trocar de preset. ' +
        (n > ppb ? 'Segure o MOD: os botões mostram os bancos; escolha um e depois o preset.' : 'Com mais de um banco (página Bancos), segurar o MOD escolhe o banco.')),
      check('Voltar sozinho para os efeitos', 'Depois de escolher o preset, os botões voltam a ser efeitos. Desmarcado: fica escolhendo preset até apertar MOD de novo.', f, 'autoReturn'),
      h('div', { class: 'insp-sec' }, h('span', { class: 'eyebrow' }, 'No modo MOD'), map));
  }
}

// ---------------- lista de mensagens ----------------
const ADD_TYPES = [['cc', 'CC (liga/desliga, valor)'], ['pc', 'PC (trocar patch)'], ['ramp', 'Rampa de CC'], ['pedal', 'Ação do pedal (preset, camada…)'],
  ['delay', 'Esperar'], ['noteOn', 'Nota'], ['bank', 'Bank Select'], ['sysex', 'SysEx'], ['contact', 'Contato Switch-3']];
function eventBox(title, hintText, list, opt = {}) {
  const box = h('div', { class: 'event' }, h('div', { class: 'ehead' }, h('b', {}, title), hintText ? h('span', { class: 'hint' }, hintText) : null));
  const msgs = h('div', { class: 'msgs' });
  const redraw = () => {
    msgs.textContent = '';
    list.forEach((m, i) => msgs.append(msgRow(list, i, redraw, opt.step)));
    if (!list.length) msgs.append(h('div', { class: 'empty-ev' }, 'nada'));
  };
  redraw();
  const add = h('select', { class: 'addsel', onchange: e => {
    const t = e.target.value; e.target.value = ''; if (!t) return;
    let m = PM.newMsg(t);
    // "ao desligar": ja sugere o mesmo CC do "ao ligar" com valor 0
    if (t === 'cc' && opt.mirror && opt.mirror.length && opt.mirror[0].type === 'cc' && !list.length) m = Object.assign(m, { number: opt.mirror[0].number, value: 0, channel: opt.mirror[0].channel });
    else if (list.length) m.channel = list[list.length - 1].channel;
    list.push(m); redraw(); changed(); refreshPads();
  } }, h('option', { value: '' }, '+ Adicionar'), ADD_TYPES.map(([v, t]) => h('option', { value: v }, t)));
  box.append(msgs, add);
  return box;
}

const num = (val, min, max, onv, title, allowEmpty) => h('input', {
  type: 'number', value: val < 0 && allowEmpty ? '' : val, min, max, title, placeholder: allowEmpty ? '–' : '',
  oninput: e => {
    const t = e.target.value.trim();
    if (t === '' && allowEmpty) { e.target.classList.remove('bad'); onv(-1); return; }
    const v = Number(t), ok = Number.isInteger(v) && v >= min && v <= max;
    e.target.classList.toggle('bad', !ok);
    onv(ok ? v : (Number.isInteger(v) ? Math.max(min, Math.min(max, v)) : min));
  },
});

function msgRow(list, i, redraw, isStep) {
  const m = list[i];
  const set = (k, v) => { m[k] = v; changed(); };
  const type = h('select', { class: 'type', onchange: e => { const n = PM.newMsg(e.target.value); n.channel = m.channel; list[i] = n; redraw(); changed(); } },
    PM.MSG_TYPES.map(t => h('option', { value: t.id }, t.text)));
  type.value = m.type;
  const chanSel = () => {
    const s = h('select', { title: 'Canal MIDI', onchange: e => set('channel', +e.target.value) },
      h('option', { value: 0 }, 'canal global'), Array.from({ length: 16 }, (_, k) => h('option', { value: k + 1 }, 'canal ' + (k + 1))));
    s.value = m.channel; return s;
  };
  const L = t => h('span', { class: 'lbl' }, t);
  const row = h('div', { class: 'mfields' });
  switch (m.type) {
    case 'cc': row.append(L('nº'), num(m.number, 0, 127, v => set('number', v), 'Número do CC'), L('valor'), num(m.value, 0, 127, v => set('value', v), 'Valor'), chanSel()); break;
    case 'pc': row.append(L('nº'), num(m.number, 0, 127, v => set('number', v), 'Número do Program Change (0 a 127)'), chanSel()); break;
    case 'noteOn': row.append(L('nota'), num(m.number, 0, 127, v => set('number', v)), L('vel'), num(m.value, 0, 127, v => set('value', v)), chanSel()); break;
    case 'noteOff': row.append(L('nota'), num(m.number, 0, 127, v => set('number', v)), chanSel()); break;
    case 'bank': row.append(L('MSB'), num(m.number, 0, 127, v => set('number', v), 'CC 0 (vazio = não manda)', true), L('LSB'), num(m.value, 0, 127, v => set('value', v), 'CC 32 (vazio = não manda)', true), chanSel()); break;
    case 'delay': row.append(num(m.value, 10, 2550, v => set('value', v), 'Espera em ms'), L('ms')); break;
    case 'contact': {
      const which = h('select', { title: 'Qual botão do Switch-3', onchange: e => set('number', +e.target.value) },
        [[1, 'botão 1 (ponta)'], [2, 'botão 2 (anel)'], [3, 'botão 3 (os dois)']].map(([v, t]) => h('option', { value: v }, t)));
      which.value = m.number;
      const act = h('select', { onchange: e => { m.mode = e.target.value; redraw(); changed(); } }, PM.CONTACT_MODES.map(([v, t]) => h('option', { value: v }, t)));
      act.value = m.mode;
      row.append(which, act);
      if (m.mode === 'pulse') row.append(num(m.ms, 20, 2550, v => set('ms', v), 'Quanto tempo o contato fica fechado'), L('ms'));
      if (!cfg.global.contacts.pinA || !cfg.global.contacts.pinB) row.append(h('span', { class: 'lbl warn-t' }, 'escolha os pinos em Ligações'));
      break;
    }
    case 'ramp': {
      const pick = (key, opts, title) => { const s = h('select', { title, onchange: e => set(key, e.target.value) }, opts.map(([v, t]) => h('option', { value: v }, t))); s.value = m[key]; return s; };
      row.append(L('CC'), num(m.number, 0, 127, v => set('number', v), 'Número do CC'),
        L('de'), num(m.from, 0, 127, v => set('from', v), 'Valor inicial'),
        L('até'), num(m.to, 0, 127, v => set('to', v), 'Valor final'),
        L('em'), num(m.ms, 20, 60000, v => set('ms', v), 'Duração em ms'), L('ms'),
        pick('curve', PM.RAMP_CURVES, 'Curva'), pick('mode', PM.RAMP_MODES, 'O que acontece ao soltar'), chanSel());
      break;
    }
    case 'sysex': {
      const inp = h('input', { type: 'text', class: 'grow mono', value: m.data, placeholder: 'F0 ... F7 (até 12 bytes, hexa)',
        oninput: e => { m.data = e.target.value.toUpperCase(); const errs = []; try { PM.validate({ ...cfg, presets: [], combos: [{ a: 1, b: 2, action: [m] }] }).forEach(x => errs.push(x)); } catch (x) {} e.target.classList.toggle('bad', errs.some(x => /SysEx/.test(x.text))); changed(); } });
      row.append(inp); break;
    }
    case 'pedal': {
      const s = h('select', { onchange: e => { m.op = e.target.value; const o = PM.op(m.op); m.value = o.arg ? o.min : 0; redraw(); changed(); } }, PM.OPS.map(o => h('option', { value: o.id }, o.text)));
      s.value = m.op; row.append(s);
      const o = PM.op(m.op);
      if (o && o.arg) row.append(L(o.arg), num(m.value, o.min, o.max, v => set('value', v)));
      break;
    }
  }
  const tools = h('div', { class: 'tools' });
  if (['cc', 'pc', 'noteOn', 'ramp'].includes(m.type)) {
    const b = h('button', { class: 'btn small ghost' + (learning && learning.msg === m ? ' learning' : ''), title: 'Aprender: mexa na pedaleira e eu copio a mensagem',
      onclick: () => { if (learning && learning.msg === m) { learning = null; b.classList.remove('learning'); return; } startLearn(m, redraw, b); } }, 'aprender');
    tools.append(b);
  }
  if (list.length > 1) tools.append(
    h('button', { class: 'btn small ghost icon', title: 'Subir', disabled: i === 0, onclick: () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; redraw(); changed(); } }, icon('up', 14)),
    h('button', { class: 'btn small ghost icon', title: 'Descer', disabled: i === list.length - 1, onclick: () => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; redraw(); changed(); } }, icon('down', 14)));
  tools.append(h('button', { class: 'btn small ghost icon danger', title: 'Remover', onclick: () => { list.splice(i, 1); redraw(); changed(); } }, icon('x', 14)));
  return h('div', { class: 'msg' }, h('div', { class: 'mtop' }, isStep ? h('span', { class: 'stepn' }, (i + 1) + '.') : null, type, tools), row.childNodes.length ? row : null);
}

// ---------------- MIDI learn ----------------
function startLearn(msg, redraw, btn) {
  if (!$('learnPort').value && !Pedal.connected) { toast('Escolha no Monitor MIDI (embaixo) a porta da pedaleira em “Aprender da porta”.'); openMonitor(); return; }
  document.querySelectorAll('.btn.learning').forEach(b => b.classList.remove('learning'));
  learning = { msg, redraw }; btn.classList.add('learning');
  toast('Aprendendo: mexa no controle da pedaleira...');
}
function learnFrom(d) {
  if (!learning) return false;
  const st = d[0] & 0xF0, c = (d[0] & 15) + 1, m = learning.msg;
  if (st === 0xB0 && m.type === 'ramp') m.number = d[1];            // rampa: so aprende qual CC
  else if (st === 0xB0) Object.assign(m, { type: 'cc', number: d[1], value: d[2] });
  else if (st === 0xC0) Object.assign(m, { type: 'pc', number: d[1] });
  else if (st === 0x90 && d[2] > 0) Object.assign(m, { type: 'noteOn', number: d[1], value: d[2] });
  else return false;
  m.channel = c === cfg.global.channel ? 0 : c;
  const r = learning.redraw; learning = null; r(); changed();
  toast('Aprendido: ' + PM.describeMsg(m));
  return true;
}

// ---------------- simulador do visor ----------------
let sim = null;
function simFor(pr, idx) {
  if (!sim || sim.preset !== idx) {
    const old = sim || {};
    sim = { preset: idx, cur: idx, toggles: pr.switches.map(s => !!s.startOn), pressed: Array(8).fill(false),
            bpm: old.bpm || cfg.global.bpm, tapActive: !!old.tapActive, lastTap: old.lastTap || 0,
            modePreset: !!old.keepMode && !!old.modePreset, tunerOn: false, tapHeld: true, tunerJustOff: false, tapDownAt: 0,
            bankMode: false, modeHeld: true, modeDownAt: 0, viewBank: Math.floor(idx / cfg.global.presetsPerBank),
            announceUntil: performance.now() + nameMs() };
  }
  return sim;
}
function simState(now) {
  const beatOn = sim.tapActive ? ((now - sim.lastTap) % (60000 / sim.bpm)) < (30000 / sim.bpm) : false;
  return { toggles: sim.toggles, pressed: sim.pressed, beatOn, flash: '', announce: now < sim.announceUntil ? sim.preset : null,
           modePreset: sim.modePreset, bankMode: sim.bankMode, viewBank: sim.viewBank, tunerOn: sim.tunerOn, cur: sim.cur, alt: Math.floor(now / ((cfg.global.display.modBlink ?? 0.5) * 1000)) % 2 === 1 };
}
function nameMs() { return (cfg.global.display.nameSeconds ?? 1.5) * 1000;
}
const nBanks = () => Math.ceil(cfg.presets.length / cfg.global.presetsPerBank);
// posicao do botao entre os livres (0 = 1o botao que nao e TAP/MOD)
const freeIndex = sw => { if (isFixed(sw)) return -1; let n = 0; for (let s = 0; s < sw; s++) if (!isFixed(s)) n++; return n; };
function simTap(now) {
  const dt = now - sim.lastTap;
  if (sim.lastTap && dt >= 240 && dt <= 2000) { sim.bpm = Math.round(60000 / dt); sim.tapActive = true; }
  sim.lastTap = now;
}
// mesma logica do firmware (Engine::fixedEvent + eventos normais, simplificados)
function simPress(pr, sw, down) {
  const s = pr.switches[sw], now = performance.now(), f = fx();
  sim.pressed[sw] = down;
  // MOD: toque curto (decide ao soltar) = presets do banco atual; segurar = pagina de bancos (no intervalo abaixo)
  if (isMode(sw)) {
    if (down) { sim.modeDownAt = now; sim.modeHeld = false; return; }
    if (sim.modeHeld) return;
    sim.modeHeld = true;
    if (sim.bankMode) { sim.bankMode = false; sim.modePreset = false; }
    else { sim.modePreset = !sim.modePreset; sim.viewBank = Math.floor(sim.cur / cfg.global.presetsPerBank); }
    sim.tunerOn = false; return;
  }
  if (!down) return;
  if (sim.bootAt) { sim.bootAt = 0; sim.announceUntil = now + nameMs(); }   // pisar pula a abertura (e o botao funciona)
  if (sim.bankMode && !isTap(sw)) {
    const n = freeIndex(sw);
    if (n >= 0 && n < nBanks()) { sim.viewBank = n; sim.bankMode = false; sim.modePreset = true; }
    return;
  }
  if (isTap(sw)) {
    sim.tapDownAt = now; sim.tapHeld = false;
    if (sim.tunerOn) { sim.tunerOn = false; sim.tunerJustOff = true; } else { sim.tunerJustOff = false; simTap(now); }
    return;
  }
  if (sim.modePreset) {
    const vb = sim.viewBank != null ? sim.viewBank : Math.floor(sim.cur / cfg.global.presetsPerBank);
    const p = LCD.presetOfSwitch(cfg, sw, vb * cfg.global.presetsPerBank);
    if (p >= 0 && p < cfg.presets.length) {
      sim.keepMode = !f.autoReturn;
      if (f.autoReturn) sim.modePreset = false;
      if (p === sel.preset) sim.announceUntil = now + nameMs();
      else { sel.preset = p; render(); }
    }
    return;
  }
  if (s.tap) simTap(now);
  if (s.behavior === 'toggle') sim.toggles[sw] = !sim.toggles[sw];
}
// previa da mensagem ao ligar (pagina Visor): repete em loop, com o nome do preset depois
let splashT0 = 0;
setInterval(() => {
  const c = document.getElementById('splashPrev'); if (!c) return;
  const dur = cfg.global.splash.seconds * 1000, t = (performance.now() - splashT0) % (Math.max(dur, 0) + 1800);
  const pr = cfg.presets[0];
  const s = LCD.hasSplash(cfg) && t < dur ? LCD.splash(cfg, t)
    : LCD.screen(cfg, pr, { toggles: pr.switches.map(x => !!x.startOn), pressed: Array(8).fill(false), beatOn: false, flash: '', announce: 0, cur: 0 });
  LCD.draw(c, s.lines, s.inv);
}, 30);

setInterval(() => {
  const c = document.getElementById('lcd');
  if (!c || !sim || sel.view !== 'preset') return;
  const pr = cfg.presets[sim.preset]; if (!pr) return;
  const now = performance.now(), ts = fx().tapSwitch - 1;
  if (ts >= 0 && sim.pressed[ts] && !sim.tapHeld && now - sim.tapDownAt >= cfg.global.holdMs) {   // segurou o tap = afinador
    sim.tapHeld = true; if (!sim.tunerJustOff) { sim.tunerOn = true; refreshPads(); }
  }
  const ms = fx().modeSwitch - 1;                     // segurou o MOD (e ha mais de 1 banco) = pagina de bancos
  if (ms >= 0 && sim.pressed[ms] && !sim.modeHeld && now - sim.modeDownAt >= cfg.global.holdMs && nBanks() > 1) {
    sim.modeHeld = true; sim.bankMode = true; sim.modePreset = false; sim.tunerOn = false; refreshPads();
  }
  if (sim.bootAt) {                                   // "Ligar o pedal": mensagem ao ligar, depois o preset
    const t = now - sim.bootAt;
    if (LCD.hasSplash(cfg) && t < cfg.global.splash.seconds * 1000) { const s = LCD.splash(cfg, t); LCD.draw(c, s.lines, s.inv); return; }
    sim.bootAt = 0; sim.announceUntil = now + nameMs();
  }
  const s = LCD.screen(cfg, pr, simState(now));
  LCD.draw(c, s.lines, s.inv);
}, 30);

// ---------------- paginas de ajustes ----------------
function pageHead(main, title, desc) { main.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, title), desc ? h('p', { class: 'desc' }, desc) : null))); }
function card(title, hint, ...kids) {
  return h('div', { class: 'card' }, title ? h('div', { class: 'card-head' }, h('h2', {}, title), hint ? h('span', { class: 'hint' }, hint) : null) : null, ...kids);
}
function selectField(label, value, options, onv, sub) {
  const s = h('select', { onchange: e => onv(e.target.value) }, options.map(([v, t]) => h('option', { value: v }, t)));
  s.value = value;
  return h('label', { class: 'field' }, h('span', {}, label), s, sub ? h('span', { class: 'sub' }, sub) : null);
}
function fieldNum(label, obj, key, min, max, sub) {
  return h('label', { class: 'field' }, h('span', {}, label), num(obj[key], min, max, v => { obj[key] = v; changed(); }), sub ? h('span', { class: 'sub' }, sub) : null);
}
// escolhe um botao numa grade igual ao pedal (linha de cima / de baixo)
function switchPicker(value, other, onv) {
  const b = n => h('button', { class: value === n ? 'on' : (other === n ? 'other' : ''), title: other === n ? 'Já é o outro botão fixo' : `Botão ${n}`,
    onclick: () => onv(value === n ? 0 : n) }, String(n));
  return h('div', { class: 'picker' }, [0, 1].map(row => [0, 1, 2, 3].map(k => b(swAt(row, k) + 1))));
}

function renderFixed(main) {
  const f = fx();
  pageHead(main, 'Botões fixos', 'Dois botões que fazem a mesma coisa em todos os presets: um para bater o tempo e ligar o afinador, outro para escolher presets com os pés. Escolha qual botão é cada um, na mesma posição do pedal.');
  const set = (key, other) => n => { f[key] = n; if (n && f[other] === n) f[other] = 0; sim = null; changed(true); };
  const tapBox = h('div', { class: 'stack' }); if (f.tapSwitch) fixedEditor(tapBox, 'tap');
  const modeBox = h('div', { class: 'stack' }); if (f.modeSwitch) fixedEditor(modeBox, 'mode');
  main.append(
    card('TAP / Afinador', f.tapSwitch ? `botão ${f.tapSwitch}` : 'desligado',
      h('div', { class: 'row', style: 'align-items:flex-start;gap:28px' }, h('div', { class: 'field' }, h('span', {}, 'Qual botão'), switchPicker(f.tapSwitch, f.modeSwitch, set('tapSwitch', 'modeSwitch')),
        h('span', { class: 'sub' }, 'Clique de novo para desligar.')), h('div', { style: 'flex:1;min-width:280px' }, tapBox))),
    card('MOD · escolher preset', f.modeSwitch ? `botão ${f.modeSwitch}` : 'desligado',
      h('div', { class: 'row', style: 'align-items:flex-start;gap:28px' }, h('div', { class: 'field' }, h('span', {}, 'Qual botão'), switchPicker(f.modeSwitch, f.tapSwitch, set('modeSwitch', 'tapSwitch'))),
        h('div', { style: 'flex:1;min-width:280px' }, modeBox))));
}

const SECS = a => a.map(v => [v, String(v).replace('.', ',') + ' s']);
function renderDisplay(main) {
  const g = cfg.global, d = g.display, pr = cfg.presets[sel.preset] || cfg.presets[0], idx = cfg.presets.indexOf(pr);
  pageHead(main, 'Visor', 'Como as informações aparecem no visor de 2 linhas do pedal.');
  const prev = h('canvas', { class: 'lcd' }), prev2 = h('canvas', { class: 'lcd' });
  const drawPrev = () => {
    const base = { toggles: pr.switches.map(s => !!s.startOn), pressed: Array(8).fill(false), beatOn: true, flash: '', cur: idx };
    let s = LCD.screen(cfg, pr, { ...base, announce: idx }); LCD.draw(prev, s.lines, s.inv);
    s = LCD.screen(cfg, pr, base); LCD.draw(prev2, s.lines, s.inv);
  };
  const seg = (opts, val, onv) => h('div', { class: 'seg' }, opts.map(([v, t]) => h('button', { class: val === v ? 'on' : '', onclick: () => { onv(v); changed(); render(); } }, t)));
  // mensagem ao ligar
  const sp = g.splash;
  const restart = () => { splashT0 = performance.now(); updNote(); };
  const lineIn = (key, ph) => h('input', { type: 'text', class: 'mono splash-in', maxlength: 16, value: sp[key], placeholder: ph, spellcheck: 'false',
    oninput: e => { const v = PM.ascii(e.target.value).toUpperCase().replace(/[^ -Z]/g, '').slice(0, 16); if (v !== e.target.value) e.target.value = v; sp[key] = v; changed(); restart(); } });
  const fxBtns = h('div', { class: 'fxgrid' }, PM.SPLASH_FX.map(([v, t]) => h('button', { class: sp.effect === v ? 'on' : '',
    onclick: e => { sp.effect = v; fxBtns.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === e.currentTarget)); changed(); restart(); } }, t)));
  const note = h('p', { class: 'hint' });
  const updNote = () => {
    const distinct = new Set(((sp.line1 || '') + (sp.line2 || '')).replace(/ /g, '')).size;
    note.textContent = !LCD.hasSplash(cfg) ? 'Sem texto (ou 0 segundos): o pedal liga direto no preset.'
      : sp.effect === 'blink' && distinct > 8 ? `Mais de 8 letras diferentes (${distinct}): as duas linhas piscam alternadas. Com até 8, a tela inteira pisca junta.`
      : 'Pisar em qualquer botão pula a abertura.';
  };
  updNote();
  main.append(card('Mensagem ao ligar', 'aparece quando você liga o pedal',
    h('div', { class: 'splash-grid' },
      h('div', { class: 'stack' },
        h('label', { class: 'field' }, h('span', {}, 'Linha de cima'), lineIn('line1', 'OLA')),
        h('label', { class: 'field' }, h('span', {}, 'Linha de baixo'), lineIn('line2', 'BOM SHOW')),
        h('div', { class: 'field' }, h('span', {}, 'Efeito'), fxBtns),
        h('label', { class: 'field' }, h('span', {}, 'Quanto tempo (segundos)'), num(sp.seconds, 0, 30, v => { sp.seconds = v; changed(); restart(); }, '0 = não mostra'))),
      h('div', { class: 'stack' }, h('div', { class: 'lcd-wrap' }, h('canvas', { class: 'lcd', id: 'splashPrev' })),
        h('div', { class: 'row', style: 'align-items:center' }, h('button', { class: 'btn small', onclick: restart }, '↻ Ver de novo'), note)))));
  splashT0 = performance.now();
  main.append(
    card('Botões', null, h('div', { class: 'stack' },
      h('div', { class: 'field' }, h('span', {}, 'Linha de cima do visor mostra'), seg([['5-8', 'Botões 5 a 8'], ['1-4', 'Botões 1 a 4']], d.topRow, v => { d.topRow = v; sim = null; }),
        h('span', { class: 'sub' }, 'Escolha para bater com a posição dos botões no seu pedal.')),
      check('Canto direito pisca no tempo', 'Um quadradinho aceso no ritmo do tap, no canto do visor.', d, 'tempoColumn', true),
      h('div', { class: 'field' }, h('span', {}, 'Velocidade da troca no botão MOD'), seg(SECS([0.3, 0.5, 0.8, 1, 1.5]), d.modBlink, v => { d.modBlink = v; }),
        h('span', { class: 'sub' }, 'O MOD fica invertido e alterna: PRS ↔ preset atual; escolhendo preset, BCO ↔ banco; escolhendo banco, só BCO.')),
      h('div', { class: 'lcd-wrap', style: 'max-width:520px' }, prev2))),
    card('Troca de preset', null, h('div', { class: 'stack' },
      h('p', { class: 'hint' }, 'Quando você troca de preset, o nome ocupa a tela inteira e depois voltam as siglas dos botões.'),
      h('div', { class: 'field' }, h('span', {}, 'Quanto tempo o nome fica na tela'), seg(SECS([0.5, 0.8, 1, 1.5, 2, 3]), d.nameSeconds, v => { d.nameSeconds = v; }),
        h('span', { class: 'sub' }, 'Vale também para avisos como CANAL 2 ou TRAVADO.')),
      check('Mostrar o número do preset embaixo do nome', null, d, 'presetNumber', true),
      h('div', { class: 'lcd-wrap', style: 'max-width:520px' }, prev))));
  requestAnimationFrame(drawPrev);
}

function renderExpression(main) {
  const x = cfg.global.expression;
  pageHead(main, 'Pedal de expressão', 'Um pedal de expressão ligado numa entrada analógica do Arduino manda um CC contínuo, por exemplo volume ou wah.');
  const pins = [['', 'sem pedal de expressão'], ['A0', 'A0'], ['A1', 'A1'], ['A2', 'A2'], ['A3', 'A3']];
  const chans = [[0, 'canal global'], ...Array.from({ length: 16 }, (_, k) => [k + 1, 'canal ' + (k + 1)])];
  main.append(card('Entrada', null, h('div', { class: 'grid2' },
    selectField('Pino', x.pin, pins, v => { x.pin = v; changed(true); }),
    x.pin ? [fieldNum('Manda o CC', x, 'cc', 0, 127), selectField('Canal', x.channel, chans, v => { x.channel = +v; changed(); }),
      fieldNum('Pé atrás', x, 'min', 0, 127, 'valor mínimo'), fieldNum('Pé à frente', x, 'max', 0, 127, 'valor máximo'),
      selectField('Curva', x.curve, [['linear', 'Linear'], ['log', 'Rápida no começo'], ['exp', 'Lenta no começo']], v => { x.curve = v; changed(); })] : null),
    x.pin ? h('p', { class: 'hint', style: 'margin-top:12px' }, 'Para inverter o pedal, troque: pé atrás 127, pé à frente 0.') : null));
  if (x.pin) main.append(card('Calibração', 'faz o curso real do seu pedal virar 0 a 127 inteiro',
    h('div', { class: 'row' }, fieldNum('Leitura com o pé atrás', x, 'calLow', 0, 1022), fieldNum('Leitura com o pé à frente', x, 'calHigh', 1, 1023),
      h('button', { class: 'btn', onclick: discoverWizard, disabled: !Pedal.connected }, 'Calibrar mexendo o pedal…'))));
  else main.append(card(null, null, h('p', { class: 'hint' }, 'Não sabe em que pino está? Em “Ligações”, o assistente descobre os botões e o pedal de expressão.')));
}

function renderCombos(main) {
  pageHead(main, 'Combos', `Pisar dois botões juntos faz uma terceira coisa, em todos os presets. Até ${PM.NCOMBO}. Ex.: 1 + 2 = preset anterior.`);
  main.append(h('div', { style: 'margin-bottom:14px' }, h('button', { class: 'btn primary', disabled: cfg.combos.length >= PM.NCOMBO, onclick: () => { cfg.combos.push({ a: 1, b: 2, action: [PM.newMsg('pedal')] }); changed(true); } }, icon('plus', 14), 'Novo combo')));
  if (!cfg.combos.length) main.append(card(null, null, h('p', { class: 'hint' }, 'Nenhum combo.')));
  const opts = Array.from({ length: 8 }, (_, i) => [i + 1, 'Botão ' + (i + 1)]);
  cfg.combos.forEach((cb, k) => {
    const fixedWarn = [cb.a, cb.b].some(n => isFixed(n - 1));
    main.append(card(null, null,
      h('div', { class: 'combo-row' }, selectField('', cb.a, opts, v => { cb.a = +v; changed(true); }), h('b', {}, '+'), selectField('', cb.b, opts, v => { cb.b = +v; changed(true); }),
        h('div', { class: 'spacer' }), h('button', { class: 'btn small ghost danger', onclick: () => { cfg.combos.splice(k, 1); changed(true); } }, icon('trash', 14), 'Apagar')),
      fixedWarn ? h('p', { class: 'hint warn-t', style: 'margin-bottom:10px' }, 'Um destes é botão fixo (TAP ou MOD): o combo não vai funcionar.') : null,
      eventBox('Faz', 'quando os dois são pisados juntos', cb.action)));
  });
  main.append(h('p', { class: 'hint', style: 'margin-top:14px' }, `Botões que fazem parte de um combo esperam ${cfg.global.comboMs} ms antes do toque normal.`));
}

function renderMidi(main) {
  const g = cfg.global;
  pageHead(main, 'MIDI e tempos', 'Ajustes gerais do pedal. Normalmente não precisa mexer.');
  main.append(
    card('MIDI', null, h('div', { class: 'grid2' },
      selectField('Canal global', g.channel, Array.from({ length: 16 }, (_, k) => [k + 1, 'Canal ' + (k + 1)]), v => { g.channel = +v; changed(); }, 'mensagens com “canal global” usam este'),
      selectField('Preset ao ligar', g.startPreset, cfg.presets.map((p, k) => [k + 1, `${k + 1} · ${p.name}`]), v => { g.startPreset = +v; changed(); }),
      fieldNum('BPM inicial do clock', g, 'bpm', 30, 255))),
    card('Tempos', null, h('div', { class: 'grid2' },
      fieldNum('Segurar (ms)', g, 'holdMs', 100, 2550, 'quanto tempo conta como “segurar”'),
      fieldNum('Dois toques (ms)', g, 'doubleTapMs', 50, 2550, 'intervalo máximo entre os toques'),
      fieldNum('Combo (ms)', g, 'comboMs', 20, 255, 'intervalo para contar como juntos'),
      fieldNum('Espera para sincronizar (ms)', g, 'syncDelayMs', 0, 2550, 'tempo para a pedaleira carregar o patch'))),
    card('Comportamento', null, h('div', { class: 'stack' },
      check('Lembrar ao desligar', 'Guarda o preset, o canal, os liga/desliga, a trava e o clock.', g, 'persistState'),
      check('Dar a volta na lista', 'Depois do último preset vem o primeiro (e vice-versa).', g, 'wrap'),
      check('Ligar o MIDI Clock junto com o pedal', null, g, 'clockAtBoot'))));
}

function renderBanks(main) {
  const g = cfg.global, n = cfg.presets.length, ppb = g.presetsPerBank, nb = Math.ceil(n / Math.min(ppb, 16));
  pageHead(main, 'Bancos', 'Separe os presets em grupos, por exemplo um banco para cada pedaleira. O botão MOD mostra só os presets do banco em que você está, e um combo (ou a ação “Banco +”) troca de banco.');
  const opts = [[16, 'Um banco só'], [6, 'Bancos de 6'], [5, 'Bancos de 5'], [4, 'Bancos de 4']];
  const free = 8 - [fx().modeSwitch, fx().tapSwitch].filter(Boolean).length;
  const hasBankCombo = cfg.combos.some(c => c.action.some(m => m.type === 'pedal' && /^bank/.test(m.op)));
  main.append(
    card('Tamanho do banco', null, h('div', { class: 'stack' },
      h('div', { class: 'seg' }, opts.map(([v, t]) => h('button', { class: ppb === v ? 'on' : '', onclick: () => { g.presetsPerBank = v; sim = null; changed(true); } }, t))),
      h('p', { class: 'hint' }, ppb >= 16 ? 'Todos os presets estão num banco só.'
        : ppb >= n ? `Por enquanto só o banco 1 (${n} de ${ppb}).` + (n === ppb ? ' Os próximos presets que você criar (botão “Novo”) vão para o banco 2.' : '')
        : `${nb} bancos. ` + (ppb > free ? `Atenção: o MOD só tem ${free} botões livres, então os últimos ${ppb - free} presets de cada banco não aparecem nele.` : `O MOD mostra os ${ppb} presets do banco atual.`)))),
    card('Trocar de banco com os pés', null, h('div', { class: 'stack' },
      hasBankCombo ? h('p', { class: 'hint' }, '✓ Você já tem um combo que troca de banco. Ajuste em Combos.')
        : h('p', { class: 'hint' }, 'Crie um combo (dois botões juntos) com a ação “Banco +”. Com 2 bancos, ele vai e volta entre os dois.'),
      h('div', {}, h('button', { class: 'btn' + (hasBankCombo ? '' : ' primary'), disabled: cfg.combos.length >= PM.NCOMBO, onclick: () => {
        cfg.combos.push({ a: 1, b: 2, action: [Object.assign(PM.newMsg('pedal'), { op: 'bank+' })] }); sel.view = 'combos'; changed(true); toast('Combo criado: escolha os dois botões.');
      } }, icon('plus', 14), 'Criar combo “Banco +”')))),
    card('Seus bancos', 'segure o MOD para escolher o banco', h('div', { class: 'stack' },
      Array.from({ length: Math.min(nb, 6) }, (_, b) => h('div', { class: 'bankrow' },
        h('label', { class: 'field' }, h('span', {}, `Banco ${b + 1}`),
          h('input', { type: 'text', class: 'code3', maxlength: 3, value: g.bankLabels[b] || '', placeholder: 'B' + (b + 1), title: 'Sigla que aparece ao segurar o MOD',
            oninput: e => { const v = clean3(e.target.value); if (v !== e.target.value) e.target.value = v; g.bankLabels[b] = v; changed(); } })),
        h('span', { class: 'hint' }, cfg.presets.slice(b * ppb, b * ppb + ppb).map(p => p.name).join(' · ') || '—'))),
      nb > 1 ? h('p', { class: 'hint' }, 'Segurar o MOD mostra as siglas dos bancos nos botões. Pise num banco para ver os presets dele; o som só muda quando você escolher o preset.')
        : h('p', { class: 'hint' }, 'Com um banco só, segurar o MOD faz o mesmo que um toque.'))));
}

function renderHardware(main) {
  const g = cfg.global, ct = g.contacts;
  const pinOpts = [['', 'nenhum'], ...[...Array.from({ length: 12 }, (_, k) => 'D' + (k + 2)), 'A0', 'A1', 'A2', 'A3'].map(n => [n, n])];
  pageHead(main, 'Ligações', 'Em quais pinos do Arduino estão os botões e as saídas. Só muda se você mexer na fiação.');
  main.append(card('Botões', null,
    h('div', { class: 'row', style: 'margin-bottom:14px' }, h('button', { class: 'btn primary', onclick: discoverWizard, disabled: !Pedal.connected }, 'Descobrir pisando nos botões…'),
      h('span', { class: 'hint' }, Pedal.connected ? 'Você pisa em cada botão e o app descobre o pino (e o pedal de expressão).' : 'Conecte o pedal para usar o assistente.')),
    h('div', { class: 'pins' }, g.pins.map((p, i) => h('div', { class: 'pinbox' }, h('b', {}, 'Botão ' + (i + 1)),
      (() => { const s = h('select', { onchange: e => { g.pins[i] = e.target.value; changed(); } }, pinOpts.map(([v, t]) => h('option', { value: v }, t))); s.value = p; return s; })(),
      h('label', { class: 'small' }, h('input', { type: 'checkbox', checked: g.activeHigh[i], onchange: e => { g.activeHigh[i] = e.target.checked; changed(); } }), 'ativo em HIGH')))),
    h('p', { class: 'hint', style: 'margin-top:10px' }, 'A4 e A5 são do visor. D0 e D1 são do MIDI/USB.')),
  card('Saída tipo Switch-3', 'para o looper da Play Electric',
    h('div', { class: 'grid2' },
      selectField('Contato A (ponta do P10)', ct.pinA, [['', 'não montado'], ...pinOpts.slice(1)], v => { ct.pinA = v; changed(true); }),
      selectField('Contato B (anel do P10)', ct.pinB, [['', 'não montado'], ...pinOpts.slice(1)], v => { ct.pinB = v; changed(true); })),
    h('p', { class: 'hint', style: 'margin-top:12px' }, 'Precisa montar 2 optoacopladores (ex.: PC817) e um P10 estéreo. Depois, em qualquer botão, adicione “Contato Switch-3”.'),
    h('p', { class: 'hint warn-t', style: 'margin-top:6px' }, 'A ligação ponta/anel veio de montagens caseiras, não do manual oficial. Confirme com a Play Electric antes de usar no palco.')));
}

function renderFile(main) {
  pageHead(main, 'Arquivo e backup', 'Guarde versões da sua configuração, mande para alguém ou peça para o Claude editar.');
  main.append(
    card('Arquivo', null, h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: exportJson }, 'Salvar arquivo…'),
      h('label', { class: 'btn' }, 'Abrir arquivo…', h('input', { type: 'file', accept: '.json,application/json', style: 'display:none', onchange: importJson })))),
    card('Começar de novo', null, h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => { if (!confirm('Trocar o que está na tela pela configuração de fábrica? (o pedal só muda quando você gravar)')) return; cfg = PM.factory(); sel = { view: 'preset', preset: 0, sw: 0 }; changed(true); } }, 'Carregar a de fábrica na tela'),
      h('button', { class: 'btn danger', disabled: !Pedal.connected, onclick: pedalFactory }, 'Voltar o PEDAL para a fábrica')),
      h('p', { class: 'hint', style: 'margin-top:10px' }, 'Toda gravação no pedal baixa antes um backup do que estava nele.')));
}

function exportJson() { download(`pedal-${stamp()}.json`, JSON.stringify(cfg, null, 2)); }
function importJson(e) {
  const f = e.target.files[0]; if (!f) return;
  f.text().then(t => {
    try { cfg = PM.normalize(JSON.parse(t)); sel = { view: 'preset', preset: 0, sw: 0 }; changed(true); toast('Arquivo aberto. Confira e clique em “Gravar no pedal”.'); }
    catch (x) { alert('Não consegui abrir: ' + x.message); }
  });
}
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
function download(name, text) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
  document.body.append(a); a.click(); a.remove();
}

// ---------------- render geral ----------------
function render() {
  if (sel.preset >= cfg.presets.length) sel.preset = 0;
  $('layout').classList.toggle('wide', sel.view !== 'preset');
  renderNav();
  const main = $('main'); main.textContent = '';
  const r = PM.pack(cfg);
  if (r.errors.length) main.append(h('div', { class: 'banner err' }, icon('alert', 18),
    h('div', {}, h('b', {}, r.errors.length === 1 ? 'Um problema impede gravar no pedal' : `${r.errors.length} problemas impedem gravar no pedal`),
      h('ul', {}, r.errors.slice(0, 8).map(e => h('li', {}, `${e.where}: ${e.text}`))))));
  ({ preset: renderPreset, banks: renderBanks, fixed: renderFixed, display: renderDisplay, expression: renderExpression, combos: renderCombos,
     midi: renderMidi, hardware: renderHardware, file: renderFile })[sel.view](main);
  refreshPads();
  renderInspector();
  updateMeter(); updateDirty(); updateConn();
}

// ---------------- conexao ----------------
function updateConn() {
  const c = $('connChip'), ok = Pedal.connected && pedalInfo;
  c.className = 'chip' + (ok ? ' ok' : connErr ? ' err' : '');
  $('connText').textContent = ok ? `Pedal conectado · firmware ${pedalInfo.fw}` : connErr ? 'Pedal não respondeu' : 'Desconectado';
  $('btnConnect').textContent = Pedal.connected ? 'Desconectar' : 'Conectar';
  $('btnRead').disabled = !Pedal.connected;
  $('btnWrite').disabled = !Pedal.connected || (pedalInfo && pedalInfo.schema !== PM.SCHEMA);
}
let connErr = false;
$('connChip').onclick = e => { e.stopPropagation(); $('connPop').hidden = !$('connPop').hidden; };
$('connPop').onclick = e => e.stopPropagation();
document.addEventListener('click', () => { $('connPop').hidden = true; document.querySelectorAll('.menu .pop').forEach(p => { p.hidden = true; }); });

function fillPorts() {
  const fill = (el, ports, keep) => {
    const v = el.value; el.textContent = '';
    if (!ports.length) el.append(h('option', { value: '' }, '(nenhuma porta)'));
    ports.forEach(p => el.append(h('option', { value: p.id }, p.name)));
    el.value = keep && ports.some(p => p.id === v) ? v : (ports.find(p => /usbmidi/i.test(p.name)) || ports[0] || {}).id || '';
  };
  fill($('portIn'), Pedal.inputs(), true); fill($('portOut'), Pedal.outputs(), true);
  const lp = $('learnPort'), lv = lp.value; lp.textContent = '';
  lp.append(h('option', { value: '' }, '(nenhuma)'));
  Pedal.inputs().forEach(p => lp.append(h('option', { value: p.id }, p.name)));
  lp.value = lv;
}

async function connect() {
  if (Pedal.connected) { Pedal.close(); pedalInfo = null; livePreset = null; connErr = false; render(); return; }
  try {
    await Pedal.open($('portIn').value, $('portOut').value);
    log('sys', 'Porta aberta. Procurando o pedal...');
    pedalInfo = await Pedal.hello(); connErr = false;
    log('sys', `Pedal encontrado: firmware ${pedalInfo.fw}, esquema ${pedalInfo.schema}.`);
    $('connPop').hidden = true;
    render();
    if (pedalInfo.schema !== PM.SCHEMA) alert(pedalInfo.schema < PM.SCHEMA ? 'O firmware do pedal é de uma versão anterior. Dá para ler a configuração dele, mas para gravar é preciso atualizar o firmware.' : 'O firmware do pedal é mais novo que este app. Atualize a página (Ctrl+F5).');
    if (confirm('Pedal conectado. Ler a configuração que está nele agora?')) readPedal();
  } catch (e) {
    connErr = true; pedalInfo = null;
    log('sys', 'Erro: ' + e.message + '. O pedal está com o firmware novo? Outro programa está usando a porta?');
    render();
  }
}

async function readPedal() {
  const d = progressDialog('Lendo o pedal...');
  try {
    const mem = await Pedal.readAll(d.set);
    const c = PM.unpack(mem);
    pedalCfg = c; cfg = JSON.parse(JSON.stringify(c)); sel = { view: 'preset', preset: 0, sw: 0 };
    changed(true); d.close(); toast('Configuração lida do pedal.');
    refreshLive();
  } catch (e) { d.close(); alert('Não consegui ler: ' + e.message); }
}

async function writePedal() {
  const r = PM.pack(cfg);
  if (r.errors.length) { alert('Corrija os problemas antes de gravar:\n\n' + r.errors.map(e => `• ${e.where}: ${e.text}`).join('\n')); return; }
  // backup + diff contra o que esta no pedal AGORA
  const p = progressDialog('Lendo o pedal para fazer backup...');
  let current = null, mem;
  try { mem = await Pedal.readAll(p.set); } catch (e) { p.close(); alert('Não consegui ler o pedal: ' + e.message); return; }
  p.close();
  try { current = PM.unpack(mem); } catch (e) { current = null; }
  const changes = PM.diff(current, cfg);
  const ok = await confirmDiff(changes, current == null);
  if (!ok) return;
  if (current) download(`backup-pedal-${stamp()}.json`, JSON.stringify(current, null, 2));
  else download(`backup-pedal-${stamp()}.bin.json`, JSON.stringify({ raw: Array.from(mem) }));
  const w = progressDialog('Gravando no pedal... não desligue');
  try {
    await Pedal.writeAll(r.data, w.set);
    w.title('Conferindo...');
    const back = await Pedal.readAll(w.set);
    for (let i = 0; i < PM.CFG_END; i++) if (back[i] !== r.data[i]) throw new Error('o que foi lido de volta é diferente no byte ' + i);
    pedalCfg = JSON.parse(JSON.stringify(cfg));
    w.close(); toast('Gravado e conferido no pedal.'); log('sys', `Gravado: ${changes.length} mudança(s).`);
    updateDirty(); refreshLive();
  } catch (e) { w.close(); alert('Falhou ao gravar: ' + e.message + '\n\nO backup foi baixado. Tente de novo; se o pedal ficar sem configuração válida, ele volta para a de fábrica ao ligar.'); }
}

async function pedalFactory() {
  if (!confirm('Apagar a configuração do PEDAL e voltar para a de fábrica?\nAntes vou baixar um backup.')) return;
  try {
    const mem = await Pedal.readAll();
    try { download(`backup-pedal-${stamp()}.json`, JSON.stringify(PM.unpack(mem), null, 2)); } catch (x) { download(`backup-pedal-${stamp()}.bin.json`, JSON.stringify({ raw: Array.from(mem) })); }
    await Pedal.factory(); toast('Pedal voltou para a configuração de fábrica.'); readPedal();
  } catch (e) { alert('Erro: ' + e.message); }
}

async function refreshLive() {
  if (!Pedal.connected) return;
  try { const s = await Pedal.getState(); livePreset = s.preset - 1; renderNav(); } catch (e) {}
}

// ---------------- janelas ----------------
function progressDialog(title) {
  const dlg = $('dlg'); dlg.textContent = '';
  const t = h('h2', {}, title), bar = h('i');
  dlg.append(h('div', { class: 'dhead' }, t), h('div', { class: 'dbody' }, h('div', { class: 'progress' }, bar)));
  dlg.showModal();
  return { set: f => { bar.style.width = Math.round(f * 100) + '%'; }, title: s => { t.textContent = s; }, close: () => dlg.close() };
}

function confirmDiff(changes, unknown) {
  return new Promise(res => {
    const dlg = $('dlg'); dlg.textContent = '';
    const body = h('div', { class: 'dbody' });
    if (unknown) body.append(h('p', {}, 'O pedal ainda não tem uma configuração deste app (firmware recém-gravado ou memória vazia). Tudo será gravado do zero.'));
    else if (!changes.length) body.append(h('p', {}, 'Nada mudou em relação ao que já está no pedal.'));
    else body.append(h('p', { class: 'hint' }, `${changes.length} mudança(s). Riscado em vermelho sai, em verde entra:`),
      h('table', { class: 'diff' }, changes.map(c => h('tr', {}, h('td', {}, c.key), h('td', {}, h('div', { class: 'from' }, c.from), h('div', { class: 'to' }, c.to))))));
    body.append(h('p', { class: 'hint' }, 'Antes de gravar eu baixo um backup do que está no pedal agora.'));
    const done = v => { dlg.close(); res(v); };
    dlg.append(h('div', { class: 'dhead' }, h('h2', {}, 'Gravar no pedal?')), body,
      h('div', { class: 'dfoot' }, h('button', { class: 'btn', onclick: () => done(false) }, 'Cancelar'),
        h('button', { class: 'btn primary', onclick: () => done(true), disabled: !unknown && !changes.length }, 'Gravar')));
    dlg.oncancel = () => res(false);
    dlg.showModal();
  });
}

// ---------------- assistente: descobrir pinos e calibrar expressao ----------------
let wiz = null;
async function discoverWizard() {
  if (!Pedal.connected) return toast('Conecte o pedal primeiro.');
  try { await Pedal.discover(true); } catch (e) { return alert('O pedal não entrou no modo descoberta: ' + e.message); }
  wiz = { step: 0, pins: Array(8).fill(''), high: Array(8).fill(false), pending: null, an: {}, phase: 'buttons' };
  drawWizard();
  $('dlg').showModal();
}
function drawWizard() {
  const dlg = $('dlg'); dlg.textContent = '';
  const body = h('div', { class: 'dbody' });
  if (wiz.phase === 'buttons') {
    body.append(h('div', { class: 'wiz-big' }, wiz.pending ? `Solte o botão ${wiz.step + 1}...` : `Pise no botão ${wiz.step + 1}`),
      h('p', { class: 'hint' }, 'Pise e solte cada botão, na ordem. Se um botão não existir ou não responder, clique em Pular.'),
      h('div', { class: 'wiz-pins' }, wiz.pins.map((p, i) => h('div', { class: (p ? 'done' : '') + (i === wiz.step ? ' cur' : '') }, `Botão ${i + 1}: ${p || '…'}`))));
  } else {
    const best = bestAnalog();
    body.append(h('div', { class: 'wiz-big' }, 'Mova o pedal de expressão'),
      h('p', { class: 'hint' }, 'Leve o pedal de expressão até o fim, para trás e para a frente, algumas vezes. Se não tiver pedal de expressão, clique em Pular.'),
      h('p', {}, best ? `Detectado no pino ${best.pin}: leitura de ${best.min} a ${best.max}` : 'Nenhum movimento detectado ainda.'));
  }
  const foot = h('div', { class: 'dfoot' },
    h('button', { class: 'btn', onclick: () => finishWizard(false) }, 'Cancelar'),
    h('button', { class: 'btn', onclick: () => wiz.phase === 'buttons' ? nextBtn('') : finishWizard(true, true) }, 'Pular'),
    wiz.phase === 'expr' && bestAnalog() ? h('button', { class: 'btn primary', onclick: () => finishWizard(true) }, 'Concluir') : null);
  dlg.append(h('div', { class: 'dhead' }, h('h2', {}, 'Descobrir pinos')), body, foot);
  dlg.oncancel = () => finishWizard(false);
}
function bestAnalog(w = wiz) {
  let b = null;
  for (const [pin, r] of Object.entries(w.an)) if (r.max - r.min > 200 && (!b || r.max - r.min > b.max - b.min)) b = { pin, ...r };
  return b;
}
function nextBtn(pin, high) {
  wiz.pins[wiz.step] = pin; wiz.high[wiz.step] = !!high; wiz.pending = null; wiz.step++;
  if (wiz.step >= 8) wiz.phase = 'expr';
  drawWizard();
}
function wizardEvent(ev) {
  if (!wiz) return;
  if (ev.cmd === 0x4D && wiz.phase === 'buttons') {
    const pin = PM.pinName(ev.body[0]), level = ev.body[1];
    if (!wiz.pending) {
      if (wiz.pins.includes(pin)) return;                      // pino ja usado (soltou o anterior)
      wiz.pending = { pin, level }; drawWizard();
    } else if (pin === wiz.pending.pin && level !== wiz.pending.level) nextBtn(pin, wiz.pending.level === 1);
  } else if (ev.cmd === 0x4C) {
    const pin = PM.pinName(ev.body[0]), v = (ev.body[1] << 7) | ev.body[2];
    if (wiz.pins.includes(pin)) return;
    const r = wiz.an[pin] || (wiz.an[pin] = { min: v, max: v });
    r.min = Math.min(r.min, v); r.max = Math.max(r.max, v);
    if (wiz.phase === 'expr') drawWizard();
  }
}
async function finishWizard(save, skipExpr) {
  const w = wiz; wiz = null; $('dlg').close();
  try { await Pedal.discover(false); } catch (e) {}
  if (!save) return;
  cfg.global.pins = w.pins; cfg.global.activeHigh = w.high;
  const best = skipExpr ? null : bestAnalog(w);
  if (best) Object.assign(cfg.global.expression, { pin: best.pin, calLow: best.min + 4, calHigh: best.max - 4 });
  changed(true);
  toast('Pinos descobertos. Clique em “Gravar no pedal” para salvar.');
}

// ---------------- monitor ----------------
const monLog = $('monLog'); let monN = 0;
function openMonitor() { $('monitor').classList.remove('closed'); }
function log(cls, text) {
  const line = h('div', { class: cls }, `${new Date().toLocaleTimeString()}  ${text}`);
  monLog.append(line); monN++;
  while (monLog.childNodes.length > 400) monLog.firstChild.remove();
  monLog.scrollTop = monLog.scrollHeight;
  $('monCount').textContent = monN + ' mensagens';
}
function describeRaw(d) {
  const st = d[0] & 0xF0, c = (d[0] & 15) + 1;
  if (d[0] === 0xF0) return 'SysEx ' + d.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  switch (st) {
    case 0xB0: return `CC ${d[1]} = ${d[2]}  (canal ${c})`;
    case 0xC0: return `PC ${d[1]}  (canal ${c})`;
    case 0x90: return d[2] ? `Nota ${d[1]} liga vel ${d[2]}  (canal ${c})` : `Nota ${d[1]} desliga  (canal ${c})`;
    case 0x80: return `Nota ${d[1]} desliga  (canal ${c})`;
    case 0xE0: return `Pitch bend  (canal ${c})`;
  }
  if (d[0] === 0xFA) return 'Clock: start'; if (d[0] === 0xFC) return 'Clock: stop';
  return d.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}
let lastClock = 0;
Pedal.on('message', m => {
  if (m.data[0] === 0xF8) { if (m.time - lastClock > 2000) { lastClock = m.time; log('in', 'Clock (pulsos)…'); } return; }
  if (m.data[0] === 0xFE) return;
  // conversa de configuracao com o pedal (SysEx que vai, quadros AF que voltam): nao polui o monitor
  if (m.data[0] === 0xF0 && m.data[1] === 0x7D && m.data[2] === 0x50) return;
  if (m.source === 'pedal' && m.data[0] === 0xAF) return;
  if (m.dir === 'in' && learnFrom(m.data)) { log('learn', 'aprendido ← ' + describeRaw(m.data)); return; }
  if (m.dir === 'in' && m.source === 'pedal') flashPadFor(m.data);
  log(m.dir === 'out' ? 'out' : (m.source === 'learn' ? 'learn' : 'in'),
    (m.dir === 'out' ? 'PC → pedal: ' : m.source === 'learn' ? 'pedaleira → PC: ' : 'pedal → PC: ') + describeRaw(m.data));
});
Pedal.on('event', wizardEvent);
Pedal.on('ports', fillPorts);

// acende o botao que provavelmente mandou esta mensagem
function flashPadFor(d) {
  if (sel.view !== 'preset') return;
  const pr = cfg.presets[livePreset != null ? livePreset : sel.preset];
  if (!pr || (livePreset != null && livePreset !== sel.preset)) return;
  pr.switches.forEach((sw, i) => {
    const hit = [...sw.press, ...sw.release, ...sw.hold, ...sw.doubleTap].some(m => {
      const c = (m.channel || cfg.global.channel) - 1;
      if (m.type === 'cc' || m.type === 'ramp') return d[0] === (0xB0 | c) && d[1] === m.number;
      if (m.type === 'pc') return d[0] === (0xC0 | c) && d[1] === m.number;
      return false;
    });
    if (hit) { const f = document.querySelector(`#pad${i} .flash`); if (f) { f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 60); } }
  });
}

// ---------------- inicio ----------------
$('btnConnect').onclick = connect;
$('btnRead').onclick = readPedal;
$('btnWrite').onclick = writePedal;
$('monBar').onclick = () => $('monitor').classList.toggle('closed');
$('monClear').onclick = () => { monLog.textContent = ''; monN = 0; $('monCount').textContent = ''; };
$('learnPort').onchange = e => Pedal.setLearnPort(e.target.value);

loadDraft();
render();
Pedal.init().then(() => { fillPorts(); log('sys', 'Web MIDI pronto. Ligue o pedal e clique em Conectar.'); })
  .catch(e => { log('sys', e.message); $('connHint').textContent = e.message; $('btnConnect').disabled = true; });
