/* =========================================================
   main.js — HUD・モード開始・メインループ・起動
   ========================================================= */
'use strict';

function updateHUD() {
  const timerPill = document.getElementById('timerPill');
  const remain = Math.max(0, STATE.timeLimit - STATE.time);
  timerPill.textContent = '⏱ ' + Math.ceil(remain);

  const alive = STATE.players.filter(p => !p.eliminated).length;
  document.getElementById('qualPill').textContent =
    STATE.mode === 'race' ? `ゴール済み: ${STATE.players.filter(p => p.finishTime).length}/16`
    : STATE.mode === 'team' ? `🔴${STATE.teamScores.red} - 🔵${STATE.teamScores.blue}`
    : `残り人数: ${alive}/16`;

  const user = STATE.players.find(p => p.isUser);
  if (user && !user.eliminated) {
    if (STATE.mode === 'race') {
      const sorted = STATE.players.filter(p => !p.eliminated).slice().sort((a, b) => b.body.position.z - a.body.position.z);
      const rank = sorted.findIndex(p => p.isUser) + 1;
      document.getElementById('rankPill').textContent = `順位: ${rank}/${sorted.length}`;
    } else {
      document.getElementById('rankPill').textContent = `生存中`;
    }
  }

  if (remain <= 0 && STATE.running) {
    if (STATE.mode === 'race') {
      endGame(user.finishTime != null, user.finishTime != null ? 'ゴールした！' : 'タイムアップ…');
    } else {
      const stillAlive = user && !user.eliminated;
      endGame(!!stillAlive, stillAlive ? '生き残った！' : 'タイムアップ…');
    }
  }
}

function startMode(mode) {
  STATE.mode = mode;
  STATE.time = 0;
  STATE.running = true;

  clearPlayers();

  let spawnFn;
  if (mode === 'race') {
    STATE.timeLimit = 75;
    buildRaceStage();
    spawnFn = (i) => new THREE.Vector3((i % 8 - 3.5) * 1.2, 1.5, Math.floor(i / 8) * 1.5);
  } else if (mode === 'survival') {
    STATE.timeLimit = 60;
    buildSurvivalStage();
    spawnFn = (i) => {
      const angle = (i / 16) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(angle) * 5, 2, Math.sin(angle) * 5);
    };
  } else if (mode === 'dodge') {
    STATE.timeLimit = 45;
    buildDodgeStage();
    spawnFn = (i) => new THREE.Vector3((i % 8 - 3.5) * 2.5, 1.5, -18 + Math.floor(i / 8) * 2);
  } else if (mode === 'team') {
    STATE.timeLimit = 60;
    buildTeamStage();
    spawnFn = (i) => {
      const isRed = i % 2 === 0;
      return new THREE.Vector3(isRed ? -10 : 10, 1.5, (Math.floor(i / 2) - 4) * 2);
    };
  } else {
    console.error('Unknown mode:', mode);
    return;
  }

  spawnAllPlayers(spawnFn);

  if (mode === 'team') {
    STATE.players.forEach((p, idx) => {
      p.team = idx % 2 === 0 ? 'red' : 'blue';
      const col = p.team === 'red' ? 0xff5577 : 0x4499ff;
      p.mesh.userData.bodyMesh.material.color.set(col);
      p.mesh.userData.handL.material.color.set(col);
      p.mesh.userData.handR.material.color.set(col);
    });
  }

  document.getElementById('titleScreen').style.display = 'none';
  document.getElementById('hud').style.display = 'flex';
  document.getElementById('actionZone').style.display = 'flex';
  document.getElementById('joystickZone').style.display = 'block';
  document.getElementById('resultScreen').style.display = 'none';

  const modeNames = {
    race: '🏁 レース：ゴールを目指せ！',
    survival: '🌀 サバイバル：床から落ちるな！',
    dodge: '💥 大玉回避：転がる玉を避けろ！',
    team: '🎯 チーム対戦：タックルで押し出せ！',
  };
  showBanner(modeNames[mode]);
}

function gameLoop() {
  requestAnimationFrame(gameLoop);
  const dt = Math.min(STATE.clock.getDelta(), 0.05);

  if (STATE.running) {
    STATE.time += dt;
    STATE.world.step(1 / 60, dt, 3);

    const user = STATE.players.find(p => p.isUser);
    if (user) {
      updatePlayerControl(user, Input.moveX, Input.moveY, Input.jumpPressed, Input.divePressed, Input.grabHeld, dt);
      Input.jumpPressed = false;
      Input.divePressed = false;
    }
    for (const p of STATE.players) {
      if (!p.isUser) updateBotAI(p, dt);
      applyGrabPhysics(p, dt);
    }
    handlePlayerCollisions();
    updateStageDynamics(dt);
    checkEliminationAndGoals(dt);
    syncMeshes(dt);
    updateCamera();
    updateHUD();
  }

  STATE.renderer.render(STATE.scene, STATE.camera);
}

// ---------- モードボタンのバインド（最重要：確実に発火させる） ----------
function setupModeButtons() {
  const buttons = document.querySelectorAll('.modeBtn');
  buttons.forEach((btn) => {
    let firing = false;
    const fire = () => {
      if (firing) return;
      firing = true;
      btn.classList.add('pressed');
      setTimeout(() => btn.classList.remove('pressed'), 150);
      const mode = btn.getAttribute('data-mode');
      startMode(mode);
      setTimeout(() => { firing = false; }, 300);
    };
    // touchendで発火。preventDefaultして後続のclickイベントの二重発火を防ぐ。
    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
      fire();
    }, { passive: false });
    // タッチが使えない環境（PCブラウザ等）向けにclickも拾う
    btn.addEventListener('click', (e) => {
      fire();
    });
  });
}

function initGame() {
  try {
    if (typeof THREE === 'undefined' || typeof CANNON === 'undefined') {
      throw new Error('THREE または CANNON が読み込まれていません（CDN読み込み失敗の可能性）');
    }
    initRenderer();
    initPhysics();
    setupJoystick();
    setupActionButtons();
    setupFullscreen();
    setupModeButtons();
    STATE.clock = new THREE.Clock();

    document.getElementById('retryBtn').addEventListener('touchend', (e) => {
      e.preventDefault();
      document.getElementById('resultScreen').style.display = 'none';
      document.getElementById('titleScreen').style.display = 'flex';
    }, { passive: false });
    document.getElementById('retryBtn').addEventListener('click', () => {
      document.getElementById('resultScreen').style.display = 'none';
      document.getElementById('titleScreen').style.display = 'flex';
    });

    document.getElementById('loadingScreen').style.display = 'none';
    gameLoop();
  } catch (err) {
    const box = document.getElementById('loadErrorBox');
    const detail = document.getElementById('loadErrorDetail');
    document.getElementById('loadingScreen').style.display = 'none';
    detail.textContent = err.message + '\n' + (err.stack || '');
    box.style.display = 'flex';
    console.error(err);
  }
}

// DOMContentLoadedで開始（loadより早く確実に発火する）
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGame);
} else {
  initGame();
}
