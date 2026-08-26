// Mirrors backend/services/tts.py VOICE_CATALOG.
// edgeOnly: free-engine exclusives (no verified ElevenLabs premade) — hidden
// when the ElevenLabs provider is selected; Local TTS shows ONLY these.
export interface VoiceOption {
  id: string;
  label: string;
  group: string;
  edgeOnly?: boolean;
}

export const VOICES: VoiceOption[] = [
  { id: "brian", label: "Brian · Resonant American", group: "Male" },
  { id: "charlie", label: "Charlie · Energetic Australian", group: "Male" },
  { id: "daniel", label: "Daniel · British Broadcast", group: "Male" },
  { id: "george", label: "George · Warm British Storyteller", group: "Male" },
  { id: "eric", label: "Eric · Smooth Conversational", group: "Male" },
  { id: "liam", label: "Liam · Young & Energetic", group: "Male" },
  { id: "roger", label: "Roger · Laid-back American", group: "Male" },
  { id: "callum", label: "Callum · Dark & Gravelly", group: "Male" },
  { id: "harry", label: "Harry · Animated & Intense", group: "Male" },
  { id: "bill", label: "Bill · Warm Documentarian", group: "Male" },
  { id: "adam", label: "Adam · Deep All-Rounder", group: "Male" },
  { id: "will", label: "Will · Casual Podcast", group: "Male" },
  { id: "antoni", label: "Antoni · Smooth Articulate", group: "Male" },
  { id: "alice", label: "Alice · Friendly British", group: "Female" },
  { id: "jessica", label: "Jessica · Playful & Trendy", group: "Female" },
  { id: "laura", label: "Laura · Sunny & Quirky", group: "Female" },
  { id: "lily", label: "Lily · Velvety British", group: "Female" },
  { id: "matilda", label: "Matilda · Professional Alto", group: "Female" },
  { id: "sarah", label: "Sarah · Confident & Warm", group: "Female" },
  { id: "river", label: "River · Relaxed Androgynous", group: "Neutral" },
  { id: "ana", label: "Ana · Kid Voice", group: "Kid" },
  // --- Free-engine accent roster ---
  { id: "prabhat", label: "Prabhat · Indian Hinglish", group: "Male", edgeOnly: true },
  { id: "neerja", label: "Neerja · Indian Hinglish", group: "Female", edgeOnly: true },
  { id: "steffan", label: "Steffan · American", group: "Male", edgeOnly: true },
  { id: "michelle", label: "Michelle · American", group: "Female", edgeOnly: true },
  { id: "thomas", label: "Thomas · British", group: "Male", edgeOnly: true },
  { id: "libby", label: "Libby · British", group: "Female", edgeOnly: true },
  { id: "connor", label: "Connor · Irish", group: "Male", edgeOnly: true },
  { id: "emily", label: "Emily · Irish", group: "Female", edgeOnly: true },
  { id: "chilemba", label: "Chilemba · Kenyan", group: "Male", edgeOnly: true },
  { id: "asilia", label: "Asilia · Kenyan", group: "Female", edgeOnly: true },
  { id: "abeo", label: "Abeo · Nigerian", group: "Male", edgeOnly: true },
  { id: "ezinne", label: "Ezinne · Nigerian", group: "Female", edgeOnly: true },
  { id: "luke", label: "Luke · South African", group: "Male", edgeOnly: true },
  { id: "leah", label: "Leah · South African", group: "Female", edgeOnly: true },
  { id: "pradeep", label: "Pradeep · Bangla", group: "Male", edgeOnly: true },
  { id: "nabanita", label: "Nabanita · Bangla", group: "Female", edgeOnly: true },
];

export const VOICE_PERSONALITIES = [
  { value: "none", label: "Default" },
  { value: "friendly", label: "Friendly" },
  { value: "hype", label: "Hype" },
  { value: "calm", label: "Calm" },
  { value: "serious", label: "Serious" },
] as const;

export type VoicePersonality = (typeof VOICE_PERSONALITIES)[number]["value"];

export const TTS_PROVIDERS = [
  { id: "auto", label: "Auto (best available)" },
  { id: "elevenlabs", label: "ElevenLabs (premium)" },
  { id: "edge", label: "Local TTS (free)" },
];
