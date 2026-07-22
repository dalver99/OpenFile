import CollectionManager from "@/features/collections/CollectionManager";
import { listCollections } from "@/server/data/collections";
import { isDemoMode } from "@/server/demo-mode";

export const dynamic = "force-dynamic";

export default async function CollectionsPage() {
  const collections = await listCollections();
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <section className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-700 dark:text-brand-400">Your study library</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-stone-900 dark:text-white sm:text-4xl">Collections</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-500">Group games into opening studies, tournament files, model games, or anything else. A game may live in several collections.</p>
      </section>
      <CollectionManager initialCollections={collections} demo={isDemoMode()} />
    </main>
  );
}
