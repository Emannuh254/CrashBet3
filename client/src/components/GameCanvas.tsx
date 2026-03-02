import React, { useEffect, useRef, useState } from "react";
import { type GameState } from "@/hooks/use-game";

interface GameCanvasProps {
  gameState: GameState;
}

export function GameCanvas({ gameState }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 400 });
  const animationRef = useRef<number>();
  const lastTimeRef = useRef<number>(Date.now());
  const visualMultiplierRef = useRef<number>(1.00);

  // Handle Resize
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight
        });
      }
    };
    window.addEventListener('resize', updateSize);
    updateSize();
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Main Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = dimensions;
    
    // Scale for high DPI displays
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const render = () => {
      const now = Date.now();
      const dt = now - lastTimeRef.current;
      lastTimeRef.current = now;

      // Clear Canvas
      ctx.clearRect(0, 0, width, height);

      // Draw Grid
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      const gridSize = 50;
      
      // Moving grid effect
      const offsetX = gameState.status === 'active' ? -(now % 1000) / 1000 * gridSize : 0;
      
      ctx.beginPath();
      for (let x = offsetX; x < width; x += gridSize) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let y = height; y > 0; y -= gridSize) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();

      if (gameState.status === 'betting') {
        // Reset visuals
        visualMultiplierRef.current = 1.00;
        
        // Draw loading/waiting state
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.font = '24px "Space Grotesk"';
        ctx.textAlign = 'center';
        ctx.fillText('WAITING FOR NEXT ROUND', width / 2, height / 2 + 100);
        
        // Draw idle plane at bottom left
        drawPlane(ctx, 40, height - 40, 0, '#ffffff');

      } else if (gameState.status === 'active' || gameState.status === 'crashed') {
        // Interpolate multiplier for smooth visuals if active, otherwise lock to crash point
        if (gameState.status === 'active') {
          // Soft catch-up to server multiplier
          const target = Math.max(1, gameState.multiplier);
          visualMultiplierRef.current += (target - visualMultiplierRef.current) * 0.1;
        } else {
          visualMultiplierRef.current = gameState.crashPoint || gameState.multiplier;
        }

        const m = visualMultiplierRef.current;
        
        // Calculate curve path
        // We want the plane to move right and up, but eventually stay relatively centered while grid moves
        // For simplicity: Map multiplier 1.0 to 10.0 across the screen, dynamically scale
        
        const scaleMax = Math.max(2.0, m * 1.2); // Always have some headroom
        
        // Map 1.0 -> scaleMax to 0 -> width/height
        const getX = (val: number) => {
          const progress = Math.min(1, (val - 1) / (scaleMax - 1));
          // Start moving right, cap at 70% of screen width
          return 40 + (progress * (width * 0.7)); 
        };
        
        const getY = (val: number) => {
          const progress = Math.min(1, (val - 1) / (scaleMax - 1));
          // Start at bottom, cap at 20% from top
          return height - 40 - (progress * (height * 0.6));
        };

        const currentX = getX(m);
        const currentY = getY(m);

        // Draw Trail (Curve)
        ctx.beginPath();
        ctx.moveTo(40, height - 40);
        
        // Bezier curve for smoothness
        const cp1x = currentX * 0.5;
        const cp1y = height - 40;
        ctx.quadraticCurveTo(cp1x, cp1y, currentX, currentY);
        
        ctx.strokeStyle = gameState.status === 'crashed' ? '#ff2a5f' : 'rgba(255, 42, 95, 0.8)';
        ctx.lineWidth = 4;
        ctx.stroke();

        // Fill under curve
        ctx.lineTo(currentX, height);
        ctx.lineTo(40, height);
        ctx.fillStyle = gameState.status === 'crashed' 
          ? 'rgba(255, 42, 95, 0.1)' 
          : 'rgba(255, 42, 95, 0.2)';
        ctx.fill();

        // Calculate angle for plane
        const angle = Math.atan2(currentY - cp1y, currentX - cp1x);

        // Draw Plane
        const planeColor = gameState.status === 'crashed' ? '#666666' : '#ff2a5f';
        drawPlane(ctx, currentX, currentY, angle, planeColor);
      }

      animationRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [dimensions, gameState]);

  // Helper to draw a stylized plane/arrow
  const drawPlane = (ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, color: string) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    
    // Simple sleek dart/plane shape
    ctx.beginPath();
    ctx.moveTo(20, 0); // nose
    ctx.lineTo(-15, 10); // bottom wing
    ctx.lineTo(-10, 0); // tail center
    ctx.lineTo(-15, -10); // top wing
    ctx.closePath();
    
    ctx.fillStyle = color;
    ctx.fill();
    
    // Engine glow if active
    if (color === '#ff2a5f') {
      ctx.shadowBlur = 15;
      ctx.shadowColor = color;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(-12, 0, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.restore();
  };

  return (
    <div 
      ref={containerRef} 
      className={`relative w-full h-[350px] md:h-[500px] bg-card rounded-2xl overflow-hidden border border-border shadow-2xl ${gameState.status === 'crashed' ? 'animate-shake border-destructive/50' : ''}`}
    >
      <canvas 
        ref={canvasRef} 
        style={{ width: '100%', height: '100%' }}
        className="absolute inset-0 z-0"
      />
      
      {/* Central Multiplier Display */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10">
        {gameState.status === 'betting' && (
          <div className="text-4xl md:text-6xl font-black text-white text-glow mb-4">
            PREPARING
          </div>
        )}
        
        {(gameState.status === 'active' || gameState.status === 'crashed') && (
          <div className="flex flex-col items-center">
             <div className={`text-6xl md:text-9xl font-black font-mono tracking-tighter ${
                gameState.status === 'crashed' 
                  ? 'text-destructive text-glow opacity-80' 
                  : 'text-primary text-glow'
              }`}>
                {gameState.multiplier.toFixed(2)}x
             </div>
             {gameState.status === 'crashed' && (
               <div className="text-2xl md:text-4xl font-bold text-destructive mt-4 tracking-widest uppercase">
                 CRASHED
               </div>
             )}
          </div>
        )}
      </div>
    </div>
  );
}
