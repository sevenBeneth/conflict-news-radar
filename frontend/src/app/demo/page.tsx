import AIChat from "@/components/panels/AIChat";
export default function DemoPage() {
  return (
    <main className="min-h-screen bg-background p-3 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <a href="/" className="text-xs text-text-muted hover:text-accent-cyan">
          ← 地区冲突资讯雷达
        </a>
        <div className="mt-3 h-[90vh] min-h-[640px] overflow-hidden rounded-lg border border-border bg-background-panel">
          <AIChat />
        </div>
      </div>
    </main>
  );
}
