// Default to localhost:3001 (backend port) – always connects directly to backend.
// In production, override via NEXT_PUBLIC_API_URL env var if needed.
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export function apiUrl(path: string): string {
    return `${API_BASE}${path}`;
}
