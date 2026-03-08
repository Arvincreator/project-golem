"use client";

import { io, Socket } from "socket.io-client";

// Auto-detect server URL:
// - Use NEXT_PUBLIC_SOCKET_URL env var if set
// - Otherwise use undefined (socket.io defaults to window.location.origin)
// This fixes remote dashboard access (non-localhost deployments)
const serverUrl = process.env.NEXT_PUBLIC_SOCKET_URL || undefined;

export const socket: Socket = io(serverUrl, {
    transports: ["websocket", "polling"], // fallback to polling if websocket fails
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,        // start at 1s
    reconnectionDelayMax: 30000,    // max 30s between retries
    timeout: 10000,                 // connection timeout 10s
});

// Connection state for UI components
export type ConnectionState = "connected" | "disconnected" | "reconnecting" | "error";

let _connectionState: ConnectionState = "disconnected";
const _listeners: Set<(state: ConnectionState) => void> = new Set();

function setState(state: ConnectionState) {
    _connectionState = state;
    _listeners.forEach(fn => fn(state));
}

export function getConnectionState(): ConnectionState {
    return _connectionState;
}

export function onConnectionChange(fn: (state: ConnectionState) => void): () => void {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
}

// Socket event handlers
socket.on("connect", () => {
    setState("connected");
    console.log("[Socket] Connected to Golem server");
});

socket.on("disconnect", (reason) => {
    setState("disconnected");
    console.log(`[Socket] Disconnected: ${reason}`);
});

socket.on("reconnect_attempt", (attempt) => {
    setState("reconnecting");
    console.log(`[Socket] Reconnecting... attempt ${attempt}`);
});

socket.on("reconnect", (attempt) => {
    setState("connected");
    console.log(`[Socket] Reconnected after ${attempt} attempts`);
    // Re-request logs after reconnection
    socket.emit("request_logs");
});

socket.on("connect_error", (error) => {
    setState("error");
    console.warn(`[Socket] Connection error: ${error.message}`);
});
