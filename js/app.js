// ==================== ESTADO DA APLICAÇÃO ====================
const STORAGE_KEY = 'tutor4f.history';
const PHASE_MINUTES = { 1: 20, 2: 15, 3: 35, 4: 20 };
const CAUSE_LABELS = { teoria: 'Lacuna Teórica', padrao: 'Reconhecimento de Padrão', atencao: 'Atenção/Prática' };
const CAUSE_PRIORITY = ['teoria', 'padrao', 'atencao'];

const TOPICS_URL = 'data/topics.json';
let DB = {}; // { [id]: topic } — preenchido a partir de data/topics.json
let TOPIC_LIST = []; // ordem original do JSON

let currentTopic = null;
let currentPhase = 1;
let maxUnlockedPhase = 1;
let currentCardIdx = 0;
let xrayActive = false;
let currentQIdx = 0;
let selectedOption = null;
let phase3Done = false;
let sessionId = null;
let userResults = []; // { qIdx, chosen, correct, isRight, doubt, guess, rootCause }
let timerSeconds = 1200;
let timerInterval = null;

const $ = (id) => document.getElementById(id);

async function loadTopics() {
  const res = await fetch(TOPICS_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  TOPIC_LIST = json.topics || [];
  if (!TOPIC_LIST.length) throw new Error('Nenhum tópico encontrado no JSON.');
  DB = {};
  TOPIC_LIST.forEach(t => { DB[t.id] = t; });
}

// Monta o <select> agrupando os tópicos por disciplina.
function populateTopicSelect() {
  const select = $('topicSelect');
  select.innerHTML = '';
  const groups = new Map();
  TOPIC_LIST.forEach(t => {
    const subject = t.subject || 'Outros';
    if (!groups.has(subject)) {
      const og = document.createElement('optgroup');
      og.label = subject;
      groups.set(subject, og);
      select.appendChild(og);
    }
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.label || t.title;
    groups.get(subject).appendChild(opt);
  });
  select.value = currentTopic;
}

async function init() {
  try {
    await loadTopics();
  } catch (e) {
    $('cardContent').innerHTML = `
      <h3 class="text-base font-bold text-rose-300 mb-2">Não foi possível carregar os tópicos</h3>
      <p class="text-sm text-slate-200">${e.message}. Abra o projeto por um servidor local (ex.: <code>python -m http.server</code> ou extensão Live Server), pois navegadores bloqueiam <code>fetch</code> em arquivos <code>file://</code>.</p>`;
    return;
  }
  currentTopic = TOPIC_LIST[0].id;
  populateTopicSelect();
  startTimer(PHASE_MINUTES[1]);
  renderPhase1();
}

// ==================== PERSISTÊNCIA ====================
function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function saveSession(entry) {
  try {
    const history = loadHistory();
    const idx = history.findIndex(h => h.sessionId === entry.sessionId);
    if (idx >= 0) history[idx] = entry; else history.push(entry);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-100)));
  } catch (e) {
    // Armazenamento indisponível (modo privado, cota): o app segue funcionando sem persistir.
  }
}

function previousSession(topic) {
  const past = loadHistory().filter(h => h.topic === topic && h.sessionId !== sessionId);
  return past.length ? past[past.length - 1] : null;
}

// ==================== TIMER ====================
function startTimer(minutes) {
  clearInterval(timerInterval);
  timerSeconds = minutes * 60;
  updateTimerUI();
  timerInterval = setInterval(() => {
    if (timerSeconds > 0) {
      timerSeconds--;
      updateTimerUI();
    }
    if (timerSeconds === 0) clearInterval(timerInterval);
  }, 1000);
}

function updateTimerUI() {
  const m = String(Math.floor(timerSeconds / 60)).padStart(2, '0');
  const s = String(timerSeconds % 60).padStart(2, '0');
  const expired = timerSeconds === 0;
  const display = $('timerDisplay');
  display.textContent = expired ? `${m}:${s} • Tempo esgotado` : `${m}:${s}`;
  display.className = `font-mono font-bold text-sm ${expired ? 'text-rose-400' : 'text-emerald-400'}`;
  $('timerDot').className = `w-2 h-2 rounded-full ${expired ? 'bg-rose-500' : 'bg-emerald-400 animate-pulse'}`;
}

function changeTopic(topicKey) {
  currentTopic = topicKey;
  currentPhase = 1;
  maxUnlockedPhase = 1;
  currentCardIdx = 0;
  xrayActive = false;
  currentQIdx = 0;
  selectedOption = null;
  phase3Done = false;
  sessionId = null;
  userResults = [];
  updateStepperUI();
  showSection(1);
  renderPhase1();
  startTimer(PHASE_MINUTES[1]);
}

// ==================== LÓGICA FASE 1 ====================
function renderPhase1() {
  const data = DB[currentTopic];
  const card = data.cards[currentCardIdx];
  $('cardCounter').textContent = `Card ${currentCardIdx + 1} de ${data.cards.length}`;
  $('cardContent').innerHTML = `
    <h3 class="text-base md:text-lg font-bold text-indigo-300 mb-2">${card.title}</h3>
    <p class="text-sm text-slate-200 leading-relaxed">${card.body}</p>
  `;
  $('btnPrevCard').disabled = (currentCardIdx === 0);
  $('btnNextCard').textContent = (currentCardIdx === data.cards.length - 1) ? "Liberar Validação ↓" : "Próximo Card →";
  $('unlockQuizBox').classList.add('hidden');
}

function prevCard() {
  if (currentCardIdx > 0) {
    currentCardIdx--;
    renderPhase1();
  }
}

function nextCard() {
  const data = DB[currentTopic];
  if (currentCardIdx < data.cards.length - 1) {
    currentCardIdx++;
    renderPhase1();
  } else {
    renderUnlockQuiz();
  }
}

function renderUnlockQuiz() {
  const quiz = DB[currentTopic].unlockQuiz;
  $('unlockQuizBox').classList.remove('hidden');
  $('unlockQuestion').textContent = quiz.q;
  const optsDiv = $('unlockOptions');
  optsDiv.innerHTML = '';
  $('unlockFeedback').classList.add('hidden');

  quiz.options.forEach((opt) => {
    const btn = document.createElement('button');
    btn.className = "w-full text-left text-xs md:text-sm p-3 rounded-lg bg-slate-900 border border-slate-700 hover:border-indigo-500 transition";
    btn.textContent = opt.text;
    btn.onclick = () => {
      const fb = $('unlockFeedback');
      fb.classList.remove('hidden');
      if (opt.ok) {
        fb.className = "text-xs mt-3 font-semibold text-emerald-400";
        fb.textContent = "✔ Conceito validado! Desbloqueando Fase 2 (Enxergar)...";
        setTimeout(() => unlockPhase(2), 700);
      } else {
        fb.className = "text-xs mt-3 font-semibold text-rose-400";
        fb.textContent = "✖ Revise o Card 1 rapidamente: lembre-se da condição exata da regra.";
      }
    };
    optsDiv.appendChild(btn);
  });
}

// ==================== LÓGICA FASE 2 ====================
function renderPhase2() {
  xrayActive = false;
  updateXrayUI();
}

function toggleXray() {
  xrayActive = !xrayActive;
  updateXrayUI();
}

function updateXrayUI() {
  const xray = DB[currentTopic].xray;
  const container = $('xrayContainer');
  const flow = $('xrayFlowchart');
  const btn = $('btnToggleXray');

  if (xrayActive) {
    container.innerHTML = xray.highlighted;
    flow.classList.remove('hidden');
    $('xraySteps').innerHTML = xray.steps.map(s => `<li>${s}</li>`).join('');
    btn.innerHTML = `<span>✨ Lente Ativa (Ocultar Raio-X)</span>`;
  } else {
    container.innerHTML = xray.raw;
    flow.classList.add('hidden');
    btn.innerHTML = `<span>🔍 Ativar Lente do Examinador</span>`;
  }
}

// ==================== LÓGICA FASE 3 ====================
function startPhase3() {
  currentQIdx = 0;
  userResults = [];
  phase3Done = false;
  sessionId = Date.now();
  renderPhase3();
}

function redoPhase3() {
  // Refazer abre uma nova sessão; a fase 4 só é recalculada quando as questões terminarem.
  maxUnlockedPhase = 3;
  startPhase3();
  goTo(3);
  startTimer(PHASE_MINUTES[3]);
}

function renderPhase3() {
  $('phase3Done').classList.toggle('hidden', !phase3Done);
  $('quizArena').classList.toggle('hidden', phase3Done);
  if (phase3Done) {
    $('qProgress').textContent = 'Concluída';
    return;
  }

  const questions = DB[currentTopic].questions;
  const q = questions[currentQIdx];
  selectedOption = null;
  $('chkDoubt').checked = false;
  $('chkGuess').checked = false;

  $('qProgress').textContent = `Questão ${currentQIdx + 1} de ${questions.length}`;
  $('qStem').textContent = q.stem;

  const optsContainer = $('qOptions');
  optsContainer.innerHTML = '';
  const idleClass = "w-full text-left text-xs md:text-sm p-3.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-indigo-400 transition flex items-center gap-3";

  q.options.forEach((optText, i) => {
    const btn = document.createElement('button');
    btn.className = idleClass;
    btn.innerHTML = `<span class="w-6 h-6 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center text-xs font-bold">${String.fromCharCode(65 + i)}</span> <span>${optText}</span>`;
    btn.onclick = () => {
      selectedOption = i;
      Array.from(optsContainer.children).forEach(c => c.className = idleClass);
      btn.className = "w-full text-left text-xs md:text-sm p-3.5 rounded-lg bg-indigo-950/80 border-2 border-indigo-500 transition flex items-center gap-3";
    };
    optsContainer.appendChild(btn);
  });
}

function submitAnswer() {
  if (selectedOption === null) {
    alert("Selecione uma alternativa antes de confirmar.");
    return;
  }
  const questions = DB[currentTopic].questions;
  const q = questions[currentQIdx];

  userResults.push({
    qIdx: currentQIdx,
    chosen: selectedOption,
    correct: q.correct,
    isRight: selectedOption === q.correct,
    doubt: $('chkDoubt').checked,
    guess: $('chkGuess').checked,
    rootCause: null
  });

  if (currentQIdx < questions.length - 1) {
    currentQIdx++;
    renderPhase3();
  } else {
    phase3Done = true;
    unlockPhase(4);
  }
}

// ==================== LÓGICA FASE 4 ====================
function renderPhase4() {
  const questions = DB[currentTopic].questions;
  const list = $('autopsyList');
  list.innerHTML = '';

  if (!userResults.length) {
    list.innerHTML = '<p class="text-xs text-slate-400">Nenhuma questão respondida ainda. Conclua a Fase 3 para gerar o diagnóstico.</p>';
    updateVerdict();
    return;
  }

  userResults.forEach((res, idx) => {
    const q = questions[res.qIdx];
    const needsReview = !res.isRight || res.doubt || res.guess;
    const statusBadge = res.isRight
      ? (res.guess || res.doubt
          ? `<span class="text-xs bg-amber-950 text-amber-300 border border-amber-700 px-2 py-0.5 rounded">⚠️ Acertou com Chute/Dúvida</span>`
          : `<span class="text-xs bg-emerald-950 text-emerald-300 border border-emerald-700 px-2 py-0.5 rounded">✔ Acerto Firme</span>`)
      : `<span class="text-xs bg-rose-950 text-rose-300 border border-rose-700 px-2 py-0.5 rounded">✖ Errou</span>`;

    const causeBtn = (key, label) => {
      const active = res.rootCause === key;
      const cls = active
        ? "text-xs px-3 py-1.5 rounded bg-indigo-600 text-white font-bold border border-indigo-400"
        : "text-xs px-3 py-1.5 rounded bg-slate-800 border border-slate-600 hover:border-indigo-400";
      return `<button onclick="setRootCause(${idx}, '${key}', this)" class="${cls}">${label}</button>`;
    };

    const card = document.createElement('div');
    card.className = "bg-slate-900 border border-slate-700 rounded-lg p-4 space-y-3";
    card.innerHTML = `
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs font-bold text-slate-300">${q.stem}</span>
        ${statusBadge}
      </div>
      <p class="text-xs text-slate-400"><b>Gabarito Comentado:</b> ${q.explanation}</p>
      ${needsReview ? `
        <div class="pt-2 border-t border-slate-800">
          <p class="text-xs font-semibold text-rose-300 mb-2">Qual foi a causa-raiz desta falha/dúvida?</p>
          <div class="flex flex-wrap gap-2" id="cause-group-${idx}">
            ${causeBtn('teoria', '🧠 Lacuna Teórica')}
            ${causeBtn('padrao', '🔍 Não enxerguei o gatilho')}
            ${causeBtn('atencao', '⚡ Desatenção / Pressa')}
          </div>
        </div>
      ` : ''}
    `;
    list.appendChild(card);
  });

  updateVerdict();
}

function setRootCause(resultIdx, cause, btnEl) {
  userResults[resultIdx].rootCause = cause;
  const group = $(`cause-group-${resultIdx}`);
  Array.from(group.children).forEach(b => b.className = "text-xs px-3 py-1.5 rounded bg-slate-800 border border-slate-600 hover:border-indigo-400");
  btnEl.className = "text-xs px-3 py-1.5 rounded bg-indigo-600 text-white font-bold border border-indigo-400";
  updateVerdict();
}

// Causa-raiz predominante entre as classificadas (empate segue a prioridade teoria > padrão > atenção).
function dominantCause() {
  const counts = {};
  userResults.forEach(r => { if (r.rootCause) counts[r.rootCause] = (counts[r.rootCause] || 0) + 1; });
  let best = null;
  CAUSE_PRIORITY.forEach(c => {
    if (counts[c] && (best === null || counts[c] > counts[best])) best = c;
  });
  return best;
}

function updateVerdict() {
  const badge = $('scoreBadge');
  const vText = $('verdictText');
  const vAction = $('verdictAction');
  const vHistory = $('verdictHistory');

  const total = userResults.length;
  if (total === 0) {
    badge.className = "text-xs font-bold px-2.5 py-1 rounded bg-slate-700 text-slate-300";
    badge.textContent = "Sem dados";
    vText.textContent = "Responda as questões da Fase 3 para receber o veredito.";
    vAction.textContent = "";
    vHistory.textContent = "";
    return;
  }

  // Acerto firme = acertou sem chute e sem dúvida.
  const firmHits = userResults.filter(r => r.isRight && !r.guess && !r.doubt).length;
  const pct = Math.round((firmHits / total) * 100);

  const pending = userResults.filter(r => (!r.isRight || r.doubt || r.guess) && !r.rootCause).length;
  const cause = dominantCause();
  const mainCause = cause ? CAUSE_LABELS[cause] : null;
  const focusText = mainCause
    ? `<b>${mainCause}</b>`
    : `<b>causa ainda não classificada</b> (classifique as questões acima para refinar a rota)`;

  if (pct >= 75) {
    badge.className = "text-xs font-bold px-2.5 py-1 rounded bg-emerald-600 text-white";
    badge.textContent = `${pct}% Acerto Firme • TÓPICO DOMINADO`;
    vText.textContent = "Excelente! Você fechou o ciclo com domínio real (descontando chutes e dúvidas). Este tópico fica VERDE e entra em revisão espaçada daqui a 7 dias.";
    vAction.innerHTML = "<b>Próxima Sessão:</b> Avançar para o Tópico #02 da trilha.";
  } else if (pct >= 50) {
    badge.className = "text-xs font-bold px-2.5 py-1 rounded bg-amber-500 text-slate-950";
    badge.textContent = `${pct}% Acerto Firme • EM AJUSTE`;
    vText.textContent = "Você compreendeu a base, mas oscilou na aplicação prática ou precisou chutar.";
    vAction.innerHTML = `<b>Rota Calculada:</b> Pular a <b>Fase 1 (Entender)</b> para não perder tempo relendo teoria e abrir direto na <b>Fase 2 (Enxergar) + Fase 3 (Fazer)</b>, com foco em: ${focusText}.`;
  } else {
    badge.className = "text-xs font-bold px-2.5 py-1 rounded bg-rose-600 text-white";
    badge.textContent = `${pct}% Acerto Firme • BASE FRÁGIL`;
    vText.textContent = "A pedra no sapato apareceu aqui — e diagnosticar isso agora economiza meses de estudo errado.";
    vAction.innerHTML = `<b>Rota Calculada:</b> Reiniciar o ciclo neste subtópico com foco cirúrgico em ${focusText} nos primeiros 20 minutos da próxima sessão.`;
  }

  if (pending > 0) {
    vAction.innerHTML += `<br><span class="text-amber-300">⚠ ${pending} questão(ões) sem causa-raiz classificada.</span>`;
  }

  const prev = previousSession(currentTopic);
  vHistory.textContent = prev
    ? `Sessão anterior neste tópico: ${prev.pct}% de acerto firme em ${new Date(prev.date).toLocaleDateString('pt-BR')}.`
    : "Primeira sessão registrada neste tópico.";

  saveSession({
    sessionId,
    topic: currentTopic,
    date: new Date().toISOString(),
    pct,
    total,
    firmHits,
    mainCause: cause,
    results: userResults
  });
}

// ==================== NAVEGAÇÃO DE FASES ====================
function goTo(phaseNum) {
  currentPhase = phaseNum;
  updateStepperUI();
  showSection(phaseNum);
}

function unlockPhase(phaseNum) {
  const alreadyUnlocked = phaseNum <= maxUnlockedPhase;
  if (phaseNum > maxUnlockedPhase) maxUnlockedPhase = phaseNum;
  goTo(phaseNum);

  // Revisitar uma fase já liberada nunca zera o progresso nem o timer.
  if (alreadyUnlocked && phaseNum !== 4) { renderPhaseView(phaseNum); return; }

  if (phaseNum === 2) { renderPhase2(); startTimer(PHASE_MINUTES[2]); }
  if (phaseNum === 3) { startPhase3(); startTimer(PHASE_MINUTES[3]); }
  if (phaseNum === 4) { renderPhase4(); startTimer(PHASE_MINUTES[4]); }
}

function renderPhaseView(phaseNum) {
  if (phaseNum === 3) renderPhase3();
  if (phaseNum === 4) renderPhase4();
}

function tryNavigate(phaseNum) {
  if (phaseNum <= maxUnlockedPhase) {
    goTo(phaseNum);
    renderPhaseView(phaseNum);
  }
}

function showSection(phaseNum) {
  [1, 2, 3, 4].forEach(n => {
    $(`phase-${n}`).classList.toggle('hidden', n !== phaseNum);
  });
}

function updateStepperUI() {
  const labels = ["1. ENTENDER", "2. ENXERGAR", "3. FAZER", "4. DIAGNOSTICAR"];
  [1, 2, 3, 4].forEach(n => {
    const btn = $(`step-${n}`);
    if (n === currentPhase) {
      btn.className = "py-2 rounded-md bg-indigo-600 text-white transition shadow";
      btn.textContent = labels[n - 1];
    } else if (n <= maxUnlockedPhase) {
      btn.className = "py-2 rounded-md bg-slate-700 text-emerald-400 hover:bg-slate-600 transition";
      btn.textContent = "✔ " + labels[n - 1];
    } else {
      btn.className = "py-2 rounded-md bg-slate-800 text-slate-500 cursor-not-allowed transition";
      btn.textContent = "🔒 " + labels[n - 1];
    }
  });
}

init();

