// Curated North Shore hikes. Waypoints are approximate [lng, lat]; the router
// snaps them to the OSM trail network. Stats are typical published figures
// (round trip unless noted). "vt" links open the VancouverTrails.com page.
const vt = (name) =>
  `https://duckduckgo.com/?q=${encodeURIComponent('! site:vancouvertrails.com ' + name)}`;

export const HIKES = [
  {
    name: 'Grouse Grind', area: 'Grouse', difficulty: 'Hard', km: 2.9, gain: 853, hours: '1.5', season: 'Summer–Fall',
    note: 'Relentless stair-climb to the Grouse chalet. One-way up; take the gondola down.',
    wp: [[-123.0989, 49.3713], [-123.0817, 49.3808]], oneWay: true,
  },
  {
    name: 'BCMC Trail', area: 'Grouse', difficulty: 'Hard', km: 3.0, gain: 853, hours: '1.5', season: 'Summer–Fall',
    note: 'Quieter, rootier alternative to the Grind, ending at the chalet.',
    wp: [[-123.0975, 49.3712], [-123.0895, 49.3765], [-123.0817, 49.3808]], oneWay: true,
  },
  {
    name: 'Goat Mountain', area: 'Grouse', difficulty: 'Intermediate', km: 10, gain: 520, hours: '4–5', season: 'Summer–Fall',
    note: 'From the top of the Skyride past Dam Mountain and Little Goat to big alpine views.',
    wp: [[-123.0817, 49.3808], [-123.0815, 49.3955], [-123.0756, 49.4045]], outAndBack: true,
  },
  {
    name: 'Crown Mountain', area: 'Grouse', difficulty: 'Hard', km: 9, gain: 885, hours: '6–7', season: 'Summer–Fall',
    note: 'Steep, exposed scramble to the Camel. Serious terrain — check conditions.',
    wp: [[-123.0817, 49.3808], [-123.0815, 49.3955], [-123.0915, 49.4116]], outAndBack: true,
  },
  {
    name: 'Dog Mountain', area: 'Seymour', difficulty: 'Easy', km: 5, gain: 100, hours: '2', season: 'Year-round (snowshoe in winter)',
    note: 'Gentle forest walk past First Lake to a viewpoint over Vancouver.',
    wp: [[-122.9483, 49.3666], [-122.9541, 49.3696], [-122.9643, 49.3712]], outAndBack: true,
  },
  {
    name: 'Mount Seymour', area: 'Seymour', difficulty: 'Intermediate', km: 9, gain: 450, hours: '5', season: 'Summer–Fall',
    note: 'Over Brockton Point and Pump Peak to the summit (third pump).',
    wp: [[-122.9483, 49.3666], [-122.9447, 49.3846], [-122.9415, 49.3925]], outAndBack: true,
  },
  {
    name: 'Lynn Peak', area: 'Lynn', difficulty: 'Intermediate', km: 9, gain: 720, hours: '4', season: 'Year-round',
    note: 'Steady forest climb from Lynn Headwaters to viewpoints over Seymour Valley.',
    wp: [[-123.0204, 49.3577], [-123.0108, 49.3713]], outAndBack: true,
  },
  {
    name: 'Norvan Falls', area: 'Lynn', difficulty: 'Intermediate', km: 14, gain: 230, hours: '5', season: 'Year-round',
    note: 'Long, mostly flat valley walk along Lynn Creek to a pretty waterfall.',
    wp: [[-123.0204, 49.3577], [-123.0236, 49.3790], [-123.0213, 49.3962]], outAndBack: true,
  },
  {
    name: 'Lynn Loop', area: 'Lynn', difficulty: 'Easy', km: 5.1, gain: 145, hours: '2', season: 'Year-round',
    note: 'Classic loop — creekside on one side, forested ridge on the other.',
    wp: [[-123.0204, 49.3577], [-123.0236, 49.3700], [-123.0170, 49.3655], [-123.0204, 49.3577]],
  },
  {
    name: 'Quarry Rock', area: 'Deep Cove', difficulty: 'Easy', km: 3.8, gain: 100, hours: '1.5', season: 'Year-round',
    note: 'Short, busy Baden-Powell section to a bluff over Indian Arm.',
    wp: [[-122.9487, 49.3275], [-122.9372, 49.3336]], outAndBack: true,
  },
  {
    name: 'Hollyburn Mountain', area: 'Cypress', difficulty: 'Intermediate', km: 7, gain: 440, hours: '3.5', season: 'Summer–Fall',
    note: 'From Cypress Nordic area past First Lake to open summit views.',
    wp: [[-123.1952, 49.3788], [-123.1873, 49.3830], [-123.1886, 49.3962]], outAndBack: true,
  },
  {
    name: "St. Mark's Summit", area: 'Cypress', difficulty: 'Intermediate', km: 11, gain: 460, hours: '5', season: 'Summer–Fall',
    note: 'Howe Sound Crest Trail to a famous viewpoint over Howe Sound.',
    wp: [[-123.2043, 49.3965], [-123.2183, 49.4060], [-123.2338, 49.4178]], outAndBack: true,
  },
  {
    name: 'Black Mountain Loop', area: 'Cypress', difficulty: 'Intermediate', km: 7.5, gain: 300, hours: '3', season: 'Summer–Fall',
    note: 'Lakes and bluffs on the Cypress plateau; Yew Lake on the way.',
    wp: [[-123.2043, 49.3965], [-123.2190, 49.3885], [-123.2120, 49.3940], [-123.2043, 49.3965]],
  },
  {
    name: 'Eagle Bluffs', area: 'Cypress', difficulty: 'Intermediate', km: 8, gain: 350, hours: '4', season: 'Summer–Fall',
    note: 'Over Black Mountain to big views of Horseshoe Bay and the islands.',
    wp: [[-123.2043, 49.3965], [-123.2190, 49.3885], [-123.2341, 49.3815]], outAndBack: true,
  },
  {
    name: 'Bowen Lookout', area: 'Cypress', difficulty: 'Easy', km: 2, gain: 70, hours: '1', season: 'Summer–Fall',
    note: 'Quick walk from the Cypress lot to a lookout over Bowen Island.',
    wp: [[-123.2043, 49.3965], [-123.2088, 49.3953]], outAndBack: true,
  },
  {
    name: 'Whyte Lake', area: 'West Van', difficulty: 'Easy', km: 4.5, gain: 210, hours: '2', season: 'Year-round',
    note: 'Mossy forest climb to a small lake near Horseshoe Bay.',
    wp: [[-123.2598, 49.3736], [-123.2512, 49.3796]], outAndBack: true,
  },
  {
    name: 'Cypress Falls', area: 'West Van', difficulty: 'Easy', km: 3, gain: 150, hours: '1.5', season: 'Year-round',
    note: 'Old-growth forest and two waterfalls in a small canyon.',
    wp: [[-123.2378, 49.3540], [-123.2339, 49.3605]], outAndBack: true,
  },
  {
    name: 'Lighthouse Park', area: 'West Van', difficulty: 'Easy', km: 5, gain: 100, hours: '2', season: 'Year-round',
    note: 'Old-growth forest and rocky shoreline around Point Atkinson.',
    wp: [[-123.2613, 49.3369], [-123.2634, 49.3302], [-123.2560, 49.3330], [-123.2613, 49.3369]],
  },
  {
    name: 'Mount Fromme', area: 'Fromme', difficulty: 'Intermediate', km: 10, gain: 850, hours: '5', season: 'Summer–Fall',
    note: 'Steep climb from Mountain Hwy on a mountain-bike-heavy mountain.',
    wp: [[-123.0560, 49.3622], [-123.0590, 49.3920]], outAndBack: true,
  },
  {
    name: 'Lynn Canyon', area: 'Lynn', difficulty: 'Easy', km: 3, gain: 80, hours: '1', season: 'Year-round',
    note: 'Suspension bridge, 30 Foot Pool and Twin Falls.',
    wp: [[-123.0190, 49.3434], [-123.0158, 49.3388], [-123.0190, 49.3434]],
  },
].map((h) => ({ ...h, link: vt(h.name) }));
