/* =========================================================
   stages.js — モード別ステージ生成・動的ギミック・判定
   ========================================================= */
'use strict';

function addStaticBox(w, h, d, x, y, z, color, ry) {
  ry = ry || 0;
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  mesh.receiveShadow = true; mesh.castShadow = true;
  STATE.scene.add(mesh);

  const shape = new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2));
  const body = new CANNON.Body({ mass: 0, shape, material: STATE.defaultMaterial });
  body.position.set(x, y, z);
  body.quaternion.setFromEuler(0, ry, 0);
  STATE.world.addBody(body);
  const entry = { mesh, body };
  STATE.obstacles.push(entry);
  return entry;
}

function clearStage() {
  for (const o of STATE.obstacles) {
    STATE.scene.remove(o.mesh);
    STATE.world.removeBody(o.body);
  }
  STATE.obstacles.length = 0;
  for (const b of STATE.bigBalls) {
    STATE.scene.remove(b.mesh);
    STATE.world.removeBody(b.body);
  }
  STATE.bigBalls = [];
  STATE.spinPlatforms = [];
}

// ---------- モード1: レース ----------
function buildRaceStage() {
  clearStage();
  const trackLen = 90;
  STATE.goalZ = trackLen;
  addStaticBox(10, 1, trackLen, 0, -0.5, trackLen / 2, 0x77c9ff);
  for (let i = 10; i < trackLen - 10; i += 12) {
    const type = Math.floor(Math.random() * 3);
    if (type === 0) {
      const bar = addStaticBox(6, 0.6, 0.6, (Math.random() - 0.5) * 2, 0.3, i, 0xffb703);
      bar.spin = true; bar.spinSpeed = (Math.random() > 0.5 ? 1 : -1) * (0.8 + Math.random());
      STATE.spinPlatforms.push(bar);
    } else if (type === 1) {
      addStaticBox(3.5, 2, 1, -3, 0.5, i, 0xef476f);
      addStaticBox(3.5, 2, 1, 3, 0.5, i, 0xef476f);
    } else {
      addStaticBox(2, 0.5, 2, (Math.random() - 0.5) * 6, 0.25, i, 0x06d6a0);
    }
  }
  addStaticBox(10, 3, 0.5, 0, 1, trackLen, 0xffd60a);
}

// ---------- モード2: サバイバル ----------
function buildSurvivalStage() {
  clearStage();
  STATE.goalZ = null;
  const platform = addStaticBox(22, 1, 22, 0, -0.5, 0, 0x9d4edd);
  platform.spin = true; platform.spinSpeed = 0.4;
  STATE.spinPlatforms.push(platform);

  for (let r = 0; r < 2; r++) {
    const bar = addStaticBox(16, 0.8, 1, 0, 0.6, 0, 0xff5d8f);
    bar.spin = true;
    bar.spinSpeed = (r === 0 ? 1 : -1) * (0.9 + r * 0.4);
    STATE.spinPlatforms.push(bar);
  }
}

// ---------- モード3: 大玉回避 ----------
function buildDodgeStage() {
  clearStage();
  STATE.goalZ = null;
  addStaticBox(24, 1, 60, 0, -0.5, 0, 0x4cc9f0);
  addStaticBox(1, 3, 60, -12, 1, 0, 0x3a86ff);
  addStaticBox(1, 3, 60, 12, 1, 0, 0x3a86ff);

  for (let i = 0; i < 5; i++) {
    const ballGeo = new THREE.SphereGeometry(2.2, 16, 16);
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xff006e, roughness: 0.4 });
    const mesh = new THREE.Mesh(ballGeo, ballMat);
    mesh.castShadow = true;
    STATE.scene.add(mesh);
    const shape = new CANNON.Sphere(2.2);
    const body = new CANNON.Body({ mass: 40, shape, material: STATE.defaultMaterial, linearDamping: 0.1 });
    body.position.set((Math.random() - 0.5) * 20, 3, -25 + i * 12);
    STATE.world.addBody(body);
    STATE.bigBalls.push({ mesh, body, dir: Math.random() > 0.5 ? 1 : -1, speed: 4 + Math.random() * 3 });
  }
}

// ---------- モード4: チーム対戦 ----------
function buildTeamStage() {
  clearStage();
  STATE.goalZ = null;
  addStaticBox(30, 1, 30, 0, -0.5, 0, 0x2ec4b6);
  addStaticBox(1, 3, 30, -15, 1, 0, 0x264653);
  addStaticBox(1, 3, 30, 15, 1, 0, 0x264653);
  addStaticBox(30, 3, 1, 0, 1, -15, 0x264653);
  addStaticBox(30, 3, 1, 0, 1, 15, 0x264653);
  STATE.teamScores = { red: 0, blue: 0 };
}

// ---------- 動的更新 ----------
function updateStageDynamics(dt) {
  for (const s of STATE.spinPlatforms) {
    s.mesh.rotation.y += s.spinSpeed * dt;
    s.body.quaternion.setFromEuler(0, s.mesh.rotation.y, 0);
  }
  if (STATE.mode === 'dodge') {
    for (const b of STATE.bigBalls) {
      b.body.velocity.x = b.dir * b.speed;
      if (Math.abs(b.body.position.x) > 9) b.dir *= -1;
      b.mesh.position.copy(b.body.position);
      b.mesh.quaternion.copy(b.body.quaternion);
      for (const p of STATE.players) {
        if (p.eliminated) continue;
        const d = p.body.position.distanceTo(b.body.position);
        if (d < 2.2 + PLAYER_RADIUS) {
          const nx = (p.body.position.x - b.body.position.x) / Math.max(d, 0.01);
          const nz = (p.body.position.z - b.body.position.z) / Math.max(d, 0.01);
          launchPlayer(p, nx, nz, 9);
        }
      }
    }
  }
}

// ---------- 脱落・ゴール判定 ----------
function checkEliminationAndGoals(dt) {
  const FALL_Y = -12;
  for (const p of STATE.players) {
    if (p.eliminated) continue;
    if (p.body.position.y < FALL_Y) { eliminatePlayer(p); continue; }
    if (STATE.mode === 'race' && !p.finishTime && p.body.position.z >= STATE.goalZ) {
      p.finishTime = STATE.time;
      p.qualified = true;
      if (p.isUser) {
        const place = STATE.players.filter(x => x.finishTime).length;
        endGame(true, `${place}位でゴール！`);
      }
    }
  }
}

function eliminatePlayer(p) {
  p.eliminated = true;
  p.mesh.visible = false;
  p.body.velocity.set(0, 0, 0);
  p.body.position.set(9999, -100, 9999);
  if (p.isUser) endGame(false, '脱落してしまった…！');
}

function endGame(success, subtitle) {
  if (!STATE.running) return;
  STATE.running = false;
  document.getElementById('hud').style.display = 'none';
  document.getElementById('actionZone').style.display = 'none';
  document.getElementById('joystickZone').style.display = 'none';
  const rs = document.getElementById('resultScreen');
  document.getElementById('crownIcon').textContent = success ? '👑' : '💀';
  document.getElementById('resultTitle').textContent = success ? 'クオリファイ！' : '脱落…';
  document.getElementById('resultSub').textContent = subtitle || '';
  rs.style.display = 'flex';
}
