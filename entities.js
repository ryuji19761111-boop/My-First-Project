/* =========================================================
   entities.js — プレイヤー・ラグドール演出・Bot AI・妨害システム
   ========================================================= */
'use strict';

function createPlayerMesh(color) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05 });
  const bodyGeo = new THREE.SphereGeometry(0.5, 12, 12);
  bodyGeo.scale(1, 1.15, 1);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = true;
  group.add(body);

  const eyeGeo = new THREE.SphereGeometry(0.09, 8, 8);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
  [-0.18, 0.18].forEach((ox) => {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(ox, 0.12, 0.42);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), pupilMat);
    pupil.position.set(0, 0, 0.06);
    eye.add(pupil);
    group.add(eye);
  });

  const handMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const handL = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), handMat);
  const handR = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), handMat);
  handL.position.set(-0.45, -0.05, 0.1);
  handR.position.set(0.45, -0.05, 0.1);
  group.add(handL); group.add(handR);
  group.userData.handL = handL;
  group.userData.handR = handR;
  group.userData.bodyMesh = body;
  return group;
}

function createPlayer(name, color, isUser, spawnPos) {
  const mesh = createPlayerMesh(color);
  STATE.scene.add(mesh);

  const shape = new CANNON.Sphere(PLAYER_RADIUS);
  const body = new CANNON.Body({
    mass: 1, shape, material: STATE.defaultMaterial,
    linearDamping: 0.5, angularDamping: 0.9,
    position: new CANNON.Vec3(spawnPos.x, spawnPos.y, spawnPos.z),
  });
  body.fixedRotation = true;
  body.updateMassProperties();
  STATE.world.addBody(body);

  const player = {
    name, mesh, body, isUser, color,
    eliminated: false, qualified: false,
    grabbing: null, grabbedBy: null,
    diveTimer: 0, diveCooldown: 0, stunTimer: 0, jumpCooldown: 0,
    grounded: false,
    aiTimer: Math.random() * 2, aiDir: new THREE.Vector2(0, 1), aiWanderX: 0,
    finishTime: null, velWobble: 0,
  };
  STATE.players.push(player);
  return player;
}

function spawnAllPlayers(spawnFn) {
  clearPlayers();
  const userPos = spawnFn(0);
  createPlayer('あなた', 0x3ec6ff, true, userPos);
  for (let i = 0; i < 15; i++) {
    const color = [0xff6b6b,0xffd93d,0x6bcB77,0xff9f45,0xc65bff,0x5bd8ff,0xff5b9c,0x8ac926][i % 8];
    createPlayer(BOT_NAMES[i % BOT_NAMES.length], color, false, spawnFn(i + 1));
  }
}

function clearPlayers() {
  for (const p of STATE.players) {
    STATE.scene.remove(p.mesh);
    STATE.world.removeBody(p.body);
  }
  STATE.players.length = 0;
}

// ---------- 操作・タックル・掴み ----------
const MOVE_SPEED = 9;
const DIVE_SPEED = 16;
const DIVE_DURATION = 0.35;
const DIVE_COOLDOWN = 0.9;
const STUN_DURATION = 0.6;
const GRAB_RANGE = 1.3;

function updatePlayerControl(p, dx, dy, wantJump, wantDive, wantGrab, dt) {
  if (p.eliminated) return;
  if (p.stunTimer > 0) { p.stunTimer -= dt; return; }

  const vel = p.body.velocity;
  p.grounded = Math.abs(vel.y) < 3.5;

  if (p.diveTimer > 0) { p.diveTimer -= dt; return; }
  if (p.diveCooldown > 0) p.diveCooldown -= dt;
  if (p.jumpCooldown > 0) p.jumpCooldown -= dt;

  const len = Math.hypot(dx, dy);
  if (len > 0.05) {
    const nx = dx / Math.max(len, 1);
    const ny = dy / Math.max(len, 1);
    const targetVX = nx * MOVE_SPEED * Math.min(len, 1);
    const targetVZ = ny * MOVE_SPEED * Math.min(len, 1);
    vel.x += (targetVX - vel.x) * Math.min(1, dt * 8);
    vel.z += (targetVZ - vel.z) * Math.min(1, dt * 8);
    const angle = Math.atan2(nx, ny);
    p.mesh.rotation.y = lerpAngle(p.mesh.rotation.y, angle, 0.25);
  }

  if (wantJump && p.grounded && p.jumpCooldown <= 0) {
    vel.y = 8.5;
    p.jumpCooldown = 0.35;
  }

  if (wantDive && p.diveCooldown <= 0 && p.grounded) {
    const facing = p.mesh.rotation.y;
    const fx = Math.sin(facing), fz = Math.cos(facing);
    vel.x = fx * DIVE_SPEED;
    vel.z = fz * DIVE_SPEED;
    vel.y = 3.5;
    p.diveTimer = DIVE_DURATION;
    p.diveCooldown = DIVE_COOLDOWN;
  }

  if (wantGrab && !p.grabbing && !p.grabbedBy) {
    tryGrab(p);
  } else if (!wantGrab && p.grabbing) {
    releaseGrab(p);
  }
}

function tryGrab(p) {
  let closest = null, closestDist = GRAB_RANGE;
  for (const other of STATE.players) {
    if (other === p || other.eliminated || other.grabbedBy) continue;
    const d = p.body.position.distanceTo(other.body.position);
    if (d < closestDist) { closest = other; closestDist = d; }
  }
  if (closest) {
    p.grabbing = closest;
    closest.grabbedBy = p;
    if (p.isUser) showBanner(`${closest.name}を掴んだ！`);
    else if (closest.isUser) showBanner(`${p.name}に掴まれた！`);
  }
}

function releaseGrab(p) {
  if (p.grabbing) {
    p.grabbing.grabbedBy = null;
    p.grabbing = null;
  }
}

function applyGrabPhysics(p, dt) {
  if (p.grabbing) {
    const target = p.grabbing;
    const dir = new CANNON.Vec3().copy(p.body.position).vsub(target.body.position);
    const dist = dir.length();
    if (dist > 0.01) dir.scale(1 / dist, dir);
    const desired = new CANNON.Vec3().copy(p.body.position).vsub(dir.scale(1.1, new CANNON.Vec3()));
    target.body.velocity.x += (desired.x - target.body.position.x) * 6 * dt;
    target.body.velocity.z += (desired.z - target.body.position.z) * 6 * dt;
    target.body.velocity.y += (p.body.position.y - target.body.position.y) * 4 * dt;
    target.stunTimer = Math.max(target.stunTimer, 0.05);
  }
}

function handlePlayerCollisions() {
  const arr = STATE.players.filter(p => !p.eliminated);
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i], b = arr[j];
      const dist = a.body.position.distanceTo(b.body.position);
      const minDist = PLAYER_RADIUS * 2 * 0.95;
      if (dist < minDist && dist > 0.001) {
        const nx = (b.body.position.x - a.body.position.x) / dist;
        const nz = (b.body.position.z - a.body.position.z) / dist;
        const aDiving = a.diveTimer > 0;
        const bDiving = b.diveTimer > 0;

        if (aDiving && !bDiving) {
          launchPlayer(b, nx, nz, 11);
          launchPlayer(a, -nx * 0.3, -nz * 0.3, 2);
          if (b.isUser) showBanner(`${a.name}にタックルされた！`);
          else if (a.isUser) showBanner(`${b.name}を吹っ飛ばした！`);
        } else if (bDiving && !aDiving) {
          launchPlayer(a, -nx, -nz, 11);
          launchPlayer(b, nx * 0.3, nz * 0.3, 2);
          if (a.isUser) showBanner(`${b.name}にタックルされた！`);
          else if (b.isUser) showBanner(`${a.name}を吹っ飛ばした！`);
        } else {
          const push = (minDist - dist) * 4;
          a.body.velocity.x -= nx * push;
          a.body.velocity.z -= nz * push;
          b.body.velocity.x += nx * push;
          b.body.velocity.z += nz * push;
        }
      }
    }
  }
}

function launchPlayer(p, nx, nz, power) {
  p.body.velocity.x = nx * power;
  p.body.velocity.z = nz * power;
  p.body.velocity.y = 5.5;
  p.stunTimer = STUN_DURATION;
  if (p.grabbedBy) { p.grabbedBy.grabbing = null; p.grabbedBy = null; }
  if (p.grabbing) releaseGrab(p);
}

// ---------- Bot AI ----------
function updateBotAI(p, dt) {
  if (p.isUser || p.eliminated) return;
  p.aiTimer -= dt;

  if (STATE.mode === 'race') {
    if (p.aiTimer <= 0) { p.aiTimer = 0.4 + Math.random() * 0.6; p.aiWanderX = (Math.random() - 0.5); }
    const wantDive = Math.random() < 0.004;
    const wantJump = Math.random() < 0.01;
    updatePlayerControl(p, p.aiWanderX, 1, wantJump, wantDive, false, dt);
  } else if (STATE.mode === 'survival') {
    if (p.aiTimer <= 0) { p.aiTimer = 0.5 + Math.random() * 0.8; p.aiDir.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2); }
    const toCenter = new THREE.Vector2(-p.body.position.x, -p.body.position.z).normalize();
    const dx = p.aiDir.x * 0.5 + toCenter.x * 0.5;
    const dy = p.aiDir.y * 0.5 + toCenter.y * 0.5;
    updatePlayerControl(p, dx, dy, Math.random() < 0.02, false, false, dt);
  } else if (STATE.mode === 'dodge') {
    if (p.aiTimer <= 0) { p.aiTimer = 0.3 + Math.random() * 0.5; p.aiDir.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2); }
    updatePlayerControl(p, p.aiDir.x, p.aiDir.y, Math.random() < 0.03, false, false, dt);
  } else if (STATE.mode === 'team') {
    const enemies = STATE.players.filter(pl => !pl.eliminated && pl.team !== p.team);
    let target = null, bd = Infinity;
    for (const e of enemies) {
      const d = p.body.position.distanceTo(e.body.position);
      if (d < bd) { bd = d; target = e; }
    }
    let dirX = 0, dirY = 1;
    if (target) {
      const dx = target.body.position.x - p.body.position.x;
      const dz = target.body.position.z - p.body.position.z;
      const len = Math.hypot(dx, dz) || 1;
      dirX = dx / len; dirY = dz / len;
    }
    const wantDive = !!(target && bd < 3 && Math.random() < 0.05);
    updatePlayerControl(p, dirX, dirY, Math.random() < 0.01, wantDive, false, dt);
  }
}

// ---------- 見た目同期・カメラ ----------
function syncMeshes(dt) {
  for (const p of STATE.players) {
    if (p.eliminated) continue;
    p.mesh.position.set(p.body.position.x, p.body.position.y, p.body.position.z);
    const vel = p.body.velocity;
    const speed = Math.hypot(vel.x, vel.z);
    const tiltTarget = Math.min(speed * 0.05, 0.35);
    p.velWobble += dt * 10;
    const wobble = Math.sin(p.velWobble) * 0.08 * Math.min(speed / 5, 1);
    p.mesh.rotation.x = -tiltTarget * 0.4;
    p.mesh.rotation.z = wobble;

    if (p.stunTimer > 0) {
      p.mesh.rotation.x = Math.sin(p.velWobble * 3) * 0.6;
      p.mesh.rotation.z = Math.cos(p.velWobble * 3) * 0.6;
    }

    const handL = p.mesh.userData.handL, handR = p.mesh.userData.handR;
    if (p.grabbing || p.diveTimer > 0) {
      handL.position.set(-0.3, -0.05, 0.5);
      handR.position.set(0.3, -0.05, 0.5);
    } else {
      handL.position.set(-0.45, -0.05, 0.1);
      handR.position.set(0.45, -0.05, 0.1);
    }
  }
}

function updateCamera() {
  const user = STATE.players.find(p => p.isUser);
  if (!user) return;
  const pos = user.mesh.position;
  const behindAngle = user.mesh.rotation.y;
  const camDist = 7.5, camHeight = 4.2;
  const camX = pos.x - Math.sin(behindAngle) * camDist;
  const camZ = pos.z - Math.cos(behindAngle) * camDist;
  const targetCamPos = new THREE.Vector3(camX, pos.y + camHeight, camZ);
  STATE.camera.position.lerp(targetCamPos, 0.08);
  STATE.camera.lookAt(pos.x, pos.y + 0.8, pos.z);
}
