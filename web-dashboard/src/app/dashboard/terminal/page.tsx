"use client";

import UnifiedConsole from "../components/UnifiedConsole";

export default function TerminalPage() {
    // Backward-compatible route: keep /dashboard/terminal but default to deep logs view.
    return <UnifiedConsole defaultTab="LOGS" showUpdateMarquee />;
}

