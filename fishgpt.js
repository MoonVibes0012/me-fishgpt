/**
 * fishgpt.js
 * Core Engine - Version 3.2
 */

const API = 'https://me-fishgpt-production.up.railway.app';

let COMMANDS = null;
let chatHistory = [];
let sortedCache = null; // cache perintah yang sudah diurutkan

// =====================================================
// LOAD & SAVE
// =====================================================
async function loadCommands() {
  const saved = localStorage.getItem('fishgpt_commands');
  if (saved) {
    try {
      COMMANDS = JSON.parse(saved);
      if (COMMANDS && Array.isArray(COMMANDS.commands)) {
        sortedCache = null;
        console.log(`[FishGPT] ${COMMANDS.commands.length} perintah dimuat dari localStorage`);
        return;
      }
    } catch (e) {
      console.warn('[FishGPT] localStorage rusak');
    }
  }

  try {
    const res = await fetch('commands.json?t=' + Date.now());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    COMMANDS = await res.json();
    saveCommands();
    sortedCache = null;
    console.log('[FishGPT] Perintah dimuat dari commands.json');
  } catch (err) {
    console.error('[FishGPT] Gagal memuat commands.json:', err.message);
    COMMANDS = getFallbackCommands();
  }
}

function getFallbackCommands() {
  return {
    version: 'fallback',
    fallback: 'me fishgpt',
    special_chance: 0.03,
    special_responses: ['dari kedalaman yang sama'],
    commands: []
  };
}

function saveCommands() {
  try {
    localStorage.setItem('fishgpt_commands', JSON.stringify(COMMANDS));
    sortedCache = null; // invalidate cache
  } catch (e) {
    console.warn('[FishGPT] Gagal menyimpan ke localStorage');
  }
}

async function resetCommandsToDefault() {
  try {
    const res = await fetch('commands.json?t=' + Date.now());
    if (!res.ok) throw new Error('Gagal memuat file');
    COMMANDS = await res.json();
    saveCommands();
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

// =====================================================
// AUDIO
// =====================================================
let audioCtx = null;

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
}

function playTypeSound() {
  if (!audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'triangle';
    osc.frequency.value = 580 + Math.random() * 160;
    gain.gain.value = 0.028;
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.05);
  } catch {}
}

function playKeySound() {
  if (!audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'square';
    osc.frequency.value = 720 + Math.random() * 300;
    gain.gain.value = 0.011;
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.028);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.028);
  } catch {}
}

// =====================================================
// MATCHING ENGINE (dengan skor)
// =====================================================
function getSortedCommands() {
  if (sortedCache) return sortedCache;
  sortedCache = [...(COMMANDS?.commands || [])].sort((a, b) => {
    return (b.priority || 0) - (a.priority || 0);
  });
  return sortedCache;
}

function calculateScore(pesan, trigger, exact = false) {
  const p = pesan.toLowerCase().trim();
  const t = trigger.toLowerCase().trim();

  if (!t) return 0;

  // Exact match
  if (p === t) return 100;

  if (exact) return 0; // jika wajib exact dan tidak sama, skor 0

  // Kata penuh
  const regex = new RegExp(`\\b${escapeRegex(t)}\\b`, 'i');
  if (regex.test(p)) return 80;

  // Partial
  if (p.includes(t)) return 50;

  return 0;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runCommand(pesan) {
  if (!COMMANDS?.commands?.length) return null;

  const p = pesan.toLowerCase().trim();
  const hour = new Date().getHours();
  const sorted = getSortedCommands();

  let bestMatch = null;
  let bestScore = 0;

  for (const cmd of sorted) {
    if (!Array.isArray(cmd.triggers)) continue;

    for (const trigger of cmd.triggers) {
      const isExact = cmd.exact === true;
      const score = calculateScore(p, trigger, isExact);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = cmd;
      }
    }
  }

  // Minimal skor 50 agar tidak terlalu longgar
  if (!bestMatch || bestScore < 50) return null;

  // Ambil response
  if (bestMatch.responses && typeof bestMatch.responses === 'object') {
    if (p.includes('pagi') || (bestMatch.category === 'sapaan' && hour >= 5 && hour < 11)) {
      return bestMatch.responses.pagi || bestMatch.responses.default;
    }
    if (p.includes('siang') || (bestMatch.category === 'sapaan' && hour >= 11 && hour < 15)) {
      return bestMatch.responses.siang || bestMatch.responses.default;
    }
    if (p.includes('sore') || (bestMatch.category === 'sapaan' && hour >= 15 && hour < 18)) {
      return bestMatch.responses.sore || bestMatch.responses.default;
    }
    if (p.includes('malam') || (bestMatch.category === 'sapaan' && (hour >= 18 || hour < 5))) {
      return bestMatch.responses.malam || bestMatch.responses.default;
    }
    return bestMatch.responses.default || Object.values(bestMatch.responses)[0];
  }

  return bestMatch.response || null;
}

// =====================================================
// CHOOSE ANSWER
// =====================================================
async function chooseAnswer(pesan) {
  chatHistory.push({ role: 'user', text: pesan, time: Date.now() });
  if (chatHistory.length > 12) chatHistory.shift();

  // 1. Command
  const fromCmd = runCommand(pesan);
  if (fromCmd) {
    chatHistory.push({ role: 'bot', text: fromCmd, type: 'command' });
    return { text: fromCmd, type: 'command' };
  }

  // 2. Special (dengan weight jika ada)
  const chance = COMMANDS.special_chance ?? 0.03;
  if (Math.random() < chance && Array.isArray(COMMANDS.special_responses) && COMMANDS.special_responses.length) {
    const text = pickSpecialResponse();
    chatHistory.push({ role: 'bot', text, type: 'special' });
    return { text, type: 'special' };
  }

  // 3. Knowledge
  try {
    const res = await fetch(API + '/knowledge/random');
    if (res.ok) {
      const data = await res.json();
      if (data.content) {
        chatHistory.push({ role: 'bot', text: data.content, type: 'learned' });
        return { text: data.content, type: 'learned' };
      }
    }
  } catch (err) {
    console.warn('[FishGPT] Gagal fetch knowledge:', err.message);
  }

  // 4. Fallback
  const fallback = COMMANDS.fallback || 'me fishgpt';
  chatHistory.push({ role: 'bot', text: fallback, type: 'normal' });
  return { text: fallback, type: 'normal' };
}

function pickSpecialResponse() {
  const list = COMMANDS.special_responses;

  // Jika item berupa object {text, weight}
  if (typeof list[0] === 'object' && list[0].text) {
    const total = list.reduce((sum, item) => sum + (item.weight || 1), 0);
    let rand = Math.random() * total;
    for (const item of list) {
      rand -= (item.weight || 1);
      if (rand <= 0) return item.text;
    }
  }

  // Biasa (array of string)
  return list[Math.floor(Math.random() * list.length)];
}

// =====================================================
// STACK JSON
// =====================================================
function stackCommands(json) {
  if (!json || !Array.isArray(json.commands)) {
    throw new Error('JSON harus memiliki array "commands"');
  }

  const validCommands = json.commands.filter(cmd => {
    return cmd &&
           Array.isArray(cmd.triggers) &&
           cmd.triggers.length > 0 &&
           (cmd.response || cmd.responses);
  });

  if (validCommands.length === 0) {
    throw new Error('Tidak ada perintah valid di JSON');
  }

  const before = COMMANDS.commands.length;
  validCommands.forEach(cmd => COMMANDS.commands.push(cmd));

  if (Array.isArray(json.special_responses)) {
    COMMANDS.special_responses = COMMANDS.special_responses || [];
    COMMANDS.special_responses.push(...json.special_responses);
  }

  if (json.fallback) COMMANDS.fallback = json.fallback;
  if (typeof json.special_chance === 'number') {
    COMMANDS.special_chance = json.special_chance;
  }

  saveCommands();
  return COMMANDS.commands.length - before;
}

// =====================================================
// HAPUS PERINTAH BERDASARKAN KATEGORI
// =====================================================
function removeCommandsByCategory(category) {
  if (!category) return 0;
  const before = COMMANDS.commands.length;
  COMMANDS.commands = COMMANDS.commands.filter(cmd => cmd.category !== category);
  saveCommands();
  return before - COMMANDS.commands.length;
}

// =====================================================
// HELPERS
// =====================================================
function getCommandCount() {
  return COMMANDS?.commands?.length || 0;
}

function getHistory() {
  return [...chatHistory];
}

function clearHistory() {
  chatHistory = [];
}

function getCommands() {
  return COMMANDS;
}

// =====================================================
// EXPORT
// =====================================================
window.FishGPT = {
  loadCommands,
  saveCommands,
  resetCommandsToDefault,
  initAudio,
  playTypeSound,
  playKeySound,
  runCommand,
  chooseAnswer,
  stackCommands,
  removeCommandsByCategory,
  getCommandCount,
  getHistory,
  clearHistory,
  getCommands
};
