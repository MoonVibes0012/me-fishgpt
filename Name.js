// ========== PILIH JAWABAN ==========
async function pilihJawaban(pesanUser) {
  // Prioritas 1: logika sederhana (tetap jalan)
  const sederhana = logikaSederhana(pesanUser);
  if (sederhana) {
    return { text: sederhana, type: 'normal' };
  }

  // Prioritas 2: spesial (sangat jarang, 3%)
  if (Math.random() < 0.03) {
    return { text: "i'm gpt by VelvetEcho ON MoonVibes", type: 'special' };
  }

  // Prioritas 3: pengetahuan dari file (hampir selalu)
  try {
    const res = await fetch(API + '/knowledge/random');
    const data = await res.json();
    if (data.content) {
      return { text: data.content, type: 'learned' };
    }
  } catch {}

  // Kalau pengetahuan masih kosong
  return { text: 'me fishgpt', type: 'normal' };
}
