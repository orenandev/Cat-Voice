import { supabase } from "./supabase";
import { deleteCloudPack } from "./packStore";
import type { Room, Take } from "./types";

export async function leaveRoom(room: Room, userId: string) {
  const { error } = await supabase.from("room_members").delete().eq("room_id", room.id).eq("user_id", userId);
  if (error) throw error;
}

export async function deleteRoom(room: Room, takes: Take[]) {
  if (takes.length) await supabase.storage.from("takes").remove(takes.map((t) => t.path));
  if (room.pack_source === "cloud") await deleteCloudPack(room.pack_key, room.pack_chunks);
  const { error } = await supabase.from("rooms").delete().eq("id", room.id);
  if (error) throw error;
}
