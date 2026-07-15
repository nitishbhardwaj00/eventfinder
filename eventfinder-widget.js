/*!
 * EventFinder Chat Widget SDK v1.0.0
 * Embeddable event-search chatbot powered by the TicketWeb feed API.
 *
 * Quick start (one line):
 *   <script src="eventfinder-widget.js"
 *           data-apikey="YOUR_KEY" data-orgid="45742" data-venueid="740573"></script>
 *
 * Or manual init:
 *   <script src="eventfinder-widget.js" data-autoinit="false"></script>
 *   <script>EventFinder.init({ apiKey: "...", orgId: "...", venueId: "..." });</script>
 *
 * Public API: EventFinder.init(cfg) | .open() | .close() | .toggle() | .search(query)
 */
(function () {
  "use strict";

  // ================= Config =================
  var DEFAULTS = {
    apiKey: "xrZT1go6BccRHSpCPPC9cQdqQ8vZwC",
    orgId: "45742",
    venueId: "740573",           // set "" to search all venues for the org
    apiBase: "https://api.ticketweb.com/",
    title: "Event Finder",
    subtitle: "",                // defaults to "Online · N upcoming events"
    greeting: "Hi! 👋 I can help you find events. Ask me things like:",
    chips: ["Events this week", "What's on this weekend?", "Country music next week", "Shows this month"],
    placeholder: 'Try "events this week"…',
    position: "right",           // "right" | "left"
    accent1: "#6366f1",
    accent2: "#8b5cf6",
    zIndex: 999999,
    showBadge: true,
    loadFont: true,              // inject Inter from Google Fonts
    maxResults: 10
  };

  var cfg = assign({}, DEFAULTS);
  var EVENTS = [];
  var mounted = false, booted = false, isOpen = false;
  var shadow = null, els = {};

  function assign(t) {
    for (var i = 1; i < arguments.length; i++) {
      var s = arguments[i];
      if (s) for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k) && s[k] !== undefined) t[k] = s[k];
    }
    return t;
  }

  function apiUrl() {
    var u = cfg.apiBase + "?apikey=" + encodeURIComponent(cfg.apiKey) +
            "&orgid=" + encodeURIComponent(cfg.orgId) +
            "&method=json&resultsPerPage=200";
    if (cfg.venueId) u += "&venueid=" + encodeURIComponent(cfg.venueId);
    return u;
  }

  // ================= Pure helpers (data) =================
  function parseTwDate(s) { // "20260716210000" -> Date (local)
    if (!s || s.length < 8) return null;
    return new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +(s.slice(8, 10) || 0), +(s.slice(10, 12) || 0));
  }
  function priceText(ev) {
    var p = ev.prices || {};
    if (p.pricedisplay) return p.pricedisplay === "$0.00" ? "Free" : p.pricedisplay;
    if (p.pricelow && p.pricehigh && p.pricelow !== p.pricehigh) return p.pricelow + " – " + p.pricehigh;
    if (p.pricelow) return p.pricelow === "$0.00" ? "Free" : p.pricelow;
    return null;
  }
  function genreText(ev) {
    var a = (ev.attractionList || [])[0];
    if (!a || !a.genre) return null;
    return a.subgenre && a.subgenre !== a.genre ? a.genre + " · " + a.subgenre : a.genre;
  }
  function whenText(ev) {
    return ev._start.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) +
      (ev.dates && ev.dates.timezone ? " " + ev.dates.timezone : "");
  }
  function waShareUrl(ev) {
    var lines = [
      "🎟️ " + ev.eventname,
      "📅 " + whenText(ev),
      "📍 " + ev.venue.name + ", " + (ev.venue.address ? ev.venue.address + ", " : "") + ev.venue.city + ", " + ev.venue.state
    ];
    var price = priceText(ev);
    if (price) lines.push("💵 " + price);
    var genre = genreText(ev);
    if (genre) lines.push("🎵 " + genre);
    lines.push("", "Get tickets 👉 " + ev.eventurl);
    return "https://wa.me/?text=" + encodeURIComponent(lines.join("\n"));
  }

  // ================= Query parsing =================
  var MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  var WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  var STOP = {};
  ("show shows event events concert concerts gig gigs find search any anything what whats what's is are there happening going on the a an me i want to see list all upcoming for of please hey hi do you have can get tickets ticket music live in at near this next week weekend month").split(" ").forEach(function (w) { STOP[w] = 1; });

  function DAY0() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }

  function parseQuery(raw) {
    var q = raw.toLowerCase().replace(/[?!.,]/g, " ").replace(/\s+/g, " ").trim();
    var today = DAY0();
    var range = null, label = null, city = null;

    function take(re, fn) {
      var m = q.match(re);
      if (m) { fn(m); q = q.replace(re, " ").replace(/\s+/g, " ").trim(); }
    }

    take(/\btoday\b|\btonight\b/, function () { range = [today, addDays(today, 1)]; label = "today"; });
    take(/\btomorrow\b/, function () { range = [addDays(today, 1), addDays(today, 2)]; label = "tomorrow"; });
    take(/\bthis weekend\b/, function () {
      var fri = addDays(today, ((5 - today.getDay()) + 7) % 7);
      range = [today > fri ? today : fri, addDays(fri, 3)]; label = "this weekend";
    });
    take(/\bnext weekend\b/, function () {
      var fri = addDays(addDays(today, ((5 - today.getDay()) + 7) % 7), 7);
      range = [fri, addDays(fri, 3)]; label = "next weekend";
    });
    take(/\bthis week\b/, function () { // through Sunday
      range = [today, addDays(today, (7 - today.getDay()) % 7 + 1)]; label = "this week";
    });
    take(/\bnext week\b/, function () {
      var start = addDays(today, (8 - today.getDay()) % 7 || 7);
      range = [start, addDays(start, 7)]; label = "next week";
    });
    take(/\bthis month\b/, function () {
      range = [today, new Date(today.getFullYear(), today.getMonth() + 1, 1)]; label = "this month";
    });
    take(/\bnext month\b/, function () {
      range = [new Date(today.getFullYear(), today.getMonth() + 1, 1), new Date(today.getFullYear(), today.getMonth() + 2, 1)];
      label = "next month";
    });
    if (!range) take(new RegExp("\\b(" + MONTHS.join("|") + ")\\b(\\s+(\\d{1,2}))?"), function (m) {
      var mi = MONTHS.indexOf(m[1]);
      var y = today.getFullYear();
      if (mi < today.getMonth()) y++;
      if (m[3]) { var d = new Date(y, mi, +m[3]); range = [d, addDays(d, 1)]; label = "on " + m[1] + " " + m[3]; }
      else { range = [new Date(y, mi, 1), new Date(y, mi + 1, 1)]; label = "in " + m[1]; }
    });
    if (!range) take(new RegExp("\\b(this\\s+|next\\s+)?(" + WEEKDAYS.join("|") + ")\\b"), function (m) {
      var wd = WEEKDAYS.indexOf(m[2]);
      var d = addDays(today, ((wd - today.getDay()) + 7) % 7);
      if (m[1] && m[1].trim() === "next") d = addDays(d, 7);
      range = [d, addDays(d, 1)]; label = "on " + m[2];
    });

    take(/\b(?:in|at|near)\s+([a-z][a-z\s]{1,30}?)(?=$|\bfor\b|\bwith\b)/, function (m) { city = m[1].trim(); });

    var keywords = q.split(" ").filter(function (w) { return w && !STOP[w]; });
    return { range: range, label: label, city: city, keywords: keywords };
  }

  // ================= Filtering =================
  function eventText(ev) {
    var parts = [ev.eventname, ev.description];
    (ev.attractionList || []).forEach(function (a) { parts.push(a.artist, a.genre, a.subgenre); });
    return parts.join(" ").toLowerCase();
  }
  function filterEvents(p) {
    return EVENTS.filter(function (ev) {
      if (p.range && !(ev._start >= p.range[0] && ev._start < p.range[1])) return false;
      if (p.city) {
        var loc = (ev.venue.city + " " + ev.venue.state + " " + ev.venue.name + " " + (ev.venue.postalcode || "")).toLowerCase();
        var ok = p.city.split(" ").every(function (w) { return loc.indexOf(w) !== -1; });
        if (!ok) return false;
      }
      if (p.keywords.length) {
        var text = eventText(ev) + " " + (ev.venue.city + " " + ev.venue.name).toLowerCase();
        var hit = p.keywords.some(function (w) { return text.indexOf(w) !== -1; });
        if (!hit) return false;
      }
      return true;
    });
  }

  // ================= Data loading =================
  function loadJsonp(url) { // fallback if CORS blocks fetch
    return new Promise(function (resolve, reject) {
      var cb = "efwCb_" + Date.now();
      var s = document.createElement("script");
      var timer = setTimeout(function () { cleanup(); reject(new Error("JSONP timeout")); }, 10000);
      function cleanup() { clearTimeout(timer); try { delete window[cb]; } catch (e) { window[cb] = undefined; } s.parentNode && s.parentNode.removeChild(s); }
      window[cb] = function (data) { cleanup(); resolve(data); };
      s.onerror = function () { cleanup(); reject(new Error("JSONP failed")); };
      s.src = url + "&callback=" + cb;
      document.head.appendChild(s);
    });
  }
  function loadEvents() {
    return fetch(apiUrl())
      .then(function (res) { if (!res.ok) throw new Error("HTTP " + res.status); return res.json(); })
      .catch(function () { return loadJsonp(apiUrl()); })
      .then(function (data) {
        EVENTS = (data.events || []).map(function (ev) {
          return assign({}, ev, { _start: parseTwDate(ev.dates.startdate) });
        }).filter(function (ev) { return ev._start; })
          .sort(function (a, b) { return a._start - b._start; });
        return EVENTS;
      });
  }

  // ================= Icons =================
  var ICONS = {
    chat: '<svg class="ico-chat" viewBox="0 0 24 24"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM7 9h10v2H7V9zm7 5H7v-2h7v2zm3-6H7V6h10v2z"/></svg>',
    close: '<svg class="ico-close" viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
    minus: '<svg viewBox="0 0 24 24"><path d="M19 13H5v-2h14v2z"/></svg>',
    send: '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>',
    ticket: '<svg viewBox="0 0 24 24"><path d="M22 10V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v4a2 2 0 0 1 0 4v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4a2 2 0 0 1 0-4z"/></svg>',
    ticketHole: '<svg viewBox="0 0 24 24"><path d="M22 10V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v4a2 2 0 0 1 0 4v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4a2 2 0 0 1 0-4zm-9 7.5h-2v-2h2v2zm0-4.5h-2v-2h2v2zm0-4.5h-2v-2h2v2z"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 10.6 4.2 2.5-.75 1.23L11 13V7h2v5.6z"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>',
    wa: '<svg viewBox="0 0 24 24"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.25-.46-2.39-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.61.14-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.5 0 1.47 1.07 2.89 1.22 3.09.15.2 2.11 3.22 5.1 4.51.71.31 1.27.49 1.7.63.72.23 1.37.2 1.88.12.57-.09 1.76-.72 2.01-1.42.25-.7.25-1.29.17-1.42-.07-.13-.27-.2-.57-.35zM12.05 21.8h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.82 9.82 0 0 1-1.51-5.26c0-5.44 4.43-9.87 9.89-9.87a9.8 9.8 0 0 1 6.98 2.9 9.8 9.8 0 0 1 2.9 6.98c0 5.45-4.44 9.88-9.88 9.88zm8.41-18.29A11.8 11.8 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.9c0 2.1.55 4.14 1.59 5.94L.06 24l6.31-1.65a11.88 11.88 0 0 0 5.68 1.44h.01c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.16-3.49-8.4z"/></svg>'
  };

  // ================= Styles (Shadow DOM — fully isolated from host page) =================
  function css() {
    var side = cfg.position === "left" ? "left" : "right";
    return "" +
":host { all: initial; }" +
".efw { --a1:" + cfg.accent1 + "; --a2:" + cfg.accent2 + "; --grad:linear-gradient(135deg,var(--a1),var(--a2));" +
"  --bg:#0b0d12; --surface:#141822; --surface2:#1a1f2c; --border:#262c3b; --borderh:#3b4358;" +
"  --text:#eef0f6; --muted:#8b93a7; --green:#25d366; --red:#f0455a; --amber:#f5a623;" +
"  font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; -webkit-font-smoothing:antialiased; }" +
".efw *, .efw *::before, .efw *::after { box-sizing:border-box; margin:0; padding:0; }" +
".efw svg { display:block; }" +

/* launcher */
".efw-launcher { position:fixed; " + side + ":22px; bottom:22px; z-index:" + cfg.zIndex + ";" +
"  width:62px; height:62px; border-radius:50%; border:none; cursor:pointer;" +
"  background:var(--grad); display:grid; place-items:center;" +
"  box-shadow:0 8px 26px rgba(99,102,241,.5); transition:transform .2s,box-shadow .2s; }" +
".efw-launcher:hover { transform:scale(1.07); }" +
".efw-launcher svg { width:28px; height:28px; fill:#fff; position:absolute; top:17px; left:17px; transition:opacity .15s,transform .2s; }" +
".efw-launcher .ico-close { opacity:0; transform:rotate(-90deg) scale(.5); }" +
".efw-launcher.open .ico-chat { opacity:0; transform:rotate(90deg) scale(.5); }" +
".efw-launcher.open .ico-close { opacity:1; transform:none; }" +
".efw-launcher::after { content:''; position:absolute; inset:0; border-radius:50%;" +
"  border:2px solid rgba(139,92,246,.6); animation:efw-pulse 2.4s ease-out infinite; }" +
".efw-launcher.open::after { animation:none; opacity:0; }" +
"@keyframes efw-pulse { 0%{transform:scale(1);opacity:1} 70%,100%{transform:scale(1.55);opacity:0} }" +
".efw-badge { position:absolute; top:-4px; " + side + ":-4px; min-width:22px; height:22px; border-radius:11px;" +
"  background:var(--red); color:#fff; font-size:11.5px; font-weight:700; display:grid; place-items:center;" +
"  padding:0 6px; border:2px solid #0b0d12; opacity:0; transform:scale(.5);" +
"  transition:all .25s cubic-bezier(.34,1.56,.64,1); }" +
".efw-badge.show { opacity:1; transform:none; }" +

/* panel */
".efw-panel { position:fixed; " + side + ":22px; bottom:98px; z-index:" + (cfg.zIndex - 1) + ";" +
"  width:min(400px,calc(100vw - 44px)); height:min(620px,calc(100vh - 130px));" +
"  display:flex; flex-direction:column; overflow:hidden; color:var(--text);" +
"  background:rgba(15,18,26,.94); -webkit-backdrop-filter:blur(20px); backdrop-filter:blur(20px);" +
"  border:1px solid var(--border); border-radius:22px;" +
"  box-shadow:0 24px 70px rgba(0,0,0,.6),0 0 0 1px rgba(139,92,246,.08);" +
"  opacity:0; transform:translateY(16px) scale(.97); pointer-events:none; transform-origin:bottom " + side + ";" +
"  transition:opacity .22s ease,transform .22s cubic-bezier(.34,1.3,.64,1); }" +
".efw-panel.open { opacity:1; transform:none; pointer-events:auto; }" +

".efw-head { display:flex; align-items:center; gap:12px; padding:15px 16px; background:var(--grad); flex-shrink:0; }" +
".efw-avatar { width:38px; height:38px; border-radius:12px; flex-shrink:0; background:rgba(255,255,255,.18); display:grid; place-items:center; }" +
".efw-avatar svg { width:21px; height:21px; fill:#fff; }" +
".efw-headtxt { min-width:0; }" +
".efw-headtxt h1 { font-size:14.5px; font-weight:700; color:#fff; letter-spacing:-.2px; }" +
".efw-headtxt p { font-size:11.5px; color:rgba(255,255,255,.75); display:flex; align-items:center; gap:6px; margin-top:1px; }" +
".efw-dot { width:7px; height:7px; border-radius:50%; background:var(--amber); flex-shrink:0; }" +
".efw-panel.online .efw-dot { background:#4ade80; box-shadow:0 0 6px rgba(74,222,128,.8); }" +
".efw-headbtn { margin-left:auto; width:32px; height:32px; border-radius:9px; border:none; cursor:pointer;" +
"  background:rgba(255,255,255,.15); color:#fff; display:grid; place-items:center; transition:background .15s; flex-shrink:0; }" +
".efw-headbtn:hover { background:rgba(255,255,255,.28); }" +
".efw-headbtn svg { width:16px; height:16px; fill:currentColor; }" +

".efw-chat { flex:1; overflow-y:auto; padding:16px 14px 10px; display:flex; flex-direction:column; gap:11px;" +
"  scrollbar-width:thin; scrollbar-color:var(--border) transparent; }" +
".efw-msg { max-width:86%; padding:10px 14px; border-radius:15px; font-size:13.5px; line-height:1.5;" +
"  white-space:pre-wrap; animation:efw-pop .25s ease both; }" +
"@keyframes efw-pop { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }" +
".efw-msg.user { align-self:flex-end; background:var(--grad); color:#fff; border-bottom-right-radius:4px; box-shadow:0 3px 10px rgba(99,102,241,.3); }" +
".efw-msg.bot { align-self:flex-start; background:var(--surface); border:1px solid var(--border); border-bottom-left-radius:4px; }" +
".efw-msg.typing { color:var(--muted); font-style:italic; }" +

".efw-chips { display:flex; gap:7px; flex-wrap:wrap; align-self:flex-start; animation:efw-pop .25s ease both; }" +
".efw-chip { font-family:inherit; font-size:12px; font-weight:500; padding:7px 12px; border-radius:18px; cursor:pointer;" +
"  background:var(--surface); border:1px solid var(--border); color:var(--muted); transition:all .15s; }" +
".efw-chip:hover { border-color:var(--a1); color:var(--text); transform:translateY(-1px); }" +

/* cards */
".efw-cards { align-self:stretch; display:flex; flex-direction:column; gap:10px; }" +
".efw-card { display:flex; gap:12px; background:var(--surface); border:1px solid var(--border); border-radius:14px;" +
"  padding:11px; position:relative; overflow:hidden; transition:border-color .2s,transform .2s,box-shadow .2s; animation:efw-pop .3s ease both; }" +
".efw-card:hover { border-color:var(--borderh); transform:translateY(-2px); box-shadow:0 8px 24px rgba(0,0,0,.35); }" +
".efw-card::before { content:''; position:absolute; left:0; top:0; bottom:0; width:3px; background:var(--grad); opacity:0; transition:opacity .2s; }" +
".efw-card:hover::before { opacity:1; }" +
".efw-thumbwrap { position:relative; flex-shrink:0; }" +
".efw-thumb { width:82px; height:82px; object-fit:cover; border-radius:10px; background:var(--surface2); display:block; }" +
".efw-dateflag { position:absolute; top:5px; left:5px; background:rgba(11,13,18,.88); border-radius:7px; padding:3px 7px; text-align:center; line-height:1.1; }" +
".efw-dateflag .d { font-size:13px; font-weight:800; color:var(--text); }" +
".efw-dateflag .m { font-size:8.5px; font-weight:600; color:var(--a2); text-transform:uppercase; letter-spacing:.7px; }" +
".efw-info { display:flex; flex-direction:column; gap:4px; min-width:0; flex:1; }" +
".efw-name { font-weight:700; font-size:13.5px; letter-spacing:-.2px; line-height:1.3; color:var(--text); }" +
".efw-when { font-size:12px; font-weight:600; color:#a5b4fc; display:flex; align-items:center; gap:5px; }" +
".efw-where { font-size:11.5px; color:var(--muted); display:flex; align-items:center; gap:5px; }" +
".efw-when svg,.efw-where svg { width:12px; height:12px; fill:currentColor; flex-shrink:0; opacity:.8; }" +
".efw-pills { display:flex; gap:5px; flex-wrap:wrap; margin-top:1px; }" +
".efw-pill { font-size:10px; font-weight:600; padding:3px 8px; border-radius:20px; border:1px solid transparent; white-space:nowrap; }" +
".efw-pill.genre { background:rgba(139,92,246,.14); color:#c4b5fd; border-color:rgba(139,92,246,.25); }" +
".efw-pill.price { background:rgba(37,211,102,.12); color:#4ade80; border-color:rgba(37,211,102,.22); }" +
".efw-pill.age { background:rgba(245,166,35,.12); color:var(--amber); border-color:rgba(245,166,35,.22); }" +
".efw-pill.soldout { background:rgba(240,69,90,.12); color:var(--red); border-color:rgba(240,69,90,.25); }" +
".efw-pill.onsale { background:rgba(37,211,102,.12); color:var(--green); border-color:rgba(37,211,102,.22); }" +
".efw-actions { display:flex; gap:7px; margin-top:6px; }" +
".efw-btn { display:inline-flex; align-items:center; gap:6px; font-family:inherit; font-size:11.5px; font-weight:600;" +
"  padding:7px 12px; border-radius:9px; cursor:pointer; border:none; text-decoration:none; transition:all .15s; }" +
".efw-btn svg { width:13px; height:13px; fill:currentColor; }" +
".efw-btn.tickets { background:var(--grad); color:#fff; box-shadow:0 3px 10px rgba(99,102,241,.35); }" +
".efw-btn.tickets:hover { transform:translateY(-1px); }" +
".efw-btn.tickets.disabled { background:var(--surface2); color:var(--muted); box-shadow:none; cursor:default; pointer-events:none; }" +
".efw-btn.wa { background:rgba(37,211,102,.12); color:var(--green); border:1px solid rgba(37,211,102,.3); }" +
".efw-btn.wa:hover { background:var(--green); color:#06281a; transform:translateY(-1px); }" +

/* composer */
".efw-composer { padding:10px 12px 12px; border-top:1px solid var(--border); flex-shrink:0; }" +
".efw-composer form { display:flex; gap:8px; }" +
".efw-field { flex:1; display:flex; align-items:center; background:var(--surface); border:1px solid var(--border);" +
"  border-radius:22px; padding:0 5px 0 15px; transition:border-color .15s,box-shadow .15s; }" +
".efw-field:focus-within { border-color:var(--a1); box-shadow:0 0 0 3px rgba(99,102,241,.15); }" +
".efw-input { flex:1; padding:11px 0; border:none; background:transparent; color:var(--text);" +
"  font-size:13.5px; font-family:inherit; outline:none; min-width:0; }" +
".efw-input::placeholder { color:#5b6377; }" +
".efw-send { width:36px; height:36px; border-radius:50%; border:none; cursor:pointer; background:var(--grad);" +
"  display:grid; place-items:center; flex-shrink:0; margin:3px 0; transition:transform .15s,opacity .15s; }" +
".efw-send:hover { transform:scale(1.06); }" +
".efw-send:disabled { opacity:.4; cursor:default; transform:none; }" +
".efw-send svg { width:15px; height:15px; fill:#fff; margin-left:2px; }" +
".efw-hint { text-align:center; font-size:10px; color:#4d5568; margin-top:7px; }" +

/* mobile */
"@media (max-width:480px) {" +
"  .efw-panel { " + side + ":0; bottom:0; width:100vw; height:100dvh; border-radius:0; border:none; }" +
"  .efw-launcher { " + side + ":16px; bottom:16px; }" +
"  .efw-launcher.open { z-index:" + (cfg.zIndex + 1) + "; }" +
"  .efw-composer { padding-bottom:max(12px, env(safe-area-inset-bottom)); }" +
"}";
  }

  // ================= Markup =================
  function html() {
    return "" +
'<div class="efw">' +
'  <button class="efw-launcher" part="launcher" aria-label="Open event chat" aria-expanded="false">' +
     ICONS.chat + ICONS.close +
'    <span class="efw-badge"></span>' +
'  </button>' +
'  <div class="efw-panel" role="dialog" aria-label="Event Finder chat">' +
'    <div class="efw-head">' +
'      <div class="efw-avatar">' + ICONS.ticketHole + '</div>' +
'      <div class="efw-headtxt">' +
'        <h1></h1>' +
'        <p><span class="efw-dot"></span><span class="efw-status">Connecting…</span></p>' +
'      </div>' +
'      <button class="efw-headbtn" aria-label="Close chat">' + ICONS.minus + '</button>' +
'    </div>' +
'    <div class="efw-chat"></div>' +
'    <div class="efw-composer">' +
'      <form>' +
'        <div class="efw-field"><input class="efw-input" autocomplete="off"></div>' +
'        <button type="submit" class="efw-send" aria-label="Send">' + ICONS.send + '</button>' +
'      </form>' +
'      <div class="efw-hint">Powered by EventFinder · Live data from TicketWeb</div>' +
'    </div>' +
'  </div>' +
'</div>';
  }

  // ================= Chat rendering =================
  function scrollDown() { els.chat.scrollTop = els.chat.scrollHeight; }
  function addMsg(text, who) {
    var el = document.createElement("div");
    el.className = "efw-msg " + who;
    el.textContent = text;
    els.chat.appendChild(el);
    scrollDown();
    return el;
  }
  function addChips(labels) {
    var wrap = document.createElement("div");
    wrap.className = "efw-chips";
    labels.forEach(function (l) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "efw-chip"; b.textContent = l;
      b.addEventListener("click", function () { submitQuery(l); });
      wrap.appendChild(b);
    });
    els.chat.appendChild(wrap);
    scrollDown();
  }
  function addCards(events) {
    var wrap = document.createElement("div");
    wrap.className = "efw-cards";
    events.forEach(function (ev, i) {
      var soldOut = ev.status === "SoldOut";
      var price = priceText(ev);
      var genre = genreText(ev);
      var artists = (ev.attractionList || []).map(function (a) { return a.artist; }).join(", ");
      var imgSrc = (ev.eventimages && ev.eventimages.small) || (ev.venue.venueimages && ev.venue.venueimages.small) || "";

      var card = document.createElement("div");
      card.className = "efw-card";
      card.style.animationDelay = (i * 60) + "ms";
      card.innerHTML =
        '<div class="efw-thumbwrap">' +
        '  <img class="efw-thumb" loading="lazy" alt="">' +
        '  <div class="efw-dateflag"><div class="d">' + ev._start.getDate() + '</div>' +
        '  <div class="m">' + ev._start.toLocaleString([], { month: "short" }) + '</div></div>' +
        '</div>' +
        '<div class="efw-info">' +
        '  <div class="efw-name"></div>' +
        '  <div class="efw-when">' + ICONS.clock + '<span></span></div>' +
        '  <div class="efw-where">' + ICONS.pin + '<span></span></div>' +
        '  <div class="efw-pills">' +
             (genre ? '<span class="efw-pill genre"></span>' : "") +
        '    <span class="efw-pill price"></span>' +
             (ev.agerestrictionmessage ? '<span class="efw-pill age"></span>' : "") +
        '    <span class="efw-pill ' + (soldOut ? "soldout" : "onsale") + '">' + (soldOut ? "Sold Out" : "On Sale") + '</span>' +
        '  </div>' +
        '  <div class="efw-actions">' +
        '    <a class="efw-btn tickets ' + (soldOut ? "disabled" : "") + '" target="_blank" rel="noopener">' + ICONS.ticket + (soldOut ? "Sold Out" : "Get Tickets") + '</a>' +
        '    <a class="efw-btn wa" target="_blank" rel="noopener" title="Share on WhatsApp">' + ICONS.wa + 'Share</a>' +
        '  </div>' +
        '</div>';

      // safe text injection
      card.querySelector(".efw-thumb").src = imgSrc;
      card.querySelector(".efw-name").textContent = ev.eventname;
      card.querySelector(".efw-when span").textContent = whenText(ev);
      card.querySelector(".efw-where span").textContent =
        ev.venue.name + ", " + ev.venue.city + ", " + ev.venue.state + (artists ? " · " + artists : "");
      if (genre) card.querySelector(".efw-pill.genre").textContent = genre;
      card.querySelector(".efw-pill.price").textContent = price || "Price TBA";
      if (ev.agerestrictionmessage) card.querySelector(".efw-pill.age").textContent = ev.agerestrictionmessage;
      card.querySelector(".efw-btn.tickets").href = ev.eventurl;
      card.querySelector(".efw-btn.wa").href = waShareUrl(ev);
      wrap.appendChild(card);
    });
    els.chat.appendChild(wrap);
    scrollDown();
  }

  // ================= Respond =================
  function respond(raw) {
    var parsed = parseQuery(raw);
    var results = filterEvents(parsed);
    var bits = [];
    if (parsed.label) bits.push(parsed.label);
    if (parsed.city) bits.push("in " + parsed.city);
    if (parsed.keywords.length) bits.push('matching "' + parsed.keywords.join(" ") + '"');
    var desc = bits.length ? " " + bits.join(", ") : "";

    if (!results.length) {
      addMsg("I couldn't find any events" + desc + ". Here's everything coming up:", "bot");
      if (EVENTS.length) addCards(EVENTS.slice(0, 5));
      else addMsg("There are no upcoming events right now.", "bot");
      return;
    }
    addMsg("Found " + results.length + " event" + (results.length > 1 ? "s" : "") + desc + ":", "bot");
    addCards(results.slice(0, cfg.maxResults));
    if (results.length > cfg.maxResults) addMsg("…and " + (results.length - cfg.maxResults) + " more. Try narrowing your search.", "bot");
  }

  function submitQuery(text) {
    text = (text || "").trim();
    if (!text || els.send.disabled) return;
    addMsg(text, "user");
    els.input.value = "";
    var typing = addMsg("Searching…", "bot");
    typing.className += " typing";
    setTimeout(function () { typing.parentNode && typing.parentNode.removeChild(typing); respond(text); }, 350);
  }

  // ================= Widget lifecycle =================
  function mount() {
    if (mounted) return;
    mounted = true;

    if (cfg.loadFont && !document.querySelector('link[data-efw-font]')) {
      var l = document.createElement("link");
      l.rel = "stylesheet"; l.setAttribute("data-efw-font", "1");
      l.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap";
      document.head.appendChild(l);
    }

    var host = document.createElement("div");
    host.id = "eventfinder-widget";
    document.body.appendChild(host);
    shadow = host.attachShadow ? host.attachShadow({ mode: "open" }) : host; // shadow DOM w/ fallback

    var style = document.createElement("style");
    style.textContent = css();
    shadow.appendChild(style);

    var frag = document.createElement("div");
    frag.innerHTML = html();
    shadow.appendChild(frag.firstChild);

    var $ = function (sel) { return shadow.querySelector(sel); };
    els = {
      launcher: $(".efw-launcher"), badge: $(".efw-badge"), panel: $(".efw-panel"),
      title: $(".efw-headtxt h1"), status: $(".efw-status"), headBtn: $(".efw-headbtn"),
      chat: $(".efw-chat"), form: $("form"), input: $(".efw-input"), send: $(".efw-send")
    };
    els.title.textContent = cfg.title;
    els.input.placeholder = cfg.placeholder;

    els.launcher.addEventListener("click", function () { isOpen ? close() : open(); });
    els.headBtn.addEventListener("click", close);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && isOpen) close(); });
    els.form.addEventListener("submit", function (e) { e.preventDefault(); submitQuery(els.input.value); });

    // preload so the badge can show the event count before first open
    loadEvents().then(function () {
      if (cfg.showBadge && EVENTS.length && !isOpen) {
        els.badge.textContent = EVENTS.length;
        els.badge.className += " show";
      }
    }).catch(function () { /* retried on open */ });
  }

  function boot() {
    booted = true;
    els.send.disabled = true;
    addMsg(cfg.greeting, "bot");
    if (cfg.chips && cfg.chips.length) addChips(cfg.chips);
    var ready = EVENTS.length ? Promise.resolve() : loadEvents();
    ready.then(function () {
      els.panel.className += " online";
      els.status.textContent = cfg.subtitle || ("Online · " + EVENTS.length + " upcoming events");
      els.send.disabled = false;
      els.input.focus();
    }).catch(function (err) {
      els.status.textContent = "Offline";
      addMsg("Sorry — I couldn't load events right now (" + err.message + "). Please try again later.", "bot");
    });
  }

  function open() {
    if (!mounted) mount();
    isOpen = true;
    els.panel.classList.add("open");
    els.launcher.classList.add("open");
    els.launcher.setAttribute("aria-expanded", "true");
    els.badge.classList.remove("show");
    if (!booted) boot();
    setTimeout(function () { els.input.focus(); }, 250);
  }
  function close() {
    if (!mounted) return;
    isOpen = false;
    els.panel.classList.remove("open");
    els.launcher.classList.remove("open");
    els.launcher.setAttribute("aria-expanded", "false");
  }
  function toggle() { isOpen ? close() : open(); }

  function init(userCfg) {
    cfg = assign({}, DEFAULTS, userCfg || {});
    if (typeof document === "undefined") return;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mount);
    } else {
      mount();
    }
  }

  // programmatic search (opens the panel and runs a query)
  function search(q) {
    open();
    var run = function () { submitQuery(q); };
    if (els.send && !els.send.disabled) run();
    else setTimeout(run, 800); // wait for boot
  }

  // ================= Public API =================
  var API = {
    init: init, open: open, close: close, toggle: toggle, search: search,
    get events() { return EVENTS.slice(); },
    version: "1.0.0",
    _test: {
      parseQuery: parseQuery, filterEvents: filterEvents, parseTwDate: parseTwDate,
      priceText: priceText, genreText: genreText, waShareUrl: waShareUrl, whenText: whenText,
      setEvents: function (e) {
        EVENTS = e.map(function (ev) { return assign({}, ev, { _start: parseTwDate(ev.dates.startdate) }); })
          .sort(function (a, b) { return a._start - b._start; });
      }
    }
  };
  if (typeof window !== "undefined") window.EventFinder = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;

  // ================= Auto-init from <script data-*> attributes =================
  if (typeof document !== "undefined" && document.currentScript) {
    var d = document.currentScript.dataset || {};
    if (d.autoinit !== "false") {
      init({
        apiKey: d.apikey, orgId: d.orgid, venueId: d.venueid, apiBase: d.apibase,
        title: d.title, subtitle: d.subtitle, greeting: d.greeting,
        placeholder: d.placeholder, position: d.position,
        accent1: d.accent, accent2: d.accent2,
        chips: d.chips ? d.chips.split("|") : undefined,
        showBadge: d.badge === "false" ? false : undefined,
        loadFont: d.font === "false" ? false : undefined,
        zIndex: d.zindex ? +d.zindex : undefined,
        maxResults: d.maxresults ? +d.maxresults : undefined
      });
    }
  }
})();
