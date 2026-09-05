"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useForm, type UseFormSetValue, type UseFormWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { api, uploadCharacter } from "@/lib/api";
import type { CharacterAssetList } from "@/lib/types";
import { LayerEditor } from "@/components/create/layer-editor";
import { UserBackgroundPanel } from "@/components/background-picker";
import type { AssetList } from "@/lib/types";
import { VOICES, VOICE_PERSONALITIES, TTS_PROVIDERS, type VoicePersonality } from "@/lib/voices";
import {
  DEFAULT_MEME_STATE,
  DEFAULT_WIZARD_STATE,
  DURATIONS,
  STEPS,
  STEP_FIELDS,
  buildPayload,
  clearDraft,
  loadDraft,
  saveDraft,
  stateFromJob,
  wizardSchema,
  type WizardInput,
  type WizardState,
} from "@/lib/wizard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CustomizePanel, Segmented } from "@/components/customize-panel";
import { cn } from "@/lib/utils";
import { SCENE_LABELS } from "@/lib/scenes";
import { PhoneFramePreview } from "@/components/create/phone-preview";
import { Stepper } from "@/components/create/stepper";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

type FieldName = Extract<keyof WizardState, string>;

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="text-[13px] font-medium text-destructive">{msg}</p>;
}

function Row({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        {hint ? (
          <span className="text-[13px] tabular-nums text-muted-foreground">{hint}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function StoryWizard({ template = "story" }: { template?: "story" | "meme" }) {
  const router = useRouter();
  const isMeme = template === "meme";
  const [step, setStep] = useState(0);
  const [maxVisited, setMaxVisited] = useState(0);
  const [creating, setCreating] = useState(false);

  const {
    register,
    handleSubmit,
    getValues,
    setValue,
    watch,
    trigger,
    reset,
    formState: { errors },
  } = useForm<WizardInput, unknown, WizardState>({
    resolver: zodResolver(wizardSchema),
    defaultValues: isMeme ? DEFAULT_MEME_STATE : DEFAULT_WIZARD_STATE,
    mode: "onTouched",
  });

  // Draft restore (after hydration so SSR markup stays stable)
  const restoredOnce = useRef(false);

  // Regenerate prefill takes precedence over any saved draft.
  const searchParams = useSearchParams();
  useEffect(() => {
    if (restoredOnce.current) return;
    const from = searchParams.get("from");
    if (!from) return;
    restoredOnce.current = true;
    api
      .get(`/jobs/${from}`)
      .then(({ data }) => {
        reset(stateFromJob(data));
        clearDraft(template);
        toast.info(
          `Settings loaded from "${(data.title || "untitled reel").slice(0, 60)}"`,
        );
        router.replace(`/dashboard/create/${template}`);
      })
      .catch(() => toast.error("Couldn't load that reel's settings"));
  }, [searchParams, reset, router]);

  // Library handoff: /dashboard/create/story?bg=<id> pre-selects user footage.
  const bgApplied = useRef(false);
  const bgParam = searchParams.get("bg");
  useEffect(() => {
    if (bgApplied.current || !bgParam || restoredOnce.current) return;
    bgApplied.current = true;
    setValue("gameplay_source", "user", { shouldDirty: true });
    setValue("background_id", bgParam, { shouldDirty: true });
    toast.info("Footage selected for your reel");
    router.replace(`/dashboard/create/${template}`);
  }, [bgParam, setValue, router]);

  useEffect(() => {
    if (restoredOnce.current) return;
    restoredOnce.current = true;
    const draft = loadDraft(template);
    if (draft && (draft.title || draft.story)) {
      reset(draft);
      toast.info("Draft restored", {
        description: "We kept your unfinished reel safe.",
      });
    }
  }, [reset]);

  // Debounced autosave
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const sub = watch((values) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(
        () => saveDraft(template, values as WizardState),
        500,
      );
    });
    return () => sub.unsubscribe();
  }, [watch]);

  const { data: quota } = useSWR<{
    daily_used: number;
    daily_limit: number;
    unlimited?: boolean;
    plan?: string;
  }>("/quota/me", fetcher, { refreshInterval: 30_000 });
  const canRetain = quota?.plan === "premium" || quota?.unlimited;
  const { data: assetData } = useSWR<AssetList>("/assets", fetcher);

  const values = watch();
  const wordCount = values.story?.trim()
    ? values.story.trim().split(/\s+/).length
    : 0;

  async function goNext() {
    // Memes don't require a Reddit title — only the story text.
    const fields =
      STEPS[step].id === "content" && template === "meme"
        ? ["story"]
        : STEP_FIELDS[STEPS[step].id];
    const ok = await trigger(fields as FieldName[], { shouldFocus: true });
    if (!ok) {
      toast.error("Fix the highlighted fields to continue");
      return;
    }
    setStep((s) => {
      const next = Math.min(s + 1, STEPS.length - 1);
      setMaxVisited((m) => Math.max(m, next));
      return next;
    });
  }

  function goTo(i: number) {
    if (i <= maxVisited) setStep(i);
  }

  async function onSubmit(state: WizardState) {
    setCreating(true);
    try {
      const r = await api.post<{ job_id: string; duplicate: boolean }>(
        "/jobs",
        buildPayload(state),
      );
      clearDraft(template);
      toast.success(r.data.duplicate ? "Already rendering this story" : "Reel queued");
      router.push(`/dashboard/reels?highlight=${r.data.job_id}`);
    } catch (err: unknown) {
      type ErrShape = { response?: { data?: { detail?: string } } };
      const detail =
        (err as ErrShape)?.response?.data?.detail || "Could not create job";
      toast.error(detail);
    } finally {
      setCreating(false);
    }
  }

  const s = values;
  const err = errors as Record<string, { message?: string } | undefined>;

  // Provider-aware voice list: Local TTS shows only free-engine voices;
  // ElevenLabs hides them; Auto shows everything.
  const visibleVoices =
    s.tts_provider === "edge"
      ? VOICES.filter((v) => v.edgeOnly)
      : s.tts_provider === "elevenlabs"
        ? VOICES.filter((v) => !v.edgeOnly)
        : VOICES;
  // A saved voice hidden by the provider switch would render with a
  // different engine — snap the selection to a visible option instead.
  const activeVoice = visibleVoices.some((v) => v.id === s.voice)
    ? s.voice
    : (visibleVoices[0]?.id ?? "daniel");

  // Snap the stored voice into the visible list so the payload never ships a
  // voice the chosen provider can't actually render.
  useEffect(() => {
    if (s.voice !== activeVoice) {
      setValue("voice", activeVoice, { shouldDirty: true });
    }
  }, [s.voice, activeVoice, setValue]);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_220px]">
      {/* Left — steps */}
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-4">
          <Link
            href="/dashboard/create"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
            All formats
          </Link>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            Story Reel
          </h1>
          <Stepper current={step} maxVisited={maxVisited} onStepClick={goTo} />
        </header>

        <form onSubmit={(e) => void handleSubmit(onSubmit)(e)}>
          <Card>
            <CardContent className="flex flex-col gap-5 p-6">
              {step === 0 && (
                <>
                  <Row
                    label={isMeme ? "Title (optional)" : "Title"}
                    hint={err.title ? undefined : `${(getValues().title ?? "").length}/300`}
                  >
                    <Input
                      placeholder={
                        isMeme
                          ? "Skip it — we'll name it from your caption"
                          : 'e.g. "AITA for returning my roommate\'s vacuum?"'
                      }
                      aria-invalid={!!err.title}
                      {...register("title")}
                    />
                    <FieldError msg={err.title?.message} />
                  </Row>
                  {!isMeme && (
                    <Row label="Subreddit label (optional)">
                      <Input placeholder="AskReddit" {...register("subreddit")} />
                    </Row>
                  )}
                  <Row label={isMeme ? "Voiceover text" : "Story / post content"} hint={`${wordCount} words`}>
                    <Textarea
                      rows={12}
                      className="resize-y"
                      placeholder="Paste the full post text here..."
                      aria-invalid={!!err.story}
                      {...register("story")}
                    />
                    <FieldError msg={err.story?.message} />
                  </Row>
                  <Row label="Max duration" hint={DURATIONS.find((d) => d.words === s.max_words)?.label}>
                    <Slider
                      min={0}
                      max={DURATIONS.length - 1}
                      step={1}
                      value={[DURATIONS.findIndex((d) => d.words === s.max_words)]}
                      onValueChange={([i]) =>
                        setValue("max_words", DURATIONS[i]?.words ?? 1200, {
                          shouldDirty: true,
                        })
                      }
                    />
                  </Row>
                </>
              )}

              {step === 1 && (
                <>
                  <Row label="Voice engine">
                    <RadioGroup
                      value={s.tts_provider}
                      onValueChange={(v) => setValue("tts_provider", v as WizardState["tts_provider"], { shouldDirty: true })}
                      className="flex flex-col gap-2"
                    >
                      {TTS_PROVIDERS.map((p) => (
                        <div key={p.id} className="flex items-center gap-2">
                          <RadioGroupItem value={p.id} id={`tts-${p.id}`} />
                          <Label htmlFor={`tts-${p.id}`} className="font-normal">
                            {p.label}
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </Row>

                  <Row label="Voice">
                    <Select
                      value={activeVoice}
                      onValueChange={(v) => setValue("voice", v, { shouldDirty: true })}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(["Male", "Female", "Neutral", "Kid"] as const)
                          .map((group) => ({
                            group,
                            items: visibleVoices.filter((v) => v.group === group),
                          }))
                          .filter(({ items }) => items.length > 0)
                          .map(({ group, items }) => (
                            <div key={group}>
                              <p className="px-2 py-1 text-[13px] font-medium text-muted-foreground">
                                {group}
                              </p>
                              {items.map((v) => (
                                <SelectItem key={v.id} value={v.id}>
                                  {v.label}
                                </SelectItem>
                              ))}
                            </div>
                          ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[13px] text-muted-foreground">
                      {s.tts_provider === "edge"
                        ? "Free engine — regional accents & Hinglish."
                        : s.tts_provider === "elevenlabs"
                          ? "Premium voices."
                          : "Premium first, free-engine fallback."}
                    </p>
                  </Row>

                  {s.tts_provider !== "elevenlabs" && (
                    <Row label="Personality" hint="Local TTS only">
                      <Segmented
                        value={(s.voice_personality ?? "none") as "none"}
                        onChange={(v) =>
                          setValue(
                            "voice_personality",
                            v as VoicePersonality,
                            { shouldDirty: true },
                          )
                        }
                        options={[...VOICE_PERSONALITIES]}
                      />
                    </Row>
                  )}

                  <Row label="Speech speed" hint={`${s.speed.toFixed(2)}×`}>
                    <Slider
                      min={0.8}
                      max={1.5}
                      step={0.05}
                      value={[s.speed]}
                      onValueChange={([v]) => setValue("speed", v, { shouldDirty: true })}
                    />
                  </Row>

                  <Row label="Expressiveness">
                    <Segmented
                      value={s.expressiveness}
                      onChange={(v) => setValue("expressiveness", v, { shouldDirty: true })}
                      options={[
                        { value: "natural", label: "Natural" },
                        { value: "expressive", label: "Expressive" },
                        { value: "dramatic", label: "Dramatic" },
                      ]}
                    />
                  </Row>
                </>
              )}

              {step === 2 && isMeme && (
                <MemeLookStep watch={watch} setValue={setValue} canRetain={canRetain ?? false} />
              )}

              {step === 2 && !isMeme && (
                <>
                  <CustomizePanel
                    preview={false}
                    value={{
                      captions_enabled: s.captions_enabled,
                      caption_mode: s.caption_mode,
                      caption_layout: s.caption_layout,
                      caption_font_size: s.caption_font_size,
                      caption_scale: s.caption_scale ?? 100,
                      caption_position: s.caption_position,
                      caption_y: s.caption_y,
                      caption_color: s.caption_color,
                      caption_outline: s.caption_outline,
                      caption_words: s.caption_words,
                      caption_animation: s.caption_animation,
                      caption_highlight_color: s.caption_highlight_color,
                      title_enabled: s.title_enabled,
                      title_position: s.title_position,
                      title_scale: s.title_scale,
                      title_style: s.title_style,
                      title_badge: s.title_badge,
                    }}
                    onChange={(patch) => {
                      for (const [k, v] of Object.entries(patch)) {
                        setValue(k as FieldName, v as never, { shouldDirty: true });
                      }
                    }}
                  />

                  <Row label="Gameplay background">
                    <RadioGroup
                      value={s.gameplay_source}
                      onValueChange={(v) => setValue("gameplay_source", v as WizardState["gameplay_source"], { shouldDirty: true })}
                      className="flex gap-4"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="library" id="bgsrc-library" />
                        <Label htmlFor="bgsrc-library" className="font-normal">Library</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="user" id="bgsrc-user" />
                        <Label htmlFor="bgsrc-user" className="font-normal">My footage</Label>
                      </div>
                    </RadioGroup>
                  </Row>

                  {s.gameplay_source === "library" ? (
                    <Row label="Clip category">
                      <Select value={s.gameplay_category} onValueChange={(v) => setValue("gameplay_category", v, { shouldDirty: true })}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(assetData?.categories ?? ["any"]).map((c) => (
                            <SelectItem key={c} value={c} className="capitalize">
                              {c === "any" ? "Any" : c.replace("_", " ")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Row>
                  ) : (
                    <UserBackgroundPicker
                      value={s.background_id || ""}
                      onChange={(id) => setValue("background_id", id, { shouldDirty: true })}
                      error={err.background_id?.message}
                    />
                  )}

                  <Row label="Keep the finished file?">
                    <RadioGroup
                      value={s.retention}
                      onValueChange={(v) => setValue("retention", v as WizardState["retention"], { shouldDirty: true })}
                      className="flex gap-4"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="ephemeral" id="ret-ephemeral" />
                        <Label htmlFor="ret-ephemeral" className="font-normal">Auto-delete (~15 min)</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="retain" id="ret-retain" disabled={!canRetain} />
                        <Label htmlFor="ret-retain" className={`font-normal ${canRetain ? "" : "opacity-50"}`}>
                          Keep until I delete
                        </Label>
                        {!canRetain && (
                          <Badge variant="outline" className="text-xs uppercase tracking-wide">premium</Badge>
                        )}
                      </div>
                    </RadioGroup>
                  </Row>
                </>
              )}

              {step === 3 && (
                <ReviewSummary values={s} onEdit={goTo} />
              )}
            </CardContent>
          </Card>

          {/* Footer nav */}
          <div className="mt-5 flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep((v) => Math.max(0, v - 1))}
              disabled={step === 0}
            >
              <ChevronLeft />
              Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button type="button" onClick={() => void goNext()}>
                Continue
                <ChevronRight />
              </Button>
            ) : (
              <Button type="submit" size="lg" disabled={creating}>
                {creating ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Sparkles />
                    Generate Reel
                  </>
                )}
              </Button>
            )}
          </div>
        </form>
      </div>

      {/* Right rail — live preview + quota */}
      <aside className="hidden flex-col gap-4 self-start lg:sticky lg:top-24 lg:flex">
        <PhoneFramePreview settings={s} className="mx-auto" />
        <Button
          variant="ghost"
          size="sm"
          className="mx-auto text-muted-foreground"
          onClick={() => reset({ ...DEFAULT_WIZARD_STATE })}
        >
          <RotateCcw />
          Reset all
        </Button>
        {quota && (
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm font-medium">Quota</p>
            <Progress
              value={
                quota.unlimited
                  ? 0
                  : (quota.daily_used / Math.max(1, quota.daily_limit)) * 100
              }
              className="mt-2 h-1.5"
            />
            <p className="mt-2 text-[13px] tabular-nums text-muted-foreground">
              {quota.unlimited
                ? "Unlimited renders"
                : `${Math.max(0, quota.daily_limit - quota.daily_used)} videos left today`}
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

// ------------------------------------------------------------------ helpers

function ReviewSummary({
  values,
  onEdit,
}: {
  values: WizardInput;
  onEdit: (step: number) => void;
}) {
  const voice = VOICES.find((v) => v.id === values.voice)?.label ?? values.voice;
  const duration =
    DURATIONS.find((d) => d.words === values.max_words)?.label ??
    `${values.max_words} words`;

  const groups: { title: string; step: number; rows: [string, React.ReactNode][] }[] = [
    {
      title: "Content",
      step: 0,
      rows: [
        ...(values.title ? ([["Title", values.title]] as [string, React.ReactNode][]) : []),
        ...(values.template !== "meme"
          ? ([
              ["Subreddit", values.subreddit || "—"],
            ] as [string, React.ReactNode][])
          : []),
        [
          values.template === "meme" ? "Voiceover text" : "Story",
          `${wordCountOf(values.story)} words · "${truncate(values.story, 80)}"`,
        ],
      ],
    },
    {
      title: "Voice",
      step: 1,
      rows: [
        ["Engine", TTS_PROVIDERS.find((p) => p.id === values.tts_provider)?.label ?? values.tts_provider],
        ["Voice", voice],
        ["Speed", `${values.speed.toFixed(2)}×`],
        ["Expressiveness", capitalize(values.expressiveness)],
      ],
    },
    {
      title: "Look & background",
      step: 2,
      rows: ((values.template === "meme"
        ? [
            ["Scene", SCENE_LABELS[values.scene_id] ?? values.scene_id],
            [
              "Voice pitch",
              values.tts_pitch
                ? `${values.tts_pitch > 0 ? "+" : ""}${values.tts_pitch} st`
                : "natural",
            ],
          ]
        : [
            [
              "Background",
              values.gameplay_source === "user"
                ? "My footage"
                : `Library · ${values.gameplay_category}`,
            ],
          ]) as [string, React.ReactNode][]).concat([
        [
          "Captions",
          values.captions_enabled
            ? `On · ${values.caption_font_size}px · ${values.caption_color} · ${values.caption_position}`
            : "Off",
        ],
        [
          "Title card",
          values.title_enabled
            ? `On · ${values.title_position} · ${values.title_scale}%`
            : "Off",
        ],
        [
          "File retention",
          values.retention === "retain"
            ? "Keep until deleted"
            : "Auto-delete ~15 min",
        ],
      ]),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {groups.map((g) => (
        <section key={g.title} className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-lg font-semibold tracking-tight">{g.title}</h2>
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onEdit(g.step)}>
              Edit
            </Button>
          </div>
          <dl className="overflow-hidden rounded-lg border">
            {g.rows.map(([k, v], i) => (
              <div
                key={k}
                className={`grid grid-cols-[130px_minmax(0,1fr)] gap-3 px-4 py-2.5 text-sm ${i > 0 ? "border-t" : ""}`}
              >
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="break-words">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

function UserBackgroundPicker({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (id: string) => void;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <UserBackgroundPanel value={value || undefined} onChange={onChange} />
      <FieldError msg={error} />
    </div>
  );
}

const truncate = (t: string, n: number) =>
  t.length > n ? `${t.slice(0, n)}…` : t || "";
const wordCountOf = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);
const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

// ------------------------------------------------------------------ meme look

function ScenePicker({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (id: string) => void;
}) {
  const { data: scenes } = useSWR<{ id: string; label: string; kind: string }[]>(
    "/scenes",
    fetcher,
  );
  return (
    <div className="grid grid-cols-3 gap-3">
      {(scenes ?? []).map((sc) => (
        <button
          key={sc.id}
          type="button"
          onClick={() => onSelect(sc.id)}
          aria-pressed={selected === sc.id}
          className={cn(
            "flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border p-1.5 transition-colors",
            selected === sc.id ? "border-brand ring-1 ring-brand" : "hover:border-ring",
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/proxy/scenes/${sc.id}/preview`}
            alt=""
            loading="lazy"
            className="aspect-[9/16] w-full rounded-md object-cover"
          />
          <span className="pb-0.5 text-[13px] font-medium">{sc.label}</span>
        </button>
      ))}
    </div>
  );
}

const DEFAULT_CHAR_SPOTS = [
  { x: 0.5, y: 0.62 },
  { x: 0.28, y: 0.68 },
  { x: 0.72, y: 0.68 },
];

function CharacterPicker({
  selectedIds,
  onToggle,
}: {
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const { data, mutate } = useSWR<CharacterAssetList>("/characters", fetcher);
  const items = data?.items.filter((a) => a.status === "ready") ?? [];
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<"idle" | "working">("idle");
  const [bgRemoved, setBgRemoved] = useState(true);
  const [dragOver, setDragOver] = useState(false);

  async function upload(file: File | undefined | null) {
    if (!file || phase === "working") return;
    setPhase("working");
    try {
      const asset = await uploadCharacter(file, { bgRemoved });
      if (asset.status !== "ready") throw new Error(asset.error_message || "Processing failed");
      toast.success(bgRemoved && asset.bg_removed ? "Character cut out" : "Image ready");
      await mutate();
      onToggle(asset.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setPhase("idle");
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-dashed p-3 transition-colors",
        dragOver ? "border-brand bg-brand/5" : "border-transparent",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (phase === "working") return;
        const file = e.dataTransfer.files?.[0];
        if (file) void upload(file);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => void upload(e.target.files?.[0])}
        disabled={phase === "working"}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" disabled={phase === "working"} onClick={() => inputRef.current?.click()}>
          {phase === "working" ? <Loader2 className="animate-spin" /> : <Plus />}
          Upload character
        </Button>
        <label className="flex cursor-pointer items-center gap-1.5 text-[13px] text-muted-foreground">
          <Switch checked={bgRemoved} onCheckedChange={setBgRemoved} />
          Remove background
        </label>
        {items.length > 0 && (
          <span className="text-[13px] text-muted-foreground">
            tap to place / remove · max 3
          </span>
        )}
      </div>
      <p className="text-[13px] text-muted-foreground">
        Pick a file or drop a PNG/JPG here{bgRemoved ? " — the background is cut out automatically." : "."}
      </p>

      {items.length > 0 && (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {items.map((a) => {
            const idx = selectedIds.indexOf(a.id);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onToggle(a.id)}
                aria-pressed={idx >= 0}
                className={cn(
                  "relative aspect-square cursor-pointer overflow-hidden rounded-lg border bg-muted p-0 transition-all",
                  idx >= 0 ? "border-brand ring-1 ring-brand" : "hover:border-ring",
                  !a.bg_removed && "after:absolute after:inset-0 after:bg-white/60 after:content-['']",
                )}
                title={!a.bg_removed ? "Original image (no cutout)" : a.label}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/proxy/characters/${a.id}/file`}
                  alt=""
                  loading="lazy"
                  className="size-full object-contain"
                />
                {idx >= 0 && (
                  <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white">
                    {idx + 1}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MemeLookStep({
  watch,
  setValue,
  canRetain,
}: {
  watch: UseFormWatch<WizardInput>;
  setValue: UseFormSetValue<WizardInput>;
  canRetain: boolean;
}) {
  const sceneId = watch("scene_id");
  const sceneAnimated = watch("scene_animated");
  const pitch = watch("tts_pitch");
  const characters = watch("characters") ?? [];
  const texts = watch("text_overlays") ?? [];

  function setCaptionsEnabled(enabled: boolean) {
    setValue("captions_enabled", enabled, { shouldDirty: true });
  }

  function toggleCharacter(id: string) {
    const idx = characters.findIndex((c) => c.asset_id === id);
    if (idx >= 0) {
      setValue(
        "characters",
        characters.filter((_, k) => k !== idx),
        { shouldDirty: true },
      );
      return;
    }
    if (characters.length >= 3) {
      toast.error("Up to 3 characters per reel");
      return;
    }
    const spot = DEFAULT_CHAR_SPOTS[characters.length % DEFAULT_CHAR_SPOTS.length];
    setValue(
      "characters",
      [...characters, { asset_id: id, ...spot, scale: 0.35, flip: false, bob: true, rotation: 0 }],
      { shouldDirty: true },
    );
  }

  return (
    <>
      <Row label="Scene">
        <ScenePicker selected={sceneId} onSelect={(id) => setValue("scene_id", id, { shouldDirty: true })} />
        <FieldError msg={undefined} />
      </Row>

      <Row label="Background motion">
        <Segmented
          value={sceneAnimated ? "animated" : "static"}
          onChange={(v) => setValue("scene_animated", v === "animated", { shouldDirty: true })}
          options={[
            { value: "static", label: "Static frame" },
            { value: "animated", label: "Animated" },
          ]}
        />
        <p className="text-[13px] text-muted-foreground">
          Static pins gradient scenes to a single blended frame — the classic
          fixed-background reel look.
        </p>
      </Row>

      <Row label="Characters">
        <CharacterPicker
          selectedIds={characters.map((c) => c.asset_id)}
          onToggle={toggleCharacter}
        />
      </Row>

      <Row label="Arrange layers">
        <LayerEditor
          sceneId={sceneId}
          characters={characters}
          texts={texts}
          captions={{
            enabled: watch("captions_enabled"),
            y: watch("caption_y") ?? 0.65,
            fontSize: watch("caption_font_size"),
            color: watch("caption_color"),
            outline: watch("caption_outline"),
            words: watch("caption_words"),
            position: watch("caption_position"),
            mode: watch("caption_mode") ?? "synced",
            layout: watch("caption_layout") ?? "chunks",
            scale: watch("caption_scale") ?? 100,
            text: watch("caption_text") ?? "",
            onChange: setCaptionsEnabled,
            onYChange: (v) =>
              setValue(
                "caption_y",
                Math.min(0.95, Math.max(0.05, v)),
                { shouldDirty: true },
              ),
            onModeChange: (v) => {
              setValue("caption_mode", v, { shouldDirty: true });
              // Switching to static pre-fills the caption text from the story
              // so users trim instead of re-typing.
              if (v === "static" && !(watch("caption_text") ?? "").trim()) {
                const story = (watch("story") ?? "").trim();
                if (story) {
                  setValue("caption_text", story.slice(0, 600), { shouldDirty: true });
                  toast.info("Caption text prefilled from your story — trim it to the punchy bits");
                }
              }
            },
            onLayoutChange: (v) => setValue("caption_layout", v, { shouldDirty: true }),
            onScaleChange: (v) => setValue("caption_scale", v, { shouldDirty: true }),
            onTextChange: (v) => setValue("caption_text", v, { shouldDirty: true }),
          }}
          onCharactersChange={(next) => setValue("characters", next, { shouldDirty: true })}
          onTextsChange={(next) => setValue("text_overlays", next, { shouldDirty: true })}
        />
      </Row>

      <Row
        label="Voice pitch"
        hint={pitch ? `${pitch > 0 ? "+" : ""}${pitch} st` : "natural"}
      >
        <Slider
          min={-12}
          max={12}
          step={1}
          value={[pitch]}
          onValueChange={([v]) => setValue("tts_pitch", v, { shouldDirty: true })}
        />
        <p className="text-[13px] text-muted-foreground">
          Pitch up for the classic meme sound. Applied after transcription, so
          captions stay word-synced.
        </p>
      </Row>

      <Row label="Keep the finished file?">
        <RadioGroup
          value={watch("retention")}
          onValueChange={(v) => setValue("retention", v as "ephemeral" | "retain", { shouldDirty: true })}
          className="flex gap-4"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="ephemeral" id="meme-ret-ephemeral" />
            <Label htmlFor="meme-ret-ephemeral" className="font-normal">Auto-delete (~15 min)</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="retain" id="meme-ret-retain" disabled={!canRetain} />
            <Label htmlFor="meme-ret-retain" className={`font-normal ${canRetain ? "" : "opacity-50"}`}>
              Keep until I delete
            </Label>
            {!canRetain && (
              <Badge variant="outline" className="text-xs uppercase tracking-wide">premium</Badge>
            )}
          </div>
        </RadioGroup>
      </Row>
    </>
  );
}
