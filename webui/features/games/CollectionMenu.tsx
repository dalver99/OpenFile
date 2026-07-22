"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { GameCollection } from "@/domain/games";

export default function CollectionMenu({
  gameId,
  collections,
  initialCollectionIds,
  showLabel = false,
}: {
  gameId: number;
  collections: GameCollection[];
  initialCollectionIds: number[];
  showLabel?: boolean;
}) {
  const router = useRouter();
  const [included, setIncluded] = useState(() => new Set(initialCollectionIds));
  const [pending, setPending] = useState<number | null>(null);

  async function toggle(collectionId: number) {
    if (pending != null) return;
    const nextIncluded = !included.has(collectionId);
    setPending(collectionId);
    try {
      const response = await fetch(`/api/collections/${collectionId}/games`, {
        method: nextIncluded ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId }),
      });
      const data = await response.json();
      if (!response.ok) return;
      setIncluded((current) => {
        const next = new Set(current);
        if (nextIncluded) next.add(collectionId);
        else next.delete(collectionId);
        return next;
      });
      if (!data.demo) router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <details className="relative">
      <summary className={`flex h-9 cursor-pointer list-none items-center justify-center gap-1.5 rounded-lg border px-2.5 text-xs font-bold shadow-sm marker:hidden [&::-webkit-details-marker]:hidden ${showLabel ? "min-w-0" : "w-9 px-0"} ${included.size ? "border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-800 dark:bg-brand-950/50 dark:text-brand-300" : "border-stone-200 bg-white text-stone-500 hover:border-brand-300 hover:text-brand-700 dark:border-stone-700 dark:bg-stone-900"}`} title="Add to collection" aria-label="Add to collection"><span aria-hidden="true">▣</span>{showLabel ? <span>Collections</span> : null}</summary>
      <div className="absolute right-0 z-30 mt-2 w-64 rounded-xl border border-stone-200 bg-white p-2 shadow-2xl dark:border-stone-700 dark:bg-stone-900">
        <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-stone-400">Collections</p>
        {collections.length ? collections.map((collection) => (
          <label key={collection.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800">
            <input type="checkbox" checked={included.has(collection.id)} disabled={pending != null} onChange={() => void toggle(collection.id)} className="h-4 w-4 accent-brand-700" />
            <i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: collection.color }} />
            <span className="min-w-0 flex-1 truncate">{collection.name}</span>
          </label>
        )) : <p className="px-2 py-3 text-xs text-stone-500">Create your first collection to organize this game.</p>}
        <Link href="/collections" className="mt-1 block border-t border-stone-100 px-2 pt-2 text-xs font-bold text-brand-700 hover:underline dark:border-stone-800 dark:text-brand-400">Manage collections →</Link>
      </div>
    </details>
  );
}
