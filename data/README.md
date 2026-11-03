# Shared data and sources

Both interfaces read this directory through `assets/data.js`. Ranking is implemented once in `assets/ranking.js`.

| Asset | Contents | Join key |
| --- | --- | --- |
| `forums.json` | 42 forum codes, names, publication labels, scope, notes, source links, forum website links and coverage types | `code` |
| `local-risks.json` | 631 local records with the original rating, likelihood, impact, graphical rating, reference and source fields where present | `id`, `forum_code` |
| `national-risks.json` | 95 national risks with descriptions, edition and PDF page references | `national_id` |
| `risk-matches.json` | 631 provisional local-to-national match records | `local_id`, `forum_code`, optional `national_id` |
| `risk-definitions.json` | Source-backed local summaries, national summaries and separately curated related background | Local risk IDs and national IDs |
| `risk-matches.csv` | Downloadable copy of the match records, replacing the missing spreadsheet | Same fields as JSON |
| `boundaries.geojson` | All 42 ONS forum geometries preserved from the original explorer | `properties.code` |

## Provenance

The collection was separated from the repository's original v1.7 `index.html` on 31 October 2026. All initial data and subsequent `Object.assign(DATA, …)` additions were merged in their original order. Local risk IDs come from the existing crosswalk, not newly inferred national matches. Original risk fields are preserved; forum names are standardised to the existing boundary names and connected through official codes.

- **Forum website links:** `website_url` comes from the [GOV.UK LRF contact directory](https://www.gov.uk/guidance/local-resilience-forums-contact-details), checked 31 October 2026. A dedicated forum website is preferred; where none is listed, the directory’s risk information page or PDF is used and labelled accordingly. These links are separate from the risk register source links.
- **Local registers:** source links are recorded per forum in `forums.json`. Publication/version labels and completeness warnings are preserved. Per-risk source notes and page references are in `local-risks.json`. Some links lead to general risk pages rather than a specific PDF; further verification is needed.
- **Boundaries:** attributed by the original prototype to ONS Open Geography, December 2024, England and Wales. The geometry is unchanged. Exact dataset URL, boundary resolution and applicable attribution/licence still need verification. Simplified boundary geometry can be ambiguous near area boundaries; postcode results are not property-level determinations.
- **National risks:** labelled by the original prototype as National Risk Register 2026, `UK_National_Risk_Register_2026.pdf`. The PDF is not supplied. The catalogue includes page references, but some text is visibly garbled or truncated. Do not treat these descriptions as audited quotations. The interface links to the official National Risk Register collection.
- **Matches:** provisional existing classifications. Only `Direct` matches filter the dashboard and highlight its map. `Candidate`, `Broad / multiple`, and `Review / unmatched` records remain available for review and download; they are not silently promoted to direct matches.

The MIT software licence does not establish reuse rights for third-party source documents, descriptions or geography. Their applicable terms need checking against the original sources.

## Ranking and coverage

Published Very Low, Low, Medium, High and Very High labels map to 1–5. Otherwise numeric likelihood × impact maps into five product bands (1–5, 6–10, 11–15, 16–20, 21–25). Otherwise approximate visual ratings are rounded. Unsupported labels such as Critical, Severe and Moderate retain their source meaning; they do not receive a guessed category mapping. If none of these inputs exists, the entry stays unranked. These are navigation ranks, not measured probabilities or comparable official ratings.

Coverage is explicit: `detailed` identifies individually transcribed tables/matrices; `summary` identifies headline, narrative, selected or partial records. It does not imply a source is complete or absent. The scope and notes give the specific caveats.

When adding records, keep IDs unique, use the relevant forum code, retain source evidence, and add a match record marked for review if no national match is established. Keep the CSV export consistent and run `python3 tools/validate.py`.

## Risk definitions

Both interfaces show a risk definition before the expandable **Rating and source details**. `risk-definitions.json` is the shared content asset. Each local/national summary references a source record and PDF page. Text is a plain-English summary, not a quotation or an official new risk assessment.

Resolution order:

1. A recorded local summary for that exact local risk ID.
2. A national summary linked through a **Direct** crosswalk record, labelled as national with the provisional-match caveat.
3. Separately curated **National background** for related or broader topics. Exact title aliases and explicitly reviewed topic groups were used, not fuzzy matching. This does not change the crosswalk or claim an exact local scenario match.
4. An explicit missing-definition message and the original local source link.

The first content pass includes nine local definitions checked against Avon and Somerset CRR 2026, plus 95 national scenario summaries checked against National Risk Register 2026. Definitions or labelled national background cover 586 of 631 local entries. The remaining 45 require further local source work; some concerns, such as climate change as a chronic risk or local infrastructure incidents, do not have a suitable single national scenario. A national fallback does not mean a local definition is absent from the original document—only that it has not yet been recorded here.

Local register PDF: https://media.aspolice.net/uploads/production/20260907120559/Community-risk-register.pdf

National register PDF: https://assets.publishing.service.gov.uk/media/6a50d66b1228eb26a4cab76c/National_Risk_Register_2026.pdf

PDF page references count from the start of the file and may differ from printed page numbers. The existing raw national excerpts are retained for provenance, but the catalogue displays the new summaries when available. Definitions never alter ratings, likelihood, impact or the national-match status. Adding further local summaries automatically takes precedence in both tools.
