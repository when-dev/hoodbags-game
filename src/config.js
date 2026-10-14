// Game tuning + content. Most "feel" tweaks live here.

export const LANES = [-2.4, 0, 2.4];
export const SPAWN_Z = -150;     // where new rows appear (ahead of the player)
export const DESPAWN_Z = 12;     // behind the camera
export const GRAVITY = 30;
export const JUMP_V = 10.5;      // ~1.85m apex
export const SLIDE_TIME = 0.65;
// Lane changes are eased by LaneMotion (src/anim.js): LANE_TIME = 0.15 s per lane, the same total
// time as the old 16 u/s linear move, so obstacle fairness (src/logic.js) is unchanged.
export const LANE_SWITCH_SPEED = 16; // legacy, unused
export const STUMBLE_WINDOW = 7;     // seconds Liq stays on your tail after a stumble

// Districts of the 3-level demo (deck p.5): The Hood → The Trenches → Bull City.
export const DISTRICTS = [
  {
    id: 'hood',
    name: 'THE HOOD',
    tagline: 'Where every degen story starts.',
    length: 900,
    speed: [15, 19],
    rowGap: [26, 20],
    sky: 0x1a0b3a,
    fog: 0x2a0f55,
    road: { base: '#1b1530', line: '#ff4fd8', edge: '#29e6ff' },
    building: [0x2b1d55, 0x3a1f66, 0x231a4a],
    windows: ['#ffd27a', '#ff7ae0', '#7ae8ff', '#ffffff', '#b28cff'], windowDensity: 0.45,
    edge: 'lamp', heights: [8, 18], skyline: 'moon',
    neon: [0xff4fd8, 0x29e6ff, 0xffc93c, 0xa45bff],
    signs: ['GM', 'HODL', '$HB', 'WAGMI', 'HOOD', 'GOOD GAMES\nBIGGER DEGENS', 'PLAY CHILL\nSTACK', 'BUY THE DIP'],
    // weights for obstacle patterns
    pool: { fud: 4, airdrop: 4, rug: 2, bar: 1, crash: 1, crashMoving: 0 },
    eazyIntro: 'Welcome to the Hood, Naz. Stack that $HB. Trust me bro.',
    liqIntro: null,
  },
  {
    id: 'trenches',
    name: 'THE TRENCHES',
    tagline: 'Rugs, FUD and fake airdrops. Stay sharp.',
    length: 1100,
    speed: [19, 23],
    rowGap: [22, 17],
    sky: 0x0c1410,
    fog: 0x18241a,
    road: { base: '#15140f', line: '#ff3b3b', edge: '#7dff5a' },
    building: [0x2a2a1c, 0x1f2a1e, 0x332619],
    windows: ['#ff3b3b', '#ff8a3b', '#7dff5a', '#553322'], windowDensity: 0.18,
    edge: 'trench', heights: [9, 22], skyline: 'red',
    neon: [0xff3b3b, 0x7dff5a, 0xffa53b],
    signs: ['REKT', '-90%', 'NGMI', 'WEN LAMBO?', 'RUG ALERT', 'FUD', 'SER PLS', 'DYOR'],
    pool: { fud: 3, airdrop: 3, rug: 4, bar: 3, crash: 3, crashMoving: 1 },
    eazyIntro: 'The Trenches. Half these airdrops are fake. The other half too.',
    liqIntro: 'Heavy bags, Naz. Let me lighten them.',
  },
  {
    id: 'bull',
    name: 'BULL CITY',
    tagline: 'The bull run starts here.',
    length: 1300,
    speed: [22, 26],
    rowGap: [20, 15],
    sky: 0x2a1036,
    fog: 0x4a1f40,
    road: { base: '#2b2010', line: '#ffd23c', edge: '#ffb000' },
    building: [0x3a2a14, 0x2a1d3a, 0x4a3a1a],
    windows: ['#ffd23c', '#ffe9a0', '#3bff8a', '#ffffff'], windowDensity: 0.55,
    edge: 'lamp', heights: [16, 34], skyline: 'gold',
    neon: [0xffd23c, 0x3bff8a, 0xff4fd8, 0x29e6ff],
    signs: ['TO THE MOON', 'BULL CITY', '+420%', 'ATH', 'WAGMI', 'MOON', 'GREEN CANDLES ONLY'],
    pool: { fud: 2, airdrop: 3, rug: 3, bar: 3, crash: 3, crashMoving: 3 },
    eazyIntro: 'BULL CITY! The golden bull is at the end. Go get it!',
    liqIntro: "My city, kid. Every bull run ends with me.",
  },
];

// Endless "Bull Run" mode reuses Bull City look with ramping speed.
export const ENDLESS = { speedStart: 17, speedMax: 30, rampPerMeter: 0.0035 };

export const POWERUPS = {
  shield:   { label: 'DIAMOND HANDS', icon: '💎', time: 15, color: 0x29e6ff },
  magnet:   { label: 'HODL MAGNET',   icon: '🧲', time: 10, color: 0xff4fd8 },
  leverage: { label: '2X LEVERAGE',   icon: '2X', time: 10, color: 0xffd23c },
  intel:    { label: "EAZY'S INTEL",  icon: '👀', time: 12, color: 0x7dff5a },
};

export const DEATH_LINES = {
  rug:     ['RUGGED.', 'You saw it coming… a little too late.'],
  crash:   ['MARKET CRASH.', 'Should have zigged when the chart zagged.'],
  airdrop: ['FAKE AIRDROP.', 'If it says FREE, you are the product.'],
  fud:     ['FUD GOT YOU.', 'Jump over the noise next time.'],
  bar:     ['LIQUIDATED BY THE LINE.', 'Low bar? Slide under it, ser.'],
  liq:     ['LIQUIDATED.', 'Liq says thanks for the liquidity.'],
};

// Short and skimmable: the player is mid-run.
export const EAZY_TIPS = [
  'Free airdrop? Trust me bro. …Jump it anyway.',
  'Carpet moves? JUMP. Classic rug.',
  'Red candle incoming. Change lanes, not your thesis.',
  'Slide under the line. Knees are forever.',
  'Bags don\u2019t fill themselves, Naz.',
  'Don\u2019t look back. Liq never sleeps.',
  'Grab the 💎. Diamond hands survive one hit.',
];
// Eazy's "intel": a lane call that is right most of the time. Fair: the obstacles are always visible.
export const EAZY_LANE_TIP = { chance: 0.75, lines: ['{lane} lane is clean. Trust me bro.', 'Alpha: stay {lane}. 100%.', 'Go {lane}. I\u2019ve seen the charts.'] };
export const EAZY_BAD_TIP = ['Okay… that tip was not financial advice.', 'My bad bro. Wrong chart.'];
export const EAZY_DEATH = ['“Wasn\u2019t my tip, bro.”', '“Buy the dip. Run it back.”', '“Everyone gets rugged once. Or nine times.”', '“Zoom out. You\u2019re still early.”'];

export const LIQ_TAUNTS = [
  'Nice bags, Naz. I\u2019ll take those.',
  'One more slip. You\u2019re exit liquidity.',
  'I can smell your stop loss.',
];

export const DUMP_LINES = ['WHO SOLD?!', 'Dev is dumping. Move!', 'Red candle! MOVE, bro!'];

// First-run tutorial: three scripted rows with on-screen prompts.
export const TUTORIAL = [
  { lanes: [null, 'fud', null], hint: 'jump' },
  { lanes: [null, 'bar', null], hint: 'slide' },
  { lanes: ['crash', 'crash', null], hint: 'right' },
];
