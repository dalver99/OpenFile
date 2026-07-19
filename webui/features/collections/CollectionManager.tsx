"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { GameCollection } from "@/domain/games";

const COLORS = ["#a12222", "#7c3aed", "#2563eb", "#0f766e", "#65a30d", "#d97706", "#57534e"];

export default function CollectionManager({ initialCollections }: { initialCollections: GameCollection[] }) {
  const router = useRouter();
  const [collections, setCollections] = useState(initialCollections);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [busyId, setBusyId] = useState<number | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusyId("new");
    setError(null);
    try {
      const response = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, color }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error === "duplicate_collection" ? "A collection with that name already exists." : "Could not create the collection.");
      setCollections((current) => [data.collection, ...current]);
      setName("");
      setDescription("");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the collection.");
    } finally {
      setBusyId(null);
    }
  }

  function edit(id: number, key: "name" | "description" | "color", value: string) {
    setCollections((current) => current.map((collection) => collection.id === id ? { ...collection, [key]: value } : collection));
  }

  async function save(collection: GameCollection) {
    setBusyId(collection.id);
    setError(null);
    try {
      const response = await fetch(`/api/collections/${collection.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collection),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error === "duplicate_collection" ? "A collection with that name already exists." : "Could not save this collection.");
      setCollections((current) => current.map((item) => item.id === collection.id ? { ...collection, ...data.collection, game_count: collection.game_count } : item));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this collection.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(collection: GameCollection) {
    if (!window.confirm(`Delete “${collection.name}”? Games remain in your library.`)) return;
    setBusyId(collection.id);
    const response = await fetch(`/api/collections/${collection.id}`, { method: "DELETE" });
    if (response.ok) {
      setCollections((current) => current.filter((item) => item.id !== collection.id));
      router.refresh();
    } else {
      setError("Could not delete this collection.");
    }
    setBusyId(null);
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <form onSubmit={create} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-700 dark:bg-stone-900 lg:sticky lg:top-24">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700 dark:text-brand-400">New collection</p>
        <h2 className="mt-1 text-lg font-black text-stone-900 dark:text-white">Create a chess folder</h2>
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="e.g. Caro-Kann study" aria-label="Collection name" className="mt-4 w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm outline-none focus:border-brand-400 dark:border-stone-700 dark:bg-stone-800" />
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={240} rows={3} placeholder="What belongs here?" aria-label="Collection description" className="mt-2 w-full resize-none rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm outline-none focus:border-brand-400 dark:border-stone-700 dark:bg-stone-800" />
        <div className="mt-3 flex items-center gap-2" aria-label="Collection color">
          {COLORS.map((item) => <button key={item} type="button" onClick={() => setColor(item)} aria-label={`Use color ${item}`} aria-pressed={color === item} className={`h-7 w-7 rounded-full transition ${color === item ? "ring-2 ring-stone-900 ring-offset-2 dark:ring-white dark:ring-offset-stone-900" : ""}`} style={{ backgroundColor: item }} />)}
        </div>
        <button type="submit" disabled={!name.trim() || busyId != null} className="mt-4 w-full rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-black text-white hover:bg-brand-800 disabled:opacity-50">{busyId === "new" ? "Creating…" : "Create collection"}</button>
        {error ? <p className="mt-3 text-xs text-rose-600 dark:text-rose-400">{error}</p> : null}
      </form>

      <section className="space-y-3">
        {collections.length ? collections.map((collection) => (
          <article key={collection.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-700 dark:bg-stone-900">
            <div className="flex gap-3">
              <input type="color" value={collection.color} onChange={(event) => edit(collection.id, "color", event.target.value)} className="mt-1 h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-full border-0 bg-transparent p-0" aria-label={`Color for ${collection.name}`} />
              <div className="min-w-0 flex-1">
                <input value={collection.name} onChange={(event) => edit(collection.id, "name", event.target.value)} maxLength={60} aria-label={`Name for ${collection.name}`} className="w-full bg-transparent text-base font-black text-stone-900 outline-none focus:text-brand-700 dark:text-white" />
                <input value={collection.description} onChange={(event) => edit(collection.id, "description", event.target.value)} maxLength={240} placeholder="Add a description" aria-label={`Description for ${collection.name}`} className="mt-1 w-full bg-transparent text-xs text-stone-500 outline-none" />
              </div>
              <span className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-bold text-stone-500 dark:bg-stone-800">{collection.game_count} games</span>
            </div>
            <div className="mt-4 flex items-center justify-between gap-2 border-t border-stone-100 pt-3 dark:border-stone-800">
              <Link href={`/games?time=all&review=all&collection=${collection.id}`} className="text-xs font-black text-brand-700 hover:underline dark:text-brand-400">Open games →</Link>
              <div className="flex gap-2">
                <button type="button" onClick={() => void remove(collection)} disabled={busyId != null} className="px-2 py-1 text-xs font-semibold text-stone-400 hover:text-rose-600">Delete</button>
                <button type="button" onClick={() => void save(collection)} disabled={!collection.name.trim() || busyId != null} className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-black text-stone-700 hover:border-brand-400 dark:border-stone-700 dark:text-stone-200">{busyId === collection.id ? "Saving…" : "Save"}</button>
              </div>
            </div>
          </article>
        )) : (
          <div className="rounded-2xl border border-dashed border-stone-300 px-6 py-16 text-center dark:border-stone-700">
            <p className="font-bold text-stone-700 dark:text-stone-200">No collections yet</p>
            <p className="mt-1 text-sm text-stone-500">Create one for openings, tournaments, model games, or positions you want to revisit.</p>
          </div>
        )}
      </section>
    </div>
  );
}
