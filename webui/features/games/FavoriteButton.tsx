"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function FavoriteButton({
  gameId,
  initialFavorite,
  showLabel = false,
}: {
  gameId: number;
  initialFavorite: boolean;
  showLabel?: boolean;
}) {
  const router = useRouter();
  const [favorite, setFavorite] = useState(initialFavorite);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function toggle() {
    if (busy) return;
    const next = !favorite;
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/games/${gameId}/favorite`, {
        method: next ? "PUT" : "DELETE",
      });
      const data = await response.json();
      if (!response.ok) throw new Error("favorite_failed");
      setFavorite(next);
      if (!data.demo) router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const action = favorite ? "Remove from favorites" : "Add to favorites";
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void toggle();
      }}
      disabled={busy}
      aria-label={action}
      aria-pressed={favorite}
      title={failed ? "Could not update favorite. Try again." : action}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold shadow-sm transition disabled:opacity-60 ${
        favorite
          ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
          : "border-stone-200 bg-white text-stone-400 hover:border-amber-300 hover:text-amber-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400"
      } ${failed ? "ring-2 ring-rose-300" : ""}`}
    >
      <span aria-hidden className="text-base leading-none">{favorite ? "★" : "☆"}</span>
      {showLabel ? <span>{favorite ? "Favorited" : "Favorite"}</span> : null}
    </button>
  );
}
