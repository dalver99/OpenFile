import "server-only";

import type { GameCollection } from "@/domain/games";
import { pool } from "@/server/database/sqlite";
import { WEBUI_USER_ID } from "@/server/current-user";

const collectionSelect = `
  SELECT c.id, c.name, c.description, c.color,
         count(cg.player_game_id)::int AS game_count,
         c.updated_at
  FROM game_collections c
  LEFT JOIN collection_games cg ON cg.collection_id = c.id`;

export async function listCollections(): Promise<GameCollection[]> {
  const { rows } = await pool.query<GameCollection>(
    `${collectionSelect}
     WHERE c.user_id = $1
     GROUP BY c.id, c.name, c.description, c.color, c.updated_at
     ORDER BY c.updated_at DESC, lower(c.name)`,
    [WEBUI_USER_ID],
  );
  return rows.map((row) => ({ ...row, game_count: Number(row.game_count) }));
}

export async function createCollection(input: {
  name: string;
  description?: string;
  color?: string;
}): Promise<GameCollection | "duplicate"> {
  try {
    const { rows } = await pool.query<GameCollection>(
      `INSERT INTO game_collections (user_id, name, description, color)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, description, color, 0 AS game_count, updated_at`,
      [
        WEBUI_USER_ID,
        input.name,
        input.description ?? "",
        input.color ?? "#a12222",
      ],
    );
    return { ...rows[0], game_count: 0 };
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      return "duplicate";
    }
    throw error;
  }
}

export async function updateCollection(
  id: number,
  input: { name: string; description: string; color: string },
): Promise<GameCollection | "missing" | "duplicate"> {
  try {
    const { rows } = await pool.query<GameCollection>(
      `UPDATE game_collections
       SET name = $3, description = $4, color = $5,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2
       RETURNING id, name, description, color,
                 0 AS game_count,
                 updated_at`,
      [id, WEBUI_USER_ID, input.name, input.description, input.color],
    );
    return rows.length ? { ...rows[0], game_count: Number(rows[0].game_count) } : "missing";
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      return "duplicate";
    }
    throw error;
  }
}

export async function deleteCollection(id: number): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM game_collections WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, WEBUI_USER_ID],
  );
  return Boolean(result.rowCount);
}

export async function setCollectionMembership(
  collectionId: number,
  playerGameId: number,
  included: boolean,
): Promise<"saved" | "missing"> {
  if (included) {
    const result = await pool.query(
      `INSERT INTO collection_games (collection_id, player_game_id)
       SELECT c.id, pg.id
       FROM game_collections c
       JOIN player_games pg ON pg.id = $2 AND pg.player_id = $3
       WHERE c.id = $1 AND c.user_id = $3
       ON CONFLICT(collection_id, player_game_id) DO NOTHING
       RETURNING collection_id`,
      [collectionId, playerGameId, WEBUI_USER_ID],
    );
    if (!result.rowCount) {
      const owned = await pool.query(
        `SELECT c.id FROM game_collections c
         JOIN player_games pg ON pg.id = $2 AND pg.player_id = $3
         WHERE c.id = $1 AND c.user_id = $3`,
        [collectionId, playerGameId, WEBUI_USER_ID],
      );
      if (!owned.rowCount) return "missing";
    }
  } else {
    const owned = await pool.query(
      `SELECT c.id FROM game_collections c
       JOIN player_games pg ON pg.id = $2 AND pg.player_id = $3
       WHERE c.id = $1 AND c.user_id = $3`,
      [collectionId, playerGameId, WEBUI_USER_ID],
    );
    if (!owned.rowCount) return "missing";
    await pool.query(
      `DELETE FROM collection_games WHERE collection_id = $1 AND player_game_id = $2`,
      [collectionId, playerGameId],
    );
  }
  await pool.query(
    `UPDATE game_collections SET updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND user_id = $2`,
    [collectionId, WEBUI_USER_ID],
  );
  return "saved";
}
