/* 閱讀闖關站：依 reading-literacy-quest 規格（PIRLS 四層次）運作的學生自主闖關網站。
   資料：window.RLQ_DATA = { texts: [...], quests: [...] }（見 data/），另可在教師端匯入 JSON。
   學習紀錄只存在這台裝置的瀏覽器（localStorage）。 */
(function () {
  "use strict";

  // ------------------------------------------------------------ constants
  var LEVELS = { 1: "提取訊息", 2: "推論分析", 3: "詮釋整合", 4: "評估與評論" };
  var LEVEL_SHORT = { 1: "提取", 2: "推論", 3: "詮釋", 4: "評估" };
  var BAND_NAME = { low: "低年級", middle: "中年級", high: "高年級" };
  var BAND_MIN = { low: 15, middle: 25, high: 35 };
  var STEPS = [
    ["intro", "任務說明"], ["warm", "讀前暖身"], ["read", "閱讀文本"],
    ["levels", "四層闖關"], ["retry", "錯題再挑戰"], ["done", "過關與反思"]
  ];
  var STICKERS = ["貓", "兔", "熊", "鹿", "鯨", "鶴", "狐", "龜", "象", "鷹"];
  var STORE_KEY = "rlq.v1";

  // ------------------------------------------------------------ storage
  var store = load();
  function blankStore() { return { v: 1, current: null, profiles: {}, imported: { quests: [], texts: [] } }; }
  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) { var s = JSON.parse(raw); if (s && s.v === 1) { s.imported = s.imported || { quests: [], texts: [] }; return s; } }
    } catch (e) { /* storage unavailable */ }
    return blankStore();
  }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* ignore */ } }

  // ------------------------------------------------------------ data
  var BASE = window.RLQ_DATA || { texts: [], quests: [] };
  var TEXTS = {}, QUESTS = [];
  function rebuildData() {
    TEXTS = {}; QUESTS = [];
    BASE.texts.concat(store.imported.texts || []).forEach(function (t) { TEXTS[t.id] = t; });
    var seen = {};
    (store.imported.quests || []).concat(BASE.quests).forEach(function (q) {
      if (!seen[q.quest_id]) { seen[q.quest_id] = 1; QUESTS.push(q); }
    });
    var order = { low: 0, middle: 1, high: 2 };
    QUESTS.sort(function (a, b) { return (order[a.grade_band] - order[b.grade_band]) || a.text_id.localeCompare(b.text_id); });
  }
  rebuildData();
  function questById(id) { for (var i = 0; i < QUESTS.length; i++) if (QUESTS[i].quest_id === id) return QUESTS[i]; return null; }
  function questsForText(tid) { return QUESTS.filter(function (q) { return q.text_id === tid; }); }
  function levelQs(quest, L) { return quest.questions.filter(function (q) { return q.level === L; }); }
  function cleanTitle(t) { var m = /〈(.+?)〉/.exec(t.title); return m ? m[1] : t.title; }

  // ------------------------------------------------------------ profile helpers
  function bandOfGrade(g) { return g <= 2 ? "low" : g <= 4 ? "middle" : "high"; }
  function me() { return store.current ? store.profiles[store.current] : null; }
  function progressOf(profile, questId) { return profile && profile.quests[questId]; }
  function newProgress() {
    return { step: "intro", warm: null, warmCheck: null, readDone: false, level: 1, cur: 0,
      answers: {}, levelResult: {}, remedial: null, retry: { answers: {}, cur: 0 },
      reflection: { choice: null, sentence: "" }, penHTML: null, notes: "", started: Date.now(), finished: null };
  }

  // ------------------------------------------------------------ view state
  var view = { name: "map", dashSource: "local", cls: null, openSub: null, qrBig: false, band: null, questId: null, textId: null, teacherTab: "class", teacherQuest: null, showText: null, pen: false, zhuyin: false };

  // ------------------------------------------------------------ utils
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }
  function toast(msg) {
    var t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function circledNum(ch) {
    var c = ch.charCodeAt(0);
    if (c >= 0x2460 && c <= 0x2473) return c - 0x2460 + 1;
    if (c >= 0x3251 && c <= 0x325f) return c - 0x3251 + 21;
    if (c >= 0x32b1 && c <= 0x32bf) return c - 0x32b1 + 36;
    return 0;
  }
  function paraLabel(nums) { return nums.map(function (n) { return "第 " + n + " 段"; }).join("、"); }

  // ------------------------------------------------------------ markdown (subset used by texts.json)
  function inline(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\[(\d+)\]/g, "<sup>[$1]</sup>");
  }
  function renderMarkdown(md, opts) {
    opts = opts || {};
    var blocks = md.replace(/\r/g, "").split(/\n\s*\n/);
    var html = [], section = "", locked = false;
    blocks.forEach(function (b) {
      b = b.replace(/^\n+|\n+$/g, "");
      if (!b.trim()) return;
      var lines = b.split("\n");
      var heading = /^\*\*([^*]+)\*\*$/.exec(b.trim());
      if (heading) {
        section = heading[1].trim();
        if (section === "語譯" && opts.lockTranslation) {
          locked = true;
          html.push('<div class="locked-block">「語譯」在闖關時先鎖住，請先自己讀原文和注釋。完成闖關後就會打開。</div>');
          return;
        }
        if (!locked) html.push("<h4>" + inline(section) + "</h4>");
        return;
      }
      if (locked) return;
      if (lines.every(function (l) { return /^\s*\|/.test(l); })) {
        var rows = lines.filter(function (l) { return !/^\s*\|\s*-{2,}/.test(l); }).map(function (l) {
          return l.trim().replace(/^\||\|$/g, "").split("|").map(function (c) { return c.trim(); });
        });
        var t = '<div class="tbl"><table><thead><tr>' + rows[0].map(function (c) { return "<th>" + inline(c) + "</th>"; }).join("") + "</tr></thead><tbody>";
        rows.slice(1).forEach(function (r) { t += "<tr>" + r.map(function (c) { return "<td>" + inline(c) + "</td>"; }).join("") + "</tr>"; });
        html.push(t + "</tbody></table></div>");
        return;
      }
      if (lines.every(function (l) { return /^\s*-\s/.test(l); })) {
        html.push("<ul>" + lines.map(function (l) { return "<li>" + inline(l.replace(/^\s*-\s/, "")) + "</li>"; }).join("") + "</ul>");
        return;
      }
      var first = b.trim().charAt(0), n = circledNum(first);
      if (n) {
        var body = b.trim().slice(1).trim();
        var isOrig = section === "" || section === "原文";
        var attr = isOrig ? ' data-p="' + n + '"' : "";
        var say = opts.readAloud ? '<button class="say" data-action="say-para" aria-label="朗讀第 ' + n + ' 段">▶ 朗讀</button>' : "";
        html.push('<p class="para"' + attr + '><span class="pnum">' + esc(first) + "</span>" + inline(body).replace(/\n/g, "<br>") + say + "</p>");
        return;
      }
      html.push('<p class="note">' + inline(b).replace(/\n/g, "<br>") + "</p>");
    });
    return html.join("");
  }

  // ------------------------------------------------------------ speech + zhuyin
  function speak(text) {
    try {
      if (!("speechSynthesis" in window)) { toast("這個瀏覽器不支援朗讀"); return; }
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text.replace(/[①-⑳㉑-㉟]/g, ""));
      u.lang = "zh-TW"; u.rate = 0.85;
      speechSynthesis.speak(u);
    } catch (e) { toast("朗讀沒有成功，請改用自己讀"); }
  }
  var pinyinReady = null;
  function loadPinyin() {
    if (window.pinyinPro) return Promise.resolve();
    if (pinyinReady) return pinyinReady;
    pinyinReady = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/pinyin-pro@3.29.4/dist/index.js";
      s.onload = function () { res(); }; s.onerror = function () { pinyinReady = null; rej(); };
      document.head.appendChild(s);
    });
    return pinyinReady;
  }
  var INITIALS = { b: "ㄅ", p: "ㄆ", m: "ㄇ", f: "ㄈ", d: "ㄉ", t: "ㄊ", n: "ㄋ", l: "ㄌ", g: "ㄍ", k: "ㄎ", h: "ㄏ", j: "ㄐ", q: "ㄑ", x: "ㄒ", zh: "ㄓ", ch: "ㄔ", sh: "ㄕ", r: "ㄖ", z: "ㄗ", c: "ㄘ", s: "ㄙ" };
  var FINALS = { a: "ㄚ", o: "ㄛ", e: "ㄜ", "ê": "ㄝ", ai: "ㄞ", ei: "ㄟ", ao: "ㄠ", ou: "ㄡ", an: "ㄢ", en: "ㄣ", ang: "ㄤ", eng: "ㄥ", er: "ㄦ", ong: "ㄨㄥ",
    i: "ㄧ", ia: "ㄧㄚ", ie: "ㄧㄝ", iao: "ㄧㄠ", iu: "ㄧㄡ", ian: "ㄧㄢ", "in": "ㄧㄣ", iang: "ㄧㄤ", ing: "ㄧㄥ", iong: "ㄩㄥ",
    u: "ㄨ", ua: "ㄨㄚ", uo: "ㄨㄛ", uai: "ㄨㄞ", ui: "ㄨㄟ", uan: "ㄨㄢ", un: "ㄨㄣ", uang: "ㄨㄤ",
    "ü": "ㄩ", "üe": "ㄩㄝ", "üan": "ㄩㄢ", "ün": "ㄩㄣ" };
  var TONES = { 1: "", 2: "ˊ", 3: "ˇ", 4: "ˋ" };
  function toZhuyin(py) {
    var m = /^([a-zü]+)([0-5]?)$/.exec(py.replace(/v/g, "ü"));
    if (!m) return "";
    var s = m[1], tone = +(m[2] || 5), ini = "", fin = s;
    if (s === "m" || s === "n" || s === "ng") return "";
    var yw = { yi: "i", ya: "ia", ye: "ie", yao: "iao", you: "iu", yan: "ian", yin: "in", yang: "iang", ying: "ing", yong: "iong",
      yu: "ü", yue: "üe", yuan: "üan", yun: "ün", wu: "u", wa: "ua", wo: "uo", wai: "uai", wei: "ui", wan: "uan", wen: "un", wang: "uang", weng: "ueng" };
    if (yw[s]) { fin = yw[s]; }
    else {
      var im = /^(zh|ch|sh|[bpmfdtnlgkhjqxrzcs])(.*)$/.exec(s);
      if (im) { ini = im[1]; fin = im[2]; }
      if (/^[jqx]$/.test(ini)) fin = fin.replace(/^u/, "ü");
      if (/^(zh|ch|sh|r|z|c|s)$/.test(ini) && fin === "i") fin = "";
    }
    var z = (INITIALS[ini] || "") + (fin === "ueng" ? "ㄨㄥ" : fin === "" ? "" : (FINALS[fin] || ""));
    if (!z) return "";
    return tone === 5 || tone === 0 ? "˙" + z : z + TONES[tone];
  }
  function fixPolyphones(chars, pys) {
    var cjk = /[\u4e00-\u9fff]/;
    for (var i = 0; i < chars.length; i++) {
      var c = chars[i], nx = chars[i + 1] || "", pv = chars[i - 1] || "";
      if (c === "們") pys[i] = "men5";
      if (c === "麼") pys[i] = "me5";
      if (c === "誰") pys[i] = "shei2";
      if (c === "幾" && nx !== "乎") pys[i] = "ji3";
      if (c === "彈" && /^[琴鋼奏吉]/.test(nx)) pys[i] = "tan2";
      if (c === "還" && !/^[給錢書原]/.test(nx)) pys[i] = "hai2";
      if (c === "子" && cjk.test(pv) && !/^[女孫弟曰]/.test(nx) && !/[孔孟老莊君]/.test(pv)) pys[i] = "zi5";
      if (chars[i] === "著" && !/^(急|名|作|陸|火|涼|迷)/.test(chars[i + 1] || "")) pys[i] = "zhe5";
      if (chars[i] === "得" && !/^(到|獎|分)/.test(chars[i + 1] || "") && /[一-鿿]/.test(chars[i - 1] || "")) pys[i] = "de5";
    }
    return pys;
  }
  function applyZhuyin(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), nodes = [], n;
    while ((n = walker.nextNode())) {
      if (n.parentNode.closest("ruby, button, .pnum, rt")) continue;
      if (/[一-鿿]/.test(n.nodeValue)) nodes.push(n);
    }
    nodes.forEach(function (node) {
      var text = node.nodeValue, chars = Array.from(text);
      var pys = window.pinyinPro.pinyin(text, { type: "array", toneType: "num", toneSandhi: false, nonZh: "consecutive" });
      if (pys.length !== chars.length) {
        pys = chars.map(function (c) { return /[一-鿿]/.test(c) ? window.pinyinPro.pinyin(c, { toneType: "num" }) : c; });
      }
      fixPolyphones(chars, pys);
      var frag = document.createDocumentFragment();
      chars.forEach(function (c, i) {
        if (/[一-鿿]/.test(c)) {
          var r = document.createElement("ruby"); r.textContent = c;
          var rt = document.createElement("rt"); rt.textContent = toZhuyin(pys[i]); r.appendChild(rt); frag.appendChild(r);
        } else frag.appendChild(document.createTextNode(c));
      });
      node.parentNode.replaceChild(frag, node);
    });
  }

  // ------------------------------------------------------------ scoring
  function fullPoints(quest) { return 100 / quest.questions.length; }
  function isRight(q, opt) { return q.answer === opt; }
  function recordPick(ctx, q, opt, quest, kind) {
    var rec = ctx.answers[q.qid] || (ctx.answers[q.qid] = { picks: [] });
    if (rec.done || rec.picks.indexOf(opt) >= 0) return rec;
    rec.picks.push(opt);
    if (isRight(q, opt)) { rec.done = true; rec.correct = true; rec.first = rec.picks.length === 1; }
    else if (rec.picks.length >= 3) { rec.done = true; rec.correct = false; rec.first = false; rec.revealed = true; }
    if (rec.done && kind === "main") {
      var full = fullPoints(quest);
      rec.points = rec.first ? full : rec.correct ? (quest.settings && quest.settings.hint_costs_points ? full / 2 : full) : 0;
    }
    if (rec.done && kind === "retry") {
      var main = ctx.mainRec, lost = fullPoints(quest) - (main.points || 0);
      rec.bonus = rec.first ? lost / 2 : 0;
    }
    return rec;
  }
  function questScore(quest, p) {
    var s = 0;
    quest.questions.forEach(function (q) {
      var r = p.answers[q.qid]; if (r && r.points) s += r.points;
      var rr = p.retry && p.retry.answers[q.qid]; if (rr && rr.bonus) s += rr.bonus;
    });
    return Math.round(s);
  }
  function threshold(n) { return Math.ceil(n * 0.6); }
  function levelNeedsGate(quest, L) {
    var rule = (quest.settings && quest.settings.unlock_rule) || "per_level_3_of_5";
    if (rule === "none") return false;
    if (rule === "levels_1_2_then_open") return L <= 2;
    return true;
  }
  function levelStats(quest, p, L) {
    var qs = levelQs(quest, L), first = 0, done = 0;
    qs.forEach(function (q) { var r = p.answers[q.qid]; if (r && r.done) { done++; if (r.first) first++; } });
    return { n: qs.length, first: first, done: done };
  }
  function wrongQs(quest, p) {
    return quest.questions.filter(function (q) { var r = p.answers[q.qid]; return r && r.done && !r.first; });
  }

  // ------------------------------------------------------------ rendering root
  var app = $("#app");
  function render() {
    var who = me();
    $("#whoChip").textContent = who ? who.name + "・" + who.grade + " 年級" : "選擇學生";
    document.querySelectorAll(".mainnav button").forEach(function (b) {
      var active = b.dataset.view === view.name || (view.name === "quest" && b.dataset.view === "map") || (view.name === "text" && b.dataset.view === "library");
      if (active) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    if (!who && ["teacher", "library", "text", "join"].indexOf(view.name) < 0) view.name = "profile";
    var fn = { map: renderMap, profile: renderProfile, library: renderLibrary, text: renderTextView, quest: renderQuest, journey: renderJourney, teacher: renderTeacher, join: renderJoin }[view.name];
    fn();
    if (view.name === "teacher" && view.teacherTab === "class" && teacherApi() && store.teacher.key && online.classes === null && !online.loading && !online.error) loadClasses();
  }

  // ------------------------------------------------------------ profile
  function renderProfile() {
    var ids = Object.keys(store.profiles);
    var list = ids.length ? ids.map(function (id) {
      var p = store.profiles[id];
      var done = Object.keys(p.quests).filter(function (k) { return p.quests[k].finished; }).length;
      return '<button class="lib-item" data-action="pick-profile" data-id="' + esc(id) + '"><b>' + (p.seat ? esc(p.seat) + " 號 " : "") + esc(p.name) + '</b><span class="muted small">' + (p.className ? esc(p.className) : p.grade + " 年級・" + BAND_NAME[bandOfGrade(p.grade)]) + "・完成 " + done + " 關</span></button>";
    }).join("") : '<p class="muted">這台裝置還沒有學生。輸入名字和年級就能開始。</p>';
    app.innerHTML =
      '<section class="sheet panel" style="max-width:720px;margin:0 auto">' +
      '<div><span class="eyebrow">開始闖關</span><h1>你是誰？</h1></div>' +
      '<p class="muted">選自己的名字繼續上次的進度。第一次來就新增一位，紀錄會存在這台裝置。</p>' +
      '<div class="lib-grid">' + list + "</div>" +
      '<form id="codeJoin" class="stack" autocomplete="off"><h3>老師給了班級代碼？</h3><div class="row"><label class="field" style="flex:1 1 200px">班級代碼<input type="text" id="jCode" maxlength="8" placeholder="例如 K7QX2M" style="text-transform:uppercase"></label>' +
      '<button class="btn primary" type="submit" style="align-self:flex-end">加入班級</button></div></form>' +
      '<h3>自己練習</h3>' +
      '<form id="newProfile" class="stack" autocomplete="off">' +
      '<div class="row"><label class="field" style="flex:2 1 200px">名字或座號<input type="text" id="pfName" maxlength="20" required placeholder="例如：五年二班 12 號 王小明"></label>' +
      '<label class="field" style="flex:1 1 120px">年級<select id="pfGrade">' + [1, 2, 3, 4, 5, 6].map(function (g) { return '<option value="' + g + '"' + (g === 5 ? " selected" : "") + ">" + g + " 年級</option>"; }).join("") + "</select></label></div>" +
      '<div><button class="btn primary" type="submit">新增並開始</button></div></form></section>';
    $("#codeJoin").addEventListener("submit", function (e) {
      e.preventDefault();
      var code = $("#jCode").value.trim().toUpperCase(); if (!code) return;
      view.joinCode = code; view.name = "join"; online.joinClass = null; online.joinError = ""; render();
    });
    $("#newProfile").addEventListener("submit", function (e) {
      e.preventDefault();
      var name = $("#pfName").value.trim(); if (!name) return;
      var id = "s" + Date.now().toString(36);
      store.profiles[id] = { id: id, name: name, grade: +$("#pfGrade").value, created: Date.now(), quests: {} };
      store.current = id; save(); view.name = "map"; view.band = null; render();
      toast("歡迎，" + name + "！");
    });
  }

  // ------------------------------------------------------------ map
  function questStatus(p, quest) {
    if (!p) return { label: "還沒開始", pctDone: 0 };
    if (p.finished) return { label: "已過關", pctDone: 100 };
    var done = quest.questions.filter(function (q) { var r = p.answers[q.qid]; return r && r.done; }).length;
    return { label: "進行中", pctDone: Math.round(done / quest.questions.length * 100) };
  }
  function levelSeals(quest, p, small) {
    return '<div class="seal-row">' + [1, 2, 3, 4].map(function (L) {
      var ok = p && p.levelResult[L] && p.levelResult[L].passed;
      return '<span class="seal lv-' + L + (ok ? "" : " off") + '" style="' + (ok ? "--c:var(--l" + L + ")" : "") + (small ? ";width:38px;height:38px;font-size:.78rem;border-width:2px" : "") + '" title="層次' + L + "・" + LEVELS[L] + (ok ? "：已過關" : "") + '">' + LEVEL_SHORT[L] + "</span>";
    }).join("") + "</div>";
  }
  function renderMap() {
    var who = me(), myBand = bandOfGrade(who.grade);
    var band = view.band || myBand;
    var inClass = !!who.classCode;
    var list = inClass ? (who.assigned || []).map(questById).filter(Boolean) : QUESTS.filter(function (q) { return q.grade_band === band; });
    var cards = list.map(function (quest, i) {
      var t = TEXTS[quest.text_id], p = progressOf(who, quest.quest_id), st = questStatus(p, quest);
      var stamp = p && p.finished ? '<span class="seal stamp pop">過關</span>' : "";
      return '<article class="sheet quest-card">' + stamp +
        '<span class="num">第 ' + (i + 1) + " 關</span>" +
        "<h3>〈" + esc(quest.title) + "〉</h3>" +
        '<div class="meta"><span class="chip">' + esc(quest.genre || "") + '</span><span class="chip">' + quest.questions.length + ' 題</span><span class="chip">約 ' + BAND_MIN[quest.grade_band] + " 分鐘</span>" + (t ? "" : '<span class="chip" style="color:var(--bad)">缺文章</span>') + "</div>" +
        levelSeals(quest, p, true) +
        '<div class="progress-bar" aria-label="完成 ' + st.pctDone + '%"><span style="width:' + st.pctDone + '%"></span></div>' +
        '<div class="foot"><span class="muted small">' + st.label + (p && p.finished ? "・" + questScore(quest, p) + " 分" : "") + "</span>" + (inClass ? submitChip(p) : "") +
        (inClass && p && p.finished && p.submitState !== "done" && p.submitState !== "sending" ? '<button class="btn primary small" data-action="submit-quest" data-id="' + esc(quest.quest_id) + '">繳交給老師</button>' :
        '<button class="btn ' + (p && p.finished ? "" : "primary") + ' small" data-action="open-quest" data-id="' + esc(quest.quest_id) + '"' + (t ? "" : " disabled") + ">" + (p ? (p.finished ? "再看一次" : "繼續闖關") : "開始闖關") + "</button>") + "</div></article>";
    }).join("");
    var waiting = inClass ? [] : Object.keys(TEXTS).map(function (k) { return TEXTS[k]; }).filter(function (t) { return t.grade_band === band && !questsForText(t.id).length; });
    cards += waiting.map(function (t) {
      return '<article class="sheet quest-card waiting"><span class="num">' + esc(t.id) + "</span><h3>〈" + esc(cleanTitle(t)) + "〉</h3>" +
        '<p class="muted small">這篇還沒有闖關題組，可以先讀文章。</p>' +
        '<div class="foot"><span class="muted small">等老師出題</span><button class="btn small" data-action="open-text" data-id="' + esc(t.id) + '">先讀文章</button></div></article>';
    }).join("");
    var finished = Object.keys(who.quests).filter(function (k) { return who.quests[k].finished; }).length;
    app.innerHTML =
      '<section class="sheet hero"><div><span class="eyebrow">闖關地圖・' + (inClass ? esc(who.className) + "・老師指派" : BAND_NAME[band]) + "</span><h1>" + esc(who.name) + "，今天讀哪一篇？</h1>" +
      "<p>每一篇文章是一個關卡。先暖身、讀完全文，再依序挑戰四個層次：提取訊息、推論分析、詮釋整合、評估與評論。答錯會有提示幫你回到文章找線索。</p></div>" +
      '<div class="stack" style="align-items:flex-end">' + (inClass ? "" : '<div class="seg" role="group" aria-label="年段">' +
      ["low", "middle", "high"].map(function (b) { return '<button data-action="band" data-band="' + b + '" aria-pressed="' + (b === band) + '">' + BAND_NAME[b] + "</button>"; }).join("") +
      "</div>") + '<span class="muted small tnum">已過關 ' + finished + " 關</span></div></section>" +
      (cards ? '<div class="map-path">' + cards + "</div>" :
        '<div class="sheet empty"><h3>' + BAND_NAME[band] + "還沒有關卡</h3><p>文章庫裡有這個年段的文章。請老師用 reading-literacy-quest 出題後，在教師端匯入題組 JSON。</p></div>");
  }

  // ------------------------------------------------------------ library
  function renderLibrary() {
    var groups = ["low", "middle", "high"].map(function (b) {
      var items = Object.keys(TEXTS).map(function (k) { return TEXTS[k]; }).filter(function (t) { return t.grade_band === b; });
      return '<section class="stack"><h2>' + BAND_NAME[b] + ' <span class="muted small">' + items.length + " 篇</span></h2><div class=\"lib-grid\">" +
        items.map(function (t) {
          var qs = questsForText(t.id);
          return '<button class="lib-item" data-action="open-text" data-id="' + esc(t.id) + '"><span class="muted small">' + esc(t.id) + "</span><b>〈" + esc(cleanTitle(t)) + "〉</b>" +
            '<span class="row" style="gap:6px">' + (t.paragraph_count ? '<span class="chip">' + t.paragraph_count + " 段</span>" : "") + (qs.length ? '<span class="chip lv lv-2">有闖關題組</span>' : '<span class="chip">尚無題組</span>') + "</span></button>";
        }).join("") + "</div></section>";
    }).join("");
    app.innerHTML = '<div class="stack"><div class="sheet panel"><span class="eyebrow">文章庫</span><h1>26 篇閱讀文章</h1><p class="muted">來自 reading-literacy-quest 內建的改寫副本文章。有題組的文章可以直接闖關；其他文章等老師出題後匯入。</p></div>' + groups + "</div>";
  }
  function renderTextView() {
    var t = TEXTS[view.textId]; if (!t) { view.name = "library"; return render(); }
    var qs = questsForText(t.id), who = me();
    app.innerHTML = '<div class="stack"><div class="row"><button class="btn ghost small" data-action="nav" data-view="library">← 回文章庫</button></div>' +
      '<div class="workspace"><article class="sheet text-pane">' + textToolbar(t, { low: t.grade_band === "low" }) +
      '<div class="article' + (t.grade_band === "low" ? " big" : "") + '" id="article">' + renderMarkdown(t.student_text_markdown, { readAloud: t.grade_band === "low" }) + "</div></article></div>" +
      (qs.length && who ? '<div class="row">' + qs.map(function (q) { return '<button class="btn primary" data-action="open-quest" data-id="' + esc(q.quest_id) + '">闖這一關〈' + esc(q.title) + "〉</button>"; }).join("") + "</div>" : "") +
      "</div>";
    afterTextRender();
  }
  function textToolbar(t, o) {
    var tools = "";
    if (o.low) {
      tools += '<button class="btn small" data-action="say-all">▶ 全文朗讀</button>';
      tools += '<button class="btn small" data-action="toggle-zhuyin" aria-pressed="' + view.zhuyin + '">' + (view.zhuyin ? "關閉注音" : "顯示注音") + "</button>";
      if (view.zhuyin) tools += '<span class="muted small" style="flex-basis:100%">注音是自動產生的，破音字可能標錯，請老師留意。</span>';
    } else if (o.pen) {
      tools += '<button class="btn small" data-action="toggle-pen" aria-pressed="' + view.pen + '">' + (view.pen ? "✎ 畫線中（點畫線可擦掉）" : "✎ 畫線筆") + "</button>";
    }
    if (o.close) tools += '<button class="btn small ghost" data-action="toggle-text">收起文章</button>';
    return '<div class="text-tools"><span class="title">〈' + esc(cleanTitle(t)) + "〉</span>" + tools + "</div>";
  }
  function afterTextRender() {
    var art = $("#article"); if (!art) return;
    if (view.zhuyin) {
      loadPinyin().then(function () { if ($("#article") === art) applyZhuyin(art); })
        .catch(function () { view.zhuyin = false; toast("注音需要網路連線，目前載入失敗"); });
    }
  }

  // ------------------------------------------------------------ quest
  function curQuest() { return questById(view.questId); }
  function curProgress() {
    var who = me(), quest = curQuest();
    if (!who.quests[quest.quest_id]) { who.quests[quest.quest_id] = newProgress(); save(); }
    return who.quests[quest.quest_id];
  }
  function stepIndex(step) { for (var i = 0; i < STEPS.length; i++) if (STEPS[i][0] === step) return i; return 0; }

  function renderQuest() {
    var quest = curQuest(), t = quest && TEXTS[quest.text_id];
    if (!quest || !t) { view.name = "map"; return render(); }
    var p = curProgress(), band = quest.grade_band;
    var stepNow = p.step === "remedial" ? "levels" : p.step, si = stepIndex(stepNow);
    var steps = '<ol class="steps">' + STEPS.map(function (s, i) {
      return '<li class="' + (i < si || p.finished ? "done" : i === si ? "now" : "") + '">' + s[1] + "</li>";
    }).join("") + "</ol>";
    var head = '<div class="sheet quest-head"><div class="spread"><div><span class="eyebrow">' + BAND_NAME[band] + "・" + esc(quest.genre || "") + "</span><h2>〈" + esc(quest.title) + "〉</h2></div>" +
      '<button class="btn ghost small" data-action="nav" data-view="map">← 闖關地圖</button></div>' + steps + "</div>";

    var inLevels = p.step === "levels" || p.step === "remedial" || p.step === "retry";
    if (view.showText === null) view.showText = band === "high";
    var showText = p.step === "read" || (inLevels && view.showText) || p.step === "done" && view.showText;
    var split = showText && p.step !== "read";
    var lockTr = inLevels;
    var textHTML = showText ?
      '<article class="sheet text-pane">' + textToolbar(t, { low: band === "low", pen: band !== "low", close: split }) +
      '<div class="article' + (band === "low" ? " big" : "") + (view.pen ? " pen-on" : "") + '" id="article">' +
      (band !== "low" && p.penHTML && !lockTr === !p.penLocked ? p.penHTML : renderMarkdown(t.student_text_markdown, { lockTranslation: lockTr, readAloud: band === "low" })) +
      "</div>" + (band === "high" ? '<div style="padding:0 22px 20px"><label class="field">我的筆記<textarea id="notes" placeholder="讀的時候想到的、還不懂的，都可以先記下來">' + esc(p.notes) + "</textarea></label></div>" : "") +
      "</article>" : "";
    var stage = '<section class="sheet stage" id="stage">' + stageHTML(quest, p, t) + "</section>";
    app.innerHTML = head + '<div class="workspace' + (split ? " split" : "") + '">' + (p.step === "read" ? textHTML + stage : textHTML + stage) + "</div>";
    if (showText) { p.penLocked = lockTr; afterTextRender(); highlightEvidence(); }
    var notes = $("#notes");
    if (notes) notes.addEventListener("input", function () { p.notes = notes.value; save(); });
  }

  function currentQuestion(quest, p) {
    if (p.step === "levels") { var qs = levelQs(quest, p.level); return qs[Math.min(p.cur, qs.length - 1)]; }
    if (p.step === "remedial") { var r = p.remedial; return remedialQs(quest, r)[Math.min(r.cur, r.qids.length - 1)]; }
    if (p.step === "retry") { var w = wrongQs(quest, p); return w[Math.min(p.retry.cur, w.length - 1)]; }
    return null;
  }
  function remedialQs(quest, r) {
    return r.qids.map(function (id) { return (quest.remedial_pool || []).filter(function (q) { return q.qid === id; })[0]; }).filter(Boolean);
  }
  function highlightEvidence() {
    var art = $("#article"); if (!art) return;
    art.querySelectorAll(".para.evidence").forEach(function (el) { el.classList.remove("evidence"); });
    var quest = curQuest(), p = curProgress(), q = currentQuestion(quest, p); if (!q) return;
    var ctx = p.step === "remedial" ? p.remedial : p.step === "retry" ? p.retry : p;
    var rec = ctx.answers[q.qid];
    if (!rec || !rec.picks.length || (rec.done && rec.first)) return;
    var firstHit = null;
    (q.evidence_paragraph || []).forEach(function (n) {
      var el = art.querySelector('.para[data-p="' + n + '"]');
      if (el) { el.classList.add("evidence"); firstHit = firstHit || el; }
    });
    if (firstHit && art.closest(".text-pane")) {
      var pane = art.closest(".text-pane");
      if (pane.scrollHeight > pane.clientHeight) pane.scrollTo({ top: firstHit.offsetTop - 60, behavior: "smooth" });
    }
  }

  function stageHTML(quest, p, t) {
    var band = quest.grade_band;
    switch (p.step) {
      case "intro":
        var n = quest.questions.length;
        return '<span class="eyebrow">任務說明</span><h2>這一關要讀〈' + esc(quest.title) + "〉，共四層，大約 " + BAND_MIN[band] + " 分鐘。</h2>" +
          '<div class="tablewrap"><table class="summary-table"><thead><tr><th>層次</th><th>要做的事</th><th>題數</th></tr></thead><tbody>' +
          [1, 2, 3, 4].map(function (L) {
            var c = levelQs(quest, L).length;
            var d = { 1: "找出文章裡寫明的資訊", 2: "把兩個以上的線索連起來推想", 3: "讀完全文，說出重點或整體", 4: "想一想作者怎麼寫、為什麼這樣寫" }[L];
            return '<tr><td><span class="chip lv lv-' + L + '">層次' + L + "・" + LEVELS[L] + "</span></td><td>" + d + '</td><td class="tnum">' + c + "</td></tr>";
          }).join("") + "</tbody></table></div>" +
          '<div class="callout">' + gateText(quest) + (band === "high" ? "使用提示後答對，該題只得一半分數。" : "使用提示不扣分。") +
          (band === "high" ? "一次做不完沒關係，進度會自動保存，可以分兩次完成。" : "") + "</div>" +
          '<div class="nav-row"><span class="muted small tnum">共 ' + n + " 題</span><button class=\"btn primary\" data-action=\"goto-step\" data-step=\"warm\">開始暖身</button></div>";
      case "warm":
        var w = quest.warm_up || { prompt: "看到標題，你猜文章會寫什麼？", options: [] };
        return '<span class="eyebrow">讀前暖身・不計分</span><h2 class="' + (band === "low" ? "stem big" : "") + '">' + esc(w.prompt) + (band === "low" ? sayBtn(w.prompt) : "") + "</h2>" +
          '<div class="choice-grid">' + w.options.map(function (o, i) {
            return '<button class="choice" data-action="warm" data-i="' + i + '" aria-pressed="' + (p.warm === i) + '">' + esc(o) + "</button>";
          }).join("") + "</div>" +
          '<div class="nav-row"><span class="muted small">讀完以後，網站會請你回頭看看自己猜得準不準。</span><button class="btn primary" data-action="goto-step" data-step="read"' + (p.warm === null ? " disabled" : "") + ">開始讀文章</button></div>";
      case "read":
        return '<span class="eyebrow">閱讀文本</span><h3>先把全文讀完</h3><p class="muted">' +
          (band === "low" ? "可以按「全文朗讀」聽一次，也可以打開注音。" : band === "middle" ? "看到表格要一欄一欄讀清楚。闖關時可以按「看文本」對照。" : "可以用畫線筆標出重要的句子，也可以寫筆記。闖關時文章會一直在旁邊。") +
          (t.student_text_markdown.indexOf("**語譯**") >= 0 ? "現在可以先看「語譯」，進入闖關後語譯會鎖住。" : "") +
          '</p><div class="nav-row"><span></span><button class="btn primary" data-action="read-done">我讀完了，開始闖關</button></div>';
      case "levels":
      case "remedial":
      case "retry":
        return questionStage(quest, p);
      case "done":
        return doneStage(quest, p);
    }
    return "";
  }
  function gateText(quest) {
    var rule = (quest.settings && quest.settings.unlock_rule) || "per_level_3_of_5";
    if (rule === "none") return "四層依序做完就過關。";
    if (rule === "levels_1_2_then_open") return "層次一、層次二各要「第一次就答對」五分之三，才會打開層次三、四；沒過的話先做三題補強關。";
    return "每一層要「第一次就答對」五分之三，才會打開下一層；沒過的話先做三題補強關。";
  }
  function sayBtn(text) { return ' <button class="btn small ghost" data-action="say" data-text="' + esc(text) + '" aria-label="朗讀">▶</button>'; }

  function questionStage(quest, p) {
    var band = quest.grade_band, kind = p.step, ctx, qs, idx, title, L;
    if (kind === "levels") { L = p.level; qs = levelQs(quest, L); idx = p.cur; ctx = p; title = "層次" + L + "・" + LEVELS[L]; }
    else if (kind === "remedial") { L = p.remedial.level; qs = remedialQs(quest, p.remedial); idx = p.remedial.cur; ctx = p.remedial; title = "補強關・層次" + L; }
    else { qs = wrongQs(quest, p); idx = p.retry.cur; ctx = p.retry; title = "錯題再挑戰"; L = qs[idx] ? qs[idx].level : 1; }
    // level / remedial / retry summary screen
    var allDone = qs.every(function (q) { var r = ctx.answers[q.qid]; return r && r.done; });
    if (kind === "levels" && allDone && p.levelResult[L] && p.levelResult[L].shown) return levelSummary(quest, p, L);
    if (kind === "remedial" && allDone && p.remedial.shown) return remedialSummary(quest, p);
    var q = qs[idx];
    if (!q) return '<p class="muted">這一層沒有題目。</p><div class="nav-row"><span></span><button class="btn primary" data-action="level-next">繼續</button></div>';
    var rec = ctx.answers[q.qid] || { picks: [] };
    var dots = '<div class="dots" role="list">' + qs.map(function (qq, i) {
      var r = ctx.answers[qq.qid], cls = i === idx ? "cur" : "";
      if (r && r.done) cls += r.first ? " ok" : r.correct ? " half" : " no";
      return '<button class="dot ' + cls + '" data-action="jump" data-i="' + i + '" aria-label="第 ' + (i + 1) + ' 題">' + (i + 1) + "</button>";
    }).join("") + "</div>";
    var opts = Object.keys(q.options).map(function (k) {
      var cls = rec.picks.indexOf(k) >= 0 && k !== q.answer ? "wrong" : "";
      if (rec.done && k === q.answer) cls = "right";
      var dis = rec.done || rec.picks.indexOf(k) >= 0;
      return '<button class="opt ' + cls + '" data-action="pick" data-k="' + k + '"' + (dis ? " disabled" : "") + '><span class="k">' + k + "</span><span>" + esc(q.options[k]) + "</span></button>";
    }).join("");
    var coach = coachHTML(quest, q, rec);
    var stemText = q.stem;
    var stem = '<p class="stem' + (band === "low" ? " big" : "") + '">' + inline(stemText) + (band === "low" ? sayBtn(stemText + "。" + Object.keys(q.options).map(function (k) { return k + "，" + q.options[k]; }).join("。")) : "") + "</p>";
    var lastIdx = idx >= qs.length - 1;
    var nextBtn = rec.done ? '<button class="btn primary" data-action="next-q">' + (lastIdx ? (allDone ? "看這一層的結果" : "回去做沒做完的題目") : "下一題") + "</button>" : "";
    var textBtn = !view.showText ? '<button class="btn small" data-action="toggle-text">' + (band === "low" ? "看文章" : "看文本") + "</button>" : "";
    var sub = q.sublevel ? '<span class="chip lv lv-4">' + (q.sublevel === "4A" ? "4A 語言形式" : "4B 寫作策略") + "</span>" : "";
    return '<div class="lvl-banner lv lv-' + L + '"><span class="lvl-name">' + title + "</span>" + sub +
      '<span class="muted small tnum" style="margin-left:auto">第 ' + (idx + 1) + " / " + qs.length + " 題</span></div>" + dots + stem +
      '<div class="opts' + (band === "low" ? " big" : "") + '">' + opts + "</div>" + coach +
      '<div class="nav-row">' + (textBtn || "<span></span>") + nextBtn + "</div>";
  }
  function coachHTML(quest, q, rec) {
    if (!rec.picks.length) return "";
    var wrongs = rec.picks.filter(function (k) { return k !== q.answer; });
    if (rec.done && rec.correct) {
      var msg = rec.first ? "答對了！" : "答對了！你回到文章找到線索了。";
      return '<div class="coach yes" role="status"><b>' + msg + "</b>" + (q.evidence_quote ? '<span class="small">文本依據：' + paraLabel(q.evidence_paragraph || []) + "「" + esc(q.evidence_quote) + "」</span>" : "") + "</div>";
    }
    if (rec.revealed) {
      return '<div class="coach reveal" role="status"><span class="ladder">第三次提示・看答案</span><b>正確答案是 ' + q.answer + "：" + esc(q.options[q.answer]) + "</b>" +
        '<span>文本依據：' + paraLabel(q.evidence_paragraph || []) + (q.evidence_quote ? "「" + esc(q.evidence_quote) + "」" : "") + "（已經幫你標亮）</span>" +
        '<span class="small muted">這一題記進錯題本，最後還有一次「錯題再挑戰」。</span></div>';
    }
    if (wrongs.length === 1) {
      return '<div class="coach hint" role="status"><span class="ladder">第一次提示・回到文章</span><b>' + esc(q.hint) + "</b>" +
        '<span class="small muted">' + paraLabel(q.evidence_paragraph || []) + "已經在文章裡標亮。" + (quest.settings && quest.settings.hint_costs_points ? "使用提示後答對，這題得一半分數。" : "") + "</span></div>";
    }
    var fb = (q.option_feedback || {})[wrongs[wrongs.length - 1]] || "再回到標亮的段落讀一次。";
    return '<div class="coach fb" role="status"><span class="ladder">第二次提示・看看你選的答案</span><b>' + esc(fb) + "</b>" +
      '<span class="small muted">' + esc(q.hint) + "</span></div>";
  }
  function levelSummary(quest, p, L) {
    var st = levelStats(quest, p, L), res = p.levelResult[L];
    var gate = levelNeedsGate(quest, L), need = threshold(st.n);
    var msg, btn;
    if (res.passed) {
      msg = gate ? "第一次就答對 " + st.first + " / " + st.n + " 題，達到門檻（" + need + " 題）。" : "這一層完成了，第一次就答對 " + st.first + " / " + st.n + " 題。";
      btn = L < 4 ? '<button class="btn primary" data-action="level-next">打開層次' + (L + 1) + "</button>" : '<button class="btn primary" data-action="level-next">完成四層</button>';
    } else {
      msg = "第一次就答對 " + st.first + " / " + st.n + " 題，還差 " + (need - st.first) + " 題才到門檻。先做補強關：三題答對兩題就能繼續。";
      btn = '<button class="btn primary" data-action="start-remedial">進入補強關</button>';
    }
    var badge = res.passed ? '<span class="seal pop" style="--c:var(--l' + L + ')">' + LEVEL_SHORT[L] + "<br>過關</span>" : '<span class="seal off">' + LEVEL_SHORT[L] + "</span>";
    return '<div class="row lv lv-' + L + '">' + badge + '<div class="stack" style="gap:4px;flex:1 1 220px"><span class="lvl-name">層次' + L + "・" + LEVELS[L] + "</span><p>" + msg + "</p></div></div>" +
      (quest.grade_band === "low" ? '<div class="stars">' + levelQs(quest, L).map(function (q) { var r = p.answers[q.qid]; return r && r.correct ? "★" : '<span class="off">★</span>'; }).join("") + "</div>" : "") +
      '<div class="nav-row"><button class="btn ghost" data-action="jump" data-i="0">回頭看這一層的題目</button>' + btn + "</div>";
  }
  function remedialSummary(quest, p) {
    var r = p.remedial, qs = remedialQs(quest, r), first = qs.filter(function (q) { var a = r.answers[q.qid]; return a && a.first; }).length;
    var ok = first >= Math.min(2, qs.length);
    return '<span class="eyebrow">補強關・層次' + r.level + '</span><h3>' + (ok ? "補強成功！" : "再試一次") + "</h3><p>第一次就答對 " + first + " / " + qs.length + " 題。" +
      (ok ? "層次" + r.level + "過關，可以繼續往下。" : "先回到文章，把標亮過的段落再讀一遍，再重新挑戰補強關。") + "</p>" +
      '<div class="nav-row"><span></span>' + (ok ? '<button class="btn primary" data-action="remedial-pass">繼續闖關</button>' : '<button class="btn primary" data-action="remedial-retry">重新挑戰補強關</button>') + "</div>";
  }

  function doneStage(quest, p) {
    var band = quest.grade_band, score = questScore(quest, p);
    var rows = [1, 2, 3, 4].map(function (L) {
      var st = levelStats(quest, p, L), res = p.levelResult[L] || {};
      return '<tr><td><span class="chip lv lv-' + L + '">層次' + L + "・" + LEVELS[L] + '</span></td><td class="tnum">' + st.first + " / " + st.n + "</td><td>" + (res.viaRemedial ? "補強後過關" : res.passed ? "過關" : "—") + "</td></tr>";
    }).join("");
    var w = quest.warm_up, warmBack = "";
    if (w && p.warm !== null) {
      warmBack = '<div class="stack" style="gap:8px"><h3>讀前你猜：「' + esc(w.options[p.warm]) + "」。你猜對了嗎？</h3>" +
        '<div class="row">' + ["猜對了", "猜對一部分", "沒猜到"].map(function (o, i) { return '<button class="choice" data-action="warm-check" data-i="' + i + '" aria-pressed="' + (p.warmCheck === i) + '">' + o + "</button>"; }).join("") + "</div></div>";
    }
    var rf = quest.reflection || { prompt: "這一關我覺得最難的是哪一層？", options: ["提取訊息", "推論分析", "詮釋整合", "評估與評論"] };
    var faces = { "很簡單": "(˙◡˙)", "剛剛好": "(˙_˙)", "有點難": "(˙︿˙)" };
    var refl = '<div class="stack" style="gap:8px"><h3>' + esc(rf.prompt) + "</h3><div class=\"choice-grid\">" + rf.options.map(function (o, i) {
      return '<button class="choice" data-action="reflect" data-i="' + i + '" aria-pressed="' + (p.reflection.choice === i) + '">' + (band === "low" && faces[o] ? '<span class="face" aria-hidden="true">' + faces[o] + "</span>" : "") + esc(o) + "</button>";
    }).join("") + "</div>" +
      (band === "high" ? '<label class="field">' + esc(rf.sentence_prompt || "下次遇到主旨題，我要先……") + '<input type="text" id="reflSentence" maxlength="60" value="' + esc(p.reflection.sentence) + '"></label>' : "") + "</div>";
    var allPassed = [1, 2, 3, 4].every(function (L) { return p.levelResult[L] && p.levelResult[L].passed; });
    var title = band === "high" && allPassed ? ([1, 2, 3, 4].every(function (L) { return !p.levelResult[L].viaRemedial; }) ? "閱讀策略家" : "四層闖關者") : "";
    var stars = band === "low" ? quest.questions.filter(function (q) { var r = p.answers[q.qid]; return r && r.correct; }).length : 0;
    return '<div class="spread"><div><span class="eyebrow">過關與反思</span><h2>〈' + esc(quest.title) + "〉闖關完成</h2></div>" +
      '<span class="seal pop" style="width:76px;height:76px;font-size:1.25rem">' + score + "<br>分</span></div>" +
      (band === "low" ? '<div class="stars" aria-label="得到 ' + stars + ' 顆星">' + quest.questions.map(function (q, i) { return i < stars ? "★" : '<span class="off">★</span>'; }).join("") + "</div>" : levelSeals(quest, p)) +
      (title ? '<p class="callout">得到稱號：<b>' + title + "</b></p>" : "") +
      '<div class="tablewrap"><table class="summary-table"><thead><tr><th>層次</th><th>第一次就答對</th><th>結果</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      warmBack + refl +
      '<div class="nav-row"><button class="btn" data-action="toggle-text">' + (view.showText ? "收起文章" : "再看一次文章") + '</button><button class="btn primary" data-action="finish">' + (me().classCode && p.submitState !== "done" ? (p.finished ? "繳交給老師" : "完成並繳交給老師") : p.finished ? "回闖關地圖" : "完成這一關") + "</button></div>";
  }

  // ------------------------------------------------------------ journey
  function allStats(profile) {
    var lv = { 1: [0, 0], 2: [0, 0], 3: [0, 0], 4: [0, 0] }, wrong = [], stars = 0, read = [], refl = [];
    Object.keys(profile.quests).forEach(function (qid) {
      var quest = questById(qid), p = profile.quests[qid]; if (!quest) return;
      quest.questions.forEach(function (q) {
        var r = p.answers[q.qid]; if (!r || !r.done) return;
        lv[q.level][1]++; if (r.first) lv[q.level][0]++;
        if (r.correct) stars++;
        if (!r.first) wrong.push({ quest: quest, q: q, rec: r, retry: p.retry.answers[q.qid] });
      });
      if (p.finished) {
        read.push(quest);
        if (p.reflection.choice !== null) refl.push({ quest: quest, r: p.reflection });
      }
    });
    return { lv: lv, wrong: wrong, stars: stars, read: read, refl: refl };
  }
  function radarSVG(rates) {
    var cx = 230, cy = 140, R = 100, pts = [], grid = "", axes = "", labels = "";
    var ang = function (i) { return -Math.PI / 2 + i * Math.PI / 2; };
    [0.25, 0.5, 0.75, 1].forEach(function (f) {
      grid += '<polygon points="' + [0, 1, 2, 3].map(function (i) { return (cx + Math.cos(ang(i)) * R * f).toFixed(1) + "," + (cy + Math.sin(ang(i)) * R * f).toFixed(1); }).join(" ") + '" fill="none" stroke="var(--rule-strong)" stroke-width="1"/>';
    });
    [0, 1, 2, 3].forEach(function (i) {
      var x = cx + Math.cos(ang(i)) * R, y = cy + Math.sin(ang(i)) * R;
      axes += '<line x1="' + cx + '" y1="' + cy + '" x2="' + x.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="var(--rule-strong)"/>';
      var v = rates[i];
      pts.push((cx + Math.cos(ang(i)) * R * v / 100).toFixed(1) + "," + (cy + Math.sin(ang(i)) * R * v / 100).toFixed(1));
      var lx = cx + Math.cos(ang(i)) * (R + 10), ly = cy + Math.sin(ang(i)) * (R + 16) + 4;
      var anchor = i === 1 ? "start" : i === 3 ? "end" : "middle";
      labels += '<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="' + anchor + '">' + LEVELS[i + 1] + " " + v + "%</text>";
    });
    var dots = pts.map(function (pt, i) { var xy = pt.split(","); return '<circle cx="' + xy[0] + '" cy="' + xy[1] + '" r="4" fill="var(--l' + (i + 1) + ')"/>'; }).join("");
    return '<svg class="radar" viewBox="0 0 460 290" width="100%" style="max-width:460px" role="img" aria-label="四層次第一次答對率雷達圖">' + grid + axes +
      '<polygon points="' + pts.join(" ") + '" fill="var(--accent)" fill-opacity=".18" stroke="var(--accent)" stroke-width="2"/>' + dots + labels + "</svg>";
  }
  function renderJourney() {
    var who = me(), band = bandOfGrade(who.grade), s = allStats(who);
    var rates = [1, 2, 3, 4].map(function (L) { return pct(s.lv[L][0], s.lv[L][1]); });
    var levelPanel;
    if (band === "high") levelPanel = '<div class="sheet panel"><h3>四層次雷達圖</h3><p class="muted small">各層次「第一次就答對」的比例。</p>' + radarSVG(rates) + "</div>";
    else levelPanel = '<div class="sheet panel"><h3>各層答對率</h3><div class="bars">' + [1, 2, 3, 4].map(function (L, i) {
      return '<div class="bar-row lv lv-' + L + '"><span>' + LEVELS[L] + '</span><div class="bar-track"><div class="bar-fill" style="width:' + rates[i] + '%"></div></div><span class="tnum">' + rates[i] + "%</span></div>";
    }).join("") + "</div></div>";
    var badges = '<div class="sheet panel"><h3>' + (band === "low" ? "星星收集冊" : "徽章進度") + "</h3>" +
      (band === "low" ?
        '<p class="tnum">已收集 <b>' + s.stars + "</b> 顆星。每 5 顆星換一張角色貼紙。</p>" +
        '<div class="row">' + STICKERS.map(function (c, i) { return '<span class="sticker' + (s.stars >= (i + 1) * 5 ? "" : " off") + '">' + c + "</span>"; }).join("") + "</div>" :
        Object.keys(who.quests).map(function (qid) {
          var quest = questById(qid); if (!quest) return "";
          return '<div class="spread"><span>〈' + esc(quest.title) + "〉</span>" + levelSeals(quest, who.quests[qid], true) + "</div>";
        }).join("") || '<p class="muted">還沒有徽章，先去闖一關吧。</p>') + "</div>";
    var shelf = '<div class="sheet panel"><h3>讀過的書架</h3><div class="shelf">' + (s.read.length ? s.read.map(function (q, i) {
      return '<span class="book" style="--c:var(--l' + (i % 4 + 1) + ')">' + esc(q.title) + "</span>";
    }).join("") : '<span class="muted small">完成第一關後，書會放上來。</span>') + "</div></div>";
    var wrong = '<div class="sheet panel"><h3>錯題本</h3>' + (s.wrong.length ? s.wrong.map(function (w) {
      var fixed = w.retry && w.retry.first;
      return '<div class="wrong-item"><div class="row" style="gap:6px"><span class="chip lv lv-' + w.q.level + '">' + LEVELS[w.q.level] + '</span><span class="muted small">〈' + esc(w.quest.title) + "〉</span>" +
        (fixed ? '<span class="chip" style="color:var(--good);border-color:var(--good)">再挑戰答對</span>' : "") + "</div><span>" + esc(w.q.stem) + '</span><span class="small muted">答案：' + w.q.answer + "　" + esc(w.q.options[w.q.answer]) + "　依據：" + paraLabel(w.q.evidence_paragraph || []) + "</span></div>";
    }).join("") : '<p class="muted">目前沒有錯題。</p>') + "</div>";
    var refl = band !== "low" ? '<div class="sheet panel"><h3>反思紀錄</h3>' + (s.refl.length ? s.refl.map(function (r) {
      var quest = r.quest, rf = quest.reflection || { options: [] };
      return '<div class="wrong-item"><span class="muted small">〈' + esc(quest.title) + "〉" + esc(rf.prompt || "") + "</span><span>" + esc(rf.options[r.r.choice] || "") + (r.r.sentence ? "；" + esc(r.r.sentence) : "") + "</span></div>";
    }).join("") : '<p class="muted">完成關卡後的反思會記在這裡。</p>') + "</div>" : "";
    app.innerHTML = '<div class="stack"><div class="sheet panel"><span class="eyebrow">我的歷程</span><h1>' + esc(who.name) + ' 的閱讀紀錄</h1><p class="muted">完成 ' + s.read.length + " 關。</p></div>" +
      '<div class="two-col">' + levelPanel + badges + (band === "low" ? shelf : "") + wrong + refl + (band !== "low" ? shelf : "") + "</div></div>";
  }

  // ------------------------------------------------------------ teacher
  function renderTeacher() {
    var tabs = [["class", "線上班級"], ["dash", "全班儀表板"], ["quests", "題組與解析"], ["import", "匯入題組"], ["export", "匯出紀錄"]];
    var body = { "class": teacherClass, dash: teacherDash, quests: teacherQuests, "import": teacherImport, "export": teacherExport }[view.teacherTab]();
    app.innerHTML = '<div class="stack"><div class="sheet panel"><span class="eyebrow">教師端</span><h1>班級與題組</h1>' +
      '<p class="muted">建立線上班級後，學生掃 QR code 登入闖關，完成後把闖關歷程繳交到這裡。命題意圖、可能迷思和教學重點只在教師端出現。</p>' +
      '<div class="tabs" role="tablist">' + tabs.map(function (t) { return '<button role="tab" data-action="tteab" data-tab="' + t[0] + '" aria-selected="' + (view.teacherTab === t[0]) + '">' + t[1] + "</button>"; }).join("") + "</div></div>" + body + "</div>";
    var f = $("#importFile");
    if (f) f.addEventListener("change", function () {
      var file = f.files[0]; if (!file) return;
      var rd = new FileReader(); rd.onload = function () { $("#importText").value = rd.result; }; rd.readAsText(file);
    });
  }
  function teacherDash() {
    var onlineProfs = view.dashSource && view.dashSource !== "local" && onlineProfiles(view.dashSource);
    var profs = onlineProfs || store.profiles, ids = Object.keys(profs);
    var srcBar = dashSourceBar();
    if (!ids.length) return srcBar + '<div class="sheet empty"><h3>還沒有學生紀錄</h3><p>學生在這台裝置登入並作答後，會出現在這裡。</p><p style="margin-top:12px"><button class="btn" data-action="demo-class">載入示範班級資料</button></p></div>';
    var rows = ids.map(function (id) {
      var pr = profs[id], s = allStats(pr);
      var done = Object.keys(pr.quests).filter(function (k) { return pr.quests[k].finished; }).length;
      var stuck = "—";
      Object.keys(pr.quests).forEach(function (qid) {
        var p = pr.quests[qid]; if (p.finished) return;
        if (p.step === "remedial") stuck = "層次" + p.remedial.level + "（補強關）";
        else if (p.step === "levels") stuck = "層次" + p.level;
      });
      return "<tr><td>" + esc(pr.name) + (pr.demo ? ' <span class="chip">示範</span>' : "") + '</td><td class="tnum">' + pr.grade + '</td><td class="tnum">' + done + "</td>" +
        [1, 2, 3, 4].map(function (L) { return '<td class="tnum">' + (s.lv[L][1] ? pct(s.lv[L][0], s.lv[L][1]) + "%" : "—") + "</td>"; }).join("") + "<td>" + stuck + "</td></tr>";
    }).join("");
    // error ranking
    var stat = {};
    ids.forEach(function (id) {
      var pr = profs[id];
      Object.keys(pr.quests).forEach(function (qid) {
        var quest = questById(qid); if (!quest) return; var p = pr.quests[qid];
        quest.questions.forEach(function (q) {
          var r = p.answers[q.qid]; if (!r || !r.done) return;
          var k = qid + "|" + q.qid, e = stat[k] || (stat[k] = { quest: quest, q: q, n: 0, wrong: 0, picks: {} });
          e.n++; if (!r.first) { e.wrong++; var wp = r.picks.filter(function (x) { return x !== q.answer; })[0]; if (wp) e.picks[wp] = (e.picks[wp] || 0) + 1; }
        });
      });
    });
    var rank = Object.keys(stat).map(function (k) { return stat[k]; }).filter(function (e) { return e.wrong; })
      .sort(function (a, b) { return b.wrong / b.n - a.wrong / a.n || b.wrong - a.wrong; }).slice(0, 5);
    var rankHTML = rank.length ? rank.map(function (e) {
      var top = Object.keys(e.picks).sort(function (a, b) { return e.picks[b] - e.picks[a]; })[0];
      return '<div class="teacher-q"><div class="row" style="gap:6px"><span class="chip lv lv-' + e.q.level + '">層次' + e.q.level + '</span><span class="muted small">〈' + esc(e.quest.title) + "〉" + e.q.qid + '</span><span class="chip tnum">錯誤率 ' + pct(e.wrong, e.n) + "%（" + e.wrong + "/" + e.n + "）</span></div>" +
        "<span>" + esc(e.q.stem) + "</span><dl><dt>最多人選</dt><dd>" + (top ? top + "　" + esc(e.q.options[top]) : "—") + "</dd><dt>可能迷思</dt><dd>" + esc(e.q.teacher.misconception) + "</dd><dt>課堂延伸</dt><dd>" + esc(e.q.teacher.teaching_point) + "</dd></dl></div>";
    }).join("") : '<p class="muted">還沒有錯題資料。</p>';
    // needs help: remedial used on the same level in two or more quests
    var help = ids.map(function (id) {
      var pr = profs[id], cnt = {};
      Object.keys(pr.quests).forEach(function (qid) {
        var p = pr.quests[qid];
        Object.keys(p.levelResult).forEach(function (L) { if (p.levelResult[L].viaRemedial || p.levelResult[L].failedGate) cnt[L] = (cnt[L] || 0) + 1; });
      });
      var lv = Object.keys(cnt).filter(function (L) { return cnt[L] >= 2; });
      return lv.length ? "<li>" + esc(pr.name) + "：層次" + lv.join("、") + " 有兩關以上沒過門檻</li>" : "";
    }).join("");
    return srcBar + '<div class="sheet panel"><div class="spread"><h3>學生進度</h3>' + (online ? "" : '<span class="row"><button class="btn small" data-action="demo-class">載入示範班級資料</button><button class="btn small ghost" data-action="clear-demo">移除示範資料</button></span>') + "</div>" +
      '<div class="tablewrap"><table class="summary-table"><thead><tr><th>學生</th><th>年級</th><th>完成關卡</th><th>層次一</th><th>層次二</th><th>層次三</th><th>層次四</th><th>卡在哪裡</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      '<p class="muted small">各層次數字為「第一次就答對」的比例。</p></div>' +
      '<div class="two-col"><div class="sheet panel"><h3>錯題排行（前 5 題）</h3>' + rankHTML + '</div><div class="sheet panel"><h3>需要協助名單</h3>' + (help ? "<ul>" + help + "</ul>" : '<p class="muted">目前沒有學生在同一層連續兩關沒過門檻。</p>') + "</div></div>";
  }
  function teacherQuests() {
    var q = questById(view.teacherQuest) || QUESTS[0];
    if (!q) return '<div class="sheet empty">還沒有題組。</div>';
    var t = TEXTS[q.text_id];
    var sel = '<select id="tqSel" data-action="tq-select">' + QUESTS.map(function (x) { return '<option value="' + esc(x.quest_id) + '"' + (x === q ? " selected" : "") + ">" + BAND_NAME[x.grade_band] + "〈" + esc(x.title) + "〉" + x.questions.length + " 題</option>"; }).join("") + "</select>";
    var notes = t && t.teacher_notes && t.teacher_notes.length ? '<div class="callout"><b>推理關鍵（教師用）</b><br>' + t.teacher_notes.map(esc).join("<br>") + "</div>" : "";
    var structure = t && t.structure_note ? '<p class="muted small">結構對照：' + esc(t.structure_note) + "</p>" : "";
    function qBlock(x) {
      return '<div class="teacher-q"><div class="row" style="gap:6px"><b>' + x.qid + '</b><span class="chip lv lv-' + x.level + '">層次' + x.level + (x.sublevel ? " " + x.sublevel : "") + "・" + LEVELS[x.level] + "</span>" + (x.for_level ? '<span class="chip">補強層次' + x.for_level + "</span>" : "") + "</div>" +
        "<span>" + esc(x.stem) + '</span><span class="small">' + Object.keys(x.options).map(function (k) { return (k === x.answer ? "<b>" : "") + k + ". " + esc(x.options[k]) + (k === x.answer ? "</b>" : ""); }).join("　") + "</span>" +
        "<dl><dt>正確答案</dt><dd>" + x.answer + "</dd><dt>文本依據</dt><dd>" + paraLabel(x.evidence_paragraph || []) + (x.evidence_quote ? "「" + esc(x.evidence_quote) + "」" : "") + "</dd>" +
        "<dt>命題意圖</dt><dd>" + esc(x.teacher.intent) + "</dd><dt>可能迷思</dt><dd>" + esc(x.teacher.misconception) + "</dd><dt>教學重點</dt><dd>" + esc(x.teacher.teaching_point) + "</dd></dl></div>";
    }
    return '<div class="sheet panel"><div class="row"><label class="field" style="flex:1 1 280px">題組' + sel + "</label></div>" + structure + notes +
      "<h3>正式題目</h3>" + q.questions.map(qBlock).join("") +
      ((q.remedial_pool || []).length ? "<h3>補強關題庫</h3>" + q.remedial_pool.map(qBlock).join("") : "") + "</div>";
  }
  function teacherImport() {
    var imported = store.imported.quests.map(function (q) { return "<li>〈" + esc(q.title) + "〉" + esc(q.quest_id) + ' <button class="btn small ghost" data-action="remove-import" data-id="' + esc(q.quest_id) + '">移除</button></li>'; }).join("");
    return '<div class="sheet panel"><h3>匯入題組或文章 JSON</h3>' +
      '<p class="muted">貼上 reading-literacy-quest 輸出的「關卡 JSON」（單一關卡、或關卡陣列），或文章庫格式 <code>{"version":1,"texts":[...]}</code>。text_id 必須對得上文章庫裡的文章。</p>' +
      '<label class="field">選擇 .json 檔<input type="file" id="importFile" accept=".json,application/json"></label>' +
      '<label class="field">或直接貼上<textarea id="importText" style="min-height:180px;font-family:ui-monospace,monospace;font-size:.82rem" placeholder="{ &quot;quest_id&quot;: &quot;h01-q1&quot;, &quot;text_id&quot;: &quot;h01&quot;, ... }"></textarea></label>' +
      '<div class="row"><button class="btn primary" data-action="do-import">檢查並匯入</button></div><div id="importMsg"></div>' +
      (imported ? "<h3>已匯入的題組</h3><ul>" + imported + "</ul>" : "") + "</div>";
  }
  function teacherExport() {
    var data = JSON.stringify({ exported: new Date().toISOString(), profiles: store.profiles }, null, 1);
    return '<div class="sheet panel"><h3>匯出學習紀錄</h3><p class="muted">複製下面的 JSON 存檔，可以帶到別台電腦彙整。</p><pre class="json" id="exportBox">' + esc(data) + '</pre><div class="row"><button class="btn" data-action="copy-export">複製</button></div></div>';
  }
  function validateQuest(q) {
    var errs = [];
    if (!q || typeof q !== "object") return ["不是物件"];
    ["quest_id", "text_id", "title", "grade_band", "questions"].forEach(function (k) { if (!q[k]) errs.push("缺少 " + k); });
    if (q.grade_band && !BAND_NAME[q.grade_band]) errs.push("grade_band 必須是 low、middle 或 high");
    (q.questions || []).concat(q.remedial_pool || []).forEach(function (x, i) {
      var tag = (x.qid || "第" + (i + 1) + "題") + "：";
      if (!(x.level >= 1 && x.level <= 4)) errs.push(tag + "level 要是 1–4");
      if (!x.options || Object.keys(x.options).length !== 4) errs.push(tag + "要有四個選項");
      else if (!x.options[x.answer]) errs.push(tag + "answer 不在選項裡");
      if (!x.teacher) errs.push(tag + "缺少 teacher 欄位");
      if (!x.hint) errs.push(tag + "缺少 hint");
    });
    if (q.text_id && !TEXTS[q.text_id]) errs.push("文章庫裡找不到 text_id「" + q.text_id + "」，請先匯入文章");
    return errs;
  }
  function doImport() {
    var msg = $("#importMsg"), raw = $("#importText").value.trim(), data;
    try { data = JSON.parse(raw); } catch (e) { msg.innerHTML = '<p class="callout" style="border-color:var(--bad)">JSON 格式有誤：' + esc(e.message) + "。常見原因是英文雙引號沒有跳脫。</p>"; return; }
    if (data && data.texts) {
      var n = 0;
      data.texts.forEach(function (t) { if (t.id && t.student_text_markdown) { store.imported.texts = store.imported.texts.filter(function (x) { return x.id !== t.id; }); store.imported.texts.push(t); n++; } });
      save(); rebuildData(); msg.innerHTML = '<p class="callout">匯入 ' + n + " 篇文章。</p>"; return;
    }
    var list = Array.isArray(data) ? data : [data], ok = [], bad = [];
    list.forEach(function (q) {
      var errs = validateQuest(q);
      if (errs.length) bad.push("〈" + esc(q && q.title || "?") + "〉" + errs.map(esc).join("；"));
      else ok.push(q);
    });
    ok.forEach(function (q) {
      q.remedial_pool = q.remedial_pool || [];
      store.imported.quests = store.imported.quests.filter(function (x) { return x.quest_id !== q.quest_id; });
      store.imported.quests.push(q);
    });
    save(); rebuildData();
    msg.innerHTML = (ok.length ? '<p class="callout">匯入 ' + ok.length + " 個題組：" + ok.map(function (q) { return "〈" + esc(q.title) + "〉"; }).join("") + "。學生的闖關地圖已經看得到。</p>" : "") +
      (bad.length ? '<p class="callout" style="border-color:var(--bad)">沒有匯入：<br>' + bad.join("<br>") + "</p>" : "");
    if (ok.length) { var keep = msg.innerHTML; render(); $("#importMsg").innerHTML = keep; }
  }
  function loadDemoClass() {
    var names = [["示範・王小明", 5, 0.85], ["示範・林佳穎", 5, 0.6], ["示範・陳柏宇", 6, 0.4], ["示範・張雅婷", 4, 0.7]];
    var seed = 7; function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    names.forEach(function (n, si) {
      var id = "demo" + si, pr = { id: id, name: n[0], grade: n[1], created: Date.now(), quests: {}, demo: true };
      QUESTS.filter(function (q) { return q.grade_band !== "low"; }).forEach(function (quest) {
        var p = newProgress(); p.step = "done"; p.finished = Date.now(); p.warm = 0; p.reflection.choice = Math.floor(rnd() * 4);
        quest.questions.forEach(function (q) {
          var skill = n[2] - (q.level - 1) * 0.08, ctx = p;
          var keys = Object.keys(q.options).filter(function (k) { return k !== q.answer; });
          var tries = rnd() < skill ? 0 : rnd() < 0.6 ? 1 : rnd() < 0.5 ? 2 : 3;
          for (var i = 0; i < tries; i++) recordPick(ctx, q, keys[(i + si) % 3], quest, "main");
          if (tries < 3) recordPick(ctx, q, q.answer, quest, "main");
        });
        [1, 2, 3, 4].forEach(function (L) {
          var st = levelStats(quest, p, L), pass = !levelNeedsGate(quest, L) || st.first >= threshold(st.n);
          p.levelResult[L] = { passed: true, viaRemedial: !pass, failedGate: !pass, shown: true };
        });
        pr.quests[quest.quest_id] = p;
      });
      store.profiles[id] = pr;
    });
    save(); render(); toast("已載入 4 位示範學生");
  }

  // ------------------------------------------------------------ online class (Google Apps Script backend)
  var CONFIG = window.RLQ_CONFIG || {};
  store.teacher = store.teacher || { api: "", key: "", site: "" };
  var online = { classes: null, subs: {}, loading: false, error: "", joinClass: null, joinError: "" };
  function apiUrl() { return (store.api || CONFIG.apiUrl || store.teacher.api || "").trim(); }
  function teacherApi() { return (store.teacher.api || CONFIG.apiUrl || "").trim(); }
  var API_ERR = {
    class_not_found: "找不到這個班級代碼，請再確認一次。",
    quest_not_assigned: "這一關不是老師指派的關卡。",
    wrong_key: "教師密碼不對。",
    missing_fields: "座號、姓名或關卡沒有填。",
    missing_name: "請輸入班級名稱。",
    missing_quests: "請至少勾選一個關卡。",
    record_too_large: "紀錄太大，無法繳交。",
    no_api: "還沒有設定繳交伺服器網址。"
  };
  function apiErrText(e) {
    var m = e && e.message || String(e);
    return API_ERR[m] || (/fetch|network|Load failed/i.test(m) ? "連不上繳交伺服器，請檢查網路後再試一次。" : "發生錯誤：" + m);
  }
  function viaScriptRun(req) {
    // inside the Apps Script web app: call the server directly, no CORS involved
    return new Promise(function (res, rej) {
      google.script.run.withSuccessHandler(function (d) { if (d && d.ok) res(d); else rej(new Error(d && d.error || "unknown")); })
        .withFailureHandler(function (e) { rej(new Error(e && e.message || "network")); }).rpc(req);
    });
  }
  var hasScriptRun = !!(window.google && google.script && google.script.run);
  function apiGet(base, params) {
    if (hasScriptRun) return viaScriptRun(params);
    if (!base) return Promise.reject(new Error("no_api"));
    var qs = Object.keys(params).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]); }).join("&");
    return fetch(base + (base.indexOf("?") >= 0 ? "&" : "?") + qs, { redirect: "follow" })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (!d.ok) throw new Error(d.error || "unknown"); return d; });
  }
  function apiPost(base, body) {
    if (hasScriptRun) return viaScriptRun(body);
    if (!base) return Promise.reject(new Error("no_api"));
    // text/plain keeps this a simple request, so Apps Script needs no CORS preflight
    return fetch(base, { method: "POST", body: JSON.stringify(body), redirect: "follow" })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (!d.ok) throw new Error(d.error || "unknown"); return d; });
  }
  function siteBase() {
    if (store.teacher.site) return store.teacher.site.trim();
    if (CONFIG.siteUrl) return CONFIG.siteUrl;
    if (/^https?:/.test(location.protocol) && !/claude\.ai|claudeusercontent/.test(location.host)) return location.origin + location.pathname;
    return "";
  }
  function joinLink(code) {
    var base = siteBase(); if (!base) return "";
    var link = base + (base.indexOf("?") >= 0 ? "&" : "?") + "c=" + encodeURIComponent(code);
    if (!CONFIG.apiUrl && teacherApi()) link += "&api=" + encodeURIComponent(teacherApi());
    return link;
  }
  function qrSVG(text, cell) {
    if (!window.qrcode || !text) return "";
    var qr = window.qrcode(0, "M"); qr.addData(text); qr.make();
    return qr.createSvgTag({ cellSize: cell || 4, margin: 2, scalable: true });
  }

  // ----- student: join by QR / code
  function readLaunchParams() {
    try {
      var q = new URLSearchParams(location.search), c = q.get("c") || (window.RLQ_LAUNCH && window.RLQ_LAUNCH.c), a = q.get("api");
      if (a) { store.api = a; save(); }
      if (c) { view.name = "join"; view.joinCode = c.trim().toUpperCase(); }
    } catch (e) { /* no query access */ }
  }
  function renderJoin() {
    var code = view.joinCode || "";
    if (!online.joinClass || online.joinClass.code !== code) {
      if (!online.joinError) {
        app.innerHTML = '<section class="sheet panel" style="max-width:560px;margin:0 auto"><span class="eyebrow">加入班級</span><h1>正在找班級 ' + esc(code) + "…</h1></section>";
        apiGet(apiUrl(), { action: "class", code: code }).then(function (d) {
          online.joinClass = d["class"]; online.joinError = ""; if (view.name === "join") render();
        }, function (e) { online.joinError = apiErrText(e); if (view.name === "join") render(); });
        return;
      }
      app.innerHTML = '<section class="sheet panel" style="max-width:560px;margin:0 auto"><span class="eyebrow">加入班級</span><h1>沒辦法加入 ' + esc(code) + "</h1><p>" + esc(online.joinError) + "</p>" +
        '<div class="row"><button class="btn primary" data-action="join-retry">再試一次</button><button class="btn ghost" data-action="nav" data-view="profile">改用其他方式登入</button></div></section>';
      return;
    }
    var c = online.joinClass;
    var titles = c.quests.map(function (id) { var q = questById(id); return q ? "〈" + esc(q.title) + "〉" : esc(id); }).join("、");
    app.innerHTML = '<section class="sheet panel" style="max-width:560px;margin:0 auto"><span class="eyebrow">加入班級・' + esc(c.code) + "</span><h1>" + esc(c.name) + "</h1>" +
      '<p class="muted">老師指派的關卡：' + titles + "</p>" +
      '<form id="joinForm" class="stack" autocomplete="off"><div class="row">' +
      '<label class="field" style="flex:1 1 100px">座號<input type="text" id="jSeat" inputmode="numeric" maxlength="4" required placeholder="例如 12"></label>' +
      '<label class="field" style="flex:2 1 180px">姓名<input type="text" id="jName" maxlength="20" required placeholder="你的名字"></label></div>' +
      '<div><button class="btn primary" type="submit">開始闖關</button></div></form>' +
      '<p class="muted small">闖關紀錄會先存在這台裝置，完成後按「繳交」送給老師。</p></section>';
    $("#joinForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var seat = $("#jSeat").value.trim(), name = $("#jName").value.trim(); if (!seat || !name) return;
      var id = "c_" + c.code + "_" + seat, pr = store.profiles[id];
      if (!pr) pr = store.profiles[id] = { id: id, quests: {}, created: Date.now() };
      pr.name = name; pr.seat = seat; pr.grade = c.grade || 5; pr.classCode = c.code; pr.className = c.name; pr.assigned = c.quests.slice();
      store.current = id; save();
      try { history.replaceState(null, "", location.pathname); } catch (err) { /* ignore */ }
      view.name = "map"; render(); toast("歡迎，" + seat + " 號 " + name + "！");
    });
  }

  // ----- student: submit
  function buildRecord(quest, p) {
    var levels = {};
    [1, 2, 3, 4].forEach(function (L) {
      var st = levelStats(quest, p, L), res = p.levelResult[L] || {};
      levels[L] = { first: st.first, n: st.n, passed: !!res.passed, viaRemedial: !!res.viaRemedial };
    });
    var rf = quest.reflection || { options: [] };
    var reflText = (p.reflection.choice !== null && rf.options[p.reflection.choice] || "") + (p.reflection.sentence ? "；" + p.reflection.sentence : "");
    return {
      questId: quest.quest_id, title: quest.title, score: questScore(quest, p), levels: levels,
      wrongCount: wrongQs(quest, p).length, answers: p.answers, levelResult: p.levelResult,
      remedial: p.remedial, retry: { answers: p.retry.answers }, warm: p.warm, warmCheck: p.warmCheck,
      reflection: p.reflection, reflectionText: reflText, notes: p.notes, started: p.started, finished: p.finished
    };
  }
  function submitQuest(questId) {
    var who = me(), quest = questById(questId), p = who && who.quests[questId];
    if (!who || !who.classCode || !quest || !p || !p.finished) return;
    p.submitState = "sending"; p.submitError = ""; save(); render();
    apiPost(apiUrl(), { action: "submit", code: who.classCode, seat: who.seat, name: who.name, questId: questId, record: buildRecord(quest, p) })
      .then(function (d) { p.submitState = "done"; p.submittedAt = d.at || new Date().toISOString(); save(); render(); toast("已繳交給老師！"); },
        function (e) { p.submitState = "error"; p.submitError = apiErrText(e); save(); render(); toast("繳交沒有成功：" + p.submitError); });
  }
  function submitChip(p) {
    if (!p || !p.finished) return "";
    if (p.submitState === "done") return '<span class="chip" style="color:var(--good);border-color:var(--good)">已繳交</span>';
    if (p.submitState === "sending") return '<span class="chip">繳交中…</span>';
    if (p.submitState === "error") return '<span class="chip" style="color:var(--bad);border-color:var(--bad)">繳交失敗</span>';
    return '<span class="chip" style="color:var(--l3);border-color:var(--l3)">還沒繳交</span>';
  }

  // ----- teacher: online class
  function fmtTime(t) {
    if (!t) return "";
    var d = new Date(t); if (isNaN(d)) return String(t);
    return (d.getMonth() + 1) + "/" + d.getDate() + " " + ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
  }
  function loadClasses() {
    online.loading = true; online.error = ""; render();
    apiGet(teacherApi(), { action: "classes", key: store.teacher.key }).then(function (d) {
      online.classes = d.classes; online.loading = false; render();
    }, function (e) { online.loading = false; online.error = apiErrText(e); render(); });
  }
  function loadSubs(code) {
    online.loading = true; online.error = ""; render();
    apiGet(teacherApi(), { action: "list", code: code, key: store.teacher.key }).then(function (d) {
      online.subs[code] = d.submissions; online.loading = false; render();
    }, function (e) { online.loading = false; online.error = apiErrText(e); render(); });
  }
  function classByCode(code) { return (online.classes || []).filter(function (c) { return c.code === code; })[0]; }
  function onlineProfiles(code) {
    var subs = online.subs[code]; if (!subs) return null;
    var cls = classByCode(code) || {}, out = {};
    subs.forEach(function (s) {
      var id = "seat" + s.seat, pr = out[id] || (out[id] = { id: id, name: s.seat + " 號 " + s.name, grade: cls.grade || 5, quests: {} });
      var r = s.record || {};
      pr.quests[s.questId] = { answers: r.answers || {}, levelResult: r.levelResult || {}, retry: r.retry || { answers: {} }, reflection: r.reflection || { choice: null },
        remedial: r.remedial, finished: r.finished || 1, step: "done", level: 4 };
    });
    return out;
  }
  function dashSourceBar() {
    var opts = [["local", "這台裝置的學生"]].concat((online.classes || []).filter(function (c) { return online.subs[c.code]; }).map(function (c) { return [c.code, "線上班級：" + c.name]; }));
    if (opts.length < 2) return '<p class="muted small">目前顯示這台裝置的學生。到「線上班級」讀取繳交紀錄後，就能在這裡切換成全班的資料。</p>';
    return '<div class="row"><label class="field" style="flex:0 1 320px">資料來源<select id="dashSrc">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (view.dashSource === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select></label></div>";
  }
  function teacherClass() {
    var t = store.teacher, connected = !!teacherApi() && !!t.key;
    var setup = '<div class="sheet panel"><div class="spread"><h3>繳交伺服器設定</h3>' + (connected ? '<span class="chip" style="color:var(--good);border-color:var(--good)">已設定</span>' : '<span class="chip">尚未設定</span>') + "</div>" +
      '<p class="muted small">第一次使用：照著 backend/README.md 建立 Google 試算表與 Apps Script，把部署後的網址和你設定的教師密碼填在這裡。這些只存在這台電腦。</p>' +
      '<form id="setupForm" class="stack" autocomplete="off"><div class="row">' +
      '<label class="field" style="flex:2 1 300px">Apps Script 網址<input type="text" id="tApi" value="' + esc(t.api || CONFIG.apiUrl || "") + '" placeholder="https://script.google.com/macros/s/…/exec"></label>' +
      '<label class="field" style="flex:1 1 160px">教師密碼<input type="password" id="tKey" value="' + esc(t.key) + '"></label></div>' +
      '<label class="field">學生用的網站網址（QR code 會連到這裡）<input type="text" id="tSite" value="' + esc(t.site || siteBase()) + '" placeholder="例如 https://你的帳號.github.io/reading-site/"></label>' +
      '<div class="row"><button class="btn primary" type="submit">儲存並讀取班級</button></div></form></div>';
    if (!connected) return setup;
    var err = online.error ? '<p class="callout" style="border-color:var(--bad)">' + esc(online.error) + "</p>" : "";
    var create = '<div class="sheet panel"><h3>建立班級</h3><form id="classForm" class="stack" autocomplete="off"><div class="row">' +
      '<label class="field" style="flex:2 1 220px">班級名稱<input type="text" id="cName" maxlength="40" required placeholder="例如：五年二班 閱讀闖關"></label>' +
      '<label class="field" style="flex:1 1 120px">年級<select id="cGrade">' + [1, 2, 3, 4, 5, 6].map(function (g) { return '<option value="' + g + '"' + (g === 5 ? " selected" : "") + ">" + g + " 年級</option>"; }).join("") + "</select></label></div>" +
      '<fieldset class="stack" style="border:0;padding:0;margin:0;gap:6px"><legend class="small" style="font-weight:500;margin-bottom:4px">指派關卡</legend>' +
      QUESTS.map(function (q) { return '<label class="row" style="gap:8px"><input type="checkbox" name="cQuest" value="' + esc(q.quest_id) + '"> ' + BAND_NAME[q.grade_band] + "〈" + esc(q.title) + "〉" + q.questions.length + " 題</label>"; }).join("") +
      '</fieldset><div><button class="btn primary" type="submit">建立並產生 QR code</button></div></form></div>';
    var list = online.classes === null ? '<p class="muted">' + (online.loading ? "讀取中…" : "還沒讀取。") + "</p>" :
      online.classes.length ? '<div class="tablewrap"><table class="summary-table"><thead><tr><th>班級</th><th>代碼</th><th>指派關卡</th><th></th></tr></thead><tbody>' +
        online.classes.map(function (c) {
          return "<tr><td>" + esc(c.name) + '</td><td class="tnum"><b>' + esc(c.code) + "</b></td><td>" + c.quests.map(function (id) { var q = questById(id); return q ? "〈" + esc(q.title) + "〉" : esc(id); }).join("") + "</td>" +
            '<td><button class="btn small' + (view.cls === c.code ? " primary" : "") + '" data-action="pick-class" data-code="' + esc(c.code) + '">打開</button></td></tr>';
        }).join("") + "</tbody></table></div>" : '<p class="muted">還沒有班級，先在上面建立一個。</p>';
    var classes = '<div class="sheet panel"><div class="spread"><h3>我的班級</h3><button class="btn small" data-action="load-classes">重新整理</button></div>' + list + "</div>";
    return err + classPanel() + create + classes + '<details class="sheet panel"><summary>繳交伺服器設定</summary>' + setup.replace('<div class="sheet panel">', "<div>") + "</details>";
  }
  function classPanel() {
    var c = classByCode(view.cls); if (!c) return "";
    var link = joinLink(c.code), subs = online.subs[c.code];
    var qr = link ? '<div class="qr" aria-label="加入班級的 QR code">' + qrSVG(link, 5) + "</div>" : '<p class="callout">請先在下方設定「學生用的網站網址」，才能產生 QR code。</p>';
    var subsHTML = !subs ? '<p class="muted">' + (online.loading ? "讀取中…" : "按「讀取繳交紀錄」看學生交了什麼。") + "</p>" :
      !subs.length ? '<p class="muted">還沒有學生繳交。</p>' :
      '<div class="tablewrap"><table class="summary-table"><thead><tr><th>座號</th><th>姓名</th><th>關卡</th><th>分數</th><th>層次一</th><th>層次二</th><th>層次三</th><th>層次四</th><th>繳交時間</th><th></th></tr></thead><tbody>' +
      subs.slice().sort(function (a, b) { return (+a.seat || 0) - (+b.seat || 0); }).map(function (s, i) {
        var r = s.record || {}, lv = r.levels || {}, q = questById(s.questId), key = s.seat + "|" + s.questId;
        var row = '<tr><td class="tnum">' + esc(s.seat) + "</td><td>" + esc(s.name) + "</td><td>" + (q ? "〈" + esc(q.title) + "〉" : esc(s.questId)) + '</td><td class="tnum">' + esc(s.score) + "</td>" +
          [1, 2, 3, 4].map(function (L) { var x = lv[L]; return '<td class="tnum">' + (x && x.n ? x.first + "/" + x.n + (x.viaRemedial ? "＊" : "") : "—") + "</td>"; }).join("") +
          '<td class="tnum">' + fmtTime(s.at) + '</td><td><button class="btn small" data-action="open-sub" data-key="' + esc(key) + '">' + (view.openSub === key ? "收起" : "看歷程") + "</button></td></tr>";
        if (view.openSub === key) row += '<tr><td colspan="10">' + historyDetail(q, s) + "</td></tr>";
        return row;
      }).join("") + '</tbody></table></div><p class="muted small">層次欄為「第一次就答對／題數」，＊表示經過補強關才過關。</p>';
    return '<div class="sheet panel"><div class="spread"><div><span class="eyebrow">班級代碼 ' + esc(c.code) + "</span><h2>" + esc(c.name) + "</h2></div>" +
      '<div class="row"><button class="btn" data-action="qr-big">投影 QR code</button><button class="btn primary" data-action="load-subs">讀取繳交紀錄</button></div></div>' +
      '<div class="class-head">' + qr + '<div class="stack" style="gap:8px;min-width:0"><p>學生用手機或平板掃描 QR code，輸入座號和姓名就能開始闖關。沒有相機的裝置可以打開下面的網址，或在登入頁輸入班級代碼 <b>' + esc(c.code) + "</b>。</p>" +
      (link ? '<code class="link-box" id="joinLinkBox">' + esc(link) + '</code><div><button class="btn small" data-action="copy-link">複製網址</button></div>' : "") +
      (subs && subs.length ? '<div><button class="btn small" data-action="dash-online">在全班儀表板分析這班</button></div>' : "") + "</div></div>" +
      "<h3>繳交紀錄</h3>" + subsHTML + "</div>" +
      (view.qrBig && link ? '<div class="qr-overlay" data-action="qr-close" role="dialog" aria-label="投影 QR code"><div class="qr-sheet"><h1>' + esc(c.name) + '</h1><div class="qr big">' + qrSVG(link, 10) + '</div><p class="qr-code-text">班級代碼 <b>' + esc(c.code) + '</b></p><p class="muted">點一下任何地方關閉</p></div></div>' : "");
  }
  function historyDetail(quest, s) {
    var r = s.record || {};
    if (!quest) return '<p class="muted">這台電腦沒有這個關卡的題目資料（' + esc(s.questId) + "）。</p>";
    var ans = r.answers || {}, retry = (r.retry || {}).answers || {};
    var path = function (q, rec) {
      if (!rec || !rec.picks) return "—";
      return rec.picks.map(function (k) { return k === q.answer ? '<b style="color:var(--good)">' + k + " ✓</b>" : '<span style="color:var(--bad)">' + k + " ✗</span>"; }).join(" → ") + (rec.revealed ? "（看答案）" : "");
    };
    var rows = quest.questions.map(function (q) {
      var a = ans[q.qid], rt = retry[q.qid];
      var hints = a && a.picks ? Math.min(2, a.picks.filter(function (k) { return k !== q.answer; }).length) : 0;
      return '<tr><td class="tnum">' + q.qid + '</td><td><span class="chip lv lv-' + q.level + '">' + LEVEL_SHORT[q.level] + "</span></td><td>" + esc(q.stem) + "</td><td>" + path(q, a) + '</td><td class="tnum">' + (hints ? hints + " 次" : "—") + "</td><td>" + (rt ? path(q, rt) : "—") + "</td></tr>";
    }).join("");
    var rem = r.remedial && r.remedial.qids ? '<p class="small">補強關：層次' + r.remedial.level + "，" + (quest.remedial_pool || []).filter(function (q) { return r.remedial.qids.indexOf(q.qid) >= 0; }).map(function (q) { return q.qid + " " + path(q, (r.remedial.answers || {})[q.qid]); }).join("　") + "</p>" : "";
    var w = quest.warm_up, warm = w && r.warm !== null && r.warm !== undefined ? "<p class=\"small\">讀前預測：「" + esc(w.options[r.warm]) + "」" + (r.warmCheck !== null && r.warmCheck !== undefined ? "，讀完自評：" + ["猜對了", "猜對一部分", "沒猜到"][r.warmCheck] : "") + "</p>" : "";
    var time = r.started && r.finished ? '<p class="small">作答時間：約 ' + Math.max(1, Math.round((r.finished - r.started) / 60000)) + " 分鐘</p>" : "";
    return '<div class="stack" style="gap:8px;padding:6px 0">' + time + warm +
      '<div class="tablewrap"><table class="summary-table"><thead><tr><th>題</th><th>層次</th><th>題目</th><th>作答過程</th><th>用了提示</th><th>錯題再挑戰</th></tr></thead><tbody>' + rows + "</tbody></table></div>" + rem +
      (r.reflectionText ? '<p class="small">反思：' + esc(r.reflectionText) + "</p>" : "") + (r.notes ? '<p class="small">筆記：' + esc(r.notes) + "</p>" : "") + "</div>";
  }
  document.addEventListener("submit", function (e) {
    if (e.target.id === "setupForm") {
      e.preventDefault();
      store.teacher.api = $("#tApi").value.trim(); store.teacher.key = $("#tKey").value; store.teacher.site = $("#tSite").value.trim();
      save(); online.classes = null; loadClasses();
    }
    if (e.target.id === "classForm") {
      e.preventDefault();
      var quests = Array.prototype.map.call(document.querySelectorAll('input[name="cQuest"]:checked'), function (x) { return x.value; });
      online.loading = true; online.error = "";
      apiPost(teacherApi(), { action: "createClass", key: store.teacher.key, name: $("#cName").value.trim(), grade: +$("#cGrade").value, quests: quests }).then(function (d) {
        online.loading = false; online.classes = (online.classes || []).concat([d["class"]]); view.cls = d["class"].code; render(); toast("已建立班級 " + d["class"].code); window.scrollTo(0, 0);
      }, function (err) { online.loading = false; online.error = apiErrText(err); render(); });
    }
  });

  // ------------------------------------------------------------ actions
  function afterAnswerUpdate() {
    save();
    var stage = $("#stage"); if (!stage) return render();
    var quest = curQuest(), p = curProgress();
    stage.innerHTML = stageHTML(quest, p, TEXTS[quest.text_id]);
    highlightEvidence();
    var y = stage.getBoundingClientRect().top;
    if (y < 0) stage.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  function advanceAfterLevel(quest, p) {
    if (p.level < 4) { p.level++; p.cur = 0; }
    else { p.step = wrongQs(quest, p).length ? "retry" : "done"; p.retry.cur = 0; }
  }
  var actions = {
    nav: function (el) { view.name = el.dataset.view; view.pen = false; render(); window.scrollTo(0, 0); },
    band: function (el) { view.band = el.dataset.band; render(); },
    "pick-profile": function (el) { store.current = el.dataset.id; save(); view.name = "map"; view.band = null; render(); },
    "open-quest": function (el) {
      if (!me()) { view.name = "profile"; return render(); }
      view.name = "quest"; view.questId = el.dataset.id; view.showText = null; view.pen = false; view.zhuyin = false;
      render(); window.scrollTo(0, 0);
    },
    "open-text": function (el) { view.name = "text"; view.textId = el.dataset.id; view.zhuyin = false; render(); window.scrollTo(0, 0); },
    "goto-step": function (el) { var p = curProgress(); p.step = el.dataset.step; save(); render(); },
    warm: function (el) { var p = curProgress(); p.warm = +el.dataset.i; save(); afterAnswerUpdate(); },
    "warm-check": function (el) { var p = curProgress(); p.warmCheck = +el.dataset.i; save(); afterAnswerUpdate(); },
    reflect: function (el) { var p = curProgress(); p.reflection.choice = +el.dataset.i; save(); afterAnswerUpdate(); },
    "read-done": function () { var p = curProgress(); p.step = "levels"; p.level = 1; p.cur = 0; p.readDone = true; save(); view.showText = curQuest().grade_band === "high"; render(); window.scrollTo(0, 0); },
    pick: function (el) {
      var quest = curQuest(), p = curProgress(), q = currentQuestion(quest, p), k = el.dataset.k;
      if (p.step === "levels") recordPick(p, q, k, quest, "main");
      else if (p.step === "remedial") recordPick(p.remedial, q, k, quest, "remedial");
      else if (p.step === "retry") { p.retry.mainRec = p.answers[q.qid]; recordPick(p.retry, q, k, quest, "retry"); delete p.retry.mainRec; }
      var ctx = p.step === "remedial" ? p.remedial : p.step === "retry" ? p.retry : p;
      var rec = ctx.answers[q.qid];
      if (rec.picks.length === 1 && !rec.correct && !view.showText) view.showText = true, render();
      else afterAnswerUpdate();
    },
    jump: function (el) {
      var p = curProgress(), i = +el.dataset.i;
      if (p.step === "levels") { p.cur = i; if (p.levelResult[p.level]) p.levelResult[p.level].shown = false; }
      else if (p.step === "remedial") { p.remedial.cur = i; p.remedial.shown = false; }
      else p.retry.cur = i;
      afterAnswerUpdate();
    },
    "next-q": function () {
      var quest = curQuest(), p = curProgress();
      if (p.step === "levels") {
        var qs = levelQs(quest, p.level), nextOpen = -1;
        for (var i = p.cur + 1; i < qs.length; i++) { var r = p.answers[qs[i].qid]; if (!r || !r.done) { nextOpen = i; break; } }
        if (nextOpen < 0) for (i = 0; i < qs.length; i++) { r = p.answers[qs[i].qid]; if (!r || !r.done) { nextOpen = i; break; } }
        if (nextOpen >= 0) p.cur = nextOpen;
        else {
          var st = levelStats(quest, p, p.level), pass = !levelNeedsGate(quest, p.level) || st.first >= threshold(st.n);
          var prev = p.levelResult[p.level] || {};
          p.levelResult[p.level] = { passed: prev.passed || pass, viaRemedial: prev.viaRemedial || false, failedGate: prev.failedGate || !pass, shown: true };
        }
      } else if (p.step === "remedial") {
        var rq = remedialQs(quest, p.remedial), open = -1;
        rq.forEach(function (x, j) { var a = p.remedial.answers[x.qid]; if (open < 0 && (!a || !a.done)) open = j; });
        if (open >= 0) p.remedial.cur = open; else p.remedial.shown = true;
      } else if (p.step === "retry") {
        var w = wrongQs(quest, p), o = -1;
        w.forEach(function (x, j) { var a = p.retry.answers[x.qid]; if (o < 0 && (!a || !a.done)) o = j; });
        if (o >= 0) p.retry.cur = o; else { p.step = "done"; save(); return render(); }
      }
      afterAnswerUpdate();
    },
    "level-next": function () { var quest = curQuest(), p = curProgress(); advanceAfterLevel(quest, p); save(); render(); window.scrollTo(0, 0); },
    "start-remedial": function () {
      var quest = curQuest(), p = curProgress(), L = p.level;
      var pool = (quest.remedial_pool || []).filter(function (q) { return q.for_level === L || (!q.for_level && q.level === L); }).slice(0, 3);
      if (!pool.length) {
        p.levelResult[L].passed = true; p.levelResult[L].viaRemedial = true; advanceAfterLevel(quest, p); save(); render();
        toast("這一關沒有補強題，請把標亮過的段落再讀一次後繼續"); return;
      }
      p.remedial = { level: L, qids: pool.map(function (q) { return q.qid; }), answers: {}, cur: 0, shown: false, tries: 1 };
      p.step = "remedial"; save(); render();
    },
    "remedial-retry": function () { var p = curProgress(); p.remedial.answers = {}; p.remedial.cur = 0; p.remedial.shown = false; p.remedial.tries++; save(); afterAnswerUpdate(); },
    "remedial-pass": function () {
      var quest = curQuest(), p = curProgress(), L = p.remedial.level;
      p.levelResult[L].passed = true; p.levelResult[L].viaRemedial = true; p.step = "levels"; advanceAfterLevel(quest, p); save(); render(); window.scrollTo(0, 0);
    },
    finish: function () {
      var quest = curQuest(), p = curProgress(), s = $("#reflSentence");
      if (s) p.reflection.sentence = s.value.trim();
      var first = !p.finished;
      p.finished = p.finished || Date.now(); p.score = questScore(quest, p); save();
      view.name = "map"; render(); window.scrollTo(0, 0);
      if (me().classCode && p.submitState !== "done") submitQuest(quest.quest_id);
      else if (first) toast("〈" + quest.title + "〉過關！得到 " + p.score + " 分");
    },
    "toggle-text": function () { view.showText = !view.showText; render(); },
    "toggle-pen": function () { view.pen = !view.pen; render(); },
    "toggle-zhuyin": function () { view.zhuyin = !view.zhuyin; render(); },
    say: function (el) { speak(el.dataset.text); },
    "say-para": function (el) { speak(el.closest(".para").textContent.replace("▶ 朗讀", "")); },
    "say-all": function () {
      var art = $("#article"); if (!art) return;
      var c = art.cloneNode(true); c.querySelectorAll("rt, .say").forEach(function (x) { x.remove(); });
      speak(c.textContent);
    },
    "join-retry": function () { online.joinError = ""; online.joinClass = null; render(); },
    "submit-quest": function (el) { submitQuest(el.dataset.id); },
    "pick-class": function (el) { view.cls = el.dataset.code; view.openSub = null; render(); if (!online.subs[view.cls]) loadSubs(view.cls); window.scrollTo(0, 0); },
    "load-classes": function () { loadClasses(); },
    "load-subs": function () { if (view.cls) loadSubs(view.cls); },
    "open-sub": function (el) { view.openSub = view.openSub === el.dataset.key ? null : el.dataset.key; render(); },
    "qr-big": function () { view.qrBig = true; render(); },
    "qr-close": function () { view.qrBig = false; render(); },
    "dash-online": function () { view.dashSource = view.cls; view.teacherTab = "dash"; render(); window.scrollTo(0, 0); },
    "copy-link": function () {
      var box = $("#joinLinkBox"), txt = box.textContent;
      var sel = function () { var r = document.createRange(); r.selectNodeContents(box); var s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("已選取，請按 Ctrl+C 複製"); };
      try { navigator.clipboard.writeText(txt).then(function () { toast("已複製網址"); }, sel); } catch (e) { sel(); }
    },
    tteab: function (el) { view.teacherTab = el.dataset.tab; render(); },
    "do-import": doImport,
    "remove-import": function (el) { store.imported.quests = store.imported.quests.filter(function (q) { return q.quest_id !== el.dataset.id; }); save(); rebuildData(); render(); },
    "demo-class": loadDemoClass,
    "clear-demo": function () { Object.keys(store.profiles).forEach(function (id) { if (store.profiles[id].demo) delete store.profiles[id]; }); if (store.current && !store.profiles[store.current]) store.current = null; save(); render(); },
    "copy-export": function () {
      var txt = $("#exportBox").textContent;
      var sel = function () { var r = document.createRange(); r.selectNodeContents($("#exportBox")); var s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("已選取，請按 Ctrl+C 複製"); };
      try { navigator.clipboard.writeText(txt).then(function () { toast("已複製"); }, sel); } catch (e) { sel(); }
    }
  };
  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-action]");
    if (el && el.tagName !== "SELECT" && !el.disabled && actions[el.dataset.action]) { e.preventDefault(); actions[el.dataset.action](el); return; }
    // eraser: click a pen mark while pen mode is on
    var m = e.target.closest("mark.pen");
    if (m && view.pen) { var parent = m.parentNode; while (m.firstChild) parent.insertBefore(m.firstChild, m); parent.removeChild(m); parent.normalize(); savePen(); }
  });
  document.addEventListener("change", function (e) {
    if (e.target.id === "tqSel") { view.teacherQuest = e.target.value; render(); }
    if (e.target.id === "dashSrc") { view.dashSource = e.target.value; render(); }
  });
  document.addEventListener("input", function (e) {
    if (e.target.id === "reflSentence") { var p = curProgress(); p.reflection.sentence = e.target.value; save(); }
  });
  // pen: wrap selection inside the article
  document.addEventListener("mouseup", penSelect);
  document.addEventListener("touchend", function () { setTimeout(penSelect, 30); });
  function penSelect() {
    if (!view.pen) return;
    var art = $("#article"), sel = window.getSelection();
    if (!art || !sel || sel.isCollapsed || !sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    if (!art.contains(range.commonAncestorContainer)) return;
    var block = function (n) { return (n.nodeType === 1 ? n : n.parentNode).closest(".para, .note, td, li"); };
    if (block(range.startContainer) !== block(range.endContainer) || !block(range.startContainer)) { toast("畫線請在同一段裡選取"); sel.removeAllRanges(); return; }
    var mark = document.createElement("mark"); mark.className = "pen";
    try { mark.appendChild(range.extractContents()); range.insertNode(mark); } catch (e) { /* ignore */ }
    sel.removeAllRanges(); savePen();
  }
  function savePen() {
    if (view.name !== "quest") return;
    var art = $("#article"), p = curProgress(); if (!art) return;
    var c = art.cloneNode(true); c.querySelectorAll(".evidence").forEach(function (x) { x.classList.remove("evidence"); });
    p.penHTML = c.innerHTML; save();
  }

  readLaunchParams();
  render();
})();
