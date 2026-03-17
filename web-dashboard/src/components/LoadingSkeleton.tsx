"use client";

/**
 * Skeleton loading states for dashboard components.
 * Shows animated placeholder blocks while data loads.
 */

interface SkeletonProps {
    className?: string;
    style?: React.CSSProperties;
}

export function Skeleton({ className = "", style }: SkeletonProps) {
    return (
        <div
            className={`animate-pulse rounded-md bg-muted ${className}`}
            style={style}
            role="status"
            aria-label="Loading..."
        />
    );
}

export function CardSkeleton() {
    return (
        <div className="rounded-lg border border-border bg-card p-6 space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-3 w-16" />
        </div>
    );
}

export function ChartSkeleton() {
    return (
        <div className="rounded-lg border border-border bg-card p-6 space-y-4">
            <Skeleton className="h-5 w-40" />
            <div className="flex items-end gap-2 h-40">
                {[60, 80, 45, 90, 70, 55, 85].map((h, i) => (
                    <Skeleton
                        key={i}
                        className="flex-1"
                        style={{ height: `${h}%` } as React.CSSProperties}
                    />
                ))}
            </div>
        </div>
    );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
    return (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
            {/* Header */}
            <div className="flex gap-4 p-4 border-b border-border">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-28" />
            </div>
            {/* Rows */}
            {Array.from({ length: rows }).map((_, i) => (
                <div key={i} className="flex gap-4 p-4 border-b border-border last:border-0">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-28" />
                </div>
            ))}
        </div>
    );
}

export function LogSkeleton({ lines = 8 }: { lines?: number }) {
    return (
        <div className="rounded-lg border border-border bg-card p-4 space-y-2 font-mono">
            {Array.from({ length: lines }).map((_, i) => (
                <Skeleton
                    key={i}
                    className="h-4"
                    style={{ width: `${50 + Math.random() * 50}%` } as React.CSSProperties}
                />
            ))}
        </div>
    );
}
