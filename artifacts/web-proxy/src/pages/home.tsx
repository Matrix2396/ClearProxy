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
  Menu
} from "lucide-react";
import { 
  useListHistory, 
  useClearHistory, 
  useListBookmarks, 
  useCreateBookmark, 
  useDeleteBookmark,
  getListHistoryQueryKey,
  getListBookmarksQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";

function ensureUrlProtocol(url: string) {
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) {
    return `https://${url}`;
  }
  return url;
}

export default function Home() {
  const [urlInput, setUrlInput] = useState("");
  const [currentUrl, setCurrentUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: history = [] } = useListHistory();
  const { data: bookmarks = [] } = useListBookmarks();
  
  const clearHistory = useClearHistory();
  const createBookmark = useCreateBookmark();
  const deleteBookmark = useDeleteBookmark();

  const handleNavigate = (url: string) => {
    const formattedUrl = ensureUrlProtocol(url);
    if (!formattedUrl) return;
    setUrlInput(formattedUrl);
    setCurrentUrl(formattedUrl);
    setIsLoading(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleNavigate(urlInput);
  };

  const handleIframeLoad = () => {
    setIsLoading(false);
    if (currentUrl) {
      // Record history (raw fetch since it's a side effect)
      fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: currentUrl })
      }).then(() => {
        queryClient.invalidateQueries({ queryKey: getListHistoryQueryKey() });
      }).catch(console.error);
    }
  };

  const handleRefresh = () => {
    if (iframeRef.current) {
      setIsLoading(true);
      // Hack to refresh iframe
      const src = iframeRef.current.src;
      iframeRef.current.src = "about:blank";
      setTimeout(() => {
        if (iframeRef.current) iframeRef.current.src = src;
      }, 50);
    }
  };

  const isBookmarked = bookmarks.some(b => b.url === currentUrl);

  const toggleBookmark = () => {
    if (!currentUrl) return;
    
    if (isBookmarked) {
      const bookmark = bookmarks.find(b => b.url === currentUrl);
      if (bookmark) {
        deleteBookmark.mutate(
          { id: bookmark.id },
          {
            onSuccess: () => {
              queryClient.invalidateQueries({ queryKey: getListBookmarksQueryKey() });
            }
          }
        );
      }
    } else {
      createBookmark.mutate(
        { data: { url: currentUrl } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListBookmarksQueryKey() });
          }
        }
      );
    }
  };

  const handleClearHistory = () => {
    clearHistory.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListHistoryQueryKey() });
        toast({ title: "History cleared" });
      }
    });
  };

  return (
    <div className="flex flex-col h-screen w-full bg-background text-foreground overflow-hidden font-mono">
      {/* Browser Chrome */}
      <div className="flex items-center gap-2 p-2 border-b border-border bg-card">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground disabled:opacity-50">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground disabled:opacity-50">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={handleRefresh}
            disabled={!currentUrl || isLoading}
          >
            <RotateCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 flex items-center relative group">
          <div className="absolute left-3 text-muted-foreground">
            {currentUrl.startsWith('https') ? <ShieldAlert className="h-4 w-4 text-green-500" /> : <Search className="h-4 w-4" />}
          </div>
          <Input 
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Search or enter address"
            className="w-full pl-10 pr-10 h-10 bg-secondary border-none focus-visible:ring-1 focus-visible:ring-primary focus-visible:bg-background transition-colors text-sm rounded-none"
            data-testid="input-url"
          />
          {currentUrl && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 h-8 w-8 text-muted-foreground hover:text-primary"
              onClick={toggleBookmark}
              data-testid="button-bookmark"
            >
              <Star className={`h-4 w-4 ${isBookmarked ? 'fill-primary text-primary' : ''}`} />
            </Button>
          )}
        </form>

        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" data-testid="button-menu">
              <PanelRight className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-80 p-0 border-l-border bg-card">
            <Tabs defaultValue="history" className="h-full flex flex-col">
              <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent p-0 h-12">
                <TabsTrigger value="history" className="flex-1 rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none h-full">
                  <History className="h-4 w-4 mr-2" />
                  History
                </TabsTrigger>
                <TabsTrigger value="bookmarks" className="flex-1 rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none h-full">
                  <BookmarkIcon className="h-4 w-4 mr-2" />
                  Bookmarks
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="history" className="flex-1 overflow-hidden m-0 flex flex-col">
                <div className="p-2 border-b border-border flex justify-between items-center bg-secondary/50">
                  <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider px-2">Recent Visits</span>
                  <Button variant="ghost" size="sm" onClick={handleClearHistory} className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10" data-testid="button-clear-history">
                    Clear All
                  </Button>
                </div>
                <ScrollArea className="flex-1">
                  {history.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground text-sm flex flex-col items-center gap-2">
                      <History className="h-8 w-8 opacity-20" />
                      No history yet.
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {history.map((entry) => (
                        <div key={entry.id} className="p-3 hover:bg-secondary/50 cursor-pointer group flex items-start gap-3 transition-colors" onClick={() => handleNavigate(entry.url)}>
                          <div className="h-8 w-8 bg-secondary rounded flex items-center justify-center shrink-0">
                            {entry.favicon ? (
                              <img src={entry.favicon} alt="" className="h-4 w-4" />
                            ) : (
                              <History className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{entry.title || entry.url}</p>
                            <p className="text-xs text-muted-foreground truncate">{entry.url}</p>
                            <p className="text-[10px] text-muted-foreground/60 mt-1">{format(new Date(entry.visitedAt), 'MMM d, h:mm a')}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="bookmarks" className="flex-1 overflow-hidden m-0 flex flex-col">
                <div className="p-2 border-b border-border bg-secondary/50 flex items-center h-[45px]">
                  <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider px-2">Saved Links</span>
                </div>
                <ScrollArea className="flex-1">
                  {bookmarks.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground text-sm flex flex-col items-center gap-2">
                      <Star className="h-8 w-8 opacity-20" />
                      No bookmarks yet.
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {bookmarks.map((bookmark) => (
                        <div key={bookmark.id} className="p-3 hover:bg-secondary/50 group flex items-center gap-3 transition-colors">
                          <div className="h-8 w-8 bg-secondary rounded flex items-center justify-center shrink-0 cursor-pointer" onClick={() => handleNavigate(bookmark.url)}>
                            {bookmark.favicon ? (
                              <img src={bookmark.favicon} alt="" className="h-4 w-4" />
                            ) : (
                              <Star className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => handleNavigate(bookmark.url)}>
                            <p className="text-sm font-medium text-foreground truncate">{bookmark.title || bookmark.url}</p>
                            <p className="text-xs text-muted-foreground truncate">{bookmark.url}</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteBookmark.mutate(
                                { id: bookmark.id },
                                { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListBookmarksQueryKey() }) }
                              );
                            }}
                          >
                            <X className="h-4 w-4" />
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

      {/* Main Content Area */}
      <div className="flex-1 relative bg-black">
        {!currentUrl ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
            <ShieldAlert className="h-16 w-16 mb-4 opacity-20" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground/80 mb-2">ClearProxy</h1>
            <p className="text-sm">Enter a URL to begin anonymous browsing.</p>
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            src={`/api/proxy?url=${encodeURIComponent(currentUrl)}`}
            className="w-full h-full border-none bg-white"
            sandbox="allow-same-origin allow-scripts allow-forms allow-top-navigation allow-popups"
            onLoad={handleIframeLoad}
            title="Proxy View"
          />
        )}
        
        {isLoading && currentUrl && (
          <div className="absolute top-0 left-0 right-0 h-1 bg-secondary overflow-hidden">
            <div className="h-full bg-primary animate-pulse w-1/3" style={{ animation: 'progress 1s ease-in-out infinite' }} />
          </div>
        )}
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes progress {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
      `}} />
    </div>
  );
}
