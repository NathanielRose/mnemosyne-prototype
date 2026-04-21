"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface BentoItem {
  title: string;
  description: string;
  icon: ReactNode;
  status?: string;
  tags?: string[];
  meta?: string;
  cta?: string;
  colSpan?: number;
  hasPersistentHover?: boolean;
  onClick?: () => void;
  className?: string;
}

interface BentoGridProps {
  items: BentoItem[];
  className?: string;
}

function BentoGrid({ items, className }: BentoGridProps) {
  return (
    <div className={cn("grid grid-cols-1 md:grid-cols-3 gap-3 p-4 max-w-7xl mx-auto", className)}>
      {items.map((item, index) => (
        <div
          key={index}
          onClick={item.onClick}
          role={item.onClick ? "button" : undefined}
          tabIndex={item.onClick ? 0 : undefined}
          onKeyDown={
            item.onClick
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    item.onClick?.();
                  }
                }
              : undefined
          }
          className={cn(
            "group relative overflow-hidden rounded-[22px] p-5 transition-all duration-300",
            "border border-white/10 bg-[#050505] text-white",
            "shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_8px_30px_rgba(0,0,0,0.45)]",
            "hover:-translate-y-0.5 hover:border-white/15 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_14px_36px_rgba(0,0,0,0.55)]",
            item.onClick ? "cursor-pointer" : "",
            item.colSpan === 2 ? "md:col-span-2" : "col-span-1",
            item.className,
            {
              "-translate-y-0.5 border-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_14px_36px_rgba(0,0,0,0.55)]":
                item.hasPersistentHover,
            }
          )}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_45%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_35%)]" />
          <div
            className={cn(
              "absolute inset-0 transition-opacity duration-300",
              item.hasPersistentHover ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            )}
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[length:4px_4px]" />
            <div className="absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-white/[0.04] to-transparent blur-xl" />
          </div>

          <div className="relative flex flex-col space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-all duration-300 group-hover:bg-white/[0.07]">
                {item.icon}
              </div>
              <span
                className={cn(
                  "rounded-xl border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-white/80 backdrop-blur-sm",
                  "transition-colors duration-300 group-hover:bg-white/[0.1]"
                )}
              >
                {item.status || "Active"}
              </span>
            </div>

            <div className="space-y-2">
              <h3 className="text-[22px] font-semibold tracking-tight text-white">
                {item.title}
                {item.meta ? (
                  <span className="ml-2 text-xs font-normal text-white/45">
                    {item.meta}
                  </span>
                ) : null}
              </h3>
              <p className="max-w-[48ch] text-sm leading-snug text-white/70">
                {item.description}
              </p>
            </div>

            <div className="flex items-center justify-between mt-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-white/55">
                {item.tags?.map((tag, i) => (
                  <span
                    key={i}
                    className="rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1 backdrop-blur-sm transition-all duration-200 hover:bg-white/[0.1]"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
              <span className="text-xs text-white/45 opacity-0 transition-opacity group-hover:opacity-100">
                {item.cta || "Explore ->"}
              </span>
            </div>
          </div>

          <div
            className={cn(
              "absolute inset-0 -z-10 rounded-[22px] bg-gradient-to-br from-transparent via-white/[0.06] to-transparent transition-opacity duration-300",
              item.hasPersistentHover ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            )}
          />
        </div>
      ))}
    </div>
  );
}

export { BentoGrid };
