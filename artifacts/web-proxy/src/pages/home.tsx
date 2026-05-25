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

export default function Home() {
  // Address bar text (mirrors what user types or what page reports)
  const [urlInput, setUrlInput] = useState("");
  // The URL actually loaded in the proxy (drives iframe src)
  const [iframeSrc, setIframeSrc] = useState("");
  // Display URL shown as "current page" for bookmarks/icon
  const [displayUrl, setDisplayUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Back/forward stack — tracks original URLs in order visited
  const navStack = useRef<string[]>([]);
  const navPos = useRef(-1);
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);

  // Deduplicate history writes
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

  // Update nav button state
  const syncNavButtons = useCallback(() => {
    setCanBack(navPos.current > 0);
    setCanForward(navPos.current < navStack.current.length - 1);
  }, []);

  // Record a history entry, deduplicated (same URL within 3 s is ignored)
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

  // Actually navigate the iframe to a URL, updating all state
  const navigateTo = useCallback(
    (original: string, addToStack = true) => {
      const full = ensureProtocol(original);
      if (!full) return;

      setUrlInput(full);
      setDisplayUrl(full);
      setIframeSrc(proxyHref(full));
      setIsLoading(true);

      if (addToStack) {
        // Trim forward history
        navStack.current = navStack.current.slice(0, navPos.current + 1);
        navStack.current.push(full);
        navPos.current = navStack.current.length - 1;
        syncNavButtons();
      }
    },
    [syncNavButtons]
  );

  // Listen for postMessage from the proxied iframe (direct child only)
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // Only accept from our direct iframe child — prevents sub-iframe floods
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
      if (!e.data || e.data.type !== "proxy-navigate") return;

      const { url, title } = e.data as { type: string; url: string; title?: string };
      if (!url) return;

      // Update address bar without remounting the iframe
      setUrlInput(url);
      setDisplayUrl(url);

      // Track in nav stack if URL changed
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
    // Force reload by toggling src
    setIframeSrc("");
    requestAnimationFrame(() => setIframeSrc(iframeSrc));
  };

  const handleIframeLoad = () => {
    setIsLoading(false);
  };

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
      {/* Browser Chrome */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border bg-card shrink-0">
        {/* Nav controls */}
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground disabled:opacity-30"
            onClick={handleBack}
            disabled={!canBack}
            data-testid="button-back"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground disabled:opacity-30"
            onClick={handleForward}
            disabled={!canForward}
            data-testid="button-forward"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground disabled:opacity-30"
            onClick={handleRefresh}
            disabled={!hasPage}
            data-testid="button-refresh"
          >
            <RotateCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* Address bar */}
        <form onSubmit={handleSubmit} className="flex-1 flex items-center relative">
          <span className="absolute left-3 text-muted-foreground pointer-events-none">
            {hasPage ? (
              isHttps ? (
                <Shield className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <ShieldAlert className="h-3.5 w-3.5 text-yellow-500" />
              )
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
          </span>
          <Input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onFocus={(e) => e.target.select()}
            placeholder="Enter a URL"
            className="w-full pl-9 pr-9 h-9 bg-secondary border-transparent focus-visible:border-primary focus-visible:ring-0 text-sm"
            data-testid="input-url"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
          />
          {hasPage && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 h-7 w-7 text-muted-foreground hover:text-primary transition-colors"
              onClick={toggleBookmark}
              data-testid="button-bookmark"
              title={isBookmarked ? "Remove bookmark" : "Add bookmark"}
            >
              <Star className={`h-3.5 w-3.5 ${isBookmarked ? "fill-primary text-primary" : ""}`} />
            </Button>
          )}
        </form>

        {/* Sidebar toggle */}
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
              data-testid="button-sidebar"
            >
              <PanelRight className="h-4 w-4" />
            </Button>
          </SheetTrigger>

          <SheetContent side="right" className="w-80 p-0 border-l border-border bg-card flex flex-col">
            <Tabs defaultValue="history" className="flex flex-col h-full">
              <TabsList className="w-full rounded-none border-b border-border bg-transparent p-0 h-11 shrink-0">
                <TabsTrigger
                  value="history"
                  className="flex-1 rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none h-full text-xs uppercase tracking-wider font-semibold"
                >
                  <History className="h-3.5 w-3.5 mr-2" />
                  History
                </TabsTrigger>
                <TabsTrigger
                  value="bookmarks"
                  className="flex-1 rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none h-full text-xs uppercase tracking-wider font-semibold"
                >
                  <BookmarkIcon className="h-3.5 w-3.5 mr-2" />
                  Bookmarks
                </TabsTrigger>
              </TabsList>

              {/* History tab */}
              <TabsContent value="history" className="flex-1 overflow-hidden m-0 flex flex-col min-h-0">
                <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Recent</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearHistory}
                    className="h-6 text-[10px] text-destructive hover:text-destructive hover:bg-destructive/10 px-2"
                    data-testid="button-clear-history"
                  >
                    Clear all
                  </Button>
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
                        <button
                          key={entry.id}
                          className="w-full text-left p-3 hover:bg-secondary/60 flex items-start gap-3 transition-colors"
                          onClick={() => { navigateTo(entry.url); setSidebarOpen(false); }}
                          data-testid={`history-entry-${entry.id}`}
                        >
                          <div className="h-7 w-7 bg-secondary rounded flex items-center justify-center shrink-0 mt-0.5">
                            {entry.favicon ? (
                              <img src={entry.favicon} alt="" className="h-4 w-4" />
                            ) : (
                              <History className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate leading-tight">{entry.title || entry.url}</p>
                            <p className="text-[11px] text-muted-foreground truncate mt-0.5">{entry.url}</p>
                            <p className="text-[10px] text-muted-foreground/50 mt-1">
                              {format(new Date(entry.visitedAt), "MMM d, h:mm a")}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              {/* Bookmarks tab */}
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
                        <div
                          key={bookmark.id}
                          className="flex items-center gap-3 p-3 hover:bg-secondary/60 group transition-colors"
                          data-testid={`bookmark-entry-${bookmark.id}`}
                        >
                          <button
                            className="h-7 w-7 bg-secondary rounded flex items-center justify-center shrink-0"
                            onClick={() => { navigateTo(bookmark.url); setSidebarOpen(false); }}
                          >
                            {bookmark.favicon ? (
                              <img src={bookmark.favicon} alt="" className="h-4 w-4" />
                            ) : (
                              <Star className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                          </button>
                          <button
                            className="flex-1 min-w-0 text-left"
                            onClick={() => { navigateTo(bookmark.url); setSidebarOpen(false); }}
                          >
                            <p className="text-sm font-medium truncate">{bookmark.title || bookmark.url}</p>
                            <p className="text-[11px] text-muted-foreground truncate mt-0.5">{bookmark.url}</p>
                          </button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteBookmark.mutate(
                                { id: bookmark.id },
                                { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListBookmarksQueryKey() }) }
                              );
                            }}
                          >
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

      {/* Loading bar */}
      {isLoading && (
        <div className="h-[2px] bg-secondary shrink-0 overflow-hidden">
          <div className="h-full bg-primary" style={{ animation: "proxyProgress 1.4s ease-in-out infinite" }} />
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 relative overflow-hidden bg-black">
        {/* Empty state */}
        {!hasPage && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-muted-foreground select-none">
            <ShieldAlert className="h-14 w-14 opacity-10" />
            <div className="text-center">
              <h1 className="text-xl font-bold tracking-tight text-foreground/60 mb-1">ClearProxy</h1>
              <p className="text-sm text-muted-foreground/60">Enter a URL above to begin browsing</p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center mt-4 max-w-sm">
              {["wikipedia.org", "reddit.com", "github.com", "news.ycombinator.com"].map((site) => (
                <button
                  key={site}
                  onClick={() => navigateTo(`https://${site}`)}
                  className="px-3 py-1.5 text-xs bg-secondary hover:bg-accent text-muted-foreground hover:text-foreground transition-colors border border-border"
                >
                  {site}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Proxy iframe — no key prop, src drives navigation without remounting */}
        <iframe
          ref={iframeRef}
          src={iframeSrc || undefined}
          className={`w-full h-full border-none block bg-white ${hasPage ? "visible" : "invisible"}`}
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
          onLoad={handleIframeLoad}
          title="Proxy View"
          data-testid="proxy-iframe"
        />
      </div>

      <style dangerouslySetInnerHTML={{
        __html: `
          @keyframes proxyProgress {
            0%   { width: 0%;   margin-left: 0%; }
            50%  { width: 60%;  margin-left: 20%; }
            100% { width: 0%;   margin-left: 100%; }
          }
        `,
      }} />
    </div>
  );
}
