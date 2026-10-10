/*! TRPL Public Land Camping Guide | Theodore Roosevelt Presidential Library | camping.labs.trlibrary.com
 *
 * Helps people camp on public land around Medora, North Dakota, and stay off private land:
 *   - "Am I on public land?"  one tap, uses the phone's location, says who manages the ground
 *     and whether camping is allowed there
 *   - a map of public land, quarter-mile no-camping zones around developed sites, and
 *     Forest Service roads
 *   - today's conditions: campfire restrictions, fire danger, rain on clay roads, weather
 *     alerts and Forest Service orders
 *   - the rules for each kind of land
 *
 * Embed:
 *   <div id="trpl-camping"></div>
 *   <script src="https://camping.labs.trlibrary.com/camping.js" defer></script>
 *
 * Optional attributes on the script tag:
 *   data-view="check"        only the "Am I on public land?" button and its answer
 *   data-view="map"          only the map (with the check button)
 *   data-view="conditions"   only today's conditions
 *   data-view="compact"      a short conditions summary for a sidebar, linking to data-more
 *   data-view="permits"      only the permits and reservations links
 *   data-view="app"          full-screen layout used by the offline map at /map/
 *   data-heading="off"       hide the built-in heading and intro
 *   data-more="https://..."  where "See the full guide" goes in the compact view
 *   data-cta="off"           hide the campground link (or give another address)
 *   data-target="#some-id"   mount somewhere other than #trpl-camping
 *   data-fonts="off"         do not load the brand fonts
 *
 * Location is read on the device and never sent anywhere. Land data comes from docs/data/
 * in this repository (rebuilt weekly); conditions are read live where the source allows it
 * and fall back to docs/data/conditions.json (refreshed every few hours).
 */
(function () {
  'use strict';

  var script = document.currentScript;
  var BASE = script && script.src ? new URL('.', script.src).href : './';
  var opts = (script && script.dataset) || {};
  var host = (opts.target && document.querySelector(opts.target)) || document.getElementById('trpl-camping');
  if (!host) {
    host = document.createElement('div');
    host.id = 'trpl-camping';
    if (script && script.parentNode) script.parentNode.insertBefore(host, script);
    else document.body.appendChild(host);
  }
  if (host.shadowRoot) return;
  var root = host.attachShadow({ mode: 'open' });

  var VIEW = opts.view || 'full';
  var APP = VIEW === 'app';
  var SHOW = {
    heading: opts.heading !== 'off' && VIEW !== 'compact' && !APP,
    check: VIEW === 'full' || VIEW === 'check' || VIEW === 'map' || APP,
    map: VIEW === 'full' || VIEW === 'map' || APP,
    conditions: VIEW === 'full' || VIEW === 'conditions' || APP,
    compact: VIEW === 'compact',
    rules: VIEW === 'full',
    permits: VIEW === 'full' || VIEW === 'permits' || APP,
    offline: APP && 'caches' in window
  };
  var CTA = opts.cta === 'off' ? null : (opts.cta || 'https://www.trlibrary.com/visit/lodging/availability');
  var MORE = opts.more || 'https://camping.labs.trlibrary.com/';
  var APP_URL = 'https://camping.labs.trlibrary.com/map/';
  var CENTER = [46.95, -103.45];
  var QUARTER_MILE = 402.3;   // metres
  var LEVELS = ['', 'Low', 'Moderate', 'High', 'Very High', 'Extreme'];
  var LEVEL_COLORS = ['#EEECE5', '#8FC895', '#99ADC5', '#F9D635', '#FC924E', '#F36079'];
  var COUNTIES = ['Billings', 'Golden Valley', 'McKenzie', 'Slope', 'Stark', 'Dunn', 'Bowman'];

  var DES = 'https://services1.arcgis.com/qQaNyq8h4wNEdlUV/arcgis/rest/services';
  var URLS = {
    lands: BASE + 'data/lands.json',
    sites: BASE + 'data/sites.json',
    roads: BASE + 'data/roads.json',
    counties: BASE + 'data/counties.json',
    meta: BASE + 'data/meta.json',
    conditions: BASE + 'data/conditions.json',
    leafletJs: BASE + 'vendor/leaflet/leaflet.js',
    leafletCss: BASE + 'vendor/leaflet/leaflet.css',
    danger: DES + '/FireDangerIndex_Public/FeatureServer/0/query?where=' + encodeURIComponent('NAME IN (' + COUNTIES.map(function (c) { return "'" + c + "'"; }).join(',') + ')') +
      '&outFields=NAME,FireIndex,day1,day2,day3,day4,day5,day6,DatePublished&returnGeometry=false&f=json',
    restrictions: DES + '/Fire_Decs_Indexes_Warnings_Template_Publish/FeatureServer/0/query?where=' + encodeURIComponent("remove<>'Yes'") +
      '&outFields=county,Jurisdiction_Type,declaration_status,campfires_conditions,campfires_red_checkbox,camp_conditions,FireIndex,burn_expiration_date,banincludedcities_v1&returnGeometry=false&f=json',
    nws: 'https://api.weather.gov/alerts/active?zone=NDC007,NDC033,NDC053,NDC087,NDC089,NDC025,NDC011',
    rain: 'https://api.open-meteo.com/v1/forecast?latitude=46.914,47.59,46.62&longitude=-103.524,-103.27,-103.45' +
      '&daily=precipitation_sum,snowfall_sum,precipitation_probability_max&past_days=3&forecast_days=4&timezone=America%2FDenver&precipitation_unit=inch'
  };
  var TILES = {
    topo: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
    imagery: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}'
  };
  var TILE_CACHE = 'trpl-camping-tiles-v1';

  var LINKS = {
    dpgDispersed: 'https://www.fs.usda.gov/r01/dpg/recreation/dispersed-camping',
    dpgAlerts: 'https://www.fs.usda.gov/r01/dpg/alerts',
    dpgMaps: 'https://www.fs.usda.gov/r01/dpg/maps-guides',
    offroadOrder: 'https://www.fs.usda.gov/r01/dpg/alerts/area-closure-vehicles-road-little-missouri-national-grassland',
    npsBackcountry: 'https://www.nps.gov/thro/planyourvisit/backcountry-camping.htm',
    npsCamping: 'https://www.nps.gov/thro/planyourvisit/camping.htm',
    cottonwood: 'https://www.recreation.gov/camping/campgrounds/251160',
    cottonwoodGroup: 'https://www.recreation.gov/camping/campgrounds/10294670',
    juniper: 'https://www.recreation.gov/camping/campgrounds/10386756',
    juniperGroup: 'https://www.recreation.gov/camping/campgrounds/72481',
    roundup: 'https://www.recreation.gov/camping/campgrounds/251161',
    dpgCampgrounds: 'https://www.fs.usda.gov/r01/dpg/recreation/what-expect-when-camping-grasslands',
    trust: 'https://www.land.nd.gov/node/154',
    wma: 'https://gf.nd.gov/wma',
    blm: 'https://www.blm.gov/programs/recreation/camping',
    parks: 'https://www.reservendparks.com/',
    burn: 'https://burnrestrictions.nd.gov'
  };

  // ---------- what each kind of land means for a camper ----------
  // status: ok (camping allowed) | permit | sites (designated sites only) | check (varies) | no
  var STATUS = {
    ok: { word: 'Camping allowed', bg: '#1B4532', ink: '#fff' },
    permit: { word: 'Permit required', bg: '#092A4D', ink: '#fff' },
    sites: { word: 'Campgrounds only', bg: '#D1CCBD', ink: '#25282A' },
    check: { word: 'Check the rules', bg: '#F9D635', ink: '#25282A' },
    no: { word: 'No camping', bg: '#E7805D', ink: '#25282A' }
  };

  function vehicleRule() {
    if (state.flags.offroad_closed) {
      return 'Keep your vehicle on Forest Service roads. Under Forest Order 01-18-00-26-03 (through July 22, 2028), driving off a road is prohibited, even a short way to reach a campsite. Ask the ranger district where you can pull over and park.';
    }
    return 'Drive only on roads open to vehicles. Check with the ranger district before pulling off a road to reach a campsite.';
  }

  var CLASSES = {
    usfs: {
      label: 'Little Missouri National Grassland', who: 'U.S. Forest Service, Dakota Prairie Grasslands', status: 'ok',
      fill: '#8FC895', legend: 'National Grassland',
      rules: function () {
        return [
          'Free dispersed camping is allowed outside developed campgrounds.',
          'Stay no more than 14 days in a row in one spot, and no more than 28 days in a calendar year.',
          'Camp at least a quarter mile from campgrounds, trailheads, picnic areas and other developed sites.',
          vehicleRule(),
          'There is no water, trash pickup or toilet. Pack out everything you bring in.',
          'Expect cattle and oil and gas sites. Leave gates the way you find them.'
        ];
      },
      links: [['Forest Service dispersed camping rules', LINKS.dpgDispersed], ['Current Forest Service orders', LINKS.dpgAlerts]],
      contact: 'Medora Ranger District, Dickinson: (701)\u00a0227\u20117800. McKenzie Ranger District, Watford City: (701)\u00a0842\u20118500.'
    },
    nps: {
      label: 'Theodore Roosevelt National Park', who: 'National Park Service', status: 'permit',
      fill: '#092A4D', legend: 'National park',
      rules: function () {
        return [
          'No roadside or car camping. Stay in a park campground, or backpack in with a free backcountry permit.',
          'Backcountry camps must be at least a quarter mile from roads and trailheads and 200 feet from water.',
          'No open fires, pets or bikes in the backcountry. There is no approved drinking water, so carry all you need.',
          'Camping in the backcountry is limited to 14 days in a row.'
        ];
      },
      links: [['Get a free backcountry permit', LINKS.npsBackcountry], ['Reserve Cottonwood Campground (South Unit)', LINKS.cottonwood], ['Reserve Juniper Campground (North Unit)', LINKS.juniper]],
      contact: 'Theodore Roosevelt National Park: (701)\u00a0623\u20114466.'
    },
    trust: {
      label: 'State school trust land', who: 'North Dakota Department of Trust Lands', status: 'no',
      fill: '#E7805D', legend: 'State trust land (no camping)',
      rules: function (p) {
        var r = [];
        if (p && p.a === 'Closed') r.push('This tract is posted closed to all public access.');
        else if (p && /notify/i.test(p.a || '')) r.push('This tract requires notifying the leaseholder before anyone enters. The Department of Trust Lands can tell you who to contact.');
        r.push('Camping and campfires are not allowed on North Dakota school trust land.');
        r.push('Walk-in access only. No driving: leave your vehicle at the gate or section line.');
        r.push('This land is leased, often for grazing. Respect livestock and fences.');
        return r;
      },
      links: [['Trust land public access rules', LINKS.trust]],
      contact: ''
    },
    blm: {
      label: 'Bureau of Land Management land', who: 'Bureau of Land Management', status: 'ok',
      fill: '#F9D635', legend: 'BLM land',
      rules: function () {
        return [
          'Dispersed camping is generally allowed, up to 14 days within any 28-day period, unless an area is posted closed.',
          'Stay on existing roads and trails.',
          'Many BLM parcels here are small and surrounded by private land. Make sure you have legal access before you go.'
        ];
      },
      links: [['BLM camping rules', LINKS.blm]],
      contact: ''
    },
    wma: {
      label: 'Wildlife management area', who: 'North Dakota Game and Fish Department', status: 'check',
      fill: '#99ADC5', legend: 'Wildlife management area',
      rules: function (p) {
        var w = wmaRule(p && p.n);
        var r = [];
        if (w === 'none') r.push('Overnight camping is prohibited on this wildlife management area.');
        else if (w === 'tuewed') r.push('Camping is allowed Thursday through Monday only. It is closed to camping on Tuesdays and Wednesdays (except holidays), and all equipment must be removed those days.');
        else r.push('Camping is allowed for up to 10 days in a row, unless the area is posted closed to camping at its entrance.');
        r.push('Vehicles must stay on constructed roads, established trails and parking areas.');
        r.push('No fireworks. No firewood brought in from elsewhere; downed wood on site may be gathered.');
        return r;
      },
      links: [['Wildlife management area regulations', LINKS.wma]],
      contact: 'North Dakota Game and Fish: (701)\u00a0328\u20116300.'
    },
    park: {
      label: 'State park or recreation area', who: 'North Dakota Parks and Recreation', status: 'sites',
      fill: '#1B4532', legend: 'State park',
      rules: function () { return ['Camp in the park campground. Sites are booked through North Dakota Parks and Recreation.']; },
      links: [['Reserve a state park campsite', LINKS.parks]],
      contact: ''
    },
    usace: {
      label: 'U.S. Army Corps of Engineers land', who: 'U.S. Army Corps of Engineers', status: 'sites',
      fill: '#D1CCBD', legend: 'Corps of Engineers',
      rules: function () { return ['Camping is permitted only at sites and areas the Corps designates, and for no more than 14 days in any 30-day period without written permission.']; },
      links: [], contact: ''
    },
    usbr: {
      label: 'Bureau of Reclamation land', who: 'Bureau of Reclamation', status: 'check',
      fill: '#D1CCBD', legend: 'Bureau of Reclamation',
      rules: function () { return ['Camping rules vary. Follow posted signs or ask the managing office.']; },
      links: [], contact: ''
    },
    fws: {
      label: 'National wildlife refuge', who: 'U.S. Fish and Wildlife Service', status: 'no',
      fill: '#F36079', legend: 'Wildlife refuge',
      rules: function () { return ['Overnight camping is generally not allowed on refuges and waterfowl production areas. Follow posted rules.']; },
      links: [], contact: ''
    },
    buffer: {
      label: 'Too close to a developed site', who: 'U.S. Forest Service, Dakota Prairie Grasslands', status: 'no',
      fill: '#F36079', legend: 'Quarter mile around developed sites',
      rules: function (p) {
        return [
          'This spot is within a quarter mile of ' + (p && p.n ? p.n : 'a developed recreation site') + '. Dispersed camping is not allowed this close.',
          'Move at least a quarter mile away, or stay in the campground.'
        ];
      },
      links: [['Forest Service dispersed camping rules', LINKS.dpgDispersed]],
      contact: 'Medora Ranger District, Dickinson: (701)\u00a0227\u20117800. McKenzie Ranger District, Watford City: (701)\u00a0842\u20118500.'
    },
    private: {
      label: 'Private land or unknown', who: 'Not in any public land record this guide uses', status: 'no',
      fill: null, legend: 'No color: private or unknown',
      rules: function (p) {
        var r = [];
        if (p && p.inside) r.push('This spot is inside the national grassland boundary, but this parcel is not Forest Service land. The grassland is a patchwork of public, state and private land.');
        r.push('Treat it as private. Do not camp, build a fire or drive off the road here without the landowner\u2019s permission.');
        r.push('Look for public land nearby on the map below.');
        return r;
      },
      links: [], contact: ''
    }
  };
  // Permits and reservations, by land. Recreation.gov IDs checked against the park's camping page (October 2026).
  var PERMITS = [
    { land: 'Little Missouri National Grassland', need: 'No permit for dispersed camping',
      text: 'Free, up to 14 days in one spot. Forest Service campgrounds on the grassland have their own fees and rules.',
      links: [['Forest Service camping rules', LINKS.dpgDispersed], ['Grassland campgrounds', LINKS.dpgCampgrounds]] },
    { land: 'Theodore Roosevelt National Park, backcountry', need: 'Free backcountry permit',
      text: 'Required for every overnight stay in the backcountry. Get it from a park visitor center; have your group size, nights and route ready.',
      links: [['Backcountry permits', LINKS.npsBackcountry]] },
    { land: 'Theodore Roosevelt National Park, campgrounds', need: 'Reservation on Recreation.gov',
      text: 'The park cannot take reservations directly.',
      links: [['Cottonwood Campground (South Unit)', LINKS.cottonwood], ['Cottonwood group site', LINKS.cottonwoodGroup], ['Juniper Campground (North Unit)', LINKS.juniper], ['Juniper group site', LINKS.juniperGroup], ['Roundup Group Horse Camp', LINKS.roundup]] },
    { land: 'North Dakota state parks', need: 'Reservation',
      text: 'Includes Rough Rider State Park near Medora.',
      links: [['Reserve a state park campsite', LINKS.parks]] },
    { land: 'Wildlife management areas', need: 'No permit',
      text: 'Up to 10 days where camping is allowed. Some areas ban camping or close Tuesdays and Wednesdays.',
      links: [['Wildlife management area rules', LINKS.wma]] },
    { land: 'State school trust land', need: 'Camping not allowed',
      text: 'No permit makes camping legal here. Walk-in recreation only.',
      links: [['Trust land public access rules', LINKS.trust]] }
  ];
  function permitsSection() {
    var sec = el('section', { 'aria-label': 'Permits and reservations' });
    sec.appendChild(el('h3', { text: 'Permits and reservations' }));
    var list = el('div', { class: 'cards' });
    PERMITS.forEach(function (p) {
      var c = el('div', { class: 'card' }, [el('h4', { text: p.land }), el('p', { class: 'need', text: p.need }), el('p', { text: p.text })]);
      var ul = el('ul', { class: 'plinks' });
      p.links.forEach(function (l) { ul.appendChild(el('li', {}, [el('a', { href: l[1], target: '_blank', rel: 'noopener', text: l[0] })])); });
      c.appendChild(ul);
      list.appendChild(c);
    });
    sec.appendChild(list);
    return sec;
  }

  // When layers overlap, the more restrictive or more specific one wins.
  var PRECEDENCE = ['nps', 'trust', 'fws', 'park', 'wma', 'usace', 'usbr', 'blm', 'usfs'];

  // ND Game and Fish, gf.nd.gov/wma (checked October 2026)
  var WMA_NO_CAMPING = ['alkali creek', 'spring creek', 'antelope creek', 'big oxbow', 'lewis and clark', 'neu', 'och', 'overlook',
    'sullivan', 'tweden', 'tobacco garden', 'hofflund', 'kerr slough', 'trenton', 'van hook'];
  var WMA_TUE_WED = ['bull creek', 'killdeer mountain', 'camel', 'cedar lake', 'speck davis', 'smishek', 'short creek', 'baukol', 'mcgregor'];
  var RENAMED = { 'Sully Creek State Recreation Area': 'Rough Rider State Park' };   // renamed by ND Parks and Recreation
  var WMA_NAMES = { 'neu': 'Neu\u2019s Point', 'ochs': 'Och\u2019s Point', 'camel hump': 'Camels Hump Lake' };
  function wmaName(name) {
    var n = String(name || '').replace(/ Wildlife Management Area$/i, '');
    return (WMA_NAMES[n.toLowerCase()] || n) + ' Wildlife Management Area';
  }
  function wmaRule(name) {
    var n = String(name || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/wildlife management area|wma/g, '').trim();
    function hit(list) { return list.some(function (k) { return n === k || n.indexOf(k) === 0; }); }
    if (hit(WMA_NO_CAMPING)) return 'none';
    if (hit(WMA_TUE_WED)) return 'tuewed';
    return 'days';
  }

  // ---------- brand fonts (same files trlibrary.com uses) ----------
  var FONT_BASE = 'https://www.trlibrary.com/themes/custom/trpl/css/';
  var FONTS = [
    ['Dharma Gothic E', 700, 'dharma_type-dharmagothice-bold.woff2'],
    ['Clearface', 400, 'clearfacestd-regular.woff2'],
    ['Clearface', 700, 'clearfacestd-heavy.woff2'],
    ['Frutiger', 400, 'frutigerltstd-regular.woff2'],
    ['Frutiger', 700, 'frutigerltstd-bold.woff2']
  ];
  (function loadFonts() {
    var onMainSite = /^(www\.)?trlibrary\.com$/.test(location.hostname);
    if (opts.fonts === 'off' || onMainSite || document.getElementById('trpl-brand-fonts')) return;
    var style = document.createElement('style');
    style.id = 'trpl-brand-fonts';
    style.textContent = FONTS.map(function (f) {
      return '@font-face{font-family:"' + f[0] + '";font-weight:' + f[1] + ';font-style:normal;font-display:swap;src:url("' + FONT_BASE + f[2] + '") format("woff2")}';
    }).join('');
    document.head.appendChild(style);
  })();
  var SANS = 'Frutiger,"Frutiger Next","Helvetica Neue",Arial,sans-serif';
  var SERIF = 'Clearface,Georgia,"Times New Roman",serif';
  var DISPLAY = '"Dharma Gothic E","Oswald","Arial Narrow",sans-serif';

  // Colors and type follow the TRPL Brand Identity System & Guidelines (see AuroraWatch for the full list).
  var CSS = [
    ':host{display:block;container-type:inline-size;font-family:' + SERIF + ';color:#25282A;line-height:1.45;' +
      '--forest:#1B4532;--night:#092A4D;--ink:#25282A;--sand:#D1CCBD;--orange:#E7805D;--bright:#8FC895;--sky:#99ADC5;--yellow:#F9D635;--pink:#F36079;' +
      '--line:#D1CCBD;--muted:#5A5F61;--wash:#F4F2EC}',
    '*{box-sizing:border-box}',
    'a{color:var(--forest)}',
    'h2{font-family:' + DISPLAY + ';font-weight:700;text-transform:uppercase;letter-spacing:.02em;font-size:clamp(2.2rem,6vw,3.4rem);line-height:.95;margin:0 0 .3em;color:var(--forest)}',
    'h3{font-family:' + DISPLAY + ';font-weight:700;text-transform:uppercase;letter-spacing:.03em;font-size:clamp(1.7rem,4vw,2.2rem);line-height:1;margin:1.6em 0 .5em;color:var(--forest)}',
    'h4{font-family:' + SANS + ';font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 6px}',
    '.intro{font-size:1.12rem;margin:0 0 1.1em;max-width:46em}',
    '.eyebrow{font-family:' + SANS + ';font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin:0 0 6px}',
    // check panel
    '.check{background:var(--forest);color:#fff;border-radius:2px;padding:22px 22px 20px}',
    '.check .eyebrow{color:var(--bright)}',
    '.check p{margin:0 0 14px;max-width:40em}',
    '.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:52px;padding:8px 24px 6px;border-radius:2px;font-family:' + DISPLAY + ';font-weight:700;font-size:1.6rem;letter-spacing:.04em;text-transform:uppercase;text-decoration:none;border:1px solid var(--orange);background:var(--orange);color:var(--ink);cursor:pointer}',
    '.btn:hover{background:#D07556;border-color:#D07556}',
    '.btn:disabled{opacity:.7;cursor:progress}',
    '.btn.ghost{background:transparent;color:#fff;border-color:rgba(255,255,255,.6);font-size:1.3rem;min-height:44px}',
    '.btn.small{font-size:1.2rem;min-height:40px;padding:6px 16px 4px}',
    '.btn.line{background:#fff;color:var(--ink);border-color:#9A9C9A}',
    '.btn:focus-visible,.chip:focus-visible,summary:focus-visible{outline:3px solid var(--yellow);outline-offset:2px}',
    '.privacy{font-family:' + SANS + ';font-size:.8rem;color:#D6E4D9;margin:12px 0 0}',
    // answer card
    '.answer{margin-top:16px;background:#fff;color:var(--ink);border-radius:2px;padding:18px 18px 16px;border-left:10px solid var(--sand)}',
    '.answer[hidden]{display:none}',
    '.verdict{display:inline-block;font-family:' + DISPLAY + ';font-weight:700;text-transform:uppercase;letter-spacing:.03em;font-size:clamp(2rem,7vw,2.8rem);line-height:1;padding:8px 12px 4px;border-radius:2px;margin:0 0 10px}',
    '.answer .place{font-size:1.25rem;font-weight:700;margin:0}',
    '.answer .who{font-family:' + SANS + ';font-size:.86rem;color:var(--muted);margin:2px 0 10px}',
    '.answer ul{margin:0 0 10px;padding-left:1.2em}',
    '.answer li{margin:0 0 6px}',
    '.answer .fire{margin:10px 0;padding:10px 12px;background:var(--wash);border-radius:2px}',
    '.answer .fire b{font-family:' + SANS + ';font-size:.76rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);display:block}',
    '.answer .warn{margin:10px 0;padding:10px 12px;border:1px solid var(--yellow);background:#FFF9DA;border-radius:2px;font-size:.98rem}',
    '.answer .meta{font-family:' + SANS + ';font-size:.8rem;color:var(--muted);margin:10px 0 0}',
    '.answer .links{font-family:' + SANS + ';font-size:.9rem;margin:8px 0 0;display:flex;flex-wrap:wrap;gap:6px 16px}',
    '.answer .actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}',
    '.err{margin-top:14px;background:#FFF9DA;color:var(--ink);padding:12px 14px;border-radius:2px}',
    // map
    '.mapwrap{position:relative;margin-top:14px}',
    '.map{height:clamp(420px,68vh,720px);border:1px solid var(--line);border-radius:2px;background:#E9E6DD}',
    '.app .map{height:calc(100vh - 168px);min-height:360px}',
    '.mapbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 8px}',
    '.chip{font-family:' + SANS + ';font-size:.86rem;font-weight:700;min-height:38px;padding:0 12px;border-radius:2px;border:1px solid #9A9C9A;background:#fff;color:var(--ink);cursor:pointer}',
    '.chip[aria-pressed="true"]{background:var(--ink);color:#fff;border-color:var(--ink)}',
    '.legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-family:' + SANS + ';font-size:.84rem;margin:10px 0 0;padding:0;list-style:none}',
    '.legend li{display:flex;align-items:center;gap:6px}',
    '.sw{width:16px;height:16px;border-radius:2px;border:1px solid rgba(0,0,0,.25);flex:0 0 auto}',
    '.sw.ring{border:2px dashed #C2405C;background:rgba(243,96,121,.18)}',
    '.sw.road{height:4px;border:0;background:#8A5A2B}',
    '.sw.none{background:#fff}',
    '.sw.bnd{background:transparent;border:2px dashed #1B4532}',
    '.loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:' + SANS + ';color:var(--muted);pointer-events:none}',
    '.leaflet-container{font-family:' + SANS + '}',
    '.pin{width:22px;height:22px;border-radius:50%;background:var(--orange);border:3px solid #fff;box-shadow:0 0 0 2px var(--ink)}',
    '.me{width:18px;height:18px;border-radius:50%;background:#2A7BE4;border:3px solid #fff;box-shadow:0 0 0 2px rgba(42,123,228,.4)}',
    '.mapnote{font-family:' + SANS + ';font-size:.8rem;color:var(--muted);margin:6px 0 0}',
    // conditions
    '.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}',
    '.card{border:1px solid var(--line);border-radius:2px;padding:14px 14px 12px;background:#fff}',
    '.card .big{font-family:' + DISPLAY + ';font-weight:700;text-transform:uppercase;font-size:2.1rem;line-height:1;margin:2px 0 6px;color:var(--forest)}',
    '.card .big.bad{color:#B4472A}',
    '.card p{margin:0 0 6px;font-size:1rem}',
    '.card small{display:block;font-family:' + SANS + ';font-size:.8rem;color:var(--muted)}',
    '.days{display:flex;gap:4px;margin:8px 0 4px}',
    '.day{flex:1;text-align:center;font-family:' + SANS + ';font-size:.7rem;color:var(--muted)}',
    '.day i{display:block;height:14px;border-radius:2px;margin-bottom:3px;border:1px solid rgba(0,0,0,.12)}',
    '.rows{list-style:none;margin:6px 0 0;padding:0;font-family:' + SANS + ';font-size:.86rem}',
    '.rows li{display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px solid #EEECE5}',
    '.tag{font-weight:700;white-space:nowrap}',
    '.rows li.stack{display:block}.rows li.stack .tag{display:block;white-space:normal}',
    '.tag.no{color:#B4472A}.tag.ok{color:var(--forest)}',
    '.orders{list-style:none;margin:8px 0 0;padding:0}',
    '.orders li{padding:10px 0;border-bottom:1px solid var(--line)}',
    '.orders a{font-weight:700}',
    '.orders small{display:block;font-family:' + SANS + ';font-size:.8rem;color:var(--muted);margin-top:2px}',
    '.orders p{margin:4px 0 0;font-size:.98rem}',
    '.stamp{font-family:' + SANS + ';font-size:.78rem;color:var(--muted);margin:10px 0 0}',
    // rules
    'details.rule{border-top:1px solid var(--line);padding:10px 0}',
    'details.rule:last-of-type{border-bottom:1px solid var(--line)}',
    'details.rule summary{cursor:pointer;display:flex;align-items:center;gap:10px;font-weight:700;font-size:1.12rem;list-style:none}',
    'details.rule summary::-webkit-details-marker{display:none}',
    'details.rule summary .badge{margin-left:auto}',
    '.badge{font-family:' + SANS + ';font-size:.74rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:4px 8px;border-radius:2px;white-space:nowrap}',
    'details.rule ul{margin:8px 0 6px;padding-left:1.2em}',
    'details.rule li{margin:0 0 5px}',
    'details.rule .small{font-family:' + SANS + ';font-size:.86rem}',
    '.tips{margin:0;padding-left:1.2em;font-size:1.05rem;max-width:46em}',
    '.tips li{margin:0 0 6px}',
    '.note{font-family:' + SANS + ';font-size:.78rem;color:var(--muted);margin:2em 0 0;max-width:62em}',
    '.compact .card{margin-bottom:10px}',
    '.card .need{font-weight:700;color:var(--forest);margin:2px 0 6px}',
    '.plinks{margin:6px 0 0;padding-left:1.1em;font-family:' + SANS + ';font-size:.9rem}',
    '.plinks li{margin:0 0 4px}',
    '@container (max-width:560px){.check{padding:18px 16px}.btn{width:100%}.answer .actions .btn{width:auto;flex:1}.legend{font-size:.8rem}}'
  ].join('\n');

  // ---------- small helpers ----------
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function getJSON(url, ms) {
    var ctl = 'AbortController' in window ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, ms || 15000) : null;
    return fetch(url, ctl ? { signal: ctl.signal } : {}).then(function (r) {
      if (t) clearTimeout(t);
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
  }
  function fmtDate(iso, withTime) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var o = { month: 'short', day: 'numeric', timeZone: 'America/Denver' };
    if (withTime) { o.hour = 'numeric'; o.minute = '2-digit'; }
    return d.toLocaleString('en-US', o) + (withTime ? ' MT' : '');
  }
  function metres(a, b) {   // haversine distance between [lat,lng] pairs
    var R = 6371000, toR = Math.PI / 180;
    var dLat = (b[0] - a[0]) * toR, dLng = (b[1] - a[1]) * toR;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  function inRing(x, y, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function inPolygons(x, y, polys) {
    for (var p = 0; p < polys.length; p++) {
      if (!inRing(x, y, polys[p][0])) continue;
      var hole = false;
      for (var h = 1; h < polys[p].length; h++) if (inRing(x, y, polys[p][h])) { hole = true; break; }
      if (!hole) return true;
    }
    return false;
  }
  function index(fc) {   // add a bounding box to every polygon feature
    (fc.features || []).forEach(function (f) {
      var g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      var b = [180, 90, -180, -90];
      polys.forEach(function (p) { p[0].forEach(function (c) {
        if (c[0] < b[0]) b[0] = c[0]; if (c[1] < b[1]) b[1] = c[1];
        if (c[0] > b[2]) b[2] = c[0]; if (c[1] > b[3]) b[3] = c[1];
      }); });
      f._b = b; f._p = polys;
    });
    return fc;
  }
  function hits(fc, lat, lng) {
    var out = [];
    if (!fc) return out;
    for (var i = 0; i < fc.features.length; i++) {
      var f = fc.features[i], b = f._b;
      if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue;
      if (inPolygons(lng, lat, f._p)) out.push(f);
    }
    return out;
  }

  // ---------- state ----------
  var state = {
    lands: null, sites: null, roads: null, counties: null, meta: null,
    cond: null, fire: null, nws: null, rain: null, flags: { offroad_closed: false, fire_order: false },
    live: {}, map: null, L: null, pin: null, me: null, layers: {}
  };
  var dataReady = null;
  function loadLandData() {
    if (dataReady) return dataReady;
    dataReady = Promise.all([
      getJSON(URLS.lands, 30000), getJSON(URLS.sites), getJSON(URLS.counties), getJSON(URLS.meta).catch(function () { return null; })
    ]).then(function (r) {
      state.lands = index(r[0]);
      state.sites = r[1];
      state.counties = index(r[2]);
      state.meta = r[3];
    });
    return dataReady;
  }

  // ---------- what is at a point ----------
  function classify(lat, lng) {
    var b = (state.meta && state.meta.bbox) || [-104.05, 46.0, -102.75, 48.1];
    var county = (hits(state.counties, lat, lng)[0] || { properties: {} }).properties.n || null;
    var res = { lat: lat, lng: lng, county: county, outside: lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3] };
    var found = hits(state.lands, lat, lng);
    var inside = found.some(function (f) { return f.properties.c === 'boundary'; });
    found = found.filter(function (f) { return f.properties.c !== 'boundary'; });
    found.sort(function (a, c) { return PRECEDENCE.indexOf(a.properties.c) - PRECEDENCE.indexOf(c.properties.c); });
    var top = found[0];
    res.cls = top ? top.properties.c : 'private';
    res.props = top ? top.properties : { inside: inside };
    res.inside = inside;
    if (res.cls === 'usfs' && state.sites) {
      var near = null, best = Infinity;
      state.sites.features.forEach(function (s) {
        if (!s.properties.b) return;
        var d = metres([lat, lng], [s.geometry.coordinates[1], s.geometry.coordinates[0]]);
        if (d < best) { best = d; near = s; }
      });
      if (near && best <= QUARTER_MILE) { res.cls = 'buffer'; res.props = near.properties; res.distance = best; }
    }
    return res;
  }
  // Does the answer change within r metres? (GPS error, or a boundary that is close by)
  function nearBoundary(lat, lng, r, cls) {
    var dLat = r / 111320, dLng = r / (111320 * Math.cos(lat * Math.PI / 180));
    for (var a = 0; a < 360; a += 45) {
      var t = a * Math.PI / 180;
      var c = classify(lat + dLat * Math.sin(t), lng + dLng * Math.cos(t));
      if (c.cls !== cls) return c;
    }
    return null;
  }

  // ---------- fire: is a campfire allowed at this spot today? ----------
  function dangerFor(county) {
    var rows = (state.fire && state.fire.danger) || [];
    for (var i = 0; i < rows.length; i++) if (rows[i].county === county) return rows[i];
    return null;
  }
  function restriction(kind, name) {
    var rows = (state.fire && state.fire.restrictions) || [];
    for (var i = 0; i < rows.length; i++) if (rows[i].kind === kind && rows[i].name === name) return rows[i];
    return null;
  }
  function campfireBanned(r, today) {
    if (!r || !r.declared) return false;
    if (r.campfires_flag) return true;
    var lvl = LEVELS.indexOf(r.campfires_at || '');
    return lvl > 0 && today >= lvl;
  }
  function fireAt(res) {
    if (!state.fire) return { text: 'Fire information is not available right now. Check ' + LINKS.burn.replace('https://', '') + ' before lighting anything.', banned: null };
    if (res.cls === 'nps') return { text: 'Fires are allowed only in campground fire grates, and never in the backcountry. Check park alerts for current restrictions.', banned: null };
    var d = dangerFor(res.county), today = d ? d.today : 0;
    var r = null, who = '';
    if (res.cls === 'usfs' || res.cls === 'buffer') { r = restriction('usfs', res.county === 'McKenzie' ? 'McKenzie District' : 'Medora District'); who = 'on the national grassland'; }
    else if (res.cls === 'blm') { r = restriction('blm', res.county); who = 'on BLM land in ' + res.county + ' County'; }
    if (!r && res.county) { r = restriction('county', res.county); who = 'in ' + res.county + ' County'; }
    var danger = today ? 'Fire danger today' + (res.county ? ' in ' + res.county + ' County' : '') + ': ' + LEVELS[today] + '. ' : '';
    if (campfireBanned(r, today)) {
      var extra = (res.cls === 'usfs' || res.cls === 'buffer') ? ' Propane stoves that turn on and off may be allowed with a cleared area around them; check the Forest Service order.' : '';
      return { text: danger + 'Campfires are not allowed ' + who + ' today.' + extra, banned: true };
    }
    return { text: danger + (r && r.declared ? 'A burn restriction is in place ' + who + ', but it does not appear to cover campfires at today\u2019s level. ' : '') + 'Conditions can change during the day (for example a Red Flag Warning), so check before you light a fire.', banned: false };
  }

  // ---------- rendering ----------
  var style = el('style', { text: CSS });
  root.appendChild(style);
  var wrap = el('div', { class: APP ? 'app' : '' });
  root.appendChild(wrap);

  if (SHOW.heading) {
    wrap.appendChild(el('p', { class: 'eyebrow', text: 'Camping on public land around Medora' }));
    wrap.appendChild(el('h2', { text: 'Know before you camp' }));
    wrap.appendChild(el('p', { class: 'intro', text: 'The Badlands around Medora are a patchwork. National grassland, a national park, state trust land and private ranches sit side by side, often with no fence or sign between them, and each has its own rules. Check where you are, what is allowed there, and what today\u2019s conditions mean for your trip.' }));
  }

  // --- the check ---
  var answer, checkBtn, errBox;
  if (SHOW.check) {
    var check = el('section', { class: 'check', 'aria-label': 'Am I on public land?' });
    check.appendChild(el('p', { class: 'eyebrow', text: 'One tap' }));
    checkBtn = el('button', { class: 'btn', type: 'button', onclick: locate }, ['Am I on public land?']);
    check.appendChild(el('p', { text: 'Your phone\u2019s location tells you who manages the ground you are standing on, and whether you can camp there.' }));
    check.appendChild(checkBtn);
    check.appendChild(el('p', { class: 'privacy', text: 'Your browser will ask to share your location. It stays on your device and is never sent to the Library or anyone else.' }));
    errBox = el('div', { class: 'err', role: 'alert', hidden: true });
    answer = el('div', { class: 'answer', hidden: true, 'aria-live': 'polite', tabindex: '-1' });
    check.appendChild(errBox);
    check.appendChild(answer);
    wrap.appendChild(check);
  }

  function showError(msg) {
    if (!errBox) return;
    errBox.textContent = msg;
    errBox.hidden = !msg;
  }

  function locate() {
    showError('');
    if (!('geolocation' in navigator)) { showError('This browser cannot share a location. Tap the map instead to check any spot.'); return; }
    checkBtn.disabled = true;
    checkBtn.textContent = 'Finding you\u2026';
    loadLandData().then(function () {
      navigator.geolocation.getCurrentPosition(function (pos) {
        checkBtn.disabled = false;
        checkBtn.textContent = 'Check again';
        explain(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, true);
      }, function (e) {
        checkBtn.disabled = false;
        checkBtn.textContent = 'Am I on public land?';
        if (e.code === 1) showError('Location sharing is turned off for this page. Allow location in your browser or phone settings and try again, or tap the map to check any spot.');
        else if (e.code === 3) showError('Your phone could not get a location fix in time. Step into the open, wait a moment and try again.');
        else showError('Your location is not available right now. Tap the map to check any spot.');
      }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    }).catch(function () {
      checkBtn.disabled = false;
      checkBtn.textContent = 'Am I on public land?';
      showError('The land records could not load. Check your connection and try again.');
    });
  }

  function explain(lat, lng, accuracy, fromGps) {
    var res = classify(lat, lng);
    var cls = CLASSES[res.cls];
    var st = STATUS[res.cls === 'wma' && wmaRule(res.props.n) === 'none' ? 'no' : cls.status];
    if (!answer) answer = el('div', { class: 'answer' });
    answer.innerHTML = '';
    answer.hidden = false;
    answer.style.borderLeftColor = st.bg;
    answer.appendChild(el('p', { class: 'eyebrow', text: fromGps ? 'Where you are' : 'The spot you picked' }));
    if (res.outside) {
      answer.appendChild(el('p', { class: 'place', text: 'Outside this guide\u2019s area' }));
      answer.appendChild(el('p', { text: 'This guide covers the Little Missouri National Grassland and Theodore Roosevelt National Park in western North Dakota. Check with the local land manager for this spot.' }));
    } else {
      answer.appendChild(el('span', { class: 'verdict', text: st.word, style: 'background:' + st.bg + ';color:' + st.ink }));
      var place = cls.label;
      if (res.cls === 'wma') place = wmaName(res.props.n);
      else if (res.cls === 'park' || res.cls === 'usace' || res.cls === 'usbr' || res.cls === 'fws') place = RENAMED[res.props.n] || res.props.n || cls.label;
      answer.appendChild(el('p', { class: 'place', text: place }));
      var who = cls.who;
      if (res.cls === 'trust' && res.props.l) who += ' \u00b7 ' + [res.props.q, res.props.l].filter(Boolean).join(' ');
      if (res.county) who += ' \u00b7 ' + res.county + ' County';
      answer.appendChild(el('p', { class: 'who', text: who }));
      var ul = el('ul');
      cls.rules(res.props).forEach(function (t) { ul.appendChild(el('li', { text: t })); });
      answer.appendChild(ul);
      var fire = fireAt(res);
      answer.appendChild(el('div', { class: 'fire' }, [el('b', { text: 'Campfires today' }), el('span', { text: fire.text })]));
      var radius = Math.max(30, Math.min(accuracy || 30, 150));
      var other = nearBoundary(lat, lng, radius, res.cls);
      if (other || (accuracy && accuracy > 100)) {
        var msg = other ? 'You are within about ' + Math.round(radius * 3.281) + ' feet of ' + (other.cls === 'private' ? 'land that may be private' : CLASSES[other.cls].label.toLowerCase()) + '. ' : '';
        if (accuracy && accuracy > 100) msg += 'Your phone\u2019s location is only accurate to about ' + Math.round(accuracy * 3.281) + ' feet right now. ';
        msg += 'Move well inside the land you mean to use, and trust fences and posted signs over this map.';
        answer.appendChild(el('div', { class: 'warn', text: msg }));
      }
      var links = el('p', { class: 'links' });
      cls.links.forEach(function (l) { links.appendChild(el('a', { href: l[1], target: '_blank', rel: 'noopener', text: l[0] })); });
      if (links.childNodes.length) answer.appendChild(links);
      if (cls.contact) answer.appendChild(el('p', { class: 'meta', text: cls.contact }));
    }
    var coords = lat.toFixed(5) + ', ' + lng.toFixed(5);
    answer.appendChild(el('p', { class: 'meta', text: (fromGps && accuracy ? 'Location ' + coords + ' (within ' + Math.round(accuracy * 3.281) + ' ft). ' : 'Location ' + coords + '. ') +
      'Land records are a guide, not a survey. Boundaries can be off by 100 feet or more.' }));
    var actions = el('div', { class: 'actions' });
    if (SHOW.map && state.map) actions.appendChild(el('button', { class: 'btn small line', type: 'button', onclick: function () { focusMap(lat, lng, fromGps, accuracy); } }, ['Show on map']));
    if (!SHOW.map) actions.appendChild(el('a', { class: 'btn small line', href: MORE + '?at=' + lat.toFixed(5) + ',' + lng.toFixed(5), target: '_blank', rel: 'noopener' }, ['Open the map']));
    if (actions.childNodes.length) answer.appendChild(actions);
    if (SHOW.map) {
      ensureMap().then(function () { focusMap(lat, lng, fromGps, accuracy, true); });
    }
    try { answer.focus({ preventScroll: !fromGps }); } catch (e) { /* older browsers */ }
  }

  // --- the map ---
  var mapEl, mapReady = null, loadingNote;
  if (SHOW.map) {
    var msec = el('section', { 'aria-label': 'Public land map' });
    if (!APP) msec.appendChild(el('h3', { text: 'Who manages this land?' }));
    if (!APP) msec.appendChild(el('p', { text: 'Tap anywhere to see who manages it and what the rules are. Uncolored land is private or unknown.' }));
    var bar = el('div', { class: 'mapbar' });
    var bTopo = el('button', { class: 'chip', type: 'button', 'aria-pressed': 'true', onclick: function () { setBase('topo'); } }, ['Topo']);
    var bImg = el('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', onclick: function () { setBase('imagery'); } }, ['Satellite']);
    var bRoads = el('button', { class: 'chip', type: 'button', 'aria-pressed': 'true', onclick: function () { toggleRoads(); } }, ['Forest roads']);
    bar.appendChild(bTopo); bar.appendChild(bImg); bar.appendChild(bRoads);
    if (SHOW.offline) bar.appendChild(el('button', { class: 'chip', type: 'button', onclick: saveArea }, ['Save this area for offline']));
    if (!APP) bar.appendChild(el('a', { class: 'chip', href: APP_URL, target: '_blank', rel: 'noopener', style: 'display:inline-flex;align-items:center;text-decoration:none' }, ['Full-screen map (works offline)']));
    msec.appendChild(bar);
    var mw = el('div', { class: 'mapwrap' });
    mapEl = el('div', { class: 'map', role: 'application', 'aria-label': 'Map of public land around Medora. Tap a spot to check it.' });
    loadingNote = el('div', { class: 'loading', text: 'Loading the map\u2026' });
    mw.appendChild(mapEl); mw.appendChild(loadingNote);
    msec.appendChild(mw);
    var lg = el('ul', { class: 'legend' });
    ['usfs', 'nps', 'trust', 'blm', 'wma', 'park', 'fws'].forEach(function (k) {
      lg.appendChild(el('li', {}, [el('span', { class: 'sw', style: 'background:' + CLASSES[k].fill + ';opacity:.75' }), CLASSES[k].legend]));
    });
    lg.appendChild(el('li', {}, [el('span', { class: 'sw ring' }), 'Quarter mile around developed sites (no camping)']));
    lg.appendChild(el('li', {}, [el('span', { class: 'sw road' }), 'Forest Service road']));
    lg.appendChild(el('li', {}, [el('span', { class: 'sw bnd' }), 'Grassland boundary']));
    lg.appendChild(el('li', {}, [el('span', { class: 'sw none' }), 'No color: private or unknown']));
    msec.appendChild(lg);
    msec.appendChild(el('p', { class: 'mapnote', html: 'The roads shown are National Forest System roads. Whether a road is open to vehicles is set by the Forest Service; see its <a href="' + LINKS.dpgMaps + '" target="_blank" rel="noopener">maps and guides</a> or ask the ranger district.' }));
    var savedNote = el('p', { class: 'mapnote', 'aria-live': 'polite' });
    msec.appendChild(savedNote);
    if (APP && answer) { /* in the app the answer sits above the map */ }
    wrap.appendChild(msec);
  }

  function loadLeaflet() {
    if (state.L) return Promise.resolve(state.L);
    var prev = window.L;
    var css = fetch(URLS.leafletCss).then(function (r) { return r.text(); }).then(function (t) {
      root.insertBefore(el('style', { text: t }), style);
    });
    var js = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = URLS.leafletJs;
      s.onload = function () {
        var mine = window.L;
        if (prev && mine !== prev && mine.noConflict) mine = mine.noConflict();   // give the page its own Leaflet back
        resolve(mine);
      };
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return Promise.all([css, js]).then(function (r) { state.L = r[1]; return state.L; });
  }

  function ensureMap() {
    if (mapReady) return mapReady;
    mapReady = Promise.all([loadLeaflet(), loadLandData()]).then(function (r) {
      var L = r[0];
      var renderer = L.canvas({ padding: 0.5, tolerance: 4 });
      var map = L.map(mapEl, { center: CENTER, zoom: 9, minZoom: 7, maxZoom: 17, renderer: renderer, preferCanvas: true, tap: false });
      state.map = map;
      state.layers.base = {
        topo: L.tileLayer(TILES.topo, { maxNativeZoom: 16, maxZoom: 17, attribution: 'Basemap: <a href="https://www.usgs.gov/the-national-map" target="_blank" rel="noopener">USGS The National Map</a>' }),
        imagery: L.tileLayer(TILES.imagery, { maxNativeZoom: 16, maxZoom: 17, attribution: 'Basemap: <a href="https://www.usgs.gov/the-national-map" target="_blank" rel="noopener">USGS The National Map</a>' })
      };
      state.layers.base.topo.addTo(map);
      map.attributionControl.setPrefix(false);
      map.attributionControl.addAttribution('Land: USDA Forest Service, ND Trust Lands, USGS PAD-US');

      state.layers.lands = L.geoJSON(state.lands, {
        renderer: renderer, interactive: false,
        filter: function (f) { return f.properties.c !== 'boundary'; },
        style: function (f) {
          var c = CLASSES[f.properties.c] || CLASSES.usbr;
          return { stroke: true, weight: 0.6, color: c.fill, opacity: 0.9, fillColor: c.fill, fillOpacity: f.properties.c === 'nps' ? 0.28 : 0.42 };
        }
      }).addTo(map);
      state.layers.boundary = L.geoJSON(state.lands, {
        renderer: renderer, interactive: false,
        filter: function (f) { return f.properties.c === 'boundary'; },
        style: function () { return { weight: 1.6, color: '#1B4532', dashArray: '6 6', fill: false }; }
      });
      var rings = L.layerGroup();
      (state.sites.features || []).forEach(function (s) {
        var ll = [s.geometry.coordinates[1], s.geometry.coordinates[0]];
        if (s.properties.b) rings.addLayer(L.circle(ll, { radius: QUARTER_MILE, renderer: renderer, interactive: false, color: '#C2405C', weight: 1.5, dashArray: '4 4', fillColor: '#F36079', fillOpacity: 0.18 }));
        rings.addLayer(L.circleMarker(ll, { radius: 4, renderer: renderer, interactive: false, color: '#fff', weight: 1.5, fillColor: '#25282A', fillOpacity: 1 }));
      });
      rings.addTo(map);
      state.layers.rings = rings;

      getJSON(URLS.roads, 30000).then(function (fc) {
        state.layers.roads = L.geoJSON(fc, {
          renderer: renderer, interactive: false,
          style: function (f) { return f.properties.s === 'closed' ? { color: '#8A5A2B', weight: 1.4, opacity: 0.8, dashArray: '3 5' } : { color: '#8A5A2B', weight: 1.6, opacity: 0.85 }; }
        });
        syncRoads();
      }).catch(function () { /* roads are a nice-to-have */ });
      map.on('zoomend', syncRoads);
      syncRoads();

      map.on('click', function (e) { explain(e.latlng.lat, e.latlng.lng, null, false); });
      loadingNote.remove();
      var at = /[?&]at=(-?\d+\.\d+),(-?\d+\.\d+)/.exec(location.search);
      if (at) explain(+at[1], +at[2], null, false);
      return map;
    }).catch(function (e) {
      loadingNote.textContent = 'The map could not load. Check your connection and reload the page.';
      throw e;
    });
    return mapReady;
  }
  var roadsOn = true;
  function syncRoads() {
    var r = state.layers.roads, m = state.map;
    if (m && state.layers.boundary) {   // the boundary outline is clutter when zoomed out
      var bWant = m.getZoom() >= 11;
      if (bWant && !m.hasLayer(state.layers.boundary)) state.layers.boundary.addTo(m);
      if (!bWant && m.hasLayer(state.layers.boundary)) m.removeLayer(state.layers.boundary);
    }
    if (!r || !m) return;
    var want = roadsOn && m.getZoom() >= 10;
    if (want && !m.hasLayer(r)) r.addTo(m);
    if (!want && m.hasLayer(r)) m.removeLayer(r);
  }
  function toggleRoads() { roadsOn = !roadsOn; bRoads.setAttribute('aria-pressed', String(roadsOn)); syncRoads(); }
  function setBase(k) {
    if (!state.map) return;
    var b = state.layers.base;
    Object.keys(b).forEach(function (n) { if (state.map.hasLayer(b[n])) state.map.removeLayer(b[n]); });
    b[k].addTo(state.map); b[k].bringToBack();
    bTopo.setAttribute('aria-pressed', String(k === 'topo'));
    bImg.setAttribute('aria-pressed', String(k === 'imagery'));
  }
  function focusMap(lat, lng, isMe, accuracy, quiet) {
    var L = state.L, map = state.map;
    if (!L || !map) return;
    var icon = L.divIcon({ className: '', html: '<div class="' + (isMe ? 'me' : 'pin') + '"></div>', iconSize: [22, 22], iconAnchor: [11, 11] });
    if (state.pin) map.removeLayer(state.pin);
    state.pin = L.marker([lat, lng], { icon: icon, keyboard: false, interactive: false }).addTo(map);
    if (state.me) { map.removeLayer(state.me); state.me = null; }
    if (isMe && accuracy) state.me = L.circle([lat, lng], { radius: accuracy, color: '#2A7BE4', weight: 1, fillOpacity: 0.08, interactive: false }).addTo(map);
    if (isMe) map.setView([lat, lng], Math.max(map.getZoom(), 14));
    if (!quiet) mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Save the tiles around the map's center so the map works with no signal (app view only).
  function saveArea() {
    if (!state.map) return;
    var c = state.map.getCenter(), km = 8, urls = [];
    for (var z = 10; z <= 15; z++) {
      var n = Math.pow(2, z);
      var dLat = km / 111.32, dLng = km / (111.32 * Math.cos(c.lat * Math.PI / 180));
      var x0 = Math.floor((c.lng - dLng + 180) / 360 * n), x1 = Math.floor((c.lng + dLng + 180) / 360 * n);
      function ty(lat) { var r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); }
      var y0 = ty(c.lat + dLat), y1 = ty(c.lat - dLat);
      for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) urls.push(TILES.topo.replace('{z}', z).replace('{y}', y).replace('{x}', x));
    }
    savedNote.textContent = 'Saving ' + urls.length + ' map tiles around the center of the map\u2026';
    caches.open(TILE_CACHE).then(function (cache) {
      var done = 0, i = 0;
      function next() {
        if (i >= urls.length) return Promise.resolve();
        var u = urls[i++];
        return cache.match(u).then(function (hit) { return hit || cache.add(u); }).catch(function () {}).then(function () {
          done++;
          if (done % 20 === 0) savedNote.textContent = 'Saved ' + done + ' of ' + urls.length + ' tiles\u2026';
          return next();
        });
      }
      return Promise.all([next(), next(), next(), next()]);
    }).then(function () {
      savedNote.textContent = 'Saved. The land layers and about 5 miles of topo map around this spot will work with no signal. Location still works offline.';
    }).catch(function () { savedNote.textContent = 'Could not save tiles on this device.'; });
  }

  // --- conditions ---
  var condSec;
  if (SHOW.conditions || SHOW.compact) {
    condSec = el('section', { class: SHOW.compact ? 'compact' : '', 'aria-label': 'Today\u2019s conditions' });
    if (!SHOW.compact && !APP) condSec.appendChild(el('h3', { text: 'Today\u2019s conditions' }));
    if (APP) condSec.appendChild(el('h3', { text: 'Today' }));
    condSec.appendChild(el('p', { class: 'stamp', text: 'Loading today\u2019s conditions\u2026' }));
    wrap.appendChild(condSec);
  }

  function parseLiveFire(dangerJson, restrJson) {
    var out = { danger: [], restrictions: [], published: null };
    (dangerJson.features || []).forEach(function (f) {
      var a = f.attributes;
      out.danger.push({ county: a.NAME, today: a.FireIndex, days: [a.day1, a.day2, a.day3, a.day4, a.day5, a.day6] });
      if (a.DatePublished) out.published = new Date(+a.DatePublished).toISOString();
    });
    out.danger.sort(function (a, b) { return COUNTIES.indexOf(a.county) - COUNTIES.indexOf(b.county); });
    var seen = {};
    (restrJson.features || []).forEach(function (f) {
      var a = f.attributes, name = (a.county || '').trim(), kind = null, key = null;
      var plain = name.replace(' County', '');
      if (a.Jurisdiction_Type === 'County FDR' && COUNTIES.indexOf(plain) >= 0) { kind = 'county'; key = plain; }
      else if (name.indexOf('USFS Little Missouri') === 0) { kind = 'usfs'; key = /McKenzie/.test(name) ? 'McKenzie District' : 'Medora District'; }
      else if (name.indexOf('BLM Lands within') === 0 && COUNTIES.indexOf(plain.replace('BLM Lands within ', '')) >= 0) { kind = 'blm'; key = plain.replace('BLM Lands within ', ''); }
      if (!kind || seen[kind + key]) return;
      seen[kind + key] = 1;
      out.restrictions.push({
        kind: kind, name: key, declared: a.declaration_status === 'Yes',
        campfires_at: LEVELS.indexOf(a.campfires_conditions) > 0 ? a.campfires_conditions : null,
        campfires_flag: a.campfires_red_checkbox === 'Yes', index: a.FireIndex,
        expires: a.burn_expiration_date ? new Date(+a.burn_expiration_date).toISOString() : null,
        note: kind === 'county' ? (a.banincludedcities_v1 || '').trim() : ''
      });
    });
    return out;
  }
  function parseRain(j) {
    var names = ['Medora', 'North Unit / Watford City', 'Southern grassland (Amidon)'];
    return (Array.isArray(j) ? j : [j]).map(function (x, i) {
      var p = x.daily.precipitation_sum;
      function sum(a) { return Math.round(a.reduce(function (s, v) { return s + (v || 0); }, 0) * 100) / 100; }
      return { place: names[i], dates: x.daily.time, precip: p, snow: x.daily.snowfall_sum, past3: sum(p.slice(0, 3)), next3: sum(p.slice(4, 7)) };
    });
  }

  function loadConditions() {
    var snap = getJSON(URLS.conditions).catch(function () { return null; });
    return snap.then(function (c) {
      state.cond = c || {};
      state.fire = state.cond.fire || null;
      state.nws = state.cond.weather || null;
      state.rain = state.cond.rain || null;
      state.flags = state.cond.flags || state.flags;
      renderConditions();
      buildRules();
      // Live readings replace the snapshot where the source allows it.
      var live = [
        Promise.all([getJSON(URLS.danger), getJSON(URLS.restrictions)]).then(function (r) {
          var f = parseLiveFire(r[0], r[1]);
          if (f.danger.length) { state.fire = f; state.live.fire = true; }
        }),
        getJSON(URLS.nws).then(function (j) {
          state.nws = (j.features || []).map(function (f) { var p = f.properties; return { event: p.event, severity: p.severity, headline: p.headline, ends: p.ends || p.expires, area: p.areaDesc }; });
          state.live.nws = true;
        }),
        getJSON(URLS.rain).then(function (j) { state.rain = parseRain(j); state.live.rain = true; })
      ].map(function (p) { return p.catch(function () {}); });
      return Promise.all(live).then(renderConditions);
    });
  }

  function statusRow(label, banned, sub) {
    return el('li', {}, [el('span', { text: label }), el('span', { class: 'tag ' + (banned ? 'no' : 'ok'), text: banned ? 'No campfires' : 'Check first' }), sub || null]);
  }

  function renderConditions() {
    if (!condSec) return;
    var keep = condSec.querySelector('h3');
    condSec.innerHTML = '';
    if (keep) condSec.appendChild(keep);
    var cards = el('div', { class: 'cards' });

    // Campfires
    var med = dangerFor('Billings'), grass = restriction('usfs', 'Medora District');
    var grassBanned = campfireBanned(grass, med ? med.today : 0);
    var fc = el('div', { class: 'card' }, [
      el('h4', { text: 'Campfires on the grassland' }),
      el('p', { class: 'big' + (grassBanned ? ' bad' : ''), text: state.fire ? (grassBanned ? 'Not allowed' : 'Check first') : 'Unknown' }),
      el('p', { text: grassBanned ? 'Fires, campfires and stove fires are restricted on the Little Missouri National Grassland. Propane stoves that turn off may be allowed.' : 'No campfire restriction is showing for the grassland right now. Restrictions can start any day.' })
    ]);
    var rows = el('ul', { class: 'rows' });
    COUNTIES.forEach(function (c) {
      var d = dangerFor(c), r = restriction('county', c);
      if (d || r) rows.appendChild(statusRow(c + ' County', campfireBanned(r, d ? d.today : 0)));
    });
    fc.appendChild(el('small', { text: 'Private and county land, by county:' }));
    fc.appendChild(rows);
    fc.appendChild(el('small', { html: 'Source: <a href="' + LINKS.burn + '" target="_blank" rel="noopener">ND burn restrictions map</a>' }));
    cards.appendChild(fc);

    // Fire danger
    var dc = el('div', { class: 'card' }, [el('h4', { text: 'Fire danger' })]);
    if (med) {
      dc.appendChild(el('p', { class: 'big' + (med.today >= 3 ? ' bad' : ''), text: LEVELS[med.today] || 'Unknown' }));
      dc.appendChild(el('p', { text: 'Today around Medora (Billings County).' }));
      var days = el('div', { class: 'days', 'aria-label': 'Fire danger for the next six days' });
      var now = new Date();
      med.days.forEach(function (v, i) {
        var d = new Date(now.getTime() + (i + 1) * 864e5);
        days.appendChild(el('div', { class: 'day', title: LEVELS[v] || '' }, [el('i', { style: 'background:' + (LEVEL_COLORS[v] || '#eee') }), d.toLocaleDateString('en-US', { weekday: 'short' })]));
      });
      dc.appendChild(days);
      dc.appendChild(el('small', { text: 'Outlook for the next six days. ' + (state.fire.published ? 'Rating issued ' + fmtDate(state.fire.published, true) + '.' : '') }));
    } else dc.appendChild(el('p', { text: 'Not available right now.' }));
    cards.appendChild(dc);

    // Roads
    var rc = el('div', { class: 'card' }, [el('h4', { text: 'Dirt roads' })]);
    if (state.rain && state.rain.length) {
      var wet = state.rain.some(function (r) { return r.past3 >= 0.25; }), coming = state.rain.some(function (r) { return r.next3 >= 0.25; });
      var snowy = state.rain.some(function (r) { return (r.snow || []).slice(0, 3).some(function (v) { return v > 0.5; }); });
      rc.appendChild(el('p', { class: 'big' + (wet || snowy ? ' bad' : ''), text: wet ? 'Likely wet' : snowy ? 'Snow' : coming ? 'Rain coming' : 'Dry lately' }));
      rc.appendChild(el('p', { text: wet ? 'Rain in the last three days. Badlands clay turns slick and can be impassable, even with four-wheel drive. Wait for roads to dry.' :
        coming ? 'Rain is in the forecast. Clay roads that are fine now can become impassable within minutes of rain. Camp where you can drive out on gravel.' :
          'Little or no rain in the last three days. Conditions can change fast with a storm.' }));
      var rr = el('ul', { class: 'rows' });
      state.rain.forEach(function (r) { rr.appendChild(el('li', { class: 'stack' }, [el('span', { class: 'tag', text: r.place }), el('span', { text: r.past3.toFixed(2) + ' in. last 3 days, ' + r.next3.toFixed(2) + ' in. next 3' })])); });
      rc.appendChild(rr);
    } else rc.appendChild(el('p', { text: 'Not available right now.' }));
    cards.appendChild(rc);

    // Weather alerts
    var wc = el('div', { class: 'card' }, [el('h4', { text: 'Weather alerts' })]);
    var al = state.nws || [];
    wc.appendChild(el('p', { class: 'big' + (al.length ? ' bad' : ''), text: state.nws ? (al.length ? al.length + ' active' : 'None') : 'Unknown' }));
    if (al.length) {
      var ar = el('ul', { class: 'rows' });
      var seenEv = {};
      al.forEach(function (a) { if (seenEv[a.event]) return; seenEv[a.event] = 1; ar.appendChild(el('li', {}, [el('span', { class: 'tag no', text: a.event }), el('span', { text: a.ends ? 'until ' + fmtDate(a.ends, true) : '' })])); });
      wc.appendChild(ar);
      if (al.some(function (a) { return /Red Flag/i.test(a.event); })) wc.appendChild(el('p', { text: 'A Red Flag Warning bans burning in most of the area. No fires of any kind.' }));
    } else if (state.nws) wc.appendChild(el('p', { text: 'No watches, warnings or advisories from the National Weather Service for the Medora area.' }));
    wc.appendChild(el('small', { html: '<a href="https://forecast.weather.gov/MapClick.php?lat=46.914&lon=-103.524" target="_blank" rel="noopener">Forecast for Medora</a>' }));
    cards.appendChild(wc);

    condSec.appendChild(cards);

    if (SHOW.compact) {
      condSec.innerHTML = '';
      var mini = el('div', { class: 'card' }, [
        el('h4', { text: 'Camping near Medora today' }),
        el('p', { html: '<b>Campfires on the grassland:</b> ' + (state.fire ? (grassBanned ? 'not allowed' : 'check first') : 'unknown') }),
        el('p', { html: '<b>Fire danger:</b> ' + (med ? LEVELS[med.today] : 'unknown') }),
        el('p', { html: '<b>Weather alerts:</b> ' + (state.nws ? (al.length ? al.map(function (a) { return a.event; }).filter(function (v, i, s) { return s.indexOf(v) === i; }).join(', ') : 'none') : 'unknown') }),
        el('a', { class: 'btn small', href: MORE, text: 'See the full guide' })
      ]);
      condSec.appendChild(mini);
      return;
    }

    // Forest Service orders
    var orders = (state.cond && state.cond.orders) || [];
    if (orders.length) {
      condSec.appendChild(el('h4', { text: 'Forest Service orders and alerts', style: 'margin-top:18px' }));
      var ol = el('ul', { class: 'orders' });
      orders.forEach(function (o) {
        var li = el('li', {}, [el('a', { href: o.url, target: '_blank', rel: 'noopener', text: o.title })]);
        var bits = [];
        if (o.order && o.title.indexOf(o.order) < 0) bits.push('Order ' + o.order);
        if (o.start) bits.push('since ' + o.start);
        if (bits.length) li.appendChild(el('small', { text: bits.join(' \u00b7 ') }));
        if (o.summary && o.summary !== o.title) li.appendChild(el('p', { text: o.summary }));
        ol.appendChild(li);
      });
      condSec.appendChild(ol);
    }
    var live = state.live.fire ? 'Fire information is live from the state.' : (state.cond && state.cond.built ? 'Fire information from ' + fmtDate(state.cond.built, true) + '.' : '');
    condSec.appendChild(el('p', { class: 'stamp', text: [live, state.cond && state.cond.built ? 'Forest Service orders checked ' + fmtDate(state.cond.built, true) + '.' : ''].join(' ') }));
    // An answer card already on screen may need its campfire line refreshed.
  }

  // --- rules by land type (built once conditions are known, so current orders show) ---
  var rulesSlot = SHOW.rules ? el('div') : null;
  if (rulesSlot) wrap.appendChild(rulesSlot);
  function buildRules() {
    if (!rulesSlot) return;
    rulesSlot.innerHTML = '';
    rulesSlot.appendChild(permitsSection());
    var rs = el('section', { 'aria-label': 'Rules by land type' });
    rs.appendChild(el('h3', { text: 'The rules, by land type' }));
    ['usfs', 'nps', 'trust', 'blm', 'wma', 'park', 'private'].forEach(function (k) {
      var c = CLASSES[k], st = STATUS[c.status];
      var d = el('details', { class: 'rule' });
      d.appendChild(el('summary', {}, [el('span', { class: 'sw' + (c.fill ? '' : ' none'), style: c.fill ? 'background:' + c.fill : '' }), k === 'private' ? 'Private land' : c.label.replace('Little Missouri ', ''), el('span', { class: 'badge', style: 'background:' + st.bg + ';color:' + st.ink, text: st.word })]));
      var ul = el('ul');
      var rules = k === 'wma' ? ['Camping is allowed for up to 10 days in a row on most wildlife management areas, unless posted closed at the entrance.',
        'Some are closed to overnight camping, including Alkali Creek, Spring Creek, Lewis and Clark, Neu\u2019s Point, Och\u2019s Point and Overlook.',
        'Some are closed to camping on Tuesdays and Wednesdays, including Bull Creek, Camels Hump Lake, Cedar Lake, Killdeer Mountains and Speck Davis Pond.',
        'Vehicles stay on constructed roads, established trails and parking areas.'] : c.rules({});
      rules.forEach(function (t) { ul.appendChild(el('li', { text: t })); });
      d.appendChild(ul);
      var links = el('p', { class: 'small' });
      c.links.forEach(function (l, i) { if (i) links.appendChild(document.createTextNode(' \u00b7 ')); links.appendChild(el('a', { href: l[1], target: '_blank', rel: 'noopener', text: l[0] })); });
      if (c.contact) links.appendChild(el('span', { text: (c.links.length ? ' \u00b7 ' : '') + c.contact }));
      if (links.childNodes.length) d.appendChild(links);
      rs.appendChild(d);
    });
    rs.appendChild(el('h3', { text: 'Before you go' }));
    var tips = el('ul', { class: 'tips' });
    [
      'Cell service is patchy in the Badlands. Open the full-screen map and save your area for offline use while you still have a signal.',
      'Bring all the water you need. There is no drinking water at dispersed sites.',
      'Pack out all trash. Bury human waste at least 200 feet from water and trails, or pack it out.',
      'Watch for bison, wild horses and rattlesnakes. Give wildlife plenty of room.',
      'Stay off clay roads after rain, and park where you can still drive out if a storm rolls through.',
      'Leave gates the way you find them, and never block a ranch road or gate.'
    ].forEach(function (t) { tips.appendChild(el('li', { text: t })); });
    rs.appendChild(tips);
    if (CTA) rs.appendChild(el('p', { style: 'margin-top:16px' }, [el('a', { class: 'btn', href: CTA }, ['Prefer a campground? Check availability'])]));
    rulesSlot.appendChild(rs);
  }

  if (!SHOW.compact) {
    var note = el('p', { class: 'note' });
    note.innerHTML = 'This guide is offered as a help, not a legal determination. The Theodore Roosevelt Presidential Library does not manage any of this land. Land records come from the U.S. Forest Service, the North Dakota Department of Trust Lands and the USGS Protected Areas Database, and boundaries are approximate. Posted signs, fences, and the land manager always have the final word. Rules and orders change; check with the managing agency before you go.';
    wrap.appendChild(note);
    var stampEl = el('p', { class: 'note', style: 'margin-top:6px' });
    wrap.appendChild(stampEl);
    loadLandData().then(function () {
      if (state.meta && state.meta.built) stampEl.textContent = 'Land records last refreshed ' + fmtDate(state.meta.built) + '.';
    }).catch(function () {});
  }

  if (SHOW.permits && !SHOW.rules) wrap.appendChild(permitsSection());

  // ---------- start ----------
  if (SHOW.conditions || SHOW.compact || SHOW.check || SHOW.rules) loadConditions();
  if (SHOW.map) {
    if ('IntersectionObserver' in window && !APP) {
      var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); ensureMap(); } }, { rootMargin: '400px' });
      io.observe(mapEl);
    } else ensureMap();
  }
})();
