// fishgpt.js
const API = 'https://me-fishgpt-production.up.railway.app';

let COMMANDS = null;

// ===== LOAD COMMANDS =====
async function loadCommands() {
  // Coba dari localStorage dulu
  const saved = localStorage.getItem('fishgpt_commands');
  if (saved) {
    try {
      COMMANDS = JSON.parse(saved);
      return;
    } catch {}
  }

  // Kalau tidak ada, ambil dari commands.json
  try {
    const res = await fetch('commands.json');
    COMMANDS = await res.json();
    localStorage.setItem('fishgpt_commands', JSON.stringify(COMMANDS));
  } catch {
    // Fallback minimal
    COMMANDS = {
      fallback: "me fishgpt",
      special_chance: 0.03,
      special_responses: ["dari kedalaman yang sama"],
      commands: []
    };
  }
}

function saveCommands() {
  localStorage.setItem('fishgpt_commands', JSON.stringify(COMMANDS));
}

// ===== AUDIO =====
let audioCtx;
function initAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playTypeSound() {
  if (!audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.connect(g);
  g.connect(audioCtx.destination);
  o.frequency.value = 600 + Math.random() * 140;
  o.type = 'triangle';
  g.gain.value = 0.025;
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
  o.start();
  o.stop(audioCtx.currentTime + 0.05);
}

function playKeySound() {
  if (!audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.connect(g);
  g.connect(audioCtx.destination);
  o.frequency.value = 750 + Math.random() * 300;
  o.type = 'square';
  g.gain.value = 0.012;
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.03);
  o.start();
  o.stop(audioCtx.currentTime + 0.03);
}

// ===== COMMAND ENGINE =====
function runCommand(pesan) {
  const p = pesan.toLowerCase().trim();
  const jam = new Date().getHours();

  for (const cmd of COMMANDS.commands) {
    if (!cmd.triggers.some(t => p.includes(t.toLowerCase()))) continue;

    if (cmd.responses) {
      if (p.includes('pagi') || (cmd.category === 'sapaan' && jam >= 5 && jam < 11))
        return cmd.responses.pagi || cmd.responses.default;
      if (p.includes('siang') || (cmd.category === 'sapaan' && jam >= 11 && jam < 15))
        return cmd.responses.siang || cmd.responses.default;
      if (p.includes('sore') || (cmd.category === 'sapaan' && jam >= 15 && jam < 18))
        return cmd.responses.sore || cmd.responses.default;
      if (p.includes('malam') || (cmd.category === 'sapaan' && (jam >= 18 || jam < 5)))
        return cmd.responses.malam || cmd.responses.default;
      return cmd.responses.default || Object.values(cmd.responses)[0];
    }

    if (cmd.response) return cmd.response;
  }
  return null;
}

// ===== PILIH JAWABAN =====
async function chooseAnswer(pesan) {
  // 1. Perintah
  const cmd = runCommand(pesan);
  if (cmd) return { text: cmd, type: 'command' };

  // 2. Special
  const chance = COMMANDS.special_chance || 0.03;
  if (Math.random() < chance && COMMANDS.special_responses?.length) {
    const list = COMMANDS.special_responses;
    const text = list[Math.floor(Math.random() * list.length)];
    return { text, type: 'special' };
  }

  // 3. Pengetahuan dari server
  try {
    const res = await fetch(API + '/knowledge/random');
    const data = await res.json();
    if (data.content) return { text: data.content, type: 'learned' };
  } catch {}

  // 4. Fallback
  return { text: COMMANDS.fallback || 'me fishgpt', type: 'normal' };
}

// ===== STACK JSON =====
function stackCommands(json) {
  if (!json.commands || !Array.isArray(json.commands)) {
    throw new Error('JSON harus punya array "commands"');
  }

  const before = COMMANDS.commands.length;
  json.commands.forEach(c => COMMANDS.commands.push(c));

  if (Array.isArray(json.special_responses)) {
    COMMANDS.special_responses = COMMANDS.special_responses || [];
    COMMANDS.special_responses.push(...json.special_responses);
  }

  if (json.fallback) COMMANDS.fallback = json.fallback;
  if (json.special_chance) COMMANDS.special_chance = json.special_chance;

  saveCommands();
  return COMMANDS.commands.length - before;
}
