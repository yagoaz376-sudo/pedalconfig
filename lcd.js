// PedalConfig - simulador do visor 16x2 do pedal. Mesma fonte e mesma logica de letras invertidas
// do firmware (firmware/PedalMidi/lcdmap.cpp e Engine::refresh). Mudou la? Mude aqui.
'use strict';

const LCD = (() => {
  // fonte 5x7 de ' ' (32) a 'Z' (90): 5 colunas, bit 0 = linha de cima
  const FONT = [
    [0x00,0x00,0x00,0x00,0x00],[0x00,0x00,0x5F,0x00,0x00],[0x00,0x07,0x00,0x07,0x00],[0x14,0x7F,0x14,0x7F,0x14],
    [0x24,0x2A,0x7F,0x2A,0x12],[0x23,0x13,0x08,0x64,0x62],[0x36,0x49,0x55,0x22,0x50],[0x00,0x05,0x03,0x00,0x00],
    [0x00,0x1C,0x22,0x41,0x00],[0x00,0x41,0x22,0x1C,0x00],[0x08,0x2A,0x1C,0x2A,0x08],[0x08,0x08,0x3E,0x08,0x08],
    [0x00,0x50,0x30,0x00,0x00],[0x08,0x08,0x08,0x08,0x08],[0x00,0x60,0x60,0x00,0x00],[0x20,0x10,0x08,0x04,0x02],
    [0x3E,0x51,0x49,0x45,0x3E],[0x00,0x42,0x7F,0x40,0x00],[0x42,0x61,0x51,0x49,0x46],[0x21,0x41,0x45,0x4B,0x31],
    [0x18,0x14,0x12,0x7F,0x10],[0x27,0x45,0x45,0x45,0x39],[0x3C,0x4A,0x49,0x49,0x30],[0x01,0x71,0x09,0x05,0x03],
    [0x36,0x49,0x49,0x49,0x36],[0x06,0x49,0x49,0x29,0x1E],[0x00,0x36,0x36,0x00,0x00],[0x00,0x56,0x36,0x00,0x00],
    [0x00,0x08,0x14,0x22,0x41],[0x14,0x14,0x14,0x14,0x14],[0x41,0x22,0x14,0x08,0x00],[0x02,0x01,0x51,0x09,0x06],
    [0x32,0x49,0x79,0x41,0x3E],[0x7E,0x11,0x11,0x11,0x7E],[0x7F,0x49,0x49,0x49,0x36],[0x3E,0x41,0x41,0x41,0x22],
    [0x7F,0x41,0x41,0x22,0x1C],[0x7F,0x49,0x49,0x49,0x41],[0x7F,0x09,0x09,0x01,0x01],[0x3E,0x41,0x41,0x51,0x32],
    [0x7F,0x08,0x08,0x08,0x7F],[0x00,0x41,0x7F,0x41,0x00],[0x20,0x40,0x41,0x3F,0x01],[0x7F,0x08,0x14,0x22,0x41],
    [0x7F,0x40,0x40,0x40,0x40],[0x7F,0x02,0x04,0x02,0x7F],[0x7F,0x04,0x08,0x10,0x7F],[0x3E,0x41,0x41,0x41,0x3E],
    [0x7F,0x09,0x09,0x09,0x06],[0x3E,0x41,0x51,0x21,0x5E],[0x7F,0x09,0x19,0x29,0x46],[0x46,0x49,0x49,0x49,0x31],
    [0x01,0x01,0x7F,0x01,0x01],[0x3F,0x40,0x40,0x40,0x3F],[0x1F,0x20,0x40,0x20,0x1F],[0x7F,0x20,0x18,0x20,0x7F],
    [0x63,0x14,0x08,0x14,0x63],[0x03,0x04,0x78,0x04,0x03],[0x61,0x51,0x49,0x45,0x43],
  ];
  const FULL = 'ÿ';                     // bloco cheio (caractere 0xFF do visor)
  const ALLOWED = /^[ -Z]*$/;                 // o que o visor sabe desenhar: espaco ate Z (maiusculas)

  // 8 linhas de 5 bits de um caractere (normal)
  function rows(ch) {
    if (ch === FULL) return [31, 31, 31, 31, 31, 31, 31, 31];
    const code = ch.charCodeAt(0), cols = FONT[code - 32] || FONT[0], r = [];
    for (let y = 0; y < 8; y++) { let b = 0; for (let x = 0; x < 5; x++) if (y < 7 && (cols[x] >> y) & 1) b |= 16 >> x; r.push(b); }
    return r;
  }

  // mesma logica do LcdMap::map: no maximo 8 letras diferentes invertidas ao mesmo tempo
  function map(lines, inv) {
    const need = [];
    lines.forEach((L, r) => [...L].forEach((ch, c) => {
      if (((inv[r] >> c) & 1) && ch !== ' ' && ch !== FULL && ch >= '!' && ch <= 'Z' && !need.includes(ch)) need.push(ch);
    }));
    const slots = need.slice(0, 8), overflow = need.slice(8);
    return { slots, overflow, cell: (r, c) => {
      const ch = lines[r][c], i = (inv[r] >> c) & 1;
      if (!i) return { ch, inv: false };
      if (ch === ' ') return { ch: FULL, inv: false };
      if (ch === FULL) return { ch: ' ', inv: false };
      return slots.includes(ch) ? { ch, inv: true } : { ch, inv: false };   // sem espaco: aparece normal
    } };
  }

  // botoes fixos: qual preset cada botao livre escolhe no modo preset (1o livre = preset 1...)
  // (igual ao Engine::presetOfSwitch) os botoes livres escolhem os presets DO BANCO de "cur"
  function presetOfSwitch(cfg, sw, cur = 0) {
    const fx = cfg.global.fixed, ms = fx.modeSwitch - 1, ts = fx.tapSwitch - 1, ppb = cfg.global.presetsPerBank || 16;
    if (sw === ms || sw === ts) return -1;
    let n = 0; for (let s = 0; s < sw; s++) if (s !== ms && s !== ts) n++;
    if (n >= ppb) return -1;
    return Math.floor(cur / ppb) * ppb + n;
  }

  // mesma logica do Engine::refresh: monta as 2 linhas a partir do preset e do estado
  // st = { toggles, pressed, beatOn, flash, modePreset, tunerOn, cur (preset atual), alt (fase de 0,5 s do MOD) }
  function screen(cfg, preset, st) {
    const g = cfg.global, top1to4 = g.display && g.display.topRow === '1-4', tempo = !g.display || g.display.tempoColumn !== false;
    const fx = g.fixed, lab = s => (PM.ascii(s || '').toUpperCase() + '   ').slice(0, 3);
    const lines = [], inv = [0, 0];
    for (let row = 0; row < 2; row++) {
      let L = '';
      for (let k = 0; k < 4; k++) {
        const sw = ((row === 0) === top1to4) ? k : 4 + k, s = preset.switches[sw];
        let text, on;
        const ppb = g.presetsPerBank || 16, nb = Math.ceil(cfg.presets.length / ppb);
        const vb = st.viewBank != null ? st.viewBank : Math.floor((st.cur || 0) / ppb);
        if (st.bankMode && sw !== fx.tapSwitch - 1) {          // pagina de bancos (segurar MOD)
          if (sw === fx.modeSwitch - 1) { text = 'BCO'; on = true; }
          else {
            const n = presetOfSwitch({ global: { ...g, presetsPerBank: 99 }, presets: [] }, sw, 0);   // posicao entre os livres
            const l = n >= 0 && n < nb ? (PM.ascii(g.bankLabels[n] || '').toUpperCase().trim() || 'B' + (n + 1)) : '';
            text = lab(l); on = n >= 0 && n === Math.floor((st.cur || 0) / ppb);
          }
        }
        else if (sw === fx.tapSwitch - 1) { text = lab(fx.tapLabel); on = st.tunerOn || st.beatOn; }
        else if (sw === fx.modeSwitch - 1 && (!st.modePreset || nb > 1)) {
          // MOD invertido alternando a cada 0,5 s (igual ao Engine::refresh): PRS <-> preset atual; no modo preset BCO <-> banco
          const alt = st.alt != null ? st.alt : true, cp = cfg.presets[st.cur || 0];
          text = st.modePreset ? (alt ? lab(PM.ascii(g.bankLabels[vb] || '').toUpperCase().trim() || 'B' + (vb + 1)) : 'BCO')
            : (alt ? lab(cp ? cp.short || PM.shortOf(cp.name) : '') : 'PRS');
          on = true;
        }
        else if (sw === fx.modeSwitch - 1) { text = lab(fx.modeLabel); on = !!st.modePreset; }
        else if (st.modePreset) {
          const p = presetOfSwitch(cfg, sw, vb * ppb);
          text = p >= 0 && p < cfg.presets.length ? lab(cfg.presets[p].short || PM.shortOf(cfg.presets[p].name)) : '   '; on = p === st.cur;
        } else {
          text = lab(s.label);
          on = s.tap ? st.beatOn : s.behavior === 'toggle' ? st.toggles[sw] : st.pressed[sw];
        }
        L += text + (k < 3 ? ' ' : '');
        if (on) inv[row] |= 7 << (k * 4);
      }
      L += tempo && st.beatOn ? FULL : ' ';
      lines.push(L);
    }
    if (st.tunerOn) { lines[0] = '     TUNER      '; inv[0] = 0; }
    else if (st.announce != null && cfg.presets[st.announce]) {
      // troca de preset: tela inteira (igual ao Engine::announcePreset)
      const pr = cfg.presets[st.announce], ppb = g.presetsPerBank || 16, n = cfg.presets.length;
      const num = g.display && g.display.presetNumber === false ? '' :
        n <= ppb ? `PRESET ${st.announce + 1}` : `BANCO ${Math.floor(st.announce / ppb) + 1} PRESET ${st.announce % ppb + 1}`;
      lines[0] = center(PM.ascii(pr.name || '').toUpperCase().trim()); lines[1] = center(num); inv[0] = inv[1] = 0;
    }
    else if (st.flash) { lines[0] = (st.flash + ' '.repeat(16)).slice(0, 16); inv[0] = 0; }
    return { lines, inv };
  }
  // mensagem ao ligar, quadro de t ms (mesma conta do Engine::splashScreen; mudou la, mude aqui)
  function splash(cfg, t) {
    const sp = cfg.global.splash, fxi = Math.max(0, PM.SPLASH_FX.findIndex(x => x[0] === sp.effect));
    const T = [], s0 = [], e0 = [];
    [sp.line1, sp.line2].forEach((l, r) => {
      const txt = PM.ascii(l || '').toUpperCase().slice(0, 16).trim();
      T[r] = center(txt); s0[r] = Math.floor((16 - txt.length) / 2); e0[r] = s0[r] + txt.length;
    });
    const scr = [T[0].split(''), T[1].split('')], inv = [0, 0];
    switch (PM.SPLASH_FX[fxi][0]) {
      case 'blink': {
        const ph = Math.floor(t / 350) & 1, seen = new Set((T[0] + T[1]).replace(/ /g, ''));
        if (seen.size <= 8) { if (ph) inv[0] = inv[1] = 0xFFFF; } else inv[ph] = 0xFFFF;
        break;
      }
      case 'flash': if (Math.floor(t / 400) & 1) { scr[0].fill(' '); scr[1].fill(' '); } break;
      case 'type': {
        const shown = Math.floor(t / 90), cur = Math.floor(t / 250) & 1; let k = 0, placed = false;
        for (let r = 0; r < 2; r++) for (let c = s0[r]; c < e0[r]; c++, k++) {
          if (k >= shown) { scr[r][c] = (k === shown && cur) ? FULL : ' '; if (k === shown) placed = true; }
        }
        if (!placed && cur) { const r = e0[1] > s0[1] ? 1 : 0; if (e0[r] < 16) scr[r][e0[r]] = FULL; }
        break;
      }
      case 'scroll':
        for (let r = 0; r < 2; r++) {
          const d = r * 300, off = Math.max(0, 16 - (t > d ? Math.floor((t - d) / 45) : 0));
          for (let c = 15; c >= 0; c--) scr[r][c] = c - off >= 0 ? T[r][c - off] : ' ';
        }
        break;
      case 'wipe': {
        const st = Math.floor(t / 30);
        for (let r = 0; r < 2; r++) for (let c = 0; c < 16; c++) {
          if (st < 16) scr[r][c] = c < st ? FULL : ' ';
          else if (st < 32) scr[r][c] = c < st - 16 ? T[r][c] : FULL;
        }
        break;
      }
      case 'shine': {
        const x = Math.floor(t / 55) % 24;
        for (let c = x - 2; c <= x; c++) if (c >= 0 && c < 16) { inv[0] |= 1 << c; inv[1] |= 1 << c; }
        break;
      }
    }
    return { lines: scr.map(r => r.join('')), inv };
  }
  const hasSplash = cfg => { const sp = cfg.global.splash; return sp.seconds > 0 && /[^ ]/.test((sp.line1 || '') + (sp.line2 || '')); };

  function center(s) { s = s.slice(0, 16); const l = Math.floor((16 - s.length) / 2); return (' '.repeat(l) + s + ' '.repeat(16)).slice(0, 16); }

  // desenha no canvas (visor com fundo escuro e pixels claros, como o seu)
  function draw(canvas, lines, inv) {
    const P = 4, GAP = 1, CW = 5 * P + (5 - 1) * GAP, CH = 8 * P + 7 * GAP, CG = 5, PAD = 14;
    const W = PAD * 2 + 16 * CW + 15 * CG, Hh = PAD * 2 + 2 * CH + 10;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== W * dpr) { canvas.width = W * dpr; canvas.height = Hh * dpr; canvas.style.aspectRatio = `${W} / ${Hh}`; }
    const x = canvas.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.fillStyle = '#05070a'; x.fillRect(0, 0, W, Hh);
    const m = map(lines, inv);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 16; c++) {
      const cell = m.cell(r, c), rr = rows(cell.ch);
      const ox = PAD + c * (CW + CG), oy = PAD + r * (CH + 10);
      // fundo da celula: no invertido as linhas entre os pixels ficam claras (como no visor real, onde sao finas)
      const whole = cell.inv || cell.ch === FULL;
      x.fillStyle = whole ? '#c9d1dd' : '#0b0f14'; x.fillRect(ox, oy, CW, CH);
      for (let y = 0; y < 8; y++) for (let xx = 0; xx < 5; xx++) {
        let lit = (rr[y] >> (4 - xx)) & 1;
        if (cell.inv) lit = !lit;
        x.fillStyle = lit ? '#f2f6ff' : '#141a22';
        x.fillRect(ox + xx * (P + GAP), oy + y * (P + GAP), P, P);
      }
    }
    return m;
  }

  // pior caso: todos os liga/desliga ligados + tap aceso -> quantas letras diferentes invertidas?
  function worstCase(cfg, preset) {
    const st = { toggles: preset.switches.map(s => s.behavior === 'toggle'), pressed: Array(8).fill(false), beatOn: true, flash: '' };
    const s = screen(cfg, preset, st);
    return map(s.lines, s.inv);
  }

  return { screen, draw, worstCase, presetOfSwitch, splash, hasSplash, ALLOWED, FULL };
})();
