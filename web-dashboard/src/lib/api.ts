const isProd = process.env.NODE_ENV === "production";

const API_BASE =
    process.env.NEXT_PUBLIC_API_URL ||
    (typeof window !== "undefined"
        ? isProd ? "" : `${window.location.protocol}//${window.location.hostname}:3001`
        : isProd ? "http://localhost:3000" : "http://localhost:3001");


export function apiUrl(path: string): string {
    return `${API_BASE}${path}`;
}
