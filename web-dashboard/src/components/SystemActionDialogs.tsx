"use client";

import React from "react";
import { RefreshCcw, PowerOff, TriangleAlert, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";

// ── 通用確認彈窗元件 ────────────────────────────────────────────────────────
interface ConfirmDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    variant: "restart" | "shutdown" | "start";
    onConfirm: () => void;
    isLoading: boolean;
}

export function ConfirmDialog({ open, onOpenChange, variant, onConfirm, isLoading }: ConfirmDialogProps) {
    const config = variant === "restart"
        ? {
            icon: <RefreshCcw className="w-5 h-5 text-primary" />,
            iconBg: "bg-primary/10 border-primary/20",
            title: "重新啟動 Golem？",
            description: "這將終止目前進程並立即重啟。前端會短暫斷線（約 3-5 秒）後自動重新連線。",
            warning: "進行中的對話將被中斷。",
            confirmLabel: "確認重啟",
            loadingLabel: "正在重啟...",
            confirmClass: "bg-primary hover:bg-primary/90 text-primary-foreground",
        }
        : variant === "shutdown"
            ? {
                icon: <PowerOff className="w-5 h-5 text-destructive" />,
                iconBg: "bg-destructive/10 border-destructive/20",
                title: "關閉 Golem？",
                description: "這將完全終止後端進程。您隨時可以透過儀表板重新啟動。",
                warning: "所有運行中的任務將立即停止。",
                confirmLabel: "確認關閉",
                loadingLabel: "正在關閉...",
                confirmClass: "bg-destructive hover:bg-destructive/90 text-destructive-foreground",
            }
            : {
                icon: <Play className="w-5 h-5 text-primary" />,
                iconBg: "bg-primary/10 border-primary/20",
                title: "啟動 Golem？",
                description: "這將初始化 Golem 核心實體並開啟瀏覽器連線。",
                warning: "請確保您的資源配置正確。",
                confirmLabel: "確認啟動",
                loadingLabel: "正在啟動...",
                confirmClass: "bg-primary hover:bg-primary/90 text-primary-foreground",
            };

    return (
        <Dialog open={open} onOpenChange={isLoading ? undefined : onOpenChange}>
            <DialogContent
                showCloseButton={!isLoading}
                className="bg-card border-border text-foreground max-w-sm"
            >
                <DialogHeader>
                    {/* 圖示卡片 */}
                    <div className={`w-12 h-12 rounded-xl border flex items-center justify-center mb-2 ${config.iconBg}`}>
                        {config.icon}
                    </div>
                    <DialogTitle className="text-foreground text-base">
                        {config.title}
                    </DialogTitle>
                    <DialogDescription className="text-muted-foreground text-sm leading-relaxed">
                        {config.description}
                    </DialogDescription>
                </DialogHeader>

                {/* 警示欄 */}
                <div className="flex items-start gap-2 rounded-lg bg-muted/60 border border-border/50 px-3 py-2.5">
                    <TriangleAlert className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-muted-foreground">{config.warning}</p>
                </div>

                <DialogFooter className="gap-2 sm:gap-2">
                    <Button
                        variant="outline"
                        className="flex-1 bg-transparent border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                        onClick={() => onOpenChange(false)}
                        disabled={isLoading}
                    >
                        取消
                    </Button>
                    <Button
                        className={`flex-1 ${config.confirmClass}`}
                        onClick={onConfirm}
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <span className="flex items-center gap-1.5">
                                <RefreshCcw className="w-3.5 h-3.5 animate-spin" />
                                {config.loadingLabel}
                            </span>
                        ) : config.confirmLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── 完成通知彈窗 ───────────────────────────────────────────────────────────
interface DoneDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    variant: "restarted" | "shutdown" | "started";
}

export function DoneDialog({ open, onOpenChange, variant }: DoneDialogProps) {
    const isSuccess = variant === "restarted" || variant === "started";
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="bg-card border-border text-foreground max-w-sm" showCloseButton={false}>
                <DialogHeader>
                    <div className={`w-12 h-12 rounded-xl border flex items-center justify-center mb-2 ${isSuccess ? "bg-green-500/10 border-green-500/20" : "bg-muted border-border"}`}>
                        {variant === "restarted" && <RefreshCcw className="w-5 h-5 text-green-400 animate-spin" />}
                        {variant === "started" && <Play className="w-5 h-5 text-green-400" />}
                        {variant === "shutdown" && <PowerOff className="w-5 h-5 text-gray-400" />}
                    </div>
                    <DialogTitle className="text-foreground text-base">
                        {variant === "restarted" ? "正在重新啟動..." : variant === "started" ? "Golem 已啟動" : "Golem 已停止"}
                    </DialogTitle>
                    <DialogDescription className="text-muted-foreground text-sm">
                        {variant === "restarted" && "系統正在重啟中，頁面將在 3 秒後自動重新整理。"}
                        {variant === "started" && "核心實體已成功啟動，您可以開始使用儀表板功能。"}
                        {variant === "shutdown" && "核心實體已停止運作。您可以隨時透過儀表板重新啟動服務。"}
                    </DialogDescription>
                </DialogHeader>
                {variant !== "restarted" && (
                    <DialogFooter>
                        <Button
                            variant="secondary"
                            className="w-full border-border"
                            onClick={() => onOpenChange(false)}
                        >
                            關閉
                        </Button>
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    );
}

export function SystemActionDialogs({
    confirmDialogOpen,
    setConfirmDialogOpen,
    confirmVariant,
    handleConfirm,
    isLoading,
    doneDialogOpen,
    setDoneDialogOpen,
    doneVariant
}: {
    confirmDialogOpen: boolean;
    setConfirmDialogOpen: (open: boolean) => void;
    confirmVariant: "restart" | "shutdown" | "start";
    handleConfirm: () => void;
    isLoading: boolean;
    doneDialogOpen: boolean;
    setDoneDialogOpen: (open: boolean) => void;
    doneVariant: "restarted" | "shutdown" | "started";
}) {
    return (
        <>
            <ConfirmDialog
                open={confirmDialogOpen}
                onOpenChange={(open) => !isLoading && setConfirmDialogOpen(open)}
                variant={confirmVariant}
                onConfirm={handleConfirm}
                isLoading={isLoading}
            />
            <DoneDialog
                open={doneDialogOpen}
                onOpenChange={setDoneDialogOpen}
                variant={doneVariant}
            />
        </>
    );
}
