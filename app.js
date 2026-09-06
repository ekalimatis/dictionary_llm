(function () {
  "use strict";

  var WORDS = [];
  var wordsLoaded = false;
  var wordsError = "";

  function updateWordCounts() {
    $("#footCount").textContent = WORDS.length;
  }

  function loadWords() {
    return fetch("api/words")
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (list) {
        if (!Array.isArray(list)) throw new Error("data.json не является списком");
        list.forEach(function (w) { WORDS.push(w); });
      })
      .catch(function (err) {
        wordsError = "Не удалось загрузить словарь: " + (err && err.message ? err.message : err) +
          ". Запустите сервер: python server.py и откройте http://127.0.0.1:8000";
      })
      .then(function () {
        wordsLoaded = true;
        updateWordCounts();
        renderDict();
      });
  }

  function postWord(entry) {
    return fetch("api/words", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry: entry })
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) {
          var msg = data && data.error ? data.error : "HTTP " + r.status;
          throw new Error(msg);
        }
        return data.entry;
      });
    });
  }

  /* ============================ hidden words ============================ */

  var HIDDEN_KEY = "teHidden";

  function loadHiddenIds() {
    try {
      var a = JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]");
      return Array.isArray(a) ? a.map(String) : [];
    } catch (err) {
      return [];
    }
  }

  var hiddenIds = loadHiddenIds();

  function saveHiddenIds() {
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(hiddenIds));
    } catch (err) { /* ignore */ }
  }

  function isHiddenWord(w) {
    return hiddenIds.indexOf(String(w.id)) !== -1;
  }

  function toggleHiddenWord(w) {
    var key = String(w.id);
    var i = hiddenIds.indexOf(key);
    if (i === -1) hiddenIds.push(key);
    else hiddenIds.splice(i, 1);
    saveHiddenIds();
    renderDict();
  }

  function deleteWordFromSite(w) {
    var text = "Удалить слово \"" + w.lemma + "\"?\nЗапись исчезнет из data.json вместе с аудиофайлами. Это действие необратимо.";
    if (!window.confirm(text)) return;
    fetch("api/words/" + w.id, { method: "DELETE" })
      .then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok) throw new Error((d && d.error) || ("HTTP " + r.status));
          return d;
        });
      })
      .then(function () {
        var i = -1;
        for (var j = 0; j < WORDS.length; j++) {
          if (String(WORDS[j].id) === String(w.id)) { i = j; break; }
        }
        if (i !== -1) WORDS.splice(i, 1);
        delete openIds[w.id];
        var h = hiddenIds.indexOf(String(w.id));
        if (h !== -1) hiddenIds.splice(h, 1);
        saveHiddenIds();
        if (typeof stats !== "undefined" && stats) {
          delete stats[String(w.id)];
          saveStats();
        }
        updateWordCounts();
        renderDict();
      })
      .catch(function (err) {
        var msg = err && err.message ? err.message : String(err);
        window.alert("Не удалось удалить слово: " + msg);
      });
  }

  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };

  var normCache = {};
  function norm(s) {
    if (normCache[s] !== undefined) return normCache[s];
    var n = String(s || "").toLowerCase()
      .replace(/[\u2019\u2018\u201c\u201d']/g, " ")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    normCache[s] = n;
    return n;
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function firstTranslation(w) {
    var ts = w.translations;
    if (Array.isArray(ts) && ts.length) return ts[0];
    return null;
  }

  function primaryMeaning(w) {
    var t = firstTranslation(w);
    return t && t.meaning ? String(t.meaning) : "";
  }

  function allMeanings(w) {
    var out = [];
    (w.translations || []).forEach(function (t) {
      if (t && t.meaning) out.push(String(t.meaning));
      (t.additional_meanings || []).forEach(function (m) {
        if (m) out.push(String(m));
      });
    });
    return out;
  }

  function wordTranscription(w) {
    return w.transcription || "";
  }

  function wordPos(w) {
    return w.part_of_speech || "";
  }

  /* ============================ text-to-speech (fallback) ============================ */

  function enVoices() {
    if (!("speechSynthesis" in window)) return [];
    try {
      return (window.speechSynthesis.getVoices() || []).filter(function (v) {
        return /^en[-_]/i.test(v.lang || "");
      });
    } catch (err) {
      return [];
    }
  }

  function speak(text) {
    if (!("speechSynthesis" in window)) return;
    var run = function () {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = "en-GB";
      u.rate = 0.92;
      window.speechSynthesis.speak(u);
    };
    var list = enVoices();
    if (list.length) {
      run();
    } else if ("speechSynthesis" in window) {
      var done = false;
      var fire = function () {
        if (done) return;
        done = true;
        try { window.speechSynthesis.removeEventListener("voiceschanged", fire); } catch (err) { /* ignore */ }
        run();
      };
      try {
        window.speechSynthesis.addEventListener("voiceschanged", fire);
      } catch (err) {
        run();
      }
      setTimeout(fire, 1500);
    }
  }

  /* ============================ per-word stats ============================ */

  var STATS_KEY = "teStats";
  var stats = loadStats();

  function loadStats() {
    try {
      var raw = localStorage.getItem(STATS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      return {};
    }
  }

  function saveStats() {
    try {
      localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch (err) {
      /* localStorage may be unavailable; ignore */
    }
  }

  function wordStat(w) {
    return stats[String(w.id)] || null;
  }

  function ensureWordStat(w) {
    var key = String(w.id);
    if (!stats[key]) {
      stats[key] = { ok: 0, bad: 0, seen: 0 };
    }
    return stats[key];
  }

  function statCellHtml(w) {
    var s = wordStat(w) || { ok: 0, bad: 0 };
    var total = s.ok + s.bad;
    if (!total) {
      return "";
    }
    var pct = Math.round((s.ok / total) * 100);
    return (
      '<span class="w-stat" title="Верно: ' + s.ok + " · Неверно: " + s.bad + '">' +
      '<span class="stat-ok">' + s.ok + " ✓</span>/" + s.bad + " ✗ · <b>" + pct + "%</b>" +
      "</span>"
    );
  }

  function plural(n, one, few, many) {
    var m10 = n % 10;
    var m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  function dictStatLineHtml(w) {
    var s = wordStat(w) || { ok: 0, bad: 0 };
    var total = s.ok + s.bad;
    if (!total) {
      return "";
    }
    var pct = Math.round((s.ok / total) * 100);
    var grade = pct >= 80 ? "Выучено" : pct >= 50 ? "В процессе изучения" : "Нужно повторять";
    return (
      '<div class="dict-stat">' +
      '<span class="dstat-num">' + total + " " + plural(total, "ответ", "ответа", "ответов") + "</span> " +
      "<span class=\"dstat-seen\">Из них 'просмотрено' не учитывается</span> · " +
      "<b>" +
      '<span class="stat-ok">' + s.ok + " ✓</span> <span class=\"stat-bad\">" + s.bad + " ✗</span>" +
      "</b> · " + pct + "% (" + grade + ")" +
      "</div>"
    );
  }

  function updateStatsUi() {
    var all = $$("#dictList details.word");
    all.forEach(function (d) {
      var id = d.getAttribute("data-id");
      var w = WORDS.filter(function (x) { return String(x.id) === id; })[0];
      if (!w) return;
      var cell = d.querySelector(".w-stat-slot");
      if (cell) cell.innerHTML = statCellHtml(w);
      var line = d.querySelector(".dict-stat-slot");
      if (line) line.innerHTML = dictStatLineHtml(w);
    });
  }

  /* ============================ tabs ============================ */

  $$("#tabs .tab").forEach(function (btn) {
    btn.addEventListener("click", function () {
      showView(btn.getAttribute("data-view"));
    });
  });

  function showView(name) {
    $$("#tabs .tab").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-view") === name);
    });
    $$(".view").forEach(function (sec) {
      sec.classList.toggle("hidden", sec.id !== "view-" + name);
    });
    if (name === "add") {
      maybeLoadOllamaModels();
    }
  }

  /* ============================ dictionary ============================ */

  var dictList = $("#dictList");
  var dictSearch = $("#dictSearch");
  var dictCount = $("#dictCount");
  $("#footCount").textContent = WORDS.length;

  var haystackCache = [];
  function haystack(w) {
    if (haystackCache[w.id]) return haystackCache[w.id];
    var parts = [w.lemma, w.original_form || "", w.transcription || "", w.part_of_speech || ""];
    (w.translations || []).forEach(function (t) {
      if (!t) return;
      parts.push(t.context || "", t.meaning || "");
      (t.additional_meanings || []).forEach(function (m) { parts.push(m); });
    });
    (w.examples || []).forEach(function (e) { parts.push(e.example || "", e.translation || ""); });
    (w.phrases || []).forEach(function (p) { parts.push(p); });
    parts.push(w.notes || "");
    var h = norm(parts.join(" "));
    haystackCache[w.id] = h;
    return h;
  }

  var openIds = {};

  function additionalText(w) {
    var lines = [];
    var phrases = (w.phrases || []).map(function (p) { return escapeHtml(p); }).join(", ");
    if (phrases) {
      lines.push('<div class="add-group"><span class="grp-name">Фразы и сочетания:</span> <span class="add-value">' + phrases + "</span></div>");
    }
    if (w.notes) {
      lines.push('<div class="grp-note"><span class="grp-name">Примечание:</span> <span class="note-text">' + escapeHtml(w.notes) + "</span></div>");
    }
    return lines.join("");
  }

  function translationGroupsHtml(w) {
    var groups = (w.translations || []).map(function (t) {
      if (!t) return "";
      var line = "";
      if (t.context) {
        line += '<span class="grp-name">' + escapeHtml(t.context) + ":</span> ";
      }
      line += '<span class="tr-main">' + escapeHtml(t.meaning) + "</span>";
      var more = (t.additional_meanings || []).filter(Boolean).map(function (m) {
        return escapeHtml(m);
      });
      if (more.length) {
        line += '<span class="tr-more">, ' + more.join(", ") + "</span>";
      }
      return '<div class="tr-group">' + line + "</div>";
    }).join("");
    return groups + additionalText(w);
  }

  function wordCard(w) {
    var srcLine = w.original_form ? '<span class="w-src">(' + escapeHtml(w.original_form) + ')</span>' : "";
    var hidden = isHiddenWord(w);
    var badge = hidden ? '<span class="w-badge">исключено</span>' : "";
    var examples = (w.examples || []).map(function (e, i) {
      return '<li><div class="ex-en"><button class="speak" type="button" data-idx="' + i + '" data-src="' + escapeHtml(e.example) + '" title="Произнести">\uD83D\uDD0A</button><span>' + escapeHtml(e.example) + "</span></div><div class=\"ex-ru\">" + escapeHtml(e.translation) + "</div></li>";
    }).join("");
    return (
      '<details class="word"' + (openIds[w.id] ? " open" : "") + " data-id=\"" + w.id + '">' +
      "<summary><span class=\"num\">" + w.id + "</span>" +
      '<span class="w-lemma">' + escapeHtml(w.lemma) + "</span>" + srcLine +
      '<span class="w-ru-prev">' + escapeHtml(primaryMeaning(w)) + "</span>" +
      (wordPos(w) ? '<span class="w-pos">' + escapeHtml(wordPos(w)) + "</span>" : "") +
      badge +
      '<button class="speak" type="button" data-src="' + escapeHtml(w.lemma) + '" title="Произнести">\uD83D\uDD0A</button>' +
      '<span class="w-ipa">' + escapeHtml(wordTranscription(w)) + "</span>" +
      '<span class="w-stat-slot">' + statCellHtml(w) + "</span>" +
      '<button class="act-btn icon" type="button" data-act="toggle" title="' + (hidden ? "Вернуть в тренировки" : "Исключить из повторения и тестов") + '">' + (hidden ? "\uD83D\uDC41\uFE0F" : "\uD83D\uDEAB") + "</button>" +
      '<button class="act-btn icon danger" type="button" data-act="del" title="Удалить слово">\uD83D\uDDD1\uFE0F</button>' +
      "</summary>" +
      '<div class="w-body">' + translationGroupsHtml(w) +
      '<div class="dict-stat-slot">' + dictStatLineHtml(w) + "</div>" +
      '<ol class="examples">' + examples + "</ol></div>" +
      "</details>"
    );
  }

  function renderDict() {
    if (!wordsLoaded) {
      dictCount.textContent = "";
      dictList.innerHTML = '<div class="empty">Загрузка словаря…</div>';
      return;
    }
    if (wordsError) {
      dictCount.textContent = "";
      dictList.innerHTML = '<div class="empty" style="color: var(--bad)">' + escapeHtml(wordsError) + "</div>";
      return;
    }
    var q = norm(dictSearch.value);
    var list, count;
    if (!q) {
      list = WORDS;
      count = WORDS.length;
    } else {
      var tokens = q.split(" ");
      list = WORDS.filter(function (w) {
        var h = haystack(w);
        return tokens.every(function (t) { return h.indexOf(t) !== -1; });
      });
      count = list.length;
    }
    dictCount.textContent = count + " / " + WORDS.length;
    if (!list.length) {
      dictList.innerHTML = '<div class="empty">Ничего не найдено</div>';
      return;
    }
    dictList.innerHTML = list.map(wordCard).join("");
  }

  dictSearch.addEventListener("input", renderDict);

  function wordById(id) {
    for (var i = 0; i < WORDS.length; i++) {
      if (String(WORDS[i].id) === String(id)) return WORDS[i];
    }
    return null;
  }

  function playWordAudio(w, fallbackText, missingCb) {
    if (!w || !w.audio) return false;
    return playAudioUrl(w.audio, fallbackText, missingCb);
  }

  function playAudioUrl(path, fallbackText, missingCb) {
    if (!path) return false;
    try {
      var a = new Audio(path);
      var fired = false;
      var fail = function () {
        if (fired) return;
        fired = true;
        if (fallbackText) speak(fallbackText);
        if (missingCb) missingCb();
      };
      a.addEventListener("error", fail);
      var p = a.play();
      if (p && p.catch) p.catch(fail);
      return true;
    } catch (err) {
      if (fallbackText) speak(fallbackText);
      if (missingCb) missingCb();
      return false;
    }
  }

  var lemmaAudioInflight = {};

  function ensureLemmaAudio(w, force) {
    if (!w || (!force && w.audio)) return;
    var key = String(w.id);
    if (lemmaAudioInflight[key]) return;
    lemmaAudioInflight[key] = true;
    fetch("api/audio/lemma", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: w.id })
    })
      .then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok) throw new Error((d && d.error) || ("HTTP " + r.status));
          return d;
        });
      })
      .then(function (d) {
        lemmaAudioInflight[key] = false;
        if (d && d.path) w.audio = d.path;
      })
      .catch(function () {
        lemmaAudioInflight[key] = false;
      });
  }

  function playLemmaAudio(w) {
    if (!w) return;
    if (w.audio) {
      playAudioUrl(w.audio, w.lemma, function () { ensureLemmaAudio(w, true); });
      return;
    }
    speak(w.lemma);
    ensureLemmaAudio(w);
  }

  var exampleGenInFlight = {};

  function speakWordExample(w, idx, text) {
    if (!w || !w.examples || !w.examples[idx]) {
      speak(text);
      return;
    }
    var ex = w.examples[idx];
    if (ex.audio) {
      playAudioUrl(ex.audio, text);
      return;
    }
    var key = w.id + "_" + idx;
    if (exampleGenInFlight[key]) return;
    exampleGenInFlight[key] = true;
    fetch("api/audio/example", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: w.id, index: idx })
    })
      .then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok) throw new Error((d && d.error) || ("HTTP " + r.status));
          return d;
        });
      })
      .then(function (d) {
        exampleGenInFlight[key] = false;
        if (d && d.path) {
          ex.audio = d.path;
          playAudioUrl(d.path, text);
        } else {
          speak(text);
        }
      })
      .catch(function () {
        exampleGenInFlight[key] = false;
        speak(text);
      });
  }

  dictList.addEventListener("click", function (ev) {
    var sp = ev.target.closest(".speak");
    if (sp) {
      ev.preventDefault();
      ev.stopPropagation();
      var text = sp.getAttribute("data-src");
      var det = ev.target.closest("details.word");
      var inSummary = !!sp.closest("summary");
      var idx = parseInt(sp.getAttribute("data-idx"), 10);
      if (inSummary && det) {
        var w = wordById(det.getAttribute("data-id"));
        if (w) {
          playLemmaAudio(w);
          return;
        }
      } else if (det && !isNaN(idx)) {
        var w2 = wordById(det.getAttribute("data-id"));
        if (w2) {
          speakWordExample(w2, idx, text);
          return;
        }
      }
      speak(text);
      return;
    }
    var act = ev.target.closest(".act-btn");
    if (act) {
      ev.preventDefault();
      ev.stopPropagation();
      var cardEl = ev.target.closest("details.word");
      var wAction = cardEl ? wordById(cardEl.getAttribute("data-id")) : null;
      if (wAction) {
        if (act.getAttribute("data-act") === "del") {
          deleteWordFromSite(wAction);
        } else {
          toggleHiddenWord(wAction);
        }
      }
      return;
    }
    var det = ev.target.closest("details.word");
    if (det) {
      openIds[det.getAttribute("data-id")] = det.open;
    }
  });

  renderDict();

  /* ============================ test ============================ */

  var elSetup = $("#testSetup");
  var elQuiz = $("#testQuiz");
  var elResult = $("#testResult");
  var quizBody = $("#quizBody");
  var quizProgress = $("#quizProgress");
  var quizFill = $("#quizFill");

  var state = {
    questions: [],
    index: 0,
    answered: false,
    records: [],
    last: { type: "choice", dir: "en-ru" }
  };

  var LETTERS = ["A", "B", "C", "D"];

  function typeHint() {
    var type = document.querySelector('input[name="testType"]:checked').value;
    var dir = document.querySelector('input[name="testDir"]:checked').value;
    var hint = $("#typeHint");
    if (type === "input") {
      hint.textContent = dir === "en-ru"
        ? "Показано английское слово — впиши его перевод с клавиатуры."
        : "Показан русский перевод — впиши английское слово с клавиатуры.";
    } else {
      hint.textContent = dir === "en-ru"
        ? "Показано слово и 4 варианта перевода — выбери правильный."
        : "Показан перевод и 4 английских слова — выбери правильное.";
    }
  }

  $$('input[name="testType"], input[name="testDir"]').forEach(function (r) {
    r.addEventListener("change", typeHint);
  });

  function pickDistractors(count, avoidText, getText) {
    var pool = shuffle(WORDS);
    var out = [];
    for (var i = 0; i < pool.length && out.length < count; i++) {
      if (isHiddenWord(pool[i])) continue;
      var t = getText(pool[i]);
      if (norm(t) !== norm(avoidText) && out.indexOf(t) === -1) out.push(t);
    }
    return out;
  }

  function buildQuestions(words, type, dir) {
    return words.map(function (w) {
      if (type === "choice") {
        var opts, correct, distract;
        if (dir === "en-ru") {
          correct = primaryMeaning(w) || w.lemma;
          distract = pickDistractors(3, correct, function (x) { return primaryMeaning(x) || x.lemma; });
        } else {
          correct = w.lemma;
          distract = pickDistractors(3, correct, function (x) { return x.lemma; });
        }
        opts = shuffle(distract.concat([correct]));
        return { w: w, kind: "choice", dir: dir, opts: opts, correctIdx: opts.indexOf(correct) };
      }
      if (dir === "en-ru") {
        return { w: w, kind: "input", dir: dir, expectMeanings: allMeanings(w) };
      }
      return { w: w, kind: "input", dir: dir, expectForms: [w.lemma].concat(w.original_form ? [w.original_form] : []) };
    });
  }

  function startTest(words) {
    if (!words.length) return;
    state.questions = buildQuestions(words, state.last.type, state.last.dir);
    state.index = 0;
    state.records = [];
    state.answered = false;
    elSetup.classList.add("hidden");
    elResult.classList.add("hidden");
    elQuiz.classList.remove("hidden");
    renderQuestion();
  }

  $("#btnStart").addEventListener("click", function () {
    var type = document.querySelector('input[name="testType"]:checked').value;
    var dir = document.querySelector('input[name="testDir"]:checked').value;
    var size = document.querySelector('input[name="testSize"]:checked').value;
    state.last.type = type;
    state.last.dir = dir;
    var visible = shuffle(WORDS.filter(function (w) { return !isHiddenWord(w); }));
    var pool = size === "all" ? visible : visible.slice(0, parseInt(size, 10));
    if (!pool.length) {
      window.alert("Нет доступных слов: все слова исключены из тренировок.");
      return;
    }
    startTest(pool);
  });

  $("#btnNewTest").addEventListener("click", function () {
    elQuiz.classList.add("hidden");
    elResult.classList.add("hidden");
    elSetup.classList.remove("hidden");
  });

  $("#btnRetryWrong").addEventListener("click", function () {
    var seen = {};
    var wrong = state.records
      .filter(function (r) { return !r.ok && !seen[r.w.id]; })
      .map(function (r) { seen[r.w.id] = true; return r.w; });
    startTest(wrong);
  });

  function nextQuestion() {
    if (state.index + 1 >= state.questions.length) {
      showResult();
      return;
    }
    state.index++;
    state.answered = false;
    renderQuestion();
  }

  function renderQuestion() {
    var q = state.questions[state.index];
    var total = state.questions.length;
    var n = state.index + 1;
    quizProgress.textContent = "Вопрос " + n + " из " + total;
    quizFill.style.width = Math.round((n / total) * 100) + "%";

    var html = "";
    if (q.kind === "choice") {
      var prompt, label;
      if (q.dir === "en-ru") {
        prompt = '<span class="q-prompt">' + escapeHtml(q.w.lemma) + ' <span class="q-ipa">' + escapeHtml(wordTranscription(q.w)) + "</span></span>";
        label = "Что означает это слово?";
      } else {
        prompt = '<span class="q-prompt">' + escapeHtml(primaryMeaning(q.w)) + "</span>";
        label = "Какое английское слово соответствует переводу?";
      }
      html =
        prompt +
        '<div class="q-label">' + label + "</div>" +
        '<div class="opts">' +
        q.opts.map(function (o, i) {
          return '<button class="opt" type="button" data-idx="' + i + '"><b>' + LETTERS[i] + ".</b> " + escapeHtml(o) + "</button>";
        }).join("") +
        "</div>" +
        '<div class="fb"></div>' +
        '<div class="quiz-actions"><button id="btnNext" class="btn primary" disabled>Дальше</button></div>';
    } else {
      var p2, ph2, lbl2;
      if (q.dir === "en-ru") {
        p2 = escapeHtml(q.w.lemma) + ' <span class="q-ipa">' + escapeHtml(wordTranscription(q.w)) + "</span>";
        lbl2 = "Напиши перевод:";
        ph2 = "перевод…";
      } else {
        p2 = escapeHtml(primaryMeaning(q.w));
        lbl2 = "Напиши слово по-английски:";
        ph2 = "английское слово…";
      }
      html =
        '<span class="q-prompt">' + p2 + "</span>" +
        '<div class="q-label">' + lbl2 + "</div>" +
        '<form id="answerForm" class="answer-form" autocomplete="off">' +
        '<input type="text" id="answerInput" class="input" placeholder="' + ph2 + '" spellcheck="false" autofocus>' +
        '<button type="submit" class="btn primary">Ответить</button>' +
        "</form>" +
        '<div class="fb"></div>' +
        '<div class="quiz-actions"><button id="btnNext" class="btn primary" disabled>Дальше</button></div>';
    }

    quizBody.innerHTML = html;

    var btnNext = $("#btnNext", quizBody);
    btnNext.addEventListener("click", nextQuestion);

    var qEl = q;
    if (qEl.kind === "choice") {
      $$(".opt", quizBody).forEach(function (btn) {
        btn.addEventListener("click", function () { answerChoice(qEl, parseInt(btn.getAttribute("data-idx"), 10)); });
      });
    } else {
      $("#answerForm", quizBody).addEventListener("submit", function (ev) {
        ev.preventDefault();
        var input = $("#answerInput", quizBody);
        if (!state.answered && norm(input.value)) answerInput(qEl, input.value);
      });
    }
  }

  function record(q, user, ok, correctText) {
    state.records.push({
      w: q.w,
      qText: q.dir === "en-ru" ? q.w.lemma : primaryMeaning(q.w),
      dir: q.dir,
      user: user,
      ok: ok,
      correct: correctText
    });
    var s = ensureWordStat(q.w);
    s.ok += ok ? 1 : 0;
    s.bad += ok ? 0 : 1;
    s.seen += 1;
    saveStats();
    updateStatsUi();
  }

  function answerChoice(q, idx) {
    if (state.answered) return;
    state.answered = true;
    var ok = idx === q.correctIdx;
    var user = q.opts[idx];
    var correctText = q.dir === "en-ru" ? q.opts[q.correctIdx] : q.w.lemma + " " + (wordTranscription(q.w) || "");
    record(q, user, ok, correctText);

    $$(".opt", quizBody).forEach(function (btn, i) {
      btn.disabled = true;
      var el = btn;
      if (i === q.correctIdx) el.classList.add("ok");
      else if (i === idx) el.classList.add("bad");
      else el.classList.add("dim");
    });

    var fb = $(".fb", quizBody);
    fb.textContent = ok ? "\u2713 Верно!" : "\u2717 Неверно. Правильно: " + correctText;
    fb.className = "fb " + (ok ? "ok" : "bad");

    $("#btnNext", quizBody).disabled = false;
    if (state.index + 1 >= state.questions.length) {
      $("#btnNext", quizBody).textContent = "Показать результат";
    }
  }

  function answerInput(q, value) {
    if (state.answered) return;
    state.answered = true;
    var nv = norm(value);
    var ok, correctText;
    if (q.dir === "en-ru") {
      var set = {};
      (q.expectMeanings || []).forEach(function (m) { set[norm(m)] = true; });
      ok = !!set[nv];
      correctText = (q.expectMeanings || []).join(" / ");
    } else {
      var forms = q.expectForms.map(norm);
      ok = forms.indexOf(nv) !== -1;
      correctText = q.w.lemma + (wordTranscription(q.w) ? "  " + wordTranscription(q.w) : "");
    }
    record(q, value, ok, correctText);

    var input = $("#answerInput", quizBody);
    input.readOnly = true;
    var fb = $(".fb", quizBody);
    fb.textContent = ok ? "\u2713 Верно!" : "\u2717 Неверно. Правильно: " + correctText;
    fb.className = "fb " + (ok ? "ok" : "bad");

    $("#btnNext", quizBody).disabled = false;
    if (state.index + 1 >= state.questions.length) {
      $("#btnNext", quizBody).textContent = "Показать результат";
    }
  }

  function showResult() {
    elQuiz.classList.add("hidden");
    elResult.classList.remove("hidden");
    var total = state.questions.length;
    var correct = state.records.filter(function (r) { return r.ok; }).length;
    var pct = Math.round((correct / total) * 100);
    var score = $("#resultScore");
    score.innerHTML =
      '<div class="score-big">' + correct + " / " + total + "</div>" +
      '<div class="muted">Верно: <span class="good-text">' + pct + "%</span> · " +
      (pct >= 80 ? "Отлично!" : pct >= 50 ? "Неплохо, повтори сложные слова." : "Стоит повторить слова ещё раз.") +
      "</div>";

    var mistakes = state.records.filter(function (r) { return !r.ok; });
    var wrap = $("#resultMistakes");
    if (!mistakes.length) {
      wrap.innerHTML = '<div class="panel" style="box-shadow:none"><b>Все ответы верные.</b> Отличная работа!</div>';
    } else {
      wrap.innerHTML = "<h2>Разбор ошибок</h2>" +
        mistakes.map(function (r) {
          return '<div class="mistake">' +
            '<div class="row1">' + escapeHtml(r.w.lemma) + ' <span class="small">' + escapeHtml(wordTranscription(r.w)) + " · " + escapeHtml(wordPos(r.w)) + "</span></div>" +
            '<div class="row2">Ты ответил: ' + escapeHtml(r.user) + "</div>" +
            '<div class="row3">Правильно: ' + escapeHtml(r.correct) + "</div>" +
            "</div>";
        }).join("");
    }
    $("#btnRetryWrong").style.display = mistakes.length ? "" : "none";
  }

  /* ============================ repeat (flashcards) ============================ */

  var repState = { list: [], index: 0, revealed: false, curAudio: null };

  function repSetStatus(text, type) { setStatus($("#repStartStatus"), text, type); }

  function sampleRepeatList() {
    var size = parseInt(document.querySelector('input[name="repSize"]:checked').value, 10) || 10;
    var visible = shuffle(WORDS.filter(function (w) { return !isHiddenWord(w); }));
    return visible.slice(0, Math.min(size, visible.length));
  }

  function startRepeat(wordsList) {
    repState.list = wordsList.slice();
    repState.index = 0;
    repState.revealed = document.querySelector('input[name="repShow"]:checked').value === "shown";
    $("#repSetup").classList.add("hidden");
    $("#repResult").classList.add("hidden");
    $("#repActive").classList.remove("hidden");
    renderRepeatCard();
  }

  function translationBlockHtml(w) {
    return translationGroupsHtml(w);
  }

  function repExamplesHtml(w) {
    var list = (w.examples || []).map(function (e, i) {
      return '<li><div class="ex-en"><button class="speak" type="button" data-idx="' + i + '" data-src="' + escapeHtml(e.example) + '" title="Произнести">\uD83D\uDD0A</button><span>' + escapeHtml(e.example) + "</span></div><div class=\"ex-ru\">" + escapeHtml(e.translation) + "</div></li>";
    }).join("");
    return list
      ? '<div class="rep-block"><span class="w-block-label">Примеры</span><ol class="examples">' + list + "</ol></div>"
      : "";
  }

  function renderRepeatCard() {
    var total = repState.list.length;
    var w = repState.list[repState.index];
    var n = repState.index + 1;
    $("#repProgress").textContent = "Слово " + n + " из " + total;
    $("#repFill").style.width = Math.round((n / total) * 100) + "%";
    $("#repLemma").innerHTML = escapeHtml(w.lemma) +
      (w.original_form && w.original_form !== w.lemma ? ' <span class="w-src">(' + escapeHtml(w.original_form) + ")</span>" : "");
    var meta = wordTranscription(w) ? escapeHtml(wordTranscription(w)) : "";
    if (wordPos(w)) meta += (meta ? " · " : "") + escapeHtml(wordPos(w));
    $("#repMeta").innerHTML = meta;
    $("#repMeaning").innerHTML = translationBlockHtml(w);
    $("#repExamples").innerHTML = repExamplesHtml(w);
    repState.revealed = document.querySelector('input[name="repShow"]:checked').value === "shown";
    $("#repMeaning").classList.toggle("hidden", !repState.revealed);
    $("#repReveal").textContent = repState.revealed ? "Скрыть перевод" : "Показать перевод";
    $("#repNext").textContent = n >= total ? "Завершить" : "Дальше";
    playRepeatAudio(w);
  }

  function playRepeatAudio(w) {
    try {
      if (repState.curAudio) { repState.curAudio.pause(); }
    } catch (err) { /* ignore */ }
    repState.curAudio = null;
    if (!w) return;
    if (w.audio) {
      try {
        var a = new Audio(w.audio);
        repState.curAudio = a;
        var p = a.play();
        var fired = false;
        var fail = function () {
          if (fired) return;
          fired = true;
          speak(w.lemma);
          ensureLemmaAudio(w, true);
        };
        a.addEventListener("error", fail);
        if (p && p.catch) p.catch(fail);
      } catch (err) {
        speak(w.lemma);
        ensureLemmaAudio(w, true);
      }
      return;
    }
    speak(w.lemma);
    ensureLemmaAudio(w);
  }

  $("#btnRepStart").addEventListener("click", function () {
    if (!wordsLoaded || !WORDS.length) {
      repSetStatus("Словарь ещё не загружен. Попробуйте ещё раз через секунду.", "err");
      return;
    }
    if (!WORDS.some(function (w) { return !isHiddenWord(w); })) {
      repSetStatus("Все слова исключены из тренировок. Верните хотя бы одно в словаре.", "err");
      return;
    }
    repSetStatus("");
    startRepeat(sampleRepeatList());
  });

  $("#repPlay").addEventListener("click", function () {
    if (repState.list[repState.index]) playRepeatAudio(repState.list[repState.index]);
  });

  $("#repReveal").addEventListener("click", function () {
    repState.revealed = !repState.revealed;
    $("#repMeaning").classList.toggle("hidden", !repState.revealed);
    $("#repReveal").textContent = repState.revealed ? "Скрыть перевод" : "Показать перевод";
  });

  $("#repExamples").addEventListener("click", function (ev) {
    var sp = ev.target.closest(".speak");
    if (sp) {
      ev.stopPropagation();
      var idx = parseInt(sp.getAttribute("data-idx"), 10);
      var w = repState.list[repState.index];
      if (w && !isNaN(idx)) {
        speakWordExample(w, idx, sp.getAttribute("data-src"));
      } else {
        speak(sp.getAttribute("data-src"));
      }
    }
  });

  $("#repNext").addEventListener("click", function () {
    if (repState.index + 1 >= repState.list.length) {
      showRepeatResult();
      return;
    }
    repState.index++;
    renderRepeatCard();
  });

  function showRepeatResult() {
    $("#repActive").classList.add("hidden");
    $("#repResult").classList.remove("hidden");
    $("#repDoneTitle").textContent = "Повторение завершено — " + repState.list.length + " слов.";
    $("#repDoneList").innerHTML = repState.list.map(function (w, i) {
      return '<div class="mistake"><div class="row1">' + (i + 1) + ". " + escapeHtml(w.lemma) +
        ' <span class="small">' + escapeHtml(wordTranscription(w)) + "</span></div>" +
        '<div class="row3">' + escapeHtml(primaryMeaning(w)) + "</div></div>";
    }).join("");
  }

  $("#btnRepAgain").addEventListener("click", function () {
    startRepeat(shuffle(repState.list));
  });

  $("#btnRepNew").addEventListener("click", function () {
    $("#repResult").classList.add("hidden");
    $("#repSetup").classList.remove("hidden");
  });

  /* ============================ add word (Ollama) ============================ */

  var OLL_SETTINGS_KEY = "teOllSettings";
  var ollLoaded = false;
  var ollModelsCache = [];

  var OLL_LOG_KEY = "teOllLog";
  var ollLog = loadOllLog();

  function loadOllLog() {
    try {
      var a = JSON.parse(localStorage.getItem(OLL_LOG_KEY) || "[]");
      return Array.isArray(a) ? a : [];
    } catch (err) {
      return [];
    }
  }

  function saveOllLog() {
    try {
      localStorage.setItem(OLL_LOG_KEY, JSON.stringify(ollLog));
    } catch (err) {
      /* ignore */
    }
  }

  function fmtTime(iso) {
    try {
      return new Date(iso).toLocaleString("ru-RU", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"
      });
    } catch (err) {
      return String(iso || "");
    }
  }

  function addOllLog(entry) {
    ollLog.unshift({
      ts: new Date().toISOString(),
      kind: entry.kind || "request",
      url: entry.url || "",
      model: entry.model || "",
      word: entry.word || "",
      status: entry.status || "ok",
      message: entry.message || "",
      request: entry.request || "",
      response: entry.response || ""
    });
    if (ollLog.length > 200) ollLog.length = 200;
    saveOllLog();
    renderOllLog();
  }

  function clearOllLog() {
    ollLog = [];
    saveOllLog();
    renderOllLog();
  }

  var KIND_LABELS = { tags: "Список моделей", version: "Проверка соединения", generate: "Генерация слова" };

  function renderOllLog() {
    var list = $("#ollLogList");
    var panel = $("#ollLogPanel");
    if (!list) return;
    panel.classList.toggle("hidden", !ollLog.length);
    if (!ollLog.length) {
      list.innerHTML = '<div class="empty">Логов пока нет.</div>';
      return;
    }
    list.innerHTML = ollLog.map(function (e) {
      var meta = "<span class=\"log-time\">" + escapeHtml(fmtTime(e.ts)) + "</span>" +
        '<span class="log-kind">' + escapeHtml(KIND_LABELS[e.kind] || e.kind) + "</span>" +
        (e.model ? '<span class="log-model">' + escapeHtml(e.model) + "</span>" : "") +
        (e.word ? '<span class="log-word">' + escapeHtml(e.word) + "</span>" : "") +
        '<span class="log-status ' + (e.status === "ok" ? "ok" : "bad") + '">' + (e.status === "ok" ? "OK" : "Ошибка") + "</span>";
      var msgBlock = e.message
        ? '<div class="log-part"><div class="log-label">Ошибка</div><pre class="log-msg">' + escapeHtml(e.message) + "</pre></div>"
        : "";
      return (
        '<details class="log-item"><summary>' + meta + "</summary>" +
        msgBlock +
        '<div class="log-part"><div class="log-label">Запрос</div><pre>' + escapeHtml(e.request) + "</pre></div>" +
        '<div class="log-part"><div class="log-label">Ответ</div><pre>' + escapeHtml(e.response) + "</pre></div>" +
        "</details>"
      );
    }).join("");
  }

  function logFetch(url, opts, meta) {
    opts = opts || {};
    meta = meta || {};
    var requestText =
      "URL: " + url + "\n" +
      "Метод: " + (opts.method || "GET") + "\n" +
      "Заголовки: " + JSON.stringify(opts.headers || {}) + "\n" +
      "Тело запроса: " + (opts.body || "(пусто)");
    var ctrl = null;
    var timer = null;
    if (meta.timeoutMs && "AbortController" in window) {
      ctrl = new AbortController();
      opts.signal = ctrl.signal;
      timer = setTimeout(function () {
        try { ctrl.abort(); } catch (err) { /* ignore */ }
      }, meta.timeoutMs);
    }
    var clearTimer = function () {
      if (timer) { clearTimeout(timer); timer = null; }
    };
    return fetch(url, opts)
      .then(function (r) {
        return r.text().then(function (text) {
          var responseText =
            "Статус: " + r.status + (r.statusText ? " " + r.statusText : "") + "\n" +
            "Content-Type: " + (r.headers.get("content-type") || "—") + "\n" +
            "Тело ответа:\n" + text;
          var parsed = null;
          try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
          var error = null;
          if (parsed && parsed.error) {
            error = "Ollama: " + parsed.error;
          } else if (!parsed) {
            error = "Сервер по адресу " + url + " вернул не JSON (" + (r.headers.get("content-type") || "без Content-Type") + "). Похоже, это не API Ollama, а веб-страница. Проверьте URL и порт.";
          } else if (!r.ok) {
            error = "HTTP " + r.status + " от " + url + ": " + JSON.stringify(parsed).slice(0, 150);
          }
          var inspectMsg = null;
          if (!error && meta.inspect) {
            try { inspectMsg = meta.inspect(parsed) || null; } catch (e) { inspectMsg = String((e && e.message) || e); }
          }
          addOllLog({
            kind: meta.kind || "request",
            url: url,
            model: meta.model || "",
            word: meta.word || "",
            status: (error || inspectMsg) ? "error" : "ok",
            message: error || inspectMsg || "",
            request: requestText,
            response: responseText
          });
          if (error) throw new Error(error);
          return parsed;
        });
      })
      .then(function (parsed) {
        clearTimer();
        return parsed;
      }, function (err) {
        clearTimer();
        if (ctrl && ctrl.signal && ctrl.signal.aborted) {
          throw new Error("Ollama не ответила за " + Math.round((meta.timeoutMs || 0) / 1000) +
            " с. Возможно, модель долго грузится или не хватает ресурсов: уменьшите num_ctx (например 2048), выберите модель поменьше и перезапустите Ollama (ollama stop; ollama serve).");
        }
        throw err;
      });
  }

  function ollBaseUrl() {
    return $("#ollUrl").value.trim().replace(/\/+$/, "");
  }

  var DEFAULT_SYSTEM_PROMPT =
    "Ты — помощник по изучению технического английского (IT-контекст). Пользователь пришлёт слово или фразу " +
    "в любой грамматической форме (например buyers, meant, getting to grips with). Верни СТРОГО один JSON-объект " +
    "без markdown-разметки и комментариев со следующей структурой: " +
    "{ lemma, original_form, transcription, part_of_speech, translations: [{ context, meaning, additional_meanings }], " +
    "examples: [{ example, translation }], phrases: [], notes }. " +
    "Правила: lemma — начальная форма (buyers → buyer, meant → mean); original_form — форма, которую прислал пользователь, " +
    "если она отличается от леммы (иначе поле опускай); transcription — IPA-транскрипция в // (британский или американский вариант); " +
    "part_of_speech — часть речи по-русски (глагол, существительное, прилагательное, фразовый глагол и т.д.); " +
    "translations — группами: обязательное поле meaning, необязательные context (подобласть IT: ML, безопасность, архитектура и т.п.) " +
    "и additional_meanings (дополнительные значения). Каждое отдельное значение клади отдельным элементом массива — не склеивай несколько значений " +
    "в meaning через ';' или ','; examples — ровно 2 примера { example, translation }, показывающих слово " +
    "в разных грамматических формах в технических текстах; phrases — устойчивые выражения и коллокации, если есть; " +
    "notes — краткие замечания (синонимы, антонимы, особенности использования).";

  var OLL_DEFAULTS = {
    url: "http://127.0.0.1:11434",
    model: "llama3.1",
    modelOllama: "llama3.1",
    modelOpenai: "openai/gpt-4o-mini",
    provider: "ollama",
    temperature: 0.2,
    topP: 0.9,
    numCtx: 4096,
    systemPrompt: DEFAULT_SYSTEM_PROMPT
  };

  function toNum(v, def) {
    var n = parseFloat(String(v == null ? "" : v).replace(",", "."));
    return isFinite(n) ? n : def;
  }

  function toInt(v, def) {
    var n = Math.round(toNum(v, def));
    return isFinite(n) ? n : def;
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function ollSettings() {
    try {
      var raw = localStorage.getItem(OLL_SETTINGS_KEY);
      if (!raw) return OLL_DEFAULTS;
      var o = JSON.parse(raw);
      var modelOllama = (o.modelOllama || o.model || OLL_DEFAULTS.modelOllama).trim();
      var modelOpenai = (o.modelOpenai || OLL_DEFAULTS.modelOpenai).trim();
      return {
        url: (o.url || OLL_DEFAULTS.url).trim().replace(/\/+$/, ""),
        model: modelOllama,
        modelOllama: modelOllama,
        modelOpenai: modelOpenai,
        provider: o.provider === "openai" ? "openai" : "ollama",
        temperature: clamp(toNum(o.temperature, OLL_DEFAULTS.temperature), 0, 2),
        topP: clamp(toNum(o.topP, OLL_DEFAULTS.topP), 0, 1),
        numCtx: Math.max(256, toInt(o.numCtx, OLL_DEFAULTS.numCtx)),
        systemPrompt: typeof o.systemPrompt === "string" && o.systemPrompt.trim() ? o.systemPrompt : DEFAULT_SYSTEM_PROMPT
      };
    } catch (err) {
      return OLL_DEFAULTS;
    }
  }

  function fieldVal(id, fallback) {
    var el = $("#" + id);
    return el && el.value ? String(el.value).trim() : fallback;
  }

  function currentProvider() {
    var r = document.querySelector('input[name="genProvider"]:checked');
    return r && r.value === "openai" ? "openai" : "ollama";
  }

  function liveSettings() {
    var s = ollSettings();
    var sp = fieldVal("ollSystem", s.systemPrompt);
    var isOpenai = currentProvider() === "openai";
    return {
      url: fieldVal("ollUrl", s.url).replace(/\/+$/, ""),
      model: fieldVal("ollModel", isOpenai ? s.modelOpenai : s.modelOllama),
      provider: isOpenai ? "openai" : "ollama",
      temperature: clamp(toNum(fieldVal("ollTemp", String(s.temperature)), s.temperature), 0, 2),
      topP: clamp(toNum(fieldVal("ollTopP", String(s.topP)), s.topP), 0, 1),
      numCtx: Math.max(256, toInt(fieldVal("ollNumCtx", String(s.numCtx)), s.numCtx)),
      systemPrompt: sp || DEFAULT_SYSTEM_PROMPT
    };
  }

  function updateProviderUi() {
    var isOpenai = currentProvider() === "openai";
    var url = $("#ollUrl");
    if (url) url.disabled = isOpenai;
    var urlDesc = $("#ollUrlDesc");
    if (urlDesc) {
      urlDesc.textContent = isOpenai
        ? "Для OpenAI-провайдера используется базовый адрес сервера (https://routerai.ru/api/v1) — поле не используется."
        : "Адрес API Ollama (порт по умолчанию 11434). Нужен именно API, а не веб-интерфейс. Если Ollama в Docker или на другом компьютере — укажите её адрес здесь.";
    }
    var modelDesc = $("#ollModelDesc");
    if (modelDesc) {
      modelDesc.innerHTML = isOpenai
        ? "Название модели OpenAI-провайдера (например gpt-4o-mini или openai/<модель>). Список доступных можно подгрузить кнопкой «Проверить подключение»."
        : 'Название установленной модели (см. <code>ollama list</code>). Нажмите ▾, чтобы выбрать из полного списка; можно ввести название вручную.';
    }
    if (isOpenai) closeModelList();
  }

  function applySettingsToInputs() {
    var s = ollSettings();
    $("#ollUrl").value = s.url;
    $("#ollModel").value = s.provider === "openai" ? s.modelOpenai : s.modelOllama;
    var radio = document.querySelector('input[name="genProvider"][value="' + s.provider + '"]');
    if (radio) radio.checked = true;
    $("#ollTemp").value = s.temperature;
    $("#ollTopP").value = s.topP;
    $("#ollNumCtx").value = s.numCtx;
    $("#ollSystem").value = s.systemPrompt;
    updateProviderUi();
  }

  function saveOllSettings() {
    var live = liveSettings();
    var prev = ollSettings();
    var modelOllama = prev.modelOllama;
    var modelOpenai = prev.modelOpenai;
    if (live.provider === "openai") {
      modelOpenai = live.model;
    } else {
      modelOllama = live.model;
    }
    try {
      localStorage.setItem(OLL_SETTINGS_KEY, JSON.stringify({
        url: live.url,
        model: modelOllama,
        modelOllama: modelOllama,
        modelOpenai: modelOpenai,
        provider: live.provider,
        temperature: live.temperature,
        topP: live.topP,
        numCtx: live.numCtx,
        systemPrompt: live.systemPrompt
      }));
    } catch (err) {
      /* ignore */
    }
  }

  function shortOllError(msg, url, isOpenai) {
    msg = String(msg || "").replace(/^Ollama:\s*/i, "");
    var low = msg.toLowerCase();
    var corsNote = "";
    if (window.location.protocol === "file:") {
      corsNote = " Если это ошибка CORS (нет соединения из file://), откройте сайт через http://localhost:8000.";
    }
    if (low.indexOf("system memory") !== -1 || low.indexOf("not enough") !== -1) {
      return msg + ". Модель не помещается в память: выберите в настройках модель поменьше (например qwen2.5:3b или llama3.2:3b) или закройте тяжёлые приложения.";
    }
    if (low.indexOf("failed to load") !== -1 || low.indexOf("resource limitations") !== -1 || low.indexOf("internal error") !== -1) {
      return msg + " Модель не смогла загрузиться — не хватает ресурсов. Закройте тяжёлые приложения, уменьшите num_ctx (например 2048) или выберите модель поменьше, затем перезапустите Ollama: ollama stop, затем ollama serve.";
    }
    if (low.indexOf("not found") !== -1) {
      if (isOpenai) {
        return msg + " Для routerai укажите корректный id модели из списка (кнопка «Проверить подключение»), например openai/gpt-4o-mini.";
      }
      return msg + ". Скачайте модель: ollama pull <имя модели>.";
    }
    if (low.indexOf("fetch") !== -1 || low.indexOf("failed to fetch") !== -1 || low.indexOf("networkerror") !== -1 || low.indexOf("load failed") !== -1) {
      return "Нет соединения с Ollama по адресу " + url + ". Запустите Ollama (ollama serve) и проверьте URL." + corsNote;
    }
    return msg;
  }

  function setStatus(el, text, type) {
    el.textContent = text;
    el.className = "st" + (type ? " " + type : "");
  }

  function setGenStatus(text, type) { setStatus($("#genStatus"), text, type); }
  function setSaveStatus(text, type) { setStatus($("#saveStatus"), text, type); }
  function setTestStatus(text, type) { setStatus($("#testStatus"), text, type); }

  function serializeTranslations(translations) {
    return (translations || []).map(function (t) {
      var line = "";
      if (t.context) line += "[" + t.context + "] ";
      line += t.meaning || "";
      (t.additional_meanings || []).forEach(function (m) {
        if (m) line += " | " + m;
      });
      return line;
    }).filter(Boolean).join("\n");
  }

  function parseTranslations(text) {
    return String(text || "").split("\n").map(function (raw) {
      var line = raw.trim();
      if (!line) return null;
      var context = "";
      if (line.charAt(0) === "[") {
        var end = line.indexOf("]");
        if (end > 0) {
          context = line.slice(1, end).trim();
          line = line.slice(end + 1).trim();
        }
      }
      var parts;
      if (line.indexOf("|") !== -1) {
        parts = line.split("|").map(function (s) { return s.trim(); }).filter(Boolean);
      } else {
        parts = line.split(";").map(function (s) { return s.trim(); }).filter(Boolean);
      }
      if (!parts.length) return null;
      var group = { meaning: parts[0] };
      if (context) group.context = context;
      if (parts.length > 1) group.additional_meanings = parts.slice(1);
      return group;
    }).filter(Boolean);
  }

  function fillForm(entry) {
    $("#fLemma").value = entry.lemma || "";
    $("#fOriginal").value = entry.original_form || "";
    $("#fTranscription").value = entry.transcription || "";
    $("#fPos").value = entry.part_of_speech || "";
    $("#fRu").value = serializeTranslations(entry.translations);
    $("#fEx").value = (entry.examples || []).map(function (e) {
      return e.example + " || " + e.translation;
    }).join("\n");
    $("#fPhrases").value = (entry.phrases || []).join("\n");
    $("#fNotes").value = entry.notes || "";
  }

  function cacheModels(models, replaceDefault) {
    ollModelsCache = models.map(String);
    var ml = $("#ollModelList");
    if (ml && !ml.classList.contains("hidden")) setModelListContent();
    if (ollModelsCache.length) {
      var cur = $("#ollModel").value.trim();
      if (!cur || (replaceDefault && cur === "llama3.1")) {
        $("#ollModel").value = ollModelsCache[0];
        saveOllSettings();
      }
    }
    ollLoaded = true;
  }

  function maybeLoadOllamaModels() {
    applySettingsToInputs();
    if (ollLoaded) return;
    var live = liveSettings();
    if (live.provider === "openai") {
      loadOpenAIModels();
      return;
    }
    loadOllamaModels(live);
  }

  function loadOllamaModels(live) {
    var tagsUrl = live.url + "/api/tags";
    logFetch(tagsUrl, null, { kind: "tags", model: live.model, timeoutMs: 15000 })
      .then(function (data) {
        cacheModels((data && data.models || []).map(function (m) { return m.name; }), true);
      })
      .catch(function (err) {
        var msg = err && err.message ? err.message : String(err);
        ollModelsCache = [];
        setGenStatus(shortOllError(msg, tagsUrl), "err");
      });
  }

  function loadOpenAIModels() {
    var mUrl = "api/llm/models";
    fetch(mUrl)
      .then(function (r) {
        return r.text().then(function (t) {
          var d = null;
          try { d = JSON.parse(t); } catch (e) { d = null; }
          if (!r.ok) {
            var msg = (d && d.error) || ("HTTP " + r.status + (t ? ": " + String(t).slice(0, 200) : ""));
            throw new Error(msg);
          }
          return d || {};
        });
      })
      .then(function (d) {
        cacheModels(d && d.models || [], false);
      })
      .catch(function (err) {
        var msg = err && err.message ? err.message : String(err);
        ollModelsCache = [];
        setGenStatus("OpenAI API: " + msg, "err");
      });
  }

  function setModelListContent() {
    var l = $("#ollModelList");
    if (!l) return;
    var typed = $("#ollModel").value.trim();
    if (!ollModelsCache.length) {
      l.innerHTML = '<div class="oll-item empty">Список моделей пуст. Проверьте подключение к провайдеру (см. сообщение выше).</div>';
      return;
    }
    var q = norm(typed);
    var exact = ollModelsCache.indexOf(typed) !== -1;
    var items = exact ? ollModelsCache.slice() : ollModelsCache.filter(function (m) { return !q || norm(m).indexOf(q) !== -1; });
    if (!items.length) {
      l.innerHTML = '<div class="oll-item empty">По запросу «' + escapeHtml(typed) + "» ничего нет. Можно ввести название модели вручную.</div>";
      return;
    }
    l.innerHTML = items.map(function (m) {
      return '<div class="oll-item" data-value="' + escapeHtml(m) + '">' + escapeHtml(m) + "</div>";
    }).join("");
  }

  function openModelList() {
    var l = $("#ollModelList");
    if (!l) return;
    setModelListContent();
    l.classList.remove("hidden");
  }

  function closeModelList() {
    var l = $("#ollModelList");
    if (l) l.classList.add("hidden");
  }

  $("#ollModelBtn").addEventListener("click", function (ev) {
    ev.stopPropagation();
    var l = $("#ollModelList");
    if (l && l.classList.contains("hidden")) openModelList();
    else closeModelList();
  });

  $("#ollModel").addEventListener("focus", function () {
    if (ollModelsCache.length) openModelList();
  });

  $("#ollModel").addEventListener("input", function () {
    var l = $("#ollModelList");
    if (l && !l.classList.contains("hidden")) setModelListContent();
  });

  $("#ollModelList").addEventListener("click", function (ev) {
    var item = ev.target.closest(".oll-item[data-value]");
    if (!item) return;
    $("#ollModel").value = item.getAttribute("data-value");
    saveOllSettings();
    closeModelList();
  });

  document.addEventListener("click", function (ev) {
    if (!ev.target.closest(".combo")) closeModelList();
  });

  $("#ollUrl").addEventListener("change", function () {
    saveOllSettings();
    ollLoaded = false;
    maybeLoadOllamaModels();
  });
  ["ollModel", "ollTemp", "ollTopP", "ollNumCtx", "ollSystem"].forEach(function (id) {
    $("#" + id).addEventListener("change", saveOllSettings);
  });

  $$('input[name="genProvider"]').forEach(function (r) {
    r.addEventListener("change", function () {
      var newProv = r.value;
      var prev = ollSettings();
      var curModel = ($("#ollModel").value || "").trim() ||
        (prev.provider === "openai" ? prev.modelOpenai : prev.modelOllama);
      var modelOllama = prev.modelOllama;
      var modelOpenai = prev.modelOpenai;
      if (prev.provider === "openai") modelOpenai = curModel;
      else modelOllama = curModel;
      try {
        localStorage.setItem(OLL_SETTINGS_KEY, JSON.stringify({
          url: prev.url,
          model: modelOllama,
          modelOllama: modelOllama,
          modelOpenai: modelOpenai,
          provider: newProv,
          temperature: prev.temperature,
          topP: prev.topP,
          numCtx: prev.numCtx,
          systemPrompt: prev.systemPrompt
        }));
      } catch (err) { /* ignore */ }
      ollLoaded = false;
      ollModelsCache = [];
      setGenStatus("");
      maybeLoadOllamaModels();
    });
  });

  $("#btnResetSystem").addEventListener("click", function () {
    $("#ollSystem").value = DEFAULT_SYSTEM_PROMPT;
    saveOllSettings();
    setGenStatus("Системный промпт сброшен к стандартному.", "ok");
  });

  $("#btnTestOll").addEventListener("click", function () {
    var live = liveSettings();
    if (live.provider === "openai") {
      setTestStatus("Проверяю OpenAI API…", "load");
      fetch("api/llm/models")
        .then(function (r) {
          return r.text().then(function (t) {
            var d = null;
            try { d = JSON.parse(t); } catch (e) { d = null; }
            if (!r.ok) {
              var msg = (d && d.error) || ("HTTP " + r.status + (t ? ": " + String(t).slice(0, 200) : ""));
              throw new Error(msg);
            }
            return d || {};
          });
        })
        .then(function (d) {
          var models = (d && d.models || []).map(String);
          setTestStatus("OpenAI API доступен. Доступно моделей: " + models.length + ". Список обновлён.", "ok");
          ollLoaded = false;
          cacheModels(models, false);
        })
        .catch(function (err) {
          var msg = err && err.message ? err.message : String(err);
          setTestStatus(shortOllError(msg, "", true), "err");
        });
      return;
    }
    var base = live.url;
    setTestStatus("Проверяю подключение…", "load");
    var verUrl = base + "/api/version";
    logFetch(verUrl, null, { kind: "version", timeoutMs: 10000 })
      .then(function (d) {
        setTestStatus("OK: Ollama " + (d.version || "?") + " по адресу " + base + ". Список моделей обновлён.", "ok");
        ollLoaded = false;
        maybeLoadOllamaModels();
      })
      .catch(function (err) {
        var msg = err && err.message ? err.message : String(err);
        setTestStatus(shortOllError(msg, base), "err");
      });
  });

  function findCardNode(node, depth) {
    if (!node || typeof node !== "object" || depth > 8) return null;
    if (!Array.isArray(node)) {
      if (node.lemma && typeof node.lemma === "string") {
        var hasMeaning = Array.isArray(node.translations) || Array.isArray(node.ru) ||
          node.meaning || (Array.isArray(node.examples) && node.examples.length) ||
          node.transcription || node.ipa || node.part_of_speech || node.pos;
        if (hasMeaning) return node;
      }
      var keys = Object.keys(node);
      for (var i = 0; i < keys.length; i++) {
        var found = findCardNode(node[keys[i]], depth + 1);
        if (found) return found;
      }
      return null;
    }
    for (var j = 0; j < node.length; j++) {
      var f = findCardNode(node[j], depth + 1);
      if (f) return f;
    }
    return null;
  }

  function normalizeIpa(ipa) {
    ipa = String(ipa || "").trim();
    if (!ipa) return "";
    if (ipa.charAt(0) === "/" && ipa.charAt(1) === "/") ipa = ipa.slice(1);
    if (ipa.slice(-2) === "//") ipa = ipa.slice(0, -1);
    if (ipa.charAt(0) !== "/" && ipa.charAt(ipa.length - 1) !== "/") {
      return "/" + ipa + "/";
    }
    return ipa;
  }

  function parsePhrases(items) {
    if (!Array.isArray(items)) return [];
    var out = [];
    items.forEach(function (p) {
      if (typeof p === "string") {
        if (p.trim()) out.push(p.trim());
      } else if (p && typeof p === "object") {
        var text = String(p.phrase || p.value || "").trim();
        if (!text) return;
        var tr = p.translation ? String(p.translation).trim() : "";
        out.push(text + (tr ? " (" + tr + ")" : ""));
      }
    });
    return out;
  }

  function modelTextFrom(data) {
    if (data && typeof data.response === "string") return data.response;
    if (data && data.message) {
      var c = data.message.content;
      if (typeof c === "string") return c;
      if (Array.isArray(c)) {
        var parts = [];
        c.forEach(function (p) {
          if (typeof p === "string") parts.push(p);
          else if (p && typeof p.text === "string") parts.push(p.text);
        });
        return parts.join("");
      }
    }
    return "";
  }

  function snippetOf(text, maxLen) {
    var one = String(text || "").replace(/\s+/g, " ").trim();
    return one.length > maxLen ? one.slice(0, maxLen) + "…" : one;
  }

  function parseTranslationGroups(tr, legacyRu) {
    var out = [];
    var pushMeaning = function (rawMeaning, rawExtra, context) {
      var meaning = rawMeaning ? String(rawMeaning).trim() : "";
      var extra = (rawExtra || []).map(String).filter(Boolean);
      if (!meaning && extra.length) {
        meaning = extra.shift();
      }
      if (!meaning) return;
      out.push({ meaning: meaning, context: context || "", extra: extra });
    };
    if (Array.isArray(tr) && tr.length) {
      tr.forEach(function (t) {
        if (typeof t === "string") {
          pushMeaning(t, [], "");
          return;
        }
        var context = t.context ? String(t.context) : "";
        var extra = Array.isArray(t.additional_meanings) ? t.additional_meanings.slice() : [];
        var meaning = t.meaning ? String(t.meaning) : "";
        var pieces = meaning.split(";").map(function (s) { return s.trim(); }).filter(Boolean);
        if (pieces.length > 1) {
          pushMeaning(pieces[0], pieces.slice(1).concat(extra), context);
        } else {
          pushMeaning(meaning, extra, context);
        }
      });
    } else if (Array.isArray(legacyRu) && legacyRu.length) {
      legacyRu.forEach(function (t) {
        if (typeof t === "string") {
          pushMeaning(t, [], "");
        } else if (t) {
          pushMeaning(t.meaning, t.additional_meanings || [], t.context || "");
        }
      });
    }
    return out.map(function (g) {
      var group = { meaning: g.meaning };
      if (g.context) group.context = g.context;
      if (g.extra.length) group.additional_meanings = g.extra;
      return group;
    });
  }

  function parseExamples(ex) {
    if (!Array.isArray(ex)) return [];
    return ex.map(function (e) {
      if (typeof e === "string") return { example: e, translation: "" };
      return {
        example: e.example || e.en || "",
        translation: e.translation || e.ru || ""
      };
    }).filter(function (e) { return e.example; });
  }

  function extractCard(data) {
    var txt = modelTextFrom(data);
    var start = txt.indexOf("{");
    var end = txt.lastIndexOf("}");
    if (start === -1 || end <= start) {
      var dbg = "";
      try { dbg = snippetOf(JSON.stringify(data && data.message), 200); } catch (e) { dbg = "?"; }
      return { error: "Модель не вернула JSON-карточку" + (txt ? " (первые символы ответа: " + snippetOf(txt, 160) + ")" : " (message: " + dbg + ")") };
    }
    try {
      var obj = JSON.parse(txt.slice(start, end + 1));
      var card = findCardNode(obj, 0);
      if (!card) return { error: "В ответе модели не найдена карточка слова (поля lemma/translation)" };
      var translations = parseTranslationGroups(card.translations, card.ru);
      if (!translations.length) {
        if (card.meaning) translations = [{ meaning: String(card.meaning) }];
      }
      var entry = {
        lemma: card.lemma,
        transcription: normalizeIpa(card.transcription || card.ipa),
        part_of_speech: card.part_of_speech || card.pos || "",
        translations: translations,
        examples: parseExamples(card.examples)
      };
      if (card.original_form) entry.original_form = String(card.original_form);
      var phrases = parsePhrases(card.phrases);
      if (phrases.length) entry.phrases = phrases;
      if (card.notes) entry.notes = String(card.notes);
      if (!entry.lemma || !translations.length) return { error: "В ответе нет полей lemma/translations" };
      return { entry: entry };
    } catch (err) {
      return { error: "Ответ модели не является корректным JSON: " + err.message };
    }
  }

  $("#btnGen").addEventListener("click", function () {
    var word = $("#addWord").value.trim();
    if (!word) {
      setGenStatus("Сначала введите слово или фразу.", "err");
      return;
    }
    setGenStatus("Запрашиваю модель…", "load");
    var live = liveSettings();
    var isOpenai = live.provider === "openai";
    var chatUrl = isOpenai ? "api/llm/openai" : (live.url + "/api/chat");
    var payload = {
      model: live.model,
      messages: [
        { role: "system", content: live.systemPrompt },
        { role: "user", content: "Слово или фраза: " + word }
      ],
      stream: false,
      options: {
        temperature: live.temperature,
        top_p: live.topP,
        num_ctx: live.numCtx
      }
    };
    if (!isOpenai) payload.format = "json";
    logFetch(chatUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }, {
      kind: "generate",
      model: live.model,
      word: word,
      timeoutMs: 150000,
      inspect: function (data) {
        var c = extractCard(data);
        return c.error || null;
      }
    })
      .then(function (data) {
        var c = extractCard(data);
        if (c.error) {
          setGenStatus(shortOllError(c.error, chatUrl, isOpenai), "err");
          return;
        }
        fillForm(c.entry);
        $("#addFormWrap").classList.remove("hidden");
        setGenStatus("Готово. Проверьте данные и сохраните.", "ok");
      })
      .catch(function (err) {
        var msg = err && err.message ? err.message : String(err);
        setGenStatus(shortOllError(msg, chatUrl, isOpenai), "err");
      });
  });

  function parseExampleLine(line) {
    var parts = line.split("||");
    var example = (parts[0] || "").trim();
    var translation = (parts.slice(1).join("||") || "").trim();
    return { example: example, translation: translation };
  }

  function buildEntryFromForm() {
    var lemma = $("#fLemma").value.trim();
    var translations = parseTranslations($("#fRu").value);
    var exLines = $("#fEx").value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
    var phraseLines = $("#fPhrases").value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
    var notes = $("#fNotes").value.trim();
    if (!lemma) throw new Error("Лемма обязательна.");
    if (!translations.length) throw new Error("Нужен хотя бы один перевод.");
    var existing = WORDS.filter(function (w) { return norm(w.lemma) === norm(lemma); })[0];
    if (existing) throw new Error("Слово \"" + lemma + "\" уже есть в словаре (№" + existing.id + ").");
    var examples = exLines.map(parseExampleLine).filter(function (e) { return e.example; });
    var entry = {
      lemma: lemma,
      transcription: $("#fTranscription").value.trim(),
      part_of_speech: $("#fPos").value.trim(),
      translations: translations,
      examples: examples
    };
    var original = $("#fOriginal").value.trim();
    if (original && norm(original) !== norm(lemma)) entry.original_form = original;
    if (phraseLines.length) entry.phrases = phraseLines;
    if (notes) entry.notes = notes;
    return entry;
  }

  function resetAddForm() {
    $("#addWord").value = "";
    $("#fLemma").value = "";
    $("#fOriginal").value = "";
    $("#fTranscription").value = "";
    $("#fPos").value = "";
    $("#fRu").value = "";
    $("#fEx").value = "";
    $("#fPhrases").value = "";
    $("#fNotes").value = "";
    $("#addFormWrap").classList.add("hidden");
    $("#saveStatus").textContent = "";
    $("#saveStatus").className = "st";
  }

  $("#btnSave").addEventListener("click", function () {
    var entry;
    try {
      entry = buildEntryFromForm();
    } catch (err) {
      setSaveStatus(err.message, "err");
      return;
    }
    setSaveStatus("Сохраняю в data.json…", "load");
    postWord(entry)
      .then(function (saved) {
        WORDS.push(saved);
        updateWordCounts();
        resetAddForm();
        var ttsMsg = saved.audio
          ? "Аудио сгенерировано."
          : "Озвучка не создана: " + (saved.tts_error ? String(saved.tts_error).slice(0, 200) : "TTS недоступен") + ".";
        setGenStatus("Добавлено: \"" + saved.lemma + "\" (№" + saved.id + "). Слово записано в data.json. " + ttsMsg, "ok");
        setSaveStatus("", "");
        openIds[saved.id] = true;
        showView("dict");
        renderDict();
        var target = dictList.querySelector('details.word[data-id="' + saved.id + '"]');
        if (target) target.open = true;
      })
      .catch(function (err) {
        var msg = err && err.message ? err.message : String(err);
        setSaveStatus(msg + " Слово не сохранено. Проверьте, что сайт открыт через python server.py (не file://) и сервер запущен.", "err");
      });
  });

  $("#btnReset").addEventListener("click", function () {
    resetAddForm();
    setGenStatus("");
  });

  $("#addWord").addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") {
      ev.preventDefault();
      $("#btnGen").click();
    }
  });

  $("#btnClearLog").addEventListener("click", clearOllLog);

  renderOllLog();
  loadWords();
})();
