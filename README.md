# Climate Resilient UK — Community risk

A static prototype with two interfaces drawing from shared data. The local collection covers England and Wales.

## Pages

The public site uses `communityrisk.climateresilient.org.uk`:

- `https://communityrisk.climateresilient.org.uk/` — project introduction and menu.
- `https://communityrisk.climateresilient.org.uk/registers/` — full risk register dashboard.
- `https://communityrisk.climateresilient.org.uk/bypostcode/` — postcode finder.

All internal links are relative. The same files also work under the current repository address, or another static hosting directory. The former home-page dashboard has moved to `registers/`.

## Structure

- `index.html`: project home page.
- `registers/index.html`, `bypostcode/index.html`: interface markup.
- `assets/`: page styling, interface code, shared data loading, ranking rules and geographic lookup.
- `data/`: the shared collection, documented in [data/README.md](data/README.md).
- `tools/validate.py`: checks data references, ranges, identifiers and local file links.
- `tests/`: browser checks using Python, Chromium and ChromeDriver; no Python packages required.

There is no application server, package installation or build step. JavaScript modules load JSON files over HTTP; opening the pages directly with `file://` will not work.

## Run locally

From this folder:

```sh
python3 tools/validate.py
python3 -m http.server 8000
```

Open `http://localhost:8000/`, then use the menu. To run browser checks (with Chromium and ChromeDriver installed):

```sh
python3 tests/browser_checks.py
```

For an additional check against real Postcodes.io responses, Leaflet styling and OpenStreetMap tiles, run `python3 tests/browser_checks.py --live` (requires internet access).

The browser checks start their own temporary HTTP server and browser driver. Postcode responses and unavailable external map services are simulated so the checks do not depend on internet access.

## Updating data

Edit the files in `data/`, not the interface JavaScript. Forum codes connect risks, area metadata, maps and national matches. Preserve stable risk IDs. Update the downloadable `risk-matches.csv` when editing `risk-matches.json`; the validator checks they agree. Run validation and browser checks before publishing.

The original 42 areas, 631 local entries, 95 national entries and 631 match records have been preserved, including later additions and corrections to the original inline dataset. Their transcription has not been independently audited. Source dates, coverage and caveats remain attached to the records. Source records are snapshots, not automatically refreshed feeds.

## GitHub Pages

This checkout does not control the repository's GitHub Pages settings.

1. Keep the repository at `pedrito1414/communityrisk` and preserve the root `CNAME` file containing `communityrisk.climateresilient.org.uk`.
2. In **Settings → Pages**, select **Deploy from a branch**, branch **main**, folder **/(root)**.
3. Commit and push the complete project, including `assets/` and `data/`. No custom build workflow is required.
4. Check the Pages deployment result and the three page addresses above.

The custom subdomain has a CNAME DNS record pointing to `pedrito1414.github.io`. HTTPS is enforced in GitHub Pages. The main `climateresilient.org.uk` domain continues to serve WordPress. Do not remove the repository’s `CNAME` file when publishing updates.

## External services and limits

The postcode finder sends a submitted postcode to Postcodes.io to obtain its location. It matches that location against the same stored ONS boundaries used by the dashboard, using official forum codes. A shared link prefills the postcode; it is not submitted automatically. The postcode appears in the page URL after a successful lookup. The application does not store postcode searches in a database.

Leaflet from unpkg and OpenStreetMap background tiles are optional external map resources. If Leaflet cannot load, a local SVG shows the boundary and postcode marker. If background tiles fail, the boundary overlay remains usable. A postcode service failure shows an error and removes previous results rather than showing a stale area's risks.

This is a public test prototype. Coverage is incomplete, national excerpts include known PDF extraction defects, national matches are provisional, and sources differ in assessment methods. The common 1–5 navigation rank is not an official score or personal risk estimate. Before public promotion, validate sources, descriptions, scores, links and accessibility. Do not collect household personal data in this prototype.

## Visit and behaviour statistics

The private dashboard is at `https://climateresilient.goatcounter.com/`. Sign in there to read statistics. No password or API key is stored in this repository. The public counting endpoint is configured once in `assets/analytics.js`.

Tracking uses GoatCounter’s [documented browser counting endpoint](https://www.goatcounter.com/help/pixel), rather than loading the default third-party script. The default script sends `location.search` as a campaign field even when the page path is customised. This integration constructs only approved fields and never includes that query field.

- One pageview per load of the home menu, register dashboard or postcode finder. Postcode searches do not create extra pageviews.
- Events for navigation, postcode attempts/success/failure, selected forum areas, opened risk details, national risk selection, dashboard views, forum/register links and the crosswalk download.
- Event names include the interface and, where relevant, a validated official forum code or risk ID. Use `data/forums.json`, `local-risks.json` and `national-risks.json` to interpret the IDs. Example: `postcode-succeeded/bypostcode/E48000008`.
- No full postcodes, coordinates, search text, query strings, fragments or raw error messages are sent. Referrers are reduced to their origin. Requests omit cookies and the HTTP Referer header. GoatCounter still receives ordinary connection information such as IP address and browser headers.
- Only the production custom hostname and the former GitHub Pages hostname can count visits; local previews do not. Do Not Track, Global Privacy Control, and the browser opt-out suppress all counting requests.
- The [privacy page](privacy/index.html) explains this and offers an opt-out stored as the local browser preference `skipgc=t`. It does not itself send pageviews.
- The tracker is separate from the application modules. Blocking the script or counting endpoint does not stop the tools. Ad blockers and privacy choices mean the figures are approximate; events can also be grouped by GoatCounter’s visitor/session rules. Activity before installation cannot be reconstructed.

The browser checks intercept all counting requests locally and verify their contents, opt-out behaviour and tracker failure. They do not send test events to your dashboard.
