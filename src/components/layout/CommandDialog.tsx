import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Command } from "cmdk";
import { Search, FileText, Users, Inbox } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useSearchStore } from "@/stores/search";

export function CommandDialog() {
  const { open, query, results, loading, setOpen, setQuery, close } = useSearchStore();
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, setOpen]);

  if (!open) return null;

  const go = (href: string) => {
    close();
    navigate(href);
  };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" onClick={close}>
      <div className="fixed inset-0 bg-black/60 animate-in fade-in-0" />
      <div className="fixed left-1/2 top-[15%] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border bg-popover shadow-2xl animate-in fade-in-0 zoom-in-95">
        <Command className="p-0">
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Command.Input
              autoFocus
              value={query}
              onValueChange={(v) => setQuery(v)}
              placeholder="Search challans, customers…"
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">ESC</kbd>
          </div>

          <Command.List className="max-h-80 overflow-y-auto p-1">
            {loading ? (
              <div className="space-y-2 p-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : query.trim().length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                Type to search challans and customers across the workspace.
              </div>
            ) : (
              <>
                {results.challans.total > 0 && (
                  <Command.Group heading="Challans" className="text-[11px] font-medium uppercase text-muted-foreground">
                    {results.challans.items.map((item) => (
                      <Command.Item
                        key={item.id}
                        value={`challan-${item.id}`}
                        onSelect={() => go(item.href)}
                        className="flex cursor-default items-center gap-2 rounded-md px-3 py-2 text-sm aria-selected:bg-accent"
                      >
                        <Inbox className="h-4 w-4 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{item.title}</p>
                          {item.subtitle && <p className="truncate text-xs text-muted-foreground">{item.subtitle}</p>}
                        </div>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
                {results.customers.total > 0 && (
                  <Command.Group heading="Customers" className="text-[11px] font-medium uppercase text-muted-foreground">
                    {results.customers.items.map((item) => (
                      <Command.Item
                        key={item.id}
                        value={`customer-${item.id}`}
                        onSelect={() => go(item.href)}
                        className="flex cursor-default items-center gap-2 rounded-md px-3 py-2 text-sm aria-selected:bg-accent"
                      >
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{item.title}</p>
                          {item.subtitle && <p className="truncate text-xs text-muted-foreground">{item.subtitle}</p>}
                        </div>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
                {results.challans.total === 0 && results.customers.total === 0 && (
                  <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                    <FileText className="mx-auto mb-2 h-8 w-8 opacity-40" />
                    No matches for “{query}”.
                  </div>
                )}
              </>
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}