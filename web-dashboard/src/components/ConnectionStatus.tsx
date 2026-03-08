"use client";

import { useEffect, useState } from "react";
import { getConnectionState, onConnectionChange, ConnectionState } from "@/lib/socket";

const STATE_CONFIG: Record<ConnectionState, { color: string; label: string; pulse: boolean }> = {
    connected:    { color: "bg-green-500",  label: "Connected",    pulse: false },
    disconnected: { color: "bg-red-500",    label: "Disconnected", pulse: false },
    reconnecting: { color: "bg-yellow-500", label: "Reconnecting", pulse: true  },
    error:        { color: "bg-red-600",    label: "Error",        pulse: true  },
};

export default function ConnectionStatus() {
    const [state, setState] = useState<ConnectionState>(getConnectionState());

    useEffect(() => {
        const unsubscribe = onConnectionChange(setState);
        return unsubscribe;
    }, []);

    const config = STATE_CONFIG[state];

    return (
        <div className="flex items-center gap-2 text-xs text-gray-400">
            <span
                className={`inline-block w-2 h-2 rounded-full ${config.color} ${
                    config.pulse ? "animate-pulse" : ""
                }`}
            />
            <span>{config.label}</span>
        </div>
    );
}
