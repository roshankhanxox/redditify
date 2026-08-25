// Mirrors backend/services/tts.py VOICE_CATALOG — only IDs verified as
// HTTP 200 on the configured ElevenLabs key (off-plan voices 402 at render)
export const VOICES: { id: string; label: string; group: string }[] = [
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
];

export const TTS_PROVIDERS = [
  { id: "auto", label: "Auto (best available)" },
  { id: "elevenlabs", label: "ElevenLabs (premium)" },
  { id: "edge", label: "Local TTS (free)" },
];
