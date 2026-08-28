/**
 * fishgpt.js
 * Core Engine - Version 3.4 (Load Speed Focused)
 */

const API = 'https://me-fishgpt-production.up.railway.app';

let COMMANDS = null;
let chatHistory = [];
let sortedCache = null;

// Statistik detail
let loadStats = {
  lastCommandsLoad: 0,
  localStorageTime: 0,
  fetchTime: 0,
  parseTime: 0,
  stackTime: 0,
  knowledgeTime: 0,
  source: null
};

// =====================================================
// LOAD COMMANDS (OPTIMIZED)
// =====================================================
async function loadCommands() {
  const totalStart = performance.now();

  // --- 1. localStorage (paling cepat) ---
  const lsStart = performance.now();
  const saved = localStorage.getItem('fishgpt_commands');
  loadStats.localStorageTime = Math.round(performance.now() - lsStart);

  if (saved) {
    const parseStart = performance.now();
    try {
      const parsed = JSON.parse(saved);
      loadStats.parseTime = Math.round(performance.now() - parseStart);

      if (parsed?.commands && Array.isArray(parsed.commands)) {
        COMMANDS = parsed;
        sortedCache = null;
        loadStats.lastCommandsLoad = Math.round(performance.now() - totalStart);
        loadStats.source = 'localStorage';
        loadStats.fetchTime = 0;
        console.log(`[FishGPT] localStorage load: ${loadStats.lastCommandsLoad}ms`);
        return {
          success: true,
          duration: loadStats.lastCommandsLoad,
          source: 'localStorage',
          breakdown: { ...loadStats }
        };
      }
    } catch (e) {
      console.warn('[FishGPT] localStorage parse failed');
    }
  }

  // --- 2. Fetch commands.json ---
  const fetchStart = performance.now();
  try {
    const res = await fetch('commands.json', { cache: 'force-cache' }); // manfaatkan cache browser
    loadStats.fetchTime = Math.round(performance.now() - fetchStart);

    if (!res.ok) throw new Error('HTTP ' + res.status);

    const parseStart = performance.now();
    COMMANDS = await res.json();
    loadStats.parseTime = Math.round(performance.now() - parseStart);

    // Simpan ke localStorage secara async (tidak memblokir)
    setTimeout(() => saveCommands(), 0);

    sortedCache = null;
    loadStats.lastCommandsLoad = Math.round(performance.now() - totalStart);
    loadStats.source = 'file';

    console.log(`[FishGPT] File load: ${loadStats.lastCommandsLoad}ms (fetch ${loadStats.fetchTime}ms + parse ${loadStats.parseTime}ms)`);

    return {
      success: true,
      duration: loadStats.lastCommandsLoad,
      source: 'file',
      breakdown: { ...loadStats }
    };
  } catch (err) {
    console.error('[FishGPT] Load failed:', err.message);
    COMMANDS = getFallbackCommands();
    loadStats.lastCommandsLoad = Math.round(performance.now() - totalStart);
    loadStats.source = 'fallback';
    return {
      success: false,
      duration: loadStats.lastCommandsLoad,
      source: 'fallback',
      breakdown: { ...loadStats }
    };
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
    // Stringify bisa berat jika commands sangat banyak, jadi kita biarkan di background
    const str = JSON.stringify(COMMANDS);
    localStorage.setItem('fishgpt_commands', str);
    sortedCache = null;
  } catch (e) {
    console.warn('[FishGPT] saveCommands failed');
  }
}

async function resetCommandsToDefault() {
  const start = performance.now();
  try {
    const res = await fetch('commands.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('Fetch failed');
    COMMANDS = await res.json();
    saveCommands();
    sortedCache = null;
    const duration = Math.round(performance.now() - start);
    loadStats.lastCommandsLoad = duration;
    loadStats.source = 'file';
    return { success: true, duration };
  } catch (err) {
    return { success: false, duration: 0 };
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
// MATCHING ENGINE
// =====================================================
function getSortedCommands() {
  if (sortedCache) return sortedCache;
  sortedCache = [...(COMMANDS?.commands || [])].sort((a, b) => (b.priority || 0) - (a.priority || 0));
  return sortedCache;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function calculateScore(pesan, trigger, exact = false) {
  const p = pesan.toLowerCase().trim();
  const t = String(trigger).toLowerCase().trim();
  if (!t) return 0;
  if (p === t) return 100;
  if (exact) return 0;
  if (p.includes(t)) {
    // Bonus jika kata penuh
    const regex = new RegExp(`\\b${escapeRegex(t)}\\b`, 'i');
    return regex.test(p) ? 80 : 50;
  }
  return 0;
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
      const score = calculateScore(p, trigger, cmd.exact === true);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = cmd;
      }
    }
  }

  if (!bestMatch || bestScore < 50) return null;

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

  const fromCmd = runCommand(pesan);
  if (fromCmd) {
    chatHistory.push({ role: 'bot', text: fromCmd, type: 'command' });
    return { text: fromCmd, type: 'command' };
  }

  const chance = COMMANDS.special_chance ?? 0.03;
  if (Math.random() < chance && Array.isArray(COMMANDS.special_responses) && COMMANDS.special_responses.length) {
    const text = pickSpecialResponse();
    chatHistory.push({ role: 'bot', text, type: 'special' });
    return { text, type: 'special' };
  }

  try {
    const res = await fetch(API + '/knowledge/random');
    if (res.ok) {
      const data = await res.json();
      if (data.content) {
        chatHistory.push({ role: 'bot', text: data.content, type: 'learned' });
        return { text: data.content, type: 'learned' };
      }
    }
  } catch (err) {}

  const fallback = COMMANDS.fallback || 'me fishgpt';
  chatHistory.push({ role: 'bot', text: fallback, type: 'normal' });
  return { text: fallback, type: 'normal' };
}

function pickSpecialResponse() {
  const list = COMMANDS.special_responses;
  if (typeof list[0] === 'object' && list[0]?.text) {
    const total = list.reduce((sum, item) => sum + (item.weight || 1), 0);
    let rand = Math.random() * total;
    for (const item of list) {
      rand -= (item.weight || 1);
      if (rand <= 0) return item.text;
    }
  }
  return list[Math.floor(Math.random() * list.length)];
}

// =====================================================
// STACK + SPEED
// =====================================================
function stackCommands(json) {
  const start = performance.now();

  if (!json?.commands || !Array.isArray(json.commands)) {
    throw new Error('JSON harus memiliki array "commands"');
  }

  const validCommands = json.commands.filter(cmd =>
    cmd && Array.isArray(cmd.triggers) && cmd.triggers.length > 0 && (cmd.response || cmd.responses)
  );

  if (validCommands.length === 0) {
    throw new Error('Tidak ada perintah valid');
  }

  const before = COMMANDS.commands.length;
  // Push lebih cepat daripada concat untuk array besar
  for (let i = 0; i < validCommands.length; i++) {
    COMMANDS.commands.push(validCommands[i]);
  }

  if (Array.isArray(json.special_responses)) {
    COMMANDS.special_responses = COMMANDS.special_responses || [];
    COMMANDS.special_responses.push(...json.special_responses);
  }

  if (json.fallback) COMMANDS.fallback = json.fallback;
  if (typeof json.special_chance === 'number') COMMANDS.special_chance = json.special_chance;

  // Save di background
  setTimeout(() => saveCommands(), 0);

  const duration = Math.round(performance.now() - start);
  loadStats.stackTime = duration;

  return {
    added: COMMANDS.commands.length - before,
    total: COMMANDS.commands.length,
    duration
  };
}

// =====================================================
// KNOWLEDGE UPLOAD + SPEED
// =====================================================
async function uploadKnowledge(file) {
  const start = performance.now();
  if (!file) throw new Error('Tidak ada file');

  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(API + '/upload', {
    method: 'POST',
    body: formData
  });

  const data = await res.json();
  const duration = Math.round(performance.now() - start);
  loadStats.knowledgeTime = duration;

  if (!res.ok) throw new Error(data.error || 'Gagal upload');

  return {
    message: data.message,
    chunks: data.chunks || 0,
    duration
  };
}

// =====================================================
// HELPERS
// =====================================================
function removeCommandsByCategory(category) {
  if (!category) return 0;
  const before = COMMANDS.commands.length;
  COMMANDS.commands = COMMANDS.commands.filter(cmd => cmd.category !== category);
  setTimeout(() => saveCommands(), 0);
  return before - COMMANDS.commands.length;
}

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

function getLoadStats() {
  return { ...loadStats };
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
  uploadKnowledge,
  removeCommandsByCategory,
  getCommandCount,
  getHistory,
  clearHistory,
  getCommands,
  getLoadStats
};
