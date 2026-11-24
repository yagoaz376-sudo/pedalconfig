// PedalConfig - conexao Web MIDI e protocolo SysEx do firmware (veja firmware/PedalMidi/protocol.h)
'use strict';

const Pedal = (() => {
  let access = null, inPort = null, outPort = null, learnPort = null;
  const waiters = [];
  const listeners = { message: [], event: [], ports: [] };
  const emit = (k, ...a) => listeners[k].forEach(f => f(...a));

  function enc87(bytes) {
    const out = [];
    for (let i = 0; i < bytes.length; i += 7) {
      const hiPos = out.length; out.push(0); let hi = 0;
      for (let j = 0; j < 7 && i + j < bytes.length; j++) { if (bytes[i + j] & 0x80) hi |= 1 << j; out.push(bytes[i + j] & 0x7F); }
      out[hiPos] = hi;
    }
    return out;
  }
  function dec78(d) {
    const out = [];
    for (let i = 0; i < d.length;) { const hi = d[i++]; for (let j = 0; j < 7 && i < d.length; j++, i++) out.push(d[i] | (((hi >> j) & 1) << 7)); }
    return out;
  }

  async function init() {
    if (!navigator.requestMIDIAccess) throw new Error('Este navegador não tem Web MIDI. Use o Microsoft Edge ou o Google Chrome.');
    access = await navigator.requestMIDIAccess({ sysex: true });
    access.onstatechange = () => emit('ports');
    return access;
  }
  const inputs = () => access ? [...access.inputs.values()] : [];
  const outputs = () => access ? [...access.outputs.values()] : [];

  function deliver(cmd, body) {
    if (cmd === 0x4D || cmd === 0x4C) { emit('event', { cmd, body }); return; }
    const i = waiters.findIndex(w => w.reply === cmd);
    if (i >= 0) { const w = waiters.splice(i, 1)[0]; clearTimeout(w.timer); w.resolve(body); }
  }
  // O chip USB do Arduino estraga SysEx vindo do pedal, entao as respostas chegam como
  // quadros de aftertouch polifonico no canal 16:  AF 7D 50 | AF cmd n | AF b0 b1 | ...
  let frame = null;
  function onFrame(d) {
    if (frame && !frame.head) {
      frame.body.push(d[1], d[2]);
      if (frame.body.length >= frame.n) { const f = frame; frame = null; deliver(f.cmd, f.body.slice(0, f.n)); }
    } else if (d[1] === 0x7D && d[2] === 0x50) frame = { head: true };
    else if (frame) {
      frame = { cmd: d[1], n: d[2], body: [] };
      if (!frame.n) { const f = frame; frame = null; deliver(f.cmd, []); }
    }
  }
  function onMsg(ev, source) {
    const d = [...ev.data];
    emit('message', { dir: 'in', source, data: d, time: performance.now() });
    if (source !== 'pedal') return;
    if (d[0] === 0xAF && d.length === 3) { onFrame(d); return; }
    if (d[0] === 0xF0 && d[1] === 0x7D && d[2] === 0x50) deliver(d[3], d.slice(4, -1));
  }

  async function open(inId, outId) {
    close();
    inPort = access.inputs.get(inId); outPort = access.outputs.get(outId);
    if (!inPort || !outPort) throw new Error('Porta MIDI não encontrada.');
    await inPort.open(); await outPort.open();
    inPort.onmidimessage = ev => onMsg(ev, 'pedal');
  }
  function close() {
    if (inPort) { inPort.onmidimessage = null; try { inPort.close(); } catch (e) {} }
    if (outPort) { try { outPort.close(); } catch (e) {} }
    inPort = outPort = null;
    waiters.splice(0).forEach(w => { clearTimeout(w.timer); w.reject(new Error('desconectado')); });
  }
  function setLearnPort(id) {
    if (learnPort) learnPort.onmidimessage = null;
    learnPort = id ? access.inputs.get(id) : null;
    if (learnPort) learnPort.onmidimessage = ev => onMsg(ev, 'learn');
  }

  function send(bytes) {
    if (!outPort) throw new Error('Pedal não conectado.');
    outPort.send(bytes);
    emit('message', { dir: 'out', source: 'pedal', data: bytes, time: performance.now() });
  }
  function request(cmd, data = [], timeout = 1500) {
    return new Promise((resolve, reject) => {
      const w = { reply: cmd | 0x40, resolve, reject };
      w.timer = setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); reject(new Error('o pedal não respondeu')); }, timeout);
      waiters.push(w);
      try { send([0xF0, 0x7D, 0x50, cmd, ...data, 0xF7]); } catch (e) { clearTimeout(w.timer); waiters.splice(waiters.indexOf(w), 1); reject(e); }
    });
  }

  async function hello() {
    const r = await request(0x01);
    return { fw: `${r[0]}.${r[1]}`, schema: r[2], cfgEnd: (r[3] << 7) | r[4], eeSize: (r[5] << 7) | r[6], chunk: r[7] };
  }
  async function readAll(progress) {
    const mem = new Uint8Array(1024);
    for (let a = 0; a < 1024; a += 16) {
      const r = await request(0x02, [a >> 7, a & 0x7F, 16]);
      if (r[2] !== 16) throw new Error('erro ao ler o endereço ' + a);
      mem.set(dec78(r.slice(3)).slice(0, 16), a);
      if (progress) progress(a / 1024);
    }
    return mem;
  }
  async function writeAll(mem, progress) {
    const st = await request(0x04);
    if (st[0] !== 0) throw new Error('o pedal não entrou no modo de gravação');
    const order = [];
    for (let a = 16; a < 1024; a += 16) order.push(a);
    order.push(0);                                   // cabeçalho por último
    for (let i = 0; i < order.length; i++) {
      const a = order[i];
      const r = await request(0x03, [a >> 7, a & 0x7F, 16, ...enc87([...mem.slice(a, a + 16)])], 2000);
      if (r[0] !== 0) throw new Error(`o pedal recusou o bloco ${a} (código ${r[0]})`);
      if (progress) progress((i + 1) / order.length);
    }
    const c = await request(0x05, [], 2000);
    if (c[0] !== 0) throw new Error('o pedal recusou a configuração (soma de verificação)');
  }
  async function getState() {
    const r = await request(0x06);
    return { preset: r[0] + 1, channel: r[1] + 1, locked: !!(r[2] & 1), layer: !!(r[2] & 2), clock: !!(r[2] & 4), bpm: (r[3] << 7) | r[4] };
  }
  const discover = on => request(0x07, [on ? 1 : 0]);
  const factory = () => request(0x08, [], 3000);

  return {
    init, inputs, outputs, open, close, setLearnPort, send, hello, readAll, writeAll, getState, discover, factory,
    get connected() { return !!outPort; },
    on: (k, f) => listeners[k].push(f),
    _enc87: enc87, _dec78: dec78, _feed: d => onMsg({ data: d }, 'pedal'),
  };
})();
