import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

function Spinner({ className, size = 16 }: { className?: string; size?: number }) {
  return <Loader2 className={cn("animate-spin", className)} style={{ width: size, height: size }} />;
}

function PageLoader({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
      <Spinner size={24} />
      {label && <p className="text-sm">{label}</p>}
    </div>
  );
}

export { Spinner, PageLoader };