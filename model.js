// PedalConfig - modelo da configuracao (JSON = fonte de verdade) e conversao para a EEPROM (schema v2).
// O layout binario espelha firmware/PedalMidi/engine.h (pm::Builder). Mudou la? Mude aqui.
'use strict';

const PM = (() => {
  // preset: nome(16), camada(1), acao "ao entrar"(1), flags(1), nome curto(3), 8 rotulos x 3 letras, 8 switches x 5
  const EE_SIZE = 1024, CFG_END = 992, SPLASH = 960, BANK_LBL = 942, NBANK_LBL = 6, DATA_END = 942, GLB = 16, CMB = 64, PRESETS = 80, NAME = 10, MAX_PRESETS = 12, NCOMBO = 4;   // 942..959 siglas dos bancos, 960..991 mensagem ao ligar
  // esquema 3: preset = nome(10) camada enter flags nome-curto(3) + SO os botoes que nao sao fixos: rotulos(3 cada) e switches(5 cada)
  const SCHEMA = 3, P_LAYER = 10, P_ENTER = 11, P_FLAGS = 12, P_SHORT = 13, P_LABELS = 16, PF_SYNC = 1, PF_RESET = 2, PF_ENTER_PC = 4, BH_TAP = 16, BH_DIRECT = 32;
  // onde cada botao fica dentro do preset (igual a pm::presetLayout): botoes fixos (TAP/MOD) nao ocupam espaco
  function layoutV3(modeSw, tapSw) {     // modeSw/tapSw: 0..7 ou -1
    const slot = []; let n = 0;
    for (let s = 0; s < 8; s++) slot.push(s === modeSw || s === tapSw ? -1 : n++);
    return { SIZE: P_LABELS + n * 8, NAME, LAYER: P_LAYER, ENTER: P_ENTER, FLAGS: P_FLAGS, SHORT: P_SHORT, LABELS: P_LABELS, SW: P_LABELS + n * 3, slot };
  }
  const ALL8 = [0, 1, 2, 3, 4, 5, 6, 7];
  const D_TOP_1TO4 = 1, D_NO_TEMPO = 2, D_NO_PNUM = 4;
  // layouts antigos (so para ler e migrar): todos os 8 botoes guardados
  const V1 = { SIZE: 75, NAME: 8, LAYER: 8, ENTER: 9, FLAGS: 10, SHORT: -1, LABELS: 11, SW: 35, slot: ALL8 };
  const V2 = { SIZE: 86, NAME: 16, LAYER: 16, ENTER: 17, FLAGS: 18, SHORT: 19, LABELS: 22, SW: 46, slot: ALL8 };
  const shortOf = n => String(n || ').toUpperCase().replace(/[^ -Z]/g, ').trim().slice(0, 3);
  const H = { NPRESETS: 3, PPB: 4, NACTIONS: 5, ACT: 6, MSG: 8, NSLOTS: 10, CK: 11 };
  const G = { CHANNEL: 0, HOLD: 1, DTAP: 2, FLAGS: 3, BPM: 4, STARTPRESET: 5, PINS: 6, ACTIVE: 14, EXPR_PIN: 15, EXPR_CC: 16, EXPR_CH: 17,
              EXPR_MIN: 18, EXPR_MAX: 19, EXPR_CURVE: 20, EXPR_LO: 21, EXPR_HI: 23, COMBO_MS: 25, SYNC_MS: 26, DISPLAY: 27,
              MODE_SW: 28, TAP_SW: 29, FIX_FLAGS: 30, TAP_ACT: 31, TUNER_ON_ACT: 32, TUNER_OFF_ACT: 33, TAP_LABEL: 34, MODE_LABEL: 37,
              CT_PIN_A: 40, CT_PIN_B: 41, SPLASH_SEC: 42, SPLASH_FX: 43, ALT_T: 44, ANN_T: 45 };
  // efeitos da mensagem ao ligar (mesma ordem de SP_* no firmware)
  const SPLASH_FX = [['static', 'Fixa'], ['blink', 'Pisca invertido'], ['flash', 'Pisca-pisca'], ['type', 'Digitando'],
                     ['scroll', 'Rolando'], ['wipe', 'Cortina'], ['shine', 'Brilho']];
  const BEHAVIORS = ['momentary', 'toggle', 'step', 'macro'];
  const CURVES = ['linear', 'log', 'exp'];
  const EVENTS = ['press', 'release', 'hold', 'doubleTap'];

  // Acoes do pedal (nao mandam MIDI). kind 9 = interna, 8 = clock
  const OPS = [
    { id: 'bank+', text: 'Banco +', kind: 9, code: 1 },
    { id: 'bank-', text: 'Banco -', kind: 9, code: 2 },
    { id: 'bank', text: 'Ir para banco', kind: 9, code: 3, arg: 'banco', min: 1, max: 16 },
    { id: 'preset+', text: 'Preset +', kind: 9, code: 4 },
    { id: 'preset-', text: 'Preset -', kind: 9, code: 5 },
    { id: 'preset', text: 'Ir para preset', kind: 9, code: 6, arg: 'preset', min: 1, max: 16 },
    { id: 'layer', text: 'Camada: alterna', kind: 9, code: 7 },
    { id: 'layerOn', text: 'Camada: liga', kind: 9, code: 8 },
    { id: 'layerOff', text: 'Camada: desliga', kind: 9, code: 9 },
    { id: 'channel+', text: 'Canal global +', kind: 9, code: 10 },
    { id: 'channel-', text: 'Canal global -', kind: 9, code: 11 },
    { id: 'channel', text: 'Definir canal global', kind: 9, code: 12, arg: 'canal', min: 1, max: 16 },
    { id: 'lock', text: 'Travar/destravar botões', kind: 9, code: 13 },
    { id: 'tap', text: 'Tap tempo (BPM do clock)', kind: 9, code: 14 },
    { id: 'clockOn', text: 'MIDI Clock: liga', kind: 8, code: 1 },
    { id: 'clockOff', text: 'MIDI Clock: desliga', kind: 8, code: 0 },
    { id: 'clockToggle', text: 'MIDI Clock: liga/desliga', kind: 8, code: 2 },
    { id: 'bpm', text: 'MIDI Clock: definir BPM', kind: 8, code: 3, arg: 'BPM', min: 30, max: 255 },
  ];
  const op = id => OPS.find(o => o.id === id);
  const opCode = (k, c) => OPS.find(o => o.kind === k && o.code === c);

  const MSG_TYPES = [
    { id: 'cc', text: 'CC (controle)' },
    { id: 'pc', text: 'PC (troca de patch)' },
    { id: 'bank', text: 'Bank Select' },
    { id: 'noteOn', text: 'Nota liga' },
    { id: 'noteOff', text: 'Nota desliga' },
    { id: 'sysex', text: 'SysEx' },
    { id: 'ramp', text: 'Rampa de CC' },
    { id: 'contact', text: 'Contato (Switch-3)' },
    { id: 'delay', text: 'Espera' },
    { id: 'pedal', text: 'Ação do pedal' },
  ];
  // contato tipo Switch-3: botao 1 = contato A (ponta), 2 = B (anel), 3 = os dois
  const CONTACT_MODES = [['open', 'abre'], ['close', 'fecha (fica fechado)'], ['pulse', 'toque']];
  const RAMP_MODES = [['once', 'vai até o fim'], ['while', 'só enquanto segura'], ['return', 'volta ao soltar']];
  const RAMP_CURVES = [['linear', 'linear'], ['log', 'logarítmica (rápida no começo)'], ['exp', 'exponencial (lenta no começo)']];

  // ---------- objetos padrao ----------
  const newMsg = (type = 'cc') => {
    const m = { type, channel: 0, number: 0, value: 127, data: '', op: '' };
    if (type === 'delay') m.value = 100;
    if (type === 'bank') { m.number = 0; m.value = -1; }
    if (type === 'sysex') m.data = 'F0 7D 00 F7';
    if (type === 'pedal') { m.op = 'preset+'; m.value = 0; }
    if (type === 'noteOff') m.value = 0;
    if (type === 'ramp') Object.assign(m, { number: 11, from: 0, to: 127, ms: 1000, mode: 'return', curve: 'linear' });
    if (type === 'contact') Object.assign(m, { number: 1, value: 0, mode: 'pulse', ms: 100 });
    return m;
  };
  // label: nome de 3 letras no visor; tap: botao de tap (mede o tempo e o nome pisca)
  const newSwitch = (i = 0) => ({ label: 'FS' + (i + 1), behavior: 'macro', tap: false, pingPong: false, startOn: false, press: [], release: [], hold: [], doubleTap: [] });
  // enter: mensagens ao entrar no preset (ex.: PC da pedaleira)
  // syncOnEnter: depois do "enter" + espera, manda o estado de todos os liga/desliga
  // resetOnEnter: ao entrar, liga/desliga voltam ao estado configurado (startOn)
  // name: ate 16 letras, aparece na tela inteira ao trocar de preset; short: 3 letras do modo preset (MOD)
  const newPreset = (name = 'PRESET', short = '') => ({ name, short: short || shortOf(name), layer: 0, enter: [], syncOnEnter: false, resetOnEnter: false, switches: Array.from({ length: 8 }, (_, i) => newSwitch(i)) });
  const newConfig = () => ({
    schema: SCHEMA,
    global: {
      channel: 1, holdMs: 500, doubleTapMs: 300, comboMs: 50, syncDelayMs: 100, persistState: false, wrap: true, clockAtBoot: false, bpm: 120,
      startPreset: 1, presetsPerBank: 16,
      display: { topRow: '5-8', tempoColumn: true, presetNumber: true, modBlink: 0.5, nameSeconds: 1.5 },   // tempos em segundos (decimos no pedal)   // linha de cima do visor: botoes 5-8 ou 1-4
      // botoes fixos (iguais em todos os presets). 0 = nenhum, 1..8 = botao
      fixed: { modeSwitch: 0, tapSwitch: 0, autoReturn: true, modeLabel: 'MOD', tapLabel: 'TAP', tap: [], tunerOn: [], tunerOff: [] },
      // pinos dos 2 optoacopladores que imitam o Switch-3 ('' = nao montado)
      contacts: { pinA: '', pinB: '' },
      // mensagem ao ligar: 2 linhas de ate 16, centralizadas; seconds 0 = nao mostra
      splash: { line1: '', line2: '', seconds: 4, effect: 'blink' },
      // sigla de cada banco (aparece ao segurar MOD)
      bankLabels: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'],
      pins: ['D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9'], activeHigh: [false, false, false, false, false, false, false, false],
      expression: { pin: '', cc: 11, channel: 0, min: 0, max: 127, curve: 'linear', calLow: 0, calHigh: 1023 },
    },
    presets: [], combos: [],
  });

  function normalize(c) {
    const d = newConfig();
    if (!c || typeof c !== 'object') throw new Error('JSON vazio ou inválido.');
    if (!(c.schema >= 1 && c.schema <= SCHEMA)) throw new Error('Versão de schema não suportada: ' + c.schema);
    c.schema = SCHEMA;                                     // v1 -> v2: ganha o nome curto (3 primeiras letras do nome)
    c.global = Object.assign(d.global, c.global || {});
    c.global.expression = Object.assign(newConfig().global.expression, (c.global && c.global.expression) || {});
    c.global.display = Object.assign(newConfig().global.display, (c.global && c.global.display) || {});
    c.global.fixed = Object.assign(newConfig().global.fixed, (c.global && c.global.fixed) || {});
    c.global.contacts = Object.assign(newConfig().global.contacts, (c.global && c.global.contacts) || {});
    c.global.splash = Object.assign(newConfig().global.splash, (c.global && c.global.splash) || {});
    c.global.bankLabels = newConfig().global.bankLabels.map((d, i) => { const v = ((c.global && c.global.bankLabels) || [])[i]; return typeof v === 'string' ? v : d; });
    ['tap', 'tunerOn', 'tunerOff'].forEach(k => { c.global.fixed[k] = (c.global.fixed[k] || []).map(m => Object.assign(newMsg(m.type || 'cc'), m)); });
    while (c.global.pins.length < 8) c.global.pins.push('');
    while (c.global.activeHigh.length < 8) c.global.activeHigh.push(false);
    c.presets = (c.presets || []).map(p => {
      const np = Object.assign(newPreset(), p);
      if (!p.short) np.short = shortOf(np.name);
      np.enter = (p.enter || []).map(m => Object.assign(newMsg(m.type || 'cc'), m));
      np.switches = Array.from({ length: 8 }, (_, i) => {
        const s = Object.assign(newSwitch(i), (p.switches || [])[i] || {});
        delete s.sendInitial;                                   // campo antigo (virou syncOnEnter no preset)
        EVENTS.forEach(ev => { s[ev] = (s[ev] || []).map(m => Object.assign(newMsg(m.type || 'cc'), m)); });
        return s;
      });
      return np;
    });
    if (!c.presets.length) c.presets.push(newPreset());
    c.combos = (c.combos || []).map(cb => ({ a: cb.a || 1, b: cb.b || 2, action: (cb.action || []).map(m => Object.assign(newMsg(m.type), m)) }));
    return c;
  }

  // ---------- fabrica (igual a pm::writeFactory) ----------
  function factory() {
    const c = newConfig();
    const ccs = [90, 64, 108, 102, 103, 71, 97, 98];
    const names = ['ORIGINAL', 'PRESET 2', 'PRESET 3', 'PRESET 4'];
    for (let p = 0; p < 4; p++) {
      const pr = newPreset(names[p]);
      for (let s = 0; s < 8; s++) {
        const cc = p === 0 ? ccs[s] : 20 + (p - 1) * 8 + s;
        const on = (p === 0 && s === 5) ? 2 : 127;
        const sw = pr.switches[s];
        sw.press.push(Object.assign(newMsg('cc'), { number: cc, value: on }));
        if (p === 0 && s === 1) { sw.behavior = 'macro'; continue; }
        sw.behavior = 'toggle';
        sw.release.push(Object.assign(newMsg('cc'), { number: cc, value: 0 }));
      }
      c.presets.push(pr);
    }
    c.combos.push({ a: 1, b: 2, action: [Object.assign(newMsg('pedal'), { op: 'preset-', value: 0 })] });
    c.combos.push({ a: 7, b: 8, action: [Object.assign(newMsg('pedal'), { op: 'preset+', value: 0 })] });
    return c;
  }

  // ---------- utilidades ----------
  const pinCode = p => {
    if (!p) return 127;
    p = String(p).trim().toUpperCase();
    let m = /^D(\d+)$/.exec(p); if (m && +m[1] >= 2 && +m[1] <= 13) return +m[1];
    m = /^A(\d)$/.exec(p); if (m && +m[1] <= 3) return 14 + +m[1];
    return -1;
  };
  const pinName = c => (c >= 2 && c <= 13) ? 'D' + c : (c >= 14 && c <= 17) ? 'A' + (c - 14) : '';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ch = c => (c <= 0 ? 16 : c - 1);
  // formato compacto do firmware (BH_DIRECT): botao com 1 CC ao pisar/ligar e (opcional) o mesmo CC ao soltar/desligar,
  // sem segurar/2 toques. Fica todo dentro do botao (5 bytes), sem gastar acoes. O app escolhe sozinho.
  function directOf(sw) {
    if (sw.behavior === 'step' || (sw.hold || []).length || (sw.doubleTap || []).length) return null;
    const p = sw.press || [], r = sw.release || [];
    if (p.length !== 1 || p[0].type !== 'cc' || r.length > 1) return null;
    if (r.length && (r[0].type !== 'cc' || r[0].number !== p[0].number || (r[0].channel || 0) !== (p[0].channel || 0))) return null;
    return { cc: p[0].number, on: p[0].value, off: r.length ? r[0].value : 0x80, ch: ch(p[0].channel) };
  }
  function checksum(e) {
    let s = 0x5A5A;
    const step = b => { s = (((s << 1) | (s >>> 15)) & 0xFFFF) ^ b; };
    for (let a = 2; a <= 10; a++) step(e[a]);
    for (let a = GLB; a < CFG_END; a++) step(e[a]);
    return s;
  }
  function parseHex(s) {
    const t = String(s || '').trim().split(/[\s,]+/).filter(Boolean);
    return t.map(x => { const v = parseInt(x.replace(/^0x/i, ''), 16); if (isNaN(v) || v < 0 || v > 255) throw new Error('hexa'); return v; });
  }
  const ascii = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '');

  function encodeMsgs(list) {
    const slots = [];
    for (const m of list) {
      switch (m.type) {
        case 'cc': slots.push([1, ch(m.channel), m.number, m.value]); break;
        case 'pc': slots.push([2, ch(m.channel), m.number, 0]); break;
        case 'noteOn': slots.push([3, ch(m.channel), m.number, m.value]); break;
        case 'noteOff': slots.push([4, ch(m.channel), m.number, 0]); break;
        case 'bank': slots.push([7, ch(m.channel), m.number < 0 ? 0x80 : m.number, m.value < 0 ? 0x80 : m.value]); break;
        case 'delay': slots.push([6, 0, clamp(Math.round(m.value / 10), 1, 255), 0]); break;
        case 'contact':
          slots.push([11, clamp(Math.round(m.ms / 10), 2, 255), m.number, CONTACT_MODES.findIndex(x => x[0] === m.mode)]);
          break;
        case 'ramp': {
          const md = RAMP_MODES.findIndex(x => x[0] === m.mode), cv = RAMP_CURVES.findIndex(x => x[0] === m.curve);
          slots.push([10, ch(m.channel), m.number, md | (cv << 2)]);
          slots.push([m.from, m.to, m.ms & 255, m.ms >> 8]);
          break;
        }
        case 'sysex': {
          const d = parseHex(m.data);
          slots.push([5, d.length, 0, 0]);
          for (let i = 0; i < d.length; i += 4) slots.push([d[i], d[i + 1] || 0, d[i + 2] || 0, d[i + 3] || 0]);
          break;
        }
        case 'pedal': {
          const o = op(m.op);
          const arg = o.arg ? (o.id === 'bpm' ? m.value : m.value - 1) : 0;
          slots.push([o.kind, 0, o.code, arg]);
          break;
        }
      }
    }
    return slots;
  }

  // ---------- validacao ----------
  function checkMsgs(errs, list, where, c) {
    const isInt = v => Number.isInteger(v);
    for (const m of list) {
      const e = t => errs.push({ where, text: t });
      if (!isInt(m.channel) || m.channel < 0 || m.channel > 16) e('canal inválido.');
      switch (m.type) {
        case 'cc': case 'noteOn':
          if (!isInt(m.number) || m.number < 0 || m.number > 127 || !isInt(m.value) || m.value < 0 || m.value > 127) e('número e valor devem ser de 0 a 127.'); break;
        case 'pc': case 'noteOff':
          if (!isInt(m.number) || m.number < 0 || m.number > 127) e('número deve ser de 0 a 127.'); break;
        case 'bank':
          if (!isInt(m.number) || m.number < -1 || m.number > 127 || !isInt(m.value) || m.value < -1 || m.value > 127) e('Bank MSB/LSB de 0 a 127 (ou vazio).'); break;
        case 'delay':
          if (!isInt(m.value) || m.value < 10 || m.value > 2550) e('espera de 10 a 2550 ms.'); break;
        case 'contact':
          if (![1, 2, 3].includes(m.number)) e('contato: escolha o botão 1, 2 ou 3 do Switch-3.');
          if (!CONTACT_MODES.some(x => x[0] === m.mode)) e('contato: ação inválida.');
          if (m.mode === 'pulse' && (!isInt(m.ms) || m.ms < 20 || m.ms > 2550)) e('contato: toque de 20 a 2550 ms.');
          if (!c.global.contacts.pinA || !c.global.contacts.pinB) e('contato: escolha em Geral os pinos dos 2 optoacopladores.');
          break;
        case 'ramp':
          if ([m.number, m.from, m.to].some(v => !isInt(v) || v < 0 || v > 127)) e('rampa: CC, início e fim de 0 a 127.');
          if (!isInt(m.ms) || m.ms < 20 || m.ms > 60000) e('rampa: duração de 20 a 60000 ms.');
          if (!RAMP_MODES.some(x => x[0] === m.mode)) e('rampa: modo inválido.');
          if (!RAMP_CURVES.some(x => x[0] === m.curve)) e('rampa: curva inválida.');
          break;
        case 'sysex': {
          let d; try { d = parseHex(m.data); } catch (x) { e('SysEx com texto inválido (use hexa, ex.: F0 7D 01 F7).'); break; }
          if (d.length < 2 || d.length > 12 || d[0] !== 0xF0 || d[d.length - 1] !== 0xF7) e('SysEx deve começar com F0, terminar com F7 e ter até 12 bytes.');
          else if (d.slice(1, -1).some(b => b > 0x7F)) e('SysEx com byte de dado acima de 7F.');
          break;
        }
        case 'pedal': {
          const o = op(m.op);
          if (!o) { e('ação do pedal desconhecida.'); break; }
          if (o.arg && (!isInt(m.value) || m.value < o.min || m.value > o.max)) e(`${o.text} precisa de ${o.arg} de ${o.min} a ${o.max}.`);
          if (o.id === 'preset' && m.value > c.presets.length) e(`preset ${m.value} não existe.`);
          break;
        }
        default: e(`tipo de mensagem desconhecido "${m.type}".`);
      }
    }
  }

  function validate(c) {
    const errs = []; const g = c.global;
    const e = (where, text) => errs.push({ where, text });
    if (c.presets.length < 1 || c.presets.length > MAX_PRESETS) e('Geral', `número de presets deve ser de 1 a ${MAX_PRESETS}.`);
    if (g.channel < 1 || g.channel > 16) e('Geral', 'canal global deve ser de 1 a 16.');
    if (g.holdMs < 100 || g.holdMs > 2550) e('Geral', 'tempo de segurar: 100 a 2550 ms.');
    if (g.doubleTapMs < 50 || g.doubleTapMs > 2550) e('Geral', 'janela de dois toques: 50 a 2550 ms.');
    if (g.comboMs < 20 || g.comboMs > 255) e('Geral', 'janela do combo: 20 a 255 ms.');
    if (!(g.syncDelayMs >= 0 && g.syncDelayMs <= 2550)) e('Geral', 'espera para sincronizar: 0 a 2550 ms.');
    if (g.bpm < 30 || g.bpm > 255) e('Geral', 'BPM: 30 a 255.');
    if (g.presetsPerBank < 1 || g.presetsPerBank > 16) e('Geral', 'presets por banco: 1 a 16.');
    if (g.startPreset < 1 || g.startPreset > c.presets.length) e('Geral', 'preset ao ligar não existe.');
    const used = new Set();
    g.pins.forEach((p, i) => {
      const pc = pinCode(p);
      if (pc < 0) e('Geral', `pino inválido no botão ${i + 1}: ${p}`);
      else if (pc !== 127) { if (used.has(pc)) e('Geral', `pino ${p} usado em mais de um botão.`); used.add(pc); }
    });
    const ctp = [g.contacts.pinA, g.contacts.pinB];
    ctp.forEach((p, k) => {
      if (!p) return;
      const pc = pinCode(p);
      if (pc < 0 || pc === 127) e('Switch-3', `pino inválido no contato ${k ? 'B' : 'A'}: ${p}`);
      else if (used.has(pc)) e('Switch-3', `o pino ${p} já é usado por um botão.`);
      else used.add(pc);
    });
    if (ctp[0] && ctp[0] === ctp[1]) e('Switch-3', 'os contatos A e B precisam de pinos diferentes.');
    const sp = g.splash;
    [sp.line1, sp.line2].forEach(l => { if (String(l || '').length > 16 || !/^[ -Z]*$/.test(l || '')) e('Mensagem ao ligar', 'cada linha: até 16 caracteres maiúsculos.'); });
    if (!(sp.seconds >= 0 && sp.seconds <= 30)) e('Mensagem ao ligar', 'tempo: 0 a 30 segundos.');
    if (!SPLASH_FX.some(x => x[0] === sp.effect)) e('Mensagem ao ligar', 'efeito inválido.');
    [['modBlink', 'troca do MOD'], ['nameSeconds', 'tempo do nome do preset']].forEach(([k, t]) => { const v = g.display[k] ?? 1; if (!(v >= 0.1 && v <= 5)) e('Visor', t + ': de 0,1 a 5 segundos.'); });
    g.bankLabels.forEach((l, i) => { if (String(l || '').length > 3 || !/^[ -Z]*$/.test(l || '')) e('Bancos', `sigla do banco ${i + 1}: até 3 caracteres maiúsculos.`); });
    const x = g.expression;
    if (x.pin) {
      const pc = pinCode(x.pin);
      if (pc < 14) e('Expressão', 'precisa de um pino analógico (A0 a A3).');
      else if (used.has(pc)) e('Expressão', 'o pino já é usado por um botão ou contato.');
      if ([x.cc, x.min, x.max].some(v => v < 0 || v > 127)) e('Expressão', 'CC e faixa de 0 a 127.');
      if (x.calLow < 0 || x.calHigh > 1023 || x.calHigh <= x.calLow) e('Expressão', 'calibração inválida.');
      if (!CURVES.includes(x.curve)) e('Expressão', 'curva inválida.');
    }
    const fx = g.fixed;
    if (fx.modeSwitch < 0 || fx.modeSwitch > 8 || fx.tapSwitch < 0 || fx.tapSwitch > 8) e('Botões fixos', 'botão inválido.');
    if (fx.modeSwitch && fx.modeSwitch === fx.tapSwitch) e('Botões fixos', 'MODO e TAP não podem ser o mesmo botão.');
    [fx.modeLabel, fx.tapLabel].forEach(l => { if (String(l || '').length > 3 || !/^[ -Z]*$/.test(l || '')) e('Botões fixos', 'nome no visor: até 3 caracteres maiúsculos.'); });
    checkMsgs(errs, fx.tap, 'Botões fixos (tap)', c); checkMsgs(errs, fx.tunerOn, 'Botões fixos (liga afinador)', c); checkMsgs(errs, fx.tunerOff, 'Botões fixos (desliga afinador)', c);
    if (c.combos.length > NCOMBO) e('Combos', `no máximo ${NCOMBO} combos.`);
    c.combos.forEach(cb => {
      const w = `Combo ${cb.a}+${cb.b}`;
      if (cb.a < 1 || cb.a > 8 || cb.b < 1 || cb.b > 8 || cb.a === cb.b) e(w, 'botões inválidos.');
      checkMsgs(errs, cb.action, w, c);
    });
    c.presets.forEach((pr, p) => {
      const w = `Preset ${p + 1}`;
      if (pr.layer < 0 || pr.layer > c.presets.length || pr.layer === p + 1) e(w, 'camada aponta para um preset inválido.');
      if (String(pr.name || '').length > NAME) e(w, 'nome: até ' + NAME + ' letras.');
      if (String(pr.short || '').length > 3 || !/^[ -Z]*$/.test(pr.short || '')) e(w, 'nome curto: até 3 caracteres maiúsculos.');
      checkMsgs(errs, pr.enter, w + ' (ao entrar)', c);
      if (pr.enter.some(m => m.type === 'pedal' && /^(preset|bank)/.test(m.op))) e(w + ' (ao entrar)', 'não use "ir para preset/banco" ao entrar num preset (vira um laço).');
      pr.switches.forEach((sw, s) => {
        const ws = `${w}, botão ${s + 1}`;
        if (!BEHAVIORS.includes(sw.behavior)) e(ws, 'tipo inválido.');
        if (String(sw.label || '').length > 3 || !/^[ -Z]*$/.test(sw.label || '')) e(ws, 'nome no visor: até 3 caracteres, letras maiúsculas, números ou símbolos simples.');
        checkMsgs(errs, sw.press, ws + ' (pisar)', c);
        checkMsgs(errs, sw.release, ws + ' (soltar)', c);
        checkMsgs(errs, sw.hold, ws + ' (segurar)', c);
        checkMsgs(errs, sw.doubleTap, ws + ' (dois toques)', c);
      });
    });
    return errs;
  }

  // ---------- JSON -> EEPROM ----------
  function pack(c) {
    const r = { data: null, used: 0, actions: 0, slots: 0, errors: validate(c) };
    if (r.errors.length) return r;
    const e = new Uint8Array(EE_SIZE);
    e.fill(0xFF, CFG_END);                                // apaga o estado salvo (config nova)
    const g = c.global, np = c.presets.length;
    const keys = new Map(), acts = [];
    const act = list => {
      if (!list || !list.length) return 0xFF;
      const slots = encodeMsgs(list), key = JSON.stringify(slots);
      if (!keys.has(key)) { keys.set(key, acts.length); acts.push(slots); }
      return Math.min(keys.get(key), 253);
    };
    const LY = layoutV3(g.fixed.modeSwitch - 1, g.fixed.tapSwitch - 1);
    c.presets.forEach((pr, p) => {
      const a = PRESETS + p * LY.SIZE, nm = ascii(pr.name).toUpperCase();
      for (let i = 0; i < NAME; i++) e[a + i] = i < nm.length ? nm.charCodeAt(i) : 32;
      e[a + P_LAYER] = pr.layer > 0 ? pr.layer - 1 : 0xFF;
      // "ao entrar" que e so um PC no canal global: fica no proprio preset, sem gastar acao
      const pcOnly = pr.enter.length === 1 && pr.enter[0].type === 'pc' && !pr.enter[0].channel;
      e[a + P_ENTER] = pcOnly ? pr.enter[0].number : act(pr.enter);
      e[a + P_FLAGS] = (pr.syncOnEnter ? PF_SYNC : 0) | (pr.resetOnEnter ? PF_RESET : 0) | (pcOnly ? PF_ENTER_PC : 0);
      const sh = ((pr.short || shortOf(pr.name)) + '   ').slice(0, 3);
      for (let j = 0; j < 3; j++) e[a + P_SHORT + j] = sh.charCodeAt(j);
      pr.switches.forEach((sw, s) => {
        const k = LY.slot[s]; if (k < 0) return;                 // botao fixo: nao e guardado no preset
        const lb = ((sw.label || '') + '   ').slice(0, 3);
        for (let j = 0; j < 3; j++) e[a + P_LABELS + k * 3 + j] = lb.charCodeAt(j);
        const o = a + LY.SW + k * 5;
        e[o] = BEHAVIORS.indexOf(sw.behavior) | (sw.pingPong ? 4 : 0) | (sw.startOn ? 8 : 0) | (sw.tap ? BH_TAP : 0);
        const dr = directOf(sw);
        if (dr) { e[o] |= BH_DIRECT; e[o + 1] = dr.cc; e[o + 2] = dr.on; e[o + 3] = dr.off; e[o + 4] = dr.ch; }
        else { e[o + 1] = act(sw.press); e[o + 2] = act(sw.release); e[o + 3] = act(sw.hold); e[o + 4] = act(sw.doubleTap); }
      });
    });
    e.fill(0xFF, CMB, CMB + NCOMBO * 4);
    c.combos.forEach((cb, k) => { e[CMB + k * 4] = cb.a - 1; e[CMB + k * 4 + 1] = cb.b - 1; e[CMB + k * 4 + 2] = act(cb.action); });
    const fx = g.fixed, fxTap = act(fx.tap), fxOn = act(fx.tunerOn), fxOff = act(fx.tunerOff);
    if (acts.length > 253) { r.errors.push({ where: 'Memória', text: `ações demais (${acts.length}; máximo 253).` }); return r; }
    const actAddr = PRESETS + np * LY.SIZE, msgAddr = actAddr + acts.length * 2;
    let slot = 0;
    acts.forEach((slots, i) => {
      e[actAddr + i * 2] = Math.min(slot, 255); e[actAddr + i * 2 + 1] = slots.length;
      for (const s of slots) { const a = msgAddr + slot * 4; if (a + 4 <= DATA_END) e.set(s, a); slot++; }
    });
    r.used = msgAddr + slot * 4; r.actions = acts.length; r.slots = slot;
    if (r.used > DATA_END || slot > 255) {
      r.errors.push({ where: 'Memória', text: `não cabe no pedal: precisa de ${r.used} bytes, cabem ${DATA_END}. Tire mensagens ou presets.` });
      return r;
    }
    e[GLB + G.CHANNEL] = g.channel - 1;
    e[GLB + G.HOLD] = clamp(Math.round(g.holdMs / 10), 10, 255);
    e[GLB + G.DTAP] = clamp(Math.round(g.doubleTapMs / 10), 5, 255);
    e[GLB + G.FLAGS] = (g.persistState ? 1 : 0) | (g.wrap ? 2 : 0) | (g.clockAtBoot ? 4 : 0);
    e[GLB + G.BPM] = g.bpm;
    e[GLB + G.STARTPRESET] = g.startPreset - 1;
    let bits = 0;
    for (let i = 0; i < 8; i++) { e[GLB + G.PINS + i] = pinCode(g.pins[i]); if (g.activeHigh[i]) bits |= 1 << i; }
    e[GLB + G.ACTIVE] = bits;
    const x = g.expression;
    e[GLB + G.EXPR_PIN] = pinCode(x.pin); e[GLB + G.EXPR_CC] = x.cc; e[GLB + G.EXPR_CH] = ch(x.channel);
    e[GLB + G.EXPR_MIN] = x.min; e[GLB + G.EXPR_MAX] = x.max; e[GLB + G.EXPR_CURVE] = Math.max(0, CURVES.indexOf(x.curve));
    e[GLB + G.EXPR_LO] = x.calLow & 255; e[GLB + G.EXPR_LO + 1] = x.calLow >> 8;
    e[GLB + G.EXPR_HI] = x.calHigh & 255; e[GLB + G.EXPR_HI + 1] = x.calHigh >> 8;
    e[GLB + G.COMBO_MS] = g.comboMs;
    e[GLB + G.SYNC_MS] = clamp(Math.round(g.syncDelayMs / 10), 0, 255);
    e[GLB + G.DISPLAY] = (g.display.topRow === '1-4' ? D_TOP_1TO4 : 0) | (g.display.tempoColumn === false ? D_NO_TEMPO : 0) | (g.display.presetNumber === false ? D_NO_PNUM : 0);
    e[GLB + G.ALT_T] = Math.round((g.display.modBlink ?? 0.5) * 10); e[GLB + G.ANN_T] = Math.round((g.display.nameSeconds ?? 1.5) * 10);
    e[GLB + G.MODE_SW] = fx.modeSwitch ? fx.modeSwitch - 1 : 0xFF; e[GLB + G.TAP_SW] = fx.tapSwitch ? fx.tapSwitch - 1 : 0xFF;
    e[GLB + G.FIX_FLAGS] = fx.autoReturn ? 1 : 0;
    e[GLB + G.CT_PIN_A] = pinCode(g.contacts.pinA); e[GLB + G.CT_PIN_B] = pinCode(g.contacts.pinB);
    const spl = [g.splash.line1, g.splash.line2].map(l => (ascii(l || '').toUpperCase() + ' '.repeat(16)).slice(0, 16));
    for (let i = 0; i < 32; i++) e[SPLASH + i] = spl[i >> 4].charCodeAt(i & 15);
    for (let b = 0; b < NBANK_LBL; b++) { const l = ((g.bankLabels[b] || '') + '   ').slice(0, 3); for (let j = 0; j < 3; j++) e[BANK_LBL + b * 3 + j] = l.charCodeAt(j); }
    e[GLB + G.SPLASH_SEC] = g.splash.seconds; e[GLB + G.SPLASH_FX] = Math.max(0, SPLASH_FX.findIndex(x => x[0] === g.splash.effect));
    e[GLB + G.TAP_ACT] = fxTap; e[GLB + G.TUNER_ON_ACT] = fxOn; e[GLB + G.TUNER_OFF_ACT] = fxOff;
    for (let j = 0; j < 3; j++) { e[GLB + G.TAP_LABEL + j] = ((fx.tapLabel || '') + '   ').charCodeAt(j); e[GLB + G.MODE_LABEL + j] = ((fx.modeLabel || '') + '   ').charCodeAt(j); }
    e[0] = 0x50; e[1] = 0x4D; e[2] = SCHEMA;
    e[H.NPRESETS] = np; e[H.PPB] = g.presetsPerBank; e[H.NACTIONS] = acts.length;
    e[H.ACT] = actAddr & 255; e[H.ACT + 1] = actAddr >> 8;
    e[H.MSG] = msgAddr & 255; e[H.MSG + 1] = msgAddr >> 8;
    e[H.NSLOTS] = slot;
    const ck = checksum(e); e[H.CK] = ck & 255; e[H.CK + 1] = ck >> 8;
    r.data = e;
    return r;
  }

  // ---------- EEPROM -> JSON ----------
  const tenths = (v, def) => (v >= 1 && v <= 50 ? v : def) / 10;   // igual ao Engine::tenths
  function unpack(e) {
    if (e.length < EE_SIZE || e[0] !== 0x50 || e[1] !== 0x4D) throw new Error('A memória do pedal não tem uma configuração deste app (talvez o firmware ainda seja o antigo).');
    if (e[2] < 1 || e[2] > SCHEMA) throw new Error('Configuração de outra versão (schema ' + e[2] + ').');
    const ver = e[2];                                   // 1 e 2 = firmwares anteriores (le para migrar)
    const LY = ver === 1 ? V1 : ver === 2 ? V2
      : layoutV3(e[GLB + G.MODE_SW] < 8 ? e[GLB + G.MODE_SW] : -1, e[GLB + G.TAP_SW] < 8 && e[GLB + G.TAP_SW] !== e[GLB + G.MODE_SW] ? e[GLB + G.TAP_SW] : -1);
    if ((e[H.CK] | (e[H.CK + 1] << 8)) !== checksum(e)) throw new Error('A configuração no pedal está corrompida (soma de verificação).');
    const c = newConfig(), g = c.global;
    const np = e[H.NPRESETS], nact = e[H.NACTIONS], actAddr = e[H.ACT] | (e[H.ACT + 1] << 8), msgAddr = e[H.MSG] | (e[H.MSG + 1] << 8);
    g.presetsPerBank = e[H.PPB];
    g.channel = (e[GLB + G.CHANNEL] & 15) + 1;
    g.holdMs = e[GLB + G.HOLD] * 10; g.doubleTapMs = e[GLB + G.DTAP] * 10; g.comboMs = e[GLB + G.COMBO_MS];
    g.syncDelayMs = e[GLB + G.SYNC_MS] * 10;
    const dd = e[GLB + G.DISPLAY] === 0xFF ? 0 : e[GLB + G.DISPLAY];
    g.display = { topRow: dd & D_TOP_1TO4 ? '1-4' : '5-8', tempoColumn: !(dd & D_NO_TEMPO), presetNumber: !(dd & D_NO_PNUM),
      modBlink: tenths(e[GLB + G.ALT_T], 5), nameSeconds: tenths(e[GLB + G.ANN_T], 15) };
    const ms = e[GLB + G.MODE_SW], ts = e[GLB + G.TAP_SW];
    const lbl = o => String.fromCharCode(...e.slice(GLB + o, GLB + o + 3)).trimEnd();
    g.fixed = { modeSwitch: ms < 8 ? ms + 1 : 0, tapSwitch: ts < 8 ? ts + 1 : 0, autoReturn: !!(e[GLB + G.FIX_FLAGS] & 1),
                modeLabel: lbl(G.MODE_LABEL), tapLabel: lbl(G.TAP_LABEL), tap: [], tunerOn: [], tunerOff: [] };
    const fixedActs = [e[GLB + G.TAP_ACT], e[GLB + G.TUNER_ON_ACT], e[GLB + G.TUNER_OFF_ACT]];
    g.contacts = { pinA: pinName(e[GLB + G.CT_PIN_A]), pinB: pinName(e[GLB + G.CT_PIN_B]) };
    if (ver >= 2) {
      const ln = r => String.fromCharCode(...e.slice(SPLASH + r * 16, SPLASH + r * 16 + 16).map(b => (b >= 32 && b < 127 ? b : 32))).trimEnd();
      const fxi = e[GLB + G.SPLASH_FX];
      g.splash = { line1: ln(0), line2: ln(1), seconds: e[GLB + G.SPLASH_SEC] <= 30 ? e[GLB + G.SPLASH_SEC] : 4, effect: (SPLASH_FX[fxi] || SPLASH_FX[1])[0] };
    }
    if (ver >= 3) g.bankLabels = Array.from({ length: NBANK_LBL }, (_, b) =>
      String.fromCharCode(...e.slice(BANK_LBL + b * 3, BANK_LBL + b * 3 + 3).map(x => (x >= 32 && x < 127 ? x : 32))).trimEnd());
    const fl = e[GLB + G.FLAGS]; g.persistState = !!(fl & 1); g.wrap = !!(fl & 2); g.clockAtBoot = !!(fl & 4);
    g.bpm = e[GLB + G.BPM]; g.startPreset = e[GLB + G.STARTPRESET] + 1;
    for (let i = 0; i < 8; i++) { g.pins[i] = pinName(e[GLB + G.PINS + i]); g.activeHigh[i] = !!((e[GLB + G.ACTIVE] >> i) & 1); }
    const x = g.expression;
    x.pin = pinName(e[GLB + G.EXPR_PIN]); x.cc = e[GLB + G.EXPR_CC];
    x.channel = e[GLB + G.EXPR_CH] >= 16 ? 0 : e[GLB + G.EXPR_CH] + 1;
    x.min = e[GLB + G.EXPR_MIN]; x.max = e[GLB + G.EXPR_MAX]; x.curve = CURVES[Math.min(2, e[GLB + G.EXPR_CURVE])];
    x.calLow = e[GLB + G.EXPR_LO] | (e[GLB + G.EXPR_LO + 1] << 8); x.calHigh = e[GLB + G.EXPR_HI] | (e[GLB + G.EXPR_HI + 1] << 8);
    const act = a => {
      const l = [];
      if (a >= nact) return l;
      const first = e[actAddr + a * 2], n = e[actAddr + a * 2 + 1];
      for (let s = first; s < first + n;) {
        const o = msgAddr + s * 4, t = e[o], c1 = e[o + 1], d1 = e[o + 2], d2 = e[o + 3];
        const mch = c1 >= 16 ? 0 : c1 + 1;
        s++;
        const M = (type, f) => l.push(Object.assign(newMsg(type), f));
        switch (t) {
          case 1: M('cc', { channel: mch, number: d1, value: d2 }); break;
          case 2: M('pc', { channel: mch, number: d1 }); break;
          case 3: M('noteOn', { channel: mch, number: d1, value: d2 }); break;
          case 4: M('noteOff', { channel: mch, number: d1, value: 0 }); break;
          case 7: M('bank', { channel: mch, number: d1 >= 0x80 ? -1 : d1, value: d2 >= 0x80 ? -1 : d2 }); break;
          case 6: M('delay', { value: d1 * 10 }); break;
          case 11: M('contact', { number: d1, mode: (CONTACT_MODES[d2] || CONTACT_MODES[2])[0], ms: c1 * 10 }); break;
          case 10: {
            const o2 = msgAddr + s * 4; s++;
            M('ramp', { channel: mch, number: d1, from: e[o2], to: e[o2 + 1], ms: e[o2 + 2] | (e[o2 + 3] << 8),
                        mode: (RAMP_MODES[d2 & 3] || RAMP_MODES[0])[0], curve: (RAMP_CURVES[(d2 >> 2) & 3] || RAMP_CURVES[0])[0] });
            break;
          }
          case 5: {
            const b = []; for (let i = 0; i < c1; i++) b.push(e[msgAddr + s * 4 + i].toString(16).toUpperCase().padStart(2, '0'));
            s += Math.ceil(c1 / 4);
            M('sysex', { data: b.join(' ') }); break;
          }
          case 8: case 9: {
            const o2 = opCode(t, d1); if (!o2) break;
            M('pedal', { op: o2.id, value: o2.arg ? (o2.id === 'bpm' ? d2 : d2 + 1) : 0 }); break;
          }
        }
      }
      return l;
    };
    g.fixed.tap = act(fixedActs[0]); g.fixed.tunerOn = act(fixedActs[1]); g.fixed.tunerOff = act(fixedActs[2]);
    for (let p = 0; p < np; p++) {
      const a = PRESETS + p * LY.SIZE, pr = newPreset();
      pr.name = String.fromCharCode(...e.slice(a, a + LY.NAME)).trimEnd().slice(0, NAME).trimEnd();   // nomes antigos maiores: corta
      pr.short = LY.SHORT < 0 ? shortOf(pr.name) : String.fromCharCode(...e.slice(a + LY.SHORT, a + LY.SHORT + 3)).trimEnd();
      pr.layer = e[a + LY.LAYER] === 0xFF ? 0 : e[a + LY.LAYER] + 1;
      const pf = e[a + LY.FLAGS] === 0xFF ? 0 : e[a + LY.FLAGS];
      pr.enter = (ver >= 3 && (pf & PF_ENTER_PC)) ? [Object.assign(newMsg('pc'), { number: e[a + LY.ENTER] & 0x7F })] : act(e[a + LY.ENTER]);
      pr.syncOnEnter = !!(pf & PF_SYNC); pr.resetOnEnter = !!(pf & PF_RESET);
      const fxSw = [g.fixed.modeSwitch - 1, g.fixed.tapSwitch - 1];
      pr.switches.forEach((sw, s) => {
        const k = LY.slot[s];
        if (k < 0 || (ver < 3 && fxSw.includes(s))) { pr.switches[s] = newSwitch(s); return; }   // botao fixo: nada guardado
        sw.label = String.fromCharCode(...e.slice(a + LY.LABELS + k * 3, a + LY.LABELS + k * 3 + 3)).trimEnd();
        const o = a + LY.SW + k * 5;
        sw.behavior = BEHAVIORS[e[o] & 3]; sw.pingPong = !!(e[o] & 4); sw.startOn = !!(e[o] & 8); sw.tap = !!(e[o] & BH_TAP);
        if (e[o] & BH_DIRECT) {
          const c = e[o + 4] >= 16 ? 0 : e[o + 4] + 1, cc = v => Object.assign(newMsg('cc'), { channel: c, number: e[o + 1], value: v });
          sw.press = [cc(e[o + 2])]; sw.release = e[o + 3] < 0x80 ? [cc(e[o + 3])] : [];
        } else { sw.press = act(e[o + 1]); sw.release = act(e[o + 2]); sw.hold = act(e[o + 3]); sw.doubleTap = act(e[o + 4]); }
      });
      c.presets.push(pr);
    }
    for (let k = 0; k < NCOMBO; k++) {
      const a = e[CMB + k * 4], b = e[CMB + k * 4 + 1];
      if (a < 8 && b < 8) c.combos.push({ a: a + 1, b: b + 1, action: act(e[CMB + k * 4 + 2]) });
    }
    return c;
  }

  // ---------- textos e diferencas ----------
  function describeMsg(m) {
    const c = m.channel ? ` (canal ${m.channel})` : '';
    switch (m.type) {
      case 'cc': return `CC ${m.number} = ${m.value}${c}`;
      case 'pc': return `PC ${m.number}${c}`;
      case 'noteOn': return `Nota ${m.number} liga (vel ${m.value})${c}`;
      case 'noteOff': return `Nota ${m.number} desliga${c}`;
      case 'bank': return `Bank MSB ${m.number < 0 ? '-' : m.number} LSB ${m.value < 0 ? '-' : m.value}${c}`;
      case 'delay': return `espera ${m.value} ms`;
      case 'contact': return `Switch-3 botão ${m.number}: ` + (m.mode === 'pulse' ? `toque (${m.ms} ms)` : m.mode === 'close' ? 'fecha' : 'abre');
      case 'ramp': {
        const md = (RAMP_MODES.find(x => x[0] === m.mode) || ['', '?'])[1], cv = m.curve === 'linear' ? '' : ', ' + (m.curve === 'log' ? 'log' : 'exp');
        return `Rampa CC ${m.number}: ${m.from}→${m.to} em ${m.ms} ms${cv}, ${md}${c}`;
      }
      case 'sysex': return `SysEx ${m.data}`;
      case 'pedal': { const o = op(m.op); return o ? o.text + (o.arg ? ' ' + m.value : '') : '?'; }
    }
    return '?';
  }
  const describeList = l => (!l || !l.length) ? '(nada)' : l.map(describeMsg).join('; ');
  const BEH_TEXT = { momentary: 'momentâneo', toggle: 'liga/desliga', step: 'sequência', macro: 'macro' };

  function flatten(c) {
    const d = {}; const g = c.global;
    d['Geral › canal global'] = String(g.channel);
    d['Geral › tempo de segurar'] = g.holdMs + ' ms';
    d['Geral › janela de dois toques'] = g.doubleTapMs + ' ms';
    d['Geral › janela de combo'] = g.comboMs + ' ms';
    d['Geral › espera antes de sincronizar'] = g.syncDelayMs + ' ms';
    d['Geral › guardar estado ao desligar'] = g.persistState ? 'sim' : 'não';
    d['Geral › dar a volta no fim da lista'] = g.wrap ? 'sim' : 'não';
    d['Geral › clock ao ligar'] = g.clockAtBoot ? 'sim' : 'não';
    d['Geral › BPM'] = String(g.bpm);
    d['Geral › preset ao ligar'] = String(g.startPreset);
    d['Geral › presets por banco'] = String(g.presetsPerBank);
    d['Visor › linha de cima'] = 'botões ' + g.display.topRow;
    d['Visor › coluna do tempo'] = g.display.tempoColumn ? 'sim' : 'não';
    d['Visor › número do preset na troca'] = g.display.presetNumber !== false ? 'sim' : 'não';
    d['Visor › troca do MOD'] = String(g.display.modBlink ?? 0.5).replace('.', ',') + ' s';
    d['Visor › tempo do nome do preset'] = String(g.display.nameSeconds ?? 1.5).replace('.', ',') + ' s';
    const fx = g.fixed;
    d['Botões fixos › MODO (preset/botão)'] = fx.modeSwitch ? `botão ${fx.modeSwitch} (${fx.modeLabel})` : 'nenhum';
    d['Botões fixos › TAP/TUNER'] = fx.tapSwitch ? `botão ${fx.tapSwitch} (${fx.tapLabel})` : 'nenhum';
    d['Botões fixos › volta sozinho ao modo botão'] = fx.autoReturn ? 'sim' : 'não';
    d['Botões fixos › tap manda'] = describeList(fx.tap);
    d['Botões fixos › liga afinador manda'] = describeList(fx.tunerOn);
    d['Botões fixos › desliga afinador manda'] = describeList(fx.tunerOff);
    d['Bancos › siglas'] = g.bankLabels.slice(0, Math.max(1, Math.ceil(c.presets.length / g.presetsPerBank))).join(', ');
    d['Mensagem ao ligar'] =(g.splash.line1 || g.splash.line2) && g.splash.seconds ? `"${g.splash.line1}" / "${g.splash.line2}", ${(SPLASH_FX.find(x => x[0] === g.splash.effect) || ['', '?'])[1].toLowerCase()}, ${g.splash.seconds} s` : 'não mostra';
    d['Switch-3 › pinos dos contatos'] = g.contacts.pinA || g.contacts.pinB ? `A (ponta) ${g.contacts.pinA || '-'}, B (anel) ${g.contacts.pinB || '-'}` : 'não montado';
    g.pins.forEach((p, i) => { d[`Geral › pino do botão ${i + 1}`] = (p || 'nenhum') + (g.activeHigh[i] ? ' (ativo em HIGH)' : ''); });
    const x = g.expression;
    d['Expressão'] = !x.pin ? 'sem pedal de expressão' :
      `pino ${x.pin}, CC ${x.cc}${x.channel ? ' canal ' + x.channel : ''}, ${x.min} a ${x.max}, curva ${x.curve}, calibração ${x.calLow}-${x.calHigh}`;
    c.combos.forEach(cb => { d[`Combo ${cb.a}+${cb.b}`] = describeList(cb.action); });
    d['Quantidade de presets'] = String(c.presets.length);
    c.presets.forEach((pr, p) => {
      const P = `Preset ${p + 1}`;
      d[P + ' › nome'] = pr.name;
      d[P + ' › nome curto (modo preset)'] = pr.short;
      d[P + ' › camada'] = pr.layer ? 'preset ' + pr.layer : 'nenhuma';
      d[P + ' › ao entrar'] = describeList(pr.enter);
      d[P + ' › sincronizar botões ao entrar'] = pr.syncOnEnter ? 'sim' : 'não';
      d[P + ' › ao entrar, botões voltam ao configurado'] = pr.resetOnEnter ? 'sim' : 'não';
      pr.switches.forEach((sw, s) => {
        if (s === fx.modeSwitch - 1 || s === fx.tapSwitch - 1) return;   // botao fixo: nao e guardado no preset
        const S = `${P} › botão ${s + 1}`;
        let beh = BEH_TEXT[sw.behavior];
        if (sw.behavior === 'step' && sw.pingPong) beh += ' (vai e volta)';
        if (sw.behavior === 'toggle') beh += sw.startOn ? ', configurado ligado' : ', configurado desligado';
        d[S + ' › tipo'] = beh + (sw.tap ? ', botão de tap' : '');
        d[S + ' › nome no visor'] = sw.label || '(vazio)';
        const tg = sw.behavior === 'toggle';
        d[S + (tg ? ' › ligar' : ' › ao pisar')] = describeList(sw.press);
        d[S + (tg ? ' › desligar' : ' › ao soltar')] = describeList(sw.release);
        d[S + ' › segurar'] = describeList(sw.hold);
        d[S + ' › dois toques'] = describeList(sw.doubleTap);
      });
    });
    return d;
  }

  function diff(before, after) {
    const a = before ? flatten(before) : {}, b = flatten(after), out = [];
    for (const k of Object.keys(b)) {
      if (!(k in a)) { if (before) out.push({ key: k, from: '(novo)', to: b[k] }); }
      else if (a[k] !== b[k]) out.push({ key: k, from: a[k], to: b[k] });
    }
    for (const k of Object.keys(a)) if (!(k in b)) out.push({ key: k, from: a[k], to: '(removido)' });
    return out;
  }

  return { SCHEMA, EE_SIZE, CFG_END, DATA_END, SPLASH_FX, MAX_PRESETS, NCOMBO, BEHAVIORS, CURVES, EVENTS, OPS, MSG_TYPES, RAMP_MODES, RAMP_CURVES, CONTACT_MODES, op,
           newMsg, newSwitch, newPreset, newConfig, shortOf, NAME_LEN: NAME, normalize, factory, pack, unpack, validate,
           describeMsg, describeList, diff, checksum, pinCode, pinName, ascii };
})();
