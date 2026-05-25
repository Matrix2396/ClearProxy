import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Star,
  History,
  Bookmark as BookmarkIcon,
  X,
  Search,
  PanelRight,
  ShieldAlert,
  Shield,
  Globe,
} from "lucide-react";
import {
  useListHistory,
  useClearHistory,
  useListBookmarks,
  useCreateBookmark,
  useDeleteBookmark,
  getListHistoryQueryKey,
  getListBookmarksQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";

function ensureProtocol(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function proxyHref(original: string) {
  return `/api/proxy?url=${encodeURIComponent(original)}`;
}

const QUICK_LINKS = [
  { label: "Wikipedia", url: "https://wikipedia.org" },
  { label: "Reddit", url: "https://reddit.com" },
  { label: "GitHub", url: "https://github.com" },
  { label: "HN", url: "https://news.ycombinator.com" },
  { label: "Chess.com", url: "https://chess.com" },
];

export default function Home() {
  const [urlInput, setUrlInput] = useState("");
  const [iframeSrc, setIframeSrc] = useState("");
  const [displayUrl, setDisplayUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);

  const navStack = useRef<string[]>([]);
  const navPos = useRef(-1);
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);

  const lastHistoryUrl = useRef("");
  const lastHistoryTime = useRef(0);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: history = [] } = useListHistory();
  const { data: bookmarks = [] } = useListBookmarks();
  const clearHistory = useClearHistory();
  const createBookmark = useCreateBookmark();
  const deleteBookmark = useDeleteBookmark();

  const syncNavButtons = useCallback(() => {
    setCanBack(navPos.current > 0);
    setCanForward(navPos.current < navStack.current.length - 1);
  }, []);

  const recordHistory = useCallback(
    (url: string, title?: string) => {
      const now = Date.now();
      if (url === lastHistoryUrl.current && now - lastHistoryTime.current < 3000) return;
      lastHistoryUrl.current = url;
      lastHistoryTime.current = now;
      fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, title: title || null }),
      })
        .then(() => queryClient.invalidateQueries({ queryKey: getListHistoryQueryKey() }))
        .catch(() => {});
    },
    [queryClient]
  );

  const navigateTo = useCallback(
    (original: string, addToStack = true) => {
      const full = ensureProtocol(original);
      if (!full) return;
      setUrlInput(full);
      setDisplayUrl(full);
      setIframeSrc(proxyHref(full));
      setIsLoading(true);
      if (addToStack) {
        navStack.current = navStack.current.slice(0, navPos.current + 1);
        navStack.current.push(full);
        navPos.current = navStack.current.length - 1;
        syncNavButtons();
      }
    },
    [syncNavButtons]
  );

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
      if (!e.data || e.data.type !== "proxy-navigate") return;
      const { url, title } = e.data as { type: string; url: string; title?: string };
      if (!url) return;
      setUrlInput(url);
      setDisplayUrl(url);
      const current = navStack.current[navPos.current];
      if (url !== current) {
        navStack.current = navStack.current.slice(0, navPos.current + 1);
        navStack.current.push(url);
        navPos.current = navStack.current.length - 1;
        syncNavButtons();
      }
      recordHistory(url, title);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [recordHistory, syncNavButtons]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigateTo(urlInput);
  };

  const handleBack = () => {
    if (navPos.current <= 0) return;
    navPos.current -= 1;
    const url = navStack.current[navPos.current];
    syncNavButtons();
    setUrlInput(url);
    setDisplayUrl(url);
    setIframeSrc(proxyHref(url));
    setIsLoading(true);
  };

  const handleForward = () => {
    if (navPos.current >= navStack.current.length - 1) return;
    navPos.current += 1;
    const url = navStack.current[navPos.current];
    syncNavButtons();
    setUrlInput(url);
    setDisplayUrl(url);
    setIframeSrc(proxyHref(url));
    setIsLoading(true);
  };

  const handleRefresh = () => {
    if (!iframeSrc) return;
    setIsLoading(true);
    const src = iframeSrc;
    setIframeSrc("");
    requestAnimationFrame(() => setIframeSrc(src));
  };

  const handleIframeLoad = () => setIsLoading(false);

  const isBookmarked = bookmarks.some((b) => b.url === displayUrl);

  const toggleBookmark = () => {
    if (!displayUrl) return;
    if (isBookmarked) {
      const bm = bookmarks.find((b) => b.url === displayUrl);
      if (bm) {
        deleteBookmark.mutate(
          { id: bm.id },
          { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListBookmarksQueryKey() }) }
        );
      }
    } else {
      createBookmark.mutate(
        { data: { url: displayUrl } },
        { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListBookmarksQueryKey() }) }
      );
    }
  };

  const handleClearHistory = () => {
    clearHistory.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListHistoryQueryKey() });
        toast({ title: "History cleared" });
      },
    });
  };

  const isHttps = displayUrl.startsWith("https://");
  const hasPage = !!iframeSrc;

  return (
    <div className="flex flex-col h-screen w-full bg-background text-foreground overflow-hidden font-mono">
      {/* ── Browser chrome ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border bg-card shrink-0 relative">
        {/* Subtle cyan top-border glow when a page is loaded */}
        {hasPage && (
          <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
        )}

        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground disabled:opacity-25 transition-all"
            onClick={handleBack} disabled={!canBack} data-testid="button-back">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground disabled:opacity-25 transition-all"
            onClick={handleForward} disabled={!canForward} data-testid="button-forward">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground disabled:opacity-25 transition-all"
            onClick={handleRefresh} disabled={!hasPage} data-testid="button-refresh">
            <RotateCw className={`h-4 w-4 transition-transform ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* Address bar */}
        <form onSubmit={handleSubmit} className="flex-1 flex items-center relative">
          <span className="absolute left-3 text-muted-foreground pointer-events-none transition-colors">
            {hasPage ? (
              isHttps
                ? <Shield className="h-3.5 w-3.5 text-emerald-400" />
                : <ShieldAlert className="h-3.5 w-3.5 text-yellow-400" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
          </span>
          <Input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onFocus={(e) => { e.target.select(); setInputFocused(true); }}
            onBlur={() => setInputFocused(false)}
            placeholder="Enter a URL"
            className={`w-full pl-9 pr-9 h-9 bg-secondary border transition-all text-sm ${
              inputFocused
                ? "border-primary/60 shadow-[0_0_0_2px_hsl(180_100%_50%/0.12)]"
                : "border-transparent"
            }`}
            data-testid="input-url"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
          />
          {hasPage && (
            <Button type="button" variant="ghost" size="icon"
              className={`absolute right-1 h-7 w-7 transition-all ${
                isBookmarked ? "text-primary" : "text-muted-foreground hover:text-primary"
              }`}
              onClick={toggleBookmark} data-testid="button-bookmark"
              title={isBookmarked ? "Remove bookmark" : "Add bookmark"}>
              <Star className={`h-3.5 w-3.5 transition-all ${isBookmarked ? "fill-primary scale-110" : ""}`} />
            </Button>
          )}
        </form>

        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0 transition-colors"
              data-testid="button-sidebar">
              <PanelRight className="h-4 w-4" />
            </Button>
          </SheetTrigger>

          <SheetContent side="right" className="w-80 p-0 border-l border-border bg-card flex flex-col">
            <Tabs defaultValue="history" className="flex flex-col h-full">
              <TabsList className="w-full rounded-none border-b border-border bg-transparent p-0 h-11 shrink-0">
                <TabsTrigger value="history"
                  className="flex-1 rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none h-full text-xs uppercase tracking-wider font-semibold transition-colors">
                  <History className="h-3.5 w-3.5 mr-2" />History
                </TabsTrigger>
                <TabsTrigger value="bookmarks"
                  className="flex-1 rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none h-full text-xs uppercase tracking-wider font-semibold transition-colors">
                  <BookmarkIcon className="h-3.5 w-3.5 mr-2" />Bookmarks
                </TabsTrigger>
              </TabsList>

              <TabsContent value="history" className="flex-1 overflow-hidden m-0 flex flex-col min-h-0">
                <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Recent</span>
                  <Button variant="ghost" size="sm" onClick={handleClearHistory}
                    className="h-6 text-[10px] text-destructive hover:text-destructive hover:bg-destructive/10 px-2"
                    data-testid="button-clear-history">Clear all</Button>
                </div>
                <ScrollArea className="flex-1">
                  {history.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
                      <History className="h-8 w-8 opacity-15" />
                      <span className="text-xs">No history yet</span>
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {history.map((entry) => (
                        <button key={entry.id}
                          className="w-full text-left p-3 hover:bg-secondary/60 flex items-start gap-3 transition-colors group"
                          onClick={() => { navigateTo(entry.url); setSidebarOpen(false); }}
                          data-testid={`history-entry-${entry.id}`}>
                          <div className="h-7 w-7 bg-secondary rounded flex items-center justify-center shrink-0 mt-0.5 group-hover:bg-accent transition-colors">
                            {entry.favicon
                              ? <img src={entry.favicon} alt="" className="h-4 w-4" />
                              : <Globe className="h-3.5 w-3.5 text-muted-foreground" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate leading-tight group-hover:text-primary transition-colors">{entry.title || entry.url}</p>
                            <p className="text-[11px] text-muted-foreground truncate mt-0.5">{entry.url}</p>
                            <p className="text-[10px] text-muted-foreground/50 mt-1">{format(new Date(entry.visitedAt), "MMM d, h:mm a")}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="bookmarks" className="flex-1 overflow-hidden m-0 flex flex-col min-h-0">
                <div className="flex items-center px-4 py-2 border-b border-border shrink-0">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Saved</span>
                </div>
                <ScrollArea className="flex-1">
                  {bookmarks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
                      <Star className="h-8 w-8 opacity-15" />
                      <span className="text-xs">No bookmarks yet</span>
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {bookmarks.map((bookmark) => (
                        <div key={bookmark.id}
                          className="flex items-center gap-3 p-3 hover:bg-secondary/60 group transition-colors"
                          data-testid={`bookmark-entry-${bookmark.id}`}>
                          <button className="h-7 w-7 bg-secondary rounded flex items-center justify-center shrink-0 group-hover:bg-accent transition-colors"
                            onClick={() => { navigateTo(bookmark.url); setSidebarOpen(false); }}>
                            {bookmark.favicon
                              ? <img src={bookmark.favicon} alt="" className="h-4 w-4" />
                              : <Star className="h-3.5 w-3.5 text-muted-foreground" />}
                          </button>
                          <button className="flex-1 min-w-0 text-left"
                            onClick={() => { navigateTo(bookmark.url); setSidebarOpen(false); }}>
                            <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{bookmark.title || bookmark.url}</p>
                            <p className="text-[11px] text-muted-foreground truncate mt-0.5">{bookmark.url}</p>
                          </button>
                          <Button variant="ghost" size="icon"
                            className="h-7 w-7 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteBookmark.mutate({ id: bookmark.id }, {
                                onSuccess: () => queryClient.invalidateQueries({ queryKey: getListBookmarksQueryKey() }),
                              });
                            }}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </SheetContent>
        </Sheet>
      </div>

      {/* ── Loading bar ─────────────────────────────────────────────────── */}
      <div className={`h-[2px] shrink-0 overflow-hidden transition-opacity duration-300 ${isLoading ? "opacity-100" : "opacity-0"}`}>
        <div className="h-full bg-gradient-to-r from-transparent via-primary to-transparent"
          style={{ animation: "proxyProgress 1.4s ease-in-out infinite" }} />
      </div>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div className="flex-1 relative overflow-hidden">
        {/* Empty state */}
        {!hasPage && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 select-none overflow-hidden">
            {/* Animated grid background */}
            <div className="absolute inset-0 opacity-[0.035]"
              style={{ backgroundImage: "linear-gradient(hsl(180 100% 50%) 1px,transparent 1px),linear-gradient(90deg,hsl(180 100% 50%) 1px,transparent 1px)", backgroundSize: "48px 48px" }} />
            {/* Radial gradient fade over grid */}
            <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 60% 60% at 50% 50%, transparent 20%, hsl(240 10% 4%) 80%)" }} />

            {/* Shield icon with pulse ring */}
            <div className="relative z-10">
              <div className="absolute inset-0 rounded-full animate-ping opacity-20"
                style={{ background: "radial-gradient(circle, hsl(180 100% 50%) 0%, transparent 70%)", transform: "scale(1.8)" }} />
              <div className="relative h-16 w-16 flex items-center justify-center rounded-full"
                style={{ background: "radial-gradient(circle, hsl(180 100% 50% / 0.15) 0%, transparent 70%)" }}>
                <Shield className="h-10 w-10" style={{ color: "hsl(180 100% 50%)", filter: "drop-shadow(0 0 12px hsl(180 100% 50% / 0.6))" }} />
              </div>
            </div>

            {/* Title */}
            <div className="text-center z-10">
              <h1 className="text-2xl font-bold tracking-tight mb-1.5"
                style={{ color: "hsl(0 0% 95%)", textShadow: "0 0 24px hsl(180 100% 50% / 0.3)" }}>
                ClearProxy
              </h1>
              <p className="text-sm text-muted-foreground/70">Browse freely. Leave no trace.</p>
            </div>

            {/* Quick links */}
            <div className="flex flex-wrap gap-2 justify-center z-10 max-w-sm mt-1">
              {QUICK_LINKS.map((link, i) => (
                <button
                  key={link.url}
                  onClick={() => navigateTo(link.url)}
                  className="px-3 py-1.5 text-xs font-mono border border-border/60 text-muted-foreground hover:text-primary hover:border-primary/50 hover:bg-primary/5 transition-all duration-200"
                  style={{ animationDelay: `${i * 60}ms` }}
                  data-testid={`quick-link-${link.label.toLowerCase()}`}>
                  {link.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Proxy iframe */}
        <iframe
          ref={iframeRef}
          src={iframeSrc || undefined}
          className={`w-full h-full border-none block bg-white transition-opacity duration-300 ${hasPage ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
          onLoad={handleIframeLoad}
          title="Proxy View"
          data-testid="proxy-iframe"
        />
      </div>

      <style dangerouslySetInnerHTML={{
        __html: `
          @keyframes proxyProgress {
            0%   { width: 0%;  margin-left: 0%; }
            50%  { width: 60%; margin-left: 20%; }
            100% { width: 0%;  margin-left: 100%; }
          }
        `,
      }} />
    </div>
  );
}
