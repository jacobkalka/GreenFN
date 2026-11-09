// Court + physical constants (meters, seconds, kilograms). NBA dimensions.
// World frame: Y up, floor at y = 0. The active rim center is at x = 0, z = 0.
// The half court extends toward +Z (baseline at negative Z). The camera usually looks toward -Z.

export const SIM_HZ = 120;
export const SIM_DT = 1 / SIM_HZ;
export const BALL_SUBSTEPS = 2;

export const GRAVITY = 9.81;

export const COURT = {
  halfWidth: 7.62, // 50 ft wide
  fullLength: 28.65, // 94 ft
  baselineZ: -1.6, // rim center is 5.25 ft from the baseline
  halfCourtZ: -1.6 + 14.325,
  lineWidth: 0.0508,
  laneWidth: 4.877, // 16 ft
  ftLineZ: -1.6 + 5.791, // 19 ft from baseline
  ftCircleR: 1.829,
  threeR: 7.239, // 23.75 ft arc
  threeCornerX: 6.706, // 22 ft corners
  restrictedR: 1.219,
  centerCircleR: 1.829,
};
// Z where the straight corner three-point lines meet the arc.
COURT.threeCornerZ = Math.sqrt(COURT.threeR * COURT.threeR - COURT.threeCornerX * COURT.threeCornerX);

export const HOOP = {
  rimY: 3.048,
  rimR: 0.2365, // tube centerline radius (inner diameter 18")
  rimTube: 0.0095,
  rimInnerR: 0.2286,
  boardFaceZ: -0.381, // backboard face (rim inner edge is 6" from the board)
  boardThick: 0.045,
  boardHalfW: 0.9145, // 6 ft wide
  boardBottom: 3.048 - 0.152,
  boardTop: 3.048 - 0.152 + 1.067, // 3.5 ft tall
  squareHalfW: 0.305,
  squareH: 0.457,
  netDepth: 0.42,
  netBottomR: 0.15,
};

export const BALL = {
  radius: 0.1194,
  mass: 0.62,
  dragK: 0.0215, // 0.5 * rho * Cd * A / m  (1/m)
  magnusK: 0.0052, // lift ~ k * (w x v)
  floorRestitution: 0.78,
  floorFriction: 0.55,
  rimRestitution: 0.52,
  rimFriction: 0.35,
  boardRestitution: 0.62,
  boardFriction: 0.3,
  bodyRestitution: 0.35,
  rollingDecel: 0.22,
};
BALL.inertia = (2 / 3) * BALL.mass * BALL.radius * BALL.radius;

export const PLAYER = {
  radius: 0.3,
  height: 1.98,
};

// Shot scoring regions
export const isBeyondArc = (x, z) => {
  // Behind the straight corner lines or outside the arc radius.
  if (z <= COURT.threeCornerZ) return Math.abs(x) >= COURT.threeCornerX;
  return Math.sqrt(x * x + z * z) >= COURT.threeR;
};

export const inCourtBounds = (x, z, margin = 0) =>
  Math.abs(x) <= COURT.halfWidth + margin && z >= COURT.baselineZ - margin && z <= COURT.halfCourtZ + margin;

export const DIFFICULTIES = [
  { id: 'rookie', name: 'Rookie', mult: 0.8 },
  { id: 'pro', name: 'Pro', mult: 1.0 },
  { id: 'allstar', name: 'All-Star', mult: 1.35 },
  { id: 'legend', name: 'Legend', mult: 1.8 },
];
