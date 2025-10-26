const GRAVITY = 0.6;
const JUMP_VELOCITY = -10;
const GROUND_HEIGHT = 80;

export class RunnerGame {
  constructor(canvas, { onScore } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onScore = onScore;

    this.reset();
  }

  reset() {
    this.player = {
      x: 80,
      y: this.canvas.height - GROUND_HEIGHT,
      width: 40,
      height: 60,
      vy: 0,
      grounded: true,
    };

    this.obstacles = [];
    this.clouds = [];
    this.frame = 0;
    this.score = 0;
    this.running = false;
    this.lastSpawn = 0;
  }

  start() {
    if (this.running) return;
    this.reset();
    this.running = true;
    this.frame = 0;
    this.score = 0;
    this.loop();
    window.addEventListener('keydown', this.handleKeyDown);
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
  }

  stop() {
    this.running = false;
    window.removeEventListener('keydown', this.handleKeyDown);
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
  }

  handleKeyDown = (event) => {
    if (event.code === 'Space' || event.code === 'ArrowUp') {
      event.preventDefault();
      this.jump();
    }
  };

  handlePointerDown = (event) => {
    event.preventDefault();
    this.jump();
  };

  jump() {
    if (this.player.grounded) {
      this.player.vy = JUMP_VELOCITY;
      this.player.grounded = false;
    }
  }

  loop = () => {
    if (!this.running) return;
    this.update();
    this.draw();
    requestAnimationFrame(this.loop);
  };

  update() {
    this.frame += 1;
    this.player.vy += GRAVITY;
    this.player.y += this.player.vy;

    if (this.player.y >= this.canvas.height - GROUND_HEIGHT) {
      this.player.y = this.canvas.height - GROUND_HEIGHT;
      this.player.vy = 0;
      this.player.grounded = true;
    }

    this.spawnObstacles();
    this.spawnClouds();
    this.updateObstacles();
    this.updateClouds();
    this.detectCollisions();

    if (this.frame % 5 === 0) {
      this.score += 1;
      this.onScore?.(this.score);
    }
  }

  spawnObstacles() {
    if (this.frame - this.lastSpawn < 90) return;
    const shouldSpawn = Math.random() > 0.7;
    if (!shouldSpawn) return;

    this.lastSpawn = this.frame;
    const height = 30 + Math.random() * 30;
    this.obstacles.push({
      x: this.canvas.width + 20,
      y: this.canvas.height - GROUND_HEIGHT,
      width: 30,
      height,
      speed: 6 + Math.min(6, this.score / 100),
    });
  }

  spawnClouds() {
    if (this.frame % 120 !== 0) return;
    this.clouds.push({
      x: this.canvas.width + 50,
      y: 50 + Math.random() * 80,
      width: 80,
      height: 30,
      speed: 1.5,
    });
  }

  updateObstacles() {
    this.obstacles.forEach((obstacle) => {
      obstacle.x -= obstacle.speed;
    });
    this.obstacles = this.obstacles.filter((obstacle) => obstacle.x + obstacle.width > 0);
  }

  updateClouds() {
    this.clouds.forEach((cloud) => {
      cloud.x -= cloud.speed;
    });
    this.clouds = this.clouds.filter((cloud) => cloud.x + cloud.width > 0);
  }

  detectCollisions() {
    const collided = this.obstacles.some((obstacle) => {
      const withinX =
        this.player.x < obstacle.x + obstacle.width && this.player.x + this.player.width > obstacle.x;
      const withinY = this.player.y < obstacle.y + obstacle.height && this.player.y + this.player.height > obstacle.y;
      return withinX && withinY;
    });

    if (collided) {
      this.stop();
      this.onScore?.(this.score);
    }
  }

  draw() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    this.drawBackground(ctx, canvas);
    this.drawGround(ctx, canvas);
    this.drawPlayer(ctx);
    this.drawObstacles(ctx);
    this.drawScore(ctx);
  }

  drawBackground(ctx, canvas) {
    ctx.save();
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#1e3a8a');
    gradient.addColorStop(1, '#0f172a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'rgba(148, 163, 184, 0.2)';
    this.clouds.forEach((cloud) => {
      ctx.beginPath();
      ctx.ellipse(cloud.x, cloud.y, cloud.width, cloud.height, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  drawGround(ctx, canvas) {
    ctx.save();
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, canvas.height - GROUND_HEIGHT, canvas.width, GROUND_HEIGHT);

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, canvas.height - GROUND_HEIGHT);
    ctx.lineTo(canvas.width, canvas.height - GROUND_HEIGHT);
    ctx.stroke();
    ctx.restore();
  }

  drawPlayer(ctx) {
    ctx.save();
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(this.player.x, this.player.y - this.player.height, this.player.width, this.player.height);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(this.player.x + 10, this.player.y - this.player.height + 15, 6, 6);
    ctx.restore();
  }

  drawObstacles(ctx) {
    ctx.save();
    ctx.fillStyle = '#facc15';
    this.obstacles.forEach((obstacle) => {
      ctx.fillRect(obstacle.x, obstacle.y - obstacle.height, obstacle.width, obstacle.height);
    });
    ctx.restore();
  }

  drawScore(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(248, 250, 252, 0.85)';
    ctx.font = 'bold 24px "Segoe UI"';
    ctx.fillText(`Score: ${this.score}`, 20, 40);
    ctx.restore();
  }
}
