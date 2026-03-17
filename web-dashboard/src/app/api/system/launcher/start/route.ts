import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

export async function POST() {
  console.log("🚀 [Launcher] Received remote start request...");

  const cwd = process.cwd();
  console.log(`📂 [Launcher] Current Working Directory: ${cwd}`);

  // 移除路徑末尾的斜槓並檢查是否以 web-dashboard 結尾
  const normalizedCwd = cwd.replace(/[/\\]$/, "");
  const rootDir = normalizedCwd.endsWith("web-dashboard") ? path.resolve(normalizedCwd, "..") : normalizedCwd;
  
  // Verify if we are in the right place by checking for package.json
  const fs = require("fs");
  const hasPackageJson = fs.existsSync(path.join(rootDir, "package.json"));
  console.log(`🔍 [Launcher] Target Root: ${rootDir} (package.json: ${hasPackageJson})`);

  if (!hasPackageJson) {
    console.error("❌ [Launcher] Could not find project root containing package.json");
    return NextResponse.json({ success: false, error: "Project root not found" }, { status: 500 });
  }

  // Check Port 3001
  try {
    const checkRes = await fetch("http://127.0.0.1:3001/api/system/status", { signal: AbortSignal.timeout(500) }).catch(() => null);
    if (checkRes && checkRes.ok) {
      console.log("⚠️ [Launcher] Backend is already running on Port 3001.");
      return NextResponse.json({ success: true, message: "Backend is already active" });
    }
  } catch (e) {}

  console.log(`📡 [Launcher] Spawning Golem process...`);

  const child = spawn("npm", ["run", "dashboard"], {
    cwd: rootDir,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, DASHBOARD_DEV_MODE: "true" }
  });

  child.on('error', (err) => {
    console.error("🔥 [Launcher] Spawn error:", err);
  });

  child.unref();

  return NextResponse.json({ 
    success: true, 
    message: "Golem startup sequence initiated." 
  });
}
