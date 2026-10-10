# Camping on Public Land

Tools from the Theodore Roosevelt Presidential Library that help people camp on public land around Medora, North Dakota, and keep off private land. Served from GitHub Pages at `camping.labs.trlibrary.com`. Land records are rebuilt weekly and conditions every six hours by GitHub Actions.

The Badlands around Medora are a patchwork. The Little Missouri National Grassland, Theodore Roosevelt National Park, state school trust land, wildlife management areas and private ranches sit side by side, often with no fence or sign between them, and each has its own rules. North Dakota school trust land is the trap most people don't know about: it looks like the grassland, but camping and campfires are banned there.

## The tools

1. **Am I on public land?** One button. With the person's permission it reads the phone's location (on the device; nothing is sent anywhere) and says who manages that ground, whether camping is allowed, and whether a campfire is allowed there today. It warns when the person is close to a boundary or the GPS fix is poor.
2. **Map.** Public land by manager, quarter-mile no-camping zones around developed Forest Service sites, National Forest System roads, and the grassland boundary. Tap anywhere for the same answer as the button. Uncolored land is private or unknown.
3. **Today's conditions.** Campfire restrictions (grassland, BLM and each county), the state fire danger rating and 6-day outlook, rain on clay roads, National Weather Service alerts, and the Forest Service orders posted for the grassland.
4. **Permits and reservations.** What each kind of land needs, with direct links: the park's free backcountry permit, Recreation.gov pages for Cottonwood, Juniper and Roundup, and ND state park reservations.
5. **Rules by land type** and a short before-you-go list.
6. **Offline map** at `/map/`. Can be added to a phone's home screen. "Save this area for offline" stores about 5 miles of topo map around the map's center. The land records, the check button and GPS then work with no signal.

## Embed

```html
<div id="trpl-camping"></div>
<script src="https://camping.labs.trlibrary.com/camping.js" defer></script>
```

| Attribute | Effect |
|---|---|
| `data-view="check"` | Only the "Am I on public land?" button and its answer (with a link to the map) |
| `data-view="map"` | The button and the map |
| `data-view="conditions"` | Only today's conditions |
| `data-view="compact"` | A short conditions summary for a sidebar or the homepage |
| `data-view="permits"` | Only the permits and reservations links (Recreation.gov, park backcountry permits, state parks) |
| `data-more="https://..."` | In the compact and check views, where "See the full guide" / "Open the map" go |
| `data-heading="off"` | Hides the built-in heading and intro |
| `data-cta="off"` | Hides the campground availability link, or give another address. Default: trlibrary.com/visit/lodging/availability |
| `data-target="#id"` | Mounts in a different element |
| `data-fonts="off"` | Does not load the brand fonts |

The widget renders in a shadow root, so page styles do not leak in or out. It carries its own copy of Leaflet and gives a page's existing Leaflet back untouched.

## How a spot is classified

The spot is tested against every land polygon. Coverage is the main box around the grassland and park, plus named extra areas (`EXTRA_AREAS` in `collector/lands.py`; today, Schnell). When layers overlap, the first match in this order wins: national park, state trust land, wildlife refuge, state park, wildlife management area, Corps of Engineers, Bureau of Reclamation, BLM, national grassland. On grassland, a spot within a quarter mile (402 m) of a developed site becomes "Too close to a developed site". A spot in no layer is "Private land or unknown"; if it is inside the grassland boundary, the answer says so.

| Land | Answer | Rule source |
|---|---|---|
| Little Missouri National Grassland | Camping allowed: 14 days in one spot, 28 days a year, a quarter mile from developed sites; vehicles stay on roads while Order 01-18-00-26-03 is posted | [Forest Service dispersed camping](https://www.fs.usda.gov/r01/dpg/recreation/dispersed-camping), [order](https://www.fs.usda.gov/r01/dpg/alerts/area-closure-vehicles-road-little-missouri-national-grassland) |
| Theodore Roosevelt National Park | Permit required (backcountry), or park campgrounds | [NPS backcountry camping](https://www.nps.gov/thro/planyourvisit/backcountry-camping.htm) |
| State school trust land | No camping, no campfires, walk-in only; "Closed" and "Notify the lessee" tracts flagged | [ND Trust Lands public access](https://www.land.nd.gov/node/154) |
| BLM | Camping allowed, 14 days in 28 | [BLM camping](https://www.blm.gov/programs/recreation/camping) |
| Schnell Recreation Area (BLM, near Richardton) | Camping allowed: primitive tent camping except along the nature trail, six sites, no fee, non-motorized | [BLM Schnell page](https://www.blm.gov/visit/schnell-ranch-recreation-area) |
| Fort Berthold Reservation (**off until approved**) | Check the rules: permission from the MHA Nation or the landowner | Three Affiliated Tribes Fish & Wildlife Division |
| Wildlife management areas | 10 days; named areas with no overnight camping or closed Tuesday and Wednesday | [ND Game and Fish](https://gf.nd.gov/wma) |
| State parks, Corps of Engineers | Designated sites only | ND Parks and Recreation; 36 CFR 327.7 |
| Wildlife refuges | Generally no camping | |

**Campfires.** A campfire is shown as not allowed when the matching restriction (the grassland's ranger district, BLM in that county, or else the county) is declared and today's fire danger meets the level the declaration names ("Low" means always), or when a Red Flag Warning covers the county. When in doubt the tool says "check first", never "allowed".

**Roads.** "Likely wet" when any of three points (Medora, Watford City, Amidon) had a quarter inch or more of rain in the last three days; "Rain coming" for the next three.

## Data

| Source | Used for | Read by |
|---|---|---|
| USDA Forest Service EDW, Surface Ownership | Forest Service parcels | `collector/lands.py` |
| ND Department of Trust Lands, Surface Tracts (ND GIS Hub) | Trust land and its public-access status. **Only tract, legal description and access are requested; the service's lessee names, phones and emails are never read.** | `collector/lands.py` |
| USGS PAD-US 4.1 Fee | National park, BLM, wildlife areas, state parks, Corps, Reclamation, refuges | `collector/lands.py` |
| Forest Service EDW, Administrative Boundaries, Recreation Sites, Road Basic | Grassland boundary, developed sites, roads | `collector/lands.py` |
| ND DES `FireDangerIndex_Public` and `Fire_Decs_Indexes_Warnings_Template_Publish` | Fire danger and burn restrictions; county outlines | Browser and `collector/conditions.py` |
| Dakota Prairie Grasslands alerts page | Forest Service orders | `collector/conditions.py` |
| National Weather Service alerts API | Watches and warnings | Browser and `collector/conditions.py` |
| Open-Meteo | Rain and snow, 3 days back and 3 ahead | Browser and `collector/conditions.py` |
| ND Game and Fish, Electronically Posted Lands (ND GIS Hub `GNF_EpostedLandsCached`) | Whether a private spot is posted, asked live for the tapped point (only the `POSTED` flag is requested; owner names and contacts in the service are never read), and the map's posted-land overlay from the state's own tiles | Browser |
| USGS The National Map | Topo and imagery basemaps | Browser |
| BLM Surface Management Agency (`BLM_Natl_SMA_LimitedScale`) | A second opinion for spots no detailed layer covers: if BLM's coarser national map shows a public agency there, the answer adds a note but stays "private or unknown" | Browser |
| BIA Land Area Representations | Fort Berthold Reservation boundary (only a thin strip falls inside the main box) | `collector/lands.py` |

The Forest Service's Motor Vehicle Use Map for the Little Missouri is not in its public map data, so the roads layer is a reference only; the map says so and links to the Forest Service's maps and guides.

## Files

| Path | Purpose |
|---|---|
| `docs/camping.js` | The widget (single file) |
| `docs/index.html` | Preview page with embed snippets |
| `docs/map/` | Full-screen offline map (page, service worker, manifest, icons) |
| `docs/data/*.json` | Land layers, sites, roads, counties, conditions snapshot |
| `docs/vendor/leaflet/` | Leaflet 1.9.4 (BSD-2-Clause) |
| `collector/lands.py` | Builds the land layers (standard library only) |
| `collector/conditions.py` | Builds the conditions snapshot (standard library only) |
| `.github/workflows/lands.yml` | Weekly land refresh (Mondays) |
| `.github/workflows/conditions.yml` | Conditions every six hours |

## Tribal land (switched off)

The Fort Berthold Reservation answer and map outline are built but stay off until the wording is approved under the Library's editorial review for MHA Nation content. Preview them by adding `?tribal=preview` to any page that embeds the widget (for example `https://www.trlibrary.com/visit/camping?tribal=preview`). After approval, set `data-tribal="on"` on the embed, or change the `TRIBAL` default in `docs/camping.js`. The draft text is the `tribal` entry in `CLASSES`.

## Upkeep

- Rules live in `CLASSES` near the top of `docs/camping.js`. The wildlife management area lists (`WMA_NO_CAMPING`, `WMA_TUE_WED`) come from gf.nd.gov/wma; check them each spring.
- **Forest Service orders changed issue.** When the alerts posted on the Dakota Prairie Grasslands page change (an order added or removed, or the off-road or fire flag flips), the conditions workflow opens a GitHub issue. The tool updates itself, but the FAQ on trlibrary.com/visit/camping repeats some orders in plain text and needs a person to edit it.
- The off-road vehicle sentence switches automatically: it appears while a "Vehicles Off Road" alert is posted on the Dakota Prairie Grasslands alerts page (`flags.offroad_closed` in conditions.json). The order runs through July 22, 2028.
- If a source changes shape, the collectors keep the last good file rather than writing an empty one. Run either workflow from the Actions tab to refresh by hand.

## Run locally

```bash
python collector/lands.py
python collector/conditions.py
cd docs && python -m http.server 8000      # preview at http://localhost:8000
```

## GitHub Pages setup

1. Settings → Pages → Deploy from a branch → `main`, folder `/docs`.
2. Custom domain `camping.labs.trlibrary.com` (already in `docs/CNAME`; the wildcard DNS record covers it). Tick "Enforce HTTPS" once the certificate is issued. Location only works over HTTPS.
3. Settings → Actions → General → Workflow permissions → Read and write.

## Not legal advice

The Library does not manage any of this land. Land records are approximate and are not a survey. Posted signs, fences and the managing agency always have the final word.
