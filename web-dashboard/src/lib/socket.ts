import { io } from "socket.io-client";

const isProd = process.env.NODE_ENV === "production";

const SOCKET_URL =
    process.env.NEXT_PUBLIC_SOCKET_URL ||
    (typeof window !== "undefined"
        ? isProd ? "" : `${window.location.protocol}//${window.location.hostname}:3001`
        : isProd ? "http://localhost:3000" : "http://localhost:3001");

export const socket = io(SOCKET_URL || undefined, {
    autoConnect: true,
});
