// ---- Neural canvas background ----
(function initCanvas() {
  const canvas = document.getElementById('neural-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let nodes = [];
  function resize() { 
    canvas.width = window.innerWidth; 
    canvas.height = window.innerHeight; 
  }
  resize();
  window.addEventListener('resize', resize);
  for (let i = 0; i < 60; i++) {
    nodes.push({ x: Math.random() * window.innerWidth, y: Math.random() * window.innerHeight, vx: (Math.random()-0.5)*0.4, vy: (Math.random()-0.5)*0.4, r: Math.random()*2+1 });
  }
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Connections
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i+1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < 150) {
          ctx.strokeStyle = `rgba(139,92,246,${(1-dist/150)*0.3})`;
          ctx.lineWidth = 0.5;
          ctx.beginPath(); ctx.moveTo(nodes[i].x, nodes[i].y); ctx.lineTo(nodes[j].x, nodes[j].y); ctx.stroke();
        }
      }
    }
    // Nodes
    nodes.forEach(n => {
      ctx.fillStyle = 'rgba(6,182,212,0.5)';
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI*2); ctx.fill();
      n.x += n.vx; n.y += n.vy;
      if (n.x < 0 || n.x > canvas.width) n.vx *= -1;
      if (n.y < 0 || n.y > canvas.height) n.vy *= -1;
    });
    requestAnimationFrame(draw);
  }
  draw();
})();

// ---- Neural head right-panel canvas ----
(function initNeuralHead() {
  const canvas = document.getElementById('neural-head-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let t = 0;
  function resize() { 
    if (!canvas.offsetWidth) return;
    canvas.width = canvas.offsetWidth; 
    canvas.height = canvas.offsetHeight; 
  }
  resize();
  window.addEventListener('resize', resize);
  const particles = Array.from({length:80}, () => ({
    theta: Math.random()*Math.PI*2, phi: Math.random()*Math.PI,
    r: 120 + Math.random()*40,
    speed: 0.002 + Math.random()*0.003
  }));
  function draw() {
    if (!canvas.width) {
        resize();
    }
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const cx = canvas.width/2, cy = canvas.height/2;
    // Outer glow ring
    const grad = ctx.createRadialGradient(cx, cy, 60, cx, cy, 180);
    grad.addColorStop(0, 'rgba(139,92,246,0.08)');
    grad.addColorStop(1, 'rgba(139,92,246,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx, cy, 180, 0, Math.PI*2); ctx.fill();
    // Rotating particles
    particles.forEach(p => {
      p.theta += p.speed;
      const x = cx + p.r * Math.sin(p.phi) * Math.cos(p.theta);
      const y = cy + p.r * Math.sin(p.phi) * Math.sin(p.theta) * 0.5;
      const bright = 0.3 + 0.7 * Math.sin(p.theta * 2);
      ctx.fillStyle = `rgba(6,182,212,${bright * 0.7})`;
      ctx.beginPath(); ctx.arc(x, y, 1.5, 0, Math.PI*2); ctx.fill();
    });
    // Central brain icon glow
    ctx.shadowBlur = 40; ctx.shadowColor = '#06b6d4';
    ctx.strokeStyle = 'rgba(6,182,212,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, 60 + Math.sin(t)*5, 0, Math.PI*2); ctx.stroke();
    ctx.shadowBlur = 0;
    // Pulsing core
    const alpha = 0.3 + 0.3*Math.sin(t*2);
    const coreGrad = ctx.createRadialGradient(cx,cy,0,cx,cy,50);
    coreGrad.addColorStop(0, `rgba(6,182,212,${alpha})`);
    coreGrad.addColorStop(1, 'rgba(6,182,212,0)');
    ctx.fillStyle = coreGrad;
    ctx.beginPath(); ctx.arc(cx, cy, 50, 0, Math.PI*2); ctx.fill();
    // Label
    ctx.fillStyle = 'rgba(6,182,212,0.8)';
    ctx.font = "bold 13px 'Space Grotesk', sans-serif";
    ctx.textAlign = 'center';
    ctx.fillText('NEURAL ANALYSIS', cx, cy + 110);
    ctx.font = "10px 'Inter', sans-serif";
    ctx.fillStyle = 'rgba(148,163,184,0.7)';
    ctx.fillText('Multi-Modal Assessment Engine', cx, cy + 130);
    t += 0.02;
    requestAnimationFrame(draw);
  }
  draw();
})();
