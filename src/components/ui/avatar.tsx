import * as React from "react";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/user";

function colorFromString(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const palette = ["#33418f", "#0e8fb8", "#1f8a5f", "#b8750a", "#8e3bb3", "#c23b4b", "#3a6ea5", "#7a5c40"];
  return palette[hash % palette.length];
}

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  name: string;
  className?: string;
}

function Avatar({ name, className, ...props }: AvatarProps) {
  return (
    <div
      className={cn(
        "flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full text-xs font-semibold text-white",
        className
      )}
      style={{ backgroundColor: colorFromString(name) }}
      {...props}
    >
      {getInitials(name)}
    </div>
  );
}

export { Avatar };