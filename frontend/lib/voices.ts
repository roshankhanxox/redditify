// Mirrors backend/services/tts.py VOICE_CATALOG
export const VOICES: { id: string; label: string; group: string }[] = [
  { id: "male", label: "Daniel · Deep Storyteller", group: "Male" },
  { id: "adam", label: "Adam · Warm Narrator", group: "Male" },
  { id: "josh", label: "Josh · Energetic Male", group: "Male" },
  { id: "brian", label: "Brian · Casual Male", group: "Male" },
  { id: "george", label: "George · British Narrator", group: "Male" },
  { id: "female", label: "Sarah · Friendly Female", group: "Female" },
  { id: "rachel", label: "Rachel · Calm Female", group: "Female" },
  { id: "emily", label: "Emily · Bright Female", group: "Female" },
  { id: "charlotte", label: "Charlotte · Posh Female", group: "Female" },
  { id: "gigi", label: "Gigi · Sassy Female", group: "Female" },
];

export const TTS_PROVIDERS = [
  { id: "auto", label: "Auto (best available)" },
  { id: "elevenlabs", label: "ElevenLabs (premium)" },
  { id: "edge", label: "Local TTS (free)" },
];
