import type { NextConfig } from "next";
import fs from "fs";
import path from "path";

// 讀取根目錄的 package.json 以獲取版本號
const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8"));
const version = packageJson.version || "9.1.5";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_GOLEM_VERSION: version,
  },
  output: process.env.NODE_ENV === "production" ? "export" : undefined,
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      {
        // 排除 launcher 路由，讓 Next.js 本身處理啟動邏輯
        source: "/api/:path((?!system/launcher).*)",
        destination: "http://127.0.0.1:3001/api/:path*",
      },
      {
        source: "/socket.io/:path*",
        destination: "http://127.0.0.1:3001/socket.io/:path*",
      },
    ];
  },
};

export default nextConfig;
