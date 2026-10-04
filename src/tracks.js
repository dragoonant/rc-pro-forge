'use strict';
// Track + theme definitions. Track corners are grid points (1 unit = CELL world px), driven in listed order.
// Feature positions are fractions of lap length; ramps/boosts snap to the nearest straight.

const THEMES = {
  backyard: {
    outer: 'tex_grass', apron: 'tex_grass', road: 'tex_dirt', apronW: 400,
    wallA: '#e8e8e8', wallB: '#d82800', wallTop: '#fcfcfc', curbA: '#fcfcfc', curbB: '#d82800',
    props: [['tree_oak', 3], ['bush', 4], ['haybale', 2]], propDensity: 0.55,
    grip: 1, mood: 'major', fallback: { outer: '#3c8c28', apron: '#3c8c28', road: '#9c6c3c' },
  },
  beach: {
    outer: 'tex_water', apron: 'tex_sand', road: 'tex_asphalt', apronW: 150,
    wallA: '#fcfcfc', wallB: '#0078f8', wallTop: '#fcfcfc', curbA: '#fcfcfc', curbB: '#f8b800',
    props: [['tree_palm', 4], ['umbrella', 2], ['rock', 2]], propDensity: 0.5, propsOnApronOnly: true,
    grip: 1, mood: 'mixo', fallback: { outer: '#2878f8', apron: '#f0d088', road: '#585858' },
  },
  snow: {
    outer: 'tex_snow', apron: 'tex_snow', road: 'tex_ice', apronW: 400,
    wallA: '#fcfcfc', wallB: '#3cbcfc', wallTop: '#fcfcfc', curbA: '#fcfcfc', curbB: '#0058f8',
    props: [['tree_pine', 5], ['snowman', 1], ['rock', 1]], propDensity: 0.5,
    grip: 0.62, mood: 'minor', fallback: { outer: '#f0f0f8', apron: '#f0f0f8', road: '#a8d8f8' },
  },
  industrial: {
    outer: 'tex_rubber', apron: 'tex_concrete', road: 'tex_asphalt', apronW: 160,
    wallA: '#f8b800', wallB: '#181818', wallTop: '#fcfcfc', curbA: '#f8b800', curbB: '#181818',
    props: [['barrel', 3], ['tirestack', 3], ['cone', 2], ['lamp', 1]], propDensity: 0.45, propsOnApronOnly: true,
    grip: 1, mood: 'dorian', fallback: { outer: '#484848', apron: '#a0a0a0', road: '#404040' },
  },
};

const TRACKS = [
  {
    name: 'BACKYARD BASH', theme: 'backyard', laps: 3, seed: 11,
    pts: [[0, 0], [8, 0], [8, 3], [5, 3], [5, 6], [0, 6]],
    ramps: [0.22, 0.7], boosts: [[0.45, 0.4], [0.88, -0.4]],
    oil: [[0.36, -0.3]], puddles: [[0.6, 0.35], [0.95, -0.2]], clouds: [0.8],
  },
  {
    name: 'SURF TURF', theme: 'beach', laps: 3, seed: 22,
    pts: [[0, 0], [6, 0], [6, 2], [9, 2], [9, 7], [6, 7], [6, 5], [3, 5], [3, 8], [0, 8]],
    ramps: [0.12, 0.52, 0.84], boosts: [[0.3, 0], [0.66, 0.4]],
    oil: [[0.25, 0.4], [0.75, -0.4]], puddles: [[0.45, -0.3], [0.9, 0.3]], clouds: [0.4],
  },
  {
    name: 'FROSTBITE PASS', theme: 'snow', laps: 3, seed: 33,
    pts: [[0, 0], [5, 0], [7, 2], [7, 5], [4, 5], [4, 3], [2, 3], [2, 7], [9, 7], [9, 9], [0, 9]],
    ramps: [0.05, 0.62, 0.86], boosts: [[0.18, 0.3], [0.5, -0.3]],
    oil: [[0.32, 0.2], [0.7, -0.35]], puddles: [[0.42, 0.35]], clouds: [0.28, 0.75],
  },
  {
    name: 'STEEL MILL MAYHEM', theme: 'industrial', laps: 3, seed: 44,
    pts: [[0, 0], [10, 0], [10, 4], [7, 4], [7, 2], [4, 2], [4, 6], [10, 6], [10, 9], [0, 9]],
    ramps: [0.08, 0.5, 0.74], boosts: [[0.2, -0.4], [0.62, 0.4], [0.9, 0]],
    oil: [[0.15, 0.35], [0.4, -0.35], [0.82, 0.3]], puddles: [[0.56, 0], [0.97, -0.4]], clouds: [0.33, 0.68],
  },
];
