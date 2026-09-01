/* IRON FRONT — config.js
   All balance data lives here. Change numbers in this file to re-tune the game;
   no other file needs editing. */
window.IF = window.IF || {};
(function (IF) {
  'use strict';

  IF.TILE = 32;
  IF.MAP_W = 96;
  IF.MAP_H = 72;

  IF.T = { FIELD: 0, ROAD: 1, FOREST: 2, WATER: 3, BRIDGE: 4, RUBBLE: 5, RUIN: 6 };

  /* How much damage each weapon type does to each kind of target.
     1.0 = full damage. 0.2 = almost useless. */
  IF.DMG = {
    bullet:     { infantry: 1.00, vehicle: 0.22, building: 0.16, air: 0.30 },
    ap:         { infantry: 0.50, vehicle: 1.00, building: 0.70, air: 0.00 },
    rocket:     { infantry: 0.40, vehicle: 1.35, building: 0.85, air: 0.00 },
    explosive:  { infantry: 1.05, vehicle: 0.70, building: 1.20, air: 0.00 },
    aa:         { infantry: 0.25, vehicle: 0.18, building: 0.10, air: 1.45 },
    bomb:       { infantry: 1.00, vehicle: 1.00, building: 1.75, air: 0.00 },
    aircannon:  { infantry: 0.85, vehicle: 1.15, building: 0.45, air: 0.25 }
  };

  IF.FACTIONS = {
    alliance: {
      id: 'alliance',
      name: 'The Alliance',
      motto: 'Speed, air power and adaptable infantry.',
      color: '#5b9bd8',
      dark: '#2c5a85',
      light: '#9fc9ee',
      mods: { buildSpeed: 0.85, infCost: 0.90, airHp: 1.15, airDmg: 1.15, vehHp: 0.92, moveSpeed: 1.05, techCost: 1.0, defHp: 1.0, vehDmg: 1.0 }
    },
    legion: {
      id: 'legion',
      name: 'The Iron Legion',
      motto: 'Heavy armour and unbreakable emplacements.',
      color: '#c2542f',
      dark: '#7a2f19',
      light: '#eda173',
      mods: { buildSpeed: 1.12, infCost: 1.0, airHp: 0.95, airDmg: 0.95, vehHp: 1.20, moveSpeed: 0.94, techCost: 1.15, defHp: 1.30, vehDmg: 1.10 }
    }
  };

  /* ---------------------------------------------------------------- BUILDINGS */
  IF.BUILDINGS = {
    hq: {
      id: 'hq', name: 'Headquarters', short: 'HQ', w: 4, h: 4, hp: 4000,
      cost: { s: 0, f: 0 }, build: 0, power: 60, pop: 20, sight: 300,
      desc: 'Command centre. Lose it and you lose the battle.'
    },
    power: {
      id: 'power', name: 'Power Station', short: 'PWR', w: 2, h: 3, hp: 750,
      cost: { s: 300, f: 0 }, build: 12, power: 100, pop: 0, sight: 160,
      desc: 'Supplies power. Without power, production slows and defences go quiet.'
    },
    depot: {
      id: 'depot', name: 'Supply Depot', short: 'DEP', w: 3, h: 3, hp: 1100,
      cost: { s: 500, f: 0 }, build: 16, power: -10, pop: 0, sight: 200,
      produces: 'sup', freeUnit: 'truck',
      desc: 'Processes supplies and builds supply trucks. Comes with one truck.'
    },
    refinery: {
      id: 'refinery', name: 'Fuel Refinery', short: 'REF', w: 3, h: 3, hp: 1100,
      cost: { s: 700, f: 0 }, build: 20, power: -20, pop: 0, sight: 200,
      produces: 'fue', freeUnit: 'tanker',
      desc: 'Processes fuel and builds tankers. Comes with one tanker.'
    },
    barracks: {
      id: 'barracks', name: 'Barracks', short: 'BAR', w: 3, h: 3, hp: 1250,
      cost: { s: 500, f: 0 }, build: 18, power: -15, pop: 6, sight: 200,
      produces: 'inf',
      desc: 'Trains all infantry. Also raises your unit limit.'
    },
    factory: {
      id: 'factory', name: 'Vehicle Factory', short: 'FAC', w: 4, h: 4, hp: 1700,
      cost: { s: 900, f: 150 }, build: 26, power: -30, pop: 6, sight: 220,
      produces: 'veh',
      desc: 'Builds tanks and armoured vehicles.'
    },
    airfield: {
      id: 'airfield', name: 'Airfield', short: 'AIR', w: 5, h: 3, hp: 1400,
      cost: { s: 1000, f: 300 }, build: 30, power: -35, pop: 6, sight: 260,
      produces: 'air',
      desc: 'Builds aircraft. Planes rearm here between missions.'
    },
    lab: {
      id: 'lab', name: 'Research Laboratory', short: 'LAB', w: 3, h: 3, hp: 1050,
      cost: { s: 700, f: 150 }, build: 24, power: -25, pop: 0, sight: 200,
      desc: 'Unlocks upgrades and advanced units.'
    },
    radar: {
      id: 'radar', name: 'Radar Station', short: 'RDR', w: 3, h: 3, hp: 950,
      cost: { s: 650, f: 100 }, build: 20, power: -30, pop: 0, sight: 420,
      desc: 'Brings the sector map online. Without one — or without power — you are blind.'
    },
    bunker: {
      id: 'bunker', name: 'Defensive Bunker', short: 'BNK', w: 2, h: 2, hp: 1500,
      cost: { s: 300, f: 0 }, build: 10, power: -5, pop: 0, sight: 240, defence: true,
      weapon: { dmg: 11, rof: 0.30, range: 190, type: 'bullet' },
      desc: 'Dug-in machine guns. Shreds infantry, does little to armour.'
    },
    atgun: {
      id: 'atgun', name: 'Anti-Tank Gun', short: 'A/T', w: 2, h: 2, hp: 950,
      cost: { s: 400, f: 80 }, build: 12, power: -10, pop: 0, sight: 280, defence: true,
      weapon: { dmg: 62, rof: 1.7, range: 250, type: 'ap' },
      desc: 'Automatically engages enemy vehicles at long range.'
    },
    aagun: {
      id: 'aagun', name: 'Anti-Air Gun', short: 'A/A', w: 2, h: 2, hp: 850,
      cost: { s: 400, f: 80 }, build: 12, power: -10, pop: 0, sight: 320, defence: true,
      airOnly: true,
      weapon: { dmg: 26, rof: 0.45, range: 280, type: 'aa' },
      desc: 'Only fires at aircraft, but tears them apart.'
    }
  };

  IF.BUILD_ORDER_MENU = ['power', 'depot', 'refinery', 'barracks', 'radar', 'factory', 'airfield', 'lab', 'bunker', 'atgun', 'aagun'];

  /* -------------------------------------------------------------------- UNITS */
  IF.UNITS = {
    /* --- support --- */
    truck: {
      id: 'truck', name: 'Supply Truck', cat: 'sup', from: 'depot', domain: 'wheel', armor: 'vehicle',
      cost: { s: 200, f: 0 }, build: 8, hp: 280, speed: 74, pop: 1, r: 9, sight: 200,
      harvest: 'supplies', capacity: 120, gatherRate: 60,
      desc: 'Drives to a supply cache, loads up and returns to a Supply Depot.'
    },
    tanker: {
      id: 'tanker', name: 'Fuel Tanker', cat: 'fue', from: 'refinery', domain: 'wheel', armor: 'vehicle',
      cost: { s: 280, f: 0 }, build: 10, hp: 300, speed: 66, pop: 1, r: 9, sight: 200,
      harvest: 'fuel', capacity: 90, gatherRate: 45,
      desc: 'Draws crude from a fuel derrick and returns it to a Fuel Refinery.'
    },
    /* --- infantry --- */
    rifle: {
      id: 'rifle', name: 'Rifle Squad', cat: 'inf', from: 'barracks', domain: 'foot', armor: 'infantry',
      cost: { s: 120, f: 0 }, build: 6, hp: 115, speed: 44, pop: 1, r: 7, sight: 220,
      weapon: { dmg: 9, rof: 0.55, range: 130, type: 'bullet' },
      desc: 'Cheap all-rounder. Numbers win fights.'
    },
    mg: {
      id: 'mg', name: 'Machine Gun Squad', cat: 'inf', from: 'barracks', domain: 'foot', armor: 'infantry',
      cost: { s: 210, f: 0 }, build: 9, hp: 145, speed: 33, pop: 2, r: 7, sight: 240,
      weapon: { dmg: 8, rof: 0.20, range: 155, type: 'bullet' },
      desc: 'Slow, but holds a line against infantry better than anything.'
    },
    sniper: {
      id: 'sniper', name: 'Sniper', cat: 'inf', from: 'barracks', domain: 'foot', armor: 'infantry',
      cost: { s: 260, f: 0 }, build: 12, hp: 80, speed: 40, pop: 2, r: 6, sight: 330,
      weapon: { dmg: 70, rof: 2.0, range: 300, type: 'bullet' },
      desc: 'Kills infantry from outside their range. Helpless against vehicles.'
    },
    engineer: {
      id: 'engineer', name: 'Engineer', cat: 'inf', from: 'barracks', domain: 'foot', armor: 'infantry',
      cost: { s: 180, f: 0 }, build: 8, hp: 95, speed: 48, pop: 1, r: 7, sight: 200,
      repair: 45, repairRange: 60,
      desc: 'Repairs buildings and vehicles. Right-click a damaged friendly target.'
    },
    at_inf: {
      id: 'at_inf', name: 'Anti-Tank Team', cat: 'inf', from: 'barracks', domain: 'foot', armor: 'infantry',
      cost: { s: 220, f: 40 }, build: 10, hp: 125, speed: 36, pop: 2, r: 7, sight: 240,
      weapon: { dmg: 48, rof: 1.6, range: 180, type: 'rocket' },
      desc: 'Bazooka team. Brutal on tanks, poor against other infantry.'
    },
    /* --- vehicles --- */
    halftrack: {
      id: 'halftrack', crush: true, name: 'Armoured Halftrack', cat: 'veh', from: 'factory', domain: 'wheel', armor: 'vehicle',
      cost: { s: 280, f: 60 }, build: 11, hp: 360, speed: 92, pop: 2, r: 11, sight: 240,
      weapon: { dmg: 12, rof: 0.28, range: 160, type: 'bullet' },
      desc: 'Fast infantry-killer. Run it away from anti-tank guns.'
    },
    light: {
      id: 'light', crush: true, name: 'Light Tank', cat: 'veh', from: 'factory', domain: 'wheel', armor: 'vehicle',
      cost: { s: 320, f: 100 }, build: 12, hp: 440, speed: 78, pop: 2, r: 12, sight: 250,
      weapon: { dmg: 25, rof: 0.9, range: 165, type: 'ap' },
      desc: 'Quick, cheap armour for early raids and scouting.'
    },
    medium: {
      id: 'medium', crush: true, name: 'Medium Tank', cat: 'veh', from: 'factory', domain: 'wheel', armor: 'vehicle',
      cost: { s: 520, f: 200 }, build: 18, hp: 700, speed: 62, pop: 3, r: 13, sight: 260,
      weapon: { dmg: 44, rof: 1.15, range: 185, type: 'ap' },
      desc: 'The backbone of any armoured push.'
    },
    heavy: {
      id: 'heavy', crush: true, name: 'Heavy Tank', cat: 'veh', from: 'factory', domain: 'wheel', armor: 'vehicle',
      cost: { s: 900, f: 450 }, build: 30, hp: 1300, speed: 42, pop: 5, r: 15, sight: 270,
      requires: 'heavy_program',
      weapon: { dmg: 85, rof: 1.7, range: 200, type: 'ap' },
      desc: 'Slow siege armour. Needs the Heavy Tank Program.'
    },
    artillery: {
      id: 'artillery', name: 'Artillery Vehicle', cat: 'veh', from: 'factory', domain: 'wheel', armor: 'vehicle',
      cost: { s: 700, f: 320 }, build: 26, hp: 310, speed: 40, pop: 4, r: 12, sight: 200,
      requires: 'artillery_program',
      weapon: { dmg: 100, rof: 4.5, range: 400, minRange: 150, splash: 70, type: 'explosive', shell: true },
      desc: 'Outranges everything. Dies instantly if anything reaches it.'
    },
    /* --- aircraft --- */
    fighter: {
      id: 'fighter', name: 'Fighter', cat: 'air', from: 'airfield', domain: 'air', armor: 'air',
      cost: { s: 450, f: 280 }, build: 18, hp: 270, speed: 205, pop: 3, r: 13, sight: 320,
      ammo: 40, weapon: { dmg: 24, rof: 0.26, range: 150, type: 'aircannon' },
      desc: 'Air superiority. Hunts enemy aircraft, decent on soft ground targets.'
    },
    attacker: {
      id: 'attacker', name: 'Ground Attack Plane', cat: 'air', from: 'airfield', domain: 'air', armor: 'air',
      cost: { s: 560, f: 360 }, build: 22, hp: 320, speed: 168, pop: 3, r: 14, sight: 300,
      requires: 'aero_program', ammo: 14,
      weapon: { dmg: 65, rof: 1.0, range: 170, type: 'rocket' },
      desc: 'Rocket plane built to break tank columns.'
    },
    bomber: {
      id: 'bomber', name: 'Bomber', cat: 'air', from: 'airfield', domain: 'air', armor: 'air',
      cost: { s: 700, f: 480 }, build: 26, hp: 400, speed: 138, pop: 4, r: 17, sight: 280,
      requires: 'aero_program', ammo: 6,
      weapon: { dmg: 170, rof: 2.2, range: 110, splash: 95, type: 'bomb', shell: true },
      desc: 'Flattens buildings and packed formations. Helpless against fighters.'
    }
  };

  IF.MENU = {
    inf: ['rifle', 'mg', 'at_inf', 'sniper', 'engineer'],
    veh: ['halftrack', 'light', 'medium', 'heavy', 'artillery'],
    air: ['fighter', 'attacker', 'bomber'],
    sup: ['truck'],
    fue: ['tanker']
  };

  /* --------------------------------------------------------------- TECHNOLOGY */
  IF.TECH = {
    weapons1: {
      id: 'weapons1', name: 'Improved Small Arms', cost: { s: 600, f: 0 }, time: 30,
      desc: 'All infantry weapons +25% damage.'
    },
    armor1: {
      id: 'armor1', name: 'Composite Armour', cost: { s: 800, f: 200 }, time: 40,
      desc: 'All vehicles +20% health.'
    },
    logistics: {
      id: 'logistics', name: 'Field Logistics', cost: { s: 600, f: 100 }, time: 30,
      desc: 'Vehicles build 25% faster.'
    },
    fortify: {
      id: 'fortify', name: 'Reinforced Emplacements', cost: { s: 600, f: 100 }, time: 30,
      desc: 'Defensive buildings +25% health and damage.'
    },
    heavy_program: {
      id: 'heavy_program', name: 'Heavy Tank Program', cost: { s: 1000, f: 500 }, time: 50,
      needs: 'armor1', desc: 'Unlocks the Heavy Tank.'
    },
    artillery_program: {
      id: 'artillery_program', name: 'Artillery Doctrine', cost: { s: 800, f: 350 }, time: 40,
      desc: 'Unlocks the Artillery Vehicle.'
    },
    aero_program: {
      id: 'aero_program', name: 'Combined Air Wing', cost: { s: 900, f: 400 }, time: 45,
      desc: 'Unlocks the Ground Attack Plane and the Bomber.'
    },
    aero_weapons: {
      id: 'aero_weapons', name: 'Aviation Ordnance', cost: { s: 700, f: 300 }, time: 35,
      needs: 'aero_program', desc: 'All aircraft +25% damage.'
    }
  };
  IF.TECH_ORDER = ['weapons1', 'armor1', 'logistics', 'fortify', 'heavy_program', 'artillery_program', 'aero_program', 'aero_weapons'];

  /* -------------------------------------------------------------- DIFFICULTY */
  IF.DIFFICULTY = {
    easy:   { name: 'Easy',   income: 0.85, buildSpeed: 1.35, firstAttack: 240, attackGap: 150, waveSize: 4, waveGrowth: 0.7, maxHarvesters: 3, maxTankers: 2, tech: false },
    normal: { name: 'Normal', income: 1.00, buildSpeed: 1.00, firstAttack: 165, attackGap: 105, waveSize: 6, waveGrowth: 1.0, maxHarvesters: 4, maxTankers: 3, tech: true },
    hard:   { name: 'Hard',   income: 1.30, buildSpeed: 0.78, firstAttack: 110, attackGap: 72,  waveSize: 8, waveGrowth: 1.4, maxHarvesters: 5, maxTankers: 4, tech: true }
  };

  /* Veterancy: units earn promotions from kills, exactly like Generals.
     A promotion heals the unit back to full as well. */
  IF.RANKS = [
    { name: 'Rookie',  kills: 0, dmg: 1.00, hp: 1.00, regen: 0 },
    { name: 'Veteran', kills: 3, dmg: 1.20, hp: 1.15, regen: 0 },
    { name: 'Elite',   kills: 8, dmg: 1.45, hp: 1.30, regen: 0.015 }
  ];

  /* Set to false if you would rather always see the whole sector map. */
  IF.REQUIRE_RADAR = true;

  /* Command Powers. Points build up over time and from kills. */
  IF.POWER_MAX = 8;
  IF.POWER_RATE = 22;          // seconds per point
  IF.POWERS = {
    recon:    { id: 'recon',    name: 'Recon Sweep',   cost: 1, cooldown: 45,  radius: 430, duration: 35,
                desc: 'A spotter plane lifts the shroud over one area for half a minute.' },
    repair:   { id: 'repair',   name: 'Repair Drop',   cost: 2, cooldown: 80,  radius: 260, heal: 0.45,
                desc: 'Air-drops parts and medics. Heals every friendly unit in the circle.' },
    barrage:  { id: 'barrage',  name: 'Artillery Barrage', cost: 3, cooldown: 95, radius: 230,
                shells: 16, spread: 5, dmg: 95, splash: 75,
                desc: 'Off-map guns walk sixteen shells across the target area.' },
    paradrop: { id: 'paradrop', name: 'Paradrop',      cost: 4, cooldown: 130, count: 6,
                desc: 'Six rifle squads land anywhere on the map. Good behind enemy lines.' },
    fuelair:  { id: 'fuelair',  name: 'Fuel Air Bomb', cost: 6, cooldown: 190, needs: 'lab',
                dmg: 750, splash: 200,
                desc: 'One bomber, one enormous hole. Needs a Research Laboratory.' }
  };
  IF.POWER_ORDER = ['recon', 'repair', 'barrage', 'paradrop', 'fuelair'];

  IF.START = { supplies: 3000, fuel: 1000 };
  IF.POP_MAX = 90;
  IF.NODE_SUPPLY = 9000;
  IF.NODE_FUEL = 6000;

})(window.IF);
