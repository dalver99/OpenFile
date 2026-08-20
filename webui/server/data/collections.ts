import "server-only";

import type { GameCollection } from "@/domain/games";
import { demoCollections, demoGameReview } from "@/server/demo/data";

export async function listCollections() {
  return demoCollections();
}

export async function createCollection(input: { name: string; description?: string; color?: string }): Promise<GameCollection | "duplicate"> {
  return { id: Date.now(), name: input.name, description: input.description ?? "", color: input.color ?? "#a12222", game_count: 0, updated_at: new Date().toISOString() };
}

export async function updateCollection(id: number, input: { name: string; description: string; color: string }): Promise<GameCollection | "missing" | "duplicate"> {
  return { id, ...input, game_count: demoCollections().find((item) => item.id === id)?.game_count ?? 0, updated_at: new Date().toISOString() };
}

export async function deleteCollection(id: number) {
  return id > 0;
}

export async function setCollectionMembership(collectionId: number, gameId: number, included: boolean) {
  void included;
  return collectionId > 0 && demoGameReview(gameId) ? "saved" as const : "missing" as const;
}
