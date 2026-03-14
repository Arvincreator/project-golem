"use client";

import { useEffect, useRef, CSSProperties } from "react";

interface PixelSpriteProps {
    /** Path to the spritesheet image */
    src: string;
    /** Width of a single frame in pixels */
    frameWidth: number;
    /** Height of a single frame in pixels */
    frameHeight: number;
    /** Total number of frames in the spritesheet */
    frameCount: number;
    /** Number of columns in the sprite grid */
    cols: number;
    /** Playback speed in frames per second (default: 12) */
    fps?: number;
    /** Scale factor (default: 1) */
    scale?: number;
    /** Whether the animation is playing (default: true) */
    isPlaying?: boolean;
    /** Whether to loop the animation (default: true) */
    loop?: boolean;
    /** Starting frame index (default: 0) */
    startFrame?: number;
    /** Additional CSS class names for the outer wrapper */
    className?: string;
    style?: CSSProperties;
}

/**
 * PixelSprite — CSS-driven sprite sheet animation component.
 *
 * Renders a single frame from a sprite grid and uses requestAnimationFrame
 * to advance frames at the target FPS. This avoids injecting global <style>
 * tags and works cleanly with React's rendering model.
 */
export function PixelSprite({
    src,
    frameWidth,
    frameHeight,
    frameCount,
    cols,
    fps = 12,
    scale = 1,
    isPlaying = true,
    loop = true,
    startFrame = 0,
    className,
    style,
}: PixelSpriteProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rafRef = useRef<number | null>(null);
    const imgRef = useRef<HTMLImageElement | null>(null);
    const frameRef = useRef(startFrame);
    const lastTimeRef = useRef(0);
    const isPlayingRef = useRef(isPlaying);
    const loopRef = useRef(loop);

    // Keep refs in sync with props without re-starting the animation loop
    isPlayingRef.current = isPlaying;
    loopRef.current = loop;

    const displayW = frameWidth * scale;
    const displayH = frameHeight * scale;

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Draw a specific frame from the spritesheet
        const drawFrame = (frame: number, img: HTMLImageElement) => {
            const col = frame % cols;
            const row = Math.floor(frame / cols);
            ctx.imageSmoothingEnabled = false;
            ctx.clearRect(0, 0, frameWidth, frameHeight);
            ctx.drawImage(
                img,
                col * frameWidth, // sx
                row * frameHeight, // sy
                frameWidth,        // sWidth
                frameHeight,       // sHeight
                0, 0,              // dx, dy
                frameWidth,        // dWidth
                frameHeight        // dHeight
            );
        };

        const img = new Image();
        imgRef.current = img;
        img.onload = () => {
            // Draw the first frame immediately
            drawFrame(frameRef.current, img);

            const interval = 1000 / fps;

            const tick = (timestamp: number) => {
                if (!isPlayingRef.current) {
                    rafRef.current = requestAnimationFrame(tick);
                    return;
                }
                if (timestamp - lastTimeRef.current >= interval) {
                    lastTimeRef.current = timestamp;
                    drawFrame(frameRef.current, img);
                    frameRef.current++;
                    if (frameRef.current >= frameCount) {
                        if (loopRef.current) {
                            frameRef.current = 0;
                        } else {
                            frameRef.current = frameCount - 1;
                            return; // Stop at last frame
                        }
                    }
                }
                rafRef.current = requestAnimationFrame(tick);
            };

            rafRef.current = requestAnimationFrame(tick);
        };
        img.src = src;

        return () => {
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        };
    // Restart animation when src or frame dimensions change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [src, frameWidth, frameHeight, frameCount, cols, fps]);

    // Reset to first frame when isPlaying transitions to true
    useEffect(() => {
        if (isPlaying) {
            frameRef.current = startFrame;
        }
    }, [isPlaying, startFrame]);

    return (
        <div
            className={className}
            style={{
                width: displayW,
                height: displayH,
                imageRendering: "pixelated",
                ...style,
            }}
        >
            <canvas
                ref={canvasRef}
                width={frameWidth}
                height={frameHeight}
                style={{
                    width: displayW,
                    height: displayH,
                    imageRendering: "pixelated",
                    display: "block",
                }}
            />
        </div>
    );
}
