/**
 * Icon generation script.
 * Run once in a browser console or import in a setup page to download PNG icons.
 * Draws the QuickStock brand icon (yellow background + bold Q) at required PWA sizes.
 */

function drawIcon(size, maskable = false) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  // Background: full bleed yellow
  ctx.fillStyle = "#FACC15";
  if (maskable) {
    // Maskable: full square (OS clips to circle/squircle)
    ctx.fillRect(0, 0, size, size);
  } else {
    // Standard: rounded square
    const r = size * 0.22;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(size - r, 0);
    ctx.quadraticCurveTo(size, 0, size, r);
    ctx.lineTo(size, size - r);
    ctx.quadraticCurveTo(size, size, size - r, size);
    ctx.lineTo(r, size);
    ctx.quadraticCurveTo(0, size, 0, size - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
    ctx.fill();
  }

  // Q letter
  const fontSize = maskable ? size * 0.42 : size * 0.52;
  ctx.fillStyle = "#141414";
  ctx.font = `900 ${fontSize}px "Arial Black", Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Q", size / 2, size / 2 + fontSize * 0.05);

  return canvas;
}

export function downloadIcons() {
  const configs = [
    { size: 192, maskable: false, name: "icon-192.png" },
    { size: 512, maskable: false, name: "icon-512.png" },
    { size: 512, maskable: true,  name: "icon-maskable-512.png" },
  ];

  configs.forEach(({ size, maskable, name }) => {
    const canvas = drawIcon(size, maskable);
    const a = document.createElement("a");
    a.download = name;
    a.href = canvas.toDataURL("image/png");
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });
}