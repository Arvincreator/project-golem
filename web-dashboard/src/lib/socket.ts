import { io } from "socket.io-client";

// Default to localhost:3001 (backend port) – always connects directly to backend.
// In production, override via NEXT_PUBLIC_SOCKET_URL env var if needed.
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "";

export const socket = io(SOCKET_URL, {
    autoConnect: true,
});
