"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { GameCollection } from "@/domain/games";

export default function ImportGameCard({ collections }: { collections: GameCollection[] }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [analyze, setAnalyze] = useState(true);
  const [collectionId, setCollectionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ gameId: number; existing: boolean; analysisStatus: string } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/games/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          analyze,
          collectionId: collectionId ? Number(collectionId) : null,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail ?? (
          data.error === "invalid_chesscom_url"
            ? "Paste a Chess.com live or daily game link."
            : "Could not import that game."
        ));
      }
      setResult(data);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not import that game.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-700 dark:bg-stone-900">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700 dark:text-brand-400">Add one game</p>
      <h2 className="mt-1 text-base font-black text-stone-900 dark:text-white">Import a Chess.com link</h2>
      <p className="mt-1 text-xs leading-5 text-stone-500">The game is kept in your library. Older links may take longer while OpenFile searches your public monthly archives.</p>
      <form onSubmit={submit} className="mt-3 space-y-2.5">
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          type="url"
          placeholder="https://www.chess.com/game/live/…"
          aria-label="Chess.com game link"
          className="w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-800 outline-none focus:border-brand-400 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
        />
        {collections.length ? (
          <select value={collectionId} onChange={(event) => setCollectionId(event.target.value)} aria-label="Add imported game to collection" className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200">
            <option value="">No collection</option>
            {collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
          </select>
        ) : null}
        <label className="flex items-center gap-2 text-xs font-semibold text-stone-600 dark:text-stone-300">
          <input type="checkbox" checked={analyze} onChange={(event) => setAnalyze(event.target.checked)} className="h-4 w-4 accent-brand-700" />
          Analyze immediately
        </label>
        <button type="submit" disabled={busy || !url.trim()} className="w-full rounded-lg bg-stone-900 px-3 py-2.5 text-xs font-black text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:bg-stone-300 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white dark:disabled:bg-stone-700">
          {busy ? "Searching Chess.com archives…" : "Import game"}
        </button>
      </form>
      {error ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p> : null}
      {result ? (
        <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          <p className="font-bold">{result.existing ? "Game already in your library." : "Game added to your library."}</p>
          <p className="mt-0.5">{result.analysisStatus === "queued" ? "Stockfish analysis has started." : result.analysisStatus === "ready" ? "Its review is already ready." : "Saved without starting analysis."}</p>
          <Link href={`/games/${result.gameId}`} target="_blank" className="mt-2 inline-block font-black underline">Open game →</Link>
        </div>
      ) : null}
    </section>
  );
}
