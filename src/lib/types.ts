export type PackClip = {
  id: string;
  audio: string;
  image?: string;
  caption: string;
  timestamps: number[];
  characters: string[];
};

export type PackCharacter = {
  name: string;
  image?: string;
  clips: number;
};

export type PackManifest = {
  root: string;
  title: string;
  subtitle?: string;
  authors: string[];
  icon?: string;
  video: string;
  backing?: string;
  characters: PackCharacter[];
  clips: PackClip[];
};

export type PackSource = "cloud" | "gamebanana" | "local";
export type RoomStatus = "lobby" | "recording" | "finished";

export type RoomSettings = {
  surprise?: boolean;
  watched?: boolean;
};

export type Room = {
  id: string;
  code: string;
  owner_id: string;
  name: string;
  max_players: number;
  status: RoomStatus;
  pack_source: PackSource;
  pack_key: string;
  pack_name: string | null;
  pack_size: number | null;
  pack_chunks: number;
  pack_ready: boolean;
  pack_url: string | null;
  manifest: PackManifest;
  settings: RoomSettings;
  created_at: string;
  updated_at: string;
};

export type Profile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
};

export type Member = {
  room_id: string;
  user_id: string;
  joined_at: string;
  pack_ready: boolean;
  watch_ready: boolean;
  profile: Profile | null;
};

export type Claim = {
  room_id: string;
  character: string;
  user_id: string;
};

export type Take = {
  room_id: string;
  clip_id: string;
  user_id: string;
  path: string;
  duration_ms: number;
  offset_ms: number;
  updated_at: string;
};
