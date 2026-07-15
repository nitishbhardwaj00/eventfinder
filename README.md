# EventFinder Chat Widget SDK

An embeddable event-search chatbot for any website, powered by the TicketWeb feed API. One script tag adds a floating launcher bubble; visitors ask things like "events this week" or "country music next month" and get event cards with prices, genres, ticket links, and WhatsApp share buttons.

## Quick start

Host `eventfinder-widget.js` anywhere (your site, S3, CDN) and add one line before `</body>`:

```html
<script src="https://your-cdn.com/eventfinder-widget.js"
        data-apikey="YOUR_TICKETWEB_KEY"
        data-orgid="45742"
        data-venueid="740573"></script>
```

Done. The widget injects itself, styles are isolated in a Shadow DOM so your site's CSS can't break it (and vice versa), and events preload in the background so the launcher badge shows the upcoming-event count.

## Configuration (data attributes)

| Attribute | Default | Description |
|---|---|---|
| `data-apikey` | demo key | TicketWeb API key |
| `data-orgid` | `45742` | TicketWeb organization ID |
| `data-venueid` | `740573` | Venue ID; omit or set `""` to search all org venues |
| `data-title` | `Event Finder` | Panel header title |
| `data-subtitle` | auto | Header status line (default: "Online · N upcoming events") |
| `data-greeting` | built-in | First bot message |
| `data-chips` | built-in | Suggestion chips, pipe-separated: `Events this week\|Shows this month` |
| `data-placeholder` | built-in | Input placeholder |
| `data-position` | `right` | `right` or `left` corner |
| `data-accent` / `data-accent2` | `#6366f1` / `#8b5cf6` | Brand gradient colors |
| `data-badge` | `true` | `false` hides the event-count badge |
| `data-font` | `true` | `false` skips loading Inter from Google Fonts |
| `data-zindex` | `999999` | Stacking order |
| `data-maxresults` | `10` | Max cards per answer |
| `data-autoinit` | `true` | `false` = don't render until you call `EventFinder.init()` |

## JavaScript API

```html
<script src="eventfinder-widget.js" data-autoinit="false"></script>
<script>
  EventFinder.init({
    apiKey: "YOUR_KEY",
    orgId: "45742",
    venueId: "740573",
    title: "Event Finder",
    accent1: "#e11d48",          // match your brand
    chips: ["Events this week", "Free shows"],
  });

  EventFinder.open();                       // open the popup
  EventFinder.close();                      // close it
  EventFinder.toggle();                     // toggle
  EventFinder.search("events this week");   // open + run a query
  EventFinder.events;                       // loaded events (array copy)
</script>
```

Any button on your page can trigger it: `<button onclick="EventFinder.open()">Find events</button>`.

## What the chatbot understands

Date phrases (today, tonight, tomorrow, this/next week, this/next weekend, this/next month, "July 28", "next Thursday"), cities ("shows in New York"), and free-text keywords matched against event names, descriptions, artists, and genres — all combinable: "country music next week in new york".

## Notes

- Requests go straight from the browser to `api.ticketweb.com` with a `fetch` → JSONP fallback. If your key is sensitive, proxy the request server-side and point `apiBase` at your proxy.
- Files: `eventfinder-widget.js` (the SDK), `index.html` (demo page).# eventfinder
