"use client";

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, AlertCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning" | "info";
  isLoading?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = "確定",
  cancelText = "取消",
  variant = "warning",
  isLoading = false,
}) => {
  const Icon = variant === "danger" ? AlertCircle : AlertTriangle;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[425px] bg-card/95 backdrop-blur-md border-primary/20 shadow-2xl animate-in fade-in zoom-in-95 duration-300">
        <DialogHeader className="flex flex-col items-center gap-4 py-4">
          <div className={cn(
            "p-3 rounded-full mb-2",
            variant === "danger" ? "bg-red-500/20 text-red-500" : 
            variant === "warning" ? "bg-amber-500/20 text-amber-500" : 
            "bg-primary/20 text-primary"
          )}>
            {variant === "info" ? (
              <RefreshCw className="w-8 h-8 animate-spin-slow" />
            ) : (
              <Icon className="w-8 h-8" />
            )}
          </div>
          <DialogTitle className="text-xl font-bold text-center tracking-tight">
            {title}
          </DialogTitle>
          <DialogDescription className="text-center text-muted-foreground text-sm leading-relaxed px-4">
            {description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex flex-row justify-center gap-3 pt-4 border-t border-border/50">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isLoading}
            className="flex-1 hover:bg-secondary transition-colors"
          >
            {cancelText}
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={cn(
              "flex-1 font-semibold shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2",
              variant === "danger" ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground" :
              "bg-primary hover:bg-primary/90 text-primary-foreground"
            )}
          >
            {isLoading && <RefreshCw className="w-4 h-4 animate-spin" />}
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
