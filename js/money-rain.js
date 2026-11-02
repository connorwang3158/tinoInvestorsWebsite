// Rains $100 bills over the page once when the home page opens.
(() => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const bill = new Image();
  bill.src = "assets/bill.webp";
  bill.decode().then(rain).catch(() => {});

  function rain() {
    const canvas = document.createElement("canvas");
    canvas.className = "money-rain";
    canvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");

    let width = 0;
    let height = 0;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingQuality = "high";
    }
    resize();
    window.addEventListener("resize", resize);

    const random = (min, max) => min + Math.random() * (max - min);
    const aspect = bill.naturalHeight / bill.naturalWidth;
    const sizeScale = width < 640 ? 0.65 : 1;
    const speedScale = Math.max(0.8, height / 900);
    const count = Math.round(Math.min(80, Math.max(30, width / 16)));

    const bills = Array.from({ length: count }, () => {
      const w = random(80, 140) * sizeScale;
      return {
        w,
        h: w * aspect,
        x: random(0, width),
        y: -w,
        delay: random(0, 2.2), // seconds before this bill starts falling
        vy: random(480, 720) * speedScale,
        drift: random(-30, 30),
        swayAmp: random(12, 40),
        swaySpeed: random(1, 2.2),
        phase: random(0, Math.PI * 2),
        angle: random(0, Math.PI * 2),
        spin: random(-1.6, 1.6),
        flip: random(0, Math.PI * 2),
        flipSpeed: random(2.5, 6),
      };
    });

    let last = performance.now();
    let elapsed = 0;

    function frame(now) {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      elapsed += dt;
      ctx.clearRect(0, 0, width, height);
      let active = 0;

      for (const b of bills) {
        const t = elapsed - b.delay;
        if (t < 0) {
          active++;
          continue;
        }
        b.y += b.vy * dt;
        if (b.y - b.w > height) continue;
        active++;

        b.angle += b.spin * dt;
        b.flip += b.flipSpeed * dt;
        const x = b.x + b.drift * t + Math.sin(t * b.swaySpeed + b.phase) * b.swayAmp;

        // Flutter: squash the bill as it turns edge-on, then flip it over
        const tilt = Math.cos(b.flip);
        const squash = Math.abs(tilt) < 0.08 ? 0.08 * Math.sign(tilt || 1) : tilt;

        ctx.save();
        ctx.translate(x, b.y);
        ctx.rotate(b.angle);
        ctx.scale(1, squash);
        ctx.drawImage(bill, -b.w / 2, -b.h / 2, b.w, b.h);
        ctx.fillStyle = `rgba(0, 0, 0, ${(1 - Math.abs(tilt)) * 0.3})`;
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
        ctx.restore();
      }

      if (active > 0) {
        requestAnimationFrame(frame);
      } else {
        window.removeEventListener("resize", resize);
        canvas.remove();
      }
    }

    requestAnimationFrame(frame);
  }
})();
