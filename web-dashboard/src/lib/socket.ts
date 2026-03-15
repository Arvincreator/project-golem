"use client";

import { io } from "socket.io-client";

export const socket = io(process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3000", {
    transports: ["websocket", "polling"],
    autoConnect: true,
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionAttempts: 5,
});

// Connection error feedback
socket.on("connect_error", (err) => {
    console.warn("[Socket.io] Connection error:", err.message);
});

socket.on("reconnect_attempt", (attempt) => {
    console.log(`[Socket.io] Reconnection attempt #${attempt}`);
});

socket.on("reconnect_failed", () => {
    console.error("[Socket.io] All reconnection attempts failed. Falling back to polling.");
});
