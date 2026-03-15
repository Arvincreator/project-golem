"use client";

import { useEffect, useState } from "react";
import { AgentChat } from "@/components/AgentChat";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface AgentInfo {
    id: string;
    status: string;
    brainEngine?: string;
    memory?: string;
    pending?: number;
}

const STATUS_COLORS: Record<string, string> = {
    active: 'bg-green-500',
    idle: 'bg-blue-500',
    error: 'bg-red-500',
    offline: 'bg-gray-500',
};

export default function AgentsPage() {
    const [agents, setAgents] = useState<AgentInfo[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/agents')
            .then(r => r.json())
            .then(data => {
                if (Array.isArray(data)) setAgents(data);
                else if (data.agents) setAgents(data.agents);
            })
            .catch(() => {
                // Fallback to hardcoded defaults if API unavailable
                setAgents([
                    { id: 'golem_A', status: 'active', brainEngine: 'RouterBrain', pending: 0 },
                ]);
            })
            .finally(() => setLoading(false));
    }, []);

    return (
        <div className="p-6 h-full flex flex-col space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold text-white tracking-tight">Agent War Room</h1>
                <div className="flex space-x-2">
                    <span className="px-3 py-1 bg-green-900/30 text-green-400 text-xs rounded-full border border-green-800 flex items-center">
                        <span className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></span>
                        Live Session
                    </span>
                    <span className="px-3 py-1 bg-gray-900/30 text-gray-400 text-xs rounded-full border border-gray-800">
                        {agents.length} agent{agents.length !== 1 ? 's' : ''}
                    </span>
                </div>
            </div>

            <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-6 min-h-0">
                <div className="lg:col-span-3 flex flex-col min-h-0">
                    <AgentChat />
                </div>

                <div className="space-y-4">
                    <Card className="bg-gray-900 border-gray-800 text-white shadow-md">
                        <CardHeader>
                            <CardTitle className="text-sm">Active Agents</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            {loading ? (
                                <div className="text-xs text-gray-500 animate-pulse">Loading agents...</div>
                            ) : agents.length === 0 ? (
                                <div className="text-xs text-gray-500">No agents detected</div>
                            ) : (
                                agents.map(agent => (
                                    <div key={agent.id} className="flex items-center justify-between p-2 bg-gray-900/50 rounded hover:bg-gray-900 transition-colors cursor-pointer">
                                        <div className="flex items-center space-x-2">
                                            <div className={`w-2 h-2 ${STATUS_COLORS[agent.status] || 'bg-gray-500'} rounded-full`}></div>
                                            <span className="text-sm text-gray-300">{agent.id}</span>
                                        </div>
                                        {agent.pending !== undefined && agent.pending > 0 && (
                                            <span className="text-[10px] bg-amber-900/30 text-amber-400 px-1.5 py-0.5 rounded">
                                                {agent.pending}
                                            </span>
                                        )}
                                    </div>
                                ))
                            )}
                        </CardContent>
                    </Card>

                    <Card className="bg-gray-900 border-gray-800 text-white shadow-md">
                        <CardHeader>
                            <CardTitle className="text-sm">Session Stats</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-xs text-gray-400 space-y-1">
                                {agents.length > 0 && agents[0].brainEngine && (
                                    <div className="flex justify-between">
                                        <span>Engine:</span>
                                        <span className="text-white font-mono text-[10px]">{agents[0].brainEngine}</span>
                                    </div>
                                )}
                                <div className="flex justify-between">
                                    <span>Agents:</span>
                                    <span className="text-white">{agents.length}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Status:</span>
                                    <span className="text-green-400">
                                        {agents.filter(a => a.status === 'active').length} active
                                    </span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
