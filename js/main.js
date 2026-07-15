import { SoundManager } from "./sounds.js";
import { Scene } from "./scene.js";

/** Boss after this many normal plane kills in a wave */
const BOSS_EVERY = 30;

/**
 * @typedef {{ word: string, category: string, description: string, pos?: string, zh?: string }} WordEntry
 * @typedef {{ text: string, author: string }} Quote
 */

class Game {
  constructor() {
    this.sounds = new SoundManager();
    this.scene = new Scene(document.getElementById("game-canvas"));

    /** @type {WordEntry[]} */
    this.words = [];
    /** @type {Quote[]} */
    this.quotes = [];

    /** @type {WordEntry | null} */
    this.nearWord = null;
    /** @type {WordEntry | null} */
    this.farWord = null;
    /** @type {Quote | null} */
    this.bossQuote = null;

    this.targetText = "";
    this.charIndex = 0;

    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.multiplier = 1;
    this.wordsCleared = 0;
    this.killsThisWave = 0;
    this.bossesDefeated = 0;
    this.correctKeys = 0;
    this.totalKeys = 0;

    /** @type {'idle' | 'combat' | 'boss'} */
    this.phase = "idle";
    this.running = false;

    this.lastTs = 0;
    this.comboLabels = [];
    this.warningHideAt = 0;

    this.el = {
      score: document.getElementById("score"),
      combo: document.getElementById("combo"),
      multiplier: document.getElementById("multiplier"),
      waveTimer: document.getElementById("wave-timer"),
      wordsCleared: document.getElementById("words-cleared"),
      skyLabel: document.getElementById("sky-label"),
      bosses: document.getElementById("bosses"),
      nearLabel: document.getElementById("near-label"),
      farLabel: document.getElementById("far-label"),
      bossLabel: document.getElementById("boss-label"),
      nearWord: document.getElementById("near-word"),
      nearPos: document.getElementById("near-pos"),
      nearZh: document.getElementById("near-zh"),
      farWord: document.getElementById("far-word"),
      bossQuote: document.getElementById("boss-quote"),
      bossAuthor: document.getElementById("boss-author"),
      overlay: document.getElementById("overlay"),
      warning: document.getElementById("warning"),
      toast: document.getElementById("toast"),
      startBtn: document.getElementById("start-btn"),
      comboLayer: document.getElementById("combo-layer"),
    };

    this.el.startBtn.addEventListener("click", () => this.start());
    window.addEventListener("keydown", (e) => this.onKey(e));
  }

  async init() {
    try {
      const [words, meta, quotes] = await Promise.all([
        loadWords("data/ogden_850_words.csv"),
        loadJson("data/word_meta.json"),
        loadJson("data/quotes.json"),
      ]);
      this.words = words
        .filter((w) => w.word.length >= 2 && w.word.length <= 12)
        .map((w) => {
          const m = meta?.[w.word];
          return {
            ...w,
            pos: m?.pos || parsePosZh(w.description),
            zh: m?.zh || "",
          };
        });
      this.quotes = Array.isArray(quotes) ? quotes : [];
    } catch (err) {
      console.error(err);
      this.words = FALLBACK_WORDS;
      this.quotes = FALLBACK_QUOTES;
    }
    this.updateSkyLabel();
    this.loop(performance.now());
  }

  start() {
    this.sounds.resume();
    this.sounds.start();

    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.multiplier = 1;
    this.wordsCleared = 0;
    this.killsThisWave = 0;
    this.bossesDefeated = 0;
    this.correctKeys = 0;
    this.totalKeys = 0;
    this.running = true;
    this.charIndex = 0;

    this.scene.applySky("day", true);
    this.scene.removeBoss();
    this.hideWarning();
    this.el.overlay.classList.add("hidden");
    this.hideToast();
    this.updateHud();
    this.updateSkyLabel();
    this.beginCombat();
  }

  beginCombat() {
    this.phase = "combat";
    this.killsThisWave = 0;

    this.nearWord = this.pickWord();
    this.farWord = this.pickWord(this.nearWord?.word);
    this.bossQuote = null;
    this.targetText = this.nearWord.word;
    this.charIndex = 0;

    this.scene.spawnNearEnemy();
    this.scene.spawnFarEnemy();
    this.scene.removeBoss();

    this.renderLabels();
    this.el.bossLabel.classList.add("hidden");
    this.updateHud();
  }

  pickWord(exclude) {
    if (!this.words.length) return FALLBACK_WORDS[0];
    let pick;
    let n = 0;
    do {
      pick = this.words[Math.floor(Math.random() * this.words.length)];
      n++;
    } while (exclude && pick.word === exclude && n < 12);
    return pick;
  }

  pickQuote() {
    if (!this.quotes.length) return FALLBACK_QUOTES[0];
    return this.quotes[Math.floor(Math.random() * this.quotes.length)];
  }

  expectedChar() {
    if (!this.targetText || this.charIndex >= this.targetText.length) return null;
    if (this.phase === "boss") return this.targetText[this.charIndex];
    return this.targetText.toLowerCase()[this.charIndex];
  }

  onKey(e) {
    // Always accept typing during combat or boss — never hard-lock input
    if (!this.running) return;
    if (this.phase !== "combat" && this.phase !== "boss") return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    let key = e.key;
    if (key === " ") {
      if (this.phase !== "boss") return;
    } else if (key.length !== 1) {
      return;
    }

    // If target not ready (edge frame), ignore
    const expected = this.expectedChar();
    if (expected == null) return;

    e.preventDefault();
    this.totalKeys++;

    let match = false;
    if (this.phase === "boss") {
      if (expected === " ") match = key === " ";
      else if (/[a-zA-Z]/.test(expected)) match = key.toLowerCase() === expected.toLowerCase();
      else match = key === expected;
    } else {
      match = key.toLowerCase() === expected;
    }

    if (match) this.onCorrect();
    else this.onWrong();
  }

  onCorrect() {
    this.correctKeys++;
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;

    const prevMult = this.multiplier;
    this.multiplier = this.getMultiplier(this.combo);
    this.score += 1 * this.multiplier;

    if (this.multiplier > prevMult) {
      this.sounds.comboUp();
      this.showToast(this.multiplier === 3 ? "×3 MULTIPLIER!" : "×2 MULTIPLIER!", "combo");
    }

    const kind = this.phase === "boss" ? "boss" : "near";
    this.sounds.shoot();
    const shot = this.scene.fireAtEnemy(kind, {
      combo: this.combo,
      multiplier: this.multiplier,
      onHit: () => this.sounds.hit(),
    });
    if (shot && this.combo >= 2) {
      this.spawnComboLabel(shot, this.combo, this.multiplier);
    }

    this.charIndex++;
    this.renderLabels();

    if (this.charIndex >= this.targetText.length) {
      if (this.phase === "boss") this.onBossDestroyed();
      else this.onNearPlaneDestroyed();
    }

    this.updateHud();
  }

  onWrong() {
    this.score = Math.max(0, this.score - 1);
    this.combo = 0;
    this.multiplier = 1;
    this.sounds.miss();
    this.sounds.enemyShot();
    this.showToast("−1", "miss");

    // Enemy fires laser at player
    const from = this.phase === "boss" ? "boss" : "near";
    this.scene.fireEnemyAtPlayer(from, () => {
      this.sounds.hit();
    });

    const container =
      this.phase === "boss" ? this.el.bossQuote : this.el.nearWord;
    const next = container?.querySelector(".letter.next, .ch.next");
    if (next) {
      next.classList.remove("miss");
      void next.offsetWidth;
      next.classList.add("miss");
      setTimeout(() => next.classList.remove("miss"), 280);
    }
    this.updateHud();
  }

  onNearPlaneDestroyed() {
    const wordPts = 5 * this.multiplier;
    this.score += wordPts;
    this.wordsCleared++;
    this.killsThisWave++;
    this.sounds.destroy();
    this.scene.explodeEnemy("near");
    this.showToast(`+${wordPts}`, "destroy");

    // 30 normal kills → BOSS (no input lock)
    if (this.killsThisWave >= BOSS_EVERY) {
      this.flashWarning();
      this.startBoss();
      this.updateHud();
      return;
    }

    // Instantly switch to next target so player can keep typing
    this.nearWord = this.farWord || this.pickWord();
    this.farWord = this.pickWord(this.nearWord?.word);
    this.targetText = this.nearWord.word;
    this.charIndex = 0;
    this.scene.promoteFarToNear();
    this.renderLabels();
    this.updateHud();
  }

  /** Non-blocking warning banner */
  flashWarning() {
    this.showWarning();
    this.sounds.warning();
    this.warningHideAt = performance.now() + 1600;
  }

  startBoss() {
    this.phase = "boss";
    this.bossQuote = this.pickQuote();
    this.targetText = this.bossQuote.text;
    this.charIndex = 0;
    this.nearWord = null;
    this.farWord = null;

    this.scene.spawnBoss();
    this.el.nearLabel.classList.add("hidden");
    this.el.farLabel.classList.add("hidden");
    this.el.bossLabel.classList.remove("hidden");
    this.renderLabels();
    this.showToast("BOSS!", "combo");
    this.sounds.boss();
    this.updateHud();
  }

  onBossDestroyed() {
    const pts = 50 * this.multiplier;
    this.score += pts;
    this.bossesDefeated++;
    this.sounds.destroy();
    this.sounds.bossDown();
    this.scene.explodeEnemy("boss");
    this.showToast(`BOSS +${pts}`, "destroy");
    this.el.bossLabel.classList.add("hidden");

    // Sky cycle + immediately resume combat (typing never blocked)
    this.scene.cycleSky();
    this.updateSkyLabel();
    this.beginCombat();
  }

  getMultiplier(combo) {
    if (combo > 20) return 3;
    if (combo > 10) return 2;
    return 1;
  }

  renderLabels() {
    if (this.phase === "combat" && this.nearWord) {
      this.el.nearWord.innerHTML = renderLetters(
        this.nearWord.word,
        this.charIndex,
        false
      );
      this.el.nearPos.textContent = this.nearWord.pos
        ? `〔${this.nearWord.pos}〕`
        : "";
      this.el.nearZh.textContent = this.nearWord.zh || "";
      this.el.nearLabel.classList.remove("hidden");
    } else {
      this.el.nearLabel.classList.add("hidden");
    }

    if (this.phase === "combat" && this.farWord) {
      this.el.farWord.innerHTML = renderLetters(this.farWord.word, -1, false);
      this.el.farLabel.classList.remove("hidden");
    } else {
      this.el.farLabel.classList.add("hidden");
    }

    if (this.phase === "boss" && this.bossQuote) {
      this.el.bossQuote.innerHTML = renderLetters(
        this.bossQuote.text,
        this.charIndex,
        true
      );
      this.el.bossAuthor.textContent = this.bossQuote.author
        ? `— ${this.bossQuote.author}`
        : "";
      this.el.bossLabel.classList.remove("hidden");
    } else if (this.phase !== "boss") {
      this.el.bossLabel.classList.add("hidden");
    }
  }

  positionLabels() {
    const place = (el, anchor, offsetY = 0) => {
      if (!el || el.classList.contains("hidden") || !anchor || !anchor.visible) {
        if (el) el.style.visibility = "hidden";
        return;
      }
      el.style.visibility = "visible";
      el.style.left = `${anchor.x}px`;
      el.style.top = `${anchor.y + offsetY}px`;
    };

    if (this.phase === "combat") {
      place(this.el.nearLabel, this.scene.getNearLabelAnchor(), 8);
      place(this.el.farLabel, this.scene.getFarLabelAnchor(), 4);
    }
    if (this.phase === "boss") {
      place(this.el.bossLabel, this.scene.getBossLabelAnchor(), 12);
    }
  }

  spawnComboLabel(shot, combo, mult) {
    if (!this.el.comboLayer || !shot?.start || !shot?.target) return;
    const el = document.createElement("div");
    el.className =
      "combo-shot-label" + (mult >= 3 ? " x3" : mult >= 2 ? " x2" : "");
    el.textContent = `x${combo}`;
    const mid = shot.start.clone().lerp(shot.target, 0.45);
    mid.y += 0.45;
    const avg = this.scene.worldToScreen(mid);
    el.style.left = `${avg.x}px`;
    el.style.top = `${avg.y}px`;
    this.el.comboLayer.appendChild(el);
    this.comboLabels.push({ el, age: 0, life: 1 });
  }

  updateComboLabels(dt) {
    for (let i = this.comboLabels.length - 1; i >= 0; i--) {
      const L = this.comboLabels[i];
      L.age += dt;
      const t = L.age / L.life;
      L.el.style.opacity = String(Math.max(0, 1 - t));
      L.el.style.transform = `translate(-50%, -50%) translateY(${-t * 40}px) scale(${1 + t * 0.3})`;
      if (L.age >= L.life) {
        L.el.remove();
        this.comboLabels.splice(i, 1);
      }
    }
  }

  updateHud() {
    this.el.score.textContent = String(this.score);
    this.el.combo.textContent = String(this.combo);
    this.el.wordsCleared.textContent = String(this.wordsCleared);
    if (this.el.bosses) this.el.bosses.textContent = String(this.bossesDefeated);

    const m = this.el.multiplier;
    m.textContent = `×${this.multiplier}`;
    m.classList.remove("x2", "x3");
    if (this.multiplier === 2) m.classList.add("x2");
    if (this.multiplier === 3) m.classList.add("x3");

    // Remaining kills until boss
    if (this.el.waveTimer) {
      if (this.phase === "boss") {
        this.el.waveTimer.textContent = "BOSS";
        this.el.waveTimer.classList.add("critical");
        this.el.waveTimer.classList.remove("warning");
      } else {
        const left = Math.max(0, BOSS_EVERY - this.killsThisWave);
        this.el.waveTimer.textContent = String(left);
        this.el.waveTimer.classList.remove("critical");
        if (left <= 5) this.el.waveTimer.classList.add("warning");
        else this.el.waveTimer.classList.remove("warning");
      }
    }
  }

  updateSkyLabel() {
    if (!this.el.skyLabel) return;
    const map = { day: "白天", dusk: "黄昏", night: "黑夜" };
    const mode =
      this.scene.skyTransitioning && this.scene.skyTo
        ? this.scene.skyTo
        : this.scene.skyMode;
    this.el.skyLabel.textContent = map[mode] || mode;
  }

  showWarning() {
    this.el.warning.classList.remove("hidden");
  }

  hideWarning() {
    this.el.warning.classList.add("hidden");
  }

  showToast(text, type) {
    const t = this.el.toast;
    t.textContent = text;
    t.className = `toast ${type}`;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.hideToast(), 800);
  }

  hideToast() {
    this.el.toast.className = "toast hidden";
  }

  loop(ts) {
    const dt = Math.min(0.05, (ts - this.lastTs) / 1000 || 0);
    this.lastTs = ts;

    if (this.warningHideAt && ts >= this.warningHideAt) {
      this.hideWarning();
      this.warningHideAt = 0;
    }

    if (this.running && this.scene.skyTransitioning) {
      this.updateSkyLabel();
    }

    this.scene.update(dt);
    this.scene.draw();
    this.positionLabels();
    this.updateComboLabels(dt);

    requestAnimationFrame((t) => this.loop(t));
  }
}

function renderLetters(text, index, isQuote) {
  const chars = text.split("");
  return chars
    .map((ch, i) => {
      let cls = isQuote ? "ch" : "letter";
      if (i < index) cls += " hit";
      else if (i === index) cls += " next";
      if (ch === " ") return `<span class="${cls} space">&nbsp;</span>`;
      return `<span class="${cls}">${escapeHtml(ch)}</span>`;
    })
    .join("");
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function loadWords(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseCsv(await res.text());
}

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = splitCsvLine(line);
    const word = (parts[0] || "").trim().toLowerCase();
    if (!word || !/^[a-z]+$/.test(word)) continue;
    rows.push({
      word,
      category: (parts[1] || "").trim(),
      description: (parts[2] || "").trim(),
    });
  }
  return rows;
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (c === "," && !inQ) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function parsePosZh(description) {
  if (!description) return "";
  const raw = description.split(" - ")[0].trim().toLowerCase();
  if (raw.includes("thing")) return "名词";
  if (raw.includes("quality")) return "形容词";
  const map = {
    verb: "动词",
    preposition: "介词",
    conjunction: "连词",
    determiner: "限定词",
    pronoun: "代词",
    adverb: "副词",
    interjection: "感叹词",
    article: "冠词",
  };
  return map[raw] || "";
}

const FALLBACK_WORDS = [
  { word: "come", pos: "动词", zh: "来", description: "verb - come", category: "" },
  { word: "plane", pos: "名词", zh: "飞机", description: "thing - plane", category: "" },
  { word: "sky", pos: "名词", zh: "天空", description: "thing - sky", category: "" },
  { word: "light", pos: "名词", zh: "光", description: "thing - light", category: "" },
  { word: "fire", pos: "名词", zh: "火", description: "thing - fire", category: "" },
  { word: "strong", pos: "形容词", zh: "强壮的", description: "quality", category: "" },
];

const FALLBACK_QUOTES = [
  { text: "Knowledge is power.", author: "Francis Bacon" },
  { text: "Stay hungry, stay foolish.", author: "Steve Jobs" },
];

const game = new Game();
game.init();
